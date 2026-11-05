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
  const S = {};
  let vix = 13.4; const vixPrev = 13.9;

  function mkCandle(st, d, m) {
    const r = st.r, sig = 0.00042 * (m < 30 ? 1.8 : m > 345 ? 1.4 : 1), o = st.p;
    const c = o * (1 + st.drift + gauss(r) * sig), h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * sig * 0.6), l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * sig * 0.6);
    const v = Math.round((800 + r() * 900) * (1 + 1.8 * ((m - 187) / 187) ** 2));
    st.p = c; return { d, m, o, h, l, c, v };
  }
  function init() {
    for (const key of KEYS) {
      const pc = P[key], st = { r: rng(pc.seed), p: pc.base * 0.992, series: [] };
      for (let d = 0; d < 3; d++) {
        st.drift = ((st.r() - 0.42) * 0.006) / 375; if (d > 0) st.p *= 1 + gauss(st.r) * 0.0025;
        const mins = d < 2 ? 375 : 250; for (let m = 0; m < mins; m++) st.series.push(mkCandle(st, d, m));
      }
      S[key] = st;
    }
  }
  function tick() {
    const nl = S.NIFTY.series, before = nl[nl.length - 1].c; let moved = false;
    for (const k of KEYS) { const st = S[k], l = st.series[st.series.length - 1]; if (l.m < 374) { st.series.push(mkCandle(st, 2, l.m + 1)); moved = true; } }
    if (moved) { const ret = (nl[nl.length - 1].c - before) / before; vix = clamp(vix + (Math.random() - 0.5) * 0.05 - ret * 250, 9, 30); }
    return moved;
  }
  function chainFor(key, Sp, curMin, chg) {
    const cf = CFG[key], pc = P[key], atm = Math.round(Sp / cf.step) * cf.step, dte = pc.dte + (375 - curMin) / 375, T = Math.max(dte, 0.02) / 365;
    const bias = clamp(chg * 0.3, -0.5, 0.5), rows = [];
    for (let i = -15; i <= 15; i++) {
      const K = atm + i * cf.step, m = Math.log(K / Sp), iv = (vix / 100) * pc.ivf * (1 + 6 * Math.abs(m) - 2.5 * m), dist = (K - Sp) / cf.step, round = K % (cf.step * 2) === 0 ? 1.15 : 1;
      const ceL = (5 + 32 * Math.exp(-((dist - 3) ** 2) / 14) + 9 * hrand(K, pc.seed)) * (1 - bias) * round;
      const peL = (5 + 32 * Math.exp(-((dist + 3) ** 2) / 14) + 9 * hrand(K, pc.seed + 5)) * (1 + bias) * round;
      const ceC = ceL * ((hrand(K, pc.seed + 9) - 0.5) * 0.3 - bias * 0.25), peC = peL * ((hrand(K, pc.seed + 13) - 0.5) * 0.3 + bias * 0.25);
      const side = (type, oiL, chL) => {
        const b = bs(Sp, K, T, iv, type), ltp = tick05(b.price), spr = Math.max(0.05, tick05(ltp * 0.003));
        return { ltp, bid: tick05(ltp - spr), ask: tick05(ltp + spr), oi: Math.round(oiL * 1e5), poi: Math.round((oiL - chL) * 1e5), iv, de: b.delta, ga: b.gamma, th: b.theta, ve: b.vega };
      };
      rows.push({ K, ce: side('CE', ceL, ceC), pe: side('PE', peL, peC) });
    }
    return { expiry: 'Demo', dte, lot: APP_CONFIG.LOT_FALLBACK[key], rows };
  }
  function get(key) {
    const pc = P[key], s1 = S[key].series, prev = s1.filter((x) => x.d === 1), last = s1[s1.length - 1];
    const PC = prev[prev.length - 1].c, price = last.c, chg = ((price - PC) / PC) * 100;
    return {
      key, candles: s1, price, prevClose: PC, sessionLive: last.m < 374, dayLabels: ['Thu', 'Fri', 'Today'],
      chain: chainFor(key, price, last.m, chg), vix: { v: vix, prev: vixPrev }, fii: 1184, dii: 926,
      hv: pc.hv.map(([n, w], i) => ({ n, w, c: chg * (0.8 + 0.5 * hrand(i, pc.seed)) + (hrand(i, pc.seed + 1) - 0.5) * 1.2 })),
      news: pc.news.map(([t, s, imp, ago]) => ({ t, s, imp, ago })),
    };
  }
  function clock() { const m = S.NIFTY.series[S.NIFTY.series.length - 1].m; return { min: m, date: 'DEMO', label: m >= 374 ? 'Market closed (demo)' : `Demo time ${hm(m)} (fast)` }; }
  const RES = [
    ['HDFC Bank', 'Q2 FY27', 'Net profit up 11%, interest income beats estimates (demo)', 0.6, '1 day ago'],
    ['ICICI Bank', 'Q2 FY27', 'Profit up 14%, asset quality stable (demo)', 0.7, '2 days ago'],
    ['Infosys', 'Q2 FY27', 'Profit in line, but full-year guidance cut (demo)', -0.3, '2 days ago'],
    ['Axis Bank', 'Q2 FY27', 'Profit misses as slippages rise (demo)', -0.5, '3 days ago'],
    ['Reliance', 'Q2 FY27', 'Retail and Jio strong, O2C weak (demo)', 0.1, '3 days ago'],
  ].map(([co, q, t, s, ago]) => ({ co, q, t, s, ago }));
  return { mode: 'demo', init, tick, get, clock, TICK_MS: 2000, results: () => ({ ai: false, items: RES }) };
})();
