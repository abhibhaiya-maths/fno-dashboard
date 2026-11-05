/* ===== डेमो डेटा (सिम्युलेशन) — लाइव डेटा जैसा ही ढाँचा ===== */
const DemoSource = (() => {
  const P = {
    NIFTY: { base: 25420, dte: 1, ivf: 1.0, seed: 101,
      hv: [['HDFC Bank', 13], ['ICICI Bank', 9], ['Reliance', 8.5], ['Infosys', 5], ['Bharti Airtel', 4.5], ['L&T', 4], ['ITC', 3.5], ['TCS', 3]],
      news: [['FII ने लगातार तीसरे दिन कैश मार्केट में ख़रीदारी की', 0.6, 'मध्यम', '1 घंटा पहले'], ['बड़े निजी बैंकों के Q2 नतीजे उम्मीद से बेहतर', 0.5, 'ऊँचा', '3 घंटे पहले'],
        ['IT कंपनियों की गाइडेंस सतर्क, शेयरों पर दबाव', -0.3, 'मध्यम', '5 घंटे पहले'], ['कच्चे तेल के दाम में हल्की तेज़ी', -0.3, 'मध्यम', '6 घंटे पहले'], ['इस हफ़्ते US फ़ेड के बयान पर नज़र', -0.1, 'ऊँचा', 'कल']] },
    SENSEX: { base: 83150, dte: 3, ivf: 0.95, seed: 202,
      hv: [['HDFC Bank', 15], ['ICICI Bank', 10], ['Reliance', 10], ['Infosys', 6], ['Bharti Airtel', 5], ['L&T', 4.5], ['ITC', 4], ['TCS', 3.5]],
      news: [['घरेलू म्यूचुअल फ़ंड में SIP निवेश रिकॉर्ड स्तर पर', 0.5, 'मध्यम', '2 घंटे पहले'], ['बैंकिंग और फ़ाइनेंशियल शेयरों में ख़रीदारी', 0.5, 'ऊँचा', '3 घंटे पहले'],
        ['ऑटो सेक्टर की बिक्री त्योहारों से पहले मज़बूत', 0.4, 'मध्यम', '4 घंटे पहले'], ['वैश्विक बाज़ारों में मिला-जुला रुख़', -0.1, 'कम', '6 घंटे पहले']] },
    BANKNIFTY: { base: 57280, dte: 8, ivf: 1.12, seed: 303,
      hv: [['HDFC Bank', 28], ['ICICI Bank', 25], ['SBI', 9], ['Kotak Bank', 8], ['Axis Bank', 8], ['IndusInd Bank', 3.5], ['Federal Bank', 3], ['AU Bank', 2.5]],
      news: [['बड़े निजी बैंकों के Q2 नतीजे मज़बूत, ब्याज आय में बढ़त', 0.7, 'ऊँचा', '2 घंटे पहले'], ['RBI: सिस्टम में लिक्विडिटी सहज रहने के संकेत', 0.4, 'ऊँचा', '4 घंटे पहले'],
        ['PSU बैंकों में मुनाफ़ावसूली', -0.3, 'मध्यम', '5 घंटे पहले'], ['अनसिक्योर्ड लोन पर कुछ बैंकों में चिंता बरकरार', -0.4, 'मध्यम', 'कल']] },
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
    return { expiry: 'डेमो', dte, lot: APP_CONFIG.LOT_FALLBACK[key], rows };
  }
  function get(key) {
    const pc = P[key], s1 = S[key].series, prev = s1.filter((x) => x.d === 1), last = s1[s1.length - 1];
    const PC = prev[prev.length - 1].c, price = last.c, chg = ((price - PC) / PC) * 100;
    return {
      key, candles: s1, price, prevClose: PC, sessionLive: last.m < 374, dayLabels: ['गुरु', 'शुक्र', 'आज'],
      chain: chainFor(key, price, last.m, chg), vix: { v: vix, prev: vixPrev }, fii: 1184, dii: 926,
      hv: pc.hv.map(([n, w], i) => ({ n, w, c: chg * (0.8 + 0.5 * hrand(i, pc.seed)) + (hrand(i, pc.seed + 1) - 0.5) * 1.2 })),
      news: pc.news.map(([t, s, imp, ago]) => ({ t, s, imp, ago })),
    };
  }
  function clock() { const m = S.NIFTY.series[S.NIFTY.series.length - 1].m; return { min: m, date: 'DEMO', label: m >= 374 ? 'बाज़ार बंद (डेमो)' : `डेमो समय ${hm(m)} (तेज़)` }; }
  return { mode: 'demo', init, tick, get, clock, TICK_MS: 2000 };
})();
