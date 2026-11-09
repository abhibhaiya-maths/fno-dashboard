/* ===== Market Brain: one context score from everything outside the chart =====
   World cues (GIFT Nifty, US futures, Asia, crude, dollar, yields), the heavyweights pulling the index (from the market map),
   breadth, a week of news with older headlines counting less, FII positioning in index futures, option-writer flow and VIX.
   It never blocks a trade. It grades it: a signal with the context behind it is grade A, against it grade B (half size). */
const BRAIN_IDX = { NIFTY: 'NIFTY50', BANKNIFTY: 'BANKNIFTY', SENSEX: 'SENSEX' };
const NEWS_HALF_LIFE = 2 * 864e5; // a 2-day-old headline counts half as much as a fresh one
const IMP_W = { high: 1.5, medium: 1, low: 0.5 };

function newsItemsFor(a) {
  // the instrument's own headlines (incl. the Worker's 7-day memory) plus, for indices, its heavyweights' company news by index weight
  const own = [...(a.news || []), ...((a.D && a.D.newsMem) || [])].map((n) => ({ ...n, sw: 1, who: a.cf.label }));
  if (!a.cf.core || !Source.hvNews) return own;
  const M = Source.maps ? Source.maps()[BRAIN_IDX[a.key]] : null, HN = Source.hvNews() || {};
  const top = M && M.items ? M.items.slice().sort((x, y) => y.w - x.w).slice(0, 8) : [];
  const extra = [];
  top.forEach((x) => (HN[x.sym] || []).forEach((n) => extra.push({ ...n, sw: clamp(x.w / 10, 0.2, 2), who: x.name || x.sym })));
  return [...own, ...extra];
}
function newsPressure(a) {
  const now = Date.now(), seen = new Set();
  let sx = 0, sw = 0, best = null;
  for (const n of newsItemsFor(a)) {
    const ts = ok(n.ts) ? n.ts : null; if (!ts || now - ts > 7 * 864e5 || !ok(n.s)) continue;
    const key = String(n.t).toLowerCase().slice(0, 70); if (seen.has(key)) continue; seen.add(key);
    const w = (IMP_W[n.imp] || 1) * Math.pow(0.5, (now - ts) / NEWS_HALF_LIFE) * n.sw;
    sx += w * n.s; sw += w;
    const pull = w * n.s; if (!best || Math.abs(pull) > Math.abs(best.pull)) best = { ...n, pull, ageH: Math.round((now - ts) / 3600e3) };
  }
  return { n: seen.size, s: sw ? sx / sw : 0, conf: Math.min(1, sw / 3), best };
}

