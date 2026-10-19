# OmniRoute evaluation for the Rise120 coach (Milestone F1, Task 1)

**Checked: 19 October 2026. Documentation and primary-source review only. Nothing was installed, run, deployed or called; no member data, keys or paid calls were used.**

## Decision

| Question | Decision |
| --- | --- |
| Test OmniRoute with real member data | **No-go** until every item in "What would change this" is met. |
| Add a server adapter and route selector (F1 Task 3) | **Deferred: not built.** The entry condition (Tasks 1 and 2 support a go) is not met. Gemini stays the only provider and the default. |
| Use OmniRoute with synthetic data | **Allowed** with the existing evaluation tool, once an operator, host and eligible paid upstream key exist (none do yet). |
| Production budget | **Unknown.** The RM100 evaluation ceiling is not a production budget (see "Cost and hosting"). |

The decision is "no-go for member data, adapter deferred", not "OmniRoute is unsafe". The documentation describes a capable gateway; what is missing is everything Rise120 would have to add around it, and several documented behaviours conflict with the coach's admission and unknown-outcome rules unless they are constrained and measured first.

## Evidence: OmniRoute

Source repository: https://github.com/diegosouzapw/OmniRoute (MIT). "Doc" means what the project's own pages say; none of it was run or audited.

| Item | Finding | Source | Level |
| --- | --- | --- | --- |
| Release to pin | GitHub Releases lists **v3.8.51** (30 Sep 2026) as Latest; the README on `main` shows branch `release/v3.8.53` and says "What's New v3.8.20 → v3.8.52". The tag, a commit SHA and a Docker image digest must be chosen by a person; I did not resolve a SHA or digest. Never deploy `latest`. | Releases page, README | Doc; **SHA/digest unknown** |
| Supported versions | 3.8.x active, 3.7.x security fixes only, below 3.7.0 unsupported. | `SECURITY.md` | Doc |
| Topology | One Node/Docker service exposing an OpenAI-compatible `/v1/*` API (default port 20128); npm, Docker, source and Electron installs; a headless mode (`OMNIROUTE_HEADLESS=1`) serves only `/v1/*`, health and auth and returns 404 for `/dashboard`. README recommends at least 2 GB container memory for light chat. | README, `.env.example` | Doc |
| Client authentication | Bearer OmniRoute key; API keys are HMAC-signed. **`REQUIRE_API_KEY` defaults to `false`**, so an exposed instance would accept unauthenticated `/v1/*` requests unless it is set to `true` (and the doc says it does not gate `GET /v1/models`). Per-key controls exist (e.g. pin a key to one model). | `.env.example`, `ENVIRONMENT.md`, README | Doc |
| Transport | The service speaks plain HTTP on its port. HTTPS, a firewall and a reverse proxy are the operator's job. `AUTH_COOKIE_SECURE=true` is needed for the dashboard cookie over HTTPS. | `SECURITY.md` | Doc; **no TLS built in as far as read** |
| Credential encryption at rest | Upstream provider credentials are encrypted with AES-256-GCM (scrypt key derivation) **only when `STORAGE_ENCRYPTION_KEY` is set; unset means plaintext passthrough**. The default in `.env.example` is empty. `API_KEY_SECRET` and `JWT_SECRET` are generated if unset. `ENVIRONMENT.md` and `SECURITY.md` describe the two key variables slightly differently (database-wide vs credential fields), so the exact coverage must be tested, not assumed. | `SECURITY.md`, `.env.example`, `ENVIRONMENT.md` | Doc; **conflicting wording** |
| Prompt and response logging | **Not stated.** Documented controls: per-key `noLog` / `NO_LOG_API_KEY_IDS`, `CALL_LOG_RETENTION_DAYS`, `PII_REDACTION_ENABLED` (default `false`), `PII_RESPONSE_SANITIZATION` (default `false`), `CREDENTIAL_REDACTION_ENABLED` (default `false`). Conversation tracking is on unless `OMNIROUTE_DISABLE_CONVERSATION_TRACKING=1`. An hourly call-log export job exists (`OMNIROUTE_LOG_EXPORT_CRON`). No request/response body-capture variable and no log-retention default were found in the files read. | `SECURITY.md`, `.env.example` | **Unknown whether member text is stored, where, or for how long** |
| Telemetry | None found in `.env.example`; the README says the Radar client does not upload prompts or usage. | README | Doc, unverified |
| Retries and fallback | One client request **can** cause several upstream requests: combo fallback to the next target, failover to another connection of the same provider on 429, a cooldown-aware wait-and-redispatch (bounded by `comboCooldownWait`), same-account retries on some 400s, and an early same-account recovery from the throughput watchdog. A circuit breaker and per-connection cooldowns also exist. The docs describe **no setting that guarantees one upstream request per client request** (`forcedModel`, combo size one and `maxAttempts` are not documented for that purpose). `X-OmniRoute-Budget` with `X-OmniRoute-Budget-Fallback: strict` fails a request instead of overspending (HTTP 402) but limits cost, not the number of providers tried. `OMNIROUTE_EMERGENCY_FALLBACK` (off) would reroute to another model on a 402. | `docs/architecture/RESILIENCE_GUIDE.md`, `docs/routing/AUTO-COMBO.md`, `.env.example` | Doc |
| Timeouts | There is **no single documented per-request deadline**. Documented: queue wait `maxWaitMs` (30 s), `executionMaxWaitMs` (600 s) and a fetch-start timeout (10 minutes default). Streaming has content-stall and active-stream watchdogs; the throughput watchdog is off by default. Non-streaming responses have no documented stall watchdog, only the 10-minute backstops and a 64 MB response cap. | `RESILIENCE_GUIDE.md`, `.env.example` | Doc |
| Free-tier claims | "375 providers (150+ free)", ~1.62B tokens a month. The README itself calls this an estimate and "not a token grant from OmniRoute"; some providers are marked `tos: avoid` and excluded from auto-routing; links include affiliate links. | README | Doc, marketing; not relied on |
| Security record | v3.8.51 lists seven security fixes (e.g. constant-time token comparison, auth added to OAuth routes, path traversal in a Codex subpath). The prompt-injection guard is described as a heuristic and "not a complete prompt-injection firewall"; guardrails fail open. A transparent traffic-decryption feature exists and is documented as needing careful review. Vulnerability reports go through a private GitHub advisory (48 h acknowledgement target). | Releases page, `SECURITY.md`, README | Doc; **no independent audit** |
| Admin boundary | Dashboard with password login (optional OIDC), JWT in HttpOnly cookie; route tiers PUBLIC, CLIENT_API, MANAGEMENT. The dashboard manages provider connections and keys, so treat the operator account as a privileged role (my inference; the docs do not enumerate what the dashboard can read). | `SECURITY.md` | Doc |

