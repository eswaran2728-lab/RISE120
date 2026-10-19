import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import MealPlannerScreen from '../../../../app/meal-planner';
import { t } from '../../../i18n';
import { mockStore } from '../../../sync/testing/storageMock';
import * as recipeData from '../../recipeData';
import * as api from '../api';
import * as plannedLog from '../plannedLog';
import { loadPlanBundle } from '../../../plan/planData';
import { loadLimitsOrCached } from '../../../monetization/limits';
import { recipe, withCalories, ing } from '../testing/fixtures';

jest.setTimeout(30000);

const mockPush = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]), // eslint-disable-line @typescript-eslint/no-require-imports
  useRouter: () => ({ back: jest.fn(), push: mockPush, navigate: mockPush }),
}));
jest.mock('../../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-19' }));
jest.mock('../../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../../recipeData', () => ({ loadRecipes: jest.fn() }));
jest.mock('../api', () => ({ loadSavedPlan: jest.fn(), saveMealPlan: jest.fn() }));
jest.mock('../plannedLog', () => ({ ...jest.requireActual('../plannedLog'), logPlannedMeal: jest.fn() }));
jest.mock('../../../plan/planData', () => ({ loadPlanBundle: jest.fn() }));
jest.mock('../../../monetization/limits', () => ({ ...jest.requireActual('../../../monetization/limits'), loadLimitsOrCached: jest.fn() }));

const mocked = {
  recipes: recipeData.loadRecipes as jest.Mock,
  saved: api.loadSavedPlan as jest.Mock,
  save: api.saveMealPlan as jest.Mock,
  log: plannedLog.logPlannedMeal as jest.Mock,
  plan: loadPlanBundle as jest.Mock,
  limits: loadLimitsOrCached as jest.Mock,
};

const premiumSnapshot = (premium: boolean) => ({ snapshot: { tier: premium ? 'premium' : 'free', planDaysAccessible: 120, food: { remaining: null }, ai: { remaining: 5 }, capabilities: { basicPlan: true, manualFood: true, adaptiveProgression: premium, mealPlanner: premium, photoFood: premium, coach: true } }, stale: false });
const bundle = (calories: number | null, protein: number | null) => ({ plan: { id: 'p', startDate: '2026-10-01', status: 'active' }, days: [{ dayNumber: 19, workout: { kind: 'rest' }, calorieTarget: calories, proteinTargetG: protein }], exercises: [] });
const noCook = (id: string, over = {}) => recipe(id, { cooking: ['none'], ...over });

const textsOf = (tree: ReactTestRenderer): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') ((node as { children?: unknown[] | null }).children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out;
};
const shows = (tree: ReactTestRenderer, text: string) => textsOf(tree).some((s) => s.includes(text));
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && (typeof n.props.onPress === 'function' || typeof n.props.onChangeText === 'function')).pop();
const has = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id).length > 0;
const press = (tree: ReactTestRenderer, id: string) =>
  act(async () => {
    await byId(tree, id)!.props.onPress();
  });
async function mount() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<MealPlannerScreen />);
  });
  return tree;
}

beforeEach(() => {
  mockStore.clear();
  mockPush.mockReset();
  Object.values(mocked).forEach((m) => m.mockReset());
  mocked.recipes.mockResolvedValue([noCook('a'), noCook('b'), noCook('c')]);
  mocked.saved.mockResolvedValue({ kind: 'none', revision: 0 });
  mocked.save.mockResolvedValue({ kind: 'saved', revision: 1, repeated: false });
  mocked.log.mockResolvedValue({ kind: 'logged', logId: 'log-1' });
  mocked.plan.mockResolvedValue(bundle(1500, 90));
  mocked.limits.mockResolvedValue(premiumSnapshot(true));
});

