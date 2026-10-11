/**
 * Grounded web research for SwiftQuote Assistant.
 * Uses Tavily when TAVILY_API_KEY is set; otherwise uses Wikipedia's public
 * MediaWiki search API as a limited, no-key fallback. Retrieved text is untrusted.
 */
const MAX_QUERY_CHARS = 500;
const MAX_RESULTS = 5;

function cleanText(value, max = 1200) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

function resultShape(item) {
  const url = safeHttpUrl(item?.url);
  if (!url) return null;
  return {
    title: cleanText(item.title, 240) || 'Untitled source',
    url,
    domain: new URL(url).hostname.replace(/^www\./, ''),
    snippet: cleanText(item.snippet ?? item.content, 1200),
  };
}

export function shouldResearchMessage(message) {
  const text = String(message ?? '').trim();
  if (text.length < 18) return false;
  if (/^(hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening)[!. ]*$/i.test(text)) return false;
  // Never send obvious credentials, contact details, or sensitive account requests to search.
  if (/\b(password|passcode|api[ -]?key|access token|secret|social security|ssn|credit card|bank account|my email|my phone|my address)\b/i.test(text)) return false;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return false;
  if (/(?:\+?\d[\d ().-]{8,}\d)/.test(text)) return false;
  return /\?|\b(research|sources?|cite|citation|fact|factual|verify|check whether|latest|current|today|yesterday|this week|price|cost|compare|versus|\bvs\b|news|update|who is|what is|when did|where is|why does|how does|statistics|evidence|look up|find out|accurate|data|information)\b/i.test(text);
}

export function createWebResearch({ apiKey = '', fetchImpl = globalThis.fetch, timeoutMs = 8_000 } = {}) {
  const tavilyConfigured = Boolean(String(apiKey).trim());

  async function getJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error('Research source returned an unsuccessful response.');
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function tavilySearch(query) {
    const data = await getJson('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + String(apiKey).trim() },
      body: JSON.stringify({
        query,
        search_depth: 'advanced',
        topic: 'general',
        max_results: MAX_RESULTS,
        include_answer: false,
        include_raw_content: false,
      }),
    });
    const results = (Array.isArray(data?.results) ? data.results : [])
      .map(item => resultShape({ title: item.title, url: item.url, content: item.content }))
      .filter(item => item && item.snippet);
    return { provider: 'tavily', results: results.slice(0, MAX_RESULTS) };
  }

  async function wikipediaSearch(query) {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(MAX_RESULTS),
      format: 'json',
      origin: '*',
    }).toString();
    const data = await getJson(url.href, { headers: { accept: 'application/json', 'user-agent': 'SwiftQuoteAssistant/1.0 (public factual search)' } });
    const results = (Array.isArray(data?.query?.search) ? data.query.search : [])
      .map(item => {
        const title = cleanText(item.title, 240);
        const pageUrl = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
        return resultShape({ title, url: pageUrl, content: item.snippet });
      })
      .filter(Boolean);
    return { provider: 'wikipedia', results: results.slice(0, MAX_RESULTS) };
  }

  return {
    configured: true,
    provider: tavilyConfigured ? 'tavily' : 'wikipedia',
    async search(query) {
      const safeQuery = cleanText(query, MAX_QUERY_CHARS);
      if (safeQuery.length < 3) return { provider: 'none', results: [] };
      try {
        return tavilyConfigured ? await tavilySearch(safeQuery) : await wikipediaSearch(safeQuery);
      } catch {
        // Search failure must not break ordinary conversation; do not expose
        // upstream response bodies, keys, or potentially sensitive request data.
        return { provider: tavilyConfigured ? 'tavily' : 'wikipedia', results: [], unavailable: true };
      }
    },
  };
}
