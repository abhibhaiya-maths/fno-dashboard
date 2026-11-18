/* ===== Time Machine: what happened to THIS trade plan on past days =====
   Idea from the day-trader-skill repo (US stocks), rebuilt for Nifty / Bank Nifty / Sensex on the Replay page's
   1-minute history. Two honest counts, no AI:
   1. Replay: the same entry time, the same stop and target distance (as % of price) on every past day. Which came
      first, the target or the stop, or neither by the 15:20 square-off? Also the subset of days that looked like today
      at that minute (same side of TWAP, same 30-minute direction).
   2. 10,000 simulated futures: the rest of today built from real one-minute moves seen at the same time of day.
   Results are in R (1R = the distance to the stop), after a small cost. It reads the index, not the option premium.
   It never changes a signal, a grade or a trade. */
const TimeMachine = (() => {
  const IDX = ['NIFTY', 'BANKNIFTY', 'SENSEX'], END = 365, MIN_DAYS = 20; // 15:20 square-off
  let data = null, loaded = false, cache = {};

  /* ---------- pure maths (also runs in Node for tests) ---------- */
  function rngOf(seed) { return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // one day: bars [[m, o, h, l, c], …]; returns null if the day has no bar near minute m0
  function walk(bars, m0, sd, sl, tp, end) {
    let i = bars.findIndex((b) => b[0] >= m0); if (i < 0 || bars[i][0] - m0 > 3) return null;
    const e = bars[i][4], S = e * (1 - sd * sl), T = e * (1 + sd * tp);
    for (let j = i + 1; j < bars.length && bars[j][0] <= end; j++) {
      const b = bars[j], hi = b[2], lo = b[3];
      const stop = sd > 0 ? lo <= S : hi >= S, tgt = sd > 0 ? hi >= T : lo <= T;
      if (stop) return { out: 'stop', R: -1, m: b[0] };            // both in one bar: count the stop (the cautious choice)
      if (tgt) return { out: 'tgt', R: tp / sl, m: b[0] };
    }
    const last = bars.filter((b) => b[0] <= end).pop(); if (!last) return null;
    return { out: 'none', R: ((last[4] / e - 1) * sd) / sl, m: last[0] };
  }
  function cond(bars, m0) {
    const upto = bars.filter((b) => b[0] <= m0); if (upto.length < 31) return null;
    const tw = upto.reduce((s, b) => s + (b[2] + b[3] + b[4]) / 3, 0) / upto.length, c = upto[upto.length - 1][4], c30 = upto[upto.length - 31][4];
    return { vw: c >= tw ? 1 : -1, mom: c >= c30 ? 1 : -1 };
  }
  function sum(L, costR) {
    const n = L.length; if (!n) return { n: 0 };
    const t = L.filter((x) => x.out === 'tgt').length, s = L.filter((x) => x.out === 'stop').length, R = L.map((x) => x.R - costR).sort((a, b) => a - b);
    const q = (p) => R[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
    return { n, tgt: t / n, stop: s / n, none: (n - t - s) / n, avgR: R.reduce((a, b) => a + b, 0) / n, win: R.filter((x) => x > 0).length / n, q10: q(0.1), q50: q(0.5), q90: q(0.9) };
  }
  /* days: [{ date, bars }], past days only. plan: { m0, dir: 'CE'|'PE', sl, tp } as fractions of price; today: { vw, mom } */
  function run(days, plan, today, opt) {
    opt = opt || {};
    const sd = plan.dir === 'PE' ? -1 : 1, end = opt.end || END, costR = (opt.costPct || 0.00008) / plan.sl, N = opt.paths || 10000;
    const rep = [], sim = [];
    days.forEach((d) => { const r = walk(d.bars, plan.m0, sd, plan.sl, plan.tp, end); if (!r) return; rep.push(r); if (today) { const c = cond(d.bars, plan.m0); if (c && c.vw === today.vw && c.mom === today.mom) sim.push(r); } });
    // Monte Carlo: one-minute steps (move, high, low vs the previous close) grouped by time of day (±10 minutes)
    const pool = {};
    days.forEach((d) => { const B = d.bars; for (let j = 1; j < B.length; j++) { const p = B[j - 1][4]; if (!(p > 0) || B[j][0] < plan.m0 - 10) continue; const k = Math.floor(B[j][0] / 10); (pool[k] || (pool[k] = [])).push([B[j][4] / p - 1, B[j][2] / p - 1, B[j][3] / p - 1]); } });
    const r = rngOf(opt.seed || 7), mc = [];
    const steps = []; for (let m = plan.m0 + 1; m <= end; m++) { const P = pool[Math.floor(m / 10)] || pool[Math.floor((m - 10) / 10)]; if (P && P.length) steps.push(P); }
    if (steps.length && days.length >= MIN_DAYS) {
      for (let i = 0; i < N; i++) {
        let p = 1, out = null;
        for (const P of steps) { const s = P[Math.floor(r() * P.length)], hi = p * (1 + s[1]), lo = p * (1 + s[2]);
          if (sd > 0 ? lo <= 1 - plan.sl : hi >= 1 + plan.sl) { out = { out: 'stop', R: -1 }; break; }
          if (sd > 0 ? hi >= 1 + plan.tp : lo <= 1 - plan.tp) { out = { out: 'tgt', R: plan.tp / plan.sl }; break; }
          p *= 1 + s[0]; }
        mc.push(out || { out: 'none', R: ((p - 1) * sd) / plan.sl });
      }
    }
    return { days: days.length, replay: sum(rep, costR), similar: sum(sim, costR), mc: sum(mc, costR), minutesLeft: Math.max(0, end - plan.m0) };
  }

  /* ---------- glue: the dashboard's data ---------- */
  function idb() { return new Promise((res) => { try { const o = indexedDB.open('fno_bt', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onsuccess = () => { try { const q = o.result.transaction('kv', 'readonly').objectStore('kv').get('hist'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }; o.onerror = () => res(null); } catch (e) { res(null); } }); }
  async function load() { if (loaded) return data; data = (typeof Replay !== 'undefined' && Replay.data) || (await idb()); if (!data && typeof Source !== 'undefined' && Source.mode !== 'live') data = demoData(); loaded = true; cache = {}; return data; }
  function daysFor(k) {
    const D = (typeof Replay !== 'undefined' && Replay.data) || data; if (!D || !D.inst || !D.inst[k]) return [];
    const td = typeof istYmd === 'function' ? istYmd() : '', X = D.inst[k];
    return Object.keys(X.m1).filter((d) => d < td && X.m1[d].length >= 300).sort().slice(-60).map((d) => ({ date: d, bars: X.m1[d] }));
  }
  // for the report card: { na } or { res, plan, days }
  function forSignal(a, s) {
    if (!a || !s || !(s.state === 'CE' || s.state === 'PE')) return null;
    if (!IDX.includes(a.key)) return { na: 'Time Machine works on Nifty, Bank Nifty and Sensex (it needs the Replay page\'s 1-minute history).' };
    if (!loaded) { load().then(() => { try { if (typeof Report !== 'undefined' && Report.refresh) Report.refresh(); } catch (e) { /* closed */ } }); return { loading: true }; }
    const days = daysFor(a.key);
    if (days.length < MIN_DAYS) return { na: `Needs at least ${MIN_DAYS} past days of 1-minute history (now ${days.length}). Open Replay → "Download From Upstox" once (about a minute).`, need: true };
    const st = s.setup || setupFor(a, s.state), e = a.price;
    if (!st || !(st.risk > 0) || !(e > 0)) return null;
    const plan = { m0: clamp(a.curMin, 0, END - 5), dir: s.state, sl: st.risk / e, tp: Math.abs(st.t1 - e) / e };
    const today = (() => { const tb = a.D.candles.filter((c) => c.d === 2).map((c) => [c.m, c.o, c.h, c.l, c.c]); return cond(tb, plan.m0); })();
    const ck = [a.key, plan.m0, plan.dir, plan.sl.toFixed(5), plan.tp.toFixed(5), today ? today.vw + '' + today.mom : ''].join('|');
    if (!cache[ck]) cache[ck] = { res: run(days, plan, today), plan, today, from: days[0].date, to: days[days.length - 1].date, demo: !!(data && data.demo) };
    return cache[ck];
  }
  // plain meaning of a result, for the screen
  function meaning(R) {
    const m = R.mc.n ? R.mc : R.replay; if (!m.n) return '';
    const edge = m.tgt - m.stop;
    if (m.avgR > 0.15 && edge > 0.1) return 'In the past, this plan reached its target clearly more often than its stop. History is on your side, but it is still not a sure thing.';
    if (m.avgR < -0.15 || edge < -0.1) return 'In the past, this plan hit its stop more often than its target. History says this is a weak trade at this time of day.';
    return 'In the past, this plan was close to a coin flip at this time of day. The edge, if any, is small.';
  }

  /* ---------- demo: made-up 1-minute history so the card can be seen offline (never used in live mode) ---------- */
  function demoData() {
    const r = rngOf(31), inst = {};
    [['NIFTY', 25400, 0.00042], ['BANKNIFTY', 57200, 0.0005], ['SENSEX', 83100, 0.0004]].forEach(([k, base, sg]) => {
      const m1 = {}; let p = base, d = Date.UTC(2026, 7, 3);
      for (let n = 0; n < 70;) { d += 864e5; const wd = new Date(d).getUTCDay(); if (wd === 0 || wd === 6) continue; n++;
        const rows = [], drift = (r() - 0.5) * 0.00004; p *= 1 + (r() - 0.5) * 0.006;
        for (let m = 0; m < 375; m++) { const s = sg * (m < 30 ? 1.8 : m > 345 ? 1.4 : 1), o = p, g = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
          const c = o * (1 + drift + g() * s), h = Math.max(o, c) * (1 + Math.abs(g()) * s * 0.6), l = Math.min(o, c) * (1 - Math.abs(g()) * s * 0.6); rows.push([m, o, h, l, c, 0, 0]); p = c; }
        m1[new Date(d).toISOString().slice(0, 10)] = rows; }
      inst[k] = { key: k, m1, d1: [] };
    });
    return { v: 1, demo: true, inst };
  }
  setTimeout(() => { load(); }, 4000);
  return { run, walk, cond, forSignal, meaning, load, reload: () => { loaded = false; return load(); } };
})();
if (typeof module !== 'undefined') module.exports = TimeMachine;
