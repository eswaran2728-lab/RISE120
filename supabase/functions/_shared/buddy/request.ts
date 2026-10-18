// Parsing for the buddy endpoint. The account always comes from the verified token, so a user id in the body is
// never read. Joining a group, or starting one, needs an explicit acceptance of the current disclosure (what a
// group can see): a missing, refused or out-of-date acceptance is rejected before anything is stored.
export const DISCLOSURE_VERSION = 1;

export type BuddyRequest =
  | { ok: true; action: 'create_group'; name: string; displayName: string }
  | { ok: true; action: 'create_invite'; groupId: string }
  | { ok: true; action: 'revoke_invite'; inviteId: string }
  | { ok: true; action: 'accept_invite'; token: string; displayName: string }
  | { ok: true; action: 'leave'; groupId: string }
  | { ok: true; action: 'remove_member' | 'block_member'; groupId: string; memberId: string }
  | { ok: true; action: 'summary'; groupId: string; from: string; to: string }
  | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43,86}$/;
const FAIL: BuddyRequest = { ok: false };
const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 31;

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

function cleanName(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

const disclosureAccepted = (body: Record<string, unknown>) => body.disclosureAccepted === true && body.disclosureVersion === DISCLOSURE_VERSION;

function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value ? null : parsed;
}

export function parseBuddyRequest(body: unknown): BuddyRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return FAIL;
  const b = body as Record<string, unknown>;

  switch (b.action) {
    case 'create_group': {
      const name = cleanName(b.name, 40);
      const displayName = cleanName(b.displayName, 30);
      if (!name || !displayName || !disclosureAccepted(b)) return FAIL;
      return { ok: true, action: 'create_group', name, displayName };
    }
    case 'create_invite':
      return isUuid(b.groupId) ? { ok: true, action: 'create_invite', groupId: b.groupId } : FAIL;
    case 'revoke_invite':
      return isUuid(b.inviteId) ? { ok: true, action: 'revoke_invite', inviteId: b.inviteId } : FAIL;
    case 'accept_invite': {
      const displayName = cleanName(b.displayName, 30);
      if (typeof b.token !== 'string' || !TOKEN.test(b.token) || !displayName || !disclosureAccepted(b)) return FAIL;
      return { ok: true, action: 'accept_invite', token: b.token, displayName };
    }
    case 'leave':
      return isUuid(b.groupId) ? { ok: true, action: 'leave', groupId: b.groupId } : FAIL;
    case 'remove_member':
    case 'block_member':
      return isUuid(b.groupId) && isUuid(b.memberId) ? { ok: true, action: b.action, groupId: b.groupId, memberId: b.memberId } : FAIL;
    case 'summary': {
      const from = parseDate(b.from);
      const to = parseDate(b.to);
      if (!isUuid(b.groupId) || from === null || to === null || to < from || (to - from) / DAY_MS + 1 > MAX_RANGE_DAYS) return FAIL;
      return { ok: true, action: 'summary', groupId: b.groupId, from: b.from as string, to: b.to as string };
    }
    default:
      return FAIL;
  }
}
