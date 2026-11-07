/* ===== Market structure, level reactions, OI flow, gaps, opening type and world cues =====
   What a professional reads before and during a trade, beyond the indicator score:
   1. Is this move noise, a pullback, a break of structure (trend continues) or a change of character (first reversal sign)?
   2. A level is coming: is it more likely to hold or break, and what would confirm either?
   3. Are option writers changing sides (OI character switch)?
   4. Today's gap: how gaps like it behaved over the past year, what caused it, and how the open is behaving.
   5. World cues: what GIFT Nifty, US futures, Asia, crude, dollar and yields say about the Indian open. */

/* ---------- 1. Swing structure, breaks counted on candle CLOSES (a wick through a level is a sweep, not a break) ---------- */
function smcRead(k, piv, at, live) {
  const n = k.length, tol = at * 0.05, ev = [], hs = [], ls = [];
  if (n < piv * 2 + 6 || !at) return null;
  let H = null, L = null, trend = 0, pend = null;
  for (let j = 0; j < n; j++) {
    const i = j - piv; // pivot candidate that gets confirmed at bar j
    if (i >= piv) {
      let hi = true, lo = true;
      for (let q = 1; q <= piv; q++) { if (!(k[i].h >= k[i - q].h && k[i].h > k[i + q].h)) hi = false; if (!(k[i].l <= k[i - q].l && k[i].l < k[i + q].l)) lo = false; }
      if (hi) { H = { v: k[i].h, i }; hs.push(H); }
      if (lo) { L = { v: k[i].l, i }; ls.push(L); }
    }
    const x = k[j], closed = !(live && j === n - 1);
    if (H && !H.used) {
      if (x.c > H.v + tol) {
        if (closed) { ev.push({ j, d: x.d, m: x.m, type: trend === 1 ? 'BOS' : 'CHoCH', dir: 1, lvl: H.v }); trend = 1; H.used = true; }
        else pend = { dir: 1, lvl: H.v, type: trend === 1 ? 'BOS' : 'CHoCH' };
      } else if (closed && !H.sw && x.h > H.v + tol && x.c < H.v) { H.sw = true; ev.push({ j, d: x.d, m: x.m, type: 'SWEEP', dir: -1, lvl: H.v, ext: x.h }); }
    }
    if (L && !L.used) {
      if (x.c < L.v - tol) {
        if (closed) { ev.push({ j, d: x.d, m: x.m, type: trend === -1 ? 'BOS' : 'CHoCH', dir: -1, lvl: L.v }); trend = -1; L.used = true; }
        else pend = { dir: -1, lvl: L.v, type: trend === -1 ? 'BOS' : 'CHoCH' };
      } else if (closed && !L.sw && x.l < L.v - tol && x.c > L.v) { L.sw = true; ev.push({ j, d: x.d, m: x.m, type: 'SWEEP', dir: 1, lvl: L.v, ext: x.l }); }
    }
  }
  return { trend, ev, H, L, hs, ls, pend, n };
}
const evName = (e) => (e.type === 'BOS' ? 'Break of structure' : e.type === 'CHoCH' ? 'Change of character' : 'Liquidity sweep');
const evTime = (e) => (e.d === 2 ? hm(e.m) : 'prev. session');

