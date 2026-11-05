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
 *             ANTHROPIC_API_KEY (वैकल्पिक)
 *  Variables: FRONTEND_URL, ALLOWED_EMAIL, FIREBASE_API_KEY, UPSTOX_REDIRECT_URI (सिर्फ़ OAuth में), CLAUDE_MODEL (वैकल्पिक)
 *  KV binding: KV
 *
 * ये टूल कोई असली ऑर्डर नहीं लगाता। सिर्फ़ डेटा पढ़ता है।
 */

const UP = 'https://api.upstox.com';

const INDEX = {
  NIFTY: { key: 'NSE_INDEX|Nifty 50' },
  SENSEX: { key: 'BSE_INDEX|SENSEX' },
  BANKNIFTY: { key: 'NSE_INDEX|Nifty Bank' },
};
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
  if (!tok) throw new HttpError(401, 'लॉगिन ज़रूरी है', 'NO_AUTH');
  const ck = 'auth:' + (await sha(tok));
  const cached = memGet(ck);
  if (cached) return cached;
  if (!env.FIREBASE_API_KEY) throw new HttpError(500, 'Worker में FIREBASE_API_KEY सेट नहीं है', 'CONFIG');
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: tok }),
  });
  if (!r.ok) throw new HttpError(401, 'लॉगिन टोकन अमान्य या पुराना है, दोबारा लॉगिन करें', 'BAD_AUTH');
  const j = await r.json();
  const email = (j.users && j.users[0] && j.users[0].email || '').toLowerCase();
  const allowed = (env.ALLOWED_EMAIL || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (!email || !allowed.includes(email)) throw new HttpError(403, 'इस ईमेल को अनुमति नहीं है', 'FORBIDDEN');
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
  if (!t) throw new HttpError(428, 'Upstox से कनेक्ट करें (रोज़ सुबह एक बार)', 'UPSTOX_LOGIN');
  memSet('upstox_token', t, 5 * 60e3);
  return t;
}
async function up(env, path) {
  const t = await upstoxToken(env);
  const r = await fetch(UP + path, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + t } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && env.UPSTOX_ACCESS_TOKEN) {
    throw new HttpError(502, 'Upstox Analytics Token अमान्य या एक्सपायर है। Upstox → My Apps → Analytics से नया टोकन लेकर UPSTOX_ACCESS_TOKEN अपडेट करें', 'UPSTOX_TOKEN_BAD');
  }
  if (r.status === 401) {
    MEM.delete('upstox_token');
    await env.KV.delete('upstox_token');
    throw new HttpError(428, 'Upstox टोकन की मियाद ख़त्म, दोबारा कनेक्ट करें', 'UPSTOX_LOGIN');
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
  if (!code || !state) return back('upstox=error&msg=' + enc('लॉगिन रद्द हुआ'));
  const ok = await env.KV.get('oauth_state:' + state);
  if (!ok) return back('upstox=error&msg=' + enc('लॉगिन सत्र पुराना हो गया, फिर से कोशिश करें'));
  await env.KV.delete('oauth_state:' + state);
  const body = new URLSearchParams({
    code, client_id: env.UPSTOX_API_KEY, client_secret: env.UPSTOX_API_SECRET,
    redirect_uri: env.UPSTOX_REDIRECT_URI, grant_type: 'authorization_code',
  });
  const r = await fetch(UP + '/v2/login/authorization/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return back('upstox=error&msg=' + enc('टोकन नहीं मिला: ' + ((j.errors && j.errors[0] && j.errors[0].message) || r.status)));
  await env.KV.put('upstox_token', j.access_token, { expiration: nextTokenExpiry() });
  memSet('upstox_token', j.access_token, 5 * 60e3);
  return back('upstox=connected');
}

/* ---------------- एक्सपायरी और लॉट ---------------- */
async function contracts(env, idx) {
  const today = ymd(istNow());
  const ck = 'contracts:' + idx + ':' + today;
  let c = memGet(ck);
  if (c) return c;
  const kv = await env.KV.get(ck, 'json');
  if (kv) { memSet(ck, kv, 3600e3); return kv; }
  const data = await up(env, '/v2/option/contract?instrument_key=' + enc(INDEX[idx].key));
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
    ltp: m.ltp || 0, bid: m.bid_price || 0, ask: m.ask_price || 0, oi: m.oi || 0, poi: m.prev_oi || 0, vol: m.volume || 0,
    iv: g.iv ? g.iv / 100 : 0, de: g.delta || 0, ga: g.gamma || 0, th: g.theta || 0, ve: g.vega || 0,
  };
}
async function chain(env, idx) {
  const c = await contracts(env, idx);
  const expiry = pickExpiry(c);
  const data = await up(env, `/v2/option/chain?instrument_key=${enc(INDEX[idx].key)}&expiry_date=${expiry}`);
  const rows = (data || []).map((r) => ({ K: r.strike_price, ce: slimSide(r.call_options), pe: slimSide(r.put_options) })).sort((a, b) => a.K - b.K);
  const spot = data && data[0] ? data[0].underlying_spot_price : null;
  return { expiry, lot: c.lots[expiry] || null, spot, rows };
}

