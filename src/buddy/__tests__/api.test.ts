import { getMilestones, groupShares, reportsOpen, shareMilestone, submitReport, withdrawShare, acceptInvite, blockMember, createGroup, createInvite, groupSummary, leaveGroup, listGroups, removeMember, revokeInvite, DISCLOSURE_VERSION } from '../api';
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

const REQUEST = '7a2b8c1e-1111-4222-8333-444455556667';

describe('milestones and shares', () => {
  it('asks for the own milestones of the signed-in member, with no account id', async () => {
    invoke.mockResolvedValue({ data: { days: 9, milestones: [{ milestone: 7, sharedIn: [GROUP], extra: 'x' }], token: 'leak' }, error: null });

    const result = await getMilestones();

    expect(invoke).toHaveBeenCalledWith('buddy', { method: 'POST', body: { action: 'milestones' } });
    expect(result).toEqual({ kind: 'ok', days: 9, milestones: [{ milestone: 7, sharedIn: [GROUP] }] });
  });

  it('sends a share with its request id, and a withdrawal with the group and milestone only', async () => {
    invoke.mockResolvedValue({ data: { shared: true }, error: null });

    expect(await shareMilestone({ groupId: GROUP, milestone: 7, requestId: REQUEST })).toEqual({ kind: 'ok' });
    await withdrawShare(GROUP, 7);

    expect(invoke.mock.calls.map((c) => c[1].body)).toEqual([
      { action: 'share_milestone', groupId: GROUP, milestone: 7, requestId: REQUEST },
      { action: 'withdraw_share', groupId: GROUP, milestone: 7 },
    ]);
  });

  it('keeps only name, number, time and ownership of a share, whatever else a response carries', async () => {
    invoke.mockResolvedValue({ data: { shares: [{ memberId: MEMBER, displayName: 'Alex', milestone: 7, sharedAt: '2026-10-19T00:00:00Z', mine: false, weight: 70, userId: 'u1', photo: 'p' }] }, error: null });

    const result = await groupShares(GROUP);

    expect(result).toEqual({ kind: 'ok', shares: [{ memberId: MEMBER, displayName: 'Alex', milestone: 7, sharedAt: '2026-10-19T00:00:00Z', mine: false }] });
  });

  it.each([
    ['MILESTONE_NOT_EARNED', 409, 'milestone_not_earned'],
    ['SHARE_WITHDRAWN', 409, 'share_withdrawn'],
    ['SHARE_NOT_FOUND', 404, 'not_found'],
    ['GROUP_NOT_FOUND', 404, 'not_found'],
  ])('maps %s to %s', async (code, status, kind) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status, { error: code }) });

    expect(await shareMilestone({ groupId: GROUP, milestone: 7, requestId: REQUEST })).toEqual({ kind });
  });

  it('says it is offline when the server cannot be reached', async () => {
    invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });

    expect(await groupShares(GROUP)).toEqual({ kind: 'offline' });
  });
});

describe('reports', () => {
  it('treats reporting as closed unless the server says it is open, and when it cannot tell', async () => {
    invoke.mockResolvedValueOnce({ data: { open: true }, error: null });
    invoke.mockResolvedValueOnce({ data: { open: 'yes' }, error: null });
    invoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError' } });

    expect(await reportsOpen()).toBe(true);
    expect(await reportsOpen()).toBe(false);
    expect(await reportsOpen()).toBe(false);
  });

  it('sends a report with its request id and reason, and returns only the acknowledgement', async () => {
    invoke.mockResolvedValue({ data: { reportId: 'r1', receivedAt: '2026-10-19T00:00:00Z', reporter: 'leak' }, error: null });

    const result = await submitReport({ groupId: GROUP, memberId: MEMBER, reason: 'harassment', note: 'Hi', requestId: REQUEST });

    expect(invoke).toHaveBeenCalledWith('buddy', { method: 'POST', body: { action: 'report', groupId: GROUP, memberId: MEMBER, reason: 'harassment', note: 'Hi', requestId: REQUEST } });
    expect(result).toEqual({ kind: 'ok', reportId: 'r1', receivedAt: '2026-10-19T00:00:00Z' });
  });

  it('says reporting is unavailable when the server says it is not open', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(503, { error: 'REPORTING_UNAVAILABLE' }) });

    expect(await submitReport({ groupId: GROUP, memberId: MEMBER, reason: 'spam', note: null, requestId: REQUEST })).toEqual({ kind: 'reporting_unavailable' });
  });

  it('is an error, not an acknowledgement, when the answer has no report id', async () => {
    invoke.mockResolvedValue({ data: {}, error: null });

    expect(await submitReport({ groupId: GROUP, memberId: MEMBER, reason: 'spam', note: null, requestId: REQUEST })).toEqual({ kind: 'error' });
  });
});
