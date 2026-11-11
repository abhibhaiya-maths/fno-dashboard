/**
 * F&O डैशबोर्ड — Cloudflare Worker (बैकएंड)
 *
 * काम:
 *  - Upstox लॉगिन (OAuth) और रोज़ का access token सुरक्षित रखना (KV में)
 *  - इंडेक्स, VIX, हैवीवेट शेयरों के लाइव भाव
 *  - 1-मिनट कैंडल्स (पिछले 2 सत्र + आज)
 *  - ऑप्शन चेन (नज़दीकी एक्सपायरी) + लॉट साइज़
 *  - न्यूज़ (RSS) + AI सेंटिमेंट स्कोर
 *  - वॉइस सवालों के लिए AI जवाब
 *  - हर रिक्वेस्ट पर Firebase लॉगिन की जाँच (सिर्फ़ ALLOWED_EMAIL)
 *
 * ज़रूरी सेटिंग्स (Cloudflare Worker → Settings → Variables and Secrets):
 *  Secrets:   UPSTOX_ACCESS_TOKEN (Upstox Analytics Token, आसान तरीक़ा, रोज़ लॉगिन नहीं)
 *             या फिर UPSTOX_API_KEY + UPSTOX_API_SECRET (OAuth, रोज़ लॉगिन)
 *             GEMINI_API_KEY (मुफ़्त, वैकल्पिक) या Workers AI binding "AI" (बिना key) या ANTHROPIC_API_KEY (पेड)
 *  Variables: FRONTEND_URL, ALLOWED_EMAIL, FIREBASE_API_KEY, UPSTOX_REDIRECT_URI (सिर्फ़ OAuth में), CLAUDE_MODEL (वैकल्पिक)
 *  KV binding: KV
 *
 * ये टूल कोई असली ऑर्डर नहीं लगाता। सिर्फ़ डेटा पढ़ता है।
 */

const UP = 'https://api.upstox.com';

const INDEX = {
  NIFTY: { key: 'NSE_INDEX|Nifty 50', sym: 'NIFTY', exch: 'NSE' },
  SENSEX: { key: 'BSE_INDEX|SENSEX', sym: 'SENSEX', exch: 'BSE' },
  BANKNIFTY: { key: 'NSE_INDEX|Nifty Bank', sym: 'BANKNIFTY', exch: 'NSE' },
};
// Session windows in minutes from 09:15 IST (MCX trades 09:00 to 23:30)
const SESS = { NSE: [0, 374], MCX: [-15, 869] };
const KEY_RE = /^[A-Z_]{3,20}\|[\w &.\-^:/]{1,40}$/;
function keyParam(url, name) {
  const k = url.searchParams.get(name);
  if (!k || !KEY_RE.test(k)) throw new HttpError(400, 'Bad instrument key');
  return k;
}
const VIX_KEY = 'NSE_INDEX|India VIX';

// हैवीवेट शेयर: [नाम, ISIN, इंडेक्स में अनुमानित वज़न %]
// वज़न समय-समय पर बदलते हैं, NSE/BSE की वेबसाइट से कभी-कभी अपडेट कर लें।
const HV = {
  NIFTY: [['HDFC Bank', 'INE040A01034', 13], ['ICICI Bank', 'INE090A01021', 9], ['Reliance', 'INE002A01018', 8.5],
    ['Infosys', 'INE009A01021', 5], ['Bharti Airtel', 'INE397D01024', 4.5], ['L&T', 'INE018A01030', 4],
    ['ITC', 'INE154A01025', 3.5], ['TCS', 'INE467B01029', 3]],
  SENSEX: [['HDFC Bank', 'INE040A01034', 15], ['ICICI Bank', 'INE090A01021', 10], ['Reliance', 'INE002A01018', 10],
    ['Infosys', 'INE009A01021', 6], ['Bharti Airtel', 'INE397D01024', 5], ['L&T', 'INE018A01030', 4.5],
    ['ITC', 'INE154A01025', 4], ['TCS', 'INE467B01029', 3.5]],
  BANKNIFTY: [['HDFC Bank', 'INE040A01034', 28], ['ICICI Bank', 'INE090A01021', 25], ['SBI', 'INE062A01020', 9],
    ['Kotak Bank', 'INE237A01028', 8], ['Axis Bank', 'INE238A01034', 8], ['IndusInd Bank', 'INE095A01012', 3.5],
    ['Federal Bank', 'INE171A01029', 3], ['AU Bank', 'INE949L01017', 2.5]],
};

// मुफ़्त मार्केट न्यूज़ RSS फ़ीड। कोई फ़ीड न चले तो उसे हटा दें या बदल दें।
const FEEDS = [
  // Trusted publishers only (no open web search). Tier is shown on every news tile.
  ['ET Markets', 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'],
  ['ET Stocks', 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms'],
  ['Business Standard', 'https://www.business-standard.com/rss/markets-106.rss'],
  ['Business Standard', 'https://www.business-standard.com/rss/markets/stock-market-news-10618.rss'],
  ['Business Standard Results', 'https://www.business-standard.com/rss/companies/results-10301.rss'],
  ['Mint Markets', 'https://www.livemint.com/rss/markets'],
  ['BusinessLine', 'https://www.thehindubusinessline.com/markets/feeder/default.rss'],
  ['BusinessLine', 'https://www.thehindubusinessline.com/markets/stock-markets/feeder/default.rss'],
  ['CNBC-TV18', 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml'],
  ['CNBC-TV18', 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/economy.xml'],
  ['Moneycontrol', 'https://www.moneycontrol.com/rss/marketreports.xml'],
  ['Moneycontrol Results', 'https://www.moneycontrol.com/rss/results.xml'],
  // Global wires, headlines only, through Google News restricted to these two sites
  ['Google News: Reuters/Bloomberg', 'https://news.google.com/rss/search?q=(India+OR+Nifty+OR+Sensex+OR+RBI+OR+rupee)+(site:reuters.com+OR+site:bloomberg.com)+when:2d&hl=en-IN&gl=IN&ceid=IN:en'],
  ['Google News: Reuters/Bloomberg', 'https://news.google.com/rss/search?q=(Fed+OR+%22Wall+Street%22+OR+crude+OR+%22oil+prices%22)+(site:reuters.com+OR+site:bloomberg.com)+when:1d&hl=en-IN&gl=IN&ceid=IN:en'],
];
// तिमाही नतीजों वाली ख़बरें पहचानने के लिए
const RESULT_RE = /\b(Q[1-4]|quarter(ly)?|results?|earnings|net profit|PAT|EBITDA|revenue|profit (rises|falls|jumps|drops|up|down))\b/i;
const NEWS_KW = {
  BANKNIFTY: /bank|banking|rbi|nbfc|lender|loan|credit|deposit|hdfc|icici|sbi|kotak|axis|indusind|repo|liquidity|npa/i,
  NIFTY: /nifty|sensex|market|stock|share|equit|fii|fpi|dii|dalal|rbi|fed|crude|oil|rupee|inflation|gdp|earning|q[1-4]|result|tariff|bond|yield/i,
  SENSEX: /nifty|sensex|market|stock|share|equit|fii|fpi|dii|dalal|rbi|fed|crude|oil|rupee|inflation|gdp|earning|q[1-4]|result|tariff|bond|yield/i,
};

/* ---------------- छोटे हेल्पर ---------------- */
const MEM = new Map(); // isolate के अंदर छोटा कैश
function memGet(k) { const v = MEM.get(k); if (!v) return null; if (v.exp < Date.now()) { MEM.delete(k); return null; } return v.val; }
function memSet(k, val, ttlMs) { MEM.set(k, { val, exp: Date.now() + ttlMs }); if (MEM.size > 300) MEM.delete(MEM.keys().next().value); }

class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }

function istNow() { return new Date(Date.now() + 5.5 * 3600e3); } // UTC फ़ील्ड्स = IST समय
function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(d.getTime() + n * 86400e3); }
const enc = (s) => encodeURIComponent(s);
const ok = (v) => v != null && isFinite(v);

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.FRONTEND_URL || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || '*'),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}
function json(data, status, req, env) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req, env) } });
}

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* ---------------- Firebase लॉगिन जाँच ---------------- */
async function verifyUser(req, env, tokenOverride) {
  const tok = tokenOverride || (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tok) throw new HttpError(401, 'Login required', 'NO_AUTH');
  const ck = 'auth:' + (await sha(tok));
  const cached = memGet(ck);
  if (cached) return cached;
  if (!env.FIREBASE_API_KEY) throw new HttpError(500, 'FIREBASE_API_KEY is not set in the Worker', 'CONFIG');
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: tok }),
  });
  if (!r.ok) throw new HttpError(401, 'Login token is invalid or expired. Log in again.', 'BAD_AUTH');
  const j = await r.json();
  const email = (j.users && j.users[0] && j.users[0].email || '').toLowerCase();
  const allowed = (env.ALLOWED_EMAIL || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (!email || !allowed.includes(email)) throw new HttpError(403, 'This email is not allowed', 'FORBIDDEN');
  memSet(ck, email, 5 * 60e3);
  return email;
}

/* ---------------- Upstox ---------------- */
async function upstoxToken(env) {
  // Upstox "Analytics Token": 1 साल चलने वाला read-only टोकन, रोज़ लॉगिन की ज़रूरत नहीं
  if (env.UPSTOX_ACCESS_TOKEN) return env.UPSTOX_ACCESS_TOKEN.trim();
  let t = memGet('upstox_token');
  if (t) return t;
  t = await env.KV.get('upstox_token');
  if (!t) throw new HttpError(428, 'Connect Upstox (once each morning)', 'UPSTOX_LOGIN');
  memSet('upstox_token', t, 5 * 60e3);
  return t;
}
async function up(env, path, force) {
  if (!force && Date.now() < RL.until) { const e = new HttpError(429, RL.msg, 'UPSTOX_RATE'); e.retryAfter = Math.ceil((RL.until - Date.now()) / 1000); throw e; }
  const t = await upstoxToken(env);
  UPC.push(Date.now()); while (UPC.length && UPC[0] < Date.now() - 1800e3) UPC.shift();
  const r = await fetch(UP + path, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + t } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && env.UPSTOX_ACCESS_TOKEN) {
    throw new HttpError(502, 'Upstox Analytics Token is invalid or expired. Create a new one in Upstox → My Apps → Analytics and update UPSTOX_ACCESS_TOKEN.', 'UPSTOX_TOKEN_BAD');
  }
  if (r.status === 401) {
    MEM.delete('upstox_token');
    await env.KV.delete('upstox_token');
    throw new HttpError(428, 'Upstox token expired. Connect again.', 'UPSTOX_LOGIN');
  }
  if (r.status === 429) {
    // back off longer each time Upstox says "too many": 1, 2, 4, 8 … up to 15 minutes, or what Upstox asks for
    const ra = +r.headers.get('retry-after') || 0, up = (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].errorCode)) || '';
    RL.n = Date.now() - RL.last < 20 * 60e3 ? RL.n + 1 : 0; RL.last = Date.now();
    const wait = ra ? ra * 1000 : Math.min(15 * 60e3, 60e3 * 2 ** RL.n);
    RL.until = Date.now() + wait;
    RL.msg = `Upstox rate limit (${up || 'too many requests'}). Pausing data requests for ${Math.round(wait / 60000) || 1} min.`;
    const e = new HttpError(429, RL.msg, 'UPSTOX_RATE'); e.retryAfter = Math.ceil(wait / 1000); throw e;
  }
  if (!r.ok || j.status === 'error') {
    const m = (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].errorCode)) || ('HTTP ' + r.status);
    throw new HttpError(502, 'Upstox: ' + m, 'UPSTOX_ERR');
  }
  return j.data;
}
// पहला रास्ता फ़ेल हो तो दूसरा आज़माओ (v3 → v2)
const RL = { until: 0, n: 0, last: 0, msg: '' }, UPC = [];
async function upAny(env, paths) {
  let last;
  for (const p of paths) {
    // never retry the second URL on a rate limit: that only doubles the load
    try { return await up(env, p); } catch (e) { if (e.code === 'UPSTOX_LOGIN' || e.code === 'UPSTOX_RATE') throw e; last = e; }
  }
  throw last;
}
// Short shared cache: phone + laptop + friends asking for the same thing within seconds share one Upstox call
async function shared(key, ms, fn) {
  const c = memGet('sh:' + key); if (c) return c;
  const p = MEM.get('shp:' + key); if (p && p.exp > Date.now()) return p.v; // same request already in flight
  const v = fn(); MEM.set('shp:' + key, { v, exp: Date.now() + 10000 });
  try { const out = await v; memSet('sh:' + key, out, ms); return out; } finally { MEM.delete('shp:' + key); }
}

function nextTokenExpiry() {
  // Upstox टोकन अगले दिन सुबह 3:30 IST पर ख़त्म होता है
  const n = istNow();
  let exp = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 3, 30));
  if (exp <= n) exp = addDays(exp, 1);
  return Math.floor((exp.getTime() - 5.5 * 3600e3) / 1000); // असली UTC epoch सेकंड
}

async function authLogin(req, env, url) {
  await verifyUser(req, env, url.searchParams.get('id_token'));
  const state = crypto.randomUUID();
  await env.KV.put('oauth_state:' + state, '1', { expirationTtl: 600 });
  const u = new URL(UP + '/v2/login/authorization/dialog');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.UPSTOX_API_KEY);
  u.searchParams.set('redirect_uri', env.UPSTOX_REDIRECT_URI);
  u.searchParams.set('state', state);
  return Response.redirect(u.toString(), 302);
}

async function authCallback(req, env, url) {
  const front = (env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '');
  const back = (q) => Response.redirect(front + '/?' + q, 302);
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state) return back('upstox=error&msg=' + enc('Login cancelled'));
  const ok = await env.KV.get('oauth_state:' + state);
  if (!ok) return back('upstox=error&msg=' + enc('Login session expired, try again'));
  await env.KV.delete('oauth_state:' + state);
  const body = new URLSearchParams({
    code, client_id: env.UPSTOX_API_KEY, client_secret: env.UPSTOX_API_SECRET,
    redirect_uri: env.UPSTOX_REDIRECT_URI, grant_type: 'authorization_code',
  });
  const r = await fetch(UP + '/v2/login/authorization/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return back('upstox=error&msg=' + enc('No token received: ' + ((j.errors && j.errors[0] && j.errors[0].message) || r.status)));
  await env.KV.put('upstox_token', j.access_token, { expiration: nextTokenExpiry() });
  memSet('upstox_token', j.access_token, 5 * 60e3);
  return back('upstox=connected');
}

