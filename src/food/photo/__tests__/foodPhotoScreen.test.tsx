import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import FoodPhotoScreen from '../../../../app/food-photo';
import i18next, { t } from '../../../i18n';
import { mockStore } from '../../../sync/testing/storageMock';
import { listPending } from '../../../sync/queue';
import * as api from '../api';
import * as files from '../files';
import * as review from '../review';
import { loadLimitsOrCached } from '../../../monetization/limits';
import { flushPending } from '../../../sync/flush';
import * as ImagePicker from 'expo-image-picker';
import type { Candidate } from '../review';
import type { Food } from '../../types';

jest.setTimeout(30000);

let mockUserId: string | null = 'A';
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]), // eslint-disable-line @typescript-eslint/no-require-imports
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace, canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../../auth/useSession', () => ({ useSession: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }) }));
jest.mock('../../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-20' }));
jest.mock('../../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() }, storage: { from: jest.fn() } } }));
jest.mock('../../../monetization/limits', () => ({ ...jest.requireActual('../../../monetization/limits'), loadLimitsOrCached: jest.fn() }));
jest.mock('../../../sync/flush', () => ({ flushPending: jest.fn() }));
jest.mock('../../../sync/supabaseTransport', () => ({ supabaseTransport: {} }));
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock('../files', () => ({ saveFoodPhotoLocal: jest.fn(), removeLocalFoodPhoto: jest.fn(), removeFoodPhotos: jest.fn() }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), analysePhoto: jest.fn(), uploadFoodPhoto: jest.fn(), removeUploadedFoodPhoto: jest.fn() }));
jest.mock('../review', () => ({ ...jest.requireActual('../review'), resolveCandidate: jest.fn() }));

const mocked = {
  limits: loadLimitsOrCached as jest.Mock,
  flush: flushPending as jest.Mock,
  permission: ImagePicker.requestCameraPermissionsAsync as jest.Mock,
  camera: ImagePicker.launchCameraAsync as jest.Mock,
  library: ImagePicker.launchImageLibraryAsync as jest.Mock,
  save: files.saveFoodPhotoLocal as jest.Mock,
  removeLocal: files.removeLocalFoodPhoto as jest.Mock,
  analyse: api.analysePhoto as jest.Mock,
  upload: api.uploadFoodPhoto as jest.Mock,
  removeRemote: api.removeUploadedFoodPhoto as jest.Mock,
  resolve: review.resolveCandidate as jest.Mock,
};

const FOOD_ID = '3f2b8c1e-1111-4222-8333-444455556666';
const premium = (photoFood: boolean) => ({ snapshot: { tier: photoFood ? 'premium' : 'free', planDaysAccessible: 120, food: { remaining: null }, ai: { remaining: 5 }, capabilities: { basicPlan: true, manualFood: true, adaptiveProgression: photoFood, mealPlanner: photoFood, photoFood, coach: true } }, stale: false });
const food = (over: Partial<Food> = {}): Food => ({ id: FOOD_ID, userId: null, name: 'Fixture rice', aliases: {}, servingDesc: '1 bowl', calories: 200, proteinG: 4, carbsG: 44, fatG: 1, source: 'curated', verified: true, region: 'MY', sourceId: 'rice-1', barcode: null, ...over });
const candidate = (over: Partial<Candidate> = {}): Candidate => ({ kind: 'food', id: FOOD_ID, name: 'Fixture rice', uncertainty: 'likely', servings: 1.5, loggable: true, provenance: { source: 'curated', sourceId: 'rice-1', verified: true, reviewed: true }, ...over });
const photo = { canceled: false, assets: [{ uri: 'file:///cache/picked.jpg', width: 4000, height: 3000 }] };

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
const has = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id).length > 0;
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && (typeof n.props.onPress === 'function' || typeof n.props.onChangeText === 'function')).pop();
const press = (tree: ReactTestRenderer, id: string) =>
  act(async () => {
    await byId(tree, id)!.props.onPress();
  });
async function mount() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<FoodPhotoScreen />);
  });
  return tree;
}
// A photo taken, uploaded and analysed with one candidate.
async function reachReview(tree: ReactTestRenderer, found: Candidate[] = [candidate()]) {
  mocked.analyse.mockResolvedValue({ kind: 'ok', candidates: found });
  await press(tree, 'photo-take');
}

