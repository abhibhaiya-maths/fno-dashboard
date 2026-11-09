/* ===== Backtest and replay engine =====
   Plays a past day minute by minute through the same analyze() the live dashboard uses.
   The engine only ever sees candles up to the current minute (no peeking ahead).
   Works in the browser (Replay page) and in Node (offline backtests). */

const BT = (() => {
  const INST = [
    ['NIFTY', 'NSE_INDEX|Nifty 50'], ['BANKNIFTY', 'NSE_INDEX|Nifty Bank'], ['SENSEX', 'BSE_INDEX|SENSEX'], ['VIX', 'NSE_INDEX|India VIX'],
  ];
  const COST_PTS = 2; // Nifty-equivalent; scaled by price below (0.008% round trip)
  const costOf = (px) => Math.max(1, px * 0.00008);

  // Upstox rows are [isoTime, o, h, l, c, vol, oi], newest first. Keep 09:15–15:29 and group by date.
  function parse(rows) {
    const days = {};
    (rows || []).forEach((r) => {
      const t = String(r[0]), date = t.slice(0, 10), m = (+t.slice(11, 13)) * 60 + (+t.slice(14, 16)) - 555;
      if (m < 0 || m >= 375) return;
      (days[date] || (days[date] = [])).push([m, +r[1], +r[2], +r[3], +r[4], +r[5] || 0, +r[6] || 0]);
    });
    for (const d in days) days[d].sort((a, b) => a[0] - b[0]);
    return days;
  }
  const parseDaily = (rows) => (rows || []).map((r) => [String(r[0]).slice(0, 10), +r[1], +r[2], +r[3], +r[4], +r[5] || 0, +r[6] || 0]).sort((a, b) => (a[0] < b[0] ? -1 : 1));

  // file format: { v, created, inst: { NIFTY: { key, m1: {date: rows}, d1: rows } ... } }
  function dates(data, k) { const x = data.inst[k]; return x ? Object.keys(x.m1).filter((d) => x.m1[d].length >= 60).sort() : []; }

  // the data object analyze() expects, as it would have looked live at minute `m` of `date`
  function buildD(data, k, date, m) {
    const X = data.inst[k], all = dates(data, k), i = all.indexOf(date);
    if (i < 2) return null;
    const ds = [all[i - 2], all[i - 1], date], candles = [];
    ds.forEach((d, j) => X.m1[d].forEach((c) => { if (j < 2 || c[0] <= m) candles.push({ d: j, m: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5], oi: c[6] }); }));
    if (!candles.length || candles[candles.length - 1].d !== 2) return null;
    const prev = X.m1[ds[1]], prevClose = prev[prev.length - 1][4], price = candles[candles.length - 1].c;
    const V = data.inst.VIX;
    let vix = null;
    if (V && V.m1[date]) { const vr = V.m1[date].filter((c) => c[0] <= m), vp = V.m1[ds[1]]; if (vr.length) vix = { v: vr[vr.length - 1][4], prev: vp ? vp[vp.length - 1][4] : null }; }
    const HD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      key: k, candles, price, prevClose, sessionLive: true, marketOpenNow: true, replay: true,
      dayLabels: ds.map((d, j) => (j === 2 ? 'Replay' : HD[new Date(d + 'T00:00:00Z').getUTCDay()])), dayDates: ds,
      chain: { rows: [] }, vix, fii: null, dii: null, hv: [], news: [], fut: null,
      daily: { rows: (X.d1 || []).filter((r) => r[0] < date) }, vixDaily: V ? (V.d1 || []).filter((r) => r[0] < date) : [],
      geo: null, glob: [], events: [], mkt: null,
    };
  }

  // one engine step at minute m (simulated clock, separate hysteresis memory)
  function step(data, k, date, m, hz) {
    const D = buildD(data, k, date, m); if (!D) return null;
    const keep = HZ; SIM.on = true; SIM.t = Date.parse(date + 'T09:15:00+05:30') + m * 60000;
    try { HZ = hz || 'intra'; const a = applyHz(analyze(D)); const s = signalFor(a); return { a, s }; }
    finally { SIM.on = false; HZ = keep; }
  }
  function resetMemory() { for (const id in HYS) if (id.startsWith(SIM.ns)) delete HYS[id]; for (const id in SIGMEM) if (id.startsWith(SIM.ns)) delete SIGMEM[id]; }

  /* Simulated trader that follows the engine exactly like the paper-trade auto rules:
     enter on a CALL/PUT signal, stop from the setup, at 1R move the stop to entry, then trail 1R,
     exit at target 2 (2.5R), on an opposite signal (after a 5-minute minimum hold), or at 15:20. */
  function tradeSim() {
    const T = { open: null, trades: [] };
    T.onBar = (m, bar, a, s) => {
      const o = T.open;
      if (o) {
        const sd = o.dir === 'CE' ? 1 : -1, fav = sd > 0 ? bar.h : bar.l, adv = sd > 0 ? bar.l : bar.h;
        o.mfe = Math.max(o.mfe, (fav - o.e) * sd); o.mae = Math.max(o.mae, (o.e - adv) * sd);
        let exit = null;
        if ((adv - o.sl) * sd <= 0) exit = [o.sl, o.sl === o.e ? 'Breakeven stop' : o.trail ? 'Trailing stop' : 'Stop-loss'];
        else if ((fav - o.t2) * sd >= 0) exit = [o.t2, 'Target 2'];
        else if (m >= 365) exit = [bar.c, '15:20 square-off'];
        else if (s && (s.state === 'CE' || s.state === 'PE') && s.state !== o.dir && m - o.m >= 5) exit = [bar.c, 'Opposite signal'];
        if (!exit) {
          const gain = (bar.c - o.e) * sd;
          if (gain >= o.risk && !o.be) { o.be = true; o.sl = o.e; }
          if (o.be) { const tr = bar.c - sd * ENG.trailR * o.risk; if ((tr - o.sl) * sd > 0) { o.sl = tr; o.trail = true; } }
        }
        if (exit) { const pts = (exit[0] - o.e) * sd - costOf(o.e); T.trades.push({ ...o, x: exit[0], xm: m, why: exit[1], pts, win: pts > 0 }); T.open = null; }
      }
      if (!T.open && s && (s.state === 'CE' || s.state === 'PE') && m < 345) {
        const st = setupFor(a, s.state);
        T.open = { dir: s.state, strength: s.strength || '', title: s.title, m, e: bar.c, sl: st.sl, t2: st.t2, risk: st.risk, mfe: 0, mae: 0, be: false, trail: false, n: T.trades.length };
      }
    };
    return T;
  }

  // run a whole day; onMinute(m, bar, a, s) lets the Replay page draw as it goes
  function runDay(data, k, date, hz, onMinute) {
    resetMemory();
    const X = data.inst[k], bars = X.m1[date], T = tradeSim(), log = [];
    for (const c of bars) {
      const m = c[0], bar = { m, o: c[1], h: c[2], l: c[3], c: c[4] };
      const r = step(data, k, date, m, hz); if (!r) continue;
      T.onBar(m, bar, r.a, r.s);
      const A1 = r.a;
      log.push({ m, c: bar.c, st: r.s.state, str: r.s.strength || '', title: r.s.title, score: Math.round(A1.score),
        f: { adx: ok(A1.adx) ? Math.round(A1.adx) : null, ext: ok(A1.e20) && A1.atr ? +((A1.price - A1.e20) / A1.atr).toFixed(2) : null, mv: ok(A1.mvA) ? +A1.mvA.toFixed(2) : null,
          vw: ok(A1.vw) ? (A1.price > A1.vw ? 1 : -1) : 0, stx: A1.stx ? A1.stx.state + (A1.stx.trend > 0 ? '+' : A1.stx.trend < 0 ? '-' : '') : '', cu: A1.coreUp, cd: A1.coreDn, st: A1.stD, setup: A1.setupType, atr: +(A1.atr || 0).toFixed(2), sh: A1.short ? A1.short.dir || '' : '', lg: A1.long ? A1.long.dir || '' : '', pb: A1.pb ? A1.pb.state : '', open: A1.open ? A1.open.type : '' } });
      if (onMinute) onMinute(m, bar, r.a, r.s);
    }
    if (T.open) { const o = T.open, last = bars[bars.length - 1], sd = o.dir === 'CE' ? 1 : -1, pts = (last[4] - o.e) * sd - costOf(o.e); T.trades.push({ ...o, x: last[4], xm: last[0], why: 'Day end', pts, win: pts > 0 }); }
    return { date, k, hz, trades: T.trades, log, stats: dayStats(bars, log, T.trades) };
  }

  /* How good was the engine on this day, beyond trade P&L:
     - direction accuracy: when it showed CALL/PUT, did price move that way over the next 15 minutes?
     - wrong-way minutes: CALL shown while price fell 0.4%+ in the next 30 minutes (and vice versa)
     - WAIT share, and how late it caught the day's biggest move */
  function dayStats(bars, log, trades) {
    const px = {}; bars.forEach((c) => (px[c[0]] = c[4]));
    const fwd = (m, n) => { for (let j = n; j >= 1; j--) if (px[m + j] !== undefined) return px[m + j]; return null; };
    let dirN = 0, dirOk = 0, wrongWay = 0, wait = 0;
    log.forEach((x) => {
      if (x.st !== 'CE' && x.st !== 'PE') { wait++; return; }
      const sd = x.st === 'CE' ? 1 : -1, f15 = fwd(x.m, 15), f30 = fwd(x.m, 30);
      if (f15 !== null) { dirN++; if ((f15 - x.c) * sd > 0) dirOk++; }
      if (f30 !== null && ((f30 - x.c) / x.c) * 100 * sd <= -0.4) wrongWay++;
    });
    // biggest one-way move of the day (from a low to a later high, or a high to a later low)
    let best = null, lo = bars[0], hi = bars[0];
    bars.forEach((c) => {
      if (c[3] < lo[3]) lo = c; if (c[2] > hi[2]) hi = c;
      const up = c[2] - lo[3], dn = hi[2] - c[3];
      if (!best || up > best.size) best = { dir: 'CE', from: lo[0], to: c[0], size: up, start: lo[3] };
      if (dn > best.size) best = { dir: 'PE', from: hi[0], to: c[0], size: dn, start: hi[2] };
    });
    let caught = null;
    if (best) { const hit = log.find((x) => x.m >= best.from && x.m <= best.to && x.st === best.dir); caught = hit ? { mins: hit.m - best.from, ptsLate: Math.abs(hit.c - best.start), pctOfMove: Math.round((Math.abs(hit.c - best.start) / best.size) * 100) } : null; }
    const wins = trades.filter((t) => t.win), pts = trades.reduce((s, t) => s + t.pts, 0);
    return { minutes: log.length, waitPct: log.length ? Math.round((wait / log.length) * 100) : 0, dirN, dirAcc: dirN ? Math.round((dirOk / dirN) * 100) : null, wrongWay,
      trades: trades.length, wins: wins.length, pts: Math.round(pts * 10) / 10, move: best, caught };
  }

  function summary(days) {
    const t = days.flatMap((d) => d.trades), w = t.filter((x) => x.win), l = t.filter((x) => !x.win);
    const sum = (a) => a.reduce((s, x) => s + x.pts, 0), avg = (a) => (a.length ? sum(a) / a.length : 0);
    const dirN = days.reduce((s, d) => s + d.stats.dirN, 0), dirOk = days.reduce((s, d) => s + (d.stats.dirAcc || 0) * d.stats.dirN / 100, 0);
    const caught = days.filter((d) => d.stats.caught), missed = days.length - caught.length;
    let peak = 0, run = 0, dd = 0; t.forEach((x) => { run += x.pts; peak = Math.max(peak, run); dd = Math.max(dd, peak - run); });
    const byStr = (s) => { const a = t.filter((x) => x.strength === s); return { n: a.length, winPct: a.length ? Math.round((a.filter((x) => x.win).length / a.length) * 100) : null, pts: Math.round(sum(a)) }; };
    return { days: days.length, trades: t.length, winPct: t.length ? Math.round((w.length / t.length) * 100) : null, netPts: Math.round(sum(t)), avgWin: Math.round(avg(w) * 10) / 10, avgLoss: Math.round(avg(l) * 10) / 10,
      profitFactor: l.length && sum(l) ? Math.round((sum(w) / -sum(l)) * 100) / 100 : null, maxDrawdownPts: Math.round(dd),
      dirAcc: dirN ? Math.round((dirOk / dirN) * 100) : null, waitPct: Math.round(days.reduce((s, d) => s + d.stats.waitPct, 0) / (days.length || 1)), wrongWayMin: days.reduce((s, d) => s + d.stats.wrongWay, 0),
      bigMoveCaught: caught.length, bigMoveMissed: missed, avgCatchDelayMin: caught.length ? Math.round(caught.reduce((s, d) => s + d.stats.caught.mins, 0) / caught.length) : null,
      avgCatchPctOfMove: caught.length ? Math.round(caught.reduce((s, d) => s + d.stats.caught.pctOfMove, 0) / caught.length) : null,
      strong: byStr('strong'), mild: byStr('mild'),
      exits: t.reduce((o, x) => ((o[x.why] = (o[x.why] || 0) + 1), o), {}) };
  }

  return { INST, COST_PTS, costOf, parse, parseDaily, dates, buildD, step, runDay, summary, resetMemory };
})();
if (typeof module !== 'undefined') module.exports = BT;
