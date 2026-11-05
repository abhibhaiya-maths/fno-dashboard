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
  ['ET Markets', 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'],
  ['ET Stocks', 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms'],
  ['Moneycontrol', 'https://www.moneycontrol.com/rss/marketreports.xml'],
  ['Mint Markets', 'https://www.livemint.com/rss/markets'],
  ['Business Standard', 'https://www.business-standard.com/rss/markets-106.rss'],
  ['Moneycontrol Results', 'https://www.moneycontrol.com/rss/results.xml'],
  // Google News RSS: मुफ़्त, बिना key, सबसे भरोसेमंद
  ['Google News', 'https://news.google.com/rss/search?q=(Nifty+OR+Sensex+OR+%22stock+market%22)+when:2d&hl=en-IN&gl=IN&ceid=IN:en'],
  ['Google News', 'https://news.google.com/rss/search?q=(%22Bank+Nifty%22+OR+RBI+OR+%22bank+shares%22)+when:2d&hl=en-IN&gl=IN&ceid=IN:en'],
  ['Google News', 'https://news.google.com/rss/search?q=(%22Q2+results%22+OR+%22Q3+results%22+OR+%22quarterly+results%22)+profit+when:3d&hl=en-IN&gl=IN&ceid=IN:en'],
  ['Business Standard Results', 'https://www.business-standard.com/rss/companies/results-10301.rss'],
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
async function up(env, path) {
  const t = await upstoxToken(env);
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
  if (!r.ok || j.status === 'error') {
    const m = (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].errorCode)) || ('HTTP ' + r.status);
    throw new HttpError(502, 'Upstox: ' + m, 'UPSTOX_ERR');
  }
  return j.data;
}
// पहला रास्ता फ़ेल हो तो दूसरा आज़माओ (v3 → v2)
async function upAny(env, paths) {
  let last;
  for (const p of paths) {
    try { return await up(env, p); } catch (e) { if (e.code === 'UPSTOX_LOGIN') throw e; last = e; }
  }
  throw last;
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
async function chain(env, ukey) {
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

async function snapshot(env, watch) {
  const [q, ...chains] = await Promise.all([
    quotes(env, watch),
    ...Object.keys(INDEX).map((k) => chain(env, INDEX[k].key).catch((e) => ({ error: e.message }))),
  ]);
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
  let todayDays = [];
  try {
    const d = await upAny(env, [
      `/v3/historical-candle/intraday/${enc(key)}/minutes/1`,
      `/v2/historical-candle/intraday/${enc(key)}/1minute`,
    ]);
    todayDays = groupCandles(d && d.candles, sess).filter((x) => x.date === today);
  } catch (e) { if (e.code === 'UPSTOX_LOGIN') throw e; }
  return { today, days: [...hist, ...todayDays].slice(-3) };
}

/* ---------------- AI ---------------- */
// ===== AI: मुफ़्त विकल्प पहले =====
// 1) GEMINI_API_KEY  -> Google Gemini (मुफ़्त key, aistudio.google.com)
// 2) AI binding      -> Cloudflare Workers AI (कोई key नहीं, रोज़ मुफ़्त कोटा)
// 3) ANTHROPIC_API_KEY -> Claude (पेड, वैकल्पिक)
const hasAI = (env) => !!(env.GEMINI_API_KEY || env.AI || env.ANTHROPIC_API_KEY);
async function gemini(env, prompt, maxTokens) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens || 800, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Gemini: ' + ((j.error && j.error.message) || r.status));
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const txt = parts.map((p) => p.text || '').join('');
  if (!txt) throw new Error('Gemini: empty reply');
  return txt;
}
async function workersAI(env, prompt, maxTokens) {
  const out = await env.AI.run(env.CF_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens || 800 });
  const txt = (out && (out.response || (out.result && out.result.response))) || '';
  if (!txt) throw new Error('Workers AI: empty reply');
  return typeof txt === 'string' ? txt : JSON.stringify(txt);
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
// purpose 'chat' = यूज़र के सवाल (बेहतर हिंदी: Gemini पहले), 'bulk' = ख़बरों का स्कोर (कोटा बचाने को Workers AI पहले)
async function aiText(env, prompt, maxTokens, purpose) {
  const order = purpose === 'bulk' ? ['AI', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'] : ['GEMINI_API_KEY', 'AI', 'ANTHROPIC_API_KEY'];
  const fn = { GEMINI_API_KEY: gemini, AI: workersAI, ANTHROPIC_API_KEY: anthropic };
  let last = new Error('No AI configured');
  for (const k of order) {
    if (!env[k]) continue;
    try { return await fn[k](env, prompt, maxTokens); } catch (e) { last = e; }
  }
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
      if (src === 'Google News') { const m = t.match(/^(.*)\s+-\s+([^-]{2,50})$/); if (m) { t = m[1]; s2 = m[2].trim(); } }
      return { t, link: g('link'), ts, src: s2, feed: src };
    }).filter((i) => i.t);
  } catch { return []; } finally { clearTimeout(t); }
}
const POS = /surge|soar|rall|gain|jump|rise|rises|record high|beat|strong|upgrade|bull|buy|inflow|boost|recover|higher|profit up|growth/i;
const NEG = /fall|falls|drop|slump|plunge|crash|decline|weak|miss|downgrade|bear|sell-off|selloff|outflow|loss|lower|cut|fear|concern|worr|tension|war|tariff hike/i;
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
  const items = feed.items.filter((i) => i.ts > Date.now() - 36 * 3600e3 && NEWS_KW[idx].test(i.t) && !RESULT_RE.test(i.t)).slice(0, 12);
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
  const res = { ts: Date.now(), ai, items: scored, sources: feed.sources };
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
  const ctx = JSON.stringify(body.context || {}).slice(0, 24000);
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
  ['RBI press releases', 'https://rbi.org.in/pressreleases_rss.xml'],
  ['RBI notifications', 'https://rbi.org.in/notifications_rss.xml'],
  ['SEBI', 'https://www.sebi.gov.in/sebirss.xml'],
];
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
          }
          out.push({ t, co, sub, src, link: g('link'), ts }); n++;
        }
      }
    } catch (e) { /* source unreachable */ }
    sources[src] = n;
  }));
  out.sort((a, b) => b.ts - a.ts);
  const res = { ts: Date.now(), items: out.slice(0, 120), sources };
  memSet('official', res, 10 * 60e3);
  return res;
}

