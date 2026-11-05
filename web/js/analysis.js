/* ===== विश्लेषण: डेटा → संकेत, स्कोर, लेवल, सेटअप ===== */
const CFG = {
  NIFTY: { label: 'NIFTY 50', voice: 'निफ्टी', step: 50, exch: 'NSE', cons: 50 },
  SENSEX: { label: 'SENSEX', voice: 'सेंसेक्स', step: 100, exch: 'BSE', cons: 30 },
  BANKNIFTY: { label: 'BANK NIFTY', voice: 'बैंक निफ्टी', step: 100, exch: 'NSE', cons: 12 },
};
const KEYS = Object.keys(CFG);

function nearestRow(rows, K) { let b = null; for (const r of rows) if (!b || Math.abs(r.K - K) < Math.abs(b.K - K)) b = r; return b; }
function sideIV(o) { return o && o.iv > 0 ? o.iv : null; }

function analyze(D) {
  const cf = CFG[D.key], s1 = D.candles;
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
  const or = today.filter((x) => x.m < 15), ORH = Math.max(...or.map((x) => x.h)), ORL = Math.min(...or.map((x) => x.l));
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
  const atm = atmRow ? atmRow.K : Math.round(price / cf.step) * cf.step;
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
  const near = rows.filter((r) => Math.abs(r.K - price) <= cf.step * 15);
  const maxCE = near.length ? near.reduce((a, b) => (b.ce.oi > a.ce.oi ? b : a)).K : null, maxPE = near.length ? near.reduce((a, b) => (b.pe.oi > a.pe.oi ? b : a)).K : null;
  const ceCh = sum((r) => r.ce.oi - (r.ce.poi || r.ce.oi)), peCh = sum((r) => r.pe.oi - (r.pe.poi || r.pe.oi));
  const ch = { rows, view, atm, atmRow, atmIV, T, dte, expiry: C.expiry, lot: C.lot, mp, pcr: ceTot ? peTot / ceTot : null, ceTot, peTot, ceChTot: ceCh, peChTot: peCh, maxCE, maxPE, straddle: atmRow ? atmRow.ce.ltp + atmRow.pe.ltp : null };

  // बाज़ार का मूड
  const hv = (D.hv || []).filter((h) => ok(h.c)).map((h) => ({ ...h, pts: ((price * h.w) / 100) * (h.c / 100) }));
  const hvW = hv.length ? hv.reduce((s, h) => s + h.w * h.c, 0) / hv.reduce((s, h) => s + h.w, 0) : null;
  const news = D.news || [], newsAvg = news.length ? news.reduce((s, n) => s + n.s, 0) / news.length : null;
  const vix = D.vix || null;

  // संकेत
  const L = I5.k.length - 1, g = (a) => a[L];
  const vw = g(I5.vwap), e20 = g(I5.ema20), e50 = g(I5.ema50), stD = g(I5.st.dir), stV = g(I5.st.st), mh = g(I5.macd.hist), rsv = g(I5.rsi);
  const ax = g(I5.adx.adx), pdi = g(I5.adx.pdi), mdi = g(I5.adx.mdi), bm = g(I5.bb.mid), bu = g(I5.bb.up), bl = g(I5.bb.lo), at = g(I5.atr) || (DH - DL) / 5 || price * 0.001;
  const pat = pattern(I5.k);
  const e15 = ema(k15.map((x) => x.c), 20).pop(), e60 = ema(k60.map((x) => x.c), 9).pop();
  const c15 = k15[k15.length - 1].c, c60 = k60[k60.length - 1].c;
  const mtf = (ok(e15) ? (c15 > e15 ? 1 : -1) : 0) + (ok(e60) ? (c60 > e60 ? 1 : -1) : 0);
  const fibPos = (price - DL) / (DH - DL || 1);
  const sigs = [], add = (gp, n, v, s, w) => sigs.push({ g: gp, n, v, s: ok(s) ? s : 0, w });
  const vwName = hasVol ? 'भाव बनाम VWAP' : 'भाव बनाम TWAP (इंडेक्स में वॉल्यूम नहीं)';
  add('ट्रेंड', vwName, f1(vw), price > vw ? 1 : -1, 2);
  add('ट्रेंड', 'EMA 20 / EMA 50', `${f0(e20)} / ${f0(e50)}`, ok(e50) ? (e20 > e50 ? 1 : -1) : 0, ok(e50) ? 2 : 0);
  add('ट्रेंड', 'Supertrend (10,3)', f1(stV), stD, ok(stV) ? 2 : 0);
  add('ट्रेंड', 'ADX (14) ट्रेंड ताक़त', `ADX ${f1(ax)} · +DI ${f1(pdi)} · −DI ${f1(mdi)}`, ok(ax) && ax >= 20 ? (pdi > mdi ? 1 : -1) : 0, ok(ax) ? 1.5 : 0);
  add('ट्रेंड', 'मल्टी-टाइमफ़्रेम (15मि + 1घं)', mtf === 2 ? 'दोनों ऊपर' : mtf === -2 ? 'दोनों नीचे' : 'मिले-जुले', mtf === 2 ? 1 : mtf === -2 ? -1 : 0, 1.5);
  add('मोमेंटम', 'RSI (14)', f1(rsv) + (rsv > 75 ? ' ओवरबॉट' : rsv < 25 ? ' ओवरसोल्ड' : ''), rsv > 75 || rsv < 25 ? 0 : rsv > 55 ? 1 : rsv < 45 ? -1 : 0, ok(rsv) ? 1 : 0);
  add('मोमेंटम', 'MACD हिस्टोग्राम', f2(mh), mh > 0 ? 1 : -1, ok(mh) ? 1 : 0);
  add('मोमेंटम', 'Bollinger (20,2) %B', ok(bu) ? f1(((price - bl) / (bu - bl || 1)) * 100) + '%' : '–', price > bm ? 1 : -1, ok(bm) ? 0.5 : 0);
  add('मोमेंटम', 'कैंडल पैटर्न (5मि)', pat[0], pat[1], 1);
  add('लेवल', 'CPR', price > tc ? 'TC के ऊपर' : price < bc ? 'BC के नीचे' : 'CPR के अंदर', price > tc ? 1 : price < bc ? -1 : 0, 1.5);
  add('लेवल', 'ओपनिंग रेंज (15मि)', curMin < 15 ? 'बन रही है' : price > ORH ? 'हाई ब्रेकआउट' : price < ORL ? 'लो ब्रेकडाउन' : 'रेंज के अंदर', curMin < 15 ? 0 : price > ORH ? 1 : price < ORL ? -1 : 0, 1.5);
  add('लेवल', hasVol ? 'वॉल्यूम प्रोफ़ाइल POC' : 'TPO प्रोफ़ाइल POC', f1(VP.POC), price > VP.POC ? 1 : -1, 1);
  add('लेवल', 'Fibonacci (दिन की रेंज)', `रेंज का ${Math.round(fibPos * 100)}%`, fibPos > 0.5 ? 1 : -1, 0.5);
  add('ऑप्शन डेटा', 'PCR', f2(ch.pcr), ch.pcr > 1.2 ? 1 : ch.pcr < 0.8 ? -1 : 0, ok(ch.pcr) ? 1.5 : 0);
  add('ऑप्शन डेटा', 'OI बदलाव (PE बनाम CE)', `PE ${sgn(peCh)}${f1(peCh / 1e5)} · CE ${sgn(ceCh)}${f1(ceCh / 1e5)} लाख`, peCh > ceCh + Math.abs(ceCh) * 0.1 ? 1 : ceCh > peCh + Math.abs(peCh) * 0.1 ? -1 : 0, rows.length ? 1.5 : 0);
  add('ऑप्शन डेटा', 'मैक्स पेन', f0(mp), mp == null ? 0 : price < mp - cf.step / 2 ? 1 : price > mp + cf.step / 2 ? -1 : 0, mp == null ? 0 : dte <= 2 ? 1 : 0.5);
  add('मार्केट मूड', 'India VIX', vix ? `${f2(vix.v)} (${vix.v < vix.prev ? 'घटा' : 'बढ़ा'})` : 'डेटा नहीं', vix ? (vix.v < vix.prev ? 1 : -1) : 0, vix ? 0.5 : 0);
  add('मार्केट मूड', 'FII कैश (₹ करोड़)', ok(D.fii) ? sgn(D.fii) + f0(D.fii) : 'डेटा नहीं (मार्केट मूड टैब में डालें)', ok(D.fii) ? (D.fii > 0 ? 1 : -1) : 0, ok(D.fii) ? 1 : 0);
  add('मार्केट मूड', 'हैवीवेट शेयर', ok(hvW) ? sgn(hvW) + f2(hvW) + '%' : 'डेटा नहीं', ok(hvW) ? (hvW > 0.2 ? 1 : hvW < -0.2 ? -1 : 0) : 0, ok(hvW) ? 1 : 0);
  add('न्यूज़', 'न्यूज़ सेंटिमेंट', ok(newsAvg) ? f2(newsAvg) : 'ख़बरें नहीं', ok(newsAvg) ? (newsAvg > 0.15 ? 1 : newsAvg < -0.15 ? -1 : 0) : 0, ok(newsAvg) ? 1 : 0);
  const sw = sigs.reduce((s, x) => s + x.w, 0);
  const score = sw ? Math.round(50 + (50 * sigs.reduce((s, x) => s + x.w * x.s, 0)) / sw) : 50;
  const active = sigs.filter((x) => x.w > 0).length;

  const lv = [...Object.entries(piv), ['CPR TC', tc], ['CPR BC', bc], ['ओपनिंग हाई', ORH], ['ओपनिंग लो', ORL], ['दिन का हाई', DH], ['दिन का लो', DL], ['VAH', VP.VAH], ['VAL', VP.VAL], ['POC', VP.POC], ['VWAP', vw]];
  if (ok(maxCE)) lv.push(['CE OI दीवार', maxCE]);
  if (ok(maxPE)) lv.push(['PE OI दीवार', maxPE]);
  const res = lv.filter((x) => x[1] > price + at * 0.05).sort((a, b) => a[1] - b[1])[0], sup = lv.filter((x) => x[1] < price - at * 0.05).sort((a, b) => b[1] - a[1])[0];

  return { key: D.key, cf, D, price, chg, PC, curMin, sessionLive: D.sessionLive, dayLabels: D.dayLabels, hasVol, I5, piv, tc, bc, p, ORH, ORL, DH, DL, fib, upSwing, VP, ch, hv, hvW, news, newsAvg, vix, fii: D.fii, dii: D.dii,
    sigs, score, active, atr: at, rsi: rsv, adx: ax, res, sup, stV, stD, vw, lot: C.lot || APP_CONFIG.LOT_FALLBACK[D.key] };
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

function setupFor(a, dir) {
  const risk = 1.5 * a.atr, e = a.price, sd = dir === 'CE' ? 1 : -1;
  const q = optQuote(a, a.ch.atm, dir), dl = Math.abs(q.delta || 0.5), P = q.ltp;
  return { dir, e, sl: e - sd * risk, t1: e + sd * risk * 1.5, t2: e + sd * risk * 2.5, risk, K: a.ch.atm, P,
    pSL: tick05(Math.max(0.05, P - dl * risk)), pT1: tick05(P + dl * risk * 1.5), delta: q.delta, theta: q.theta };
}

function alertsFor(a, dir) {
  const out = [];
  if (a.vix && a.vix.v > 16) out.push(['d', `India VIX ${f1(a.vix.v)} ऊँचा है: प्रीमियम महँगे हैं और झटके बड़े हो सकते हैं।`]);
  if (ok(a.adx) && a.adx < 20) out.push(['w', `ADX ${f1(a.adx)}: मार्केट साइडवेज़ है, ब्रेकआउट फ़ेल होने का ख़तरा ज़्यादा।`]);
  if (a.rsi > 70) out.push(['w', `RSI ${f1(a.rsi)} ओवरबॉट: नई कॉल ख़रीदने में देर हो सकती है।`]);
  if (a.rsi < 30) out.push(['w', `RSI ${f1(a.rsi)} ओवरसोल्ड: नई पुट ख़रीदने में देर हो सकती है।`]);
  if (a.ch.dte <= 1 && a.ch.atmRow) out.push(['d', `एक्सपायरी नज़दीक: ATM प्रीमियम लगभग ₹${f1(Math.abs(a.ch.atmRow.ce.th))} रोज़ थीटा से घट रहा है।`]);
  if (dir === 'CE' && a.res && a.res[1] - a.price < 0.6 * a.atr) out.push(['w', `ठीक ऊपर रेज़िस्टेंस: ${a.res[0]} ${f0(a.res[1])}।`]);
  if (dir === 'PE' && a.sup && a.price - a.sup[1] < 0.6 * a.atr) out.push(['w', `ठीक नीचे सपोर्ट: ${a.sup[0]} ${f0(a.sup[1])}।`]);
  if (Math.abs(a.tc - a.bc) / a.price < 0.001) out.push(['i', 'CPR बहुत पतला है: आज ट्रेंडिंग दिन होने की संभावना।']);
  if (a.curMin >= 315) out.push(['w', 'आख़िरी घंटा: तेज़ उतार-चढ़ाव और स्प्रेड बढ़ सकते हैं।']);
  if (!a.hasVol) out.push(['i', 'इंडेक्स का वॉल्यूम नहीं आता, इसलिए VWAP की जगह TWAP और वॉल्यूम प्रोफ़ाइल की जगह TPO इस्तेमाल हो रहा है।']);
  out.push(['i', 'एक ट्रेड में कुल पूंजी का 1–2% से ज़्यादा जोखिम न लें। स्टॉप-लॉस पहले से तय रखें।']);
  return out;
}

// पेपर ट्रेडिंग का बड़ा सिग्नल: कॉल / पुट / रुको
function signalFor(a) {
  const pro = (d) => a.sigs.filter((x) => x.w > 0 && x.s * d > 0).sort((x, y) => y.w - x.w);
  const con = (d) => a.sigs.filter((x) => x.w > 0 && x.s * d < 0).sort((x, y) => y.w - x.w);
  if (!a.sessionLive) return { state: 'WAIT', title: 'बाज़ार बंद है', sub: 'अगले सत्र में 9:30 के बाद सिग्नल शुरू होंगे', reasons: [], against: [] };
  if (a.curMin < 15) return { state: 'WAIT', title: 'रुको: ओपनिंग रेंज बन रही है', sub: 'पहले 15 मिनट (9:30 तक) कोई नया सिग्नल नहीं', reasons: [], against: [] };
  if (a.curMin >= 345) return { state: 'WAIT', title: 'रुको: नई ट्रेड का समय निकल गया', sub: '3:00 के बाद नई पोज़िशन जोखिम भरी, खुली पोज़िशन 3:20 पर बंद होगी', reasons: [], against: [] };
  const s = a.score;
  let state = s >= 58 ? 'CE' : s <= 42 ? 'PE' : 'WAIT';
  if (state === 'WAIT') return { state, title: 'रुको: साफ़ सेटअप नहीं', sub: `स्कोर ${s}: संकेत मिले-जुले हैं। इंतज़ार करना भी एक पोज़िशन है।`, reasons: [...pro(1).slice(0, 2), ...pro(-1).slice(0, 2)], against: [] };
  const d = state === 'CE' ? 1 : -1, strength0 = d === 1 ? s : 100 - s;
  let strength = strength0 >= 70 ? 'मज़बूत' : 'हल्का';
  const caveats = [];
  if (ok(a.adx) && a.adx < 20) { strength = 'हल्का'; caveats.push('ADX 20 से कम: ट्रेंड कमज़ोर'); }
  if (a.vix && a.vix.v > 18) caveats.push('VIX ऊँचा: प्रीमियम महँगे');
  return {
    state, strength, dirScore: strength0,
    title: state === 'CE' ? `📈 कॉल (CE) का ${strength} सेटअप` : `📉 पुट (PE) का ${strength} सेटअप`,
    sub: `${a.cf.label} · स्कोर ${s} · ${a.active} में से ${pro(d).length} संकेत पक्ष में`,
    reasons: pro(d).slice(0, 3), against: con(d).slice(0, 2), caveats, setup: setupFor(a, state),
  };
}
