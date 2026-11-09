/* ===== Replay and backtest page =====
   1. Download ~60 days of 1-minute candles (Nifty, Bank Nifty, Sensex, India VIX) from Upstox through the Worker.
   2. Replay any day minute by minute: the engine sees only what it would have seen live; you paper-trade along.
   3. Backtest all days: the engine trades every day by the paper-trade rules; see where it was right and wrong. */
const Replay = (() => {
  let data = null, R = null, timer = null, bt = null;
  const $r = (id) => document.getElementById(id);
  const LOT = { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 };
  const lotOf = (k) => (APP_CONFIG.LOT_FALLBACK && APP_CONFIG.LOT_FALLBACK[k]) || LOT[k] || 1;
  const HZN = { short: 'Short (1-min)', intra: 'Intraday (5-min)', long: 'Long run (daily)' };
  const dayName = (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T00:00:00Z').getUTCDay()];

  /* ---------- saved data (IndexedDB, falls back to memory) ---------- */
  function idb(mode, fn) {
    return new Promise((res) => {
      try {
        const o = indexedDB.open('fno_bt', 1);
        o.onupgradeneeded = () => o.result.createObjectStore('kv');
        o.onsuccess = () => { try { const tx = o.result.transaction('kv', mode), st = tx.objectStore('kv'), q = fn(st); tx.oncomplete = () => res(q && q.result); tx.onerror = () => res(null); } catch (e) { res(null); } };
        o.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  const save = (d) => idb('readwrite', (st) => st.put(d, 'hist'));
  const load = () => idb('readonly', (st) => st.get('hist'));

  /* ---------- download from Upstox ---------- */
  const ymdOf = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function download() {
    if (Source.mode !== 'live') return toast('Downloading needs live mode (log in with your Upstox-connected Worker).');
    const btn = $r('rpDl'); btn.disabled = true;
    const now = Date.now(), wins = [[0, 27], [28, 55], [56, 83]];
    const list = BT.INST.map(([k, key]) => ({ k, key }));
    const out = { v: 1, created: new Date().toISOString(), inst: {} };
    let done = 0; const total = list.length * (wins.length + 1);
    const prog = (t) => { $r('rpProg').style.width = Math.round((done / total) * 100) + '%'; $r('rpDataTxt').textContent = t; };
    try {
      for (const it of list) {
        const m1 = {}; let d1 = [];
        for (const [a, b] of wins) {
          prog(`Downloading ${it.k}: ${ymdOf(now - b * 864e5)} to ${ymdOf(now - a * 864e5)}…`);
          const j = await fetchRetry(`/api/hist?key=${encodeURIComponent(it.key)}&unit=minutes&iv=1&from=${ymdOf(now - b * 864e5)}&to=${ymdOf(now - a * 864e5)}`);
          Object.assign(m1, BT.parse(j && j.data && j.data.candles));
          done++; await sleep(400);
        }
        prog(`Downloading ${it.k}: daily candles, 1 year…`);
        const j = await fetchRetry(`/api/hist?key=${encodeURIComponent(it.key)}&unit=days&iv=1&from=${ymdOf(now - 400 * 864e5)}&to=${ymdOf(now)}`);
        d1 = BT.parseDaily(j && j.data && j.data.candles); done++; await sleep(400);
        out.inst[it.k] = { key: it.key, m1, d1 };
      }
      data = out; await save(out); prog(''); info(); toast('History downloaded. Pick a day to replay, or run the backtest.');
    } catch (e) { $r('rpDataTxt').textContent = 'Download stopped: ' + e.message + (e.code === 'UPSTOX_RATE' ? ' (try again in a few minutes)' : /hist|404|Not found/i.test(e.message) ? ' (deploy the new Worker code first)' : ''); }
    btn.disabled = false;
  }
  async function fetchRetry(p) {
    for (let i = 0; i < 3; i++) {
      try { return await Source.raw(p); } catch (e) { if (e.code === 'UPSTOX_RATE' && i < 2) { $r('rpDataTxt').textContent = 'Upstox asked to slow down, waiting 60 s…'; await sleep(61000); continue; } throw e; }
    }
  }
  function saveFile() {
    if (!data) return toast('Download the history first.');
    const b = new Blob([JSON.stringify(data)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = `fno-history-${ymdOf(Date.now())}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function loadFile(f) {
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => { try { const j = JSON.parse(rd.result); if (!j.inst) throw new Error('not a history file'); data = j; await save(j); info(); toast('History file loaded.'); } catch (e) { toast('Could not read that file: ' + e.message); } };
    rd.readAsText(f);
  }
  function info() {
    const box = $r('rpDataTxt');
    if (!data) { box.textContent = 'No history yet. Download it once (about a minute); it is kept in this browser.'; return; }
    const parts = Object.keys(data.inst).filter((k) => k !== 'VIX').map((k) => { const d = BT.dates(data, k); return d.length ? `${k} ${d.length} days (${d[0]} to ${d[d.length - 1]})` : `${k}: none`; });
    box.textContent = 'Loaded: ' + parts.join(' · ') + `. Saved ${data.created ? data.created.slice(0, 10) : ''}.`;
    fillDays();
  }

  /* ---------- page ---------- */
  function build() {
    if ($r('rp')) return;
    const el = document.createElement('div'); el.id = 'rp'; el.className = 'rp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Replay and backtest');
    el.innerHTML = `
    <div class="rp-top"><h2>Replay and backtest</h2><span class="mut">Practise on past days and check how the engine would have done. Paper money only.</span><button class="x" onclick="Replay.close()" aria-label="Close">✕</button></div>
    <div class="rp-data"><div class="rp-dtxt"><span id="rpDataTxt"></span><div class="rp-pbar"><i id="rpProg"></i></div></div>
      <button class="btn" id="rpDl" onclick="Replay.download()">Download last ~60 days from Upstox</button>
      <button class="btn ghost" onclick="Replay.saveFile()">Save as file</button>
      <label class="btn ghost">Load file<input type="file" accept=".json,application/json" hidden onchange="Replay.loadFile(this.files[0])"></label></div>
    <div class="rp-bar">
      <label>Instrument <select id="rpInst" onchange="Replay.fillDays()"><option>NIFTY</option><option>BANKNIFTY</option><option>SENSEX</option></select></label>
      <label>Day <select id="rpDay"></select></label>
      <label>Engine <select id="rpHz"><option value="intra">Intraday (5-min)</option><option value="short">Short (1-min)</option><option value="long">Long run (daily)</option></select></label>
      <label class="chk"><input type="checkbox" id="rpHide"> Training mode: hide engine signals till the day ends</label>
      <button class="btn" onclick="Replay.start()">Start replay</button>
      <button class="btn ghost" onclick="Replay.backtest()">Backtest all days</button>
    </div>
    <div class="rp-main">
      <div class="rp-chartbox">
        <canvas id="rpCv" aria-label="Replay chart"></canvas>
        <div class="rp-ctl">
          <button class="btn" id="rpPlay" onclick="Replay.toggle()">▶ Play</button>
          <span class="seg" id="rpSpd">${[1, 3, 10, 30].map((s) => `<button data-s="${s}" onclick="Replay.speed(${s})">${s}×</button>`).join('')}</span>
          <button class="btn ghost" onclick="Replay.adv(1)">+1 min</button><button class="btn ghost" onclick="Replay.adv(15)">+15 min</button>
          <span class="rp-clock" id="rpClock">–</span>
        </div>
        <div class="legend">1× = one minute of market time per second (a full day in about 6 minutes). Arrows: engine CALL ▲ / PUT ▼ when it changed. Circles: your trades.</div>
      </div>
      <aside class="rp-side">
        <div class="rp-eng" id="rpEng"></div>
        <div class="rp-me">
          <div class="sec" style="margin-top:0">Your paper trade</div>
          <div class="rp-buy"><button class="btn-solid ce" onclick="Replay.buy('CE')">Buy CALL</button><button class="btn-solid pe" onclick="Replay.buy('PE')">Buy PUT</button>
            <label>Lots <input type="number" id="rpLots" value="1" min="1" max="50"></label><label>Stop (pts) <input type="number" id="rpSL" placeholder="auto"></label></div>
          <div id="rpPos"></div>
        </div>
        <div id="rpLog"></div>
      </aside>
    </div>
    <div id="rpBt"></div>`;
    document.body.appendChild(el);
    try { $r('rpHz').value = HZ; } catch (e) { /* default */ }
    speed(Store.pref ? +Store.pref('rpSpd', 3) || 3 : 3);
    addEventListener('resize', () => R && draw());
  }
  async function open() {
    build(); $r('rp').classList.add('on'); document.body.style.overflow = 'hidden';
    if (!data) data = await load();
    info();
  }
  function close() { pause(); const el = $r('rp'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; }
  function fillDays() {
    if (!data) return;
    const k = $r('rpInst').value, ds = BT.dates(data, k).slice(2).reverse(), X = data.inst[k];
    $r('rpDay').innerHTML = ds.map((d) => { const b = X.m1[d], all = BT.dates(data, k), p = X.m1[all[all.indexOf(d) - 1]], pc = p[p.length - 1][4], c = b[b.length - 1][4], ch = ((c - pc) / pc) * 100;
      return `<option value="${d}">${dayName(d)} ${d} (${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%)${b.length < 370 ? ' partial' : ''}</option>`; }).join('');
  }

  /* ---------- replay ---------- */
  function start() {
    if (!data) return toast('Download the history first.');
    pause();
    const k = $r('rpInst').value, date = $r('rpDay').value; if (!date) return toast('Pick a day.');
    BT.resetMemory();
    const bars = data.inst[k].m1[date];
    R = { k, date, hz: $r('rpHz').value, bars, i: 0, shown: [], sig: [], last: null, prevSt: 'WAIT', me: null, mine: [], eng: [], engOpen: null, hide: $r('rpHide').checked, ended: false,
      sim: null, pc: (() => { const all = BT.dates(data, k), p = data.inst[k].m1[all[all.indexOf(date) - 1]]; return p[p.length - 1][4]; })() };
    R.sim = engineTrader();
    // skip the first 15 minutes quickly (engine is locked then anyway)
    while (R.i < bars.length && bars[R.i][0] < 15) stepOne(true);
    draw(); side(); play();
  }
  function engineTrader() {
    // same rules as the backtest: shows where the engine itself would have entered and exited
    const T = { open: null };
    T.on = (m, bar, a, s) => {
      const o = T.open;
      if (o) {
        const sd = o.dir === 'CE' ? 1 : -1, adv = sd > 0 ? bar.l : bar.h, fav = sd > 0 ? bar.h : bar.l; let ex = null;
        if ((adv - o.sl) * sd <= 0) ex = [o.sl, o.be ? 'Trailing/breakeven stop' : 'Stop-loss'];
        else if ((fav - o.t2) * sd >= 0) ex = [o.t2, 'Target 2'];
        else if (m >= 365) ex = [bar.c, '15:20 square-off'];
        else if ((s.state === 'CE' || s.state === 'PE') && s.state !== o.dir && m - o.m >= 5) ex = [bar.c, 'Opposite signal'];
        if (!ex) { const g = (bar.c - o.e) * sd; if (g >= o.risk) o.be = true; if (o.be) { const tr = bar.c - sd * o.risk; if ((tr - o.sl) * sd > 0) o.sl = tr; if ((o.e - o.sl) * sd > 0) o.sl = o.e; } }
        if (ex) { R.eng.push({ ...o, x: ex[0], xm: m, why: ex[1], pts: (ex[0] - o.e) * sd - BT.COST_PTS }); T.open = null; }
      }
      if (!T.open && (s.state === 'CE' || s.state === 'PE') && m < 345) { const st = setupFor(a, s.state); T.open = { dir: s.state, strength: s.strength || '', m, e: bar.c, sl: st.sl, t2: st.t2, risk: st.risk, be: false }; }
    };
    return T;
  }
  function stepOne(quiet) {
    if (!R || R.i >= R.bars.length) return false;
    const c = R.bars[R.i++], bar = { m: c[0], o: c[1], h: c[2], l: c[3], c: c[4] };
    R.shown.push(bar);
    const r = BT.step(data, R.k, R.date, bar.m, R.hz);
    if (r) {
      R.last = r;
      const st = r.s.state;
      if ((st === 'CE' || st === 'PE') && st !== R.prevSt) R.sig.push({ m: bar.m, st, p: bar.c, str: r.s.strength || '' });
      R.prevSt = st;
      R.sim.on(bar.m, bar, r.a, r.s);
    }
    myTick(bar);
    if (R.i >= R.bars.length) end();
    if (!quiet) { draw(); side(); }
    return true;
  }
  function play() {
    if (!R || R.ended) return; pause();
    const sp = curSpd, per = sp > 10 ? Math.round(sp / 10) : 1, iv = sp > 10 ? 100 : 1000 / sp;
    timer = setInterval(() => { for (let j = 0; j < per; j++) stepOne(j < per - 1); if (!R || R.ended) pause(); }, iv);
    $r('rpPlay').textContent = '⏸ Pause';
  }
  function pause() { if (timer) clearInterval(timer); timer = null; const b = $r('rpPlay'); if (b) b.textContent = '▶ Play'; }
  function toggle() { if (timer) pause(); else if (R && !R.ended) play(); else start(); }
  let curSpd = 3;
  function speed(s) { curSpd = s; document.querySelectorAll('#rpSpd button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s)); try { Store.setPref('rpSpd', s); } catch (e) { /* ignore */ } if (timer) play(); }
  function adv(n) { if (!R) return; for (let j = 0; j < n; j++) stepOne(j < n - 1); }

  /* ---------- your paper trades ---------- */
  function buy(dir) {
    if (!R || !R.shown.length) return toast('Start a replay first.');
    if (R.ended) return toast('The day has ended.');
    const bar = R.shown[R.shown.length - 1], lots = Math.max(1, +$r('rpLots').value || 1);
    if (R.me) exitMine('Switched side');
    const a = R.last && R.last.a, slPts = +$r('rpSL').value || (a ? Math.round(1.5 * a.atr) : 30);
    R.me = { dir, m: bar.m, e: bar.c, sl: bar.c - (dir === 'CE' ? 1 : -1) * slPts, lots, eng: R.last ? R.last.s.state : 'WAIT', engTitle: R.last ? R.last.s.title : '' };
    side(); draw();
  }
  function myTick(bar) {
    const o = R.me; if (!o) return;
    const sd = o.dir === 'CE' ? 1 : -1;
    if (((sd > 0 ? bar.l : bar.h) - o.sl) * sd <= 0) exitMine('Your stop-loss', o.sl);
    else if (bar.m >= 365) exitMine('15:20 square-off');
  }
  function exitMine(why, px) {
    const o = R.me; if (!o) return;
    const bar = R.shown[R.shown.length - 1], x = ok(px) ? px : bar.c, sd = o.dir === 'CE' ? 1 : -1, pts = (x - o.e) * sd - BT.COST_PTS;
    R.mine.push({ ...o, x, xm: bar.m, why: why || 'You exited', pts, rs: pts * 0.5 * lotOf(R.k) * o.lots });
    R.me = null; side(); draw();
  }
  function end() {
    R.ended = true; pause();
    if (R.me) exitMine('Day end');
    if (R.sim.open) { const o = R.sim.open, b = R.shown[R.shown.length - 1], sd = o.dir === 'CE' ? 1 : -1; R.eng.push({ ...o, x: b.c, xm: b.m, why: 'Day end', pts: (b.c - o.e) * sd - BT.COST_PTS }); R.sim.open = null; }
    R.hide = false; side(); draw();
  }

  /* ---------- drawing ---------- */
  function draw() {
    const cv = $r('rpCv'); if (!cv || !R) return;
    const W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), C = (n, f) => (css.getPropertyValue(n) || f).trim();
    const up = C('--call', '#00F5A0'), dn = C('--put', '#FF3B6B'), mut = C('--dim', '#4A5B78'), cy = C('--cyan', '#00E5FF'), tx = C('--muted', '#7F93B2');
    const bs = R.shown; if (!bs.length) return;
    let hi = Math.max(R.pc, ...bs.map((b) => b.h)), lo = Math.min(R.pc, ...bs.map((b) => b.l)); const pad = (hi - lo) * 0.08 || 10; hi += pad; lo -= pad;
    const L = 8, Rr = 58, T = 10, B = 22, x = (m) => L + ((W - L - Rr) * (m + 0.5)) / 375, y = (p) => T + ((H - T - B) * (hi - p)) / (hi - lo), bw = Math.max(1, ((W - L - Rr) / 375) * 0.7);
    g.font = '11px IBM Plex Sans, system-ui'; g.fillStyle = tx; g.strokeStyle = 'rgba(0,229,255,.08)'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const p = lo + ((hi - lo) * i) / 4, yy = y(p); g.beginPath(); g.moveTo(L, yy); g.lineTo(W - Rr, yy); g.stroke(); g.fillText(Math.round(p), W - Rr + 4, yy + 4); }
    for (let m = 45; m < 375; m += 60) { g.fillText(hm(m), x(m) - 14, H - 6); }
    g.setLineDash([4, 4]); g.strokeStyle = mut; g.beginPath(); g.moveTo(L, y(R.pc)); g.lineTo(W - Rr, y(R.pc)); g.stroke(); g.setLineDash([]); g.fillStyle = mut; g.fillText('prev close', L + 2, y(R.pc) - 4);
    bs.forEach((b) => { const c = b.c >= b.o ? up : dn; g.strokeStyle = c; g.fillStyle = c; g.beginPath(); g.moveTo(x(b.m), y(b.h)); g.lineTo(x(b.m), y(b.l)); g.stroke(); const t = y(Math.max(b.o, b.c)), h2 = Math.max(1, Math.abs(y(b.o) - y(b.c))); g.fillRect(x(b.m) - bw / 2, t, bw, h2); });
    // average price line (index has no volume: time-weighted)
    let s = 0; g.strokeStyle = cy; g.globalAlpha = 0.7; g.beginPath(); bs.forEach((b, i) => { s += (b.h + b.l + b.c) / 3; const v = s / (i + 1); i ? g.lineTo(x(b.m), y(v)) : g.moveTo(x(b.m), y(v)); }); g.stroke(); g.globalAlpha = 1;
    if (!R.hide) {
      R.sig.forEach((q) => { const yy = q.st === 'CE' ? y(bs.find((b) => b.m === q.m).l) + 12 : y(bs.find((b) => b.m === q.m).h) - 12; g.fillStyle = q.st === 'CE' ? up : dn; g.beginPath(); const xx = x(q.m); if (q.st === 'CE') { g.moveTo(xx, yy - 8); g.lineTo(xx - 6, yy + 3); g.lineTo(xx + 6, yy + 3); } else { g.moveTo(xx, yy + 8); g.lineTo(xx - 6, yy - 3); g.lineTo(xx + 6, yy - 3); } g.fill(); });
    }
    const mark = (t, col) => { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x(t.m), y(t.e), 5, 0, 7); g.stroke(); if (ok(t.xm)) { g.beginPath(); g.moveTo(x(t.xm) - 4, y(t.x) - 4); g.lineTo(x(t.xm) + 4, y(t.x) + 4); g.moveTo(x(t.xm) + 4, y(t.x) - 4); g.lineTo(x(t.xm) - 4, y(t.x) + 4); g.stroke(); g.globalAlpha = 0.5; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x(t.m), y(t.e)); g.lineTo(x(t.xm), y(t.x)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; } g.lineWidth = 1; };
    R.mine.forEach((t) => mark(t, '#FFFFFF')); if (R.me) mark(R.me, '#FFFFFF');
    if (R.me) { g.setLineDash([2, 3]); g.strokeStyle = C('--warn', '#FFB547'); g.beginPath(); g.moveTo(x(R.me.m), y(R.me.sl)); g.lineTo(W - Rr, y(R.me.sl)); g.stroke(); g.setLineDash([]); }
    const lb = bs[bs.length - 1]; g.fillStyle = cy; g.fillRect(W - Rr, y(lb.c) - 8, Rr, 16); g.fillStyle = '#04070D'; g.fillText(Math.round(lb.c), W - Rr + 4, y(lb.c) + 4);
  }
  function side() {
    if (!R) return;
    const bar = R.shown[R.shown.length - 1], r = R.last;
    $r('rpClock').textContent = bar ? `${R.date} ${hm(bar.m)} · ${f1(bar.c)} (${sgn(bar.c - R.pc)}${f1(bar.c - R.pc)})` : '–';
    // engine
    let h = '';
    if (R.hide && !R.ended) h = '<div class="rp-hidden"><b>Engine hidden (training mode)</b><span>Decide on your own. The engine\'s signals and trades appear when the day ends, so you can compare.</span></div>';
    else if (r) {
      const s = r.s, cls = s.state === 'CE' ? 'up' : s.state === 'PE' ? 'dn' : 'n', a = r.a;
      const chip = (n, x) => x ? `<span class="pill ${x.dir === 'CE' ? 'b' : x.dir === 'PE' ? 's' : 'n'}">${n} ${x.dir ? (x.dir === 'CE' ? 'CALL' : 'PUT') : 'WAIT'} ${Math.round(x.score)}</span>` : '';
      h = `<div class="rp-sig ${cls}"><small>Engine (${HZN[R.hz]}) at ${hm(bar.m)}</small><b>${esc(s.title)}</b><span>${esc(s.sub || '')}</span></div>
        <div class="rp-chips">${chip('Short', a.short)}${chip('Intra', a.intra)}${chip('Long', a.long)}</div>
        ${a.stx ? `<div class="rp-stx">${esc(a.stx.label)}</div>` : ''}`;
    }
    $r('rpEng').innerHTML = h;
    // my position
    const o = R.me;
    if (o && bar) { const sd = o.dir === 'CE' ? 1 : -1, pts = (bar.c - o.e) * sd; $r('rpPos').innerHTML = `<div class="rp-open ${pts >= 0 ? 'up' : 'dn'}"><span>${o.dir === 'CE' ? 'CALL' : 'PUT'} since ${hm(o.m)} @ ${f1(o.e)} · stop ${f1(o.sl)}</span><b>${sgn(pts)}${f1(pts)} pts ≈ ₹${f0(pts * 0.5 * lotOf(R.k) * o.lots)}</b><button class="btn" onclick="Replay.exitMine()">Exit</button></div>`; }
    else $r('rpPos').innerHTML = `<div class="mut" style="font-size:12.5px">No open trade. ₹ is approximate: an ATM option moves about half the index points (delta 0.5) × lot size ${lotOf(R.k)}.</div>`;
    // trades
    const row = (t, who) => `<tr><td class="l">${who}</td><td class="l"><span class="pill ${t.dir === 'CE' ? 'b' : 's'}">${t.dir === 'CE' ? 'CALL' : 'PUT'}</span></td><td>${hm(t.m)}</td><td>${hm(t.xm)}</td><td class="${t.pts >= 0 ? 'up' : 'down'}">${sgn(t.pts)}${f1(t.pts)}</td><td class="l mut">${esc(t.why)}${who === 'You' && t.eng ? ` · engine said ${t.eng === 'CE' ? 'CALL' : t.eng === 'PE' ? 'PUT' : 'WAIT'}` : ''}</td></tr>`;
    const engT = R.hide && !R.ended ? [] : R.eng;
    const sum = (a) => a.reduce((s, t) => s + t.pts, 0);
    let lg = `<div class="sec">Trades today</div>`;
    if (R.mine.length || engT.length) lg += `<div class="tbl"><table><thead><tr><th class="l">Who</th><th class="l">Side</th><th>In</th><th>Out</th><th>Pts</th><th class="l">Exit</th></tr></thead><tbody>${[...R.mine.map((t) => [t, 'You']), ...engT.map((t) => [t, 'Engine'])].sort((p, q) => p[0].m - q[0].m).map(([t, w]) => row(t, w)).join('')}</tbody></table></div>`;
    else lg += '<div class="mut" style="font-size:12.5px">No trades yet.</div>';
    if (R.ended) {
      const me = sum(R.mine), en = sum(R.eng), mw = R.mine.filter((t) => t.pts > 0).length, ew = R.eng.filter((t) => t.pts > 0).length;
      lg += `<div class="rp-res"><div><small>You</small><b class="${me >= 0 ? 'up' : 'down'}">${sgn(me)}${f1(me)} pts</b><span>${R.mine.length} trades, ${mw} right · ≈ ₹${f0(R.mine.reduce((s, t) => s + t.rs, 0))}</span></div><div><small>Engine</small><b class="${en >= 0 ? 'up' : 'down'}">${sgn(en)}${f1(en)} pts</b><span>${R.eng.length} trades, ${ew} right</span></div></div>
        <div class="legend">Points are after ${BT.COST_PTS} pts of costs per trade. "Right" = closed in profit. Look at the chart: where did you or the engine enter against the trend?</div>`;
    }
    $r('rpLog').innerHTML = lg;
  }

  /* ---------- backtest all days ---------- */
  async function backtest() {
    if (!data) return toast('Download the history first.');
    pause();
    const k = $r('rpInst').value, hz = $r('rpHz').value, ds = BT.dates(data, k).slice(2), box = $r('rpBt'), days = [];
    bt = { k, hz, days };
    for (let i = 0; i < ds.length; i++) {
      box.innerHTML = `<div class="sec">Backtesting ${k}, ${HZN[hz]}: day ${i + 1} of ${ds.length} (${ds[i]})…</div><div class="rp-pbar"><i style="width:${Math.round((i / ds.length) * 100)}%"></i></div>`;
      await sleep(10);
      days.push(BT.runDay(data, k, ds[i], hz));
    }
    BT.resetMemory();
    renderBt();
  }
  function renderBt() {
    const box = $r('rpBt'); if (!bt) return;
    const S = BT.summary(bt.days), card = (t, v, sub, cls) => `<div class="rp-card"><small>${t}</small><b class="${cls || ''}">${v}</b><span>${sub || ''}</span></div>`;
    let h = `<div class="sec">Backtest: ${bt.k}, ${HZN[bt.hz]}, ${S.days} days</div><div class="rp-cards">
      ${card('Net result', `${sgn(S.netPts)}${S.netPts} pts`, `after ${BT.COST_PTS} pts cost per trade`, S.netPts >= 0 ? 'up' : 'down')}
      ${card('Trades right', S.winPct === null ? '–' : S.winPct + '%', `${S.trades} trades · avg win ${S.avgWin}, avg loss ${S.avgLoss}`)}
      ${card('Direction right (next 15 min)', S.dirAcc === null ? '–' : S.dirAcc + '%', 'when it showed CALL or PUT')}
      ${card('Time on WAIT', S.waitPct + '%', 'of market minutes')}
      ${card('Wrong-way minutes', S.wrongWayMin, 'CALL shown before a 0.4% fall (or PUT before a rise)', S.wrongWayMin ? 'down' : '')}
      ${card('Biggest move of the day', `${S.bigMoveCaught} of ${S.days} caught`, S.avgCatchDelayMin === null ? '' : `on average ${S.avgCatchDelayMin} min late, after ${S.avgCatchPctOfMove}% of the move`)}
      ${card('Strong vs mild', `${S.strong.winPct ?? '–'}% / ${S.mild.winPct ?? '–'}%`, `right: ${S.strong.n} strong, ${S.mild.n} mild trades`)}
      ${card('Worst losing run', `${S.maxDrawdownPts} pts`, 'peak-to-low of the running total')}</div>`;
    h += `<div class="tbl"><table><thead><tr><th class="l">Day</th><th>Day move</th><th>Trades</th><th>Right</th><th>Pts</th><th>Direction right</th><th>WAIT</th><th>Wrong-way min</th><th class="l">Biggest move caught?</th><th></th></tr></thead><tbody>` +
      bt.days.slice().reverse().map((d) => { const s = d.stats, X = data.inst[bt.k].m1[d.date], ch = X[X.length - 1][4] - X[0][1];
        return `<tr><td class="l">${dayName(d.date)} ${d.date}</td><td class="${ch >= 0 ? 'up' : 'down'}">${sgn(ch)}${f0(ch)}</td><td>${s.trades}</td><td>${s.wins}</td><td class="${s.pts >= 0 ? 'up' : 'down'}">${sgn(s.pts)}${f1(s.pts)}</td><td>${s.dirAcc ?? '–'}%</td><td>${s.waitPct}%</td><td>${s.wrongWay}</td>
          <td class="l">${s.move ? `${s.move.dir === 'CE' ? 'Up' : 'Down'} ${f0(s.move.size)} pts: ${s.caught ? `yes, ${s.caught.mins} min late` : '<span class="down">missed</span>'}` : '–'}</td><td><button class="btn ghost" onclick="Replay.openDay('${d.date}')">Replay</button></td></tr>`; }).join('') + '</tbody></table></div>';
    h += `<div class="legend">Engine trades follow the paper-trade rules: enter on CALL/PUT, stop 1.5 ATR (or beyond the pullback), breakeven at 1R then trail, exit at 2.5R, on an opposite signal after 5 minutes, or at 15:20. Prices are index points; option P&L is roughly half of this per lot unit. No option-chain or news data from the past is used, so OI and news tools are silent in backtests.</div>`;
    box.innerHTML = h;
  }
  function openDay(d) { $r('rpDay').value = d; $r('rpHide').checked = false; start(); $r('rp').scrollTo({ top: 0, behavior: 'smooth' }); }

  return { open, close, download, saveFile, loadFile, fillDays, start, toggle, speed, adv, buy, exitMine: () => exitMine('You exited'), backtest, openDay, get data() { return data; } };
})();
