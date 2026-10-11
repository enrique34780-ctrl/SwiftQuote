# SwiftQuote independent AI (Ollama / open-weight models)

SwiftQuote's server already has an OpenAI-compatible model adapter. It can call a self-hosted Ollama instance without an OpenAI or Gemini API key. This change makes that compatible endpoint the **first-choice provider** whenever `AI_BASE_URL` is configured.

## 1. Run a model on a machine you control

Install Ollama from https://ollama.com/download, then run:

```sh
ollama pull llama3.1
ollama run llama3.1
```

Keep Ollama running. Its OpenAI-compatible API is usually available at `http://127.0.0.1:11434/v1`.

## 2. Configure SwiftQuote

Set these environment variables for a SwiftQuote server running on the **same machine** as Ollama:

```dotenv
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=llama3.1
AI_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
```

Restart SwiftQuote after changing environment variables. The app's `/api/config` endpoint reports only whether AI is configured; it must never expose secrets.

## Important deployment note

`127.0.0.1` always means the machine/container SwiftQuote is running in, not your phone or personal computer. A SwiftQuote service hosted on Render cannot reach Ollama running on your home computer through that URL. For Render, run the model on a separate machine/service you control and connect it through a private network or a securely authenticated encrypted tunnel. Do **not** expose Ollama's unauthenticated port directly to the public internet. Use a strong access layer, restrict inbound access, and keep credentials in server-side environment variables.

If only `AI_BASE_URL` is configured and the model server is unavailable, SwiftQuote returns a provider error rather than silently sending prompts to a commercial API. If commercial provider keys are also configured, the current router can fall back to them after the preferred compatible endpoint fails. Remove those keys if you require strict no-commercial-API behavior.

## What this does and does not do

- The open-weight model runs inference; SwiftQuote owns the routing, research, product integration, and safety checks.
- This is not training a new foundation model from scratch.
- Quality and speed depend on the chosen model and hardware.
- The current research engine can still use public web sources; model hosting and web research are separate features.
- Do not send confidential customer data to an endpoint unless you control its security and retention settings.
