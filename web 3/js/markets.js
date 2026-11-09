/* ===== Market map (index heatmap, who moved the index, sectors) and Screener (F&O stocks) ===== */
const Markets = (() => {
  let tab = 'map', idx = 'NIFTY50', map = null, mapErr = '', mapT = null, popSym = null;
  let uni = null, scan = null, calls = null, rescal = null, scr = 'dip', scanning = false;
  const $m = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const live = () => Source.mode === 'live';
  const pct = (x, d = 2) => (ok(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}%` : '–');
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const ymdIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

  /* ---------- shell ---------- */
  function build() {
    if ($m('mk')) return;
    const el = document.createElement('div'); el.id = 'mk'; el.className = 'rp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Market map and screener');
    el.innerHTML = `<div class="rp-top"><div class="mk-tabs" role="tablist"><button data-t="map" onclick="Markets.show('map')">Market Map</button><button data-t="scr" onclick="Markets.show('scr')">Screener</button></div>
      <span class="mut" id="mkNote"></span><button class="x" onclick="Markets.close()" aria-label="Close">✕</button></div><div id="mkBody"></div>`;
    document.body.appendChild(el);
    addEventListener('resize', () => { if (tab === 'map' && $m('mk').classList.contains('on')) drawTM(); });
  }
  function open(t) { build(); $m('mk').classList.add('on'); document.body.style.overflow = 'hidden'; show(t || tab); }
  function close() { $m('mk').classList.remove('on'); document.body.style.overflow = ''; clearInterval(mapT); mapT = null; }
  function show(t) {
    tab = t; if ($m('mkNote')) $m('mkNote').textContent = ''; document.querySelectorAll('.mk-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    clearInterval(mapT); mapT = null;
    if (t === 'map') { renderMap(); loadMap(); mapT = setInterval(loadMap, 30000); }
    else { renderScr(); loadScr(); }
  }

  /* ---------- market map ---------- */
  async function loadMap() {
    try { map = live() ? await Source.raw('/api/map?idx=' + idx) : demoMap(); mapErr = ''; }
    catch (e) { mapErr = e.message + (/404|Not found/i.test(e.message) ? ' (deploy the new Worker code)' : ''); }
    if (tab === 'map') renderMap();
  }
  function setIdx(k) { idx = k; map = null; renderMap(); loadMap(); }
  function renderMap() {
    const b = $m('mkBody'); if (!b) return;
    const IDX = [['NIFTY50', 'Nifty 50'], ['BANKNIFTY', 'Bank Nifty'], ['NIFTYIT', 'Nifty IT'], ['NIFTYNEXT50', 'Nifty Next 50']];
    let h = `<div class="mk-grid"><section class="mk-panel"><div class="ph"><h2>${map ? esc(map.label) : 'Market'} Map</h2><div class="seg mk-seg">${IDX.map(([k, n]) => `<button class="${k === idx ? 'on' : ''}" onclick="Markets.setIdx('${k}')">${n}</button>`).join('')}</div></div>`;
    if (!map) { h += `<div class="mut" style="padding:40px 0;text-align:center">${mapErr ? esc(mapErr) : 'Loading live prices…'}</div></section></div>`; b.innerHTML = h; return; }
    const it = map.items.filter((x) => ok(x.chg)), up = it.filter((x) => x.chg > 0).length, dn = it.filter((x) => x.chg < 0).length;
    const byW = map.items.slice().sort((p, q) => q.w - p.w), top = byW.slice(0, 10), sumPts = (a) => a.reduce((s, x) => s + (x.pts || 0), 0);
    const I = map.index;
    h += `<div class="sum mk-sum"><div><small>${esc(map.label)}</small><b class="${cls(I && I.chg)}">${I ? f2(I.price) + ' ' + pct(I.chg) : '–'}</b></div>
      <div><small>Advancers / Decliners</small><b><span class="up">${up}</span> / <span class="down">${dn}</span></b></div>
      <div><small>Top 10 By Weight</small><b class="${cls(sumPts(top))}">${sgn(sumPts(top))}${f1(sumPts(top))} pts</b></div>
      <div><small>Rest Of The Index</small><b class="${cls(sumPts(byW.slice(10)))}">${sgn(sumPts(byW.slice(10)))}${f1(sumPts(byW.slice(10)))} pts</b></div></div>
      <div id="mkTM" class="mk-tm" aria-label="Heatmap: box size is index weight, colour is today's change"></div>
      <div class="mk-scale"><span>−3%</span><i></i><span>+3%</span><span class="mut">Box size = weight in the index (${esc(map.wsrc)}). Tap a box for details.</span></div><div id="mkPop"></div></section>`;
    // who moved
    const C = map.items.filter((x) => ok(x.pts)).sort((p, q) => q.pts - p.pts), pos = C.filter((x) => x.pts > 0).slice(0, 6), neg = C.filter((x) => x.pts < 0).slice(-5), all = [...pos, ...neg];
    const mx = Math.max(1, ...all.map((x) => Math.abs(x.pts)));
    const idxPts = I ? I.price - I.prevClose : null, top3 = C.slice(0, 3), bot3 = C.slice(-3).reverse();
    const lead = !I ? '' : idxPts >= 0
      ? `${esc(map.label)} is up ${f0(idxPts)} pts. ${top3.map((x) => x.sym).join(', ')} added ${f0(sumPts(top3))} of them.`
      : `${esc(map.label)} is down ${f0(-idxPts)} pts. ${bot3.map((x) => x.sym).join(', ')} took away ${f0(-sumPts(bot3))} of them.`;
    const broad = up + dn ? (idxPts >= 0 ? up / (up + dn) : dn / (up + dn)) : 0;
    h += `<section class="mk-panel"><div class="ph"><h2>Who Moved ${esc(map.label)} Today</h2></div><div class="mut" style="font-size:12px;margin-bottom:4px">Index points added (green) or taken away (red) by each stock</div>
      ${all.map((x) => { const w = (Math.abs(x.pts) / mx) * 50; return `<div class="cb"><span>${esc(x.sym)}</span><div class="t"><i style="${x.pts >= 0 ? `left:50%;width:${w}%;background:var(--call)` : `right:50%;width:${w}%;background:var(--put)`}"></i></div><em class="${x.pts >= 0 ? 'up' : 'down'}">${sgn(x.pts)}${f1(x.pts)}</em></div>`; }).join('')}
      ${lead ? `<div class="callout">${lead} ${broad >= 0.65 ? `Breadth agrees (${up} up, ${dn} down): the move is broad.` : broad <= 0.45 ? `But breadth disagrees (${up} up, ${dn} down): a few heavyweights are doing the work, so the move is fragile.` : `Breadth is mixed (${up} up, ${dn} down).`}</div>` : ''}
      <div class="sec">Breadth</div><div class="ad"><i style="width:${up + dn ? (up / (up + dn)) * 100 : 50}%;background:var(--call)"></i><i style="flex:1;background:var(--put)"></i></div><div class="mut" style="font-size:12px">${up} up · ${dn} down · ${it.length - up - dn} flat</div>
      <div class="sec">Sectors</div><div class="sect">${(map.sectors || []).slice().sort((p, q) => q.chg - p.chg).map((s) => `<div class="st ${s.chg > 0 ? 'up' : s.chg < 0 ? 'dn' : ''}"><small>${esc(s.name)}</small><b class="${cls(s.chg)}">${pct(s.chg)}</b></div>`).join('') || '<span class="mut">Not available</span>'}</div>
      <div class="legend">Points = stock's weight × its % change × index level. Updates every 30 seconds while this page is open.</div></section></div>`;
    b.innerHTML = h; drawTM(); pop(popSym);
    $m('mkNote').textContent = map.ts ? `Prices as of ${new Date(map.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : '';
  }
  const colour = (p) => { if (!ok(p)) return '#1b2433'; const t = Math.max(-1, Math.min(1, p / 3)), a = [27, 36, 51], z = t >= 0 ? [0, 179, 119] : [179, 18, 63], k = Math.min(1, Math.abs(t) * 1.4); return `rgb(${a.map((x, i) => Math.round(x + (z[i] - x) * k)).join(',')})`; };
  function squarify(items, x, y, w, h, out) {
    if (!items.length) return;
    const total = items.reduce((s, i) => s + i.v, 0), sc = (w * h) / total, short = Math.min(w, h), row = [], rest = items.slice();
    const worst = (r) => { const s = r.reduce((a, i) => a + i.v * sc, 0), mx = Math.max(...r.map((i) => i.v * sc)), mn = Math.min(...r.map((i) => i.v * sc)); return Math.max((short * short * mx) / (s * s), (s * s) / (short * short * mn)); };
    while (rest.length) { const n = rest[0]; if (!row.length || worst([...row, n]) <= worst(row)) { row.push(n); rest.shift(); } else break; }
    const s = row.reduce((a, i) => a + i.v * sc, 0);
    if (w >= h) { const cw = s / h; let cy = y; row.forEach((i) => { const ch = (i.v * sc) / cw; out.push({ ...i, x, y: cy, w: cw, h: ch }); cy += ch; }); squarify(rest, x + cw, y, w - cw, h, out); }
    else { const ch = s / w; let cx = x; row.forEach((i) => { const cw = (i.v * sc) / ch; out.push({ ...i, x: cx, y, w: cw, h: ch }); cx += cw; }); squarify(rest, x, y + ch, w, h - ch, out); }
  }
  function drawTM() {
    const el = $m('mkTM'); if (!el || !map) return;
    const W = el.clientWidth, H = el.clientHeight, out = [];
    squarify(map.items.filter((x) => x.w > 0).map((x) => ({ ...x, v: x.w })).sort((p, q) => q.v - p.v), 0, 0, W, H, out);
    el.innerHTML = out.map((t) => { const big = Math.min(t.w, t.h), fs = Math.max(9, Math.min(26, big / 4, (t.w - 6) / (t.sym.length * 0.62)));
      return `<button class="tl" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;background:${colour(t.chg)}" onclick="Markets.pop('${esc(t.sym)}')" title="${esc(t.name)} · ${esc(t.sector || '')} · weight ${f2(t.w)}% · ${pct(t.chg)}${ok(t.pts) ? ` · ${sgn(t.pts)}${f1(t.pts)} index pts` : ''}">
        ${big > 22 ? `<b style="font-size:${fs}px">${esc(t.sym)}</b>` : ''}${big > 44 ? `<span>${pct(t.chg)}</span>` : ''}${big > 78 && ok(t.pts) ? `<i>${sgn(t.pts)}${f1(t.pts)} pts</i>` : ''}</button>`; }).join('');
  }
  function pop(sym) {
    popSym = sym; const box = $m('mkPop'); if (!box) return;
    const x = sym && map && map.items.find((i) => i.sym === sym);
    if (!x) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="mk-pop"><div><b>${esc(x.sym)}</b> <span class="mut">${esc(x.name)} · ${esc(x.sector || '')}</span></div>
      <div>${ok(x.price) ? f2(x.price) : '–'} <span class="${cls(x.chg)}">${pct(x.chg)}</span> · weight ${f2(x.w)}% · ${ok(x.pts) ? `${sgn(x.pts)}${f1(x.pts)} index pts` : ''}</div>
      <div class="mk-pop-a"><button class="btn" onclick="Markets.analyze('${esc(x.sym)}')">Add To Watchlist And Analyze</button><button class="btn ghost" onclick="Markets.pop(null)">Close</button></div></div>`;
  }
  async function analyze(sym) {
    const x = (map && map.items.find((i) => i.sym === sym)) || (uni && uni.items.find((i) => i.sym === sym)) || (scan && scan.rows.find((i) => i.sym === sym));
    if (!x) return;
    if (!live()) return toast('Adding stocks works in live mode.');
    const key = x.key || 'NSE_EQ|' + x.isin;
    close();
    addWatch({ id: sym.replace(/[^A-Z0-9&]/g, '').slice(0, 20), label: sym, name: x.name || sym, key, ukey: key, exch: 'NSE', kind: 'EQ', fo: true, lot: x.lot || null, sym });
  }

  /* ---------- screener ---------- */
  const SCREENS = [
    ['dip', 'Strong Stock, Price Dipped', 'Long uptrend (above 200 DMA, 50 DMA above 200 DMA, up 10%+ in a year) but down 4–15% in the last 5 sessions. Bounce candidates.'],
    ['breakout', 'Breakouts', 'At or near a 52-week high on 1.5× normal volume, above 50 and 200 DMA.'],
    ['momentum', 'Momentum Leaders', 'Strongest 3-month gainers that are above 20, 50 and 200 DMA and beating Nifty.'],
    ['oversold', 'Oversold In An Uptrend', 'RSI below 32 while still above the 200 DMA: sharp dip in a healthy trend.'],
    ['volume', 'Volume Shockers', 'Today\'s volume 2.5× the 20-day average with a 2%+ move, either way.'],
    ['red', 'Red Flags: May Fall', 'Broke below the 200 DMA on heavy volume, 50 DMA crossed under 200 DMA, a 12%+ fall in a month, or broker downgrades / target cuts.'],
    ['orders', 'Big Order Wins', 'Order-win headlines from the last 7 days (trusted business news).'],
    ['brokers', 'Broker Upgrades And Downgrades', 'Rating and target-price changes reported in the last 7 days.'],
    ['results', 'Results This Week', 'F&O companies with board meetings for results in the next 7 days (NSE calendar).'],
    ['multi', 'Multibagger Watch', 'Needs sales, profit, ROCE and order-book data from company results. Planned as the next step; not available yet.'],
  ];
  async function loadScr() {
    try {
      if (!scan) { const s = await idbGet('scan'); if (s) scan = s; }
      if (live()) {
        if (!uni) uni = await Source.raw('/api/universe');
        const [c, r] = await Promise.all([Source.raw('/api/brokercalls').catch(() => null), Source.raw('/api/rescal').catch(() => null)]);
        calls = c; rescal = r;
      } else { if (!scan) scan = demoScan(); calls = calls || demoCalls(); rescal = rescal || { items: [] }; uni = uni || { items: scan.rows }; }
    } catch (e) { $m('mkNote').textContent = e.message + (/404|Not found/i.test(e.message) ? ' (deploy the new Worker code)' : ''); }
    renderScr();
  }
  async function runScan() {
    if (!live()) return toast('Scanning works in live mode. Demo shows sample results.');
    if (scanning) return;
    if (!uni) { try { uni = await Source.raw('/api/universe'); } catch (e) { return toast(e.message); } }
    scanning = true;
    const list = [{ sym: 'NIFTY', key: 'NSE_INDEX|Nifty 50', name: 'Nifty 50' }, ...uni.items], rows = [], now = Date.now(), from = new Date(now - 400 * 864e5 + 5.5 * 3600e3).toISOString().slice(0, 10), to = ymdIST();
    let nifty = null, fails = 0;
    for (let i = 0; i < list.length; i++) {
      const x = list[i]; const bar = $m('scProg'); if (bar) { bar.style.width = Math.round((i / list.length) * 100) + '%'; $m('scTxt').textContent = `Scanning ${x.sym} (${i + 1} of ${list.length})…`; }
      try {
        const j = await Source.raw(`/api/hist?key=${encodeURIComponent(x.key)}&unit=days&iv=1&from=${from}&to=${to}`);
        const d = BT.parseDaily(j && j.data && j.data.candles);
        if (x.sym === 'NIFTY') nifty = d; else { const f = features(d, nifty); if (f) rows.push({ ...x, ...f }); }
      } catch (e) { fails++; if (e.code === 'UPSTOX_RATE') { $m('scTxt').textContent = 'Upstox asked to slow down, waiting 60 s…'; await sleep(61000); i--; continue; } if (e.code === 'UPSTOX_TOKEN_BAD' || e.code === 'UPSTOX_LOGIN') { toast(e.message); break; } }
      await sleep(130);
    }
    scan = { ts: Date.now(), day: to, rows, fails }; await idbSet('scan', scan); scanning = false; renderScr();
    toast(`Scan done: ${rows.length} stocks${fails ? `, ${fails} failed` : ''}.`);
  }
  function features(d, nifty) {
    if (!d || d.length < 60) return null;
    const c = d.map((r) => r[4]), v = d.map((r) => r[5]), n = c.length, L = n - 1, at = (k) => c[Math.max(0, L - k)];
    const sma = (k, end = L) => { if (end + 1 < k) return null; let s = 0; for (let i = end - k + 1; i <= end; i++) s += c[i]; return s / k; };
    const ret = (k) => (n > k ? ((c[L] - at(k)) / at(k)) * 100 : null);
    const s20 = sma(20), s50 = sma(50), s200 = sma(200), s200p = n > 220 ? sma(200, L - 20) : null, s50p = n > 60 ? sma(50, L - 10) : null, s200p10 = n > 210 ? sma(200, L - 10) : null;
    const yr = d.slice(-250), hi52 = Math.max(...yr.slice(0, -1).map((r) => r[2])), lo52 = Math.min(...yr.map((r) => r[3]));
    const vol20 = v.slice(-21, -1).reduce((a, b) => a + b, 0) / 20, volX = vol20 ? v[L] / vol20 : null;
    let g = 0, l = 0; for (let i = L - 13; i <= L; i++) { const ch = c[i] - c[i - 1]; if (ch > 0) g += ch; else l -= ch; } const rsi = l ? 100 - 100 / (1 + g / l) : 100;
    const above200recently = s200 && c.slice(-6, -1).some((x, i) => x > sma(200, L - 5 + i));
    const nr60 = nifty && nifty.length > 61 ? ((nifty[nifty.length - 1][4] - nifty[nifty.length - 61][4]) / nifty[nifty.length - 61][4]) * 100 : null;
    return { price: c[L], date: d[L][0], chg1: ret(1), r5: ret(5), r20: ret(20), r60: ret(60), r250: ret(250), s20, s50, s200, slope200: s200 && s200p ? ((s200 - s200p) / s200p) * 100 : null,
      hi52, lo52, offHi: ((c[L] - hi52) / hi52) * 100, volX, rsi, rs60: ok(nr60) && ok(ret(60)) ? ret(60) - nr60 : null,
      brk200: !!(s200 && c[L] < s200 && above200recently), death: !!(s50 && s200 && s50p && s200p10 && s50 < s200 && s50p >= s200p10) };
  }
  // match news headlines to F&O stocks by symbol or a distinctive name
  const GENERIC = new Set(['tata', 'bajaj', 'hdfc', 'icici', 'adani', 'mahindra', 'bharat', 'hindustan', 'indian', 'india', 'state', 'power', 'bank', 'the', 'jsw', 'aditya', 'godrej', 'sun', 'max', 'life', 'motors', 'steel']);
  function matcher() {
    const L = (scan && scan.rows) || (uni && uni.items) || [];
    return L.map((x) => { const w = String(x.name || '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').split(/\s+/).filter((t) => t && !['ltd', 'limited', 'the', 'and', 'of', 'co', 'company', 'corporation', 'industries', 'india'].includes(t));
      const nameKey = w.length ? (GENERIC.has(w[0]) && w[1] ? w[0] + ' ' + w[1] : w[0]) : null;
      return { x, re: new RegExp(`\\b(${[x.sym.length >= 3 ? x.sym.toLowerCase().replace(/[&]/g, '\\&') : null, nameKey && nameKey.length >= 4 ? nameKey.replace(/[&]/g, '\\&') : null].filter(Boolean).join('|')})\\b`, 'i') }; });
  }
  function headlinesFor(list) { const M = matcher(); return (list || []).map((h) => { const m = M.find((z) => z.re.test(h.t)); return m ? { ...h, sym: m.x.sym, row: scan && scan.rows.find((r) => r.sym === m.x.sym) } : { ...h }; }); }
  function results() {
    const R = (scan && scan.rows) || [], out = [];
    const add = (x, score, why) => out.push({ x, score: Math.max(0, Math.min(100, Math.round(score))), why });
    if (scr === 'dip') R.forEach((x) => { if (x.s200 && x.price > x.s200 && x.s50 > x.s200 && x.r250 > 10 && x.r5 <= -4 && x.r5 >= -15) add(x, 50 + Math.min(20, x.r250 / 3) + (x.slope200 > 0 ? 10 : 0) + (x.price > x.s50 ? 10 : 0) - Math.abs(x.r5 + 8) + (x.rsi < 40 ? 5 : 0),
      [[`Up ${f0(x.r250)}% in a year`], [`Down ${f1(-x.r5)}% in 5 days`, 'w'], [x.price > x.s50 ? 'Still above 50 DMA' : 'Below 50 DMA', x.price > x.s50 ? '' : 'w'], ['Above 200 DMA'], [`RSI ${f0(x.rsi)}`, x.rsi < 35 ? '' : 'w']]); });
    if (scr === 'breakout') R.forEach((x) => { if (x.offHi >= -1 && x.volX >= 1.5 && x.s50 && x.s200 && x.price > x.s50 && x.s50 > x.s200) add(x, 55 + Math.min(25, (x.volX - 1.5) * 15) + (x.rs60 > 0 ? 10 : 0) + (x.offHi >= 0 ? 10 : 0),
      [[x.offHi >= 0 ? 'New 52-week high' : `${f1(-x.offHi)}% below 52-week high`], [`Volume ${f1(x.volX)}× normal`], [`3 months ${pct(x.r60, 1)}`], [x.rs60 > 0 ? 'Beating Nifty' : 'Lagging Nifty', x.rs60 > 0 ? '' : 'w']]); });
    if (scr === 'momentum') R.filter((x) => x.s20 && x.s50 && x.s200 && x.price > x.s20 && x.s20 > x.s50 && x.s50 > x.s200 && x.rs60 > 0).sort((p, q) => q.r60 - p.r60).slice(0, 25).forEach((x, i) => add(x, 90 - i * 2,
      [[`3 months ${pct(x.r60, 1)}`], [`${f1(x.rs60)}% ahead of Nifty`], ['Above 20/50/200 DMA'], [x.rsi > 75 ? `RSI ${f0(x.rsi)}: stretched` : `RSI ${f0(x.rsi)}`, x.rsi > 75 ? 'w' : '']]));
    if (scr === 'oversold') R.forEach((x) => { if (x.rsi < 32 && x.s200 && x.price > x.s200) add(x, 60 + (32 - x.rsi) + (x.slope200 > 0 ? 10 : 0), [[`RSI ${f0(x.rsi)}`], ['Above 200 DMA'], [`Down ${f1(-x.r20)}% in a month`, 'w']]); });
    if (scr === 'volume') R.forEach((x) => { if (x.volX >= 2.5 && Math.abs(x.chg1) >= 2) add(x, 50 + Math.min(40, x.volX * 6), [[`Volume ${f1(x.volX)}× normal`], [`Today ${pct(x.chg1)}`, x.chg1 > 0 ? '' : 'r']]); });
    if (scr === 'red') {
      const dn = headlinesFor(calls && calls.down).filter((h) => h.sym);
      R.forEach((x) => { const why = [];
        if (x.brk200) why.push([`Broke below 200 DMA${x.volX >= 1.3 ? ` on ${f1(x.volX)}× volume` : ''}`, 'r']);
        if (x.death) why.push(['50 DMA crossed below 200 DMA', 'r']);
        if (x.r20 <= -12 && x.price < x.s50) why.push([`Down ${f0(-x.r20)}% in a month`, 'r']);
        const h = dn.filter((z) => z.sym === x.sym); if (h.length) why.push([`Broker downgrade / target cut (${h.length})`, 'r']);
        if (why.length) add(x, 40 + why.length * 15 + (x.volX >= 1.3 && x.brk200 ? 10 : 0), why); });
    }
    return out.sort((p, q) => q.score - p.score);
  }
  function renderScr() {
    const b = $m('mkBody'); if (!b) return;
    const S = SCREENS.find((s) => s[0] === scr);
    const counts = {}; const keep = scr; SCREENS.forEach(([k]) => { if (['orders', 'brokers', 'results', 'multi'].includes(k)) return; scr = k; counts[k] = results().length; }); scr = keep;
    if (calls) { counts.orders = (calls.orders || []).length; counts.brokers = (calls.up || []).length + (calls.down || []).length; }
    if (rescal) counts.results = soonResults().length;
    let h = `<section class="mk-panel scr"><aside><div class="sec" style="margin-top:0">Ready-Made Screens</div><div class="presets">${SCREENS.map(([k, n, d]) => `<button class="preset ${k === scr ? 'on' : ''} ${k === 'red' ? 'red' : ''} ${k === 'multi' ? 'dis' : ''}" onclick="Markets.setScr('${k}')"><em>${counts[k] ?? ''}</em><b>${n}</b><small>${d}</small></button>`).join('')}</div></aside><div>`;
    const sc = scan ? `Last scan ${scan.day} (${new Date(scan.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}), ${scan.rows.length} F&O stocks${live() ? '' : ', sample data'}` : 'No scan yet';
    h += `<div class="scan-bar"><div><span id="scTxt">${scanning ? 'Scanning…' : sc}</span><div class="rp-pbar"><i id="scProg"></i></div></div><button class="btn" onclick="Markets.runScan()" ${scanning ? 'disabled' : ''}>${scan ? 'Rescan Now' : 'Run First Scan'} (about 1 minute)</button></div>`;
    h += `<div class="ph"><h2>${S[1]}</h2></div><p class="mut" style="font-size:13px;margin:-6px 0 10px">${S[2]}</p>`;
    if (scr === 'multi') h += `<div class="alert i">Multibagger screening needs each company's sales, profit, ROCE, debt and order book. That data is not in any free API; it has to be built up from the quarterly results companies file with NSE/BSE. This is planned as the next step. The price-based screens and Big Order Wins already cover part of it.</div>`;
    else if (scr === 'orders' || scr === 'brokers') {
      const list = scr === 'orders' ? headlinesFor(calls && calls.orders) : [...headlinesFor(calls && calls.up).map((x) => ({ ...x, kind: 'up' })), ...headlinesFor(calls && calls.down).map((x) => ({ ...x, kind: 'down' }))].sort((p, q) => q.ts - p.ts);
      h += list.length ? `<div class="tblw"><table><thead><tr><th class="l">Headline</th><th class="l">Stock</th>${scr === 'orders' ? '<th>Order (₹ cr)</th>' : '<th class="l">Type</th>'}<th>Price</th><th>1D</th><th>1W</th><th></th></tr></thead><tbody>${list.map((x) => `<tr><td class="l"><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.t)}</a><br><small class="mut">${esc(x.src)} · ${new Date(x.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></td>
        <td class="l">${x.sym ? `<b>${esc(x.sym)}</b>` : '<span class="mut">Not F&O / unmatched</span>'}</td>${scr === 'orders' ? `<td>${x.cr ? x.cr.toLocaleString('en-IN') : '–'}</td>` : `<td class="l"><span class="pill ${x.kind === 'up' ? 'b' : 's'}">${x.kind === 'up' ? 'Upgrade' : 'Downgrade'}</span></td>`}
        <td>${x.row ? f2(x.row.price) : '–'}</td><td class="${cls(x.row && x.row.chg1)}">${x.row ? pct(x.row.chg1, 1) : '–'}</td><td class="${cls(x.row && x.row.r5)}">${x.row ? pct(x.row.r5, 1) : '–'}</td><td>${x.sym ? `<button class="btn ghost" onclick="Markets.analyze('${esc(x.sym)}')">Analyze</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="mut">${calls ? 'Nothing in the last 7 days.' : 'Loading headlines…'}</div>`;
      h += '<div class="legend">From Google News, limited to Economic Times, Moneycontrol, Mint, Business Standard, BusinessLine, CNBC-TV18, Financial Express and NDTV Profit. Stock matching is by name, so check the headline.</div>';
    } else if (scr === 'results') {
      const list = soonResults();
      h += list.length ? `<div class="tblw"><table><thead><tr><th class="l">Date</th><th class="l">Stock</th><th>Price</th><th>1M</th><th>From 52W High</th><th></th></tr></thead><tbody>${list.map((x) => `<tr><td class="l">${x.date}</td><td class="l"><b>${esc(x.sym)}</b><br><small class="mut">${esc(x.co || '')}</small></td><td>${x.row ? f2(x.row.price) : '–'}</td><td class="${cls(x.row && x.row.r20)}">${x.row ? pct(x.row.r20, 1) : '–'}</td><td>${x.row ? pct(x.row.offHi, 1) : '–'}</td><td><button class="btn ghost" onclick="Markets.analyze('${esc(x.sym)}')">Analyze</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="mut">${rescal && rescal.error ? esc(rescal.error) : rescal ? 'No F&O results in the next 7 days.' : 'Loading…'}</div>`;
    } else if (!scan) h += `<div class="alert i">Run the first scan. It reads one year of daily candles for every F&O stock from Upstox (about 1 minute) and is saved in this browser. Rescan once a day, ideally after 3:30 pm.</div>`;
    else {
      const rs = results();
      h += rs.length ? `<div class="tblw"><table><thead><tr><th class="l">Stock</th><th>Price</th><th>1D</th><th>1W</th><th>1M</th><th>From 52W High</th><th>Score</th><th class="l">Why It's On The List</th><th></th></tr></thead><tbody>${rs.map(({ x, score, why }) => `<tr><td class="l nm"><b>${esc(x.sym)}</b><small>${esc(x.name || '')}</small></td><td>${f2(x.price)}</td><td class="${cls(x.chg1)}">${pct(x.chg1, 1)}</td><td class="${cls(x.r5)}">${pct(x.r5, 1)}</td><td class="${cls(x.r20)}">${pct(x.r20, 1)}</td><td>${pct(x.offHi, 1)}</td>
        <td><div class="score"><i><u style="width:${score}%;background:${score >= 75 ? 'var(--call)' : score >= 60 ? 'var(--warn)' : 'var(--put)'}"></u></i><b>${score}</b></div></td><td class="l"><div class="why">${why.map(([t, c]) => `<span class="${c || ''}">${esc(t)}</span>`).join('')}</div></td><td><button class="btn ghost" onclick="Markets.analyze('${esc(x.sym)}')">Analyze</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="mut">No stock matches this screen today.</div>';
      h += `<div class="legend">Score ranks candidates for your own research using trend, momentum, volume and news. It is not a prediction or a recommendation. "Analyze" adds the stock to your watchlist so the engine reads it live.</div>`;
    }
    h += '</div></section>';
    b.innerHTML = h;
  }
  function soonResults() {
    const today = ymdIST(), lim = new Date(Date.now() + 7 * 864e5 + 5.5 * 3600e3).toISOString().slice(0, 10), set = new Set(((uni && uni.items) || []).map((x) => x.sym));
    return ((rescal && rescal.items) || []).filter((x) => x.date >= today && x.date <= lim && (!set.size || set.has(x.sym))).sort((p, q) => (p.date < q.date ? -1 : 1)).map((x) => ({ ...x, row: scan && scan.rows.find((r) => r.sym === x.sym) }));
  }
  function setScr(k) { scr = k; renderScr(); }

  /* ---------- storage ---------- */
  function idb(mode, fn) { return new Promise((res) => { try { const o = indexedDB.open('fno_bt', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onsuccess = () => { try { const tx = o.result.transaction('kv', mode), q = fn(tx.objectStore('kv')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => res(null); } catch (e) { res(null); } }; o.onerror = () => res(null); } catch (e) { res(null); } }); }
  const idbGet = (k) => idb('readonly', (s) => s.get(k)), idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k));

  /* ---------- demo data ---------- */
  function demoMap() {
    const N = [['HDFCBANK', 'Financial Services', 12.4, 1.1], ['ICICIBANK', 'Financial Services', 8.9, 0.9], ['RELIANCE', 'Oil Gas', 8.4, 1.3], ['INFY', 'IT', 4.8, -0.6], ['BHARTIARTL', 'Telecom', 4.7, 0.4], ['LT', 'Construction', 3.9, 1.6], ['ITC', 'FMCG', 3.3, -0.3], ['SBIN', 'Financial Services', 3.2, 0.7], ['TCS', 'IT', 3.0, -0.9], ['AXISBANK', 'Financial Services', 3.0, 0.5], ['KOTAKBANK', 'Financial Services', 2.8, -0.4], ['M&M', 'Auto', 2.6, 2.1], ['BAJFINANCE', 'Financial Services', 2.3, 1.4], ['HINDUNILVR', 'FMCG', 2.0, -0.2], ['ETERNAL', 'Consumer Services', 1.6, 2.8], ['SUNPHARMA', 'Healthcare', 1.6, 0.3], ['MARUTI', 'Auto', 1.6, 0.8], ['HCLTECH', 'IT', 1.5, -1.1], ['NTPC', 'Power', 1.4, 0.6], ['TITAN', 'Consumer Durables', 1.3, -0.7], ['ULTRACEMCO', 'Construction Materials', 1.3, 0.2], ['TATAMOTORS', 'Auto', 1.2, 1.9], ['TATASTEEL', 'Metals', 1.2, 2.4], ['BEL', 'Capital Goods', 1.2, 1.2], ['POWERGRID', 'Power', 1.1, 0.1], ['ASIANPAINT', 'Consumer Durables', 1.0, -1.4], ['BAJAJFINSV', 'Financial Services', 0.9, 0.9], ['ADANIPORTS', 'Services', 0.9, 1.7], ['JSWSTEEL', 'Metals', 0.9, 2.0], ['TECHM', 'IT', 0.9, -0.8], ['ONGC', 'Oil Gas', 0.8, -0.5], ['GRASIM', 'Construction Materials', 0.8, 0.4], ['COALINDIA', 'Oil Gas', 0.8, 0.2], ['HINDALCO', 'Metals', 0.8, 2.6], ['TRENT', 'Consumer Services', 0.8, -2.2], ['SHRIRAMFIN', 'Financial Services', 0.7, 1.0], ['NESTLEIND', 'FMCG', 0.7, -0.4], ['CIPLA', 'Healthcare', 0.7, 0.5], ['INDUSINDBK', 'Financial Services', 0.6, -1.8], ['JIOFIN', 'Financial Services', 0.6, 0.3], ['SBILIFE', 'Financial Services', 0.6, 0.2], ['HDFCLIFE', 'Financial Services', 0.6, -0.1], ['DRREDDY', 'Healthcare', 0.6, -0.6], ['WIPRO', 'IT', 0.6, -1.0], ['APOLLOHOSP', 'Healthcare', 0.6, 0.7], ['EICHERMOT', 'Auto', 0.6, 1.1], ['TATACONSUM', 'FMCG', 0.5, 0.1], ['ADANIENT', 'Metals', 0.5, 2.9], ['HEROMOTOCO', 'Auto', 0.5, 0.6], ['BAJAJ-AUTO', 'Auto', 0.5, 0.9]];
    const a = A.NIFTY, pc = a ? a.PC : 25466, tw = N.reduce((s, x) => s + x[2], 0), jig = (Date.now() / 30000) % 7;
    const items = N.map(([sym, sector, w, c], i) => { const ch = c + Math.sin(jig + i) * 0.15, ww = (w / tw) * 100; return { sym, name: sym, sector, key: '', w: ww, price: 1000 + i * 37, chg: ch, pts: Math.round((ww / 100) * (ch / 100) * pc * 10) / 10 }; });
    const tot = items.reduce((s, x) => s + x.pts, 0);
    return { ts: Date.now(), label: 'Nifty 50', index: { price: pc + tot, prevClose: pc, chg: (tot / pc) * 100 }, wsrc: 'sample data', items,
      sectors: [['Bank', 0.84], ['IT', -0.82], ['Auto', 1.21], ['Metal', 2.31], ['FMCG', -0.24], ['Pharma', 0.18], ['Energy', 0.62], ['Realty', 1.05], ['PSU Bank', 1.44]].map(([name, chg]) => ({ name, chg, price: 0 })) };
  }
  function demoScan() {
    const syms = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'LT', 'BEL', 'HAL', 'BHEL', 'TATAMOTORS', 'TATASTEEL', 'DIXON', 'POLYCAB', 'PERSISTENT', 'COFORGE', 'TRENT', 'ZYDUSLIFE', 'LUPIN', 'IRCTC', 'RVNL', 'NBCC', 'CDSL', 'BSE', 'ANGELONE', 'SUZLON', 'IDEA', 'YESBANK', 'PNB', 'CANBK'];
    let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const rows = syms.map((sym) => { const price = 200 + r() * 3000, r250 = (r() - 0.3) * 80, s200 = price / (1 + (r() - 0.35) * 0.3), s50 = s200 * (1 + (r() - 0.3) * 0.15);
      return { sym, name: sym, key: '', price, chg1: (r() - 0.5) * 6, r5: (r() - 0.6) * 20, r20: (r() - 0.5) * 25, r60: (r() - 0.4) * 40, r250, s20: price * (1 + (r() - 0.5) * 0.05), s50, s200, slope200: (r() - 0.4) * 5, hi52: price * (1 + r() * 0.3), lo52: price * 0.6, offHi: -r() * 25, volX: 0.5 + r() * 3.5, rsi: 20 + r() * 60, rs60: (r() - 0.5) * 30, brk200: r() > 0.85, death: r() > 0.9 }; });
    rows[0].offHi = 0.2; rows[0].volX = 2.2; rows[0].s50 = rows[0].price * 0.95; rows[0].s200 = rows[0].price * 0.85; rows[0].rs60 = 6;
    return { ts: Date.now(), day: ymdIST(), rows, fails: 0 };
  }
  function demoCalls() {
    const t = Date.now();
    return { up: [{ t: 'Brokerage upgrades Polycab to buy, raises target price', src: 'Moneycontrol', link: '#', ts: t - 864e5 }], down: [{ t: 'Analysts cut target price on Trent after weak quarter', src: 'Economic Times', link: '#', ts: t - 2 * 864e5 }],
      orders: [{ t: 'BEL bags orders worth ₹1,150 crore from defence ministry', src: 'BusinessLine', link: '#', ts: t - 3 * 864e5, cr: 1150 }, { t: 'RVNL receives order worth Rs 540 crore', src: 'Mint', link: '#', ts: t - 4 * 864e5, cr: 540 }] };
  }

  return { open, close, show, setIdx, pop, analyze, runScan, setScr };
})();
