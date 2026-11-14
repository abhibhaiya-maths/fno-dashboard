/* ===== Stock Pulse: type a few letters of any F&O stock, get the whole picture in plain words =====
   Positioning (futures buildup, option writers), how the day closed (range, last hour, VWAP), trend, results and how the
   market reacted, news with an authenticity check, broker calls, FII mood, a rule-based verdict with every reason shown,
   a trade plan (trigger / wrong-if / next level) and a Hindi summary that is checked against the data.
   Tabs: One stock · Compare (rank your list) · Market buildup (all F&O stocks, NSE bhavcopy).
   Auto-refresh while open: 9:15:40, 9:30:40, then every 10 minutes until 3:30. */
const Pulse = (() => {
  let tab = 'stock', P = null, busy = false, err = '', BU = null, buErr = '', showEn = false, nextAt = null, timer = null;
  let CMP = null, cmpBusy = false, cmpErr = '', cmpList = null;
  let UNI = null, sugg = [], sel = -1, sugFor = 'stock';
  const $p = (id) => document.getElementById(id);
  const live = () => Source.mode === 'live';
  const pct = (x, d = 2) => (ok(x) ? `${x >= 0 ? '+' : ''}${(+x).toFixed(d)}%` : '–');
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const BNAME = { LB: 'Long buildup', SB: 'Short buildup', SC: 'Short covering', LU: 'Long unwinding' };
  const BHI = { LB: 'Buyers adding fresh positions', SB: 'Sellers adding fresh positions', SC: 'Sellers exiting (covering)', LU: 'Buyers exiting (booking out)' };
  const BTONE = { LB: 'up', SB: 'down', SC: 'up', LU: 'down' };
  const TONE = { 'STRONG CALL': 'up', 'LEANS CALL': 'up', WAIT: 'n', 'LEANS PUT': 'dn', 'STRONG PUT': 'dn' };
  const HEAD = { 'STRONG CALL': '▲▲ Strong CALL side', 'LEANS CALL': '▲ Leans CALL side', WAIT: '⏸ No clear side: WAIT', 'LEANS PUT': '▼ Leans PUT side', 'STRONG PUT': '▼▼ Strong PUT side' };
  const SUB = { 'STRONG CALL': 'Positioning, price and trend agree', 'LEANS CALL': 'More points up than down, but not fully confirmed', WAIT: 'Points cancel out: no edge either way',
    'LEANS PUT': 'More points down than up, but not fully confirmed', 'STRONG PUT': 'Positioning, price and trend agree' };
  const recent = () => Store.pref('pulse_recent', []);
  const saveRecent = (it) => Store.setPref('pulse_recent', [it, ...recent().filter((x) => x.sym !== it.sym)].slice(0, 8));
  const leanOf = (L) => (L.lean in TONE ? L.lean : L.lean === 'CALL' ? 'LEANS CALL' : L.lean === 'PUT' ? 'LEANS PUT' : 'WAIT'); // older Worker

  /* ---------- shell ---------- */
  function build() {
    if ($p('pl')) return;
    const el = document.createElement('div'); el.id = 'pl'; el.className = 'rp pl'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Stock Pulse');
    el.innerHTML = `<div class="rp-top"><h2>Stock Pulse</h2><div class="pl-tabs" role="tablist"><button data-t="stock" onclick="Pulse.show('stock')">One stock</button><button data-t="cmp" onclick="Pulse.show('cmp')">Compare</button><button data-t="mkt" onclick="Pulse.show('mkt')">Market buildup</button></div>
      <span class="mut" id="plNote"></span><button class="x" onclick="Pulse.close()" aria-label="Close">✕</button></div>
      <form class="pl-search" onsubmit="event.preventDefault();Pulse.enter()" autocomplete="off">
        <div class="pl-sbox"><input id="plQ" placeholder="Type 2-3 letters: pay, hal, tata, eich…" autocomplete="off" aria-label="Stock name" role="combobox" aria-expanded="false" aria-controls="plSug" aria-autocomplete="list" spellcheck="false">
        <div class="pl-sug" id="plSug" role="listbox"></div></div>
        <button class="btn-up" type="submit" id="plGo">Check</button></form>
      <div class="pl-chips" id="plChips"></div>
      <div id="plBody"></div>`;
    document.body.appendChild(el);
    const q = $p('plQ');
    q.addEventListener('input', () => suggest(q.value));
    q.addEventListener('focus', () => { loadUni(); if (q.value) suggest(q.value); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!sugg.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length) % sugg.length; drawSug(); }
      else if (e.key === 'Escape') { hideSug(); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.pl-sbox')) hideSug(); });
  }
  function open(sym) { build(); $p('pl').classList.add('on'); document.body.style.overflow = 'hidden'; loadUni(); show(tab); if (sym) find(sym); tick(); clearInterval(timer); timer = setInterval(tick, 20000); }
  function close() { const el = $p('pl'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; clearInterval(timer); timer = null; hideSug(); }
  function show(t) {
    tab = t; document.querySelectorAll('#pl .pl-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    const q = $p('plQ'); if (q) q.placeholder = t === 'cmp' ? 'Add a stock to compare: type 2-3 letters…' : 'Type 2-3 letters: pay, hal, tata, eich…';
    const g = $p('plGo'); if (g) g.textContent = t === 'cmp' ? 'Add' : 'Check';
    if (t === 'mkt' && !BU) loadBuildup();
    if (t === 'cmp' && !cmpList) cmpList = defaultCmp();
    render();
  }

  /* ---------- type-ahead: the F&O list is loaded once a day, matching is instant and costs no Upstox call ---------- */
  async function loadUni() {
    if (UNI) return;
    try { const c = JSON.parse(localStorage.getItem('fno_uni') || 'null'); if (c && c.ts > Date.now() - 864e5 && c.items && c.items.length > 50) { UNI = c.items; return; } } catch (e) { /* private mode */ }
    if (!live()) { try { const r = await Source.search('  '); const it = (r.items || []).filter((x) => x.kind === 'EQ').map((x) => ({ sym: x.sym || x.id, name: x.name, key: x.key, fo: x.fo })); UNI = it.length ? it : null; } catch (e) { UNI = null; } return; }
    try {
      const r = await Source.raw('/api/universe'), items = (r.items || []).map((x) => ({ sym: x.sym, name: x.name, key: x.key, fo: true }));
      if (items.length) { UNI = items; try { localStorage.setItem('fno_uni', JSON.stringify({ ts: Date.now(), items })); } catch (e) { /* full */ } }
    } catch (e) { /* falls back to Upstox search */ }
  }
  const nameKey = (s) => String(s || '').toUpperCase().replace(/LIMITED|LTD\.?|\(.*?\)/g, '').replace(/[^A-Z0-9&]/g, '');
  const ALIAS = { PAYTM: 'PAYTM', POLICYBAZAAR: 'POLICYBZR', PB: 'POLICYBZR', ROYALENFIELD: 'EICHERMOT', ZOMATO: 'ETERNAL', SBI: 'SBIN', HUL: 'HINDUNILVR', 'L&T': 'LT', LNT: 'LT', BAJAJFINANCE: 'BAJFINANCE', MANDM: 'M&M', MAHINDRA: 'M&M', AIRTEL: 'BHARTIARTL', HDFC: 'HDFCBANK', ICICI: 'ICICIBANK', KOTAK: 'KOTAKBANK', TATAMOTORS: 'TMPV', MARUTI: 'MARUTI', NYKAA: 'NYKAA', DMART: 'DMART', JIO: 'JIOFIN' };
  async function suggest(q) {
    const Q = String(q || '').trim().toUpperCase().replace(/\s+/g, '');
    sel = -1; sugFor = tab;
    if (Q.length < 2) { sugg = []; return drawSug(); }
    let list = UNI;
    if (!list) { // demo, or the list could not load: ask the search API (debounced)
      clearTimeout(suggest.t); suggest.t = setTimeout(async () => {
        try { const r = await Source.search(q); sugg = (r.items || []).filter((x) => x.kind === 'EQ').slice(0, 8).map((x) => ({ sym: x.sym || x.id, name: x.name, key: x.key, fo: x.fo })); } catch (e) { sugg = []; }
        if ($p('plQ').value.trim().toUpperCase().replace(/\s+/g, '') === Q) drawSug();
      }, 250);
      return;
    }
    const al = Object.keys(ALIAS).filter((k) => k.startsWith(Q)).map((k) => ALIAS[k]);
    const score = (x) => { const n = nameKey(x.name); return al.includes(x.sym) ? 0 : x.sym === Q ? 1 : x.sym.startsWith(Q) ? 2 : n.startsWith(Q) ? 3 : n.includes(Q) ? 4 : x.sym.includes(Q) ? 5 : 9; };
    sugg = list.map((x) => [score(x), x]).filter((a) => a[0] < 9).sort((a, b) => a[0] - b[0] || a[1].sym.length - b[1].sym.length).slice(0, 8).map((a) => a[1]);
    drawSug();
  }
  function drawSug() {
    const box = $p('plSug'), q = $p('plQ'); if (!box) return;
    const on = sugg.length > 0 && document.activeElement === q;
    q.setAttribute('aria-expanded', String(on));
    box.classList.toggle('on', on);
    box.innerHTML = sugg.map((x, i) => `<button type="button" role="option" aria-selected="${i === sel}" class="${i === sel ? 'sel' : ''}" onmousedown="event.preventDefault()" onclick='Pulse.pick(${i})'><b>${esc(x.sym)}</b><small>${esc(x.name || '')}</small></button>`).join('');
  }
  function hideSug() { sugg = []; sel = -1; const b = $p('plSug'); if (b) { b.classList.remove('on'); b.innerHTML = ''; } const q = $p('plQ'); if (q) q.setAttribute('aria-expanded', 'false'); }
  function pick(i) {
    const x = sugg[i]; if (!x) return; hideSug(); const q = $p('plQ'); if (q) { q.value = ''; q.blur(); }
    const it = { sym: x.sym, key: x.key, name: x.name };
    if (tab === 'cmp') addCmp(it); else load(it);
  }
  function enter() {
    if (sugg.length) return pick(sel >= 0 ? sel : 0);
    const v = $p('plQ').value; if (tab === 'cmp') return findCmp(v); find(v);
  }

  /* ---------- chips ---------- */
  function chips() {
    const box = $p('plChips'); if (!box) return;
    if (tab === 'cmp') { box.innerHTML = ''; return; }
    const w = typeof watchItems === 'function' ? watchItems().filter((x) => x.kind === 'EQ') : [], r = recent();
    const all = [...w.map((x) => ({ sym: x.sym || x.id, key: x.key, name: x.name })), ...r].filter((x, i, a) => x.sym && a.findIndex((y) => y.sym === x.sym) === i).slice(0, 12);
    box.innerHTML = all.length ? all.map((x) => `<button class="chip ${P && P.sym === x.sym ? 'on' : ''}" onclick='Pulse.load(${JSON.stringify({ sym: x.sym, key: x.key, name: x.name })})'>${esc(x.sym)}</button>`).join('') : '<span class="mut">Your watchlist stocks and recent checks show up here.</span>';
  }

  /* ---------- auto refresh: 9:15, 9:30, then every 10 minutes ---------- */
  function schedule() {
    const m = istMin(), d = istNow().getUTCDay(), wk = d > 0 && d < 6;
    if (!wk || m >= 375) return (nextAt = null);
    const slots = [0.67, 15.67]; for (let x = 25; x < 375; x += 10) slots.push(x + 0.67);
    nextAt = slots.find((s) => s > m + istNow().getUTCSeconds() / 60) ?? null;
    return nextAt;
  }
  function tick() {
    if (!$p('pl') || !$p('pl').classList.contains('on')) return;
    const m = istMin() + istNow().getUTCSeconds() / 60;
    if (nextAt != null && m >= nextAt && !document.hidden) {
      if (P && !busy) load({ sym: P.sym, key: P.key, name: P.name }, true);
      if (tab === 'mkt') loadBuildup();
      if (tab === 'cmp' && CMP && !cmpBusy) runCmp(true);
    }
    if (nextAt == null || m >= nextAt) schedule();
    const n = $p('plNote'); if (n) n.textContent = nextAt != null ? `Next auto-update ${hm(Math.floor(nextAt))}` : 'Market closed: auto-update starts 9:15 on the next trading day';
  }

  /* ---------- search and load ---------- */
  async function resolve(q) {
    q = String(q || '').trim(); if (q.length < 2) { toast('Type at least 2 letters of the stock name'); return null; }
    await suggest(q); if (sugg.length) { const x = sugg[0]; hideSug(); return { sym: x.sym, key: x.key, name: x.name }; }
    const r = await Source.search(q), items = (r.items || []).filter((x) => x.kind === 'EQ'), fo = items.filter((x) => x.fo), x = fo[0] || items[0];
    return x ? { sym: x.sym || x.id, key: x.key, name: x.name } : null;
  }
  async function find(q) {
    busy = true; err = ''; render();
    try { const it = await resolve(q); if (!it) { busy = false; err = `No NSE stock found for "${q}". Try the NSE symbol (for example PAYTM, HAL, TATAPOWER).`; return render(); } $p('plQ').value = ''; return load(it); }
    catch (e) { busy = false; err = e.message; render(); }
  }
  async function load(it, auto) {
    if (tab !== 'stock' && !auto) show('stock');
    busy = true; err = ''; if (!auto) { P = null; showEn = false; } render();
    try {
      const mkt = A.NIFTY ? { niftyChg: A.NIFTY.chg } : null;
      P = live() ? await Source.post('/api/pulse', { ...it, mkt }) : demo(it);
      saveRecent({ sym: P.sym, key: P.key, name: P.name });
    } catch (e) { err = /404|Not found/i.test(e.message) && !/find/i.test(e.message) ? 'Deploy the new Worker code: it adds /api/pulse.' : e.message; }
    busy = false; schedule(); render(); tick();
  }
  async function loadBuildup() {
    buErr = ''; render();
    try { BU = live() ? await Source.raw('/api/buildup') : demoBuildup(); } catch (e) { buErr = /404|Not found/i.test(e.message) ? 'Deploy the new Worker code: it adds /api/buildup.' : e.message; }
    render();
  }

  /* ---------- compare ---------- */
  function defaultCmp() {
    const saved = Store.pref('pulse_cmp', null); if (Array.isArray(saved) && saved.length) return saved;
    const w = typeof watchItems === 'function' ? watchItems().filter((x) => x.kind === 'EQ' && x.fo).map((x) => ({ sym: x.sym || x.id, key: x.key, name: x.name })) : [];
    return [...w, ...recent()].filter((x, i, a) => x.sym && a.findIndex((y) => y.sym === x.sym) === i).slice(0, 6);
  }
  const saveCmp = () => Store.setPref('pulse_cmp', cmpList);
  function addCmp(it) {
    cmpList = cmpList || [];
    if (cmpList.some((x) => x.sym === it.sym)) return toast(`${it.sym} is already in the list`);
    if (cmpList.length >= 8) return toast('Up to 8 stocks. Remove one first.');
    cmpList.push(it); saveCmp(); render();
  }
  async function findCmp(q) { try { const it = await resolve(q); if (it) { $p('plQ').value = ''; addCmp(it); } else toast(`No NSE stock found for "${q}"`); } catch (e) { toast(e.message); } }
  function rmCmp(sym) { cmpList = (cmpList || []).filter((x) => x.sym !== sym); saveCmp(); if (CMP) CMP.items = CMP.items.filter((x) => x.sym !== sym); render(); }
  async function runCmp(auto) {
    if (!cmpList || !cmpList.length) return toast('Add stocks to compare first');
    cmpBusy = true; cmpErr = ''; render();
    try {
      const mkt = A.NIFTY ? { niftyChg: A.NIFTY.chg } : null;
      CMP = live() ? await Source.post('/api/compare', { items: cmpList, mkt }) : demoCmp(cmpList);
    } catch (e) { cmpErr = /404|Not found/i.test(e.message) ? 'Deploy the new Worker code: it adds /api/compare.' : e.message; }
    cmpBusy = false; if (!auto) schedule(); render();
  }

  /* ---------- drawing ---------- */
  function render() {
    const b = $p('plBody'); if (!b) return; chips();
    if (tab === 'mkt') { b.innerHTML = renderMkt(); return; }
    if (tab === 'cmp') { b.innerHTML = renderCmp(); return; }
    if (busy && !P) { b.innerHTML = `<div class="pl-wait"><span class="spin"></span>Reading futures, options, news, filings and FII data…</div>`; return; }
    if (err && !P) { b.innerHTML = `<div class="alert d">${esc(err)}</div>`; return; }
    if (!P) { b.innerHTML = intro(); return; }
    b.innerHTML = (busy ? '<div class="pl-wait"><span class="spin"></span>Auto-updating…</div>' : '') + (err ? `<div class="alert d">${esc(err)}</div>` : '') + renderStock(P);
  }
  function intro() {
    return `<div class="pl-intro"><b>Type 2-3 letters of a stock and pick it from the list.</b> In about 5 seconds you get, in one place:
      <ul><li><b>Who is in control</b>: futures long/short buildup (live and NSE's own end-of-day file), where option writers sit, how the day closed, who traded the last hour</li>
      <li><b>Is the news real?</b> Each headline is marked: NSE/BSE filing, results date confirmed on NSE, several trusted outlets, single source, or only a "report"</li>
      <li><b>Results and how the market reacted</b>, broker upgrades/downgrades, trend, FII mood</li>
      <li>A verdict (Strong / Leans CALL, WAIT, Leans / Strong PUT) with every reason, the <b>levels to act on</b>, and a short Hindi summary</li></ul>
      <span class="mut"><b>Compare</b> ranks your own list. While this page is open it refreshes itself at 9:15, 9:30 and every 10 minutes. On weekends it reads Friday's data.</span></div>`;
  }
  const row = (k, v, c) => `<div class="pl-r"><span>${k}</span><b class="${c || ''}">${v}</b></div>`;
  function bCard(title, x) {
    if (!x || !x.b) return `<div class="pl-b n"><small>${title}</small><b>No data</b></div>`;
    const weak = x.clear === false || !(Math.abs(x.doiPct || 0) >= 2 && Math.abs(x.dp || 0) >= 0.5);
    return `<div class="pl-b ${BTONE[x.b]}"><small>${title}</small><b>${BNAME[x.b]}${weak ? ' <em class="pl-weak">weak</em>' : ''}</b><span>${BHI[x.b]}</span><em>Price ${pct(x.dp)} · OI ${pct(x.doiPct)}</em></div>`;
  }
  function planBox(L) {
    const P = L.plan; if (!P) return '';
    if (P.side === 'CALL') return `<div class="pl-plan"><div><small>Confirms above</small><b class="up">${f2(P.trigger)}</b></div><div><small>Wrong if below</small><b class="down">${P.stop ? f2(P.stop) : '–'}</b></div><div><small>Next level</small><b>${P.target ? f2(P.target) : '–'}</b></div></div>`;
    if (P.side === 'PUT') return `<div class="pl-plan"><div><small>Confirms below</small><b class="down">${f2(P.trigger)}</b></div><div><small>Wrong if above</small><b class="up">${P.stop ? f2(P.stop) : '–'}</b></div><div><small>Next level</small><b>${P.target ? f2(P.target) : '–'}</b></div></div>`;
    return `<div class="pl-plan"><div><small>Turns up above</small><b class="up">${P.up ? f2(P.up) : '–'}</b></div><div><small>Turns down below</small><b class="down">${P.dn ? f2(P.dn) : '–'}</b></div><div><small>Until then</small><b>Range</b></div></div>`;
  }
  function renderStock(p) {
    const L = p.lean, lean = leanOf(L), X = p.px, lv = p.lev, F = p.fut, S = p.sess, O = p.opt, R = p.resEv, closed = p.phase === 'closed' || p.phase === 'pre';
    const phaseTxt = { live: 'Live', open15: 'First 15 minutes', pre: 'Pre-open', closed: 'Market closed' }[p.phase];
    const ago = Math.max(0, Math.round((Date.now() - p.ts) / 60000));
    let h = `<div class="pl-head"><div><h3>${esc(p.name)} <span class="mut">${esc(p.sym)}</span></h3>
      <div class="pl-px"><b>${f2(X.price)}</b> <span class="${cls(X.chg)}">${pct(X.chg)}</span> <span class="pill ${p.phase === 'live' ? 'b' : 'n'}">${phaseTxt}${p.liveDay ? '' : `: session ${esc(X.session || '')}`}</span>${p.stale ? ' <span class="pill g">Upstox busy: last saved data</span>' : ''}</div></div>
      <button class="btn-ghost" onclick='Pulse.load(${JSON.stringify({ sym: p.sym, key: p.key, name: p.name })})'>↻ Refresh</button></div>`;
    if (p.ban) h += `<div class="alert d"><b>In the F&O ban list</b>${p.ban.date ? ` (${esc(p.ban.date)})` : ''}: no fresh F&O positions allowed, only closing existing ones.</div>`;
    h += `<div class="pl-verdict ${TONE[lean]}"><div class="pl-v1"><b>${HEAD[lean]}</b><span>${SUB[lean]} · confidence ${L.conf} · score ${L.score > 0 ? '+' : ''}${L.score}</span></div>
      <div class="pl-why">${L.why.map((w) => `<span class="pill ${w.pts > 0 ? 'b' : 's'}">${w.pts > 0 ? '+' : ''}${w.pts} ${esc(w.txt)}</span>`).join('') || '<span class="mut">Nothing strong either way.</span>'}</div>
      ${planBox(L)}
      ${L.warn.map((w) => `<div class="alert">${esc(w)}</div>`).join('')}
      <div class="legend">Points add up to the score: +1.5 or more leans CALL, +3.5 or more is strong (only when futures positioning confirms it and no results or ban are due); the same below zero for PUT. It describes the data, not a forecast or advice. The decision is yours.</div></div>`;
    const sm = p.ai && p.ai.hi ? p.ai : p.rule;
    if (sm && (sm.hi || sm.en)) {
      const txt = showEn ? sm.en || sm.hi : sm.hi || sm.en;
      h += `<div class="pl-ai"><div class="pl-ai-h"><b>In simple words</b><span><button class="btn" onclick="Pulse.lang()">${showEn ? 'हिंदी' : 'English'}</button><button class="btn" onclick="Pulse.speak()">🔊 Listen</button></span></div><div class="pl-ai-t">${esc(txt).replace(/\n/g, '<br>')}</div>
        <div class="legend">${sm.by === 'ai' ? 'Written by AI from the numbers on this page only, and checked against them.' : 'Built directly from the numbers on this page.'}${p.aiNote ? ' ' + esc(p.aiNote) + '.' : ''}</div></div>`;
    }
    // positioning
    h += `<div class="pl-grid">
      <section class="pl-card"><div class="sec">Who is in control? (futures)</div><div class="pl-bs">${F.live ? bCard(`Today, live (${hm(F.live.at)})`, F.live) : ''}${bCard(F.nse ? `Last session, NSE file ${esc(F.nse.date)}` : 'Last session', F.nse || F.last)}</div>
        ${O ? `<div class="sec" style="margin-top:10px">Option writers (${esc(O.expiry || 'near expiry')})</div>${row('Biggest call writing above (resistance)', O.callWall ? f0(O.callWall) : '–', 'down')}${row('Biggest put writing below (support)', O.putWall ? f0(O.putWall) : '–', 'up')}${row('Put-call ratio near the price', f2(O.pcr), O.pcr >= 1.2 ? 'up' : O.pcr <= 0.7 ? 'down' : '')}${row('Added today near the price', `Puts ${O.peAdd >= 0 ? '+' : ''}${f0(O.peAdd)} · Calls ${O.ceAdd >= 0 ? '+' : ''}${f0(O.ceAdd)}`)}` : ''}
        <div class="legend">Long buildup = price up + OI up (fresh buying). Short buildup = price down + OI up (fresh selling). Short covering = price up + OI down (sellers exiting; such rallies fade more often). Long unwinding = price down + OI down. "Weak" = OI changed less than 2% or price less than 0.5%. Option writers are usually the big players: the strike with the most call writing often caps the price, the most put writing often supports it.${F.expiry ? ` Futures expiry ${esc(F.expiry)}${F.lot ? `, lot ${F.lot}` : ''}.` : ''}${!F.live && !closed ? ' Live futures data appears after the first minutes of trading.' : ''}</div></section>
      <section class="pl-card"><div class="sec">How the ${p.liveDay ? 'day is going' : 'last session closed'}</div>
        ${S ? row('VWAP (average price paid)', f2(S.vwap), X.price > S.vwap ? 'up' : 'down') + (ok(S.clv) ? row('Closed at', `${Math.round(S.clv * 100)}% of the day's range ${S.clv >= 0.8 ? '(near the high)' : S.clv <= 0.2 ? '(near the low)' : ''}`, S.clv >= 0.7 ? 'up' : S.clv <= 0.3 ? 'down' : '') : '') + (ok(S.lastHour) ? row('Last hour (after 2:30)', `${pct(S.lastHour)}${ok(S.lastHourVol) ? ` on ${Math.round(S.lastHourVol)}% of the day's volume` : ''}`, cls(S.lastHour)) : '') + row('Day open / high / low', `${f2(S.open)} / ${f2(S.hi)} / ${f2(S.lo)}`) : ok(X.clvDaily) ? row('Closed at', `${Math.round(X.clvDaily * 100)}% of the day's range`) : '<span class="mut">Minute data not available</span>'}
        ${ok(X.gap) ? row('Opening gap', pct(X.gap), cls(X.gap)) : ''}${row('Volume vs 20-day average', ok(X.volX) ? f1(X.volX) + '×' : '–', X.volX >= 1.5 ? 'up' : '')}
        <div class="legend">Closing near the high with buying in the last hour usually means bigger players are holding overnight; closing near the low, the opposite. Above VWAP, the average buyer of the day is in profit.</div></section>
      <section class="pl-card"><div class="sec">Results</div>
        ${R && R.kind === 'past' ? row('Results date', `${esc(R.date)} ${R.src === 'NSE' ? '<span class="pill b">NSE</span>' : '<span class="pill n">news</span>'}`) + row('Price since results', `${pct(R.react)} (${R.sessions} session${R.sessions === 1 ? '' : 's'})`, cls(R.react)) : ''}
        ${R && R.kind === 'next' ? row('Results due', `${esc(R.date)} (in ${R.inDays} day${R.inDays === 1 ? '' : 's'})`, 'down') : ''}
        ${R && R.nums ? row('Profit / revenue (YoY)', `${pct(R.nums.pat, 0)} / ${pct(R.nums.rev, 0)}`, cls(R.nums.pat)) + `<div class="legend">As reported by ${esc(R.nums.src || 'news')}${R.nums.q ? ', ' + esc(R.nums.q) : ''}.</div>` : ''}
        ${!R ? '<span class="mut">No results in the last 2 weeks or the next 10 days.</span>' : ''}
        ${(p.brokers || []).length ? `<div class="sec" style="margin-top:10px">Broker calls (7 days)</div>${p.brokers.map((b) => `<div class="pl-n"><span class="pill ${b.kind === 'up' ? 'b' : 's'}">${b.kind === 'up' ? 'Upgrade' : 'Downgrade'}</span><div>${b.link ? `<a href="${esc(b.link)}" target="_blank" rel="noopener">${esc(b.t)}</a>` : esc(b.t)}<small class="mut">${esc(b.src || '')} · ${agoT(b.ts)}</small></div></div>`).join('')}` : ''}
        <div class="legend">After results, how the price reacts matters more than the numbers themselves. Before results, option premiums are inflated and fall sharply after.</div></section>
      <section class="pl-card"><div class="sec">Trend and levels</div>
        ${row('1 week / 1 month', `${pct(X.r1w, 1)} / ${pct(X.r1m, 1)}`, cls(X.r1w))}${row('3 months / 1 year', `${pct(X.r3m, 1)} / ${pct(X.r1y, 1)}`, cls(X.r3m))}
        ${row('20 / 50 / 200-day average', `${f0(X.dma20)} / ${f0(X.dma50)} / ${f0(X.dma200)}`)}${row('RSI (14 days)', ok(X.rsi) ? f1(X.rsi) + (X.rsi >= 70 ? ' overbought' : X.rsi <= 30 ? ' oversold' : '') : '–', X.rsi >= 70 ? 'down' : X.rsi <= 30 ? 'up' : '')}
        ${row('52-week high / low', `${f0(X.hi52)} / ${f0(X.lo52)}`)}
        ${lv ? row(`Previous high / low / close (${esc(lv.from)})`, `${f2(lv.pdh)} / ${f2(lv.pdl)} / ${f2(lv.pdc)}`) + row('Pivot / R1 / S1', `${f2(lv.p)} / <span class="up">${f2(lv.r1)}</span> / <span class="down">${f2(lv.s1)}</span>`) : ''}
        ${row('Nifty', A.NIFTY ? pct(A.NIFTY.chg) : '–', A.NIFTY ? cls(A.NIFTY.chg) : '')}
        ${p.fii ? row(`FII index futures (${esc(p.fii.date)})`, `${f0(p.fii.longPct)}% long, ${ok(p.fii.netChg) ? `${p.fii.netChg > 0 ? '+' : ''}${f0(p.fii.netChg)} net` : ''}`, p.fii.longPct >= 50 ? 'up' : 'down') : ''}</section></div>`;
    const N = p.news, BADGE = { official: ['b', '✓ NSE/BSE filing'], results: ['b', '✓ Results (date on NSE)'], confirmed: ['b', '✓ Several trusted outlets'], single: ['n', 'Single source'], report: ['g', '⚠ Report, not confirmed'] };
    h += `<section class="pl-card pl-news"><div class="sec">News check (last 7 days)</div>${N.items.length ? N.items.map((n) => `<div class="pl-n"><span class="pill ${(BADGE[n.status] || BADGE.single)[0]}">${(BADGE[n.status] || BADGE.single)[1]}</span><div><a href="${esc(n.link || '#')}" target="_blank" rel="noopener">${esc(n.t)}</a><small class="mut">${esc((n.pubs || []).slice(0, 3).join(', '))}${(n.pubs || []).length > 3 ? ` +${n.pubs.length - 3}` : ''} · ${agoT(n.ts)}${ok(n.s) && Math.abs(n.s) >= 0.15 ? ` · <span class="${cls(n.s)}">${n.s > 0 ? 'positive' : 'negative'}</span>` : ''}</small></div></div>`).join('') : '<div class="mut">No company news from trusted outlets this week.</div>'}
      ${N.official.length ? `<div class="sec">Official filings (NSE / BSE)</div>${N.official.map((o) => `<div class="pl-n"><span class="pill b">Filing</span><div>${o.link ? `<a href="${esc(o.link)}" target="_blank" rel="noopener">${esc(o.t)}</a>` : esc(o.t)}<small class="mut">${esc(o.src)} · ${agoT(o.ts)}</small></div></div>`).join('')}` : ''}
      ${p.results && p.results.length ? `<div class="sec">Results headlines</div>${p.results.map((r) => `<div class="pl-n"><span class="pill ${r.s > 0.15 ? 'b' : r.s < -0.15 ? 's' : 'n'}">${esc(r.q || 'Results')}</span><div>${esc(r.t)}<small class="mut">${esc(r.src || '')} · ${agoT(r.ts)}</small></div></div>`).join('')}` : ''}
      <div class="legend">"Report, not confirmed" = the headline uses words like reportedly, sources, may, likely, in talks, and no exchange filing backs it. Such news can reverse fast. "Results (date on NSE)" = the results date is confirmed on NSE; the figures are as reported by the outlet.</div></section>
      <div class="legend">Updated ${ago ? ago + ' min ago' : 'just now'}. For analysis and practice only, not investment advice.</div>`;
    return h;
  }
  function agoT(ts) { if (!ts) return ''; const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; }
  function renderCmp() {
    const L = cmpList || [];
    let h = `<div class="pl-cmpbar">${L.map((x) => `<span class="chip on">${esc(x.sym)} <button aria-label="Remove ${esc(x.sym)}" onclick="Pulse.rmCmp('${esc(x.sym)}')">✕</button></span>`).join('') || '<span class="mut">Add up to 8 stocks with the box above (type 2-3 letters).</span>'}
      <button class="btn-up" onclick="Pulse.runCmp()" ${L.length ? '' : 'disabled'}>${cmpBusy ? 'Comparing…' : CMP ? '↻ Compare again' : 'Compare'}</button></div>`;
    if (cmpErr) h += `<div class="alert d">${esc(cmpErr)}</div>`;
    if (cmpBusy && !CMP) return h + '<div class="pl-wait"><span class="spin"></span>Reading each stock (about 3 seconds per 3 stocks)…</div>';
    if (!CMP) return h + '<div class="pl-intro">Ranks your list from the clearest signal to the weakest, using the same rules as the single-stock view, so you can see at a glance which one has the strongest data and why. Tap a row for the full pulse.</div>';
    const items = CMP.items || [];
    h += `<div class="pl-cmp">${items.map((x, i) => x.err ? `<div class="pl-crow e"><span class="pl-rank">–</span><div><b>${esc(x.sym)}</b><small class="mut">${esc(x.err)}</small></div></div>` : `
      <div class="pl-crow ${TONE[leanOf(x)]}" onclick='Pulse.load(${JSON.stringify({ sym: x.sym, key: x.key, name: x.name })})' role="button" tabindex="0">
        <span class="pl-rank">${i + 1}</span>
        <div class="pl-cmain"><div class="pl-ct"><b>${esc(x.sym)}</b> <span class="mut">${f2(x.price)}</span> <span class="${cls(x.chg)}">${pct(x.chg)}</span>${x.ban ? ' <span class="pill s">F&O ban</span>' : ''}</div>
          <div class="pl-cv"><b>${HEAD[leanOf(x)]}</b> <span class="mut">${x.conf} · ${x.score > 0 ? '+' : ''}${x.score}${x.fut ? ' · ' + BNAME[x.fut] : ''}</span></div>
          <div class="pl-why">${(x.why || []).map((w) => `<span class="pill ${w.pts > 0 ? 'b' : 's'}">${w.pts > 0 ? '+' : ''}${w.pts} ${esc(w.txt)}</span>`).join('')}</div>
          ${x.risk ? `<div class="pl-crisk">Biggest risk: ${esc(x.risk)}</div>` : ''}
          ${x.plan && x.plan.side !== 'WAIT' && x.plan.trigger ? `<div class="mut pl-cplan">${x.plan.side === 'CALL' ? `Confirms above ${f2(x.plan.trigger)}${x.plan.stop ? `, wrong below ${f2(x.plan.stop)}` : ''}` : `Confirms below ${f2(x.plan.trigger)}${x.plan.stop ? `, wrong above ${f2(x.plan.stop)}` : ''}`}</div>` : x.plan && (x.plan.up || x.plan.dn) ? `<div class="mut pl-cplan">Up above ${f2(x.plan.up)}, down below ${f2(x.plan.dn)}</div>` : ''}
        </div></div>`).join('')}</div>
      <div class="legend">Sorted by the size of the score, up or down. Same rules as the single-stock view (no AI), so the ranking is consistent. Updated ${agoT(CMP.ts)}. Not investment advice.</div>`;
    return h;
  }
  function renderMkt() {
    if (buErr) return `<div class="alert d">${esc(buErr)}</div>`;
    if (!BU) return '<div class="pl-wait"><span class="spin"></span>Reading NSE\'s F&O file…</div>';
    const F = typeof fiiPositions === 'function' ? fiiPositions() : null, C = BU.counts, tot = C.LB + C.SB + C.SC + C.LU || 1;
    const mood = C.SB + C.LU > (C.LB + C.SC) * 1.5 ? ['dn', 'More stocks saw selling than buying'] : C.LB + C.SC > (C.SB + C.LU) * 1.5 ? ['up', 'More stocks saw buying than selling'] : ['n', 'Buying and selling fairly balanced'];
    return `<div class="pl-verdict ${mood[0]}"><div class="pl-v1"><b>${mood[1]}</b><span>Session ${esc(BU.date)} · ${esc(BU.src)}</span></div>
      <div class="pl-bar">${['LB', 'SC', 'LU', 'SB'].map((k) => `<i class="${k}" style="width:${(C[k] / tot) * 100}%" title="${BNAME[k]}: ${C[k]}"></i>`).join('')}</div>
      <div class="pl-why">${['LB', 'SB', 'SC', 'LU'].map((k) => `<span class="pill ${BTONE[k] === 'up' ? 'b' : 's'}">${BNAME[k]}: ${C[k]}</span>`).join('')}${(BU.index || []).map((x) => `<span class="pill n">${esc(x.sym)}: ${BNAME[x.b]} (OI ${pct(x.doiPct, 1)})</span>`).join('')}</div>
      ${F ? `<div class="legend">FII index futures ${esc(F.date || '')}: ${f0(F.longPct)}% long (${esc(F.read)}).</div>` : ''}</div>
      <div class="pl-cols">${['LB', 'SB', 'SC', 'LU'].map((k) => `<section class="pl-card"><div class="sec ${BTONE[k]}">${BNAME[k]}</div><div class="mut" style="font-size:12px">${BHI[k]}</div>
        <table class="pl-t"><thead><tr><th class="l">Stock</th><th>Price</th><th>OI</th></tr></thead><tbody>${(BU.lists[k] || []).map((x) => `<tr onclick='Pulse.fromList(${JSON.stringify(x.sym)})' title="Open the full pulse for ${esc(x.sym)}"><td class="l"><b>${esc(x.sym)}</b>${x.clear ? '' : ' <small class="mut">weak</small>'}</td><td class="${cls(x.dp)}">${pct(x.dp, 1)}</td><td>${pct(x.doiPct, 1)}</td></tr>`).join('') || '<tr><td colspan="3" class="mut">None</td></tr>'}</tbody></table></section>`).join('')}</div>
      <div class="legend">Sorted by how much fresh positions changed, weighted by how much price moved, so "OI up 13% but price +0.2%" ranks lower and is marked weak. Tap a stock for its full pulse. NSE publishes this file each evening, so during market hours it shows the previous session; the live buildup for one stock is on its own pulse.</div>`;
  }
  function fromList(sym) { const u = (UNI || []).find((x) => x.sym === sym); load(u ? { sym, key: u.key, name: u.name } : { sym }); }
  function lang() { showEn = !showEn; render(); }
  function speak() { const sm = P && (P.ai && P.ai.hi ? P.ai : P.rule); if (sm && sm.hi) Voice.say(sm.hi.replace(/\n/g, '। ')); else toast('No Hindi summary to read'); }

  /* ---------- demo data (?demo=1) ---------- */
  function demo(it) {
    const sym = (it.sym || 'DEMO').toUpperCase(), now = Date.now();
    const f = { v: 2, ts: now, sym, name: it.name || sym, key: it.key || '', phase: 'closed', liveDay: false,
      px: { price: 7650, chg: 1.34, prevClose: 7549, session: '2026-11-13', r1w: -0.3, r1m: 8.0, r3m: -5.6, r1y: 11.3, dma20: 7375, dma50: 7358, dma200: 7403, rsi: 61.6, hi52: 7900, lo52: 4600, volX: 1.2 },
      lev: { from: '2026-11-13', pdh: 7654, pdl: 7420, pdc: 7650, p: 7574.7, r1: 7678.3, s1: 7437.3 },
      sess: { date: '2026-11-13', open: 7549, hi: 7654, lo: 7420, close: 7650, vwap: 7608, clv: 0.98, lastHour: 0.62, lastHourVol: 26, complete: true },
      fut: { nse: { date: '2026-11-13', b: 'SC', dp: 1.91, doiPct: -1.41, clear: false }, expiry: '2026-11-24', lot: 175 },
      opt: { expiry: '2026-11-24', pcr: 1.12, callWall: 7700, putWall: 7500, ceAdd: 21000, peAdd: 64000 },
      fii: { date: '2026-11-13', longPct: 34.6, netChg: -6201 },
      resEv: { kind: 'past', date: '2026-11-13', src: 'NSE', react: 1.34, sessions: 1, nums: { q: 'Q2 FY27', pat: 15, rev: 12, src: 'Business Standard' } },
      brokers: [{ t: 'Eicher Motors: brokerage raises target after Q2 (demo)', kind: 'up', src: 'Moneycontrol', ts: now - 864e5 }],
      news: { items: [{ t: 'Eicher Motors Q2: net profit rises 15%, revenue at record high (demo)', pubs: ['Business Standard'], ts: now - 1.2 * 864e5, s: 0.6, status: 'results' },
        { t: 'Royal Enfield sales jump in October (demo)', pubs: ['Autocar India'], ts: now - 2 * 864e5, s: 0.4, status: 'single' }], official: [] }, results: [], ban: null };
    f.lean = { lean: 'LEANS CALL', side: 'CALL', label: 'Leans CALL side', conf: 'medium', score: 3.8, verified: 1,
      why: [{ pts: 1, txt: 'Price above the 20-day and 50-day averages (uptrend)' }, { pts: 0.5, txt: 'Futures short covering (last session, NSE 2026-11-13: price +1.91%, OI -1.41%), weak' },
        { pts: 0.5, txt: "Closed near the day's high (top 2% of the range)" }, { pts: 0.5, txt: 'Buying in the last hour (+0.62% after 2:30, 26% of the day\'s volume)' },
        { pts: 0.5, txt: "Closed above the day's VWAP 7608 (average price paid)" }, { pts: 0.5, txt: 'Stronger than Nifty by 2.0%' }, { pts: 0.5, txt: 'Broker upgrade / target raised (Moneycontrol)' }, { pts: -0.5, txt: 'Nifty down 0.61%' }],
      warn: ['The rise is partly short covering (sellers exiting, not fresh buyers): such moves fade more often unless fresh longs join', 'Heavy call writing at 7700, just above the price: expect resistance there',
        'Not marked strong: futures positioning does not clearly confirm the move', 'Market closed: this reads the last session. It refreshes at 9:15 and 9:30'],
      plan: { side: 'CALL', trigger: 7678.3, stop: 7608, target: 7700 } };
    f.rule = { by: 'rules', hi: 'ये पिछले सत्र (2026-11-13) का डेटा है, सुबह 9:30 के बाद दोबारा देखें।\nफ्यूचर्स में बेचने वाले अपनी पोज़िशन काट रहे हैं (शॉर्ट कवरिंग), पर ये संकेत कमज़ोर है: भाव +1.91%, OI -1.41%।\nदिन का अंत मज़बूत रहा: भाव ऊपरी हिस्से में या VWAP के ऊपर।\nनतीजे 2026-11-13 को आए (तारीख़ NSE से पक्की); तब से भाव +1.34%, मुनाफ़ा सालाना +15% (ख़बरों के मुताबिक़)।\nलंबा रुझान ऊपर की तरफ़ है।\nऊपर 7,678 पार हो तो तेज़ी पक्की होती है, अगला पड़ाव 7,700; 7,608 के नीचे आए तो ये सोच ग़लत।\nसबसे बड़ा जोखिम: ये तेज़ी कुछ हद तक शॉर्ट कवरिंग से है; नए खरीदार न जुड़े तो कम टिकती है।\nकुल मिलाकर: डेटा कॉल की तरफ़ झुका है, पर पक्का नहीं। फ़ैसला आपका है। (डेमो)',
      en: 'This is last-session data (2026-11-13); recheck after 9:30.\nIn futures, sellers are cutting positions (short covering), but the signal is weak: price +1.91%, OI -1.41%.\nThe day ended strong: price in the upper part of the range or above VWAP.\nResults came on 2026-11-13 (date confirmed on NSE); price +1.34% since, profit +15% YoY (as reported).\nThe bigger trend points up.\nAbove 7,678 the rise is confirmed, next stop 7,700; below 7,608 the view is wrong.\nBiggest risk: the rise is partly short covering; it fades more often unless fresh buyers join.\nOverall: Leans CALL side. The decision is yours. (demo)' };
    f.ai = null;
    return f;
  }
  function demoCmp(list) {
    const D = { EICHERMOT: ['LEANS CALL', 3.8, 'medium', 'SC'], POLICYBZR: ['STRONG CALL', 4.4, 'high', 'LB'], PAYTM: ['LEANS CALL', 1.9, 'low', 'LB'], ABB: ['WAIT', 0.8, 'low', 'LB'], TATAPOWER: ['LEANS PUT', -3.1, 'medium', 'SB'], HAL: ['WAIT', -0.4, 'low', 'LU'] };
    return { ts: Date.now(), phase: 'closed', items: list.map((x, i) => { const d = D[x.sym] || [['LEANS CALL', 'WAIT', 'LEANS PUT'][i % 3], [2.1, 0.3, -2.0][i % 3], 'low', ['LB', 'SC', 'SB'][i % 3]];
      return { sym: x.sym, name: x.name, key: x.key, price: 1000 + i * 137, chg: d[1] / 2, lean: d[0], conf: d[2], score: d[1], fut: d[3], why: [{ pts: d[1] > 0 ? 2 : -2, txt: `Futures ${BNAME[d[3]].toLowerCase()} (demo)` }, { pts: d[1] > 0 ? 1 : -1, txt: 'Trend (demo)' }],
        risk: d[3] === 'SC' ? 'The rise is partly short covering (demo)' : null, plan: { side: d[1] >= 1.5 ? 'CALL' : d[1] <= -1.5 ? 'PUT' : 'WAIT', trigger: 1010 + i * 137, stop: 990 + i * 137, up: 1010 + i * 137, dn: 990 + i * 137 } }; })
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score)) };
  }
  function demoBuildup() {
    const L = (a) => a.map(([sym, dp, doiPct]) => ({ sym, dp, doiPct, clear: Math.abs(dp) >= 0.5 && Math.abs(doiPct) >= 2 }));
    return { date: '2026-11-13 (demo)', src: 'NSE F&O bhavcopy (demo)', counts: { LB: 38, SB: 130, SC: 15, LU: 38 },
      lists: { LB: L([['POLICYBZR', 5.19, 10.85], ['ENRIN', 3.97, 8.75], ['MFSL', 2.35, 7.22], ['ANGELONE', 1.87, 7.63], ['ABB', 1.76, 7.18], ['VMM', 0.46, 12.96]]),
        SB: L([['GRASIM', -2.97, 8.51], ['ALKEM', -3.7, 5.28], ['BOSCHLTD', -1.87, 5.44], ['POLYCAB', -1.53, 5.42], ['CHOLAFIN', -0.73, 7.2], ['PAGEIND', -0.57, 22.31]]),
        SC: L([['AMBER', 9.92, -8.91], ['GVT&D', 6.05, -0.86], ['EICHERMOT', 1.91, -1.41], ['BLUESTARCO', 0.91, -4.65]]),
        LU: L([['COROMANDEL', -2.29, -5.92], ['KALYANKJIL', -2.32, -5.06], ['KAYNES', -2.58, -2.26], ['BDL', -1.49, -3.11]]) },
      index: [{ sym: 'BANKNIFTY', b: 'LU', doiPct: -6.53 }] };
  }
  return { open, close, show, find, load, fromList, lang, speak, pick, enter, runCmp, rmCmp };
})();
