// Gemini adapter behind the CoachProvider interface. Server only: the API key and model name come from server
// secrets (the caller passes them in), never from the app or Git. Nothing here logs prompts, replies or the key,
// and an error message never carries the key or any part of the response body.
import { SAFE_FALLBACK, buildSystemPrompt, buildUserPrompt } from './prompt.ts';
import { COACH_LIMITS, CoachContext, CoachProvider, CoachProviderError, CoachReply, CoachValidationError } from './types.ts';
import { parseCoachOutput, validateMessage } from './validate.ts';

type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const SAFETY_CATEGORIES = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'];
// Finish reasons that mean the provider declined to answer.
const REFUSAL_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

// Structured output hint for the model. The validator, not this schema, decides what is acceptable.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    proposal: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        patches: {
          type: 'ARRAY',
          maxItems: COACH_LIMITS.maxPatches,
          items: {
            type: 'OBJECT',
            properties: {
              dayNumber: { type: 'INTEGER' },
              calorieTarget: { type: 'INTEGER' },
              proteinTargetG: { type: 'INTEGER' },
              workout: {
                type: 'OBJECT',
                properties: {
                  kind: { type: 'STRING', enum: ['workout'] },
                  exercises: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: { exercise_id: { type: 'STRING' }, sets: { type: 'INTEGER' }, reps: { type: 'INTEGER' } },
                      required: ['exercise_id', 'sets', 'reps'],
                    },
                  },
                },
                required: ['kind', 'exercises'],
              },
            },
            required: ['dayNumber'],
          },
        },
      },
      required: ['patches'],
    },
  },
  required: ['reply'],
};

export function createGeminiProvider(options: GeminiOptions): CoachProvider {
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? COACH_LIMITS.providerTimeoutMs;

  return {
    async generate(context: CoachContext, rawMessage: string): Promise<CoachReply> {
      if (!options.apiKey || !options.model) throw new CoachProviderError('misconfigured', false, 'coach_provider_not_configured');
      const message = validateMessage(rawMessage);

      const body = {
        systemInstruction: { parts: [{ text: buildSystemPrompt(context.language) }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(context, message) }] }],
        generationConfig: {
          maxOutputTokens: COACH_LIMITS.maxOutputTokens,
          temperature: 0.3,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
        safetySettings: SAFETY_CATEGORIES.map((category) => ({ category, threshold: 'BLOCK_MEDIUM_AND_ABOVE' })),
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
          fetcher(`${ENDPOINT}/${options.model}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
            body: JSON.stringify(body),
            signal: controller.signal,
          }),
          timedOut,
        ]);
      } catch (error) {
        if (error instanceof CoachProviderError) throw error;
        // The request may have been processed even though we never saw the answer.
        throw new CoachProviderError('unavailable', true, 'coach_provider_request_failed');
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) throw new CoachProviderError('unavailable', false, `coach_provider_http_${response.status}`);

      let data: Record<string, any>;
      try {
        data = (await response.json()) as Record<string, any>;
      } catch {
        throw new CoachProviderError('invalid', false, 'coach_provider_unreadable');
      }

      const refusal: CoachReply = { text: SAFE_FALLBACK[context.language], proposal: null, refused: true };
      if (data?.promptFeedback?.blockReason) return refusal;
      const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : undefined;
      if (!candidate) throw new CoachProviderError('invalid', false, 'coach_provider_no_answer');
      if (REFUSAL_REASONS.has(candidate.finishReason)) return refusal;
      if (candidate.finishReason === 'MAX_TOKENS') throw new CoachProviderError('invalid', false, 'coach_provider_truncated');

      const parts: unknown[] = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
      const text = parts.map((part) => (part as { text?: unknown }).text).filter((t): t is string => typeof t === 'string').join('');
      try {
        return parseCoachOutput(text);
      } catch (error) {
        if (error instanceof CoachValidationError) throw new CoachProviderError('invalid', false, 'coach_provider_bad_output');
        throw error;
      }
    },
  };
}
