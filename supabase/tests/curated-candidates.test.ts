import fs from 'fs';
import path from 'path';
import { buildSeedSql, CANDIDATE_COLUMNS, parseCandidates, validateCandidates } from '../tools/curated/curation';

const COMPLETE: Record<string, string> = {
  id: 'nasi-lemak',
  name_en: 'Nasi lemak',
  alias_en: '',
  alias_ms: '',
  alias_ta: '',
  region: 'MY',
  serving_amount: '250',
  serving_unit: 'g',
  serving_desc: '1 plate (250 g)',
  calories: '644',
  protein_g: '15.5',
  carbs_g: '80',
  fat_g: '28',
  source_name: 'Example reviewed source',
  source_url: 'https://example.org/foods/nasi-lemak',
  source_record_id: 'EX-001',
  accessed_on: '2026-10-13',
  reuse_permission_evidence: 'Written permission, ref 123, 2026-10-01',
  reviewer: 'Eswar',
  verdict: 'approved',
  notes: '',
};

const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
const csv = (...rows: Record<string, string>[]) =>
  [CANDIDATE_COLUMNS.join(','), ...rows.map((row) => CANDIDATE_COLUMNS.map((column) => quote(row[column] ?? '')).join(','))].join('\n');
const approved = (overrides: Record<string, string> = {}) => ({ ...COMPLETE, ...overrides });
const unreviewed = (overrides: Record<string, string> = {}) => ({
  ...Object.fromEntries(CANDIDATE_COLUMNS.map((column) => [column, ''])),
  id: 'roti-canai',
  name_en: 'Roti canai',
  region: 'MY',
  verdict: 'unreviewed',
  ...overrides,
});

const issuesFor = (...rows: Record<string, string>[]) => validateCandidates(parseCandidates(csv(...rows)));
const fields = (issues: { field: string }[]) => issues.map((issue) => issue.field);

describe('candidate file parsing', () => {
  it('parses quoted fields, commas and doubled quotes', () => {
    const [row] = parseCandidates(csv(approved({ name_en: 'Mak "Cik", special', notes: 'a, b' })));

    expect(row.name_en).toBe('Mak "Cik", special');
    expect(row.notes).toBe('a, b');
  });

  it('refuses a file whose header does not match the expected columns', () => {
    expect(() => parseCandidates('id,name\n1,x')).toThrow(/header/i);
  });

  it('ignores blank lines and Windows line endings', () => {
    const text = csv(unreviewed()).replace(/\n/g, '\r\n') + '\r\n\r\n';

    expect(parseCandidates(text)).toHaveLength(1);
  });
});

describe('validateCandidates', () => {
  it('accepts a fully reviewed, source-backed candidate', () => {
    expect(issuesFor(approved())).toEqual([]);
  });

  it('accepts an unreviewed candidate that is only a name (no values are required yet)', () => {
    expect(issuesFor(unreviewed())).toEqual([]);
  });

  it.each([
    ['a blank source name', { source_name: '' }, 'source_name'],
    ['a blank source url', { source_url: '' }, 'source_url'],
    ['a source url that is not http(s)', { source_url: 'ftp://x' }, 'source_url'],
    ['a blank source record id', { source_record_id: '' }, 'source_record_id'],
    ['a missing access date', { accessed_on: '' }, 'accessed_on'],
    ['a malformed access date', { accessed_on: '13/10/2026' }, 'accessed_on'],
    ['absent reuse permission evidence', { reuse_permission_evidence: '  ' }, 'reuse_permission_evidence'],
    ['a missing reviewer', { reviewer: '' }, 'reviewer'],
  ])('rejects an approved row with %s', (_label, override, field) => {
    expect(fields(issuesFor(approved(override)))).toContain(field);
  });

  it.each([
    ['text', 'abc'],
    ['a unit suffix', '12 g'],
    ['a negative number', '-5'],
    ['a blank value', ''],
  ])('rejects an approved row with a nonnumeric nutrient (%s)', (_label, value) => {
    expect(fields(issuesFor(approved({ protein_g: value })))).toContain('protein_g');
  });

  it.each([
    ['calories', 'calories'],
    ['carbs', 'carbs_g'],
    ['fat', 'fat_g'],
  ])('rejects an approved row with a blank %s instead of treating it as zero', (_label, field) => {
    expect(fields(issuesFor(approved({ [field]: '' })))).toContain(field);
  });

  it.each([
    ['a serving amount that disagrees with the description', { serving_amount: '300' }],
    ['a serving unit that disagrees with the description', { serving_unit: 'ml' }],
    ['a zero serving amount', { serving_amount: '0' }],
    ['a nonnumeric serving amount', { serving_amount: 'one plate' }],
    ['an unsupported serving unit', { serving_unit: 'cups' }],
    ['a blank serving description', { serving_desc: '' }],
  ])('rejects an approved row with %s', (_label, override) => {
    const found = fields(issuesFor(approved(override)));

    expect(found.some((field) => field.startsWith('serving'))).toBe(true);
  });

  it('accepts a serving description that states no weight, as long as amount and unit are given', () => {
    expect(issuesFor(approved({ serving_desc: '1 plate' }))).toEqual([]);
  });

  it('rejects an approved row whose energy does not match its macros', () => {
    expect(fields(issuesFor(approved({ calories: '2500' })))).toContain('calories');
  });

  it('never lets nutrient values sit on a row without a source (no unsourced numbers)', () => {
    const found = fields(issuesFor(unreviewed({ calories: '300', source_name: '', source_url: '', source_record_id: '' })));

    expect(found).toEqual(expect.arrayContaining(['source_name', 'source_url', 'source_record_id']));
  });

  it('rejects a nonnumeric value even on an unreviewed row', () => {
    expect(fields(issuesFor(unreviewed({ calories: 'lots', source_name: 's', source_url: 'https://x.org', source_record_id: '1' })))).toContain('calories');
  });

  it('does not let a rejected or unreviewed row be treated as approved', () => {
    expect(() => buildSeedSql(parseCandidates(csv(unreviewed(), approved({ id: 'x', verdict: 'rejected' }))))).toThrow(/no approved/i);
  });

  it('rejects an unknown verdict, a duplicate id, and a bad id', () => {
    expect(fields(issuesFor(unreviewed({ verdict: 'maybe' })))).toContain('verdict');
    expect(fields(issuesFor(unreviewed(), unreviewed()))).toContain('id');
    expect(fields(issuesFor(unreviewed({ id: 'Has Spaces' })))).toContain('id');
  });

  it('reports the row number and id with each issue', () => {
    const [issue] = issuesFor(approved({ source_name: '' }));

    expect(issue).toMatchObject({ row: 2, id: 'nasi-lemak', field: 'source_name' });
  });
});

