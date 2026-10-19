import { parseSaveMealPlanRequest } from '../functions/_shared/food/mealPlan';

const REQUEST = '4a2b8c1e-1111-4222-8333-444455556667';
const sel = { recipeId: 'nasi-fixture', version: 1, servings: 1.5, day: 0, slot: 0 };
const body = { requestId: REQUEST, expectedRevision: 0, selections: [sel] };

describe('parseSaveMealPlanRequest', () => {
  it('accepts a plan and keeps only the fields it needs', () => {
    expect(parseSaveMealPlanRequest({ ...body, userId: 'someone-else', selections: [{ ...sel, price: 0 }] })).toEqual({
      ok: true,
      requestId: REQUEST,
      expectedRevision: 0,
      selections: [sel],
    });
  });

  it('lower-cases the request id', () => {
    expect(parseSaveMealPlanRequest({ ...body, requestId: REQUEST.toUpperCase() })).toMatchObject({ ok: true, requestId: REQUEST });
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['bad request id', { ...body, requestId: 'x' }],
    ['negative revision', { ...body, expectedRevision: -1 }],
    ['fractional revision', { ...body, expectedRevision: 1.5 }],
    ['no selections', { ...body, selections: [] }],
    ['selections not a list', { ...body, selections: 'x' }],
    ['too many selections', { ...body, selections: Array.from({ length: 43 }, (_, i) => ({ ...sel, day: Math.floor(i / 6), slot: i % 6 })) }],
    ['bad recipe id', { ...body, selections: [{ ...sel, recipeId: 'Bad Id' }] }],
    ['bad version', { ...body, selections: [{ ...sel, version: 0 }] }],
    ['zero servings', { ...body, selections: [{ ...sel, servings: 0 }] }],
    ['too many servings', { ...body, selections: [{ ...sel, servings: 51 }] }],
    ['day out of range', { ...body, selections: [{ ...sel, day: 7 }] }],
    ['slot out of range', { ...body, selections: [{ ...sel, slot: 6 }] }],
    ['two meals in one slot', { ...body, selections: [sel, { ...sel, recipeId: 'other-fixture' }] }],
  ])('rejects %s', (_name, input) => {
    expect(parseSaveMealPlanRequest(input)).toEqual({ ok: false });
  });
});
