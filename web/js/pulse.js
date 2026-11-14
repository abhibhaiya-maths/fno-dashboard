/* ===== Stock Pulse: type a stock, get the whole picture in plain words =====
   Buyers or sellers (futures buildup, live and last session), trend, levels to watch, FII mood, news with an
   authenticity check, results, a rule-based CALL / PUT / WAIT lean and a Hindi summary.
   Market-wide tab: long / short buildup, short covering, long unwinding for every F&O stock (NSE bhavcopy).
   Auto-refresh while open: 9:15:40, 9:30:40, then every 10 minutes until 3:30. Nothing to type in by hand. */
const Pulse = (() => {
  let tab = 'stock', P = null, busy = false, err = '', BU = null, buErr = '', showEn = false, nextAt = null, timer = null;
  let picks = [], pickQ = '';
  const $p = (id) => document.getElementById(id);
  const live = () => Source.mode === 'live';
  const pct = (x, d = 2) => (ok(x) ? `${x >= 0 ? '+' : ''}${(+x).toFixed(d)}%` : '–');
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const BNAME = { LB: 'Long buildup', SB: 'Short buildup', SC: 'Short covering', LU: 'Long unwinding' };
  const BHI = { LB: 'Buyers adding fresh positions', SB: 'Sellers adding fresh positions', SC: 'Sellers running away (covering)', LU: 'Buyers booking out' };
  const BTONE = { LB: 'up', SB: 'down', SC: 'up', LU: 'down' };
  const recent = () => Store.pref('pulse_recent', []);
  const saveRecent = (it) => Store.setPref('pulse_recent', [it, ...recent().filter((x) => x.sym !== it.sym)].slice(0, 8));

  /* ---------- shell ---------- */
  function build() {
    if ($p('pl')) return;
    const el = document.createElement('div'); el.id = 'pl'; el.className = 'rp pl'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Stock Pulse');
    el.innerHTML = `<div class="rp-top"><h2>Stock Pulse</h2><div class="pl-tabs" role="tablist"><button data-t="stock" onclick="Pulse.show('stock')">One stock</button><button data-t="mkt" onclick="Pulse.show('mkt')">Market buildup</button></div>
      <span class="mut" id="plNote"></span><button class="x" onclick="Pulse.close()" aria-label="Close">✕</button></div>
      <form class="pl-search" onsubmit="event.preventDefault();Pulse.find($('plQ').value)">
        <input id="plQ" placeholder="Type any F&O stock: Paytm, HAL, Tata Power, Policybazaar…" autocomplete="off" aria-label="Stock name">
        <button class="btn-up" type="submit">Check</button></form>
      <div class="pl-chips" id="plChips"></div>
      <div id="plBody"></div>`;
    document.body.appendChild(el);
  }
  function open(sym) { build(); $p('pl').classList.add('on'); document.body.style.overflow = 'hidden'; show(tab); if (sym) find(sym); tick(); clearInterval(timer); timer = setInterval(tick, 20000); }
  function close() { const el = $p('pl'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; clearInterval(timer); timer = null; }
  function show(t) {
    tab = t; document.querySelectorAll('#pl .pl-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    if (t === 'mkt' && !BU) loadBuildup();
    render();
  }
  function chips() {
    const w = typeof watchItems === 'function' ? watchItems().filter((x) => x.kind === 'EQ') : [], r = recent();
    const all = [...w.map((x) => ({ sym: x.sym || x.id, key: x.key, name: x.name })), ...r].filter((x, i, a) => x.sym && a.findIndex((y) => y.sym === x.sym) === i).slice(0, 12);
    $p('plChips').innerHTML = all.length ? all.map((x) => `<button class="chip ${P && P.sym === x.sym ? 'on' : ''}" onclick='Pulse.load(${JSON.stringify({ sym: x.sym, key: x.key, name: x.name })})'>${esc(x.sym)}</button>`).join('') : '<span class="mut">Your watchlist stocks and recent checks show up here.</span>';
  }

  /* ---------- auto refresh: 9:15, 9:30, then every 10 minutes ---------- */
  function schedule() {
    const m = istMin(), d = istNow().getUTCDay(), wk = d > 0 && d < 6, at = (min) => min;
    if (!wk || m >= 375) return (nextAt = null);
    const slots = [0.67, 15.67]; for (let x = 25; x < 375; x += 10) slots.push(x + 0.67);
    nextAt = slots.find((s) => s > m + (istNow().getUTCSeconds() / 60)) ?? null;
    return at(nextAt);
  }
  function tick() {
    if (!$p('pl') || !$p('pl').classList.contains('on')) return;
    const m = istMin() + istNow().getUTCSeconds() / 60;
    if (P && nextAt != null && m >= nextAt && !busy && !document.hidden) { load({ sym: P.sym, key: P.key, name: P.name }, true); if (tab === 'mkt') loadBuildup(); }
    if (nextAt == null || m >= nextAt) schedule();
    const n = $p('plNote'); if (n) n.textContent = nextAt != null && P ? `Next auto-update ${hm(Math.floor(nextAt))}` : P ? 'Market closed: auto-update starts 9:15 on the next trading day' : '';
  }

  /* ---------- search and load ---------- */
  async function find(q) {
    q = String(q || '').trim(); if (q.length < 2) return toast('Type at least 2 letters of the stock name');
    busy = true; err = ''; picks = []; pickQ = q; render();
    try {
      const r = await Source.search(q), items = (r.items || []).filter((x) => x.kind === 'EQ');
      const Q = q.toUpperCase().replace(/\s+/g, ''), exact = items.find((x) => x.id === Q || (x.sym || '').toUpperCase() === Q);
      const fo = items.filter((x) => x.fo);
      if (exact) return load({ sym: exact.sym || exact.id, key: exact.key, name: exact.name });
      if (fo.length === 1 || (fo.length && items.length === 1)) return load({ sym: fo[0].sym || fo[0].id, key: fo[0].key, name: fo[0].name });
      picks = (fo.length ? fo : items).slice(0, 8); busy = false;
      if (!picks.length) err = `No NSE stock found for "${q}". Try the NSE symbol (for example PAYTM, HAL, TATAPOWER).`;
      render();
    } catch (e) { busy = false; err = e.message; render(); }
  }
  async function load(it, auto) {
    busy = true; err = ''; picks = []; if (!auto) { P = null; showEn = false; } render();
    try {
      const mkt = A.NIFTY ? { niftyChg: A.NIFTY.chg } : null;
      P = live() ? await Source.post('/api/pulse', { ...it, mkt }) : demo(it);
      saveRecent({ sym: P.sym, key: P.key, name: P.name });
      if ($p('plQ') && !auto) $p('plQ').value = '';
    } catch (e) { err = /404|Not found/i.test(e.message) && !/find/i.test(e.message) ? 'Deploy the new Worker code: it adds /api/pulse.' : e.message; }
    busy = false; schedule(); render(); tick();
  }
  async function loadBuildup() {
    buErr = ''; render();
    try { BU = live() ? await Source.raw('/api/buildup') : demoBuildup(); } catch (e) { buErr = /404|Not found/i.test(e.message) ? 'Deploy the new Worker code: it adds /api/buildup.' : e.message; }
    render();
  }

  /* ---------- drawing ---------- */
  function render() {
    const b = $p('plBody'); if (!b) return; chips();
    if (tab === 'mkt') { b.innerHTML = renderMkt(); return; }
    if (busy) { b.innerHTML = `<div class="pl-wait"><span class="spin"></span>Reading futures, news, filings and FII data${P ? ' (auto-update)' : ''}…</div>`; if (!P) return; }
    if (picks.length) { b.innerHTML = `<div class="sec">Which one did you mean by "${esc(pickQ)}"?</div><div class="pl-picks">${picks.map((x) => `<button onclick='Pulse.load(${JSON.stringify({ sym: x.sym || x.id, key: x.key, name: x.name })})'><b>${esc(x.sym || x.id)}</b><small>${esc(x.name || '')}${x.fo ? ' · F&O' : ' · no F&O'}</small></button>`).join('')}</div>`; return; }
    if (err && !P) { b.innerHTML = `<div class="alert d">${esc(err)}</div>`; return; }
    if (!P) { b.innerHTML = intro(); return; }
    b.innerHTML = (err ? `<div class="alert d">${esc(err)}</div>` : '') + renderStock(P);
  }
  function intro() {
    return `<div class="pl-intro"><b>Type a stock and press Check.</b> In about 5 seconds you get, in one place:
      <ul><li><b>Buyers or sellers</b>: futures long/short buildup, live and for the last session (NSE's own end-of-day file)</li>
      <li><b>Is the news real?</b> Each headline is marked: NSE/BSE filing found, confirmed by several trusted outlets, single source, or only a "report"</li>
      <li><b>Trend, levels and FII mood</b>, then a CALL / PUT / WAIT lean with every reason shown, and a short Hindi summary</li></ul>
      <span class="mut">While this page is open it refreshes itself at 9:15, 9:30 and every 10 minutes after that. On weekends it reads Friday's data.</span></div>`;
  }
  const row = (k, v, c) => `<div class="pl-r"><span>${k}</span><b class="${c || ''}">${v}</b></div>`;
  function bCard(title, x) {
    if (!x || !x.b) return `<div class="pl-b n"><small>${title}</small><b>No data</b></div>`;
    return `<div class="pl-b ${BTONE[x.b]}"><small>${title}</small><b>${BNAME[x.b]}</b><span>${BHI[x.b]}</span><em>Price ${pct(x.dp)} · OI ${pct(x.doiPct)}</em></div>`;
  }
  function renderStock(p) {
    const L = p.lean, X = p.px, lv = p.lev, F = p.fut, closed = p.phase === 'closed' || p.phase === 'pre';
    const tone = L.lean === 'CALL' ? 'up' : L.lean === 'PUT' ? 'dn' : 'n';
    const head = L.lean === 'CALL' ? '▲ Data leans CALL side' : L.lean === 'PUT' ? '▼ Data leans PUT side' : '⏸ No clear side: WAIT';
    const phaseTxt = { live: 'Live', open15: 'First 15 minutes', pre: 'Pre-open', closed: 'Market closed' }[p.phase];
    const ago = Math.max(0, Math.round((Date.now() - p.ts) / 60000));
    let h = `<div class="pl-head"><div><h3>${esc(p.name)} <span class="mut">${esc(p.sym)}</span></h3>
      <div class="pl-px"><b>${f2(X.price)}</b> <span class="${cls(X.chg)}">${pct(X.chg)}</span> <span class="pill ${p.phase === 'live' ? 'b' : 'n'}">${phaseTxt}${p.liveDay ? '' : `: session ${esc(X.session || '')}`}</span>${p.stale ? ' <span class="pill g">Upstox busy: last saved data</span>' : ''}</div></div>
      <button class="btn-ghost" onclick='Pulse.load(${JSON.stringify({ sym: p.sym, key: p.key, name: p.name })})'>↻ Refresh</button></div>`;
    h += `<div class="pl-verdict ${tone}"><div class="pl-v1"><b>${head}</b><span>Confidence: ${L.conf} · score ${L.score > 0 ? '+' : ''}${L.score}</span></div>
      <div class="pl-why">${L.why.map((w) => `<span class="pill ${w.pts > 0 ? 'b' : 's'}">${w.pts > 0 ? '+' : ''}${w.pts} ${esc(w.txt)}</span>`).join('') || '<span class="mut">Nothing strong either way.</span>'}</div>
      ${L.warn.map((w) => `<div class="alert">${esc(w)}</div>`).join('')}
      <div class="legend">The lean adds up the points above (CALL side at +2.5 or more, PUT side at −2.5 or less). It describes the data; it is not a forecast or advice. The decision is yours.</div></div>`;
    if (p.ai && (p.ai.hi || p.ai.en)) {
      const txt = showEn ? p.ai.en || p.ai.hi : p.ai.hi || p.ai.en;
      h += `<div class="pl-ai"><div class="pl-ai-h"><b>In simple words</b><span><button class="btn" onclick="Pulse.lang()">${showEn ? 'हिंदी' : 'English'}</button><button class="btn" onclick="Pulse.speak()">🔊 Listen</button></span></div><div class="pl-ai-t">${esc(txt).replace(/\n/g, '<br>')}</div><div class="legend">Written by AI from the numbers on this page only.</div></div>`;
    } else if (p.ai && p.ai.err) h += `<div class="alert i">AI summary unavailable right now (${esc(p.ai.err)}). All the data below is still live.</div>`;
    h += `<div class="pl-grid">
      <section class="pl-card"><div class="sec">Buyers or sellers? (futures)</div><div class="pl-bs">${F.live ? bCard(`Today, live (${hm(F.live.at)})`, F.live) : ''}${bCard(F.nse ? `Last session, NSE file ${esc(F.nse.date)}` : 'Last session', F.nse || F.last)}</div>
        <div class="legend">Long buildup = price up + open interest up (fresh buying). Short buildup = price down + OI up (fresh selling). Short covering = price up + OI down (sellers exiting; such rallies fade more often). Long unwinding = price down + OI down.${F.expiry ? ` Near-month expiry ${esc(F.expiry)}${F.lot ? `, lot ${F.lot}` : ''}.` : ''}${!F.live && !closed ? ' Live futures data appears after the first minutes of trading.' : ''}</div></section>
      <section class="pl-card"><div class="sec">Trend and momentum</div>
        ${row('1 week / 1 month', `${pct(X.r1w, 1)} / ${pct(X.r1m, 1)}`, cls(X.r1w))}${row('3 months / 1 year', `${pct(X.r3m, 1)} / ${pct(X.r1y, 1)}`, cls(X.r3m))}
        ${row('20 / 50 / 200-day average', `${f0(X.dma20)} / ${f0(X.dma50)} / ${f0(X.dma200)}`)}${row('RSI (14 days)', ok(X.rsi) ? f1(X.rsi) + (X.rsi >= 70 ? ' overbought' : X.rsi <= 30 ? ' oversold' : '') : '–', X.rsi >= 70 ? 'down' : X.rsi <= 30 ? 'up' : '')}
        ${row('52-week high / low', `${f0(X.hi52)} / ${f0(X.lo52)}`)}${row('Volume vs 20-day average', ok(X.volX) ? f1(X.volX) + '×' : '–', X.volX >= 1.5 ? 'up' : '')}</section>
      <section class="pl-card"><div class="sec">Levels to watch ${lv ? `<span class="mut">(from ${esc(lv.from)})</span>` : ''}</div>
        ${lv ? row('Previous high / low / close', `${f2(lv.pdh)} / ${f2(lv.pdl)} / ${f2(lv.pdc)}`) + row('Pivot / R1 / S1', `${f2(lv.p)} / <span class="up">${f2(lv.r1)}</span> / <span class="down">${f2(lv.s1)}</span>`) : '<span class="mut">Not available</span>'}
        ${ok(X.gap) ? row('Opening gap', pct(X.gap), cls(X.gap)) : ''}${ok(X.open) ? row('Today open / high / low', `${f2(X.open)} / ${f2(X.hi)} / ${f2(X.lo)}`) : ''}
        ${lv ? `<div class="legend">Holding above ${f2(lv.pdh)} keeps buyers in charge; a slip below ${f2(lv.pdl)} hands control to sellers. In between is noise.</div>` : ''}</section>
      <section class="pl-card"><div class="sec">Market mood</div>
        ${row('Nifty today', A.NIFTY ? pct(A.NIFTY.chg) : '–', A.NIFTY ? cls(A.NIFTY.chg) : '')}
        ${p.fii ? row(`FII index futures (${esc(p.fii.date)})`, `${f0(p.fii.longPct)}% long`, p.fii.longPct >= 50 ? 'up' : 'down') + row('FII net change vs day before', ok(p.fii.netChg) ? `${p.fii.netChg > 0 ? '+' : ''}${f0(p.fii.netChg)} contracts` : '–', cls(p.fii.netChg)) : '<span class="mut">FII data not available yet</span>'}
        <div class="legend">FIIs mostly short (below 50% long) means big players lean bearish on the index; them cutting shorts often fuels rallies.</div></section></div>`;
    const N = p.news, BADGE = { official: ['b', '✓ NSE/BSE filing'], confirmed: ['b', '✓ Several trusted outlets'], single: ['n', 'Single source'], report: ['g', '⚠ Report, not confirmed'] };
    h += `<section class="pl-card pl-news"><div class="sec">News check (last 7 days)</div>${N.items.length ? N.items.map((n) => `<div class="pl-n"><span class="pill ${BADGE[n.status][0]}">${BADGE[n.status][1]}</span><div><a href="${esc(n.link || '#')}" target="_blank" rel="noopener">${esc(n.t)}</a><small class="mut">${esc(n.pubs.slice(0, 3).join(', '))}${n.pubs.length > 3 ? ` +${n.pubs.length - 3}` : ''} · ${agoT(n.ts)}${ok(n.s) && Math.abs(n.s) >= 0.15 ? ` · <span class="${cls(n.s)}">${n.s > 0 ? 'positive' : 'negative'}</span>` : ''}</small></div></div>`).join('') : '<div class="mut">No company news from trusted outlets this week.</div>'}
      ${N.official.length ? `<div class="sec">Official filings (NSE / BSE)</div>${N.official.map((o) => `<div class="pl-n"><span class="pill b">Filing</span><div>${o.link ? `<a href="${esc(o.link)}" target="_blank" rel="noopener">${esc(o.t)}</a>` : esc(o.t)}<small class="mut">${esc(o.src)} · ${agoT(o.ts)}</small></div></div>`).join('')}` : ''}
      ${p.results && p.results.length ? `<div class="sec">Results headlines</div>${p.results.map((r) => `<div class="pl-n"><span class="pill ${r.s > 0.15 ? 'b' : r.s < -0.15 ? 's' : 'n'}">${esc(r.q || 'Results')}</span><div>${esc(r.t)}<small class="mut">${esc(r.src || '')} · ${agoT(r.ts)}</small></div></div>`).join('')}` : ''}
      <div class="legend">"Report, not confirmed" = the headline uses words like reportedly, sources, may, likely, in talks, and no exchange filing backs it. Such news can reverse fast.</div></section>
      <div class="legend">Updated ${ago ? ago + ' min ago' : 'just now'}. For analysis and practice only, not investment advice.</div>`;
    return h;
  }
  function agoT(ts) { if (!ts) return ''; const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; }
  function renderMkt() {
    if (buErr) return `<div class="alert d">${esc(buErr)}</div>`;
    if (!BU) return '<div class="pl-wait"><span class="spin"></span>Reading NSE\'s F&O file…</div>';
    const F = typeof fiiPositions === 'function' ? fiiPositions() : null, C = BU.counts, tot = C.LB + C.SB + C.SC + C.LU || 1;
    const mood = C.SB + C.LU > (C.LB + C.SC) * 1.5 ? ['dn', 'More stocks saw selling than buying'] : C.LB + C.SC > (C.SB + C.LU) * 1.5 ? ['up', 'More stocks saw buying than selling'] : ['n', 'Buying and selling fairly balanced'];
    let h = `<div class="pl-verdict ${mood[0]}"><div class="pl-v1"><b>${mood[1]}</b><span>Session ${esc(BU.date)} · ${esc(BU.src)}</span></div>
      <div class="pl-bar">${['LB', 'SC', 'LU', 'SB'].map((k) => `<i class="${BTONE[k]} ${k}" style="width:${(C[k] / tot) * 100}%" title="${BNAME[k]}: ${C[k]}"></i>`).join('')}</div>
      <div class="pl-why">${['LB', 'SB', 'SC', 'LU'].map((k) => `<span class="pill ${BTONE[k] === 'up' ? 'b' : 's'}">${BNAME[k]}: ${C[k]}</span>`).join('')}${(BU.index || []).map((x) => `<span class="pill n">${esc(x.sym)}: ${BNAME[x.b]} (OI ${pct(x.doiPct, 1)})</span>`).join('')}</div>
      ${F ? `<div class="legend">FII index futures ${esc(F.date || '')}: ${f0(F.longPct)}% long (${esc(F.read)}).</div>` : ''}</div>
      <div class="pl-cols">${['LB', 'SB', 'SC', 'LU'].map((k) => `<section class="pl-card"><div class="sec ${BTONE[k]}">${BNAME[k]}</div><div class="mut" style="font-size:12px">${BHI[k]}</div>
        <table class="pl-t"><thead><tr><th class="l">Stock</th><th>Price</th><th>OI</th></tr></thead><tbody>${(BU.lists[k] || []).map((x) => `<tr onclick='Pulse.fromList(${JSON.stringify(x.sym)})' title="Open the full pulse for ${esc(x.sym)}"><td class="l"><b>${esc(x.sym)}</b>${x.clear ? '' : ' <small class="mut">weak</small>'}</td><td class="${cls(x.dp)}">${pct(x.dp, 1)}</td><td>${pct(x.doiPct, 1)}</td></tr>`).join('') || '<tr><td colspan="3" class="mut">None</td></tr>'}</tbody></table></section>`).join('')}</div>
      <div class="legend">Sorted by how much fresh positions changed, weighted by how much price moved, so "OI up 13% but price +0.2%" ranks lower and is marked weak. Tap a stock for its full pulse. NSE publishes this file each evening, so during market hours it shows the previous session; the live buildup for one stock is on its own pulse.</div>`;
    return h;
  }
  function fromList(sym) { show('stock'); load({ sym }); }
  function lang() { showEn = !showEn; render(); }
  function speak() { if (P && P.ai && P.ai.hi) Voice.say(P.ai.hi.replace(/\n/g, '। ')); else toast('No Hindi summary to read'); }

  /* ---------- demo data (?demo=1) ---------- */
  function demo(it) {
    const sym = (it.sym || 'DEMO').toUpperCase(), now = Date.now();
    const f = { ts: now, sym, name: it.name || sym, key: it.key || '', phase: 'closed', liveDay: false,
      px: { price: 1105, chg: 5.23, prevClose: 1050.1, session: '2026-11-13', r1w: 14.3, r1m: 5.0, r3m: -36.6, r1y: -36.6, dma20: 1003, dma50: 1088, dma200: 1420, rsi: 61, hi52: 1964, lo52: 916, volX: 5.4 },
      lev: { from: '2026-11-13', pdh: 1112, pdl: 1021, pdc: 1105, p: 1079.3, r1: 1137.7, s1: 1046.7 },
      fut: { nse: { date: '2026-11-13', b: 'LB', dp: 5.19, doiPct: 10.85, clear: true }, expiry: '2026-11-24', lot: 350 },
      fii: { date: '2026-11-13', longPct: 34.6, netChg: -6201 },
      news: { items: [{ t: 'Policybazaar shares rally as Irdai may revise proposed distribution rules (demo)', pubs: ['Outlook Money'], ts: now - 864e5, s: 0.6, status: 'report' },
        { t: 'PB Fintech Q2: revenue up 35%, profit up 42% (demo)', pubs: ['Moneycontrol', 'Economic Times', 'Mint'], ts: now - 9 * 864e5, s: 0.5, status: 'official' }],
        official: [{ t: 'Financial Results for quarter ended September 2026 (demo)', src: 'NSE announcements', ts: now - 10 * 864e5 }] }, results: [] };
    f.lean = { lean: 'CALL', conf: 'medium', score: 3.4, why: [{ pts: 2, txt: 'Futures long buildup (last session: price +5.19%, OI +10.85%)' }, { pts: 0.9, txt: 'News leans positive (2 headlines, 1 verified)' }, { pts: 0.5, txt: 'Volume 5.4× normal on a rise' }, { pts: -0.5, txt: 'Nifty down 0.54%' }],
      warn: ['Big headline is an unconfirmed report (demo)', 'Market closed: this reads the last session. It refreshes at 9:15 and 9:30'] };
    f.ai = { hi: 'खरीदार हावी हैं: पिछले सत्र में भाव 5% चढ़ा और फ्यूचर्स में नई लॉन्ग पोज़िशन 11% बढ़ीं।\nतेज़ी की बड़ी वजह IRDAI वाली ख़बर है, जो अभी सिर्फ़ रिपोर्ट है, आधिकारिक पुष्टि नहीं।\n1,112 के ऊपर टिके तो तेज़ी बनी रह सकती है; 1,021 के नीचे फिसले तो कमज़ोरी।\nबाज़ार का मूड सावधानी वाला है, FII इंडेक्स में ज़्यादातर शॉर्ट हैं।\nये पिछले सत्र का डेटा है, सोमवार 9:30 के बाद दोबारा देखें।\nफ़ैसला आपका है। (डेमो)', en: 'Buyers are in control: price rose 5% and fresh long positions rose 11% last session.\nThe rally rests on an IRDAI report that is not confirmed yet.\nAbove 1,112 the rally can continue; below 1,021 it weakens.\nMarket mood is cautious; FIIs are mostly short in index futures.\nThis is last-session data; recheck after 9:30 on Monday.\nThe decision is yours. (demo)' };
    return f;
  }
  function demoBuildup() {
    const L = (a) => a.map(([sym, dp, doiPct]) => ({ sym, dp, doiPct, clear: Math.abs(dp) >= 0.5 && Math.abs(doiPct) >= 2 }));
    return { date: '2026-11-13 (demo)', src: 'NSE F&O bhavcopy (demo)', counts: { LB: 38, SB: 130, SC: 15, LU: 38 },
      lists: { LB: L([['POLICYBZR', 5.19, 10.85], ['ENRIN', 3.97, 8.75], ['MFSL', 2.35, 7.22], ['ANGELONE', 1.87, 7.63], ['ABB', 1.76, 7.18], ['VMM', 0.46, 12.96]]),
        SB: L([['GRASIM', -2.97, 8.51], ['ALKEM', -3.7, 5.28], ['BOSCHLTD', -1.87, 5.44], ['POLYCAB', -1.53, 5.42], ['CHOLAFIN', -0.73, 7.2], ['PAGEIND', -0.57, 22.31]]),
        SC: L([['AMBER', 9.92, -8.91], ['GVT&D', 6.05, -0.86], ['EICHERMOT', 2.58, -1.12], ['BLUESTARCO', 0.91, -4.65]]),
        LU: L([['COROMANDEL', -2.29, -5.92], ['KALYANKJIL', -2.32, -5.06], ['KAYNES', -2.58, -2.26], ['BDL', -1.49, -3.11]]) },
      index: [{ sym: 'BANKNIFTY', b: 'LU', doiPct: -6.53 }] };
  }
  return { open, close, show, find, load, fromList, lang, speak };
})();