describe('buildSeedSql', () => {
  it('refuses to produce a seed when no candidate is approved', () => {
    expect(() => buildSeedSql(parseCandidates(csv(unreviewed())))).toThrow(/no approved/i);
  });

  it('refuses to produce a seed when an approved row is invalid, naming the problem', () => {
    expect(() => buildSeedSql(parseCandidates(csv(approved({ reuse_permission_evidence: '' }))))).toThrow(/reuse_permission_evidence/);
  });

  it('writes an idempotent insert of verified, shared, Malaysian curated foods from approved rows only', () => {
    const sql = buildSeedSql(
      parseCandidates(
        csv(
          approved({ alias_ms: 'nasi lemak biasa', alias_en: "coconut rice; Mak Cik's special" }),
          unreviewed()
        )
      )
    );

    expect(sql).toContain('insert into public.foods');
    expect(sql).toContain("'curated'");
    expect(sql).toContain('true');
    expect(sql).toContain("'MY'");
    expect(sql).toContain('null');
    expect(sql).toContain('on conflict (source, source_id) where user_id is null and source_id is not null do nothing');
    expect(sql).toContain('644');
    expect(sql).not.toContain('Roti canai');
  });

  it('escapes apostrophes and stores reviewed aliases per language as JSON', () => {
    const sql = buildSeedSql(parseCandidates(csv(approved({ name_en: "Mak Cik's nasi lemak", alias_en: 'a; b', alias_ms: 'nasi lemak biasa' }))));

    expect(sql).toContain("'Mak Cik''s nasi lemak'");
    expect(sql).toContain('"en":["a","b"]');
    expect(sql).toContain('"ms":["nasi lemak biasa"]');
    expect(sql).not.toContain('"ta"');
  });

  it('keeps provenance with each row: stable source id, source url, source record, reviewer and permission', () => {
    const sql = buildSeedSql(parseCandidates(csv(approved())));

    expect(sql).toContain("'nasi-lemak'"); // stable source_id used for idempotency
    expect(sql).toContain("'https://example.org/foods/nasi-lemak'"); // source_url column
    expect(sql).toContain('EX-001'); // the source's own record id, in the audit comment
    expect(sql).toContain('Example reviewed source');
    expect(sql).toContain('reviewed by Eswar');
    expect(sql).toContain('Written permission, ref 123');
  });
});

describe('the committed candidate list', () => {
  const file = path.resolve(__dirname, '../../docs/food/curated-candidates.csv');
  const rows = parseCandidates(fs.readFileSync(file, 'utf8'));

  it('exists with a starter list of well-known foods', () => {
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });

  it('has no validation problems', () => {
    expect(validateCandidates(rows)).toEqual([]);
  });

  it('carries no nutrition value without a source, and no alias nobody reviewed', () => {
    for (const row of rows) {
      const hasValue = [row.calories, row.protein_g, row.carbs_g, row.fat_g].some((value) => value.trim() !== '');
      if (hasValue) expect(row.source_name.trim()).not.toBe('');
      if (row.verdict !== 'approved') expect([row.alias_en, row.alias_ms, row.alias_ta].every((alias) => alias.trim() === '')).toBe(true);
    }
  });
});