function brainOf(a) {
  const rows = [], add = (k, label, s, w, val, txt) => { if (ok(s) && w > 0) rows.push({ k, label, s: clamp(s, -1, 1), w, val, txt }); };
  const core = !!a.cf.core, m = a.curMin, live = a.sessionLive, idxPx = a.price;
  // 1. world cues: matter most before and just after the open, less as the day's own flows take over
  const W = typeof worldRead === 'function' ? worldRead(a) : null;
  if (W) {
    const w = (!live || m < 60 ? 2 : m < 180 ? 1 : 0.5) * (core ? 1 : 0.6), br = W.rows.find((x) => x.id === 'brent'), g = W.gift;
    add('world', 'World cues', W.score / 100, w, `${sgn(W.score)}${W.score}`, `${W.lean}${g && g.note && !live ? '. GIFT Nifty ' + g.note : ''}${br && ok(br.chg) ? `. Brent ${sgn(br.chg)}${f1(br.chg)}%` : ''}`);
  }
  // 2. who is moving the index: heavyweights' contribution in points, and breadth (all members, from the market map)
  let movers = null, up = null, dn = null, pts = null, topPts = null;
  const M = core && Source.maps ? Source.maps()[BRAIN_IDX[a.key]] : null;
  if (core && M && M.items && M.items.length && !M.fno) {
    const it = M.items.filter((x) => ok(x.chg)), byW = M.items.slice().sort((x, y) => y.w - x.w);
    up = it.filter((x) => x.chg > 0).length; dn = it.filter((x) => x.chg < 0).length;
    pts = it.reduce((s, x) => s + (x.pts || 0), 0); topPts = byW.slice(0, 10).reduce((s, x) => s + (x.pts || 0), 0);
    movers = it.filter((x) => ok(x.pts)).sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts)).slice(0, 6).map((x) => ({ n: x.name || x.sym, sym: x.sym, pts: x.pts, chg: x.chg, w: x.w }));
  } else if (core && a.hv && a.hv.length) {
    // no map yet: the top heavyweights from the snapshot
    const it = a.hv.filter((h) => ok(h.c) && ok(h.w));
    up = it.filter((h) => h.c > 0).length; dn = it.filter((h) => h.c < 0).length;
    topPts = it.reduce((s, h) => s + (h.w / 100) * (h.c / 100) * (a.PC || idxPx), 0); pts = null;
    movers = it.map((h) => ({ n: h.n, pts: (h.w / 100) * (h.c / 100) * (a.PC || idxPx), chg: h.c, w: h.w })).sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts)).slice(0, 6);
  }
  if (ok(topPts) && idxPx) {
    const lead = movers && movers.filter((x) => x.pts * topPts > 0).slice(0, 2).map((x) => x.n).join(' + ');
    add('pull', 'Heavyweights', topPts / (0.003 * idxPx), 1, `${sgn(topPts)}${f0(topPts)} pts`, `Top 10 by weight ${topPts >= 0 ? 'adding' : 'taking off'} ${f0(Math.abs(topPts))} pts${lead ? ` (${lead})` : ''}${ok(pts) ? `; whole index ${sgn(pts)}${f0(pts)} pts` : ''}`);
  }
  if (ok(up) && up + dn > 0) {
    const b = (up - dn) / (up + dn), idxUp = a.chg > 0.1, idxDn = a.chg < -0.1;
    const div = idxUp && b < -0.1 ? 'Index up on a few heavyweights while most stocks fall: a narrow, weaker rally' : idxDn && b > 0.1 ? 'Index down on a few heavyweights while most stocks rise: selling is narrow' : b >= 0.4 ? 'Broad buying across the index' : b <= -0.4 ? 'Broad selling across the index' : 'Mixed';
    add('breadth', 'Breadth', b * 1.4, 1, `${up} up · ${dn} down`, div);
  }
  // 3. news over the last 7 days, older headlines counting less (half-life 2 days), company news by index weight
  const N = newsPressure(a);
  if (N.n) add('news', 'News (7 days)', N.s * 1.6, 1.5 * N.conf, `${sgn(N.s)}${f2(N.s)}`, N.best ? `${N.best.who !== a.cf.label ? N.best.who + ': ' : ''}"${String(N.best.t).slice(0, 90)}" (${N.best.ageH < 24 ? N.best.ageH + ' h ago' : Math.round(N.best.ageH / 24) === 1 ? '1 day ago' : Math.round(N.best.ageH / 24) + ' days ago'})` : `${N.n} headlines`);
  // 4. FII positioning in index futures (previous day) and FII cash
  const F = typeof fiiPositions === 'function' ? fiiPositions() : null;
  if (F && core) {
    const flow = ok(F.dL) && ok(F.dS) && F.futL + F.futS ? clamp(((F.dL - F.dS) / (F.futL + F.futS)) * 15, -0.35, 0.35) : 0;
    add('fii', 'FII index futures', (F.longPct - 50) / 30 + flow, 1, `${f0(F.longPct)}% long${flow ? (flow > 0 ? ', adding longs' : ', adding shorts') : ''}`, F.read);
  }
  if (ok(a.fii)) add('fiicash', 'FII cash (prev. day)', a.fii / 3000, 0.5, `${sgn(a.fii)}₹${f0(a.fii)} cr`, a.fii >= 0 ? 'Foreign funds bought shares' : 'Foreign funds sold shares');
  // 5. option writers near the money (live 15-minute OI change), else PCR
  if (a.oif && a.oif.ready) add('oi', 'Option writers (15 min)', a.oif.bias, 1.5, a.oif.bias >= 0.3 ? 'Put writers' : a.oif.bias <= -0.3 ? 'Call writers' : 'Balanced', a.oif.read);
  else if (a.ch && ok(a.ch.pcr) && a.cf.opt) add('oi', 'PCR', (a.ch.pcr - 1) / 0.4, 0.75, f2(a.ch.pcr), a.ch.pcr > 1.2 ? 'Heavy put writing: support below' : a.ch.pcr < 0.8 ? 'Heavy call writing: pressure above' : 'Balanced');
  // 6. fear gauge
  if (a.vix && ok(a.vix.v) && ok(a.vix.prev) && a.vix.prev > 0 && !a.isMCX) {
    const c = ((a.vix.v - a.vix.prev) / a.vix.prev) * 100;
    add('vix', 'India VIX', -c / 8, 0.5, `${f2(a.vix.v)} (${sgn(c)}${f1(c)}%)`, c > 3 ? 'Fear rising: falls can speed up' : c < -3 ? 'Fear easing: supportive' : 'Steady');
  }
  const sw = rows.reduce((s, r) => s + r.w, 0), score = sw ? Math.round((rows.reduce((s, r) => s + r.w * r.s, 0) / sw) * 100) : null;
  const lean = !ok(score) ? 'no data yet' : score >= 40 ? 'Strongly bullish' : score >= 15 ? 'Bullish' : score <= -40 ? 'Strongly bearish' : score <= -15 ? 'Bearish' : 'Neutral';
  return { score, lean, rows: rows.sort((x, y) => Math.abs(y.s * y.w) - Math.abs(x.s * x.w)), movers, up, dn, pts, topPts, day: dayTypeOf(a), mapAt: M ? M.ts : null };
}

