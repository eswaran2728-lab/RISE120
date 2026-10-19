import { mapDishRow, validateDishes, type Dish } from '../eatingOut';

// SYNTHETIC dishes only: not real dishes, calories, reviewer or source.
const L = (t: string) => ({ en: t, ms: `${t} ms`, ta: `${t} ta` });
const reviewer = { name: 'Fixture Reviewer', role: 'Fixture role', reviewedOn: '2000-01-01' };
const provenance = { name: 'Fixture source', url: null, recordId: null, version: '1', accessedOn: '2000-01-02', licenceEvidence: 'Fixture evidence' };
const dish = (over: Partial<Dish> = {}): Dish => ({
  id: 'fixture-dish', version: 1, status: 'draft', region: 'MY', name: L('Fixture dish'), aliases: {}, tips: [L('Ask for less sauce.')],
  calories: { min: 400, max: 700 }, servingNote: L('One plate'), provenance, reviewer: null, ...over,
});
const published = (over: Partial<Dish> = {}) => dish({ status: 'published', reviewer, ...over });
const codes = (dishes: Dish[]) => validateDishes(dishes).map((e) => `${e.code}:${e.id}`);

describe('validateDishes', () => {
  it('accepts a clean draft and a clean published dish', () => {
    expect(codes([dish()])).toEqual([]);
    expect(codes([published()])).toEqual([]);
  });

  it('requires a published dish to have a reviewer, all three names and tips in all three languages', () => {
    expect(codes([published({ reviewer: null })])).toContain('missing_review:fixture-dish');
    expect(codes([published({ name: { en: 'x', ms: '', ta: 'x' } })])).toContain('missing_name:fixture-dish');
    expect(codes([published({ tips: [] })])).toContain('missing_tips:fixture-dish');
    expect(codes([published({ tips: [{ en: 'x', ms: 'x', ta: ' ' }] })])).toContain('missing_tips:fixture-dish');
  });

  it('only ever gives calories as an approximate range with a note saying what portion it describes', () => {
    expect(codes([dish({ calories: { min: 500, max: 500 } })])).toContain('calories_not_a_range:fixture-dish');
    expect(codes([dish({ calories: { min: 700, max: 400 } })])).toContain('calories_not_a_range:fixture-dish');
    expect(codes([dish({ calories: { min: -1, max: 400 } })])).toContain('calories_invalid:fixture-dish');
    expect(codes([dish({ servingNote: null })])).toContain('calories_need_serving:fixture-dish');
  });

  it('allows unknown calories, kept as null and never zero', () => {
    expect(codes([published({ calories: null, servingNote: null, provenance: null })])).toEqual([]);
  });

  it('requires a published calorie range to name its source, version, access date and licence evidence', () => {
    expect(codes([published({ provenance: null })])).toContain('missing_source:fixture-dish');
    expect(codes([published({ provenance: { ...provenance, licenceEvidence: ' ' } })])).toContain('missing_source:fixture-dish');
    expect(codes([published({ provenance: { ...provenance, version: '' } })])).toContain('missing_source:fixture-dish');
  });

  it('flags a duplicate of the same dish version', () => {
    expect(codes([dish(), dish()])).toContain('duplicate_dish:fixture-dish');
    expect(codes([dish(), dish({ version: 2 })])).toEqual([]);
  });
});

describe('mapDishRow', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a', version: 1, status: 'published', region: 'MY', name: L('A'), aliases: {}, tips: [L('t')], calories_min: 400, calories_max: 700, serving_note: L('One plate'),
    provenance, reviewer, ...over,
  });

  it('maps a row and keeps unknown calories as null, not zero', () => {
    expect(mapDishRow(row())).toMatchObject({ id: 'a', calories: { min: 400, max: 700 } });
    expect(mapDishRow(row({ calories_min: null, calories_max: null, serving_note: null }))!.calories).toBeNull();
  });

  it.each([null, 'x', row({ name: 'x' }), row({ tips: 'x' }), row({ status: 'live' })])('gives null for a malformed row', (bad) => {
    expect(mapDishRow(bad as never)).toBeNull();
  });
});