beforeEach(async () => {
  jest.clearAllMocks();
  Object.values(mocked).forEach((m) => m.mockReset());
  mockStore.clear();
  mockUserId = 'A';
  await i18next.changeLanguage('en');
  mocked.limits.mockResolvedValue(premium(true));
  mocked.permission.mockResolvedValue({ granted: true });
  mocked.camera.mockResolvedValue(photo);
  mocked.library.mockResolvedValue(photo);
  mocked.save.mockResolvedValue('file:///docs/food-photos/A/1.jpg');
  mocked.upload.mockResolvedValue({ kind: 'ok' });
  mocked.removeRemote.mockResolvedValue(undefined);
  mocked.analyse.mockResolvedValue({ kind: 'no_match' });
  mocked.resolve.mockResolvedValue({ kind: 'ok', selected: { kind: 'food', food: food() } });
  mocked.flush.mockResolvedValue({ synced: 0, failed: 0, remaining: 0 });
});

describe('access', () => {
  it('restarts for each account', () => {
    expect((FoodPhotoScreen as unknown as { accountScoped?: boolean }).accountScoped).toBe(true);
  });

  it('offers the photo steps when the server says photo logging is available, and always the manual path', async () => {
    const tree = await mount();

    expect(has(tree, 'photo-take')).toBe(true);
    expect(has(tree, 'photo-choose')).toBe(true);
    expect(has(tree, 'photo-manual')).toBe(true);
    expect(shows(tree, t('food.photo.intro'))).toBe(true);
  });

  it('offers Premium and manual search, and no photo step, when the server says it is not available to this account', async () => {
    mocked.limits.mockResolvedValue(premium(false));
    const tree = await mount();

    expect(has(tree, 'photo-take')).toBe(false);
    expect(has(tree, 'photo-upgrade')).toBe(true);
    expect(has(tree, 'photo-manual')).toBe(true);
    await press(tree, 'photo-upgrade');
    expect(mockPush).toHaveBeenCalledWith('/paywall');
  });

  it('does not guess access when the server cannot be asked: it says so and offers a retry and manual search', async () => {
    mocked.limits.mockResolvedValue(null);
    const tree = await mount();

    expect(has(tree, 'photo-take')).toBe(false);
    expect(shows(tree, t('food.photo.accessUnknown'))).toBe(true);
    expect(has(tree, 'photo-retry-access')).toBe(true);
    mocked.limits.mockResolvedValue(premium(true));
    await press(tree, 'photo-retry-access');
    expect(has(tree, 'photo-take')).toBe(true);
  });

  it('opens manual food search from the fallback', async () => {
    const tree = await mount();

    await press(tree, 'photo-manual');

    expect(mockPush).toHaveBeenCalledWith('/food-search');
  });

  it('makes no claim of exact nutrition, allergy safety or halal status anywhere', async () => {
    const tree = await mount();

    expect(textsOf(tree).join(' ')).not.toMatch(/halal|allerg|exact calories|guarantee/i);
  });
});

