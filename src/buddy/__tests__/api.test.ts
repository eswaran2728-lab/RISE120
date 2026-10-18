import { acceptInvite, blockMember, createGroup, createInvite, groupSummary, leaveGroup, listGroups, removeMember, revokeInvite, DISCLOSURE_VERSION } from '../api';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), rpc: jest.fn() } }));

const invoke = supabase.functions.invoke as jest.Mock;
const GROUP = '3f2b8c1e-1111-4222-8333-444455556666';
const MEMBER = '9a2b8c1e-1111-4222-8333-444455556666';
const TOKEN = 'A'.repeat(43);
const httpError = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', context: { status, json: async () => body } });

beforeEach(() => jest.clearAllMocks());

describe('what the app sends', () => {
  it('starts a group only with the disclosure the member accepted, and sends no account id', async () => {
    invoke.mockResolvedValue({ data: { groupId: GROUP }, error: null });

    const result = await createGroup({ name: 'Crew', displayName: 'Alex', disclosureAccepted: true });

    expect(invoke).toHaveBeenCalledWith('buddy', { method: 'POST', body: { action: 'create_group', name: 'Crew', displayName: 'Alex', disclosureVersion: DISCLOSURE_VERSION, disclosureAccepted: true } });
    expect(result).toEqual({ kind: 'ok', groupId: GROUP });
  });

  it('does not call the server at all when the disclosure was not accepted', async () => {
    expect(await createGroup({ name: 'Crew', displayName: 'Alex', disclosureAccepted: false })).toEqual({ kind: 'disclosure_required' });
    expect(await acceptInvite({ token: TOKEN, displayName: 'Sam', disclosureAccepted: false })).toEqual({ kind: 'disclosure_required' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends the other actions with only the ids they need', async () => {
    invoke.mockResolvedValue({ data: {}, error: null });

    await revokeInvite('inv-1');
    await leaveGroup(GROUP);
    await removeMember(GROUP, MEMBER);
    await blockMember(GROUP, MEMBER);
    await groupSummary(GROUP, '2026-10-12', '2026-10-18');

    expect(invoke.mock.calls.map((c) => c[1].body)).toEqual([
      { action: 'revoke_invite', inviteId: 'inv-1' },
      { action: 'leave', groupId: GROUP },
      { action: 'remove_member', groupId: GROUP, memberId: MEMBER },
      { action: 'block_member', groupId: GROUP, memberId: MEMBER },
      { action: 'summary', groupId: GROUP, from: '2026-10-12', to: '2026-10-18' },
    ]);
  });
});

describe('what comes back', () => {
  it('reads an invitation token and its expiry', async () => {
    invoke.mockResolvedValue({ data: { token: TOKEN, inviteId: 'i1', expiresAt: '2026-10-21T00:00:00Z' }, error: null });

    expect(await createInvite(GROUP)).toEqual({ kind: 'ok', token: TOKEN, inviteId: 'i1', expiresAt: '2026-10-21T00:00:00Z' });
  });

  it('reads the summary as names and days only', async () => {
    invoke.mockResolvedValue({ data: { members: [{ memberId: MEMBER, displayName: 'Sam', days: ['2026-10-13'], weight: 70, userId: 'x' }] }, error: null });

    expect(await groupSummary(GROUP, '2026-10-12', '2026-10-18')).toEqual({ kind: 'ok', members: [{ memberId: MEMBER, displayName: 'Sam', days: ['2026-10-13'] }] });
  });

  it.each([
    [404, { error: 'INVITE_UNAVAILABLE' }, 'invite_unavailable'],
    [404, { error: 'GROUP_NOT_FOUND' }, 'not_found'],
    [404, { error: 'MEMBER_NOT_FOUND' }, 'not_found'],
    [403, { error: 'NOT_OWNER' }, 'not_owner'],
    [409, { error: 'GROUP_FULL' }, 'group_full'],
    [409, { error: 'LIMIT_REACHED' }, 'limit_reached'],
    [409, { error: 'ALREADY_MEMBER' }, 'already_member'],
    [400, { error: 'invalid_request' }, 'invalid'],
    [500, { error: 'x' }, 'error'],
  ])('maps %i %j to %s', async (status, body, kind) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status, body) });

    expect(await leaveGroup(GROUP)).toEqual({ kind });
  });

  it('says offline when no answer arrived', async () => {
    invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });

    expect(await leaveGroup(GROUP)).toEqual({ kind: 'offline' });
  });

  it('treats an invite answer without a token as an error', async () => {
    invoke.mockResolvedValue({ data: {}, error: null });

    expect(await createInvite(GROUP)).toEqual({ kind: 'error' });
  });
});

describe('listGroups', () => {
  it('reads only the columns members are allowed to see, groups with their members', async () => {
    const groups = [{ id: GROUP, name: 'Crew', created_at: '2026-10-01T00:00:00Z' }];
    const members = [{ member_id: MEMBER, group_id: GROUP, display_name: 'Sam', role: 'member', joined_at: '2026-10-02T00:00:00Z' }];
    const select = jest.fn((columns: string) => ({ order: async () => ({ data: columns.startsWith('id') ? groups : members, error: null }) }));
    (supabase.from as jest.Mock).mockReturnValue({ select });
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [{ group_id: GROUP, member_id: MEMBER, role: 'member' }], error: null });

    const result = await listGroups();

    expect(select.mock.calls.map((c) => c[0])).toEqual(['id, name, created_at', 'member_id, group_id, display_name, role, joined_at']);
    expect(supabase.rpc).toHaveBeenCalledWith('buddy_my_memberships');
    expect(result).toEqual([{ id: GROUP, name: 'Crew', me: { memberId: MEMBER, role: 'member' }, members: [{ memberId: MEMBER, displayName: 'Sam', role: 'member' }] }]);
  });

  it('answers null, not an empty list, when the groups cannot be read', async () => {
    (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ order: async () => ({ data: null, error: { message: 'offline' } }) }) });

    expect(await listGroups()).toBeNull();
  });

  it('answers null when the own roles cannot be read, so the app never guesses who is the owner', async () => {
    const select = jest.fn(() => ({ order: async () => ({ data: [], error: null }) }));
    (supabase.from as jest.Mock).mockReturnValue({ select });
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'offline' } });

    expect(await listGroups()).toBeNull();
  });
});
