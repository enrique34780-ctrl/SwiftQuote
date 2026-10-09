/**
 * Optional OpenAI/Gemini text provider with bounded timeouts and server-side keys.
 * OpenAI is preferred when configured; Gemini is a fallback or standalone option.
 */
export function createAIProvider({
  openai = null,
  openaiApiKey = '',
  openaiModel = 'gpt-4.1-mini',
  geminiApiKey = '',
  geminiModel = 'gemini-3.8-flash',
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
} = {}) {
  const hasOpenAI = Boolean(openai && openaiApiKey);
  const hasGemini = Boolean(geminiApiKey);
  return {
    configured: hasOpenAI || hasGemini,
    providers: { openai: hasOpenAI, gemini: hasGemini },
    async generateText({ system, user, maxOutputTokens = 256, json = false }) {
      const prompts = {
        system: String(system ?? '').slice(0, 12_000),
        user: String(user ?? '').slice(0, 12_000),
      };
      const maxTokens = Math.max(32, Math.min(2_000, Math.trunc(Number(maxOutputTokens) || 256)));
      const failures = [];

      if (hasOpenAI) {
        try {
          const result = await openai.responses.create({
            model: openaiModel,
            store: false,
            max_output_tokens: maxTokens,
            input: [
              { role: 'system', content: prompts.system },
              { role: 'user', content: prompts.user },
            ],
            ...(json ? { text: { format: { type: 'json_object' } } } : {}),
          });
          const output = String(result?.output_text ?? '').trim();
          if (output) return output;
          failures.push('OpenAI returned empty output');
        } catch {
          failures.push('OpenAI request failed');
        }
      }

      if (hasGemini) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
            const response = await fetchImpl(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiApiKey },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: prompts.system }] },
                contents: [{ role: 'user', parts: [{ text: prompts.user }] }],
                generationConfig: {
                  maxOutputTokens: maxTokens,
                  ...(json ? { responseMimeType: 'application/json' } : {}),
                },
              }),
              signal: controller.signal,
              redirect: 'error',
            });
            if (!response?.ok) throw new Error('Gemini request failed');
            // Keep the deadline active while reading the response body too.
            const data = await response.json();
            const output = Array.isArray(data?.candidates?.[0]?.content?.parts)
              ? data.candidates[0].content.parts.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim()
              : '';
            if (output) return output;
            failures.push('Gemini returned empty output');
          } finally {
            clearTimeout(timer);
          }
        } catch {
          failures.push('Gemini request failed');
        }
      }

      if (!this.configured) throw new Error('AI is not configured');
      throw new Error(failures.length ? 'Configured AI providers were unavailable' : 'AI request failed');
    },
  };
}