// What kind of day is it? Decides which setups deserve attention (★ pullbacks on trend days, quick trades on range days)
function dayTypeOf(a) {
  const cpr = a.tdi && ok(a.tdi.cpr) ? a.tdi.cpr : ok(a.tc) && ok(a.bc) && a.price ? (Math.abs(a.tc - a.bc) / a.price) * 100 : null;
  if (!ok(cpr)) return null;
  let kind = cpr < ENG.cprMax ? 'trend' : cpr > 0.35 ? 'range' : 'normal';
  const why = [`yesterday's CPR ${f2(cpr)}% wide`];
  if (a.open && a.open.final) {
    if (a.open.type === 'OD' || a.open.type === 'OTD') { kind = 'trend'; why.push(a.open.name); }
    else if (a.open.type === 'OA') { kind = 'range'; why.push('two-sided open'); }
  }
  if (a.gap && a.gap.today && Math.abs(a.gap.today.g || 0) >= 0.5) why.push(`${a.gap.today.side === 'up' ? 'gap up' : 'gap down'} ${f0(Math.abs(a.gap.today.pts))} pts`);
  if (a.vix && a.vix.v > 18) why.push(`VIX ${f1(a.vix.v)} high`);
  const st = a.tdi && a.tdi.state, arrow = kind === 'trend' && st ? (st > 0 ? ' ↑' : ' ↓') : '';
  const name = kind === 'trend' ? 'Trend day likely' + arrow : kind === 'range' ? 'Range day likely' : 'Normal day';
  const tip = kind === 'trend' ? (cpr < ENG.cprMax ? '★ pullback entries are the best trades today; avoid fading the move.' : 'Trend-following pullback entries work best; avoid fading the move. (★ needs a narrow CPR, so it stays off today.)') : kind === 'range' ? 'Moves reverse at the levels: book quickly, avoid chasing breakouts.' : 'Mix of trend and range: follow the grades.';
  return { kind, name, why: why.join(', '), tip, cpr };
}
