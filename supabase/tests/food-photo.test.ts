import { callFunction, createAdmin, createTestClient, createTestUser, publishableKey, TestUser } from './helpers';
import { completePhotoRequest, failPhotoRequest, reservePhotoRequest } from '../functions/_shared/food/photo/ledger';
import { deletePhotoImage, foodPhotoPath, isFoodPhotoPath, runPhotoCleanup } from '../functions/_shared/food/photo/lifecycle';
import { FOOD_PHOTO_LIMITS } from '../functions/_shared/food/photo/image';
import { syntheticJpeg } from './food-photo-fixtures';

jest.setTimeout(300000);

const BUCKET = 'food-photos';
const uuid = () => crypto.randomUUID();
const RESULT = { candidates: [{ kind: 'food', id: '00000000-0000-4000-8000-000000000001', name: 'Fixture rice' }] };

// Roadmap F2 Task 1, SYNTHETIC images only: the private image lifecycle and request admission for food photos.
// Run in band (these tests change shared configuration and restore it).
describe('food photo images and admission (live)', () => {
  const admin = createAdmin();
  const users: TestUser[] = [];
  let A: TestUser, B: TestUser, FREE: TestUser;

  beforeAll(async () => {
    for (const label of ['fp-a', 'fp-b', 'fp-free']) users.push(await createTestUser(admin, label));
    [A, B, FREE] = users;
    for (const user of [A, B]) expect((await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id)).error).toBeNull();
  });
  afterAll(async () => {
    await clean();
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });
  const ids = () => users.map((u) => u.id);
  async function clean() {
    for (const user of users) {
      const { data } = await admin.storage.from(BUCKET).list(user.id, { limit: 1000 });
      if (data?.length) await admin.storage.from(BUCKET).remove(data.map((f) => `${user.id}/${f.name}`));
    }
    await admin.from('food_photo_requests').delete().in('user_id', ids());
  }
  beforeEach(clean);

  const setConfig = async (key: string, value: unknown, run: () => Promise<void>) => {
    const original = (await admin.from('app_config').select('value').eq('key', key).single()).data?.value;
    try {
      expect((await admin.from('app_config').update({ value }).eq('key', key)).error).toBeNull();
      await run();
    } finally {
      await admin.from('app_config').update({ value: original }).eq('key', key);
    }
  };
  const enabled = (run: () => Promise<void>) => setConfig('food_photo_enabled', true, run);
  const upload = (user: TestUser, path: string, bytes: Uint8Array = syntheticJpeg(), contentType = 'image/jpeg', upsert = false) =>
    user.client.storage.from(BUCKET).upload(path, bytes, { contentType, upsert });
  const exists = async (path: string) => !(await admin.storage.from(BUCKET).download(path)).error;
  const rowOf = async (user: TestUser, requestId: string) => (await admin.from('food_photo_requests').select('*').eq('user_id', user.id).eq('request_id', requestId).maybeSingle()).data;

  describe('the private bucket', () => {
    it('lets a member store and read only a generated object under their own folder', async () => {
      const path = foodPhotoPath(A.id, uuid());

      expect((await upload(A, path)).error).toBeNull();

      expect((await A.client.storage.from(BUCKET).download(path)).error).toBeNull();
      expect(isFoodPhotoPath(A.id, path)).toBe(true);
    });

    it('keeps one member out of another\'s folder: no read, no signed link, no write, no overwrite, no delete', async () => {
      const path = foodPhotoPath(A.id, uuid());
      await upload(A, path);

      expect((await B.client.storage.from(BUCKET).download(path)).error).not.toBeNull();
      expect((await B.client.storage.from(BUCKET).createSignedUrl(path, 60)).error).not.toBeNull();
      expect((await upload(B, foodPhotoPath(A.id, uuid()))).error).not.toBeNull();
      expect((await upload(B, path, syntheticJpeg({ width: 100 }), 'image/jpeg', true)).error).not.toBeNull();
      await B.client.storage.from(BUCKET).remove([path]);
      expect(await exists(path)).toBe(true);
    });

    it('lets nobody who is signed out read or write', async () => {
      const path = foodPhotoPath(A.id, uuid());
      await upload(A, path);
      const anonymous = createTestClient(publishableKey);

      expect((await anonymous.storage.from(BUCKET).download(path)).error).not.toBeNull();
      expect((await anonymous.storage.from(BUCKET).upload(foodPhotoPath(A.id, uuid()), syntheticJpeg(), { contentType: 'image/jpeg' })).error).not.toBeNull();
    });

    it('does not let a member replace an object they already stored (no overwrite)', async () => {
      const path = foodPhotoPath(A.id, uuid());
      expect((await upload(A, path)).error).toBeNull();

      expect((await upload(A, path, syntheticJpeg({ width: 100 }), 'image/jpeg', true)).error).not.toBeNull();
    });

    it.each([
      ['a name that is not a request id', (id: string) => `${id}/not-a-request-id.jpg`],
      ['a check-in style name', (id: string) => `${id}/2026-10-20.jpg`],
      ['a nested folder', (id: string) => `${id}/sub/${uuid()}.jpg`],
      ['another extension', (id: string) => `${id}/${uuid()}.png`],
    ])('refuses %s', async (_name, build) => {
      expect((await upload(A, build(A.id))).error).not.toBeNull();
    });

    it('refuses a MIME type that is not JPEG and a file over the size limit', async () => {
      expect((await upload(A, foodPhotoPath(A.id, uuid()), syntheticJpeg(), 'text/plain')).error).not.toBeNull();
      expect((await upload(A, foodPhotoPath(A.id, uuid()), syntheticJpeg(), 'image/png')).error).not.toBeNull();
      const tooBig = new Uint8Array(FOOD_PHOTO_LIMITS.maxBytes + 1024);
      expect((await upload(A, foodPhotoPath(A.id, uuid()), tooBig)).error).not.toBeNull();
    });

    it('is a separate bucket from check-in photos, which this lifecycle never reads', async () => {
      const bucket = (await admin.storage.getBucket(BUCKET)).data!;
      expect(bucket).toMatchObject({ id: BUCKET, public: false });
      expect(bucket.allowed_mime_types).toEqual(['image/jpeg']);
      expect(isFoodPhotoPath(A.id, `${A.id}/2026-10-20.jpg`)).toBe(false);
    });
  });

  describe('admission', () => {
    it('is closed by default: the provider kill switch is off', async () => {
      const requestId = uuid();
      expect((await admin.from('app_config').select('value').eq('key', 'food_photo_enabled').single()).data!.value).toBe(false);

      expect(await reservePhotoRequest(admin, A.id, requestId, foodPhotoPath(A.id, requestId))).toMatchObject({ status: 'unavailable', reason: 'disabled' });
      expect(await rowOf(A, requestId)).toBeNull();
    });

    it('is for premium members only (the server capability), with a clear reason', async () => {
      await enabled(async () => {
        const requestId = uuid();
        expect(await reservePhotoRequest(admin, FREE.id, requestId, foodPhotoPath(FREE.id, requestId))).toMatchObject({ status: 'unavailable', reason: 'premium_required' });
      });
    });

    it('reserves once, answers in_progress to a repeat, and replays a completed result without a second start', async () => {
      await enabled(async () => {
        const requestId = uuid();
        const path = foodPhotoPath(A.id, requestId);

        expect(await reservePhotoRequest(admin, A.id, requestId, path)).toMatchObject({ status: 'reserved' });
        expect(await reservePhotoRequest(admin, A.id, requestId, path)).toMatchObject({ status: 'in_progress' });
        expect(await completePhotoRequest(admin, A.id, requestId, RESULT)).toMatchObject({ status: 'completed', result: RESULT });
        expect(await reservePhotoRequest(admin, A.id, requestId, path)).toMatchObject({ status: 'completed', result: RESULT });
        expect(await completePhotoRequest(admin, A.id, requestId, { candidates: [] })).toMatchObject({ status: 'completed', result: RESULT }); // the first result wins
      });
    });

    it('lets a known failure be retried under the same id, without counting a completed analysis', async () => {
      await enabled(async () => {
        await setConfig('food_photo_per_day', 1, async () => {
          const requestId = uuid();
          const path = foodPhotoPath(A.id, requestId);
          await reservePhotoRequest(admin, A.id, requestId, path);
          expect(await failPhotoRequest(admin, A.id, requestId)).toMatchObject({ status: 'failed' });

          const other = uuid();
          expect(await reservePhotoRequest(admin, A.id, other, foodPhotoPath(A.id, other))).toMatchObject({ status: 'reserved' }); // the failure did not use the allowance
          expect(await reservePhotoRequest(admin, A.id, requestId, path)).toMatchObject({ status: 'limited' }); // but the retry now needs a free slot
        });
      });
    });

    it('never regenerates an unknown outcome: a reserved request stays in_progress, and a failure cannot undo a completed one', async () => {
      await enabled(async () => {
        const requestId = uuid();
        const path = foodPhotoPath(A.id, requestId);
        await reservePhotoRequest(admin, A.id, requestId, path);
        await completePhotoRequest(admin, A.id, requestId, RESULT);

        expect(await failPhotoRequest(admin, A.id, requestId)).toMatchObject({ status: 'completed' });
        expect(await reservePhotoRequest(admin, A.id, requestId, path)).toMatchObject({ status: 'completed' });
      });
    });

    it('enforces the daily allowance, counting completed analyses and live reservations', async () => {
      await enabled(async () => {
        await setConfig('food_photo_per_day', 2, async () => {
          const make = () => {
            const id = uuid();
            return { id, path: foodPhotoPath(A.id, id) };
          };
          const [one, two, three] = [make(), make(), make()];

          expect(await reservePhotoRequest(admin, A.id, one.id, one.path)).toMatchObject({ status: 'reserved' });
          await completePhotoRequest(admin, A.id, one.id, RESULT);
          expect(await reservePhotoRequest(admin, A.id, two.id, two.path)).toMatchObject({ status: 'reserved' });
          expect(await reservePhotoRequest(admin, A.id, three.id, three.path)).toMatchObject({ status: 'limited', resetsAt: expect.any(String) });
        });
      });
    });

    it('cannot exceed the allowance when requests arrive at the same moment', async () => {
      await enabled(async () => {
        await setConfig('food_photo_per_day', 2, async () => {
          const attempts = Array.from({ length: 6 }, () => uuid());

          const results = await Promise.all(attempts.map((id) => reservePhotoRequest(admin, A.id, id, foodPhotoPath(A.id, id))));

          expect(results.filter((r) => r.status === 'reserved')).toHaveLength(2);
          expect(results.filter((r) => r.status === 'limited')).toHaveLength(4);
        });
      });
    });

    it('keeps one member\'s allowance and results separate from another\'s', async () => {
      await enabled(async () => {
        await setConfig('food_photo_per_day', 1, async () => {
          const a = uuid();
          const b = uuid();
          expect(await reservePhotoRequest(admin, A.id, a, foodPhotoPath(A.id, a))).toMatchObject({ status: 'reserved' });
          expect(await reservePhotoRequest(admin, B.id, b, foodPhotoPath(B.id, b))).toMatchObject({ status: 'reserved' });
          await completePhotoRequest(admin, A.id, a, RESULT);

          expect(await reservePhotoRequest(admin, B.id, a, foodPhotoPath(B.id, a))).toMatchObject({ status: 'limited' }); // same id, another member: a different request
          expect((await B.client.from('food_photo_requests').select('request_id')).data).toEqual([{ request_id: b }]);
        });
      });
    });

    it('fails closed on a missing or invalid configuration', async () => {
      await enabled(async () => {
        for (const bad of ['many', -1, 1.5, []]) {
          await setConfig('food_photo_per_day', bad, async () => {
            const id = uuid();
            expect(await reservePhotoRequest(admin, A.id, id, foodPhotoPath(A.id, id))).toMatchObject({ status: 'unavailable', reason: 'config' });
          });
        }
      });
    });

    it('rejects an image reference that is not this member\'s generated food-photo path', async () => {
      await enabled(async () => {
        const id = uuid();
        for (const path of [foodPhotoPath(B.id, id), `${A.id}/2026-10-20.jpg`, `${A.id}/${uuid()}.jpg`, `../${A.id}/${id}.jpg`, `${A.id}/${id}.jpg/extra`]) {
          await expect(reservePhotoRequest(admin, A.id, id, path)).rejects.toThrow();
        }
        expect(await rowOf(A, id)).toBeNull();
      });
    });

    it('stores a bounded result only', async () => {
      await enabled(async () => {
        const id = uuid();
        await reservePhotoRequest(admin, A.id, id, foodPhotoPath(A.id, id));

        await expect(completePhotoRequest(admin, A.id, id, { candidates: [{ name: 'x'.repeat(40000) }] })).rejects.toThrow();
        expect((await rowOf(A, id))!.status).toBe('reserved');
      });
    });

    it('is not callable, readable or writable by a member directly', async () => {
      await enabled(async () => {
        const id = uuid();
        await reservePhotoRequest(admin, A.id, id, foodPhotoPath(A.id, id));

        expect((await A.client.rpc('food_photo_reserve', { p_user_id: A.id, p_request_id: uuid(), p_image_path: foodPhotoPath(A.id, id) })).error).not.toBeNull();
        expect((await A.client.from('food_photo_requests').insert({ user_id: A.id, request_id: uuid(), image_path: foodPhotoPath(A.id, id), status: 'completed', quota_day: '2026-10-20', lease_until: new Date().toISOString() })).error).not.toBeNull();
        expect((await A.client.from('food_photo_requests').update({ status: 'failed' }).eq('request_id', id)).data ?? []).toEqual([]);
        expect((await rowOf(A, id))!.status).toBe('reserved');
        expect((await A.client.from('food_photo_requests').select('request_id')).data).toEqual([{ request_id: id }]);
      });
    });
  });

  describe('cleanup', () => {
    it('deletes the image as soon as a request completes or fails, and records it', async () => {
      await enabled(async () => {
        const [done, failed] = [uuid(), uuid()];
        for (const id of [done, failed]) {
          await upload(A, foodPhotoPath(A.id, id));
          await reservePhotoRequest(admin, A.id, id, foodPhotoPath(A.id, id));
        }
        await completePhotoRequest(admin, A.id, done, RESULT);
        await failPhotoRequest(admin, A.id, failed);

        const outcome = await runPhotoCleanup(admin, { retentionHours: 24 });

        expect(outcome.deleted).toBe(2);
        expect(await exists(foodPhotoPath(A.id, done))).toBe(false);
        expect(await exists(foodPhotoPath(A.id, failed))).toBe(false);
        expect((await rowOf(A, done))!.image_deleted_at).not.toBeNull();
      });
    });

    it('keeps an image for a request that is still in progress, inside the retention period', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, foodPhotoPath(A.id, id));
        await reservePhotoRequest(admin, A.id, id, foodPhotoPath(A.id, id));

        const outcome = await runPhotoCleanup(admin, { retentionHours: 24 });

        expect(outcome.deleted).toBe(0);
        expect(await exists(foodPhotoPath(A.id, id))).toBe(true);
      });
    });

    it('removes an abandoned upload with no request at all once it is older than the retention period', async () => {
      const id = uuid();
      await upload(A, foodPhotoPath(A.id, id));
      expect((await runPhotoCleanup(admin, { retentionHours: 24 })).deleted).toBe(0);

      const outcome = await runPhotoCleanup(admin, { retentionHours: 0 });

      expect(outcome.deleted).toBeGreaterThanOrEqual(1);
      expect(await exists(foodPhotoPath(A.id, id))).toBe(false);
    });

    it('removes an in-progress request\'s image after the retention period too, and does not touch other buckets', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, foodPhotoPath(A.id, id));
        await reservePhotoRequest(admin, A.id, id, foodPhotoPath(A.id, id));
        await admin.storage.from('checkin-photos').upload(`${A.id}/cleanup-canary.jpg`, syntheticJpeg(), { contentType: 'image/jpeg', upsert: true });

        await runPhotoCleanup(admin, { retentionHours: 0 });

        expect(await exists(foodPhotoPath(A.id, id))).toBe(false);
        expect((await admin.storage.from('checkin-photos').download(`${A.id}/cleanup-canary.jpg`)).error).toBeNull();
        await admin.storage.from('checkin-photos').remove([`${A.id}/cleanup-canary.jpg`]);
      });
    });

    it('can be repeated safely, and deletePhotoImage on a missing object is not an error', async () => {
      const id = uuid();
      await expect(deletePhotoImage(admin, foodPhotoPath(A.id, id))).resolves.toBeUndefined();
      await runPhotoCleanup(admin, { retentionHours: 24 });
      await expect(runPhotoCleanup(admin, { retentionHours: 24 })).resolves.toMatchObject({ deleted: 0 });
    });

    it('is served over HTTP only to the scheduled job: no secret, no cleanup', async () => {
      expect((await callFunction('food-photo-cleanup', undefined, {})).status).toBe(401);
      expect((await callFunction('food-photo-cleanup', A.jwt, {})).status).toBe(401);
      expect((await callFunction('food-photo-cleanup', 'not-the-secret', {})).status).toBe(401);
    });
  });

  describe('account deletion', () => {
    it('removes the ledger rows and every queued image, and does not block the deletion', async () => {
      await enabled(async () => {
        const temp = await createTestUser(admin, 'fp-temp');
        await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', temp.id);
        const id = uuid();
        expect((await upload(temp, foodPhotoPath(temp.id, id))).error).toBeNull();
        await reservePhotoRequest(admin, temp.id, id, foodPhotoPath(temp.id, id));

        const result = await callFunction('delete-account', temp.jwt, {});

        expect(result.status).toBe(200);
        expect((await admin.from('food_photo_requests').select('request_id').eq('user_id', temp.id)).data).toEqual([]);
        expect(await exists(foodPhotoPath(temp.id, id))).toBe(false);
        const { data } = await admin.storage.from(BUCKET).list(temp.id, { limit: 10 });
        expect(data ?? []).toEqual([]);
      });
    });
  });
});