function structureOf(a) {
  const k5 = a.I5.k.slice(-90), live = !!a.sessionLive, at = a.atr;
  const M = smcRead(k5, 2, at, live);
  if (!M) return null;
  const k1 = a.D.candles.slice(-150), at1 = (a.short && a.short.atr) || at / 2.2;
  const m = smcRead(k1, 3, at1, live);
  const price = a.price, d = M.trend, ago = (e, k) => (e ? k.length - 1 - e.j : 999);
  const brk = M.ev.filter((e) => e.type !== 'SWEEP'), last = brk[brk.length - 1] || null;
  const sweep = M.ev.filter((e) => e.type === 'SWEEP').pop();
  const mBrk = m ? m.ev.filter((e) => e.type !== 'SWEEP') : [], micro = mBrk[mBrk.length - 1] || null, microAgo = ago(micro, k1);
  const word = d === 1 ? 'uptrend' : 'downtrend';
  const prot = d === 1 ? M.L && M.L.v : d === -1 ? M.H && M.H.v : null; // the swing that must hold for the trend to stay intact
  const since = last ? k5.slice(last.j) : k5.slice(-12);
  const ext = d === 1 ? Math.max(...since.map((x) => x.h)) : d === -1 ? Math.min(...since.map((x) => x.l)) : null;
  const pull = d ? (ext - price) * d : 0, leg = d && ok(prot) ? Math.abs(ext - prot) : null, retr = leg ? pull / leg : null;
  const S = { trend: d, prot, ext, pull, retr, last, sweep: sweep && ago(sweep, k5) <= 3 ? sweep : null, micro, microAgo, microTrend: m ? m.trend : 0, pend: M.pend, events: M.ev.slice(-8), at };
  const nm = (x) => (x > 0 ? 'up' : 'down');
  if (last && last.type === 'CHoCH' && ago(last, k5) <= 8) {
    // a fresh character change: confirmed once the next swing fails to get back (lower high / higher low)
    const after = (last.dir < 0 ? M.hs : M.ls).filter((s) => s.i > last.j);
    const conf = after.length > 0;
    const pre = k5.slice(Math.max(0, last.j - 12), last.j + 1), origin = last.dir < 0 ? Math.max(...pre.map((x) => x.h)) : Math.min(...pre.map((x) => x.l));
    Object.assign(S, { state: 'choch', dir: last.dir, confirmed: conf, origin, tone: last.dir > 0 ? 'call' : 'put',
      label: `Change of character (5m): the ${last.dir < 0 ? 'uptrend broke its last higher low' : 'downtrend broke its last lower high'} at ${f0(last.lvl)} (${evTime(last)})`,
      detail: conf ? `Confirmed: the bounce after the break made a ${last.dir < 0 ? 'lower high' : 'higher low'}. Treat the old trend as over until price gets back beyond ${f0(origin)}.`
        : `First warning of a reversal, not yet a confirmed one. Confirmed if the next ${last.dir < 0 ? 'bounce stalls below' : 'dip holds above'} ${f0(origin)}. If price closes back ${last.dir < 0 ? 'above' : 'below'} ${f0(last.lvl)}, it was a stop hunt.` });
  } else if (d && M.pend && M.pend.dir === -d) {
    Object.assign(S, { state: 'testing', tone: 'warn', label: `Breaking the ${d > 0 ? 'protected low' : 'protected high'} ${f0(M.pend.lvl)} right now`,
      detail: `If this 5-minute candle closes ${d > 0 ? 'below' : 'above'} ${f0(M.pend.lvl)}, the ${word}'s character changes. Until the close, it can still be a wick (stop hunt).` });
  } else if (d && ok(prot) && Math.abs(price - prot) < 0.35 * at) {
    Object.assign(S, { state: 'testing', tone: 'warn', label: `Testing the ${d > 0 ? 'protected low' : 'protected high'} ${f0(prot)}`,
      detail: `This swing has to hold for the ${word} to stay intact. A 5-minute close ${d > 0 ? 'below' : 'above'} it is a change of character; a bounce from it is a pullback entry.` });
  } else if (d && pull < 0.6 * at) {
    if (micro && micro.type === 'CHoCH' && micro.dir === -d && microAgo <= 6)
      Object.assign(S, { state: 'micro', tone: 'warn', label: `1-minute turned ${nm(-d)} inside a 5-minute ${word}`,
        detail: `Early warning only. The 5-minute ${word} is intact while price stays ${d > 0 ? 'above' : 'below'} ${f0(prot)}. Most 1-minute flips like this end as small pullbacks.` });
    else if (last && last.type === 'BOS' && ago(last, k5) <= 3)
      Object.assign(S, { state: 'bos', tone: d > 0 ? 'call' : 'put', label: `Break of structure: ${word} continues past ${f0(last.lvl)}`,
        detail: `A candle closed beyond the last swing. Continuation is the higher-odds path; the first pullback towards ${f0(last.lvl)} is the usual re-entry.` });
    else Object.assign(S, { state: 'noise', tone: 'info', label: `Noise: a ${f0(pull)}-point wobble inside the ${word}`,
      detail: `Smaller than 0.6 ATR (${f0(0.6 * at)} pts) and no swing broken. Nothing to act on; don't flip direction on moves this size.` });
  } else if (d) {
    const pct = Math.round((retr || 0) * 100);
    Object.assign(S, { state: 'pullback', tone: retr > 0.786 ? 'warn' : 'info', label: `Pullback of ${pct}% in the ${word} (${f0(pull)} pts from ${f0(ext)})`,
      detail: retr > 0.786 ? `Deep pullback: past 78.6% of the last leg. The ${word} is weak; a close ${d > 0 ? 'below' : 'above'} ${f0(prot)} would change its character.`
        : `Healthy while price stays ${d > 0 ? 'above' : 'below'} the ${d > 0 ? 'protected low' : 'protected high'} ${f0(prot)}. The 38.2–61.8% zone is where trend traders look for the turn.` });
  } else Object.assign(S, { state: 'range', tone: 'info', label: 'No swing trend on 5-minute yet', detail: 'Swings overlap without breaking each other: a range. Breakouts from ranges fail often; wait for a close beyond the range.' });
  if (S.sweep) S.sweepTxt = `Liquidity sweep at ${evTime(S.sweep)}: a wick ${S.sweep.dir < 0 ? 'above' : 'below'} the swing ${S.sweep.dir < 0 ? 'high' : 'low'} ${f0(S.sweep.lvl)} closed back inside. Stops were taken there; moves after a sweep often go the other way.`;
  return S;
}

