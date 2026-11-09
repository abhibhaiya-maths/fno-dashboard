/* ===== विश्लेषण: डेटा → संकेत, स्कोर, लेवल, सेटअप ===== */
// Session windows, minutes from 09:15 IST: NSE/BSE 09:15–15:30, MCX 09:00–23:30
const SESS = { NSE: { o: 0, c: 375 }, MCX: { o: -15, c: 870 } };
// Engine settings (tuned by backtest on real Nifty / Bank Nifty / Sensex data)
const ENG = { mode: 'v1', enterUp: 58, enterDn: 42, coreNeed: 3, rangeADX: 18, chase: [3, 2, 4], pbBlock: true, v2need: 3.5, v2flip: true, dailyFilter: 'soft', confirm1m: true, failATR: 1.5, coolMin: 30, lastEntryMin: 0, t1R: 1.5, t2R: 2.5, trailR: 1, cprMax: 0.15, tdMax: 3, itm: 0, exitTwap: false, tstop: 0, oppExit: true };
// Two trading modes, both backtested on 54 days of Nifty / Bank Nifty / Sensex 1-minute data (costs included)
const ENG_MODES = {
  graded: { short: '★ Full Size · A Small · B Minimum · S Paper Or 1 Lot. Nothing Is Blocked By The Clock.', name: 'Graded', set: { itm: 0, mode: 'v1', confirm1m: true, dailyFilter: 'soft', t1R: 1.5, t2R: 2.5, trailR: 1, exitTwap: false, tstop: 0, oppExit: true, lastEntryMin: 0 },
    note: 'Recommended. Every setup runs side by side from 9:15 to 3:30 and the best one is shown with a grade that sets the size: ★ Prime (trend-day pullback, profitable over a full year: full size), A (intraday signal with the market context behind it: small size), B (context, daily trend or time of day against it: minimum size), S (1-minute scalp with the 5-minute trend: paper or 1 lot). Nothing is blocked by the clock.' },
  trend: { short: 'Only ★ Trend-Day Pullbacks On Nifty And Sensex. About 1 Trade A Day On Trend Days.', name: 'Trend-Day', set: { itm: 2, mode: 'trend', confirm1m: false, dailyFilter: false, t1R: 2, t2R: 99, trailR: 1, exitTwap: true, tstop: 20, oppExit: false, lastEntryMin: 30 },
    note: 'Only the ★ Prime setup, nothing else. Trades only on narrow-CPR (trend) days: pullback entries, exit on a TWAP break, a 20-minute time stop, the stop or the trail. 1-year backtest after costs: profitable in both half-years on Nifty and Sensex with futures (profit factor ~1.25) and slightly with 2-strike in-the-money options (~1.1); ATM options lose. About 1 trade a day per index. Bank Nifty is off (it lost money).' },
  active: { short: 'Every Intraday Signal, No Grades. For Practice.', name: 'Active', set: { itm: 0, mode: 'v1', confirm1m: true, dailyFilter: 'soft', t1R: 1.5, t2R: 2.5, trailR: 1, exitTwap: false, tstop: 0, oppExit: true, lastEntryMin: 0 },
    note: 'For practice and reading the market only. Many signals (4–5 a day), but over 1 year it was break-even before option costs (profit factor 0.95–1.05) and loses money after them.' },
  safe: { short: 'Only With The Daily Trend, Bigger Targets. For Practice.', name: 'Safe', set: { itm: 0, mode: 'v1', confirm1m: true, dailyFilter: true, t1R: 2, t2R: 4, trailR: 1.5, exitTwap: false, tstop: 0, oppExit: true, lastEntryMin: 0 },
    note: 'Only with the daily trend, bigger targets. Good on the 54-day test, but not proven over a full year. Use for practice.' },
};
let ENG_MODE = 'graded';
function setEngMode(m, quiet) {
  if (!ENG_MODES[m]) return; ENG_MODE = m; Object.assign(ENG, ENG_MODES[m].set);
  for (const id in SIGMEM) if (!id.startsWith(SIM.ns)) delete SIGMEM[id];
  if (!quiet) { try { Store.setPref('engMode3', m); } catch (e) { /* ignore */ } if (typeof refreshAll === 'function') refreshAll(); if (typeof toast === 'function') toast(`${ENG_MODES[m].name} mode: ${ENG_MODES[m].note}`); }
}
// Special sessions on non-working days (Diwali Muhurat etc.). Minutes counted from 09:15 IST. Add a line here for future ones.
const SPECIAL_SESS = {
  '2026-11-08': { name: 'Diwali Muhurat trading', o: 305, c: 375 }, // NSE/BSE 14:20–15:30 (pre-open 14:05–14:20)
};
function sessFor(cf, ymd) {
  const sp = SPECIAL_SESS[ymd];
  if (sp) return { o: sp.o, c: sp.c, special: sp.name };
  return (cf && cf.sess) || SESS.NSE;
}
const CFG = {
  NIFTY: { label: 'NIFTY 50', voice: 'निफ्टी', step: 50, exch: 'NSE', cons: 50, kind: 'INDEX', core: true, opt: true, key: 'NSE_INDEX|Nifty 50', sess: SESS.NSE },
  SENSEX: { label: 'SENSEX', voice: 'सेंसेक्स', step: 100, exch: 'BSE', cons: 30, kind: 'INDEX', core: true, opt: true, key: 'BSE_INDEX|SENSEX', sess: SESS.NSE },
  BANKNIFTY: { label: 'BANK NIFTY', voice: 'बैंक निफ्टी', step: 100, exch: 'NSE', cons: 12, kind: 'INDEX', core: true, opt: true, key: 'NSE_INDEX|Nifty Bank', sess: SESS.NSE },
};
let KEYS = Object.keys(CFG);
// Watchlist instruments (stocks, other indices, MCX futures) join the same engine
function addInst(it) {
  if (!it || !it.id || (CFG[it.id] && CFG[it.id].core)) return null;
  CFG[it.id] = { label: it.label || it.id, voice: it.name || it.label || it.id, name: it.name || it.label || it.id, step: it.step || null, exch: it.exch || 'NSE', cons: 0, kind: it.kind || 'EQ',
    core: false, opt: !!it.fo, key: it.key, ukey: it.ukey || null, sym: it.sym || it.id, lot: it.lot || null, expiry: it.expiry || null, sess: it.exch === 'MCX' ? SESS.MCX : SESS.NSE, demo: it.demo || null };
  KEYS = Object.keys(CFG);
  return CFG[it.id];
}
function removeInst(id) { if (CFG[id] && !CFG[id].core) { delete CFG[id]; KEYS = Object.keys(CFG); } }
const watchItems = () => KEYS.filter((k) => !CFG[k].core).map((k) => { const c = CFG[k]; return { id: k, label: c.label, name: c.name, key: c.key, ukey: c.ukey, exch: c.exch, kind: c.kind, fo: c.opt, lot: c.lot, sym: c.sym, expiry: c.expiry }; });
// Strike step: from the chain if available, else NSE-style steps by price
function autoStep(rows, price) {
  if (rows && rows.length > 3) {
    const d = {}; let best = null;
    for (let i = 1; i < rows.length; i++) { const g = +(rows[i].K - rows[i - 1].K).toFixed(2); if (g > 0) d[g] = (d[g] || 0) + 1; }
    for (const g in d) if (!best || d[g] > d[best]) best = g;
    if (best) return +best;
  }
  return price < 250 ? 2.5 : price < 500 ? 5 : price < 1000 ? 10 : price < 2500 ? 20 : price < 5000 ? 50 : 100;
}
const stdev = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
// Futures OI buildup: price vs open interest (the classic four states)
function buildup(dp, doi) {
  if (!ok(dp) || !ok(doi) || doi === 0 || dp === 0) return null;
  if (dp > 0 && doi > 0) return ['Long buildup', 1];
  if (dp < 0 && doi > 0) return ['Short buildup', -1];
  if (dp > 0 && doi < 0) return ['Short covering', 0.5];
  return ['Long unwinding', -0.5];
}

function nearestRow(rows, K) { let b = null; for (const r of rows) if (!b || Math.abs(r.K - K) < Math.abs(b.K - K)) b = r; return b; }
function sideIV(o) { return o && o.iv > 0 ? o.iv : null; }

