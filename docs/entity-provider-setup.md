# Entity discovery provider setup

## Approved preparation

- Pilot ceiling: **$1 per UTC day**, for entity extraction only. This is not an
  account-wide Replit spending limit.
- Selected route: **Replit-managed OpenRouter** (not a personal API key).
- Selected catalog model: `openai/gpt-5.4-mini`.
- Conservative cost reservation: **$0.10 per attempt**, including failed or
  interrupted attempts whose charges are uncertain. No refunds are inferred.
- Token allowance: **750,000 per UTC day**, allowing ten worst-case
  74,192-token reservations; the dollar allowance also limits attempts to ten.
- Inputs stay bounded to 16,000 UTF-16 characters and output to 8,192 tokens.
- Processing remains unauthorized and observe-only. Private paste/upload
  material is not authorized. Autonomous decisions remain blocked.

The selected model's published standard text prices were checked on
2026-11-06: $0.75 per million input tokens and $4.50 per million output tokens.
The existing conservative reservation bounds input at 66,000 tokens including
overhead, plus 8,192 output tokens: $0.086364 before the $0.10 rounding margin.
No tools, images, regional-processing premium or external search are enabled.
Recheck rates and caps before changing models or allowing additional features.

Reference: https://developers.openai.com/api/docs/models/gpt-5.4-mini
OpenRouter's live model catalog also lists this identifier, the same prompt and
completion prices, and structured-output support:
https://openrouter.ai/api/v1/models

## Managed connection check — 2026-11-06

The main Agent's normal `setupReplitAIIntegrations` operation was available and
successfully provisioned managed OpenRouter. Before provisioning, the managed
credentials were absent: the earlier model/blueprint selection had not connected
the provider. The previous isolated session's missing setup operation was an
environment limitation, not a requirement for manual credentials or another chat.
No personal API key was requested or substituted.

**Exactly one real fictional-text request was made.** It used the existing
extraction adapter, SDK retries disabled and OpenRouter fallbacks disabled.
Before the request, a row-locked transaction reserved $0.10 and 74,192 tokens
against the actual daily automation budget. A durable attempt identifier blocks
accidental repetition, including after a failed response validation.

The only model input was:

> Mira Vale leads the fictional Lumen Agency.

The response identified `openai/gpt-5.4-mini` and reported:

- 620 prompt tokens, 324 completion tokens, 944 total tokens;
- no cached input or reasoning tokens;
- usage cost **$0.001923**, comprising $0.000465 prompt and $0.001458 completion;
- `is_byok: false`, consistent with the managed rather than personal-key route.

**The full validation test failed; the provider connection is NOT verified.**
The adapter received a real model response but rejected it during its completion/
extraction validation. The initial diagnostic runner retained usage, but did not
retain the rejected output or precise validation message. Therefore neither the
exact rejected field nor successful evidence-quotation validation can honestly
be certified from that attempt. No additional model request was made.

The runner now preserves finish reason, fictional output and validation details
on any future explicitly approved test. This instrumentation is opt-in and is
not used to log real capture text. Do not rerun the model test without approval.
The isolated runner is `artifacts/api-server/src/scripts/entity-connection-test.ts`;
its result is journaled in the entity control log, not in the entity registry.

Post-test database checks confirmed observe-only mode, global processing
authorization false, private-material authorization false, zero article model
attempts and no fictional registry rows. Daily reservations remain **$0.10 and
74,192 tokens**; the smaller reported model cost does not refund the conservative
reservation. The $1/day and 750,000-token limits remain unchanged.

The health endpoint's `configured` status means managed settings are present,
not that the fictional validation test passed. No activation manifest was
created. The remaining immediate blocker is diagnosing and passing strict
completion/schema/exact-evidence validation in a separately authorized test.

Platform reference:
https://docs.replit.com/features/integrations/replit-ai-integrations

Do not enable global capture authorization to test one fictional excerpt. The
smoke test must be isolated, reserve its budget, send only the approved
fictional text, validate exact quotations, and leave real processing disabled.

## Remaining after a successful fictional test

Use the existing proposed private reporting trial task and
`docs/entity-automation-release-checklist.md`. Approve a small real-reporting
sample; measure costs, evidence offsets, false matches, attribution, duplicate
developments and priority quality. Then calibrate the policy. Verify actual
published private access and always-on hosting separately, and obtain explicit
activation approval. Do not create the approval manifest before those checks
are performed.

## Bounded private-trial approval — 2026-11-10

The user explicitly approved the capped private, observe-only monitoring trial:

- Replit-managed provider usage for a small, reviewed sample of public reporting,
  subject to the existing release-checklist prerequisites.
- Maximum **$1 per UTC day**, **$0.10 reserved per attempt**, and **750,000
  reserved tokens per UTC day**. Uncertain or failed attempts retain their
  reservations.
- Diagnose and pass the fictional connection test before any real-reporting
  trial. This approval permits that prerequisite test; it does not establish
  that it passed or that the provider connection is verified.
- Private paste/upload material remains excluded. Do not turn on unrestricted
  archive processing or global capture authorization to perform the trial.
- No publishing/deployment, autonomous decisions, separate paid X plan, or
  increase to the approved limits is authorized.

This is an approval record, not evidence of execution, access verification,
calibration or activation. The existing active private-reporting-trial work
remains responsible for satisfying and recording those prerequisites; no
duplicate trial has been started from this approval record.
