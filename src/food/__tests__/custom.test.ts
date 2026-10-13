import { mockStore } from '../../sync/testing/storageMock';
import { supabase } from '../../lib/supabase';
import { recentFoods } from '../cache';
import { createCustomFood, CustomFoodError, deleteCustomFood, getOwnCustomFood, updateCustomFood } from '../custom';
import type { FoodFields } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const fields: FoodFields = { name: ' Mak Cik nasi lemak ', servingDesc: '1 packet', calories: '580', protein: '14,5', carbs: '75', fat: '24' };

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'food-1', user_id: 'u1', name: 'Mak Cik nasi lemak', aliases: {}, serving_desc: '1 packet', calories: 580, protein_g: 14.5,
  carbs_g: 75, fat_g: 24, source: 'custom', verified: false, region: null, source_id: null, barcode: null, ...extra,
});

// A small recording stand-in for the Supabase query builder.
function mockTables(options: { logCount?: number; updateResult?: unknown; deleteResult?: unknown; insertResult?: unknown } = {}) {
  const calls = { insert: jest.fn(), update: jest.fn(), delete: jest.fn(), eq: [] as [string, unknown][] };
  const recordEq = (builder: object) => {
    const proxy: Record<string, unknown> = builder as Record<string, unknown>;
    proxy.eq = (column: string, value: unknown) => {
      calls.eq.push([column, value]);
      return proxy;
    };
    return proxy;
  };
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'food_logs') {
      return { select: () => ({ eq: async () => ({ count: options.logCount ?? 0, error: null }) }) };
    }
    return {
      insert: (payload: unknown) => {
        calls.insert(payload);
        return { select: () => ({ single: async () => options.insertResult ?? { data: row(), error: null } }) };
      },
      update: (payload: unknown) => {
        calls.update(payload);
        return recordEq({ select: () => ({ maybeSingle: async () => options.updateResult ?? { data: row({ name: 'Edited' }), error: null } }) });
      },
      delete: () => {
        calls.delete();
        return recordEq({ select: async () => options.deleteResult ?? { data: [{ id: 'food-1' }], error: null } });
      },
    };
  });
  return calls;
}

describe('createCustomFood', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('creates an own, unverified, custom-source food from valid input', async () => {
    const calls = mockTables();

    const food = await createCustomFood('u1', fields);

    expect(calls.insert).toHaveBeenCalledWith({
      user_id: 'u1',
      name: 'Mak Cik nasi lemak',
      serving_desc: '1 packet',
      calories: 580,
      protein_g: 14.5,
      carbs_g: 75,
      fat_g: 24,
      source: 'custom',
      verified: false,
      region: null,
    });
    expect(food).toMatchObject({ id: 'food-1', source: 'custom', verified: false, userId: 'u1' });
  });

  it('rejects invalid nutrition without writing anything, and never turns a blank into zero', async () => {
    const calls = mockTables();

    await expect(createCustomFood('u1', { ...fields, fat: '' })).rejects.toMatchObject({ code: 'invalid', field: 'fat', reason: 'required' });
    await expect(createCustomFood('u1', { ...fields, calories: '-5' })).rejects.toMatchObject({ code: 'invalid', field: 'calories' });
    await expect(createCustomFood('u1', { ...fields, name: '  ' })).rejects.toMatchObject({ code: 'invalid', field: 'name' });

    expect(calls.insert).not.toHaveBeenCalled();
  });

  it('ignores any attempt to spoof the owner, verified flag, source or region through extra fields', async () => {
    const calls = mockTables();
    const spoofed = { ...fields, user_id: 'someone-else', verified: true, source: 'curated', region: 'MY' } as unknown as FoodFields;

    await createCustomFood('u1', spoofed);

    expect(calls.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', verified: false, source: 'custom', region: null }));
  });

  it('remembers the new food for offline search', async () => {
    mockTables();

    await createCustomFood('u1', fields);

    expect((await recentFoods('u1')).map((f) => f.id)).toEqual(['food-1']);
  });

  it('surfaces a database error', async () => {
    mockTables({ insertResult: { data: null, error: { message: 'Network request failed' } } });

    await expect(createCustomFood('u1', fields)).rejects.toThrow('Network request failed');
  });
});

