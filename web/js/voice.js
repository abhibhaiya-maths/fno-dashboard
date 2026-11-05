/* ===== Voice: ask by speaking or typing. Screen answers are English; spoken answers are Hindi. ===== */
const Voice = (() => {
  let recog = null, listening = false;
  const hint = (t) => ($('hint').textContent = t);
  function say(t) {
    if (!t || !('speechSynthesis' in window) || !$('tts') || !$('tts').checked) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t); u.lang = 'hi-IN';
      const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('hi'));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }
  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return hint('Voice input isn’t supported in this browser. Open in Chrome, or type your question.');
    if (listening) return recog.stop();
    recog = new SR(); recog.lang = 'hi-IN'; recog.interimResults = true; recog.maxAlternatives = 1;
    recog.onstart = () => { listening = true; $('mic').classList.add('rec'); hint('Listening… speak in Hindi or English'); };
    recog.onresult = (e) => { let t = ''; for (const r of e.results) t += r[0].transcript; $('q').value = t; if (e.results[e.results.length - 1].isFinal) ask(); };
    recog.onerror = (e) => hint(e.error === 'not-allowed' ? 'Microphone permission was blocked. Allow it in the browser (the site must be on https).' : 'Didn’t catch that. Tap the mic and try again.');
    recog.onend = () => { listening = false; $('mic').classList.remove('rec'); };
    try { recog.start(); } catch { hint('Couldn’t start the mic. Tap it again.'); }
  }
  function parseQ(raw) {
    const t = raw.replace(/[०-९]/g, (d) => '०१२३४५६७८९'.indexOf(d)).replace(/(\d)[,\s](?=\d{3}\b)/g, '$1').toLowerCase();
    let key = null;
    if (/bank\s*nifty|banknifty|बैंक\s*निफ़?्टी|बैंकनिफ्टी/.test(t)) key = 'BANKNIFTY';
    else if (/sensex|सेंसेक्स|सेनसेक्स/.test(t)) key = 'SENSEX';
    else if (/nifty|निफ़?्टी/.test(t)) key = 'NIFTY';
    let type = null;
    if (/\bput\b|पुट|\bpe\b/.test(t)) type = 'PE'; else if (/\bcall\b|कॉल|काल|\bce\b/.test(t)) type = 'CE';
    const m = t.match(/\d{4,6}/);
    const hold = /होल्ड|hold|exit|एग्जिट|एग्ज़िट|बेच|निकल|sell my|my position/.test(t);
    return { key, type, K: m ? +m[0] : null, hold };
  }

  // ===== Full dashboard data for the AI =====
  const HIST = []; // last 4 Q&A, so follow-ups like "and its stop-loss?" work
  const r0 = (v) => (ok(v) ? Math.round(v * 100) / 100 : null);
  function idxSummary(x) {
    const today = x.D.candles.filter((c) => c.d === 2);
    return { index: x.cf.label, session: x.dayLabels[2] === 'Today' ? 'today' : 'previous session: ' + x.dayLabels[2], marketOpenNow: x.sessionLive,
      open: r0(today.length ? today[0].o : null), high: r0(x.DH), low: r0(x.DL), price: r0(x.price), prevClose: r0(x.PC), chgPts: r0(x.price - x.PC), chgPct: r0(x.chg),
      score: x.score, signal: signalFor(x).title };
  }
  function fullCtx(a) {
    const s = signalFor(a), st = a.score >= 58 ? setupFor(a, 'CE') : a.score <= 42 ? setupFor(a, 'PE') : null;
    const near = a.ch.view.map((r) => ({ K: r.K, ceLtp: r0(r.ce.ltp), ceOI: r.ce.oi, ceOIchg: r.ce.oi - (r.ce.poi || r.ce.oi), ceIV: r0(r.ce.iv * 100), ceDelta: r0(r.ce.de),
      peLtp: r0(r.pe.ltp), peOI: r.pe.oi, peOIchg: r.pe.oi - (r.pe.poi || r.pe.oi), peIV: r0(r.pe.iv * 100), peDelta: r0(r.pe.de) }));
    const k5 = a.I5.k.filter((c) => c.d === 2).slice(-12).map((c) => [hm(c.m), r0(c.o), r0(c.h), r0(c.l), r0(c.c)]);
    const pj = Engine.projection(a);
    return {
      now: Source.clock().label, mode: Source.mode, selected: idxSummary(a), allIndices: KEYS.filter((k) => A[k]).map((k) => idxSummary(A[k])),
      signalPanel: { title: s.title, detail: s.sub, reasonsFor: (s.reasons || []).map((x) => x.n), against: (s.against || []).map((x) => x.n), caveats: s.caveats || [] },
      projection30m: { upsidePct: pj.up, downsidePct: pj.dn, expectedLow: r0(pj.lo), expectedHigh: r0(pj.hi), entryZone: pj.dir ? [r0(pj.entryLo), r0(pj.entryHi)] : null },
      all20Signals: a.sigs.map((x) => ({ group: x.g, name: x.n, value: x.v, direction: x.s > 0 ? 'bullish' : x.s < 0 ? 'bearish' : 'neutral', weight: x.w })),
      indicators5m: { rsi: r0(a.rsi), adx: r0(a.adx), atr: r0(a.atr), supertrend: r0(a.stV), supertrendDir: a.stD === 1 ? 'up' : 'down', vwapOrTwap: r0(a.vw) },
      last12Candles5m: k5,
      levels: { pivots: Object.fromEntries(Object.entries(a.piv).map(([k, v]) => [k, r0(v)])), cprTC: r0(a.tc), cprBC: r0(a.bc), openingRangeHigh: r0(a.ORH), openingRangeLow: r0(a.ORL),
        fibonacci: a.fib.map((f) => ({ level: (f.r * 100).toFixed(1) + '%', price: r0(f.v) })), fibDirection: a.upSwing ? 'low→high' : 'high→low',
        volumeProfile: { POC: r0(a.VP.POC), VAH: r0(a.VP.VAH), VAL: r0(a.VP.VAL) }, nearestResistance: a.res, nearestSupport: a.sup },
      optionChain: { expiry: a.ch.expiry, daysToExpiry: r0(a.ch.dte), lotSize: a.lot, atm: a.ch.atm, pcr: r0(a.ch.pcr), maxPain: a.ch.mp, atmIV: r0(a.ch.atmIV * 100), straddle: r0(a.ch.straddle),
        callOIWall: a.ch.maxCE, putOIWall: a.ch.maxPE, strikesNearATM: near },
      marketMood: { vix: a.vix, fiiCr: a.fii, diiCr: a.dii, heavyweights: a.hv.map((h) => ({ name: h.n, weight: h.w, chgPct: r0(h.c) })) },
      tradeSetup: st ? { direction: st.dir, strike: st.K, indexEntry: r0(st.e), indexSL: r0(st.sl), indexT1: r0(st.t1), indexT2: r0(st.t2), premium: r0(st.P), premiumSL: st.pSL, premiumT1: st.pT1 } : 'no clear setup',
      alerts: alertsFor(a, st ? st.dir : null).map((x) => x[1]),
      news: a.news.slice(0, 8).map((n) => ({ headline: n.t, sentiment: r0(n.s), ago: n.ago })),
      quarterlyResults: (Source.results ? Source.results().items : []).slice(0, 8).map((n) => ({ company: n.co, quarter: n.q, summary: n.t, sentiment: r0(n.s) })),
      paperTrading: { openPositions: Paper.openTrades().map((t) => ({ index: t.label, strike: t.K, type: t.type, lots: t.lots, entry: t.entry, now: t.ltp, sl: t.sl, target: t.tgt, pnl: r0((t.ltp - t.entry) * t.qty), advice: t.advice ? t.advice.title : null })) },
    };
  }
  const aiOn = () => Source.mode === 'live' && Source.status && Source.status.ai;
  async function askAI(raw, a, slot) {
    $(slot).innerHTML = '<div class="alert i">AI is reading the dashboard data…</div>';
    try {
      const r = await Source.ask(raw, fullCtx(a), HIST.slice(-4));
      HIST.push({ q: raw, a: r.answer });
      $(slot).innerHTML = `<div class="alert i"><b>AI answer</b><br>${esc(r.answer).replace(/\n/g, '<br>')}</div>`;
      say(r.speak || r.answer);
      return true;
    } catch (e) { $(slot).innerHTML = `<div class="alert">No answer from AI: ${esc(e.message)}</div>`; return false; }
  }

  // ===== Any question that isn't "buy CE/PE?" =====
  // AI on: every question goes to AI with the full dashboard (plus an instant data card where one fits)
  // AI off: known question types are answered straight from the data
  function localCard(raw, a) {
    const t = raw.toLowerCase(), cf = a.cf, today = a.D.candles.filter((x) => x.d === 2);
    const live = a.dayLabels[2] === 'Today';
    const dayEn = live ? 'Today' : `Last session (${a.dayLabels[2]})`, dayHi = live ? 'आज' : 'पिछले सत्र में';
    const open = today.length ? today[0].o : a.PC, pts = a.price - a.PC;
    const has = (re) => re.test(t);
    if (has(/हाई|high|लो\b|low|टच|touch|ऊपर|नीचे|पॉइंट|point|रेंज|range|खुला|open|बंद|close|गिरा|चढ़ा|बढ़ा|कितना|कहाँ तक|move|moved/)) return { html: `<h3>${cf.label}: ${dayEn}</h3>
        <div class="lv"><div><small>Open</small><b>${f2(open)}</b></div><div><small>Day high</small><b class="up">${f2(a.DH)}</b></div><div><small>Day low</small><b class="down">${f2(a.DL)}</b></div></div>
        <div class="row"><span>${a.sessionLive ? 'Current price' : 'Last price'}</span><b>${f2(a.price)}</b></div>
        <div class="row"><span>Change from previous close (${f2(a.PC)})</span><b class="${pts >= 0 ? 'up' : 'down'}">${sgn(pts)}${f2(pts)} pts (${sgn(a.chg)}${f2(a.chg)}%)</b></div>
        <div class="row"><span>Day range (high − low)</span><b>${f2(a.DH - a.DL)} pts</b></div>`,
      say: `${cf.voice} ${dayHi} ${Math.round(open)} पर खुला। ऊपर में ${Math.round(a.DH)} तक गया और नीचे में ${Math.round(a.DL)} तक आया। ${a.sessionLive ? 'अभी' : 'आख़िर में'} ${Math.round(a.price)} पर है, यानी पिछले बंद से ${Math.abs(Math.round(pts))} पॉइंट ${pts >= 0 ? 'ऊपर' : 'नीचे'}।` };
    if (has(/सपोर्ट|support|रेज़िस्टेंस|रेजिस्टेंस|resistance|लेवल|level|पिवट|pivot|cpr|fib|फिबोनाची/)) return { html: `<h3>${cf.label}: nearby levels</h3>
        <div class="row"><span>Current price</span><b>${f2(a.price)}</b></div>
        <div class="row"><span>Resistance above</span><b class="down">${a.res ? `${esc(a.res[0])} ${f1(a.res[1])}` : '–'}</b></div>
        <div class="row"><span>Support below</span><b class="up">${a.sup ? `${esc(a.sup[0])} ${f1(a.sup[1])}` : '–'}</b></div>
        <div class="row"><span>Call OI wall / put OI wall</span><b>${f0(a.ch.maxCE)} / ${f0(a.ch.maxPE)}</b></div>
        <div class="row"><span>Fibonacci golden zone (50%–61.8%)</span><b>${f1(a.fib[3].v)} – ${f1(a.fib[4].v)}</b></div>`,
      say: `${cf.voice} अभी ${Math.round(a.price)} पर है। ऊपर ${a.res ? Math.round(a.res[1]) + ' पर' : 'कोई'} रेज़िस्टेंस है और नीचे ${a.sup ? Math.round(a.sup[1]) + ' पर' : 'कोई'} सपोर्ट है।` };
    if (has(/pcr|पीसीआर|मैक्स पेन|max pain|vix|विक्स|\biv\b|\boi\b|ऑप्शन चेन|option chain/)) return { html: `<h3>${cf.label}: option data</h3>
        <div class="row"><span>PCR</span><b>${f2(a.ch.pcr)}</b></div><div class="row"><span>Max pain</span><b>${f0(a.ch.mp)}</b></div>
        <div class="row"><span>ATM IV</span><b>${f1(a.ch.atmIV * 100)}%</b></div><div class="row"><span>India VIX</span><b>${a.vix ? f2(a.vix.v) : '–'}</b></div>
        <div class="row"><span>Expected range to expiry</span><b>${f0(a.price - a.ch.straddle)} – ${f0(a.price + a.ch.straddle)}</b></div>`,
      say: `${cf.voice} का PCR ${f2(a.ch.pcr)} है, मैक्स पेन ${Math.round(a.ch.mp)} पर है, और VIX ${a.vix ? f1(a.vix.v) : 'उपलब्ध नहीं'} है।` };
    if (has(/न्यूज़|न्यूज|ख़बर|खबर|news|रिजल्ट|रिज़ल्ट|नतीजे|result/)) {
      setNewsTab(has(/रिजल्ट|रिज़ल्ट|नतीजे|result/) ? 'results' : 'news');
      const top = a.news.slice(0, 3);
      return { html: `<h3>${cf.label}: news</h3>${top.length ? top.map((x) => `<div class="row"><span>${esc(x.t)}</span></div>`).join('') : '<div class="mut">No news right now.</div>'}`,
        say: top.length ? `${cf.voice} की ${top.length} ताज़ा ख़बरें स्क्रीन पर हैं। औसत सेंटिमेंट ${a.newsAvg > 0.15 ? 'बुलिश' : a.newsAvg < -0.15 ? 'बेयरिश' : 'न्यूट्रल'} है।` : 'अभी कोई ख़बर नहीं मिली।' };
    }
    if (has(/सिग्नल|signal|स्कोर|score|क्या लूँ|क्या करूँ|ट्रेड|trade|मार्केट|market|ट्रेंड|trend|मूड|sentiment|सेंटिमेंट|direction|setup/)) {
      const s = signalFor(a);
      return { html: `<h3>${cf.label}: current signal</h3><div class="dirbox ${s.state === 'CE' ? 'b' : s.state === 'PE' ? 's' : 'n'}">${esc(s.title)}<br><small>${esc(s.sub)}</small></div>`, say: signalHi(a) };
    }
    return null;
  }
  function general(raw, a) {
    const card = localCard(raw, a);
    if (aiOn()) {
      show(`${card ? card.html : `<h3>${a.cf.label}</h3>`}<div id="aiAns"></div>`, '');
      return askAI(raw, a, 'aiAns').then((done) => { if (!done && card) say(card.say); });
    }
    if (card) return show(card.html + `<div class="legend">To ask anything at all (e.g. "What drove today's move?", "How risky is my position?"), turn on AI: add a free GEMINI_API_KEY or a Workers AI binding in the Worker.</div>`, card.say);
    show(`<h3>${a.cf.label}</h3><div class="alert">This question needs AI, which is off. Add a free GEMINI_API_KEY (or a Workers AI binding) in the Cloudflare Worker, and you can ask anything about the dashboard.</div>
      <div class="legend">Without AI you can ask about: day high/low, support/resistance, PCR/VIX, news, the current signal, or "Should I buy ${a.cf.label} ${a.ch.atm} CE?"</div>`, 'ये सवाल समझने के लिए AI चालू करना होगा।');
  }
  function show(h, s) { openAsk(); $('answer').innerHTML = h; $('answer').classList.add('show'); hint('Tap the mic to ask another question.'); say(s); }

  async function ask() {
    const raw = $('q').value.trim(); if (!raw) return hint('Type or speak a question first.');
    const q = parseQ(raw);
    if (q.key && q.key !== cur) { cur = q.key; renderAll(); }
    const a = A[cur]; if (!a) return hint('Data is still loading…');
    const cf = a.cf;
    // About an open position: "hold or exit?"
    const op = Paper.openTrades().filter((t) => t.key === cur && (!q.K || t.K === Math.round(q.K / cf.step) * cf.step));
    if (q.hold && op.length) {
      const t = op[0], adv = t.advice || { state: 'HOLD', title: '🟢 Hold', hi: 'होल्ड करें', why: [] };
      return show(`<h3>${t.label} ${t.K} ${t.type} (your position)</h3><div class="adv ${{ HOLD: 'b', WARN: 'w', BOOK: 'o', EXIT: 's' }[adv.state] || 'b'}"><b>${adv.title}</b><div>${adv.why.map(esc).join('. ')}</div></div>
        <div class="row"><span>Bought → now</span><b>${f2(t.entry)} → ${f2(t.ltp)}</b></div><div class="row"><span>SL</span><b class="down">${f2(t.sl)}</b></div>`,
        `${cf.voice} ${t.K} ${t.type === 'CE' ? 'कॉल' : 'पुट'}: ${adv.hi || 'होल्ड करें'}। ख़रीद ${Math.round(t.entry)}, अभी ${Math.round(t.ltp)}, स्टॉप-लॉस ${Math.round(t.sl)}।`);
    }
    if (!q.type) return general(raw, a);
    let K = q.K ? Math.round(q.K / cf.step) * cf.step : a.ch.atm, note = '';
    if (q.K && K !== q.K) note = `(${q.K} isn't a strike; using nearest ${K})`;
    if (Math.abs(K - a.price) / a.price > 0.08) return show(`<h3>${cf.label} ${K} ${q.type}</h3>This strike is too far from the current price ${f0(a.price)}.`, 'ये स्ट्राइक मौजूदा भाव से बहुत दूर है।');
    const o = optQuote(a, K, q.type), b = bs(a.price, K, a.ch.T, o.iv, q.type), dir = q.type === 'CE' ? 1 : -1, ds = q.type === 'CE' ? a.score : 100 - a.score;
    const pro = a.sigs.filter((x) => x.w > 0 && x.s * dir > 0).sort((x, y) => y.w - x.w), con = a.sigs.filter((x) => x.w > 0 && x.s * dir < 0).sort((x, y) => y.w - x.w);
    const t = setupFor(a, q.type), dl = Math.abs(o.delta || 0.5), pSL = tick05(Math.max(0.05, o.ltp - dl * t.risk)), pT = tick05(o.ltp + dl * t.risk * 1.5);
    const mny = q.type === 'CE' ? (K < a.price ? 'in the money' : K > a.price ? 'out of the money' : 'at the money') : K > a.price ? 'in the money' : K < a.price ? 'out of the money' : 'at the money';
    const vd = ds >= 65 ? ['up', 'Most signals favour your direction', 'ज़्यादातर संकेत आपकी दिशा के पक्ष में हैं'] : ds >= 55 ? ['up', 'Signals mildly favour you', 'संकेत हल्के से आपके पक्ष में हैं'] : ds >= 45 ? ['', 'Signals are mixed, no clear direction', 'संकेत मिले-जुले हैं'] : ['down', 'Most signals are against your direction', 'ज़्यादातर संकेत आपकी दिशा के ख़िलाफ़ हैं'];
    const al = alertsFor(a, q.type).filter((x) => x[0] !== 'i');
    const li = (arr) => arr.slice(0, 4).map((x) => `<li>${esc(x.n)}: ${esc(x.v)}</li>`).join('') || '<li>None</li>';
    const html = `<h3>${cf.label} ${K} ${q.type === 'CE' ? 'CALL' : 'PUT'} <span class="mut" style="font-size:12px;font-weight:400">${note}</span></h3>
      <div class="row"><span>Score for your direction</span><b class="${vd[0]}">${ds}/100, ${vd[1]}</b></div>
      <div class="row"><span>Premium (${mny})</span><b>${rs(o.ltp)}</b></div>
      <div class="row"><span>Delta, theta/day, IV</span><span>${f2(o.delta)}, ₹${f1(o.theta)}, ${f1(o.iv * 100)}%</span></div>
      <div class="row"><span>Mathematical chance of expiring ITM</span><b>${Math.round(b.pitm * 100)}%</b></div>
      <div class="two" style="margin-top:8px"><div><b class="up">In favour (${pro.length})</b><ul>${li(pro)}</ul></div><div><b class="down">Against (${con.length})</b><ul>${li(con)}</ul></div></div>
      <div class="lv"><div><small>Index SL</small><b class="down">${f0(t.sl)}</b></div><div><small>Premium SL</small><b class="down">${rs(pSL)}</b></div><div><small>Premium target</small><b class="up">${rs(pT)}</b></div></div>
      ${al.map(([c, x]) => `<div class="alert ${c === 'd' ? 'd' : ''}">${x}</div>`).join('')}
      <div id="aiAns"></div>
      <button class="btn-ghost" style="margin-top:8px" onclick="Paper.openFromAsk(${K},'${q.type}')">Take a paper trade on this</button>
      <div class="legend" style="margin-top:8px">This is a probability, not a guarantee. The decision is yours.</div>`;
    const sayTxt = `${cf.voice} ${K} ${q.type === 'CE' ? 'कॉल' : 'पुट'}। आपकी दिशा का स्कोर ${ds} है, यानी ${vd[2]}। ${pro.length} संकेत पक्ष में और ${con.length} ख़िलाफ़ हैं। प्रीमियम लगभग ${Math.round(o.ltp)} रुपये है। स्टॉप-लॉस इंडेक्स पर ${Math.round(t.sl)}, या प्रीमियम पर लगभग ${Math.round(pSL)} रुपये।`;
    const useAI = aiOn();
    show(html, useAI ? '' : sayTxt);
    if (useAI) { const done = await askAI(raw, a, 'aiAns'); if (!done) say(sayTxt); }
  }
  return { say, toggleMic, ask };
})();