/* ---------- 3. Option OI history (kept in the browser, one sample per market minute, 90 minutes) ---------- */
const OIH = {};
function oiRecord(a) {
  const rows = a.ch.rows; if (!rows.length || !a.sessionLive) return;
  const t = a.curMin, st = a.ch.step;
  let H = OIH[a.key];
  if (!H || (H.s.length && t < H.s[H.s.length - 1].t - 5)) H = OIH[a.key] = { s: [] };
  const snap = { t, px: a.price, m: {} };
  rows.forEach((r) => { if (Math.abs(r.K - a.price) <= st * 12) snap.m[r.K] = [r.ce.oi || 0, r.pe.oi || 0, r.ce.ltp, r.pe.ltp]; });
  const last = H.s[H.s.length - 1];
  if (last && last.t === t) H.s[H.s.length - 1] = snap; else H.s.push(snap);
  while (H.s.length && H.s[0].t < t - 90) H.s.shift();
}
function oiThen(key, mins, from) {
  const H = OIH[key]; if (!H || H.s.length < 2) return null;
  const now = from || H.s[H.s.length - 1], tgt = now.t - mins; let best = null;
  for (const s of H.s) if (s.t <= tgt) best = s;
  if (!best && now.t - H.s[0].t >= mins * 0.6 && H.s[0] !== now) best = H.s[0];
  return best;
}
function oiFlow(a) {
  const H = OIH[a.key], now = H && H.s[H.s.length - 1];
  if (!a.cf.opt || !now) return { ready: false, mins: 0 };
  const p15 = oiThen(a.key, 15);
  if (!p15) return { ready: false, mins: now.t - H.s[0].t };
  const p30 = oiThen(a.key, 15, p15), st = a.ch.step, atm = a.ch.atm;
  const Ks = Object.keys(now.m).map(Number).filter((K) => Math.abs(K - atm) <= st * 4.01 && p15.m[K]).sort((x, y) => x - y);
  const dOf = (A, B, K, i) => (A.m[K] && B.m[K] ? A.m[K][i] - B.m[K][i] : 0);
  const sumD = (A, B, i) => Ks.reduce((s, K) => s + dOf(A, B, K, i), 0);
  const tot = Ks.reduce((s, K) => s + now.m[K][0] + now.m[K][1], 0) || 1;
  const biasOf = (c, p) => (Math.abs(c) + Math.abs(p) < tot * 0.004 ? 0 : (p - c) / (Math.abs(p) + Math.abs(c)));
  const ce15 = sumD(now, p15, 0), pe15 = sumD(now, p15, 1), bias = biasOf(ce15, pe15);
  const prevBias = p30 ? biasOf(sumD(p15, p30, 0), sumD(p15, p30, 1)) : null;
  const wall = (S, i) => { let b = null; for (const K in S.m) if (Math.abs(K - S.px) <= st * 10 && (!b || S.m[K][i] > b[1])) b = [+K, S.m[K][i]]; return b; };
  const old = p30 || p15, cw = wall(now, 0), pw = wall(now, 1), cw0 = wall(old, 0), pw0 = wall(old, 1);
  const per = Ks.map((K) => ({ K, ce: now.m[K][0], pe: now.m[K][1], dce: dOf(now, p15, K, 0), dpe: dOf(now, p15, K, 1) }));
  const pxMove = (now.px - p15.px) / (a.atr || 1);
  const notes = [], L = (v) => f1(v / 1e5) + 'L';
  if (ok(prevBias) && prevBias >= 0.3 && bias <= -0.3) notes.push(['put', 'switch-', 'OI character switched bearish: 15 minutes ago put writers were adding near the money (support building); now call writers are adding and puts are being cut. Rallies are likely to be sold.']);
  if (ok(prevBias) && prevBias <= -0.3 && bias >= 0.3) notes.push(['call', 'switch+', 'OI character switched bullish: 15 minutes ago call writers were adding near the money (resistance building); now put writers are adding and calls are being cut. Dips are likely to be bought.']);
  if (pw && pw0 && pw[0] !== pw0[0]) notes.push([pw[0] > pw0[0] ? 'call' : 'put', 'pw' + pw[0], `Put OI wall moved ${pw[0] > pw0[0] ? 'up' : 'down'} from ${pw0[0]} to ${pw[0]}: support is ${pw[0] > pw0[0] ? 'rising with price (bullish)' : 'slipping lower (bearish)'}.`]);
  if (cw && cw0 && cw[0] !== cw0[0]) notes.push([cw[0] > cw0[0] ? 'call' : 'put', 'cw' + cw[0], `Call OI wall moved ${cw[0] > cw0[0] ? 'up' : 'down'} from ${cw0[0]} to ${cw[0]}: resistance is ${cw[0] > cw0[0] ? 'moving away (bullish)' : 'coming down on price (bearish)'}.`]);
  const atWall = (W, i) => (W && p15.m[W[0]] && p15.m[W[0]][i] > 0 ? (now.m[W[0]][i] - p15.m[W[0]][i]) / p15.m[W[0]][i] : null);
  const pwCh = atWall(pw, 1), cwCh = atWall(cw, 0);
  if (ok(pwCh) && pwCh < -0.08) notes.push(['put', 'pweak' + pw[0], `Put writers at ${pw[0]} cut ${Math.round(-pwCh * 100)}% of their OI in 15 minutes: support there is weakening.`]);
  if (ok(cwCh) && cwCh < -0.08) notes.push(['call', 'cweak' + cw[0], `Call writers at ${cw[0]} cut ${Math.round(-cwCh * 100)}% of their OI in 15 minutes: resistance there is weakening (breakout risk).`]);
  if (pxMove > 0.6 && ce15 < 0 && -ce15 > Math.abs(pe15) * 0.5) notes.push(['call', 'scover', `Short covering: price up ${f1(pxMove)} ATR while call OI near the money fell ${L(-ce15)}. Covering rallies are fast but can stall once the writers are out.`]);
  if (pxMove < -0.6 && pe15 < 0 && -pe15 > Math.abs(ce15) * 0.5) notes.push(['put', 'punwind', `Put writers exiting into the fall: price down ${f1(-pxMove)} ATR while put OI near the money fell ${L(-pe15)}. Supports can give way fast.`]);
  const read = bias >= 0.3 ? 'Put writers dominate near the money (they expect support): bullish' : bias <= -0.3 ? 'Call writers dominate near the money (they expect a cap): bearish' : 'No side dominates the last 15 minutes of OI change';
  return { ready: true, ce15, pe15, bias, prevBias, cw, pw, cw0, pw0, per, notes, pxMove, read, span: now.t - old.t };
}

