import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { loadDraft, OnboardingDraft, saveDraft } from '../draft';
import { submitProfile } from '../submit';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const draft: OnboardingDraft = {
  goal: 'build_muscle',
  age: 30,
  heightCm: 175,
  weightKg: 70.5,
  trainingLevel: 'beginner',
  equipment: 'home',
  foodPreferences: ['halal'],
  language: 'ms',
  units: 'metric',
  energySex: 'undisclosed',
  activityLevel: 'light',
};

const upsert = jest.fn();
const update = jest.fn();
const eq = jest.fn();
const isNull = jest.fn();

function mockProfiles(results: { upsert?: unknown; update?: unknown } = {}) {
  upsert.mockResolvedValue(results.upsert ?? { error: null });
  isNull.mockResolvedValue(results.update ?? { error: null });
  eq.mockReturnValue({ is: isNull });
  update.mockReturnValue({ eq });
  (supabase.from as jest.Mock).mockReturnValue({ upsert, update });
}

describe('submitProfile', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockProfiles();
  });

  it('upserts the profile on id, never inserts, when submitted twice', async () => {
    await submitProfile('u1', draft);
    await submitProfile('u1', draft);

    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(upsert).toHaveBeenCalledTimes(2);
    for (const [row, options] of upsert.mock.calls) {
      expect(options).toEqual({ onConflict: 'id' });
      expect(row).toEqual({
        id: 'u1',
        goal: 'build_muscle',
        age: 30,
        height_cm: 175,
        weight_kg: 70.5,
        training_level: 'beginner',
        equipment: 'home',
        food_preferences: ['halal'],
        language: 'ms',
        units: 'metric',
        energy_sex: 'undisclosed',
        activity_level: 'light',
      });
      expect(row).not.toHaveProperty('onboarded_at');
    }
  });

  it('sets onboarded_at only where it is still null', async () => {
    await submitProfile('u1', draft);

    expect(update).toHaveBeenCalledWith({ onboarded_at: expect.any(String) });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
    expect(isNull).toHaveBeenCalledWith('onboarded_at', null);
  });

  it('rejects age 17 before calling supabase', async () => {
    await expect(submitProfile('u1', { ...draft, age: 17 })).rejects.toThrow();

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('surfaces a database error and leaves the saved draft untouched', async () => {
    await saveDraft(draft, 5);
    mockProfiles({ upsert: { error: { message: 'Network request failed' } } });

    await expect(submitProfile('u1', draft)).rejects.toThrow('Network request failed');

    expect(update).not.toHaveBeenCalled();
    expect(await loadDraft()).toEqual({ draft, step: 5 });
  });

  it('surfaces a thrown network error and leaves the saved draft untouched', async () => {
    await saveDraft(draft, 5);
    upsert.mockRejectedValue(new Error('Network request failed'));

    await expect(submitProfile('u1', draft)).rejects.toThrow('Network request failed');

    expect(await loadDraft()).toEqual({ draft, step: 5 });
  });

  it('surfaces an error from setting onboarded_at', async () => {
    mockProfiles({ update: { error: { message: 'update failed' } } });

    await expect(submitProfile('u1', draft)).rejects.toThrow('update failed');
  });
});
