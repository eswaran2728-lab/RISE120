import { mockStore } from '../../sync/testing/storageMock';
import { supabase } from '../../lib/supabase';
import { loadPlanBundle } from '../planData';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// With more than one cycle stored, the app must read the ACTIVE plan, never an older completed one.
function serve(plans: Record<string, unknown>[]) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    let rows = [...plans];
    const q: Record<string, unknown> = {};
    q.select = (...args: unknown[]) => (calls.push({ table, method: 'select', args }), q);
    q.eq = (col: string, val: unknown) => {
      calls.push({ table, method: 'eq', args: [col, val] });
      if (table === 'plans') rows = rows.filter((r) => r[col] === val);
      return q;
    };
    q.order = (col: string, o?: { ascending?: boolean }) => {
      calls.push({ table, method: 'order', args: [col, o] });
      if (table === 'plans') rows.sort((a, b) => ((a[col] as number) - (b[col] as number)) * (o?.ascending === false ? -1 : 1));
      return q;
    };
    q.limit = (n: number) => (calls.push({ table, method: 'limit', args: [n] }), (rows = rows.slice(0, n)), q);
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    (q as { then: (r: (v: unknown) => void) => void }).then = (resolve) => resolve({ data: [], error: null });
    return q;
  });
  return calls;
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('reading the active plan', () => {
  const old = { id: 'p1', user_id: 'A', start_date: '2026-06-01', status: 'completed', cycle_number: 1 };
  const current = { id: 'p2', user_id: 'A', start_date: '2026-10-18', status: 'active', cycle_number: 2 };

  it('asks only for this account\'s active plan, newest cycle first', async () => {
    const calls = serve([old, current]);

    const bundle = await loadPlanBundle('A');

    expect(bundle?.plan.id).toBe('p2');
    const plans = calls.filter((c) => c.table === 'plans');
    expect(plans).toContainEqual({ table: 'plans', method: 'eq', args: ['user_id', 'A'] });
    expect(plans).toContainEqual({ table: 'plans', method: 'eq', args: ['status', 'active'] });
    expect(plans).toContainEqual({ table: 'plans', method: 'order', args: ['cycle_number', { ascending: false }] });
    expect(plans).toContainEqual({ table: 'plans', method: 'limit', args: [1] });
  });

  it('does not fall back to a completed plan when there is no active one', async () => {
    serve([old]);

    expect(await loadPlanBundle('A')).toBeNull();
  });

  it('carries the cycle number so screens can tell cycles apart', async () => {
    serve([old, current]);

    expect((await loadPlanBundle('A'))?.plan.cycleNumber).toBe(2);
  });

  it('a plan from before cycles existed reads as cycle 1', async () => {
    serve([{ id: 'p0', user_id: 'A', start_date: '2026-10-01', status: 'active' }]);

    expect((await loadPlanBundle('A'))?.plan.cycleNumber).toBe(1);
  });
});
