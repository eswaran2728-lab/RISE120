import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import RootLayout from '../../../app/_layout';
import { supabase } from '../../lib/supabase';
import { notifyOnboardingComplete } from '../../onboarding/completion';

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

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

function mockProfileLookup(result: { data: unknown; error: unknown } | Error) {
  const single = result instanceof Error ? jest.fn().mockRejectedValue(result) : jest.fn().mockResolvedValue(result);
  (supabase.from as jest.Mock).mockReturnValueOnce({
    select: () => ({ eq: () => ({ single }) }),
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
    mockProfileLookup({ data: { onboarded_at: '2026-10-12T00:00:00Z' }, error: null });

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
    mockProfileLookup({ data: { onboarded_at: '2026-10-12T00:00:00Z' }, error: null });

    await renderLayout();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not reuse the previous account onboarded flag for the next sign-in', async () => {
    mockProfileLookup({ data: { onboarded_at: '2026-10-12T00:00:00Z' }, error: null });
    const tree = await renderLayout();
    expect(mockReplace).toHaveBeenLastCalledWith('/(tabs)/today');

    mockSession = null;
    await act(async () => {
      tree.update(<RootLayout />);
    });
    expect(mockReplace).toHaveBeenLastCalledWith('/(auth)/sign-in');

    mockReplace.mockClear();
    (supabase.from as jest.Mock).mockReturnValueOnce({
      select: () => ({ eq: () => ({ single: () => new Promise(() => {}) }) }),
    });
    mockSession = { user: { id: 'u2' } };
    await act(async () => {
      tree.update(<RootLayout />);
    });

    expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)/today');
  });
});
