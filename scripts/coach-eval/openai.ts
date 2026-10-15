// A second CoachProvider for the evaluation only: any OpenAI-compatible chat endpoint (a gateway such as
// OmniRoute, or a provider's compatible API). It uses the same versioned prompts and the same parser as the real
// coach, so the comparison measures the model, not the plumbing. It is NOT wired into the app or any edge
// function. The key travels only in the Authorization header, and no error carries the key or any response text.
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

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CoachProviderError('timeout', true, 'coach_provider_timeout'));
        }, timeoutMs);
      });

      let response;
      try {
        response = await Promise.race([
          fetcher(`${options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
            body: JSON.stringify(body),
            signal: controller.signal,
          }),
          timedOut,
        ]);
      } catch (error) {
        if (error instanceof CoachProviderError) throw error;
        throw new CoachProviderError('unavailable', true, 'coach_provider_request_failed');
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) throw new CoachProviderError('unavailable', false, `coach_provider_http_${response.status}`);

      let data: { choices?: { message?: { content?: unknown } }[] };
      try {
        data = (await response.json()) as typeof data;
      } catch {
        throw new CoachProviderError('invalid', false, 'coach_provider_unreadable');
      }
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
