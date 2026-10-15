// The coach history remembered on this phone for one account, so it can be read without a connection. Cleared
// with the rest of the account's cache when the account is deleted (see userCache). Never shared between accounts.
import { readCache, writeCache } from '../cache/userCache';
import { withProposalStatus } from './state';
import type { CoachExchange, ProposalStatus } from './types';

const isExchange = (value: unknown): value is CoachExchange => {
  const e = value as Partial<CoachExchange> | null;
  return !!e && typeof e.requestId === 'string' && typeof e.messageId === 'string' && typeof e.message === 'string' && typeof e.reply === 'string';
};

export async function readCoachCache(userId: string): Promise<CoachExchange[] | null> {
  const cached = await readCache<unknown>(userId, 'coach');
  return Array.isArray(cached) && cached.every(isExchange) ? cached : null;
}

export function writeCoachCache(userId: string, history: CoachExchange[]): Promise<void> {
  return writeCache(userId, 'coach', history);
}

// Records a decision in the saved copy of an account that is no longer the signed-in one.
export async function setCachedProposalStatus(userId: string, proposalId: string, status: ProposalStatus): Promise<void> {
  const cached = await readCoachCache(userId);
  if (cached) await writeCoachCache(userId, withProposalStatus(cached, proposalId, status));
}
