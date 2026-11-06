/* ===== Paper trading: dummy money, real-like prices and charges, SL/target, hold/exit advice, signal record =====
   Screen text is English; spoken alerts (Voice.say) are Hindi. */
const Paper = (() => {
  const C = APP_CONFIG.CHARGES, PC = APP_CONFIG.PAPER;
  const runId = Math.random().toString(36).slice(2, 7);
  let acc = null, trades = [], signals = [], ready = false, lastSave = 0;
  const lastState = {};
  const sqMin = (() => { const [h, m] = (PC.SQUARE_OFF_TIME || '15:20').split(':').map(Number); return h * 60 + m - 555; })();
  const dateKey = () => { const c = Source.clock(); return c.date === 'DEMO' ? 'DEMO-' + runId : c.date; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const opts = () => ({ trail: true, autoExit: false, lots: 1, slMode: 'both', voice: 'important', ...Store.pref('paper_opts', {}) });
  /* ---- Calm voice: an alert is spoken only after it has held for a while, positions on the same instrument are
     grouped into one sentence, HOLD is never spoken, and the same alert can't repeat for 3 minutes. ---- */
  const HOLD_MS = { EXIT: 20000, BOOK: 30000, WARN: 45000, HOLD: 45000 };
  const said = {};
  function speak(level, key, text) {
    const v = opts().voice;
    if (v === 'off' || (v === 'important' && level !== 'imp')) return;
    const ck = key + '|' + text, now = Date.now();
    if (said[ck] && now - said[ck] < 180000) return;
    said[ck] = now; Voice.say(text);
  }
  // Effective stop-loss. Options are only bought here, so a higher SL is the safer one.
  //  both:   the tighter of your SL and the auto SL (your SL = the most you accept to lose; auto protects profit)
  //  auto:   the system's SL only      manual: your SL only, never moved by the system
  function effSL(t) {
    const m = t.slMode || 'both', u = ok(t.slUser) ? t.slUser : null, au = ok(t.slAuto) ? t.slAuto : t.sl0;
    return m === 'manual' ? (u ?? t.sl0) : m === 'auto' ? au : Math.max(au, u ?? -Infinity);
  }
  const hiType = (t) => (t === 'CE' ? 'कॉल' : 'पुट');
  const vname = (t) => (CFG[t.key] ? CFG[t.key].voice : t.label);
  // पुराने (हिंदी) रिकॉर्ड भी पढ़ सकें
  const OUT = { 'सही': 'right', 'ग़लत': 'wrong', 'फ़्लैट': 'flat' };
  const outc = (v) => OUT[v] || v;
  const isStrong = (x) => x.strength === 'strong' || x.strength === 'मज़बूत';
  const isMild = (x) => x.strength === 'mild' || x.strength === 'हल्का';
  const ADV = {
    HOLD: ['🟢 Hold', 'होल्ड करें'],
    WARN: ['🟡 Caution: keep SL tight', 'सावधान, स्टॉप-लॉस कड़ा रखें'],
    BOOK: ['🟠 Time to book profit', 'मुनाफ़ा बुक करने का समय'],
    EXIT: ['🔴 Exit signal', 'एग्जिट का संकेत'],
  };

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
    if (!ready || !a) return toast('Data is not ready yet');
    if (!a.cf.opt) return toast(`${a.cf.label} has no options on Upstox, so it can't be paper traded here.`);
    if (!a.sessionLive) return toast('Market is closed. Paper trades open during market hours.');
    const e = estimate(key, K, type, lots);
    if (e.cost > acc.cash) return toast(`Not enough cash: need ${rs(e.cost)}, have ${rs(acc.cash)}`);
    const st = setupFor(a, type), dl = Math.abs(e.q.delta || 0.5);
    const slv = ok(sl) && sl > 0 && sl < e.px ? sl : tick05(Math.max(0.05, e.px - dl * st.risk));
    const tgv = ok(tgt) && tgt > e.px ? tgt : tick05(e.px + dl * st.risk * 1.5);
    acc.cash -= e.cost;
    const t = { id: uid(), key, label: a.cf.label, K, type, lots, lot: a.lot, qty: e.qty, exch: a.cf.exch, entry: e.px, entryCh: e.ch, sl: slv, sl0: slv, tgt: tgv,
      risk0: e.px - slv, high: e.px, ltp: e.px, status: 'open', openedTs: Date.now(), openedDate: dateKey(), openedMin: a.curMin, openIdx: a.price,
      score: a.score, st0: a.stD, src: src || 'manual', advice: null, exitSigPx: null, log: [],
      slMode: opts().slMode, slUser: ok(sl) && sl > 0 && sl < e.px ? slv : null, slAuto: tick05(Math.max(0.05, e.px - dl * st.risk)) };
    t.sl = effSL(t);
    trades.unshift(t);
    await Promise.all([Store.saveTrade(t), Store.saveAccount(acc)]);
    beep(660); toast(`Paper buy: ${t.label} ${K} ${type}, ${lots} lot at ${rs(e.px)}`);
    speak('imp', key, `${a.cf.voice} ${K} ${hiType(type)} ${lots} लॉट ${Math.round(e.px)} रुपये पर ख़रीदा। स्टॉप-लॉस ${Math.round(t.sl)}।`);
    render();
  }
  async function close(t, reason, reasonHi, quiet) {
    const a = A[t.key]; if (!a || t.status !== 'open') return;
    const q = optQuote(a, t.K, t.type), px = sellPx(q), ch = charges('SELL', px, t.qty, t.exch);
    acc.cash += px * t.qty - ch.total;
    Object.assign(t, { status: 'closed', exit: px, exitCh: ch, closedTs: Date.now(), closedMin: a.curMin, exitIdx: a.price, reason,
      gross: (px - t.entry) * t.qty, net: (px - t.entry) * t.qty - t.entryCh.total - ch.total, adviceAtExit: t.advice ? t.advice.state : null });
    await Promise.all([Store.saveTrade(t), Store.saveAccount(acc)]);
    beep(t.net >= 0 ? 880 : 300);
    toast(`Closed: ${t.label} ${t.K} ${t.type}. ${reason}. Net ${t.net >= 0 ? '+' : ''}${rs(t.net)}`);
    if (!quiet) speak('imp', t.key + t.id, `${vname(t)} ${t.K} ${hiType(t.type)} बंद। ${reasonHi || ''}। नेट ${t.net >= 0 ? 'मुनाफ़ा' : 'नुक़सान'} ${Math.abs(Math.round(t.net))} रुपये।`);
    render();
  }

  // ===== Advice on an open position: hold / caution / book / exit =====
  function advise(a, t) {
    const d = t.type === 'CE' ? 1 : -1, ds = d === 1 ? a.score : 100 - a.score;
    const R = (t.ltp - t.entry) / (t.risk0 || 1), mh = a.I5.macd.hist[a.I5.k.length - 1];
    const exit = [], book = [], warn = [];
    if (ds <= 42) exit.push(`Score turned against you (${ds}/100 in your direction)`);
    if (a.stD === -d && t.st0 !== -d) exit.push('Supertrend flipped against you');
    else if (a.stD === -d) warn.push('Supertrend has been against you since entry');
    if ((a.price - a.vw) * d < 0 && ok(mh) && mh * d < 0) exit.push(`Price on the wrong side of ${a.hasVol ? 'VWAP' : 'TWAP'} and MACD reversed`);
    if (a.curMin >= a.SS.c - 30) exit.push('Last 30 minutes: theta and sudden-swing risk');
    if (R >= 1.5) book.push(`Profit is already ${R.toFixed(1)}R`);
    if (t.tgt && t.ltp >= t.tgt * 0.97) book.push('Right at the target');
    if (R > 0.5 && ((d === 1 && a.rsi > 72) || (d === -1 && a.rsi < 28))) book.push(`RSI ${f1(a.rsi)}: the move may be tiring`);
    if (ds < 55) warn.push(`Signals weakening (${ds}/100)`);
    // 1-minute engine against the position: earliest warning; strong + losing money = exit
    if (a.short && a.short.dir === (d === 1 ? 'PE' : 'CE')) {
      if (a.short.strength === 'strong' && R < 0.3) exit.push(`1-minute trend has turned hard against you (short score ${a.short.score})`);
      else if (R > 0.8) book.push(`1-minute turning against you with ${R.toFixed(1)}R profit: lock it in`);
      else warn.push(`1-minute momentum turning against you (short score ${a.short.score})`);
    }
    if (d === 1 && a.res && a.res[1] - a.price < 0.4 * a.atr) warn.push(`Resistance close: ${a.res[0]} ${f0(a.res[1])}`);
    if (d === -1 && a.sup && a.price - a.sup[1] < 0.4 * a.atr) warn.push(`Support close: ${a.sup[0]} ${f0(a.sup[1])}`);
    if (ok(a.adx) && a.adx < 18) warn.push(`ADX ${f1(a.adx)}: weak trend`);
    if (R >= 1 && t.sl < t.entry) warn.push('Profit above 1R: move SL to entry');
    const mk = (state, why) => ({ state, title: ADV[state][0], hi: ADV[state][1], why, ds, R });
    if (exit.length) return mk('EXIT', exit);
    if (book.length) return mk('BOOK', book);
    if (warn.length) return mk('WARN', warn);
    const pro = a.sigs.filter((x) => x.w > 0 && x.s * d > 0).sort((x, y) => y.w - x.w).slice(0, 2).map((x) => `${x.n} in favour`);
    return mk('HOLD', [`Score ${ds}/100 in your direction`, ...pro]);
  }

  function onTick() {
    if (!ready) return;
    const o = opts(), now = Date.now(), ann = {}, toClose = [];
    let dirty = false;
    for (const t of openTrades()) {
      const a = A[t.key]; if (!a) continue;
      if (!t.slMode) { t.slMode = 'both'; t.slAuto = t.sl; t.slUser = null; } // positions from older versions
      const q = optQuote(a, t.K, t.type), bid = q.bid > 0 ? q.bid : q.ltp, d = t.type === 'CE' ? 1 : -1;
      t.ltp = bid; t.high = Math.max(t.high, bid);
      // ---- Auto SL: only ever moves up ----
      let na = t.slAuto;
      if (t.high - t.entry >= t.risk0) na = Math.max(na, t.entry, tick05(t.high - t.risk0));           // +1R: breakeven, then trail 1R behind the high
      if (t.tgtHit) na = Math.max(na, tick05(t.tgt - 0.5 * t.risk0));                                    // target touched: lock most of it
      if (a.short && a.short.dir === (d === 1 ? 'PE' : 'CE') && a.short.strength === 'strong' && bid > t.entry)
        na = Math.max(na, tick05(t.entry + (bid - t.entry) * 0.5));                                       // 1-minute turned hard against: protect half the open profit
      na = Math.min(na, tick05(bid - 0.05));
      if (na > t.slAuto + 0.04) { t.slAuto = na; t.log.push(`${hm(a.curMin)} Auto SL raised to ${f2(na)}`); dirty = true; }
      const es = effSL(t); if (Math.abs(es - t.sl) > 0.001) { t.sl = es; dirty = true; }
      // ---- Advice: change only after it holds (no flip-flopping) ----
      const adv = advise(a, t);
      if (!t.advice || t.advice.state === adv.state) { t.advice = adv; t.advPend = null; }
      else if (!t.advPend || t.advPend.state !== adv.state) t.advPend = { state: adv.state, since: now };
      else if (now - t.advPend.since >= HOLD_MS[adv.state]) {
        t.log.push(`${hm(a.curMin)} ${adv.title}`); dirty = true;
        if (adv.state === 'EXIT' && t.exitSigPx == null) t.exitSigPx = bid;
        if (adv.state !== 'HOLD') { const g = (ann[t.key + adv.state] = ann[t.key + adv.state] || { t, adv, n: 0 }); g.n++; }
        t.advice = adv; t.advPend = null;
      }
      if (t.slMode !== 'manual' && t.tgt && bid >= t.tgt && !t.tgtHit) {
        // auto SL on: at the target, lock profit and let it run instead of selling
        t.tgtHit = true; t.slAuto = Math.max(t.slAuto, tick05(t.tgt - 0.5 * t.risk0)); t.sl = effSL(t);
        t.log.push(`${hm(a.curMin)} Target touched, auto SL locked at ${f2(t.slAuto)}`); dirty = true; beep(880);
        speak('imp', t.key + 'tgt', `${vname(t)} ने टारगेट छुआ। मुनाफ़ा लॉक, स्टॉप-लॉस ${Math.round(t.sl)}।`);
      }
      const mine = t.slMode !== 'auto' && ok(t.slUser) && t.sl === t.slUser;
      if (bid <= t.sl) {
        const be = t.sl >= t.entry && t.sl < t.entry + 0.15 * t.risk0, pr = t.sl >= t.entry + 0.15 * t.risk0;
        toClose.push([t, pr ? (mine ? 'Your SL hit (in profit)' : 'Auto SL hit (profit locked)') : be ? 'Breakeven SL hit' : mine ? 'Your stop-loss hit' : 'Stop-loss hit',
          pr ? 'स्टॉप-लॉस हिट, मुनाफ़ा लॉक' : be ? 'ब्रेकईवन पर बंद' : 'स्टॉप-लॉस हिट']);
      }
      else if (t.tgt && bid >= t.tgt && t.slMode === 'manual') toClose.push([t, 'Target hit', 'टारगेट हिट']);
      else if (a.curMin >= sqMin) toClose.push([t, `${PC.SQUARE_OFF_TIME} auto square-off`, 'ऑटो स्क्वेयर-ऑफ़']);
      else if (o.autoExit && t.advice && t.advice.state === 'EXIT') toClose.push([t, 'Exit signal: ' + t.advice.why[0], 'एग्जिट संकेत']);
      else if (t.openedDate !== dateKey() && Source.mode === 'live' && a.sessionLive) toClose.push([t, 'Previous-day position closed', 'पिछले दिन की पोज़िशन बंद']);
    }
    // one sentence per instrument and alert, however many lots or positions
    for (const g of Object.values(ann)) {
      const many = openTrades().filter((x) => x.key === g.t.key && x.advice && x.advice.state === g.adv.state).length;
      beep(g.adv.state === 'EXIT' ? 330 : 520);
      speak(g.adv.state === 'WARN' ? 'all' : 'imp', g.t.key + g.adv.state, `${vname(g.t)}${many > 1 ? ` की ${many} पोज़िशन` : ` ${g.t.K} ${hiType(g.t.type)}`}: ${g.adv.hi}।`);
    }
    if (toClose.length) {
      const byKey = {};
      toClose.forEach(([t, r, rh]) => { (byKey[t.key] = byKey[t.key] || []).push([t, r, rh]); close(t, r, rh, true); });
      for (const k in byKey) {
        const L = byKey[k], t0 = L[0][0];
        setTimeout(() => {
          const net = L.reduce((x, [t]) => x + (t.net || 0), 0);
          speak('imp', k + 'close' + L.map(([t]) => t.id).join(), `${vname(t0)}${L.length > 1 ? ` की ${L.length} पोज़िशन` : ` ${t0.K} ${hiType(t0.type)}`} बंद, ${L[0][2]}। नेट ${net >= 0 ? 'मुनाफ़ा' : 'नुक़सान'} ${Math.abs(Math.round(net))} रुपये।`);
        }, 400);
      }
    }
    if (dirty || Date.now() - lastSave > 60000) { lastSave = Date.now(); openTrades().forEach((t) => Store.saveTrade(t)); }
    trackSignals();
  }

  // ===== Signal record: was it right 15 and 30 minutes later? =====
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
          if (k === cur && prev !== s.state) { beep(740); speak('imp', 'sig' + k, signalHi(a)); }
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
          x[f] = mv > 0.25 * x.atr ? 'right' : mv < -0.25 * x.atr ? 'wrong' : 'flat';
          x[f + 'mv'] = mv; ch = true;
        }
        if (ch) Store.saveSignal(x);
      }
    }
  }
  function sigStats(list) {
    const dec = list.filter((x) => ['right', 'wrong'].includes(outc(x.r30))), win = dec.filter((x) => outc(x.r30) === 'right').length;
    return { n: list.length, dec: dec.length, win, pct: dec.length ? Math.round((win / dec.length) * 100) : null };
  }
  function tradeStats() {
    const cl = closedTrades(), w = cl.filter((t) => t.net > 0), l = cl.filter((t) => t.net <= 0);
    const net = cl.reduce((s, t) => s + t.net, 0), chg = cl.reduce((s, t) => s + t.entryCh.total + (t.exitCh ? t.exitCh.total : 0), 0);
    const gw = w.reduce((s, t) => s + t.net, 0), gl = -l.reduce((s, t) => s + t.net, 0);
    const today = cl.filter((t) => t.openedDate === dateKey()).reduce((s, t) => s + t.net, 0);
    const sigFollow = cl.filter((t) => t.exitSigPx != null && t.adviceAtExit !== 'EXIT' && !/Exit signal|एग्जिट संकेत/.test(t.reason || ''));
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
    let h = `<div class="sig ${cls}"><div class="sig-k">${a.cf.label} live signal · ${HZ_INFO[a.hz || 'intra'].name} (${HZ_INFO[a.hz || 'intra'].tf}) · ${Source.clock().label}</div><div class="sigt">${s.title}</div><div class="sigs">${esc(s.sub)}</div>`;
    if (s.reasons && s.reasons.length) h += `<div class="sigr">${s.reasons.map((x) => `<span class="pill ${x.s > 0 ? 'b' : x.s < 0 ? 's' : 'n'}">✓ ${esc(x.n)}</span>`).join('')}${(s.against || []).map((x) => `<span class="pill s">✗ ${esc(x.n)}</span>`).join('')}</div>`;
    if (s.caveats && s.caveats.length) h += `<div class="alert" style="margin-top:10px">${s.caveats.join('. ')}.</div>`;
    if (s.setup && s.noOpt) {
      const st = s.setup;
      h += `<div class="lv"><div><small>${s.state === 'CE' ? 'Long' : 'Short'} around</small><b>${f1(st.e)}</b></div><div><small>Stop-loss</small><b class="down">${f1(st.sl)}</b></div><div><small>Target 1 / 2</small><b class="up">${f1(st.t1)} / ${f1(st.t2)}</b></div></div>
        <div class="mut" style="font-size:12px;margin-top:6px">${esc(a.cf.label)} has no option chain on Upstox, so paper trading is off. Levels are for the ${a.isMCX ? 'futures contract' : 'stock price'}.</div>`;
    } else if (s.setup) {
      const st = s.setup, e = estimate(cur, st.K, st.dir, o.lots);
      h += `<div class="lv"><div><small>Strike</small><b>${st.K} ${st.dir}</b></div><div><small>Buy price</small><b>${rs(e.px)}</b></div><div><small>SL / target</small><b><span class="down">${f1(st.pSL)}</span> / <span class="up">${f1(st.pT1)}</span></b></div></div>
        <button class="big ${cls}" onclick="Paper.takeSignal()">Take paper trade: ${o.lots} lot (${e.qty}), total ${rs(e.cost)}</button>`;
    }
    const ss = sigStats(signals.filter((x) => x.key === cur));
    h += `<div class="sig-foot">${ss.n} ${a.cf.label} signals so far. ${ss.pct == null ? 'No 30-minute results yet.' : `${ss.pct}% were right after 30 minutes (${ss.win} of ${ss.dec}).`}</div></div>`;
    $('pBanner').innerHTML = h;
  }
  function renderAccount() {
    const st = tradeStats(), eq = equity(), tot = eq - acc.start;
    $('pAcc').innerHTML = `<div><small>Cash (dummy)</small><b>${rs(acc.cash)}</b></div><div><small>Total value</small><b class="${tot >= 0 ? 'up' : 'down'}">${rs(eq)}</b></div>
      <div><small>Today's net P&L</small><b class="${st.today >= 0 ? 'up' : 'down'}">${sgn(st.today)}${rs(st.today)}</b></div><div><small>Win rate</small><b>${st.pct == null ? '–' : st.pct + '%'} <span class="mut" style="font-size:11px">(${st.n} trades)</span></b></div>`;
  }
  function renderPositions() {
    // don't redraw while you are typing a stop-loss or target (ticks would wipe the input)
    const ae = document.activeElement; if (ae && ae.closest && ae.closest('#pPos') && /INPUT|SELECT/.test(ae.tagName)) return;
    const op = openTrades(), o = opts();
    let h = `<div class="ptog"><label>New trades' SL <select onchange="Paper.setOpt('slMode',this.value)">${Object.entries(SLM).map(([k, l]) => `<option value="${k}" ${o.slMode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Voice <select onchange="Paper.setOpt('voice',this.value)"><option value="important" ${o.voice === 'important' ? 'selected' : ''}>Important only</option><option value="all" ${o.voice === 'all' ? 'selected' : ''}>All alerts</option><option value="off" ${o.voice === 'off' ? 'selected' : ''}>Off</option></select></label>
      <label><input type="checkbox" ${o.autoExit ? 'checked' : ''} onchange="Paper.setOpt('autoExit',this.checked)"> Auto-sell on exit signal</label></div>`;
    if (!op.length) h += '<div class="mut" style="padding:8px 0">No open positions. Take a trade from the live signal or place one manually below.</div>';
    for (const t of op) {
      const pnl = (t.ltp - t.entry) * t.qty, pct = ((t.ltp - t.entry) / t.entry) * 100, adv = t.advice || { state: 'HOLD', title: ADV.HOLD[0], why: [] };
      const ac = { HOLD: 'b', WARN: 'w', BOOK: 'o', EXIT: 's' }[adv.state];
      h += `<div class="pos"><div class="posh"><b>${t.label} ${t.K} ${t.type}</b><span class="mut">${t.lots} lot (${t.qty}), opened ${hm(t.openedMin)}</span></div>
        <div class="adv ${ac}"><b>${ADV[adv.state][0]}</b><div>${adv.why.map(esc).join('. ')}</div></div>
        <div class="lv"><div><small>Bought at</small><b>${f2(t.entry)}</b></div><div><small>Now (bid)</small><b>${f2(t.ltp)}</b></div><div><small>P&L</small><b class="${pnl >= 0 ? 'up' : 'down'}">${sgn(pnl)}${rs(pnl)}<br><small>${sgn(pct)}${f1(pct)}%</small></b></div></div>
        <div class="slbox"><div class="slm" role="group" aria-label="Stop-loss mode">${Object.entries({ both: 'Both', auto: 'Auto', manual: 'Mine' }).map(([k, l]) => `<button class="${(t.slMode || 'both') === k ? 'on' : ''}" onclick="Paper.setSLMode('${t.id}','${k}')">${l}</button>`).join('')}</div>
          <div class="slv"><span class="${t.slMode !== 'manual' && t.sl === t.slAuto ? 'act' : ''}"><small>Auto SL</small><b>${ok(t.slAuto) ? f2(t.slAuto) : '–'}</b></span>
          <span class="${t.slMode !== 'auto' && ok(t.slUser) && t.sl === t.slUser ? 'act' : ''}"><small>My SL</small><input type="number" step="0.05" placeholder="not set" value="${ok(t.slUser) ? t.slUser.toFixed(2) : ''}" onchange="Paper.setSL('${t.id}',this.value)"></span>
          <span><small>Active SL</small><b class="down">${f2(t.sl)}</b></span></div></div>
        <div class="posf">
        <label>Target <input type="number" step="0.05" value="${t.tgt ? t.tgt.toFixed(2) : ''}" onchange="Paper.setTgt('${t.id}',this.value)"></label>
        <button class="sell" onclick="Paper.closeId('${t.id}')">Sell now</button></div>
        ${t.log.length ? `<details><summary class="mut">Events (${t.log.length})</summary><div class="mut" style="font-size:12px">${t.log.slice(-8).map(esc).join('<br>')}</div></details>` : ''}</div>`;
    }
    $('pPos').innerHTML = h;
  }
  function renderOrderForm() {
    const a = A[cur]; if (!a) return;
    const strikes = a.ch.rows.length ? a.ch.view.map((r) => r.K) : Array.from({ length: 11 }, (_, i) => a.ch.atm + (i - 5) * a.ch.step);
    $('oStrike').innerHTML = strikes.map((K) => `<option value="${K}" ${K === a.ch.atm ? 'selected' : ''}>${K}${K === a.ch.atm ? ' (ATM)' : ''}</option>`).join('');
    $('oIdx').textContent = a.cf.label;
    updateEstimate();
  }
  function updateEstimate() {
    const a = A[cur]; if (!a || !$('oStrike').value) return;
    const K = +$('oStrike').value, type = $('oType').value, lots = Math.max(1, +$('oLots').value || 1), e = estimate(cur, K, type, lots);
    if (!e) return;
    $('oEst').innerHTML = `Buy price ${rs(e.px)} × ${e.qty} = ${rs(e.px * e.qty)} + charges ${rs(e.ch.total)} = <b>${rs(e.cost)}</b><br><span class="mut">Brokerage ${rs(e.ch.brk)}, transaction ${rs(e.ch.txn)}, stamp ${rs(e.ch.stamp)}, GST ${rs(e.ch.gst)}. STT of 0.15% applies when you sell.</span>`;
  }
  function renderRecord() {
    const mine = signals.filter((x) => x.key === cur).slice(0, 10), all = sigStats(signals), st = tradeStats();
    const by = (f) => sigStats(signals.filter(f));
    const strong = by(isStrong), weak = by(isMild);
    let h = `<div class="stats" style="margin-top:0"><div><small>Total signals (all indices)</small><b>${all.n}</b></div><div><small>Right after 30 min</small><b>${all.pct == null ? '–' : all.pct + '%'}</b></div>
      <div><small>Strong signals right</small><b>${strong.pct == null ? '–' : strong.pct + '%'}</b></div><div><small>Mild signals right</small><b>${weak.pct == null ? '–' : weak.pct + '%'}</b></div>
      <div><small>Exit signals ignored</small><b>${st.sigFollowN}</b></div><div><small>Difference if followed</small><b class="${st.better >= 0 ? 'up' : 'down'}">${st.sigFollowN ? sgn(st.better) + rs(st.better) : '–'}</b></div></div>`;
    h += `<div class="tbl" style="margin-top:10px"><table><thead><tr><th>Time</th><th>Direction</th><th>Score</th><th>Price</th><th>15 min</th><th>30 min</th></tr></thead><tbody>` +
      (mine.length ? mine.map((x) => `<tr><td>${hm(x.min)}</td><td><span class="pill ${x.dir === 'CE' ? 'b' : 's'}">${x.dir} ${isStrong(x) ? 'strong' : isMild(x) ? 'mild' : ''}</span></td><td>${x.score}</td><td>${f1(x.price)}</td><td>${res(x.r15, x.r15mv)}</td><td>${res(x.r30, x.r30mv)}</td></tr>`).join('') : '<tr><td colspan="6" class="mut">No signals yet</td></tr>') + '</tbody></table></div>';
    $('pRec').innerHTML = h;
  }
  const res = (r, mv) => { if (!r) return '<span class="mut">Pending</span>'; const o = outc(r); return `<span class="pill ${o === 'right' ? 'b' : o === 'wrong' ? 's' : 'n'}">${o === 'right' ? 'Right' : o === 'wrong' ? 'Wrong' : 'Flat'} ${sgn(mv)}${f1(mv)}</span>`; };
  function renderHistory() {
    const cl = closedTrades().slice(0, 15), st = tradeStats();
    let h = `<div class="stats" style="margin-top:0"><div><small>Total net P&L</small><b class="${st.net >= 0 ? 'up' : 'down'}">${sgn(st.net)}${rs(st.net)}</b></div><div><small>Paid in charges</small><b class="down">${rs(st.chg)}</b></div>
      <div><small>Avg win / loss</small><b><span class="up">${rs(st.avgW)}</span> / <span class="down">${rs(st.avgL)}</span></b></div><div><small>Profit factor</small><b>${st.pf == null ? '–' : f2(st.pf)}</b></div></div>`;
    h += `<div class="tbl" style="margin-top:10px"><table><thead><tr><th class="l">Trade</th><th>Buy → sell</th><th>Net P&L</th><th class="l">Reason</th></tr></thead><tbody>` +
      (cl.length ? cl.map((t) => `<tr><td class="l">${t.label} ${t.K} ${t.type}<br><span class="mut">${t.lots} lot, ${hm(t.openedMin)}–${hm(t.closedMin)}</span></td><td>${f2(t.entry)} → ${f2(t.exit)}</td>
        <td class="${t.net >= 0 ? 'up' : 'down'}">${sgn(t.net)}${rs(t.net)}<br><span class="mut">charges ${rs(t.entryCh.total + t.exitCh.total)}</span></td><td class="l" style="white-space:normal">${esc(t.reason)}</td></tr>`).join('') : '<tr><td colspan="4" class="mut">No closed trades yet</td></tr>') + '</tbody></table></div>';
    h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn-ghost" onclick="Paper.reset()">Reset account</button><span class="mut" style="font-size:12px;align-self:center">Starting capital ${rs(acc.start)}. ${Store.cloud ? 'Saved to Firebase.' : 'Saved in this browser.'}</span></div>`;
    $('pHist').innerHTML = h;
  }

  // ===== Actions =====
  function takeSignal() { const a = A[cur], s = signalFor(a); if (!s.setup) return; open({ key: cur, K: s.setup.K, type: s.setup.dir, lots: opts().lots, src: 'signal' }); }
  function placeManual() {
    const K = +$('oStrike').value, type = $('oType').value, lots = Math.max(1, Math.floor(+$('oLots').value || 1));
    open({ key: cur, K, type, lots, sl: +$('oSL').value || null, tgt: +$('oTgt').value || null, src: 'manual' });
  }
  function openFromAsk(K, type) { open({ key: cur, K, type, lots: opts().lots, src: 'ask' }); }
  function closeId(id) { const t = trades.find((x) => x.id === id); if (t) close(t, 'Sold manually', 'हाथ से बेचा'); }
  function setSL(id, v) {
    const t = trades.find((x) => x.id === id); if (!t) return;
    v = +v; t.slUser = v > 0 ? tick05(v) : null;
    if (t.slUser && t.slMode === 'auto') t.slMode = 'both';
    t.sl = effSL(t); t.log.push(t.slUser ? `Your SL set to ${f2(t.slUser)}` : 'Your SL removed'); Store.saveTrade(t); renderPositions();
  }
  function setSLMode(id, m) { const t = trades.find((x) => x.id === id); if (!t) return; t.slMode = m; if (m === 'manual' && !ok(t.slUser)) t.slUser = t.sl; t.sl = effSL(t); t.log.push(`SL mode: ${SLM[m]}`); Store.saveTrade(t); renderPositions(); }
  const SLM = { both: 'Both (tighter wins)', auto: 'Auto only', manual: 'Mine only' };
  function setTgt(id, v) { const t = trades.find((x) => x.id === id); v = +v; if (t) { t.tgt = v > 0 ? tick05(v) : null; Store.saveTrade(t); } }
  function setOpt(k, v) { const o = opts(); o[k] = v; Store.setPref('paper_opts', o); renderPositions(); }
  function setLots(v) { const o = opts(); o.lots = Math.max(1, Math.floor(+v || 1)); Store.setPref('paper_opts', o); renderBanner(); }
  async function reset() {
    const cap = prompt('This clears the paper account, trade history and signal record. Enter new starting capital (₹):', String(PC.START_CAPITAL));
    if (cap == null) return;
    const c = Math.max(1000, +cap || PC.START_CAPITAL);
    await Store.resetAll(); acc = { cash: c, start: c, created: Date.now() }; trades = []; signals = [];
    await Store.saveAccount(acc); toast('Account reset'); render();
  }
  return { load, onTick, render, renderOrderForm, updateEstimate, takeSignal, placeManual, closeId, openFromAsk, setSL, setSLMode, setTgt, setOpt, setLots, reset, opts, charges,
    get ready() { return ready; }, openTrades };
})();

/* Small helpers: beep and toast */
let _ac = null;
function beep(freq) {
  try { _ac = _ac || new (window.AudioContext || window.webkitAudioContext)(); const o = _ac.createOscillator(), g = _ac.createGain();
    o.frequency.value = freq || 600; g.gain.setValueAtTime(0.12, _ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, _ac.currentTime + 0.35);
    o.connect(g).connect(_ac.destination); o.start(); o.stop(_ac.currentTime + 0.36); } catch { /* sound blocked */ }
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3500); }
