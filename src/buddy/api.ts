// The app's only contact with buddy groups: one server function and the member's own readable rows. The server
// decides who may see what; the app never sends an account id.
import { supabase } from '../lib/supabase';
import type { BuddyFailure, BuddyGroup, BuddyMember, GroupShare, MemberDays, Milestone, ReportReason } from './types';

// The disclosure version this build shows. The server rejects any other, so an out-of-date app cannot record
// consent to text it did not show.
export const DISCLOSURE_VERSION = 1;

type Ok<T> = { kind: 'ok' } & T;

const KINDS: Record<string, BuddyFailure['kind']> = {
  INVITE_UNAVAILABLE: 'invite_unavailable',
  GROUP_NOT_FOUND: 'not_found',
  MEMBER_NOT_FOUND: 'not_found',
  INVITE_NOT_FOUND: 'not_found',
  NOT_OWNER: 'not_owner',
  GROUP_FULL: 'group_full',
  LIMIT_REACHED: 'limit_reached',
  ALREADY_MEMBER: 'already_member',
  MILESTONE_NOT_EARNED: 'milestone_not_earned',
  SHARE_WITHDRAWN: 'share_withdrawn',
  SHARE_NOT_FOUND: 'not_found',
  REPORTING_UNAVAILABLE: 'reporting_unavailable',
  INVALID_TARGET: 'invalid',
};

async function call(body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; failure: BuddyFailure }> {
  const { data, error } = await supabase.functions.invoke('buddy', { method: 'POST', body });
  if (!error) return { ok: true, data: (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown> };

  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<unknown> } };
  if (e.name !== 'FunctionsHttpError' || typeof e.context?.status !== 'number') return { ok: false, failure: { kind: 'offline' } };
  let code: unknown;
  try {
    code = ((await e.context.json?.()) as { error?: unknown } | undefined)?.error;
  } catch {
    code = undefined;
  }
  if (typeof code === 'string' && KINDS[code]) return { ok: false, failure: { kind: KINDS[code] } as BuddyFailure };
  return { ok: false, failure: { kind: e.context.status === 400 ? 'invalid' : 'error' } };
}

export async function createGroup(input: { name: string; displayName: string; disclosureAccepted: boolean }): Promise<Ok<{ groupId: string }> | BuddyFailure> {
  if (!input.disclosureAccepted) return { kind: 'disclosure_required' };
  const result = await call({ action: 'create_group', name: input.name, displayName: input.displayName, disclosureVersion: DISCLOSURE_VERSION, disclosureAccepted: true });
  if (!result.ok) return result.failure;
  return typeof result.data.groupId === 'string' ? { kind: 'ok', groupId: result.data.groupId } : { kind: 'error' };
}

export async function createInvite(groupId: string): Promise<Ok<{ token: string; inviteId: string; expiresAt: string }> | BuddyFailure> {
  const result = await call({ action: 'create_invite', groupId });
  if (!result.ok) return result.failure;
  const { token, inviteId, expiresAt } = result.data;
  return typeof token === 'string' && typeof inviteId === 'string' && typeof expiresAt === 'string' ? { kind: 'ok', token, inviteId, expiresAt } : { kind: 'error' };
}

export async function acceptInvite(input: { token: string; displayName: string; disclosureAccepted: boolean }): Promise<Ok<{ groupId: string }> | BuddyFailure> {
  if (!input.disclosureAccepted) return { kind: 'disclosure_required' };
  const result = await call({ action: 'accept_invite', token: input.token, displayName: input.displayName, disclosureVersion: DISCLOSURE_VERSION, disclosureAccepted: true });
  if (!result.ok) return result.failure;
  return typeof result.data.groupId === 'string' ? { kind: 'ok', groupId: result.data.groupId } : { kind: 'error' };
}

async function simple(body: Record<string, unknown>): Promise<{ kind: 'ok' } | BuddyFailure> {
  const result = await call(body);
  return result.ok ? { kind: 'ok' } : result.failure;
}

export const revokeInvite = (inviteId: string) => simple({ action: 'revoke_invite', inviteId });
export const leaveGroup = (groupId: string) => simple({ action: 'leave', groupId });
export const removeMember = (groupId: string, memberId: string) => simple({ action: 'remove_member', groupId, memberId });
export const blockMember = (groupId: string, memberId: string) => simple({ action: 'block_member', groupId, memberId });

