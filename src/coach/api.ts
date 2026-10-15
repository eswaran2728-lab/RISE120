// The app's only contact with the coach: two server functions and the member's own stored history. The app never
// calls a model and never edits a plan day; the server decides every answer and every plan change.
import { supabase } from '../lib/supabase';
import { COACH_HISTORY_LIMIT, CoachExchange, CoachProposal, ProposalStatus } from './types';

export type SendResult =
  | { kind: 'answered'; exchange: CoachExchange; refused: boolean; proposalDropped: boolean }
  | { kind: 'limit'; resetsAt: string | null }
  | { kind: 'rate_limited'; retryAt: string | null }
  | { kind: 'in_progress' }
  | { kind: 'unavailable' }
  | { kind: 'unknown_outcome' } // the server may have asked the model but never recorded an answer
  | { kind: 'invalid' }
  | { kind: 'offline' } // no response at all: the request may or may not have arrived
  | { kind: 'error' };

export type DecideResult =
  | { kind: 'accepted'; changedDays: number[] }
  | { kind: 'declined' }
  | { kind: 'stale' }
  | { kind: 'conflict'; current: string }
  | { kind: 'not_found' }
  | { kind: 'offline' }
  | { kind: 'error' };

type Failure = { offline: true } | { offline: false; status: number; body: Record<string, unknown> | null };

// A non-2xx answer carries the server's JSON body; anything else (no connection) means no answer arrived.
async function failureOf(error: unknown): Promise<Failure> {
  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<unknown> } } | null;
  if (e?.name !== 'FunctionsHttpError' || typeof e.context?.status !== 'number') return { offline: true };
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await e.context.json?.();
    body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { offline: false, status: e.context.status, body };
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const isStatus = (value: unknown): value is ProposalStatus => value === 'pending' || value === 'accepted' || value === 'declined' || value === 'stale';

function toProposal(value: unknown): CoachProposal | null {
  const p = value as { id?: unknown; status?: unknown; patches?: unknown } | null;
  if (!p || typeof p.id !== 'string' || !isStatus(p.status) || !Array.isArray(p.patches)) return null;
  return { id: p.id, status: p.status, patches: p.patches as CoachProposal['patches'] };
}

export async function sendCoachMessage(requestId: string, message: string): Promise<SendResult> {
  let response;
  try {
    response = await supabase.functions.invoke('ai-coach', { method: 'POST', body: { requestId, message } });
  } catch {
    return { kind: 'offline' };
  }

  if (response.error) {
    const failure = await failureOf(response.error);
    if (failure.offline) return { kind: 'offline' };
    const code = failure.body?.error;
    if (failure.status === 429 && code === 'AI_LIMIT_REACHED') return { kind: 'limit', resetsAt: text(failure.body?.resetsAt) };
    if (failure.status === 429 && code === 'COACH_RATE_LIMITED') return { kind: 'rate_limited', retryAt: text(failure.body?.retryAt) };
    if (failure.status === 409 && code === 'COACH_IN_PROGRESS') return { kind: 'in_progress' };
    if (failure.status === 503 && code === 'COACH_UNAVAILABLE') return { kind: failure.body?.outcomeUnknown === true ? 'unknown_outcome' : 'unavailable' };
    if (failure.status === 400) return { kind: 'invalid' };
    return { kind: 'error' };
  }

  const data = response.data as Record<string, unknown> | null;
  const reply = text(data?.reply);
  const messageId = text(data?.messageId);
  const language = text(data?.language);
  const id = text(data?.requestId);
  if (!data || reply === null || messageId === null || language === null || id === null) return { kind: 'error' };
  return {
    kind: 'answered',
    refused: data.refused === true,
    proposalDropped: data.proposalDropped === true,
    exchange: { requestId: id, messageId, message, reply, language, createdAt: null, proposal: toProposal(data.proposal) },
  };
}

export async function decideProposal(proposalId: string, decision: 'accept' | 'decline'): Promise<DecideResult> {
  let response;
  try {
    response = await supabase.functions.invoke('decide-coach-proposal', { method: 'POST', body: { proposalId, decision } });
  } catch {
    return { kind: 'offline' };
  }

  if (response.error) {
    const failure = await failureOf(response.error);
    if (failure.offline) return { kind: 'offline' };
    const code = failure.body?.error;
    if (failure.status === 409 && code === 'PROPOSAL_STALE') return { kind: 'stale' };
    if (failure.status === 409 && code === 'DECISION_CONFLICT') return { kind: 'conflict', current: text(failure.body?.current) ?? '' };
    if (failure.status === 404) return { kind: 'not_found' };
    return { kind: 'error' };
  }

  const data = response.data as { status?: unknown; changedDays?: unknown } | null;
  if (data?.status === 'declined') return { kind: 'declined' };
  if (data?.status === 'accepted' && Array.isArray(data.changedDays)) return { kind: 'accepted', changedDays: data.changedDays as number[] };
  return { kind: 'error' };
}

// The account's own exchanges and their proposals, oldest first. Row-level security limits both reads to the
// signed-in member; the user id filter is explicit as well. Throws when the server cannot be read.
export async function loadHistory(userId: string): Promise<CoachExchange[]> {
  const messages = await supabase
    .from('coach_messages')
    .select('id, request_id, message, reply, language, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(COACH_HISTORY_LIMIT);
  if (messages.error) throw new Error('history_failed');
  const rows = (messages.data ?? []) as { id: string; request_id: string; message: string; reply: string; language: string; created_at: string }[];

  const proposalRows = rows.length
    ? await supabase.from('coach_proposals').select('id, request_id, patch, status').eq('user_id', userId).in('request_id', rows.map((r) => r.request_id))
    : { data: [], error: null };
  if (proposalRows.error) throw new Error('history_failed');
  const byRequest = new Map(
    ((proposalRows.data ?? []) as { id: string; request_id: string; patch: { patches?: unknown } | null; status: string }[]).map((p) => [
      p.request_id,
      toProposal({ id: p.id, status: p.status, patches: p.patch?.patches }),
    ])
  );

  return rows
    .map((row) => ({
      requestId: row.request_id,
      messageId: row.id,
      message: row.message,
      reply: row.reply,
      language: row.language,
      createdAt: row.created_at,
      proposal: byRequest.get(row.request_id) ?? null,
    }))
    .reverse();
}
