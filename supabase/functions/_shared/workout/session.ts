// Pure parsing for the start-session endpoint. Only five fields are read; the account always comes from the
// verified token, and the session content is built by the database from the published template, never taken
// from the request.
export type StartSessionRequest =
  | { ok: true; requestId: string; planId: string; dayNumber: number; templateId: string; templateVersion: number }
  | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseStartSessionRequest(body: unknown): StartSessionRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const { requestId, planId, dayNumber, templateId, templateVersion } = body as Record<string, unknown>;
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return { ok: false };
  if (typeof planId !== 'string' || !UUID.test(planId)) return { ok: false };
  if (typeof dayNumber !== 'number' || !Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 120) return { ok: false };
  if (typeof templateId !== 'string' || !TEMPLATE_ID.test(templateId)) return { ok: false };
  if (typeof templateVersion !== 'number' || !Number.isInteger(templateVersion) || templateVersion < 1) return { ok: false };
  return { ok: true, requestId: requestId.toLowerCase(), planId: planId.toLowerCase(), dayNumber, templateId, templateVersion };
}
