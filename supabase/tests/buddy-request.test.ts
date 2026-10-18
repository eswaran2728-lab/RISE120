import { DISCLOSURE_VERSION, parseBuddyRequest } from '../functions/_shared/buddy/request';

const ID = '3f2b8c1e-1111-4222-8333-444455556666';
const OTHER = '9a2b8c1e-1111-4222-8333-444455556666';
const TOKEN = 'A'.repeat(43); // 32 random bytes in base64url

const ok = (body: unknown) => parseBuddyRequest(body);

describe('parseBuddyRequest', () => {
  it('knows exactly one current disclosure version', () => {
    expect(DISCLOSURE_VERSION).toBe(1);
  });

  describe('create_group', () => {
    const good = { action: 'create_group', name: 'Morning crew', displayName: 'Sam', disclosureVersion: 1, disclosureAccepted: true };

    it('accepts a name, a display name and an accepted disclosure', () => {
      expect(ok(good)).toEqual({ ok: true, action: 'create_group', name: 'Morning crew', displayName: 'Sam' });
    });

    it.each([
      ['no disclosure acceptance', { ...good, disclosureAccepted: undefined }],
      ['a refused disclosure', { ...good, disclosureAccepted: false }],
      ['a disclosure accepted as text', { ...good, disclosureAccepted: 'true' }],
      ['an old disclosure version', { ...good, disclosureVersion: 0 }],
      ['a future disclosure version', { ...good, disclosureVersion: 2 }],
      ['an empty group name', { ...good, name: '   ' }],
      ['a group name over 40 characters', { ...good, name: 'x'.repeat(41) }],
      ['an empty display name', { ...good, displayName: '' }],
      ['a display name over 30 characters', { ...good, displayName: 'x'.repeat(31) }],
      ['a display name with a line break', { ...good, displayName: 'Sam\nLee' }],
    ])('rejects %s', (_label, body) => {
      expect(ok(body)).toEqual({ ok: false });
    });
  });

  describe('invites', () => {
    it('create_invite and revoke_invite take only ids', () => {
      expect(ok({ action: 'create_invite', groupId: ID })).toEqual({ ok: true, action: 'create_invite', groupId: ID });
      expect(ok({ action: 'revoke_invite', inviteId: ID })).toEqual({ ok: true, action: 'revoke_invite', inviteId: ID });
      expect(ok({ action: 'create_invite', groupId: 'nope' })).toEqual({ ok: false });
      expect(ok({ action: 'revoke_invite' })).toEqual({ ok: false });
    });

    const accept = { action: 'accept_invite', token: TOKEN, displayName: 'Lee', disclosureVersion: 1, disclosureAccepted: true };

    it('accept_invite needs a token-shaped string, a display name and an accepted disclosure', () => {
      expect(ok(accept)).toEqual({ ok: true, action: 'accept_invite', token: TOKEN, displayName: 'Lee' });
    });

    it.each([
      ['a token that is too short', { ...accept, token: 'abc' }],
      ['a token with characters outside base64url', { ...accept, token: `${'A'.repeat(42)}!` }],
      ['a token that is not text', { ...accept, token: 12345 }],
      ['no disclosure acceptance', { ...accept, disclosureAccepted: false }],
      ['no display name', { ...accept, displayName: undefined }],
    ])('rejects %s', (_label, body) => {
      expect(ok(body)).toEqual({ ok: false });
    });
  });

  describe('membership actions', () => {
    it('leave needs a group id', () => {
      expect(ok({ action: 'leave', groupId: ID })).toEqual({ ok: true, action: 'leave', groupId: ID });
      expect(ok({ action: 'leave' })).toEqual({ ok: false });
    });

    it('remove_member and block_member need a group id and a member id', () => {
      expect(ok({ action: 'remove_member', groupId: ID, memberId: OTHER })).toEqual({ ok: true, action: 'remove_member', groupId: ID, memberId: OTHER });
      expect(ok({ action: 'block_member', groupId: ID, memberId: OTHER })).toEqual({ ok: true, action: 'block_member', groupId: ID, memberId: OTHER });
      expect(ok({ action: 'remove_member', groupId: ID })).toEqual({ ok: false });
    });
  });

  describe('summary', () => {
    it('needs a group and a date range of at most 31 days', () => {
      expect(ok({ action: 'summary', groupId: ID, from: '2026-10-01', to: '2026-10-31' })).toEqual({ ok: true, action: 'summary', groupId: ID, from: '2026-10-01', to: '2026-10-31' });
    });

    it.each([
      ['a range of 32 days', { from: '2026-10-01', to: '2026-11-01' }],
      ['a range that ends before it starts', { from: '2026-10-05', to: '2026-10-01' }],
      ['an impossible date', { from: '2026-02-31', to: '2026-03-01' }],
      ['dates that are not dates', { from: 'yesterday', to: 'today' }],
    ])('rejects %s', (_label, range) => {
      expect(ok({ action: 'summary', groupId: ID, ...range })).toEqual({ ok: false });
    });
  });

  it('rejects an unknown action, a missing body and anything else', () => {
    expect(ok({ action: 'delete_everything' })).toEqual({ ok: false });
    expect(ok(null)).toEqual({ ok: false });
    expect(ok([])).toEqual({ ok: false });
    expect(ok('leave')).toEqual({ ok: false });
  });

  it('never reads a user id from the body', () => {
    const result = ok({ action: 'leave', groupId: ID, userId: OTHER, user_id: OTHER });

    expect(result).toEqual({ ok: true, action: 'leave', groupId: ID });
  });
});
