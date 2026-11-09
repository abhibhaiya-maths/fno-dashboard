/* ===== डेमो डेटा (सिम्युलेशन) — लाइव डेटा जैसा ही ढाँचा ===== */
const DemoSource = (() => {
  const P = {
    NIFTY: { base: 25420, dte: 1, ivf: 1.0, seed: 101,
      hv: [['HDFC Bank', 13], ['ICICI Bank', 9], ['Reliance', 8.5], ['Infosys', 5], ['Bharti Airtel', 4.5], ['L&T', 4], ['ITC', 3.5], ['TCS', 3]],
      news: [['FIIs buy in the cash market for a third straight day', 0.6, 'medium', '1 hour ago'], ['Large private banks beat Q2 estimates', 0.5, 'high', '3 hours ago'],
        ['IT companies give cautious guidance, stocks under pressure', -0.3, 'medium', '5 hours ago'], ['Crude oil prices edge higher', -0.3, 'medium', '6 hours ago'], ['Markets watch US Fed commentary this week', -0.1, 'high', 'yesterday']] },
    SENSEX: { base: 83150, dte: 3, ivf: 0.95, seed: 202,
      hv: [['HDFC Bank', 15], ['ICICI Bank', 10], ['Reliance', 10], ['Infosys', 6], ['Bharti Airtel', 5], ['L&T', 4.5], ['ITC', 4], ['TCS', 3.5]],
      news: [['Domestic mutual fund SIP inflows hit a record', 0.5, 'medium', '2 hours ago'], ['Buying in banking and financial stocks', 0.5, 'high', '3 hours ago'],
        ['Auto sales strong ahead of the festive season', 0.4, 'medium', '4 hours ago'], ['Mixed trend in global markets', -0.1, 'low', '6 hours ago']] },
    BANKNIFTY: { base: 57280, dte: 8, ivf: 1.12, seed: 303,
      hv: [['HDFC Bank', 28], ['ICICI Bank', 25], ['SBI', 9], ['Kotak Bank', 8], ['Axis Bank', 8], ['IndusInd Bank', 3.5], ['Federal Bank', 3], ['AU Bank', 2.5]],
      news: [['Large private banks post strong Q2, net interest income up', 0.7, 'high', '2 hours ago'], ['RBI signals comfortable system liquidity', 0.4, 'high', '4 hours ago'],
        ['Profit booking in PSU banks', -0.3, 'medium', '5 hours ago'], ['Concerns persist over unsecured loans at some banks', -0.4, 'medium', 'yesterday']] },
  };
  // Demo watchlist universe (search works on these in demo mode)
  const UNI = [
    { id: 'RELIANCE', label: 'RELIANCE', name: 'Reliance', key: 'NSE_EQ|INE002A01018', ukey: 'NSE_EQ|INE002A01018', exch: 'NSE', kind: 'EQ', fo: true, lot: 500, sym: 'RELIANCE', demo: { base: 1452, dte: 19, ivf: 1.6, seed: 404, step: 10, vol: 1 } },
    { id: 'HDFCBANK', label: 'HDFCBANK', name: 'HDFC Bank', key: 'NSE_EQ|INE040A01034', ukey: 'NSE_EQ|INE040A01034', exch: 'NSE', kind: 'EQ', fo: true, lot: 550, sym: 'HDFCBANK', demo: { base: 992, dte: 19, ivf: 1.4, seed: 505, step: 10, vol: 1 } },
    { id: 'WIPRO', label: 'WIPRO', name: 'Wipro', key: 'NSE_EQ|INE075A01022', ukey: 'NSE_EQ|INE075A01022', exch: 'NSE', kind: 'EQ', fo: true, lot: 3000, sym: 'WIPRO', demo: { base: 246, dte: 19, ivf: 1.9, seed: 606, step: 2.5, vol: 1 } },
    { id: 'IRFC', label: 'IRFC', name: 'IRFC', key: 'NSE_EQ|INE053F01010', ukey: 'NSE_EQ|INE053F01010', exch: 'NSE', kind: 'EQ', fo: false, lot: null, sym: 'IRFC', demo: { base: 128, seed: 707, vol: 1 } },
    { id: 'CRUDEOIL', label: 'CRUDEOIL FUT', name: 'Crude Oil', key: 'MCX_FO|432293', ukey: null, exch: 'MCX', kind: 'FUT', fo: false, lot: 100, sym: 'CRUDEOIL', expiry: 'Demo', demo: { base: 5480, seed: 808, vol: 1, oi: 1 } },
    { id: 'GOLDM', label: 'GOLDM FUT', name: 'Gold Mini', key: 'MCX_FO|440001', ukey: null, exch: 'MCX', kind: 'FUT', fo: false, lot: 10, sym: 'GOLDM', expiry: 'Demo', demo: { base: 121500, seed: 909, vol: 1, oi: 1 } },
    { id: 'NIFTYIT', label: 'Nifty IT', name: 'Nifty IT', key: 'NSE_INDEX|Nifty IT', ukey: 'NSE_INDEX|Nifty IT', exch: 'NSE', kind: 'INDEX', fo: false, lot: null, sym: 'NIFTYIT', demo: { base: 36200, seed: 111 } },
  ];
  const S = {};
  let vix = 13.4; const vixPrev = 13.9;

  function mkCandle(st, d, m) {
    const r = st.r, sig = 0.00042 * st.sk * (m < 30 ? 1.8 : m > 345 ? 1.4 : 1), o = st.p;
    const c = o * (1 + st.drift + gauss(r) * sig), h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * sig * 0.6), l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * sig * 0.6);
    const v = st.vol ? Math.round((800 + r() * 900) * (1 + 1.8 * ((m - 187) / 187) ** 2) * (st.vol === 2 ? 40 : 1)) : 0;
    if (st.oiOn) st.oi = Math.max(1000, st.oi * (1 + (c > o ? 1 : -1) * st.oiBias * 0.0004 + gauss(r) * 0.0006));
    st.p = c; return { d, m, o, h, l, c, v, oi: st.oiOn ? Math.round(st.oi) : 0 };
  }
  function mkSeries(key, pc) {
    const S0 = (CFG[key] && CFG[key].sess) || SESS.NSE;
    const st = { r: rng(pc.seed), p: pc.base * 0.992, series: [], sk: pc.sk || 1, vol: pc.vol ? (CFG[key].kind === 'EQ' ? 2 : 1) : 0, oiOn: !!pc.oi, oi: 2e5, oiBias: (hrand(pc.seed, 3) - 0.5) * 2, o: S0.o };
    for (let d = 0; d < 3; d++) {
      st.drift = ((st.r() - 0.42) * 0.006) / 375; if (d > 0) st.p *= 1 + gauss(st.r) * 0.0025;
      if (d === 2) st.prevOi = st.oi;
      const nowM = S.NIFTY ? S.NIFTY.series[S.NIFTY.series.length - 1].m : 249;
      const end = d < 2 ? S0.c : nowM + 1; for (let m = S0.o; m < end; m++) st.series.push(mkCandle(st, d, m));
    }
    return st;
  }
  function init() { for (const key of ['NIFTY', 'SENSEX', 'BANKNIFTY']) S[key] = mkSeries(key, P[key]); KEYS.forEach(ensure); }
  function ensure(k) {
    if (S[k] || !CFG[k]) return;
    const u = UNI.find((x) => x.id === k), d = (u && u.demo) || CFG[k].demo || { base: 1000, seed: k.length * 97 };
    P[k] = { dte: d.dte || 19, ivf: d.ivf || 1.5, seed: d.seed, step: d.step, hv: [], news: [[`${CFG[k].label}: traders track sector cues (demo)`, 0.2, 'medium', '2 hours ago'], [`Brokerages review ${CFG[k].label} targets after results (demo)`, -0.1, 'low', 'yesterday']], ...d };
    S[k] = mkSeries(k, P[k]);
  }
  function tick() {
    const nl = S.NIFTY.series, before = nl[nl.length - 1].c; let moved = false;
    const nm = nl[nl.length - 1].m;
    for (const k of KEYS) { ensure(k); const st = S[k], l = st.series[st.series.length - 1], end = ((CFG[k] && CFG[k].sess) || SESS.NSE).c - 1; if (l.m < end && (k === 'NIFTY' ? nm < 374 : l.m < (nm < 374 ? nm + 1 : end))) { st.series.push(mkCandle(st, 2, l.m + 1)); moved = true; } }
    if (moved) { const ret = (nl[nl.length - 1].c - before) / before; vix = clamp(vix + (Math.random() - 0.5) * 0.05 - ret * 250, 9, 30); }
    return moved;
  }
  function chainFor(key, Sp, curMin, chg) {
    const cf = CFG[key], pc = P[key], stp = cf.step || pc.step, atm = Math.round(Sp / stp) * stp, dte = pc.dte + (375 - curMin) / 375, T = Math.max(dte, 0.02) / 365;
    if (!cf.opt) return { rows: [] };
    const bias = clamp(chg * 0.3, -0.5, 0.5), rows = [];
    for (let i = -15; i <= 15; i++) {
      const K = +(atm + i * stp).toFixed(2), m = Math.log(K / Sp), iv = (vix / 100) * pc.ivf * (1 + 6 * Math.abs(m) - 2.5 * m), dist = (K - Sp) / stp, round = Math.round(K / stp) % 2 === 0 ? 1.15 : 1;
      const ceL = (5 + 32 * Math.exp(-((dist - 3) ** 2) / 14) + 9 * hrand(K, pc.seed)) * (1 - bias) * round;
      const peL = (5 + 32 * Math.exp(-((dist + 3) ** 2) / 14) + 9 * hrand(K, pc.seed + 5)) * (1 + bias) * round;
      const ceC = ceL * ((hrand(K, pc.seed + 9) - 0.5) * 0.3 - bias * 0.25), peC = peL * ((hrand(K, pc.seed + 13) - 0.5) * 0.3 + bias * 0.25);
      const side = (type, oiL, chL) => {
        const b = bs(Sp, K, T, iv, type), ltp = tick05(b.price), spr = Math.max(0.05, tick05(ltp * 0.003));
        return { ltp, bid: tick05(ltp - spr), ask: tick05(ltp + spr), oi: Math.round(oiL * 1e5), poi: Math.round((oiL - chL) * 1e5), iv, de: b.delta, ga: b.gamma, th: b.theta, ve: b.vega };
      };
      rows.push({ K, ce: side('CE', ceL, ceC), pe: side('PE', peL, peC) });
    }
    return { expiry: 'Demo', dte, lot: cf.lot || APP_CONFIG.LOT_FALLBACK[key], rows };
  }
  // Synthetic extras so every panel can be tried in demo mode
  const WORLD_DEMO = { ts: Date.now(), items: [['gift', 'GIFT Nifty', 'india', 25540, 0.35], ['dowF', 'Dow futures', 'us', 44380, 0.31], ['nasF', 'Nasdaq 100 futures', 'us', 22040, 0.52], ['spxF', 'S&P 500 futures', 'us', 6135, 0.38],
    ['dow', 'Dow Jones', 'us', 44210, 0.42], ['nas', 'Nasdaq Composite', 'us', 19980, 0.74], ['spx', 'S&P 500', 'us', 6120, 0.51], ['usvix', 'US VIX (fear gauge)', 'us', 15.2, -3.1],
    ['nikkei', 'Nikkei 225 (Japan)', 'asia', 39880, -0.21], ['hsi', 'Hang Seng (Hong Kong)', 'asia', 26050, 0.18], ['kospi', 'Kospi (Korea)', 'asia', 2890, 0.44], ['sse', 'Shanghai Composite', 'asia', 3420, -0.12],
    ['dax', 'DAX (Germany)', 'eu', 23410, 0.22], ['ftse', 'FTSE 100 (UK)', 'eu', 8810, 0.05],
    ['brent', 'Brent crude', 'cmd', 74.2, -0.6], ['wti', 'WTI crude', 'cmd', 70.9, -0.7], ['gold', 'Gold', 'cmd', 3390, 0.3], ['silver', 'Silver', 'cmd', 38.6, 0.5], ['natgas', 'Natural gas', 'cmd', 3.4, 1.1],
    ['dxy', 'Dollar index (DXY)', 'fx', 98.6, -0.25], ['us10y', 'US 10-year yield', 'fx', 4.21, -0.6], ['usdinr', 'USD / INR', 'fx', 87.9, 0.05],
    ['infy', 'Infosys ADR', 'adr', 19.4, 1.2], ['hdb', 'HDFC Bank ADR', 'adr', 76.1, 0.6], ['ibn', 'ICICI Bank ADR', 'adr', 34.2, 0.4], ['wit', 'Wipro ADR', 'adr', 3.05, 0.9]]
    .map(([id, name, grp, price, chg]) => ({ id, name, grp, price, chg, prevClose: price / (1 + chg / 100), src: 'demo', ts: Date.now() - 6e5 })) };
  const PART_DEMO = { latest: { date: 'demo', asOf: 'demo', p: { FII: { futL: 118000, futS: 196000, callL: 410000, putL: 520000, callS: 380000, putS: 455000 }, CLIENT: { futL: 260000, futS: 150000 }, PRO: { futL: 90000, futS: 95000 }, DII: { futL: 70000, futS: 31000 } } },
    prev: { date: 'demo', p: { FII: { futL: 112000, futS: 204000 }, CLIENT: { futL: 266000, futS: 146000 }, PRO: { futL: 88000, futS: 92000 }, DII: { futL: 70000, futS: 31000 } } }, src: 'demo' };
  const GLOB = [['GIFT NIFTY', 'SGX NIFTY', 0.35, 25540], ['Dow Jones', '^DJI', 0.42, 44210], ['S&P 500', '^GSPC', 0.51, 6120], ['US Tech 100', 'NDX', 0.74, 21980], ['Nikkei 225', '^N225', -0.21, 39880], ['Hang Seng', '^HSI', 0.18, 26050], ['Oil (Brent)', 'BZUSD', -0.6, 74.2], ['USD INR', 'USDINR', 0.05, 87.9]]
    .map(([name, sym, chg, price]) => ({ name, sym, chg, price, prevClose: price / (1 + chg / 100), latency: 'demo' }));
  const dPlus = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const CAL = { items: [{ date: dPlus(0), time: '19:00', t: 'USD: ISM Services PMI (demo)', imp: 'high', src: 'ForexFactory' }, { date: dPlus(1), time: '19:00', t: 'USD: Non-Farm Payrolls (demo)', imp: 'high', src: 'ForexFactory' }, { date: dPlus(6), time: '16:00', t: 'India CPI inflation (MoSPI, usual date)', imp: 'medium', src: 'MoSPI' }], sources: { demo: 3 } };
  const OFF = { items: [['Outcome of Board Meeting: Financial Results for quarter ended September 2026', 'HDFC Bank Limited', 'NSE announcements', 40], ['RBI announces Variable Rate Repo auction', '', 'RBI press releases', 95], ['Circular on enhancing trading-system resilience for brokers', '', 'SEBI', 180], ['Board Meeting Intimation: fund raising via QIP', 'Wipro Limited', 'NSE announcements', 300]]
    .map(([t, co, src, m]) => ({ t, co, src, ago: m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago' })), sources: { 'NSE announcements': 2, 'RBI press releases': 1, SEBI: 1 } };
  const GEO = { level: 'Elevated', ratio: 1.6, items: [['US and Iran trade warnings as oil tankers reroute around Hormuz (demo)', 'reuters.com', 35], ['EU agrees new sanctions package; energy curbs widened (demo)', 'bbc.co.uk', 120], ['India, China hold border talks; troops to pull back (demo)', 'thehindu.com', 240]].map(([t, src, m]) => ({ t, src, ts: Date.now() - m * 60e3, ago: m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago' })) };
  function get(key) {
    ensure(key); if (!S[key]) return null;
    const pc = P[key], st = S[key], s1 = st.series, prev = s1.filter((x) => x.d === 1), last = s1[s1.length - 1], cf = CFG[key];
    const PC = prev[prev.length - 1].c, price = last.c, chg = ((price - PC) / PC) * 100;
    const today = s1.filter((x) => x.d === 2), nm = S.NIFTY.series[S.NIFTY.series.length - 1].m;
    // synthetic futures OI for indices / F&O stocks: follows price with a bias
    let fut = null;
    if (cf.exch !== 'MCX' && (cf.core || cf.opt)) {
      let oi = 1.2e7 * (1 + hrand(pc.seed, 7)); const prevOi = oi, c = [];
      today.forEach((x, i) => { oi *= 1 + (i ? Math.sign(x.c - today[i - 1].c) : 0) * 0.0012 * (hrand(pc.seed, 2) > 0.4 ? 1 : -1) + (hrand(i, pc.seed) - 0.5) * 0.001; c.push([x.m, x.c * 1.002, Math.round(oi)]); });
      fut = { expiry: 'Demo', prevClose: PC * 1.002, prevOi: Math.round(prevOi), c };
    }
    const daily = { rows: Array.from({ length: 260 }, (_, i) => { const r = 1 + Math.sin(i / 9 + pc.seed) * 0.06 + (hrand(i, pc.seed) - 0.5) * 0.02; const c = PC * r; return ['d' + i, c, c * 1.012, c * 0.988, c, 0, 0]; }) };
    const vixDaily = Array.from({ length: 260 }, (_, i) => ['v' + i, 0, 0, 0, 11 + 6 * hrand(i, 77)]);
    const n = A.NIFTY;
    return {
      key, candles: s1, price, prevClose: PC, sessionLive: last.m < cf.sess.c - 1 && (cf.exch === 'MCX' || nm < 374), dayLabels: ['Thu', 'Fri', 'Today'],
      chain: chainFor(key, price, Math.min(374, last.m), chg), vix: { v: vix, prev: vixPrev }, fii: 1184, dii: 926, fiiSrc: 'demo',
      hv: (pc.hv || []).map(([n2, w], i) => ({ n: n2, w, c: chg * (0.8 + 0.5 * hrand(i, pc.seed)) + (hrand(i, pc.seed + 1) - 0.5) * 1.2 })),
      news: pc.news.map(([t, s2, imp, ago]) => ({ t, s: s2, imp, ago })),
      fut, daily, vixDaily, geo: GEO, prevOi: st.prevOi ? Math.round(st.prevOi) : null, glob: GLOB, events: CAL.items, mkt: key !== 'NIFTY' && n ? { chg: n.chg, score: n.score } : null,
    };
  }
  function clock() { const m = S.NIFTY.series[S.NIFTY.series.length - 1].m; return { min: m, date: 'DEMO', label: m >= 374 ? 'Market closed (demo)' : `Demo time ${hm(m)} (fast)` }; }
  async function search(q) { const Q = q.toUpperCase().replace(/\s+/g, ''); return { items: UNI.filter((u) => u.id.includes(Q) || u.name.toUpperCase().replace(/\s+/g, '').includes(Q)).map((u) => ({ ...u })) }; }
  const RES = [
    ['HDFC Bank', 'Q2 FY27', 'Net profit up 11%, interest income beats estimates (demo)', 0.6, '1 day ago'],
    ['ICICI Bank', 'Q2 FY27', 'Profit up 14%, asset quality stable (demo)', 0.7, '2 days ago'],
    ['Infosys', 'Q2 FY27', 'Profit in line, but full-year guidance cut (demo)', -0.3, '2 days ago'],
    ['Axis Bank', 'Q2 FY27', 'Profit misses as slippages rise (demo)', -0.5, '3 days ago'],
    ['Reliance', 'Q2 FY27', 'Retail and Jio strong, O2C weak (demo)', 0.1, '3 days ago'],
  ].map(([co, q, t, s, ago]) => ({ co, q, t, s, ago }));
  return { mode: 'demo', init, tick, get, clock, search, TICK_MS: 2000, results: () => ({ ai: false, items: RES }), drop: (k) => { delete S[k]; },
    world: () => { const N = typeof A !== 'undefined' && A.NIFTY, g = WORLD_DEMO.items[0]; if (N) { g.price = Math.round((N.sessionLive ? N.PC : N.price) * 1.0035 * 2) / 2; } return WORLD_DEMO; }, participant: () => PART_DEMO,
    global: () => GLOB, calendar: () => CAL, geo: () => GEO, official: () => OFF, fiiAuto: () => ({ fii: 1184, dii: 926, src: 'demo', date: 'demo' }) };
})();