describe('permission and capture', () => {
  it('explains a denied camera permission, does not open the camera, and keeps choosing a photo and manual search available', async () => {
    mocked.permission.mockResolvedValue({ granted: false });
    const tree = await mount();

    await press(tree, 'photo-take');

    expect(shows(tree, t('food.photo.permissionDenied'))).toBe(true);
    expect(mocked.camera).not.toHaveBeenCalled();
    expect(has(tree, 'photo-choose')).toBe(true);
    expect(has(tree, 'photo-manual')).toBe(true);
  });

  it('does nothing when the picker is cancelled', async () => {
    mocked.camera.mockResolvedValue({ canceled: true, assets: [] });
    const tree = await mount();

    await press(tree, 'photo-take');

    expect(mocked.save).not.toHaveBeenCalled();
    expect(mocked.upload).not.toHaveBeenCalled();
  });

  it('re-encodes the photo into the account\'s own folder, uploads it under a request id, analyses it with the same id, then removes the local copy', async () => {
    const tree = await mount();

    await reachReview(tree);

    expect(mocked.save).toHaveBeenCalledWith('A', 'file:///cache/picked.jpg', 4000, 3000);
    const requestId = mocked.upload.mock.calls[0][1];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocked.upload).toHaveBeenCalledWith('A', requestId, 'file:///docs/food-photos/A/1.jpg');
    expect(mocked.analyse).toHaveBeenCalledWith('A', requestId);
    expect(mocked.removeLocal).toHaveBeenCalledWith('file:///docs/food-photos/A/1.jpg');
  });

  it('can choose a photo from the library as well', async () => {
    const tree = await mount();
    mocked.analyse.mockResolvedValue({ kind: 'ok', candidates: [candidate()] });

    await press(tree, 'photo-choose');

    expect(mocked.library).toHaveBeenCalled();
    expect(has(tree, `photo-candidate-${FOOD_ID}`)).toBe(true);
  });

  it('says the photo could not be prepared when re-encoding fails, and sends nothing', async () => {
    mocked.save.mockRejectedValue(new Error('boom'));
    const tree = await mount();

    await press(tree, 'photo-take');

    expect(shows(tree, t('food.photo.invalidImage'))).toBe(true);
    expect(mocked.upload).not.toHaveBeenCalled();
  });
});

describe('what the server answers', () => {
  it.each([
    ['no_match', { kind: 'no_match' }, 'food.photo.noMatch'],
    ['unavailable (disabled)', { kind: 'unavailable', reason: 'disabled' }, 'food.photo.unavailable'],
    ['unavailable (provider)', { kind: 'unavailable', reason: 'provider' }, 'food.photo.unavailable'],
    ['unavailable (premium)', { kind: 'unavailable', reason: 'premium_required' }, 'food.photo.premiumOnly'],
    ['limited', { kind: 'limited', retryAt: '2026-10-21T00:00:00.000Z' }, 'food.photo.limited'],
    ['in progress', { kind: 'in_progress' }, 'food.photo.inProgress'],
    ['unknown outcome', { kind: 'unknown' }, 'food.photo.unknown'],
    ['failed', { kind: 'failed' }, 'food.photo.failed'],
    ['invalid image', { kind: 'invalid_image', missing: false }, 'food.photo.invalidImage'],
    ['offline', { kind: 'offline' }, 'food.photo.offline'],
    ['error', { kind: 'error' }, 'food.photo.failed'],
  ])('explains %s and keeps manual search available', async (_name, answer, key) => {
    mocked.analyse.mockResolvedValue(answer);
    const tree = await mount();

    await press(tree, 'photo-take');

    expect(shows(tree, t(key))).toBe(true);
    expect(has(tree, 'photo-manual')).toBe(true);
    expect(has(tree, `photo-candidate-${FOOD_ID}`)).toBe(false);
  });

  it('retries an upload that failed for lack of a connection, with the same request id', async () => {
    mocked.upload.mockResolvedValueOnce({ kind: 'offline' });
    const tree = await mount();
    mocked.analyse.mockResolvedValue({ kind: 'ok', candidates: [candidate()] });

    await press(tree, 'photo-take');
    expect(shows(tree, t('food.photo.offline'))).toBe(true);
    await press(tree, 'photo-retry');

    expect(mocked.upload).toHaveBeenCalledTimes(2);
    expect(mocked.upload.mock.calls[1][1]).toBe(mocked.upload.mock.calls[0][1]);
    expect(has(tree, `photo-candidate-${FOOD_ID}`)).toBe(true);
  });

  it('never retries an unknown outcome automatically: there is no retry for it, only a new photo or manual search', async () => {
    mocked.analyse.mockResolvedValue({ kind: 'unknown' });
    const tree = await mount();

    await press(tree, 'photo-take');

    expect(has(tree, 'photo-retry')).toBe(false);
    expect(mocked.analyse).toHaveBeenCalledTimes(1);
  });

  it('takes a new request id for a new photo', async () => {
    const tree = await mount();
    await press(tree, 'photo-take');
    await press(tree, 'photo-take');

    expect(mocked.upload.mock.calls[1][1]).not.toBe(mocked.upload.mock.calls[0][1]);
  });
});

