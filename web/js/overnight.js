/* ===== Overnight page: BTST edge, gap-up / gap-down watch, reversal radar, BTST paper account and live record =====
   Everything here is separate from the intraday engine: it never changes a CALL/PUT signal, a score, a grade or the
   intraday paper account. BTST paper trades live in their own list ("btst"), so the 3:29 square-off never touches them.
   Numbers come from counting what happened the next day after days like today (js/overnight-model.js), never from AI. */
const Overnight = (() => {
  const IDX = [['NIFTY', 'NSE_INDEX|Nifty 50', 'Nifty 50'], ['BANKNIFTY', 'NSE_INDEX|Nifty Bank', 'Bank Nifty'], ['SENSEX', 'BSE_INDEX|SENSEX', 'Sensex']];
  const isIdx = (s) => IDX.some((x) => x[0] === s);
  let H = null, Q = null, M = null, V = null, tab = 'edge', busy = '', prog = 0, err = '', timer = null, trades = [], preds = [], loaded = false, mode = 'buy';
  const $o = (id) => document.getElementById(id);
  const live = () => Source.mode === 'live';
  const B = () => ({ AMOUNT: 50000, EXIT: 'close', ...((APP_CONFIG && APP_CONFIG.BTST) || {}) });
  const cost = () => OVM.costPct(B().AMOUNT, APP_CONFIG.CHARGES, B());
  const P = (x, d = 1) => (ok(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : '–');
  const pc0 = (x) => (ok(x) ? `${Math.round(x * 100)}%` : '–');
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const ymdNow = () => istYmd();
  const nowMin = () => istMin();
  const weekday = () => { const d = istNow().getUTCDay(); return d > 0 && d < 6; };
  const marketOpen = () => (!live() ? true : weekday() && nowMin() >= 0 && nowMin() < 375);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- storage: history in IndexedDB, BTST trades + predictions in Firestore (logged in) or this browser ---------- */
  function idb(mode2, fn) { return new Promise((res) => { try { const o = indexedDB.open('fno_bt', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onsuccess = () => { try { const tx = o.result.transaction('kv', mode2), q = fn(tx.objectStore('kv')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => res(null); } catch (e) { res(null); } }; o.onerror = () => res(null); } catch (e) { res(null); } }); }
  const hKey = () => (live() ? 'ovn_hist' : 'ovn_hist_demo3');
  const fsCol = (name) => (Store.cloud && Store.user && window.firebase ? firebase.firestore().collection('users').doc(Store.user.uid).collection(name) : null);
  async function loadBook() {
    const lk = live() ? '' : '_demo';
    const c1 = fsCol('btst'), c2 = fsCol('btstpred');
    try {
      if (c1) { const [a, b] = await Promise.all([c1.orderBy('ts', 'desc').limit(200).get(), c2.orderBy('date', 'desc').limit(600).get()]); trades = a.docs.map((d) => d.data()); preds = b.docs.map((d) => d.data()); }
      else { trades = Store.pref('btst_trades' + lk, []); preds = Store.pref('btst_preds' + lk, []); }
    } catch (e) { trades = Store.pref('btst_trades' + lk, []); preds = Store.pref('btst_preds' + lk, []); }
    loaded = true;
  }
  async function saveTrade(t) {
    const i = trades.findIndex((x) => x.id === t.id); if (i >= 0) trades[i] = t; else trades.unshift(t);
    const c = fsCol('btst'); if (c) { try { await c.doc(t.id).set(t); return; } catch (e) { /* fall back to this browser */ } }
    Store.setPref('btst_trades' + (live() ? '' : '_demo'), trades.slice(0, 200));
  }
  async function savePreds(list) {
    const c = fsCol('btstpred');
    if (c) { try { const b = firebase.firestore().batch(); list.forEach((p) => b.set(c.doc(p.id), p)); await b.commit(); return; } catch (e) { /* fall back */ } }
    Store.setPref('btst_preds' + (live() ? '' : '_demo'), preds.slice(0, 600));
  }

  /* ---------- data ---------- */
  async function loadHist() { if (!H) H = await idb('readonly', (s) => s.get(hKey())); if (!H && !live()) { H = demoHist(); await idb('readwrite', (s) => s.put(H, hKey())); } if (H && !M) rebuild(); }
  function rebuild() {
    M = OVM.build(H.rows, isIdx);
    try { V = OVM.validate(H.rows, isIdx, { cost: cost() }); } catch (e) { V = null; }
  }
  async function download() {
    if (!live()) return toast('Demo mode uses sample history. Log in to download real history from Upstox.');
    if (busy) return;
    busy = 'Getting the F&O stock list…'; prog = 0; render();
    try {
      const U = await Source.raw('/api/universe');
      const list = [...IDX.map(([sym, key, name]) => ({ sym, key, name, idx: true })), ...(U.items || [])];
      const to = ymdNow(), from = new Date(Date.now() + 5.5 * 3600e3 - 760 * 864e5).toISOString().slice(0, 10), from2 = new Date(Date.now() + 5.5 * 3600e3 - 400 * 864e5).toISOString().slice(0, 10);
      const rows = {}, meta = {}; let fails = 0;
      for (let i = 0; i < list.length; i++) {
        const x = list[i]; prog = i / list.length; busy = `Downloading 2 years of daily candles: ${x.sym} (${i + 1} of ${list.length})…`; if (i % 3 === 0) render();
        let j = null;
        for (let tries = 0; tries < 3 && !j; tries++) {
          try { j = await Source.raw(`/api/hist?key=${encodeURIComponent(x.key)}&unit=days&iv=1&from=${tries ? from2 : from}&to=${to}`); }
          catch (e) { if (e.code === 'UPSTOX_RATE') { busy = 'Upstox asked to slow down, waiting 60 s…'; render(); await sleep(61000); } else if (e.code === 'UPSTOX_TOKEN_BAD' || e.code === 'UPSTOX_LOGIN') throw e; else if (tries === 2) fails++; }
        }
        const d = j ? BT.parseDaily(j.data && j.data.candles).filter((r) => r[0] < to).map((r) => [r[0], r[1], r[2], r[3], r[4], r[5] || 0]) : [];
        if (d.length > 60) { rows[x.sym] = d; meta[x.sym] = { key: x.key, name: x.name, lot: x.lot || null, idx: !!x.idx }; }
        await sleep(120);
      }
      H = { ts: Date.now(), day: to, rows, meta, fails };
      await idb('readwrite', (s) => s.put(H, hKey()));
      busy = 'Working out the patterns…'; render(); await sleep(30);
      rebuild(); busy = ''; toast(`History ready: ${Object.keys(rows).length} instruments${fails ? `, ${fails} failed` : ''}.`);
      await refreshQuotes(); evaluatePreds();
    } catch (e) { busy = ''; err = 'Download stopped: ' + e.message + (/404|Not found/i.test(e.message) ? ' (deploy the new Worker code)' : ''); }
    render();
  }
  async function refreshQuotes(syms) {
    if (!live()) { Q = demoQuotes(); return; }
    try { const j = await Source.raw('/api/eod' + (syms ? '?syms=' + syms.join(',') : '')); if (!syms) Q = j; else { Q = Q || { ts: j.ts, q: {} }; Object.assign(Q.q, j.q); } err = ''; }
    catch (e) { err = /404|Not found/i.test(e.message) ? 'Deploy the new Worker code: it adds /api/eod for end-of-day prices.' : e.message; }
    appendToday();
  }
  // after 15:30 on a trading day, today's candle joins the history (so it stays current without a re-download)
  function appendToday() {
    if (!live() || !H || !Q || !Q.q || !weekday() || nowMin() < 376) return;
    const td = ymdNow(); let n = 0;
    for (const sym in Q.q) {
      const q = Q.q[sym], R = H.rows[sym]; if (!R || !R.length || !ok(q.o) || !ok(q.c)) continue;
      const L = R[R.length - 1]; if (L[0] >= td || (!isIdx(sym) && !(q.v > 0))) continue;
      if (L[1] === q.o && L[2] === q.h && L[3] === q.l && L[4] === q.c) continue; // a holiday shows the last session again
      R.push([td, q.o, q.h, q.l, q.c, q.v || 0]); n++;
    }
    if (n) { H.day = td; idb('readwrite', (s) => s.put(H, hKey())); rebuild(); evaluatePreds(); }
  }

  /* ---------- today, for every instrument ---------- */
  function todayRow(sym) {
    const R = H && H.rows[sym], q = Q && Q.q && Q.q[sym]; if (!R || !q || !ok(q.c)) return null;
    const td = live() ? ymdNow() : 'today', last = R[R.length - 1];
    // weekend or holiday: the quote still shows the last session, which is already the last history row
    if (live() && last[1] === q.o && last[2] === q.h && last[3] === q.l && last[4] === q.c) { const f0r = OVM.feat(R, R.length - 1, 1); return f0r ? { sym, q, f: f0r, L: OVM.lookup(M, sym, f0r, isIdx(sym)), meta: (H.meta && H.meta[sym]) || {} } : null; }
    const base = last[0] >= td ? R.slice(0, -1) : R;
    const el = live() ? clamp(nowMin(), 1, 375) : 375, vf = el >= 375 ? 1 : 1 / Math.pow(el / 375, 1.3); // part-day volume scaled to a full day
    const rows = [...base, [td, q.o || q.c, q.h || q.c, q.l || q.c, q.c, q.v || 0]];
    const f = OVM.feat(rows, rows.length - 1, vf); if (!f) return null;
    return { sym, q, f, L: OVM.lookup(M, sym, f, isIdx(sym)), meta: (H.meta && H.meta[sym]) || {} };
  }
  function scan() {
    if (!H || !M || !Q || !Q.q) return [];
    const out = []; for (const sym in H.rows) { const t = todayRow(sym); if (t) out.push(t); } return out;
  }
  const TAG = { F2: ['Big fall today', 's'], F1: ['Down today', 's'], N0: ['Flat today', 'n'], R1: ['Up today', 'b'], R2: ['Big rise today', 'b'], L: ['closing near the low', 's'], M: ['closing mid-range', 'n'], H: ['closing near the high', 'b'], U: ['above 50-day avg', 'b'], D: ['below 50-day avg', 's'], V: ['heavy volume', 'g'] };
  const tags = (f) => [f.ch, f.cl, f.tr, f.vo === 'V' ? 'V' : null].filter(Boolean).map((k) => `<span class="pill ${TAG[k][1]}">${TAG[k][0]}</span>`).join('');
  function levels(t) {
    // stop at least ~0.6 of a normal day's move away (closer stops get hit by noise); targets at least 1.5× the round-trip cost
    const st = t.L.best.st, c = t.q.c, am = t.f.avgMove || 0.01, C = cost();
    const sl = Math.min(st.loQ25 || -0.01, -0.6 * am, -0.004), t1 = Math.max(st.hiMed || 0.005, 1.5 * C), t2 = Math.max(st.hiQ75 || 0.01, t1 + 0.4 * am);
    return { e1: c * 0.998, e2: c * 1.001, sl: c * (1 + sl), t1: c * (1 + t1), t2: c * (1 + t2) };
  }
  function context(sym) {
    const out = [];
    try { const c = Impact.companies().find((x) => x.sym === sym); if (c) out.push(`<span class="pill ${c.sc >= 0 ? 'b' : 's'}">News ${c.sc >= 0 ? '▲' : '▼'}</span>`); } catch (e) { /* no news data */ }
    try { const r = Impact.earnings && Impact.earnings.items && Impact.earnings.items.find((x) => x.sym === sym); if (r) out.push(`<span class="pill ${r.s >= 0.3 ? 'b' : r.s <= -0.3 ? 's' : 'n'}">Results ${ok(r.pat) ? `profit ${r.pat >= 0 ? '+' : ''}${Math.round(r.pat)}%` : r.s >= 0.3 ? 'strong' : r.s <= -0.3 ? 'weak' : 'mixed'}</span>`); } catch (e) { /* no results data */ }
    return out.join('');
  }

  /* ---------- page ---------- */
  function build() {
    if ($o('ov')) return;
    const el = document.createElement('div'); el.id = 'ov'; el.className = 'rp ov'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Overnight: BTST and gap radar');
    el.innerHTML = `<div class="rp-top"><div class="mk-tabs" role="tablist"><button data-t="edge" onclick="Overnight.show('edge')">Overnight Edge</button><button data-t="rev" onclick="Overnight.show('rev')">Reversal Radar</button><button data-t="book" onclick="Overnight.show('book')">BTST Paper & Record</button></div>
      <span class="mut" id="ovNote"></span><button class="x" onclick="Overnight.close()" aria-label="Close">✕</button></div><div id="ovBody"></div>`;
    document.body.appendChild(el);
  }
  async function open(t) {
    build(); $o('ov').classList.add('on'); document.body.style.overflow = 'hidden';
    tab = t || tab; render();
    if (!loaded) await loadBook();
    await loadHist(); render();
    try { if (typeof Impact !== 'undefined') { Impact.load(); Impact.loadEarnings && Impact.loadEarnings().then(render); } } catch (e) { /* optional */ }
    await refreshQuotes(); await checkTrades(); recordPicks(); evaluatePreds(); render();
    clearInterval(timer); timer = setInterval(async () => { if (!$o('ov').classList.contains('on')) return; if (marketOpen() || !Q) { await refreshQuotes(); await checkTrades(); recordPicks(); render(); } }, 60000);
  }
  function close() { clearInterval(timer); timer = null; const el = $o('ov'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; }
  function show(t) { tab = t; render(); }
  function render() {
    const b = $o('ovBody'); if (!b) return;
    document.querySelectorAll('#ov .mk-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
    $o('ovNote').textContent = `${Source.clock().label}${Q ? ` · prices ${new Date(Q.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : ''}${H ? ` · history to ${H.day}${live() ? '' : ' (demo)'}` : ''}`;
    let h = '';
    if (busy) h += `<div class="alert i">${esc(busy)}<div class="rp-pbar"><i style="width:${Math.round(prog * 100)}%"></i></div></div>`;
    if (err) h += `<div class="alert d">${esc(err)}</div>`;
    b.innerHTML = h + (tab === 'edge' ? edgeHTML() : tab === 'rev' ? revHTML() : bookHTML());
  }

  /* ---------- tab 1: overnight edge ---------- */
  function timeNote() {
    if (!live()) return 'Demo: made-up history with a built-in pattern, so the lists have something to show. Real numbers come after you download history in live mode.';
    const m = nowMin();
    if (!weekday() || m >= 375) return 'Market closed: this uses today\'s closing prices. Good time to plan tomorrow.';
    if (m < 330) return `It's ${hm(m)}: today's candle is still forming, so "days like today" can change a lot before the close. The picture firms up from 2:45 PM; BTST entries are usually taken 3:00–3:25 PM.`;
    return `It's ${hm(m)}: the closing window. Today's candle is close to final.`;
  }
  function validationHTML() {
    if (!V) return '';
    const c = V.close, o = V.open, row = (b, i) => { const g = V.cal.gap[i], u = V.cal.up[i]; return `<tr><td class="l">${Math.round(b[0] * 100)}–${Math.min(100, Math.round(b[1] * 100))}%</td><td>${g.n ? pc0(g.hit / g.n) : '–'} <small class="mut">(${g.n})</small></td><td>${u.n ? pc0(u.hit / u.n) : '–'} <small class="mut">(${u.n})</small></td></tr>`; };
    const verdict = V.edge === 'found' ? ['b', `Edge found in the test period${live() ? '' : ' (demo data has a built-in pattern, so this is not a real result)'}: over the last ${V.days} trading days, buying the top 5 picks each day and selling at the next close averaged ${P(c.avg, 2)} per trade after costs (win ${pc0(c.win)}, profit factor ${f2(c.pf)}, ${c.n} trades).`]
      : V.edge === 'none' ? ['s', `No reliable edge after costs: over the last ${V.days} trading days the top picks averaged ${P(c.avg, 2)} per trade after costs (${c.n} trades). Treat this page as information, not as a buy list.`]
        : ['n', `Too few picks passed the bar in the test period (${c.n} trades) to judge an edge. That itself says: strong overnight setups are rare.`];
    return `<details class="rc-d ov-val" ${V.edge !== 'found' ? 'open' : ''}><summary>How good is this? Tested on ${V.days} past days it had not seen (${V.from} to ${V.to})</summary><div>
      <div class="alert ${verdict[0] === 'b' ? 'i' : verdict[0] === 's' ? 'd' : ''}">${verdict[1]}</div>
      <div class="lv"><div><small>Sell next close</small><b class="${cls(c.avg)}">${P(c.avg, 2)}</b><small>avg per trade, after costs</small></div><div><small>Sell at next open</small><b class="${cls(o.avg)}">${P(o.avg, 2)}</b><small>avg per trade, after costs</small></div><div><small>Buying every stock</small><b class="${cls(V.base)}">${P(V.base, 2)}</b><small>the baseline to beat</small></div></div>
      <div class="sec">Are the percentages honest? (calibration)</div>
      <div class="tblw"><table><thead><tr><th class="l">When it said</th><th>Gapped up</th><th>Closed up next day</th></tr></thead><tbody>${V.cal.bins.map(row).join('')}</tbody></table></div>
      <div class="legend">If the numbers are honest, a "60%+" row should come true about 60% of the time or more. Costs used: ${P(V.cost, 2)} per round trip on ₹${f0(B().AMOUNT)} (delivery STT both sides, stamp duty, exchange, GST, brokerage, a little slippage). Today's F&O list is used for the past too, so stocks that left F&O are missing (survivorship bias): real results are usually a bit worse.</div></div></details>`;
  }
  function card(list, kind) {
    if (!list.length) return `<div class="mut ov-empty">${kind === 'buy' ? 'No stock passes the bar today: at least 55% of similar days closed higher the next day AND the average gain beats costs. That\'s a normal answer, most days have no good BTST.' : kind === 'up' ? 'No stock has a 60%+ gap-up history for days like today.' : 'No stock has a 60%+ gap-down history for days like today.'}</div>`;
    return `<div class="tblw"><table><thead><tr><th class="l">Stock</th><th>Price</th><th>Today</th><th class="l">Today's picture</th><th>Gap up next day</th><th>Avg gap</th><th>Up by next close</th><th>Next-day range</th><th>Days like today</th>${kind === 'buy' ? '<th>Entry / SL / T1 / T2</th>' : ''}<th></th></tr></thead><tbody>${list.map((t) => {
      const st = t.L.best.st, lv = levels(t), idx = isIdx(t.sym), pcv = t.q.pc ? t.q.c / t.q.pc - 1 : t.f.chg;
      return `<tr><td class="l nm"><b>${esc(t.sym)}</b><small>${esc(t.meta.name || '')}</small><div class="ov-ctx">${context(t.sym)}</div></td><td>${f2(t.q.c)}</td><td class="${cls(pcv)}">${P(pcv)}</td><td class="l ov-tags">${tags(t.f)}</td>
        <td><b class="${st.pGap >= 0.55 ? 'up' : st.pGap <= 0.45 ? 'down' : ''}">${pc0(st.pGap)}</b></td><td class="${cls(st.mGap)}">${P(st.mGap, 2)}</td><td><b class="${st.pUp >= 0.55 ? 'up' : st.pUp <= 0.45 ? 'down' : ''}">${pc0(st.pUp)}</b></td>
        <td>${P(st.q10)} to ${P(st.q90)}</td><td>${t.L.src === 'own' ? `${st.n} <small class="mut">own</small>` : `<small class="mut">${t.L.nOwn || 0} own · pattern from all ${idx ? 'indices' : 'F&O'} (${t.L.pool.st.n})</small>`}</td>
        ${kind === 'buy' ? `<td class="ov-lv">${f1(lv.e1)}–${f1(lv.e2)}<br><span class="down">SL ${f1(lv.sl)}</span> · <span class="up">${f1(lv.t1)} / ${f1(lv.t2)}</span></td>` : ''}
        <td>${!idx ? `<button class="btn-ghost" onclick="Overnight.buy('${esc(t.sym)}')">Paper BTST</button>` : ''}${!idx && t.meta.key ? `<button class="btn-ghost" onclick="Overnight.analyze('${esc(t.sym)}')">Analyze</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  function edgeHTML() {
    if (!H) return `<div class="mk-panel"><h2 class="ov-h">One-time setup</h2><p class="rc-p">This page needs 2 years of daily candles for every F&O stock and the 3 indices, kept in this browser. Download takes about 2 minutes, once. After that it updates itself each evening when you open it after 3:30 PM.</p><button class="btn" onclick="Overnight.download()">Download history from Upstox</button></div>`;
    const all = scan(), C = cost(), stocks = all.filter((t) => !isIdx(t.sym) && t.L && t.L.best), ix = all.filter((t) => isIdx(t.sym));
    const buys = stocks.filter((t) => t.L.src === 'own' && t.L.best.st.pUp >= 0.55 && t.L.best.st.mOc - C > 0).sort((a, b) => b.L.best.st.mOc - a.L.best.st.mOc).slice(0, 12);
    const ups = all.filter((t) => t.L && t.L.best && t.L.best.st.pGap >= 0.6 && t.L.best.st.mGap > 0.002).sort((a, b) => b.L.best.st.pGap - a.L.best.st.pGap).slice(0, 12);
    const dns = all.filter((t) => t.L && t.L.best && t.L.best.st.pGap <= 0.4 && t.L.best.st.mGap < -0.002).sort((a, b) => a.L.best.st.pGap - b.L.best.st.pGap).slice(0, 12);
    let h = `<div class="ov-bar"><span>${esc(timeNote())}</span><span class="mut">${all.length} instruments read · cost ${P(C, 2)} per BTST round trip</span><button class="btn ghost" onclick="Overnight.refresh()">Refresh prices</button>${live() ? '<button class="btn ghost" onclick="Overnight.download()">Re-download history</button>' : ''}</div>`;
    h += validationHTML();
    h += `<div class="ov-idx">${ix.map((t) => { const st = t.L && t.L.best && t.L.best.st, pcv = t.q.pc ? t.q.c / t.q.pc - 1 : t.f.chg; return `<div class="ov-i"><small>${esc(t.meta.name || t.sym)}</small><b class="${cls(pcv)}">${f0(t.q.c)} <span>${P(pcv, 2)}</span></b><div class="ov-tags">${tags(t.f)}</div>${st ? `<span>Next day: gap up <b>${pc0(st.pGap)}</b>, avg gap ${P(st.mGap, 2)}, up by close <b>${pc0(st.pUp)}</b> <small class="mut">(${t.L.src === 'own' ? st.n + ' similar days' : 'pattern from all indices'})</small></span>` : '<span class="mut">INSUFFICIENT DATA for days like today</span>'}</div>`; }).join('')}</div>`;
    const seg = [['buy', `Top BTST buys (${buys.length})`], ['up', `Gap-up watch (${ups.length})`], ['dn', `Gap-down alerts (${dns.length})`]];
    h += `<div class="seg ov-seg">${seg.map(([k, n]) => `<button class="${mode === k ? 'on' : ''}" onclick="Overnight.mode('${k}')">${n}</button>`).join('')}</div>`;
    h += `<section class="mk-panel">${mode === 'buy' ? `<p class="mut ov-p">Stocks whose own history says: on days like today, at least 55% closed higher the next day and the average gain beat the ${P(C, 2)} cost. Sorted by that average. Levels come from how far similar days moved next day (stop = a dip three-quarters of them stayed above; T1 = the high half of them reached).</p>${card(buys, 'buy')}`
      : mode === 'up' ? `<p class="mut ov-p">60%+ of similar days opened higher the next morning, with an average gap above +0.2%. A gap-up is not a profit: some gaps are sold off right after the open.</p>${card(ups, 'up')}`
        : `<p class="mut ov-p">60%+ of similar days opened LOWER the next morning. Useful if you hold these overnight, or as a warning against buying them today.</p>${card(dns, 'dn')}`}</section>`;
    h += `<div class="legend">How to read it: "Gap up next day 62%" means that in the past 2 years, on days that looked like today for this stock, 62 of every 100 opened higher the next morning. Small samples are pulled towards the all-stocks rate so a few lucky days can't show a big number. History can't see tonight's news, US markets or results: GIFT Nifty and the Impact page tell you about those. A stop-loss does not protect you overnight: a gap can open below it.</div>`;
    return h;
  }

  /* ---------- tab 2: reversal radar (indices) ---------- */
  function revRead(k) {
    const a = A[k]; if (!a) return null;
    const today = a.D.candles.filter((c) => c.d === 2); if (!today.length || !ok(a.PC)) return null;
    const fall = a.DL / a.PC - 1, rec = a.PC > a.DL ? (a.price - a.DL) / (a.PC - a.DL) : null;
    const back = today.find((c) => c.m >= a.curMin - 60), last60 = back ? a.price / back.c - 1 : null;
    const R = H && H.rows[k]; let avg = null; if (R && R.length > 21) { avg = 0; for (let i = R.length - 20; i < R.length; i++) avg += Math.abs(R[i][4] / R[i - 1][4] - 1); avg /= 20; }
    const thr = Math.max(0.008, avg ? avg * 1.2 : 0.008), active = fall <= -thr;
    const vw = ok(a.vw) ? a.price > a.vw : null, br = a.brain || {}, up = br.up, dn = br.dn;
    const sc = !!(a.oif && a.oif.notes && a.oif.notes.some((x) => /scover/.test(x[1]))) || !!(a.fut && a.fut.m30 && /Short covering/.test(a.fut.m30[0]));
    const longBuild = !!(a.fut && a.fut.m30 && /Long buildup/.test(a.fut.m30[0]));
    let nl = null; try { nl = Impact.niftyLean(); } catch (e) { /* no news */ }
    const daily = a.long && a.long.dir;
    const why = [];
    if (ok(rec)) why.push([rec >= 0.6 ? 'ok' : rec >= 0.3 ? 'warn' : 'bad', `Recovered ${Math.round(rec * 100)}% of today's fall (low ${f0(a.DL)}, now ${f0(a.price)})`]);
    if (ok(last60)) why.push([last60 > 0.002 ? 'ok' : last60 < -0.002 ? 'bad' : 'warn', `Last 60 minutes ${P(last60, 2)}`]);
    if (vw != null) why.push([vw ? 'ok' : 'bad', `Price ${vw ? 'above' : 'below'} ${a.hasVol ? 'VWAP' : 'TWAP'} (${f0(a.vw)})`]);
    if (ok(up) && up + dn > 0) why.push([up > dn ? 'ok' : 'bad', `Breadth ${up} up, ${dn} down${up > dn ? ': the bounce is broad' : ': only a few stocks are lifting it'}`]);
    if (sc) why.push(['warn', 'Short covering in futures or near-the-money options: fast, but can fade once shorts are out']);
    if (longBuild) why.push(['ok', 'Fresh long buildup in futures (last 30 min): new buyers, not just shorts covering']);
    if (ok(nl)) why.push([nl >= 0.12 ? 'ok' : nl <= -0.12 ? 'bad' : 'warn', `News lean ${nl >= 0.12 ? 'positive' : nl <= -0.12 ? 'negative' : 'neutral'} (Impact page)`]);
    if (daily) why.push([daily === 'CE' ? 'ok' : 'warn', `Daily trend ${daily === 'CE' ? 'up: dips get bought' : 'down: bounces in a downtrend often fail'}`]);
    let label = 'No reversal yet', tone = 'n';
    if (ok(rec)) {
      if (rec >= 0.6 && vw && ok(up) && up > dn && (ok(last60) ? last60 > 0 : true) && !(sc && !longBuild)) { label = ok(nl) && nl >= 0.25 ? 'News-driven recovery' : 'Genuine-looking reversal'; tone = 'b'; }
      else if (rec >= 0.4 && sc && !(ok(up) && up > dn)) { label = 'Short-covering bounce'; tone = 'g'; }
      else if (rec >= 0.3 && (daily === 'PE' || vw === false)) { label = daily === 'PE' ? 'Bear-market rally risk' : 'Weak bounce: below VWAP'; tone = 'g'; }
      else if (rec >= 0.5 && vw && ok(last60) && last60 < -0.002) { label = 'False-start risk: recovery fading in the last hour'; tone = 'g'; }
      else if (rec < 0.3) { label = 'No reversal: still near the lows'; tone = 's'; }
      else { label = 'Partial recovery, mixed signs'; tone = 'n'; }
    }
    // history: past days of this index with a fall like today's and a similar close position
    let hist = null;
    if (H && R) {
      const clv = a.DH > a.DL ? (a.price - a.DL) / (a.DH - a.DL) : 0.5, cb = clv < 0.33 ? 0 : clv > 0.67 ? 2 : 1, L = [], LP = [];
      const take = (RR, into) => { for (let i = 21; i < RR.length - 1; i++) { const r = RR[i], pcx = RR[i - 1][4]; let av = 0; for (let j = i - 20; j < i; j++) av += Math.abs(RR[j][4] / RR[j - 1][4] - 1); av /= 20; const fl = r[3] / pcx - 1, cv = r[2] > r[3] ? (r[4] - r[3]) / (r[2] - r[3]) : 0.5; if (fl <= -Math.max(0.008, av * 1.2) && (cv < 0.33 ? 0 : cv > 0.67 ? 2 : 1) === cb) { const o = OVM.out(RR, i); if (o) into.push(o); } } };
      take(R, L); IDX.forEach(([s]) => H.rows[s] && take(H.rows[s], LP));
      hist = { own: OVM.stats(L), pool: OVM.stats(LP), cb };
    }
    return { k, a, fall, rec, last60, active, thr, label, tone, why, hist };
  }
  function revHTML() {
    const L = IDX.map(([k]) => revRead(k)).filter(Boolean);
    if (!L.length) return '<div class="mut">Waiting for index data…</div>';
    const CB = ['near its low', 'mid-range', 'near its high'];
    return `<p class="mut ov-p">Wakes up when an index falls more than about 1.2× its normal daily move (at least 0.8%). It then reads whether the bounce looks real, and counts what happened the next day after past falls like today's.</p>` + L.map((r) => {
      const hs = r.hist, own = hs && hs.own, pool = hs && hs.pool;
      const hist = !hs ? '<div class="mut">Download the history on the Overnight Edge tab to see what happened after past days like this.</div>'
        : own.n >= 15 ? `<div class="lv"><div><small>Gap up next day</small><b class="${own.pGap >= 0.55 ? 'up' : own.pGap <= 0.45 ? 'down' : ''}">${pc0(own.pGap)}</b><small>avg gap ${P(own.mGap, 2)}</small></div><div><small>Up by next close</small><b class="${own.pUp >= 0.55 ? 'up' : own.pUp <= 0.45 ? 'down' : ''}">${pc0(own.pUp)}</b><small>range ${P(own.q10)} to ${P(own.q90)}</small></div><div><small>Past days like this</small><b>${own.n}</b><small>${r.a.cf.label}, closing ${CB[hs.cb]}</small></div></div>`
          : `<div class="alert">INSUFFICIENT DATA: only ${own.n} past ${r.a.cf.label} days had a fall like this and closed ${CB[hs.cb]} (15 needed).${pool.n >= 20 ? ` Across all 3 indices: ${pool.n} days, gap up next day ${pc0(pool.pGap)}, up by next close ${pc0(pool.pUp)}.` : ''}</div>`;
      return `<section class="mk-panel ov-rev"><div class="ph"><h2>${esc(r.a.cf.label)}</h2><span class="pill ${r.active ? 'g' : 'n'}">${r.active ? 'Radar active' : 'Radar idle'}</span></div>
        ${r.active ? `<div class="rc-verdict ${r.tone}"><div class="rc-vk">Today's fall to the low: ${P(r.fall, 2)} (radar starts at ${P(-r.thr, 2)})</div><div class="rc-vt">${esc(r.label)}</div></div>
        <div class="rc-list" style="margin-top:8px">${r.why.map(([st, t]) => `<div class="rc-item ${st}"><span class="rc-ic">${{ ok: '✓', warn: '!', bad: '✗' }[st]}</span><div><span>${esc(t)}</span></div></div>`).join('')}</div>
        <div class="sec">What happened the next day after falls like this</div>${hist}`
        : `<div class="mut">Today's biggest fall from yesterday's close was ${P(r.fall, 2)}. The radar starts at ${P(-r.thr, 2)} for ${esc(r.a.cf.label)}. Nothing to read today.</div>`}</section>`;
    }).join('') + '<div class="legend">The label is a reading of today\'s tape (recovery, VWAP, breadth, futures and option flow, news, daily trend), not a forecast. The next-day numbers are counts from past days. A big fall can keep falling the next day: never assume a fall is a buying chance.</div>';
  }

  /* ---------- BTST paper account (separate from intraday paper trading) ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const chargesOf = (amt) => cost() * amt - (2 * ((B().SLIP_PCT || 0.05) / 100)) * amt; // costs without the slippage (slippage is in the fill prices)
  async function buy(sym) {
    const t0 = todayRow(sym); if (!t0) return toast('No price for ' + sym + ' yet.');
    if (!t0.L || !t0.L.best) return toast(`${sym}: INSUFFICIENT DATA for days like today, so there is no plan to paper-trade.`);
    if (live() && !marketOpen()) return toast('BTST paper buys work during market hours (9:15–3:30).');
    if (trades.some((x) => x.sym === sym && x.status === 'open')) return toast(`You already hold a BTST paper position in ${sym}.`);
    const slip = (B().SLIP_PCT || 0.05) / 100, px = t0.q.c * (1 + slip), qty = Math.max(1, Math.floor(B().AMOUNT / px)), lv = levels(t0), st = t0.L.best.st;
    const t = { id: uid(), sym, key: t0.meta.key || null, name: t0.meta.name || sym, qty, entry: px, date: live() ? ymdNow() : 'demo-' + Date.now(), ts: Date.now(), sl: lv.sl, t1: lv.t1, status: 'open',
      pred: { pGap: st.pGap, pUp: st.pUp, mOc: st.mOc, n: st.n, src: t0.L.src }, mode: B().EXIT, log: [] };
    await saveTrade(t); toast(`Paper BTST: bought ${qty} ${sym} at ${rs(px)}. Exit plan: ${t.mode === 'open' ? 'sell at tomorrow\'s open' : 'stop, target, or by 3:15 PM tomorrow'}.`);
    tab = 'book'; render();
  }
  async function sellNow(id, why) {
    const t = trades.find((x) => x.id === id); if (!t || t.status !== 'open') return;
    const q = Q && Q.q && Q.q[t.sym]; if (!q) return toast('No price yet.');
    await closeT(t, q.c * (1 - (B().SLIP_PCT || 0.05) / 100), why || 'Sold manually');
  }
  async function closeT(t, px, why) {
    const amt = t.entry * t.qty, ch = chargesOf(amt);
    Object.assign(t, { status: 'closed', exit: px, exitTs: Date.now(), why, gross: (px - t.entry) * t.qty, net: (px - t.entry) * t.qty - ch, ch });
    await saveTrade(t); render();
  }
  // next trading day: stop or target touched (stop first if both), sell-at-open mode, or time exit at 3:15 PM
  async function checkTrades() {
    const open = trades.filter((t) => t.status === 'open'); if (!open.length) return;
    if (live()) { const syms = [...new Set(open.map((t) => t.sym))]; try { const j = await Source.raw('/api/eod?syms=' + syms.join(',')); Q = Q || { ts: j.ts, q: {} }; Object.assign(Q.q, j.q); Q.ts = j.ts; } catch (e) { /* keep last */ } }
    for (const t of open) {
      const R = H && H.rows[t.sym], next = R && R.find((r) => r[0] > t.date);
      let day = null;
      if (next) day = { o: next[1], h: next[2], l: next[3], c: next[4], done: true };
      else if (live() && ymdNow() > t.date && weekday() && nowMin() >= 0) { const q = Q && Q.q && Q.q[t.sym]; if (q && ok(q.o)) day = { o: q.o, h: q.h, l: q.l, c: q.c, done: nowMin() >= 375 }; }
      else if (!live() && t.demoNext) day = t.demoNext;
      if (!day) continue;
      const slip = (B().SLIP_PCT || 0.05) / 100;
      if (t.mode === 'open') await closeT(t, day.o * (1 - slip), 'Sold at the next open');
      else if (day.o <= t.sl) await closeT(t, day.o * (1 - slip), 'Gapped below the stop: sold at the open');
      else if (day.o >= t.t1) await closeT(t, day.o * (1 - slip), 'Gapped above target 1: sold at the open');
      else if (day.l <= t.sl) await closeT(t, t.sl * (1 - slip), 'Stop-loss');
      else if (day.h >= t.t1) await closeT(t, t.t1 * (1 - slip), 'Target 1');
      else if (day.done || nowMin() >= 360) await closeT(t, day.c * (1 - slip), day.done ? 'Sold at the next close' : 'Time exit 3:15 PM');
    }
  }

  /* ---------- live record: what the page said vs what happened ---------- */
  function recordPicks() {
    if (!live() || !H || !Q || !weekday() || nowMin() < 330 || nowMin() > 400) return; // the closing window only
    const td = ymdNow(), all = scan(), C = cost(), add = [];
    const put = (t, kind) => { const st = t.L.best.st, id = `${td}-${kind}-${t.sym}`, p = { id, date: td, sym: t.sym, kind, close: t.q.c, pGap: st.pGap, pUp: st.pUp, mOc: st.mOc, n: st.n, src: t.L.src, ts: Date.now() }; const i = preds.findIndex((x) => x.id === id); if (i >= 0) preds[i] = { ...preds[i], ...p }; else preds.unshift(p); add.push(p); };
    all.filter((t) => !isIdx(t.sym) && t.L && t.L.src === 'own' && t.L.best.st.pUp >= 0.55 && t.L.best.st.mOc - C > 0).sort((a, b) => b.L.best.st.mOc - a.L.best.st.mOc).slice(0, 5).forEach((t) => put(t, 'buy'));
    all.filter((t) => t.L && t.L.best && t.L.best.st.pGap >= 0.6 && t.L.best.st.mGap > 0.002).slice(0, 8).forEach((t) => put(t, 'up'));
    all.filter((t) => t.L && t.L.best && t.L.best.st.pGap <= 0.4 && t.L.best.st.mGap < -0.002).slice(0, 8).forEach((t) => put(t, 'dn'));
    if (add.length) savePreds(add);
  }
  function evaluatePreds() {
    if (!H) return; const ch = [];
    preds.forEach((p) => { if (p.done) return; const R = H.rows[p.sym], n = R && R.find((r) => r[0] > p.date); if (!n) return; Object.assign(p, { gap: n[1] / p.close - 1, oc: n[4] / p.close - 1, done: true }); ch.push(p); });
    if (ch.length) savePreds(ch);
  }
  function bookHTML() {
    const op = trades.filter((t) => t.status === 'open'), cl = trades.filter((t) => t.status === 'closed'), w = cl.filter((t) => t.net > 0);
    const net = cl.reduce((s, t) => s + t.net, 0), gw = w.reduce((s, t) => s + t.net, 0), gl = -cl.filter((t) => t.net <= 0).reduce((s, t) => s + t.net, 0);
    let h = `<section class="mk-panel"><div class="ph"><h2>BTST paper account</h2><span class="mut">₹${f0(B().AMOUNT)} per trade · separate from intraday paper trading${Store.cloud ? ' · saved to Firebase' : ' · saved in this browser'}</span></div>
      <div class="lv"><div><small>Closed trades</small><b>${cl.length}</b></div><div><small>Won</small><b>${cl.length ? pc0(w.length / cl.length) : '–'}</b></div><div><small>Net after charges</small><b class="${cls(net)}">${cl.length ? sgn(net) + rs(net) : '–'}</b><small>${gl ? 'profit factor ' + f2(gw / gl) : ''}</small></div></div>`;
    h += op.length ? `<div class="sec">Open overnight positions</div>${op.map((t) => { const q = Q && Q.q && Q.q[t.sym], px = q ? q.c : null, pl = ok(px) ? (px - t.entry) * t.qty : null; return `<div class="pos"><div class="posh"><b>${esc(t.sym)}</b><span class="mut">${t.qty} shares at ${rs(t.entry)} · bought ${esc(String(t.date).replace(/^demo-\d+/, 'today'))}</span></div>
        <div class="lv"><div><small>Now</small><b>${ok(px) ? f2(px) : '–'}</b></div><div><small>P&L (before charges)</small><b class="${cls(pl)}">${ok(pl) ? sgn(pl) + rs(pl) : '–'}</b></div><div><small>Stop / target 1</small><b><span class="down">${f1(t.sl)}</span> / <span class="up">${f1(t.t1)}</span></b></div></div>
        <div class="mut ov-p">Plan: ${t.mode === 'open' ? 'sell at the next open' : 'next trading day: stop or target, else sell by 3:15 PM'}. History said: gap up ${pc0(t.pred.pGap)}, up by close ${pc0(t.pred.pUp)} (${t.pred.n} days).</div>
        <button class="sell" onclick="Overnight.sell('${t.id}')">Sell now</button></div>`; }).join('')}` : '<div class="mut ov-p">No open BTST positions. Take one from the Overnight Edge tab with "Paper BTST".</div>';
    if (cl.length) h += `<div class="sec">Closed</div><div class="tblw"><table><thead><tr><th class="l">Stock</th><th>Buy → sell</th><th>Net</th><th class="l">Exit</th><th>History said (up by close)</th></tr></thead><tbody>${cl.slice(0, 30).map((t) => `<tr><td class="l">${esc(t.sym)}<br><small class="mut">${esc(String(t.date).replace(/^demo-\d+/, 'demo'))}</small></td><td>${f2(t.entry)} → ${f2(t.exit)}</td><td class="${cls(t.net)}">${sgn(t.net)}${rs(t.net)}</td><td class="l">${esc(t.why)}</td><td>${pc0(t.pred && t.pred.pUp)}</td></tr>`).join('')}</tbody></table></div>`;
    h += '</section>';
    // the live record
    const done = preds.filter((p) => p.done), grp = (k, f) => { const a = done.filter((p) => p.kind === k), hit = a.filter(f).length; return { n: a.length, hit, pct: a.length ? hit / a.length : null, exp: a.length ? a.reduce((s, p) => s + (k === 'buy' ? p.pUp : k === 'up' ? p.pGap : 1 - p.pGap), 0) / a.length : null }; };
    const G = [['buy', 'Top BTST buys: closed higher next day', (p) => p.oc > 0], ['up', 'Gap-up watch: opened higher', (p) => p.gap > 0], ['dn', 'Gap-down alerts: opened lower', (p) => p.gap < 0]].map(([k, n, f]) => [n, grp(k, f)]);
    h += `<section class="mk-panel" style="margin-top:12px"><div class="ph"><h2>Live record: what this page said vs what happened</h2></div>
      <div class="tblw"><table><thead><tr><th class="l">List</th><th>Checked</th><th>Came true</th><th>History expected</th></tr></thead><tbody>${G.map(([n, g]) => `<tr><td class="l">${n}</td><td>${g.n}</td><td><b class="${g.pct != null && g.exp != null ? (g.pct >= g.exp - 0.03 ? 'up' : 'down') : ''}">${g.pct == null ? '–' : pc0(g.pct)}</b></td><td>${g.exp == null ? '–' : pc0(g.exp)}</td></tr>`).join('')}</tbody></table></div>
      <div class="legend">Every trading day, when this page is open between 3:00 and 3:30 PM, it saves its lists; the next day's candle checks them. ${done.length < 60 ? `Only ${done.length} checked so far: give it 30–60 trading days before trusting it.` : 'If "came true" stays close to "history expected", the numbers are honest.'}</div></section>`;
    return h;
  }
  function analyze(sym) {
    if (!live()) return toast('Adding stocks works in live mode.');
    const m = H && H.meta && H.meta[sym]; if (!m || !m.key) return;
    close(); addWatch({ id: sym.replace(/[^A-Z0-9&]/g, '').slice(0, 20), label: sym, name: m.name || sym, key: m.key, ukey: m.key, exch: 'NSE', kind: 'EQ', fo: true, lot: m.lot || null, sym });
  }
  async function refresh() { await refreshQuotes(); await checkTrades(); recordPicks(); evaluatePreds(); render(); }

  /* ---------- demo data: made-up history with a built-in habit, so every list has something to show offline ---------- */
  function demoHist() {
    const r = rng(4242), rows = {}, meta = {}, list = [...IDX.map(([s, k, n]) => [s, n, true]), ...['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'LT', 'BEL', 'HAL', 'TATASTEEL', 'TATAMOTORS', 'DIXON', 'LUPIN', 'TRENT', 'INDIGO', 'BPCL', 'ONGC', 'ASIANPAINT', 'HEROMOTOCO', 'PERSISTENT', 'COFORGE', 'POLYCAB', 'SUNPHARMA', 'CIPLA', 'AXISBANK', 'KOTAKBANK', 'BAJFINANCE', 'MARUTI', 'ITC', 'WIPRO'].map((s) => [s, s, false])];
    list.forEach(([sym, name, ix]) => {
      let c = ix ? (sym === 'SENSEX' ? 83000 : sym === 'BANKNIFTY' ? 57000 : 25400) : 200 + r() * 3000, d = Date.UTC(2024, 9, 1), drift = 0; const R = [], vol = ix ? 0.009 : 0.017;
      for (let i = 0; i < 500;) { d += 864e5; const wd = new Date(d).getUTCDay(); if (wd === 0 || wd === 6) continue; i++;
        const o = c * (1 + (r() - 0.5) * vol * 0.6 + drift), cl = o * (1 + (r() - 0.5) * 2 * vol + drift * 0.5), h = Math.max(o, cl) * (1 + r() * vol * 0.4), l = Math.min(o, cl) * (1 - r() * vol * 0.4);
        R.push([new Date(d).toISOString().slice(0, 10), o, h, l, cl, ix ? 0 : Math.round(1e6 * (0.5 + r()))]);
        // demo only: a built-in habit (sharp falls tend to bounce next morning, sharp rises tend to dip) so the lists have something to show
        const ch = cl / c - 1; drift = ch < -vol * 0.6 ? vol * 0.12 : ch > vol * 0.6 ? -vol * 0.1 : 0; c = cl; }
      rows[sym] = R; meta[sym] = { key: '', name, idx: ix, lot: null };
    });
    return { ts: Date.now(), day: 'demo', rows, meta, demo: true };
  }
  function demoQuotes() {
    const q = {}, r = rng(Math.floor(Date.now() / 60000));
    for (const sym in H.rows) { const R = H.rows[sym], L = R[R.length - 1], pc = L[4], idx = isIdx(sym), a = A[sym];
      // demo indices follow the dashboard's demo move today, scaled onto the demo history's last close
      const mv = idx && a && a.PC ? a.price / a.PC - 1 : (r() - 0.5) * 0.05, c = pc * (1 + mv), o = pc * (1 + (r() - 0.5) * 0.01), h = Math.max(o, c) * (1 + r() * 0.008), l = Math.min(o, c) * (1 - r() * 0.008);
      q[sym] = { key: '', o, h, l, c, pc, v: idx ? 0 : L[5] * (0.5 + r() * 1.5) }; }
    return { ts: Date.now(), q };
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $o('ov') && $o('ov').classList.contains('on')) close(); });
  return { open, close, show, download, refresh, buy, sell: (id) => sellNow(id), analyze, mode: (m) => { mode = m; render(); }, get model() { return { H, Q, M, V }; }, scan, revRead };
})();