/* ---------------- एक्सपायरी और लॉट ---------------- */
async function contracts(env, ukey) {
  const today = ymd(istNow());
  const ck = 'contracts:' + ukey + ':' + today;
  let c = memGet(ck);
  if (c) return c;
  const kv = await env.KV.get(ck, 'json');
  if (kv) { memSet(ck, kv, 3600e3); return kv; }
  const data = await up(env, '/v2/option/contract?instrument_key=' + enc(ukey));
  const exp = {};
  for (const x of data || []) { if (!exp[x.expiry]) exp[x.expiry] = x.lot_size; }
  const expiries = Object.keys(exp).sort();
  c = { expiries, lots: exp };
  await env.KV.put(ck, JSON.stringify(c), { expirationTtl: 26 * 3600 });
  memSet(ck, c, 3600e3);
  return c;
}
function pickExpiry(c) {
  const n = istNow(), today = ymd(n);
  const afterClose = n.getUTCHours() * 60 + n.getUTCMinutes() > 15 * 60 + 30;
  return c.expiries.find((e) => e > today || (e === today && !afterClose)) || c.expiries[c.expiries.length - 1];
}

function slimSide(o) {
  const m = (o && o.market_data) || {}, g = (o && o.option_greeks) || {};
  return {
    key: (o && o.instrument_key) || null, ltp: m.ltp || 0, bid: m.bid_price || 0, ask: m.ask_price || 0, oi: m.oi || 0, poi: m.prev_oi || 0, vol: m.volume || 0,
    iv: g.iv ? g.iv / 100 : 0, de: g.delta || 0, ga: g.gamma || 0, th: g.theta || 0, ve: g.vega || 0,
  };
}
async function chain(env, ukey) { return shared('chain:' + ukey, 8000, () => chain0(env, ukey)); }
async function chain0(env, ukey) {
  const c = await contracts(env, ukey);
  if (!c.expiries.length) throw new HttpError(404, 'No option contracts for this instrument', 'NO_OPTIONS');
  const expiry = pickExpiry(c);
  const data = await up(env, `/v2/option/chain?instrument_key=${enc(ukey)}&expiry_date=${expiry}`);
  const rows = (data || []).map((r) => ({ K: r.strike_price, ce: slimSide(r.call_options), pe: slimSide(r.put_options) })).sort((a, b) => a.K - b.K);
  const spot = data && data[0] ? data[0].underlying_spot_price : null;
  return { expiry, lot: c.lots[expiry] || null, spot, rows };
}

/* ---------------- भाव ---------------- */
function quoteMap(data) {
  const byKey = {};
  for (const name in data || {}) {
    const q = data[name];
    const tk = q.instrument_token || name.replace(':', '|');
    const lp = q.last_price, nc = q.net_change || 0, o = q.ohlc || {};
    byKey[tk] = { price: lp, prevClose: lp - nc, chg: lp - nc ? (nc / (lp - nc)) * 100 : 0, vol: q.volume || 0, oi: q.oi || 0, hi: o.high || null, lo: o.low || null, open: o.open || null, ts: q.last_trade_time || q.timestamp || null };
  }
  return byKey;
}
async function quotes(env, watch) {
  const keys = new Set([VIX_KEY, ...Object.values(INDEX).map((x) => x.key)]);
  for (const k in HV) HV[k].forEach((h) => keys.add('NSE_EQ|' + h[1]));
  (watch || []).forEach((k) => keys.add(k));
  const data = await up(env, '/v2/market-quote/quotes?instrument_key=' + [...keys].map(enc).join(','));
  const byKey = quoteMap(data);
  const indices = {};
  for (const k in INDEX) indices[k] = byKey[INDEX[k].key] || null;
  const v = byKey[VIX_KEY];
  const hv = {};
  for (const k in HV) hv[k] = HV[k].map(([n, isin, w]) => ({ n, w, k: 'NSE_EQ|' + isin, c: byKey['NSE_EQ|' + isin] ? byKey['NSE_EQ|' + isin].chg : null }));
  const ikeys = { vix: VIX_KEY }; for (const k in INDEX) ikeys[k] = INDEX[k].key;
  const w = {}; (watch || []).forEach((k) => { if (byKey[k]) w[k] = byKey[k]; });
  return { indices, vix: v ? { v: v.price, prev: v.prevClose } : null, hv, keys: ikeys, watch: w };
}

async function snapshot(env, watch, lite) {
  return shared('snap:' + (lite ? 'L:' : '') + (watch || []).join(','), 2500, () => snapshot0(env, watch, lite));
}
async function snapshot0(env, watch, lite) {
  // lite = prices only (1 Upstox call) for fast polling; full adds the three option chains (3 more calls)
  const [q, ...chains] = await Promise.all([
    quotes(env, watch),
    ...(lite ? [] : Object.keys(INDEX).map((k) => chain(env, INDEX[k].key).catch((e) => ({ error: e.message })))),
  ]);
  if (lite) return { ts: Date.now(), ...q, lite: true };
  const ch = {};
  Object.keys(INDEX).forEach((k, i) => (ch[k] = chains[i]));
  return { ts: Date.now(), ...q, chains: ch };
}

/* ---------------- कैंडल्स ---------------- */
function groupCandles(arr, sess) {
  // Upstox: [timestamp, open, high, low, close, volume, oi], नई कैंडल पहले
  const [a, b] = SESS[sess] || SESS.NSE, days = {};
  for (const c of arr || []) {
    const ts = c[0], date = ts.slice(0, 10), hh = +ts.slice(11, 13), mm = +ts.slice(14, 16);
    const m = hh * 60 + mm - 555; // 09:15 = 0
    if (m < a || m > b) continue;
    (days[date] = days[date] || []).push([m, c[1], c[2], c[3], c[4], c[5] || 0, c[6] || 0]);
  }
  return Object.keys(days).sort().map((date) => ({ date, c: days[date].sort((a, b) => a[0] - b[0]) }));
}
async function candles(env, key, sess) {
  const n = istNow(), today = ymd(n);
  const hk = 'hist:' + key + ':' + today;
  let hist = memGet(hk) || (await env.KV.get(hk, 'json'));
  if (!hist) {
    const to = ymd(addDays(n, -1)), from = ymd(addDays(n, -10));
    const d = await upAny(env, [
      `/v3/historical-candle/${enc(key)}/minutes/1/${to}/${from}`,
      `/v2/historical-candle/${enc(key)}/1minute/${to}/${from}`,
    ]);
    hist = groupCandles(d && d.candles, sess).filter((x) => x.date < today).slice(-3);
    await env.KV.put(hk, JSON.stringify(hist), { expirationTtl: 20 * 3600 });
    memSet(hk, hist, 3600e3);
  } else memSet(hk, hist, 3600e3);
  let todayDays = [], todayErr = null;
  const lk = 'lastToday:' + key;
  try {
    const d = await shared('intra:' + key, 20000, () => upAny(env, [
      `/v3/historical-candle/intraday/${enc(key)}/minutes/1`,
      `/v2/historical-candle/intraday/${enc(key)}/1minute`,
    ]));
    todayDays = groupCandles(d && d.candles, sess).filter((x) => x.date === today);
    if (todayDays.length) memSet(lk, todayDays, 6 * 3600e3);
  } catch (e) {
    if (e.code === 'UPSTOX_LOGIN') throw e;
    todayErr = e.message;
  }
  // Upstox hiccup: fall back to the last good copy of today's candles instead of silently dropping the session
  if (!todayDays.length) { const c = memGet(lk); if (c && c[0] && c[0].date === today) todayDays = c; }
  return { today, days: [...hist, ...todayDays].slice(-3), todayErr };
}

/* ---------------- AI ---------------- */
// ===== AI: मुफ़्त विकल्प पहले =====
// 1) GEMINI_API_KEY  -> Google Gemini (मुफ़्त key, aistudio.google.com)
// 2) AI binding      -> Cloudflare Workers AI (कोई key नहीं, रोज़ मुफ़्त कोटा)
// 3) ANTHROPIC_API_KEY -> Claude (पेड, वैकल्पिक)
const hasAI = (env) => !!(env.GEMINI_API_KEY || env.AI || env.ANTHROPIC_API_KEY);
// Each Gemini model has its own free daily quota, so we fall through several. A model that hits its quota
// is skipped until Google's reset (midnight US Pacific ≈ 12:30–1:30 PM IST).
const GEMINI_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemma-3-27b-it'];
function nextPacificMidnight() { const d = new Date(); const pt = new Date(d.getTime() - 8 * 3600e3); return Date.UTC(pt.getUTCFullYear(), pt.getUTCMonth(), pt.getUTCDate() + 1) + 8 * 3600e3; }
async function gemini1(env, model, prompt, maxTokens) {
  const gen = { maxOutputTokens: maxTokens || 800, temperature: 0.3 };
  if (/^gemini-2\.5/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gen }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('Gemini ' + model + ': ' + ((j.error && j.error.message) || r.status)); e.quota = r.status === 429 || /quota|exhaust/i.test(e.message); throw e; }
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const txt = parts.map((p) => p.text || '').join('');
  if (!txt) throw new Error('Gemini ' + model + ': empty reply');
  return txt;
}
async function gemini(env, prompt, maxTokens, models) {
  const list = models || (env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...GEMINI_CHAIN.filter((m) => m !== env.GEMINI_MODEL)] : GEMINI_CHAIN);
  let last = new Error('Gemini: all free models are out of quota for today');
  for (const m of list) {
    const ck = 'gq:' + m;
    if (memGet(ck) || (await env.KV.get(ck))) { last.quota = true; continue; }
    try { return await gemini1(env, m, prompt, maxTokens); }
    catch (e) {
      last = e;
      if (e.quota) { const ttl = Math.max(60, Math.round((nextPacificMidnight() - Date.now()) / 1000)); memSet(ck, 1, ttl * 1000); await env.KV.put(ck, '1', { expirationTtl: ttl }).catch(() => {}); }
    }
  }
  throw last;
}
// Workers AI: Cloudflare retired the plain Llama 3.1/3 models on 30 May 2026, so try current ones in order
const CF_CHAIN = ['@cf/meta/llama-3.1-8b-instruct-fast', '@cf/zai-org/glm-4.7-flash', '@cf/google/gemma-4-26b-a4b-it'];
async function workersAI(env, prompt, maxTokens) {
  const list = env.CF_AI_MODEL ? [env.CF_AI_MODEL, ...CF_CHAIN.filter((m) => m !== env.CF_AI_MODEL)] : CF_CHAIN;
  let last = new Error('Workers AI: no model available');
  for (const m of list) {
    if (memGet('cfdead:' + m)) continue;
    try {
      const out = await env.AI.run(m, { messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens || 800 });
      let txt = out && (out.response || (out.result && out.result.response) || (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content));
      if (txt && typeof txt !== 'string') txt = JSON.stringify(txt);
      if (txt) return txt;
      last = new Error('Workers AI ' + m + ': empty reply');
    } catch (e) {
      last = new Error('Workers AI ' + m + ': ' + (e.message || e));
      if (/deprecat|not found|no such model|5028|5007/i.test(String(e.message))) memSet('cfdead:' + m, 1, 24 * 3600e3);
    }
  }
  throw last;
}
async function anthropic(env, prompt, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || 'claude-haiku-5-5', max_tokens: maxTokens || 800, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Claude: ' + ((j.error && j.error.message) || r.status));
  return (j.content || []).map((c) => c.text || '').join('');
}
// purpose 'chat' = your questions (best model first). 'bulk' = scoring headlines: never spends the good Gemini quota
// (Workers AI, then Gemma; if neither works the simple keyword score is used).
// Speech to text for phones whose browser has no speech recognition (iPhone with Siri/Dictation off, in-app browsers):
// the page records a few seconds of audio and the Worker transcribes it (Workers AI Whisper, else Gemini). Nothing is stored.
async function stt(env, body) {
  const b64 = String((body && body.audio) || ''), mime = String((body && body.mime) || 'audio/mp4').split(';')[0];
  if (!b64 || b64.length > 6e6) throw new HttpError(400, 'No audio, or the recording is too long');
  let last = new Error('Voice input needs AI: add GEMINI_API_KEY or a Workers AI binding (AI) in the Worker');
  if (env.AI) {
    try {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: b64 }).catch(() => env.AI.run('@cf/openai/whisper', { audio: [...bin] }));
      const t = out && (out.text || (out.result && out.result.text));
      if (t && t.trim()) return { text: t.trim(), via: 'Workers AI' };
    } catch (e) { last = e; }
  }
  if (env.GEMINI_API_KEY) {
    const prompt = 'Transcribe this short voice question exactly as spoken. The speaker uses Hindi, English or a mix, usually about the Indian stock market (Nifty, Bank Nifty, Sensex, call, put, strike prices). Write Hindi words in Devanagari and English words in English. Return only the transcript, nothing else.';
    const mimes = [...new Set([mime, /mp4|m4a|aac/.test(mime) ? 'audio/aac' : /webm|ogg/.test(mime) ? 'audio/ogg' : mime])];
    for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) for (const mt of mimes) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mt, data: b64 } }] }], generationConfig: { temperature: 0, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } } }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { last = new Error('Gemini ' + model + ': ' + ((j.error && j.error.message) || r.status)); continue; }
        const t = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((x) => x.text || '').join('').trim();
        if (t) return { text: t, via: 'Gemini' };
      } catch (e) { last = e; }
    }
  }
  throw new HttpError(502, 'Could not understand the recording: ' + String(last.message || last).slice(0, 160));
}
async function aiText(env, prompt, maxTokens, purpose) {
  const steps = purpose === 'bulk'
    ? [['AI', () => workersAI(env, prompt, maxTokens)], ['GEMINI_API_KEY', () => gemini(env, prompt, maxTokens, ['gemma-3-27b-it'])]]
    : [['GEMINI_API_KEY', () => gemini(env, prompt, maxTokens)], ['AI', () => workersAI(env, prompt, maxTokens)], ['ANTHROPIC_API_KEY', () => anthropic(env, prompt, maxTokens)]];
  let last = new Error('No AI configured'), quota = false;
  for (const [k, fn] of steps) {
    if (!env[k]) continue;
    try { return await fn(); } catch (e) { last = e; if (e.quota) quota = true; }
  }
  if (quota && purpose !== 'bulk') throw new HttpError(429, env.AI ? 'AI is busy right now. Try again in a minute.' : 'Free AI quota for today is used up. It resets around 1:30 PM IST. Add the free Workers AI binding (name: AI) in the Worker so answers keep coming.', 'AI_QUOTA');
  throw last;
}

