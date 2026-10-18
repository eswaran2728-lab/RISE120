import { runValidation, ContentFiles } from '../validate';

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const exercise = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  version: 1,
  pattern: 'squat',
  equipment: 'home',
  name: L(id),
  cues: [L('cue one'), L('cue two')],
  regressions: [],
  alternatives: [id === 'a' ? 'b' : 'a'],
  media: { kind: 'video', source: 'Rise120 Studio', licence: 'Owned', url: 'https://media.example.test/x.mp4' },
  reviewer,
  status: 'published',
  ...over,
});
const files = (items: { exercises?: unknown[]; sessions?: unknown[] }): ContentFiles => ({
  exercises: (items.exercises ?? []).map((value, i) => ({ path: `content/exercises/e${i}.json`, text: JSON.stringify(value) })),
  sessions: (items.sessions ?? []).map((value, i) => ({ path: `content/sessions/s${i}.json`, text: JSON.stringify(value) })),
});

describe('runValidation', () => {
  it('passes an empty content folder and says nothing is published yet', () => {
    const result = runValidation(files({}));

    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toMatch(/nothing is published/i);
  });

  it('passes a valid catalogue and counts by status', () => {
    const result = runValidation(files({ exercises: [exercise('a'), exercise('b'), exercise('c', { status: 'draft', reviewer: null, alternatives: [] })] }));

    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toMatch(/exercises: 3 \(published 2, in review 0, draft 1\)/);
  });

  it('fails with a non-zero code and names the file and the problem for a published exercise with no licence', () => {
    const result = runValidation(files({ exercises: [exercise('a', { media: { kind: 'video', source: 'x', licence: '' } }), exercise('b')] }));

    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toMatch(/a: missing_licence/);
  });

  it('fails on a file that is not valid JSON and says which file, without printing its text', () => {
    const result = runValidation({ exercises: [{ path: 'content/exercises/broken.json', text: '{ not json secret-text' }], sessions: [] });

    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toContain('content/exercises/broken.json');
    expect(result.lines.join('\n')).not.toContain('secret-text');
  });

  it('fails on a file whose shape is wrong (not an exercise at all)', () => {
    const result = runValidation(files({ exercises: [{ hello: 'world' }] }));

    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toMatch(/content\/exercises\/e0\.json/);
  });

  it('fails on a duplicate id across two files', () => {
    const result = runValidation(files({ exercises: [exercise('a'), exercise('b'), exercise('a', { version: 2 })] }));

    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toMatch(/a: duplicate_id/);
  });

  it('reports a published count of zero as a launch gate, not as a failure', () => {
    const result = runValidation(files({ exercises: [exercise('a', { status: 'draft', reviewer: null, alternatives: [] })] }));

    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toMatch(/launch gate/i);
  });
});