## Evidence: upstream model

Shortlist: **at most one primary and one backup.**

| | Primary | Backup |
| --- | --- | --- |
| Model | Gemini 2.5 Flash-Lite, **paid tier**, called with a paid-tier key (directly or behind the gateway) | **None shortlisted.** No second provider has been verified, so none is named. |
| Commercial use | Allowed for "professional or business purposes, not consumer use" under the Gemini API Additional Terms. Whether a consumer fitness app counts needs the owner's reading of the terms. | unknown |
| Malaysia / Singapore availability | Both are listed as available regions for the Gemini API. | unknown |
| Account and key | A Google AI Studio / Cloud billing account and key held only as a server secret. | unknown |
| Data handling | **Paid tier:** Google says it does not use prompts or responses to improve products, logs them "for a limited period" only to detect abuse (length not stated) and processes them under a data processing addendum. **Free tier: content is used to improve products and human reviewers may read it, and the terms say not to submit personal information. A free tier is therefore not eligible for member data.** | unknown |
| Price (paid, text) | $0.10 per 1M input tokens, $0.40 per 1M output tokens (pricing page last updated 2026-10-16). Free tier exists but is ineligible for member data. | unknown |
| Terms that need an owner decision | The terms say the services must not be used "in clinical practice, to provide medical advice" and that users should not rely on them for medical or mental-health advice; users must be 18 or older. The coach adjusts calorie and training targets, so the owner must read this against the coach's wording **whether or not a gateway is used**. | unknown |
| Checked | 19 Oct 2026 | not checked |

Free upstream tiers of other providers were **not** assessed and must not be used for member data without the same retention and training-use review. Consumer-session or pooled credentials must not be used at all.

Consequence: because the only verified eligible upstream is a paid Gemini key, a gateway adds an operator, a host and a retention surface without adding a verified provider. A gateway only earns its place if a verified second paid provider exists as the single evaluated backup.

## Cost and hosting budget

No figure below is a measured Rise120 cost; they are bounds to size the question.

- **Gateway host:** at least 2 GB memory per the README, always on, plus operator time, TLS and backups. Price depends on the provider chosen and is **unknown**. This is a fixed monthly cost that direct Gemini does not have.
- **Per coach message (Gemini 2.5 Flash-Lite paid, estimate):** the output is capped at 700 tokens (`COACH_LIMITS.maxOutputTokens`). With an assumed 1,500 input tokens (Malay and Tamil use more tokens per character, so the real figure is higher) the cost is about 1,500 x $0.10/1M + 700 x $0.40/1M = about **$0.00043**. This is the maximum for a successful call; retries and gateway fallback multiply it.
- **Failed and fallback calls:** a gateway can start more than one upstream request per Rise120 request (see the evidence table). Each attempt that reached a provider can bill. Rise120's ledger charges one allowance per request id and today has **no global spend control**: I checked the coach migrations and `ledger.ts`; the only limits are per member.
- **Ceilings needed before any member traffic:** a server-owned daily and monthly spend ceiling counted in provider attempts (not in requests), enforced atomically before a call starts, with a kill switch the owner can flip without a deploy. **None exists.** The ceiling values must live in `app_config`, not in the app.
- **Against the RM100 ceiling:** RM100 is the user's evaluation ceiling. It cannot also pay for an always-on host and uncapped member traffic; it can pay for a synthetic evaluation. Production needs its own written ceiling and a measured per-message cost.

