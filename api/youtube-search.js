/**
 * api/youtube-search.js
 * ──────────────────────────────────────────────────────────────
 * Secure backend proxy for the dashboard's "course videos" YouTube search.
 *
 * WHY THIS EXISTS — the bug it fixes:
 * The dashboard used to call the YouTube Data API directly from the
 * browser with a single hardcoded key shared by EVERY student on the
 * platform. YouTube's free quota is 10,000 units/day, and a search.list
 * call costs 100 units — so the whole platform had room for only ~100
 * searches a day, combined, before the key's quota ran out. Once it did,
 * every subsequent search (for every student, regardless of what they
 * searched) silently fell back to the same hardcoded 6-video default
 * list, which is exactly the bug reported: "one student gets results,
 * the other gets the same set of videos that are already there."
 *
 * This endpoint fixes both the quota problem and the security problem
 * (a client-exposed API key) at once:
 *   1. The key now lives only in this server-side env var — never shipped
 *      to the browser.
 *   2. Identical/near-identical searches are served from an in-memory
 *      cache instead of hitting YouTube again, so ten students searching
 *      "calculus" within the cache window cost ONE YouTube API call, not
 *      ten — directly reducing how fast the shared daily quota is spent.
 *   3. If YouTube still returns a quota/error response, this says so
 *      honestly (`ok: false, reason: 'unavailable'`) instead of silently
 *      returning unrelated videos disguised as search results — the
 *      frontend is responsible for telling the student that, not hiding it.
 *
 * Environment variables required:
 *   YOUTUBE_API_KEY  – a YouTube Data API v3 key (server-side only)
 *
 * Endpoint : GET /api/youtube-search?q=<query>
 * Response : { ok: true, items: [{ videoId, title }] }
 *         or { ok: false, reason: 'unavailable' | 'invalid' | ... }
 * ──────────────────────────────────────────────────────────────
 */

const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

const ALLOWED_ORIGINS = [
  'https://peerloom.online',
  'https://www.peerloom.online',
];

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mdofjippejpqylwuzsqp.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kb2ZqaXBwZWpwcXlsd3V6c3FwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI2NjcyNzAsImV4cCI6MjA2ODI0MzI3MH0.PKtUqmGKciAQH3f_kz2q9VeYSdOcYHQDCJFu6UHcAw4';

async function verifySupabaseUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error(`Supabase auth responded ${r.status}`);
  const u = await r.json();
  return u && u.id ? u : null;
}

/**
 * ── Rate limiting ───────────────────────────────────────────────
 * Same best-effort, zero-infrastructure, in-memory-per-instance limiter
 * already used by api/peerpal.js — see that file for the honest caveats
 * about multi-instance serverless scaling. The point here isn't to be
 * bulletproof, it's to stop one student's runaway search loop from
 * burning the platform's entire shared daily quota by itself.
 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateLimitBuckets = new Map();

function isRateLimited(clientKey, max) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(clientKey);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(clientKey, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

if (typeof globalThis.__ytSearchRateLimitSweepStarted === 'undefined') {
  globalThis.__ytSearchRateLimitSweepStarted = true;
  setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    for (const [key, bucket] of rateLimitBuckets) {
      if (bucket.windowStart < cutoff) rateLimitBuckets.delete(key);
    }
  }, RATE_LIMIT_WINDOW_MS).unref?.();
}

/**
 * ── Result cache ────────────────────────────────────────────────
 * Keyed by the normalized query. This is the main quota-saving lever:
 * many students search overlapping terms (course codes, topic names), so
 * serving repeats from cache instead of re-querying YouTube is what keeps
 * the shared 100-searches/day budget from being exhausted by midday.
 * In-memory per serverless instance, same honest limitation as the rate
 * limiter above — good enough to meaningfully cut quota usage, not a
 * guaranteed global cache.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_MAX_ENTRIES = 500;
const searchCache = new Map();

function cacheGet(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry.items;
}

function cacheSet(key, items) {
  if (searchCache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest entry — simple FIFO is plenty for this use case.
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey !== undefined) searchCache.delete(oldestKey);
  }
  searchCache.set(key, { items, at: Date.now() });
}

function normalizeQuery(q) {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (isRateLimited('ip:' + ip, 60)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ ok: false, reason: 'rate_limited' });
  }

  // Signed-in Peerloom users only — same reasoning as api/peerpal.js: an
  // open endpoint in front of a metered, quota-limited API is an abuse
  // magnet, and this feature only ever appears inside the logged-in
  // dashboard anyway.
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let user = null;
  try {
    user = bearer ? await verifySupabaseUser(bearer) : null;
  } catch (authErr) {
    console.error('[youtube-search] Auth service unreachable:', authErr.message);
    return res.status(503).json({ ok: false, reason: 'auth_unavailable' });
  }
  if (!user) {
    return res.status(401).json({ ok: false, reason: 'not_signed_in' });
  }
  if (isRateLimited('user:' + user.id, 20)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ ok: false, reason: 'rate_limited' });
  }

  const rawQuery = typeof req.query?.q === 'string' ? req.query.q : '';
  const query = rawQuery.trim();
  if (!query) {
    return res.status(400).json({ ok: false, reason: 'invalid_query' });
  }
  if (query.length > 150) {
    return res.status(400).json({ ok: false, reason: 'invalid_query' });
  }

  const educationalKeywords = 'educational tutorial lecture course university college learning';
  const fullQuery = `${query} ${educationalKeywords}`;
  const cacheKey = normalizeQuery(fullQuery);

  const cached = cacheGet(cacheKey);
  if (cached) {
    return res.status(200).json({ ok: true, items: cached, cached: true });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('[youtube-search] YOUTUBE_API_KEY is not set in environment variables.');
    return res.status(200).json({ ok: false, reason: 'not_configured' });
  }

  try {
    const url = `${YOUTUBE_SEARCH_URL}?part=snippet&q=${encodeURIComponent(fullQuery)}&type=video&maxResults=8&key=${apiKey}`;
    const ytRes = await fetch(url);
    const ytData = await ytRes.json().catch(() => null);

    if (!ytRes.ok || !ytData || ytData.error) {
      // Quota exceeded, key invalid, etc. Logged for the operator, but the
      // student-facing response stays a plain, honest "unavailable" — the
      // frontend decides how to present that, it never gets to pretend
      // these are search results when they aren't.
      const reason = ytData?.error?.errors?.[0]?.reason || ytRes.status;
      console.error(`[youtube-search] YouTube API error (${reason}):`, ytData?.error?.message || ytRes.statusText);
      return res.status(200).json({ ok: false, reason: 'unavailable' });
    }

    const items = (ytData.items || [])
      .filter(item => item?.id?.videoId && item?.snippet?.title)
      .slice(0, 8)
      .map(item => ({ videoId: item.id.videoId, title: item.snippet.title }));

    cacheSet(cacheKey, items);
    return res.status(200).json({ ok: true, items, cached: false });
  } catch (networkError) {
    console.error('[youtube-search] Network error calling YouTube:', networkError);
    return res.status(200).json({ ok: false, reason: 'unavailable' });
  }
}

module.exports = handler;