/* ---------- 2. Level reaction pre-alerts ---------- */
function levelWatch(a, S, F) {
  const at = a.atr, price = a.price, raw = [];
  const addL = (n, v) => { if (ok(v)) raw.push({ n, v }); };
  (a.lv || []).forEach(([n, v]) => addL(n, v));
  if (S && ok(S.prot)) addL(S.trend > 0 ? 'Protected swing low (5m)' : 'Protected swing high (5m)', S.prot);
  if (a.pb && a.pb.state === 'pullback') { addL('Fib 61.8% of last leg', a.pb.z618); addL('Fib 78.6% (reversal line)', a.pb.z786); }
  if (ok(a.PH)) addL('Previous day high', a.PH);
  if (ok(a.PL)) addL('Previous day low', a.PL);
  // levels closer than 0.15 ATR are one zone (confluence makes a level stronger)
  raw.sort((x, y) => x.v - y.v);
  const Z = [];
  raw.forEach((l) => { const z = Z[Z.length - 1]; if (z && l.v - z.hi <= 0.15 * at) { z.names.push(l.n); z.hi = l.v; z.v = (z.lo + z.hi) / 2; } else Z.push({ names: [l.n], lo: l.v, hi: l.v, v: l.v }); });
  const above = Z.filter((z) => z.lo > price + 0.05 * at).sort((x, y) => x.lo - y.lo)[0];
  const below = Z.filter((z) => z.hi < price - 0.05 * at).sort((x, y) => y.hi - x.hi)[0];
  const k5t = a.I5.k.filter((x) => x.d === 2), n5 = k5t.length;
  const evalZ = (z, R) => {
    if (!z) return null;
    const v = R ? z.lo : z.hi, dist = Math.abs(v - price), sd = R ? 1 : -1, hold = [], brk = [];
    // how many separate times today price came within 0.15 ATR of it
    let tests = 0, lastT = -9;
    k5t.forEach((x, i) => { const touch = R ? x.h >= v - 0.15 * at && x.c < v + 0.1 * at : x.l <= v + 0.15 * at && x.c > v - 0.1 * at; if (touch) { if (i - lastT > 2) tests++; lastT = i; } });
    if (tests >= 2) brk.push([1.5, `Tested ${tests} times today: each test uses up the orders defending it, so later tests break more often`]);
    else hold.push([1, 'First test of the level today: first tests hold more often']);
    if (z.names.length >= 2) hold.push([1, `Confluence: ${z.names.length} levels in one zone (${z.names.slice(0, 3).join(', ')})`]);
    if (n5 >= 4) {
      const speed = ((price - k5t[n5 - 4].c) / at) * sd, rng = k5t.slice(-3).reduce((s, x) => s + (x.h - x.l), 0) / 3 / at;
      if (speed > 1.2 && rng > 1) brk.push([1.5, `Fast approach with wide candles (${f1(speed)} ATR in 15 min): momentum carries through levels`]);
      else if (speed > 0 && speed < 0.5 && rng < 0.7) hold.push([1, 'Slow approach, candles shrinking: momentum is fading into the level']);
      const wick = k5t.slice(-3).filter((x) => { const r = x.h - x.l || 1; return (R ? x.h - Math.max(x.o, x.c) : Math.min(x.o, x.c) - x.l) / r > 0.5; }).length;
      if (wick >= 2) hold.push([1.5, `${wick} of the last 3 candles left long ${R ? 'upper' : 'lower'} wicks: ${R ? 'sellers' : 'buyers'} are already reacting`]);
    }
    if (S && S.trend === sd) brk.push([1, `The 5-minute ${sd > 0 ? 'uptrend' : 'downtrend'} points into the level`]);
    else if (S && S.trend === -sd) hold.push([1, `The 5-minute trend points away from the level (${sd > 0 ? 'downtrend' : 'uptrend'})`]);
    if (R && a.rsi > 70 && !(a.adx >= 25)) hold.push([0.5, `RSI ${f0(a.rsi)} overbought without a strong trend`]);
    if (!R && a.rsi < 30 && !(a.adx >= 25)) hold.push([0.5, `RSI ${f0(a.rsi)} oversold without a strong trend`]);
    if (a.fut && a.fut.m30) { const fd = a.fut.m30[1] * sd; if (fd > 0) brk.push([1, `Futures last 30 min: ${a.fut.m30[0]}`]); else if (fd < 0) hold.push([1, `Futures last 30 min: ${a.fut.m30[0]}`]); }
    // OI at the strike nearest the level: writers defending or running?
    let K = null;
    if (a.cf.opt && a.ch.rows.length) {
      K = nearestRow(a.ch.rows, v).K;
      const p = F && F.ready ? F.per.find((x) => x.K === K) : null, now = OIH[a.key] && OIH[a.key].s[OIH[a.key].s.length - 1], m = now && now.m[K];
      if (p && m) {
        const ce0 = m[0] - p.dce, pe0 = m[1] - p.dpe, dc = ce0 > 0 ? p.dce / ce0 : 0, dp = pe0 > 0 ? p.dpe / pe0 : 0, pc = (x) => `${sgn(x * 100)}${f0(x * 100)}%`;
        if (R) {
          if (dc > 0.03) hold.push([2, `Call writers adding at ${K} (${pc(dc)} OI in 15 min): they are defending it`]);
          if (dc < -0.05) brk.push([2, `Call writers covering at ${K} (${pc(dc)} OI in 15 min): the defence is leaving`]);
          if (dp > 0.05) brk.push([1, `Put writers moving up to ${K} (${pc(dp)} OI): support is following price`]);
        } else {
          if (dp > 0.03) hold.push([2, `Put writers adding at ${K} (${pc(dp)} OI in 15 min): they are defending it`]);
          if (dp < -0.05) brk.push([2, `Put writers exiting at ${K} (${pc(dp)} OI in 15 min): the defence is leaving`]);
          if (dc > 0.05) brk.push([1, `Call writers moving down to ${K} (${pc(dc)} OI): pressure is following price`]);
        }
      } else if (z.names.some((x) => /OI wall/.test(x))) hold.push([1, `Biggest ${R ? 'call' : 'put'} OI of the chain sits here (live OI change needs 15 minutes of data)`]);
    }
    const hs = hold.reduce((s, x) => s + x[0], 0), bs = brk.reduce((s, x) => s + x[0], 0), diff = bs - hs;
    const verdict = diff >= 1.5 ? 'break' : diff <= -1.5 ? 'hold' : 'either';
    const vTxt = verdict === 'break' ? 'Breakout more likely' : verdict === 'hold' ? (R ? 'Rejection more likely' : 'Bounce more likely') : 'Could go either way';
    const nm = (x) => (x === 'CE' ? (a.cf.opt ? 'CALL' : 'long') : a.cf.opt ? 'PUT' : 'short');
    return { R, v, z, dist, distATR: dist / at, near: dist <= 0.6 * at, tests, K, hold, brk, hs, bs, verdict, vTxt,
      kind: R ? 'Resistance' : 'Support', name: z.names[0] + (z.names.length > 1 ? ` + ${z.names.length - 1} more` : ''),
      confirmBreak: `A 5-minute close ${R ? 'above' : 'below'} ${f0(v + sd * 0.1 * at)}${K ? ` with ${R ? 'call' : 'put'} OI at ${K} falling` : ''}`,
      confirmHold: `A 1-minute ${R ? 'lower high' : 'higher low'} and a close back ${R ? 'below' : 'above'} ${f0(v - sd * 0.25 * at)}${K ? ` with ${R ? 'call' : 'put'} OI at ${K} rising` : ''}`,
      act: verdict === 'hold' ? `Don't buy ${nm(R ? 'CE' : 'PE')} into the level. ${nm(R ? 'PE' : 'CE')} only after the ${R ? 'rejection' : 'bounce'} is confirmed.`
        : verdict === 'break' ? `If you hold ${nm(R ? 'PE' : 'CE')}, tighten the stop just ${R ? 'above' : 'below'} the level. ${nm(R ? 'CE' : 'PE')} only after the 5-minute close beyond it.`
          : 'Let the level decide. Act on whichever confirmation comes first, not before.' };
  };
  return { above: evalZ(above, true), below: evalZ(below, false) };
}