/* ---------------- न्यूज़ ---------------- */
function xmlText(s) {
  return (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
async function fetchFeed([src, url]) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (FnO Dashboard)' } });
    if (!r.ok) return [];
    const x = await r.text();
    const items = x.split(/<item[\s>]/i).slice(1, 40);
    return items.map((it) => {
      const g = (tag) => { const m = it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')); return m ? xmlText(m[1]) : ''; };
      const ts = Date.parse(g('pubDate')) || Date.now();
      let t = g('title'), s2 = src;
      if (src.startsWith('Google News')) { const m = t.match(/^(.*)\s+-\s+([^-]{2,50})$/); if (m) { t = m[1]; s2 = m[2].trim(); } }
      return { t, link: g('link'), ts, src: s2, feed: src };
    }).filter((i) => i.t);
  } catch { return []; } finally { clearTimeout(t); }
}
const POS = /surge|soar|rall|gain|jump|rise|rises|record high|beat|strong|upgrade|bull|buy|inflow|boost|recover|higher|profit up|growth/i;
const NEG = /fall|falls|drop|slump|plunge|crash|decline|weak|miss|downgrade|bear|sell-off|selloff|outflow|loss|lower|cut|fear|concern|worr|tension|war|tariff hike/i;
// Merge the same story reported by several publishers (word overlap), keeping the earliest/most-detailed one
function normWords(t) { return new Set(String(t).toLowerCase().replace(/[^a-z0-9₹% ]/g, ' ').split(/\s+/).filter((w) => w.length > 3)); }
function mergeDupes(items) {
  const out = [];
  for (const it of items) {
    const w = normWords(it.t);
    const hit = out.find((o) => { let n = 0; w.forEach((x) => { if (o._w.has(x)) n++; }); return n >= 4 && n / Math.min(w.size, o._w.size) >= 0.6; });
    if (hit) { hit.n = (hit.n || 1) + 1; if (!hit.alsoBy.includes(it.src)) hit.alsoBy.push(it.src); if (Math.abs(it.s || 0) > Math.abs(hit.s || 0)) { hit.s = it.s; hit.imp = it.imp; } continue; }
    out.push({ ...it, n: 1, alsoBy: [], _w: w });
  }
  return out.map(({ _w, ...x }) => x);
}
function lexScore(t) { const p = POS.test(t), n = NEG.test(t); return p && !n ? 0.4 : n && !p ? -0.4 : 0; }

// सारी फ़ीड एक बार लाओ, 8 मिनट कैश (ख़बरें और नतीजे दोनों इसी से)
async function allFeeds(env) {
  const ck = 'feeds:all';
  const c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 8 * 60e3) { memSet(ck, c, 8 * 60e3); return c; }
  const all = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  const seen = new Set();
  const items = all.filter((i) => { const k = i.t.toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.ts - a.ts).slice(0, 200);
  const sources = {};
  all.forEach((i) => { sources[i.feed] = (sources[i.feed] || 0) + 1; });
  FEEDS.forEach(([n]) => { if (!(n in sources)) sources[n] = 0; });
  const res = { ts: Date.now(), items, sources };
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 3600 });
  memSet(ck, res, 8 * 60e3);
  return res;
}
function parseAIArray(out) { return JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)); }

async function news(env, idx) {
  const ck = 'news:' + idx;
  const c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 20 * 60e3) { memSet(ck, c, 10 * 60e3); return c; }
  const feed = await allFeeds(env);
  const items = feed.items.filter((i) => i.ts > Date.now() - 36 * 3600e3 && NEWS_KW[idx].test(i.t) && !RESULT_RE.test(i.t)).slice(0, 24);
  let scored = items.map((i) => ({ ...i, s: lexScore(i.t), imp: 'medium' }));
  let ai = false;
  if (hasAI(env) && items.length) {
    try {
      const name = { NIFTY: 'Nifty 50', SENSEX: 'Sensex', BANKNIFTY: 'Bank Nifty' }[idx];
      const prompt = `You are a markets analyst for Indian index options traders. For each headline below, rate its likely short-term (today/this week) impact on the ${name} index.
Return ONLY a JSON array, one object per headline, in the same order: {"i": index, "s": score from -1 (very bearish) to 1 (very bullish), "imp": "high" | "medium" | "low"}.
Headlines:
${items.map((x, i) => `${i}. ${x.t}`).join('\n')}`;
      const arr = parseAIArray(await aiText(env, prompt, 1500, 'bulk'));
      scored = items.map((x, i) => {
        const a = arr.find((z) => z.i === i) || {};
        return { ...x, s: typeof a.s === 'number' ? Math.max(-1, Math.min(1, a.s)) : lexScore(x.t), imp: a.imp || 'medium' };
      });
      ai = true;
    } catch (e) { /* AI फ़ेल हो तो शब्दों वाला सरल स्कोर */ }
  }
  // same story from several publishers = one item with a count (more sources, more confirmed)
  const res = { ts: Date.now(), ai, items: mergeDupes(scored), sources: feed.sources };
  // 7-day memory: headlines older than today's window are kept (with their score) for the dashboard's news pressure
  try {
    const mk = 'newsmem:' + idx, old = (await env.KV.get(mk, 'json')) || [], seen = new Set(), cut = Date.now() - 7 * 864e5;
    const all = [...res.items.map((x) => ({ t: x.t, s: x.s, imp: x.imp, ts: x.ts, src: x.src })), ...old]
      .filter((x) => { const k = String(x.t).toLowerCase().slice(0, 70); if (x.ts < cut || seen.has(k)) return false; seen.add(k); return true; })
      .sort((x, y) => y.ts - x.ts).slice(0, 150);
    await env.KV.put(mk, JSON.stringify(all), { expirationTtl: 8 * 86400 });
    const now = new Set(res.items.map((x) => String(x.t).toLowerCase().slice(0, 70)));
    res.mem = all.filter((x) => !now.has(String(x.t).toLowerCase().slice(0, 70)));
  } catch (e) { res.mem = []; }
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 3600 });
  memSet(ck, res, 10 * 60e3);
  return res;
}

// तिमाही नतीजे (Q1-Q4): पिछले 3 दिन की ख़बरों में से
async function results(env) {
  const ck = 'results:v1';
  const c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 30 * 60e3) { memSet(ck, c, 15 * 60e3); return c; }
  const feed = await allFeeds(env);
  const items = feed.items.filter((i) => i.ts > Date.now() - 72 * 3600e3 && RESULT_RE.test(i.t)).slice(0, 16);
  let out = items.map((i) => ({ ...i, co: '', q: (i.t.match(/\bQ[1-4](\s?FY\s?\d{2,4})?/i) || [''])[0].toUpperCase(), s: lexScore(i.t) }));
  let ai = false;
  if (hasAI(env) && items.length) {
    try {
      const prompt = `You read Indian company quarterly-results headlines for an index options trader.
Return ONLY a JSON array, one object per headline, same order: {"i": index, "co": company name (short, e.g. "HDFC Bank"), "q": quarter like "Q2 FY27" or "" if unknown, "s": -1 (clearly weak / missed) to 1 (clearly strong / beat)}.
Headlines:
${items.map((x, i) => `${i}. ${x.t}`).join('\n')}`;
      const arr = parseAIArray(await aiText(env, prompt, 1800, 'bulk'));
      out = out.map((x, i) => {
        const a = arr.find((z) => z.i === i) || {};
        return { ...x, co: a.co || '', q: a.q || x.q, s: typeof a.s === 'number' ? Math.max(-1, Math.min(1, a.s)) : x.s };
      });
      ai = true;
    } catch (e) { /* सरल स्कोर */ }
  }
  const res = { ts: Date.now(), ai, items: out };
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 3600 });
  memSet(ck, res, 15 * 60e3);
  return res;
}

async function ask(env, body) {
  if (!hasAI(env)) throw new HttpError(400, 'AI is off: add GEMINI_API_KEY or a Workers AI binding (AI) in the Worker', 'NO_AI');
  const q = String(body.question || '').slice(0, 500);
  const ctx = JSON.stringify(body.context || {}).slice(0, 40000);
  const hist = (Array.isArray(body.history) ? body.history : []).slice(-4)
    .map((h) => `User: ${String(h.q || '').slice(0, 300)}\nYou: ${String(h.a || '').slice(0, 600)}`).join('\n\n');
  const prompt = `You are an experienced Indian F&O, equity and MCX analyst built into the user's private trading dashboard.
Below is everything the dashboard is showing right now, as JSON: the indices and the user's watchlist (stocks, MCX futures), the selected instrument's signals, indicators, the last 12 candles, pivot/CPR/Fibonacci/volume-profile levels, the option chain around ATM, futures OI buildup, IV percentile, VIX/FII/heavyweights, global cues (GIFT Nifty, US, Asia, crude), the event calendar, official NSE/RBI/SEBI announcements, the 30-minute projection, the trade setup, alerts, news, quarterly results and the user's open paper positions.
${hist ? `\nEarlier conversation (for follow-ups):\n${hist}\n` : ''}
User's question (may be Hindi, Hinglish or English): "${q}"
Data: ${ctx}

Rules:
- Whatever the question, answer it directly from this data with the exact numbers. Do simple arithmetic from the data if needed.
- Use only the data above. Never invent prices, figures or news. If the answer is not in the data, say the dashboard doesn't have it.
- If marketOpenNow is false, say this is from the last session.
- For call/put or hold/exit questions: say whether signals favour or oppose it, the 2-3 most important reasons, the stop-loss and the biggest risk.
- Never promise an outcome. It is a probability; the final decision is the user's.
- Return ONLY JSON: {"en": "answer in clear English, 3-7 short sentences, no markdown or emoji", "hi": "the same answer in simple spoken Hindi (Devanagari), for text-to-speech"}`;
  const raw = await aiText(env, prompt, 1100, 'chat');
  let en = raw.trim(), hi = '';
  try { const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); en = String(j.en || '').trim() || en; hi = String(j.hi || '').trim(); } catch (e) { /* not JSON: show as-is */ }
  return { answer: en, speak: hi || en };
}

/* ---------------- Watchlist: instrument search, F&O check, futures, daily history ---------------- */
function normExp(e) {
  if (e == null || e === '') return null;
  if (typeof e === 'number') return ymd(new Date(e + 5.5 * 3600e3));
  return String(e).slice(0, 10);
}
const shortName = (s) => String(s || '').replace(/\b(LIMITED|LTD\.?|INDUSTRIES|CORPORATION|COMPANY)\b/gi, '').replace(/\s+/g, ' ').trim();
async function upSearch(env, params) {
  const qs = new URLSearchParams({ records: '30', page_number: '1', ...params });
  return (await up(env, '/v2/instruments/search?' + qs.toString())) || [];
}
// Search any instrument: stocks, indices, stock/index futures, MCX futures
async function search(env, q) {
  q = String(q || '').trim().slice(0, 40);
  if (q.length < 2) return { items: [] };
  const ck = 'search:' + q.toLowerCase();
  const c = memGet(ck); if (c) return c;
  const settle = (p) => p.catch((e) => { if (e.code === 'UPSTOX_LOGIN' || e.code === 'UPSTOX_TOKEN_BAD') throw e; return []; });
  const [broad, eq, fut, mcx] = await Promise.all([
    settle(upSearch(env, { query: q })),
    settle(upSearch(env, { query: q, exchanges: 'NSE,BSE', segments: 'EQ,INDEX' })),
    settle(upSearch(env, { query: q, exchanges: 'NSE,BSE', instrument_types: 'FUT' })),
    settle(upSearch(env, { query: q, exchanges: 'MCX', instrument_types: 'FUT' })),
  ]);
  const all = [...eq, ...broad, ...fut, ...mcx];
  const today = ymd(istNow()), seen = new Set(), out = [];
  const futs = all.filter((x) => String(x.instrument_type || '').toUpperCase() === 'FUT' && (normExp(x.expiry) || '9') >= today);
  for (const x of all) {
    const seg = String(x.segment || ''), it = String(x.instrument_type || '').toUpperCase();
    let item = null;
    if (/_EQ$/.test(seg) || /_INDEX$/.test(seg)) {
      const kind = /_INDEX$/.test(seg) ? 'INDEX' : 'EQ';
      if (kind === 'EQ' && it && !['EQ', 'BE', 'BZ', 'SM', 'ST'].includes(it)) continue; // skip bonds, ETFs etc. we can't trade options on
      const f = futs.filter((y) => y.underlying_key === x.instrument_key).sort((a, b) => (normExp(a.expiry) < normExp(b.expiry) ? -1 : 1))[0];
      const sym = String(x.trading_symbol || x.name || '').toUpperCase();
      item = { id: sym.replace(/[^A-Z0-9&]/g, '').slice(0, 20), label: kind === 'INDEX' ? String(x.name || sym) : sym, name: shortName(x.name || sym), key: x.instrument_key, ukey: x.instrument_key,
        exch: seg.startsWith('BSE') ? 'BSE' : 'NSE', kind, fo: !!f, lot: f ? f.lot_size : null, sym: f ? (f.underlying_symbol || sym) : sym, tick: x.tick_size || null };
    } else if (seg === 'MCX_FO' && it === 'FUT') {
      if ((normExp(x.expiry) || '0') < today) continue;
      const sym = String(x.underlying_symbol || String(x.trading_symbol || '').split(' ')[0]).toUpperCase();
      const nearest = futs.filter((y) => y.segment === 'MCX_FO' && String(y.underlying_symbol || String(y.trading_symbol || '').split(' ')[0]).toUpperCase() === sym)
        .sort((a, b) => (normExp(a.expiry) < normExp(b.expiry) ? -1 : 1))[0] || x;
      item = { id: sym.replace(/[^A-Z0-9]/g, '').slice(0, 20), label: sym + ' FUT', name: shortName(nearest.name || sym), key: nearest.instrument_key, ukey: null, exch: 'MCX', kind: 'FUT', fo: false,
        lot: nearest.lot_size || null, expiry: normExp(nearest.expiry), sym, tick: nearest.tick_size || null, tsym: nearest.trading_symbol };
    }
    if (!item || seen.has(item.kind + item.id)) continue;
    seen.add(item.kind + item.id); out.push(item);
  }
  // exact symbol matches first, then F&O names, then the rest
  const Q = q.toUpperCase().replace(/\s+/g, '');
  out.sort((a, b) => (b.id === Q) - (a.id === Q) || (b.fo || b.kind !== 'EQ') - (a.fo || a.kind !== 'EQ') || a.id.length - b.id.length);
  const res = { items: out.slice(0, 20) };
  memSet(ck, res, 10 * 60e3);
  return res;
}