/* ---------------- भाव ---------------- */
async function quotes(env) {
  const keys = new Set([VIX_KEY, ...Object.values(INDEX).map((x) => x.key)]);
  for (const k in HV) HV[k].forEach((h) => keys.add('NSE_EQ|' + h[1]));
  const data = await up(env, '/v2/market-quote/quotes?instrument_key=' + [...keys].map(enc).join(','));
  const byKey = {};
  for (const name in data || {}) {
    const q = data[name];
    const tk = q.instrument_token || name.replace(':', '|');
    const lp = q.last_price, nc = q.net_change || 0;
    byKey[tk] = { price: lp, prevClose: lp - nc, chg: lp - nc ? (nc / (lp - nc)) * 100 : 0 };
  }
  const indices = {};
  for (const k in INDEX) indices[k] = byKey[INDEX[k].key] || null;
  const v = byKey[VIX_KEY];
  const hv = {};
  for (const k in HV) hv[k] = HV[k].map(([n, isin, w]) => ({ n, w, c: byKey['NSE_EQ|' + isin] ? byKey['NSE_EQ|' + isin].chg : null }));
  return { indices, vix: v ? { v: v.price, prev: v.prevClose } : null, hv };
}

async function snapshot(env) {
  const [q, ...chains] = await Promise.all([
    quotes(env),
    ...Object.keys(INDEX).map((k) => chain(env, k).catch((e) => ({ error: e.message }))),
  ]);
  const ch = {};
  Object.keys(INDEX).forEach((k, i) => (ch[k] = chains[i]));
  return { ts: Date.now(), ...q, chains: ch };
}

/* ---------------- कैंडल्स ---------------- */
function groupCandles(arr) {
  // Upstox: [timestamp, open, high, low, close, volume, oi], नई कैंडल पहले
  const days = {};
  for (const c of arr || []) {
    const ts = c[0], date = ts.slice(0, 10), hh = +ts.slice(11, 13), mm = +ts.slice(14, 16);
    const m = hh * 60 + mm - 555; // 09:15 = 0
    if (m < 0 || m > 374) continue;
    (days[date] = days[date] || []).push([m, c[1], c[2], c[3], c[4], c[5] || 0]);
  }
  return Object.keys(days).sort().map((date) => ({ date, c: days[date].sort((a, b) => a[0] - b[0]) }));
}
async function candles(env, idx) {
  const key = INDEX[idx].key, n = istNow(), today = ymd(n);
  const hk = 'hist:' + idx + ':' + today;
  let hist = memGet(hk) || (await env.KV.get(hk, 'json'));
  if (!hist) {
    const to = ymd(addDays(n, -1)), from = ymd(addDays(n, -10));
    const d = await upAny(env, [
      `/v3/historical-candle/${enc(key)}/minutes/1/${to}/${from}`,
      `/v2/historical-candle/${enc(key)}/1minute/${to}/${from}`,
    ]);
    hist = groupCandles(d && d.candles).filter((x) => x.date < today).slice(-3);
    await env.KV.put(hk, JSON.stringify(hist), { expirationTtl: 20 * 3600 });
    memSet(hk, hist, 3600e3);
  } else memSet(hk, hist, 3600e3);
  let todayDays = [];
  try {
    const d = await upAny(env, [
      `/v3/historical-candle/intraday/${enc(key)}/minutes/1`,
      `/v2/historical-candle/intraday/${enc(key)}/1minute`,
    ]);
    todayDays = groupCandles(d && d.candles).filter((x) => x.date === today);
  } catch (e) { if (e.code === 'UPSTOX_LOGIN') throw e; }
  return { today, days: [...hist, ...todayDays].slice(-3) };
}

