import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import RootLayout from '../../../app/_layout';
import i18next from '../../i18n';
import { supabase } from '../../lib/supabase';
import { signOut } from '../authService';
import { useSync } from '../../sync/useSync';
import { useReminderSync } from '../../notifications/useReminderSync';
import { notifyOnboardingComplete, notifyPlanInputsSaved } from '../../onboarding/completion';
import { mockStore } from '../../sync/testing/storageMock';

const COMPLETE_PROFILE = { onboarded_at: '2026-10-12T00:00:00Z', energy_sex: 'male', activity_level: 'light' };
const mockReplace = jest.fn();
let mockSegments: string[] = [];
let mockSession: { user: { id: string } } | null = { user: { id: 'u1' } };

jest.mock('expo-router', () => ({
  DarkTheme: {},
  Stack: () => null,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => mockSegments,
}));

jest.mock('../useSession', () => ({
  useSession: () => ({ session: mockSession, loading: false }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../sync/useSync', () => ({ useSync: jest.fn() }));
jest.mock('../../notifications/useReminderSync', () => ({ useReminderSync: jest.fn() }));
jest.mock('../authService', () => ({ signOut: jest.fn().mockResolvedValue(undefined) }));

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

function mockProfileLookup(result: { data: unknown; error: unknown } | Error) {
  const maybeSingle = result instanceof Error ? jest.fn().mockRejectedValue(result) : jest.fn().mockResolvedValue(result);
  (supabase.from as jest.Mock).mockReturnValueOnce({
    select: () => ({ eq: () => ({ maybeSingle }) }),
  });
}

async function renderLayout(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<RootLayout />);
  });
  return tree;
}

describe('RootLayout profile lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    mockSegments = [];
    mockSession = { user: { id: 'u1' } };
  });

  it.each([
    ['a database error', { data: null, error: { message: 'network request failed' } }],
    ['a thrown network error', new Error('Network request failed')],
  ])('shows a retry state instead of onboarding after %s', async (_name, failure) => {
    mockProfileLookup(failure as Error);

    const tree = await renderLayout();

    expect(mockReplace).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'profile-retry' })).toBeTruthy();
  });

  it('routes to today after a retry succeeds', async () => {
    mockProfileLookup({ data: null, error: { message: 'network request failed' } });
    const tree = await renderLayout();
    mockProfileLookup({ data: { ...COMPLETE_PROFILE }, error: null });

    await act(async () => {
      tree.root.findByProps({ testID: 'profile-retry' }).props.onPress();
    });

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/today');
  });

  it('routes to today when onboarding completes for a not-onboarded user', async () => {
    mockProfileLookup({ data: { onboarded_at: null }, error: null });
    await renderLayout();
    expect(mockReplace).toHaveBeenLastCalledWith('/onboarding/1');

    await act(async () => {
      notifyOnboardingComplete();
    });

    expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/today');
  });

  it('leaves an onboarded user on the settings screen', async () => {
    mockSegments = ['settings'];
    mockProfileLookup({ data: { ...COMPLETE_PROFILE }, error: null });

    await renderLayout();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not reuse the previous account onboarded flag for the next sign-in', async () => {
    mockProfileLookup({ data: { ...COMPLETE_PROFILE }, error: null });
    const tree = await renderLayout();
    expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/today');

    mockSession = null;
    await act(async () => {
      tree.update(<RootLayout />);
    });
    expect(mockReplace).toHaveBeenLastCalledWith('/(auth)/sign-in');

    mockReplace.mockClear();
    (supabase.from as jest.Mock).mockReturnValueOnce({
      select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }),
    });
    mockSession = { user: { id: 'u2' } };
    await act(async () => {
      tree.update(<RootLayout />);
    });

    expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)/today');
  });

  it('treats a missing profile row as not onboarded instead of an error', async () => {
    mockProfileLookup({ data: null, error: null });

    await renderLayout();

    expect(mockReplace).toHaveBeenLastCalledWith('/onboarding/1');
  });

  it('lets the user sign out from the retry screen', async () => {
    mockProfileLookup({ data: null, error: { message: 'network request failed' } });
    const tree = await renderLayout();

    await act(async () => {
      tree.root.findByProps({ testID: 'profile-signout' }).props.onPress();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('restores the saved language from the profile', async () => {
    mockProfileLookup({ data: { ...COMPLETE_PROFILE, language: 'ms' }, error: null });

    await renderLayout();

    expect(i18next.language).toBe('ms');
    await i18next.changeLanguage('en');
  });

  it('sends an onboarded user with missing plan inputs to plan-inputs', async () => {
    mockProfileLookup({
      data: { onboarded_at: '2026-10-12T00:00:00Z', energy_sex: null, activity_level: null },
      error: null,
    });

    await renderLayout();

    expect(mockReplace).toHaveBeenLastCalledWith('/plan-inputs');
  });

  it('routes to today after the plan inputs are saved', async () => {
    mockProfileLookup({
      data: { onboarded_at: '2026-10-12T00:00:00Z', energy_sex: null, activity_level: null },
      error: null,
    });
    await renderLayout();

    await act(async () => {
      notifyPlanInputsSaved();
    });

    expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/today');
  });

  it('runs the offline sync for the signed-in user only', async () => {
    mockProfileLookup({ data: { ...COMPLETE_PROFILE }, error: null });

    await renderLayout();

    expect(useSync).toHaveBeenCalledWith('u1');
  });

  it('keeps the reminders in step with the signed-in account, and with none when signed out', async () => {
    mockProfileLookup({ data: { ...COMPLETE_PROFILE }, error: null });
    await renderLayout();
    expect(useReminderSync).toHaveBeenCalledWith('u1');

    (useReminderSync as jest.Mock).mockClear();
    mockSession = null;
    await renderLayout();
    expect(useReminderSync).toHaveBeenCalledWith(null);
    mockSession = { user: { id: 'u1' } };
  });

  it.each(['meal-planner', 'session', 'exercise', 'plan-preview', 'checkin', 'food-edit', 'food-search', 'food-scan'])('leaves an onboarded user on the %s screen', async (segment) => {
    mockSegments = [segment];
    mockProfileLookup({ data: { ...COMPLETE_PROFILE }, error: null });

    await renderLayout();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  describe('offline cold start', () => {
    it('uses the last known profile when the lookup fails, instead of the retry screen', async () => {
      mockProfileLookup({ data: { ...COMPLETE_PROFILE }, error: null });
      const first = await renderLayout();
      await act(async () => first.unmount());
      mockReplace.mockClear();

      mockProfileLookup({ data: null, error: { message: 'Network request failed' } });
      const tree = await renderLayout();

      expect(tree.root.findAllByProps({ testID: 'profile-retry' })).toHaveLength(0);
      expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/today');
    });

    it('still shows the retry screen when offline and nothing is remembered', async () => {
      mockProfileLookup({ data: null, error: { message: 'Network request failed' } });

      const tree = await renderLayout();

      expect(tree.root.findByProps({ testID: 'profile-retry' })).toBeTruthy();
    });

    it('does not apply another account remembered profile', async () => {
      mockProfileLookup({ data: { ...COMPLETE_PROFILE }, error: null });
      const first = await renderLayout();
      await act(async () => first.unmount());

      mockSession = { user: { id: 'u2' } };
      mockProfileLookup({ data: null, error: { message: 'Network request failed' } });
      const tree = await renderLayout();

      expect(tree.root.findByProps({ testID: 'profile-retry' })).toBeTruthy();
    });
  });
});