// Does this underlying have options? Lot size and expiries from Upstox's contract list.
async function instInfo(env, ukey) {
  try {
    const c = await contracts(env, ukey);
    if (!c.expiries.length) return { fo: false };
    const e = pickExpiry(c);
    return { fo: true, lot: c.lots[e] || null, expiry: e, expiries: c.expiries.slice(0, 4) };
  } catch (e) { if (e.code === 'UPSTOX_LOGIN') throw e; return { fo: false }; }
}

// Nearest futures contract of an index / stock
async function futFor(env, ukey, sym, exch) {
  const today = ymd(istNow()), ck = 'fut:' + ukey + ':' + today;
  const c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c) { memSet(ck, c, 3600e3); return c.fkey ? c : null; }
  const list = await upSearch(env, { query: sym, exchanges: exch === 'BSE' ? 'BSE' : 'NSE', instrument_types: 'FUT' }).catch(() => []);
  const f = list.filter((x) => x.underlying_key === ukey && (normExp(x.expiry) || '0') >= today).sort((a, b) => (normExp(a.expiry) < normExp(b.expiry) ? -1 : 1))[0];
  const r = f ? { fkey: f.instrument_key, expiry: normExp(f.expiry), lot: f.lot_size || null } : { fkey: null };
  await env.KV.put(ck, JSON.stringify(r), { expirationTtl: 26 * 3600 });
  memSet(ck, r, 3600e3);
  return r.fkey ? r : null;
}
// Daily candles (about one year), cached for the day: HV, IV percentile (VIX), 52-week range, previous week
async function daily(env, key) {
  const today = ymd(istNow()), ck = 'daily:' + key + ':' + today;
  const c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c) { memSet(ck, c, 3600e3); return c; }
  const to = ymd(addDays(istNow(), -1)), from = ymd(addDays(istNow(), -380));
  const d = await upAny(env, [`/v3/historical-candle/${enc(key)}/days/1/${to}/${from}`, `/v2/historical-candle/${enc(key)}/day/${to}/${from}`]);
  const rows = (d && d.candles || []).map((x) => [String(x[0]).slice(0, 10), x[1], x[2], x[3], x[4], x[5] || 0, x[6] || 0])
    .filter((x) => x[0] < today).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-260);
  const res = { key, rows };
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 26 * 3600 });
  memSet(ck, res, 3600e3);
  return res;
}
// Futures: previous-day close and OI + today's 1-minute close/OI (for long/short buildup)
async function futData(env, ukey, sym, exch, sess) {
  const f = await futFor(env, ukey, sym, exch);
  if (!f) return { none: true };
  const ck = 'futd:' + f.fkey;
  const c = memGet(ck); if (c) return c;
  const today = ymd(istNow());
  let prev = null;
  try { const d = await daily(env, f.fkey); const l = d.rows[d.rows.length - 1]; if (l) prev = { date: l[0], close: l[4], oi: l[6] }; } catch (e) { if (e.code === 'UPSTOX_LOGIN') throw e; }
  let rows = [];
  try {
    const d = await upAny(env, [`/v3/historical-candle/intraday/${enc(f.fkey)}/minutes/1`, `/v2/historical-candle/intraday/${enc(f.fkey)}/1minute`]);
    const g = groupCandles(d && d.candles, sess).filter((x) => x.date === today)[0];
    rows = g ? g.c.map((x) => [x[0], x[4], x[6]]) : [];
  } catch (e) { if (e.code === 'UPSTOX_LOGIN') throw e; }
  const res = { fkey: f.fkey, expiry: f.expiry, lot: f.lot, prevClose: prev && prev.close, prevOi: prev && prev.oi, prevDate: prev && prev.date, c: rows.slice(-180) };
  memSet(ck, res, 45e3);
  return res;
}

/* ---------------- Global cues (Upstox global instruments: GIFT Nifty, Dow, S&P, Nikkei, Brent, USD/INR …) ---------------- */
const GLOBAL_FALLBACK = [
  { key: 'GLOBAL_INDEX|SGX NIFTY', name: 'GIFT NIFTY', seg: 'GLOBAL_INDEX' },
  { key: 'GLOBAL_INDICATOR|BZUSD', name: 'Oil (Brent)', seg: 'GLOBAL_INDICATOR' },
];
async function globalList(env) {
  const today = ymd(istNow()), ck = 'glist:' + today;
  const c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c) { memSet(ck, c, 6 * 3600e3); return c; }
  let list = null;
  try {
    const r = await fetch('https://assets.upstox.com/market-quote/instruments/exchange/global.json.gz');
    if (r.ok) {
      const buf = new Uint8Array(await r.arrayBuffer());
      let text;
      if (buf[0] === 0x1f && buf[1] === 0x8b) text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      else text = new TextDecoder().decode(buf);
      const arr = JSON.parse(text);
      list = (Array.isArray(arr) ? arr : []).filter((x) => x.instrument_key).slice(0, 40)
        .map((x) => ({ key: x.instrument_key, name: x.name || x.trading_symbol, sym: x.trading_symbol, seg: x.segment, country: x.country || '', latency: x.latency || '' }));
    }
  } catch (e) { list = null; }
  if (!list || !list.length) return GLOBAL_FALLBACK;
  await env.KV.put(ck, JSON.stringify(list), { expirationTtl: 26 * 3600 });
  memSet(ck, list, 6 * 3600e3);
  return list;
}
async function globalCues(env) {
  const c = memGet('global'); if (c) return c;
  const list = await globalList(env);
  let byKey = {};
  try { byKey = quoteMap(await up(env, '/v2/market-quote/quotes?instrument_key=' + list.map((x) => enc(x.key)).join(','))); }
  catch (e) { if (e.code === 'UPSTOX_LOGIN') throw e; }
  const items = list.map((x) => ({ ...x, ...(byKey[x.key] || {}) })).filter((x) => ok(x.price));
  const res = { ts: Date.now(), items };
  memSet('global', res, 20e3);
  return res;
}
/* ---------------- Pre-market checklist: world futures, Asia, commodities, currency, bonds, ADRs ----------------
   Yahoo Finance chart endpoint (free, no key). Each symbol fails on its own; the rest still show. */