/* ---------------- AI ---------------- */
async function claude(env, prompt, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || 'claude-haiku-5-5', max_tokens: maxTokens || 800, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('AI: ' + ((j.error && j.error.message) || r.status));
  return (j.content || []).map((c) => c.text || '').join('');
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
      return { t: g('title'), link: g('link'), ts, src };
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
  const res = { ts: Date.now(), items };
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 3600 });
  memSet(ck, res, 8 * 60e3);
  return res;
}
function parseAIArray(out) { return JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)); }

async function news(env, idx) {
  const ck = 'news:' + idx;
  const c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 10 * 60e3) { memSet(ck, c, 10 * 60e3); return c; }
  const feed = await allFeeds(env);
  const items = feed.items.filter((i) => i.ts > Date.now() - 36 * 3600e3 && NEWS_KW[idx].test(i.t) && !RESULT_RE.test(i.t)).slice(0, 12);
  let scored = items.map((i) => ({ ...i, s: lexScore(i.t), imp: 'मध्यम', hi: '' }));
  let ai = false;
  if (env.ANTHROPIC_API_KEY && items.length) {
    try {
      const name = { NIFTY: 'Nifty 50', SENSEX: 'Sensex', BANKNIFTY: 'Bank Nifty' }[idx];
      const prompt = `You are a markets analyst for Indian index options traders. For each headline below, rate its likely short-term (today/this week) impact on the ${name} index.
Return ONLY a JSON array, one object per headline, in the same order: {"i": index, "s": score from -1 (very bearish) to 1 (very bullish), "imp": "ऊँचा" | "मध्यम" | "कम", "hi": short Hindi translation of the headline (max 14 words)}.
Headlines:
${items.map((x, i) => `${i}. ${x.t}`).join('\n')}`;
      const arr = parseAIArray(await claude(env, prompt, 1500));
      scored = items.map((x, i) => {
        const a = arr.find((z) => z.i === i) || {};
        return { ...x, s: typeof a.s === 'number' ? Math.max(-1, Math.min(1, a.s)) : lexScore(x.t), imp: a.imp || 'मध्यम', hi: a.hi || '' };
      });
      ai = true;
    } catch (e) { /* AI फ़ेल हो तो शब्दों वाला सरल स्कोर */ }
  }
  const res = { ts: Date.now(), ai, items: scored };
  await env.KV.put(ck, JSON.stringify(res), { expirationTtl: 3600 });
  memSet(ck, res, 10 * 60e3);
  return res;
}

