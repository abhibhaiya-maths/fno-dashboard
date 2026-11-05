/* ===== हेल्पर, इंडिकेटर (स्टैंडर्ड फ़ॉर्मूले, TradingView जैसे) और Black-Scholes ===== */
const $ = (id) => document.getElementById(id);
const ok = (v) => v != null && isFinite(v);
const f0 = (v) => (ok(v) ? Math.round(v).toLocaleString('en-IN') : '–');
const f1 = (v) => (ok(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–');
const f2 = (v) => (ok(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–');
const rs = (v) => (ok(v) ? '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–');
const sgn = (v) => (v > 0 ? '+' : '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hm = (m) => { const t = 555 + m; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
const tick05 = (v) => Math.max(0.05, Math.round(v * 20) / 20);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function hrand(n, seed) { const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453; return x - Math.floor(x); }
function istNow() { return new Date(Date.now() + 5.5 * 3600e3); }
function istYmd() { return istNow().toISOString().slice(0, 10); }
function istMin() { const n = istNow(); return n.getUTCHours() * 60 + n.getUTCMinutes() - 555; } // 09:15 = 0

function agg(s, t) {
  const out = []; let c = null;
  for (const k of s) {
    const key = k.d * 1000 + Math.floor(k.m / t);
    if (!c || c.key !== key) { c = { key, d: k.d, m: Math.floor(k.m / t) * t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }; out.push(c); }
    else { c.h = Math.max(c.h, k.h); c.l = Math.min(c.l, k.l); c.c = k.c; c.v += k.v; }
  }
  return out;
}
function sma(a, n) { const o = Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function ema(a, n) {
  const o = Array(a.length).fill(null), k = 2 / (n + 1), st = a.findIndex((v) => v != null);
  if (st < 0 || a.length - st < n) return o;
  let s = 0; for (let i = st; i < st + n; i++) s += a[i];
  let e = s / n; o[st + n - 1] = e;
  for (let i = st + n; i < a.length; i++) { e = a[i] * k + e * (1 - k); o[i] = e; }
  return o;
}
function rma(a, n, st = 0) {
  const o = Array(a.length).fill(null); if (a.length - st < n) return o;
  let s = 0; for (let i = st; i < st + n; i++) s += a[i];
  let v = s / n; o[st + n - 1] = v;
  for (let i = st + n; i < a.length; i++) { v = (v * (n - 1) + a[i]) / n; o[i] = v; }
  return o;
}
function trArr(k) { return k.map((x, i) => (i ? Math.max(x.h - x.l, Math.abs(x.h - k[i - 1].c), Math.abs(x.l - k[i - 1].c)) : x.h - x.l)); }
function atr(k, n = 14) { return rma(trArr(k), n); }
function rsi(c, n = 14) {
  const o = Array(c.length).fill(null); if (c.length <= n) return o;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n; o[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  return o;
}
function adx(k, n = 14) {
  const L = k.length, pdm = [0], mdm = [0];
  for (let i = 1; i < L; i++) { const up = k[i].h - k[i - 1].h, dn = k[i - 1].l - k[i].l; pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0); }
  const tr = trArr(k), at = rma(tr, n, 1), p = rma(pdm, n, 1), m = rma(mdm, n, 1), pdi = [], mdi = [], dx = [];
  for (let i = 0; i < L; i++) {
    if (!at[i]) { pdi.push(null); mdi.push(null); dx.push(null); continue; }
    const a = (100 * p[i]) / at[i], b = (100 * m[i]) / at[i];
    pdi.push(a); mdi.push(b); dx.push(a + b ? (100 * Math.abs(a - b)) / (a + b) : 0);
  }
  const f = dx.findIndex((v) => v != null);
  return { adx: f < 0 ? Array(L).fill(null) : rma(dx.map((v) => v ?? 0), n, f), pdi, mdi };
}
function supertrend(k, n = 10, mult = 3) {
  const a = atr(k, n), L = k.length, st = Array(L).fill(null), dir = Array(L).fill(null);
  let fu = null, fl = null, d = 1;
  for (let i = 0; i < L; i++) {
    if (a[i] == null) continue;
    const hl2 = (k[i].h + k[i].l) / 2, bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
    if (fu === null) { fu = bu; fl = bl; }
    else { const pc = k[i - 1].c; fu = bu < fu || pc > fu ? bu : fu; fl = bl > fl || pc < fl ? bl : fl; }
    if (d === 1 && k[i].c < fl) d = -1; else if (d === -1 && k[i].c > fu) d = 1;
    st[i] = d === 1 ? fl : fu; dir[i] = d;
  }
  return { st, dir };
}
function bbands(c, n = 20, m = 2) {
  const mid = sma(c, n), up = [], lo = [];
  for (let i = 0; i < c.length; i++) {
    if (mid[i] == null) { up.push(null); lo.push(null); continue; }
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n); up.push(mid[i] + m * sd); lo.push(mid[i] - m * sd);
  }
  return { mid, up, lo };
}
function macd(c) {
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const line = c.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const sig = ema(line, 9);
  return { line, sig, hist: line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null)) };
}
// इंडेक्स में वॉल्यूम नहीं होता, तब हर कैंडल का वज़न बराबर (TWAP)
function vwap(k, useVol) { let d = -1, pv = 0, vv = 0; return k.map((x) => { if (x.d !== d) { d = x.d; pv = 0; vv = 0; } const w = useVol ? x.v : 1; pv += ((x.h + x.l + x.c) / 3) * w; vv += w; return vv ? pv / vv : x.c; }); }
function ind(k, useVol) {
  const c = k.map((x) => x.c);
  return { k, c, ema9: ema(c, 9), ema20: ema(c, 20), ema50: ema(c, 50), vwap: vwap(k, useVol), bb: bbands(c), rsi: rsi(c), macd: macd(c), atr: atr(k), adx: adx(k), st: supertrend(k) };
}
function pattern(k) {
  if (k.length < 2) return ['कोई ख़ास पैटर्न नहीं', 0];
  const a = k[k.length - 2], b = k[k.length - 1];
  const body = Math.abs(b.c - b.o), rg = b.h - b.l || 1e-9, up = b.h - Math.max(b.o, b.c), dn = Math.min(b.o, b.c) - b.l;
  if (a.c < a.o && b.c > b.o && b.c >= a.o && b.o <= a.c) return ['बुलिश एंगल्फ़िंग', 1];
  if (a.c > a.o && b.c < b.o && b.o >= a.c && b.c <= a.o) return ['बेयरिश एंगल्फ़िंग', -1];
  if (body / rg < 0.1) return ['डोजी (अनिर्णय)', 0];
  if (dn >= 2 * body && up <= body * 0.5) return ['हैमर', 1];
  if (up >= 2 * body && dn <= body * 0.5) return ['शूटिंग स्टार', -1];
  if (body / rg > 0.7) return [b.c > b.o ? 'मज़बूत हरी कैंडल' : 'मज़बूत लाल कैंडल', b.c > b.o ? 1 : -1];
  return ['कोई ख़ास पैटर्न नहीं', 0];
}

/* Black-Scholes (भाव और ग्रीक्स) */
const RATE = 0.065;
function ncdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp((-x * x) / 2); const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x > 0 ? 1 - p : p; }
function npdf(x) { return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI); }
function bs(Sp, K, T, v, type) {
  v = Math.max(v || 0.12, 0.01); T = Math.max(T, 1e-5);
  const sq = Math.sqrt(T), d1 = (Math.log(Sp / K) + (RATE + (v * v) / 2) * T) / (v * sq), d2 = d1 - v * sq, df = Math.exp(-RATE * T);
  const gamma = npdf(d1) / (Sp * v * sq), vega = (Sp * npdf(d1) * sq) / 100;
  if (type === 'CE') return { price: Sp * ncdf(d1) - K * df * ncdf(d2), delta: ncdf(d1), gamma, vega, theta: ((-Sp * npdf(d1) * v) / (2 * sq) - RATE * K * df * ncdf(d2)) / 365, pitm: ncdf(d2) };
  return { price: K * df * ncdf(-d2) - Sp * ncdf(-d1), delta: ncdf(d1) - 1, gamma, vega, theta: ((-Sp * npdf(d1) * v) / (2 * sq) + RATE * K * df * ncdf(-d2)) / 365, pitm: ncdf(-d2) };
}