const WORLD = [
  ['dowF', 'YM=F', 'Dow futures', 'us'], ['nasF', 'NQ=F', 'Nasdaq 100 futures', 'us'], ['spxF', 'ES=F', 'S&P 500 futures', 'us'],
  ['dow', '^DJI', 'Dow Jones', 'us'], ['nas', '^IXIC', 'Nasdaq Composite', 'us'], ['spx', '^GSPC', 'S&P 500', 'us'], ['usvix', '^VIX', 'US VIX (fear gauge)', 'us'],
  ['nikkei', '^N225', 'Nikkei 225 (Japan)', 'asia'], ['hsi', '^HSI', 'Hang Seng (Hong Kong)', 'asia'], ['kospi', '^KS11', 'Kospi (Korea)', 'asia'], ['sse', '000001.SS', 'Shanghai Composite', 'asia'],
  ['dax', '^GDAXI', 'DAX (Germany)', 'eu'], ['ftse', '^FTSE', 'FTSE 100 (UK)', 'eu'],
  ['brent', 'BZ=F', 'Brent crude', 'cmd'], ['wti', 'CL=F', 'WTI crude', 'cmd'], ['gold', 'GC=F', 'Gold', 'cmd'], ['silver', 'SI=F', 'Silver', 'cmd'], ['natgas', 'NG=F', 'Natural gas', 'cmd'],
  ['dxy', 'DX-Y.NYB', 'Dollar index (DXY)', 'fx'], ['us10y', '^TNX', 'US 10-year yield', 'fx'], ['usdinr', 'INR=X', 'USD / INR', 'fx'],
  ['infy', 'INFY', 'Infosys ADR', 'adr'], ['hdb', 'HDB', 'HDFC Bank ADR', 'adr'], ['ibn', 'IBN', 'ICICI Bank ADR', 'adr'], ['wit', 'WIT', 'Wipro ADR', 'adr'],
];
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
let YHOST = 'query1';
async function yahooQuote(sym, budget) {
  for (const host of [YHOST, YHOST === 'query1' ? 'query2' : 'query1']) {
    if (budget.n <= 0) return null;
    budget.n--;
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${enc(sym)}?interval=1d&range=5d`, { headers: { 'User-Agent': UA_BROWSER, Accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json(), res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res || !res.meta) continue;
      const m = res.meta, price = m.regularMarketPrice, ts = (m.regularMarketTime || 0) * 1000;
      const t = res.timestamp || [], cl = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
      const rows = t.map((x, i) => [x * 1000, cl[i]]).filter((x) => ok(x[1]));
      // previous close = the last daily close that belongs to an earlier day than the latest quote
      const day = (ms) => new Date(ms + (m.gmtoffset || 0) * 1000).toISOString().slice(0, 10);
      const before = rows.filter((x) => day(x[0]) < day(ts || x[0]));
      const prev = before.length ? before[before.length - 1][1] : ok(m.previousClose) ? m.previousClose : m.chartPreviousClose;
      if (!ok(price) || !ok(prev) || !prev) continue;
      YHOST = host;
      return { price, prevClose: prev, chg: ((price - prev) / prev) * 100, ts, state: m.marketState || '' };
    } catch (e) { /* try the other host */ }
  }
  return null;
}
async function nseCookie() {
  const h = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA_BROWSER, Accept: 'text/html' } });
  return (h.headers.getSetCookie ? h.headers.getSetCookie() : [h.headers.get('set-cookie') || '']).map((x) => x.split(';')[0]).filter(Boolean).join('; ');
}
// GIFT Nifty and the pre-open indicative Nifty, from NSE's market-status feed (best effort: NSE sometimes blocks cloud servers)
async function giftNifty() {
  try {
    const ck = await nseCookie();
    const r = await fetch('https://www.nseindia.com/api/marketStatus', { headers: { 'User-Agent': UA_BROWSER, Accept: 'application/json', Referer: 'https://www.nseindia.com/', Cookie: ck } });
    if (!r.ok) return null;
    const j = await r.json(), g = j && j.giftnifty, ind = j && j.indicativenifty50;
    const out = {};
    if (g && ok(+g.LASTPRICE)) out.gift = { price: +g.LASTPRICE, chg: ok(+g.PERCHANGE) ? +g.PERCHANGE : null, pts: ok(+g.DAYCHANGE) ? +g.DAYCHANGE : null, ts: g.TIMESTMP || '', expiry: g.EXPIRYDATE || '' };
    if (ind && ok(+ind.closingValue || +ind.finalClosingValue)) out.ind = { price: +(ind.finalClosingValue || ind.closingValue), chg: ok(+ind.perChange) ? +ind.perChange : null, pts: ok(+ind.change) ? +ind.change : null, ts: ind.dateTime || '' };
    return out.gift || out.ind ? out : null;
  } catch (e) { return null; }
}
async function world(env) {
  return shared('world', 60e3, async () => {
    const items = [], budget = { n: 40 }; // stays under the free plan's 50 subrequests per call
    for (let i = 0; i < WORLD.length; i += 7) {
      const part = await Promise.all(WORLD.slice(i, i + 7).map(async ([id, sym, name, grp]) => { const q = await yahooQuote(sym, budget); return q ? { id, sym, name, grp, src: 'Yahoo', ...q } : null; }));
      part.forEach((x) => x && items.push(x));
    }
    const g = await giftNifty();
    if (g && g.gift) items.unshift({ id: 'gift', sym: 'GIFT NIFTY', name: 'GIFT Nifty', grp: 'india', src: 'NSE IX', price: g.gift.price, chg: g.gift.chg, pts: g.gift.pts, ts: Date.now(), tsText: g.gift.ts, expiry: g.gift.expiry });
    if (g && g.ind) items.push({ id: 'indicative', sym: 'NIFTY PRE-OPEN', name: 'Nifty pre-open (indicative)', grp: 'india', src: 'NSE', price: g.ind.price, chg: g.ind.chg, pts: g.ind.pts, ts: Date.now(), tsText: g.ind.ts });
    const res = { ts: Date.now(), items, missing: WORLD.filter(([id]) => !items.some((x) => x.id === id)).map((x) => x[2]) };
    if (items.length) await kvKeep(env, 'world:last', res, 600e3);
    else { const last = await env.KV.get('world:last', 'json'); if (last) return { ...last, stale: true }; }
    return res;
  });
}
// KV write at most once per `every` ms (free plan: 1000 writes a day)
const KVW = {};
async function kvKeep(env, key, val, every) { const now = Date.now(); if (KVW[key] && now - KVW[key] < every) return; KVW[key] = now; try { await env.KV.put(key, JSON.stringify(val), { expirationTtl: 7 * 86400 }); } catch (e) { /* ignore */ } }

/* FII / Pro / Client positions in index futures and options (NSE daily archive, published around 7 pm) */
function parseParticipant(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hi = lines.findIndex((l) => /^"?Client Type/i.test(l)); if (hi < 0) return null;
  const cells = (l) => l.split(',').map((c) => c.replace(/"/g, '').replace(/\t/g, '').trim());
  const head = cells(lines[hi]).map((h) => h.toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const C = { fl: col(/future index long/), fs: col(/future index short/), cl: col(/option index call long/), pl: col(/option index put long/), cs: col(/option index call short/), ps: col(/option index put short/) };
  if (C.fl < 0 || C.fs < 0) return null;
  const out = {};
  lines.slice(hi + 1).forEach((l) => { const c = cells(l), who = (c[0] || '').toUpperCase(); if (!/^(CLIENT|DII|FII|PRO|TOTAL)$/.test(who)) return; const n = (i) => (i >= 0 ? +c[i] || 0 : null); out[who] = { futL: n(C.fl), futS: n(C.fs), callL: n(C.cl), putL: n(C.pl), callS: n(C.cs), putS: n(C.ps) }; });
  const asOf = (lines[0].match(/as on\s+([A-Za-z]{3}\s+\d{1,2},?\s+\d{4})/i) || [])[1] || '';
  return out.FII ? { asOf, p: out } : null;
}
async function participantOI(env) {
  const c = memGet('part'); if (c) return c;
  const n = istNow(), got = [];
  for (let i = 0; i < 10 && got.length < 2; i++) {
    const d = new Date(n.getTime() - i * 864e5), wd = d.getUTCDay(); if (wd === 0 || wd === 6) continue;
    if (i === 0 && n.getUTCHours() * 60 + n.getUTCMinutes() < 18 * 60 + 30) continue; // today's file comes in the evening
    const dd = String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0') + d.getUTCFullYear();
    const ck = 'part:' + dd, kv = await env.KV.get(ck, 'json');
    if (kv) { got.push({ date: ymd(d), ...kv }); continue; }
    try {
      const r = await fetch(`https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${dd}.csv`, { headers: { 'User-Agent': UA_BROWSER, Accept: 'text/csv,*/*' } });
      if (!r.ok) continue;
      const p = parseParticipant(await r.text()); if (!p) continue;
      await env.KV.put(ck, JSON.stringify(p), { expirationTtl: 15 * 86400 });
      got.push({ date: ymd(d), ...p });
    } catch (e) { /* skip that day */ }
  }
  const res = got.length ? { ts: Date.now(), latest: got[0], prev: got[1] || null, src: 'NSE participant-wise OI' } : { none: true };
  memSet('part', res, got.length ? 3600e3 : 600e3);
  return res;
}

/* ---------------- Economic calendar ---------------- */
// RBI MPC FY2026-27 (RBI press release, 23 Mar 2026). Decision on the last day, 10:00 IST.
const MPC = ['2026-04-08', '2026-06-05', '2026-08-05', '2026-10-07', '2026-12-04', '2027-02-05'];
// US FOMC 2026 decisions: 2:00 pm New York = 00:30 / 23:30 IST next day
const FOMC = ['2026-01-29', '2026-03-19', '2026-04-30', '2026-06-18', '2026-07-30', '2026-09-17', '2026-10-29', '2026-12-10'];
async function calendar(env) {
  const c = memGet('cal'); if (c) return c;
  const ev = [];
  MPC.forEach((d) => ev.push({ date: d, time: '10:00', t: 'RBI monetary policy decision', ctry: 'IN', imp: 'high', src: 'RBI' }));
  FOMC.forEach((d) => ev.push({ date: d, time: '00:30', t: 'US Fed (FOMC) rate decision', ctry: 'US', imp: 'high', src: 'Federal Reserve' }));
  // India CPI: MoSPI publishes on the 12th at 16:00
  const n = istNow();
  for (let i = 0; i < 2; i++) { const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + i, 12)); ev.push({ date: ymd(d), time: '16:00', t: 'India CPI inflation (MoSPI, usual date)', ctry: 'IN', imp: 'medium', src: 'MoSPI' }); }
  let ff = 0;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (FnO Dashboard)' } });
    clearTimeout(tm);
    if (r.ok) {
      const arr = await r.json();
      for (const x of arr || []) {
        if (!/high/i.test(x.impact || '') || !['USD', 'CNY', 'EUR', 'JPY', 'INR'].includes(x.country)) continue;
        const t = Date.parse(x.date); if (!t) continue;
        const ist = new Date(t + 5.5 * 3600e3);
        ev.push({ date: ymd(ist), time: ist.toISOString().slice(11, 16), t: `${x.country}: ${x.title}`, ctry: x.country, imp: 'high', src: 'ForexFactory', fc: x.forecast || '', pv: x.previous || '' });
        ff++;
      }
    }
  } catch (e) { /* calendar feed unavailable: keep the fixed events */ }
  const today = ymd(istNow()), until = ymd(addDays(istNow(), 10));
  const items = ev.filter((x) => x.date >= today && x.date <= until).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  const res = { ts: Date.now(), items, sources: { 'RBI (fixed dates)': 1, 'Fed (fixed dates)': 1, ForexFactory: ff } };
  memSet('cal', res, (ff ? 3 : 0.5) * 3600e3);
  return res;
}

/* ---------------- FII / DII cash (NSE, best effort) ---------------- */
async function fiiDii(env) {
  const c = memGet('fiidii'); if (c) return c;
  let res = null;
  try {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const h = await fetch('https://www.nseindia.com/reports/fii-dii', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    const ck = (h.headers.getSetCookie ? h.headers.getSetCookie() : [h.headers.get('set-cookie') || '']).map((x) => x.split(';')[0]).filter(Boolean).join('; ');
    const r = await fetch('https://www.nseindia.com/api/fiidiiTradeReact', { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.nseindia.com/reports/fii-dii', Cookie: ck } });
    if (r.ok) {
      const arr = await r.json();
      const pick = (re) => (arr || []).find((x) => re.test(x.category || ''));
      const f = pick(/FII|FPI/i), d = pick(/DII/i);
      if (f && d) res = { fii: +f.netValue, dii: +d.netValue, date: f.date || d.date, src: 'NSE', ts: Date.now() };
    }
  } catch (e) { /* NSE often blocks cloud servers */ }
  if (res && ok(res.fii)) { await env.KV.put('fiidii:last', JSON.stringify(res), { expirationTtl: 7 * 86400 }); memSet('fiidii', res, 30 * 60e3); return res; }
  const last = await env.KV.get('fiidii:last', 'json');
  const out = last ? { ...last, stale: true } : { none: true };
  memSet('fiidii', out, 10 * 60e3);
  return out;
}

/* ---------------- Official sources: NSE announcements, RBI, SEBI ---------------- */
const OFFICIAL = [
  ['NSE announcements', 'https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml'],
  ['BSE announcements', 'https://www.bseindia.com/data/xml/announcements.aspx'],
  ['BSE results', 'https://www.bseindia.com/Data/XML/FinancialResultsFeed.aspx'],
  ['BSE notices', 'https://www.bseindia.com/data/xml/notices.xml'],
  ['RBI press releases', 'https://rbi.org.in/pressreleases_rss.xml'],
  ['RBI notifications', 'https://rbi.org.in/notifications_rss.xml'],
  ['SEBI', 'https://www.sebi.gov.in/sebirss.xml'],
  ['PIB', 'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3'],
];
// Exchange notices and government releases are noisy: keep only what can move prices
const BSE_NOTICE_KEEP = /derivativ|f&o|futures|options|lot size|index|sensex|bankex|expiry|circuit|price band|surveillance|asm|gsm|trading holiday|market timing|settlement|margin|suspension|delist/i;
const PIB_KEEP = /\b(gdp|inflation|cpi|wpi|iip|budget|fiscal|tax|gst|customs|excise|rbi|monetary|economy|economic|trade deficit|exports?|imports?|disinvest|ipo|sebi|bank|insurance|pli|capex|core sector|fdi|rupee|petroleum|crude|coal|power|steel|telecom|railway)\b/i;
const OFF_HIGH = /result|dividend|buy ?back|bonus|split|acquisition|amalgamation|merger|order (win|received|worth)|credit rating|default|penalty|investigation|fraud|repo rate|monetary policy|crr|slr|gdp|budget|ban|suspend/i;
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseDateIST(s) {
  const m = String(s || '').match(/(\d{1,2})[- ](\w{3})[a-z]*[- ,]+(\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/i);
  if (m && MON[m[2].toLowerCase()] != null && !/GMT|\+\d{4}|UTC/.test(s)) return Date.UTC(+m[3], MON[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0)) - 5.5 * 3600e3;
  return Date.parse(s) || null;
}
const ANN_KEEP = /result|board meeting|dividend|buy ?back|bonus|split|acquisition|amalgamation|merger|order|credit rating|outcome|fund raising|qip|resignation|appointment of (md|ceo|managing)|pledge|insider|default|investigation|penalty|litigation|guidance|update/i;
const ANN_DROP = /net asset value|\bnav\b|mutual fund|\betf\b|newspaper publication|trading window|loss of share|duplicate share|recording|transcript|74\s*\(5\)|certificate/i;
async function official(env) {
  const c = memGet('official'); if (c) return c;
  const out = [], sources = {};
  await Promise.all(OFFICIAL.map(async ([src, url]) => {
    let n = 0;
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (FnO Dashboard)', Accept: 'application/rss+xml, application/xml, text/xml' } });
      clearTimeout(tm);
      if (r.ok) {
        const x = await r.text();
        for (const it of x.split(/<item[\s>]/i).slice(1, 80)) {
          const g = (tag) => { const m = it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')); return m ? xmlText(m[1]) : ''; };
          const title = g('title'), desc = g('description'), ts = parseDateIST(g('pubDate')) || Date.now();
          if (!title) continue;
          let t = title, co = '', sub = '';
          if (src === 'NSE announcements') {
            sub = (desc.split('|SUBJECT:')[1] || '').trim();
            const body = desc.split('|SUBJECT:')[0].replace(/has informed the Exchange (about|that)?/i, '').trim();
            if (ANN_DROP.test(desc + ' ' + title) || !ANN_KEEP.test(sub + ' ' + body)) continue;
            co = title; t = sub ? `${sub}: ${body}`.slice(0, 220) : body.slice(0, 220);
          } else if (src === 'BSE announcements' || src === 'BSE results') {
            // BSE titles look like "Company Ltd - 500325 - Subject"
            const parts = title.split(/\s+-\s+/);
            co = parts.length > 1 ? parts[0].trim() : ''; t = (parts.length > 2 ? parts.slice(2).join(' - ') : parts.slice(1).join(' - ') || title).trim();
            if (desc && desc.length > t.length && desc.length < 260) t = desc;
            if (src === 'BSE announcements' && (ANN_DROP.test(title + ' ' + desc) || !ANN_KEEP.test(title + ' ' + desc))) continue;
          } else if (src === 'BSE notices') {
            if (!BSE_NOTICE_KEEP.test(title + ' ' + desc)) continue;
          } else if (src === 'PIB') {
            if (!PIB_KEEP.test(title + ' ' + desc)) continue;
          }
          const s0 = lexScore(t);
          out.push({ t, co, sub, src, link: g('link'), ts, s: s0, imp: OFF_HIGH.test(t + ' ' + sub) ? 'high' : 'medium' }); n++;
        }
      }
    } catch (e) { /* source unreachable */ }
    sources[src] = n;
  }));
  out.sort((a, b) => b.ts - a.ts);
  const res = { ts: Date.now(), items: mergeDupes(out).slice(0, 120), sources };
  memSet('official', res, 10 * 60e3);
  return res;
}

/* ---------------- Geopolitical risk (GDELT, free, no key) ----------------
   Headlines from trusted outlets about wars, sanctions, tariffs and oil chokepoints, plus how loud that news is
   right now versus the last 3 days. GDELT allows one request every 5 seconds, so the two calls are spaced out
   and the result is cached for 30 minutes. */
const GEO_Q = '(iran OR israel OR "middle east" OR hormuz OR "red sea" OR missile OR airstrike OR sanctions OR tariff OR "trade war" OR ukraine OR taiwan OR "india pakistan" OR "border clash" OR opec) sourcelang:english';
const GEO_TRUST = /(^|\.)(reuters\.com|apnews\.com|bbc\.(co\.uk|com)|aljazeera\.com|bloomberg\.com|cnbc\.com|ft\.com|wsj\.com|nytimes\.com|theguardian\.com|dw\.com|france24\.com|thehindu\.com|ndtv\.com|indianexpress\.com|hindustantimes\.com|economictimes\.indiatimes\.com|livemint\.com|business-standard\.com|timesofindia\.indiatimes\.com|cnn\.com|washingtonpost\.com|politico\.com|nikkei\.com|scmp\.com)$/i;
function gdeltDate(s) { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; }
async function gdelt(params) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch('https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({ query: GEO_Q, format: 'json', ...params }), { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (FnO Dashboard)' } });
    if (!r.ok) return null;
    const t = await r.text(); try { return JSON.parse(t); } catch (e) { return null; }
  } finally { clearTimeout(tm); }
}
async function geoRisk(env) {
  const c = memGet('geo'); if (c) return c;
  let items = [], ratio = null;
  try {
    const a = await gdelt({ mode: 'artlist', maxrecords: '75', timespan: '12h', sort: 'hybridrel' });
    items = ((a && a.articles) || []).filter((x) => GEO_TRUST.test(x.domain || '')).map((x) => ({ t: String(x.title || '').trim(), src: x.domain, link: x.url, ts: gdeltDate(x.seendate) || Date.now() })).filter((x) => x.t);
    items = mergeDupes(items).slice(0, 12);
  } catch (e) { /* GDELT unreachable */ }
  try {
    await new Promise((res) => setTimeout(res, 5500)); // GDELT: one request every 5 seconds
    const v = await gdelt({ mode: 'timelinevol', timespan: '3d' });
    const pts = ((v && v.timeline && v.timeline[0] && v.timeline[0].data) || []).map((x) => +x.value).filter((x) => isFinite(x));
    if (pts.length > 24) {
      const recent = pts.slice(-24), avg = (z) => z.reduce((p, q) => p + q, 0) / z.length; // last ~6 h of 15-min points vs 3 days
      const base = avg(pts); ratio = base > 0 ? avg(recent) / base : null;
    }
  } catch (e) { /* volume optional */ }
  // GDELT often refuses cloud servers: fall back to world headlines via Google News. Short queries (one long query with
  // many site: filters came back empty), then keep only trusted publishers by the name Google appends to each title.
  let via = 'GDELT';
  if (!items.length) {
    const TRUST = /reuters|associated press|ap news|bbc|al jazeera|cnbc|bloomberg|financial times|economic times|mint|business standard|the hindu|hindustan times|ndtv|indian express|wion|times of india|cnn|guardian|wall street journal|nikkei|dw/i;
    const Q = ['(Iran OR Israel OR Gaza OR "Middle East" OR Hormuz OR Houthi) when:1d', '(Russia OR Ukraine OR NATO OR China OR Taiwan OR Pakistan) (war OR attack OR missile OR talks OR sanctions OR border) when:1d', '(sanctions OR tariff OR ceasefire OR "peace deal" OR "trade deal" OR OPEC OR "oil supply") when:1d'];
    const got = await Promise.all(Q.map((q) => fetchFeed(gnews(q)).catch(() => [])));
    let g = got.flat().filter((x) => TRUST.test(x.src || '') && x.ts > Date.now() - 24 * 3600e3);
    if (!g.length) { try { const f = await allFeeds(env); g = f.items.filter((x) => /\b(Iran|Israel|Gaza|Russia|Ukraine|China|Taiwan|Pakistan|war|missile|sanction|tariff|ceasefire|OPEC|Hormuz)\b/i.test(x.t) && x.ts > Date.now() - 24 * 3600e3); } catch (e) { /* none */ } }
    items = mergeDupes(g.sort((x, y) => y.ts - x.ts)).slice(0, 12).map((x) => ({ t: x.t, src: x.src, link: x.link, ts: x.ts }));
    via = 'Google News, trusted outlets';
  }
  const ESC = /\b(war|attack|strike[sd]?|missile|drone|bomb|killed|clash|escalat|sanction|tariff|threat|invasion|retaliat|blockade|tension)/i, DEESC = /\b(deal|ceasefire|truce|talks|agreement|accord|peace|de-escalat|eases?|lifts? sanctions|signs?)\b/i;
  const esc = items.filter((x) => ESC.test(x.t) && !DEESC.test(x.t)).length, calm = items.filter((x) => DEESC.test(x.t)).length;
  items = items.map((x) => ({ ...x, tone: ESC.test(x.t) && !DEESC.test(x.t) ? 'risk' : DEESC.test(x.t) ? 'calm' : '' }));
  const level = ok(ratio) ? (ratio >= 2 ? 'High' : ratio >= 1.4 ? 'Elevated' : ratio <= 0.7 ? 'Low' : 'Normal')
    : !items.length ? 'Unknown' : esc >= 7 ? 'High' : esc >= 4 && esc > calm ? 'Elevated' : calm > esc ? 'Easing' : 'Normal';
  const res = { ts: Date.now(), level, ratio, items, via, esc, calm };
  memSet('geo', res, (items.length ? 30 : 5) * 60e3);
  return res;
}

/* ---------------- Company news for a watchlist stock / commodity ---------------- */
async function newsFor(env, id, name) {
  name = String(name || id).replace(/[^\w &.-]/g, '').trim().slice(0, 40);
  const ck = 'wnews:' + id;
  const c = memGet(ck) || (await env.KV.get(ck, 'json').catch(() => null)); if (c && c.ts > Date.now() - 30 * 60e3) { memSet(ck, c, 15 * 60e3); return c; }
  const words = name.split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|ltd|limited|bank|india|fut)$/i.test(w));
  const re = new RegExp('\\b(' + [id, ...words.slice(0, 2)].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');
  // company news only from trusted publishers (no random websites)
  const TRUSTED = ['economictimes.indiatimes.com', 'business-standard.com', 'livemint.com', 'moneycontrol.com', 'thehindubusinessline.com', 'cnbctv18.com', 'reuters.com', 'bloomberg.com'];
  const g = await fetchFeed(['Google News', `https://news.google.com/rss/search?q=${enc('"' + name + '"')}+(${TRUSTED.map((d) => 'site:' + d).join('+OR+')})+when:7d&hl=en-IN&gl=IN&ceid=IN:en`]);
  const feed = await allFeeds(env);
  const seen = new Set();
  const items = [...g, ...feed.items.filter((i) => re.test(i.t))]
    .filter((i) => { const k = i.t.toLowerCase().slice(0, 80); if (seen.has(k) || i.ts < Date.now() - 7 * 864e5) return false; seen.add(k); return true; })
    .sort((a, b) => b.ts - a.ts).slice(0, 16);
  let scored = items.map((i) => ({ ...i, s: lexScore(i.t), imp: 'medium' })), ai = false;
  if (hasAI(env) && items.length) {
    try {
      const prompt = `You are a markets analyst. For each headline, rate its likely short-term (today/this week) impact on ${name} (${id}) price.
Return ONLY a JSON array, same order: {"i": index, "s": -1 (very bearish) to 1 (very bullish), "imp": "high" | "medium" | "low"}. Use 0 if the headline is not really about ${name}.
Headlines:
${items.map((x, i) => `${i}. ${x.t}`).join('\n')}`;
      const arr = parseAIArray(await aiText(env, prompt, 1200, 'bulk'));
      scored = items.map((x, i) => { const a = arr.find((z) => z.i === i) || {}; return { ...x, s: typeof a.s === 'number' ? Math.max(-1, Math.min(1, a.s)) : lexScore(x.t), imp: a.imp || 'medium' }; });
      ai = true;
    } catch (e) { /* keyword score */ }
  }
  const res = { ts: Date.now(), ai, items: mergeDupes(scored), sources: { 'Trusted publishers (Google News)': g.length, 'Market feeds': items.length - g.length } };
  memSet(ck, res, 15 * 60e3);
  try { await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 3600 }); } catch (e) { /* cache only */ }
  return res;
}

