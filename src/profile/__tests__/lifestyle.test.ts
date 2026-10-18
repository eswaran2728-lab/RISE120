import { LifestyleInput, loadLifestyle, saveLifestyle, validateLifestyle } from '../lifestyle';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const valid: LifestyleInput = {
  region: 'MY',
  journeyTimeZone: 'Asia/Kuala_Lumpur',
  cookingAccess: 'basic',
  cookingMinutes: 20,
  budgetAmount: 15,
  budgetCurrency: 'MYR',
};

describe('validateLifestyle', () => {
  it('accepts a complete set of preferences', () => {
    expect(validateLifestyle(valid)).toEqual({ ok: true, value: valid });
  });

  it('accepts every field being unset: nothing here is required', () => {
    const empty = { region: null, journeyTimeZone: null, cookingAccess: null, cookingMinutes: null, budgetAmount: null, budgetCurrency: null };

    expect(validateLifestyle(empty)).toEqual({ ok: true, value: empty });
  });

  it.each([
    ['an unknown region', { region: 'FR' }, 'region'],
    ['an invalid time zone', { journeyTimeZone: 'Mars/Phobos' }, 'journeyTimeZone'],
    ['an unknown cooking access', { cookingAccess: 'chef' }, 'cookingAccess'],
    ['fewer than 5 cooking minutes', { cookingMinutes: 2 }, 'cookingMinutes'],
    ['more than 240 cooking minutes', { cookingMinutes: 500 }, 'cookingMinutes'],
    ['fractional cooking minutes', { cookingMinutes: 20.5 }, 'cookingMinutes'],
    ['a negative budget', { budgetAmount: -1 }, 'budgetAmount'],
    ['an absurd budget', { budgetAmount: 1e9 }, 'budgetAmount'],
    ['a budget that is not a number', { budgetAmount: '15' }, 'budgetAmount'],
    ['an unsupported currency', { budgetCurrency: 'USD' }, 'budgetCurrency'],
    ['a budget with no currency', { budgetCurrency: null }, 'budgetCurrency'],
    ['a currency with no budget', { budgetAmount: null }, 'budgetAmount'],
  ])('rejects %s', (_label, change, field) => {
    const result = validateLifestyle({ ...valid, ...change } as never);

    expect(result).toEqual({ ok: false, field });
  });

  it('rejects anything that is not an object, and unknown extra fields are not passed on', () => {
    expect(validateLifestyle(null as never)).toEqual({ ok: false, field: 'input' });
    const result = validateLifestyle({ ...valid, weightKg: 70, calorieTarget: 5000 } as never);
    expect(result).toEqual({ ok: true, value: valid });
  });
});

describe('saving and loading', () => {
  const update = jest.fn();
  const eq = jest.fn();
  const maybeSingle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    eq.mockResolvedValue({ error: null });
    update.mockReturnValue({ eq });
    (supabase.from as jest.Mock).mockReturnValue({
      update,
      select: () => ({ eq: () => ({ maybeSingle }) }),
    });
  });

  it('writes only the lifestyle columns, for the signed-in account', async () => {
    await saveLifestyle('A', valid);

    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({
      region: 'MY',
      journey_time_zone: 'Asia/Kuala_Lumpur',
      cooking_access: 'basic',
      cooking_minutes: 20,
      budget_amount: 15,
      budget_currency: 'MYR',
    });
    expect(eq).toHaveBeenCalledWith('id', 'A');
  });

  it('never touches body measurements, goals or calorie inputs, so a budget cannot change a plan target', async () => {
    await saveLifestyle('A', valid);

    const written = Object.keys(update.mock.calls[0][0]);
    for (const column of ['weight_kg', 'height_cm', 'age', 'goal', 'energy_sex', 'activity_level', 'equipment']) expect(written).not.toContain(column);
  });

  it('refuses invalid preferences before any request is made', async () => {
    await expect(saveLifestyle('A', { ...valid, journeyTimeZone: 'Mars/Phobos' })).rejects.toThrow('journeyTimeZone');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('reports a failed save instead of pretending it worked', async () => {
    eq.mockResolvedValue({ error: { message: 'offline' } });

    await expect(saveLifestyle('A', valid)).rejects.toThrow('offline');
  });

  it('loads the stored preferences, with nulls for anything unset', async () => {
    maybeSingle.mockResolvedValue({ data: { region: 'SG', journey_time_zone: null, cooking_access: null, cooking_minutes: null, budget_amount: '12.5', budget_currency: 'SGD' }, error: null });

    expect(await loadLifestyle('A')).toEqual({ region: 'SG', journeyTimeZone: null, cookingAccess: null, cookingMinutes: null, budgetAmount: 12.5, budgetCurrency: 'SGD' });
  });

  it('treats a stored value that fails validation as unset rather than trusting it', async () => {
    maybeSingle.mockResolvedValue({ data: { region: 'FR', journey_time_zone: 'Mars/Phobos', cooking_access: 'chef', cooking_minutes: 1, budget_amount: null, budget_currency: null }, error: null });

    expect(await loadLifestyle('A')).toEqual({ region: null, journeyTimeZone: null, cookingAccess: null, cookingMinutes: null, budgetAmount: null, budgetCurrency: null });
  });

  it('returns all-unset when there is no profile row or the read fails', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'x' } });

    expect(await loadLifestyle('A')).toEqual({ region: null, journeyTimeZone: null, cookingAccess: null, cookingMinutes: null, budgetAmount: null, budgetCurrency: null });
  });
});
