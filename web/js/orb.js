/* ===== ORB scanner: which F&O stocks are breaking out of their first 15 minutes =====
   The "opening range" (ORB) is the high and low of 9:15–9:30. A close above that box with heavy volume means buyers
   won the opening fight; below it, sellers did. This is a research list for intraday ideas. It never places, changes or
   grades a trade, and the CALL/PUT engine does not read it.
   How it works (live): every 2 minutes it reads the price of every F&O stock in one call (/api/eod), picks the ones near
   the day's high or low or moving a lot, and reads today's 1-minute candles only for those (/api/intra, up to 25 new
   stocks a scan). The 9:15–9:30 box is fixed for the day, so each stock's box is read once and kept. */
const Orb = (() => {
  const OR_END = 15, EVERY = 120e3, MAXNEW = 25;
  const live = () => typeof Source !== 'undefined' && Source.mode === 'live';
  let box = {}, boxDay = '', Q = null, last = 0, busy = false, err = '', timer = null, avgVol = null, demoSeed = 0;
  const mins = () => (typeof istMin === 'function' ? istMin() : 0);
  const day = () => (typeof istYmd === 'function' ? istYmd() : new Date().toISOString().slice(0, 10));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // share of a normal day's volume done by minute m (Indian markets: busy open, busy close) — rough
  const volShare = (m) => Math.min(1, Math.pow(Math.max(1, m + 1) / 375, 0.8));
  const hhmm = (m) => { const t = m + 555; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

  /* ---------- pure: one stock ---------- */
  // candles: [[m, o, h, l, c, v], …] for today, oldest first
  function boxOf(c) {
    const f = c.filter((x) => x[0] >= 0 && x[0] < OR_END); if (f.length < 8) return null;
    const hi = Math.max(...f.map((x) => x[2])), lo = Math.min(...f.map((x) => x[3])), v = f.reduce((s, x) => s + (x[5] || 0), 0);
    let up = null, dn = null;
    c.filter((x) => x[0] >= OR_END).forEach((x) => { if (up === null && x[4] > hi) up = x[0]; if (dn === null && x[4] < lo) dn = x[0]; });
    return { hi, lo, v, up, dn, n: f.length };
  }
  function read(sym, q, b, avg, m) {
    if (!b || !q || !(q.c > 0)) return null;
    const w = (b.hi - b.lo) / q.c, pace = avg && q.v ? q.v / (avg * volShare(m)) : null;
    const side = q.c > b.hi ? 'up' : q.c < b.lo ? 'dn' : 'in', dist = side === 'up' ? q.c / b.hi - 1 : side === 'dn' ? q.c / b.lo - 1 : 0;
    const near = side === 'in' ? (b.hi - q.c) / q.c <= 0.003 ? 'up' : (q.c - b.lo) / q.c <= 0.003 ? 'dn' : '' : '';
    const at = side === 'up' ? b.up : side === 'dn' ? b.dn : null;
    const flip = side === 'up' ? b.dn !== null : side === 'dn' ? b.up !== null : false; // broke the other side first: messy day
    let q2 = 0, notes = [];
    if (ok(pace)) { if (pace >= 1.5) { q2++; notes.push(`volume ${f1(pace)}× a normal day by now`); } else if (pace < 0.8) notes.push('volume below normal: weak move'); }
    if (w > 0 && w <= 0.012) { q2++; notes.push(`tight box (${f1(w * 100)}% wide)`); } else if (w > 0.025) notes.push(`wide box (${f1(w * 100)}%): stop is far`);
    if (Math.abs(dist) > 0.02) notes.push(`already ${f1(Math.abs(dist) * 100)}% past the box: late entry`); else if (side !== 'in') q2++;
    if (flip) notes.push('it broke the other side first: choppy');
    const stop = side === 'up' ? b.lo : side === 'dn' ? b.hi : null, risk = stop ? Math.abs(q.c - stop) / q.c : null;
    return { sym, side, near, dist, w, pace, at, flip, q: q2 - (flip ? 1 : 0), notes, price: q.c, chg: q.pc ? (q.c / q.pc - 1) * 100 : 0, hi: b.hi, lo: b.lo, stop, risk };
  }

  /* ---------- data ---------- */
  function idbGet(k) { return new Promise((res) => { try { const o = indexedDB.open('fno_bt', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onsuccess = () => { try { const r = o.result.transaction('kv', 'readonly').objectStore('kv').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); } catch (e) { res(null); } }; o.onerror = () => res(null); } catch (e) { res(null); } }); }
  async function loadAvg() {
    if (avgVol) return avgVol; avgVol = {};
    const H = await idbGet('ovn_hist');
    if (H && H.rows) for (const s in H.rows) { const r = H.rows[s].slice(-20).map((x) => x[5]).filter((v) => v > 0); if (r.length >= 10) avgVol[s] = r.reduce((a, b) => a + b, 0) / r.length; }
    const B = await idbGet('brief_sec_avg'); if (B && B.v) for (const s in B.v) if (!avgVol[s]) avgVol[s] = B.v[s];
    return avgVol;
  }
  function parseIntra(j) {
    const c = ((j && j.data && j.data.candles) || []).map((x) => { const t = String(x[0]), hh = +t.slice(11, 13), mm = +t.slice(14, 16); return [hh * 60 + mm - 555, x[1], x[2], x[3], x[4], x[5] || 0, t.slice(0, 10)]; });
    const d = day(); return c.filter((x) => x[6] === d).sort((a, b) => a[0] - b[0]);
  }
  async function scan(force) {
    if (busy) return; const m = mins();
    if (!force && Date.now() - last < EVERY - 2000) return;
    if (boxDay !== day()) { box = {}; boxDay = day(); }
    busy = true; err = '';
    try {
      if (!live()) { demo(); return; }
      if (m < OR_END) { Q = null; return; }
      await loadAvg();
      const r = await Source.raw('/api/eod'); Q = r.q || {};
      const all = Object.entries(Q).filter(([, x]) => !x.idx && x.c > 0 && x.h > x.l);
      const want = all.filter(([s, x]) => !box[s] && ((x.h - x.c) / x.c <= 0.004 || (x.c - x.l) / x.c <= 0.004 || Math.abs(x.c / x.pc - 1) >= 0.012))
        .sort((a, b) => Math.abs(b[1].c / b[1].pc - 1) - Math.abs(a[1].c / a[1].pc - 1)).slice(0, MAXNEW);
      for (let i = 0; i < want.length; i += 5) {
        await Promise.all(want.slice(i, i + 5).map(async ([s, x]) => {
          try { const c = parseIntra(await Source.raw('/api/intra?key=' + encodeURIComponent(x.key))); const b = boxOf(c); box[s] = b ? { ...b, ts: Date.now() } : { none: true, ts: Date.now() }; }
          catch (e) { if (e.code === 'UPSTOX_RATE') throw e; if (/404|not found/i.test(e.message)) throw new Error('Deploy the new Worker code (the /api/intra endpoint is missing).'); }
        }));
        await sleep(150);
      }
      // boxes already known: the break time can change, so refresh up to 8 of the active ones a scan
      const stale = all.filter(([s]) => box[s] && !box[s].none && Date.now() - box[s].ts > 6 * 60e3).sort((a, b) => Math.abs(b[1].c / b[1].pc - 1) - Math.abs(a[1].c / a[1].pc - 1)).slice(0, 8);
      for (const [s, x] of stale) { try { const b = boxOf(parseIntra(await Source.raw('/api/intra?key=' + encodeURIComponent(x.key)))); if (b) box[s] = { ...b, ts: Date.now() }; } catch (e) { break; } }
    } catch (e) { err = e.message; }
    finally { busy = false; last = Date.now(); rerender(); }
  }
  function rows() {
    if (!Q) return [];
    const m = live() ? mins() : 150, out = [];
    for (const s in box) { const b = box[s]; if (!b || b.none) continue; const r = read(s, Q[s], b, avgVol && avgVol[s], m); if (r) out.push(r); }
    return out;
  }
  const lists = () => {
    const R = rows(), by = (a, b) => b.q - a.q || Math.abs(a.dist) - Math.abs(b.dist);
    return { up: R.filter((x) => x.side === 'up').sort(by), dn: R.filter((x) => x.side === 'dn').sort(by), near: R.filter((x) => x.near).sort((a, b) => (b.pace || 0) - (a.pace || 0)) };
  };
  const count = () => { const L = lists(); return Q ? L.up.length + L.dn.length : ''; };

  /* ---------- screen (a panel inside the Screener) ---------- */
  function rerender() { if (document.getElementById('orbPanel') && typeof Markets !== 'undefined' && Markets.setScr) Markets.setScr('orb'); }
  function tick() { if (!document.getElementById('orbPanel')) { clearInterval(timer); timer = null; return; } scan(false); }
  function panelHTML() {
    if (!timer) { timer = setInterval(tick, 15e3); setTimeout(() => scan(false), 50); }
    const m = live() ? mins() : 150, L = lists();
    let h = `<div id="orbPanel" class="orbx">`;
    h += `<div class="gd-mean"><b>आसान मतलब:</b> सुबह 9:15 से 9:30 तक के high और low को एक "डिब्बा" मानिए। भाव डिब्बे से <b class="up">ऊपर</b> निकले और volume ज़्यादा हो, तो खरीदार मज़बूत हैं; <b class="dn">नीचे</b> निकले तो बेचने वाले। यह सिर्फ़ research की list है, CALL/PUT signal नहीं।</div>`;
    if (live() && m < OR_END) return h + `<div class="alert i">The opening range is the first 15 minutes (9:15–9:30). This scan starts at 9:30.</div></div>`;
    if (live() && m > 375) h += `<div class="alert i">Market is closed. This shows how today's breakouts stood at the close.</div>`;
    h += `<div class="scan-bar"><div><span>${busy ? 'Scanning…' : last ? `Last scan ${new Date(last).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · ${Object.keys(box).length} stocks' boxes read${live() ? '' : ' · sample data'}` : 'Starting…'}</span></div><button class="btn" onclick="Orb.scan(true)" ${busy ? 'disabled' : ''}>Scan Now</button></div>`;
    if (err) h += `<div class="alert">${esc(err)}</div>`;
    const tbl = (list, side) => list.length ? `<div class="tblw"><table><thead><tr><th class="l">Stock</th><th>Price</th><th>Today</th><th>Box (9:15–9:30)</th><th>${side === 'up' ? 'Above' : 'Below'} box</th><th>Broke at</th><th>Volume pace</th><th>Stop if wrong</th><th class="l">Read</th><th></th></tr></thead><tbody>${list.slice(0, 15).map((x) => `<tr>
      <td class="l nm"><b>${esc(x.sym)}</b>${x.q >= 2 ? '<small class="up">clean</small>' : x.q <= 0 ? '<small class="dn">weak</small>' : ''}</td><td>${f2(x.price)}</td><td class="${x.chg >= 0 ? 'up' : 'dn'}">${x.chg >= 0 ? '+' : ''}${f2(x.chg)}%</td>
      <td>${f2(x.lo)}–${f2(x.hi)}</td><td class="${side === 'up' ? 'up' : 'dn'}">${f2(Math.abs(x.dist) * 100)}%</td><td>${ok(x.at) ? hhmm(x.at) : '–'}</td><td>${ok(x.pace) ? f1(x.pace) + '×' : '<span class="mut">no history</span>'}</td>
      <td>${x.stop ? `${f2(x.stop)} <small class="mut">(${f1(x.risk * 100)}%)</small>` : '–'}</td><td class="l"><div class="why">${x.notes.map((t) => `<span>${esc(t)}</span>`).join('')}</div></td>
      <td><button class="btn ghost" onclick="Markets.analyze('${esc(x.sym)}')">Analyze</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="mut">${Q ? 'None right now.' : busy ? 'Reading…' : ''}</div>`;
    h += `<div class="ph"><h2 class="up">▲ Breaking above the box (${L.up.length})</h2></div>${tbl(L.up, 'up')}`;
    h += `<div class="ph" style="margin-top:14px"><h2 class="dn">▼ Breaking below the box (${L.dn.length})</h2></div>${tbl(L.dn, 'dn')}`;
    if (L.near.length) h += `<div class="ph" style="margin-top:14px"><h2>Watch: sitting at the edge of the box</h2></div><div class="why" style="margin-bottom:8px">${L.near.slice(0, 12).map((x) => `<span class="${x.near === 'up' ? 'up' : 'dn'}">${esc(x.sym)} ${x.near === 'up' ? 'at the top' : 'at the bottom'}</span>`).join('')}</div>`;
    h += `<div class="legend">"Volume pace" compares today's volume so far with a normal day's volume by this time (needs the Overnight page's history; rough, as volume is heavier at the open and close). "Clean" = heavy volume, a tight box and not too far past it. "Stop if wrong" is the other side of the box. Breakouts fail often, more so on low volume and after 2 pm: this list finds candidates, the chart and your rules decide. Only stocks near their high or low or moving 1.2%+ are read, so a quiet stock can be missing. Not back-tested.</div>`;
    return h + '</div>';
  }

  /* ---------- demo ---------- */
  function demo() {
    const syms = [['TATASTEEL', 168, 1], ['BEL', 412, 1], ['DIXON', 14200, 1], ['HAL', 4710, 1], ['POLYCAB', 7020, 1], ['TRENT', 6900, -1], ['INFY', 1510, -1], ['LUPIN', 1880, -1], ['ICICIBANK', 1342, 0], ['SBIN', 905, 1], ['HINDALCO', 702, 1], ['WIPRO', 252, -1], ['COFORGE', 1720, 0]];
    Q = {}; demoSeed++;
    syms.forEach(([s, p, d], i) => { const w = 0.006 + (i % 4) * 0.003, lo = p * (1 - w / 2), hi = p * (1 + w / 2), c = d > 0 ? hi * (1 + 0.002 + (i % 3) * 0.004) : d < 0 ? lo * (1 - 0.002 - (i % 3) * 0.004) : hi * 0.9985;
      Q[s] = { c, pc: p * (1 - d * 0.006), h: Math.max(hi, c), l: Math.min(lo, c), v: 1e6 * (1 + (i % 5) * 0.5) };
      box[s] = { hi, lo, v: 2e5, up: d > 0 ? 40 + i * 7 : i === 7 ? 30 : null, dn: d < 0 ? 55 + i * 6 : null, n: 15, ts: Date.now() };
      (avgVol || (avgVol = {}))[s] = 1.1e6; });
  }
  return { scan, panelHTML, count, lists, boxOf, read, parseIntra };
})();
if (typeof module !== 'undefined') module.exports = Orb;