/* ---------------- Market map: index constituents, weights, live moves, sectors ----------------
   Constituents and ISINs: NSE index files (free archive). Weights: NSE free-float market cap when NSE answers
   (saved daily in KV), else the last saved weights, else approximate ones. Prices: one Upstox quote call. */
const MAP_IDX = {
  NIFTY50: { file: 'ind_nifty50list.csv', nse: 'NIFTY 50', key: 'NSE_INDEX|Nifty 50', label: 'Nifty 50' },
  BANKNIFTY: { file: 'ind_niftybanklist.csv', nse: 'NIFTY BANK', key: 'NSE_INDEX|Nifty Bank', label: 'Bank Nifty' },
  NIFTYIT: { file: 'ind_niftyitlist.csv', nse: 'NIFTY IT', key: 'NSE_INDEX|Nifty IT', label: 'Nifty IT' },
  NIFTYNEXT50: { file: 'ind_niftynext50list.csv', nse: 'NIFTY NEXT 50', key: 'NSE_INDEX|Nifty Next 50', label: 'Nifty Next 50' },
  FINNIFTY: { file: 'ind_niftyfinancelist.csv', nse: 'NIFTY FINANCIAL SERVICES', key: 'NSE_INDEX|Nifty Fin Service', label: 'Fin Nifty' },
  MIDCPNIFTY: { file: 'ind_niftymidcapselect_list.csv', nse: 'NIFTY MIDCAP SELECT', key: 'NSE_INDEX|NIFTY MID SELECT', label: 'Midcap Select' },
  NIFTYAUTO: { file: 'ind_niftyautolist.csv', nse: 'NIFTY AUTO', key: 'NSE_INDEX|Nifty Auto', label: 'Nifty Auto' },
  NIFTYPHARMA: { file: 'ind_niftypharmalist.csv', nse: 'NIFTY PHARMA', key: 'NSE_INDEX|Nifty Pharma', label: 'Nifty Pharma' },
  NIFTYFMCG: { file: 'ind_niftyfmcglist.csv', nse: 'NIFTY FMCG', key: 'NSE_INDEX|Nifty FMCG', label: 'Nifty FMCG' },
  NIFTYMETAL: { file: 'ind_niftymetallist.csv', nse: 'NIFTY METAL', key: 'NSE_INDEX|Nifty Metal', label: 'Nifty Metal' },
  NIFTYENERGY: { file: 'ind_niftyenergylist.csv', nse: 'NIFTY ENERGY', key: 'NSE_INDEX|Nifty Energy', label: 'Nifty Energy' },
  NIFTYPSUBANK: { file: 'ind_niftypsubanklist.csv', nse: 'NIFTY PSU BANK', key: 'NSE_INDEX|Nifty PSU Bank', label: 'PSU Bank' },
  NIFTYREALTY: { file: 'ind_niftyrealtylist.csv', nse: 'NIFTY REALTY', key: 'NSE_INDEX|Nifty Realty', label: 'Nifty Realty' },
  // Sensex: BSE publishes no free constituents file. Its 30 members are all Nifty 50 stocks, so the list is taken from
  // the Nifty 50 file (for ISINs) and weighted by the same NSE free-float market caps. Membership changes twice a year.
  SENSEX: { from: 'NIFTY50', key: 'BSE_INDEX|SENSEX', label: 'Sensex', members: ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'BHARTIARTL', 'LT', 'ITC', 'TCS', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'M&M', 'BAJFINANCE', 'HINDUNILVR', 'SUNPHARMA', 'MARUTI', 'HCLTECH', 'NTPC', 'TITAN', 'ULTRACEMCO', 'TATASTEEL', 'POWERGRID', 'ASIANPAINT', 'BAJAJFINSV', 'ADANIPORTS', 'TECHM', 'ETERNAL', 'BEL', 'TRENT', 'TMPV', 'TATAMOTORS'] },
  // all F&O stocks: no index to add points to, so boxes are sized by today's traded value
  FNO: { fno: true, label: 'F&O Stocks' },
};
const SECTORS = [['Bank', 'NSE_INDEX|Nifty Bank'], ['IT', 'NSE_INDEX|Nifty IT'], ['Auto', 'NSE_INDEX|Nifty Auto'], ['FMCG', 'NSE_INDEX|Nifty FMCG'], ['Metal', 'NSE_INDEX|Nifty Metal'],
  ['Pharma', 'NSE_INDEX|Nifty Pharma'], ['Energy', 'NSE_INDEX|Nifty Energy'], ['Realty', 'NSE_INDEX|Nifty Realty'], ['PSU Bank', 'NSE_INDEX|Nifty PSU Bank'], ['Fin Services', 'NSE_INDEX|Nifty Fin Service'],
  ['Private Bank', 'NSE_INDEX|Nifty Pvt Bank'], ['Media', 'NSE_INDEX|Nifty Media'], ['Infra', 'NSE_INDEX|Nifty Infra']];
let SECT_OK = null; // the sector keys Upstox accepted last time
// approximate Nifty 50 weights (%) used only until NSE's free-float market caps have been fetched once
const W_APPROX = { HDFCBANK: 12.5, ICICIBANK: 8.9, RELIANCE: 8.4, INFY: 4.8, BHARTIARTL: 4.7, LT: 3.9, ITC: 3.3, SBIN: 3.2, TCS: 3.0, AXISBANK: 3.0, KOTAKBANK: 2.8, 'M&M': 2.6, BAJFINANCE: 2.3,
  HINDUNILVR: 2.0, ETERNAL: 1.6, SUNPHARMA: 1.6, MARUTI: 1.6, HCLTECH: 1.5, NTPC: 1.4, TITAN: 1.3, ULTRACEMCO: 1.3, TATAMOTORS: 1.2, TATASTEEL: 1.2, BEL: 1.2, POWERGRID: 1.1, ASIANPAINT: 1.0 };
function csvRows(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  const cells = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const head = cells(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => { const c = cells(l), o = {}; head.forEach((h, i) => (o[h] = c[i])); return o; });
}
async function constituents(env, idx) {
  const M = MAP_IDX[idx]; if (!M) throw new HttpError(400, 'Unknown index');
  if (M.from) { const base = await constituents(env, M.from), set = new Set(M.members); return { ts: base.ts, items: base.items.filter((x) => set.has(x.sym)), approx: true }; }
  if (M.fno) { const u = await universe(env); return { ts: u.ts, items: u.items.map((x) => ({ sym: x.sym, name: x.name, sector: '', isin: x.isin, lot: x.lot })) }; }
  const ck = 'cons:' + idx, c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 7 * 864e5) { memSet(ck, c, 6 * 3600e3); return c; }
  try {
    const r = await fetch('https://nsearchives.nseindia.com/content/indices/' + M.file, { headers: { 'User-Agent': UA_BROWSER, Accept: 'text/csv,*/*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const items = csvRows(await r.text()).map((o) => ({ sym: o.symbol, name: o['company name'], sector: o.industry, isin: o['isin code'] })).filter((x) => x.sym && /^IN[A-Z0-9]{10}$/.test(x.isin || ''));
    if (items.length < 5) throw new Error('empty list');
    const res = { ts: Date.now(), items };
    await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 30 * 86400 }); memSet(ck, res, 6 * 3600e3);
    return res;
  } catch (e) { if (c) return c; throw new HttpError(502, 'Could not load the index constituents from NSE: ' + e.message); }
}
async function nseWeights(env, idx) {
  const M = MAP_IDX[idx];
  if (M.fno) return { w: null, src: 'traded value' };
  if (M.from) { const b = await nseWeights(env, M.from); return b && b.w ? { ...b, src: b.src + ', re-scaled to Sensex members' } : b; }
  const ck = 'w:' + idx, mk = memGet(ck); if (mk) return mk;
  const saved = await env.KV.get(ck, 'json');
  if (saved && saved.day === ymd(istNow())) { memSet(ck, saved, 3600e3); return saved; }
  try {
    const cookie = await nseCookie();
    const r = await fetch('https://www.nseindia.com/api/equity-stockIndices?index=' + encodeURIComponent(M.nse), { headers: { 'User-Agent': UA_BROWSER, Accept: 'application/json', Referer: 'https://www.nseindia.com/', Cookie: cookie } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), w = {};
    (j.data || []).forEach((x) => { if (x.symbol && x.symbol !== M.nse && ok(+x.ffmc) && +x.ffmc > 0) w[x.symbol] = +x.ffmc; });
    const tot = Object.values(w).reduce((a, b) => a + b, 0);
    if (!tot) throw new Error('no ffmc');
    for (const k in w) w[k] = (w[k] / tot) * 100;
    const res = { day: ymd(istNow()), src: 'NSE free-float market cap', w };
    await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 60 * 86400 }); memSet(ck, res, 3600e3);
    return res;
  } catch (e) {
    const res = saved ? { ...saved, src: saved.src + ' (saved ' + saved.day + ')' } : null;
    memSet(ck, res || { w: null }, 30 * 60e3); return res || { w: null };
  }
}
async function marketMap(env, idx) {
  return shared('map:' + idx, 20000, async () => {
    const M = MAP_IDX[idx]; if (!M) throw new HttpError(400, 'Unknown index');
    const [cons, W] = await Promise.all([constituents(env, idx), nseWeights(env, idx)]);
    const keys = cons.items.map((x) => 'NSE_EQ|' + x.isin), q = {};
    for (let i = 0; i < keys.length; i += 250) Object.assign(q, quoteMap(await up(env, '/v2/market-quote/quotes?instrument_key=' + keys.slice(i, i + 250).map(enc).join(','))));
    // the index quote on its own, so one unknown index key can't break the whole map
    if (M.key) { try { Object.assign(q, quoteMap(await up(env, '/v2/market-quote/quotes?instrument_key=' + enc(M.key)))); } catch (e) { if (e.code === 'UPSTOX_LOGIN') throw e; } }
    const ix = M.key ? q[M.key] : null;
    // sector indices in a separate call: if Upstox rejects one key, fall back to the core set instead of losing the map
    const sq = await shared('sectq', 30000, async () => {
      for (const list of [SECT_OK || SECTORS, SECTORS.slice(0, 10)]) {
        try { const r = quoteMap(await up(env, '/v2/market-quote/quotes?instrument_key=' + list.map((x) => enc(x[1])).join(','))); SECT_OK = list; return r; } catch (e) { if (e.code === 'UPSTOX_RATE' || e.code === 'UPSTOX_LOGIN') return {}; }
      }
      return {};
    });
    Object.assign(q, sq);
    let wsrc = W && W.w ? W.src : 'approximate weights';
    const tv = (x) => { const z = q['NSE_EQ|' + x.isin]; return z && z.price && z.vol ? z.price * z.vol : 0; };
    const raw = cons.items.map((x) => ({ ...x, w: M.fno ? tv(x) : W && W.w ? W.w[x.sym] : (idx === 'NIFTY50' || idx === 'SENSEX') ? W_APPROX[x.sym] || 0.5 : null }));
    if (M.fno) { wsrc = "today's traded value (price × volume)"; raw.forEach((x) => { if (!x.w) x.w = 1e-9; }); }
    if (cons.approx) wsrc += '; Sensex members approximate';
    if (raw.some((x) => !ok(x.w))) { raw.forEach((x) => { if (!ok(x.w)) x.w = 100 / raw.length; }); if (!(W && W.w)) wsrc = 'equal weights (NSE weights not reachable yet)'; }
    const tw = raw.reduce((s, x) => s + x.w, 0) || 1;
    const items = raw.map((x) => { const k = 'NSE_EQ|' + x.isin, z = q[k] || {}; const w = (x.w / tw) * 100;
      return { sym: x.sym, name: x.name, sector: x.sector, key: k, w: Math.round(w * 100) / 100, price: z.price ?? null, chg: z.chg ?? null, pc: z.prevClose ?? null, vol: z.vol || 0,
        pts: ix && ok(z.chg) && !M.fno ? Math.round((w / 100) * (z.chg / 100) * ix.prevClose * 10) / 10 : null, lot: x.lot || null }; });
    const sectors = SECTORS.map(([n, k]) => (q[k] ? { name: n, price: q[k].price, chg: q[k].chg } : null)).filter(Boolean);
    return { ts: Date.now(), idx, label: M.label, fno: !!M.fno, index: ix ? { price: ix.price, prevClose: ix.prevClose, chg: ix.chg } : null, wsrc, items, sectors };
  });
}

