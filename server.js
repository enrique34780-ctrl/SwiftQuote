import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { createAIProvider } from './ai-provider.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) { console.error('Invalid PORT.'); process.exit(1); }
const isProd = process.env.NODE_ENV === 'production';
const APP_NAME = process.env.APP_NAME || 'SwiftQuote';
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'SwiftQuote';
const SESSION_SECRET = process.env.SESSION_SECRET || 'i-am-the-chosen-one-of-the-world.';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ramirez123!!';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const STRIPE_PAYMENT_LINK = process.env.STRIPE_PAYMENT_LINK || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PROVIDER_PRICE_ID = process.env.STRIPE_PROVIDER_PRICE_ID || '';
const STRIPE_PROVIDER_PRICE_IDS = { starter: process.env.STRIPE_PROVIDER_PRICE_ID_STARTER || STRIPE_PROVIDER_PRICE_ID, contractor: process.env.STRIPE_PROVIDER_PRICE_ID_CONTRACTOR || STRIPE_PROVIDER_PRICE_ID, business: process.env.STRIPE_PROVIDER_PRICE_ID_BUSINESS || STRIPE_PROVIDER_PRICE_ID, pro: process.env.STRIPE_PROVIDER_PRICE_ID_PRO || STRIPE_PROVIDER_PRICE_ID };
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const LEAD_WEBHOOK_URL = process.env.LEAD_WEBHOOK_URL || '';
function strongSecret(v, min = 32) { return typeof v === 'string' && v.length >= min; }
const rawProxyHops = process.env.TRUST_PROXY_HOPS ?? '0';
const TRUST_PROXY_HOPS = Number(rawProxyHops);
if (!Number.isInteger(TRUST_PROXY_HOPS) || TRUST_PROXY_HOPS < 0 || TRUST_PROXY_HOPS > 10) { console.error('TRUST_PROXY_HOPS must be an integer from 0 to 10.'); process.exit(1); }
const APP_ORIGIN = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || '';
const WEBHOOK_SECRET = process.env.LEAD_WEBHOOK_SECRET || '';
if (isProd && !APP_ORIGIN) { console.error('APP_ORIGIN is required in production.'); process.exit(1); }
if (isProd && APP_ORIGIN && !APP_ORIGIN.startsWith('https://')) { console.error('APP_ORIGIN must use HTTPS in production.'); process.exit(1); }
if (LEAD_WEBHOOK_URL && (!WEBHOOK_SECRET || !strongSecret(WEBHOOK_SECRET))) { console.error('LEAD_WEBHOOK_SECRET must be at least 32 characters when LEAD_WEBHOOK_URL is configured.'); process.exit(1); }
const rawRetention = Number(process.env.LEAD_RETENTION_DAYS || 365);
if (!Number.isInteger(rawRetention) || rawRetention < 30 || rawRetention > 3650) { console.error('LEAD_RETENTION_DAYS must be an integer from 30 to 3650.'); process.exit(1); }
const LEAD_RETENTION_DAYS = rawRetention;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 5;
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 8_000, maxRetries: 1 })
  : null;
const ai = createAIProvider({
  openai, openaiApiKey: process.env.OPENAI_API_KEY || '', openaiModel: OPENAI_MODEL,
  geminiApiKey: GEMINI_API_KEY, geminiModel: GEMINI_MODEL,
});

if (isProd && (!strongSecret(SESSION_SECRET) || SESSION_SECRET === 'dev-only-change-me')) {
  console.error('Refusing production startup: SESSION_SECRET must be a strong random secret of at least 32 characters.');
  process.exit(1);
}
if (isProd && (!ADMIN_PASSWORD || ADMIN_PASSWORD === 'change-this-before-production' || ADMIN_PASSWORD.length < 12)) {
  console.error('Refusing production startup: ADMIN_PASSWORD must be at least 12 characters and non-default.');
  process.exit(1);
}
if (isProd && STRIPE_SECRET_KEY) {
  const missingStripePlans = Object.entries(STRIPE_PROVIDER_PRICE_IDS).filter(([,v]) => !strongSecret(v, 8)).map(([k]) => k);
  if (missingStripePlans.length) { console.error(`Refusing production startup: missing Stripe provider price IDs for: ${missingStripePlans.join(', ')}`); process.exit(1); }
}
if (APP_ORIGIN) {
  try {
    const u = new URL(APP_ORIGIN);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('invalid');
  } catch { console.error('Invalid APP_ORIGIN.'); process.exit(1); }
}

