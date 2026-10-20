// One end-to-end deadline for a provider call. The clock starts before the request and stops only when the whole
// answer has been read, so a server that sends its headers and then stalls on the body cannot hold a request open.
// When it runs out the request is aborted and the call fails as a timeout with an UNKNOWN outcome: the provider may
// already have produced (and billed for) an answer that was never seen, so it must not be regenerated automatically
// under the same request id.
import { CoachProviderError } from './types.ts';

export async function withDeadline<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CoachProviderError('timeout', true, 'coach_provider_timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

// Token counts the provider itself reported for one call. Never estimated, and never a reason to fail a call.
export interface ReportedUsage {
  inputTokens: number;
  outputTokens: number;
}

export function reportUsage(onUsage: ((usage: ReportedUsage) => void) | undefined, usage: ReportedUsage | null): void {
  if (!onUsage || !usage) return;
  try {
    onUsage(usage);
  } catch {
    // A measuring hook must never change the outcome of a coach call.
  }
}

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

export function geminiUsage(data: unknown): ReportedUsage | null {
  const meta = (data as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  const input = count(meta?.promptTokenCount);
  const output = count(meta?.candidatesTokenCount);
  if (input === null || output === null) return null;
  return { inputTokens: input, outputTokens: output + (count(meta?.thoughtsTokenCount) ?? 0) }; // thinking tokens are billed as output
}

export function openAiUsage(data: unknown): ReportedUsage | null {
  const usage = (data as { usage?: Record<string, unknown> } | null)?.usage;
  const input = count(usage?.prompt_tokens);
  const output = count(usage?.completion_tokens);
  return input === null || output === null ? null : { inputTokens: input, outputTokens: output };
}