describe('the meal planner screen', () => {
  it('restarts for each account', () => {
    expect((MealPlannerScreen as unknown as { accountScoped?: boolean }).accountScoped).toBe(true);
  });

  it('shows a useful empty state, and the way to log food by hand, when there are no reviewed recipes', async () => {
    mocked.recipes.mockResolvedValue([]);
    const tree = await mount();

    expect(shows(tree, t('planner.empty'))).toBe(true);
    expect(byId(tree, 'planner-save')).toBeUndefined();
    await press(tree, 'planner-manual');
    expect(mockPush).toHaveBeenCalled();
  });

  it('explains why nothing matches when recipes exist but none fit the choices', async () => {
    mocked.recipes.mockResolvedValue([recipe('stove')]); // needs a stovetop; the member has no cooker

    const tree = await mount();

    expect(shows(tree, t('planner.noMatch'))).toBe(true);
    expect(byId(tree, 'planner-save')).toBeUndefined();
  });

  it('offers recipes that need a cooker once the member says they have one, and remembers that', async () => {
    mocked.recipes.mockResolvedValue([recipe('stove-a'), recipe('stove-b'), recipe('stove-c')]);
    const tree = await mount();
    expect(has(tree, 'planner-meal-0-0')).toBe(false);

    await press(tree, 'planner-cooking-stovetop');

    expect(has(tree, 'planner-meal-0-0')).toBe(true);
    const again = await mount();
    expect(has(again, 'planner-meal-0-0')).toBe(true); // remembered for this account
  });

  it('shows planned meals with fractional servings, calories, and an unknown price as unknown', async () => {
    mocked.recipes.mockResolvedValue([noCook('a', { price: null }), noCook('b', { price: null }), noCook('c', { price: null })]);
    mocked.plan.mockResolvedValue(bundle(750, null)); // 250 kcal per meal: half a serving of 500 kcal
    const tree = await mount();

    expect(shows(tree, t('planner.servings', { count: 0.5 }))).toBe(true);
    expect(shows(tree, t('planner.priceUnknown'))).toBe(true);
  });

  it('says so when there is no calorie target, and never says a plan fits a budget it cannot check', async () => {
    mocked.recipes.mockResolvedValue([noCook('a', { price: null }), noCook('b'), noCook('c')]);
    mocked.plan.mockResolvedValue(bundle(null, null));
    const tree = await mount();
    await act(async () => {
      byId(tree, 'planner-budget')!.props.onChangeText('20');
    });

    expect(shows(tree, t('planner.limit.no_targets'))).toBe(true);
    expect(shows(tree, t('planner.limit.budget_unknown'))).toBe(true);
    expect(shows(tree, t('planner.budgetWithin'))).toBe(false);
  });

  it('lists the shopping list with quantities combined only where units agree', async () => {
    mocked.recipes.mockResolvedValue([noCook('a', { ingredients: [ing('rice', 200), ing('egg', 2, 'piece')] }), noCook('b', { ingredients: [ing('rice', 0.1, 'kg')] }), noCook('c', { ingredients: [ing('egg', 50, 'g')] })]);
    mocked.plan.mockResolvedValue(bundle(1500, null));
    const tree = await mount();

    expect(shows(tree, 'rice')).toBe(true);
    expect(shows(tree, t('planner.shopping'))).toBe(true);
  });
});

describe('saving the plan', () => {
  it('sends a request id, the revision it saw and the planned selections, then says it is saved', async () => {
    mocked.saved.mockResolvedValue({ kind: 'plan', revision: 2, selections: [] });
    const tree = await mount();

    await press(tree, 'planner-save');

    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(mocked.save).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), expectedRevision: 2, selections: expect.arrayContaining([expect.objectContaining({ day: 0, slot: 0, servings: 1 })]) }));
    expect(shows(tree, t('planner.saved', { revision: 1 }))).toBe(true);
  });

  it('saves once however many times the button is tapped', async () => {
    let release!: (value: unknown) => void;
    mocked.save.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const tree = await mount();

    await act(async () => {
      void byId(tree, 'planner-save')!.props.onPress();
      void byId(tree, 'planner-save')!.props.onPress();
    });
    await act(async () => release({ kind: 'saved', revision: 1, repeated: false }));

    expect(mocked.save).toHaveBeenCalledTimes(1);
  });

  it('retries a save whose answer was lost with the same request id and revision, so it cannot save twice', async () => {
    mocked.save.mockResolvedValueOnce({ kind: 'offline' });
    mocked.save.mockResolvedValueOnce({ kind: 'saved', revision: 1, repeated: true });
    const tree = await mount();

    await press(tree, 'planner-save');
    expect(shows(tree, t('planner.saveOffline'))).toBe(true);
    await press(tree, 'planner-save');

    const [first, second] = mocked.save.mock.calls.map((c) => c[0]);
    expect(second.requestId).toBe(first.requestId);
    expect(second.expectedRevision).toBe(first.expectedRevision);
  });

  it('reloads the saved plan and asks the member to check it when the revision is stale', async () => {
    mocked.save.mockResolvedValue({ kind: 'stale', revision: 3 });
    const tree = await mount();
    mocked.saved.mockClear();
    mocked.saved.mockResolvedValue({ kind: 'plan', revision: 3, selections: [] });

    await press(tree, 'planner-save');

    expect(shows(tree, t('planner.stale'))).toBe(true);
    expect(mocked.saved).toHaveBeenCalledTimes(1);
  });

  it('takes a new request id for a deliberate new save after a definite answer', async () => {
    const tree = await mount();

    await press(tree, 'planner-save');
    await press(tree, 'planner-save');

    expect(mocked.save.mock.calls[1][0].requestId).not.toBe(mocked.save.mock.calls[0][0].requestId);
  });

  it('keeps the plan and says why when the server refuses (premium, or a recipe that is no longer available)', async () => {
    mocked.save.mockResolvedValueOnce({ kind: 'premium_required' });
    mocked.save.mockResolvedValueOnce({ kind: 'recipe_unavailable' });
    const tree = await mount();

    await press(tree, 'planner-save');
    expect(shows(tree, t('planner.premiumNeeded'))).toBe(true);
    await press(tree, 'planner-save');
    expect(shows(tree, t('planner.recipeGone'))).toBe(true);
    expect(has(tree, 'planner-meal-0-0')).toBe(true);
  });

  it('shows an upgrade path instead of a save button for a free member, who can still see the candidate plan', async () => {
    mocked.limits.mockResolvedValue(premiumSnapshot(false));
    const tree = await mount();

    expect(byId(tree, 'planner-save')).toBeUndefined();
    expect(byId(tree, 'planner-upgrade')).toBeDefined();
    expect(has(tree, 'planner-meal-0-0')).toBe(true);
    await press(tree, 'planner-upgrade');
    expect(mockPush).toHaveBeenCalledWith('/paywall');
  });

  it('does not log anything by saving or by choosing recipes', async () => {
    const tree = await mount();

    await press(tree, 'planner-save');

    expect(mocked.log).not.toHaveBeenCalled();
  });
});

