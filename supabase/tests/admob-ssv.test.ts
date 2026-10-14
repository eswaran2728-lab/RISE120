import { createHash, generateKeyPairSync, sign as nodeSign, KeyObject } from 'crypto';
import { verifyRewardCallback, KeyLookup } from '../functions/_shared/ads/ssv';
import { createKeyProvider, KEYS_URL } from '../functions/_shared/ads/keys';
import { handleAdRewardCallback, CallbackDeps } from '../functions/_shared/ads/handler';

// Signed fixtures: a throwaway P-256 key pair made inside the test stands in for Google's. No real key is used.
const makeKey = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
};
const GOOGLE = makeKey();
const OTHER = makeKey();

const sign = (content: string, key: KeyObject = GOOGLE.privateKey) =>
  nodeSign('sha256', Buffer.from(content), { key, dsaEncoding: 'der' }).toString('base64url');

const TOKEN = 'tok_ABC-123_xyz';
const AD_UNIT = '1234567890';
const base = (over: Record<string, string> = {}) =>
  new URLSearchParams({
    ad_network: '5450213213286189855',
    ad_unit: AD_UNIT,
    custom_data: TOKEN,
    reward_amount: '1',
    reward_item: 'reward',
    timestamp: '1791979199000',
    transaction_id: 'ABCDEF0123456789ABCDEF0123456789',
    user_id: 'ignored-by-server',
    ...over,
  }).toString();
// Exactly the shape Google sends: signed content, then &signature=, then &key_id= last.
const signed = (content = base(), keyId = '3335741209', key: KeyObject = GOOGLE.privateKey) => `${content}&signature=${sign(content, key)}&key_id=${keyId}`;

const keys: KeyLookup = { get: async (id) => (id === '3335741209' ? GOOGLE.spki : null) };

