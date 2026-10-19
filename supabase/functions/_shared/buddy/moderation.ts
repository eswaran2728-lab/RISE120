// Parsing for the moderation endpoint. Only a named moderator can use it (see the migration); the account always
// comes from the verified token.
export const RESOLUTIONS = ['no_action', 'removed_from_group', 'other'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export type ModerationRequest =
  | { ok: true; action: 'queue' }
  | { ok: true; action: 'start_review'; reportId: string }
  | { ok: true; action: 'resolve'; reportId: string; resolution: Resolution; note: string | null }
  | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const FAIL: ModerationRequest = { ok: false };

export function parseModerationRequest(body: unknown): ModerationRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return FAIL;
  const b = body as Record<string, unknown>;
  switch (b.action) {
    case 'queue':
      return { ok: true, action: 'queue' };
    case 'start_review':
      return isUuid(b.reportId) ? { ok: true, action: 'start_review', reportId: b.reportId } : FAIL;
    case 'resolve': {
      const resolution = (RESOLUTIONS as readonly unknown[]).includes(b.resolution) ? (b.resolution as Resolution) : null;
      if (!isUuid(b.reportId) || !resolution) return FAIL;
      if (b.note !== undefined && b.note !== null && (typeof b.note !== 'string' || b.note.length > 500)) return FAIL;
      const note = typeof b.note === 'string' && b.note.trim() !== '' ? b.note.trim() : null;
      return { ok: true, action: 'resolve', reportId: b.reportId, resolution, note };
    }
    default:
      return FAIL;
  }
}
