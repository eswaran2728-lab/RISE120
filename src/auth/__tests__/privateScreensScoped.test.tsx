import Today from '../../../app/(tabs)/today';
import Workout from '../../../app/(tabs)/workout';
import Food from '../../../app/(tabs)/food';
import Progress from '../../../app/(tabs)/progress';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn(), useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }), Href: undefined }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));

// A private tab keeps loaded data in component state. If one account signs out and another signs in while the
// screen stays mounted, that state would still show the first account's data. Each private tab therefore starts
// from scratch for every account.
test.each([
  ['Today', Today],
  ['Workout', Workout],
  ['Food', Food],
  ['Progress', Progress],
])('the %s tab restarts for each account', (_name, screen) => {
  expect((screen as unknown as { accountScoped?: boolean }).accountScoped).toBe(true);
});
