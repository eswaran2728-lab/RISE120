import AsyncStorage from '@react-native-async-storage/async-storage';

export type OnboardingDraft = {
  goal: 'lose_fat' | 'build_muscle' | 'recomp';
  age: number;
  heightCm: number;
  weightKg: number;
  trainingLevel: 'beginner' | 'intermediate' | 'advanced';
  equipment: 'gym' | 'home' | 'none';
  foodPreferences: string[];
  language: 'en' | 'ms' | 'ta';
  units: 'metric' | 'imperial';
};

type StoredDraft = { draft: Partial<OnboardingDraft>; step: number };

const STORAGE_KEY = 'rise120.onboarding.draft';
const EMPTY: StoredDraft = { draft: {}, step: 1 };

export async function saveDraft(draft: Partial<OnboardingDraft>, step: number): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ draft, step }));
}

export async function loadDraft(): Promise<StoredDraft> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (parsed.draft && typeof parsed.draft === 'object' && Number.isInteger(parsed.step)) {
      return { draft: parsed.draft, step: parsed.step as number };
    }
  } catch {
    // Corrupt draft: start over rather than block onboarding.
  }
  return { ...EMPTY };
}

export async function clearDraft(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