const dbPath = process.env.DB_PATH || './data/swiftquote.db';
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  service TEXT NOT NULL,
  job_size TEXT NOT NULL,
  timing TEXT NOT NULL,
  address TEXT NOT NULL,
  details TEXT NOT NULL,
  estimate_min INTEGER NOT NULL,
  estimate_max INTEGER NOT NULL,
  ai_summary TEXT,
  ai_priority TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT NOT NULL DEFAULT 'website',
  industry TEXT NOT NULL DEFAULT 'general',
  source_lead_id TEXT,
  source_url TEXT,
  lead_score INTEGER NOT NULL DEFAULT 0,
  next_action TEXT NOT NULL DEFAULT 'Review and contact',
  estimated_value INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS lead_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT 'general',
  enabled INTEGER NOT NULL DEFAULT 1,
  config_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_sync_at INTEGER,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_industry ON leads(industry);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(lead_score DESC, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_source_ref ON leads(source, source_lead_id) WHERE source_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sources_kind ON lead_sources(kind);
CREATE TABLE IF NOT EXISTS lead_events (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS followups (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, channel TEXT NOT NULL, due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', message TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(status, due_at);
CREATE INDEX IF NOT EXISTS idx_events_lead ON lead_events(lead_id, created_at DESC);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_type TEXT NOT NULL CHECK(account_type IN ('customer','provider')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS provider_profiles (
  account_id INTEGER PRIMARY KEY,
  provider_kind TEXT NOT NULL CHECK(provider_kind IN ('individual','contractor','company')),
  business_name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT 'general',
  services_json TEXT NOT NULL DEFAULT '[]',
  service_area TEXT NOT NULL DEFAULT '',
  zip_codes TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 0,
  jobs_completed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'payment_required',
  current_period_end INTEGER,
  external_customer_id TEXT,
  external_subscription_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS provider_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS marketplace_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_account_id INTEGER,
  service TEXT NOT NULL,
  industry TEXT NOT NULL,
  details TEXT NOT NULL,
  address TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  timing TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(customer_account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS lead_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  provider_account_id INTEGER NOT NULL,
  match_score INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'offered',
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  UNIQUE(lead_id, provider_account_id),
  FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  lead_id INTEGER,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  external_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status, current_period_end);
CREATE INDEX IF NOT EXISTS idx_provider_sessions_expiry ON provider_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_status ON marketplace_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_provider ON lead_matches(provider_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_account ON payments(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  provider_account_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  expires_at INTEGER,
  customer_accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL UNIQUE,
  provider_account_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL UNIQUE,
  customer_account_id INTEGER NOT NULL,
  provider_account_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY(customer_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS account_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS provider_metrics (
  provider_account_id INTEGER PRIMARY KEY,
  reliability_score INTEGER NOT NULL DEFAULT 0,
  response_rate REAL NOT NULL DEFAULT 0,
  completion_rate REAL NOT NULL DEFAULT 0,
  avg_response_minutes REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_provider_metrics_score ON provider_metrics(reliability_score DESC);
CREATE TABLE IF NOT EXISTS service_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT 'general',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_created ON stripe_events(created_at);
CREATE INDEX IF NOT EXISTS idx_quotes_lead ON quotes(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_provider ON quotes(provider_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_provider ON jobs(provider_account_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reviews_provider ON reviews(provider_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_account ON account_notifications(account_id, read_at, created_at DESC);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_account ON audit_log(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  opened_by_account_id INTEGER NOT NULL,
  against_account_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(opened_by_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(against_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_disputes_job ON disputes(job_id, created_at DESC);
CREATE TABLE IF NOT EXISTS provider_verification_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_account_id INTEGER NOT NULL,
  verification_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  UNIQUE(provider_account_id, verification_type, status),
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_verification_provider ON provider_verification_requests(provider_account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS provider_availability (
  provider_account_id INTEGER PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  schedule_json TEXT NOT NULL DEFAULT '{}',
  blackout_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER,
  response_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(account_id, scope, idem_key),
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
CREATE TABLE IF NOT EXISTS risk_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  ip_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  risk_score INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_account ON risk_events(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS payment_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending',
  external_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS provider_payout_accounts (
  provider_account_id INTEGER PRIMARY KEY,
  stripe_account_id TEXT NOT NULL UNIQUE,
  onboarding_status TEXT NOT NULL DEFAULT 'pending',
  charges_enabled INTEGER NOT NULL DEFAULT 0,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS job_agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE,
  quote_id INTEGER NOT NULL,
  customer_account_id INTEGER NOT NULL,
  provider_account_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  amount INTEGER NOT NULL,
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  schedule_json TEXT NOT NULL DEFAULT '{}',
  customer_accepted_at INTEGER,
  provider_accepted_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending_provider',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
  FOREIGN KEY(customer_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS change_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  provider_account_id INTEGER NOT NULL,
  customer_account_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  amount_delta INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_customer',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(customer_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_change_orders_job ON change_orders(job_id, created_at DESC);
CREATE TABLE IF NOT EXISTS customer_metrics (
  account_id INTEGER PRIMARY KEY,
  reliability_score INTEGER NOT NULL DEFAULT 100,
  completed_jobs INTEGER NOT NULL DEFAULT 0,
  cancellations INTEGER NOT NULL DEFAULT 0,
  disputes INTEGER NOT NULL DEFAULT 0,
  no_shows INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS trust_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  actor_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  weight INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS review_risk_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL UNIQUE,
  risk_score INTEGER NOT NULL,
  reasons TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'review',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(review_id) REFERENCES reviews(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS service_price_benchmarks (
  service TEXT PRIMARY KEY,
  sample_count INTEGER NOT NULL DEFAULT 0,
  median_amount INTEGER NOT NULL DEFAULT 0,
  p25_amount INTEGER NOT NULL DEFAULT 0,
  p75_amount INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_service_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_account_id INTEGER NOT NULL,
  zip_code TEXT NOT NULL,
  radius_miles INTEGER NOT NULL DEFAULT 0,
  emergency_available INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider_account_id,zip_code),
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_trust_events_account ON trust_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due ON scheduled_notifications(status, due_at);
CREATE INDEX IF NOT EXISTS idx_service_areas_zip ON provider_service_areas(zip_code, emergency_available);
CREATE TABLE IF NOT EXISTS job_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  sender_account_id INTEGER NOT NULL,
  recipient_account_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(sender_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(recipient_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_messages_job ON job_messages(job_id, created_at DESC);
CREATE TABLE IF NOT EXISTS job_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  actor_account_id INTEGER,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_job_status_events_job ON job_status_events(job_id, created_at DESC);
CREATE TABLE IF NOT EXISTS cancellation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  requested_by_account_id INTEGER NOT NULL,
  against_account_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(requested_by_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(against_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cancellation_job ON cancellation_requests(job_id, created_at DESC);
CREATE TABLE IF NOT EXISTS completion_confirmations (
  job_id INTEGER PRIMARY KEY,
  customer_account_id INTEGER NOT NULL,
  confirmed_at INTEGER,
  disputed_at INTEGER,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(customer_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS provider_payout_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_account_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending',
  external_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(job_id),
  FOREIGN KEY(provider_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payout_ledger_provider ON provider_payout_ledger(provider_account_id, status, created_at DESC);

`);
try {
  const cols = db.prepare('PRAGMA table_info(leads)').all().map(x => x.name);
  if (!cols.includes('industry')) db.exec("ALTER TABLE leads ADD COLUMN industry TEXT NOT NULL DEFAULT 'general'");
  if (!cols.includes('source_lead_id')) db.exec('ALTER TABLE leads ADD COLUMN source_lead_id TEXT');
  if (!cols.includes('source_url')) db.exec('ALTER TABLE leads ADD COLUMN source_url TEXT');
  db.exec("CREATE INDEX IF NOT EXISTS idx_leads_industry ON leads(industry)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_source_ref ON leads(source, source_lead_id) WHERE source_lead_id IS NOT NULL");
  if (!cols.includes('lead_score')) db.exec("ALTER TABLE leads ADD COLUMN lead_score INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes('next_action')) db.exec("ALTER TABLE leads ADD COLUMN next_action TEXT NOT NULL DEFAULT 'Review and contact'");
  if (!cols.includes('estimated_value')) db.exec("ALTER TABLE leads ADD COLUMN estimated_value INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes('customer_account_id')) db.exec("ALTER TABLE leads ADD COLUMN customer_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL");
  if (!cols.includes('zip_code')) db.exec("ALTER TABLE leads ADD COLUMN zip_code TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(lead_score DESC, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(customer_account_id, created_at DESC)");
  const holdCols = db.prepare('PRAGMA table_info(payment_holds)').all().map(x => x.name);
  if (!holdCols.includes('payment_intent_id')) db.exec("ALTER TABLE payment_holds ADD COLUMN payment_intent_id TEXT");
  const changeCols = db.prepare('PRAGMA table_info(change_orders)').all().map(x => x.name);
  if (!changeCols.includes('payment_session_id')) db.exec("ALTER TABLE change_orders ADD COLUMN payment_session_id TEXT");
  if (!changeCols.includes('payment_intent_id')) db.exec("ALTER TABLE change_orders ADD COLUMN payment_intent_id TEXT");
  if (!changeCols.includes('refund_id')) db.exec("ALTER TABLE change_orders ADD COLUMN refund_id TEXT");
  if (!changeCols.includes('payment_status')) db.exec("ALTER TABLE change_orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'not_required'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_change_orders_payment ON change_orders(payment_status, created_at DESC)");
} catch (e) { console.error('Database migration failed:', e.message); process.exit(1); }
try {
  const integrity=db.prepare('PRAGMA integrity_check').get();
  if (integrity?.integrity_check !== 'ok') throw new Error('integrity_check did not return ok');
} catch (e) { console.error('Database integrity check failed:', e.message); process.exit(1); }

function cleanupData() {
  const now=Date.now();
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM provider_sessions WHERE expires_at < ?').run(now);
  const cutoff=new Date(now - LEAD_RETENTION_DAYS * 86400000).toISOString();
  // Retain any lead tied to financial/service history. SQLite foreign keys intentionally cascade from leads
  // to jobs/quotes/etc., so blindly deleting old leads would destroy historical records.
  db.prepare(`DELETE FROM leads WHERE created_at < ? AND source <> 'marketplace'
    AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.lead_id=leads.id)
    AND NOT EXISTS (SELECT 1 FROM quotes WHERE quotes.lead_id=leads.id)
    AND NOT EXISTS (SELECT 1 FROM payments WHERE payments.lead_id=leads.id)`).run(cutoff);
  db.prepare('DELETE FROM account_notifications WHERE created_at < ?').run(now - 180*86400000);
  db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(now - 730*86400000);
  db.prepare('DELETE FROM stripe_events WHERE created_at < ?').run(now - 400*86400000);
  db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(now - 7*86400000);
  db.prepare("DELETE FROM payment_holds WHERE status='starting' AND created_at < ?").run(now - 60*60*1000);
  db.prepare("UPDATE change_orders SET payment_status='required' WHERE payment_status='checkout_starting' AND created_at < ?").run(now - 60*60*1000);
  db.prepare('DELETE FROM risk_events WHERE created_at < ?').run(now - 365*86400000);
  db.prepare("DELETE FROM scheduled_notifications WHERE status='sent' AND created_at < ?").run(now - 180*86400000);
  db.prepare('DELETE FROM trust_events WHERE created_at < ?').run(now - 730*86400000);
}
cleanupData();
setInterval(cleanupData, 6 * 60 * 60 * 1000).unref();

const catalogSeed=[
['yard_cleanup','Yard Cleanup','landscaping'],['lawn_care','Lawn Care','landscaping'],['tree_trimming','Tree Trimming','landscaping'],['landscape_design','Landscape Design','landscaping'],['house_cleaning','House Cleaning','cleaning'],['deep_cleaning','Deep Cleaning','cleaning'],['move_out_cleaning','Move-Out Cleaning','cleaning'],['carpet_cleaning','Carpet Cleaning','cleaning'],['junk_removal','Junk Removal','junk_removal'],['moving_help','Moving Help','moving'],['packing','Packing Services','moving'],['handyman','Handyman / Small Repair','handyman'],['pressure_washing','Pressure Washing','pressure_washing'],['roof_repair','Roof Repair','roofing'],['roof_replacement','Roof Replacement','roofing'],['gutter_service','Gutter Service','roofing'],['hvac_repair','HVAC Repair','hvac'],['ac_installation','AC Installation','hvac'],['plumbing_repair','Plumbing Repair','plumbing'],['drain_cleaning','Drain Cleaning','plumbing'],['water_heater','Water Heater Service','plumbing'],['electrical_repair','Electrical Repair','electrical'],['panel_upgrade','Electrical Panel Upgrade','electrical'],['interior_painting','Interior Painting','painting'],['exterior_painting','Exterior Painting','painting'],['drywall','Drywall Repair','construction'],['flooring','Flooring Installation','construction'],['fence','Fence Installation/Repair','construction'],['concrete','Concrete Work','construction'],['general_construction','General Construction','construction'],['auto_repair','Auto Repair','auto'],['mobile_mechanic','Mobile Mechanic','auto'],['photography','Photography','photography'],['event_services','Event Services','events'],['personal_training','Personal Training','fitness'],['beauty_services','Beauty Services','beauty'],['legal_consultation','Legal Consultation','legal'],['real_estate_services','Real Estate Services','real_estate'],['insurance_services','Insurance Services','insurance'],['business_consulting','Business Consulting','professional']
];
const seedCatalog=db.prepare('INSERT OR IGNORE INTO service_catalog(slug,label,industry) VALUES(?,?,?)');
for(const item of catalogSeed)seedCatalog.run(...item);

const rates = {
  yard: {label:'Yard Cleanup', small:[85,140], medium:[150,240], large:[250,425]},
  junk: {label:'Junk Removal', small:[100,175], medium:[200,325], large:[350,575]},
  pressure: {label:'Pressure Washing', small:[125,200], medium:[225,350], large:[375,650]},
  moving: {label:'Moving Help', small:[120,190], medium:[240,380], large:[420,700]},
  handyman: {label:'Handyman / Small Repair', small:[100,175], medium:[200,325], large:[350,575]}
};
const statuses = new Set(['new','contacted','booked','completed','lost']);
const industries = {
  general:'General Services', home_services:'Home Services', landscaping:'Landscaping', cleaning:'Cleaning',
  junk_removal:'Junk Removal', moving:'Moving', handyman:'Handyman', pressure_washing:'Pressure Washing',
  roofing:'Roofing', hvac:'HVAC', plumbing:'Plumbing', electrical:'Electrical', painting:'Painting',
  auto:'Automotive', legal:'Legal Services', real_estate:'Real Estate', insurance:'Insurance',
  photography:'Photography', events:'Events', fitness:'Fitness', beauty:'Beauty & Personal Care',
  professional:'Professional Services', construction:'Construction'
};
const sourceKinds = new Set(['website','meta_lead_ads','instagram_lead_ads','linkedin_lead_sync','tiktok_lead_gen','webhook','csv','manual']);
const sourceHostAllowlist = new Set(['graph.facebook.com','api.linkedin.com','open.tiktokapis.com']);
function normalizeIndustry(v){ const k=clean(v,40).toLowerCase().replace(/[^a-z0-9_]/g,'_'); return Object.hasOwn(industries,k)?k:'general'; }
function safeSourceUrl(v){ if(!v) return ''; try { const u=new URL(v); return u.protocol==='https:' && !u.username && !u.password && !u.hash && sourceHostAllowlist.has(u.hostname) ? u.toString() : ''; } catch { return ''; } }
function cryptoKey(){ return crypto.createHash('sha256').update(SESSION_SECRET).digest(); }
function encryptSecret(value){ const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',cryptoKey(),iv); const data=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]); return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`; }
function decryptSecret(value){ try { const [iv,tag,data]=String(value).split('.').map(x=>Buffer.from(x,'base64url')); const decipher=crypto.createDecipheriv('aes-256-gcm',cryptoKey(),iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'); } catch { return ''; } }
function safeJson(v){ try { return JSON.parse(v||'{}'); } catch { return {}; } }
function scoreLead(x){
  let score=35;
  if(x.phone) score+=15; if(x.email && !x.email.endsWith('.invalid')) score+=10;
  if(x.details && x.details.length>=30) score+=10;
  const timing=String(x.timing||'').toLowerCase();
  if(/today|now|urgent|asap|emergency|immediately/.test(timing)) score+=25; else if(/tomorrow|this week|soon/.test(timing)) score+=12;
  if(Number(x.estimateMax)>=500) score+=10; else if(Number(x.estimateMax)>=300) score+=5;
  return Math.max(0,Math.min(100,score));
}
function nextActionFor(score,timing){ if(score>=80) return 'Contact immediately'; if(/today|now|urgent|asap|emergency/i.test(String(timing||''))) return 'Contact today'; if(score>=60) return 'Contact within 2 hours'; return 'Review and contact'; }
function mapImportedLead(raw, source){
  const x=raw||{}; const name=clean(x.name || [x.first_name,x.last_name].filter(Boolean).join(' '),100);
  const phone=clean(x.phone || x.phone_number || '',40); const email=clean(x.email || '',160);
  const service=clean(x.service || x.requested_service || source.name || 'Imported Lead',120);
  const details=clean(x.details || x.message || x.description || '',2000);
  const timing=clean(x.timing || x.when || 'Contact customer',60); const address=clean(x.address || x.location || 'Not provided',180);
  const sourceLeadId=clean(x.id || x.lead_id || x.source_lead_id || '',200) || null;
  const sourceUrl=clean(x.url || x.source_url || '',500); const zipCode=normalizeZip(x.zip || x.zip_code || x.postal_code || '');
  return {name,phone,email,service,details,timing,address,sourceLeadId,sourceUrl,industry:normalizeIndustry(x.industry || source.industry),zipCode,estimateMin:Number.isInteger(x.estimate_min)?x.estimate_min:0,estimateMax:Number.isInteger(x.estimate_max)?x.estimate_max:0,leadScore:scoreLead({phone,email,details,timing,estimateMax:Number.isInteger(x.estimate_max)?x.estimate_max:0}),nextAction:nextActionFor(scoreLead({phone,email,details,timing,estimateMax:Number.isInteger(x.estimate_max)?x.estimate_max:0}),timing)};
}
function validImportedLead(x){ return x.name && (validEmail(x.email)||x.phone.replace(/\D/g,'').length>=7) && x.details.length>=1 && x.service.length>=1; }
function sourceKey(source){ return `${source.kind}:${source.id}`; }

const PROVIDER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const providerPlans = {
  starter: {monthly: 49, leadLimit: 100}, contractor: {monthly: 99, leadLimit: 500}, business: {monthly: 199, leadLimit: 2500}, pro: {monthly: 399, leadLimit: 10000}
};
function hashPassword(password, salt=crypto.randomBytes(16)) {
  const digest=crypto.scryptSync(String(password), salt, 64, {N:16384,r:8,p:1});
  return `s2$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}
function verifyPassword(password, stored) {
  try { const [ver,salt64,digest64]=String(stored).split('$'); if(ver!=='s2'||!salt64||!digest64)return false; const salt=Buffer.from(salt64,'base64url'); const expected=Buffer.from(digest64,'base64url'); const actual=crypto.scryptSync(String(password),salt,64,{N:16384,r:8,p:1}); return expected.length===actual.length && crypto.timingSafeEqual(expected,actual); } catch { return false; }
}
function accountCookieName(){return isProd?'__Host-sq_account':'sq_account';}
function providerSession(accountId){
  const token=crypto.randomBytes(32).toString('base64url'); const csrf=crypto.randomBytes(32).toString('base64url'); const now=Date.now();
  db.prepare('INSERT INTO provider_sessions(token_hash,account_id,csrf_token,created_at,expires_at) VALUES(?,?,?,?,?)').run(tokenHash(token),accountId,csrf,now,now+PROVIDER_SESSION_TTL_MS);
  const active=db.prepare('SELECT token_hash FROM provider_sessions WHERE account_id=? ORDER BY created_at DESC').all(accountId);
  for(const row of active.slice(5)) db.prepare('DELETE FROM provider_sessions WHERE token_hash=?').run(row.token_hash);
  return {token,csrf};
}
function readProviderSession(req){
  const name=accountCookieName(); const raw=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1);
  if(!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
  const row=db.prepare('SELECT ps.*,a.account_type,a.name,a.email,a.status FROM provider_sessions ps JOIN accounts a ON a.id=ps.account_id WHERE ps.token_hash=? AND ps.expires_at>?').get(tokenHash(raw),Date.now());
  return row||null;
}
function setAccountCookie(res,token){const parts=[`${accountCookieName()}=${token}`,'Path=/','HttpOnly','SameSite=Lax',`Max-Age=${Math.floor(PROVIDER_SESSION_TTL_MS/1000)}`];if(isProd)parts.push('Secure');res.setHeader('Set-Cookie',parts.join('; '));}
function clearAccountCookie(res){const parts=[`${accountCookieName()}=`,'Path=/','HttpOnly','SameSite=Lax','Max-Age=0'];if(isProd)parts.push('Secure');res.setHeader('Set-Cookie',parts.join('; '));}
function requireAccount(req,res,next){const s=readProviderSession(req);if(!s)return res.status(401).json({error:'Account authentication required.'});if(s.status!=='active')return res.status(403).json({error:'Account is not active.'});req.account=s;next();}
function requireProvider(req,res,next){return requireAccount(req,res,()=>{if(req.account.account_type!=='provider')return res.status(403).json({error:'Provider account required.'});next();});}
function requireAccountCsrf(req,res,next){const s=req.account||readProviderSession(req);if(!s)return res.status(401).json({error:'Account authentication required.'});const supplied=req.get('x-csrf-token')||'';if(!supplied||supplied.length!==s.csrf_token.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(s.csrf_token)))return res.status(403).json({error:'Invalid CSRF token.'});next();}
function subscriptionActive(accountId){const s=db.prepare('SELECT * FROM subscriptions WHERE account_id=?').get(accountId);if(!s)return false;return s.status==='active' && (!s.current_period_end || s.current_period_end>Date.now());}
function providerCanReceive(accountId){return subscriptionActive(accountId) && db.prepare("SELECT status FROM accounts WHERE id=? AND account_type='provider'").get(accountId)?.status==='active';}
function providerUsage(accountId){const sub=db.prepare('SELECT plan,status,current_period_end FROM subscriptions WHERE account_id=?').get(accountId);const plan=providerPlans[sub?.plan]||providerPlans.starter;const monthStart=new Date();monthStart.setDate(1);monthStart.setHours(0,0,0,0);const used=Number(db.prepare("SELECT COUNT(*) count FROM lead_matches WHERE provider_account_id=? AND created_at>=? AND status='claimed'").get(accountId,monthStart.getTime()).count);const offered=Number(db.prepare("SELECT COUNT(*) count FROM lead_matches WHERE provider_account_id=? AND created_at>=? AND status='offered'").get(accountId,monthStart.getTime()).count);return {subscription:sub||{status:'payment_required',plan:'starter'},used,offered,limit:plan.leadLimit,offerLimit:Math.max(10,Math.min(100,plan.leadLimit*3)),monthly:plan.monthly};}
function providerCanClaim(accountId){const u=providerUsage(accountId);return providerCanReceive(accountId) && u.used < u.limit;}
function addNotification(accountId,kind,message){db.prepare('INSERT INTO account_notifications(account_id,kind,message,created_at) VALUES(?,?,?,?)').run(accountId,clean(kind,40),clean(message,500),Date.now());}
function audit(accountId,actorType,action,objectType,objectId,metadata={}){db.prepare('INSERT INTO audit_log(account_id,actor_type,action,object_type,object_id,metadata,created_at) VALUES(?,?,?,?,?,?,?)').run(accountId||null,clean(actorType,30),clean(action,80),clean(objectType,40),Number.isSafeInteger(objectId)?objectId:null,JSON.stringify(metadata||{}),Date.now());}
const quoteStatuses=new Set(['sent','payment_required','paid','accepted','declined','expired','canceled']);
const jobStatuses=new Set(['scheduled','in_progress','completed','canceled']);
function normalizeZip(v){return String(v||'').replace(/[^0-9-]/g,'').slice(0,10);}
function providerServices(accountId){try{const p=db.prepare('SELECT services_json FROM provider_profiles WHERE account_id=?').get(accountId);const a=JSON.parse(p?.services_json||'[]');return Array.isArray(a)?a.map(x=>String(x).slice(0,80)):[];}catch{return[];}}
function matchScore(lead, profile){
  let score=0;
  const services=providerServices(profile.account_id);
  const service=String(lead.service||'').toLowerCase();
  const industry=String(lead.industry||'general').toLowerCase();
  if(services.some(x=>service.includes(x.toLowerCase())||x.toLowerCase().includes(service)||x.toLowerCase().includes(industry)))score+=55;
  if(profile.industry===lead.industry||profile.industry==='general')score+=20;
  const z=normalizeZip(lead.zip_code);
  const areaMatch=!!(z&&db.prepare('SELECT 1 FROM provider_service_areas WHERE provider_account_id=? AND zip_code=?').get(profile.account_id,z));
  const legacyZipMatch=!!(z&&profile.zip_codes.split(/[ ,]+/).map(normalizeZip).includes(z));
  if(areaMatch||legacyZipMatch)score+=20;
  if(profile.verified)score+=5;
  return Math.min(100,score);
}
function matchReasons(lead, profile){
  const reasons=[];
  const services=providerServices(profile.account_id);
  const service=String(lead.service||'').toLowerCase();
  const industry=String(lead.industry||'general').toLowerCase();
  if(services.some(x=>service.includes(x.toLowerCase())||x.toLowerCase().includes(service)||x.toLowerCase().includes(industry))) reasons.push('Service match');
  if(profile.industry===lead.industry||profile.industry==='general') reasons.push('Industry match');
  const z=normalizeZip(lead.zip_code);
  const areaMatch=!!(z&&db.prepare('SELECT 1 FROM provider_service_areas WHERE provider_account_id=? AND zip_code=?').get(profile.account_id,z));
  const legacyZipMatch=!!(z&&profile.zip_codes.split(/[ ,]+/).map(normalizeZip).includes(z));
  if(areaMatch||legacyZipMatch) reasons.push('Service-area match');
  if(profile.verified) reasons.push('Verified provider');
  return reasons;
}
function providerReliability(accountId){
  const p=db.prepare('SELECT rating,jobs_completed FROM provider_profiles WHERE account_id=?').get(accountId)||{rating:0,jobs_completed:0};
  const offered=Number(db.prepare("SELECT COUNT(*) c FROM lead_matches WHERE provider_account_id=?").get(accountId).c);
  const claimed=Number(db.prepare("SELECT COUNT(*) c FROM lead_matches WHERE provider_account_id=? AND status='claimed'").get(accountId).c);
  const completed=Number(db.prepare("SELECT COUNT(*) c FROM jobs WHERE provider_account_id=? AND status='completed'").get(accountId).c);
  const responseRate=offered?Math.min(1,claimed/offered):0;
  const completionRate=claimed?Math.min(1,completed/claimed):0;
  const verified=db.prepare('SELECT verified FROM provider_profiles WHERE account_id=?').get(accountId)?.verified?1:0;
  const ratingScore=Math.max(0,Math.min(1,Number(p.rating||0)/5));
  const score=Math.round((ratingScore*50)+(responseRate*20)+(completionRate*25)+(verified*5));
  return {reliabilityScore:score,responseRate,completionRate,verified:!!verified,jobsCompleted:completed,rating:Number(p.rating||0)};
}
function refreshProviderMetrics(accountId){
  const m=providerReliability(accountId);
  db.prepare('INSERT INTO provider_metrics(provider_account_id,reliability_score,response_rate,completion_rate,avg_response_minutes,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(provider_account_id) DO UPDATE SET reliability_score=excluded.reliability_score,response_rate=excluded.response_rate,completion_rate=excluded.completion_rate,updated_at=excluded.updated_at').run(accountId,m.reliabilityScore,m.responseRate,m.completionRate,0,Date.now());
  return m;
}
function createMatchesForLead(leadId){
  const lead=db.prepare('SELECT * FROM leads WHERE id=?').get(leadId);if(!lead)return 0;
  const providers=db.prepare("SELECT a.id account_id,p.* FROM accounts a JOIN provider_profiles p ON p.account_id=a.id WHERE a.account_type='provider' AND a.status='active'").all();
  let n=0;const stmt=db.prepare('INSERT OR IGNORE INTO lead_matches(lead_id,provider_account_id,match_score,status,created_at) VALUES(?,?,?,?,?)');
  for(const p of providers){if(!providerCanReceive(p.account_id))continue;const offered=providerUsage(p.account_id).offered;if(offered>=providerUsage(p.account_id).offerLimit)continue;const score=matchScore(lead,p);if(score>=50){stmt.run(leadId,p.account_id,score,'offered',Date.now());n++;}}
  return n;
}
function createMatchesForProvider(accountId){
  if(!providerCanReceive(accountId))return 0;
  const p=db.prepare("SELECT a.id account_id,p.* FROM accounts a JOIN provider_profiles p ON p.account_id=a.id WHERE a.id=? AND a.account_type='provider' AND a.status='active'").get(accountId);if(!p)return 0;
  const leads=db.prepare("SELECT * FROM leads WHERE status IN ('new','contacted') AND (source='marketplace' OR source='website') ORDER BY created_at DESC LIMIT 500").all();
  const usage=providerUsage(accountId);let n=0;const stmt=db.prepare('INSERT OR IGNORE INTO lead_matches(lead_id,provider_account_id,match_score,status,created_at) VALUES(?,?,?,?,?)');
  for(const lead of leads){if(usage.offered+n>=usage.offerLimit)break;const score=matchScore(lead,p);if(score>=50){const r=stmt.run(lead.id,accountId,score,'offered',Date.now());if(r.changes)n++;}}
  return n;
}


app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY_HOPS);
app.use(helmet({
  permissionsPolicy: { policies: { camera: [], microphone: [], geolocation: [], payment: [] } },
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
  contentSecurityPolicy: { directives: {
    defaultSrc:["'self'"], baseUri:["'self'"], fontSrc:["'self'"], formAction:["'self'"],
    frameAncestors:["'none'"], imgSrc:["'self'",'data:'], objectSrc:["'none'"],
    scriptSrc:["'self'"], styleSrc:["'self'"], connectSrc:["'self'"]
  }},
  referrerPolicy: { policy:'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false
}));
app.post('/api/billing/stripe-webhook',express.raw({type:'application/json',limit:'256kb'}),(req,res)=>{
  noStore(res);
  if(!STRIPE_WEBHOOK_SECRET)return res.status(503).send('Webhook not configured');
  const sig=req.get('stripe-signature')||''; const match=sig.match(/(?:^|,)t=(\d+)(?:,|$)/); const v1=[...sig.matchAll(/(?:^|,)v1=([^,]+)/g)].map(m=>m[1]);
  if(!match||!v1.length)return res.status(400).send('Invalid signature');
  const timestamp=Number(match[1]); if(!Number.isSafeInteger(timestamp)||Math.abs(Date.now()/1000-timestamp)>300)return res.status(400).send('Stale signature');
  const expected=hmacHex(STRIPE_WEBHOOK_SECRET,`${timestamp}.${Buffer.from(req.body).toString('utf8')}`); const ok=v1.some(v=>v.length===expected.length&&crypto.timingSafeEqual(Buffer.from(v),Buffer.from(expected))); if(!ok)return res.status(401).send('Invalid signature');
  let event;try{event=JSON.parse(Buffer.from(req.body).toString('utf8'));}catch{return res.status(400).send('Invalid JSON');}
  const eventId=clean(event.id,255); if(!eventId)return res.status(400).send('Missing event id');
  try{
    const processEvent=db.transaction(()=>{
      const o=event.data?.object||{};
      const inserted=db.prepare('INSERT OR IGNORE INTO stripe_events(event_id,event_type,created_at) VALUES(?,?,?)').run(eventId,clean(event.type,100),Date.now());
      if(!inserted.changes)return {duplicate:true};
      if(event.type==='checkout.session.completed'){
        const changeOrderId=Number(o.metadata?.swiftquote_change_order_id);
        if(Number.isSafeInteger(changeOrderId)&&changeOrderId>0){
          const co=db.prepare('SELECT * FROM change_orders WHERE id=?').get(changeOrderId);
          if(!co||co.status!=='approved'||!['checkout_pending','checkout_starting'].includes(co.payment_status))throw new Error('Invalid change-order payment state.');
          const paid=String(o.payment_status||'')==='paid';
          const amountOk=Number(o.amount_total)===Math.abs(Number(co.amount_delta))*100;
          const currencyOk=String(o.currency||'').toLowerCase()==='usd';
          const customerId=Number(o.metadata?.swiftquote_customer_account_id||0);
          const changeSessionMatches=co.payment_session_id?clean(o.id,255)===clean(co.payment_session_id,255):co.payment_status==='checkout_starting';if(!paid||!amountOk||!currencyOk||customerId!==Number(co.customer_account_id)||!changeSessionMatches)throw new Error('Stripe payment did not match the SwiftQuote change order.');
          const now=Date.now();
          db.prepare("UPDATE change_orders SET payment_status='paid',payment_session_id=?,payment_intent_id=? WHERE id=? AND payment_status='checkout_pending'").run(clean(o.id,255),clean(o.payment_intent,255),changeOrderId);
          db.prepare('INSERT INTO payments(account_id,lead_id,kind,status,amount,currency,external_id,created_at) SELECT customer_account_id,(SELECT lead_id FROM jobs WHERE id=job_id),\'change_order\',\'paid\',?,\'usd\',?,? FROM change_orders WHERE id=?').run(Math.abs(Number(co.amount_delta)),clean(o.payment_intent||o.id,255),now,changeOrderId);
          addNotification(co.provider_account_id,'change_order_paid','The approved change order has been paid.');
        } else {
          const quoteId=Number(o.metadata?.swiftquote_quote_id);
          if(Number.isSafeInteger(quoteId)&&quoteId>0){
            const q=db.prepare('SELECT q.id,q.lead_id,q.provider_account_id,q.amount,q.currency,q.scope,q.deposit_amount,q.status,l.customer_account_id FROM quotes q JOIN leads l ON l.id=q.lead_id WHERE q.id=?').get(quoteId);
            if(q&&(q.status==='payment_required'||q.status==='payment_starting')){
              const paid=String(o.payment_status||'')==='paid';
              const amountOk=Number(o.amount_total)===Number(q.amount)*100;
              const currencyOk=String(o.currency||'').toLowerCase()===String(q.currency||'usd').toLowerCase();
              const customerId=Number(o.metadata?.swiftquote_customer_account_id||0);
              const hold=db.prepare('SELECT external_id,status FROM payment_holds WHERE quote_id=?').get(q.id);const sessionMatches=hold?.external_id?clean(o.id,255)===clean(hold.external_id,255):hold?.status==='starting';if(!paid||!amountOk||!currencyOk||customerId!==Number(q.customer_account_id)||!sessionMatches)throw new Error('Stripe payment did not match the SwiftQuote quote.');
              const now=Date.now();
              db.prepare("UPDATE quotes SET status='paid',customer_accepted_at=COALESCE(customer_accepted_at,?),updated_at=? WHERE id=? AND status='payment_required'").run(now,now,quoteId);
              db.prepare("UPDATE leads SET status='booked' WHERE id=?").run(q.lead_id);
              db.prepare('INSERT OR IGNORE INTO jobs(lead_id,provider_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(q.lead_id,q.provider_account_id,'scheduled',now,now);
              const job=db.prepare('SELECT id FROM jobs WHERE lead_id=?').get(q.lead_id);
              if(job){
                db.prepare('INSERT OR IGNORE INTO job_agreements(job_id,quote_id,customer_account_id,provider_account_id,scope,amount,deposit_amount,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(job.id,q.id,q.customer_account_id,q.provider_account_id,q.scope,q.amount,q.deposit_amount,'pending_customer',now,now);
                db.prepare('INSERT INTO job_status_events(job_id,actor_account_id,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?)').run(job.id,q.customer_account_id,'','scheduled','Payment received; job created.',now);
              }
              db.prepare("UPDATE payment_holds SET status='paid',external_id=?,payment_intent_id=?,updated_at=? WHERE quote_id=?").run(clean(o.id,255),clean(o.payment_intent,255),now,q.id);
              db.prepare('INSERT INTO payments(account_id,lead_id,kind,status,amount,currency,external_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(q.customer_account_id,q.lead_id,'quote','paid',q.amount,q.currency||'usd',clean(o.payment_intent||o.id,255),now);
              addNotification(q.provider_account_id,'payment_received','The customer payment was received and the job is ready to schedule.');
            }
          }
        }
      } else if(event.type==='customer.subscription.updated'||event.type==='customer.subscription.deleted'){
        const status=event.type.endsWith('deleted')?'canceled':String(o.status||'past_due');
        const row=db.prepare('SELECT account_id FROM subscriptions WHERE external_subscription_id=? OR external_customer_id=?').get(clean(o.id,200),clean(o.customer,200));
        if(row){
          const active=['active','trialing'].includes(status);
          db.prepare('UPDATE subscriptions SET status=?,current_period_end=?,updated_at=? WHERE account_id=?').run(active?'active':status,Number(o.current_period_end||0)*1000||null,Date.now(),row.account_id);
          if(active){createMatchesForProvider(row.account_id);refreshProviderMetrics(row.account_id);}
        }
      } else if(event.type==='invoice.paid'){
        const accountId=Number(o.metadata?.swiftquote_account_id);
        if(Number.isSafeInteger(accountId)&&accountId>0){
          db.prepare("UPDATE subscriptions SET status='active',updated_at=? WHERE account_id=?").run(Date.now(),accountId);
          createMatchesForProvider(accountId);
        }
      } else if(event.type==='account.updated'){
        const accountId=db.prepare('SELECT provider_account_id FROM provider_payout_accounts WHERE stripe_account_id=?').get(clean(o.id,255))?.provider_account_id;
        if(accountId){
          const status=o.details_submitted?'complete':'pending';
          db.prepare('UPDATE provider_payout_accounts SET onboarding_status=?,charges_enabled=?,payouts_enabled=?,updated_at=? WHERE provider_account_id=?').run(status,o.charges_enabled?1:0,o.payouts_enabled?1:0,Date.now(),accountId);
        }
      }
      return {duplicate:false};
    });
    const result=processEvent(); if(result.duplicate)return res.json({received:true,duplicate:true}); return res.json({received:true});
  }catch(e){console.error('Stripe webhook processing failed:',e.message);return res.status(500).send('Webhook processing failed');}
});
app.use(express.json({limit:'20kb', strict:true}));
app.use(express.urlencoded({extended:false, limit:'20kb'}));
app.use('/api',(req,res,next)=>{ noStore(res); if(!rateLimit(rateKey('api-ip',clientIp(req)),240,60_000)) return res.status(429).json({error:'API request rate limit reached. Please slow down.'}); next(); });
app.use((req,res,next)=>{ req.setTimeout(15_000); next(); });
app.get('/admin',(req,res)=>{ noStore(res); res.set('X-Robots-Tag','noindex, nofollow, noarchive'); res.sendFile(path.join(process.cwd(),'public/admin.html')); });
app.get('/admin/',(req,res)=>{ noStore(res); res.set('X-Robots-Tag','noindex, nofollow, noarchive'); res.redirect(302,'/admin'); });
app.get('/admin.html',(req,res)=>{ noStore(res); res.set('X-Robots-Tag','noindex, nofollow, noarchive'); res.sendFile(path.join(process.cwd(),'public/admin.html')); });
app.use(express.static('public', {extensions:['html'], dotfiles:'deny', index:'index.html'}));

const attempts = new Map();
function pruneAttempts() {
  const now = Date.now();
  for (const [key, item] of attempts) if (now > item.reset) attempts.delete(key);
  if (attempts.size > 5000) {
    const entries = [...attempts.entries()].sort((a,b) => a[1].reset - b[1].reset);
    for (let i = 0; i < Math.floor(entries.length / 2); i++) attempts.delete(entries[i][0]);
  }
}
setInterval(pruneAttempts, 5 * 60_000).unref();
function rateLimit(key, max=20, windowMs=60_000) {
  const now = Date.now();
  const item = attempts.get(key) || {count:0, reset:now + windowMs};
  if (now > item.reset) { item.count=0; item.reset=now+windowMs; }
  item.count++;
  attempts.set(key,item);
  return item.count <= max;
}
function clean(v, max=1000) { return String(v ?? '').trim().slice(0,max); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function estimate(service,size) {
  if (!Object.hasOwn(rates, service)) return null;
  const r = rates[service];
  if (!Object.hasOwn(r, size)) return null;
  const range = r[size];
  return Array.isArray(range) && range.length === 2 && Number.isInteger(range[0]) && Number.isInteger(range[1]) ? {min:range[0],max:range[1]} : null;
}
function clientIp(req) { return req.ip || req.socket.remoteAddress || 'unknown'; }
function validHttpsUrl(value) { if (!value) return ''; try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && u.hash==='' ? u.toString() : ''; } catch { return ''; } }
function hmacHex(secret, value) { return crypto.createHmac('sha256', secret).update(value).digest('hex'); }
function rateKey(scope, value) { return `${scope}:${hmacHex(SESSION_SECRET, String(value))}`; }
function webhookSignature(timestamp, body) { return `sha256=${hmacHex(WEBHOOK_SECRET, `${timestamp}.${body}`)}`; }
const paymentLink = validHttpsUrl(STRIPE_PAYMENT_LINK);
const webhookUrl = validHttpsUrl(LEAD_WEBHOOK_URL);
if (STRIPE_PAYMENT_LINK && !paymentLink) { console.error('Invalid STRIPE_PAYMENT_LINK: expected an HTTPS URL without credentials or a fragment.'); process.exit(1); }
if (LEAD_WEBHOOK_URL && !webhookUrl) { console.error('Invalid LEAD_WEBHOOK_URL: expected an HTTPS URL without credentials or a fragment.'); process.exit(1); }
function sameOrigin(req) {
  const origin=req.get('origin');
  if (!origin) return true;
  try {
    const expected=APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    return new URL(origin).origin === new URL(expected).origin;
  } catch { return false; }
}
function noStore(res) { res.set('Cache-Control','no-store'); }
function requireJson(req,res,next) {
  if (!req.is('application/json')) return res.status(415).json({error:'Content-Type must be application/json.'});
  next();
}
function tokenHash(token) { return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex'); }
function newSession() {
  const token=crypto.randomBytes(32).toString('base64url');
  const csrf=crypto.randomBytes(32).toString('base64url');
  const now=Date.now();
  const create=db.transaction(() => {
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now);
    db.prepare('INSERT INTO admin_sessions(token_hash,csrf_token,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)')
      .run(tokenHash(token),csrf,now,now+SESSION_TTL_MS,now);
    const active=db.prepare('SELECT token_hash FROM admin_sessions ORDER BY created_at DESC').all();
    for (const row of active.slice(MAX_ACTIVE_SESSIONS)) db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(row.token_hash);
  });
  create();
  return {token,csrf};
}
function readSession(req) {
  const name=sessionCookieName();
  const raw=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1);
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const row=db.prepare('SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(tokenHash(raw),Date.now());
  if (!row) return null;
  db.prepare('UPDATE admin_sessions SET last_seen_at=? WHERE token_hash=?').run(Date.now(),row.token_hash);
  return {...row, token:raw};
}
function requireAdmin(req,res,next) {
  const session=readSession(req);
  if (!session) { noStore(res); return res.status(401).json({error:'Unauthorized'}); }
  req.adminSession=session;
  next();
}
function requireCsrf(req,res,next) {
  if (!sameOrigin(req)) return res.status(403).json({error:'Invalid request origin.'});
  const session=req.adminSession || readSession(req);
  const supplied=req.get('x-csrf-token');
  if (!session || !supplied || supplied.length !== session.csrf_token.length || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(session.csrf_token)))
    return res.status(403).json({error:'Invalid security token. Refresh and try again.'});
  next();
}
function secureCookie(value,maxAge) {
  const prefix=isProd?'__Host-sq_session':'sq_session';
  return `${prefix}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isProd?'; Secure':''}`;
}
function sessionCookieName(){ return isProd?'__Host-sq_session':'sq_session'; }

function requestHash(req) { return crypto.createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex'); }
function withIdempotency(req,res,scope,fn) {
  const key=clean(req.get('Idempotency-Key'),100);
  if(!/^[A-Za-z0-9._:-]{16,100}$/.test(key)) return res.status(400).json({error:'A valid Idempotency-Key is required for this operation.'});
  const accountId=req.account.account_id, hash=requestHash(req);
  const existing=db.prepare('SELECT request_hash,status_code,response_json FROM idempotency_keys WHERE account_id=? AND scope=? AND idem_key=?').get(accountId,scope,key);
  if(existing){ if(existing.request_hash!==hash)return res.status(409).json({error:'This Idempotency-Key was already used with different request data.'}); if(existing.response_json!==null)return res.status(existing.status_code||200).json(JSON.parse(existing.response_json)); return res.status(409).json({error:'This operation is already being processed.'}); }
  db.prepare('INSERT INTO idempotency_keys(account_id,scope,idem_key,request_hash,created_at) VALUES(?,?,?,?,?)').run(accountId,scope,key,hash,Date.now());
  let done=false; const original=res.json.bind(res); res.json=(body)=>{ if(!done){done=true;db.prepare('UPDATE idempotency_keys SET status_code=?,response_json=? WHERE account_id=? AND scope=? AND idem_key=?').run(res.statusCode,JSON.stringify(body),accountId,scope,key);} return original(body); };
  try { return fn(); } catch(e) { db.prepare('DELETE FROM idempotency_keys WHERE account_id=? AND scope=? AND idem_key=?').run(accountId,scope,key); throw e; }
}
function recordRisk(accountId,req,eventType,riskScore,metadata={}) {
  const ipHash=hmacHex(SESSION_SECRET,clientIp(req));
  db.prepare('INSERT INTO risk_events(account_id,ip_hash,event_type,risk_score,metadata,created_at) VALUES(?,?,?,?,?,?)').run(accountId,ipHash,eventType,Math.max(0,Math.min(100,Math.round(riskScore))),JSON.stringify(metadata),Date.now());
}
function riskForAccount(accountId,eventType) { return Number(db.prepare('SELECT COALESCE(AVG(risk_score),0) score FROM risk_events WHERE account_id=? AND event_type=? AND created_at>=?').get(accountId,eventType,Date.now()-30*86400000).score||0); }
function validSchedule(value) {
  if(!value || typeof value!=='object' || Array.isArray(value)) return false;
  const days=['sun','mon','tue','wed','thu','fri','sat'];
  for(const d of days){
    if(value[d]===undefined) continue;
    if(!Array.isArray(value[d])||value[d].length>4) return false;
    let previousEnd=-1;
    for(const slot of value[d]){
      if(!slot||typeof slot!=='object'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(slot.start))||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(slot.end))) return false;
      const [sh,sm]=String(slot.start).split(':').map(Number),[eh,em]=String(slot.end).split(':').map(Number);
      const start=sh*60+sm,end=eh*60+em;
      if(end<=start || start<previousEnd) return false;
      previousEnd=end;
    }
  }
  return true;
}
function availabilityForProvider(accountId) { const row=db.prepare('SELECT timezone,schedule_json,blackout_json,updated_at FROM provider_availability WHERE provider_account_id=?').get(accountId); return row ? {timezone:row.timezone,schedule:safeJson(row.schedule_json),blackouts:safeJson(row.blackout_json),updatedAt:row.updated_at} : {timezone:'UTC',schedule:{},blackouts:[],updatedAt:null}; }
function providerSlotAvailable(accountId, timestamp) {
  const row=db.prepare('SELECT timezone,schedule_json,blackout_json FROM provider_availability WHERE provider_account_id=?').get(accountId);
  if(!row) return true;
  const tz=String(row.timezone||'UTC');
  let parts;
  try { parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(timestamp)); } catch { return false; }
  const get=k=>parts.find(x=>x.type===k)?.value||'';
  const day={Sun:'sun',Mon:'mon',Tue:'tue',Wed:'wed',Thu:'thu',Fri:'fri',Sat:'sat'}[get('weekday')];
  const date=`${get('year')}-${get('month')}-${get('day')}`;
  const minutes=Number(get('hour'))*60+Number(get('minute'));
  const blackouts=safeJson(row.blackout_json);
  if(Array.isArray(blackouts)&&blackouts.some(x=>String(x?.date||'')===date)) return false;
  const schedule=safeJson(row.schedule_json);
  const slots=Array.isArray(schedule?.[day])?schedule[day]:[];
  return slots.some(slot=>{const [sh,sm]=String(slot.start).split(':').map(Number);const [eh,em]=String(slot.end).split(':').map(Number);return Number.isInteger(sh)&&Number.isInteger(sm)&&Number.isInteger(eh)&&Number.isInteger(em)&&minutes>=sh*60+sm&&minutes<eh*60+em;});
}
function customerReliability(accountId){
  const completed=Number(db.prepare("SELECT COUNT(*) c FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE l.customer_account_id=? AND j.status='completed'").get(accountId).c);
  const canceled=Number(db.prepare("SELECT COUNT(*) c FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE l.customer_account_id=? AND j.status='canceled'").get(accountId).c);
  const disputes=Number(db.prepare("SELECT COUNT(*) c FROM disputes WHERE opened_by_account_id=? OR against_account_id=?").get(accountId,accountId).c);
  const noShows=Number(db.prepare("SELECT COUNT(*) c FROM trust_events WHERE account_id=? AND event_type='no_show'").get(accountId).c);
  const score=Math.max(0,Math.min(100,100-Math.min(40,canceled*10)-Math.min(25,disputes*5)-Math.min(30,noShows*15)+Math.min(15,completed*2)));
  return {reliabilityScore:score,completedJobs:completed,cancellations:canceled,disputes,noShows};
}
function refreshCustomerMetrics(accountId){
  const completed=Number(db.prepare("SELECT COUNT(*) c FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE l.customer_account_id=? AND j.status='completed'").get(accountId).c);
  const canceled=Number(db.prepare("SELECT COUNT(*) c FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE l.customer_account_id=? AND j.status='canceled'").get(accountId).c);
  const disputes=Number(db.prepare("SELECT COUNT(*) c FROM disputes WHERE opened_by_account_id=? OR against_account_id=?").get(accountId,accountId).c);
  const noShows=Number(db.prepare("SELECT COUNT(*) c FROM trust_events WHERE account_id=? AND event_type='no_show'").get(accountId).c);
  const score=Math.max(0,Math.min(100,100-Math.min(40,canceled*10)-Math.min(25,disputes*5)-Math.min(30,noShows*15)+Math.min(15,completed*2)));
  db.prepare('INSERT INTO customer_metrics(account_id,reliability_score,completed_jobs,cancellations,disputes,no_shows,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET reliability_score=excluded.reliability_score,completed_jobs=excluded.completed_jobs,cancellations=excluded.cancellations,disputes=excluded.disputes,no_shows=excluded.no_shows,updated_at=excluded.updated_at').run(accountId,score,completed,canceled,disputes,noShows,Date.now());
  return {reliabilityScore:score,completedJobs:completed,cancellations:canceled,disputes,noShows};
}
function providerWorkload(accountId){ return Number(db.prepare("SELECT COUNT(*) c FROM jobs WHERE provider_account_id=? AND status IN ('scheduled','in_progress')").get(accountId).c); }
function trustGraph(accountId,provider=true){
  if(provider){const t=refreshProviderMetrics(accountId);const p=db.prepare('SELECT verified,jobs_completed,rating FROM provider_profiles WHERE account_id=?').get(accountId)||{};return {verified:!!p.verified,jobsCompleted:Number(p.jobs_completed||0),rating:Number(p.rating||0),reliabilityScore:t.reliabilityScore,responseRate:t.responseRate,completionRate:t.completionRate,workload:providerWorkload(accountId)};}
  return refreshCustomerMetrics(accountId);
}
function reviewRisk(rating,comment,accountId,leadId){
  let score=0;const reasons=[];const text=String(comment||'').toLowerCase();
  if(text.length>900){score+=10;reasons.push('unusually_long');}
  if(/\b(guaranteed|paid|cash|money back)\b/.test(text)){score+=10;reasons.push('transaction_language');}
  const recent=Number(db.prepare('SELECT COUNT(*) c FROM reviews WHERE customer_account_id=? AND created_at>=?').get(accountId,Date.now()-86400000).c);
  if(recent>=5){score+=45;reasons.push('many_reviews_same_day');}
  if(db.prepare('SELECT 1 FROM reviews WHERE customer_account_id=? AND lead_id<>? AND comment=? LIMIT 1').get(accountId,leadId,comment)){score+=25;reasons.push('duplicate_comment');}
  return {score:Math.min(100,score),reasons};
}
function priceBenchmark(service){
  const vals=db.prepare("SELECT amount FROM quotes WHERE status IN ('accepted','paid') AND lead_id IN (SELECT id FROM leads WHERE service=?) ORDER BY amount").all(service).map(x=>Number(x.amount)).filter(Number.isFinite);
  if(!vals.length)return null; const q=(p)=>vals[Math.min(vals.length-1,Math.floor((vals.length-1)*p))];
  return {sampleCount:vals.length,medianAmount:q(.5),p25Amount:q(.25),p75Amount:q(.75)};
}
function updatePriceBenchmark(service){
  const vals=db.prepare("SELECT amount FROM quotes WHERE status IN ('accepted','paid') AND lead_id IN (SELECT id FROM leads WHERE service=?) ORDER BY amount").all(service).map(x=>Number(x.amount)).filter(Number.isFinite);
  if(!vals.length)return null; const q=(p)=>vals[Math.min(vals.length-1,Math.floor((vals.length-1)*p))]; const median=q(.5);
  db.prepare('INSERT INTO service_price_benchmarks(service,sample_count,median_amount,p25_amount,p75_amount,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(service) DO UPDATE SET sample_count=excluded.sample_count,median_amount=excluded.median_amount,p25_amount=excluded.p25_amount,p75_amount=excluded.p75_amount,updated_at=excluded.updated_at').run(service,vals.length,median,q(.25),q(.75),Date.now());
  return {sampleCount:vals.length,medianAmount:median,p25Amount:q(.25),p75Amount:q(.75)};
}
function scheduleReminder(accountId,kind,message,dueAt){db.prepare('INSERT INTO scheduled_notifications(account_id,kind,message,due_at,created_at) VALUES(?,?,?,?,?)').run(accountId,kind,message,dueAt,Date.now());}
function jobParticipant(jobId,accountId){
  return db.prepare(`SELECT j.id,j.status,j.provider_account_id,l.customer_account_id,l.service FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE j.id=? AND (j.provider_account_id=? OR l.customer_account_id=?)`).get(jobId,accountId,accountId);
}
function sanitizeMessage(v){
  const x=clean(v,2000);
  if(!x || /(?:https?:\/\/|www\.|@)/i.test(x)) return '';
  return x;
}
function scheduleJobReminders(jobId,scheduledAt){
  const job=db.prepare('SELECT j.provider_account_id,l.customer_account_id,l.service FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE j.id=?').get(jobId);
  if(!job||!scheduledAt)return;
  db.prepare("DELETE FROM scheduled_notifications WHERE kind='appointment_reminder' AND status='pending' AND message LIKE ?").run(`%job #${jobId}%`);
  const due=Math.max(Date.now(),scheduledAt-24*60*60*1000);
  const msg=`Reminder: your ${job.service} appointment is scheduled soon (job #${jobId}).`;
  scheduleReminder(job.customer_account_id,'appointment_reminder',msg,due);
  scheduleReminder(job.provider_account_id,'appointment_reminder',`Reminder: your ${job.service} appointment is scheduled soon (job #${jobId}).`,due);
}
function recordJobStatus(jobId,actorId,fromStatus,toStatus,note=''){db.prepare('INSERT INTO job_status_events(job_id,actor_account_id,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?)').run(jobId,actorId,fromStatus,toStatus,clean(note,500),Date.now());}
function processScheduledNotifications(){const now=Date.now();const rows=db.prepare("SELECT id,account_id,kind,message FROM scheduled_notifications WHERE status='pending' AND due_at<=? ORDER BY due_at LIMIT 100").all(now);const tx=db.transaction(()=>{for(const r of rows){addNotification(r.account_id,r.kind,r.message);db.prepare("UPDATE scheduled_notifications SET status='sent' WHERE id=? AND status='pending'").run(r.id);}});tx();}
setInterval(processScheduledNotifications,60_000).unref();


app.get('/api/config',(req,res)=>{ noStore(res); res.json({appName:APP_NAME,businessName:BUSINESS_NAME,paymentLink}); });

app.post('/api/quote',requireJson,async(req,res)=>{
  noStore(res);
  if(!sameOrigin(req)) return res.status(403).json({error:'Invalid request origin.'});
  const ip=clientIp(req);
  if(!rateLimit(rateKey('quote-ip',ip),10,60_000)) return res.status(429).json({error:'Too many requests. Please wait a minute and try again.'});
  const input=req.body||{};
  if (clean(input.website,120)) return res.status(400).json({error:'Invalid submission.'});
  const body={name:clean(input.name,100),phone:clean(input.phone,40),email:clean(input.email,160),service:clean(input.service,40),jobSize:clean(input.jobSize,20),timing:clean(input.timing,60),address:clean(input.address,180),zip:normalizeZip(input.zip),details:clean(input.details,2000)};
  const range=estimate(body.service,body.jobSize);
  if(!body.name||!body.phone||!validEmail(body.email)||!range||!body.timing||!body.address||!body.details)
    return res.status(400).json({error:'Please complete every required field with valid information.'});
  const emailKey=body.email.toLowerCase();
  const phoneKey=body.phone.replace(/\D/g,'');
  if(!rateLimit(rateKey('quote-email',emailKey),3,10*60_000) || (phoneKey.length>=7 && !rateLimit(rateKey('quote-phone',phoneKey),3,10*60_000)))
    return res.status(429).json({error:'Too many quote requests for this contact information. Please wait a few minutes.'});
  let aiSummary=''; let priority='normal';
  if(ai.configured){
    try {
      aiSummary=clean(await ai.generateText({
        system:'You qualify local-service leads. Return concise plain text only. Identify urgency, scope clues, and useful follow-up questions. Never promise a final price. Never repeat personal contact details or full addresses. Start with PRIORITY: high|normal|low on its own line.',
        user:`Service: ${rates[body.service].label}\nSize: ${body.jobSize}\nTiming: ${body.timing}\nDetails: ${body.details}`,
        maxOutputTokens:250,
      }),1200);
      const m=aiSummary.match(/PRIORITY:\s*(high|normal|low)/i); if(m) priority=m[1].toLowerCase();
    } catch(e) { console.error('AI qualification failed:',e.message); }
  }
  const createdAt=new Date().toISOString();
  const result=db.prepare(`INSERT INTO leads(created_at,name,phone,email,service,job_size,timing,address,details,estimate_min,estimate_max,ai_summary,ai_priority,status,source,industry,source_lead_id,source_url,lead_score,next_action,estimated_value,zip_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(createdAt,body.name,body.phone,body.email,rates[body.service].label,body.jobSize,body.timing,body.address,body.details,range.min,range.max,aiSummary,priority,'new','website',normalizeIndustry(body.service),null,null,scoreLead({phone:body.phone,email:body.email,details:body.details,timing:body.timing,estimateMax:range.max}),nextActionFor(scoreLead({phone:body.phone,email:body.email,details:body.details,timing:body.timing,estimateMax:range.max}),body.timing),range.max,body.zip);
  createMatchesForLead(Number(result.lastInsertRowid));
  const lead={id:Number(result.lastInsertRowid),createdAt,name:body.name,phone:body.phone,email:body.email,service:rates[body.service].label,jobSize:body.jobSize,timing:body.timing,address:body.address,details:body.details,estimateMin:range.min,estimateMax:range.max,aiSummary,priority};
  if(webhookUrl){
    const payload=JSON.stringify(lead); const timestamp=Math.floor(Date.now()/1000).toString();
    const headers={'content-type':'application/json','x-swiftquote-timestamp':timestamp,'x-swiftquote-signature':webhookSignature(timestamp,payload)};
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),5_000);
    fetch(webhookUrl,{method:'POST',redirect:'error',headers,body:payload,signal:controller.signal}).then(r=>{ if(!r.ok) throw new Error(`Webhook HTTP ${r.status}`); db.prepare('INSERT INTO webhook_deliveries(lead_id,created_at) VALUES(?,?)').run(lead.id,Date.now()); }).catch(e=>console.error('Webhook failed:',e.message)).finally(()=>clearTimeout(timer));
  }
  res.status(201).json({ok:true,leadId:lead.id,estimate:range,serviceLabel:lead.service,priority,summary:aiSummary,paymentLink});
});

app.post('/api/admin/login',requireJson,(req,res)=>{
  noStore(res);
  if(!sameOrigin(req)) return res.status(403).json({error:'Invalid request origin.'});
  const ip=clientIp(req);
  if(!rateLimit(rateKey('login-ip',ip),5,15*60_000) || !rateLimit('login:global',25,15*60_000)) return res.status(429).json({error:'Too many login attempts. Try again later.'});
  const password=String((req.body||{}).password||'');
  const a=Buffer.from(password); const b=Buffer.from(ADMIN_PASSWORD);
  const match=a.length===b.length && crypto.timingSafeEqual(a,b);
  if(!match || password.length===0 || password.length>200) return res.status(401).json({error:'Invalid password'});
  const {token,csrf}=newSession();
  res.setHeader('Set-Cookie',secureCookie(token,Math.floor(SESSION_TTL_MS/1000)));
  res.json({ok:true,csrfToken:csrf});
});

app.get('/api/admin/session',(req,res)=>{
  noStore(res); const session=readSession(req);
  if(!session) return res.status(401).json({error:'Unauthorized'});
  res.json({ok:true,csrfToken:session.csrf_token});
});

app.post('/api/admin/logout',requireAdmin,requireCsrf,(req,res)=>{
  noStore(res);
  db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(req.adminSession.token_hash);
  res.setHeader('Set-Cookie',`${sessionCookieName()}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isProd?'; Secure':''}`);
  res.json({ok:true});
});

app.get('/api/admin/leads',requireAdmin,(req,res)=>{
  noStore(res);
  if(!rateLimit(rateKey('admin-ip',clientIp(req)),120,60_000)) return res.status(429).json({error:'Too many requests.'});
  const rawLimit=req.query.limit ?? '50';
  const rawOffset=req.query.offset ?? '0';
  const parsedLimit=Number(rawLimit);
  const parsedOffset=Number(rawOffset);
  if(!Number.isSafeInteger(parsedLimit) || parsedLimit<1 || parsedLimit>100 || !Number.isSafeInteger(parsedOffset) || parsedOffset<0 || parsedOffset>1_000_000)
    return res.status(400).json({error:'Invalid pagination parameters.'});
  const limit=parsedLimit;
  const offset=parsedOffset;
  const rows=db.prepare('SELECT id,created_at,name,phone,email,service,job_size,timing,estimate_min,estimate_max,ai_priority,status,source,industry,lead_score,next_action,estimated_value FROM leads ORDER BY lead_score DESC, id DESC LIMIT ? OFFSET ?').all(limit,offset);
  const stats=db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(estimated_value),0) value, COALESCE(SUM(CASE WHEN status='new' THEN 1 ELSE 0 END),0) new, COALESCE(SUM(CASE WHEN lead_score>=80 THEN 1 ELSE 0 END),0) hot, COALESCE(SUM(CASE WHEN status='booked' THEN 1 ELSE 0 END),0) booked FROM leads`).get();
  const count=db.prepare('SELECT COUNT(*) total FROM leads').get().total;
  res.json({leads:rows,stats:{total:Number(stats.total),value:Number(stats.value),new:Number(stats.new),hot:Number(stats.hot),booked:Number(stats.booked)},pagination:{offset,limit,hasMore:offset+rows.length<count}});
});

app.get('/api/admin/leads/:id',requireAdmin,(req,res)=>{
  noStore(res);
  if(!rateLimit(rateKey('admin-detail-ip',clientIp(req)),120,60_000)) return res.status(429).json({error:'Too many requests.'});
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:'Invalid lead id'});
  const row=db.prepare('SELECT * FROM leads WHERE id=?').get(id);
  if(!row) return res.status(404).json({error:'Lead not found'});
  res.json({lead:row});
});

app.patch('/api/admin/leads/:id',requireAdmin,requireCsrf,requireJson,(req,res)=>{
  noStore(res);
  if(!rateLimit(rateKey('admin-write-ip',clientIp(req)),60,60_000)) return res.status(429).json({error:'Too many requests.'});
  const status=clean((req.body||{}).status,30); const id=Number(req.params.id);
  if(!statuses.has(status)) return res.status(400).json({error:'Invalid status'});
  if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:'Invalid lead id'});
  const result=db.prepare('UPDATE leads SET status=? WHERE id=?').run(status,id); if(result.changes) db.prepare('INSERT INTO lead_events(lead_id,event_type,payload,created_at) VALUES(?,?,?,?)').run(id,'status_change',JSON.stringify({status}),Date.now());
  if(!result.changes) return res.status(404).json({error:'Lead not found'});
  res.json({ok:true});
});

app.get('/api/admin/industries',requireAdmin,(req,res)=>{ noStore(res); res.json({industries}); });
app.post('/api/admin/leads/:id/ai-draft',requireAdmin,requireCsrf,requireJson,async(req,res)=>{
  noStore(res); if(!ai.configured) return res.status(503).json({error:'AI drafting is not configured.'});
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:'Invalid lead id'});
  const lead=db.prepare('SELECT service,job_size,timing,details,industry,ai_priority,next_action FROM leads WHERE id=?').get(id); if(!lead) return res.status(404).json({error:'Lead not found'});
  try {
    const draft=clean(await ai.generateText({
      system:'Draft a concise professional first-response message for a local service lead. Do not invent pricing, availability, names, addresses, phone numbers, emails, guarantees, or facts. Do not mention AI. Plain text only.',
      user:JSON.stringify({service:lead.service,jobSize:lead.job_size,timing:lead.timing,details:lead.details,industry:lead.industry,priority:lead.ai_priority,nextAction:lead.next_action}),
      maxOutputTokens:180,
    }),1500); if(!draft) return res.status(502).json({error:'AI returned no draft.'});
    db.prepare('INSERT INTO lead_events(lead_id,event_type,payload,created_at) VALUES(?,?,?,?)').run(id,'ai_draft',JSON.stringify({length:draft.length}),Date.now());
    res.json({ok:true,draft});
  } catch { res.status(502).json({error:'AI drafting failed.'}); }
});


app.get('/api/admin/analytics',requireAdmin,(req,res)=>{
  noStore(res);
  const bySource=db.prepare('SELECT source, COUNT(*) count, COALESCE(SUM(estimated_value),0) value FROM leads GROUP BY source ORDER BY count DESC').all();
  const byIndustry=db.prepare('SELECT industry, COUNT(*) count, COALESCE(SUM(estimated_value),0) value FROM leads GROUP BY industry ORDER BY count DESC').all();
  const pipeline=db.prepare("SELECT status, COUNT(*) count, COALESCE(SUM(estimated_value),0) value FROM leads GROUP BY status").all();
  const followups=db.prepare("SELECT COUNT(*) pending FROM followups WHERE status='pending' AND due_at<=?").get(Date.now()).pending;
  res.json({bySource,byIndustry,pipeline,overdueFollowups:Number(followups)});
});
app.get('/api/admin/leads/:id/events',requireAdmin,(req,res)=>{ noStore(res); const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid lead id'}); res.json({events:db.prepare('SELECT id,event_type,payload,created_at FROM lead_events WHERE lead_id=? ORDER BY id DESC LIMIT 100').all(id)}); });
app.post('/api/admin/leads/:id/followup',requireAdmin,requireCsrf,requireJson,(req,res)=>{ noStore(res); const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid lead id'}); const channel=clean(req.body.channel,20).toLowerCase(); if(!['email','sms','call','task'].includes(channel))return res.status(400).json({error:'Invalid follow-up channel'}); const due=Number(req.body.dueAt); const message=clean(req.body.message,2000); if(!Number.isSafeInteger(due)||due<Date.now()-60000||!message)return res.status(400).json({error:'Invalid follow-up'}); if(!db.prepare('SELECT 1 FROM leads WHERE id=?').get(id))return res.status(404).json({error:'Lead not found'}); const r=db.prepare('INSERT INTO followups(lead_id,channel,due_at,status,message,created_at) VALUES(?,?,?,?,?,?)').run(id,channel,due,'pending',message,Date.now()); db.prepare('INSERT INTO lead_events(lead_id,event_type,payload,created_at) VALUES(?,?,?,?)').run(id,'followup_created',JSON.stringify({channel,dueAt:due}),Date.now()); res.status(201).json({ok:true,id:Number(r.lastInsertRowid)}); });
app.get('/api/admin/followups',requireAdmin,(req,res)=>{ noStore(res); const rows=db.prepare("SELECT f.id,f.lead_id,f.channel,f.due_at,f.status,f.message,l.name,l.phone,l.email FROM followups f JOIN leads l ON l.id=f.lead_id WHERE f.status='pending' ORDER BY f.due_at ASC LIMIT 100").all(); res.json({followups:rows}); });
app.get('/api/admin/sources',requireAdmin,(req,res)=>{
  noStore(res);
  const rows=db.prepare('SELECT id,name,kind,industry,enabled,created_at,last_sync_at,last_error FROM lead_sources ORDER BY id DESC').all();
  res.json({sources:rows});
});

app.post('/api/admin/sources',requireAdmin,requireCsrf,requireJson,(req,res)=>{
  noStore(res);
  const b=req.body||{}; const name=clean(b.name,100); const kind=clean(b.kind,40); const industry=normalizeIndustry(b.industry); const externalId=clean(b.externalId,200); const accessToken=clean(b.accessToken,4000); const endpoint=safeSourceUrl(b.endpoint);
  if(!name||!sourceKinds.has(kind)) return res.status(400).json({error:'Invalid source configuration.'});
  if(['meta_lead_ads','instagram_lead_ads','linkedin_lead_sync'].includes(kind) && (!externalId||!accessToken)) return res.status(400).json({error:'This source requires an external form/account ID and access token.'});
  if(kind==='webhook' && !strongSecret(accessToken,32)) return res.status(400).json({error:'Webhook sources require a 32+ character secret.'});
  if(['meta_lead_ads','instagram_lead_ads','linkedin_lead_sync'].includes(kind) && endpoint==='') return res.status(400).json({error:'Endpoint must be an approved HTTPS platform URL.'});
  const config=encryptSecret(JSON.stringify({accessToken,externalId,endpoint}));
  const result=db.prepare('INSERT INTO lead_sources(name,kind,industry,enabled,config_enc,created_at) VALUES(?,?,?,?,?,?)').run(name,kind,industry,1,config,Date.now());
  res.status(201).json({ok:true,id:Number(result.lastInsertRowid)});
});

app.post('/api/admin/sources/:id/sync',requireAdmin,requireCsrf,async(req,res)=>{
  noStore(res); const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:'Invalid source id'});
  if(!rateLimit(rateKey('source-sync',`${clientIp(req)}:${id}`),20,60_000)) return res.status(429).json({error:'Too many sync attempts.'});
  const source=db.prepare('SELECT * FROM lead_sources WHERE id=?').get(id); if(!source) return res.status(404).json({error:'Source not found'});
  if(!source.enabled) return res.status(409).json({error:'Source is disabled.'});
  const cfg=safeJson(decryptSecret(source.config_enc)); if(!cfg.accessToken) return res.status(400).json({error:'Source credentials are missing or invalid.'});
  if(source.kind==='tiktok_lead_gen' || source.kind==='webhook' || source.kind==='csv' || source.kind==='manual' || source.kind==='website') return res.status(409).json({error:'This source uses push/import mode rather than polling.'});
  const endpoint=cfg.endpoint; if(!endpoint) return res.status(400).json({error:'Source endpoint is not configured.'});
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000); let response;
  try { response=await fetch(endpoint,{headers:{authorization:`Bearer ${cfg.accessToken}`,accept:'application/json'},redirect:'error',signal:controller.signal}); if(Number(response.headers.get('content-length')||0)>2_000_000) throw new Error('upstream response too large'); if(!response.ok) throw new Error(`upstream HTTP ${response.status}`); const payload=await response.json(); const items=Array.isArray(payload)?payload:(payload.data||payload.elements||payload.results||payload.leads||[]); let imported=0,duplicates=0,rejected=0;
    const stmt=db.prepare('INSERT INTO leads(created_at,name,phone,email,service,job_size,timing,address,details,estimate_min,estimate_max,ai_summary,ai_priority,status,source,industry,source_lead_id,source_url,lead_score,next_action,estimated_value,zip_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const tx=db.transaction(()=>{ for(const raw of items.slice(0,100)){ const x=mapImportedLead(raw,source); if(!validImportedLead(x)){rejected++;continue;} if(x.sourceLeadId && db.prepare('SELECT 1 FROM leads WHERE source=? AND source_lead_id=?').get(sourceKey(source),x.sourceLeadId)){duplicates++;continue;} stmt.run(new Date().toISOString(),x.name,x.phone||'Not provided',x.email||'not-provided@example.invalid',x.service,'unknown',x.timing,x.address,x.details,x.estimateMin,x.estimateMax,'','normal','new',sourceKey(source),x.industry,x.sourceLeadId,x.sourceUrl,x.leadScore,x.nextAction,x.estimateMax,x.zipCode); imported++; }}); tx(); db.prepare('UPDATE lead_sources SET last_sync_at=?,last_error=NULL WHERE id=?').run(Date.now(),id); for(const row of db.prepare("SELECT id FROM leads WHERE source=? AND created_at>=?").all(sourceKey(source),new Date(Date.now()-60000).toISOString())) createMatchesForLead(row.id); res.json({ok:true,imported,duplicates,rejected});
  } catch(e){ db.prepare('UPDATE lead_sources SET last_sync_at=?,last_error=? WHERE id=?').run(Date.now(),clean(e.message,500),id); res.status(502).json({error:'Lead source sync failed.'}); } finally {clearTimeout(timer);}
});

app.post('/api/intake/:sourceKey',requireJson,(req,res)=>{
  noStore(res); const key=clean(req.params.sourceKey,100); const row=db.prepare('SELECT * FROM lead_sources WHERE id=? AND enabled=1').get(Number(key));
  if(!row || !['webhook','tiktok_lead_gen'].includes(row.kind)) return res.status(404).json({error:'Intake source not found.'});
  const cfg=safeJson(decryptSecret(row.config_enc)); const supplied=req.get('x-swiftquote-source-secret')||'';
  if(!supplied || !cfg.accessToken || supplied.length!==cfg.accessToken.length || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(cfg.accessToken))) return res.status(401).json({error:'Unauthorized source.'});
  const x=mapImportedLead(req.body,row); if(!validImportedLead(x)) return res.status(400).json({error:'Lead data is incomplete.'});
  if(x.sourceLeadId && db.prepare('SELECT 1 FROM leads WHERE source=? AND source_lead_id=?').get(sourceKey(row),x.sourceLeadId)) return res.status(200).json({ok:true,duplicate:true});
  const r=db.prepare('INSERT INTO leads(created_at,name,phone,email,service,job_size,timing,address,details,estimate_min,estimate_max,ai_summary,ai_priority,status,source,industry,source_lead_id,source_url,lead_score,next_action,estimated_value,zip_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(new Date().toISOString(),x.name,x.phone||'Not provided',x.email||'not-provided@example.invalid',x.service,'unknown',x.timing,x.address,x.details,x.estimateMin,x.estimateMax,'','normal','new',sourceKey(row),x.industry,x.sourceLeadId,x.sourceUrl,x.leadScore,x.nextAction,x.estimateMax,x.zipCode);
  createMatchesForLead(Number(r.lastInsertRowid));
  res.status(201).json({ok:true,leadId:Number(r.lastInsertRowid)});
});

app.get('/api/marketplace/services',(req,res)=>{noStore(res);const services=db.prepare('SELECT slug id,label,industry FROM service_catalog WHERE active=1 ORDER BY industry,label').all();res.json({industries,services});});
app.get('/api/marketplace/providers',(req,res)=>{noStore(res);const industry=normalizeIndustry(req.query.industry);const zip=normalizeZip(req.query.zip);const rows=db.prepare("SELECT a.id,p.provider_kind,p.business_name,p.industry,p.service_area,p.description,p.verified,p.rating,p.jobs_completed,p.services_json,p.zip_codes FROM accounts a JOIN provider_profiles p ON p.account_id=a.id JOIN subscriptions s ON s.account_id=a.id WHERE a.account_type='provider' AND a.status='active' AND s.status='active' AND (s.current_period_end IS NULL OR s.current_period_end>?)").all(Date.now());const providers=rows.filter(p=>(industry==='general'||p.industry==='general'||p.industry===industry)&&(!zip||p.zip_codes.split(/[ ,]+/).map(normalizeZip).includes(zip)||(!zip?true:!!db.prepare('SELECT 1 FROM provider_service_areas WHERE provider_account_id=? AND zip_code=?').get(p.id,zip)))).slice(0,50).map(p=>{const m=providerReliability(p.id);const {zip_codes,services_json,...safe}=p;return {...safe,services:safeJson(services_json),reliability_score:m.reliabilityScore,response_rate:m.responseRate,completion_rate:m.completionRate};});res.json({providers});});
app.get('/api/marketplace/providers/:id',(req,res)=>{noStore(res);const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid provider id.'});const p=db.prepare(`SELECT a.id,p.provider_kind,p.business_name,p.industry,p.service_area,p.description,p.verified,p.rating,p.jobs_completed,p.services_json,p.zip_codes FROM accounts a JOIN provider_profiles p ON p.account_id=a.id JOIN subscriptions s ON s.account_id=a.id WHERE a.id=? AND a.account_type='provider' AND a.status='active' AND s.status='active' AND (s.current_period_end IS NULL OR s.current_period_end>?)`).get(id,Date.now());if(!p)return res.status(404).json({error:'Provider not found.'});const m=providerReliability(id);const {zip_codes,services_json,...safe}=p;const configuredAreas=db.prepare('SELECT zip_code,radius_miles,emergency_available FROM provider_service_areas WHERE provider_account_id=? ORDER BY zip_code').all(id);res.json({provider:{...safe,services:safeJson(services_json),serviceAreas:configuredAreas.length?configuredAreas:zip_codes.split(/[ ,]+/).map(normalizeZip).filter(Boolean).map(zip_code=>({zip_code,radius_miles:0,emergency_available:0}))},trust:m});});

app.post('/api/account/register',requireJson,(req,res)=>{noStore(res);if(!sameOrigin(req))return res.status(403).json({error:'Origin not allowed.'});if(!rateLimit(rateKey('register',clientIp(req)),10,3600000))return res.status(429).json({error:'Too many registration attempts.'});const b=req.body||{};const name=clean(b.name,100),email=clean(b.email,160).toLowerCase(),password=String(b.password||'');const type=clean(b.accountType,20).toLowerCase();if(name.length<2||!validEmail(email)||password.length<12||password.length>200||!['customer','provider'].includes(type))return res.status(400).json({error:'Provide a valid name, email, 12+ character password, and account type.'});try{const now=Date.now();const r=db.prepare('INSERT INTO accounts(account_type,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(type,name,email,hashPassword(password),now);const id=Number(r.lastInsertRowid);if(type==='provider'){const kind=['individual','contractor','company'].includes(b.providerKind)?b.providerKind:'individual';const services=Array.isArray(b.services)?b.services.map(x=>clean(x,80)).filter(Boolean).slice(0,30):[];db.prepare('INSERT INTO provider_profiles(account_id,provider_kind,business_name,industry,services_json,service_area,zip_codes,description) VALUES(?,?,?,?,?,?,?,?)').run(id,kind,clean(b.businessName||name,120),normalizeIndustry(b.industry),JSON.stringify(services),clean(b.serviceArea,200),clean(b.zipCodes,300),clean(b.description,1000));const chosenPlan=Object.hasOwn(providerPlans,clean(b.plan,20))?clean(b.plan,20):'starter';db.prepare('INSERT INTO subscriptions(account_id,plan,status,current_period_end,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,chosenPlan,'payment_required',null,now,now);}const session=providerSession(id);audit(id,'account','account_created','account',id,{accountType:type});setAccountCookie(res,session.token);res.status(201).json({ok:true,accountId:id,accountType:type,csrf:session.csrf,subscription:type==='provider'?'payment_required':'free'});}catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'An account with that email already exists.'});throw e;}});
app.post('/api/account/login',requireJson,(req,res)=>{noStore(res);if(!sameOrigin(req))return res.status(403).json({error:'Origin not allowed.'});const email=clean(req.body?.email,160).toLowerCase(),password=String(req.body?.password||'');if(!rateLimit(rateKey('login',clientIp(req)),15,900000)||(!email||!rateLimit(rateKey('login-email',email),8,900000)))return res.status(429).json({error:'Too many login attempts.'});const a=db.prepare('SELECT * FROM accounts WHERE email=?').get(email);if(!a||!verifyPassword(password,a.password_hash))return res.status(401).json({error:'Invalid email or password.'});const session=providerSession(a.id);audit(a.id,'account','login','account',a.id);setAccountCookie(res,session.token);res.json({ok:true,accountId:a.id,accountType:a.account_type,csrf:session.csrf,subscription:a.account_type==='provider'?(db.prepare('SELECT status,plan,current_period_end FROM subscriptions WHERE account_id=?').get(a.id)||{status:'payment_required'}):'free'});});
app.post('/api/account/change-password',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);return withIdempotency(req,res,'change-password',()=>{const current=String(req.body?.currentPassword||''),next=String(req.body?.newPassword||'');if(current.length<12||next.length<12||next.length>200)return res.status(400).json({error:'Passwords must be 12 to 200 characters.'});const a=db.prepare('SELECT password_hash FROM accounts WHERE id=?').get(req.account.account_id);if(!a||!verifyPassword(current,a.password_hash))return res.status(401).json({error:'Current password is incorrect.'});if(current===next)return res.status(400).json({error:'New password must be different.'});db.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(hashPassword(next),req.account.account_id);const cookieName=accountCookieName();const raw=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`))?.slice(cookieName.length+1)||'';const currentHash=raw?tokenHash(raw):'';if(currentHash)db.prepare('DELETE FROM provider_sessions WHERE account_id=? AND token_hash<>?').run(req.account.account_id,currentHash);else db.prepare('DELETE FROM provider_sessions WHERE account_id=?').run(req.account.account_id);audit(req.account.account_id,'account','password_changed','account',req.account.account_id);res.json({ok:true});});});
app.post('/api/account/logout',requireAccount,requireAccountCsrf,(req,res)=>{noStore(res);const name=accountCookieName();const raw=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1);if(raw)db.prepare('DELETE FROM provider_sessions WHERE token_hash=?').run(tokenHash(raw));clearAccountCookie(res);res.json({ok:true});});
app.get('/api/account/me',requireAccount,(req,res)=>{noStore(res);const a=req.account;const profile=a.account_type==='provider'?db.prepare('SELECT provider_kind,business_name,industry,services_json,service_area,zip_codes,description,verified,rating,jobs_completed FROM provider_profiles WHERE account_id=?').get(a.account_id):null;const subscription=a.account_type==='provider'?db.prepare('SELECT plan,status,current_period_end FROM subscriptions WHERE account_id=?').get(a.account_id):null;res.json({account:{id:a.account_id,type:a.account_type,name:a.name,email:a.email},profile,subscription});});
app.post('/api/ai/structure-request',requireAccount,requireAccountCsrf,requireJson,async(req,res)=>{noStore(res);if(!ai.configured)return res.status(503).json({error:'AI assistance is not configured.'});if(!rateLimit(rateKey('ai-structure',req.account.account_id),20,3600000))return res.status(429).json({error:'AI request limit reached.'});const text=clean(req.body?.text,4000);if(text.length<10)return res.status(400).json({error:'Describe the service need in at least 10 characters.'});try{const out=String(await ai.generateText({system:'Convert a local-service customer description into JSON only. Never invent price, diagnosis, credentials, urgency, or facts. Use null when unknown. Keys: service, industry, urgency, summary, questions (array of short questions), suggested_timing.',user:text,maxOutputTokens:500,json:true})).trim();const parsed=JSON.parse(out);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('invalid');const safe={service:clean(parsed.service,120),industry:normalizeIndustry(parsed.industry||'general'),urgency:['low','normal','high'].includes(parsed.urgency)?parsed.urgency:'normal',summary:clean(parsed.summary,600),questions:Array.isArray(parsed.questions)?parsed.questions.map(x=>clean(x,160)).filter(Boolean).slice(0,8):[],suggested_timing:clean(parsed.suggested_timing,80)};recordRisk(req.account.account_id,req,'ai_structure',0,{chars:text.length});res.json({ok:true,result:safe});}catch{return res.status(502).json({error:'AI could not safely structure this request. Please enter the details manually.'});}});

app.post('/api/marketplace/request',requireJson,(req,res)=>{noStore(res);if(!sameOrigin(req))return res.status(403).json({error:'Origin not allowed.'});if(!rateLimit(rateKey('marketplace-request',clientIp(req)),20,3600000))return res.status(429).json({error:'Too many requests.'});const b=req.body||{};const service=clean(b.service,120),industry=normalizeIndustry(b.industry||service),details=clean(b.details,2000),address=clean(b.address,180),zip=normalizeZip(b.zip),timing=clean(b.timing,60);if(!service||details.length<10||!address||zip.length<5||!timing)return res.status(400).json({error:'Service, details, address, ZIP, and timing are required.'});const session=readProviderSession(req);const customerId=session?.account_type==='customer'?session.account_id:null;const r=db.prepare('INSERT INTO marketplace_requests(customer_account_id,service,industry,details,address,zip_code,timing,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(customerId,service,industry,details,address,zip,timing,'new',Date.now());const requestId=Number(r.lastInsertRowid);const est=Object.hasOwn(rates,service)?estimate(service,b.jobSize||'medium'):null;const lead=db.prepare('INSERT INTO leads(created_at,name,phone,email,service,job_size,timing,address,details,estimate_min,estimate_max,ai_summary,ai_priority,status,source,industry,source_lead_id,source_url,lead_score,next_action,estimated_value,zip_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(new Date().toISOString(),clean(b.name||'Marketplace Customer',100),clean(b.phone||'Not provided',40),validEmail(b.email)?clean(b.email,160):'not-provided@example.invalid',service,clean(b.jobSize||'medium',20),timing,address,details,est?.min||0,est?.max||0,'','normal','new','marketplace',industry,`marketplace:${requestId}`,null,scoreLead({phone:b.phone,email:b.email,details,timing,estimateMax:est?.max||0}),nextActionFor(scoreLead({phone:b.phone,email:b.email,details,timing,estimateMax:est?.max||0}),timing),est?.max||0,zip);const leadId=Number(lead.lastInsertRowid);if(customerId)db.prepare('UPDATE leads SET customer_account_id=? WHERE id=?').run(customerId,leadId);createMatchesForLead(leadId);res.status(201).json({ok:true,requestId,leadId,estimate:est});});
app.get('/api/provider/leads',requireProvider,(req,res)=>{noStore(res);if(!providerCanReceive(req.account.account_id))return res.status(402).json({error:'Active subscription required to receive leads.'});const rows=db.prepare("SELECT l.id,l.created_at,l.service,l.industry,l.job_size,l.timing,l.details,l.address,l.lead_score,l.next_action,l.estimated_value,m.match_score,m.status match_status FROM lead_matches m JOIN leads l ON l.id=m.lead_id WHERE m.provider_account_id=? AND m.status IN ('offered','claimed') ORDER BY m.match_score DESC,m.created_at DESC LIMIT 100").all(req.account.account_id);res.json({leads:rows.map(r=>({...r,match_reasons:matchReasons(r,db.prepare('SELECT a.id account_id,p.* FROM accounts a JOIN provider_profiles p ON p.account_id=a.id WHERE a.id=?').get(req.account.account_id)),trust:refreshProviderMetrics(req.account.account_id)}))});});
app.post('/api/provider/leads/:id/claim',requireProvider,requireAccountCsrf,(req,res)=>{noStore(res);if(!providerCanReceive(req.account.account_id))return res.status(402).json({error:'Active subscription required.'});if(!providerCanClaim(req.account.account_id))return res.status(429).json({error:'Monthly lead limit reached. Upgrade your plan or wait for the next billing period.'});const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid lead id.'});const now=Date.now();const tx=db.transaction(()=>{const r=db.prepare("UPDATE lead_matches SET status='claimed',claimed_at=? WHERE lead_id=? AND provider_account_id=? AND status='offered'").run(now,id,req.account.account_id);if(!r.changes)return false;db.prepare('INSERT INTO lead_events(lead_id,event_type,payload,created_at) VALUES(?,?,?,?)').run(id,'provider_claimed',JSON.stringify({providerAccountId:req.account.account_id}),now);const lead=db.prepare('SELECT customer_account_id,service FROM leads WHERE id=?').get(id);if(lead?.customer_account_id)addNotification(lead.customer_account_id,'lead_claimed',`A provider claimed your ${lead.service} request.`);return true;});if(!tx())return res.status(409).json({error:'Lead is no longer available.'});audit(req.account.account_id,'provider','lead_claimed','lead',id);refreshProviderMetrics(req.account.account_id);res.json({ok:true});});
app.post('/api/provider/subscription/checkout',requireProvider,requireAccountCsrf,requireJson,async(req,res)=>{noStore(res);return withIdempotency(req,res,'subscription-checkout',async()=>{if(!STRIPE_SECRET_KEY)return res.status(503).json({error:'Subscription billing is not configured yet.'});const plan=['starter','contractor','business','pro'].includes(req.body?.plan)?req.body.plan:'starter';const priceId=STRIPE_PROVIDER_PRICE_IDS[plan]||'';if(!priceId)return res.status(503).json({error:`The ${plan} subscription price is not configured.`});const origin=APP_ORIGIN||`${req.protocol}://${req.get('host')}`;const params=new URLSearchParams();params.set('mode','subscription');params.set('line_items[0][price]',priceId);params.set('line_items[0][quantity]','1');params.set('success_url',`${origin}/#provider`);params.set('cancel_url',`${origin}/#account`);params.set('client_reference_id',String(req.account.account_id));params.set('metadata[swiftquote_account_id]',String(req.account.account_id));params.set('metadata[swiftquote_plan]',plan);params.set('subscription_data[metadata][swiftquote_account_id]',String(req.account.account_id));params.set('customer_email',req.account.email);try{const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{authorization:`Bearer ${STRIPE_SECRET_KEY}`,'content-type':'application/x-www-form-urlencoded','Idempotency-Key':`swiftquote-subscription-${req.account.account_id}-${plan}`},body:params,signal:AbortSignal.timeout(8000)});const d=await r.json();if(!r.ok||!d.url)throw Error('Stripe checkout creation failed');res.json({ok:true,url:d.url});}catch(e){res.status(502).json({error:'Unable to start subscription checkout.'});}});});

app.get('/api/customer/requests',requireAccount,(req,res)=>{noStore(res);if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});const rows=db.prepare(`SELECT mr.id,mr.service,mr.industry,mr.timing,mr.status,mr.created_at,l.id lead_id,l.lead_score,l.estimated_value FROM marketplace_requests mr LEFT JOIN leads l ON l.source_lead_id=('marketplace:'||mr.id) AND l.source='marketplace' WHERE mr.customer_account_id=? ORDER BY mr.created_at DESC LIMIT 100`).all(req.account.account_id);res.json({requests:rows});});
app.get('/api/customer/quotes',requireAccount,(req,res)=>{noStore(res);if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});const rows=db.prepare(`SELECT q.id,q.provider_account_id,q.amount,q.deposit_amount,q.currency,q.scope,q.status,q.expires_at,q.created_at,p.business_name,p.provider_kind,p.rating,p.jobs_completed,m.match_score FROM quotes q JOIN lead_matches m ON m.lead_id=q.lead_id AND m.provider_account_id=q.provider_account_id JOIN leads l ON l.id=q.lead_id JOIN provider_profiles p ON p.account_id=q.provider_account_id WHERE l.customer_account_id=? ORDER BY q.created_at DESC LIMIT 100`).all(req.account.account_id);res.json({quotes:rows});});
app.post('/api/provider/leads/:id/quote',requireProvider,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);if(!providerCanReceive(req.account.account_id))return res.status(402).json({error:'Active subscription required.'});const id=Number(req.params.id),amount=Number(req.body?.amount),deposit=Number(req.body?.depositAmount||0),scope=clean(req.body?.scope,2000);if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(amount)||amount<1||amount>999999||!Number.isInteger(deposit)||deposit<0||deposit>amount||amount*100>99999999||scope.length<5)return res.status(400).json({error:'Provide a valid amount, deposit, and scope.'});const match=db.prepare("SELECT status FROM lead_matches WHERE lead_id=? AND provider_account_id=?").get(id,req.account.account_id);if(!match||match.status!=='claimed')return res.status(403).json({error:'You must claim this lead before quoting it.'});const lead=db.prepare('SELECT customer_account_id,service FROM leads WHERE id=?').get(id);if(!lead)return res.status(404).json({error:'Lead not found.'});const now=Date.now(),expires=now+7*86400000;const r=db.prepare('INSERT INTO quotes(lead_id,provider_account_id,amount,deposit_amount,scope,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,req.account.account_id,amount,deposit,scope,'sent',expires,now,now);if(lead.customer_account_id)addNotification(lead.customer_account_id,'quote_received',`You received a quote for ${lead.service}.`);audit(req.account.account_id,'provider','quote_created','quote',Number(r.lastInsertRowid),{leadId:id,amount});refreshProviderMetrics(req.account.account_id);res.status(201).json({ok:true,quoteId:Number(r.lastInsertRowid),expiresAt:expires});});
app.get('/api/customer/quotes/compare/:leadId',requireAccount,(req,res)=>{
  noStore(res);
  if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});
  const leadId=Number(req.params.leadId);
  if(!Number.isSafeInteger(leadId)||leadId<1)return res.status(400).json({error:'Invalid lead id.'});
  const rows=db.prepare(`SELECT q.id,q.amount,q.deposit_amount,q.currency,q.scope,q.status,q.expires_at,q.created_at,q.provider_account_id,p.business_name,p.provider_kind,p.rating,p.jobs_completed,m.match_score FROM quotes q JOIN leads l ON l.id=q.lead_id JOIN lead_matches m ON m.lead_id=q.lead_id AND m.provider_account_id=q.provider_account_id JOIN provider_profiles p ON p.account_id=q.provider_account_id WHERE q.lead_id=? AND l.customer_account_id=? ORDER BY q.status='sent' DESC,q.amount ASC`).all(leadId,req.account.account_id).map(r=>({...r,trust:refreshProviderMetrics(r.provider_account_id)}));
  res.json({quotes:rows});
});
app.post('/api/customer/quotes/:id/respond',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{
  noStore(res); if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});
  return withIdempotency(req,res,'quote-respond',async()=>{
    const id=Number(req.params.id),decision=clean(req.body?.decision,20).toLowerCase();
    if(!Number.isSafeInteger(id)||id<1||!['accepted','declined'].includes(decision))return res.status(400).json({error:'Invalid quote decision.'});
    const q=db.prepare(`SELECT q.*,l.id lead_id,l.customer_account_id,l.service FROM quotes q JOIN leads l ON l.id=q.lead_id WHERE q.id=? AND l.customer_account_id=?`).get(id,req.account.account_id);
    if(!q)return res.status(404).json({error:'Quote not found.'});
    if(q.status==='payment_starting' && q.updated_at<Date.now()-10*60_000){db.prepare("UPDATE quotes SET status='sent',updated_at=? WHERE id=? AND status='payment_starting'").run(Date.now(),id);q.status='sent';}if(q.status!=='sent'||(q.expires_at&&q.expires_at<Date.now()))return res.status(409).json({error:'Quote is no longer actionable.'});
    const now=Date.now();
    if(decision==='declined'){db.prepare('UPDATE quotes SET status=?,updated_at=? WHERE id=?').run('declined',now,id);addNotification(q.provider_account_id,'quote_declined','A customer declined your quote.');audit(req.account.account_id,'customer','quote_declined','quote',id);return res.json({ok:true,status:'declined'});}
    if(!STRIPE_SECRET_KEY)return res.status(503).json({error:'Secure payment is required before booking, but payment processing is not configured.'});
    const origin=APP_ORIGIN||`${req.protocol}://${req.get('host')}`; const params=new URLSearchParams();
    params.set('mode','payment'); params.set('line_items[0][price_data][currency]',q.currency||'usd'); params.set('line_items[0][price_data][product_data][name]',`${q.service} — SwiftQuote protected payment`); params.set('line_items[0][price_data][unit_amount]',String(q.amount*100)); params.set('line_items[0][quantity]','1');
    params.set('success_url',`${origin}/#account`); params.set('cancel_url',`${origin}/#account`); params.set('customer_email',req.account.email); params.set('metadata[swiftquote_quote_id]',String(q.id)); params.set('metadata[swiftquote_customer_account_id]',String(req.account.account_id));
    const reserved=db.prepare("UPDATE quotes SET status='payment_starting',updated_at=? WHERE id=? AND status='sent'").run(now,id);if(!reserved.changes)return res.status(409).json({error:'Quote payment is already being started.'});db.prepare('INSERT INTO payment_holds(quote_id,amount,currency,status,external_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(quote_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').run(q.id,q.amount,q.currency||'usd','starting',null,now,now);
    try{const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{authorization:`Bearer ${STRIPE_SECRET_KEY}`,'content-type':'application/x-www-form-urlencoded','Idempotency-Key':`swiftquote-quote-checkout-${q.id}`},body:params,signal:AbortSignal.timeout(8000)});const d=await r.json();if(!r.ok||!d.url)throw Error('Stripe checkout creation failed');
      db.prepare("UPDATE quotes SET status='payment_required',updated_at=? WHERE id=? AND status='payment_starting'").run(now,id);
      db.prepare("UPDATE payment_holds SET status='pending',external_id=?,updated_at=? WHERE quote_id=?").run(clean(d.id,255),now,q.id);
      audit(req.account.account_id,'customer','payment_started','quote',id,{amount:q.amount}); return res.json({ok:true,status:'payment_required',amount:q.amount,currency:q.currency||'usd',url:d.url});
    }catch{db.prepare("DELETE FROM payment_holds WHERE quote_id=? AND status='starting'").run(id);db.prepare("UPDATE quotes SET status='sent',updated_at=? WHERE id=? AND status='payment_starting'").run(Date.now(),id);return res.status(502).json({error:'Unable to start secure payment.'});}
  });
});
app.post('/api/provider/payout/onboard',requireProvider,requireAccountCsrf,requireJson,async(req,res)=>{noStore(res);return withIdempotency(req,res,'payout-onboard',async()=>{if(!STRIPE_SECRET_KEY)return res.status(503).json({error:'Stripe is not configured.'});const existing=db.prepare('SELECT stripe_account_id FROM provider_payout_accounts WHERE provider_account_id=?').get(req.account.account_id);try{let stripeAccountId=existing?.stripe_account_id;if(!stripeAccountId){const body=new URLSearchParams();body.set('type','express');body.set('country','US');body.set('email',req.account.email);const kind=db.prepare('SELECT provider_kind FROM provider_profiles WHERE account_id=?').get(req.account.account_id)?.provider_kind;body.set('business_type',kind==='company'?'company':'individual');const r=await fetch('https://api.stripe.com/v1/accounts',{method:'POST',headers:{authorization:`Bearer ${STRIPE_SECRET_KEY}`,'content-type':'application/x-www-form-urlencoded','Idempotency-Key':`swiftquote-connect-account-${req.account.account_id}`},body,signal:AbortSignal.timeout(8000)});const d=await r.json();if(!r.ok||!d.id)throw Error('account creation failed');stripeAccountId=clean(d.id,255);db.prepare('INSERT INTO provider_payout_accounts(provider_account_id,stripe_account_id,updated_at) VALUES(?,?,?)').run(req.account.account_id,stripeAccountId,Date.now());}
const origin=APP_ORIGIN||`${req.protocol}://${req.get('host')}`;const body=new URLSearchParams();body.set('account',stripeAccountId);body.set('refresh_url',`${origin}/#provider`);body.set('return_url',`${origin}/#provider`);body.set('type','account_onboarding');const r=await fetch('https://api.stripe.com/v1/account_links',{method:'POST',headers:{authorization:`Bearer ${STRIPE_SECRET_KEY}`,'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(8000)});const d=await r.json();if(!r.ok||!d.url)throw Error('account link failed');audit(req.account.account_id,'provider','payout_onboarding_started','payout_account',req.account.account_id);res.json({ok:true,url:d.url});}catch{res.status(502).json({error:'Unable to start payout onboarding.'});}});});
app.get('/api/provider/payout-status',requireProvider,(req,res)=>{noStore(res);const row=db.prepare('SELECT stripe_account_id,onboarding_status,charges_enabled,payouts_enabled,updated_at FROM provider_payout_accounts WHERE provider_account_id=?').get(req.account.account_id);res.json({payout:row?{configured:true,...row}: {configured:false}});});

app.get('/api/provider/availability',requireProvider,(req,res)=>{noStore(res);res.json({availability:availabilityForProvider(req.account.account_id)});});
app.put('/api/provider/availability',requireProvider,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);return withIdempotency(req,res,'provider-availability',()=>{const timezone=clean(req.body?.timezone,80)||'UTC',schedule=req.body?.schedule,blackouts=Array.isArray(req.body?.blackouts)?req.body.blackouts.slice(0,100):[];try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format();}catch{return res.status(400).json({error:'Invalid IANA timezone.'});}if(!validSchedule(schedule))return res.status(400).json({error:'Invalid weekly availability schedule.'});const blackoutSet=new Set();for(const b of blackouts){const date=String(b?.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number(date.slice(0,4))<2020||Number(date.slice(0,4))>2100)return res.status(400).json({error:'Invalid blackout date.'});if(blackoutSet.has(date))return res.status(400).json({error:'Duplicate blackout date.'});blackoutSet.add(date);}const now=Date.now();db.prepare('INSERT INTO provider_availability(provider_account_id,timezone,schedule_json,blackout_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(provider_account_id) DO UPDATE SET timezone=excluded.timezone,schedule_json=excluded.schedule_json,blackout_json=excluded.blackout_json,updated_at=excluded.updated_at').run(req.account.account_id,timezone,JSON.stringify(schedule),JSON.stringify(blackouts),now);audit(req.account.account_id,'provider','availability_updated','provider',req.account.account_id);res.json({ok:true,availability:availabilityForProvider(req.account.account_id)});});});
app.get('/api/provider/availability/:id', (req,res)=>{noStore(res);const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid provider id.'});const p=db.prepare("SELECT account_id,business_name FROM provider_profiles WHERE account_id=? AND verified=1").get(id);if(!p)return res.status(404).json({error:'Provider not found.'});res.json({provider:{id:p.account_id,businessName:p.business_name},availability:availabilityForProvider(id)});});
app.post('/api/provider/jobs/:id/schedule',requireProvider,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);return withIdempotency(req,res,'job-schedule',()=>{const id=Number(req.params.id),when=Number(req.body?.scheduledAt);if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(when)||when<Date.now()-60000||when>Date.now()+365*86400000)return res.status(400).json({error:'Provide a valid schedule time within the next year.'});const job=db.prepare("SELECT * FROM jobs WHERE id=? AND provider_account_id=? AND status='scheduled'").get(id,req.account.account_id);if(!job)return res.status(404).json({error:'Scheduled job not found.'});const existing=db.prepare("SELECT id FROM jobs WHERE provider_account_id=? AND scheduled_at=? AND status IN ('scheduled','in_progress') AND id<>?").get(req.account.account_id,when,id);if(existing)return res.status(409).json({error:'Provider already has a job at that exact time.'});if(!providerSlotAvailable(req.account.account_id,when))return res.status(409).json({error:'That time is outside the provider availability schedule or is blacked out.'});db.prepare('UPDATE jobs SET scheduled_at=?,updated_at=? WHERE id=?').run(when,Date.now(),id);const customer=db.prepare('SELECT customer_account_id,service FROM leads WHERE id=?').get(job.lead_id);if(customer?.customer_account_id){addNotification(customer.customer_account_id,'job_scheduled',`Your ${customer.service} appointment has been scheduled.`);} scheduleJobReminders(id,when);audit(req.account.account_id,'provider','job_scheduled','job',id,{scheduledAt:when});res.json({ok:true,scheduledAt:when});});});
app.get('/api/customer/jobs/:id/agreement',requireAccount,(req,res)=>{noStore(res);if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});const id=Number(req.params.id);const a=db.prepare('SELECT ja.* FROM job_agreements ja JOIN jobs j ON j.id=ja.job_id JOIN leads l ON l.id=j.lead_id WHERE ja.job_id=? AND l.customer_account_id=?').get(id,req.account.account_id);if(!a)return res.status(404).json({error:'Agreement not found.'});res.json({agreement:{...a,schedule:safeJson(a.schedule_json)}});});
app.post('/api/customer/jobs/:id/agreement/accept',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});return withIdempotency(req,res,'agreement-accept',()=>{const id=Number(req.params.id),a=db.prepare('SELECT ja.* FROM job_agreements ja JOIN jobs j ON j.id=ja.job_id JOIN leads l ON l.id=j.lead_id WHERE ja.job_id=? AND l.customer_account_id=?').get(id,req.account.account_id);if(!a)return res.status(404).json({error:'Agreement not found.'});if(a.status==='accepted')return res.json({ok:true,status:'accepted'});if(a.status!=='pending_customer')return res.status(409).json({error:'Agreement is not awaiting customer acceptance.'});const now=Date.now();db.prepare("UPDATE job_agreements SET customer_accepted_at=?,status='pending_provider',updated_at=? WHERE id=?").run(now,now,a.id);addNotification(a.provider_account_id,'agreement_ready','Customer accepted the job agreement.');audit(req.account.account_id,'customer','agreement_accepted','job',id);res.json({ok:true,status:'pending_provider'});});});
app.post('/api/provider/jobs/:id/agreement/accept',requireProvider,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);return withIdempotency(req,res,'agreement-provider-accept',()=>{const id=Number(req.params.id),a=db.prepare('SELECT * FROM job_agreements WHERE job_id=? AND provider_account_id=?').get(id,req.account.account_id);if(!a)return res.status(404).json({error:'Agreement not found.'});if(!a.customer_accepted_at)return res.status(409).json({error:'Customer must accept the agreement first.'});const now=Date.now();db.prepare("UPDATE job_agreements SET provider_accepted_at=?,status='accepted',updated_at=? WHERE id=?").run(now,now,a.id);audit(req.account.account_id,'provider','agreement_accepted','job',id);res.json({ok:true,status:'accepted'});});});
app.post('/api/provider/jobs/:id/change-orders',requireProvider,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);return withIdempotency(req,res,'change-order-create',()=>{const id=Number(req.params.id),delta=Number(req.body?.amountDelta),description=clean(req.body?.description,1000);if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(delta)||delta===0||Math.abs(delta)>999999||Math.abs(delta)*100>99999999||description.length<5)return res.status(400).json({error:'Provide a valid change-order description and amount.'});const job=db.prepare('SELECT j.id,j.provider_account_id,l.customer_account_id,l.service FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE j.id=? AND j.provider_account_id=? AND j.status IN (\'scheduled\',\'in_progress\')').get(id,req.account.account_id);if(!job)return res.status(404).json({error:'Job not found.'});const r=db.prepare('INSERT INTO change_orders(job_id,provider_account_id,customer_account_id,description,amount_delta,created_at) VALUES(?,?,?,?,?,?)').run(id,req.account.account_id,job.customer_account_id,description,delta,Date.now());addNotification(job.customer_account_id,'change_order','Your provider submitted a change order for approval.');audit(req.account.account_id,'provider','change_order_created','job',id,{changeOrderId:Number(r.lastInsertRowid),amountDelta:delta});res.status(201).json({ok:true,changeOrderId:Number(r.lastInsertRowid),status:'pending_customer'});});});
app.post('/api/customer/change-orders/:id/payment',requireAccount,requireAccountCsrf,requireJson,async(req,res)=>{noStore(res);if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});return withIdempotency(req,res,'change-order-payment',async()=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid change order id.'});if(!STRIPE_SECRET_KEY)return res.status(503).json({error:'Secure payment is not configured.'});const co=db.prepare('SELECT * FROM change_orders WHERE id=? AND customer_account_id=?').get(id,req.account.account_id);if(!co)return res.status(404).json({error:'Change order not found.'});if(co.status!=='approved'||co.amount_delta<=0||co.payment_status!=='required')return res.status(409).json({error:'This change order is not awaiting additional payment.'});const job=db.prepare('SELECT j.id,l.service FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE j.id=? AND l.customer_account_id=?').get(co.job_id,req.account.account_id);if(!job)return res.status(404).json({error:'Job not found.'});db.prepare("UPDATE change_orders SET payment_status='checkout_starting' WHERE id=? AND payment_status='required'").run(id);const origin=APP_ORIGIN||`${req.protocol}://${req.get('host')}`;const params=new URLSearchParams();params.set('mode','payment');params.set('line_items[0][price_data][currency]','usd');params.set('line_items[0][price_data][product_data][name]',`SwiftQuote change order — ${job.service}`);params.set('line_items[0][price_data][unit_amount]',String(co.amount_delta*100));params.set('line_items[0][quantity]','1');params.set('success_url',`${origin}/#account`);params.set('cancel_url',`${origin}/#account`);params.set('customer_email',req.account.email);params.set('metadata[swiftquote_change_order_id]',String(id));params.set('metadata[swiftquote_customer_account_id]',String(req.account.account_id));try{const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{authorization:`Bearer ${STRIPE_SECRET_KEY}`,'content-type':'application/x-www-form-urlencoded','Idempotency-Key':`swiftquote-change-checkout-${id}`},body:params,signal:AbortSignal.timeout(8000)});const d=await r.json();if(!r.ok||!d.url)throw Error('Stripe change-order checkout failed');db.prepare("UPDATE change_orders SET payment_status='checkout_pending',payment_session_id=? WHERE id=? AND payment_status='checkout_starting'").run(clean(d.id,255),id);return res.json({ok:true,url:d.url,status:'checkout_pending'});}catch{db.prepare("UPDATE change_orders SET payment_status='required' WHERE id=? AND payment_status='checkout_starting'").run(id);return res.status(502).json({error:'Unable to start secure change-order payment.'});}});});
app.post('/api/customer/change-orders/:id/respond',requireAccount,requireAccountCsrf,requireJson,async(req,res)=>{
  noStore(res); if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});
  return withIdempotency(req,res,'change-order-respond',async()=>{
    const id=Number(req.params.id),decision=clean(req.body?.decision,20).toLowerCase();
    if(!Number.isSafeInteger(id)||id<1||!['approved','declined'].includes(decision))return res.status(400).json({error:'Invalid decision.'});
    const co=db.prepare('SELECT * FROM change_orders WHERE id=? AND customer_account_id=?').get(id,req.account.account_id);
    if(!co)return res.status(404).json({error:'Change order not found.'});
    if(co.status!=='pending_customer')return res.status(409).json({error:'Change order is no longer actionable.'});
    const now=Date.now();
    if(decision==='declined'){
      db.prepare("UPDATE change_orders SET status='declined',payment_status='not_required',decided_at=? WHERE id=?").run(now,id);
      addNotification(co.provider_account_id,'change_order_update','The customer declined your change order.');
      audit(req.account.account_id,'customer','change_order_declined','change_order',id,{amountDelta:co.amount_delta});
      return res.json({ok:true,status:'declined',paymentRequired:false});
    }
    if(co.amount_delta>0){
      const reserved=db.prepare("UPDATE change_orders SET status='approved',payment_status='required',decided_at=? WHERE id=? AND status='pending_customer'").run(now,id);if(!reserved.changes)return res.status(409).json({error:'Change order is already being processed.'});
      if(!STRIPE_SECRET_KEY){db.prepare("UPDATE change_orders SET status='pending_customer',payment_status='not_required',decided_at=NULL WHERE id=? AND status='approved'").run(id);return res.status(503).json({error:'Secure payment is not configured for this change order.'});}
      const job=db.prepare('SELECT j.id,l.service FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE j.id=? AND l.customer_account_id=?').get(co.job_id,req.account.account_id);
      if(!job)return res.status(404).json({error:'Job not found.'});
      db.prepare("UPDATE change_orders SET status='approved',payment_status='required',decided_at=? WHERE id=?").run(now,id);
      const origin=APP_ORIGIN||`${req.protocol}://${req.get('host')}`;const params=new URLSearchParams();
      params.set('mode','payment');params.set('line_items[0][price_data][currency]','usd');params.set('line_items[0][price_data][product_data][name]',`SwiftQuote change order — ${job.service}`);params.set('line_items[0][price_data][unit_amount]',String(co.amount_delta*100));params.set('line_items[0][quantity]','1');params.set('success_url',`${origin}/#account`);params.set('cancel_url',`${origin}/#account`);params.set('customer_email',req.account.email);params.set('metadata[swiftquote_change_order_id]',String(id));params.set('metadata[swiftquote_customer_account_id]',String(req.account.account_id));
      try{const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{authorization:`Bearer ${STRIPE_SECRET_KEY}`,'content-type':'application/x-www-form-urlencoded','Idempotency-Key':`swiftquote-change-checkout-${id}`},body:params,signal:AbortSignal.timeout(8000)});const d=await r.json();if(!r.ok||!d.url)throw Error('Stripe change-order checkout failed');db.prepare("UPDATE change_orders SET payment_status='checkout_pending',payment_session_id=? WHERE id=? AND payment_status='required'").run(clean(d.id,255),id);addNotification(co.provider_account_id,'change_order_payment_required','The customer approved the change order. Additional payment is ready for checkout.');audit(req.account.account_id,'customer','change_order_approved','change_order',id,{amountDelta:co.amount_delta});return res.json({ok:true,status:'approved',paymentRequired:true,url:d.url});}
      catch{db.prepare("UPDATE change_orders SET payment_status='required' WHERE id=?").run(id);return res.status(502).json({error:'Unable to start secure change-order payment.'});}
    }
    if(!STRIPE_SECRET_KEY)return res.status(503).json({error:'Secure refund processing is not configured for this change order.'});
    const reservedNegative=db.prepare("UPDATE change_orders SET status='approved',payment_status='refund_pending',decided_at=? WHERE id=? AND status='pending_customer'").run(now,id);if(!reservedNegative.changes)return res.status(409).json({error:'Change order is already being processed.'});
    const hold=db.prepare('SELECT ph.payment_intent_id FROM payment_holds ph JOIN quotes q ON q.id=ph.quote_id JOIN jobs j ON j.lead_id=q.lead_id AND j.provider_account_id=q.provider_account_id WHERE j.id=? AND q.provider_account_id=?').get(co.job_id,co.provider_account_id);
    if(!hold?.payment_intent_id){db.prepare("UPDATE change_orders SET status='pending_customer',payment_status='not_required',decided_at=NULL WHERE id=? AND payment_status='refund_pending'").run(id);return res.status(409).json({error:'The original payment is not eligible for an automatic refund yet.'});}
    const originalPaid=Number(db.prepare('SELECT amount FROM payment_holds WHERE quote_id=(SELECT id FROM quotes WHERE lead_id=(SELECT lead_id FROM jobs WHERE id=?) AND provider_account_id=?) AND status=\'paid\'').get(co.job_id,co.provider_account_id)?.amount||0);
    const priorRefunded=Number(db.prepare("SELECT COALESCE(SUM(ABS(amount_delta)),0) total FROM change_orders WHERE job_id=? AND amount_delta<0 AND payment_status='refunded' AND id<>?").get(co.job_id,id).total||0);
    const requestedRefund=Math.abs(Number(co.amount_delta));
    if(requestedRefund+priorRefunded>originalPaid){db.prepare("UPDATE change_orders SET status='pending_customer',payment_status='not_required',decided_at=NULL WHERE id=? AND payment_status='refund_pending'").run(id);return res.status(409).json({error:'The requested refund would exceed the amount originally paid.'});}
    try{const body=new URLSearchParams();body.set('payment_intent',hold.payment_intent_id);body.set('amount',String(Math.abs(co.amount_delta)*100));const r=await fetch('https://api.stripe.com/v1/refunds',{method:'POST',headers:{authorization:`Bearer ${STRIPE_SECRET_KEY}`,'content-type':'application/x-www-form-urlencoded','Idempotency-Key':`swiftquote-change-refund-${id}`},body,signal:AbortSignal.timeout(8000)});const d=await r.json();if(!r.ok||!d.id)throw Error('Stripe refund failed');db.prepare("UPDATE change_orders SET payment_status='refunded',refund_id=? WHERE id=?").run(clean(d.id,255),id);db.prepare('INSERT INTO payments(account_id,lead_id,kind,status,amount,currency,external_id,created_at) SELECT customer_account_id,(SELECT lead_id FROM jobs WHERE id=job_id),\'change_order_refund\',\'refunded\',?,\'usd\',?,? FROM change_orders WHERE id=?').run(Math.abs(co.amount_delta),clean(d.id,255),Date.now(),id);addNotification(co.provider_account_id,'change_order_refunded','The approved credit was refunded to the customer.');audit(req.account.account_id,'customer','change_order_refunded','change_order',id,{amountDelta:co.amount_delta,refundId:d.id});return res.json({ok:true,status:'approved',paymentRequired:false,refunded:true});}
    catch{db.prepare("UPDATE change_orders SET payment_status='refund_failed' WHERE id=?").run(id);return res.status(502).json({error:'The refund could not be completed automatically. No refund is being represented as completed.'});}
  });
});

app.get('/api/jobs/:id/timeline',requireAccount,(req,res)=>{noStore(res);const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid job id.'});const job=jobParticipant(id,req.account.account_id);if(!job)return res.status(404).json({error:'Job not found.'});const events=db.prepare('SELECT id,from_status,to_status,note,created_at FROM job_status_events WHERE job_id=? ORDER BY created_at ASC').all(id);const messages=db.prepare('SELECT id,sender_account_id,recipient_account_id,body,created_at,read_at FROM job_messages WHERE job_id=? AND (sender_account_id=? OR recipient_account_id=?) ORDER BY created_at ASC LIMIT 200').all(id,req.account.account_id,req.account.account_id);res.json({job:{id:job.id,status:job.status,service:job.service},events,messages});});
app.post('/api/jobs/:id/messages',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);return withIdempotency(req,res,'job-message',()=>{const id=Number(req.params.id),body=sanitizeMessage(req.body?.message);if(!Number.isSafeInteger(id)||id<1||body.length<1)return res.status(400).json({error:'Provide a valid in-app message. Links, email addresses, and URLs are not allowed.'});const job=jobParticipant(id,req.account.account_id);if(!job||['canceled'].includes(job.status))return res.status(404).json({error:'Job not found or unavailable.'});const recipient=req.account.account_id===job.customer_account_id?job.provider_account_id:job.customer_account_id;if(!recipient)return res.status(409).json({error:'Recipient unavailable.'});const r=db.prepare('INSERT INTO job_messages(job_id,sender_account_id,recipient_account_id,body,created_at) VALUES(?,?,?,?,?)').run(id,req.account.account_id,recipient,body,Date.now());addNotification(recipient,'job_message','You received a new message about your SwiftQuote job.');audit(req.account.account_id,'account','job_message_sent','job',id,{messageId:Number(r.lastInsertRowid)});res.status(201).json({ok:true,messageId:Number(r.lastInsertRowid)});});});
app.post('/api/jobs/:id/messages/read',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid job id.'});const job=jobParticipant(id,req.account.account_id);if(!job)return res.status(404).json({error:'Job not found.'});const r=db.prepare('UPDATE job_messages SET read_at=? WHERE job_id=? AND recipient_account_id=? AND read_at IS NULL').run(Date.now(),id,req.account.account_id);res.json({ok:true,markedRead:r.changes});});
app.get('/api/account/cancellation-requests',requireAccount,(req,res)=>{noStore(res);const rows=db.prepare('SELECT id,job_id,requested_by_account_id,against_account_id,reason,status,created_at,decided_at FROM cancellation_requests WHERE requested_by_account_id=? OR against_account_id=? ORDER BY created_at DESC LIMIT 100').all(req.account.account_id,req.account.account_id);res.json({requests:rows});});
app.post('/api/jobs/:id/cancellation-request',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);return withIdempotency(req,res,'job-cancellation-request',()=>{const id=Number(req.params.id),reason=clean(req.body?.reason,500);if(!Number.isSafeInteger(id)||id<1||reason.length<5)return res.status(400).json({error:'Provide a valid cancellation reason.'});const job=jobParticipant(id,req.account.account_id);if(!job||!['scheduled','in_progress'].includes(job.status))return res.status(409).json({error:'This job cannot be canceled through a request.'});const against=req.account.account_id===job.customer_account_id?job.provider_account_id:job.customer_account_id;if(!against)return res.status(409).json({error:'Other participant unavailable.'});const existing=db.prepare("SELECT id FROM cancellation_requests WHERE job_id=? AND status='pending'").get(id);if(existing)return res.status(409).json({error:'A cancellation request is already pending.'});const r=db.prepare('INSERT INTO cancellation_requests(job_id,requested_by_account_id,against_account_id,reason,created_at) VALUES(?,?,?,?,?)').run(id,req.account.account_id,against,reason,Date.now());addNotification(against,'cancellation_request','The other participant requested cancellation of a SwiftQuote job.');audit(req.account.account_id,'account','cancellation_requested','job',id,{requestId:Number(r.lastInsertRowid)});res.status(201).json({ok:true,requestId:Number(r.lastInsertRowid),status:'pending'});});});
app.post('/api/cancellation-requests/:id/respond',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);return withIdempotency(req,res,'job-cancellation-response',()=>{const id=Number(req.params.id),decision=clean(req.body?.decision,20).toLowerCase();if(!Number.isSafeInteger(id)||id<1||!['approved','declined'].includes(decision))return res.status(400).json({error:'Invalid decision.'});const r=db.prepare('SELECT * FROM cancellation_requests WHERE id=? AND against_account_id=?').get(id,req.account.account_id);if(!r||r.status!=='pending')return res.status(404).json({error:'Cancellation request not found.'});const now=Date.now();const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(r.job_id);if(!job||!['scheduled','in_progress'].includes(job.status))return res.status(409).json({error:'Job is no longer cancellable.'});const tx=db.transaction(()=>{db.prepare('UPDATE cancellation_requests SET status=?,decided_at=? WHERE id=?').run(decision,now,id);if(decision==='approved'){db.prepare("UPDATE jobs SET status='canceled',updated_at=? WHERE id=?").run(now,r.job_id);db.prepare("UPDATE leads SET status='lost' WHERE id=?").run(job.lead_id);recordJobStatus(r.job_id,req.account.account_id,job.status,'canceled',r.reason);addNotification(r.requested_by_account_id,'cancellation_approved','The job cancellation request was approved.');}else addNotification(r.requested_by_account_id,'cancellation_declined','The job cancellation request was declined.');});tx();audit(req.account.account_id,'account',`cancellation_${decision}`,'job',r.job_id,{requestId:id});res.json({ok:true,status:decision});});});
app.post('/api/customer/jobs/:id/confirm-completion',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});return withIdempotency(req,res,'completion-confirm',()=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid job id.'});const job=jobParticipant(id,req.account.account_id);if(!job||job.customer_account_id!==req.account.account_id)return res.status(404).json({error:'Job not found.'});if(job.status!=='completed')return res.status(409).json({error:'Provider must mark the job completed first.'});const now=Date.now();db.prepare('INSERT INTO completion_confirmations(job_id,customer_account_id,confirmed_at) VALUES(?,?,?) ON CONFLICT(job_id) DO UPDATE SET confirmed_at=excluded.confirmed_at,disputed_at=NULL').run(id,req.account.account_id,now);db.prepare("INSERT INTO provider_payout_ledger(provider_account_id,job_id,amount,status,created_at,updated_at) SELECT j.provider_account_id,j.id,q.amount+COALESCE((SELECT SUM(CASE WHEN co.amount_delta>0 AND co.payment_status='paid' THEN co.amount_delta WHEN co.amount_delta<0 AND co.payment_status='refunded' THEN co.amount_delta ELSE 0 END) FROM change_orders co WHERE co.job_id=j.id),0),'pending',?,? FROM jobs j JOIN quotes q ON q.lead_id=j.lead_id AND q.provider_account_id=j.provider_account_id WHERE j.id=? ON CONFLICT(job_id) DO NOTHING").run(now,now,id);addNotification(job.provider_account_id,'completion_confirmed','The customer confirmed job completion. The payout is now eligible for processing.');audit(req.account.account_id,'customer','completion_confirmed','job',id);res.json({ok:true,status:'confirmed'});});});
app.post('/api/provider/payouts/:id/request',requireProvider,requireAccountCsrf,requireJson,async(req,res)=>{
  noStore(res); return withIdempotency(req,res,'provider-payout',async()=>{
    const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid payout id.'});
    if(!STRIPE_SECRET_KEY)return res.status(503).json({error:'Stripe is not configured.'});
    const row=db.prepare("SELECT l.id,l.job_id,l.amount,l.currency,l.status,pa.stripe_account_id,pa.payouts_enabled FROM provider_payout_ledger l JOIN provider_payout_accounts pa ON pa.provider_account_id=l.provider_account_id WHERE l.id=? AND l.provider_account_id=?").get(id,req.account.account_id);
    if(!row)return res.status(404).json({error:'Payout not found.'});if(row.status!=='pending')return res.status(409).json({error:'Payout is no longer pending.'});if(!row.payouts_enabled)return res.status(409).json({error:'Stripe payout onboarding is not complete.'});
    const dispute=db.prepare("SELECT id FROM disputes WHERE job_id=? AND status IN ('open','investigating') LIMIT 1").get(row.job_id);if(dispute)return res.status(409).json({error:'Payout is frozen while the job has an open dispute.'});
    const confirmation=db.prepare('SELECT confirmed_at FROM completion_confirmations WHERE job_id=? AND confirmed_at IS NOT NULL').get(row.job_id);if(!confirmation)return res.status(409).json({error:'Customer completion confirmation is required first.'});
    if(Number(row.amount)<=0||!Number.isSafeInteger(Number(row.amount)))return res.status(409).json({error:'Payout amount must be a positive safe integer.'});
    const cents=Number(row.amount)*100;if(!Number.isSafeInteger(cents)||cents<1)return res.status(409).json({error:'Payout amount is outside the supported payment range.'});
    const body=new URLSearchParams();body.set('amount',String(cents));body.set('currency',row.currency||'usd');body.set('destination',row.stripe_account_id);body.set('transfer_group',`swiftquote_job_${row.job_id}`);body.set('metadata[swiftquote_payout_id]',String(row.id));body.set('metadata[swiftquote_job_id]',String(row.job_id));
    try{const r=await fetch('https://api.stripe.com/v1/transfers',{method:'POST',headers:{authorization:`Bearer ${STRIPE_SECRET_KEY}`,'content-type':'application/x-www-form-urlencoded','Idempotency-Key':`swiftquote-payout-${row.id}`},body,signal:AbortSignal.timeout(8000)});const d=await r.json();if(!r.ok||!d.id)throw Error('Stripe transfer failed');db.prepare("UPDATE provider_payout_ledger SET status='paid',external_id=?,updated_at=? WHERE id=? AND status='pending'").run(clean(d.id,255),Date.now(),id);addNotification(req.account.account_id,'payout_sent','Your SwiftQuote payout was sent to your connected payout account.');audit(req.account.account_id,'provider','payout_sent','payout',id,{transferId:d.id,jobId:row.job_id,amount:row.amount});return res.json({ok:true,status:'paid',externalId:d.id});}
    catch{audit(req.account.account_id,'provider','payout_failed','payout',id,{jobId:row.job_id});return res.status(502).json({error:'Stripe could not process this payout. The payout remains pending.'});}
  });
});
app.get('/api/provider/payout-ledger',requireProvider,(req,res)=>{noStore(res);const rows=db.prepare('SELECT id,job_id,amount,currency,status,external_id,created_at,updated_at FROM provider_payout_ledger WHERE provider_account_id=? ORDER BY created_at DESC LIMIT 100').all(req.account.account_id);res.json({payouts:rows});});

app.get('/api/customer/jobs',requireAccount,(req,res)=>{noStore(res);if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});const rows=db.prepare(`SELECT j.id,j.status,j.scheduled_at,j.completed_at,j.created_at,l.service,l.industry,q.amount,q.currency,q.scope,p.business_name,p.verified,p.rating FROM jobs j JOIN leads l ON l.id=j.lead_id LEFT JOIN quotes q ON q.lead_id=j.lead_id AND q.provider_account_id=j.provider_account_id LEFT JOIN provider_profiles p ON p.account_id=j.provider_account_id WHERE l.customer_account_id=? ORDER BY COALESCE(j.scheduled_at,j.created_at) DESC LIMIT 100`).all(req.account.account_id);res.json({jobs:rows});});
app.get('/api/provider/jobs',requireProvider,(req,res)=>{noStore(res);const rows=db.prepare(`SELECT j.id,j.lead_id,j.status,j.scheduled_at,j.completed_at,j.created_at,l.service,l.timing,l.estimated_value FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE j.provider_account_id=? ORDER BY COALESCE(j.scheduled_at,j.created_at) DESC LIMIT 100`).all(req.account.account_id);res.json({jobs:rows});});
app.patch('/api/provider/jobs/:id',requireProvider,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);const id=Number(req.params.id),status=clean(req.body?.status,30);if(!Number.isSafeInteger(id)||id<1||!jobStatuses.has(status))return res.status(400).json({error:'Invalid job or status.'});const job=db.prepare('SELECT * FROM jobs WHERE id=? AND provider_account_id=?').get(id,req.account.account_id);if(!job)return res.status(404).json({error:'Job not found.'});const allowed={scheduled:new Set(['in_progress','canceled']),in_progress:new Set(['completed','canceled']),completed:new Set(),canceled:new Set()};if(!allowed[job.status].has(status))return res.status(409).json({error:'Invalid job status transition.'});const now=Date.now();db.prepare('UPDATE jobs SET status=?,completed_at=?,updated_at=? WHERE id=?').run(status,status==='completed'?now:job.completed_at,now,id);recordJobStatus(id,req.account.account_id,job.status,status);if(status==='completed'){const c=db.prepare('SELECT customer_account_id FROM leads WHERE id=?').get(job.lead_id);if(c?.customer_account_id)db.prepare('INSERT OR IGNORE INTO completion_confirmations(job_id,customer_account_id) VALUES(?,?)').run(id,c.customer_account_id);}audit(req.account.account_id,'provider','job_status_changed','job',id,{status});if(status==='completed'){db.prepare("UPDATE leads SET status='completed' WHERE id=?").run(job.lead_id);const customer=db.prepare('SELECT customer_account_id,service FROM leads WHERE id=?').get(job.lead_id);if(customer?.customer_account_id)addNotification(customer.customer_account_id,'job_completed',`Your ${customer.service} job was marked completed.`);refreshProviderMetrics(job.provider_account_id);}res.json({ok:true,status});});
app.post('/api/customer/jobs/:id/review',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});const id=Number(req.params.id),rating=Number(req.body?.rating),comment=clean(req.body?.comment,1000);if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(rating)||rating<1||rating>5)return res.status(400).json({error:'Rating must be 1 through 5.'});const job=db.prepare(`SELECT j.*,l.customer_account_id FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE j.id=? AND l.customer_account_id=?`).get(id,req.account.account_id);if(!job)return res.status(404).json({error:'Job not found.'});if(job.status!=='completed')return res.status(409).json({error:'Review is available after the job is completed.'});const confirmation=db.prepare('SELECT confirmed_at FROM completion_confirmations WHERE job_id=?').get(id);if(confirmation && !confirmation.confirmed_at)return res.status(409).json({error:'Please confirm the job completion before reviewing it.'});try{const reviewResult=db.prepare('INSERT INTO reviews(lead_id,customer_account_id,provider_account_id,rating,comment,created_at) VALUES(?,?,?,?,?,?)').run(job.lead_id,req.account.account_id,job.provider_account_id,rating,comment,Date.now());const rr=reviewRisk(rating,comment,req.account.account_id,job.lead_id);if(rr.score>=40)db.prepare('INSERT INTO review_risk_flags(review_id,risk_score,reasons,status,created_at) VALUES(?,?,?,?,?)').run(Number(reviewResult.lastInsertRowid),rr.score,JSON.stringify(rr.reasons),'review',Date.now());const agg=db.prepare('SELECT AVG(rating) rating FROM reviews WHERE provider_account_id=?').get(job.provider_account_id);const completedCount=Number(db.prepare("SELECT COUNT(*) count FROM jobs WHERE provider_account_id=? AND status='completed'").get(job.provider_account_id).count);db.prepare('UPDATE provider_profiles SET rating=?,jobs_completed=? WHERE account_id=?').run(Number(agg.rating||0),completedCount,job.provider_account_id);audit(req.account.account_id,'customer','review_submitted','job',id,{rating});refreshProviderMetrics(job.provider_account_id);res.status(201).json({ok:true});}catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'A review has already been submitted.'});throw e;}});
app.get('/api/provider/reviews/:id',(req,res)=>{noStore(res);const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid provider id.'});const p=db.prepare("SELECT p.account_id,p.business_name FROM provider_profiles p JOIN accounts a ON a.id=p.account_id JOIN subscriptions s ON s.account_id=p.account_id WHERE p.account_id=? AND p.verified=1 AND a.account_type='provider' AND a.status='active' AND s.status='active' AND (s.current_period_end IS NULL OR s.current_period_end>?)").get(id,Date.now());if(!p)return res.status(404).json({error:'Provider not found.'});const rows=db.prepare(`SELECT r.rating,r.comment,r.created_at FROM reviews r JOIN jobs j ON j.lead_id=r.lead_id AND j.provider_account_id=r.provider_account_id WHERE r.provider_account_id=? AND j.status='completed' ORDER BY r.created_at DESC LIMIT 50`).all(id);res.json({provider:{id:p.account_id,businessName:p.business_name},verifiedReviews:rows});});

app.get('/api/account/notifications',requireAccount,(req,res)=>{noStore(res);const rows=db.prepare('SELECT id,kind,message,created_at FROM account_notifications WHERE account_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 50').all(req.account.account_id);res.json({notifications:rows});});
app.post('/api/account/notifications/read',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);const id=Number(req.body?.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid notification id.'});const r=db.prepare('UPDATE account_notifications SET read_at=? WHERE id=? AND account_id=?').run(Date.now(),id,req.account.account_id);if(!r.changes)return res.status(404).json({error:'Notification not found.'});res.json({ok:true});});
app.get('/api/provider/usage',requireProvider,(req,res)=>{noStore(res);res.json(providerUsage(req.account.account_id));});

app.post('/api/account/verification-request',requireProvider,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);const type=clean(req.body?.type,40).toLowerCase();if(!['identity','business','license','insurance'].includes(type))return res.status(400).json({error:'Invalid verification type.'});const note=clean(req.body?.note,500);const now=Date.now();try{const r=db.prepare("INSERT INTO provider_verification_requests(provider_account_id,verification_type,status,note,created_at) VALUES(?,?,?,?,?)").run(req.account.account_id,type,'pending',note,now);audit(req.account.account_id,'provider','verification_requested','verification',Number(r.lastInsertRowid),{type});res.status(201).json({ok:true,id:Number(r.lastInsertRowid),status:'pending'});}catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'A request of this type is already pending.'});throw e;}});
app.get('/api/account/audit',requireAccount,(req,res)=>{noStore(res);const rows=db.prepare('SELECT id,action,object_type,object_id,metadata,created_at FROM audit_log WHERE account_id=? ORDER BY created_at DESC LIMIT 100').all(req.account.account_id).map(x=>({...x,metadata:safeJson(x.metadata)}));res.json({events:rows});});
app.post('/api/disputes',requireAccount,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);const jobId=Number(req.body?.jobId),reason=clean(req.body?.reason,80),details=clean(req.body?.details,2000);if(!Number.isSafeInteger(jobId)||jobId<1||!reason||details.length<10)return res.status(400).json({error:'Provide a valid job, reason, and details.'});const job=db.prepare('SELECT id,provider_account_id,lead_id FROM jobs WHERE id=? AND status IN (\'scheduled\',\'in_progress\',\'completed\')').get(jobId);if(!job)return res.status(404).json({error:'Job not found.'});const lead=db.prepare('SELECT customer_account_id FROM leads WHERE id=?').get(job.lead_id);const isCustomer=req.account.account_id===lead?.customer_account_id;const isProvider=req.account.account_id===job.provider_account_id;if(!isCustomer&&!isProvider)return res.status(403).json({error:'You are not a participant in this job.'});const against=isCustomer?job.provider_account_id:lead.customer_account_id;if(!against)return res.status(409).json({error:'The other participant is unavailable.'});const existing=db.prepare("SELECT id FROM disputes WHERE job_id=? AND opened_by_account_id=? AND status IN ('open','investigating') LIMIT 1").get(jobId,req.account.account_id);if(existing)return res.status(409).json({error:'You already have an open dispute for this job.'});const now=Date.now();const r=db.prepare('INSERT INTO disputes(job_id,opened_by_account_id,against_account_id,reason,details,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(jobId,req.account.account_id,against,reason,details,now,now);addNotification(against,'dispute_opened','A participant opened a dispute regarding a job.');audit(req.account.account_id,'account','dispute_opened','job',jobId,{disputeId:Number(r.lastInsertRowid)});res.status(201).json({ok:true,disputeId:Number(r.lastInsertRowid),status:'open'});});
app.get('/api/account/disputes',requireAccount,(req,res)=>{noStore(res);const rows=db.prepare('SELECT id,job_id,opened_by_account_id,against_account_id,reason,details,status,resolution,created_at,updated_at FROM disputes WHERE opened_by_account_id=? OR against_account_id=? ORDER BY created_at DESC LIMIT 100').all(req.account.account_id,req.account.account_id);res.json({disputes:rows});});
app.get('/api/provider/trust-card',requireProvider,(req,res)=>{noStore(res);const p=db.prepare('SELECT business_name,provider_kind,industry,verified,rating,jobs_completed FROM provider_profiles WHERE account_id=?').get(req.account.account_id);if(!p)return res.status(404).json({error:'Provider profile not found.'});const trust=refreshProviderMetrics(req.account.account_id);const badges=[];if(p.verified)badges.push('Verified');if(p.jobs_completed>=25)badges.push('25+ completed jobs');if(p.rating>=4.8&&p.jobs_completed>=5)badges.push('Top rated');if(trust.responseRate>=0.9)badges.push('Responsive');res.json({provider:{businessName:p.business_name,kind:p.provider_kind,industry:p.industry,rating:p.rating,jobsCompleted:p.jobs_completed},trust,badges});});
app.get('/api/customer/service-passport/:jobId',requireAccount,(req,res)=>{noStore(res);if(req.account.account_type!=='customer')return res.status(403).json({error:'Customer account required.'});const jobId=Number(req.params.jobId);if(!Number.isSafeInteger(jobId)||jobId<1)return res.status(400).json({error:'Invalid job id.'});const row=db.prepare(`SELECT j.id,j.status,j.scheduled_at,j.completed_at,j.created_at,l.service,l.industry,l.timing,q.amount,q.deposit_amount,q.scope,q.status quote_status,p.business_name,p.provider_kind,p.verified,p.rating,p.jobs_completed FROM jobs j JOIN leads l ON l.id=j.lead_id LEFT JOIN quotes q ON q.lead_id=j.lead_id AND q.provider_account_id=j.provider_account_id LEFT JOIN provider_profiles p ON p.account_id=j.provider_account_id WHERE j.id=? AND l.customer_account_id=? ORDER BY q.created_at DESC LIMIT 1`).get(jobId,req.account.account_id);if(!row)return res.status(404).json({error:'Job not found.'});const review=db.prepare('SELECT rating,comment,created_at FROM reviews WHERE lead_id=?').get(db.prepare('SELECT lead_id FROM jobs WHERE id=?').get(jobId).lead_id);const disputes=db.prepare('SELECT id,reason,status,created_at,updated_at FROM disputes WHERE job_id=? ORDER BY created_at DESC').all(jobId);res.json({passport:{...row,review:review||null,disputes}});});
app.get('/api/admin/verifications',requireAdmin,(req,res)=>{noStore(res);const rows=db.prepare(`SELECT v.id,v.provider_account_id,v.verification_type,v.status,v.note,v.created_at,p.business_name FROM provider_verification_requests v JOIN provider_profiles p ON p.account_id=v.provider_account_id WHERE v.status='pending' ORDER BY v.created_at ASC LIMIT 100`).all();res.json({requests:rows});});
app.patch('/api/admin/verifications/:id',requireAdmin,requireCsrf,requireJson,(req,res)=>{noStore(res);const id=Number(req.params.id),decision=clean(req.body?.status,20).toLowerCase();if(!Number.isSafeInteger(id)||id<1||!['approved','rejected'].includes(decision))return res.status(400).json({error:'Invalid verification decision.'});const v=db.prepare('SELECT * FROM provider_verification_requests WHERE id=? AND status=\'pending\'').get(id);if(!v)return res.status(404).json({error:'Verification request not found.'});const now=Date.now();const tx=db.transaction(()=>{db.prepare('UPDATE provider_verification_requests SET status=?,reviewed_at=? WHERE id=?').run(decision,now,id);if(decision==='approved')db.prepare('UPDATE provider_profiles SET verified=1 WHERE account_id=?').run(v.provider_account_id);addNotification(v.provider_account_id,'verification_update',`Your ${v.verification_type} verification request was ${decision}.`);audit(null,'admin',`verification_${decision}`,'verification',id,{providerAccountId:v.provider_account_id});});tx();res.json({ok:true,status:decision});});

app.get('/api/account/trust-graph',requireAccount,(req,res)=>{noStore(res);const provider=req.account.account_type==='provider';res.json({accountId:req.account.account_id,type:provider?'provider':'customer',trust:provider?providerReliability(req.account.account_id):customerReliability(req.account.account_id)});});
app.get('/api/provider/workload',requireProvider,(req,res)=>{noStore(res);res.json({activeJobs:providerWorkload(req.account.account_id),availability:availabilityForProvider(req.account.account_id)});});
app.post('/api/provider/service-areas',requireProvider,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);const zip=normalizeZip(req.body?.zipCode),radius=Number(req.body?.radiusMiles||0),emergency=req.body?.emergency===true;if(!/^\d{5}(?:-\d{4})?$/.test(zip)||!Number.isInteger(radius)||radius<0||radius>100)return res.status(400).json({error:'Provide a valid ZIP and radius up to 100 miles.'});db.prepare('INSERT INTO provider_service_areas(provider_account_id,zip_code,radius_miles,emergency_available) VALUES(?,?,?,?) ON CONFLICT(provider_account_id,zip_code) DO UPDATE SET radius_miles=excluded.radius_miles,emergency_available=excluded.emergency_available').run(req.account.account_id,zip,radius,emergency?1:0);res.status(201).json({ok:true,zipCode:zip,radiusMiles:radius,emergencyAvailable:emergency});});
app.get('/api/provider/service-areas',requireProvider,(req,res)=>{noStore(res);res.json({areas:db.prepare('SELECT zip_code,radius_miles,emergency_available FROM provider_service_areas WHERE provider_account_id=? ORDER BY zip_code').all(req.account.account_id)});});
app.get('/api/customer/providers/:id/trust',requireAccount,(req,res)=>{noStore(res);const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid provider id.'});const p=db.prepare("SELECT p.business_name,p.provider_kind,p.industry,p.verified,p.rating,p.jobs_completed FROM provider_profiles p JOIN accounts a ON a.id=p.account_id JOIN subscriptions s ON s.account_id=p.account_id WHERE p.account_id=? AND a.account_type='provider' AND a.status='active' AND s.status='active' AND (s.current_period_end IS NULL OR s.current_period_end>?)").get(id,Date.now());if(!p)return res.status(404).json({error:'Provider not found.'});res.json({provider:p,trust:providerReliability(id)});});
app.get('/api/customer/price-check',requireAccount,(req,res)=>{noStore(res);const service=clean(req.query?.service,120);if(!service)return res.status(400).json({error:'Service is required.'});const b=priceBenchmark(service);if(!b)return res.json({available:false});const rawAmount=req.query?.amount;const amount=rawAmount===undefined||rawAmount===''?0:Number(rawAmount);if(!Number.isFinite(amount)||amount<0||amount>999999)return res.status(400).json({error:'Invalid amount.'});let position='typical';if(amount&&amount<b.p25Amount)position='below typical';else if(amount&&amount>b.p75Amount)position='above typical';res.json({available:true,service,...b,amount:amount||null,position});});
app.get('/api/provider/roi',requireProvider,(req,res)=>{noStore(res);const id=req.account.account_id;const leads=Number(db.prepare("SELECT COUNT(*) c FROM lead_matches WHERE provider_account_id=?").get(id).c);const claimed=Number(db.prepare("SELECT COUNT(*) c FROM lead_matches WHERE provider_account_id=? AND status='claimed'").get(id).c);const jobs=Number(db.prepare("SELECT COUNT(*) c FROM jobs WHERE provider_account_id=? AND status='completed'").get(id).c);const revenue=Number(db.prepare("SELECT COALESCE(SUM(q.amount),0) total FROM quotes q WHERE q.provider_account_id=? AND q.status IN ('paid','accepted')").get(id).total);res.json({leads,claimed,completedJobs:jobs,conversionRate:claimed?jobs/claimed:0,quotedRevenue:revenue});});
app.post('/api/provider/emergency-mode',requireProvider,requireAccountCsrf,requireJson,(req,res)=>{noStore(res);const enabled=req.body?.enabled===true;const r=db.prepare('UPDATE provider_service_areas SET emergency_available=? WHERE provider_account_id=?').run(enabled?1:0,req.account.account_id);if(!r.changes)return res.status(409).json({error:'Configure at least one service area before changing emergency mode.'});recordRisk(req.account.account_id,req,'emergency_mode_change',0,{enabled});audit(req.account.account_id,'provider','emergency_mode_changed','provider',req.account.account_id,{enabled});res.json({ok:true,enabled});});
app.get('/api/customer/reminders',requireAccount,(req,res)=>{noStore(res);res.json({upcoming:db.prepare("SELECT id,kind,message,due_at FROM scheduled_notifications WHERE account_id=? AND status='pending' ORDER BY due_at LIMIT 50").all(req.account.account_id)});});

app.get('/api/health',(req,res)=>{
  noStore(res);
  try { db.prepare('SELECT 1 AS ok').get(); res.json({ok:true,app:APP_NAME,time:new Date().toISOString()}); }
  catch { res.status(503).json({ok:false,error:'Database unavailable'}); }
});

app.use('/admin/*splat',(req,res)=>{ noStore(res); res.set('X-Robots-Tag','noindex, nofollow, noarchive'); res.status(404).send('Not found'); });

app.use((err,req,res,next)=>{
  console.error('Unhandled request error:', err?.message || err);
  if (res.headersSent) return next(err);
  noStore(res);
  if (err?.type === 'entity.too.large') return res.status(413).json({error:'Request too large.'});
  if (err?.type === 'entity.parse.failed') return res.status(400).json({error:'Invalid JSON.'});
  res.status(500).json({error:'Internal server error.'});
});

app.get('/{*splat}',(req,res)=>{ if(req.path.startsWith('/api/')) { noStore(res); return res.status(404).json({error:'Not found'}); } if(req.path.startsWith('/admin/')) { noStore(res); res.set('X-Robots-Tag','noindex, nofollow, noarchive'); return res.status(404).send('Not found'); } res.sendFile(path.join(process.cwd(),'public/index.html')); });

const server=app.listen(PORT,()=>console.log(`${APP_NAME} listening on http://localhost:${PORT}`));
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;
function shutdown(){ server.close(()=>{ try { db.close(); } finally { process.exit(0); } }); setTimeout(()=>process.exit(1),10_000).unref(); }
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
