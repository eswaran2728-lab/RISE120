// Tooling for the curated Malaysian/Malay/Tamil food seed. It is a gate, not a data source:
// a row can only become a verified food if its serving, nutrition, source, reuse permission and
// reviewer are all recorded and valid. Nothing here invents a value. Not part of the app bundle.
import { isEnergyConsistent } from '../../functions/_shared/food/consistency';

export const CANDIDATE_COLUMNS = [
  'id', 'name_en', 'alias_en', 'alias_ms', 'alias_ta', 'region', 'serving_amount', 'serving_unit', 'serving_desc',
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'source_name', 'source_url', 'source_record_id', 'accessed_on',
  'reuse_permission_evidence', 'reviewer', 'verdict', 'notes',
] as const;

export type CandidateColumn = (typeof CANDIDATE_COLUMNS)[number];
export type Candidate = Record<CandidateColumn, string>;

export interface Issue {
  row: number; // line number in the CSV (the header is row 1)
  id: string;
  field: string;
  message: string;
}

// Minimal RFC 4180 reader: quoted fields, commas and newlines inside quotes, doubled quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n') {
      pushRow();
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

export function parseCandidates(text: string): Candidate[] {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ''));
  if (!header || header.join(',') !== CANDIDATE_COLUMNS.join(',')) {
    throw new Error(`Unexpected CSV header. Expected: ${CANDIDATE_COLUMNS.join(',')}`);
  }
  return body.map((values) => Object.fromEntries(CANDIDATE_COLUMNS.map((column, index) => [column, (values[index] ?? '').trim()])) as Candidate);
}

const NUTRIENTS = ['calories', 'protein_g', 'carbs_g', 'fat_g'] as const;
const NUMBER = /^\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;
const VERDICTS = ['unreviewed', 'approved', 'rejected'];
const UNITS = ['g', 'ml'];

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateCandidates(candidates: Candidate[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();

  candidates.forEach((c, index) => {
    const row = index + 2;
    const add = (field: string, message: string) => issues.push({ row, id: c.id, field, message });
    const approved = c.verdict === 'approved';

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) add('id', 'must be a lowercase slug such as nasi-lemak');
    else if (seen.has(c.id)) add('id', 'duplicate id');
    seen.add(c.id);
    if (c.name_en === '') add('name_en', 'required');
    if (!VERDICTS.includes(c.verdict)) add('verdict', `must be one of ${VERDICTS.join(', ')}`);

    // A number must always be a plain number; blank is only allowed until approval.
    const hasValue = NUTRIENTS.some((field) => c[field] !== '');
    for (const field of NUTRIENTS) {
      if (c[field] === '') {
        if (approved) add(field, 'required for an approved row (a blank is never treated as zero)');
      } else if (!NUMBER.test(c[field])) {
        add(field, 'must be a plain non-negative number');
      }
    }

    // Numbers never exist without their provenance.
    if (hasValue || approved) {
      if (c.source_name === '') add('source_name', 'required when nutrition values are present');
      if (c.source_url === '') add('source_url', 'required when nutrition values are present');
      else if (!URL_PATTERN.test(c.source_url)) add('source_url', 'must be an http(s) URL');
      if (c.source_record_id === '') add('source_record_id', 'required when nutrition values are present');
    }

    if (!approved) return;

    if (!isRealDate(c.accessed_on)) add('accessed_on', 'required, as YYYY-MM-DD');
    if (c.reuse_permission_evidence === '') add('reuse_permission_evidence', 'required: evidence that Rise120 may reuse this data');
    if (c.reviewer === '') add('reviewer', 'required');
    if (c.region !== 'MY') add('region', "must be 'MY' for the curated Malaysian seed");

    if (!NUMBER.test(c.serving_amount) || Number(c.serving_amount) <= 0) add('serving_amount', 'must be a positive number');
    if (!UNITS.includes(c.serving_unit)) add('serving_unit', `must be one of ${UNITS.join(', ')}`);
    if (c.serving_desc === '') add('serving_desc', 'required');
    else {
      // If the description states a weight or volume it must agree with the serving amount and unit.
      const measures = [...c.serving_desc.matchAll(/(\d+(?:\.\d+)?)\s*(g|ml)\b/gi)];
      const agrees = measures.some((m) => Number(m[1]) === Number(c.serving_amount) && m[2].toLowerCase() === c.serving_unit);
      if (measures.length > 0 && !agrees) add('serving_desc', 'states a weight or volume that disagrees with serving_amount and serving_unit');
    }

    if (NUTRIENTS.every((field) => NUMBER.test(c[field]))) {
      const energy = { calories: Number(c.calories), proteinG: Number(c.protein_g), carbsG: Number(c.carbs_g), fatG: Number(c.fat_g) };
      if (!isEnergyConsistent(energy)) add('calories', 'energy does not match protein, carbs and fat (check the units and the serving)');
    }
  });

  return issues;
}

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ');

function aliasesJson(c: Candidate): string {
  const aliases: Record<string, string[]> = {};
  for (const [language, value] of [['en', c.alias_en], ['ms', c.alias_ms], ['ta', c.alias_ta]] as const) {
    const names = value.split(';').map((name) => name.trim()).filter((name) => name !== '');
    if (names.length > 0) aliases[language] = names;
  }
  return JSON.stringify(aliases);
}

// SQL for a seed migration, from approved rows only. Refuses (throws) if nothing is approved or any
// approved row is invalid, so an unreviewed value can never be deployed as verified.
export function buildSeedSql(candidates: Candidate[]): string {
  const approvedRows = candidates.filter((c) => c.verdict === 'approved');
  if (approvedRows.length === 0) throw new Error('No approved candidates: nothing to seed.');

  const approvedIds = new Set(approvedRows.map((c) => c.id));
  const problems = validateCandidates(candidates).filter((issue) => approvedIds.has(issue.id));
  if (problems.length > 0) {
    throw new Error(`Approved candidates have problems:\n${problems.map((p) => `row ${p.row} ${p.id}: ${p.field} - ${p.message}`).join('\n')}`);
  }

  const values = approvedRows.map(
    (c) =>
      `  -- ${oneLine(c.id)}: source ${oneLine(c.source_record_id)} (${oneLine(c.source_name)}), ${oneLine(c.source_url)}, accessed ${c.accessed_on}; ` +
      `reviewed by ${oneLine(c.reviewer)}; reuse: ${oneLine(c.reuse_permission_evidence)}\n` +
      `  (null, ${sqlText(c.name_en)}, ${sqlText(aliasesJson(c))}::jsonb, ${sqlText(c.serving_desc)}, ${Number(c.calories)}, ${Number(c.protein_g)}, ` +
      `${Number(c.carbs_g)}, ${Number(c.fat_g)}, 'curated', ${sqlText(c.id)}, ${sqlText(c.source_url)}, true, 'MY')`
  );

  return [
    '-- Reviewed Malaysian/Malay/Tamil food seed. Generated from approved rows of docs/food/curated-candidates.csv;',
    '-- do not edit by hand. Idempotent: re-running changes nothing.',
    'insert into public.foods (user_id, name, aliases, serving_desc, calories, protein_g, carbs_g, fat_g, source, source_id, source_url, verified, region)',
    'values',
    values.join(',\n'),
    'on conflict (source, source_id) where user_id is null and source_id is not null do nothing;',
    '',
  ].join('\n');
}
