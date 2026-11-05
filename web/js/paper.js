/* ===== पेपर ट्रेडिंग: डमी पैसा, असली जैसे भाव, चार्ज, SL/टारगेट, होल्ड/एग्जिट सलाह, सिग्नल रिकॉर्ड ===== */
const Paper = (() => {
  const C = APP_CONFIG.CHARGES, PC = APP_CONFIG.PAPER;
  const runId = Math.random().toString(36).slice(2, 7);
  let acc = null, trades = [], signals = [], ready = false, lastSave = 0;
  const lastState = {}, lastAdvice = {};
  const sqMin = (() => { const [h, m] = (PC.SQUARE_OFF_TIME || '15:20').split(':').map(Number); return h * 60 + m - 555; })();
  const dateKey = () => { const c = Source.clock(); return c.date === 'DEMO' ? 'DEMO-' + runId : c.date; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const opts = () => Store.pref('paper_opts', { trail: true, autoExit: false, lots: 1 });

  function charges(side, prem, qty, exch) {
    const to = prem * qty, brk = C.BROKERAGE, stt = side === 'SELL' ? to * C.STT_SELL : 0, txn = to * (exch === 'BSE' ? C.BSE_TXN : C.NSE_TXN);
    const sebi = to * C.SEBI, stamp = side === 'BUY' ? to * C.STAMP_BUY : 0, gst = (brk + txn + sebi) * C.GST;
    return { brk, stt, txn, sebi, stamp, gst, total: brk + stt + txn + sebi + stamp + gst };
  }
  const slip = (v, s) => tick05(v * (1 + (s * PC.SLIPPAGE_PCT) / 100) + (s > 0 ? 0.05 : -0.05));
  const buyPx = (q) => (q.ask > 0 ? q.ask : slip(q.ltp, 1));
  const sellPx = (q) => (q.bid > 0 ? q.bid : slip(q.ltp, -1));

  async function load() {
    const d = await Store.load();
    acc = d.account || { cash: PC.START_CAPITAL, start: PC.START_CAPITAL, created: Date.now() };
    trades = d.trades || []; signals = d.signals || []; ready = true;
  }
  const openTrades = () => trades.filter((t) => t.status === 'open');
  const closedTrades = () => trades.filter((t) => t.status === 'closed');

  function estimate(key, K, type, lots) {
    const a = A[key]; if (!a) return null;
    const q = optQuote(a, K, type), px = buyPx(q), qty = lots * a.lot, ch = charges('BUY', px, qty, a.cf.exch);
    return { px, qty, ch, cost: px * qty + ch.total, q };
  }
  async function open({ key, K, type, lots, sl, tgt, src }) {
    const a = A[key];
    if (!ready || !a) return toast('डेटा अभी तैयार नहीं है');
    if (!a.sessionLive) return toast('बाज़ार बंद है, अभी पेपर ट्रेड नहीं लग सकती');
    const e = estimate(key, K, type, lots);
    if (e.cost > acc.cash) return toast(`पैसे कम हैं: चाहिए ${rs(e.cost)}, हैं ${rs(acc.cash)}`);
    const st = setupFor(a, type), dl = Math.abs(e.q.delta || 0.5);
    const slv = ok(sl) && sl > 0 && sl < e.px ? sl : tick05(Math.max(0.05, e.px - dl * st.risk));
    const tgv = ok(tgt) && tgt > e.px ? tgt : tick05(e.px + dl * st.risk * 1.5);
    acc.cash -= e.cost;
    const t = { id: uid(), key, label: a.cf.label, K, type, lots, lot: a.lot, qty: e.qty, exch: a.cf.exch, entry: e.px, entryCh: e.ch, sl: slv, sl0: slv, tgt: tgv,
      risk0: e.px - slv, high: e.px, ltp: e.px, status: 'open', openedTs: Date.now(), openedDate: dateKey(), openedMin: a.curMin, openIdx: a.price,
      score: a.score, src: src || 'manual', advice: null, exitSigPx: null, log: [] };
    trades.unshift(t);
    await Promise.all([Store.saveTrade(t), Store.saveAccount(acc)]);
    beep(660); toast(`पेपर ख़रीद: ${t.label} ${K} ${type} · ${lots} लॉट @ ${rs(e.px)}`);
    Voice.say(`${a.cf.voice} ${K} ${type === 'CE' ? 'कॉल' : 'पुट'} ${lots} लॉट ${Math.round(e.px)} रुपये पर ख़रीदा। स्टॉप-लॉस ${Math.round(slv)}।`);
    render();
  }
  async function close(t, reason) {
    const a = A[t.key]; if (!a || t.status !== 'open') return;
    const q = optQuote(a, t.K, t.type), px = sellPx(q), ch = charges('SELL', px, t.qty, t.exch);
    acc.cash += px * t.qty - ch.total;
    Object.assign(t, { status: 'closed', exit: px, exitCh: ch, closedTs: Date.now(), closedMin: a.curMin, exitIdx: a.price, reason,
      gross: (px - t.entry) * t.qty, net: (px - t.entry) * t.qty - t.entryCh.total - ch.total, adviceAtExit: t.advice ? t.advice.state : null });
    await Promise.all([Store.saveTrade(t), Store.saveAccount(acc)]);
    beep(t.net >= 0 ? 880 : 300);
    toast(`बंद: ${t.label} ${t.K} ${t.type} · ${reason} · नेट ${t.net >= 0 ? '+' : ''}${rs(t.net)}`);
    Voice.say(`${CFG[t.key].voice} ${t.K} ${t.type === 'CE' ? 'कॉल' : 'पुट'} बंद। ${reason}। नेट ${t.net >= 0 ? 'मुनाफ़ा' : 'नुक़सान'} ${Math.abs(Math.round(t.net))} रुपये।`);
    render();
  }

  // ===== खुली पोज़िशन पर सलाह: होल्ड / सावधान / मुनाफ़ा बुक / एग्जिट =====
  function advise(a, t) {
    const d = t.type === 'CE' ? 1 : -1, ds = d === 1 ? a.score : 100 - a.score;
    const R = (t.ltp - t.entry) / (t.risk0 || 1), mh = a.I5.macd.hist[a.I5.k.length - 1];
    const exit = [], book = [], warn = [];
    if (ds <= 42) exit.push(`स्कोर उलट गया (आपकी दिशा में ${ds}/100)`);
    if (a.stD === -d) exit.push('Supertrend आपके ख़िलाफ़ पलट गया');
    if ((a.price - a.vw) * d < 0 && ok(mh) && mh * d < 0) exit.push(`भाव ${a.hasVol ? 'VWAP' : 'TWAP'} के ग़लत तरफ़ और MACD उलटा`);
    if (a.curMin >= 345) exit.push('3 बजे के बाद: थीटा और अचानक झटकों का जोखिम');
    if (R >= 1.5) book.push(`मुनाफ़ा ${R.toFixed(1)}R हो चुका है`);
    if (t.tgt && t.ltp >= t.tgt * 0.97) book.push('टारगेट के बिल्कुल पास');
    if (R > 0.5 && ((d === 1 && a.rsi > 72) || (d === -1 && a.rsi < 28))) book.push(`RSI ${f1(a.rsi)}: मूव थक सकता है`);
    if (ds < 55) warn.push(`संकेत कमज़ोर हो रहे हैं (${ds}/100)`);
    if (d === 1 && a.res && a.res[1] - a.price < 0.4 * a.atr) warn.push(`रेज़िस्टेंस पास: ${a.res[0]} ${f0(a.res[1])}`);
    if (d === -1 && a.sup && a.price - a.sup[1] < 0.4 * a.atr) warn.push(`सपोर्ट पास: ${a.sup[0]} ${f0(a.sup[1])}`);
    if (ok(a.adx) && a.adx < 18) warn.push(`ADX ${f1(a.adx)}: ट्रेंड कमज़ोर`);
    if (R >= 1 && t.sl < t.entry) warn.push('मुनाफ़ा 1R से ज़्यादा: SL को एंट्री पर ले आएँ');
    if (exit.length) return { state: 'EXIT', title: '🔴 एग्जिट का संकेत', why: exit, ds, R };
    if (book.length) return { state: 'BOOK', title: '🟠 मुनाफ़ा बुक करने का समय', why: book, ds, R };
    if (warn.length) return { state: 'WARN', title: '🟡 सावधान: SL कड़ा रखें', why: warn, ds, R };
    const pro = a.sigs.filter((x) => x.w > 0 && x.s * d > 0).sort((x, y) => y.w - x.w).slice(0, 2).map((x) => `${x.n} पक्ष में`);
    return { state: 'HOLD', title: '🟢 होल्ड करो', why: [`स्कोर आपकी दिशा में ${ds}/100`, ...pro], ds, R };
  }

  function onTick() {
    if (!ready) return;
    const o = opts(), clk = Source.clock();
    let dirty = false;
    for (const t of openTrades()) {
      const a = A[t.key]; if (!a) continue;
      const q = optQuote(a, t.K, t.type), bid = q.bid > 0 ? q.bid : q.ltp;
      t.ltp = bid; t.high = Math.max(t.high, bid);
      if (o.trail && t.high - t.entry >= t.risk0) {
        const ns = Math.max(t.sl, t.entry, tick05(t.high - t.risk0));
        if (ns > t.sl) { t.sl = ns; t.log.push(`${hm(a.curMin)} SL ऊपर खिसका: ${f2(ns)}`); dirty = true; }
      }
      const adv = advise(a, t);
      if (!t.advice || t.advice.state !== adv.state) {
        if (t.advice) { beep(adv.state === 'EXIT' ? 330 : 520); Voice.say(`${CFG[t.key].voice} ${t.K} ${t.type === 'CE' ? 'कॉल' : 'पुट'}: ${adv.title.replace(/^\S+\s/, '')}। ${adv.why[0]}।`); }
        t.log.push(`${hm(a.curMin)} ${adv.title}`); dirty = true;
        if (adv.state === 'EXIT' && t.exitSigPx == null) t.exitSigPx = bid;
      }
      t.advice = adv;
      if (o.trail && t.tgt && bid >= t.tgt && !t.tgtHit) {
        // ट्रेलिंग चालू: टारगेट पर बेचने की जगह मुनाफ़ा लॉक करके आगे चलने दो
        t.tgtHit = true; t.sl = Math.max(t.sl, tick05(t.tgt - 0.5 * t.risk0));
        t.log.push(`${hm(a.curMin)} टारगेट छुआ, SL ${f2(t.sl)} पर लॉक`); dirty = true; beep(880);
        Voice.say(`${CFG[t.key].voice} ${t.K} ने टारगेट छुआ। मुनाफ़ा लॉक करके स्टॉप-लॉस ${Math.round(t.sl)} पर किया।`);
      }
      if (bid <= t.sl) close(t, t.sl >= t.entry ? 'ट्रेलिंग SL हिट (मुनाफ़ा लॉक)' : 'स्टॉप-लॉस हिट');
      else if (t.tgt && bid >= t.tgt && !o.trail) close(t, 'टारगेट हिट');
      else if (a.curMin >= sqMin) close(t, `${PC.SQUARE_OFF_TIME} ऑटो स्क्वेयर-ऑफ़`);
      else if (o.autoExit && adv.state === 'EXIT') close(t, 'एग्जिट संकेत: ' + adv.why[0]);
      else if (t.openedDate !== dateKey() && Source.mode === 'live' && a.sessionLive) close(t, 'पिछले दिन की पोज़िशन बंद');
    }
    if (dirty || Date.now() - lastSave > 60000) { lastSave = Date.now(); openTrades().forEach((t) => Store.saveTrade(t)); }
    trackSignals(clk);
  }

  // ===== सिग्नल का रिकॉर्ड: 15 और 30 मिनट बाद सही निकला या नहीं =====
  function trackSignals() {
    const dk = dateKey();
    for (const k of KEYS) {
      const a = A[k]; if (!a) continue;
      const s = signalFor(a), prev = lastState[k];
      lastState[k] = s.state;
      if (s.state === 'CE' || s.state === 'PE') {
        const lastSig = signals.find((x) => x.key === k && x.date === dk);
        const fresh = prev !== s.state || !lastSig || a.curMin - lastSig.min >= 30;
        if (prev !== undefined && fresh && (!lastSig || lastSig.min !== a.curMin)) {
          const x = { id: uid(), key: k, dir: s.state, strength: s.strength, score: a.score, date: dk, min: a.curMin, price: a.price, atr: a.atr, ts: Date.now() };
          signals.unshift(x); Store.saveSignal(x);
          if (k === cur && prev !== s.state) { beep(740); Voice.say(`${a.cf.voice} में ${s.state === 'CE' ? 'कॉल' : 'पुट'} का ${s.strength} सेटअप बना।`); }
        }
      }
      const today = a.D.candles.filter((c) => c.d === 2);
      for (const x of signals) {
        if (x.key !== k || x.date !== dk || x.r30) continue;
        let ch = false;
        for (const [f, n] of [['r15', 15], ['r30', 30]]) {
          if (x[f]) continue;
          const c = today.find((y) => y.m === x.min + n);
          if (!c) continue;
          const mv = (c.c - x.price) * (x.dir === 'CE' ? 1 : -1);
          x[f] = mv > 0.25 * x.atr ? 'सही' : mv < -0.25 * x.atr ? 'ग़लत' : 'फ़्लैट';
          x[f + 'mv'] = mv; ch = true;
        }
        if (ch) Store.saveSignal(x);
      }
    }
  }
  function sigStats(list) {
    const dec = list.filter((x) => x.r30 === 'सही' || x.r30 === 'ग़लत'), win = dec.filter((x) => x.r30 === 'सही').length;
    return { n: list.length, dec: dec.length, win, pct: dec.length ? Math.round((win / dec.length) * 100) : null };
  }
  function tradeStats() {
    const cl = closedTrades(), w = cl.filter((t) => t.net > 0), l = cl.filter((t) => t.net <= 0);
    const net = cl.reduce((s, t) => s + t.net, 0), chg = cl.reduce((s, t) => s + t.entryCh.total + (t.exitCh ? t.exitCh.total : 0), 0);
    const gw = w.reduce((s, t) => s + t.net, 0), gl = -l.reduce((s, t) => s + t.net, 0);
    const today = cl.filter((t) => t.openedDate === dateKey()).reduce((s, t) => s + t.net, 0);
    const sigFollow = cl.filter((t) => t.exitSigPx != null && t.adviceAtExit !== 'EXIT' && !/एग्जिट संकेत/.test(t.reason || ''));
    const better = sigFollow.reduce((s, t) => s + (t.exitSigPx - t.exit) * t.qty, 0);
    return { n: cl.length, wins: w.length, pct: cl.length ? Math.round((w.length / cl.length) * 100) : null, net, chg, avgW: w.length ? gw / w.length : null, avgL: l.length ? -gl / l.length : null,
      pf: gl ? gw / gl : null, today, sigFollowN: sigFollow.length, better };
  }
  const equity = () => acc.cash + openTrades().reduce((s, t) => s + t.ltp * t.qty, 0);

  // ===== UI =====
  function render() {
    if (!ready || !A[cur]) return;
    renderBanner(); renderAccount();
    const box = $('pPos');
    if (!box.contains(document.activeElement)) renderPositions();
    renderRecord(); renderHistory();
  }
  function renderBanner() {
    const a = A[cur], s = signalFor(a), o = opts();
    const cls = s.state === 'CE' ? 'b' : s.state === 'PE' ? 's' : 'n';
    let h = `<div class="sig ${cls}"><div class="sigt">${s.title}</div><div class="sigs">${esc(s.sub)}</div>`;
    if (s.reasons && s.reasons.length) h += `<div class="sigr">${s.reasons.map((x) => `<span class="pill ${x.s > 0 ? 'b' : 'n'}">✓ ${esc(x.n)}</span>`).join('')}${(s.against || []).map((x) => `<span class="pill s">✗ ${esc(x.n)}</span>`).join('')}</div>`;
    if (s.caveats && s.caveats.length) h += `<div class="sigs">⚠️ ${s.caveats.join(' · ')}</div>`;
    if (s.setup) {
      const st = s.setup, e = estimate(cur, st.K, st.dir, o.lots);
      h += `<div class="lv" style="margin-top:10px"><div><small>स्ट्राइक</small><b>${st.K} ${st.dir}</b></div><div><small>प्रीमियम (ख़रीद भाव)</small><b>${rs(e.px)}</b></div><div><small>SL / टारगेट</small><b><span class="down">${f1(st.pSL)}</span> / <span class="up">${f1(st.pT1)}</span></b></div></div>
        <button class="big ${cls}" onclick="Paper.takeSignal()">इस सिग्नल पर पेपर ट्रेड लो · ${o.lots} लॉट (${e.qty}) · कुल ${rs(e.cost)}</button>`;
    }
    const ss = sigStats(signals.filter((x) => x.key === cur));
    h += `<div class="sigs" style="margin-top:8px">📊 ${a.cf.label} के अब तक ${ss.n} सिग्नल · 30 मिनट बाद ${ss.pct == null ? 'अभी नतीजा नहीं' : ss.pct + '% सही (' + ss.dec + ' में से ' + ss.win + ')'}</div></div>`;
    $('pBanner').innerHTML = h;
  }
  function renderAccount() {
    const st = tradeStats(), eq = equity(), tot = eq - acc.start;
    $('pAcc').innerHTML = `<div><small>नकद (डमी)</small><b>${rs(acc.cash)}</b></div><div><small>कुल वैल्यू</small><b class="${tot >= 0 ? 'up' : 'down'}">${rs(eq)}</b></div>
      <div><small>आज का नेट P&L</small><b class="${st.today >= 0 ? 'up' : 'down'}">${sgn(st.today)}${rs(st.today)}</b></div><div><small>जीत %</small><b>${st.pct == null ? '–' : st.pct + '%'} <span class="mut" style="font-size:11px">(${st.n} ट्रेड)</span></b></div>`;
  }
  function renderPositions() {
    const op = openTrades(), o = opts();
    let h = `<div class="ptog"><label><input type="checkbox" ${o.trail ? 'checked' : ''} onchange="Paper.setOpt('trail',this.checked)"> ऑटो ट्रेलिंग SL</label>
      <label><input type="checkbox" ${o.autoExit ? 'checked' : ''} onchange="Paper.setOpt('autoExit',this.checked)"> एग्जिट संकेत पर अपने-आप बेचो</label></div>`;
    if (!op.length) h += '<div class="mut" style="padding:8px 0">कोई खुली पोज़िशन नहीं।</div>';
    for (const t of op) {
      const pnl = (t.ltp - t.entry) * t.qty, pct = ((t.ltp - t.entry) / t.entry) * 100, adv = t.advice || { state: 'HOLD', title: '🟢 होल्ड करो', why: [] };
      const ac = { HOLD: 'b', WARN: 'w', BOOK: 'o', EXIT: 's' }[adv.state];
      h += `<div class="pos"><div class="posh"><b>${t.label} ${t.K} ${t.type}</b><span class="mut">${t.lots} लॉट (${t.qty}) · ${hm(t.openedMin)} पर</span></div>
        <div class="adv ${ac}"><b>${adv.title}</b><div>${adv.why.map(esc).join(' · ')}</div></div>
        <div class="lv"><div><small>ख़रीद</small><b>${f2(t.entry)}</b></div><div><small>अभी (बिक्री भाव)</small><b>${f2(t.ltp)}</b></div><div><small>P&L</small><b class="${pnl >= 0 ? 'up' : 'down'}">${sgn(pnl)}${rs(pnl)}<br><small>${sgn(pct)}${f1(pct)}%</small></b></div></div>
        <div class="posf"><label>SL <input type="number" step="0.05" value="${t.sl.toFixed(2)}" onchange="Paper.setSL('${t.id}',this.value)"></label>
        <label>टारगेट <input type="number" step="0.05" value="${t.tgt ? t.tgt.toFixed(2) : ''}" onchange="Paper.setTgt('${t.id}',this.value)"></label>
        <button class="sell" onclick="Paper.closeId('${t.id}')">अभी बेचो</button></div>
        ${t.log.length ? `<details><summary class="mut">घटनाएँ (${t.log.length})</summary><div class="mut" style="font-size:12px">${t.log.slice(-8).map(esc).join('<br>')}</div></details>` : ''}</div>`;
    }
    $('pPos').innerHTML = h;
  }
  function renderOrderForm() {
    const a = A[cur]; if (!a) return;
    const strikes = a.ch.rows.length ? a.ch.view.map((r) => r.K) : Array.from({ length: 11 }, (_, i) => a.ch.atm + (i - 5) * a.cf.step);
    $('oStrike').innerHTML = strikes.map((K) => `<option value="${K}" ${K === a.ch.atm ? 'selected' : ''}>${K}${K === a.ch.atm ? ' (ATM)' : ''}</option>`).join('');
    $('oIdx').textContent = a.cf.label;
    updateEstimate();
  }
  function updateEstimate() {
    const a = A[cur]; if (!a || !$('oStrike').value) return;
    const K = +$('oStrike').value, type = $('oType').value, lots = Math.max(1, +$('oLots').value || 1), e = estimate(cur, K, type, lots);
    if (!e) return;
    $('oEst').innerHTML = `ख़रीद भाव ${rs(e.px)} × ${e.qty} = ${rs(e.px * e.qty)} + चार्ज ${rs(e.ch.total)} = <b>${rs(e.cost)}</b><br><span class="mut">ब्रोकरेज ${rs(e.ch.brk)} · ट्रांज़ैक्शन ${rs(e.ch.txn)} · स्टांप ${rs(e.ch.stamp)} · GST ${rs(e.ch.gst)} · बेचते समय STT 0.15% भी लगेगा</span>`;
  }
  function renderRecord() {
    const mine = signals.filter((x) => x.key === cur).slice(0, 10), all = sigStats(signals), st = tradeStats();
    const by = (f) => sigStats(signals.filter(f));
    const strong = by((x) => x.strength === 'मज़बूत'), weak = by((x) => x.strength === 'हल्का');
    let h = `<div class="stats" style="margin-top:0"><div><small>कुल सिग्नल (सभी इंडेक्स)</small><b>${all.n}</b></div><div><small>30 मिनट बाद सही</small><b>${all.pct == null ? '–' : all.pct + '%'}</b></div>
      <div><small>मज़बूत सिग्नल सही</small><b>${strong.pct == null ? '–' : strong.pct + '%'}</b></div><div><small>हल्के सिग्नल सही</small><b>${weak.pct == null ? '–' : weak.pct + '%'}</b></div>
      <div><small>एग्जिट संकेत अनदेखा किया</small><b>${st.sigFollowN} बार</b></div><div><small>संकेत मानते तो फ़र्क़</small><b class="${st.better >= 0 ? 'up' : 'down'}">${st.sigFollowN ? sgn(st.better) + rs(st.better) : '–'}</b></div></div>`;
    h += `<div class="tbl" style="margin-top:10px"><table><thead><tr><th>समय</th><th>दिशा</th><th>स्कोर</th><th>भाव</th><th>15 मिनट</th><th>30 मिनट</th></tr></thead><tbody>` +
      (mine.length ? mine.map((x) => `<tr><td>${hm(x.min)}</td><td><span class="pill ${x.dir === 'CE' ? 'b' : 's'}">${x.dir} · ${x.strength || ''}</span></td><td>${x.score}</td><td>${f1(x.price)}</td><td>${res(x.r15, x.r15mv)}</td><td>${res(x.r30, x.r30mv)}</td></tr>`).join('') : '<tr><td colspan="6" class="mut">अभी कोई सिग्नल नहीं</td></tr>') + '</tbody></table></div>';
    $('pRec').innerHTML = h;
  }
  const res = (r, mv) => (!r ? '<span class="mut">इंतज़ार</span>' : `<span class="pill ${r === 'सही' ? 'b' : r === 'ग़लत' ? 's' : 'n'}">${r} ${sgn(mv)}${f1(mv)}</span>`);
  function renderHistory() {
    const cl = closedTrades().slice(0, 15), st = tradeStats();
    let h = `<div class="stats" style="margin-top:0"><div><small>कुल नेट P&L</small><b class="${st.net >= 0 ? 'up' : 'down'}">${sgn(st.net)}${rs(st.net)}</b></div><div><small>चार्ज में गए</small><b class="down">${rs(st.chg)}</b></div>
      <div><small>औसत जीत / हार</small><b><span class="up">${rs(st.avgW)}</span> / <span class="down">${rs(st.avgL)}</span></b></div><div><small>प्रॉफ़िट फ़ैक्टर</small><b>${st.pf == null ? '–' : f2(st.pf)}</b></div></div>`;
    h += `<div class="tbl" style="margin-top:10px"><table><thead><tr><th style="text-align:left">ट्रेड</th><th>ख़रीद → बिक्री</th><th>नेट P&L</th><th style="text-align:left">कारण</th></tr></thead><tbody>` +
      (cl.length ? cl.map((t) => `<tr><td style="text-align:left">${t.label} ${t.K} ${t.type}<br><span class="mut">${t.lots} लॉट · ${hm(t.openedMin)}–${hm(t.closedMin)}</span></td><td>${f2(t.entry)} → ${f2(t.exit)}</td>
        <td class="${t.net >= 0 ? 'up' : 'down'}">${sgn(t.net)}${rs(t.net)}<br><span class="mut">चार्ज ${rs(t.entryCh.total + t.exitCh.total)}</span></td><td style="text-align:left;white-space:normal">${esc(t.reason)}</td></tr>`).join('') : '<tr><td colspan="4" class="mut">अभी कोई बंद ट्रेड नहीं</td></tr>') + '</tbody></table></div>';
    h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" onclick="Paper.reset()">खाता रीसेट करें</button><span class="mut" style="font-size:12px;align-self:center">शुरुआती पूंजी ${rs(acc.start)} · ${Store.cloud ? 'Firebase में सेव' : 'इसी ब्राउज़र में सेव'}</span></div>`;
    $('pHist').innerHTML = h;
  }

  // ===== बटन =====
  function takeSignal() { const a = A[cur], s = signalFor(a); if (!s.setup) return; open({ key: cur, K: s.setup.K, type: s.setup.dir, lots: opts().lots, src: 'signal' }); }
  function placeManual() {
    const K = +$('oStrike').value, type = $('oType').value, lots = Math.max(1, Math.floor(+$('oLots').value || 1));
    open({ key: cur, K, type, lots, sl: +$('oSL').value || null, tgt: +$('oTgt').value || null, src: 'manual' });
  }
  function openFromAsk(K, type) { open({ key: cur, K, type, lots: opts().lots, src: 'ask' }); }
  function closeId(id) { const t = trades.find((x) => x.id === id); if (t) close(t, 'हाथ से बेचा'); }
  function setSL(id, v) { const t = trades.find((x) => x.id === id); v = +v; if (t && v > 0) { t.sl = tick05(v); t.log.push(`SL बदला: ${f2(t.sl)}`); Store.saveTrade(t); } }
  function setTgt(id, v) { const t = trades.find((x) => x.id === id); v = +v; if (t) { t.tgt = v > 0 ? tick05(v) : null; Store.saveTrade(t); } }
  function setOpt(k, v) { const o = opts(); o[k] = v; Store.setPref('paper_opts', o); renderPositions(); }
  function setLots(v) { const o = opts(); o.lots = Math.max(1, Math.floor(+v || 1)); Store.setPref('paper_opts', o); renderBanner(); }
  async function reset() {
    const cap = prompt('पूरा पेपर खाता, ट्रेड हिस्ट्री और सिग्नल रिकॉर्ड मिट जाएगा। नई शुरुआती पूंजी डालें (₹):', String(PC.START_CAPITAL));
    if (cap == null) return;
    const c = Math.max(1000, +cap || PC.START_CAPITAL);
    await Store.resetAll(); acc = { cash: c, start: c, created: Date.now() }; trades = []; signals = [];
    await Store.saveAccount(acc); toast('खाता रीसेट हो गया'); render();
  }
  return { load, onTick, render, renderOrderForm, updateEstimate, takeSignal, placeManual, closeId, openFromAsk, setSL, setTgt, setOpt, setLots, reset, opts, charges,
    get ready() { return ready; }, openTrades };
})();

/* छोटे हेल्पर: बीप और टोस्ट */
let _ac = null;
function beep(freq) {
  try { _ac = _ac || new (window.AudioContext || window.webkitAudioContext)(); const o = _ac.createOscillator(), g = _ac.createGain();
    o.frequency.value = freq || 600; g.gain.setValueAtTime(0.12, _ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, _ac.currentTime + 0.35);
    o.connect(g).connect(_ac.destination); o.start(); o.stop(_ac.currentTime + 0.36); } catch { /* आवाज़ बंद */ }
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3500); }