function analyze(D) {
  const cf = CFG[D.key], s1 = D.candles, SS = sessFor(cf, D.dayDates ? D.dayDates[2] : '');
  const prev = s1.filter((x) => x.d === 1), today = s1.filter((x) => x.d === 2);
  if (!prev.length || !today.length) return null;
  const hasVol = today.some((x) => x.v > 0);
  const I5 = ind(agg(s1, 5), hasVol), k15 = agg(s1, 15), k60 = agg(s1, 60);
  const PH = Math.max(...prev.map((x) => x.h)), PL = Math.min(...prev.map((x) => x.l));
  const PC = ok(D.prevClose) ? D.prevClose : prev[prev.length - 1].c;
  const last = today[today.length - 1], price = ok(D.price) ? D.price : last.c, chg = ((price - PC) / PC) * 100, curMin = last.m;

  // पिवट और CPR (पिछले सत्र से)
  const p = (PH + PL + prev[prev.length - 1].c) / 3, bc0 = (PH + PL) / 2, tc0 = 2 * p - bc0, tc = Math.max(tc0, bc0), bc = Math.min(tc0, bc0);
  const piv = { R3: PH + 2 * (p - PL), R2: p + (PH - PL), R1: 2 * p - PL, P: p, S1: 2 * p - PH, S2: p - (PH - PL), S3: PL - 2 * (PH - p) };
  // ओपनिंग रेंज (पहले 15 मिनट)
  const or0 = today.filter((x) => x.m < SS.o + 15), or = or0.length ? or0 : today.slice(0, 1), ORH = Math.max(...or.map((x) => x.h)), ORL = Math.min(...or.map((x) => x.l));
  // दिन का हाई-लो और Fibonacci
  let DH = -Infinity, DL = Infinity, iH = 0, iL = 0;
  today.forEach((x, i) => { if (x.h > DH) { DH = x.h; iH = i; } if (x.l < DL) { DL = x.l; iL = i; } });
  const upSwing = iL < iH, fib = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((r) => ({ r, v: upSwing ? DH - (DH - DL) * r : DL + (DH - DL) * r }));
  // वॉल्यूम प्रोफ़ाइल (वॉल्यूम न हो तो TPO = हर मिनट का वज़न 1)
  const bins = 24, bw = (DH - DL) / bins || 1, vol = Array(bins).fill(0);
  today.forEach((x) => { const b = clamp(Math.floor(((x.h + x.l + x.c) / 3 - DL) / bw), 0, bins - 1); vol[b] += hasVol ? x.v : 1; });
  let poc = 0; vol.forEach((v, i) => { if (v > vol[poc]) poc = i; });
  const tot = vol.reduce((a, b) => a + b, 0); let lo = poc, hi = poc, acc = vol[poc];
  while (acc < 0.7 * tot && (lo > 0 || hi < bins - 1)) { const a = lo > 0 ? vol[lo - 1] : -1, b = hi < bins - 1 ? vol[hi + 1] : -1; if (b >= a) { hi++; acc += vol[hi]; } else { lo--; acc += vol[lo]; } }
  const VP = { bins, bw, vol, DL, poc, POC: DL + (poc + 0.5) * bw, VAL: DL + lo * bw, VAH: DL + (hi + 1) * bw, lo, hi };

  // ऑप्शन चेन
  const C = D.chain || { rows: [] }, rows = (C.rows || []).filter((r) => r.ce && r.pe);
  const dte = ok(C.dte) ? C.dte : 1, T = Math.max(dte, 0.02) / 365;
  const atmRow = rows.length ? nearestRow(rows, price) : null;
  const step = cf.step || autoStep(rows, price);
  const atm = atmRow ? atmRow.K : Math.round(price / step) * step;
  const atmIV = atmRow ? ((sideIV(atmRow.ce) || 0) + (sideIV(atmRow.pe) || 0)) / ((sideIV(atmRow.ce) ? 1 : 0) + (sideIV(atmRow.pe) ? 1 : 0) || 1) || 0.13 : 0.13;
  const fill = (o, K, type) => {
    // ग्रीक्स न मिलें तो Black-Scholes से निकालो
    const iv = sideIV(o) || atmIV, b = bs(price, K, T, iv, type);
    return { ...o, iv, de: o.de || b.delta, ga: o.ga || b.gamma, th: o.th || b.theta, ve: o.ve || b.vega, ltp: o.ltp || b.price };
  };
  rows.forEach((r) => { r.ce = fill(r.ce, r.K, 'CE'); r.pe = fill(r.pe, r.K, 'PE'); });
  const ai = atmRow ? rows.indexOf(atmRow) : 0, view = rows.slice(Math.max(0, ai - 8), ai + 9);
  let mp = null, mpv = Infinity;
  rows.forEach((a) => { let pain = 0; rows.forEach((b) => { pain += b.ce.oi * Math.max(0, a.K - b.K) + b.pe.oi * Math.max(0, b.K - a.K); }); if (pain < mpv) { mpv = pain; mp = a.K; } });
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const ceTot = sum((r) => r.ce.oi), peTot = sum((r) => r.pe.oi);
  const near = rows.filter((r) => Math.abs(r.K - price) <= step * 15);
  const maxCE = near.length ? near.reduce((a, b) => (b.ce.oi > a.ce.oi ? b : a)).K : null, maxPE = near.length ? near.reduce((a, b) => (b.pe.oi > a.pe.oi ? b : a)).K : null;
  const ceCh = sum((r) => r.ce.oi - (r.ce.poi || r.ce.oi)), peCh = sum((r) => r.pe.oi - (r.pe.poi || r.pe.oi));
  const ch = { step, rows, view, atm, atmRow, atmIV, T, dte, expiry: C.expiry, lot: C.lot, mp, pcr: ceTot ? peTot / ceTot : null, ceTot, peTot, ceChTot: ceCh, peChTot: peCh, maxCE, maxPE, straddle: atmRow ? atmRow.ce.ltp + atmRow.pe.ltp : null };

  // बाज़ार का मूड
  const hv = (D.hv || []).filter((h) => ok(h.c)).map((h) => ({ ...h, pts: ((price * h.w) / 100) * (h.c / 100) }));
  const hvW = hv.length ? hv.reduce((s, h) => s + h.w * h.c, 0) / hv.reduce((s, h) => s + h.w, 0) : null;
  const news = D.news || [], newsAvg = news.length ? news.reduce((s, n) => s + n.s, 0) / news.length : null;
  const vix = D.vix || null;
  const isIdx = cf.kind === 'INDEX', isMCX = cf.exch === 'MCX';

  // Futures OI buildup: day (vs previous close / OI) and last 30 minutes
  let fut = null;
  {
    const F = D.fut, own = isMCX ? today.filter((x) => x.oi > 0) : null;
    const series = own && own.length ? own.map((x) => [x.m, x.c, x.oi]) : F && F.c && F.c.length ? F.c : null;
    if (series && series.length) {
      const L0 = series[series.length - 1], p30 = series.find((x) => x[0] >= L0[0] - 30) || series[0];
      const pc = own ? PC : F.prevClose, poi = own ? (D.prevOi || null) : F.prevOi;
      const day = buildup(ok(pc) ? L0[1] - pc : null, ok(poi) && poi > 0 ? L0[2] - poi : null);
      const d30oi = L0[2] - p30[2], m30 = series.length > 5 && Math.abs(d30oi) / (L0[2] || 1) > 0.002 ? buildup(L0[1] - p30[1], d30oi) : null;
      fut = { day, m30, oi: L0[2], doi: ok(poi) && poi > 0 ? ((L0[2] - poi) / poi) * 100 : null, d30: L0[2] ? (d30oi / L0[2]) * 100 : null, px: L0[1], basis: L0[1] - price, expiry: F && F.expiry };
    }
  }
  // Volatility regime: IV percentile (India VIX, 1 year) for indices; IV vs 20-day realised volatility for stocks
  let vlt = null;
  {
    const dr = D.daily && D.daily.rows || [], closes = dr.map((x) => x[4]);
    const rets = []; for (let i = Math.max(1, closes.length - 20); i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
    const hv20 = rets.length >= 10 ? stdev(rets) * Math.sqrt(252) : null;
    const yr = dr.slice(-252);
    vlt = { hv20, hi52: yr.length ? Math.max(...yr.map((x) => x[2]), DH) : null, lo52: yr.length ? Math.min(...yr.map((x) => x[3]), DL) : null };
    const wk = dr.slice(-5); if (wk.length) { vlt.pwH = Math.max(...wk.map((x) => x[2])); vlt.pwL = Math.min(...wk.map((x) => x[3])); }
    if (isIdx && D.vixDaily && D.vixDaily.length > 100 && vix) {
      const vs = D.vixDaily.slice(-252).map((x) => x[4]), mn = Math.min(...vs), mx = Math.max(...vs);
      vlt.ivp = Math.round((vs.filter((v) => v < vix.v).length / vs.length) * 100); vlt.ivr = Math.round(((vix.v - mn) / (mx - mn || 1)) * 100); vlt.src = 'India VIX, 1 year';
    }
    if (ok(hv20) && rows.length && atmIV) vlt.ivhv = atmIV / hv20;
  }
  // Global cues: Asia live, US last close, Europe after 13:30 IST; crude for MCX crude
  let glob = null;
  {
    const G = (D.glob || []).filter((g) => ok(g.chg));
    const pickG = (re) => G.filter((g) => re.test(g.name + ' ' + (g.sym || '')));
    let set;
    if (isMCX) set = /CRUDE/i.test(cf.sym || cf.label) ? pickG(/brent|wti|bzusd|clusd|crude|oil/i) : [];
    else set = pickG(/dow|s&p|us tech|us 30|nikkei|hang seng|dax|ftse|cac/i);
    if (set.length) glob = { items: set, avg: set.reduce((x, g) => x + g.chg, 0) / set.length };
    const gift = pickG(/gift|sgx/i)[0];
    if (gift && cf.key === 'NSE_INDEX|Nifty 50' && ok(D.prevClose)) glob = { ...(glob || { items: [], avg: null }), gift, gap: gift.price - D.prevClose };
  }
  // Event risk (calendar): high-impact events today or before tomorrow's open
  const events = (D.events || []).filter((e) => e.imp === 'high' && (e.date === istYmd() || (e.date === new Date(Date.now() + 5.5 * 3600e3 + 86400e3).toISOString().slice(0, 10) && e.time < '09:15')));

  // संकेत
  const L = I5.k.length - 1, g = (a) => a[L];
  const vw = g(I5.vwap), e20 = g(I5.ema20), e50 = g(I5.ema50), stD = g(I5.st.dir), stV = g(I5.st.st), mh = g(I5.macd.hist), rsv = g(I5.rsi);
  const ax = g(I5.adx.adx), pdi = g(I5.adx.pdi), mdi = g(I5.adx.mdi), bm = g(I5.bb.mid), bu = g(I5.bb.up), bl = g(I5.bb.lo), at = g(I5.atr) || (DH - DL) / 5 || price * 0.001;
  const pat = pattern(I5.k);
  const e15 = ema(k15.map((x) => x.c), 20).pop(), e60 = ema(k60.map((x) => x.c), 9).pop();
  const c15 = k15[k15.length - 1].c, c60 = k60[k60.length - 1].c;
  const mtf = (ok(e15) ? (c15 > e15 ? 1 : -1) : 0) + (ok(e60) ? (c60 > e60 ? 1 : -1) : 0);
  const fibPos = (price - DL) / (DH - DL || 1);
  // Two tiers, the way a trader reads a chart: PRICE ACTION decides the direction, CONTEXT (options data, flows, news)
  // only adds conviction. Context is capped at 25% of the score so a bullish backdrop can't hide a falling market.
  const CTX = { Options: 1, 'Market mood': 1, News: 1, Context: 1 };
  const sigs = [], add = (gp, n, v, s, w) => sigs.push({ g: gp, n, v, s: ok(s) ? s : 0, w, t: CTX[gp] ? 'c' : 'p' });
  // Intraday structure from 5-minute swing points (today only): higher highs + higher lows, or lower highs + lower lows
  const k5t = I5.k.filter((x) => x.d === 2), swH = [], swL = [];
  for (let i = 2; i < k5t.length - 2; i++) {
    const x = k5t[i];
    if (x.h >= k5t[i - 1].h && x.h >= k5t[i - 2].h && x.h > k5t[i + 1].h && x.h > k5t[i + 2].h) swH.push(x.h);
    if (x.l <= k5t[i - 1].l && x.l <= k5t[i - 2].l && x.l < k5t[i + 1].l && x.l < k5t[i + 2].l) swL.push(x.l);
  }
  // the unfinished leg counts too: a fresh low below the last swing low is already a lower low
  const lastL = k5t.length ? Math.min(...k5t.slice(-3).map((x) => x.l)) : null, lastH = k5t.length ? Math.max(...k5t.slice(-3).map((x) => x.h)) : null;
  let struct = 0, structV = 'Not enough swings yet';
  if (swH.length >= 1 && swL.length >= 1) {
    const h2 = swH.slice(-2), l2 = swL.slice(-2);
    const hh = h2.length === 2 ? h2[1] > h2[0] : lastH > h2[0], hl = l2.length === 2 ? l2[1] > l2[0] : lastL > l2[0];
    const lh = h2.length === 2 ? h2[1] < h2[0] : lastH < h2[0], ll = l2.length === 2 ? l2[1] < l2[0] : lastL < l2[0];
    if (lastL < l2[l2.length - 1] - at * 0.1 && (lh || price < h2[h2.length - 1])) { struct = -1; structV = 'Breaking below the last swing low'; }
    else if (lastH > h2[h2.length - 1] + at * 0.1 && (hl || price > l2[l2.length - 1])) { struct = 1; structV = 'Breaking above the last swing high'; }
    else if (hh && hl) { struct = 1; structV = 'Higher highs, higher lows'; }
    else if (lh && ll) { struct = -1; structV = 'Lower highs, lower lows'; }
    else structV = 'Mixed swings (range)';
  }
  // Momentum over the last 30 minutes, measured in ATRs so it means the same for Nifty, Reliance or crude
  const c30 = I5.k.length > 6 ? I5.k[I5.k.length - 7].c : null, mv30 = ok(c30) ? price - c30 : null, mvA = ok(mv30) && at ? mv30 / at : null;
  const vwName = hasVol ? 'Price vs VWAP' : 'Price vs TWAP (index has no volume)';
  add('Trend', vwName, f1(vw), price > vw ? 1 : -1, 2);
  add('Trend', 'EMA 20 / EMA 50', `${f0(e20)} / ${f0(e50)}`, ok(e50) ? (e20 > e50 ? 1 : -1) : 0, ok(e50) ? 2 : 0);
  add('Trend', 'Supertrend (10,3)', f1(stV), stD, ok(stV) ? 2 : 0);
  add('Trend', 'ADX (14) trend strength', `ADX ${f1(ax)}, +DI ${f1(pdi)}, −DI ${f1(mdi)}`, ok(ax) && ax >= 20 ? (pdi > mdi ? 1 : -1) : 0, ok(ax) ? 1.5 : 0);
  add('Trend', 'Price structure (5m swings)', structV, struct, swH.length && swL.length ? 2 : 0);
  add('Momentum', 'Last 30 minutes', ok(mv30) ? `${sgn(mv30)}${f1(mv30)} (${sgn(mvA)}${f1(mvA)} ATR)` : '–', ok(mvA) ? (mvA > 0.8 ? 1 : mvA < -0.8 ? -1 : mvA / 0.8 * 0.5) : 0, ok(mvA) ? 1.5 : 0);
  add('Trend', 'Multi-timeframe (15m + 1h)', mtf === 2 ? 'Both up' : mtf === -2 ? 'Both down' : 'Mixed', mtf / 2, 1.5);
  // In a strong trend RSI pinned at an extreme is strength, not a reversal signal
  const trending = ok(ax) && ax >= 25;
  const rsiS = rsv > 70 ? (trending && pdi > mdi ? 1 : 0) : rsv < 30 ? (trending && mdi > pdi ? -1 : 0) : rsv > 55 ? 1 : rsv < 45 ? -1 : 0;
  add('Momentum', 'RSI (14)', f1(rsv) + (rsv > 70 ? (trending ? ' overbought, strong uptrend' : ' overbought') : rsv < 30 ? (trending ? ' oversold, strong downtrend' : ' oversold') : ''), rsiS, ok(rsv) ? 1 : 0);
  add('Momentum', 'MACD histogram', f2(mh), mh > 0 ? 1 : -1, ok(mh) ? 1 : 0);
  add('Momentum', 'Bollinger (20,2) %B', ok(bu) ? f1(((price - bl) / (bu - bl || 1)) * 100) + '%' : '–', price > bm ? 1 : -1, ok(bm) ? 0.5 : 0);
  add('Momentum', 'Candle pattern (5m)', pat[0], pat[1], 1);
  add('Levels', 'CPR', price > tc ? 'Above TC' : price < bc ? 'Below BC' : 'Inside CPR', price > tc ? 1 : price < bc ? -1 : 0, 1);
  const orForming = curMin < SS.o + 15;
  add('Levels', 'Opening range (15m)', orForming ? 'Forming' : price > ORH ? 'High breakout' : price < ORL ? 'Low breakdown' : 'Inside range', orForming ? 0 : price > ORH ? 1 : price < ORL ? -1 : 0, 1.5);
  add('Levels', hasVol ? 'Volume profile POC' : 'TPO profile POC', f1(VP.POC), price > VP.POC ? 1 : -1, 1);
  add('Levels', 'Fibonacci (day range)', `${Math.round(fibPos * 100)}% of range`, fibPos > 0.5 ? 1 : -1, 0.5);
  add('Options', 'PCR', f2(ch.pcr), ch.pcr > 1.2 ? 1 : ch.pcr < 0.8 ? -1 : 0, ok(ch.pcr) ? 1 : 0);
  add('Options', 'OI change (PE vs CE)', `PE ${sgn(peCh)}${f1(peCh / 1e5)}L, CE ${sgn(ceCh)}${f1(ceCh / 1e5)}L`, peCh > ceCh + Math.abs(ceCh) * 0.1 ? 1 : ceCh > peCh + Math.abs(peCh) * 0.1 ? -1 : 0, rows.length ? 1.5 : 0);
  add('Options', 'Max pain', f0(mp), mp == null ? 0 : price < mp - step / 2 ? 1 : price > mp + step / 2 ? -1 : 0, mp == null ? 0 : dte <= 2 ? 1 : 0.5);
  {
    // last 30 min is live price action; since-yesterday is background context
    add('Derivatives', 'Futures OI, last 30 min', fut ? (fut.m30 ? fut.m30[0] + (ok(fut.d30) ? `, OI ${sgn(fut.d30)}${f2(fut.d30)}%` : '') : 'No clear buildup') : 'No futures data', fut && fut.m30 ? fut.m30[1] : 0, fut ? 1.5 : 0);
    add('Context', 'Futures OI, since yesterday', fut ? (fut.day ? fut.day[0] : 'Flat') + (ok(fut.doi) ? `, OI ${sgn(fut.doi)}${f1(fut.doi)}%` : '') : 'No futures data', fut && fut.day ? fut.day[1] : 0, fut && fut.day ? 1 : 0);
  }
  if (!isMCX) {
    add('Market mood', 'India VIX', vix ? `${f2(vix.v)} (${vix.v < vix.prev ? 'falling' : 'rising'})` : 'No data', vix ? (vix.v < vix.prev ? 1 : -1) : 0, vix ? 0.5 : 0);
    add('Market mood', 'FII cash, previous day (₹ cr)', ok(D.fii) ? sgn(D.fii) + f0(D.fii) + (D.fiiSrc ? ` (${D.fiiSrc})` : '') : 'No data', ok(D.fii) ? (D.fii > 0 ? 1 : -1) : 0, ok(D.fii) ? 0.5 : 0);
  }
  if (isIdx && cf.core) add('Market mood', 'Heavyweight stocks', ok(hvW) ? sgn(hvW) + f2(hvW) + '%' : 'No data', ok(hvW) ? (hvW > 0.2 ? 1 : hvW < -0.2 ? -1 : 0) : 0, ok(hvW) ? 1 : 0);
  else if (!isMCX && D.mkt && ok(D.mkt.chg)) {
    const rel = chg - D.mkt.chg;
    add('Market mood', 'Relative strength vs Nifty', `${sgn(rel)}${f2(rel)}% (Nifty ${sgn(D.mkt.chg)}${f2(D.mkt.chg)}%)`, rel > 0.3 ? 1 : rel < -0.3 ? -1 : 0, 1);
    add('Market mood', 'Broad market (Nifty score)', String(D.mkt.score), D.mkt.score >= 58 ? 1 : D.mkt.score <= 42 ? -1 : 0, 1);
  }
  add('Market mood', isMCX ? 'Global crude (Brent / WTI)' : 'Global cues (US close, Asia, Europe)', glob && ok(glob.avg) ? `${sgn(glob.avg)}${f2(glob.avg)}% avg of ${glob.items.length}` : 'No data', glob && ok(glob.avg) ? (glob.avg > 0.25 ? 1 : glob.avg < -0.25 ? -1 : 0) : 0, glob && ok(glob.avg) ? (isMCX ? 1.5 : 0.5) : 0);
  add('News', 'News sentiment', ok(newsAvg) ? f2(newsAvg) : 'No news', ok(newsAvg) ? (newsAvg > 0.15 ? 1 : newsAvg < -0.15 ? -1 : 0) : 0, ok(newsAvg) ? 1 : 0);
  const tierN = (t) => { const xs = sigs.filter((x) => x.t === t && x.w > 0), w = xs.reduce((s, x) => s + x.w, 0); return w ? xs.reduce((s, x) => s + x.w * x.s, 0) / w : null; };
  const paN = tierN('p'), cxN = tierN('c');
  const blend = ok(paN) && ok(cxN) ? 0.75 * paN + 0.25 * cxN : ok(paN) ? paN : ok(cxN) ? cxN : 0;
  const score = Math.round(50 + 50 * blend);
  const active = sigs.filter((x) => x.w > 0).length;
  // Trend core: the five price tools a trader checks first. A setup must have at least 3 of 5 on its side.
  const coreN = [vwName, 'Supertrend (10,3)', 'EMA 20 / EMA 50', 'Price structure (5m swings)', 'Last 30 minutes'];
  const core = sigs.filter((x) => coreN.includes(x.n) && x.w > 0);
  const coreUp = core.filter((x) => x.s >= 0.5).length, coreDn = core.filter((x) => x.s <= -0.5).length;
  const raw = score >= ENG.enterUp ? 'CE' : score <= ENG.enterDn ? 'PE' : null;
  let dir = raw, gate = null;
  if (raw === 'CE' && coreUp < ENG.coreNeed) { dir = null; gate = coreDn >= 3 ? `Options data and mood look bullish, but price is falling (${coreDn} of ${core.length} trend tools down). Don't buy calls into a fall.` : `Only ${coreUp} of ${core.length} trend tools are up. Wait for price to confirm.`; }
  if (raw === 'PE' && coreDn < ENG.coreNeed) { dir = null; gate = coreUp >= 3 ? `Options data and mood look bearish, but price is rising (${coreUp} of ${core.length} trend tools up). Don't buy puts into a rally.` : `Only ${coreDn} of ${core.length} trend tools are down. Wait for price to confirm.`; }
  // No trend (low ADX, no swing structure): option buyers lose to time decay in a range, so stand aside
  if (dir && ok(ax) && ax < ENG.rangeADX && struct === 0) { dir = null; gate = `Range-bound market (ADX ${f1(ax)}, no swing trend). Option buyers lose to time decay in a range; wait for a breakout.`; }

  const lv = [...Object.entries(piv), ...(vlt && ok(vlt.pwH) ? [['Prev week high', vlt.pwH], ['Prev week low', vlt.pwL]] : []), ['CPR TC', tc], ['CPR BC', bc], ['Opening high', ORH], ['Opening low', ORL], ['Day high', DH], ['Day low', DL], ['VAH', VP.VAH], ['VAL', VP.VAL], ['POC', VP.POC], ['VWAP', vw]];
  if (ok(maxCE)) lv.push(['Call OI wall', maxCE]);
  if (ok(maxPE)) lv.push(['Put OI wall', maxPE]);
  const res = lv.filter((x) => x[1] > price + at * 0.05).sort((a, b) => a[1] - b[1])[0], sup = lv.filter((x) => x[1] < price - at * 0.05).sort((a, b) => b[1] - a[1])[0];

  const A0 = { key: D.key, cf, D, price, chg, PC, curMin, sessionLive: D.sessionLive, dayLabels: D.dayLabels, hasVol, I5, piv, tc, bc, p, ORH, ORL, DH, DL, fib, upSwing, VP, ch, hv, hvW, news, newsAvg, vix, fii: D.fii, dii: D.dii,
    adxV: ax, sigs, score, active, paScore: ok(paN) ? Math.round(50 + 50 * paN) : null, cxScore: ok(cxN) ? Math.round(50 + 50 * cxN) : null, dir, gate, coreUp, coreDn, coreN: core.length, struct, mvA, atr: at, rsi: rsv, adx: ax, res, sup, stV, stD, vw, lot: C.lot || cf.lot || APP_CONFIG.LOT_FALLBACK[D.key] || null, fut, vol: vlt, glob, events, isIdx, isMCX, SS };
  Object.assign(A0, { e20, e50, mtf, lv, PH, PL });
  try { A0.short = shortTerm(A0); } catch (e) { A0.short = null; }
  try { A0.long = longTerm(A0); } catch (e) { A0.long = null; }
  try { refine(A0); } catch (e) { A0.pb = null; }
  try { studyAll(A0); } catch (e) { console.warn('structure', e); }
  if (ENG.mode === 'v2') { try { decideV2(A0); } catch (e) { console.warn('v2', e); } }
  if (ENG.mode === 'trend') { try { decideTD(A0); } catch (e) { console.warn('trend', e); } }
  try { A0.tdi = tdRead(A0); } catch (e) { A0.tdi = null; }
  try { A0.brain = typeof brainOf === 'function' ? brainOf(A0) : null; } catch (e) { console.warn('brain', e); A0.brain = null; }
  return A0;
}

/* ===== Trade quality: how professionals avoid the three classic option-buyer losses =====
   1. Mistaking a pullback inside a trend for a reversal (buying puts on the dip of an uptrend).
   2. Chasing: buying after the move is already stretched far from its average.
   3. Costs: wide bid-ask spreads and targets too small to beat brokerage + taxes. */
// Last impulse leg on 5-minute candles and how much of it has been retraced (Fibonacci)
function pullbackOf(a) {
  const k = a.I5.k.slice(-48), at = a.atr, price = a.price;
  const up = ok(a.e50) && a.e20 > a.e50 && a.mtf >= 1, dn = ok(a.e50) && a.e20 < a.e50 && a.mtf <= -1;
  if ((!up && !dn) || k.length < 8 || !at) return null;
  const d = up ? 1 : -1;
  let ix = 0; k.forEach((x, i) => { if (up ? x.h >= k[ix].h : x.l <= k[ix].l) ix = i; });
  const ext = up ? k[ix].h : k[ix].l, before = k.slice(0, ix + 1), after = k.slice(ix);
  const base = up ? Math.min(...before.map((x) => x.l)) : Math.max(...before.map((x) => x.h));
  const leg = Math.abs(ext - base);
  if (leg < 2 * at) return null; // no real impulse to pull back from
  const retr = (up ? ext - price : price - ext) / leg;
  const pullX = up ? Math.min(...after.map((x) => x.l)) : Math.max(...after.map((x) => x.h)); // deepest point of the pullback
  const lvl = (r) => ext - d * leg * r;
  const barsSince = k.length - 1 - ix;
  let state = 'trend';
  if (barsSince >= 2 && retr >= 0.236) state = retr > 0.786 || (up ? pullX < base : pullX > base) ? 'failed' : 'pullback';
  const inZone = state === 'pullback' && retr >= 0.33 && retr <= 0.68;
  // resumption trigger: the 1-minute engine leans back to the trend
  const sh = a.short, shLean = sh ? (up ? sh.score : 100 - sh.score) : 50;
  const trigger = state === 'pullback' && (sh && sh.dir === (up ? 'CE' : 'PE') || shLean >= 57);
  return { trend: up ? 'CE' : 'PE', d, ext, base, leg, retr, pullX, state, inZone, trigger, z382: lvl(0.382), z50: lvl(0.5), z618: lvl(0.618), z786: lvl(0.786), barsSince };
}
/* v2: price-led direction. The 5-minute swing structure (closes beyond swings), VWAP side, fast EMAs, Supertrend and
   30-minute momentum vote; the slower score only grades strength. Flips as soon as structure breaks and VWAP is lost. */
/* Trend-Day mode: the one setup that stayed profitable over a full year of Nifty and Sensex 1-minute data after
   realistic costs (in-the-money option or futures, slippage, a human's reaction time):
   only on narrow-CPR days, enter a pullback to the 5-minute 20-EMA when the trend state (above TWAP, Supertrend up,
   EMA 9 above EMA 20) resumes; exit on a TWAP break, a 20-minute time stop, the stop or the trail. */
function decideTD(a) {
  a.td = { on: true };
  if (!a.sessionLive) { a.dir = null; a.gate = 'Market closed. Trend-Day mode checks the CPR and trend at the next open.'; return; }
  const K = a.I5.k, closedNow = (a.curMin + 1) % 5 === 0, i = closedNow ? K.length - 1 : K.length - 2;
  const cprW = (Math.abs(a.tc - a.bc) / a.price) * 100, nm = (d) => (d > 0 ? (a.cf.opt ? 'CALL' : 'long') : a.cf.opt ? 'PUT' : 'short');
  a.td.cpr = cprW; a.td.trendDay = cprW < ENG.cprMax;
  if (/BANK/.test(a.key)) { a.gate = 'Trend-Day mode is off for Bank Nifty: the same rules lost money on it over the past year. Use Nifty or Sensex, or switch mode to practise.'; a.td.reason = 'bank'; return; }
  a.dir = null; a.setupType = 'trend';
  if (i < 2 || K[i].d !== 2) { a.gate = 'Trend-Day mode: waiting for the first 5-minute bars.'; return; }
  const e9 = a.I5.ema9, e20 = a.I5.ema20, tw = a.I5.vwap, st = a.I5.st.dir, at = a.I5.atr;
  const S = (j) => (K[j].c > tw[j] && st[j] > 0 && e9[j] > e20[j] ? 1 : K[j].c < tw[j] && st[j] < 0 && e9[j] < e20[j] ? -1 : 0);
  const s = S(i); a.td.state = s;
  if (!a.td.trendDay) { a.gate = `Not a trend day: yesterday's CPR is ${f2(cprW)}% wide (needs under ${ENG.cprMax}%). On wide-CPR days, trend trades lost money over the past year after costs. No trades today in Trend-Day mode.`; a.td.reason = 'cpr'; return; }
  const ix = Math.floor(K[i].m / 5);
  if (ix < 6) { a.gate = 'Trend day (narrow CPR). Entries start after 09:45.'; return; }
  if (!s) { a.gate = `Trend day (CPR ${f2(cprW)}%), but price, TWAP, Supertrend and EMAs don't agree yet. Wait.`; return; }
  const trig = (j) => { const sj = S(j); if (!sj || K[j].d !== 2 || Math.floor(K[j].m / 5) < 6) return 0; const x = K[j], p = K[j - 1];
    const touched = sj > 0 ? p.l <= e20[j - 1] + 0.2 * at[j] : p.h >= e20[j - 1] - 0.2 * at[j];
    return touched && (sj > 0 ? x.c > p.h : x.c < p.l) ? sj : 0; };
  // at most ENG.tdMax entries a day (the backtest allowed 3): count earlier triggers today
  let nTrig = 0; for (let j = 2; j < i; j++) if (K[j].d === 2 && trig(j)) nTrig++;
  a.td.bar = K[i].m;
  if (trig(i) && nTrig >= ENG.tdMax) { a.gate = `Trend day: ${ENG.tdMax} entries already today. The backtest stopped there; more trades added cost, not profit.`; return; }
  if (trig(i)) { a.dir = s > 0 ? 'CE' : 'PE'; a.setupType = 'pullback'; a.pbNote = `Trend-day ${s > 0 ? 'buy the dip' : 'sell the rally'}: the ${s > 0 ? 'up' : 'down'}trend pulled back to its 5-minute 20-EMA and the last bar closed beyond the previous bar.`; a.td.entry = true; return; }
  a.trendDir = s > 0 ? 'CE' : 'PE';
  a.gate = `Trend day, ${s > 0 ? 'uptrend' : 'downtrend'}. Wait for a pullback to the 5-minute 20-EMA (about ${f0(e20[i])}) and a bar that closes back ${s > 0 ? 'above the previous high' : 'below the previous low'}, then ${nm(s)}.`;
}

/* The same Trend-Day setup, read in every mode without taking over the signal: gives the ★ Prime grade.
   A trigger counts for 10 minutes after its 5-minute bar closes, while the trend state still holds. */
function tdRead(a) {
  const T = { cpr: null, trendDay: false, bank: /BANK/.test(a.key), star: null };
  if (!a.sessionLive || !a.I5 || !ok(a.tc) || !ok(a.bc) || !a.cf.core && !a.cf.opt) return T;
  const K = a.I5.k, closedNow = (a.curMin + 1) % 5 === 0, i = closedNow ? K.length - 1 : K.length - 2, SS = a.SS || SESS.NSE;
  T.cpr = (Math.abs(a.tc - a.bc) / a.price) * 100; T.trendDay = T.cpr < ENG.cprMax;
  if (i < 2 || K[i].d !== 2) return T;
  const e9 = a.I5.ema9, e20 = a.I5.ema20, tw = a.I5.vwap, st = a.I5.st.dir, at = a.I5.atr;
  const S = (j) => (K[j].c > tw[j] && st[j] > 0 && e9[j] > e20[j] ? 1 : K[j].c < tw[j] && st[j] < 0 && e9[j] < e20[j] ? -1 : 0);
  const trig = (j) => { const sj = S(j); if (!sj || K[j].d !== 2 || Math.floor((K[j].m - SS.o) / 5) < 6 || K[j].m >= SS.c - 30) return 0; const x = K[j], p = K[j - 1];
    const touched = sj > 0 ? p.l <= e20[j - 1] + 0.2 * at[j] : p.h >= e20[j - 1] - 0.2 * at[j];
    return touched && (sj > 0 ? x.c > p.h : x.c < p.l) ? sj : 0; };
  T.state = S(i); T.e20 = e20[i];
  let n = 0, last = null;
  for (let j = 2; j <= i; j++) { const t = trig(j); if (t) { n++; last = { j, m: K[j].m, dir: t, n, stop: t > 0 ? Math.min(K[j - 1].l, K[j].l) : Math.max(K[j - 1].h, K[j].h) }; } }
  T.n = n; T.last = last;
  if (T.trendDay && !T.bank && last && last.n <= ENG.tdMax && T.state === last.dir && a.curMin - (last.m + 4) <= 10 && (a.price - last.stop) * last.dir > 0)
    T.star = { dir: last.dir > 0 ? 'CE' : 'PE', m: last.m, stop: last.stop, note: `Trend-day ${last.dir > 0 ? 'buy the dip' : 'sell the rally'}: narrow CPR (${f2(T.cpr)}%), the ${last.dir > 0 ? 'up' : 'down'}trend pulled back to its 5-minute 20-EMA and the ${hm(last.m)} bar closed beyond the previous bar.` };
  return T;
}

function decideV2(a) {
  if (!a.sessionLive) return;
  const X = a.stx, c = a.I5.k.map((x) => x.c), L = c.length - 1, e9 = ema(c, 9)[L], e21 = ema(c, 21)[L];
  const v = [];
  if (X) v.push([X.trend, 2, '5-minute structure']);
  if (ok(a.vw)) v.push([a.price > a.vw ? 1 : -1, 1.5, 'VWAP side']);
  if (ok(e21)) v.push([e9 > e21 ? 1 : -1, 1, 'EMA 9/21']);
  if (ok(a.stD)) v.push([a.stD, 1, 'Supertrend']);
  if (ok(a.mvA) && Math.abs(a.mvA) >= 0.5) v.push([Math.sign(a.mvA), 1, '30-min momentum']);
  const tot = v.reduce((s, x) => s + x[0] * x[1], 0), max = v.reduce((s, x) => s + x[1], 0);
  a.v2 = { tot, max, votes: v };
  let dir = tot >= ENG.v2need && a.price > a.vw ? 'CE' : tot <= -ENG.v2need && a.price < a.vw ? 'PE' : null, gate = null;
  // fresh change of character + VWAP lost = the old direction is over right now
  if (ENG.v2flip && X && X.state === 'choch' && X.last && a.I5.k.length - 1 - X.last.j <= 3) { const d = X.last.dir > 0 ? 'CE' : 'PE'; if ((d === 'CE') === (a.price > a.vw)) dir = d; }
  if (!dir) gate = `Price tools are split (${f1(tot)} of ±${f1(max)}). Wait for structure and VWAP to line up.`;
  if (dir && ok(a.adx) && a.adx < 15 && X && X.state === 'range') { dir = null; gate = `Range-bound market (ADX ${f1(a.adx)}, no swing trend). Wait for a breakout.`; }
  // only an extreme, still-accelerating stretch blocks entry
  if (dir && ok(a.e20) && a.atr) { const sd = dir === 'CE' ? 1 : -1, ext = ((a.price - a.e20) * sd) / a.atr, burst = ok(a.mvA) ? a.mvA * sd : 0; if (ext > 4 && burst > 2.5) { dir = null; a.chase = true; gate = `Extended: price is ${f1(ext)} ATR from its 20-EMA after a burst. Wait for a pause.`; } }
  a.dir = dir; a.gate = gate; a.setupType = a.setupType === 'pullback' && dir === (a.pb && a.pb.trend) ? 'pullback' : 'trend';
  // the score now follows the vote, so the gauge and the signal tell the same story
  a.score = Math.round(50 + 50 * (0.8 * (tot / (max || 1)) + 0.2 * ((a.score - 50) / 50)));
  a.coreUp = v.filter((x) => x[0] > 0).length; a.coreDn = v.filter((x) => x[0] < 0).length; a.coreN = v.length;
}

function refine(a) {
  const pb = pullbackOf(a), nm = (x) => (x === 'CE' ? (a.cf.opt ? 'CALL' : 'long') : a.cf.opt ? 'PUT' : 'short');
  a.pb = pb; a.setupType = 'trend';
  if (pb) {
    const pct = Math.round(pb.retr * 100), word = pb.trend === 'CE' ? 'uptrend' : 'downtrend';
    pb.label = pb.state === 'pullback' ? `Pullback in ${word}: ${pct}% retracement of the last move (${f0(pb.base)} → ${f0(pb.ext)})` : pb.state === 'failed' ? `Pullback failed: ${pct}% retracement, the ${word} may be over` : `Trend leg running (${f0(pb.base)} → ${f0(pb.ext)})`;
    // 1. a healthy pullback is not a reversal: no counter-trend signal until 78.6% breaks
    if (ENG.pbBlock && pb.state === 'pullback' && a.dir && a.dir !== pb.trend) {
      a.dir = null;
      a.gate = `${pb.label}. That is a normal dip inside the ${word}, not a reversal yet. A reversal is confirmed only beyond ${f0(pb.z786)} (78.6%).`;
    }
    // trend days have shallow dips: a touch of the 20-EMA in the last 30 minutes counts as a pullback too
    const k6 = a.I5.k.slice(-6), up = pb.trend === 'CE';
    pb.emaTouch = ok(a.e20) && k6.some((x) => (up ? x.l <= a.e20 + 0.3 * a.atr : x.h >= a.e20 - 0.3 * a.atr)) && (up ? a.price > a.e20 : a.price < a.e20);
    if (pb.emaTouch && pb.state === 'trend') { pb.state = 'pullback'; pb.ema = true; pb.inZone = true; pb.pullX = up ? Math.min(...k6.map((x) => x.l)) : Math.max(...k6.map((x) => x.h)); const sh = a.short; pb.trigger = !!(sh && (sh.dir === pb.trend || (up ? sh.score : 100 - sh.score) >= 57)); }
    // 2. buy the dip / sell the rally: trend + golden zone (or 20-EMA) + 1-minute turning back
    if (pb.state === 'pullback' && pb.inZone && pb.trigger && a.dir !== pb.trend && a.sessionLive) {
      const lean = pb.trend === 'CE' ? a.score : 100 - a.score;
      if (lean >= 42) { a.dir = pb.trend; a.gate = null; a.setupType = 'pullback'; a.pbNote = pb.ema ? `${pb.trend === 'CE' ? 'Buy the dip' : 'Sell the rally'}: ${word} pulled back to its 20-EMA and the 1-minute is turning back.` : `${pb.trend === 'CE' ? 'Buy the dip' : 'Sell the rally'}: ${word} pulled back ${pct}% into the 38.2–61.8% zone and the 1-minute is turning back.`; }
    }
  }
  // 3. don't chase: entry too far from its 20-EMA
  if (a.dir && a.setupType !== 'pullback' && ok(a.e20) && a.atr) {
    const sd = a.dir === 'CE' ? 1 : -1, ext = ((a.price - a.e20) * sd) / a.atr;
    a.extATR = ext;
    // only a stretched AND still-accelerating move counts as chasing (strong trend days stay tradable)
    const burst = ok(a.mvA) ? a.mvA * sd : 0;
    if ((ext > ENG.chase[0] && burst > ENG.chase[1]) || ext > ENG.chase[2]) {
      const back = a.e20 + sd * a.atr * 0.8;
      a.gate = `Extended: price is ${f1(ext)} ATR ${sd > 0 ? 'above' : 'below'} its 20-EMA. Late entries after a stretched move are where most option buyers lose; wait for a pullback towards ${f0(back)} or a pause.`;
      a.dir = null; a.chase = true;
    }
  }
}

// किसी भी स्ट्राइक का अभी का भाव (चेन से, न मिले तो Black-Scholes)
function optQuote(a, K, type) {
  const r = a.ch.rows.find((x) => x.K === K);
  if (r) { const o = type === 'CE' ? r.ce : r.pe; return { ltp: o.ltp, bid: o.bid, ask: o.ask, iv: o.iv, delta: o.de, theta: o.th, gamma: o.ga, vega: o.ve }; }
  const nr = a.ch.rows.length ? nearestRow(a.ch.rows, K) : null;
  const iv = nr ? (type === 'CE' ? nr.ce.iv : nr.pe.iv) : a.ch.atmIV;
  const b = bs(a.price, K, a.ch.T, iv, type);
  return { ltp: tick05(b.price), bid: 0, ask: 0, iv, delta: b.delta, theta: b.theta, gamma: b.gamma, vega: b.vega };
}

function setupFor(a, dir, o) {
  o = o || {};
  const e = a.price, sd = dir === 'CE' ? 1 : -1;
  let risk = 1.5 * a.atr;
  // pullback entries: the stop goes just beyond the pullback's extreme (structure), not a fixed ATR distance
  if (a.setupType === 'pullback' && a.pb && a.pb.trend === dir) risk = clamp(Math.abs(e - a.pb.pullX) + 0.25 * a.atr, 0.8 * a.atr, 2 * a.atr);
  if (ok(o.risk) && o.risk > 0) risk = o.risk;
  const itm = o.itm != null ? o.itm : ENG.itm, t1R = o.t1R || ENG.t1R, t2R = o.t2R || ENG.t2R;
  // Trend-Day mode suggests an in-the-money strike: less time decay per point of move (that is what the backtest assumed)
  const K = itm && ok(a.ch.atm) && a.ch.step ? a.ch.atm - sd * a.ch.step * itm : a.ch.atm;
  const q = optQuote(a, K, dir), dl = Math.abs(q.delta || 0.5), P = q.ltp;
  return { dir, e, sl: e - sd * risk, t1: e + sd * risk * t1R, t2: e + sd * risk * t2R, risk, K, P, itm,
    pSL: tick05(Math.max(0.05, P - dl * risk)), pT1: tick05(P + dl * risk * t1R), delta: q.delta, theta: q.theta };
}

function alertsFor(a, dir) {
  const out = [];
  if (a.vix && a.vix.v > 16) out.push(['d', `India VIX ${f1(a.vix.v)} is high: premiums are expensive and swings can be sharp.`]);
  if (ok(a.adx) && a.adx < 20) out.push(['w', `ADX ${f1(a.adx)}: market is sideways, breakouts fail more often.`]);
  if (a.rsi > 70) out.push(['w', `RSI ${f1(a.rsi)} overbought: a fresh call may be late.`]);
  if (a.rsi < 30) out.push(['w', `RSI ${f1(a.rsi)} oversold: a fresh put may be late.`]);
  if (a.ch.dte <= 1 && a.ch.atmRow) out.push(['d', `Expiry is near: ATM premium is losing about ₹${f1(Math.abs(a.ch.atmRow.ce.th))} a day to theta.`]);
  if (dir === 'CE' && a.res && a.res[1] - a.price < 0.6 * a.atr) out.push(['w', `Resistance just above: ${a.res[0]} ${f0(a.res[1])}.`]);
  if (dir === 'PE' && a.sup && a.price - a.sup[1] < 0.6 * a.atr) out.push(['w', `Support just below: ${a.sup[0]} ${f0(a.sup[1])}.`]);
  if (Math.abs(a.tc - a.bc) / a.price < 0.001) out.push(['i', 'Very narrow CPR: today is likely to be a trending day.']);
  if (a.SS.c - a.curMin <= 60) out.push(['w', 'Last hour of the session: expect sharper moves and wider spreads.']);
  a.events.forEach((e) => out.push(['d', `Event risk: ${e.t} (${e.date === istYmd() ? 'today' : 'tomorrow'} ${e.time} IST). Expect a volatility spike; IV usually drops after the event.`]));
  if (a.vol && ok(a.vol.ivp)) {
    if (a.vol.ivp >= 80) out.push(['w', `IV percentile ${a.vol.ivp} (${a.vol.src}): options are expensive versus the past year. Buying premium needs a quick, strong move.`]);
    else if (a.vol.ivp <= 20) out.push(['i', `IV percentile ${a.vol.ivp}: options are cheap versus the past year, good for buying premium.`]);
  } else if (a.vol && ok(a.vol.ivhv)) {
    if (a.vol.ivhv > 1.4) out.push(['w', `ATM IV is ${f1(a.vol.ivhv)}× the 20-day realised volatility: premiums are rich (results or news priced in?).`]);
    else if (a.vol.ivhv < 0.8) out.push(['i', `ATM IV is below realised volatility (${f2(a.vol.ivhv)}×): premiums look cheap.`]);
  }
  if (a.D.geo && /High|Elevated/.test(a.D.geo.level || '')) out.push(['w', `Geopolitical news is ${a.D.geo.level.toLowerCase()} (${ok(a.D.geo.ratio) ? f1(a.D.geo.ratio) + '× its 3-day average' : 'many headlines'}). Expect gaps and sudden swings; keep size small.`]);
  if (a.isMCX && !a.cf.opt) out.push(['i', 'MCX: Upstox gives no commodity option chain, so levels are for the futures contract.']);
  if (!a.hasVol) out.push(['i', 'Indices carry no volume, so TWAP replaces VWAP and a TPO profile replaces the volume profile.']);
  out.push(['i', 'Risk no more than 1–2% of capital on one trade. Set the stop-loss before you enter.']);
  return out;
}

// पेपर ट्रेडिंग का बड़ा सिग्नल: कॉल / पुट / रुको
// Graded mode: every setup runs side by side from the open to the close; the best one is shown with a grade that sets the size.
//   ★ Prime = Trend-Day pullback (profitable over a full year of Nifty/Sensex data)   A = intraday signal, context behind it
//   B = intraday signal against the context, in the opening 15 minutes or late (half size)   S = 1-minute scalp (1 lot, quick exit)
const GRADE_RANK = { '★': 4, A: 3, B: 2, S: 1 };
const GRADE_INFO = {
  '★': { name: 'Prime', size: 'Full size', mul: 1, hi: 'स्टार प्राइम सेटअप', why: 'Trend-day pullback. 1-year backtest: profitable on Nifty and Sensex (profit factor 1.3–1.4 on the index, ~1.2 with futures, ~1.05–1.1 with a 2-strike in-the-money option). About 1 a day on trend days.' },
  A: { name: 'Grade A', size: 'Small size', mul: 0.5, hi: 'ग्रेड ए, छोटा साइज़', why: 'Intraday signal with the market context behind it. Over a year, intraday signals on their own were about break-even before costs; the Market Brain is meant to lift them. The grade scorecard will show if it does.' },
  B: { name: 'Grade B', size: 'Minimum size', mul: 0, hi: 'ग्रेड बी, कम से कम साइज़', why: 'Intraday signal, but the context, the daily trend or the time of day disagrees. Minimum size.' },
  S: { name: 'Scalp', size: 'Paper or 1 lot', mul: 0, hi: 'स्कैल्प, पेपर या एक लॉट', why: '1-minute move with the 5-minute trend. Over a year these lost after costs: practise on paper, or 1 lot with a quick exit.' },
};
// which 1-minute moves are worth a scalp: ENG.scalp = 'all' | 'align' (with the 5-minute lean and the VWAP side) | 'trend' (only with the 5-minute trend)
function scalpOk(a, dir) {
  const d = dir === 'CE' ? 1 : -1, m = ENG.scalp || 'trend';
  if (m === 'all') return true;
  const vw = !ok(a.vw) || (a.price - a.vw) * d > 0, lean = ((a.intra ? a.intra.score : a.score) - 50) * d;
  if (m === 'align') return vw && lean >= 0;
  return vw && (a.trendDir === dir || (a.stx && a.stx.trend === d)) && lean >= 5;
}
function gradeLots(g) { const L = typeof Paper !== 'undefined' && Paper.opts ? Paper.opts().lots : 1, I = GRADE_INFO[g]; return !I || !I.mul ? 1 : Math.max(1, Math.round(L * I.mul)); }
function signalFor(a) {
  const pro = (d) => a.sigs.filter((x) => x.w > 0 && x.s * d > 0).sort((x, y) => y.w - x.w);
  const con = (d) => a.sigs.filter((x) => x.w > 0 && x.s * d < 0).sort((x, y) => y.w - x.w);
  const SS = a.SS || SESS.NSE, graded = ENG_MODE === 'graded';
  if (!a.sessionLive && a.D.marketOpenNow) return { state: 'WAIT', title: "Waiting for today's data", sub: `Market is open, but today's candles haven't arrived from Upstox yet${a.D.todayErr ? ` (${a.D.todayErr})` : ''}. Signals pause instead of using yesterday's chart. They resume as soon as data or live ticks arrive.`, reasons: [], against: [] };
  if (!a.sessionLive) return { state: 'WAIT', title: 'Market closed', sub: `Signals start again at the next open (${hm(SS.o)}).`, reasons: [], against: [] };
  if (ENG.lastEntryMin && a.curMin >= SS.c - (SS.special ? 30 : ENG.lastEntryMin)) return { state: 'WAIT', title: 'Wait: too late for new trades', sub: `Trend-Day mode takes no new entries after ${hm(SS.c - ENG.lastEntryMin)} (that is how it was backtested). Switch to Graded mode to see every setup till the close.`, reasons: [], against: [] };
  const s = a.score, early = a.curMin < SS.o + 15, late = a.curMin >= SS.c - (SS.special || a.isMCX ? 30 : 75);
  let state = a.dir || 'WAIT', src = a.hz === 'short' ? 'scalp' : 'intra';
  const star = graded && a.hz !== 'short' && a.tdi && a.tdi.star ? a.tdi.star : null;
  if (star) { state = star.dir; src = 'star'; }
  else if (graded && state === 'WAIT' && (a.hz || 'intra') === 'intra' && a.short && a.short.dir && scalpOk(a, a.short.dir)) { state = a.short.dir; src = 'scalp'; }
  if (state === 'WAIT') return { state, title: a.td && a.td.reason === 'cpr' ? 'Wait: not a trend day' : a.td && a.td.reason === 'bank' ? 'Off for Bank Nifty' : a.trendDir && !a.dir ? `${a.trendDir === 'CE' ? '▲ CALL' : '▼ PUT'} trend: wait for ${a.td ? 'pullback' : '1-min'} entry` : a.gate ? (/signal failed|last .* signal failed/i.test(a.gate) ? 'Wait: last signal failed' : /daily trend/.test(a.gate) ? `Wait: ${a.blocked === 'CE' ? 'CALL' : a.blocked === 'PE' ? 'PUT' : 'trade'} against the daily trend` : /but price is/.test(a.gate) ? 'Wait: price and context disagree' : /Range-bound|Flat/.test(a.gate) ? 'Wait: no trend right now' : /Confirming/.test(a.gate) ? 'Wait: confirming new direction' : /^Extended/.test(a.gate) ? "Wait: don't chase" : /^Pullback in/.test(a.gate) ? 'Wait: pullback, not a reversal' : 'Wait: trend tools not aligned') : 'Wait: no clear setup', sub: a.gate || `Score ${s}: signals are mixed. Waiting is a position too.`, reasons: [...pro(1).slice(0, 2), ...pro(-1).slice(0, 2)], against: [] };
  const d = state === 'CE' ? 1 : -1, strength0 = d === 1 ? s : 100 - s, coreFor = d === 1 ? a.coreUp : a.coreDn;
  let strength = src === 'star' ? 'strong' : src === 'scalp' && a.hz !== 'short' ? (a.short && a.short.strength) || 'mild' : a.hz && a.hz !== 'intra' ? a.hzStrength || 'mild' : strength0 >= 70 && coreFor >= 4 && ok(a.adx) && a.adx >= 25 ? 'strong' : 'mild';
  const caveats = [], soft = []; // soft = reasons that push an intraday signal down to grade B
  const dailyDir = a.long && a.long.dir, against = !!(dailyDir && dailyDir !== state);
  if (ok(a.adx) && a.adx < 20 && src !== 'star') { strength = 'mild'; caveats.push('ADX below 20: weak trend'); }
  if (src === 'intra' && coreFor < 4) caveats.push(`${coreFor} of ${a.coreN} trend tools agree`);
  if (a.stD === -d && src !== 'star') { strength = 'mild'; caveats.push('Supertrend still points the other way'); }
  if (a.vix && a.vix.v > 18 && !a.isMCX) caveats.push('High VIX: expensive premiums');
  if (ENG.mode === 'trend' && /BANK/.test(a.key)) { strength = 'mild'; caveats.push('Bank Nifty: no edge found for this setup in the 1-year backtest. Paper trade only, or tiny size.'); }
  if (against) { if (src !== 'star') strength = 'mild'; caveats.push('Against the daily trend (right less often in backtests)'); soft.push('against the daily trend'); }
  if (early) { caveats.push('Opening 15 minutes: price discovery, fake moves are common'); soft.push('opening 15 minutes'); }
  if (late) { caveats.push(`Late in the session: less time for the move, faster time decay${a.isMCX ? '' : '. Paper trades square off at ' + (APP_CONFIG.PAPER.SQUARE_OFF_TIME || '15:29')}`); soft.push('late in the session'); }
  // the market context (world cues, heavyweights, breadth, news, FII, OI): never blocks, it grades
  const br = a.brain;
  if (br && ok(br.score)) {
    if (br.score * d <= -25) { caveats.push(`Market Brain ${sgn(br.score)}${br.score} leans the other way (${br.lean})`); soft.push('market context against'); }
    else if (br.score * d >= 25) caveats.unshift(`Market Brain ${sgn(br.score)}${br.score} agrees (${br.lean})`);
  }
  // market structure: a fresh change of character against the setup, a level about to hold against it, a two-sided open
  const X = a.stx;
  if (X && X.state === 'choch' && X.dir === -d) { strength = 'mild'; caveats.push(`5-minute change of character against this setup at ${f0(X.last.lvl)}`); soft.push('fresh change of character against'); }
  if (X && X.state === 'testing' && X.trend === d) caveats.push(X.label);
  else if (X && X.trend === -d && X.state !== 'choch' && src !== 'scalp') { strength = 'mild'; caveats.push(`5-minute swing structure points the other way (${X.trend > 0 ? 'up' : 'down'})`); }
  const lvA = a.lvw && (d === 1 ? a.lvw.above : a.lvw.below);
  if (lvA && lvA.near && lvA.verdict === 'hold') { strength = 'mild'; caveats.push(`${lvA.kind} ${f0(lvA.v)} is close and more likely to ${d === 1 ? 'reject' : 'bounce'}`); }
  if (a.oif && a.oif.ready && a.oif.bias * d <= -0.5) caveats.push('Option writers near the money lean the other way');
  if (a.open && a.open.type === 'OA' && a.curMin < a.SS.o + 60) { strength = 'mild'; caveats.push('Two-sided open: range-day odds'); }
  // the opening type only matters early, and only while price is still on the drive's side of VWAP (a reversed day is a reversed day)
  if (a.open && (a.open.type === 'OD' || a.open.type === 'OTD') && a.open.dir === -d && a.curMin < a.SS.o + 90 && (!ok(a.vw) || (a.price - a.vw) * a.open.dir > 0)) { strength = 'mild'; caveats.push(`Against today's ${a.open.name}`); }
  if (a.vol && a.vol.ivp >= 80) caveats.push(`IV percentile ${a.vol.ivp}: rich premiums`);
  if (a.events && a.events.length) { strength = 'mild'; caveats.push('Event risk: ' + a.events[0].t); }
  if (a.D.geo && /High|Elevated/.test(a.D.geo.level || '')) { strength = 'mild'; caveats.push(`Geopolitical news ${a.D.geo.level.toLowerCase()} (${ok(a.D.geo.ratio) ? f1(a.D.geo.ratio) + '× normal' : 'many risk headlines'})`); }
  // the setup for each kind of trade: ★ stops beyond the pullback bar with an in-the-money strike; scalps use the 1-minute range
  const atr = a.intra ? a.intra.atr : a.atr;
  const setup = src === 'star' ? setupFor(a, state, { risk: clamp(Math.abs(a.price - star.stop) + 0.1 * atr, 0.5 * atr, 2 * atr), itm: 2, t1R: 2, t2R: 3 })
    : src === 'scalp' && a.hz !== 'short' && a.short ? setupFor(a, state, { risk: a.short.atr * 1.5, itm: 0, t1R: 1.5, t2R: 2.5 }) : setupFor(a, state);
  // costs: wide spreads and targets too small to beat charges
  if (a.cf.opt && a.ch.rows.length) {
    const q = optQuote(a, setup.K, state), lot = a.lot || 1;
    const spread = q.ask > 0 && q.bid > 0 && q.ltp > 0 ? (q.ask - q.bid) / q.ltp : null;
    if (ok(spread) && spread > 0.04) { strength = 'mild'; caveats.push(`Wide bid-ask spread (${f1(spread * 100)}% of premium)`); }
    const gain = (setup.pT1 - setup.P) * lot, cost = 47.2 + setup.P * lot * 0.00236;
    if (gain > 0 && gain < 3 * cost) { strength = 'mild'; caveats.push(`Target only ₹${f0(gain)}/lot vs ~₹${f0(cost)} charges`); }
  }
  const grade = !graded ? null : src === 'star' ? '★' : src === 'scalp' ? 'S' : soft.length ? 'B' : 'A';
  const St = strength === 'strong' ? 'Strong' : 'Mild', CALL = a.cf.opt ? 'CALL' : 'long', PUT = a.cf.opt ? 'PUT' : 'short';
  const base = a.setupType === 'pullback' && src === 'intra' ? (state === 'CE' ? `▲ Buy the dip: ${St} ${CALL}` : `▼ Sell the rally: ${St} ${PUT}`)
    : a.cf.opt ? (state === 'CE' ? `▲ ${St} CALL setup` : `▼ ${St} PUT setup`) : (state === 'CE' ? `▲ ${St} bullish setup` : `▼ ${St} bearish setup`);
  const title = src === 'star' ? `★ Prime: ${state === 'CE' ? '▲ Buy the dip, ' + CALL : '▼ Sell the rally, ' + PUT}` : src === 'scalp' && a.hz !== 'short' ? `S · Scalp ${state === 'CE' ? '▲ ' + CALL : '▼ ' + PUT} (1-minute)` : grade ? `${grade} · ${base}` : base;
  const sh = a.short;
  const sub = src === 'star' ? `${star.note} Exit on a 5-minute close back through TWAP (${f0(a.vw)}), if it hasn't moved in 20 minutes, or at the stop.`
    : src === 'scalp' && a.hz !== 'short' ? `The 1-minute engine says ${state === 'CE' ? CALL : PUT} (short score ${sh ? sh.score : '–'}), while the 5-minute picture ${a.trendDir ? 'is ' + (a.trendDir === 'CE' ? 'up' : 'down') + ' but not confirmed' : 'has no clear trend'}. Quick trade: 1 lot, exit within 5–15 minutes or at the stop.`
    : (a.hz || 'intra') === 'intra' ? `${a.setupType === 'pullback' && a.pbNote ? a.pbNote + ' ' : ''}Score ${s}/100. Price action ${a.paScore ?? '–'}, context ${a.cxScore ?? '–'}. ${coreFor} of ${a.coreN} trend tools and ${pro(d).length} of ${a.active} signals agree.`
      : `Score ${s}/100 on the ${HZ_INFO[a.hz].tf} engine. ${coreFor} of ${a.coreN} core tools and ${pro(d).length} of ${a.active} signals agree.${a.hz === 'long' ? ' Paper trades still square off at the close (intraday only).' : ''}`;
  return {
    state, strength, dirScore: strength0, noOpt: !a.cf.opt, grade, src, gradeWhy: soft, lots: grade ? gradeLots(grade) : null,
    exitNote: src === 'star' ? `Exit: 5-min close through TWAP ${f0(a.vw)}, no move in 20 min, or the stop` : src === 'scalp' ? 'Exit: within 5–15 minutes, at target 1 or the stop' : null,
    title, sub, reasons: pro(d).slice(0, 3), against: con(d).slice(0, 2), caveats, setup,
  };
}
// every instrument's current best trade, best grade first (for the "other live suggestions" list)
function bestTrades() {
  const out = [];
  for (const k of KEYS) { const a = A[k]; if (!a) continue; let s; try { s = signalFor(a); } catch (e) { continue; } if (s.state === 'CE' || s.state === 'PE') out.push({ k, a, s }); }
  return out.sort((x, y) => (GRADE_RANK[y.s.grade] || 0) - (GRADE_RANK[x.s.grade] || 0) || y.s.dirScore - x.s.dirScore);
}

// बोलने के लिए हिंदी (स्क्रीन English में है)
const HI = { strong: 'मज़बूत', mild: 'हल्का', CE: 'कॉल', PE: 'पुट' };
function signalHi(a) {
  const s = signalFor(a);
  if (s.state === 'WAIT') return `${a.cf.voice}: अभी कोई साफ़ सेटअप नहीं, स्कोर ${a.score}।`;
  const g = s.grade ? `${GRADE_INFO[s.grade].hi}: ` : '';
  if (s.noOpt) return `${a.cf.voice}: ${g}${s.state === 'CE' ? 'तेज़ी' : 'मंदी'} का ${HI[s.strength]} सेटअप, स्कोर ${a.score}।`;
  return `${a.cf.voice}: ${g}${HI[s.state]} का ${HI[s.strength]} सेटअप, स्कोर ${a.score}।`;
}

/* ===== Three horizons: SHORT (1-minute, next 5–15 min), INTRADAY (5-minute, main engine), LONG RUN (daily, next days) =====
   Each horizon has its own tools, its own trend core and its own gate, so a short pullback inside an uptrend shows as
   "Short: PUT / Long run: CALL" instead of one blurred number. */
// Which horizon drives the main signal, projection, setup, globe and paper trades (you pick it by tapping a card)
const HZ_INFO = {
  short: { name: 'Short-term', tf: '1-minute', horizon: 'next 5–15 minutes', proj: 'Next 15-minute projection', mins: 15, bt: 'Backtest: about break-even after costs (9–10 trades a day). Use it to time entries of the Intraday signal, not on its own.' },
  intra: { name: 'Intraday', tf: '5-minute', horizon: 'next 30–90 minutes', proj: 'Next 30-minute projection', mins: 30 },
  long: { name: 'Long run', tf: 'daily', horizon: 'next 3–10 sessions', proj: 'Next 5-session projection', mins: null },
};
let HZ = (typeof Store !== 'undefined' && Store.pref('hz', 'intra')) || 'intra';
/* Anti-whipsaw, per instrument and horizon:
   - a NEW direction must hold for a few seconds before it is shown (short 30 s, intraday 20 s, long run instant),
     and while it confirms the old direction is dropped, so you never see a stale CALL during a fall;
   - an EXISTING direction is kept while the score still leans its way (hysteresis) and the other side
     doesn't own the core trend tools, so it doesn't flicker to WAIT on every small wobble. */
// Replay/backtest runs the engine on a simulated clock with its own memory, so it never touches the live signals
const SIM = { on: false, t: 0, ns: 'rp:' }, SIGMEM = {};
const HYS = {}, HYS_CFG = { short: [54, 30], intra: [53, 20], long: [55, 0] };
function stick(id, hz, h) {
  const [hold, sec0] = HYS_CFG[hz], sec = !SIM.on && typeof Source !== 'undefined' && Source.mode === 'demo' ? sec0 / 15 : sec0;
  if (SIM.on) id = SIM.ns + id;
  const S = HYS[id] || (HYS[id] = { dir: null, pend: null, since: 0 }), now = SIM.on ? SIM.t : Date.now(), raw = h.dir;
  const nm = (d) => (d === 'CE' ? 'CALL' : 'PUT');
  if (raw && raw === S.dir) { S.pend = null; return { dir: S.dir }; }
  if (raw && raw !== S.dir) {
    if (S.pend !== raw) { S.pend = raw; S.since = now; }
    S.dir = null; // the old direction is no longer valid
    if (now - S.since >= sec * 1000) { S.dir = raw; S.pend = null; return { dir: raw }; }
    return { dir: null, note: `Confirming a new ${nm(raw)} signal (${Math.max(1, Math.ceil(sec - (now - S.since) / 1000))} s). Avoids reacting to a single spike.` };
  }
  // raw WAIT: a pending direction keeps its timer while the score still leans its way
  if (S.pend) { const pl = S.pend === 'CE' ? h.score : 100 - h.score; if (pl < hold) S.pend = null; else return { dir: null, note: `Confirming a new ${nm(S.pend)} signal. Avoids reacting to a single spike.` }; }
  if (S.dir) {
    const ds = S.dir === 'CE' ? h.score : 100 - h.score, opp = S.dir === 'CE' ? h.dn : h.up;
    if (ds >= hold && opp < Math.ceil(h.coreN * 0.6)) return { dir: S.dir, held: true };
    S.dir = null;
  }
  return { dir: null };
}
function applyHz(a) {
  if (!a) return a;
  if (ENG.mode !== 'trend') { const r = stick(a.key + ':intra', 'intra', { dir: a.dir, score: a.score, up: a.coreUp, dn: a.coreDn, coreN: a.coreN }); a.dir = r.dir; if (!r.dir && r.note) a.gate = r.note; a.dirHeld = !!r.held; }
  for (const k of ['short', 'long']) {
    const h = a[k]; if (!h) continue;
    const r = stick(a.key + ':' + k, k, h); h.dir = r.dir; h.held = !!r.held;
    if (!r.dir) { h.strength = null; if (r.note) h.gate = r.note; } else if (!h.strength || r.held) h.strength = 'mild';
  }
  // Backtest-proven trade rules (Aug–Nov 2026, Nifty / Bank Nifty / Sensex, 1-minute data):
  //  1. Trading against the daily trend lost money (37% right) while trading with it made money (48%): block it.
  //  2. A signal whose price runs 1.5 ATR against it has failed: drop it at once and block that side for 30 minutes
  //     (re-entries right after a loss were the worst trades). This is what stops "CALL shown while price keeps falling".
  const nmD = (d) => (d === 'CE' ? (a.cf.opt ? 'CALL' : 'long') : a.cf.opt ? 'PUT' : 'short');
  const guard = (id, h, atr) => {
    const mk = (SIM.on ? SIM.ns : '') + id, G = SIGMEM[mk] || (SIGMEM[mk] = { dir: null, e: 0, fail: {} }), now = SIM.on ? SIM.t : Date.now();
    if (!h.dir) { G.dir = null; return; }
    const sd = h.dir === 'CE' ? 1 : -1;
    if (G.fail[h.dir] && now - G.fail[h.dir] < ENG.coolMin * 60000) { h.gate = `The last ${nmD(h.dir)} signal failed (price ran ${ENG.failATR} ATR against it). No new ${nmD(h.dir)} for ${Math.ceil((ENG.coolMin * 60000 - (now - G.fail[h.dir])) / 60000)} min.`; h.dir = null; G.dir = null; return; }
    if (G.dir !== h.dir) { G.dir = h.dir; G.e = a.price; }
    if (atr && (G.e - a.price) * sd >= ENG.failATR * atr) {
      G.fail[h.dir] = now; G.dir = null; if (HYS[mk]) Object.assign(HYS[mk], { dir: null, pend: null });
      h.gate = `${nmD(h.dir)} signal failed: price moved ${ENG.failATR} ATR against it. Standing aside on that side for ${ENG.coolMin} min.`; h.dir = null;
    }
  };
  const dailyDir = a.long && a.long.dir;
  const daily = (h) => { if (h.dir && dailyDir && dailyDir !== h.dir) { h.againstDaily = true; if (ENG.dailyFilter === 'soft') return; }
    if (ENG.dailyFilter === true && h.dir && dailyDir && dailyDir !== h.dir) { h.gate = `Intraday points ${nmD(h.dir)}, but that is against the daily trend (the long-run engine says ${nmD(dailyDir)}). In backtests, trades against the daily trend were right only 37% of the time. Wait.`; h.blocked = h.dir; h.dir = null; } };
  if (ENG.mode !== 'trend') { const h = { dir: a.dir, gate: a.gate }; daily(h); guard(a.key + ':intra', h, a.atr); a.dir = h.dir; a.gate = h.gate || a.gate; a.blocked = h.blocked || null; }
  if (a.short) { daily(a.short); guard(a.key + ':short', a.short, a.short.atr * 1.5); if (!a.short.dir) a.short.strength = null; }
  // 3. Entry timing: the intraday direction is traded only when the 1-minute engine agrees (backtest: same profit as the
  //    daily-trend block, ~30% more trades, and every index profitable in both test periods). The trend stays visible.
  a.againstDaily = !!(a.dir && dailyDir && dailyDir !== a.dir);
  if (ENG.mode !== 'trend' && ENG.confirm1m && a.dir && a.short && a.short.dir !== a.dir) { a.trendDir = a.dir; a.gate = `Intraday trend is ${nmD(a.dir)}, but the 1-minute is not confirming yet. Enter when it turns ${nmD(a.dir)} (usually after a small dip).`; a.dir = null; }
  a.intra = { score: a.score, dir: a.dir, gate: a.gate, sigs: a.sigs, coreUp: a.coreUp, coreDn: a.coreDn, coreN: a.coreN, atr: a.atr, adx: a.adx, stD: a.stD, paScore: a.paScore, cxScore: a.cxScore, active: a.active };
  a.hz = 'intra'; a.hzWanted = HZ;
  const h = HZ === 'short' ? a.short : HZ === 'long' ? a.long : null;
  if (!h) return a; // not enough data for that horizon yet: intraday stays in charge (shown on screen)
  Object.assign(a, { hz: HZ, score: h.score, dir: h.dir, gate: h.gate, sigs: h.sigs, coreUp: h.up, coreDn: h.dn, coreN: h.coreN, active: h.sigs.filter((x) => x.w > 0).length,
    adx: h.adx, stD: h.stD, hzStrength: h.strength, blocked: h.blocked || null,
    // risk unit for SL/targets: scalps use the 1-minute ATR, positional uses part of the daily ATR
    atr: HZ === 'short' ? h.atr * 1.5 : h.atr * 0.6 });
  return a;
}
function hzScore(sigs) {
  const xs = sigs.filter((x) => x.w > 0), w = xs.reduce((s, x) => s + x.w, 0);
  return w ? Math.round(50 + (50 * xs.reduce((s, x) => s + x.w * x.s, 0)) / w) : 50;
}
function hzSwing(k, look, piv, tol) {
  // swing structure on any candle array: +1 HH/HL, -1 LH/LL, 0 mixed (with the unfinished leg counted)
  const z = k.slice(-look), H = [], L = [];
  for (let i = piv; i < z.length - piv; i++) {
    let hi = true, lo = true;
    for (let j = 1; j <= piv; j++) { if (!(z[i].h >= z[i - j].h && z[i].h > z[i + j].h)) hi = false; if (!(z[i].l <= z[i - j].l && z[i].l < z[i + j].l)) lo = false; }
    if (hi) H.push(z[i].h); if (lo) L.push(z[i].l);
  }
  if (!H.length || !L.length) return [0, 'Not enough swings', false];
  const tail = z.slice(-piv - 1), nowH = Math.max(...tail.map((x) => x.h)), nowL = Math.min(...tail.map((x) => x.l));
  const lastH = H[H.length - 1], lastL = L[L.length - 1];
  if (nowL < lastL - tol) return [-1, 'Breaking below the last swing low', true];
  if (nowH > lastH + tol) return [1, 'Breaking above the last swing high', true];
  if (H.length >= 2 && L.length >= 2) {
    const hh = H[H.length - 1] > H[H.length - 2], hl = L[L.length - 1] > L[L.length - 2];
    if (hh && hl) return [1, 'Higher highs, higher lows', true];
    if (!hh && !hl) return [-1, 'Lower highs, lower lows', true];
  }
  return [0, 'Mixed swings (range)', true];
}
function hzDecide(sigs, coreNames, enter, strongAt, extraGate) {
  const score = hzScore(sigs), core = sigs.filter((x) => coreNames.includes(x.n) && x.w > 0);
  const up = core.filter((x) => x.s >= 0.5).length, dn = core.filter((x) => x.s <= -0.5).length, need = Math.ceil(core.length * 0.6);
  let dir = score >= enter ? 'CE' : score <= 100 - enter ? 'PE' : null, gate = null;
  if (dir === 'CE' && up < need) { gate = `Only ${up} of ${core.length} core tools up`; dir = null; }
  if (dir === 'PE' && dn < need) { gate = `Only ${dn} of ${core.length} core tools down`; dir = null; }
  if (dir && extraGate) { const g = extraGate(dir); if (g) { gate = g; dir = null; } }
  const agree = dir === 'CE' ? up : dir === 'PE' ? dn : Math.max(up, dn);
  const ds = dir === 'PE' ? 100 - score : score;
  const strength = dir && ds >= strongAt && agree === core.length ? 'strong' : dir ? 'mild' : null;
  const pro = (d) => sigs.filter((x) => x.w > 0 && x.s * d > 0).sort((a, b) => b.w - a.w);
  const d = dir === 'CE' ? 1 : dir === 'PE' ? -1 : 0;
  return { score, dir, gate, strength, up, dn, coreN: core.length, sigs, reasons: d ? pro(d).slice(0, 3) : [], against: d ? pro(-d).slice(0, 2) : [] };
}

// SHORT: 1-minute candles, reacts within a minute or two
function shortTerm(a) {
  const k = a.D.candles.slice(-240);
  if (k.length < 40) return null;
  const c = k.map((x) => x.c), L = k.length - 1, price = a.price;
  const e9 = ema(c, 9)[L], e21 = ema(c, 21)[L], st = supertrend(k, 10, 2), stD = st.dir[L], r7 = rsi(c, 7)[L];
  const mc = macd(c), mh = mc.hist[L], mhP = mc.hist[L - 3], at1 = atr(k, 14)[L] || a.atr / 2.2 || price * 0.0004;
  const ax = adx(k, 14), A1 = ax.adx[L], pd = ax.pdi[L], md = ax.mdi[L];
  const mv = (n) => (k.length > n ? (price - k[L - n].c) / at1 : null), m5 = mv(5), m15 = mv(15);
  const [sw, swV, swOk] = hzSwing(k, 60, 3, at1 * 0.15);
  const last3 = k.slice(-3), up3 = last3.every((x, i) => !i || x.c > last3[i - 1].c), dn3 = last3.every((x, i) => !i || x.c < last3[i - 1].c);
  const pat = pattern(k);
  const trend = ok(A1) && A1 >= 22;
  const sigs = [], add = (n, v, s, w) => sigs.push({ g: 'Short', n, v, s: ok(s) ? s : 0, w });
  add('EMA 9 / 21 (1m)', `${f1(e9)} / ${f1(e21)}`, e9 > e21 ? 1 : -1, 2);
  add('Supertrend (1m, 10,2)', f1(st.st[L]), stD, 2);
  add('Last 5 minutes', ok(m5) ? `${sgn(m5)}${f1(m5)} ATR` : '–', ok(m5) ? clamp(m5, -1, 1) : 0, 1.5);
  add('Last 15 minutes', ok(m15) ? `${sgn(m15)}${f1(m15)} ATR` : '–', ok(m15) ? clamp(m15 / 1.5, -1, 1) : 0, 1.5);
  add('Swing structure (1m)', swV, sw, swOk ? 1.5 : 0);
  add('MACD (1m)', `${f2(mh)} ${ok(mhP) ? (mh > mhP ? 'rising' : 'falling') : ''}`, ok(mh) ? (mh > 0 && mh >= mhP ? 1 : mh < 0 && mh <= mhP ? -1 : mh > 0 ? 0.5 : -0.5) : 0, 1);
  add('RSI 7 (1m)', f1(r7), r7 > 75 ? (trend && pd > md ? 1 : 0) : r7 < 25 ? (trend && md > pd ? -1 : 0) : r7 > 58 ? 1 : r7 < 42 ? -1 : 0, 1);
  add('Last 3 candles', up3 ? '3 higher closes' : dn3 ? '3 lower closes' : 'Mixed', up3 ? 1 : dn3 ? -1 : 0, 0.75);
  add('Candle (1m)', pat[0], pat[1], 0.5);
  add(a.hasVol ? 'Price vs VWAP' : 'Price vs TWAP', f1(a.vw), price > a.vw ? 1 : -1, 1);
  if (a.fut && a.fut.m30) add('Futures OI, last 30 min', a.fut.m30[0], a.fut.m30[1], 1);
  const h = hzDecide(sigs, ['EMA 9 / 21 (1m)', 'Supertrend (1m, 10,2)', 'Last 5 minutes', 'Swing structure (1m)'], 60, 72,
    () => (ok(A1) && A1 < 15 && sw === 0 && Math.abs(m15 || 0) < 0.8 ? `Flat 1-minute tape (ADX ${f1(A1)})` : null));
  const exp = at1 * Math.sqrt(10);
  return { ...h, tf: '1m', horizon: 'next 5–15 min', atr: at1, lo: price - exp, hi: price + exp, adx: A1, m5, m15, stD };
}

// LONG RUN: daily candles (about a year) + today's live candle
function longTerm(a) {
  const rows = (a.D.daily && a.D.daily.rows) || [];
  if (rows.length < 30) return null;
  const today = a.D.candles.filter((x) => x.d === 2);
  const k = rows.map((r) => ({ o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] || 0 }));
  if (today.length && rows[rows.length - 1][0] !== istYmd()) k.push({ o: today[0].o, h: a.DH, l: a.DL, c: a.price, v: 0 });
  const c = k.map((x) => x.c), L = k.length - 1, price = a.price;
  const d20 = sma(c, 20)[L], d50 = sma(c, 50)[L], d200 = c.length >= 200 ? sma(c, 200)[L] : null, d20p = sma(c, 20)[L - 5];
  const st = supertrend(k, 10, 3), r14 = rsi(c, 14)[L], mh = macd(c).hist[L], ax = adx(k, 14);
  const at = atr(k, 14)[L] || price * 0.01;
  // weekly bars from daily (5 sessions each, newest last)
  const wk = []; for (let i = k.length; i > 0 && wk.length < 10; i -= 5) { const z = k.slice(Math.max(0, i - 5), i); wk.unshift({ h: Math.max(...z.map((x) => x.h)), l: Math.min(...z.map((x) => x.l)), c: z[z.length - 1].c }); }
  const [ws, wsV, wsOk] = hzSwing(wk, 10, 1, at * 0.2);
  const yr = k.slice(-252), hi52 = Math.max(...yr.map((x) => x.h)), lo52 = Math.min(...yr.map((x) => x.l)), pos52 = (price - lo52) / (hi52 - lo52 || 1);
  const m20 = c.length > 20 ? (price - c[L - 20]) / c[L - 20] * 100 : null;
  const sigs = [], add = (n, v, s, w) => sigs.push({ g: 'Long run', n, v, s: ok(s) ? s : 0, w });
  add('Price vs 20 DMA', f0(d20), ok(d20) ? (price > d20 ? 1 : -1) : 0, ok(d20) ? 1.5 : 0);
  add('Price vs 50 DMA', f0(d50), ok(d50) ? (price > d50 ? 1 : -1) : 0, ok(d50) ? 1.5 : 0);
  add('Price vs 200 DMA', ok(d200) ? f0(d200) : 'Needs 200 days', ok(d200) ? (price > d200 ? 1 : -1) : 0, ok(d200) ? 2 : 0);
  add('20 DMA vs 50 DMA', ok(d50) ? (d20 > d50 ? 'Golden side (20 above 50)' : 'Bearish side (20 below 50)') : '–', ok(d50) ? (d20 > d50 ? 1 : -1) : 0, ok(d50) ? 1.5 : 0);
  add('20 DMA slope (5 days)', ok(d20p) ? `${sgn(d20 - d20p)}${f1(d20 - d20p)}` : '–', ok(d20p) ? (d20 > d20p ? 1 : -1) : 0, ok(d20p) ? 1 : 0);
  add('Supertrend (daily)', f0(st.st[L]), st.dir[L], 2);
  add('Weekly structure', wsV, ws, wsOk ? 1.5 : 0);
  add('RSI 14 (daily)', f1(r14), r14 > 55 ? 1 : r14 < 45 ? -1 : 0, ok(r14) ? 1 : 0);
  add('MACD (daily)', f1(mh), ok(mh) ? (mh > 0 ? 1 : -1) : 0, ok(mh) ? 1 : 0);
  add('ADX (daily)', `${f1(ax.adx[L])}, +DI ${f1(ax.pdi[L])} / −DI ${f1(ax.mdi[L])}`, ax.adx[L] >= 20 ? (ax.pdi[L] > ax.mdi[L] ? 1 : -1) : 0, 1);
  add('20-day return', ok(m20) ? `${sgn(m20)}${f1(m20)}%` : '–', ok(m20) ? clamp(m20 / 4, -1, 1) : 0, 1);
  add('52-week position', `${Math.round(pos52 * 100)}% of range`, pos52 > 0.8 ? 0.5 : pos52 < 0.2 ? -0.5 : 0, 0.5);
  if (a.fut && a.fut.day) add('Futures OI since yesterday', a.fut.day[0], a.fut.day[1], 1);
  if (ok(a.D.fii) && !a.isMCX) add('FII cash (previous day)', sgn(a.D.fii) + f0(a.D.fii), a.D.fii > 0 ? 1 : -1, 0.5);
  const h = hzDecide(sigs, ['Price vs 50 DMA', '20 DMA vs 50 DMA', 'Supertrend (daily)', 'Weekly structure', 'Price vs 20 DMA'], 60, 75);
  return { ...h, tf: '1D', horizon: 'next 3–10 sessions', adx: ax.adx[L], atr: at, lo: price - at * 3, hi: price + at * 3, d20, d50, d200, hi52, lo52, stD: st.dir[L], days: rows.length };
}
