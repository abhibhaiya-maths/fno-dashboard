/* ===== Option writers' read + 3-scenario trade plan =====
   Reads the option chain the way a trader does: OI change together with premium change, strike by strike.
     Call OI ↑ + call premium ↓ = call WRITING (resistance)   Put OI ↑ + put premium ↓ = put WRITING (support)
     Call OI ↑ + call premium ↑ = call BUYING (bullish bets)  Put OI ↑ + put premium ↑ = put BUYING (bearish bets)
     OI ↓ = unwinding (that level is getting weaker)
   Writing on in-the-money strikes is the strongest sign; heavy at-the-money OI is flagged as unclear. Walls are the strikes
   with the most OI ADDED today. OI-change PCR = put OI added ÷ call OI added in ±8 strikes (below 0.7 bearish, above 1.3
   bullish). Squeeze: price above the biggest call-writing strike = those writers are trapped (and the mirror for puts).
   The exchange does not say who started a trade, so "writing" is an inference, and hedges add OI too.
   Then a plan for three openings (gap-up / inside the range / gap-down) with trigger, stop-loss and targets from walls,
   VWAP, the day's high/low and classic pivots. Advice only: it never changes a signal, a grade or a trade. */
const Writers = (() => {
  const okN = (x) => typeof x === 'number' && isFinite(x);
  const fx = (x, d = 2) => (okN(x) ? (+x).toFixed(d) : '–');
  const lakh = (x) => (okN(x) ? `${x < 0 ? '−' : '+'}${(Math.abs(x) / 1e5).toFixed(Math.abs(x) >= 1e6 ? 1 : 2)} L` : '–');
  const LAB = { W: 'writing', B: 'buying', U: 'unwinding', '': '' };

  /* rows: [{ K, ce: { oi, poi, ltp, cp, vol }, pe: {…} }] (whole chain); price: spot; step: strike gap */
  function read(rows, price, step, opt) {
    opt = opt || {};
    if (!rows || !rows.length || !okN(price)) return null;
    const R = rows.filter((r) => r.ce && r.pe).slice().sort((a, b) => a.K - b.K); if (R.length < 3) return null;
    step = step || Math.abs(R[1].K - R[0].K) || 1;
    let ai = 0; R.forEach((r, i) => { if (Math.abs(r.K - price) < Math.abs(R[ai].K - price)) ai = i; });
    const W = opt.all ? R : R.slice(Math.max(0, ai - 8), ai + 9);
    const side = (o) => { const doi = okN(o.poi) && o.poi > 0 ? o.oi - o.poi : okN(o.doi) ? o.doi : null, dp = okN(o.cp) && o.cp > 0 && okN(o.ltp) ? o.ltp - o.cp : okN(o.dp) ? o.dp : null; return { oi: o.oi || 0, doi, dp, vol: okN(o.vol) ? o.vol : null }; };
    const V = W.map((r) => ({ K: r.K, ce: side(r.ce), pe: side(r.pe), _r: r }));
    /* Trend-day fix: on a 2% up day every call premium rises and every put falls just because the price moved.
       So we take out the part explained by the move (delta × price change) and judge writing/buying on what is left.
       Price change: given, else read from the chain itself (call change − put change at the same strike ≈ move of the underlying). */
    let dS = okN(opt.dS) ? opt.dS : null;
    if (dS === null) { const ds = V.filter((r) => Math.abs(r.K - price) <= step * 2 && okN(r.ce.dp) && okN(r.pe.dp)).map((r) => r.ce.dp - r.pe.dp).sort((a, b) => a - b); if (ds.length) dS = ds[Math.floor(ds.length / 2)]; }
    const T = opt.T || 7 / 365;
    const dlt = (o, K, type) => { if (okN(o.de) && o.de !== 0) return o.de; const iv = (okN(o.iv) && o.iv > 0 ? (o.iv > 3 ? o.iv / 100 : o.iv) : 0.25); const d1 = (Math.log(price / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T)); const N = (x) => 0.5 * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x))); return type === 'CE' ? N(d1) : N(d1) - 1; };
    const adj = okN(dS) && Math.abs(dS) > price * 0.002;
    // the standard rule (your rulebook) still decides each label; the move-adjusted premium is a second check shown beside it
    if (adj) V.forEach((r) => { [['ce', 'CE'], ['pe', 'PE']].forEach(([s, t]) => { const x = r[s]; if (okN(x.dp)) x.dpAdj = x.dp - dlt(r._r[s], r.K, t) * dS; }); });
    V.forEach((r) => { delete r._r; });
    const hasPrem = V.some((r) => okN(r.ce.dp) || okN(r.pe.dp)), hasDoi = V.some((r) => okN(r.ce.doi) || okN(r.pe.doi));
    if (!hasDoi) return { noData: true };
    const maxOI = Math.max(1, ...V.map((r) => Math.max(r.ce.oi, r.pe.oi))), maxD = Math.max(1, ...V.map((r) => Math.max(Math.abs(r.ce.doi || 0), Math.abs(r.pe.doi || 0))));
    const maxVol = Math.max(0, ...V.map((r) => Math.max(r.ce.vol || 0, r.pe.vol || 0)));
    V.forEach((r) => {
      r.atm = Math.abs(r.K - price) <= step / 2;
      ['ce', 'pe'].forEach((s) => {
        const x = r[s]; x.itm = s === 'ce' ? r.K < price - step / 2 : r.K > price + step / 2;
        x.thin = (maxVol > 0 && okN(x.vol) && x.vol < maxVol * 0.02) || x.oi < maxOI * 0.01;
        x.lab = !okN(x.doi) || Math.abs(x.doi) < maxD * 0.05 || x.thin ? '' : x.doi < 0 ? 'U' : !okN(x.dp) ? '' : x.dp < 0 ? 'W' : 'B';
        x.big = okN(x.doi) && x.doi >= maxD * 0.3;
        // trend day: a label that only matches what the price move alone would do (calls up on an up day, puts down) is unsure
        if (adj && (x.lab === 'W' || x.lab === 'B') && okN(x.dpAdj)) { const la = x.dpAdj < 0 ? 'W' : 'B', moveDir = (s === 'ce' ? 1 : -1) * Math.sign(dS), aligned = Math.sign(x.dp) === moveDir; x.labAdj = la; x.amb = aligned && la !== x.lab && Math.abs(dS) >= price * 0.01; }
      });
    });
    const ceSum = V.reduce((s, r) => s + (r.ce.thin ? 0 : r.ce.doi || 0), 0), peSum = V.reduce((s, r) => s + (r.pe.thin ? 0 : r.pe.doi || 0), 0);
    const pcrChg = ceSum > 0 && peSum >= 0 ? peSum / ceSum : ceSum <= 0 && peSum > 0 ? 9.99 : null;
    const best = (s, f) => V.filter((r) => f(r[s])).reduce((a, b) => (!a || (b[s].doi || 0) > (a[s].doi || 0) ? b : a), null);
    // walls only on their own side: a resistance wall must be at/above the price, a support wall at/below it
    const Vabove = V.filter((r) => r.K >= price - step * 0.25), Vbelow = V.filter((r) => r.K <= price + step * 0.25);
    const bestIn = (L, s, f) => L.filter((r) => f(r[s])).reduce((a, b) => (!a || (b[s].doi || 0) > (a[s].doi || 0) ? b : a), null);
    const resW = bestIn(Vabove, 'ce', (x) => x.lab === 'W') || bestIn(Vabove, 'ce', (x) => (x.doi || 0) > 0), supW = bestIn(Vbelow, 'pe', (x) => x.lab === 'W') || bestIn(Vbelow, 'pe', (x) => (x.doi || 0) > 0);
    const rW = best('ce', (x) => x.lab === 'W'), sW = best('pe', (x) => x.lab === 'W');
    const notes = [], pts = [];
    const ambN = V.reduce((t, r) => t + (r.ce.amb ? 1 : 0) + (r.pe.amb ? 1 : 0), 0);
    if (ambN) notes.push(['w', `Trend-day caution: price moved ${dS > 0 ? '+' : ''}${fx(dS)}, so every ${dS > 0 ? 'call' : 'put'} premium rose and every ${dS > 0 ? 'put' : 'call'} premium fell just from the move. ${ambN} strike label${ambN > 1 ? 's' : ''} flip once that move is taken out (marked "unsure"). Trust the OI-only numbers more today: OI added, OI-change PCR and the walls.`]);
    const add = (p, t, k) => { pts.push(p); notes.push([k || (p > 0 ? 'up' : p < 0 ? 'dn' : ''), t]); };
    if (okN(pcrChg)) { if (pcrChg < 0.7) add(-1, `OI-change PCR ${fx(pcrChg)}: far more calls added than puts (below 0.7 = bearish).`); else if (pcrChg > 1.3) add(1, `OI-change PCR ${pcrChg > 9 ? 'very high' : fx(pcrChg)}: far more puts added than calls (above 1.3 = bullish).`); else add(0, `OI-change PCR ${fx(pcrChg)}: balanced (0.7–1.3).`, ''); }
    const itmCW = V.filter((r) => r.ce.itm && r.ce.lab === 'W' && r.ce.big && !r.atm), itmPW = V.filter((r) => r.pe.itm && r.pe.lab === 'W' && r.pe.big && !r.atm);
    if (itmCW.length) add(-1.25, `In-the-money CALL writing at ${itmCW.map((r) => r.K).join(', ')}: sellers are confident it stays below (strong bearish).`);
    if (itmPW.length) add(1.25, `In-the-money PUT writing at ${itmPW.map((r) => r.K).join(', ')}: sellers are confident it stays above (strong bullish).`);
    const sumLab = (s, l) => V.reduce((t, r) => t + (r[s].lab === l && !(l === 'B' && r[s].amb) ? r[s].doi : 0), 0); // a move-driven "buying" label is not counted as a bet
    const cw = sumLab('ce', 'W'), pw = sumLab('pe', 'W'), cb = sumLab('ce', 'B'), pb = sumLab('pe', 'B');
    if (hasPrem) {
      if (pb > cb * 1.5 && pb > maxD * 0.5) add(-0.5, `Put BUYING (OI and premium both up) ${lakh(pb)}: bearish bets.`);
      if (cb > pb * 1.5 && cb > maxD * 0.5) add(0.5, `Call BUYING (OI and premium both up) ${lakh(cb)}: bullish bets.`);
      if (cw > pw * 1.5 && cw > maxD) add(-0.5, `Call writing ${lakh(cw)} vs put writing ${lakh(pw)}: resistance is building.`);
      else if (pw > cw * 1.5 && pw > maxD) add(0.5, `Put writing ${lakh(pw)} vs call writing ${lakh(cw)}: support is building.`);
    } else notes.push(['w', 'Premium change is not available, so writing and buying cannot be told apart (deploy the new Worker).']);
    const atmRow = V.find((r) => r.atm);
    if (atmRow && (atmRow.ce.big || atmRow.pe.big)) notes.push(['w', `Heavy OI change at the at-the-money strike ${atmRow.K}: could be buying or writing (at-the-money OI is ambiguous): read it with care.`]);
    let squeeze = null;
    if (rW && price > rW.K + step * 0.25) squeeze = { side: 'up', K: rW.K, t: `Price is above the biggest call-writing strike ${rW.K}: those writers are trapped. If it holds above, short covering can push it up fast.` };
    if (sW && price < sW.K - step * 0.25) squeeze = { side: 'dn', K: sW.K, t: `Price is below the biggest put-writing strike ${sW.K}: those writers are trapped. If it holds below, it can fall fast.` };
    const tot = pts.reduce((s, x) => s + x, 0), verdict = tot <= -1 ? 'bearish' : tot >= 1 ? 'bullish' : 'neutral';
    const unw = V.filter((r) => r.ce.lab === 'U' && r.ce.big === false && r.ce.doi < -maxD * 0.3).map((r) => r.K);
    return { V, price, step, pcrChg, ceSum, peSum, resW: resW && resW.K, supW: supW && supW.K, resWw: rW && rW.K, supWw: sW && sW.K, verdict, score: tot, notes, squeeze, itmCW: itmCW.map((r) => r.K), itmPW: itmPW.map((r) => r.K), hasPrem, unw };
  }

  /* classic pivots from a session's high, low and close (for the NEXT session) */
  const pivots = (H, L, C) => { const P = (H + L + C) / 3; return { P, R1: 2 * P - L, S1: 2 * P - H, R2: P + (H - L), S2: P - (H - L) }; };

  /* x: { price, open, H, L, PC, vwap, atr, read, piv } → three scenarios */
  function plan(x) {
    const { price, H, L, vwap, read: W } = x, piv = x.piv || pivots(H, L, price), buf = Math.max((x.atr || price * 0.002) * 0.25, price * 0.0005);
    const above = (v) => okN(v) && v > price, below = (v) => okN(v) && v < price;
    // "walls" for targets: strikes where a lot of OI was added today (either side), nearest first
    const act = W && W.V ? W.V.map((r) => [r.K, Math.max(0, r.ce.doi || 0) + Math.max(0, r.pe.doi || 0)]) : [], mxA = Math.max(1, ...act.map((a) => a[1]));
    const busy = act.filter((a) => a[1] >= mxA * 0.1).map((a) => a[0]);
    // trigger: the nearer of the day's high/low and a real writing wall on that side (both have to give way)
    const upC = [H, W && W.resWw].filter((v) => above(v) || v === H), dnC = [L, W && W.supWw].filter((v) => below(v) || v === L);
    const u2 = upC.filter((v) => okN(v) && v >= price), d2 = dnC.filter((v) => okN(v) && v <= price);
    const upT = u2.length ? Math.min(...u2) : Math.max(H, price), dnT = d2.length ? Math.max(...d2) : Math.min(L, price);
    const uniq = (a) => [...new Set(a.map((v) => +(+v).toFixed(2)))];
    const upTg = uniq([...busy.filter((k) => k > upT + buf), ...[piv.R1, piv.R2].filter((v) => v > upT + buf)]).sort((a, b) => a - b).slice(0, 3);
    const dnTg = uniq([...busy.filter((k) => k < dnT - buf), ...[piv.S1, piv.S2].filter((v) => v < dnT - buf)]).sort((a, b) => b - a).slice(0, 3);
    // stop: the other side of VWAP when VWAP is on that side; otherwise the nearest wall / pivot on the other side
    const upSL = (okN(vwap) && vwap < upT - buf * 2 ? vwap : Math.max(...[W && W.supW, piv.P].filter((v) => okN(v) && v < upT - buf * 2), L)) - buf;
    const dnSL = (okN(vwap) && vwap > dnT + buf * 2 ? vwap : Math.min(...[W && W.resW, piv.P].filter((v) => okN(v) && v > dnT + buf * 2), H)) + buf;
    const rr = (e, s, t) => (okN(t) && Math.abs(e - s) > 0 ? Math.abs(t - e) / Math.abs(e - s) : null);
    const S = [
      { id: 'up', name: 'Gap-up, or a break above the day high / call wall', trig: upT, sl: upSL, tg: upTg, rr: rr(upT, upSL, upTg[0]), dir: 'CE', text: `Buy side only if price breaks above ${fx(upT)} and HOLDS there for 5–10 minutes after the open.` },
      { id: 'in', name: 'Opening inside the range', text: `Between ${fx(L)} and ${fx(H)}: usually wait. Trade only when one side breaks and holds (then use the matching plan).` },
      { id: 'dn', name: 'Gap-down, or a break below the day low / put wall', trig: dnT, sl: dnSL, tg: dnTg, rr: rr(dnT, dnSL, dnTg[0]), dir: 'PE', text: `Sell side only if price breaks below ${fx(dnT)} and HOLDS there for 5–10 minutes after the open.` },
    ];
    const pref = W && W.verdict === 'bearish' ? 'dn' : W && W.verdict === 'bullish' ? 'up' : null;
    return { S, pref, piv, buf };
  }

  /* price-action facts and caution flags, for a report card */
  function facts(x) {
    const out = [], o = x.open, pc = x.PC;
    const gap = okN(o) && okN(pc) && pc > 0 ? o / pc - 1 : null, pos = x.H > x.L ? (x.price - x.L) / (x.H - x.L) : null;
    if (okN(gap)) out.push(['', `Gap ${gap >= 0 ? '+' : ''}${fx(gap * 100)}% at the open (${fx(o)} vs previous close ${fx(pc)}).`]);
    if (okN(pos)) out.push([pos <= 0.25 ? 'dn' : pos >= 0.75 ? 'up' : '', `Position in the day's range: ${fx(pos)} (${pos <= 0.25 ? 'near the low: weak' : pos >= 0.75 ? 'near the high: strong' : 'middle'}).`]);
    if (okN(x.vwap)) out.push([x.price < x.vwap ? 'dn' : 'up', `${x.price < x.vwap ? 'Below' : 'Above'} VWAP ${fx(x.vwap)}: ${x.price < x.vwap ? 'sellers' : 'buyers'} in control.`]);
    if (okN(gap) && gap >= 0.002 && x.price < o && okN(x.vwap) && x.price < x.vwap) out.push(['dn', '"Sell the news": gapped up, now trading below the open and VWAP.']);
    if (okN(gap) && gap <= -0.002 && x.price > o && okN(x.vwap) && x.price > x.vwap) out.push(['up', '"Buy the dip": gapped down, now trading above the open and VWAP.']);
    if (okN(x.volX)) out.push([x.volX >= 1.5 ? 'up' : x.volX < 0.7 ? 'w' : '', `Volume ${fx(x.volX, 1)}× its 20-day average${x.volPace ? ' (for this time of day)' : ''}: ${x.volX >= 1.5 ? 'confirms the move' : x.volX < 0.7 ? 'weak conviction' : 'normal'}.`]);
    if (okN(x.niftyChg) && okN(x.chg) && !x.isIdx) { if (x.niftyChg <= -0.7 && x.chg > 0) out.push(['up', `Up ${fx(x.chg)}% while Nifty is down ${fx(-x.niftyChg)}%: real relative strength.`]); else if (x.niftyChg >= 0.7 && x.chg < 0) out.push(['dn', `Down ${fx(-x.chg)}% while Nifty is up ${fx(x.niftyChg)}%: relative weakness.`]); }
    // futures
    const f = x.fut;
    if (f && f.day && okN(f.doi)) { const strong = Math.abs(f.doi) >= 10 && Math.abs(x.chg || 0) >= 2; out.push([/Long|covering/i.test(f.day) ? 'up' : /Short build|unwind/i.test(f.day) ? 'dn' : '', `Futures: ${f.day}, OI ${f.doi >= 0 ? '+' : ''}${fx(f.doi, 1)}%${strong ? ' with a 2%+ price move: a STRONG signal' : ''}.`]); }
    const warn = [];
    if (f && f.expiry) { const d = (Date.parse(f.expiry) - Date.now()) / 864e5; if (d >= -1 && d <= 5) warn.push('Expiry week: rollovers to next month distort OI changes.'); }
    warn.push('OI can be hedges (for example a fund selling calls against shares it owns), not fresh bets.');
    if (okN(x.chg) && x.chg <= (x.isIdx ? -1.5 : -4)) warn.push(`Already down ${fx(-x.chg)}% today: rebound risk. Fresh shorts only after a break of today's low.`);
    if (okN(x.chg) && x.chg >= (x.isIdx ? 1.5 : 4)) warn.push(`Already up ${fx(x.chg)}% today: pullback risk. Fresh longs only after a break of today's high.`);
    if (okN(x.fiiLong) && x.fiiLong < 0.35 && okN(x.niftyChg) && x.niftyChg < -0.3) warn.push(`FIIs are net short in index futures (${Math.round(x.fiiLong * 100)}% long) and Nifty is falling: favour bearish setups, take only the strongest bullish ones.`);
    if (okN(x.fiiLong) && x.fiiLong > 0.6 && okN(x.niftyChg) && x.niftyChg > 0.3) warn.push(`FIIs are net long in index futures (${Math.round(x.fiiLong * 100)}% long) and Nifty is rising: favour bullish setups.`);
    if (!x.isIdx) warn.push('Pending open offer or buyback? Check the company\'s filings before shorting: a stock well below an offer price tends to be supported.');
    return { out, warn, gap, pos };
  }

  /* ---------- HTML pieces ---------- */
  function readHTML(W, opt) {
    opt = opt || {};
    if (!W) return '';
    if (W.noData) return '<div class="mut">No OI change in this chain yet.</div>';
    const cls = (l) => (l === 'W' ? 'w-w' : l === 'B' ? 'w-b' : l === 'U' ? 'w-u' : '');
    const cell = (x, s) => `<td class="${(x.doi || 0) >= 0 ? '' : 'dn'}">${lakh(x.doi)}</td><td class="${(x.dp || 0) > 0 ? 'up' : (x.dp || 0) < 0 ? 'dn' : ''}">${okN(x.dp) ? (x.dp >= 0 ? '+' : '') + fx(x.dp) : '–'}</td><td class="l"><span class="wl ${cls(x.lab)}">${x.thin ? '<span class="mut">thin</span>' : `${x.lab ? (s === 'ce' ? 'Call ' : 'Put ') + LAB[x.lab] : ''}${x.amb ? ` <span class="mut" title="After removing the price move (delta × move) this looks like ${LAB[x.labAdj]}">(unsure: move-driven)</span>` : ''}${x.itm && x.lab === 'W' && x.big ? ' <b>(ITM)</b>' : ''}`}</span></td>`;
    const head = `<div class="w-sum ${W.verdict === 'bearish' ? 'dn' : W.verdict === 'bullish' ? 'up' : ''}"><b>Writers' read: ${W.verdict.toUpperCase()}</b>
      <span>Call OI added ${lakh(W.ceSum)} · Put OI added ${lakh(W.peSum)} · OI-change PCR <b>${okN(W.pcrChg) ? (W.pcrChg > 9 ? 'very high' : fx(W.pcrChg)) : '–'}</b></span>
      <span>Resistance wall (most call OI added): <b>${W.resW || '–'}</b> · Support wall (most put OI added): <b>${W.supW || '–'}</b></span></div>
      ${W.squeeze ? `<div class="alert ${W.squeeze.side === 'up' ? 'i' : 'd'}" style="margin:6px 0">⚡ ${W.squeeze.t}</div>` : ''}
      <ul class="w-notes">${W.notes.map(([k, t]) => `<li class="${k}">${t}</li>`).join('')}</ul>`;
    if (opt.short) return head;
    return head + `<div class="tblw"><table class="w-tbl"><thead><tr><th colspan="3">CALLS: OI change · premium change · read</th><th>Strike</th><th colspan="3">PUTS: OI change · premium change · read</th></tr></thead><tbody>${W.V.map((r) => `<tr class="${r.atm ? 'atm' : ''}">${cell(r.ce, 'ce')}<td><b>${r.K}</b>${r.atm ? ' <small class="mut">ATM</small>' : ''}</td>${cell(r.pe, 'pe')}</tr>`).join('')}</tbody></table></div>
      <div class="legend">Writing = OI up and premium down; buying = OI up and premium up; unwinding = OI down. ITM writing is the strongest sign. "Thin" strikes (little volume or OI) are ignored. The exchange does not say who started each trade, so this is an inference; hedges add OI too, and walls can break on news.</div>`;
  }
  function planHTML(P, fmt) {
    if (!P) return '';
    const f = fmt || ((v) => fx(v));
    return `<div class="w-plan">${P.S.map((s) => `<div class="w-sc s-${s.id} ${P.pref === s.id ? 'pref' : ''}"><div class="w-sch"><b>${s.name}</b>${P.pref === s.id ? '<span class="pill ' + (s.id === 'up' ? 'b' : 's') + '">favoured by the writers\' read</span>' : ''}</div><p>${s.text}</p>
      ${s.trig ? `<div class="w-kv"><span>Trigger <b>${f(s.trig)}</b></span><span>Stop-loss <b>${f(s.sl)}</b></span><span>Targets <b>${s.tg.length ? s.tg.map(f).join(' → ') : '–'}</b></span><span>Reward : risk <b>${okN(s.rr) ? fx(s.rr, 1) + ' : 1' : '–'}</b></span></div>${okN(s.rr) && s.rr < 1 ? '<div class="w-rr">Reward is smaller than the risk here: skip it, or wait for a pullback towards the trigger for a tighter stop.</div>' : ''}` : ''}</div>`).join('')}
      <div class="legend">Levels from the day's high/low, VWAP, the walls above and classic pivots for the next session (P ${f(P.piv.P)} · R1 ${f(P.piv.R1)} · R2 ${f(P.piv.R2)} · S1 ${f(P.piv.S1)} · S2 ${f(P.piv.S2)}). Wait 5–10 minutes after the open for the trigger to hold. A plan, not a promise: size it with your risk rules.</div></div>`;
  }

  /* ---------- the test case from the analysis guide (Reliance) ---------- */
  function selfTest() {
    const T = [[1320, 45500, -16.3, 119000, 11.3], [1330, 80000, -15.15, 15000, 12.1], [1340, 2071000, -13.3, 485500, 13.55], [1350, 2708500, -12.2, 1159500, 14.75], [1360, 690500, -11, 422500, 16.35], [1370, 353000, -10.5, 343000, 16.25], [1380, 207000, -9.35, 401000, 17.7]];
    const rows = T.map(([K, cd, cdp, pd, pdp]) => ({ K, ce: { oi: 5e6 + cd, poi: 5e6, ltp: 50 + cdp, cp: 50 }, pe: { oi: 5e6 + pd, poi: 5e6, ltp: 50 + pdp, cp: 50 } }));
    const W = read(rows, 1351, 10, { all: true }), x = { price: 1351, open: 1381, H: 1390, L: 1346.9, PC: 1377.5, vwap: 1360.64, atr: 4, read: W, chg: (1351 / 1377.5 - 1) * 100 };
    const P = plan(x), F = facts(x);
    const exp = { verdict: 'bearish', pcr: 0.48, trig: 1346.9 }, got = { verdict: W.verdict, pcr: +W.pcrChg.toFixed(2), trig: P.S[2].trig };
    const pass = got.verdict === exp.verdict && Math.abs(got.pcr - exp.pcr) <= 0.01 && got.trig === exp.trig && P.S[2].tg[0] === 1340 && P.S[2].sl > 1360 && W.itmCW.includes(1340);
    return { W, P, F, pass, got, exp };
  }
  function testHTML() {
    const t = selfTest();
    return `<div class="alert ${t.pass ? 'i' : 'd'}"><b>${t.pass ? '✅ PASS' : '❌ MISMATCH'}</b>: verdict ${t.got.verdict} (expected bearish), OI-change PCR ${t.got.pcr} (expected about 0.48), sell trigger ${t.got.trig} (expected below 1346.90), first target ${t.P.S[2].tg[0]} (expected 1340), stop-loss ${fx(t.P.S[2].sl)} (expected above 1360), ITM call writing at ${t.W.itmCW.join(', ') || '–'} (expected 1340).</div>
      ${readHTML(t.W)}<ul class="w-notes">${t.F.out.map(([k, s]) => `<li class="${k}">${s}</li>`).join('')}</ul>${planHTML(t.P)}`;
  }
  /* from the dashboard's analysed instrument (a = the engine's read of one instrument) */
  function forA(a) {
    if (!a || !okN(a.price)) return null;
    const ch = a.ch, W = ch && ch.rows && ch.rows.length && a.cf && a.cf.opt ? read(ch.rows, a.price, ch.step, { dS: okN(a.PC) ? a.price - a.PC : null, T: ch.T }) : null;
    const today = ((a.D && a.D.candles) || []).filter((c) => c.d === 2), open = today.length ? today[0].o : null;
    let volX = null, volPace = false;
    if (a.hasVol && !a.isIdx && today.length) {
      const v = today.reduce((t, c) => t + (c.v || 0), 0), rows = (a.D.daily && a.D.daily.rows) || [], av = rows.slice(-20).map((r) => r[5]).filter((x) => x > 0);
      if (av.length >= 10 && v > 0) { const avg = av.reduce((t, x) => t + x, 0) / av.length, m = a.curMin || 0, live = a.sessionLive && m < 374, share = live ? Math.min(1, Math.pow(Math.max(1, m + 1) / 375, 0.8)) : 1; volX = v / (avg * share); volPace = live; }
    }
    const N = typeof A !== 'undefined' && A.NIFTY ? A.NIFTY.chg : null, F = typeof fiiPositions === 'function' ? fiiPositions() : null;
    const x = { price: a.price, open, H: a.DH, L: a.DL, PC: a.PC, vwap: a.vw, atr: a.atr, chg: a.chg, isIdx: a.isIdx, fut: a.fut, volX, volPace, niftyChg: a.key === 'NIFTY' ? null : N, fiiLong: F && F.futL + F.futS > 0 ? F.futL / (F.futL + F.futS) : null, read: W };
    return { x, W, F: facts(x), P: plan(x) };
  }
  return { read, plan, facts, pivots, readHTML, planHTML, selfTest, testHTML, forA };
})();
if (typeof module !== 'undefined') module.exports = Writers;
