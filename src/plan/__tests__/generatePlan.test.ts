import { supabase } from '../../lib/supabase';
import { generatePlan } from '../generatePlan';

jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));

describe('generatePlan', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls the generate-plan function with the local start date', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { planId: 'p1', created: true }, error: null });

    await generatePlan('2026-10-13');

    expect(supabase.functions.invoke).toHaveBeenCalledWith('generate-plan', { method: 'POST', body: { startDate: '2026-10-13' } });
  });

  it('throws when the function returns an error', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: { message: 'Network request failed' } });

    await expect(generatePlan('2026-10-13')).rejects.toThrow('Network request failed');
  });
});