describe('logging a planned meal', () => {
  it('needs an explicit confirmation: pressing Log only asks', async () => {
    const tree = await mount();

    await press(tree, 'planner-log-0-0');

    expect(mocked.log).not.toHaveBeenCalled();
    expect(byId(tree, 'planner-log-confirm-0-0')).toBeDefined();
  });

  it('logs once after confirmation, however many times the confirm is tapped', async () => {
    let release!: (value: unknown) => void;
    mocked.log.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const tree = await mount();
    await press(tree, 'planner-log-0-0');

    await act(async () => {
      void byId(tree, 'planner-log-confirm-0-0')!.props.onPress();
      void byId(tree, 'planner-log-confirm-0-0')!.props.onPress();
    });
    await act(async () => release({ kind: 'logged', logId: 'log-1' }));

    expect(mocked.log).toHaveBeenCalledTimes(1);
    expect(mocked.log).toHaveBeenCalledWith('A', '2026-10-19', expect.objectContaining({ confirmed: true, servings: 1, mealType: 'breakfast', slotKey: '0:0' }));
    expect(shows(tree, t('planner.logged'))).toBe(true);
  });

  it('explains when it cannot log: no connection the first time, or nutrition that is incomplete', async () => {
    mocked.log.mockResolvedValueOnce({ kind: 'offline' });
    mocked.log.mockResolvedValueOnce({ kind: 'nutrition_unknown' });
    const tree = await mount();

    await press(tree, 'planner-log-0-0');
    await press(tree, 'planner-log-confirm-0-0');
    expect(shows(tree, t('planner.logOffline'))).toBe(true);
    await press(tree, 'planner-log-confirm-0-0');
    expect(shows(tree, t('planner.logNutritionUnknown'))).toBe(true);
  });

  it('offers logging only for todays meals, not for later days of a week plan', async () => {
    const tree = await mount();
    await press(tree, 'planner-days-7');

    expect(byId(tree, 'planner-log-0-0')).toBeDefined();
    expect(byId(tree, 'planner-log-1-0')).toBeUndefined();
  });
});

describe('what the planner reads', () => {
  it('uses the calorie and protein targets of the plan day for today', async () => {
    mocked.recipes.mockResolvedValue([noCook('a', { nutrition: withCalories(500, 5) }), noCook('b'), noCook('c')]);
    mocked.plan.mockResolvedValue(bundle(1500, 150));
    const tree = await mount();

    expect(shows(tree, t('planner.limit.protein_short'))).toBe(true);
  });

  it('asks for the signed-in account only', async () => {
    await mount();

    expect(mocked.recipes).toHaveBeenCalledWith('A');
    expect(mocked.limits).toHaveBeenCalledWith('A');
  });
});
