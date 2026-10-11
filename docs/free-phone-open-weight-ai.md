# Free phone-only setup for SwiftQuote's open-weight AI

This path is intended for someone who has only a phone and cannot run a model server locally. SwiftQuote already supports OpenAI-compatible chat endpoints, so this setup does not require a new dependency or a change to the existing marketplace.

## Important free-tier limit

Hugging Face Inference Providers currently lists **$0.10 in monthly credits for free accounts**, and says this amount can change. That is a small trial allowance, not unlimited production hosting. Check the current pricing page before enabling it: https://huggingface.co/docs/inference-providers/pricing

To keep this project at **$0 new cost**:
- Do not buy credits, upgrade the account, or enable any auto-reload/top-up feature.
- Stop using the hosted model when the included free allowance is exhausted. Availability, speed, eligible models, and quota can change.
- If the provider reports that the quota/credits are exhausted, leave AI disabled or wait for the allowance to reset. Do not add a payment method just to keep it running.
- This is hosted inference of an open-weight model, not a model running on SwiftQuote's Render server and not a foundation model trained from scratch.

## Set it up from your phone

1. Create or sign in to a Hugging Face account at https://huggingface.co/.
2. Open https://huggingface.co/settings/tokens and create a fine-grained access token with the **Make calls to Inference Providers** permission only. Treat it like a password.
3. Browse the Inference Providers model catalog at https://huggingface.co/models?inference_provider=all and choose a chat model that is currently available to your account. Copy its exact model ID. A model shown in a catalog is not a guarantee that every provider or model has free capacity.
4. Open the SwiftQuote Render service's **Environment** settings. Add/update the following variables (use the exact model ID you selected):

   - `AI_BASE_URL` = `https://router.huggingface.co/v1`
   - `AI_API_KEY` = your Hugging Face token (secret; never put it in frontend code or a chat message)
   - `AI_MODEL` = the exact model ID from step 3, optionally with a supported routing suffix such as `:fastest`
   - `AI_PROVIDER_MODE` = `compatible-only`

5. Save changes and let Render redeploy. The strict mode prevents SwiftQuote from falling back to OpenAI or Gemini, even if their keys remain configured. If the Hugging Face endpoint is unavailable or the free allowance is exhausted, AI requests should fail rather than silently use a commercial fallback.
6. Open https://swiftquote-4k5x.onrender.com/api/config and verify that the response reports `aiProviderMode: "compatible-only"` and AI configured/readiness as true. This only confirms that settings are present, **not** that the remote model has successfully answered a prompt.
7. Then open https://swiftquote-4k5x.onrender.com/assistant.html and send a short harmless test prompt. A successful answer is the end-to-end check. If it fails, check Render logs for the request failure; never paste the token into logs, source code, or this chat.

## Privacy and security

- The Hugging Face token must remain only in Render's server-side environment variables. Never add it to `app.js`, HTML, browser storage, screenshots, GitHub commits, or a public issue.
- `compatible-only` is the privacy guard against fallback to OpenAI/Gemini. It does not mean the hosted inference provider cannot process prompts; prompts are sent to the selected hosted provider to generate responses. Do not send sensitive customer information unless you have reviewed the provider's current terms and data handling.
- Use the minimum token permission needed, and revoke the token if it is exposed.
- Do not create paid Render services or inference endpoints. This guide requires no code replacement, no database migration, and no paid infrastructure.

## Current limitations

The free allowance is very small and may only support light testing. It is not enough to promise always-on production AI for all customers. SwiftQuote's local deterministic planning/validation helpers remain separate from the language model and are not a replacement for a general-purpose LLM.
