import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import EatingOutScreen from '../../../app/eating-out';
import { t } from '../../i18n';
import * as data from '../eatingOutData';
import type { Dish } from '../eatingOut';

jest.setTimeout(30000);

const mockPush = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]), // eslint-disable-line @typescript-eslint/no-require-imports
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../eatingOutData', () => ({ loadDishes: jest.fn() }));

// SYNTHETIC dishes only.
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const dish = (id: string, over: Partial<Dish> = {}): Dish => ({
  id, version: 1, status: 'published', region: 'MY', name: L(`Dish ${id}`), aliases: {}, tips: [L(`Tip for ${id}`)], calories: { min: 400, max: 700 }, servingNote: L('One plate'),
  provenance: { name: 'Fixture', url: null, recordId: null, version: '1', accessedOn: '2000-01-01', licenceEvidence: 'Fixture' }, reviewer: { name: 'Fixture', role: 'Fixture', reviewedOn: '2000-01-01' }, ...over,
});

const textsOf = (tree: ReactTestRenderer): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') ((node as { children?: unknown[] | null }).children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out;
};
const shows = (tree: ReactTestRenderer, text: string) => textsOf(tree).some((s) => s.includes(text));
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && typeof n.props.onPress === 'function').pop();
async function mount() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<EatingOutScreen />);
  });
  return tree;
}

beforeEach(() => {
  mockPush.mockReset();
  (data.loadDishes as jest.Mock).mockReset();
});

describe('the eating-out screen', () => {
  it('restarts for each account', () => {
    expect((EatingOutScreen as unknown as { accountScoped?: boolean }).accountScoped).toBe(true);
  });

  it('says there are no reviewed dishes yet and offers the honest manual path', async () => {
    (data.loadDishes as jest.Mock).mockResolvedValue([]);
    const tree = await mount();

    expect(shows(tree, t('eatingOut.empty'))).toBe(true);
    await act(async () => {
      byId(tree, 'eating-out-manual')!.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/food-search');
  });

  it('always says this is general guidance for reviewed dishes, not a live menu or a restaurant', async () => {
    (data.loadDishes as jest.Mock).mockResolvedValue([dish('a')]);
    const tree = await mount();

    expect(shows(tree, t('eatingOut.notLive'))).toBe(true);
  });

  it('shows each dish with its tips and an approximate calorie range for the portion described, never one precise number', async () => {
    (data.loadDishes as jest.Mock).mockResolvedValue([dish('a')]);
    const tree = await mount();

    expect(shows(tree, 'Dish a')).toBe(true);
    expect(shows(tree, 'Tip for a')).toBe(true);
    expect(shows(tree, t('eatingOut.range', { min: 400, max: 700 }))).toBe(true);
    expect(shows(tree, 'One plate')).toBe(true);
  });

  it('says calories are not known, and shows no range, when the reviewer could not support one', async () => {
    (data.loadDishes as jest.Mock).mockResolvedValue([dish('a', { calories: null, servingNote: null, provenance: null })]);
    const tree = await mount();

    expect(shows(tree, t('eatingOut.caloriesUnknown'))).toBe(true);
    expect(shows(tree, t('eatingOut.range', { min: 0, max: 0 }))).toBe(false);
  });

  it('asks for the signed-in account only', async () => {
    (data.loadDishes as jest.Mock).mockResolvedValue([]);
    await mount();

    expect(data.loadDishes).toHaveBeenCalledWith('A');
  });
});