/* ---------- 4. Gaps: base rates from a year of daily candles, today's gap, its cause, and the opening type ---------- */
function gapStudy(a) {
  const today = istYmd(), rows = ((a.D.daily && a.D.daily.rows) || []).filter((r) => !(String(r[0]) >= today && /^\d{4}-/.test(String(r[0]))));
  if (rows.length < 40) return null;
  const B = () => ({ n: 0, same: 0, go: 0, fill: 0 }), st = { up: { small: B(), big: B() }, dn: { small: B(), big: B() } };
  const atrAt = (i) => { const z = rows.slice(Math.max(0, i - 14), i); return z.reduce((s, r) => s + (r[2] - r[3]), 0) / (z.length || 1); };
  for (let i = 15; i < rows.length; i++) {
    const pc = rows[i - 1][4], [, o, h, l, c] = rows[i], A1 = atrAt(i); if (!A1 || !ok(o) || o <= 0) continue;
    const g = (o - pc) / A1; if (Math.abs(g) < 0.15) continue;
    const up = g > 0, b = st[up ? 'up' : 'dn'][Math.abs(g) >= 0.5 ? 'big' : 'small'];
    b.n++; if (up ? c > pc : c < pc) b.same++; if (up ? c > o : c < o) b.go++; if (up ? l <= pc : h >= pc) b.fill++;
  }
  const res = { st, days: rows.length, A: atrAt(rows.length) };
  const t = a.D.candles.filter((x) => x.d === 2);
  if (!t.length || !ok(a.PC)) return res;
  const o = t[0].o, g = (o - a.PC) / (res.A || 1), pts = o - a.PC;
  const T = { o, pts, pct: (pts / a.PC) * 100, g, side: Math.abs(g) < 0.15 ? 'flat' : g > 0 ? 'up' : 'dn', size: Math.abs(g) >= 0.5 ? 'big' : 'small' };
  if (T.side !== 'flat') {
    T.base = st[T.side][T.size];
    const up = T.side === 'up';
    T.filled = up ? a.DL <= a.PC : a.DH >= a.PC;
    T.fillPct = clamp(up ? (o - a.DL) / (o - a.PC) : (a.DH - o) / (a.PC - o), 0, 1);
    T.vsOpen = (a.price - o) * (up ? 1 : -1);
  }
  res.today = T;
  res.driver = gapDriver(a, T);
  return res;
}
// Why did it gap? A gap with a clear cause (big news, world markets agreeing) tends to run; a gap without one tends to fade.
function gapDriver(a, T) {
  const out = { items: [], score: 0 };
  if (!T || T.side === 'flat') return out;
  const sd = T.side === 'up' ? 1 : -1, ms = (n) => (ok(n.ts) ? n.ts : typeof agoMs === 'function' ? agoMs(n.ago) : null);
  const fresh = (a.news || []).filter((n) => { const t = ms(n); return t && Date.now() - t < 20 * 3600e3 && (n.imp === 'high' || Math.abs(n.s) >= 0.5); });
  const withGap = fresh.filter((n) => n.s * sd > 0.15), against = fresh.filter((n) => n.s * sd < -0.15);
  if (withGap.length) { out.score += Math.min(2, withGap.length); out.items.push(['ok', `${withGap.length} high-impact headline${withGap.length > 1 ? 's' : ''} since yesterday point the same way as the gap ("${withGap[0].t.slice(0, 80)}")`]); }
  if (against.length) { out.score -= 1; out.items.push(['wr', `${against.length} high-impact headline${against.length > 1 ? 's' : ''} point the other way`]); }
  if (!fresh.length) out.items.push(['n', 'No high-impact news since yesterday: the gap has no clear cause, and such gaps fade more often']);
  const W = worldRead(a);
  if (W && ok(W.score) && Math.abs(W.score) >= 15) {
    if (W.score * sd > 0) { out.score += 1; out.items.push(['ok', `World cues agree with the gap (${W.lean})`]); }
    else { out.score -= 1; out.items.push(['wr', `World cues disagree with the gap (${W.lean})`]); }
  }
  if (a.events && a.events.length) out.items.push(['wr', `Event risk today: ${a.events[0].t}`]);
  if (a.D.geo && /High|Elevated/.test(a.D.geo.level || '')) { out.score += sd < 0 ? 1 : -1; out.items.push([sd < 0 ? 'ok' : 'wr', `Geopolitical news ${a.D.geo.level.toLowerCase()}`]); }
  out.verdict = out.score >= 2 ? 'Strong cause: gap-and-go odds are higher' : out.score <= 0 ? 'Weak or no cause: fade (gap-fill) odds are higher' : 'Some cause: let the first 30 minutes decide';
  return out;
}
// Opening types (Market Profile, J. Dalton): how the first 30 minutes trade says a lot about the rest of the day
function openingType(a) {
  const SS = a.SS, t = a.D.candles.filter((x) => x.d === 2), mins = a.curMin - SS.o, at = a.atr;
  if (!t.length || !a.sessionLive && !t.length) return null;
  if (mins < 10) return { type: 'forming', name: 'Opening forming', note: 'The first minutes are price discovery: overnight orders, stop orders and option hedges all hit at once. Signals stay locked till ' + hm(SS.o + 15) + '.' };
  const f = t.filter((x) => x.m < SS.o + 30), o = t[0].o;
  let hi = -Infinity, lo = Infinity, iH = 0, iL = 0;
  f.forEach((x, i) => { if (x.h > hi) { hi = x.h; iH = i; } if (x.l < lo) { lo = x.l; iL = i; } });
  const up = hi - o, dn = o - lo, c = f[f.length - 1].c, pos = (c - lo) / (hi - lo || 1), done = mins >= 30;
  const firstUp = iH < iL; // which extreme came first
  const firstEx = firstUp ? up : dn, secondEx = firstUp ? dn : up, driveDir = firstUp ? -1 : 1;
  const gap = ok(a.PC) ? o - a.PC : 0, gapDir = Math.abs(gap) > 0.15 * at ? Math.sign(gap) : 0;
  let r;
  if (Math.min(up, dn) <= 0.25 * at && Math.max(up, dn) >= 1.0 * at && (up > dn ? pos > 0.7 : pos < 0.3)) {
    const d = up > dn ? 1 : -1;
    r = { type: 'OD', dir: d, name: `Open-Drive ${d > 0 ? 'up' : 'down'}`, note: `Price left the open in one direction and never looked back. Trend-day odds are high ${d > 0 ? 'upward' : 'downward'}: buy pullbacks to VWAP ${d > 0 ? 'in calls' : 'in puts'}, don't fade it.` };
  } else if (firstEx >= 0.3 * at && firstEx < 0.8 * at && secondEx >= 1.0 * at && (driveDir > 0 ? c > o : c < o)) {
    r = { type: 'OTD', dir: driveDir, ext: firstUp ? hi : lo, name: `Open-Test-Drive ${driveDir > 0 ? 'up' : 'down'}`, note: `The first move ${firstUp ? 'up' : 'down'} was a test (often a stop hunt) and failed; the drive ${driveDir > 0 ? 'up' : 'down'} is the real move. Trade with the drive on pullbacks; stop beyond the test extreme ${f0(firstUp ? hi : lo)}.` };
  } else if (firstEx >= 0.8 * at && (firstUp ? c < o - 0.2 * at : c > o + 0.2 * at)) {
    r = { type: 'ORR', dir: driveDir, ext: firstUp ? hi : lo, name: `Open-Rejection-Reverse ${driveDir > 0 ? 'up' : 'down'}`, note: `A strong first move ${firstUp ? 'up' : 'down'} was rejected and price came back through the open.${gapDir && gapDir === -driveDir ? ' The gap is being sold into: expect a pull towards yesterday\'s close (gap fill).' : ''} The rejection extreme ${f0(firstUp ? hi : lo)} is the stop for trades the other way.` };
  } else if (up >= 0.4 * at && dn >= 0.4 * at && pos > 0.3 && pos < 0.7) {
    r = { type: 'OA', dir: 0, name: 'Open-Auction (two-sided)', note: 'Both sides were tested and price sits in the middle: no conviction. Range-day odds are high; option buyers lose to decay here. Wait for a 5-minute close outside the opening range.' };
  } else r = { type: 'OX', dir: 0, name: 'Mixed open', note: 'The first 30 minutes fit no clean opening type. Let the opening-range break decide.' };
  r.final = done;
  if (!done) r.name += ' (forming)';
  // early trap detection: the first push swept yesterday's high/low or the opening range and the 1-minute flipped
  const S = a.stx;
  if (mins < 60 && S && S.micro && S.micro.type === 'CHoCH' && S.microAgo <= 5) {
    const pushUp = up > dn;
    if ((pushUp && S.micro.dir < 0) || (!pushUp && S.micro.dir > 0)) {
      const swept = pushUp ? (ok(a.PH) && hi > a.PH && a.price < a.PH ? `yesterday's high ${f0(a.PH)}` : null) : ok(a.PL) && lo < a.PL && a.price > a.PL ? `yesterday's low ${f0(a.PL)}` : null;
      r.trap = `Possible opening fake-out: the first push ${pushUp ? 'up' : 'down'}${swept ? ` took out ${swept} and` : ''} has just flipped on the 1-minute. Don't chase the opening move; wait for a ${pushUp ? 'VWAP loss' : 'VWAP reclaim'} to confirm the reversal.`;
    }
  }
  return r;
}