export async function groupSummary(groupId: string, from: string, to: string): Promise<Ok<{ members: MemberDays[] }> | BuddyFailure> {
  const result = await call({ action: 'summary', groupId, from, to });
  if (!result.ok) return result.failure;
  const raw = Array.isArray(result.data.members) ? (result.data.members as Record<string, unknown>[]) : [];
  // Only these three fields are kept, whatever else a response might carry.
  const members = raw.map((m) => ({ memberId: String(m.memberId), displayName: String(m.displayName), days: Array.isArray(m.days) ? (m.days as unknown[]).map(String) : [] }));
  return { kind: 'ok', members };
}

// The member's completion milestones, computed by the server from distinct workout days (one point for each local day).
export async function getMilestones(): Promise<Ok<{ days: number; milestones: Milestone[] }> | BuddyFailure> {
  const result = await call({ action: 'milestones' });
  if (!result.ok) return result.failure;
  const raw = Array.isArray(result.data.milestones) ? (result.data.milestones as Record<string, unknown>[]) : [];
  return {
    kind: 'ok',
    days: Number(result.data.days) || 0,
    milestones: raw.map((m) => ({ milestone: Number(m.milestone), sharedIn: Array.isArray(m.sharedIn) ? (m.sharedIn as unknown[]).map(String) : [] })),
  };
}

// Only ever called after the member has confirmed a preview. The request id stays the same for a retry, and the server
// remembers it, so a late repeat of a withdrawn share cannot bring it back.
export const shareMilestone = (input: { groupId: string; milestone: number; requestId: string }) => simple({ action: 'share_milestone', ...input });
export const withdrawShare = (groupId: string, milestone: number) => simple({ action: 'withdraw_share', groupId, milestone });

export async function groupShares(groupId: string): Promise<Ok<{ shares: GroupShare[] }> | BuddyFailure> {
  const result = await call({ action: 'shares', groupId });
  if (!result.ok) return result.failure;
  const raw = Array.isArray(result.data.shares) ? (result.data.shares as Record<string, unknown>[]) : [];
  // Only these five fields are kept, whatever else a response might carry.
  return { kind: 'ok', shares: raw.map((s) => ({ memberId: String(s.memberId), displayName: String(s.displayName), milestone: Number(s.milestone), sharedAt: String(s.sharedAt), mine: s.mine === true })) };
}

// Reporting is open only when the server says so (it needs a named moderator). Anything else counts as closed.
export async function reportsOpen(): Promise<boolean> {
  const result = await call({ action: 'reports_status' });
  return result.ok && result.data.open === true;
}

export async function submitReport(input: { groupId: string; memberId: string; reason: ReportReason; note: string | null; requestId: string }): Promise<Ok<{ reportId: string; receivedAt: string }> | BuddyFailure> {
  const result = await call({ action: 'report', ...input });
  if (!result.ok) return result.failure;
  const { reportId, receivedAt } = result.data;
  return typeof reportId === 'string' && typeof receivedAt === 'string' ? { kind: 'ok', reportId, receivedAt } : { kind: 'error' };
}

// The member's own groups and member lists, read under row-level security and the column grants (so only a
// random member id, a display name and a role can be read). Null when they cannot be read.
export async function listGroups(): Promise<BuddyGroup[] | null> {
  const groups = await supabase.from('buddy_groups').select('id, name, created_at').order('created_at');
  if (groups.error || !groups.data) return null;
  const members = await supabase.from('buddy_members').select('member_id, group_id, display_name, role, joined_at').order('joined_at');
  if (members.error || !members.data) return null;
  // Which listed member is the caller: only their own member id and role are returned, never anyone else's.
  const mine = await supabase.rpc('buddy_my_memberships');
  if (mine.error || !mine.data) return null;
  const own = new Map((mine.data as { group_id: string; member_id: string; role: BuddyMember['role'] }[]).map((m) => [m.group_id, m]));

  return (groups.data as { id: string; name: string }[]).flatMap((g) => {
    const me = own.get(g.id);
    if (!me) return [];
    return [
      {
        id: g.id,
        name: g.name,
        me: { memberId: me.member_id, role: me.role },
        members: (members.data as { member_id: string; group_id: string; display_name: string; role: BuddyMember['role'] }[])
          .filter((m) => m.group_id === g.id)
          .map((m) => ({ memberId: m.member_id, displayName: m.display_name, role: m.role })),
      },
    ];
  });
}