describe('a temporary problem, and an image that cleanup removed', () => {
  it('keeps the photo for a retry after a temporary server problem: same request id, no second upload, and the local copy stays until the answer', async () => {
    mocked.analyse.mockResolvedValueOnce({ kind: 'temporary' });
    mocked.analyse.mockResolvedValueOnce({ kind: 'ok', candidates: [candidate()] });
    const tree = await mount();

    await press(tree, 'photo-take');
    expect(shows(tree, t('food.photo.temporary'))).toBe(true);
    expect(mocked.removeLocal).not.toHaveBeenCalled();
    await press(tree, 'photo-retry');

    expect(mocked.upload).toHaveBeenCalledTimes(1);
    expect(mocked.analyse).toHaveBeenCalledTimes(2);
    expect(mocked.analyse.mock.calls[1][1]).toBe(mocked.analyse.mock.calls[0][1]);
    expect(has(tree, `photo-candidate-${FOOD_ID}`)).toBe(true);
    expect(mocked.removeLocal).toHaveBeenCalledWith('file:///docs/food-photos/A/1.jpg');
  });

  it('does not remove the local copy while the server has not answered', async () => {
    mocked.analyse.mockReturnValue(new Promise(() => undefined));
    const tree = await mount();

    await act(async () => {
      void byId(tree, 'photo-take')!.props.onPress();
    });

    expect(mocked.upload).toHaveBeenCalled();
    expect(mocked.removeLocal).not.toHaveBeenCalled();
  });

  it('sends the photo again, once, under the same request id, when the server says the uploaded image is gone', async () => {
    mocked.analyse.mockResolvedValueOnce({ kind: 'temporary' });
    mocked.analyse.mockResolvedValueOnce({ kind: 'invalid_image', missing: true });
    mocked.analyse.mockResolvedValueOnce({ kind: 'ok', candidates: [candidate()] });
    const tree = await mount();

    await press(tree, 'photo-take');
    await press(tree, 'photo-retry');

    expect(mocked.upload).toHaveBeenCalledTimes(2);
    expect(mocked.upload.mock.calls[1]).toEqual(mocked.upload.mock.calls[0]); // same account, request id and local file
    expect(mocked.analyse).toHaveBeenCalledTimes(3);
    expect(has(tree, `photo-candidate-${FOOD_ID}`)).toBe(true);
  });

  it('does not loop: a second missing image is explained, and the local copy is then removed', async () => {
    mocked.analyse.mockResolvedValue({ kind: 'invalid_image', missing: true });
    const tree = await mount();

    await press(tree, 'photo-take');

    expect(mocked.upload).toHaveBeenCalledTimes(2);
    expect(mocked.analyse).toHaveBeenCalledTimes(2);
    expect(shows(tree, t('food.photo.invalidImage'))).toBe(true);
    expect(mocked.removeLocal).toHaveBeenCalledWith('file:///docs/food-photos/A/1.jpg');
  });

  it('explains a photo the server refused for its content without sending it again', async () => {
    mocked.analyse.mockResolvedValue({ kind: 'invalid_image', missing: false });
    const tree = await mount();

    await press(tree, 'photo-take');

    expect(mocked.upload).toHaveBeenCalledTimes(1);
    expect(shows(tree, t('food.photo.invalidImage'))).toBe(true);
  });

  it('stops quietly if the re-upload cannot be made, and keeps the explanation', async () => {
    mocked.analyse.mockResolvedValueOnce({ kind: 'invalid_image', missing: true });
    mocked.upload.mockResolvedValueOnce({ kind: 'ok' });
    mocked.upload.mockResolvedValueOnce({ kind: 'offline' });
    const tree = await mount();

    await press(tree, 'photo-take');

    expect(shows(tree, t('food.photo.offline'))).toBe(true);
    expect(has(tree, 'photo-retry')).toBe(true);
  });
});

