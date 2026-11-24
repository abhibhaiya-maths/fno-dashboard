/* ===== Chart modes: "Manual tools" (as before) or "Auto setup" =====
   Auto setup does what a trader does before taking a trade, live, on the chart:
   1. picks the tools that suit today (trend day: VWAP, EMA 20, Supertrend, opening range; range day: CPR, profile, pivots),
   2. draws support and resistance ZONES where several tools meet (walls, VAH/VAL/POC, yesterday's high/low, pivots, CPR,
      swings, opening range, Fibonacci) and says which tools make each zone,
   3. marks liquidity (where stop-losses usually sit) and events on the candles: VWAP cross, Supertrend flip, break of
      structure (BOS), liquidity sweep (a poke beyond a level that closes back inside),
   4. explains under the chart why the engine says CALL, PUT or WAIT, tool by tool, in simple Hindi,
   5. scores each tool: when it pointed a way, did price move that way in the next 30 minutes (today and last sessions).
   Display only: it never changes a signal, a grade, a score or a trade, and makes no extra data calls. */
const Setup = (() => {
  const $s = (id) => document.getElementById(id);
  let lastPanel = 0, lastKey = '';
  const mode = () => Store.pref('chart_mode', 'manual');
  function setMode(m) { Store.setPref('chart_mode', m); lastKey = ''; if (typeof renderControls === 'function') renderControls(); if (typeof drawChart === 'function') drawChart(); }
  const on = () => mode() === 'auto';

  /* 1. tools for today */
  function overlays(a) {
    const day = a.brain && a.brain.day ? a.brain.day.kind : 'normal', o = { vwap: true, ema20: false, ema50: false, bb: false, st: false, fib: false, cpr: false, piv: false, orb: false, vp: false, exr: false };
    if (day === 'trend') Object.assign(o, { ema20: true, st: true, orb: a.curMin >= 15 });
    else if (day === 'range') Object.assign(o, { cpr: true, vp: true });
    else Object.assign(o, { ema20: true, st: true, cpr: true, vp: true });
    if (a.cf && a.cf.opt && a.ch && ok(a.ch.atmIV)) o.exr = true;
    return { o, day, why: day === 'trend' ? 'Trend day likely: tools that FOLLOW the move' : day === 'range' ? 'Range day likely: tools that mark the EDGES' : 'Normal day: trend tools plus range edges' };
  }

  /* 2. zones where several tools meet */
  function swings(k, n) {
    const H = [], L = [];
    for (let i = 2; i < k.length - 2; i++) { const x = k[i];
      if (x.h >= k[i - 1].h && x.h >= k[i - 2].h && x.h > k[i + 1].h && x.h > k[i + 2].h) H.push(x.h);
      if (x.l <= k[i - 1].l && x.l <= k[i - 2].l && x.l < k[i + 1].l && x.l < k[i + 2].l) L.push(x.l); }
    return { H: H.slice(-n), L: L.slice(-n) };
  }
  function zones(a) {
    const P = a.price, tol = Math.max((a.atr || P * 0.001) * 0.6, P * 0.0006), C = [];
    const add = (v, n, w, kind) => { if (ok(v) && v > 0 && Math.abs(v - P) / P < 0.06) C.push({ v, n, w, kind: kind || 'lvl' }); };
    let W = null; try { W = typeof Writers !== 'undefined' && a.cf.opt ? Writers.read(a.ch.rows, P, a.ch.step) : null; } catch (e) { W = null; }
    if (W && !W.noData) { add(W.resWw || W.resW, 'Call wall', 1.5); add(W.supWw || W.supW, 'Put wall', 1.5); }
    else if (a.ch && a.cf.opt) { add(a.ch.maxCE, 'Most call OI', 1.2); add(a.ch.maxPE, 'Most put OI', 1.2); }
    if (a.VP) { add(a.VP.POC, 'POC', 1); add(a.VP.VAH, 'VAH', 1); add(a.VP.VAL, 'VAL', 1); }
    add(a.DH, "Today's high", 1, 'liq'); add(a.DL, "Today's low", 1, 'liq');
    if (a.ch && ok(a.ch.atmIV) && a.ch.atmIV > 0 && ok(a.PC)) { const d = (a.PC * a.ch.atmIV) / Math.sqrt(252); add(a.PC + d, 'Options range high', 0.8); add(a.PC - d, 'Options range low', 0.8); }
    add(a.piv && a.piv.S3, 'S3', 0.6); add(a.piv && a.piv.R3, 'R3', 0.6);
    add(a.PH, "Yesterday's high", 1.2, 'liq'); add(a.PL, "Yesterday's low", 1.2, 'liq');
    if (a.curMin >= 15) { add(a.ORH, 'Opening high', 1, 'liq'); add(a.ORL, 'Opening low', 1, 'liq'); }
    ['R1', 'R2', 'S1', 'S2'].forEach((k) => add(a.piv && a.piv[k], k, 0.7)); add(a.p, 'Pivot', 0.7);
    add(a.tc, 'CPR top', 0.6); add(a.bc, 'CPR bottom', 0.6);
    if (a.vol) { add(a.vol.pwH, 'Last week high', 1, 'liq'); add(a.vol.pwL, 'Last week low', 1, 'liq'); }
    const sw = swings(a.I5.k.slice(-160), 3); sw.H.forEach((v) => add(v, 'Swing high', 0.8, 'liq')); sw.L.forEach((v) => add(v, 'Swing low', 0.8, 'liq'));
    (a.fib || []).filter((f) => f.r === 0.5 || f.r === 0.618).forEach((f) => add(f.v, `Fib ${(f.r * 100).toFixed(1)}%`, 0.5));
    if (ok(a.vw)) add(a.vw, a.hasVol ? 'VWAP' : 'TWAP', 0.8);
    C.sort((x, y) => x.v - y.v);
    const Z = [];
    C.forEach((c) => { const z = Z[Z.length - 1]; if (z && c.v - z.lo <= tol * 1.5) { z.m.push(c); z.hi = Math.max(z.hi, c.v); z.lo = Math.min(z.lo, c.v); } else Z.push({ lo: c.v, hi: c.v, m: [c] }); });
    Z.forEach((z) => { z.s = z.m.reduce((t, c) => t + c.w, 0); z.mid = z.m.reduce((t, c) => t + c.v * c.w, 0) / z.s; z.n = new Set(z.m.map((c) => c.n)).size; z.liq = z.m.some((c) => c.kind === 'liq'); z.side = z.mid > P ? 'R' : 'S'; z.pad = tol * 0.25;
      z.label = [...new Set(z.m.sort((p, q) => q.w - p.w).map((c) => c.n))].slice(0, 4).join(' + '); });
    const good = Z.filter((z) => z.n >= 2 || z.s >= 1.5);
    let R = good.filter((z) => z.lo > P + tol * 0.2).sort((p, q) => p.mid - q.mid), S = good.filter((z) => z.hi < P - tol * 0.2).sort((p, q) => q.mid - p.mid);
    // nothing strong on one side (e.g. after a big fall): show the nearest single level, marked as weak
    if (!S.length) S = Z.filter((z) => z.hi < P - tol * 0.2).sort((p, q) => q.mid - p.mid).slice(0, 2);
    if (!R.length) R = Z.filter((z) => z.lo > P + tol * 0.2).sort((p, q) => p.mid - q.mid).slice(0, 2);
    const at = good.filter((z) => z.lo - tol * 0.2 <= P && z.hi + tol * 0.2 >= P);
    return { R, S, at, tol, W };
  }

  /* 3. events on the candles (any timeframe) */
  function events(I, s0, e, atr) {
    const k = I.k, out = [], L = 12;
    for (let i = Math.max(s0, L + 1); i < e; i++) {
      const c = k[i], p = k[i - 1]; if (c.d !== p.d) continue;
      const vw = I.vwap[i], vp = I.vwap[i - 1];
      if (ok(vw) && ok(vp) && Math.sign(c.c - vw) !== Math.sign(p.c - vp) && Math.abs(c.c - vw) > atr * 0.1) out.push({ i, t: c.c > vw ? 'VWAP↑' : 'VWAP↓', d: c.c > vw ? 1 : -1, p: 1 });
      if (I.st && I.st.dir[i] != null && I.st.dir[i - 1] != null && I.st.dir[i] !== I.st.dir[i - 1]) out.push({ i, t: I.st.dir[i] > 0 ? 'ST↑' : 'ST↓', d: I.st.dir[i], p: 2 });
      const win = k.slice(i - L, i).filter((x) => x.d === c.d); if (win.length < 6) continue;
      const hh = Math.max(...win.map((x) => x.h)), ll = Math.min(...win.map((x) => x.l));
      if (c.c > hh + atr * 0.05) out.push({ i, t: 'BOS↑', d: 1, p: 3 });
      else if (c.c < ll - atr * 0.05) out.push({ i, t: 'BOS↓', d: -1, p: 3 });
      else if (c.h > hh + atr * 0.1 && c.c < hh) out.push({ i, t: 'Sweep↓', d: -1, p: 4 });
      else if (c.l < ll - atr * 0.1 && c.c > ll) out.push({ i, t: 'Sweep↑', d: 1, p: 4 });
    }
    // keep the clearer ones and not too many: one per candle, the newest 12
    const by = {}; out.forEach((x) => { if (!by[x.i] || by[x.i].p < x.p) by[x.i] = x; });
    return Object.values(by).sort((p, q) => p.i - q.i).slice(-12);
  }

  /* drawing, called from drawChart with its scales */
  function draw(ctx, G) {
    const { a, I, s0, e, y, X, pw, top, bot, mn, mx, later, W } = G, phone = W < 640, Z = zones(a), n = phone ? 2 : 3, used = [];
    // one label per ~14 px, so labels never sit on top of each other
    const room = (yy) => { if (used.some((u) => Math.abs(u - yy) < 14)) return false; used.push(yy); return true; };
    const band = (z, col) => { const y1 = y(Math.min(mx, z.hi + z.pad)), y2 = y(Math.max(mn, z.lo - z.pad)); if (y2 < top || y1 > bot) return;
      ctx.fillStyle = col; ctx.globalAlpha = Math.min(0.32, 0.1 + z.s * 0.04); ctx.fillRect(0, y1, pw, Math.max(2, y2 - y1)); ctx.globalAlpha = 1;
      const t = phone ? `${z.side === 'R' ? 'R' : 'S'} ${f0(z.mid)} (${z.n})` : `${z.side === 'R' ? 'R' : 'S'} ${f0(z.mid)} · ${z.label.split(' + ').slice(0, 2).join(' + ')}${z.n > 2 ? ` +${z.n - 2}` : ''}`;
      const yy = Math.max(top + 12, Math.min(bot - 2, (y1 + y2) / 2 + 4));
      if (room(yy)) later.push([t, Math.max(4, pw - ctx.measureText(t).width - 8), yy, z.side === 'R' ? COL.put : COL.call]); };
    Z.R.slice(0, n).forEach((z) => band(z, '#FF3B6B')); Z.S.slice(0, n).forEach((z) => band(z, '#00F5A0'));
    // liquidity: the nearest pool of stops above and below (yesterday's / opening / swing high-low)
    const lq = (L, up) => { const z = L.find((q) => q.liq); if (!z) return; const v = up ? z.hi : z.lo; if (v < mn || v > mx) return; const yy = y(v), x0 = pw * 0.62;
      ctx.strokeStyle = COL.brass; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(pw, yy); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      const ly = yy + (up ? -4 : 13); if (room(ly)) later.push([`${up ? '▲' : '▼'} stops ${f0(v)}`, x0, ly, COL.brass]); };
    lq(Z.R, true); lq(Z.S, false);
    // events on candles
    const ev = events(I, s0, e, a.atr || a.price * 0.001).slice(phone ? -6 : -10);
    ctx.font = '10px ' + (FONT.split('px ')[1] || 'sans-serif');
    ev.forEach((x) => { const c = I.k[x.i], xx = X(x.i - s0), up = x.d > 0, yy = up ? y(c.l) + 10 : y(c.h) - 10, col = /Sweep/.test(x.t) ? COL.brass : up ? COL.call : COL.put;
      ctx.fillStyle = col; ctx.beginPath(); if (up) { ctx.moveTo(xx, yy - 6); ctx.lineTo(xx - 4, yy); ctx.lineTo(xx + 4, yy); } else { ctx.moveTo(xx, yy + 6); ctx.lineTo(xx - 4, yy); ctx.lineTo(xx + 4, yy); } ctx.closePath(); ctx.fill();
      if (/BOS|Sweep/.test(x.t)) ctx.fillText(x.t, xx - 12, up ? yy + 11 : yy - 3); });
    ctx.font = FONT;
  }

  /* 4. why the engine says what it says, tool by tool */
  const HI = [
    [/VWAP|TWAP/, ['भाव VWAP के ऊपर: आज के औसत से ऊपर, खरीदार हावी', 'भाव VWAP के नीचे: बेचने वाले हावी']],
    [/Supertrend/, ['Supertrend हरा: छोटा trend ऊपर', 'Supertrend लाल: छोटा trend नीचे']],
    [/EMA/, ['छोटी औसत ऊपर: तेज़ी का झुकाव', 'छोटी औसत नीचे: मंदी का झुकाव']],
    [/swing|structure/i, ['Higher high / higher low: ऊपर की बनावट', 'Lower high / lower low: नीचे की बनावट']],
    [/RSI/, ['RSI 50 के ऊपर: ताक़त खरीदारों की', 'RSI 50 के नीचे: ताक़त बेचने वालों की']],
    [/MACD/, ['MACD ऊपर: रफ़्तार बढ़ रही है', 'MACD नीचे: रफ़्तार नीचे की']],
    [/ADX|DI/, ['ADX: trend में दम, +DI आगे', 'ADX: trend में दम, −DI आगे']],
    [/POC|profile|TPO/i, ['भाव POC के ऊपर: ज़्यादातर सौदे नीचे हुए, buyers ने संभाला', 'भाव POC के नीचे: sellers ने संभाला']],
    [/Fibonacci/, ['दिन की range के ऊपरी हिस्से में', 'दिन की range के निचले हिस्से में']],
    [/CPR|Pivot/i, ['Pivot/CPR के ऊपर: तेज़ी वाला इलाक़ा', 'Pivot/CPR के नीचे: मंदी वाला इलाक़ा']],
    [/Opening|OR /, ['Opening range के ऊपर निकला', 'Opening range के नीचे गया']],
    [/PCR|OI|writ|Option/i, ['Options data: नीचे support मज़बूत', 'Options data: ऊपर रुकावट मज़बूत']],
    [/Futures|buildup/i, ['Futures में तेज़ी वाली buildup', 'Futures में मंदी वाली buildup']],
    [/VIX/, ['VIX शांत: बाज़ार में डर कम', 'VIX बढ़ा: डर बढ़ा']],
    [/News/i, ['खबरें अच्छी', 'खबरें बुरी']], [/FII|flow/i, ['बड़े पैसों का झुकाव खरीद', 'बड़े पैसों का झुकाव बिक्री']],
    [/Heavy|breadth|weights/i, ['बड़े शेयर ऊपर खींच रहे हैं', 'बड़े शेयर नीचे खींच रहे हैं']], [/Global|GIFT|cues/i, ['दुनिया के संकेत अच्छे', 'दुनिया के संकेत कमज़ोर']],
    [/30|momentum|Last/i, ['पिछले 30 मिनट ऊपर', 'पिछले 30 मिनट नीचे']], [/Candle|pattern/i, ['Candle pattern तेज़ी का', 'Candle pattern मंदी का']], [/Bollinger/, ['Bollinger के ऊपरी हिस्से में', 'Bollinger के निचले हिस्से में']],
  ];
  const hi = (n, s) => { const r = HI.find(([re]) => re.test(n)); return !s ? 'कोई साफ़ दिशा नहीं' : r ? r[1][s > 0 ? 0 : 1] : s > 0 ? 'ऊपर की ओर इशारा' : 'नीचे की ओर इशारा'; };

  /* 5. tool scorecard: each tool's direction vs the price 30 minutes later (5-minute candles) */
  function scorecard(a) {
    const I = a.I5, k = I.k, N = k.length, atr = a.atr || a.price * 0.001, ahead = 6;
    const T = [
      ['VWAP / TWAP', (i) => (ok(I.vwap[i]) ? Math.sign(k[i].c - I.vwap[i]) : 0)],
      ['EMA 20 vs 50', (i) => (ok(I.ema20[i]) && ok(I.ema50[i]) ? Math.sign(I.ema20[i] - I.ema50[i]) : 0)],
      ['Supertrend', (i) => (I.st && I.st.dir[i] != null ? I.st.dir[i] : 0)],
      ['MACD', (i) => (I.macd && ok(I.macd.hist[i]) ? Math.sign(I.macd.hist[i]) : 0)],
      ['RSI (55/45)', (i) => (ok(I.rsi[i]) ? (I.rsi[i] > 55 ? 1 : I.rsi[i] < 45 ? -1 : 0) : 0)],
      ['ADX + DI', (i) => (I.adx && ok(I.adx.adx[i]) && I.adx.adx[i] > 20 ? Math.sign(I.adx.pdi[i] - I.adx.mdi[i]) : 0)],
    ];
    const today = k.length ? k[k.length - 1].d : 2;
    return T.map(([n, f]) => {
      const r = { n, now: f(N - 1), t: [0, 0], all: [0, 0], fl: [0, 0] };
      for (let i = 1; i < N - ahead; i++) {
        if (k[i + ahead].d !== k[i].d) continue; const s = f(i); if (!s) continue;
        const mv = k[i + ahead].c - k[i].c; if (Math.abs(mv) < atr * 0.15) continue;
        const hit = Math.sign(mv) === s ? 1 : 0; r.all[0] += hit; r.all[1]++; if (k[i].d === today) { r.t[0] += hit; r.t[1]++; }
        if (k[i].d === today && f(i - 1) !== s) { r.fl[0] += hit; r.fl[1]++; }
      }
      return r;
    });
  }

  /* controls above the chart: the mode switch, and in auto mode the tools in use */
  function controls(a) {
    let seg = $s('modeSeg'); if (!seg) { const chips = $s('ovChips'); if (!chips) return; seg = document.createElement('div'); seg.id = 'modeSeg'; seg.className = 'mode-seg'; chips.parentNode.insertBefore(seg, chips); }
    let au = $s('autoChips'); if (!au) { au = document.createElement('div'); au.id = 'autoChips'; au.className = 'auto-chips'; $s('ovChips').parentNode.insertBefore(au, $s('ovChips').nextSibling); }
    const m = mode();
    seg.innerHTML = `<button class="${m === 'manual' ? 'on' : ''}" onclick="Setup.setMode('manual')" aria-pressed="${m === 'manual'}">🛠 Manual tools</button><button class="${m === 'auto' ? 'on' : ''}" onclick="Setup.setMode('auto')" aria-pressed="${m === 'auto'}">🎯 Auto setup</button>`;
    $s('ovChips').style.display = m === 'auto' ? 'none' : '';
    au.style.display = m === 'auto' ? '' : 'none';
    if (m === 'auto') { const O = overlays(a), L = { vwap: a.hasVol ? 'VWAP' : 'TWAP', ema20: 'EMA 20', st: 'Supertrend', orb: 'Opening range', cpr: 'CPR', vp: a.hasVol ? 'Volume profile' : 'TPO profile', exr: 'Options range' };
      au.innerHTML = `<span class="auto-why">${esc(O.why)}:</span>${Object.keys(O.o).filter((k) => O.o[k]).map((k) => `<span class="chip on"><span class="sw" style="background:${OVC[k]}"></span>${L[k] || k}</span>`).join('')}<span class="chip on"><span class="sw" style="background:linear-gradient(90deg,#00F5A0,#FF3B6B)"></span>Zones</span><span class="chip on"><span class="sw" style="background:${COL.brass}"></span>Liquidity & events</span>`; }
    const p = $s('setupPanel'); if (p) p.style.display = m === 'auto' ? '' : 'none';
  }

  /* the panel under the chart (auto mode) */
  function panel(a) {
    const p = $s('setupPanel'); if (!p || !on()) return;
    const key = a.key + '|' + a.curMin + '|' + Math.round(a.price * 20);
    if (key === lastKey && Date.now() - lastPanel < 15000) return; lastKey = key; lastPanel = Date.now();
    const s = signalFor(a), Z = zones(a), sc = scorecard(a), sig = ((a.intra && a.intra.sigs) || []).filter((x) => x.w > 0);
    const side = s.state === 'CE' ? 1 : s.state === 'PE' ? -1 : 0;
    const P = sig.filter((x) => x.t !== 'c'), Cx = sig.filter((x) => x.t === 'c');
    const up = sig.filter((x) => x.s > 0.1).length, dn = sig.filter((x) => x.s < -0.1).length;
    const dot = (v) => `<i class="sp-dot ${v > 0.1 ? 'g' : v < -0.1 ? 'r' : 'n'}"></i>`;
    const row = (x) => `<div class="sp-row ${side && Math.sign(x.s) === side ? 'with' : side && Math.sign(x.s) === -side ? 'against' : ''}">${dot(x.s)}<b>${esc(x.n)}</b><span class="mut">${esc(String(x.v == null ? '' : x.v))}</span><em>${hi(x.n, Math.abs(x.s) > 0.1 ? Math.sign(x.s) : 0)}</em></div>`;
    const zl = (L, side2) => L.slice(0, 3).map((z) => `<div class="sp-z ${side2}"><b>${f0(z.mid)}</b><span>${esc(z.label)}</span><em>${z.n >= 3 ? 'strong' : z.n === 2 ? 'medium' : 'single'} · ${f1(Math.abs(z.mid - a.price) / (a.atr || 1))} ATR away</em></div>`).join('') || '<div class="mut">None near.</div>';
    const vp = a.VP && ok(a.VP.POC) ? (a.price > a.VP.VAH ? `Above the value area (VAH ${f0(a.VP.VAH)}): buyers accepted higher prices; if it falls back inside, sellers regain control.` : a.price < a.VP.VAL ? `Below the value area (VAL ${f0(a.VP.VAL)}): sellers in charge; a move back above VAL is the first sign of buyers.` : a.price >= a.VP.POC ? `Inside the value area, above POC ${f0(a.VP.POC)}: buyers slightly in control; VAH ${f0(a.VP.VAH)} is the next test.` : `Inside the value area, below POC ${f0(a.VP.POC)}: sellers slightly in control; VAL ${f0(a.VP.VAL)} is the next test.`) : '';
    const best = sc.filter((r) => r.t[1] >= 6).sort((x, y) => y.t[0] / y.t[1] - x.t[0] / x.t[1])[0];
    const pc = (r) => (r[1] ? `${Math.round((r[0] / r[1]) * 100)}% <small class="mut">(${r[0]}/${r[1]})</small>` : '–');
    let h = `<div class="sp-head"><div class="sp-verdict ${side > 0 ? 'up' : side < 0 ? 'dn' : ''}"><small>Engine now</small><b>${s.state === 'CE' ? 'CALL' : s.state === 'PE' ? 'PUT' : 'WAIT'}${s.grade ? ' · ' + s.grade : ''}</b><span>${esc(s.title || '')}</span></div>
      <div class="sp-count"><span class="up">▲ ${up} tools up</span><span class="dn">▼ ${dn} tools down</span>${a.brain && a.brain.day ? `<span>${esc(a.brain.day.name)}</span>` : ''}</div></div>
      <div class="gd-mean"><b>आसान मतलब:</b> ${side ? `Engine ${side > 0 ? 'CALL' : 'PUT'} इसलिए कह रहा है क्योंकि नीचे के <b>${side > 0 ? up : dn}</b> tools ${side > 0 ? 'ऊपर' : 'नीचे'} इशारा कर रहे हैं (हरी/लाल बत्ती)। जो tools खिलाफ़ हैं वे पीले किनारे से दिखे हैं — वही जोखिम हैं।` : 'Engine अभी WAIT पर है: tools आपस में बँटे हुए हैं या दिशा साफ़ नहीं। Chart पर ज़ोन देखें — भाव किस ज़ोन को तोड़ता है, वहीं से अगला मौका बनेगा।'} ${Z.R[0] ? `ऊपर पहली रुकावट <b>${f0(Z.R[0].mid)}</b>` : ''}${Z.S[0] ? `, नीचे पहला support <b>${f0(Z.S[0].mid)}</b>` : ''}।</div>
      <div class="sp-grid"><section><h4>Price-action tools (decide the direction)</h4>${P.map(row).join('') || '<div class="mut">–</div>'}</section><section><h4>Context (options, flows, news, world)</h4>${Cx.map(row).join('') || '<div class="mut">–</div>'}</section></div>
      <div class="sp-grid"><section><h4 class="dn">Resistance zones above</h4>${zl(Z.R, 'r')}</section><section><h4 class="up">Support zones below</h4>${zl(Z.S, 's')}</section></div>
      ${Z.at.length ? `<div class="alert i">Price is sitting ON a zone now (${Z.at.map((z) => esc(z.label)).join('; ')}): expect a reaction here, a bounce or a break.</div>` : ''}
      ${vp ? `<div class="sp-vp"><b>${a.hasVol ? 'Volume profile' : 'TPO profile'}:</b> ${esc(vp)}</div>` : ''}
      <section class="sp-sc"><h4>Which tool worked ${best ? `— today the best was <b>${esc(best.n)}</b>` : ''}</h4><div class="tblw"><table><thead><tr><th class="l">Tool</th><th>Says now</th><th>Right today</th><th>Fresh signals today</th><th>Last few sessions</th></tr></thead><tbody>${sc.map((r) => `<tr><td class="l">${esc(r.n)}</td><td class="${r.now > 0 ? 'up' : r.now < 0 ? 'dn' : ''}">${r.now > 0 ? '▲ up' : r.now < 0 ? '▼ down' : '• flat'}</td><td>${pc(r.t)}</td><td>${pc(r.fl)}</td><td>${pc(r.all)}</td></tr>`).join('')}</tbody></table></div>
      <div class="legend">"Right" = when the tool pointed up or down on a 5-minute candle, price moved that way over the next 30 minutes (tiny moves skipped). Candles overlap, so today's numbers are a glimpse, not proof. Chart marks: VWAP↑/↓ cross, ST Supertrend flip, BOS break of structure (close beyond the last hour's high/low), Sweep = poked beyond a high/low and closed back inside (stops taken, often a reversal). Dotted brass line = where stop-losses usually sit (estimate). Zones = levels where 2+ tools meet; the more tools, the stronger.</div></section>`;
    p.innerHTML = h;
  }
  return { mode, on, setMode, overlays, zones, events, draw, controls, panel, scorecard };
})();
