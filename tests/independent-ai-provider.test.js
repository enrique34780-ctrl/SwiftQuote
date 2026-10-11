import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIProvider } from '../ai-provider.js';

test('configured self-hosted compatible model is preferred over commercial providers', async () => {
  let localCalls = 0;
  let cloudCalls = 0;
  const provider = createAIProvider({
    openaiApiKey: 'test-key',
    openai: { responses: { create: async () => { cloudCalls++; return { output_text: 'cloud answer' }; } } },
    compatibleBaseUrl: 'http://127.0.0.1:11434/v1',
    compatibleModel: 'llama3.1',
    fetchImpl: async (url, options) => {
      localCalls++;
      assert.equal(url, 'http://127.0.0.1:11434/v1/chat/completions');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'llama3.1');
      assert.equal(body.stream, false);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'local answer' } }] }) };
    },
  });

  assert.equal(provider.configured, true);
  assert.equal(provider.providers.compatible, true);
  assert.equal(await provider.generateText({ user: 'Hello' }), 'local answer');
  assert.equal(localCalls, 1);
  assert.equal(cloudCalls, 0);
});

test('self-hosted compatible provider does not fall back to cloud when no cloud provider is configured', async () => {
  const provider = createAIProvider({
    compatibleBaseUrl: 'http://127.0.0.1:11434/v1',
    compatibleModel: 'llama3.1',
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  await assert.rejects(() => provider.generateText({ user: 'Private prompt' }), /Configured AI providers were unavailable/);
});

test('invalid self-hosted base URLs are not marked as configured', () => {
  const provider = createAIProvider({
    compatibleBaseUrl: 'http://user:password@127.0.0.1:11434/v1',
    compatibleModel: 'llama3.1',
  });
  assert.equal(provider.configured, false);
  assert.equal(provider.providers.compatible, false);
});