/* ---------------- Screener support: F&O universe, broker calls, order wins, results calendar ---------------- */
async function universe(env) {
  const ck = 'fno-universe', c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 7 * 864e5) { memSet(ck, c, 6 * 3600e3); return c; }
  try {
    const H = { headers: { 'User-Agent': UA_BROWSER, Accept: 'text/csv,*/*' } };
    const [lots, eq] = await Promise.all([fetch('https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv', H).then((r) => r.text()), fetch('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', H).then((r) => r.text())]);
    const isin = {}; csvRows(eq).forEach((o) => { if (o.symbol && o['isin number']) isin[o.symbol] = { isin: o['isin number'], name: o['name of company'] }; });
    const seen = new Set(), items = [];
    lots.split(/\r?\n/).forEach((l) => {
      const c2 = l.split(',').map((x) => x.trim()), sym = (c2[1] || '').toUpperCase(), lot = +c2[2] || +c2[3] || null;
      if (!sym || sym === 'SYMBOL' || seen.has(sym) || !isin[sym]) return; // indices and headers have no ISIN
      seen.add(sym); items.push({ sym, name: isin[sym].name, isin: isin[sym].isin, key: 'NSE_EQ|' + isin[sym].isin, lot });
    });
    if (items.length < 50) throw new Error('only ' + items.length + ' symbols');
    const res = { ts: Date.now(), items };
    await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 30 * 86400 }); memSet(ck, res, 6 * 3600e3);
    return res;
  } catch (e) { if (c) return c; throw new HttpError(502, 'Could not load the F&O stock list from NSE: ' + e.message); }
}
const gnews = (q) => ['Google News', `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`];
const TRUSTED_SITES = 'site:economictimes.indiatimes.com OR site:moneycontrol.com OR site:livemint.com OR site:business-standard.com OR site:thehindubusinessline.com OR site:cnbctv18.com OR site:financialexpress.com OR site:ndtvprofit.com';
async function brokerCalls(env) {
  const ck = 'brokercalls:v1', c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 60 * 60e3) { memSet(ck, c, 30 * 60e3); return c; }
  const [dn, upg, ord] = await Promise.all([
    fetchFeed(gnews(`(downgrade OR "cuts target" OR "target price cut" OR "sell rating" OR "reduce rating" OR "lowers target") when:7d (${TRUSTED_SITES})`)),
    fetchFeed(gnews(`(upgrade OR "raises target" OR "target price hike" OR "buy rating" OR "initiates coverage") when:7d (${TRUSTED_SITES})`)),
    fetchFeed(gnews(`("bags order" OR "order worth" OR "receives order" OR "wins order" OR "secures order" OR "order inflow") crore when:7d (${TRUSTED_SITES})`)),
  ]);
  const val = (t) => { const m = t.match(/(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?)\s?(crore|cr|lakh crore|billion|bn|mn|million)/i); if (!m) return null; let v = parseFloat(m[1].replace(/,/g, '')); const u = m[2].toLowerCase(); if (u === 'lakh crore') v *= 1e5; else if (/billion|bn/.test(u)) v *= 100; else if (/million|mn/.test(u)) v /= 10; return Math.round(v); };
  const pick = (a, kind) => mergeDupes(a).slice(0, 40).map((x) => ({ t: x.t, src: x.src, link: x.link, ts: x.ts, kind, cr: kind === 'order' ? val(x.t) : null }));
  const res = { ts: Date.now(), down: pick(dn, 'down'), up: pick(upg, 'up'), orders: pick(ord, 'order') };
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 6 * 3600 }); memSet(ck, res, 30 * 60e3);
  return res;
}
// upcoming board meetings for results (NSE event calendar, best effort)
// Results calendar: board meetings for results, 20 days back to 30 days ahead.
// 1) NSE event calendar (official). 2) If NSE blocks the cloud server: results-date headlines from trusted
//    business sites, read by the AI (marked as "news", so the page and the AI say it is not official).
async function resultsCalendar(env) {
  const ck = 'rescal:v2', c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 6 * 3600e3 && c.items && c.items.length) { memSet(ck, c, 3600e3); return c; }
  const M = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
  const parse = (j) => (Array.isArray(j) ? j : j.data || []).filter((x) => /result/i.test((x.purpose || '') + ' ' + (x.bm_desc || ''))).map((x) => {
    const m = String(x.date || '').match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/); return { sym: x.symbol, co: x.company, date: m ? `${m[3]}-${M[m[2]] || '01'}-${m[1].padStart(2, '0')}` : null, what: x.purpose || 'Financial Results', src: 'NSE' };
  }).filter((x) => x.date && x.sym);
  let items = [], src = null, err = null;
  try {
    const cookie = await nseCookie(), H = { headers: { 'User-Agent': UA_BROWSER, Accept: 'application/json', Referer: 'https://www.nseindia.com/', Cookie: cookie } };
    const n = istNow(), from = dmy(addDays(n, -20)), to = dmy(addDays(n, 30));
    const [r1, r2] = await Promise.all([
      fetch(`https://www.nseindia.com/api/event-calendar?index=equities&from_date=${from}&to_date=${to}`, H).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('https://www.nseindia.com/api/event-calendar', H).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const seen = new Set();
    [...(r1 ? parse(r1) : []), ...(r2 ? parse(r2) : [])].forEach((x) => { const k = x.sym + x.date; if (!seen.has(k)) { seen.add(k); items.push(x); } });
    if (items.length) src = 'NSE event calendar'; else err = r1 || r2 ? 'NSE returned no results dates' : 'NSE event calendar not reachable (NSE often blocks cloud servers)';
  } catch (e) { err = 'NSE event calendar not reachable'; }
  if (!items.length && hasAI(env)) {
    try {
      const pool = mergeDupes([
        ...(await fetchFeed(gnews(`("results date" OR "to announce" OR "board meeting" OR "will announce") (Q2 OR Q3 OR "quarterly results" OR earnings) when:14d (${TRUSTED_SITES})`))),
        ...(await fetchFeed(gnews(`("Q2 results today" OR "Q3 results today" OR "results today" OR "earnings this week" OR "results calendar") when:7d (${TRUSTED_SITES})`))),
      ]).slice(0, 50);
      if (pool.length) {
        const today = ymd(istNow());
        const arr = await aiJSON(env, `Today is ${today} (India). From these Indian business-news headlines, list every listed company whose quarterly-results date (board meeting for results) is stated or clearly implied ("today", "tomorrow", a weekday or a date).
Return ONLY a JSON array: {"sym": NSE symbol, "co": short company name, "date": "YYYY-MM-DD"}. Skip anything without a clear date. Never guess a date.
Headlines (with publication dates):
${pool.map((x, i) => `${i}. [${ymd(new Date(x.ts + 5.5 * 3600e3))}] ${x.t}`).join('\n')}`, 2500);
        const seen = new Set();
        (Array.isArray(arr) ? arr : []).forEach((x) => { const sym = String(x.sym || '').toUpperCase().replace(/[^A-Z0-9&-]/g, ''), d = String(x.date || '').slice(0, 10); if (sym && /^\d{4}-\d{2}-\d{2}$/.test(d) && !seen.has(sym + d)) { seen.add(sym + d); items.push({ sym, co: String(x.co || sym).slice(0, 60), date: d, what: 'Financial Results', src: 'news' }); } });
        if (items.length) src = 'news headlines (not official)';
      }
    } catch (e) { /* AI or news unavailable */ }
  }
  if (!items.length) { if (c && c.items && c.items.length) return { ...c, stale: true }; return { ts: Date.now(), items: [], error: err || 'No results dates found' }; }
  const U = await fnoSymbols(env);
  items = items.map((x) => ({ ...x, fo: !!U[x.sym] })).sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : (q.fo - p.fo)));
  const res = { ts: Date.now(), items, src };
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 2 * 86400 }); memSet(ck, res, 3600e3);
  return res;
}

/* ---------------- News impact: which sectors and companies each big headline helps or hurts ----------------
   Read-only, advice only. The dashboard's call/put engine never reads this. One AI call per 30 minutes at most
   (cached in KV), so it stays well inside the free quotas. */
const IMPACT_SECTORS = ['Banks', 'PSU Banks', 'NBFC & Finance', 'Insurance', 'IT', 'Pharma & Healthcare', 'FMCG', 'Auto', 'Tyres & Auto parts', 'Metals & Mining',
  'Oil marketing (OMCs)', 'Upstream oil & gas', 'Gas utilities', 'Power', 'Capital goods & Infra', 'Defence', 'Railways', 'Cement', 'Realty', 'Telecom', 'Aviation',
  'Paints & Chemicals', 'Consumer durables', 'Retail & Consumer', 'Media', 'Logistics & Shipping', 'Hotels & Travel', 'Fertilisers & Agri', 'Textiles', 'Jewellery & Gold'];
// AI for the impact jobs: Gemini's lighter free models first (better JSON), then Workers AI. Never throws a quota error to the page.
async function aiJSON(env, prompt, maxTokens) {
  const steps = [];
  if (env.GEMINI_API_KEY) steps.push(() => gemini(env, prompt, maxTokens, ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemma-3-27b-it']));
  if (env.AI) steps.push(() => workersAI(env, prompt, maxTokens));
  if (env.ANTHROPIC_API_KEY) steps.push(() => anthropic(env, prompt, maxTokens));
  let last = new Error('No AI configured');
  for (const fn of steps) { try { return parseAIArray(await fn()); } catch (e) { last = e; } }
  throw last;
}
// F&O symbols (from the NSE list the Screener already uses), to keep only real tickers
async function fnoSymbols(env) {
  try { const u = await universe(env); const m = {}; (u.items || []).forEach((x) => (m[x.sym] = x)); return m; } catch (e) { return {}; }
}
const sectorOf = (n) => { const s = String(n || '').toLowerCase(); return IMPACT_SECTORS.find((x) => x.toLowerCase() === s) || IMPACT_SECTORS.find((x) => x.toLowerCase().split(/[ &()]+/).some((w) => w.length > 3 && s.includes(w))) || null; };
const clamp1 = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

async function newsImpact(env) {
  const ck = 'impact:v1', c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 30 * 60e3) { memSet(ck, c, 10 * 60e3); return c; }
  if (!hasAI(env)) return { ts: Date.now(), ai: false, items: [], note: 'AI is off: add GEMINI_API_KEY or the Workers AI binding (AI) in the Worker.' };
  // market news + the macro and policy stories that move sectors (crude, rates, tariffs, government policy, commodities)
  const [feed, macroIn, macroW] = await Promise.all([
    allFeeds(env),
    fetchFeed(gnews(`(RBI OR "repo rate" OR GST OR "excise duty" OR "import duty" OR "export duty" OR subsidy OR budget OR monsoon OR "fuel price" OR ATF OR "windfall tax" OR PLI OR SEBI) India when:2d (${TRUSTED_SITES})`)),
    fetchFeed(gnews('("crude oil" OR Brent OR OPEC OR "Federal Reserve" OR "Fed rate" OR tariff OR "trade deal" OR "US yields" OR dollar OR "China stimulus" OR "steel prices" OR "copper prices" OR "gold prices") when:2d')),
  ]);
  const pool = mergeDupes([...macroIn, ...macroW, ...feed.items].filter((i) => i.ts > Date.now() - 36 * 3600e3 && !RESULT_RE.test(i.t)).sort((a, b) => b.ts - a.ts)).slice(0, 36);
  if (!pool.length) return { ts: Date.now(), ai: true, items: [], note: 'No fresh headlines right now.' };
  const prompt = `You are a senior Indian equity strategist. For each headline, judge its likely effect on Indian stock-market sectors and listed companies.
Use ONLY these sector names: ${IMPACT_SECTORS.join('; ')}.
For companies use NSE symbols (e.g. INDIGO, BPCL, ONGC, HDFCBANK, TATASTEEL). Think about second-order effects (e.g. cheaper crude helps airlines, paints, tyres and OMCs, hurts upstream oil producers).
Return ONLY a JSON array with one object per headline that matters for Indian stocks (skip headlines with no clear effect):
{"i": headline number, "nifty": -1..1 effect on the Nifty overall, "str": 1 (small) | 2 (medium) | 3 (big), "hz": "d" (today) | "w" (days to weeks) | "m" (months), "sec": [["sector name", 1 or -1], ...] (max 4), "co": [["NSE symbol", 1 or -1], ...] (max 4), "why": "one short plain-English line"}
Headlines:
${pool.map((x, i) => `${i}. ${x.t}`).join('\n')}`;
  let arr;
  try { arr = await aiJSON(env, prompt, 3000); } catch (e) { if (c) return { ...c, stale: true }; return { ts: Date.now(), ai: false, items: [], note: 'AI could not read the news right now: ' + String(e.message || e).slice(0, 120) }; }
  const SYM = await fnoSymbols(env);
  const items = [];
  (Array.isArray(arr) ? arr : []).forEach((a) => {
    const h = pool[a && a.i]; if (!h) return;
    const sec = (Array.isArray(a.sec) ? a.sec : []).map(([n, d]) => [sectorOf(n), d > 0 ? 1 : -1]).filter((x) => x[0]).slice(0, 4);
    const co = (Array.isArray(a.co) ? a.co : []).map(([s, d]) => { const sym = String(s || '').toUpperCase().replace(/^NSE:/, '').replace(/[^A-Z0-9&-]/g, ''); return { sym, d: d > 0 ? 1 : -1, fo: !!SYM[sym], key: SYM[sym] ? SYM[sym].key : null, name: SYM[sym] ? SYM[sym].name : null, lot: SYM[sym] ? SYM[sym].lot : null }; }).filter((x) => x.sym.length >= 2).slice(0, 4);
    if (!sec.length && !co.length && !a.nifty) return;
    items.push({ t: h.t, src: h.src, link: h.link, ts: h.ts, n: h.n || 1, nifty: clamp1(a.nifty), str: [1, 2, 3].includes(a.str) ? a.str : 1, hz: ['d', 'w', 'm'].includes(a.hz) ? a.hz : 'd', sec, co, why: String(a.why || '').slice(0, 200) });
  });
  const res = { ts: Date.now(), ai: true, items, read: pool.length };
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 6 * 3600 }); memSet(ck, res, 10 * 60e3);
  return res;
}