/* ---------- 5. World cues and what they mean for the Indian market ---------- */
const CUE = {
  gift: { w: 3, s: 1, thr: 0.15, grp: 'India', why: 'Trades almost round the clock in GIFT City. Its gap to Nifty\'s last close is the best single guess of the opening gap.' },
  indicative: { w: 2, s: 1, thr: 0.15, grp: 'India', why: 'NSE pre-open (9:00–9:08) price discovery: where Nifty is about to open.' },
  dowF: { w: 1.5, s: 1, thr: 0.25, grp: 'US futures (live overnight)', why: 'US futures trade during Asian hours, so they show the mood after GIFT and the US close. Up = supportive for India.' },
  nasF: { w: 1.5, s: 1, thr: 0.3, grp: 'US futures (live overnight)', why: 'Tech-heavy. Moves Indian IT (Infosys, TCS, HCL, Wipro) most.' },
  spxF: { w: 1.5, s: 1, thr: 0.25, grp: 'US futures (live overnight)', why: 'Broadest US gauge; global funds key off it.' },
  dow: { w: 0.75, s: 1, thr: 0.3, grp: 'US close (last session)', why: 'Last close. Mostly priced into GIFT Nifty already.' },
  nas: { w: 0.75, s: 1, thr: 0.35, grp: 'US close (last session)', why: 'Last close. A big Nasdaq move often shows in Indian IT at the open.' },
  spx: { w: 0.75, s: 1, thr: 0.3, grp: 'US close (last session)', why: 'Last close. Sets global risk mood for Asia.' },
  usvix: { w: 1, s: -1, thr: 5, grp: 'US close (last session)', why: 'Fear gauge. A jump means global risk-off: FIIs sell emerging markets. Falling VIX is supportive.' },
  nikkei: { w: 1, s: 1, thr: 0.4, grp: 'Asia (live in Indian morning)', why: 'Opens before India; sets the Asian tone.' },
  hsi: { w: 1, s: 1, thr: 0.5, grp: 'Asia (live in Indian morning)', why: 'Hong Kong/China flows. Matters for metals and emerging-market funds.' },
  kospi: { w: 0.75, s: 1, thr: 0.5, grp: 'Asia (live in Indian morning)', why: 'Korea: tech and foreign flows into Asia.' },
  sse: { w: 0.5, s: 1, thr: 0.5, grp: 'Asia (live in Indian morning)', why: 'China mainland. Affects metals (Tata Steel, Hindalco).' },
  dax: { w: 0.5, s: 1, thr: 0.4, grp: 'Europe (opens 12:30–13:30 IST)', why: 'Europe opens mid-session; it moves the Indian afternoon.' },
  ftse: { w: 0.5, s: 1, thr: 0.4, grp: 'Europe (opens 12:30–13:30 IST)', why: 'UK market; risk mood in the afternoon.' },
  brent: { w: 1.5, s: -1, thr: 0.8, grp: 'Commodities', why: 'India imports about 85% of its oil. Higher crude = inflation, weaker rupee, pressure on OMCs (BPCL, HPCL, IOC), paints, airlines, tyres. Lower crude helps India. ONGC and Oil India gain when crude rises.' },
  wti: { w: 0.5, s: -1, thr: 0.8, grp: 'Commodities', why: 'US crude benchmark; moves with Brent. MCX crude follows it.' },
  gold: { w: 0.5, s: -1, thr: 0.6, grp: 'Commodities', why: 'A sharp rise is a safe-haven (fear) signal. Steady gold is neutral for equities.' },
  silver: { w: 0, s: 1, thr: 1, grp: 'Commodities', why: 'Industrial + precious metal; MCX silver follows it.' },
  natgas: { w: 0, s: -1, thr: 1.5, grp: 'Commodities', why: 'Matters for gas utilities (GAIL, IGL, MGL) and fertilisers.' },
  dxy: { w: 1, s: -1, thr: 0.25, grp: 'Currency and bonds', why: 'Stronger dollar pulls foreign money out of emerging markets like India. Weaker dollar is supportive.' },
  us10y: { w: 1, s: -1, thr: 1.2, grp: 'Currency and bonds', why: 'Higher US yields make US bonds more attractive than Indian stocks: FII selling. Hits banks and high-valuation stocks. Falling yields are supportive.' },
  usdinr: { w: 1, s: -1, thr: 0.15, grp: 'Currency and bonds', why: 'Higher = weaker rupee: negative for FII flows and importers, positive for IT and pharma exporters.' },
  infy: { w: 0.5, s: 1, thr: 0.8, grp: 'Indian ADRs (US-listed)', why: 'Infosys in New York: hints how Infosys and IT open in India.' },
  wit: { w: 0.25, s: 1, thr: 0.8, grp: 'Indian ADRs (US-listed)', why: 'Wipro in New York: IT sentiment.' },
  hdb: { w: 0.5, s: 1, thr: 0.8, grp: 'Indian ADRs (US-listed)', why: 'HDFC Bank in New York: hints at the bank-heavy Nifty and Bank Nifty open.' },
  ibn: { w: 0.5, s: 1, thr: 0.8, grp: 'Indian ADRs (US-listed)', why: 'ICICI Bank in New York: Bank Nifty sentiment.' },
};
function worldItems() {
  const W = Source.world ? Source.world() : null, items = (W && W.items) || [];
  // Upstox's global list fills gaps (GIFT Nifty, Asia) when Yahoo/NSE can't be reached
  const G = Source.global ? Source.global() : [], have = new Set(items.map((x) => x.id)), extra = [];
  const map = [[/gift|sgx/i, 'gift', 'GIFT Nifty'], [/nikkei/i, 'nikkei', 'Nikkei 225 (Japan)'], [/hang seng/i, 'hsi', 'Hang Seng (Hong Kong)'], [/dow/i, 'dow', 'Dow Jones'], [/s&p|spx/i, 'spx', 'S&P 500'], [/nasdaq|us tech/i, 'nas', 'Nasdaq'], [/brent|bzusd/i, 'brent', 'Brent crude'], [/usd ?inr/i, 'usdinr', 'USD / INR']];
  G.forEach((g) => { const m = map.find(([re]) => re.test(g.name + ' ' + (g.sym || ''))); if (m && !have.has(m[1]) && ok(g.price) && ok(g.chg)) { have.add(m[1]); extra.push({ id: m[1], name: m[2], price: g.price, chg: g.chg, src: 'Upstox' }); } });
  const m = istMin(), preOpen = m >= -15 && m < 15; // NSE's indicative price only means something around 9:00–9:15
  return { items: [...items, ...extra].filter((x) => CUE[x.id] && ok(x.price) && (x.id !== 'indicative' || preOpen)), stale: W && W.stale, missing: (W && W.missing) || [] };
}
function worldRead(a0) {
  const { items } = worldItems(); if (!items.length) return null;
  const N = A.NIFTY || a0, beforeOpen = N && !N.sessionLive;
  const base = N ? (beforeOpen ? N.price : N.PC) : null; // Nifty's last close
  let sw = 0, sx = 0;
  const rows = items.map((x) => {
    const c = CUE[x.id];
    let chg = x.chg, note = '';
    if (x.id === 'gift' && ok(base)) { const gap = x.price - base; chg = (gap / base) * 100; note = `${sgn(gap)}${f0(gap)} pts vs Nifty's last close (${f0(base)})`; }
    const mag = ok(chg) ? Math.min(Math.abs(chg) / (2 * c.thr), 1) : 0, dirn = !ok(chg) || Math.abs(chg) < c.thr ? 0 : Math.sign(chg) * c.s;
    sw += c.w; sx += c.w * dirn * mag;
    return { ...x, chgUse: chg, note, imp: dirn, cue: c };
  });
  const score = sw ? Math.round((sx / sw) * 100) : 0;
  const lean = score >= 35 ? 'clearly positive' : score >= 15 ? 'mildly positive' : score <= -35 ? 'clearly negative' : score <= -15 ? 'mildly negative' : 'mixed / flat';
  const gift = rows.find((x) => x.id === 'gift');
  return { rows, score, lean, gift, base, beforeOpen };
}
// FII positions in index futures (NSE participant-wise OI, previous day)
function fiiPositions() {
  const P = Source.participant ? Source.participant() : null; if (!P || !P.latest || !P.latest.p || !P.latest.p.FII) return null;
  const f = P.latest.p.FII, pv = P.prev && P.prev.p && P.prev.p.FII, longPct = (f.futL / (f.futL + f.futS || 1)) * 100;
  const dL = pv ? f.futL - pv.futL : null, dS = pv ? f.futS - pv.futS : null;
  const read = longPct >= 65 ? 'heavily long: bullish positioning (but crowded)' : longPct >= 50 ? 'more long than short: mildly bullish' : longPct >= 35 ? 'more short than long: mildly bearish' : 'heavily short: bearish positioning, but also fuel for sharp short-covering rallies';
  const others = ['CLIENT', 'PRO', 'DII'].map((w) => { const x = P.latest.p[w]; return x ? { who: w === 'CLIENT' ? 'Retail (clients)' : w === 'PRO' ? 'Prop desks' : 'DII', longPct: (x.futL / (x.futL + x.futS || 1)) * 100 } : null; }).filter(Boolean);
  return { date: P.latest.asOf || P.latest.date, longPct, futL: f.futL, futS: f.futS, dL, dS, read, others, opt: ok(f.callL) ? { callL: f.callL, putL: f.putL, callS: f.callS, putS: f.putS } : null };
}

/* ---------- Glue: run everything for one instrument (called from analyze) ---------- */
function studyAll(a) {
  try { a.stx = structureOf(a); } catch (e) { a.stx = null; }
  try { oiRecord(a); a.oif = oiFlow(a); } catch (e) { a.oif = null; }
  try { a.lvw = levelWatch(a, a.stx, a.oif); } catch (e) { a.lvw = null; }
  try { a.gap = gapStudy(a); } catch (e) { a.gap = null; }
  try { a.open = a.sessionLive ? openingType(a) : null; } catch (e) { a.open = null; }
}