describe('updateCustomFood', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('updates only the editable fields, scoped to the owner and to custom foods', async () => {
    const calls = mockTables();

    const food = await updateCustomFood('u1', 'food-1', fields);

    expect(calls.update).toHaveBeenCalledWith({
      name: 'Mak Cik nasi lemak',
      serving_desc: '1 packet',
      calories: 580,
      protein_g: 14.5,
      carbs_g: 75,
      fat_g: 24,
    });
    expect(calls.eq).toEqual([['id', 'food-1'], ['user_id', 'u1'], ['source', 'custom'], ['verified', false]]);
    expect(food.name).toBe('Edited');
  });

  it('cannot promote a food to verified or change its source through extra fields', async () => {
    const calls = mockTables();
    const spoofed = { ...fields, verified: true, source: 'curated' } as unknown as FoodFields;

    await updateCustomFood('u1', 'food-1', spoofed);

    const payload = calls.update.mock.calls[0][0];
    expect(payload).not.toHaveProperty('verified');
    expect(payload).not.toHaveProperty('source');
    expect(payload).not.toHaveProperty('user_id');
  });

  it('rejects invalid input without updating', async () => {
    const calls = mockTables();

    await expect(updateCustomFood('u1', 'food-1', { ...fields, protein: 'abc' })).rejects.toMatchObject({ code: 'invalid', field: 'protein' });

    expect(calls.update).not.toHaveBeenCalled();
  });

  it('reports not_found when the row is not the caller own custom food (row-level security hides it)', async () => {
    mockTables({ updateResult: { data: null, error: null } });

    await expect(updateCustomFood('u1', 'someone-elses-food', fields)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('deleteCustomFood', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('deletes an own custom food that no meal log uses', async () => {
    const calls = mockTables({ logCount: 0 });

    await deleteCustomFood('u1', 'food-1');

    expect(calls.delete).toHaveBeenCalled();
    expect(calls.eq).toEqual([['id', 'food-1'], ['user_id', 'u1'], ['source', 'custom'], ['verified', false]]);
  });

  it('refuses to delete a food that logged meals reference, preserving history', async () => {
    const calls = mockTables({ logCount: 3 });

    await expect(deleteCustomFood('u1', 'food-1')).rejects.toMatchObject({ code: 'in_use' });

    expect(calls.delete).not.toHaveBeenCalled();
  });

  it('reports in_use when the database refuses the delete (a log appeared meanwhile)', async () => {
    mockTables({ logCount: 0, deleteResult: { data: [], error: null } });

    await expect(deleteCustomFood('u1', 'food-1')).rejects.toBeInstanceOf(CustomFoodError);
  });

  it('surfaces a database error', async () => {
    mockTables({ deleteResult: { data: null, error: { message: 'Network request failed' } } });

    await expect(deleteCustomFood('u1', 'food-1')).rejects.toThrow('Network request failed');
  });
});

describe('getOwnCustomFood', () => {
  const maybeSingle = jest.fn();
  const eqs: [string, unknown][] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    eqs.length = 0;
    const builder: Record<string, unknown> = {};
    builder.eq = (column: string, value: unknown) => {
      eqs.push([column, value]);
      return eqs.length === 3 ? { maybeSingle } : builder;
    };
    (supabase.from as jest.Mock).mockReturnValue({ select: () => builder });
  });

  it('loads a food that is the caller own custom food', async () => {
    maybeSingle.mockResolvedValue({ data: row(), error: null });

    expect(await getOwnCustomFood('u1', 'food-1')).toMatchObject({ id: 'food-1', name: 'Mak Cik nasi lemak' });
    expect(eqs).toEqual([['id', 'food-1'], ['user_id', 'u1'], ['source', 'custom']]);
  });

  it('returns null when there is no such own food', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    expect(await getOwnCustomFood('u1', 'nope')).toBeNull();
  });
});
