/* ===== Overnight model: what happened the NEXT day after days like today =====
   Pure maths on daily candles, no AI and no guessing. Works in the browser and in Node (for tests).
   A "day like today" is described by four plain facts, each measured on that stock's own scale:
     1. how big today's move was compared with its normal daily move (big fall … big rise)
     2. where it is closing inside the day's range (near the low, middle, near the high)
     3. whether it is above or below its 50-day average
     4. whether volume is heavy (1.5× its 20-day average)
   For each stock we look up its own past days with the same facts; if fewer than MIN_N such days exist,
   we fall back to the same facts across all F&O stocks (labelled as such), and below that we say INSUFFICIENT DATA.
   Probabilities are plain counts from history. The walk-forward check measures how those counts would have done on
   days they had not seen, after delivery costs. */
const OVM = (() => {
  const MIN_N = 30, MIN_POOL = 150;
  // row = [date, open, high, low, close, volume]
  function feat(R, i, vf) {
    if (i < 51 || !R[i] || !R[i - 1]) return null;
    const c = R[i][4], pc = R[i - 1][4], h = R[i][2], l = R[i][3];
    if (!(c > 0 && pc > 0)) return null;
    let a = 0; for (let j = i - 20; j < i; j++) a += Math.abs(R[j][4] / R[j - 1][4] - 1); a /= 20;
    const chg = c / pc - 1, z = a ? chg / a : 0;
    const ch = z <= -1.5 ? 'F2' : z <= -0.5 ? 'F1' : z < 0.5 ? 'N0' : z < 1.5 ? 'R1' : 'R2';
    const clv = h > l ? (c - l) / (h - l) : 0.5, cl = clv < 0.33 ? 'L' : clv > 0.67 ? 'H' : 'M';
    let s = 0; for (let j = i - 49; j <= i; j++) s += R[j][4];
    const tr = c > s / 50 ? 'U' : 'D';
    let v = 0; for (let j = i - 20; j < i; j++) v += R[j][5] || 0; v /= 20;
    const vr = v ? ((R[i][5] || 0) * (vf || 1)) / v : 0, vo = vr >= 1.5 ? 'V' : 'n';
    return { chg, z, clv, vr, avgMove: a, ch, cl, tr, vo, k: [ch + cl + tr + vo, ch + cl + tr, ch + cl] };
  }
  function out(R, i) { const n = R[i + 1], c = R[i][4]; return n && c > 0 ? [n[1] / c - 1, n[4] / c - 1, n[2] / c - 1, n[3] / c - 1] : null; } // gap, close, high, low
  const q = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
  function stats(L) {
    const n = L.length; if (!n) return { n: 0 };
    const g = L.map((x) => x[0]), oc = L.map((x) => x[1]), hi = L.map((x) => x[2]), lo = L.map((x) => x[3]);
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    return { n, pGap: g.filter((x) => x > 0).length / n, mGap: mean(g), pUp: oc.filter((x) => x > 0).length / n, mOc: mean(oc), med: q(oc, 0.5), q10: q(oc, 0.1), q90: q(oc, 0.9),
      gq10: q(g, 0.1), gq90: q(g, 0.9), hiMed: q(hi, 0.5), hiQ75: q(hi, 0.75), loQ25: q(lo, 0.25) };
  }
  // build lookup tables from full history: H = { sym: rows }, isIdx(sym) → bool
  function build(H, isIdx) {
    const own = {}, pool = { S: {}, I: {} };
    for (const sym in H) {
      const R = H[sym], O = (own[sym] = {}), P = pool[isIdx(sym) ? 'I' : 'S'];
      for (let i = 51; i < R.length - 1; i++) {
        const f = feat(R, i), o = out(R, i); if (!f || !o) continue;
        f.k.forEach((k, lvl) => { const kk = lvl + k; (O[kk] || (O[kk] = [])).push(o); (P[kk] || (P[kk] = [])).push(o); });
      }
    }
    return { own, pool };
  }
  const LVL = ['all four facts', 'move + close + trend', 'move + close'];
  const K = 60; // a stock's own count is blended with the all-stocks count as if the latter were 60 extra days
  // pick the most detailed description that the all-stocks history still has plenty of days for
  function level(P, f, minPool) { for (let l = 0; l < 3; l++) { const a = P[l + f.k[l]]; if (a && a.length >= minPool) return l; } return -1; }
  function blend(o, p) {
    // small own samples are pulled towards the all-stocks rate (so 25 lucky days can't show 70%)
    if (!o || !o.n) return { ...p, nOwn: 0 };
    const w = (x, y) => (o.n * x + K * y) / (o.n + K);
    const big = o.n >= MIN_N;
    return { n: o.n, nOwn: o.n, pGap: w(o.pGap, p.pGap), pUp: w(o.pUp, p.pUp), mGap: w(o.mGap, p.mGap), mOc: w(o.mOc, p.mOc),
      med: big ? o.med : p.med, q10: big ? o.q10 : p.q10, q90: big ? o.q90 : p.q90, gq10: big ? o.gq10 : p.gq10, gq90: big ? o.gq90 : p.gq90,
      hiMed: big ? o.hiMed : p.hiMed, hiQ75: big ? o.hiQ75 : p.hiQ75, loQ25: big ? o.loQ25 : p.loQ25 };
  }
  function lookup(M, sym, f, idx) {
    if (!M || !f) return null;
    const P = M.pool[idx ? 'I' : 'S'], O = M.own[sym] || {}, l = level(P, f, idx ? 40 : MIN_POOL);
    if (l < 0) return { own: null, pool: null, best: null, src: null };
    const pst = stats(P[l + f.k[l]]), ost = O[l + f.k[l]] ? stats(O[l + f.k[l]]) : null, minOwn = idx ? 20 : MIN_N;
    const own = ost && ost.n >= minOwn ? { lvl: l, why: LVL[l], st: ost } : null, pool = { lvl: l, why: LVL[l], st: pst };
    return { own, pool, best: { lvl: l, why: LVL[l], st: blend(ost, pst) }, src: own ? 'own' : 'pool', nOwn: ost ? ost.n : 0 };
  }

  /* walk-forward check: walk through history day by day; each day is judged only with what was known before it */
  function validate(H, isIdx, opt) {
    const cost = opt.cost, testDays = opt.testDays || 250, top = opt.top || 5, ev = [];
    for (const sym in H) {
      if (isIdx(sym)) continue;
      const R = H[sym];
      for (let i = 51; i < R.length - 1; i++) { const f = feat(R, i), o = out(R, i); if (f && o) ev.push({ d: R[i][0], sym, k: f.k, o }); }
    }
    if (!ev.length) return null;
    ev.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const dates = [...new Set(ev.map((e) => e.d))], startTest = dates[Math.max(0, dates.length - testDays)];
    const oc = {}, pc = {}, add = (T, k, o) => { const c = T[k] || (T[k] = { n: 0, g: 0, u: 0, s: 0 }); c.n++; if (o[0] > 0) c.g++; if (o[1] > 0) c.u++; c.s += o[1]; };
    const bins = [[0, 0.45], [0.45, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 1.01]], cal = { gap: bins.map(() => ({ n: 0, hit: 0 })), up: bins.map(() => ({ n: 0, hit: 0 })) };
    const bi = (p) => bins.findIndex(([a, b]) => p >= a && p < b);
    const trades = [], daily = [];
    let base = { n: 0, s: 0 }, i = 0;
    while (i < ev.length) {
      const d = ev[i].d; let j = i; while (j < ev.length && ev[j].d === d) j++;
      const grp = ev.slice(i, j);
      if (d >= startTest) {
        const cand = [];
        grp.forEach((e) => {
          base.n++; base.s += e.o[1] - cost;
          let l = -1; for (let z = 0; z < 3 && l < 0; z++) { const x = pc[z + e.k[z]]; if (x && x.n >= MIN_POOL) l = z; }
          if (l < 0) return;
          const P = pc[l + e.k[l]], O = oc[e.sym + '|' + l + e.k[l]] || { n: 0, g: 0, u: 0, s: 0 };
          const bl = (a, b) => (a + K * (b / P.n)) / (O.n + K); // same blend as the live lookup
          const pg = bl(O.g, P.g), pu = bl(O.u, P.u), mo = bl(O.s, P.s);
          const b1 = bi(pg), b2 = bi(pu);
          if (b1 >= 0) { cal.gap[b1].n++; if (e.o[0] > 0) cal.gap[b1].hit++; }
          if (b2 >= 0) { cal.up[b2].n++; if (e.o[1] > 0) cal.up[b2].hit++; }
          if (pu >= 0.55 && mo - cost > 0) cand.push({ e, mo });
        });
        const pick = cand.sort((a, b) => b.mo - a.mo).slice(0, top);
        if (pick.length) { const r = pick.map((p) => ({ d, sym: p.e.sym, close: p.e.o[1] - cost, open: p.e.o[0] - cost })); trades.push(...r); daily.push({ d, r: r.reduce((s, x) => s + x.close, 0) / r.length }); }
      }
      grp.forEach((e) => { e.k.forEach((k, l) => { add(oc, e.sym + '|' + l + k, e.o); add(pc, l + k, e.o); }); });
      i = j;
    }
    const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
    const res = (f) => { const w = trades.filter((t) => f(t) > 0), l = trades.filter((t) => f(t) <= 0), gw = sum(w, f), gl = -sum(l, f);
      return { n: trades.length, win: trades.length ? w.length / trades.length : null, avg: trades.length ? sum(trades, f) / trades.length : null, pf: gl ? gw / gl : null }; };
    let run = 0, peak = 0, dd = 0; daily.forEach((x) => { run += x.r; peak = Math.max(peak, run); dd = Math.max(dd, peak - run); });
    const C = res((t) => t.close), Op = res((t) => t.open);
    return { from: startTest, to: dates[dates.length - 1], days: dates.filter((d) => d >= startTest).length, stocks: Object.keys(H).filter((s) => !isIdx(s)).length, cost,
      cal: { bins, gap: cal.gap, up: cal.up }, close: C, open: Op, daysTraded: daily.length, maxDD: dd, base: base.n ? base.s / base.n : null,
      edge: C.n >= 100 && C.avg > 0 && C.pf > 1.1 ? 'found' : C.n >= 100 ? 'none' : 'few' };
  }

  /* delivery (BTST) costs as a fraction of the amount, both sides, plus a little slippage */
  function costPct(amount, CH, B) {
    const brk = (CH && CH.BROKERAGE) || 20, sebi = (CH && CH.SEBI) || 0.000001, gst = (CH && CH.GST) || 0.18;
    const stt = (B && B.STT) || 0.001, stamp = (B && B.STAMP) || 0.00015, txn = (B && B.TXN) || 0.0000297, slip = ((B && B.SLIP_PCT) || 0.05) / 100;
    const a = amount || 50000, fees = 2 * brk + 2 * stt * a + stamp * a + 2 * txn * a + 2 * sebi * a, g = gst * (2 * brk + 2 * txn * a + 2 * sebi * a);
    return (fees + g) / a + 2 * slip;
  }
  return { feat, out, stats, build, lookup, validate, costPct, MIN_N };
})();
if (typeof module !== 'undefined') module.exports = OVM;
