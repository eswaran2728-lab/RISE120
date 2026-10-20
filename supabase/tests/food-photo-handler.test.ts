import { createAdmin, createTestUser, TestUser } from './helpers';
import { handleFoodPhotoRequest } from '../functions/_shared/food/photo/handler';
import { createFoodPhotoDeps } from '../functions/_shared/food/photo/deps';
import { PhotoGuess, PhotoProvider, PhotoProviderError } from '../functions/_shared/food/photo/provider';
import { foodPhotoPath } from '../functions/_shared/food/photo/lifecycle';
import { syntheticJpeg } from './food-photo-fixtures';

jest.setTimeout(300000);

const BUCKET = 'food-photos';
const uuid = () => crypto.randomUUID();
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'Fixture Reviewer', role: 'Fixture role', reviewedOn: '2000-01-01' };
const provenance = { name: 'Fixture source', url: null, recordId: null, version: '1', accessedOn: '2000-01-02', licenceEvidence: 'Fixture evidence' };
const nutrition = (calories: number | null = 400) => ({ perServing: { calories, proteinG: 12, carbsG: 50, fatG: 10, fibreG: null, sugarG: null, sodiumMg: null }, provenance });

// Roadmap F2 Task 2: the analysis function over an injected FAKE provider. SYNTHETIC images, foods and recipes only. These
// tests do not show that any real model can recognise food; they show the contract around one: bounded references to
// existing sourced records, replay, admission, failure handling and no food log.
describe('analyse-food-photo handler (live ledger, storage and catalogue; fake provider)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  const source = `fp-${suffix}`;
  const users: TestUser[] = [];
  let A: TestUser, B: TestUser;
  const food = { shared: '', usda: '', unverifiedShared: '', ownPrivate: '', othersPrivate: '', openFoodFacts: '' };
  const recipeId = `fprcp-${suffix}-ok`;
  const recipeUnknownId = `fprcp-${suffix}-unknown`;
  const draftId = `fprcp-${suffix}-draft`;
  const privateRecipeId = `fprcp-${suffix}-private`;

  const foodRow = (over: Record<string, unknown>) => ({ name: 'Fixture food', serving_desc: '1 serving', calories: 200, protein_g: 5, carbs_g: 30, fat_g: 4, source, verified: false, ...over });
  const recipeRow = (id: string, over: Record<string, unknown> = {}) => ({
    id, version: 1, status: 'published', verified: true, reviewer, region: 'MY', name: L(`Recipe ${id}`), servings: 2,
    ingredients: [{ ref: { source, sourceId: 'rice' }, name: 'rice', amount: 200, unit: 'g', tags: [] }],
    preparation: [L('Cook.')], prep_minutes: 5, cook_minutes: 10, cooking: ['stovetop'], nutrition: nutrition(), price: null, ...over,
  });

  beforeAll(async () => {
    A = await createTestUser(admin, 'fph-a');
    B = await createTestUser(admin, 'fph-b');
    users.push(A, B);
    for (const user of users) expect((await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id)).error).toBeNull();
    const inserted = await admin
      .from('foods')
      .insert([
        foodRow({ name: 'Fixture curated rice', source: 'curated', source_id: `${source}-rice-curated`, verified: true }),
        foodRow({ name: 'Fixture usda egg', source: 'usda', source_id: `${source}-egg`, verified: false }),
        foodRow({ name: 'Fixture shared but unsourced', source: 'custom', source_id: null, verified: false }),
        foodRow({ name: 'Fixture own private', user_id: A.id, source: 'custom', source_id: `${source}-mine` }),
        foodRow({ name: 'Fixture other private', user_id: B.id, source: 'custom', source_id: `${source}-theirs` }),
        foodRow({ name: 'Fixture off product', source: 'openfoodfacts', source_id: `${source}-off`, verified: false }),
        foodRow({ name: 'rice', source, source_id: 'rice', verified: true }),
      ])
      .select('id, source_id');
    expect(inserted.error).toBeNull();
    const idOf = (sid: string) => inserted.data!.find((r) => r.source_id === sid)!.id as string;
    Object.assign(food, {
      shared: idOf(`${source}-rice-curated`), usda: idOf(`${source}-egg`), unverifiedShared: inserted.data!.find((r) => r.source_id === null)?.id ?? '',
      ownPrivate: idOf(`${source}-mine`), othersPrivate: idOf(`${source}-theirs`), openFoodFacts: idOf(`${source}-off`),
    });
    expect(
      (
        await admin.from('recipes').insert([
          recipeRow(recipeId),
          recipeRow(recipeUnknownId, { nutrition: nutrition(null) }),
          recipeRow(draftId, { status: 'draft', verified: false, reviewer: null, nutrition: null }),
        ])
      ).error
    ).toBeNull();
    expect((await admin.from('recipes').insert({ ...recipeRow(privateRecipeId, { status: 'private', verified: false, reviewer: null, user_id: A.id }) })).error).toBeNull();
  });
  afterAll(async () => {
    await clean();
    await admin.from('recipes').delete().like('id', `fprcp-${suffix}-%`);
    await admin.from('foods').delete().eq('source', source).neq('id', '00000000-0000-0000-0000-000000000000');
    await admin.from('foods').delete().like('source_id', `${source}-%`);
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });
  async function clean() {
    for (const user of users) {
      const { data } = await admin.storage.from(BUCKET).list(user.id, { limit: 1000 });
      if (data?.length) await admin.storage.from(BUCKET).remove(data.map((f) => `${user.id}/${f.name}`));
    }
    await admin.from('food_photo_requests').delete().in('user_id', users.map((u) => u.id));
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
  // Listing, not downloading: a downloaded object can still be served from the CDN cache for a while after it is deleted.
  const exists = async (path: string) => {
    const [folder, name] = path.split('/');
    const { data } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
    return (data ?? []).some((f) => f.name === name);
  };
  const upload = async (user: TestUser, requestId: string, bytes: Uint8Array = syntheticJpeg()) => {
    expect((await user.client.storage.from(BUCKET).upload(foodPhotoPath(user.id, requestId), bytes, { contentType: 'image/jpeg' })).error).toBeNull();
  };
  const logsOf = async (user: TestUser) => (await admin.from('food_logs').select('id').eq('user_id', user.id)).data!.length;
  const ledger = async (user: TestUser, requestId: string) => (await admin.from('food_photo_requests').select('status, result').eq('user_id', user.id).eq('request_id', requestId).maybeSingle()).data;

  const provider = (guesses: PhotoGuess[] | ((image: Uint8Array) => Promise<PhotoGuess[]>)): PhotoProvider & { calls: number; seen: Uint8Array[] } => {
    const p = {
      calls: 0,
      seen: [] as Uint8Array[],
      async identify(image: Uint8Array) {
        p.calls += 1;
        p.seen.push(image);
        return typeof guesses === 'function' ? guesses(image) : guesses;
      },
    };
    return p;
  };
  const run = (user: TestUser, requestId: string, fake: PhotoProvider | null, over: { body?: unknown; timeoutMs?: number } = {}) =>
    handleFoodPhotoRequest({ userId: user.id, body: 'body' in over ? over.body : { requestId, privateImageRef: foodPhotoPath(user.id, requestId) } }, createFoodPhotoDeps(admin, fake, { providerTimeoutMs: over.timeoutMs }));
  const guess = (kind: 'food' | 'recipe', id: string, extra: Partial<PhotoGuess> = {}): PhotoGuess => ({ kind, id, ...extra });

  describe('the request', () => {
    it.each([
      ['no body', null],
      ['a list', []],
      ['a bad request id', { requestId: 'x', privateImageRef: 'x' }],
      ['no image reference', { requestId: '4a2b8c1e-1111-4222-8333-444455556667' }],
      ['an image reference that is not a string', { requestId: '4a2b8c1e-1111-4222-8333-444455556667', privateImageRef: 5 }],
    ])('rejects %s before anything else happens', async (_name, body) => {
      const fake = provider([]);
      const result = await run(A, uuid(), fake, { body });

      expect(result.status).toBe(400);
      expect(fake.calls).toBe(0);
    });

    it('refuses an image reference that is another member\'s, a check-in photo path, or not this request\'s', async () => {
      await enabled(async () => {
        const id = uuid();
        const fake = provider([]);
        for (const ref of [foodPhotoPath(B.id, id), `${A.id}/2026-10-20.jpg`, foodPhotoPath(A.id, uuid()), `${A.id}/${id}.jpg/../x.jpg`]) {
          expect((await run(A, id, fake, { body: { requestId: id, privateImageRef: ref } })).status).toBe(400);
        }
        expect(fake.calls).toBe(0);
        expect(await ledger(A, id)).toBeNull();
      });
    });

    it('accepts no nutrition from the client: extra fields are ignored and never stored', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        const fake = provider([guess('food', food.shared)]);

        const result = await run(A, id, fake, { body: { requestId: id, privateImageRef: foodPhotoPath(A.id, id), calories: 9999, candidates: [{ id: 'forged' }] } });

        expect(result.status).toBe(200);
        expect(JSON.stringify(result.body)).not.toContain('9999');
        expect(JSON.stringify(result.body)).not.toContain('forged');
      });
    });
  });

  describe('candidates', () => {
    it('returns only references to existing eligible records, named from the catalogue, with provenance and no nutrition', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        const fake = provider([
          guess('food', food.shared, { confidence: 'high', servings: 1.5 }),
          guess('food', food.usda, { confidence: 'medium' }),
          guess('recipe', recipeId, { confidence: 'low', servings: 2 }),
          guess('food', uuid(), { confidence: 'high' }), // unknown record
          guess('recipe', `fprcp-${suffix}-invented`, { confidence: 'high' }), // fabricated recipe reference
          guess('recipe', draftId), // not published
          guess('recipe', privateRecipeId), // a private recipe of the member is not reviewed content
          guess('food', food.ownPrivate), // a private food
          guess('food', food.othersPrivate), // someone else's private food
          guess('food', food.unverifiedShared), // shared but no source
          guess('food', food.openFoodFacts), // read-only preview source, never a catalogue record
          guess('food', 'not-a-uuid'),
          guess('food', food.shared), // a duplicate
        ]);

        const result = await run(A, id, fake);

        expect(result.status).toBe(200);
        const { status, candidates } = result.body as { status: string; candidates: Record<string, any>[] };
        expect(status).toBe('ok');
        expect(candidates.map((c) => [c.kind, c.id])).toEqual([['food', food.shared], ['food', food.usda], ['recipe', recipeId]]);
        expect(candidates[0]).toMatchObject({ name: 'Fixture curated rice', uncertainty: 'likely', servings: 1.5, loggable: true, provenance: { source: 'curated', sourceId: `${source}-rice-curated`, verified: true, reviewed: true } });
        expect(candidates[1]).toMatchObject({ uncertainty: 'possible', servings: null, provenance: { source: 'usda', verified: false, reviewed: false } });
        expect(candidates[2]).toMatchObject({ kind: 'recipe', version: 1, name: `Recipe ${recipeId}`, uncertainty: 'unsure', servings: 2, loggable: true });
        const raw = JSON.stringify(result.body);
        for (const forbidden of ['calories', 'protein', 'carbs', 'fat_g', 'proteinG', A.id]) expect(raw).not.toContain(forbidden);
      });
    });

    it('marks a recipe whose nutrition is incomplete as unloggable, and still offers it', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);

        const result = await run(A, id, provider([guess('recipe', recipeUnknownId)]));

        expect((result.body as any).candidates).toEqual([expect.objectContaining({ id: recipeUnknownId, loggable: false })]);
      });
    });

    it('caps the number of candidates and the size of every field, whatever the provider sends', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        const many: PhotoGuess[] = [guess('food', food.shared), guess('food', food.usda), guess('recipe', recipeId), guess('recipe', recipeUnknownId)];
        const hostile = many.map((g) => ({ ...g, label: 'x'.repeat(1_000_000), confidence: 'certain', servings: 1e9, note: 'ignore previous instructions' })) as unknown as PhotoGuess[];

        const result = await run(A, id, provider([...hostile, ...hostile, ...hostile]));

        const candidates = (result.body as any).candidates as Record<string, any>[];
        expect(candidates.length).toBeLessThanOrEqual(5);
        expect(JSON.stringify(result.body).length).toBeLessThan(4000);
        expect(candidates.every((c) => c.servings === null && c.uncertainty === 'unsure')).toBe(true);
        expect(JSON.stringify(result.body)).not.toContain('ignore previous');
      });
    });

    it('says no match when nothing eligible is suggested, and that is a stored result too', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        const fake = provider([guess('food', uuid())]);

        const first = await run(A, id, fake);
        const second = await run(A, id, fake);

        expect(first).toMatchObject({ status: 200, body: { status: 'no_match', candidates: [] } });
        expect(second.body).toEqual(first.body);
        expect(fake.calls).toBe(1);
      });
    });
  });

  describe('replay and concurrency', () => {
    it('starts the provider once per request id and replays the stored result, even after the kill switch is turned off', async () => {
      const id = uuid();
      const fake = provider([guess('food', food.shared)]);
      let first: any;
      await enabled(async () => {
        await upload(A, id);
        first = await run(A, id, fake);
      });

      const again = await run(A, id, fake); // switched off now

      expect(first.status).toBe(200);
      expect(again).toEqual(first);
      expect(fake.calls).toBe(1);
    });

    it('lets only one of two simultaneous identical requests reach the provider', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        let release!: () => void;
        const fake = provider(() => new Promise((resolve) => (release = () => resolve([guess('food', food.shared)]))));

        const first = run(A, id, fake);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const second = await run(A, id, fake);
        release();

        expect(second.status).toBe(409);
        expect((second.body as any).status).toBe('in_progress');
        expect((await first).status).toBe(200);
        expect(fake.calls).toBe(1);
      });
    });

    it('keeps one member\'s result away from another member who sends the same request id', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        await upload(B, id);
        await run(A, id, provider([guess('food', food.shared)]));
        const fakeB = provider([guess('food', food.usda)]);

        const forB = await run(B, id, fakeB);

        expect((forB.body as any).candidates.map((c: any) => c.id)).toEqual([food.usda]);
        expect(fakeB.calls).toBe(1);
      });
    });
  });

  describe('provider failures', () => {
    it('treats a timeout as an unknown outcome: it stays unresolved, is never started again, and a late answer is ignored', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        let late!: (guesses: PhotoGuess[]) => void;
        const fake = provider(() => new Promise((resolve) => (late = resolve)));

        const result = await run(A, id, fake, { timeoutMs: 50 });
        expect(result.status).toBe(504);
        expect(result.body).toMatchObject({ status: 'unknown' });
        late([guess('food', food.shared)]); // the provider answers after we gave up
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect((await ledger(A, id))!.status).toBe('reserved');
        const retry = await run(A, id, fake);
        expect(retry.status).toBe(409);
        expect(fake.calls).toBe(1);
        expect(await exists(foodPhotoPath(A.id, id))).toBe(true); // kept until the retention period
      });
    });

    it('stops at one deadline for the whole provider call, not only for its first byte', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        const stalled: PhotoProvider = { identify: () => new Promise(() => undefined) };

        const started = Date.now();
        const result = await run(A, id, stalled, { timeoutMs: 100 });

        expect(result.status).toBe(504);
        expect(Date.now() - started).toBeLessThan(5000);
      });
    });

    it('records a known failure, deletes the image at once, and lets the same request id try again', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        const failing: PhotoProvider & { calls: number } = { calls: 0, identify: async () => { failing.calls += 1; throw new PhotoProviderError('unavailable', false, 'provider_http_429'); } };

        const failed = await run(A, id, failing);

        expect(failed).toMatchObject({ status: 502, body: { status: 'failed' } });
        expect((await ledger(A, id))!.status).toBe('failed');
        expect(await exists(foodPhotoPath(A.id, id))).toBe(false);

        await upload(A, id); // the app uploads again for a retry
        const retry = await run(A, id, provider([guess('food', food.shared)]));
        expect(retry.status).toBe(200);
      });
    });

    it('treats an error that may have been processed as unknown, not as a failure', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        const flaky: PhotoProvider = { identify: async () => { throw new PhotoProviderError('unavailable', true, 'provider_http_503'); } };

        const result = await run(A, id, flaky);

        expect(result.status).toBe(504);
        expect((await ledger(A, id))!.status).toBe('reserved');
      });
    });

    it('treats an unexpected error from the provider as unknown, and never puts its text in the answer', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        const odd: PhotoProvider = { identify: async () => { throw new Error('secret-key-123 knee pain photo'); } };

        const result = await run(A, id, odd);

        expect(result.status).toBe(504);
        expect(JSON.stringify(result.body)).not.toContain('secret-key-123');
      });
    });
  });

  describe('the image', () => {
    it.each([
      ['EXIF metadata', syntheticJpeg({ exif: true }), 'metadata'],
      ['something that is not a JPEG', new TextEncoder().encode('not an image'), 'not_jpeg'],
      ['a truncated file', syntheticJpeg({ noEoi: true }), 'malformed'],
      ['dimensions beyond the bound', syntheticJpeg({ width: 5000, height: 5000 }), 'dimensions'],
      ['bytes after the end of the picture', syntheticJpeg({ trailing: 40 }), 'malformed'],
      ['an application segment that is not what it claims', syntheticJpeg({ app2Text: 'hidden note' }), 'metadata'],
    ])('never shows %s to the provider: refused, recorded as a known failure, image deleted', async (_name, bytes, reason) => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id, bytes as Uint8Array).catch(() => undefined);
        // The bucket may already refuse some bytes by MIME or size; write the object directly when it accepted none.
        if (!(await exists(foodPhotoPath(A.id, id)))) await admin.storage.from(BUCKET).upload(foodPhotoPath(A.id, id), bytes as Uint8Array, { contentType: 'image/jpeg' });
        const fake = provider([guess('food', food.shared)]);

        const result = await run(A, id, fake);

        expect(result).toMatchObject({ status: 422, body: { status: 'invalid_image', reason } });
        expect(fake.calls).toBe(0);
        expect((await ledger(A, id))!.status).toBe('failed');
        expect(await exists(foodPhotoPath(A.id, id))).toBe(false);
      });
    });

    it('answers missing_image, as a known failure, when nothing was uploaded', async () => {
      await enabled(async () => {
        const id = uuid();
        const fake = provider([]);

        const result = await run(A, id, fake);

        expect(result).toMatchObject({ status: 422, body: { status: 'invalid_image', reason: 'missing' } });
        expect(fake.calls).toBe(0);
        expect((await ledger(A, id))!.status).toBe('failed');
      });
    });

    it('gives the provider the validated bytes, and deletes the image as soon as a result is stored', async () => {
      await enabled(async () => {
        const id = uuid();
        const bytes = syntheticJpeg({ width: 800, height: 600 });
        await upload(A, id, bytes);
        const fake = provider([guess('food', food.shared)]);

        await run(A, id, fake);

        expect([...fake.seen[0]]).toEqual([...bytes]);
        expect(await exists(foodPhotoPath(A.id, id))).toBe(false);
        expect((await ledger(A, id))!.status).toBe('completed');
      });
    });
  });

  describe('a transient Storage read error before the provider starts', () => {
    const flaky = (provider: PhotoProvider, failures: number) => {
      const base = createFoodPhotoDeps(admin, provider);
      let left = failures;
      return { ...base, readImage: async (path: string) => { if (left-- > 0) throw new Error('storage unavailable'); return base.readImage(path); } };
    };
    const send = (user: TestUser, id: string, deps: ReturnType<typeof createFoodPhotoDeps>) =>
      handleFoodPhotoRequest({ userId: user.id, body: { requestId: id, privateImageRef: foodPhotoPath(user.id, id) } }, deps);

    it('releases the request as retryable: no provider start, no kept charge, and the image stays for the retry', async () => {
      await enabled(async () => {
        await setConfig('food_photo_per_day', 1, async () => {
          const id = uuid();
          await upload(A, id);
          const fake = provider([guess('food', food.shared)]);
          const deps = flaky(fake, 1);

          const first = await send(A, id, deps);

          expect(first).toMatchObject({ status: 503, body: { status: 'temporary' } });
          expect(fake.calls).toBe(0);
          expect((await ledger(A, id))!.status).toBe('failed');
          expect(await exists(foodPhotoPath(A.id, id))).toBe(true);
          // The release counts nothing against the allowance: a different request is still admitted.
          const other = uuid();
          await upload(A, other);
          const otherFake = provider([]);
          expect((await send(A, other, createFoodPhotoDeps(admin, otherFake))).status).toBe(200);
        });
      });
    });

    it('succeeds on the same request id when the retry comes, with exactly one provider start and one completed analysis', async () => {
      await enabled(async () => {
        await setConfig('food_photo_per_day', 1, async () => {
          const id = uuid();
          await upload(A, id);
          const fake = provider([guess('food', food.shared)]);
          const deps = flaky(fake, 2);

          expect((await send(A, id, deps)).status).toBe(503);
          expect((await send(A, id, deps)).status).toBe(503);
          const retry = await send(A, id, deps);
          const again = await send(A, id, deps); // a repeat after success replays

          expect(retry.status).toBe(200);
          expect(again).toEqual(retry);
          expect(fake.calls).toBe(1);
          expect((await admin.from('food_photo_requests').select('status').eq('user_id', A.id).eq('status', 'completed')).data).toHaveLength(1);
          expect(await exists(foodPhotoPath(A.id, id))).toBe(false); // deleted once the result was stored
        });
      });
    });

    it('does not let two simultaneous retries both start the provider', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);
        const fake = provider([guess('food', food.shared)]);
        const deps = flaky(fake, 1);
        await send(A, id, deps);

        const results = await Promise.all([send(A, id, deps), send(A, id, deps)]);

        expect(fake.calls).toBe(1);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      });
    });

    it('does not turn a storage error into a missing image: that would delete the image and refuse the retry', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);

        const result = await send(A, id, flaky(provider([]), 1));

        expect(result.status).toBe(503);
        expect(result.body).not.toMatchObject({ status: 'invalid_image' });
      });
    });

    it('still answers missing, once, when cleanup has really removed the image, and then the same id can be retried after a new upload', async () => {
      await enabled(async () => {
        const id = uuid();
        const fake = provider([guess('food', food.shared)]);

        const missing = await send(A, id, createFoodPhotoDeps(admin, fake)); // nothing in storage
        expect(missing).toMatchObject({ status: 422, body: { status: 'invalid_image', reason: 'missing' } });
        expect(fake.calls).toBe(0);

        await upload(A, id);
        expect((await send(A, id, createFoodPhotoDeps(admin, fake))).status).toBe(200);
        expect(fake.calls).toBe(1);
      });
    });
  });

  describe('admission, quota and the kill switch', () => {
    it('is unavailable while the kill switch is off (the default), without starting anything', async () => {
      const id = uuid();
      await upload(A, id);
      const fake = provider([guess('food', food.shared)]);

      const result = await run(A, id, fake);

      expect(result).toMatchObject({ status: 503, body: { status: 'unavailable', reason: 'disabled' } });
      expect(fake.calls).toBe(0);
      expect(await ledger(A, id)).toBeNull();
    });

    it('says premium is required for a free member', async () => {
      await enabled(async () => {
        const free = await createTestUser(admin, 'fph-free');
        users.push(free);
        const id = uuid();
        await upload(free, id);

        const result = await run(free, id, provider([]));

        expect(result).toMatchObject({ status: 503, body: { status: 'unavailable', reason: 'premium_required' } });
      });
    });

    it('releases the reservation and says the provider is unavailable when none is configured', async () => {
      await enabled(async () => {
        const id = uuid();
        await upload(A, id);

        const result = await run(A, id, null);

        expect(result).toMatchObject({ status: 503, body: { status: 'unavailable', reason: 'provider' } });
        expect((await ledger(A, id))!.status).toBe('failed');
      });
    });

    it('limits the daily allowance with a retry time, without calling the provider', async () => {
      await enabled(async () => {
        await setConfig('food_photo_per_day', 1, async () => {
          const [one, two] = [uuid(), uuid()];
          await upload(A, one);
          await upload(A, two);
          const fake = provider([guess('food', food.shared)]);

          expect((await run(A, one, fake)).status).toBe(200);
          const limited = await run(A, two, fake);

          expect(limited).toMatchObject({ status: 429, body: { status: 'limited', retryAt: expect.any(String) } });
          expect(fake.calls).toBe(1);
        });
      });
    });
  });

  describe('what it never does', () => {
    it('writes no food log in any outcome', async () => {
      const before = await logsOf(A);
      await enabled(async () => {
        for (const behaviour of [
          provider([guess('food', food.shared)]),
          provider([]),
          { identify: async () => { throw new PhotoProviderError('unavailable', false, 'x'); } } as PhotoProvider,
        ]) {
          const id = uuid();
          await upload(A, id);
          await run(A, id, behaviour);
        }
      });
      expect(await logsOf(A)).toBe(before);
    });
  });
});
