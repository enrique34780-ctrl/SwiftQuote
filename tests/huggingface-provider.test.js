import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIProvider } from '../ai-provider.js';

test('Hugging Face compatible endpoint uses server-side bearer token and strict no-fallback mode', async () => {
  let cloudCalls = 0;
  let requestedUrl = '';
  let sentHeaders;
  let sentBody;
  const provider = createAIProvider({
    mode: 'compatible-only',
    compatibleBaseUrl: 'https://router.huggingface.co/v1',
    compatibleApiKey: 'hf-test-token',
    compatibleModel: 'openai/gpt-oss-20b:fastest',
    openaiApiKey: 'must-not-be-used',
    openai: { responses: { create: async () => { cloudCalls++; return { output_text: 'cloud fallback' }; } } },
    geminiApiKey: 'must-not-be-used',
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      sentHeaders = options.headers;
      sentBody = JSON.parse(options.body);
      assert.equal(options.redirect, 'error');
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'hosted open-weight answer' } }] }),
      };
    },
  });

  assert.equal(provider.mode, 'compatible-only');
  assert.equal(provider.configured, true);
  assert.equal(provider.providers.compatible, true);
  assert.equal(await provider.generateText({ user: 'Reply with a short test response.' }), 'hosted open-weight answer');
  assert.equal(requestedUrl, 'https://router.huggingface.co/v1/chat/completions');
  assert.equal(sentHeaders.authorization, 'Bearer hf-test-token');
  assert.equal(sentBody.model, 'openai/gpt-oss-20b:fastest');
  assert.equal(sentBody.stream, false);
  assert.equal(cloudCalls, 0);
});

test('Hugging Face endpoint failure in strict mode never falls back to OpenAI or Gemini', async () => {
  let cloudCalls = 0;
  const provider = createAIProvider({
    mode: 'compatible-only',
    compatibleBaseUrl: 'https://router.huggingface.co/v1',
    compatibleApiKey: 'hf-test-token',
    compatibleModel: 'openai/gpt-oss-20b:fastest',
    openaiApiKey: 'must-not-be-used',
    openai: { responses: { create: async () => { cloudCalls++; return { output_text: 'cloud fallback' }; } } },
    geminiApiKey: 'must-not-be-used',
    fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'quota exceeded' }) }),
  });

  await assert.rejects(() => provider.generateText({ user: 'test' }), /Configured AI providers were unavailable/);
  assert.equal(cloudCalls, 0);
});
