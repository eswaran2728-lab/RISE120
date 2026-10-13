import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearDraft, loadDraft, saveDraft } from '../draft';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const STORAGE_KEY = 'rise120.onboarding.draft';

describe('onboarding draft', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns the saved draft and step', async () => {
    const draft = { goal: 'recomp' as const, age: 30, heightCm: 170.5, weightKg: 70.5 };

    await saveDraft(draft, 3);

    expect(await loadDraft()).toEqual({ draft, step: 3 });
  });

  it('returns an empty draft at step 1 when nothing is saved', async () => {
    expect(await loadDraft()).toEqual({ draft: {}, step: 1 });
  });

  it('returns an empty draft at step 1 when the stored value is corrupt', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');

    expect(await loadDraft()).toEqual({ draft: {}, step: 1 });
  });

  it('empties storage on clearDraft', async () => {
    await saveDraft({ age: 30 }, 2);

    await clearDraft();

    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(await loadDraft()).toEqual({ draft: {}, step: 1 });
  });
});
