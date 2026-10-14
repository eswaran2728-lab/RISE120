// Turns the database's stable quota refusal into a typed pending reason. The refusal is not a failure of
// the operation: the log stays queued under its own id and syncs when the server has capacity again.
export interface PendingLimit {
  kind: 'limit';
  limit: 'food';
  resetsAt: string | null; // ISO instant of the next 00:00 UTC, as sent by the server; null if unreadable
}

const FOOD_LIMIT_MESSAGE = 'FOOD_LIMIT_REACHED';

export class QuotaLimitError extends Error {
  readonly reason: PendingLimit;

  constructor(reason: PendingLimit) {
    super(FOOD_LIMIT_MESSAGE);
    this.name = 'QuotaLimitError';
    this.reason = reason;
    Object.setPrototypeOf(this, QuotaLimitError.prototype);
  }
}

export function quotaErrorFrom(error: { message?: string; hint?: string | null; code?: string } | null | undefined): QuotaLimitError | null {
  if (!error || error.message !== FOOD_LIMIT_MESSAGE) return null;
  const parsed = typeof error.hint === 'string' ? Date.parse(error.hint) : NaN;
  return new QuotaLimitError({ kind: 'limit', limit: 'food', resetsAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null });
}
