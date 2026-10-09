
import crypto from "node:crypto";

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Normalize ordinary user-entered text.
 * Do not use this for passwords, secrets, signatures, or payment payloads.
 */
export function normalizeText(value, {
  min = 0,
  max = 500,
  required = false,
  field = "value"
} = {}) {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be text.`);
  }

  const result = value
    .normalize("NFC")
    .replace(CONTROL_CHARS, "")
    .trim()
    .replace(/\s+/gu, " ");

  if (required && result.length === 0) {
    throw new Error(`${field} is required.`);
  }

  if (result.length < min || result.length > max) {
    throw new Error(`${field} must be between ${min} and ${max} characters.`);
  }

  return result;
}

/**
 * Normalize an email for consistent lookup and uniqueness checks.
 * Email delivery systems may have provider-specific rules, so do not
 * remove dots or plus-tags from addresses.
 */
export function normalizeEmail(value) {
  const email = normalizeText(value, {
    min: 3,
    max: 254,
    required: true,
    field: "Email"
  }).toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.includes("..")
  ) {
    throw new Error("Enter a valid email address.");
  }

  return email;
}

/** Normalize a United States ZIP code while preserving leading zeroes. */
export function normalizeUSZip(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError("ZIP code must be text or a number.");
  }

  const zip = String(value).trim();

  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
    throw new Error("Enter a valid 5-digit ZIP or ZIP+4 code.");
  }

  return zip;
}

/** Normalize a short, machine-readable identifier. */
export function normalizeSlug(value, field = "Identifier") {
  const slug = normalizeText(value, {
    min: 1,
    max: 80,
    required: true,
    field
  }).toLowerCase();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`${field} contains unsupported characters.`);
  }

  return slug;
}

/**
 * Deduplicate a list of strings case-insensitively.
 * The first spelling is retained; blank entries are ignored.
 */
export function uniqueStringList(values, {
  maxItems = 50,
  maxLength = 100,
  field = "List"
} = {}) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${field} must be a list.`);
  }

  if (values.length > maxItems * 3) {
    throw new Error(`${field} contains too many entries.`);
  }

  const seen = new Set();
  const output = [];

  for (const value of values) {
    if (typeof value !== "string") {
      throw new TypeError(`${field} entries must be text.`);
    }

    const item = normalizeText(value, {
      max: maxLength,
      field
    });

    if (!item) continue;

    const key = item.toLocaleLowerCase("en-US");

    if (seen.has(key)) continue;

    seen.add(key);
    output.push(item);

    if (output.length > maxItems) {
      throw new Error(`${field} may contain at most ${maxItems} unique entries.`);
    }
  }

  return output;
}

/** Parse safe, bounded pagination values from query parameters. */
export function parsePagination(query = {}, {
  defaultLimit = 20,
  maxLimit = 100
} = {}) {
  const parseInteger = (value, fallback, field) => {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const text = String(value);

    if (!/^\d+$/.test(text)) {
      throw new Error(`${field} must be a whole number.`);
    }

    const number = Number(text);

    if (!Number.isSafeInteger(number)) {
      throw new Error(`${field} is outside the allowed range.`);
    }

    return number;
  };

  const limit = parseInteger(query.limit, defaultLimit, "limit");
  const page = parseInteger(query.page, 1, "page");

  if (limit < 1 || limit > maxLimit) {
    throw new Error(`limit must be between 1 and ${maxLimit}.`);
  }

  if (page < 1 || page > 1_000_000) {
    throw new Error("page is outside the allowed range.");
  }

  const offset = (page - 1) * limit;

  if (!Number.isSafeInteger(offset)) {
    throw new Error("Pagination offset is outside the allowed range.");
  }

  return { limit, page, offset };
}

/**
 * Validate an idempotency key supplied for a retryable operation.
 * Scope the key to the authenticated account and operation in the database.
 */
export function validateIdempotencyKey(value) {
  if (typeof value !== "string") {
    throw new Error("A valid idempotency key is required.");
  }

  const key = value.trim();

  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new Error(
      "Idempotency key must contain 16–128 letters, numbers, underscores, or hyphens."
    );
  }

  return key;
}

/**
 * Produce deterministic JSON for hashing.
 * Objects are sorted recursively so key order does not change the hash.
 * Unsupported values and cyclic objects are rejected.
 */
function canonicalize(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Payload contains a non-finite number.");
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Payload must not be cyclic.");
    seen.add(value);
    const result = value.map(item => canonicalize(item, seen));
    seen.delete(value);
    return result;
  }

  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    if (seen.has(value)) throw new TypeError("Payload must not be cyclic.");
    seen.add(value);

    const result = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];

      if (
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol" ||
        typeof item === "bigint"
      ) {
        throw new TypeError("Payload contains an unsupported value.");
      }

      result[key] = canonicalize(item, seen);
    }

    seen.delete(value);
    return result;
  }

  throw new TypeError("Payload must contain only JSON-compatible data.");
}

/** SHA-256 fingerprint for detecting same-key, different-payload retries. */
export function fingerprintPayload(payload) {
  const canonicalJson = JSON.stringify(canonicalize(payload));

  return crypto
    .createHash("sha256")
    .update(canonicalJson, "utf8")
    .digest("hex");
}

/** Validate an amount expressed in integer cents; never use floats for money. */
export function validateMoneyCents(value, {
  min = 0,
  max = 100_000_000,
  field = "Amount"
} = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be a whole number of cents between ${min} and ${max}.`);
  }

  return value;
}

/** Validate an IANA timezone, such as America/Chicago. */
export function validateTimeZone(value) {
  const timezone = normalizeText(value, {
    min: 1,
    max: 100,
    required: true,
    field: "Timezone"
  });

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    throw new Error("Enter a valid IANA timezone.");
  }
}

/** Escape text before inserting it into an HTML text or quoted attribute context. */
export function escapeHtml(value) {
  const text = String(value);

  return text.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
