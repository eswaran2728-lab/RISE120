import { supabase } from '../../lib/supabase';
import { updateProfilePreference } from '../preferences';

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const update = jest.fn();
const eq = jest.fn();

describe('updateProfilePreference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eq.mockResolvedValue({ error: null });
    update.mockReturnValue({ eq });
    (supabase.from as jest.Mock).mockReturnValue({ update });
  });

  it('updates the language on the caller profile row', async () => {
    await updateProfilePreference('u1', { language: 'ta' });

    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({ language: 'ta' });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('updates the units', async () => {
    await updateProfilePreference('u1', { units: 'imperial' });

    expect(update).toHaveBeenCalledWith({ units: 'imperial' });
  });

  it('throws when the update fails', async () => {
    eq.mockResolvedValue({ error: { message: 'Network request failed' } });

    await expect(updateProfilePreference('u1', { units: 'metric' })).rejects.toThrow('Network request failed');
  });
});