describe('verifyRewardCallback', () => {
  it('accepts an untouched signed callback and returns its decoded parameters', async () => {
    const result = await verifyRewardCallback(`?${signed(base({ custom_data: 'a b+c/d' }))}`, keys);

    expect(result).toMatchObject({ ok: true, params: { ad_unit: AD_UNIT, custom_data: 'a b+c/d', transaction_id: 'ABCDEF0123456789ABCDEF0123456789' } });
  });

  it('accepts the same callback without a leading question mark', async () => {
    expect((await verifyRewardCallback(signed(), keys)).ok).toBe(true);
  });

  it.each([
    ['a changed reward amount', (q: string) => q.replace('reward_amount=1', 'reward_amount=100')],
    ['a changed token', (q: string) => q.replace(TOKEN, 'tok_OTHER')],
    ['a changed transaction id', (q: string) => q.replace('ABCDEF', 'FEDCBA')],
    ['reordered parameters', (q: string) => q.replace('ad_network=5450213213286189855&ad_unit=1234567890', 'ad_unit=1234567890&ad_network=5450213213286189855')],
    ['re-encoded characters', (q: string) => q.replace('custom_data=tok_ABC-123_xyz', 'custom_data=tok%5FABC-123_xyz')],
  ])('rejects %s after signing', async (_name, change) => {
    const result = await verifyRewardCallback(change(signed()), keys);

    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a signature made with a key Google did not publish', async () => {
    expect(await verifyRewardCallback(signed(base(), '3335741209', OTHER.privateKey), keys)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a signature that belongs to different content', async () => {
    const forged = `${base()}&signature=${sign(base({ custom_data: 'different' }))}&key_id=3335741209`;

    expect(await verifyRewardCallback(forged, keys)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an unknown key id', async () => {
    expect(await verifyRewardCallback(signed(base(), '42'), keys)).toEqual({ ok: false, reason: 'unknown_key' });
  });

  it.each([
    ['empty', ''],
    ['no signature', base()],
    ['key id before signature', `${base()}&key_id=3335741209&signature=${sign(base())}`],
    ['parameters after key_id', `${signed()}&extra=1`],
    ['no key id', `${base()}&signature=${sign(base())}`],
    ['empty signature', `${base()}&signature=&key_id=3335741209`],
    ['duplicate custom_data', (() => { const c = `${base()}&custom_data=second`; return signed(c); })()],
    ['duplicate transaction_id', (() => { const c = `${base()}&transaction_id=00`; return signed(c); })()],
  ])('reports %s as malformed', async (_name, query) => {
    expect(await verifyRewardCallback(query, keys)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('treats a non-base64 or non-DER signature as a bad signature, never as an exception', async () => {
    const content = base();

    expect(await verifyRewardCallback(`${content}&signature=!!!notbase64!!!&key_id=3335741209`, keys)).toMatchObject({ ok: false });
    expect(await verifyRewardCallback(`${content}&signature=AAAA&key_id=3335741209`, keys)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('accepts standard or URL-safe base64 signatures', async () => {
    const content = base();
    const std = nodeSign('sha256', Buffer.from(content), { key: GOOGLE.privateKey, dsaEncoding: 'der' }).toString('base64');

    expect((await verifyRewardCallback(`${content}&signature=${encodeURIComponent(std)}&key_id=3335741209`, keys)).ok).toBe(true);
  });
});

describe('createKeyProvider', () => {
  const body = (...ids: string[]) => ({ keys: ids.map((id) => ({ keyId: Number(id), pem: 'x', base64: `spki-${id}` })) });
  const make = (responses: unknown[], clock: { now: number }) => {
    const calls: string[] = [];
    const fetcher = jest.fn(async (url: string) => {
      calls.push(url);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return { ok: next !== null, json: async () => next };
    });
    return { fetcher, calls, provider: createKeyProvider({ fetcher: fetcher as never, now: () => clock.now, ttlMs: 60 * 60 * 1000, minRefetchMs: 60 * 1000 }) };
  };

  it('fetches Google\'s published keys once and caches them', async () => {
    const clock = { now: 1_000_000 };
    const { provider, fetcher, calls } = make([body('1', '2')], clock);

    expect(await provider.get('1')).toBe('spki-1');
    expect(await provider.get('2')).toBe('spki-2');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(KEYS_URL);
    expect(KEYS_URL).toBe('https://www.gstatic.com/admob/reward/verifier-keys.json');
  });

  it('refreshes after the cache lifetime, which is under 24 hours', async () => {
    const clock = { now: 1_000_000 };
    const { provider, fetcher } = make([body('1'), body('1', '3')], clock);
    await provider.get('1');

    clock.now += 61 * 60 * 1000;

    expect(await provider.get('3')).toBe('spki-3');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('re-fetches once for an unknown key (rotation) but not repeatedly', async () => {
    const clock = { now: 1_000_000 };
    const { provider, fetcher } = make([body('1'), body('1', '9')], clock);
    await provider.get('1');

    clock.now += 2 * 60 * 1000;
    expect(await provider.get('9')).toBe('spki-9');
    expect(await provider.get('404')).toBeNull();
    expect(await provider.get('405')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('throws when keys cannot be fetched and nothing is cached, so the callback is retried', async () => {
    const { provider } = make([new Error('network')], { now: 1 });

    await expect(provider.get('1')).rejects.toThrow();
  });

  it('throws on a malformed key document', async () => {
    const { provider } = make([{ nope: true }], { now: 1 });

    await expect(provider.get('1')).rejects.toThrow();
  });
});

describe('handleAdRewardCallback', () => {
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  const makeDeps = (over: Partial<CallbackDeps> = {}): CallbackDeps & { grants: unknown[] } => {
    const grants: unknown[] = [];
    return {
      keys,
      adUnitIds: ['ca-app-pub-3940256099942544/1234567890'],
      grant: async (call) => {
        grants.push(call);
        return 'granted';
      },
      grants,
      ...over,
    };
  };

  it('grants through the ledger with the hashed token, transaction id and ad unit, then answers 200', async () => {
    const deps = makeDeps();

    const res = await handleAdRewardCallback(signed(), deps);

    expect(res).toEqual({ status: 200, body: { ok: true, outcome: 'granted' } });
    expect(deps.grants).toEqual([{ tokenHash: hash(TOKEN), transactionId: 'ABCDEF0123456789ABCDEF0123456789', adUnit: AD_UNIT }]);
  });

  it('never calls the ledger for a forged, changed or unknown-key callback', async () => {
    const deps = makeDeps();

    expect((await handleAdRewardCallback(signed().replace('reward_amount=1', 'reward_amount=9'), deps)).status).toBe(403);
    expect((await handleAdRewardCallback(signed(base(), '3335741209', OTHER.privateKey), deps)).status).toBe(403);
    expect((await handleAdRewardCallback(signed(base(), '42'), deps)).status).toBe(403);
    expect((await handleAdRewardCallback('', deps)).status).toBe(400);
    expect(deps.grants).toEqual([]);
  });

  it('rejects a validly signed callback from an ad unit that is not ours', async () => {
    const deps = makeDeps();

    const res = await handleAdRewardCallback(signed(base({ ad_unit: '999' })), deps);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'ad_unit_not_allowed' });
    expect(deps.grants).toEqual([]);
  });

  it('accepts the configured ad unit written as the full id or the bare number', async () => {
    expect((await handleAdRewardCallback(signed(), makeDeps({ adUnitIds: [AD_UNIT] }))).status).toBe(200);
    expect((await handleAdRewardCallback(signed(), makeDeps({ adUnitIds: ['ca-app-pub-1~2/1234567890'] }))).status).toBe(200);
  });

  it('fails closed with 503 when no ad unit is configured', async () => {
    const deps = makeDeps({ adUnitIds: [] });

    expect((await handleAdRewardCallback(signed(), deps)).status).toBe(503);
    expect(deps.grants).toEqual([]);
  });

  it('rejects a signed callback with no token or no transaction id', async () => {
    const deps = makeDeps();
    const params = new URLSearchParams(base());
    params.delete('custom_data');
    const noTx = new URLSearchParams(base());
    noTx.delete('transaction_id');

    expect((await handleAdRewardCallback(signed(params.toString()), deps)).status).toBe(400);
    expect((await handleAdRewardCallback(signed(noTx.toString()), deps)).status).toBe(400);
    expect(deps.grants).toEqual([]);
  });

  it.each(['unknown_token', 'token_used', 'expired', 'duplicate', 'cap_reached', 'premium'])('answers 200 with the %s outcome so Google does not retry', async (outcome) => {
    const deps = makeDeps({ grant: async () => outcome as never });

    expect(await handleAdRewardCallback(signed(), deps)).toEqual({ status: 200, body: { ok: true, outcome } });
  });

  it('answers 500 when the ledger fails and 503 when keys cannot be loaded, so Google retries', async () => {
    const failing = makeDeps({
      grant: async () => {
        throw new Error('db down');
      },
    });
    const noKeys = makeDeps({
      keys: {
        get: async () => {
          throw new Error('offline');
        },
      },
    });

    expect((await handleAdRewardCallback(signed(), failing)).status).toBe(500);
    expect((await handleAdRewardCallback(signed(), noKeys)).status).toBe(503);
  });
});
