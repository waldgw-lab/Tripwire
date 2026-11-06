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

## Connection blocker

Managed provisioning is unavailable from this session for both OpenAI and
OpenRouter. The setup operation is absent, including in the separate execution
environment, and catalog search returned no OpenRouter connection to attach.
This does not mean Replit lacks managed OpenRouter support; it means setup
could not be performed here.

Only model selection and per-call reservation were saved. **No model request
was made, no fictional connection test passed, and no article was sent.**
Offline fixtures are not a substitute for a real provider connection test.

The user selected Replit's managed mechanism, so do not ask for a personal key.
Replit's documentation gives this manual approval path: Project Editor →
Tools → Connectors → Add new integration → OpenRouter → Approve managed
credentials. Interface labels may vary. Do not manufacture managed credentials
or set their values manually. If OpenRouter is not offered there, retry managed
provisioning in a session where setup is available.

The adapter now explicitly selects OpenRouter, requests a structured-output
capable route, and waits for `AI_INTEGRATIONS_OPENROUTER_BASE_URL` and
`AI_INTEGRATIONS_OPENROUTER_API_KEY` supplied by Replit. It never silently falls
back to a different provider. Once provisioned, restart the API and verify the
health endpoint reports `configured`, still unauthorized and observe-only.
The connection is not verified until a real fictional-text request succeeds.

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