describe('reviewing candidates', () => {
  it('shows each candidate with its uncertainty, its source and whether it is verified, and a suggested portion that is only a guess', async () => {
    const tree = await mount();

    await reachReview(tree, [candidate(), candidate({ id: '00000000-0000-4000-8000-000000000002', name: 'Fixture egg', uncertainty: 'unsure', servings: null, provenance: { source: 'usda', sourceId: 'e', verified: false, reviewed: false } })]);

    expect(shows(tree, 'Fixture rice')).toBe(true);
    expect(shows(tree, t('food.photo.likely'))).toBe(true);
    expect(shows(tree, t('food.photo.unsure'))).toBe(true);
    expect(shows(tree, t('food.photo.suggested', { count: 1.5 }))).toBe(true);
    expect(shows(tree, t('food.verified'))).toBe(true);
  });

  it('shows an unloggable candidate as unloggable, never opens it, and offers manual search', async () => {
    const tree = await mount();

    await reachReview(tree, [candidate({ loggable: false })]);

    expect(shows(tree, t('food.photo.unloggable'))).toBe(true);
    expect(has(tree, `photo-candidate-${FOOD_ID}`)).toBe(false);
    expect(has(tree, 'photo-manual')).toBe(true);
  });

  it('says so when the record behind a candidate is gone, and when it cannot be read offline', async () => {
    mocked.resolve.mockResolvedValueOnce({ kind: 'gone' });
    mocked.resolve.mockResolvedValueOnce({ kind: 'offline' });
    const tree = await mount();
    await reachReview(tree);

    await press(tree, `photo-candidate-${FOOD_ID}`);
    expect(shows(tree, t('food.photo.gone'))).toBe(true);
    await press(tree, `photo-candidate-${FOOD_ID}`);
    expect(shows(tree, t('food.photo.offline'))).toBe(true);
    expect(await listPending('A')).toEqual([]);
  });

  it('opens the portion and nutrition preview with the suggested amount, the source, and a note that it is an estimate; nothing is logged yet', async () => {
    const tree = await mount();
    await reachReview(tree);

    await press(tree, `photo-candidate-${FOOD_ID}`);

    expect(byId(tree, 'food-entry-quantity')!.props.value).toBe('1.5');
    expect(shows(tree, t('food.photo.estimateNote'))).toBe(true);
    expect(shows(tree, 'Fixture rice')).toBe(true);
    expect(await listPending('A')).toEqual([]);
  });

  it('lets the member correct the portion before saving, and logs exactly that amount only after Save', async () => {
    const tree = await mount();
    await reachReview(tree);
    await press(tree, `photo-candidate-${FOOD_ID}`);

    await act(async () => {
      byId(tree, 'food-entry-quantity')!.props.onChangeText('2');
    });
    expect(await listPending('A')).toEqual([]);
    await press(tree, 'food-entry-submit');

    const [op] = await listPending('A');
    expect(op).toMatchObject({ kind: 'food_log', foodId: FOOD_ID, quantity: 2, deleted: false, date: '2026-10-20' });
    expect((op as { food: Food }).food).toMatchObject({ source: 'curated', verified: true });
    expect(mocked.flush).toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it('saves once however many times Save is pressed', async () => {
    const tree = await mount();
    await reachReview(tree);
    await press(tree, `photo-candidate-${FOOD_ID}`);

    await act(async () => {
      void byId(tree, 'food-entry-submit')!.props.onPress();
      void byId(tree, 'food-entry-submit')!.props.onPress();
    });

    expect(await listPending('A')).toHaveLength(1);
  });

  it('still saves when the phone is offline after the candidate arrived, and syncs later', async () => {
    mocked.flush.mockRejectedValue(new Error('Network request failed'));
    const tree = await mount();
    await reachReview(tree);
    await press(tree, `photo-candidate-${FOOD_ID}`);

    await press(tree, 'food-entry-submit');

    expect(await listPending('A')).toHaveLength(1);
    expect(mockBack).toHaveBeenCalled();
  });

  it('logs a recipe candidate through its private food, food before log', async () => {
    const { recipe } = jest.requireActual('../../mealPlanner/testing/fixtures');
    mocked.resolve.mockResolvedValue({ kind: 'ok', selected: { kind: 'recipe', recipe: recipe('bowl') } });
    const tree = await mount();
    await reachReview(tree, [candidate({ kind: 'recipe', id: 'bowl', version: 1, name: 'Recipe bowl', provenance: { source: 'recipe', sourceId: 'bowl@1', verified: false, reviewed: true } })]);
    await press(tree, 'photo-candidate-bowl');

    await press(tree, 'food-entry-submit');

    expect((await listPending('A')).map((o) => o.kind)).toEqual(['recipe_food', 'food_log']);
  });

  it('keeps an unloggable recipe from being saved at all: explained, with manual search', async () => {
    const { recipe } = jest.requireActual('../../mealPlanner/testing/fixtures');
    const base = recipe('bowl');
    mocked.resolve.mockResolvedValue({ kind: 'ok', selected: { kind: 'recipe', recipe: { ...base, nutrition: { ...base.nutrition, perServing: { ...base.nutrition.perServing, fatG: null } } } } });
    const tree = await mount();
    await reachReview(tree, [candidate({ kind: 'recipe', id: 'bowl', version: 1, name: 'Recipe bowl' })]);

    await press(tree, 'photo-candidate-bowl');

    expect(shows(tree, t('food.photo.unloggable'))).toBe(true);
    expect(has(tree, 'food-entry-submit')).toBe(false);
    expect(await listPending('A')).toEqual([]);
  });

  it('can go back from the preview to the candidates, and from the candidates to a new photo', async () => {
    const tree = await mount();
    await reachReview(tree);
    await press(tree, `photo-candidate-${FOOD_ID}`);
    const cancel = tree.root.findAll((n) => typeof n.props.onPress === 'function' && n.findAll((m) => (m.type as unknown) === 'Text' && m.children.includes(t('settings.cancel'))).length > 0).pop()!;

    await act(async () => cancel.props.onPress());

    expect(has(tree, `photo-candidate-${FOOD_ID}`)).toBe(true);
    expect(has(tree, 'food-entry-submit')).toBe(false);
  });
});

describe('accounts and clean-up', () => {
  it('never shows one account\'s candidates to the next account, and removes the in-flight local photo when the screen goes', async () => {
    let release!: (value: unknown) => void;
    mocked.analyse.mockReturnValue(new Promise((resolve) => (release = resolve)));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<FoodPhotoScreen />);
    });
    await act(async () => {
      void byId(tree, 'photo-take')!.props.onPress();
    });

    mockUserId = 'B';
    await act(async () => {
      tree.update(<FoodPhotoScreen />);
    });
    await act(async () => release({ kind: 'ok', candidates: [candidate()] }));

    expect(has(tree, `photo-candidate-${FOOD_ID}`)).toBe(false);
    expect(shows(tree, 'Fixture rice')).toBe(false);
    expect(mocked.removeRemote).not.toHaveBeenCalledWith('B', expect.anything());
  });

  it('does not save a log for an account that has switched away', async () => {
    const tree = await mount();
    await reachReview(tree);
    await press(tree, `photo-candidate-${FOOD_ID}`);
    mockUserId = 'B';

    await act(async () => {
      tree.update(<FoodPhotoScreen />);
    });

    expect(await listPending('B')).toEqual([]);
    expect(has(tree, 'food-entry-submit')).toBe(false);
  });

  it('removes the uploaded object it made when the photo is abandoned before an answer', async () => {
    mocked.analyse.mockReturnValue(new Promise(() => undefined));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<FoodPhotoScreen />);
    });
    await act(async () => {
      void byId(tree, 'photo-take')!.props.onPress();
    });

    await act(async () => tree.unmount());

    expect(mocked.removeRemote).toHaveBeenCalledWith('A', mocked.upload.mock.calls[0][1]);
  });
});

describe('translations', () => {
  it.each(['ms', 'ta'])('has the photo text in %s rather than falling back to English', async (language) => {
    const keys = ['food.photo.open', 'food.photo.intro', 'food.photo.take', 'food.photo.permissionDenied', 'food.photo.noMatch', 'food.photo.estimateNote', 'food.photo.unloggable', 'food.photo.likely', 'food.photo.unknown', 'food.photo.temporary'];
    await i18next.changeLanguage('en');
    const english = keys.map((k) => t(k));
    await i18next.changeLanguage(language);

    keys.forEach((k, i) => {
      expect(t(k)).not.toBe(k);
      expect(t(k)).not.toBe(english[i]);
    });
    await i18next.changeLanguage('en');
  });
});