/* ---------------- Results radar: profit and revenue growth pulled from results headlines ----------------
   Headlines from trusted business sites over the last 3 weeks; the AI reads the numbers that are IN the headline
   (it must leave a number empty rather than guess). Not official filings: check the company's results before trading. */
async function earningsRadar(env) {
  const ck = 'earnings:v1', c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 3 * 3600e3) { memSet(ck, c, 30 * 60e3); return c; }
  if (!hasAI(env)) return { ts: Date.now(), ai: false, items: [], note: 'AI is off: add GEMINI_API_KEY or the Workers AI binding (AI) in the Worker.' };
  const [feed, g1, g2, g3] = await Promise.all([
    allFeeds(env),
    fetchFeed(gnews(`("Q2 results" OR "Q2 FY27" OR "September quarter") ("net profit" OR PAT) (jumps OR rises OR surges OR grows OR up) YoY when:21d (${TRUSTED_SITES})`)),
    fetchFeed(gnews(`("Q2 results" OR "Q2 FY27" OR "September quarter") ("net profit" OR PAT OR loss) (falls OR declines OR drops OR plunges OR down OR misses) when:21d (${TRUSTED_SITES})`)),
    fetchFeed(gnews(`("quarterly results" OR "Q2 earnings") revenue profit "year-on-year" when:21d (${TRUSTED_SITES})`)),
  ]);
  const pool = mergeDupes([...g1, ...g2, ...g3, ...feed.items.filter((i) => RESULT_RE.test(i.t))].filter((i) => i.ts > Date.now() - 21 * 864e5 && /profit|loss|revenue|pat|ebitda|earnings|results/i.test(i.t)).sort((a, b) => b.ts - a.ts)).slice(0, 90);
  if (!pool.length) return { ts: Date.now(), ai: true, items: [], note: 'No results headlines found in the last 3 weeks.' };
  const out = [];
  for (let s = 0; s < pool.length; s += 30) {
    const part = pool.slice(s, s + 30);
    const prompt = `You read Indian listed-company quarterly results headlines. For each headline about ONE listed Indian company's results, return:
{"i": headline number, "sym": NSE symbol (e.g. "TATAMOTORS"), "co": short company name, "q": quarter like "Q2 FY27", "pat": net profit change year-on-year in % as a number, or null if the headline does not state it, "rev": revenue change year-on-year in % or null, "s": -1 (clearly weak / missed / loss) to 1 (clearly strong / beat)}
Rules: use only numbers written in the headline (a headline saying "profit doubles" means 100; "profit triples" means 200). Never guess a number. If a headline turned a loss into a profit, pat = null and s = 1. Skip headlines that are not one company's quarterly results.
Return ONLY a JSON array.
Headlines:
${part.map((x, i) => `${s + i}. ${x.t}`).join('\n')}`;
    try { const arr = await aiJSON(env, prompt, 2500); if (Array.isArray(arr)) out.push(...arr); } catch (e) { if (!out.length && s === 0) { if (c) return { ...c, stale: true }; return { ts: Date.now(), ai: false, items: [], note: 'AI could not read the results right now: ' + String(e.message || e).slice(0, 120) }; } }
  }
  const SYM = await fnoSymbols(env), by = {};
  const num = (v) => (typeof v === 'number' && isFinite(v) && Math.abs(v) < 5000 ? Math.round(v * 10) / 10 : null);
  out.forEach((a) => {
    const h = pool[a && a.i]; if (!h || !a.sym) return;
    const sym = String(a.sym).toUpperCase().replace(/^NSE:/, '').replace(/[^A-Z0-9&-]/g, ''); if (sym.length < 2) return;
    const x = { sym, co: String(a.co || SYM[sym] && SYM[sym].name || sym).slice(0, 60), q: String(a.q || '').slice(0, 12), pat: num(a.pat), rev: num(a.rev), s: clamp1(a.s), t: h.t, src: h.src, link: h.link, ts: h.ts,
      fo: !!SYM[sym], key: SYM[sym] ? SYM[sym].key : null, lot: SYM[sym] ? SYM[sym].lot : null };
    const p = by[sym], info = (y) => (y.pat != null ? 2 : 0) + (y.rev != null ? 1 : 0);
    if (!p || info(x) > info(p) || (info(x) === info(p) && x.ts > p.ts)) by[sym] = { ...x, more: p ? (p.more || 0) + 1 : 0 };
    else p.more = (p.more || 0) + 1;
  });
  const res = { ts: Date.now(), ai: true, items: Object.values(by).sort((a, b) => b.ts - a.ts), read: pool.length };
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 12 * 3600 }); memSet(ck, res, 30 * 60e3);
  return res;
}

/* ---------------- End-of-day quotes: every F&O stock + the 3 indices, for the Overnight page ----------------
   Two or three Upstox calls (150 instruments each), shared for 20 seconds. Read-only. */
const EOD_IDX = [['NIFTY', 'NSE_INDEX|Nifty 50', 'Nifty 50'], ['BANKNIFTY', 'NSE_INDEX|Nifty Bank', 'Nifty Bank'], ['SENSEX', 'BSE_INDEX|SENSEX', 'Sensex']];
async function eodQuotes(env, only) {
  const U = await universe(env);
  let list = [...EOD_IDX.map(([sym, key, name]) => ({ sym, key, name, idx: true })), ...(U.items || [])];
  if (only && only.length) list = list.filter((x) => only.includes(x.sym));
  const out = {};
  for (let i = 0; i < list.length; i += 150) {
    const part = list.slice(i, i + 150);
    const m = quoteMap(await up(env, '/v2/market-quote/quotes?instrument_key=' + part.map((x) => enc(x.key)).join(',')));
    part.forEach((x) => { const q = m[x.key]; if (q && ok(q.price)) out[x.sym] = { key: x.key, name: x.name, lot: x.lot || null, idx: !!x.idx, o: q.open, h: q.hi, l: q.lo, c: q.price, pc: q.prevClose, v: q.vol, ts: q.ts }; });
  }
  return { ts: Date.now(), n: Object.keys(out).length, q: out };
}

/* ---------------- Backtest data: historical candles passed straight through ----------------
   No parsing here, so a month of 1-minute candles stays well inside the free plan's CPU limit.
   Upstox v3 allows up to one month of 1-minute candles per request; the dashboard asks month by month. */
async function histRaw(req, env, url) {
  const key = keyParam(url, 'key'), unit = url.searchParams.get('unit') || 'minutes', iv = url.searchParams.get('iv') || '1';
  const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
  if (!/^(minutes|days)$/.test(unit) || !/^\d{1,3}$/.test(iv) || !/^\d{4}-\d\d-\d\d$/.test(from) || !/^\d{4}-\d\d-\d\d$/.test(to)) throw new HttpError(400, 'Bad range');
  if (Date.now() < RL.until) { const e = new HttpError(429, RL.msg, 'UPSTOX_RATE'); e.retryAfter = Math.ceil((RL.until - Date.now()) / 1000); throw e; }
  const t = await upstoxToken(env);
  UPC.push(Date.now());
  const r = await fetch(`${UP}/v3/historical-candle/${enc(key)}/${unit}/${iv}/${to}/${from}`, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + t } });
  if (r.status === 429) { RL.until = Date.now() + 60e3; RL.msg = 'Upstox rate limit while downloading history. Pausing 1 min.'; const e = new HttpError(429, RL.msg, 'UPSTOX_RATE'); e.retryAfter = 60; throw e; }
  if (r.status === 401) throw new HttpError(502, 'Upstox token is invalid or expired.', 'UPSTOX_TOKEN_BAD');
  return new Response(r.body, { status: r.ok ? 200 : 502, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req, env) } });
}

/* ---------------- रूटर ---------------- */
async function route(req, env, url) {
  const p = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  if (p === '/auth/callback') return authCallback(req, env, url);
  if (p === '/auth/login') return authLogin(req, env, url);
  if (p === '/' || p === '/health') return json({ ok: true, name: 'F&O Terminal Worker' }, 200, req, env);

  const email = await verifyUser(req, env);
  const idx = (url.searchParams.get('index') || '').toUpperCase();
  const sess = url.searchParams.get('s') === 'MCX' ? 'MCX' : 'NSE';
  const R = (d) => json(d, 200, req, env);

  switch (p) {
    case '/api/status': {
      const t = env.UPSTOX_ACCESS_TOKEN || (await env.KV.get('upstox_token'));
      return R({ email, upstox: !!t, ai: hasAI(env), aiVia: env.GEMINI_API_KEY ? 'Gemini' : env.AI ? 'Workers AI' : env.ANTHROPIC_API_KEY ? 'Claude' : null, tokenMode: env.UPSTOX_ACCESS_TOKEN ? 'analytics' : 'oauth', v: 2, upCalls30m: UPC.length, rateWait: Math.max(0, Math.ceil((RL.until - Date.now()) / 1000)) });
    }
    case '/api/snapshot': {
      const w = (url.searchParams.get('w') || '').split(',').filter((k) => KEY_RE.test(k)).slice(0, 40);
      return R(await snapshot(env, w, url.searchParams.get('lite') === '1'));
    }
    case '/api/candles': return R(await candles(env, INDEX[idx] ? INDEX[idx].key : keyParam(url, 'key'), sess));
    case '/api/chain': return R(await chain(env, keyParam(url, 'u')));
    case '/api/search': return R(await search(env, url.searchParams.get('q')));
    case '/api/inst': return R(await instInfo(env, keyParam(url, 'u')));
    case '/api/fut': {
      const u = INDEX[idx] ? INDEX[idx].key : keyParam(url, 'u');
      const sym = INDEX[idx] ? INDEX[idx].sym : String(url.searchParams.get('sym') || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '').slice(0, 20);
      const ex = INDEX[idx] ? INDEX[idx].exch : url.searchParams.get('exch') === 'BSE' ? 'BSE' : 'NSE';
      return R(await futData(env, u, sym, ex, 'NSE'));
    }
    case '/api/daily': return R(await daily(env, keyParam(url, 'key')));
    case '/api/global': return R(await globalCues(env));
    case '/api/world': return R(await world(env));
    case '/api/hist': return histRaw(req, env, url);
    case '/api/map': return R(await marketMap(env, (url.searchParams.get('idx') || 'NIFTY50').toUpperCase()));
    case '/api/universe': return R(await universe(env));
    case '/api/brokercalls': return R(await brokerCalls(env));
    case '/api/rescal': return R(await resultsCalendar(env));
    case '/api/participant': return R(await participantOI(env));
    case '/api/calendar': return R(await calendar(env));
    case '/api/fiidii': return R(await fiiDii(env));
    case '/api/official': return R(await official(env));
    case '/api/geo': return R(await shared('geo', 60e3, () => geoRisk(env)));
    case '/api/feed-url': {
      // Upstox लाइव WebSocket के लिए एक बार इस्तेमाल होने वाला URL (टोकन Worker में ही रहता है)
      const d = await up(env, '/v3/feed/market-data-feed/authorize', true); // the live stream is what gets us out of a rate limit, so always try it
      const url = d && (d.authorizedRedirectUri || d.authorized_redirect_uri);
      if (!url) throw new HttpError(502, 'Upstox did not return a live-feed URL', 'FEED_URL');
      return json({ url }, 200, req, env);
    }
    case '/api/news': {
      if (INDEX[idx]) return R(await news(env, idx));
      const id = String(url.searchParams.get('id') || '').toUpperCase().replace(/[^A-Z0-9&]/g, '').slice(0, 20);
      if (!id) throw new HttpError(400, 'Unknown index');
      return R(await newsFor(env, id, url.searchParams.get('name')));
    }
    case '/api/results': return json(await results(env), 200, req, env);
    case '/api/impact': return R(await shared('impact', 30e3, () => newsImpact(env)));
    case '/api/eod': {
      const only = (url.searchParams.get('syms') || '').toUpperCase().split(',').map((x) => x.replace(/[^A-Z0-9&-]/g, '')).filter(Boolean).slice(0, 60);
      return R(await shared('eod:' + only.join(','), 20e3, () => eodQuotes(env, only)));
    }
    case '/api/earnings': return R(await shared('earnings', 30e3, () => earningsRadar(env)));
    case '/api/stt': {
      if (req.method !== 'POST') throw new HttpError(405, 'POST required');
      return json(await stt(env, await req.json()), 200, req, env);
    }
    case '/api/ask': {
      if (req.method !== 'POST') throw new HttpError(405, 'POST required');
      return json(await ask(env, await req.json()), 200, req, env);
    }
    case '/api/upstox/logout': {
      await env.KV.delete('upstox_token'); MEM.delete('upstox_token');
      return json({ ok: true }, 200, req, env);
    }
  }
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      return await route(req, env, url);
    } catch (e) {
      const status = e.status || 500;
      return json({ error: e.message || String(e), code: e.code || 'ERR', retryAfter: e.retryAfter || undefined }, status, req, env);
    }
  },
};