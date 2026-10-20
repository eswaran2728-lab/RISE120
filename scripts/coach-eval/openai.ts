// A second CoachProvider for the evaluation only: any OpenAI-compatible chat endpoint (a gateway such as
// OmniRoute, or a provider's compatible API). It uses the same versioned prompts and the same parser as the real
// coach, so the comparison measures the model, not the plumbing. It is NOT wired into the app or any edge
// function. The key travels only in the Authorization header, and no error carries the key or any response text.
import { ReportedUsage, openAiUsage, reportUsage, withDeadline } from '../../supabase/functions/_shared/coach/deadline.ts';
import { buildSystemPrompt, buildUserPrompt } from '../../supabase/functions/_shared/coach/prompt.ts';
import { COACH_LIMITS, CoachContext, CoachProvider, CoachProviderError, CoachReply, CoachValidationError } from '../../supabase/functions/_shared/coach/types.ts';
import { parseCoachOutput, validateMessage } from '../../supabase/functions/_shared/coach/validate.ts';

type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  // Called with the token counts the gateway reported for a call (evaluation only).
  onUsage?: (usage: ReportedUsage) => void;
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): CoachProvider {
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? COACH_LIMITS.providerTimeoutMs;

  return {
    async generate(context: CoachContext, rawMessage: string): Promise<CoachReply> {
      if (!options.baseUrl || !options.apiKey || !options.model) throw new CoachProviderError('misconfigured', false, 'coach_provider_not_configured');
      const message = validateMessage(rawMessage);

      const body = {
        model: options.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(context.language) },
          { role: 'user', content: buildUserPrompt(context, message) },
        ],
        max_tokens: COACH_LIMITS.maxOutputTokens,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      };

      // One deadline covers the request AND reading the whole answer. Exactly one request is ever sent: this adapter has
      // no retry or fallback of its own, so it cannot multiply provider starts.
      const data = await withDeadline(timeoutMs, async (signal) => {
        let response;
        try {
          response = await fetcher(`${options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
            body: JSON.stringify(body),
            signal,
          });
        } catch {
          throw new CoachProviderError('unavailable', true, 'coach_provider_request_failed');
        }
        // Behind a gateway a 5xx or a gateway timeout can arrive after an upstream provider already generated, and
        // billed for, an answer. Only a rejection that cannot have generated one (auth, rate limit, bad request) is
        // a known failure.
        if (!response.ok) throw new CoachProviderError('unavailable', response.status >= 500, `coach_provider_http_${response.status}`);
        try {
          return (await response.json()) as { model?: unknown; choices?: { message?: { content?: unknown } }[] };
        } catch {
          throw new CoachProviderError('invalid', false, 'coach_provider_unreadable');
        }
      });
      reportUsage(options.onUsage, openAiUsage(data));
      // A different model answered: a gateway fallback. Not the evaluated model, so it is not scored as its answer.
      if (typeof data?.model === 'string' && data.model !== options.model) throw new CoachProviderError('invalid', false, 'coach_provider_model_mismatch');
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new CoachProviderError('invalid', false, 'coach_provider_no_answer');
      try {
        return parseCoachOutput(content);
      } catch (error) {
        if (error instanceof CoachValidationError) throw new CoachProviderError('invalid', false, 'coach_provider_bad_output');
        throw error;
      }
    },
  };
}
