// The Supabase side of the coach ledger: the service-role operations from the coach_ledger migrations, plus
// reading back a stored exchange. The user id must come from a verified token.
import type { FinishInput, LedgerPort, StoredExchange } from './handler.ts';
import type { CoachProposalPatch } from './types.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export function createLedger(db: Db): LedgerPort {
  return {
    async reserve(userId, requestId) {
      const { data, error } = await db.rpc('coach_reserve_request', { p_user_id: userId, p_request_id: requestId });
      if (error || !data) throw new Error('reserve_failed');
      return { status: data.status, resetsAt: data.resets_at };
    },

    async finish(userId, requestId, input: FinishInput) {
      const { data, error } = await db.rpc('coach_finish_request', {
        p_user_id: userId,
        p_request_id: requestId,
        p_message: input.message,
        p_reply: input.reply,
        p_language: input.language,
        p_proposal: input.proposal,
      });
      if (error || !data) throw new Error('finish_failed');
      return { status: data.status };
    },

    async fail(userId, requestId) {
      const { error } = await db.rpc('coach_fail_request', { p_user_id: userId, p_request_id: requestId });
      if (error) throw new Error('fail_failed');
    },

    async loadStored(userId, requestId): Promise<StoredExchange | null> {
      const message = await db
        .from('coach_messages')
        .select('id, reply, language')
        .eq('user_id', userId)
        .eq('request_id', requestId)
        .maybeSingle();
      if (message.error || !message.data) return null;
      const proposal = await db
        .from('coach_proposals')
        .select('id, patch, status')
        .eq('user_id', userId)
        .eq('request_id', requestId)
        .maybeSingle();
      if (proposal.error) return null;
      return {
        messageId: message.data.id,
        reply: message.data.reply,
        language: message.data.language,
        proposal: proposal.data
          ? { id: proposal.data.id, status: proposal.data.status, patches: (proposal.data.patch?.patches ?? []) as CoachProposalPatch[] }
          : null,
      };
    },
  };
}