## What would change this to "go"

All of these, written and dated, before member data or an adapter:

1. A named **operator** and a host, with HTTPS, a firewall, `REQUIRE_API_KEY=true`, `STORAGE_ENCRYPTION_KEY` set and tested (provider credentials verified not to be readable in the database file), headless mode, a non-root container and the dashboard reachable only by the operator.
2. A pinned release **SHA and image digest**, reviewed, with upgrade and rollback steps.
3. A **measured** answer to: does the gateway store prompts or replies, where and for how long; can storage be turned off (per-key `noLog`, no conversation tracking) and verified by inspecting the instance.
4. A verified way to make **one Rise120 request equal one upstream request**: either fallback is provably off for the route, or every attempt is counted against the spend ceiling. Until measured, assume it can multiply.
5. A written **upstream decision** for each provider (terms, retention, training use, region, price, the medical-advice clause), with a paid, no-training tier for the primary and a verified backup if one is wanted.
6. **Measured** English, Malay and Tamil quality and structured-output validity on the evaluation scenarios, with native-speaker review of Malay and Tamil.
7. A **server-owned spend reservation and kill switch** (new migration with live tests), and an owner-set daily and monthly ceiling.
8. An **incident procedure** (below) with an owner who can run it.

## Kill switch and incident procedure (design for when a route exists)

- Route selection is a server-side value (a secret or `app_config` key), default Gemini. Setting it back to Gemini, or to "coach off", takes effect on the next request with no app release.
- Suspected key leak: rotate the gateway key and the upstream key, set the route to Gemini or off, review the gateway's logs without copying prompt text into tickets, and tell the owner before telling members.
- Suspected prompt retention or breach: disable the route, stop and preserve the instance, decide on member notification with the owner and the applicable privacy law.
- Cost anomaly: the spend ceiling trips and the coach answers "unavailable" without charging the member's allowance (already the behaviour when no provider is configured).
- Nobody is assigned to this today; that is a gate, not a detail.

## Findings about the code as it is today

These come from reading `gemini.ts` and the evaluation adapter while checking the review points. They are addressed in Task 2 (tests first).

1. **Deadline covers headers only.** Both adapters clear their timer in `finally` as soon as `fetch` resolves, then call `response.json()` with no deadline. A server that sends headers and then stalls the body would hang until the platform's own limit, with the request id still reserved. The fix is one end-to-end deadline across fetch and body read, still reported as `timeout` with an unknown outcome.
2. **Unknown outcome classification.** A transport error or timeout is `outcomeUnknown: true` and not auto-retried; an HTTP error response is `outcomeUnknown: false` (the request is released and not charged). For a gateway, an HTTP 5xx after the gateway accepted the request may still have produced a billable answer upstream; the plan's review focus 3 says not to retry it automatically under the same request id. Treating a gateway's HTTP 5xx and 504 as unknown outcome is the cautious rule for any future gateway adapter and is encoded in the evaluation adapter's tests in Task 2.
3. **No provider-reported usage.** The evaluation estimates tokens as characters divided by four, which understates Malay and Tamil. Task 2 records provider-reported tokens when the provider returns them.

## Sources (read 19 October 2026)

- https://github.com/diegosouzapw/OmniRoute (README, Releases page)
- https://github.com/diegosouzapw/OmniRoute/blob/main/SECURITY.md
- https://github.com/diegosouzapw/OmniRoute/blob/main/.env.example
- https://github.com/diegosouzapw/OmniRoute/blob/main/docs/reference/ENVIRONMENT.md
- https://github.com/diegosouzapw/OmniRoute/blob/main/docs/architecture/RESILIENCE_GUIDE.md
- https://github.com/diegosouzapw/OmniRoute/blob/main/docs/routing/AUTO-COMBO.md
- https://ai.google.dev/gemini-api/terms
- https://ai.google.dev/gemini-api/docs/available-regions
- https://ai.google.dev/gemini-api/docs/pricing

Each fetched page was summarised by a reading tool and several were truncated; the table marks anything not confirmed as unknown. Read the exact lines again before relying on any single item for a launch decision.
