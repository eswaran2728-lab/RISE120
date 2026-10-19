import { mockStore } from '../../../sync/testing/storageMock';
import { clearUserCache } from '../../../cache/userCache';
import { DEFAULT_PREFS, loadMealPrefs, mealTypeForSlot, saveMealPrefs } from '../prefs';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../../sync/testing/storageMock').asyncStorageMock,
}));

beforeEach(() => mockStore.clear());

describe('meal planner preferences', () => {
  it('start with no cooker assumed, no time limit, no diet and no budget', async () => {
    expect(DEFAULT_PREFS).toMatchObject({ cooking: [], maxMinutes: null, diets: [], avoid: [], budget: null, mealsPerDay: 3, days: 1 });
    expect(await loadMealPrefs('A')).toEqual(DEFAULT_PREFS);
  });

  it('are remembered for this account only, and removed with the account', async () => {
    const mine = { ...DEFAULT_PREFS, cooking: ['stovetop' as const], maxMinutes: 30, diets: ['vegetarian' as const], budget: { amount: 20, currency: 'MYR', per: 'day' as const } };
    expect(await saveMealPrefs('A', mine)).toBe(true);

    expect(await loadMealPrefs('A')).toEqual(mine);
    expect(await loadMealPrefs('B')).toEqual(DEFAULT_PREFS);
    await clearUserCache('A');
    expect(await loadMealPrefs('A')).toEqual(DEFAULT_PREFS);
  });

  it('refuse values that make no sense and keep the last good ones', async () => {
    const good = { ...DEFAULT_PREFS, days: 3 };
    await saveMealPrefs('A', good);

    for (const bad of [{ ...good, days: 8 }, { ...good, mealsPerDay: 0 }, { ...good, maxMinutes: -5 }, { ...good, budget: { amount: -1, currency: 'MYR', per: 'day' as const } }, { ...good, budget: { amount: 5, currency: 'ringgit', per: 'day' as const } }, { ...good, cooking: ['jetpack' as never] }]) {
      expect(await saveMealPrefs('A', bad)).toBe(false);
    }
    expect(await loadMealPrefs('A')).toEqual(good);
  });

  it('fall back to the defaults when the stored value is damaged', async () => {
    await saveMealPrefs('A', DEFAULT_PREFS);
    mockStore.set('rise120.cache.A.mealPrefs', JSON.stringify({ days: 'many' }));

    expect(await loadMealPrefs('A')).toEqual(DEFAULT_PREFS);
  });
});

describe('mealTypeForSlot', () => {
  it('names the meals of a day in a sensible order', () => {
    expect([0, 1, 2].map((s) => mealTypeForSlot(s, 3))).toEqual(['breakfast', 'lunch', 'dinner']);
    expect([0, 1, 2, 3].map((s) => mealTypeForSlot(s, 4))).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect([0, 1].map((s) => mealTypeForSlot(s, 2))).toEqual(['breakfast', 'dinner']);
    expect(mealTypeForSlot(0, 1)).toBe('lunch');
    expect(mealTypeForSlot(5, 6)).toBe('snack');
  });
});
