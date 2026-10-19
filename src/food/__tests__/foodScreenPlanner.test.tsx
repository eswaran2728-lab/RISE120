import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import FoodScreen from '../../../app/(tabs)/food';
import { buildFoodDay } from '../day';
import { loadFoodDay } from '../loadDay';
import { loadPlanBundle } from '../../plan/planData';
import { loadLimitsOrCached } from '../../monetization/limits';
import { useUnlock } from '../../monetization/useUnlock';

jest.setTimeout(30000);

const mockPush = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]), // eslint-disable-line @typescript-eslint/no-require-imports
  useRouter: () => ({ push: mockPush, navigate: mockPush }),
}));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-19' }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../loadDay', () => ({ loadFoodDay: jest.fn() }));
jest.mock('../../plan/planData', () => ({ loadPlanBundle: jest.fn() }));
jest.mock('../../monetization/limits', () => ({ ...jest.requireActual('../../monetization/limits'), loadLimitsOrCached: jest.fn() }));
jest.mock('../../monetization/useUnlock', () => ({ useUnlock: jest.fn() }));

const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && typeof n.props.onPress === 'function').pop();

describe('the Food tab', () => {
  it('links to the meal planner, and keeps the manual add buttons', async () => {
    (loadFoodDay as jest.Mock).mockResolvedValue(buildFoodDay({ date: '2026-10-19', synced: [], pending: [], knownFoods: [] }));
    (loadPlanBundle as jest.Mock).mockResolvedValue(null);
    (loadLimitsOrCached as jest.Mock).mockResolvedValue(null);
    (useUnlock as jest.Mock).mockReturnValue({ run: jest.fn(), busy: false });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<FoodScreen />);
    });

    await act(async () => {
      byId(tree, 'food-open-planner')!.props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith('/meal-planner');
    expect(tree.root.findAll((n) => typeof n.props.onPress === 'function' && n.findAll((m) => (m.type as unknown) === 'Text' && typeof m.children[0] === 'string' && (m.children[0] as string).startsWith('+ ')).length > 0).length).toBeGreaterThan(0);
  });
});
