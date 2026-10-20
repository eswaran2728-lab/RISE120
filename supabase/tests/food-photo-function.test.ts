import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';
import { foodPhotoPath } from '../functions/_shared/food/photo/lifecycle';
import { syntheticJpeg } from './food-photo-fixtures';

jest.setTimeout(300000);

const uuid = () => crypto.randomUUID();

// The deployed analyse-food-photo function on Rise120 development. No image provider is configured there, so the honest
// answer to a real request is "unavailable"; these tests check that, plus authentication, validation and cleanup.
describe('analyse-food-photo (deployed, no provider configured)', () => {
  const admin = createAdmin();
  let A: TestUser, FREE: TestUser;

  beforeAll(async () => {
    A = await createTestUser(admin, 'fpf-a');
    FREE = await createTestUser(admin, 'fpf-free');
    expect((await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', A.id)).error).toBeNull();
  });
  afterAll(async () => {
    await clean();
    for (const user of [A, FREE]) await admin.auth.admin.deleteUser(user.id);
  });
  async function clean() {
    for (const user of [A, FREE]) {
      const { data } = await admin.storage.from('food-photos').list(user.id, { limit: 1000 });
      if (data?.length) await admin.storage.from('food-photos').remove(data.map((f) => `${user.id}/${f.name}`));
    }
    await admin.from('food_photo_requests').delete().in('user_id', [A.id, FREE.id]);
  }
  beforeEach(clean);

  const setSwitch = async (value: boolean, run: () => Promise<void>) => {
    const original = (await admin.from('app_config').select('value').eq('key', 'food_photo_enabled').single()).data?.value;
    try {
      await admin.from('app_config').update({ value }).eq('key', 'food_photo_enabled');
      await run();
    } finally {
      await admin.from('app_config').update({ value: original }).eq('key', 'food_photo_enabled');
    }
  };
  const analyse = (user: TestUser | undefined, body: unknown) => callFunction('analyse-food-photo', user?.jwt, body as object);
  const upload = async (user: TestUser, id: string) => {
    expect((await user.client.storage.from('food-photos').upload(foodPhotoPath(user.id, id), syntheticJpeg(), { contentType: 'image/jpeg' })).error).toBeNull();
  };
  const listed = async (user: TestUser) => ((await admin.storage.from('food-photos').list(user.id, { limit: 100 })).data ?? []).length;

  it('answers 401 without a valid JWT and 400 for a bad body', async () => {
    expect((await analyse(undefined, {})).status).toBe(401);
    expect((await callFunction('analyse-food-photo', 'not-a-jwt', {})).status).toBe(401);
    expect((await analyse(A, {})).status).toBe(400);
    expect((await analyse(A, { requestId: uuid(), privateImageRef: foodPhotoPath(FREE.id, uuid()) })).status).toBe(400);
    expect((await analyse(A, { requestId: 'x', privateImageRef: 'y' })).status).toBe(400);
  });

  it('is unavailable while the kill switch is off, and keeps nothing', async () => {
    const id = uuid();
    await upload(A, id);

    const result = await analyse(A, { requestId: id, privateImageRef: foodPhotoPath(A.id, id) });

    expect(result.status).toBe(503);
    expect(result.json).toEqual({ status: 'unavailable', reason: 'disabled' });
    expect((await admin.from('food_photo_requests').select('request_id').eq('user_id', A.id)).data).toEqual([]);
  });

  it('is unavailable for a free member even with the switch on', async () => {
    await setSwitch(true, async () => {
      const id = uuid();
      await upload(FREE, id);

      const result = await analyse(FREE, { requestId: id, privateImageRef: foodPhotoPath(FREE.id, id) });

      expect(result.json).toEqual({ status: 'unavailable', reason: 'premium_required' });
    });
  });

  it('says the provider is unavailable when none is configured, releases the reservation and removes the image', async () => {
    await setSwitch(true, async () => {
      const id = uuid();
      await upload(A, id);

      const result = await analyse(A, { requestId: id, privateImageRef: foodPhotoPath(A.id, id) });

      expect(result.status).toBe(503);
      expect(result.json).toEqual({ status: 'unavailable', reason: 'provider' });
      expect((await admin.from('food_photo_requests').select('status').eq('user_id', A.id).eq('request_id', id).single()).data!.status).toBe('failed');
      expect(await listed(A)).toBe(0);
      expect((await admin.from('food_logs').select('id').eq('user_id', A.id)).data).toEqual([]);
    });
  });

  it('does not leak anything about the account, the image or the server in an answer', async () => {
    await setSwitch(true, async () => {
      const id = uuid();
      await upload(A, id);

      const result = await analyse(A, { requestId: id, privateImageRef: foodPhotoPath(A.id, id) });

      const raw = JSON.stringify(result.json);
      for (const secret of [A.id, A.email, 'food-photos', 'stack', 'supabase']) expect(raw).not.toContain(secret);
    });
  });
});
