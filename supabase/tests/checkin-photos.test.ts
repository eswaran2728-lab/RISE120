import { callFunction, createAdmin, createTestClient, createTestUser, nodeFetch, publishableKey, supabaseUrl, TestUser } from './helpers';

jest.setTimeout(120000);

const BUCKET = 'checkin-photos';
// A valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('check-in photo storage and rules (live)', () => {
  const admin = createAdmin();
  let a: TestUser;
  let b: TestUser;
  const pathFor = (user: TestUser, date = '2026-10-13') => `${user.id}/${date}.jpg`;
  const upload = (user: TestUser, path: string, contentType = 'image/jpeg') =>
    user.client.storage.from(BUCKET).upload(path, PNG, { contentType, upsert: true });

  beforeAll(async () => {
    a = await createTestUser(admin, 'photo-a');
    b = await createTestUser(admin, 'photo-b');
  });

  afterAll(async () => {
    for (const user of [a, b]) {
      if (!user) continue;
      await admin.storage.from(BUCKET).remove([pathFor(user), pathFor(user, '2026-10-14')]);
      await admin.auth.admin.deleteUser(user.id);
    }
  });

  it('has a private bucket', async () => {
    const { data, error } = await admin.storage.getBucket(BUCKET);

    expect(error).toBeNull();
    expect(data?.public).toBe(false);
  });

  it('lets a user store and read a photo in their own folder', async () => {
    const { error } = await upload(a, pathFor(a));
    expect(error).toBeNull();

    const download = await a.client.storage.from(BUCKET).download(pathFor(a));
    expect(download.error).toBeNull();
  });

  it('rejects uploads into another users folder', async () => {
    const { error } = await upload(b, pathFor(a, '2026-10-14'));

    expect(error).not.toBeNull();
  });

  it('rejects files that are not images', async () => {
    const { error } = await upload(a, `${a.id}/notes.txt`, 'text/plain');

    expect(error).not.toBeNull();
  });

  it('hides one users photos from another user', async () => {
    const download = await b.client.storage.from(BUCKET).download(pathFor(a));
    expect(download.error).not.toBeNull();

    const listing = await b.client.storage.from(BUCKET).list(a.id);
    expect(listing.data ?? []).toEqual([]);

    await b.client.storage.from(BUCKET).remove([pathFor(a)]);
    // B's delete had no effect: the owner can still read the photo.
    const stillThere = await a.client.storage.from(BUCKET).download(pathFor(a));
    expect(stillThere.error).toBeNull();
  });

  it('does not serve photos to anonymous or public requests', async () => {
    const anon = createTestClient(publishableKey);
    expect((await anon.storage.from(BUCKET).download(pathFor(a))).error).not.toBeNull();

    const publicResponse = await nodeFetch(`${supabaseUrl}/storage/v1/object/public/${BUCKET}/${pathFor(a)}`, {
      headers: { apikey: publishableKey },
    });
    expect(publicResponse.status).not.toBe(200);
  });

  it('gives the owner a working signed URL', async () => {
    const { data, error } = await a.client.storage.from(BUCKET).createSignedUrl(pathFor(a), 60);
    expect(error).toBeNull();

    const response = await nodeFetch(data!.signedUrl);
    expect(response.status).toBe(200);
  });

  it('refuses another user a signed URL for the photo', async () => {
    const { data } = await b.client.storage.from(BUCKET).createSignedUrl(pathFor(a), 60);

    expect(data?.signedUrl ?? null).toBeNull();
  });

  it('keeps mood within 1 to 5', async () => {
    await admin.from('checkins').insert({ user_id: a.id, checkin_date: '2026-10-13', weight_kg: 70, mood: 3, sleep_hours: 7 });

    const bad = await a.client.from('checkins').update({ mood: 9 }).eq('user_id', a.id).select();
    expect(bad.error).not.toBeNull();
    const ok = await a.client.from('checkins').update({ mood: 5 }).eq('user_id', a.id).select();
    expect(ok.error).toBeNull();
  });

  it('removes only the deleted users photos when the account is deleted', async () => {
    expect((await upload(b, pathFor(b))).error).toBeNull();

    const { status } = await callFunction('delete-account', a.jwt);

    expect(status).toBe(200);
    expect((await admin.storage.from(BUCKET).list(a.id)).data ?? []).toEqual([]);
    expect(((await admin.storage.from(BUCKET).list(b.id)).data ?? []).length).toBe(1);
  });
});