// तिमाही नतीजे (Q1-Q4): पिछले 3 दिन की ख़बरों में से
async function results(env) {
  const ck = 'results:v1';
  const c = memGet(ck) || (await env.KV.get(ck, 'json'));
  if (c && c.ts > Date.now() - 15 * 60e3) { memSet(ck, c, 15 * 60e3); return c; }
  const feed = await allFeeds(env);
  const items = feed.items.filter((i) => i.ts > Date.now() - 72 * 3600e3 && RESULT_RE.test(i.t)).slice(0, 16);
  let out = items.map((i) => ({ ...i, co: '', q: (i.t.match(/\bQ[1-4](\s?FY\s?\d{2,4})?/i) || [''])[0].toUpperCase(), s: lexScore(i.t), hi: '' }));
  let ai = false;
  if (env.ANTHROPIC_API_KEY && items.length) {
    try {
      const prompt = `You read Indian company quarterly-results headlines for an index options trader.
Return ONLY a JSON array, one object per headline, same order: {"i": index, "co": company name (short, e.g. "HDFC Bank"), "q": quarter like "Q2 FY27" or "" if unknown, "s": -1 (clearly weak / missed) to 1 (clearly strong / beat), "hi": Hindi summary of the result (max 14 words)}.
Headlines:
${items.map((x, i) => `${i}. ${x.t}`).join('\n')}`;
      const arr = parseAIArray(await claude(env, prompt, 1800));
      out = out.map((x, i) => {
        const a = arr.find((z) => z.i === i) || {};
        return { ...x, co: a.co || '', q: a.q || x.q, s: typeof a.s === 'number' ? Math.max(-1, Math.min(1, a.s)) : x.s, hi: a.hi || '' };
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
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(400, 'AI key सेट नहीं है', 'NO_AI');
  const q = String(body.question || '').slice(0, 300);
  const ctx = JSON.stringify(body.context || {}).slice(0, 6000);
  const prompt = `तुम एक अनुभवी भारतीय F&O (इंडेक्स ऑप्शन) एनालिस्ट हो। यूज़र अपने निजी डैशबोर्ड से पूछ रहा है। नीचे डैशबोर्ड का अभी का डेटा JSON में है (इंडिकेटर्स, ऑप्शन चेन, लेवल, स्कोर)।
यूज़र का सवाल: "${q}"
डेटा: ${ctx}

नियम:
- सरल हिंदी में 4 से 6 छोटे वाक्य, बोलकर सुनाने लायक़ (कोई मार्कडाउन, बुलेट या इमोजी नहीं)।
- सिर्फ़ ऊपर के डेटा पर आधारित बात करो, अपनी तरफ़ से कोई नया आँकड़ा मत बनाओ।
- पहले बताओ कि संकेत उसकी दिशा के पक्ष में हैं या ख़िलाफ़, फिर 2-3 सबसे अहम कारण, फिर स्टॉप-लॉस और सबसे बड़ा जोखिम।
- कभी गारंटी मत दो। ये संभावना है, फ़ैसला यूज़र का है।`;
  const answer = await claude(env, prompt, 500);
  return { answer: answer.trim() };
}

/* ---------------- रूटर ---------------- */
async function route(req, env, url) {
  const p = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  if (p === '/auth/callback') return authCallback(req, env, url);
  if (p === '/auth/login') return authLogin(req, env, url);
  if (p === '/' || p === '/health') return json({ ok: true, name: 'F&O डैशबोर्ड Worker' }, 200, req, env);

  const email = await verifyUser(req, env);
  const idx = (url.searchParams.get('index') || 'NIFTY').toUpperCase();
  if (!['/api/status', '/api/ask', '/api/snapshot', '/api/results'].includes(p) && !INDEX[idx]) throw new HttpError(400, 'ग़लत इंडेक्स');

  switch (p) {
    case '/api/status': {
      const t = env.UPSTOX_ACCESS_TOKEN || (await env.KV.get('upstox_token'));
      return json({ email, upstox: !!t, ai: !!env.ANTHROPIC_API_KEY, tokenMode: env.UPSTOX_ACCESS_TOKEN ? 'analytics' : 'oauth' }, 200, req, env);
    }
    case '/api/snapshot': return json(await snapshot(env), 200, req, env);
    case '/api/candles': return json(await candles(env, idx), 200, req, env);
    case '/api/news': return json(await news(env, idx), 200, req, env);
    case '/api/results': return json(await results(env), 200, req, env);
    case '/api/ask': {
      if (req.method !== 'POST') throw new HttpError(405, 'POST चाहिए');
      return json(await ask(env, await req.json()), 200, req, env);
    }
    case '/api/upstox/logout': {
      await env.KV.delete('upstox_token'); MEM.delete('upstox_token');
      return json({ ok: true }, 200, req, env);
    }
  }
  throw new HttpError(404, 'रास्ता नहीं मिला');
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
