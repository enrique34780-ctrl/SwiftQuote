import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

let child;
let baseUrl;
let tempDir;
let output = '';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'swiftquote-test-'));
  const port = await freePort();
  baseUrl = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DB_PATH: path.join(tempDir, 'test.sqlite'),
      APP_ORIGIN: '',
      TRUST_PROXY_HOPS: '0',
      SESSION_SECRET: 'test-only-session-secret-12345678901234567890',
      ADMIN_PASSWORD: 'test-only-admin-password-123456'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(baseUrl + '/api/health', { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'server failed to start. Output: ' + output);
}, { timeout: 25000 });

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

test('health endpoint checks the database', async () => {
  const response = await fetch(baseUrl + '/api/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.app, 'SwiftQuote');
});

test('marketplace API returns service categories and showcase safely', async () => {
  const servicesResponse = await fetch(baseUrl + '/api/marketplace/services');
  assert.equal(servicesResponse.status, 200);
  const services = await servicesResponse.json();
  assert.ok(Array.isArray(services.services));
  assert.ok(services.services.length > 0);
  assert.ok(services.services.every(item => item.id && item.label && item.industry));

  const showcaseResponse = await fetch(baseUrl + '/api/marketplace/showcase');
  assert.equal(showcaseResponse.status, 200);
  assert.ok(Array.isArray((await showcaseResponse.json()).posts));
});

test('service, provider, and showcase pages are served', async () => {
  for (const route of ['/service.html', '/provider.html', '/showcase.html']) {
    const response = await fetch(baseUrl + route);
    assert.equal(response.status, 200, route + ' should load');
    assert.match(response.headers.get('content-type') || '', /text\/html/);
  }
});

test('invalid public provider contact data is rejected without reserving the email', async () => {
  const payload = {
    name: 'SwiftQuote Test Provider',
    email: 'provider-smoke@example.test',
    password: 'ValidSmokeTestPassword123!',
    accountType: 'provider',
    publicEmail: 'not-an-email'
  };
  const invalid = await fetch(baseUrl + '/api/account/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify(payload)
  });
  assert.equal(invalid.status, 400);

  const valid = await fetch(baseUrl + '/api/account/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ ...payload, publicEmail: 'contact@example.test' })
  });
  assert.equal(valid.status, 201, await valid.text());
});

test('showcase publishing rejects unauthenticated requests', async () => {
  const response = await fetch(baseUrl + '/api/provider/showcase', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ type: 'project', title: 'Test', mediaUrl: 'https://example.com/work' })
  });
  assert.equal(response.status, 401);
});