/* ---------------- Company news for a watchlist stock / commodity ---------------- */
async function newsFor(env, id, name) {
  name = String(name || id).replace(/[^\w &.-]/g, '').trim().slice(0, 40);
  const ck = 'wnews:' + id;
  const c = memGet(ck); if (c) return c;
  const words = name.split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|ltd|limited|bank|india|fut)$/i.test(w));
  const re = new RegExp('\\b(' + [id, ...words.slice(0, 2)].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');
  const g = await fetchFeed(['Google News', `https://news.google.com/rss/search?q=${enc('"' + name + '"')}+when:3d&hl=en-IN&gl=IN&ceid=IN:en`]);
  const feed = await allFeeds(env);
  const seen = new Set();
  const items = [...g, ...feed.items.filter((i) => re.test(i.t))]
    .filter((i) => { const k = i.t.toLowerCase().slice(0, 80); if (seen.has(k) || i.ts < Date.now() - 72 * 3600e3) return false; seen.add(k); return true; })
    .sort((a, b) => b.ts - a.ts).slice(0, 12);
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
  const res = { ts: Date.now(), ai, items: scored, sources: { 'Google News': g.length, 'Market feeds': items.length - g.length } };
  memSet(ck, res, 15 * 60e3);
  return res;
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
      return R({ email, upstox: !!t, ai: hasAI(env), aiVia: env.GEMINI_API_KEY ? 'Gemini' : env.AI ? 'Workers AI' : env.ANTHROPIC_API_KEY ? 'Claude' : null, tokenMode: env.UPSTOX_ACCESS_TOKEN ? 'analytics' : 'oauth', v: 2 });
    }
    case '/api/snapshot': {
      const w = (url.searchParams.get('w') || '').split(',').filter((k) => KEY_RE.test(k)).slice(0, 40);
      return R(await snapshot(env, w));
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
    case '/api/calendar': return R(await calendar(env));
    case '/api/fiidii': return R(await fiiDii(env));
    case '/api/official': return R(await official(env));
    case '/api/feed-url': {
      // Upstox लाइव WebSocket के लिए एक बार इस्तेमाल होने वाला URL (टोकन Worker में ही रहता है)
      const d = await up(env, '/v3/feed/market-data-feed/authorize');
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
      return json({ error: e.message || String(e), code: e.code || 'ERR' }, status, req, env);
    }
  },
};
