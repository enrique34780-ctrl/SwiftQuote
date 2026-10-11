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
      ADMIN_PASSWORD: 'test-only-admin-password-123456',
      STRIPE_WEBHOOK_SECRET: 'test-only-stripe-webhook-secret-1234567890'
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

test('signed Stripe subscription checkout activates only the correct provider account', async () => {
  const payload = {
    name: 'Stripe Smoke Provider',
    email: 'stripe-provider@example.test',
    password: 'ValidSmokeTestPassword123!',
    accountType: 'provider'
  };
  const register = await fetch(baseUrl + '/api/account/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify(payload)
  });
  assert.equal(register.status, 201);
  const account = await register.json();
  const cookie = (register.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'provider session cookie should be issued');

  const now = Math.floor(Date.now() / 1000);
  const event = {
    id: 'evt_swiftquote_subscription_smoke',
    type: 'checkout.session.completed',
    created: now,
    data: { object: {
      id: 'cs_swiftquote_smoke',
      mode: 'subscription',
      payment_status: 'paid',
      customer: 'cus_swiftquote_smoke',
      subscription: 'sub_swiftquote_smoke',
      client_reference_id: String(account.accountId),
      metadata: { swiftquote_account_id: String(account.accountId), swiftquote_plan: 'contractor' }
    }}
  };
  const raw = JSON.stringify(event);
  const crypto = await import('node:crypto');
  const signature = crypto.createHmac('sha256', 'test-only-stripe-webhook-secret-1234567890').update(now + '.' + raw).digest('hex');
  const webhook = await fetch(baseUrl + '/api/billing/stripe-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=' + now + ',v1=' + signature },
    body: raw
  });
  assert.equal(webhook.status, 200, await webhook.text());

  const usage = await fetch(baseUrl + '/api/provider/usage', { headers: { cookie } });
  assert.equal(usage.status, 200);
  const body = await usage.json();
  assert.equal(body.subscription.status, 'active');
  assert.equal(body.subscription.plan, 'contractor');

  const duplicate = await fetch(baseUrl + '/api/billing/stripe-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=' + now + ',v1=' + signature },
    body: raw
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
});

test('customer can register, submit a service request, and retrieve it from their workspace', async () => {
  const servicesResponse = await fetch(baseUrl + '/api/marketplace/services');
  assert.equal(servicesResponse.status, 200);
  const catalog = await servicesResponse.json();
  const service = catalog.services[0];
  assert.ok(service?.label && service?.industry);

  const register = await fetch(baseUrl + '/api/account/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({
      name: 'Workspace Test Customer',
      email: 'workspace-customer@example.test',
      password: 'ValidSmokeTestPassword123!',
      accountType: 'customer'
    })
  });
  assert.equal(register.status, 201);
  const cookie = (register.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'customer session cookie should be issued');

  const requestResponse = await fetch(baseUrl + '/api/marketplace/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl, cookie },
    body: JSON.stringify({
      name: 'Workspace Test Customer',
      email: 'workspace-customer@example.test',
      phone: '555-0100',
      service: service.label,
      industry: service.industry,
      jobSize: 'medium',
      timing: 'Within two weeks',
      address: '123 Test Street',
      zip: '72904',
      details: 'Please provide an estimate for this service request.'
    })
  });
  assert.equal(requestResponse.status, 201);
  const created = await requestResponse.json();
  assert.ok(created.requestId > 0);

  const workspace = await fetch(baseUrl + '/api/customer/requests', { headers: { cookie } });
  assert.equal(workspace.status, 200);
  const body = await workspace.json();
  assert.ok(body.requests.some(item => item.id === created.requestId && item.service === service.label));
});
