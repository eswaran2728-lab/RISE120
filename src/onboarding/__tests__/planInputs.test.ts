import { supabase } from '../../lib/supabase';
import { savePlanInputs } from '../planInputs';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const update = jest.fn();
const eq = jest.fn();

describe('savePlanInputs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eq.mockResolvedValue({ error: null });
    update.mockReturnValue({ eq });
    (supabase.from as jest.Mock).mockReturnValue({ update });
  });

  it('updates only the caller profile row', async () => {
    await savePlanInputs('u1', { energySex: 'undisclosed', activityLevel: 'light' });

    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({ energy_sex: 'undisclosed', activity_level: 'light' });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('throws when the update fails', async () => {
    eq.mockResolvedValue({ error: { message: 'Network request failed' } });

    await expect(savePlanInputs('u1', { energySex: 'male', activityLevel: 'active' })).rejects.toThrow('Network request failed');
  });
});
