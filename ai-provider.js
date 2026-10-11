/**
 * SwiftQuote AI provider router.
 * Supports OpenAI, Gemini, and OpenAI-compatible endpoints (including Ollama).
 * When a compatible endpoint is configured, prefer it first so a self-hosted
 * open-weight model can run without sending prompts to a commercial API.
 * All credentials remain server-side. Provider output is untrusted input and must
 * be validated by the feature that consumes it.
 */
function boundedText(value, max) {
  return String(value ?? '').slice(0, max);
}

function normalizeBaseUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function createAIProvider({
  openai = null,
  openaiApiKey = '',
  openaiModel = 'gpt-4.1-mini',
  geminiApiKey = '',
  geminiModel = 'gemini-3.8-flash',
  compatibleBaseUrl = '',
  compatibleApiKey = '',
  compatibleModel = 'llama3.1',
  fetchImpl = globalThis.fetch,
  timeoutMs = 12_000,
} = {}) {
  const hasOpenAI = Boolean(openai && openaiApiKey);
  const hasGemini = Boolean(geminiApiKey);
  const baseUrl = normalizeBaseUrl(compatibleBaseUrl);
  const hasCompatible = Boolean(baseUrl && compatibleModel);
  const configured = hasOpenAI || hasGemini || hasCompatible;

  async function fetchWithDeadline(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
      return { response, clear: () => clearTimeout(timer) };
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }

  async function generateCompatible({ systemPrompt, safeMessages, maxTokens, json }) {
    const endpoint = /\/v1$/i.test(baseUrl) ? baseUrl + '/chat/completions' : baseUrl + '/v1/chat/completions';
    const headers = { 'content-type': 'application/json' };
    if (compatibleApiKey) headers.authorization = `Bearer ${compatibleApiKey}`;
    const { response, clear } = await fetchWithDeadline(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: compatibleModel,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          ...safeMessages,
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        stream: false,
      }),
    });
    try {
      if (!response.ok) throw new Error('Compatible AI request failed');
      const data = await response.json();
      const output = String(data?.choices?.[0]?.message?.content ?? '').trim();
      if (!output) throw new Error('Compatible AI returned empty output');
      return output;
    } finally {
      clear();
    }
  }

  return {
    configured,
    providers: { openai: hasOpenAI, gemini: hasGemini, compatible: hasCompatible },
    async generateText({ system, user, messages = null, maxOutputTokens = 512, json = false } = {}) {
      const systemPrompt = boundedText(system, 12_000);
      const userPrompt = boundedText(user, 12_000);
      const safeMessages = Array.isArray(messages)
        ? messages.slice(-12).map(item => ({
            role: item?.role === 'assistant' ? 'assistant' : 'user',
            content: boundedText(item?.content, 4_000),
          })).filter(item => item.content.trim())
        : [{ role: 'user', content: userPrompt }];
      const maxTokens = Math.max(32, Math.min(3_000, Math.trunc(Number(maxOutputTokens) || 512)));
      const failures = [];

      // If a self-hosted/open-weight endpoint is configured, prefer it before
      // commercial providers. This avoids sending prompts to cloud APIs unless
      // the self-hosted endpoint fails and a cloud provider is also configured.
      if (hasCompatible) {
        try {
          return await generateCompatible({ systemPrompt, safeMessages, maxTokens, json });
        } catch {
          failures.push('Compatible AI request failed');
        }
      }

      if (hasOpenAI) {
        try {
          const input = [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            ...safeMessages,
          ];
          const result = await openai.responses.create({
            model: openaiModel,
            store: false,
            max_output_tokens: maxTokens,
            input,
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
          const { response, clear } = await fetchWithDeadline(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiApiKey },
              body: JSON.stringify({
                ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
                contents: safeMessages.map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })),
                generationConfig: {
                  maxOutputTokens: maxTokens,
                  ...(json ? { responseMimeType: 'application/json' } : {}),
                },
              }),
            },
          );
          try {
            if (!response.ok) throw new Error('Gemini request failed');
            const data = await response.json();
            const output = Array.isArray(data?.candidates?.[0]?.content?.parts)
              ? data.candidates[0].content.parts.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim()
              : '';
            if (output) return output;
            failures.push('Gemini returned empty output');
          } finally { clear(); }
        } catch {
          failures.push('Gemini request failed');
        }
      }

      if (!configured) throw new Error('AI is not configured');
      throw new Error(failures.length ? 'Configured AI providers were unavailable' : 'AI request failed');
    },
  };
}
