/* ===== Overview: the whole market on one page, plus Strength & Money Flow, Sector Rotation, Regime & Calm Zone,
   Screeners (IV, futures basis, RSI, stocks to avoid) and a usage meter.
   Every number is labelled: ACTUAL (reported by NSE / the exchange), LIVE (broker price now), ESTIMATE (worked out from
   prices and volumes, e.g. money flow), MODEL (our own rule-based score), N/A (not available). Nothing is made up: a
   missing value shows "–". It reads the same data the dashboard already loads plus NSE's daily files (via the Worker),
   so it adds almost no load on Upstox. It never changes a signal, a grade or a trade. */
const EodCache = (() => {
  // one shared copy of /api/eod (all F&O prices) for the Overview, ORB scanner and Brief: fewer Upstox calls
  let last = null, at = 0, busy = null;
  async function get(maxAge) {
    if (last && Date.now() - at < (maxAge || 60e3)) return last;
    if (busy) return busy;
    busy = Source.raw('/api/eod').then((r) => { last = r; at = Date.now(); return r; }).finally(() => { busy = null; });
    return busy;
  }
  return { get, peek: () => last, age: () => (at ? Date.now() - at : null) };
})();

const Intel = (() => {
  const live = () => typeof Source !== 'undefined' && Source.mode === 'live';
  const $n = (id) => document.getElementById(id);
  let tab = 'ov', D = null, C = null, busy = '', err = '', secSel = null, sortS = 'iv', timer = null, usage = null, hTs = 0;
  const W0 = { rs: 25, mom: 20, vol: 15, br: 15, oi: 10, inst: 10, news: 5 };
  const weights = () => ({ ...W0, ...Store.pref('intel_w', {}) });

  /* ---------- helpers ---------- */
  const mean = (a) => { const b = a.filter(ok); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : null; };
  const med = (a) => { const b = a.filter(ok).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
  const sd = (a) => { const m = mean(a); if (!ok(m)) return null; const b = a.filter(ok); return b.length > 1 ? Math.sqrt(b.reduce((s, x) => s + (x - m) ** 2, 0) / (b.length - 1)) : null; };
  const cap = (x, m) => Math.max(-m, Math.min(m, x));
  const pc = (x, d = 1) => (ok(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : '–');
  const cl = (x) => (ok(x) && x !== 0 ? (x > 0 ? 'up' : 'dn') : '');
  const crore = (x) => (ok(x) ? `₹${Math.abs(Math.round(x)).toLocaleString('en-IN')} cr` : '–');
  const T = (k) => `<span class="it-tag ${k}">${{ act: 'ACTUAL', live: 'LIVE', est: 'ESTIMATE', model: 'MODEL', na: 'N/A', eod: 'EOD FILE' }[k]}</span>`;
  const tsDate = (ts) => { const t = +ts || Date.parse(ts); return t ? new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10) : ''; };
  const hhmm = (t) => (t ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
  const volShare = (m) => Math.min(1, Math.pow(Math.max(1, m + 1) / 375, 0.8));
  function rsi(cl2, n = 14) { if (cl2.length < n + 1) return null; let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = cl2[i] - cl2[i - 1]; if (d > 0) g += d; else l -= d; } g /= n; l /= n; for (let i = n + 1; i < cl2.length; i++) { const d = cl2[i] - cl2[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  function ivSolve(price, S, K, Ty, type) {
    if (typeof bs !== 'function' || !(price > 0) || !(S > 0) || !(K > 0) || !(Ty > 0)) return null;
    let lo = 0.01, hi = 3; if (bs(S, K, Ty, hi, type).price < price) return null;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (bs(S, K, Ty, m, type).price > price) hi = m; else lo = m; }
    const v = (lo + hi) / 2; return v > 0.015 && v < 2.9 ? v : null;
  }

  /* ---------- data ---------- */
  async function load(force) {
    if (busy) return; err = ''; busy = 'Reading prices and NSE files…'; render();
    try {
      if (!live()) D = demoData();
      else {
        const miss = [], safe = async (p, w) => { try { return await p; } catch (e) { miss.push(w + ': ' + e.message); return null; } };
        const [E, H] = await Promise.all([safe(EodCache.get(force ? 5e3 : 60e3), 'Live prices'), !D || !D.H || force === 'hist' || Date.now() - hTs > 3 * 3600e3 ? safe(Brief.history(22), 'NSE files') : Promise.resolve(D.H)]);
        if (H && H !== (D && D.H)) hTs = Date.now();
        busy = 'Reading FII/DII, world, results, ban list…'; render();
        const n = Source.get('NIFTY') || {};
        const [ban, res, fii, part, world, cal] = await Promise.all([D && D.ban && !force ? D.ban : safe(Brief.banList(), 'F&O ban list'), safe(Source.raw('/api/rescal'), 'Results'), Promise.resolve(Source.fiiAuto ? Source.fiiAuto() : null), Promise.resolve(Source.participant ? Source.participant() : null), Promise.resolve(Source.world ? Source.world() : null), Promise.resolve(Source.calendar ? Source.calendar() : null)]);
        D = { live: true, E, H, ban, res, fii, part, world, cal, nd: n.daily && n.daily.rows, vd: n.vixDaily, vix: n.vix, miss, ts: Date.now() };
      }
      C = compute(D);
      if (live()) Source.raw('/api/usage').then((u) => { usage = u; render(); }).catch(() => { usage = { none: true }; });
    } catch (e) { err = e.message; }
    busy = ''; render();
    try { if (typeof Brief !== 'undefined' && !Brief.data) Brief.build().then(() => render()); } catch (e) { /* later */ }
  }

  /* ---------- the maths (pure) ---------- */
  function compute(D) {
    const Q = (D.E && D.E.q) || {}, H = D.H || { sec: {} }, sd8 = Object.keys(H.sec || {}).sort(), secMap = H.sectors || {};
    const NQ = Q.NIFTY, qDate = NQ ? tsDate(NQ.ts) || (typeof istYmd === 'function' ? istYmd() : '') : '';
    const past = sd8.filter((d) => Brief.d8to10(d) < qDate); // history before today's prices
    const nf = NQ && NQ.pc ? NQ.c / NQ.pc - 1 : null;
    const m = typeof istMin === 'function' ? istMin() : 375, openNow = live() && m >= 0 && m < 375 && qDate === (typeof istYmd === 'function' ? istYmd() : qDate);
    const nd = (D.nd || []).filter((r) => r[0] < qDate), nCl = nd.map((r) => r[4]);
    if (NQ) nCl.push(NQ.c);
    const nRet = (k) => (nCl.length > k ? nCl[nCl.length - 1] / nCl[nCl.length - 1 - k] - 1 : null);
    const n5 = nRet(5), n20 = nRet(20);
    const S = [];
    for (const sym in Q) {
      const q = Q[sym]; if (q.idx || !(q.c > 0) || !(q.pc > 0)) continue;
      const rows = past.map((d) => H.sec[d] && H.sec[d].s[sym]).filter(Boolean); // [c, pc, o, h, l, v, dp]
      const cls = [...rows.map((r) => r[0]), q.c], n = cls.length;
      const r1 = q.c / q.pc - 1, r5 = n > 5 ? q.c / cls[n - 6] - 1 : null, r20 = n > 20 ? q.c / cls[n - 21] - 1 : n > 15 ? q.c / cls[0] - 1 : null;
      const v20 = mean(rows.slice(-20).map((r) => r[5])), volX = v20 && q.v ? q.v / (v20 * (openNow ? volShare(m) : 1)) : null;
      const lr = []; for (let i = 1; i < cls.length; i++) lr.push(Math.log(cls[i] / cls[i - 1]));
      const rv = lr.length >= 10 ? sd(lr.slice(-20)) * Math.sqrt(252) : null, atrP = mean(rows.slice(-14).map((r) => (r[3] - r[4]) / r[0]));
      const tv = q.c * (q.v || 0), tv20 = mean(rows.slice(-20).map((r) => r[0] * r[5]));
      const sma20 = cls.length >= 20 ? mean(cls.slice(-20)) : null;
      S.push({ sym, ind: secMap[sym] || '', c: q.c, r1, rel: ok(nf) ? r1 - nf : null, r5, r20, rs5: ok(r5) && ok(n5) ? r5 - n5 : null, rs20: ok(r20) && ok(n20) ? r20 - n20 : null, volX, rv, atrP, tv, tv20,
        flow: tv * cap(r1 / 0.01, 1) / 1e7, dp: rows.length ? rows[rows.length - 1][6] : null, dp20: mean(rows.slice(-20).map((r) => r[6])), rsi: rsi(cls), above20: ok(sma20) ? q.c > sma20 : null, days: rows.length });
    }
    // sectors
    const by = {}; S.forEach((x) => (by[x.ind] || (by[x.ind] = [])).push(x));
    const SEC = Object.entries(by).filter(([k, L]) => k && L.length >= 2).map(([k, L]) => {
      const r1 = mean(L.map((x) => x.r1)), r5 = mean(L.map((x) => x.r5)), r20 = mean(L.map((x) => x.r20));
      const rs5 = ok(r5) && ok(n5) ? r5 - n5 : null, rs20 = ok(r20) && ok(n20) ? r20 - n20 : null;
      const quad = !ok(rs20) || !ok(rs5) ? '' : rs20 >= 0 ? (rs5 >= 0 ? 'Leading' : 'Weakening') : rs5 >= 0 ? 'Improving' : 'Lagging';
      const bs = typeof Brief !== 'undefined' && Brief.data ? Brief.data.R.sectors.find((s) => s.ind === k) : null;
      return { ind: k, name: Brief.secName(k), n: L.length, r1, rel: ok(r1) && ok(nf) ? r1 - nf : null, r5, r20, rs5, rs20, quad, up: L.filter((x) => x.r1 > 0).length, beat: ok(r1) ? L.filter((x) => x.r1 > r1).length : 0,
        volX: med(L.map((x) => x.volX)), flow: L.reduce((s, x) => s + (x.flow || 0), 0), dpX: mean(L.map((x) => (ok(x.dp) && x.dp20 ? x.dp / x.dp20 : null))), oiT: bs ? bs.oiT : null, news: bs ? bs.news : null, L };
    });
    // rotation score: each part ranked across sectors (0–1), then weighted; weights are a starting guess, editable
    const Wt = weights(), parts = { rs: (s) => (ok(s.rs20) ? s.rs20 : 0) + (ok(s.rel) ? s.rel * 3 : 0), mom: (s) => s.r5, vol: (s) => s.volX, br: (s) => s.up / s.n, oi: (s) => s.oiT, inst: (s) => s.dpX, news: (s) => s.news };
    const rk = {}; for (const p in parts) { const vals = SEC.map((s) => parts[p](s)).filter(ok).sort((a, b) => a - b); rk[p] = (v) => (ok(v) && vals.length > 1 ? vals.indexOf(v) / (vals.length - 1) : null); }
    SEC.forEach((s) => { let t = 0, w = 0; for (const p in parts) { const r = rk[p](parts[p](s)); if (ok(r)) { t += r * Wt[p]; w += Wt[p]; } } s.score = w ? Math.round((t / w) * 100) : null; s.wUsed = w; });
    // leadership change: today's rank vs 5-day rank
    const rT = SEC.slice().sort((a, b) => b.r1 - a.r1), r5s = SEC.slice().sort((a, b) => (b.r5 || 0) - (a.r5 || 0));
    SEC.forEach((s) => { s.rankT = rT.indexOf(s) + 1; s.rank5 = r5s.indexOf(s) + 1; });
    SEC.sort((a, b) => (b.score || 0) - (a.score || 0));
    // market mood (risk-on / risk-off): breadth, sector participation, money flow, Nifty trend, VIX, world
    const adv = S.filter((x) => x.r1 > 0).length, dec = S.filter((x) => x.r1 < 0).length, secUp = SEC.filter((s) => s.r1 > 0).length, flowN = S.reduce((s, x) => s + (x.flow || 0), 0), flowAbs = S.reduce((s, x) => s + Math.abs(x.flow || 0), 0);
    const sma20N = nCl.length >= 20 ? mean(nCl.slice(-20)) : null, vNow = D.vix && ok(D.vix.v) ? D.vix : null;
    const mood = [];
    if (adv + dec) mood.push(['Breadth', cap(((adv - dec) / (adv + dec)) * 1.4, 1), `${adv} up, ${dec} down`]);
    if (SEC.length) mood.push(['Sectors', cap(((secUp / SEC.length) - 0.5) * 2.4, 1), `${secUp} of ${SEC.length} sectors up`]);
    if (flowAbs) mood.push(['Money flow', cap((flowN / flowAbs) * 2, 1), `net ${flowN >= 0 ? 'in' : 'out'} ${crore(Math.abs(flowN))} (estimate)`]);
    if (ok(sma20N) && NQ) mood.push(['Nifty trend', NQ.c > sma20N ? 0.6 : -0.6, `Nifty ${NQ.c > sma20N ? 'above' : 'below'} its 20-day average`]);
    if (vNow && vNow.prev) { const vc = vNow.v / vNow.prev - 1; mood.push(['India VIX', cap(-vc / 0.05, 1), `VIX ${f2(vNow.v)} (${pc(vc)})`]); }
    const Wd = {}; ((D.world && D.world.items) || []).forEach((x) => { Wd[x.id] = x; });
    const us = Wd.nasF || Wd.dowF; if (us && ok(us.chg)) mood.push(['US futures', cap(us.chg / 0.8, 1), `Nasdaq fut ${ok(Wd.nasF && Wd.nasF.chg) ? pc(Wd.nasF.chg / 100) : '–'}, Dow fut ${ok(Wd.dowF && Wd.dowF.chg) ? pc(Wd.dowF.chg / 100) : '–'}`]);
    const moodV = mood.length ? Math.round((mood.reduce((s, x) => s + x[1], 0) / mood.length) * 100) : null;
    const moodL = !ok(moodV) ? 'Unknown' : moodV >= 40 ? 'Risk-on' : moodV >= 15 ? 'Mildly risk-on' : moodV <= -40 ? 'Risk-off' : moodV <= -15 ? 'Mildly risk-off' : 'Mixed';
    const reg = regime(D, nd, NQ, moodL);
    // IV and futures basis from the NSE F&O file (end of day)
    const fo = H.fo, foDate = fo && fo.date, scr = [];
    if (fo) for (const sym in fo.walls) {
      const w = fo.walls[sym], f = fo.fut[sym]; if (!f || f.idx) continue;
      const days = w.x && foDate ? (Date.parse(w.x) - Date.parse(foDate)) / 864e5 : null, x = S.find((y) => y.sym === sym);
      let iv = null; if (w.atm && days > 0) { const Ty = days / 365, a = ivSolve(w.atm.c, w.atm.u, w.atm.K, Ty, 'CE'), b = ivSolve(w.atm.p, w.atm.u, w.atm.K, Ty, 'PE'); iv = ok(a) && ok(b) ? (a + b) / 2 : a || b; }
      const nr = f.near, fdays = nr && nr.x && foDate ? Math.max(1, (Date.parse(nr.x) - Date.parse(foDate)) / 864e5) : null, basis = nr && nr.u > 0 && nr.c > 0 ? nr.c / nr.u - 1 : null;
      scr.push({ sym, iv, rv: x && x.rv, ivr: ok(iv) && x && x.rv ? iv / x.rv : null, basis, basisA: ok(basis) && fdays ? (basis * 365) / fdays : null, dte: days, pcr: w.pcr, rsi: x && x.rsi, r5: x && x.r5, c: x ? x.c : null });
    }
    // stocks to avoid
    const res = {}; ((D.res && D.res.items) || []).forEach((r) => { if (r.sym && r.date >= qDate) res[r.sym] = res[r.sym] && res[r.sym] < r.date ? res[r.sym] : r.date; });
    const nextD = qDate ? Brief.nextWeekday(qDate) : '', tvs = S.map((x) => x.tv20).filter(ok).sort((a, b) => a - b), tvLow = tvs.length ? tvs[Math.floor(tvs.length * 0.08)] : null;
    const banSet = new Set((D.ban && D.ban.syms) || []), avoid = [];
    S.forEach((x) => { const why = [];
      if (banSet.has(x.sym)) why.push(['In the F&O ban: no new positions allowed', 'r']);
      if (res[x.sym] && res[x.sym] <= nextD) why.push([`Results ${res[x.sym] === qDate ? 'today' : 'on ' + res[x.sym]}: a gap either way`, 'w']);
      if (ok(tvLow) && ok(x.tv20) && x.tv20 <= tvLow) why.push(['Thinly traded: wider spreads, costly exits', 'w']);
      if (ok(x.r5) && Math.abs(x.r5) >= 0.15) why.push([`Already ${x.r5 > 0 ? 'up' : 'down'} ${pc(Math.abs(x.r5), 0).slice(1)} in 5 days: chasing risk`, 'w']);
      if (why.length) avoid.push({ ...x, why }); });
    avoid.sort((a, b) => b.why.length - a.why.length || (banSet.has(b.sym) ? 1 : 0) - (banSet.has(a.sym) ? 1 : 0));
    return { S, SEC, nf, n5, n20, NQ, qDate, openNow, mood, moodV, moodL, reg, scr, foDate, avoid, banSet, res, nextD, adv, dec, flowN, Wd, sdays: past.length };
  }
  // market regime from Nifty and VIX daily candles (several days, not just today)
  function regimeAt(cl2, vix, i) {
    const c = cl2.slice(0, i + 1); if (c.length < 55) return null;
    const s20 = mean(c.slice(-20)), s50 = mean(c.slice(-50)), s20p = mean(c.slice(-25, -5)), last = c[c.length - 1];
    let path = 0; for (let k = c.length - 20; k < c.length; k++) path += Math.abs(c[k] - c[k - 1]);
    const er = path ? Math.abs(last - c[c.length - 21]) / path : 0;
    const up = last > s20 && s20 > s50 && s20 > s20p, dn = last < s20 && s20 < s50 && s20 < s20p;
    const trend = er < 0.15 ? 'Sideways' : up ? (er >= 0.3 ? 'Strong bullish trend' : 'Weak bullish trend') : dn ? (er >= 0.3 ? 'Strong bearish trend' : 'Weak bearish trend') : 'Sideways';
    const vv = vix && vix.length ? vix.slice(0, Math.max(0, vix.length - (cl2.length - 1 - i))) : [], /* both series end today: align from the end */ v = vv.length ? vv[vv.length - 1] : null, pct = v && vv.length > 60 ? vv.slice(-250).filter((x) => x <= v).length / Math.min(250, vv.length) : null;
    const vol = !ok(v) ? '' : v >= 18 || (ok(pct) && pct >= 0.8) ? 'High volatility' : v <= 12 || (ok(pct) && pct <= 0.25) ? 'Low volatility' : 'Normal volatility';
    return { trend, er, vol, v, pct, s20, s50 };
  }
  function regime(D, nd, NQ, moodL) {
    const cl2 = nd.map((r) => r[4]); if (NQ) cl2.push(NQ.c);
    const vRows = (D.vd || []).map((r) => r[4]).filter(ok); if (D.vix && ok(D.vix.v)) vRows.push(D.vix.v);
    const now = regimeAt(cl2, vRows, cl2.length - 1); if (!now) return null;
    const hist = []; for (let i = Math.max(55, cl2.length - 60); i < cl2.length; i++) { const r = regimeAt(cl2, vRows, i); if (r) hist.push(r.trend); }
    const soon = ((D.cal && D.cal.items) || []).filter((e) => e.imp === 'high' && e.date <= Brief.nextWeekday(typeof istYmd === 'function' ? istYmd() : '2099-01-01'));
    const tags = [now.trend]; if (now.vol) tags.push(now.vol); if (soon.length) tags.push('Event-driven'); if (/Risk-on|Risk-off/.test(moodL)) tags.push(moodL.replace('Mildly ', ''));
    return { ...now, tags, hist, soon, n: cl2.length };
  }
  // what usually suits each regime (general trading rules, not back-tested here)
  function suits(R) {
    if (!R) return [];
    const t = R.trend, hv = R.vol === 'High volatility', lv = R.vol === 'Low volatility', side = t === 'Sideways', strong = /Strong/.test(t);
    return [
      ['Breakouts (ORB, 52-week highs)', side ? ['bad', 'Often fail in a sideways market: wait for volume'] : strong ? ['ok', 'Work better when the trend is strong'] : ['mid', 'Take only with volume']],
      ['Buying pullbacks in the trend', strong ? ['ok', 'The classic trend-day trade (★ setups)'] : side ? ['bad', 'No trend to pull back into'] : ['mid', 'Smaller size, quicker exits']],
      ['Range trades (sell high, buy low in the range)', side && !hv ? ['ok', 'Suits a quiet sideways market'] : ['bad', 'Ranges break in trends and in high volatility']],
      ['Option buying', hv ? ['mid', 'Big moves, but premiums are expensive'] : lv ? ['mid', 'Cheap premiums, but moves are small: time decay hurts'] : ['ok', 'Normal']],
      ['Holding overnight (BTST)', hv || R.tags.includes('Event-driven') ? ['bad', 'Gap risk is high'] : ['mid', 'Check the Overnight page\'s record first']],
      ['Position size', hv ? ['bad', 'Cut size, widen stops'] : ['ok', 'Normal size per your risk rules']],
    ];
  }

  /* ---------- page ---------- */
  function mk() {
    if ($n('it')) return;
    const el = document.createElement('div'); el.id = 'it'; el.className = 'rp it'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Market overview');
    el.innerHTML = `<div class="rp-top"><div class="mk-tabs" role="tablist"><button data-t="ov" onclick="Intel.show('ov')">Overview</button><button data-t="str" onclick="Intel.show('str')">Strength & Money Flow</button><button data-t="sec" onclick="Intel.show('sec')">Sector Rotation</button><button data-t="reg" onclick="Intel.show('reg')">Regime & Calm Zone</button><button data-t="scr" onclick="Intel.show('scr')">IV, Basis & Avoid</button><button data-t="use" onclick="Intel.show('use')">Data & Usage</button></div>
      <span class="mut" id="itNote"></span><button class="x" onclick="Intel.close()" aria-label="Close">✕</button></div><div id="itBody"></div>`;
    document.body.appendChild(el);
  }
  function open(t) { mk(); $n('it').classList.add('on'); document.body.style.overflow = 'hidden'; show(t || tab); if (!C || Date.now() - D.ts > 2 * 60e3) load(); if (!timer) timer = setInterval(() => { if ($n('it') && $n('it').classList.contains('on') && C && C.openNow && !busy) load(); }, 3 * 60e3); }
  function close() { const el = $n('it'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; }
  function show(t) { tab = t; render(); }
  function render() {
    const b = $n('itBody'); if (!b) return;
    document.querySelectorAll('#it .mk-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
    let h = busy ? `<div class="alert i">${esc(busy)}</div>` : '';
    if (err) h += `<div class="alert">${esc(err)}</div>`;
    if (C) h += tab === 'ov' ? ovHTML() : tab === 'str' ? strHTML() : tab === 'sec' ? secHTML() : tab === 'reg' ? regHTML() : tab === 'scr' ? scrHTML() : useHTML();
    else if (!busy && !err) h += '<div class="mut">Loading…</div>';
    h += `<div class="legend it-disc">Labels: ${T('act')} reported by NSE/exchange · ${T('live')} broker price now · ${T('eod')} NSE end-of-day file · ${T('est')} worked out from prices and volumes · ${T('model')} our own rule-based score · ${T('na')} not available. Research and education only, not investment advice; this dashboard is not a SEBI-registered adviser or research analyst. Decisions and risk are yours.</div>`;
    b.innerHTML = h;
    const n = $n('itNote'); if (n && D) n.textContent = `${D.live ? (C && C.openNow ? 'Market open · prices live' : 'Market closed · last prices') : 'Sample data'} · updated ${hhmm(D.ts)}${C && C.sdays ? ` · ${C.sdays} days of NSE files` : ''}`;
  }
  const card = (title, tag, body, go, wide) => { if (go && !/^Intel\./.test(go)) go = 'Intel.close();' + go; return `<section class="it-card${wide ? ' wide' : ''}"${go ? ` onclick="${go}" role="button" tabindex="0"` : ''}><div class="it-ch"><h3>${title}</h3>${tag}</div>${body}${go ? '<span class="it-go">Open →</span>' : ''}</section>`; };
  function gauge(v, label) {
    const a = ok(v) ? (v / 100) * 90 : 0, col = !ok(v) ? 'var(--wait)' : v >= 15 ? 'var(--call)' : v <= -15 ? 'var(--put)' : 'var(--warn)';
    return `<svg viewBox="0 0 200 118" class="it-gauge" role="img" aria-label="Market mood ${esc(label)}"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--line2)" stroke-width="14" stroke-linecap="round"/>
      <path d="M20 100 A80 80 0 0 1 60 31" fill="none" stroke="var(--put)" stroke-width="14" opacity=".55"/><path d="M140 31 A80 80 0 0 1 180 100" fill="none" stroke="var(--call)" stroke-width="14" opacity=".55"/>
      <line x1="100" y1="100" x2="100" y2="32" stroke="${col}" stroke-width="4" stroke-linecap="round" transform="rotate(${a} 100 100)"/><circle cx="100" cy="100" r="7" fill="${col}"/>
      <text x="100" y="116" text-anchor="middle" fill="${col}" font-size="15" font-weight="700">${esc(label)}${ok(v) ? ` (${v > 0 ? '+' : ''}${v})` : ''}</text><text x="18" y="116" font-size="10" fill="var(--muted)">Risk-off</text><text x="182" y="116" font-size="10" text-anchor="end" fill="var(--muted)">Risk-on</text></svg>`;
  }
  const bar = (v, mx, t) => `<div class="it-bar"><span>${t}</span><div class="t"><i style="${v >= 0 ? `left:50%;width:${Math.min(50, (Math.abs(v) / mx) * 50)}%;background:var(--call)` : `right:50%;width:${Math.min(50, (Math.abs(v) / mx) * 50)}%;background:var(--put)`}"></i></div><em class="${cl(v)}">${pc(v)}</em></div>`;
  function heat(SEC, k) {
    return `<div class="it-heat">${SEC.slice().sort((a, b) => (b[k] || 0) - (a[k] || 0)).map((s) => { const v = s[k] || 0, a = Math.min(1, Math.abs(v) / 0.02); return `<button class="it-tile" style="background:${v >= 0 ? `rgba(0,245,160,${0.08 + a * 0.45})` : `rgba(255,59,107,${0.08 + a * 0.45})`}" onclick="event.stopPropagation();Intel.pickSec('${esc(s.ind)}')"><b>${esc(s.name)}</b><span>${pc(s.r1)}</span><small>5D ${pc(s.r5)} · 20D ${pc(s.r20)}</small></button>`; }).join('')}</div>`;
  }
  function ovHTML() {
    const c = C, W = c.Wd, BR = typeof Brief !== 'undefined' ? Brief.data : null;
    const tips = `<div class="gd-mean"><b>आसान मतलब:</b> यह पूरे बाज़ार का एक-page सार है। ऊपर बाज़ार का मूड (risk-on = लोग जोखिम ले रहे हैं, risk-off = डर), फिर दुनिया, FII/DII, sectors, कल के मज़बूत-कमज़ोर शेयर, असामान्य volume, खबरें और results। किसी भी डिब्बे पर tap करें तो उसका पूरा page खुलेगा।</div>`;
    let h = tips + '<div class="it-grid">';
    h += card('Market mood', T('model'), `${gauge(c.moodV, c.moodL)}<div class="it-list">${c.mood.map(([n, v, t]) => `<div><span class="${cl(v)}">${v > 0.05 ? '▲' : v < -0.05 ? '▼' : '•'}</span> ${esc(n)}: ${esc(t)}</div>`).join('')}</div>`, "Intel.show('str')");
    const wl = [['gift', 'GIFT Nifty'], ['dowF', 'Dow fut'], ['nasF', 'Nasdaq fut'], ['spxF', 'S&P fut'], ['nikkei', 'Nikkei'], ['hsi', 'Hang Seng'], ['brent', 'Brent'], ['wti', 'WTI'], ['gold', 'Gold'], ['usdinr', 'USD/INR'], ['dxy', 'DXY'], ['us10y', 'US 10Y'], ['usvix', 'US VIX']];
    const risk = (() => { let s = 0, n = 0; [['nasF', 1], ['dowF', 1], ['nikkei', 0.5], ['hsi', 0.5], ['usvix', -0.5], ['dxy', -0.5], ['brent', -0.3]].forEach(([k, w]) => { const x = W[k]; if (x && ok(x.chg)) { s += Math.sign(x.chg) * w * Math.min(1, Math.abs(x.chg) / 0.5); n += Math.abs(w); } }); return n ? s / n : null; })();
    h += card('Global pulse', T('live'), `<div class="it-kv">${wl.map(([k, n]) => { const x = W[k]; return x ? `<div><small>${n}</small><b>${f2(x.price)}</b><em class="${cl(x.chg)}">${ok(x.chg) ? pc(x.chg / 100, 2) : '–'}</em></div>` : ''; }).join('') || '<div class="mut">World data not loaded yet.</div>'}</div>
      ${ok(risk) ? `<div class="it-line ${cl(risk)}">Global tone: <b>${risk >= 0.25 ? 'risk-on' : risk <= -0.25 ? 'risk-off' : 'mixed'}</b> <small class="mut">(US futures and Asia up, VIX/dollar/crude down = risk-on)</small></div>` : ''}`, '', false);
    const ix = ['NIFTY', 'BANKNIFTY', 'SENSEX'].map((k) => [k, D.E && D.E.q && D.E.q[k]]).filter((x) => x[1]);
    h += card('Indian pulse', T(c.openNow ? 'live' : 'act'), `<div class="it-kv">${ix.map(([k, q]) => `<div><small>${k === 'NIFTY' ? 'Nifty 50' : k === 'BANKNIFTY' ? 'Bank Nifty' : 'Sensex'}</small><b>${f2(q.c)}</b><em class="${cl(q.c - q.pc)}">${pc(q.c / q.pc - 1, 2)}</em></div>`).join('')}${D.vix && ok(D.vix.v) ? `<div><small>India VIX</small><b>${f2(D.vix.v)}</b><em class="${cl(-(D.vix.v - D.vix.prev))}">${D.vix.prev ? pc(D.vix.v / D.vix.prev - 1, 1) : ''}</em></div>` : ''}</div>
      <div class="it-line">F&O breadth: <b class="up">${c.adv} up</b> · <b class="dn">${c.dec} down</b></div>`, "Markets.open('map')");
    const F = D.fii, P = D.part && D.part.latest && D.part.latest.p && D.part.latest.p.FII;
    h += card('FII / DII', T('act'), F && ok(F.fii) ? `<div class="it-kv"><div><small>FII cash</small><b class="${cl(F.fii)}">${F.fii >= 0 ? '+' : '−'}${crore(F.fii)}</b></div><div><small>DII cash</small><b class="${cl(F.dii)}">${F.dii >= 0 ? '+' : '−'}${crore(F.dii)}</b></div>${P ? `<div><small>FII index futures</small><b>${f0((P.futL / (P.futL + P.futS)) * 100)}% long</b></div>` : ''}</div>
      <div class="it-line mut">${esc(F.date || '')}${F.stale ? ' · last available (NSE did not answer)' : ''}. ${ok(F.fii) && ok(F.dii) && Math.sign(F.fii) !== Math.sign(F.dii) ? 'FII and DII are on opposite sides today.' : ''} Daily FII buying per stock or sector is not published.</div>` : `<div class="mut">FII/DII not available yet (NSE publishes in the evening).</div>`, '');
    h += card('Sector heatmap', T(c.openNow ? 'live' : 'act'), heat(c.SEC.filter((s) => s.n >= 3), 'r1'), "Intel.show('sec')", true);
    const pk = (L, s) => (L && L.length ? L.map((x) => `<div class="it-pick"><b>${esc(x.sym)}</b><span class="mut">${esc(Brief.secName(x.ind))}</span><em class="${s > 0 ? 'up' : 'dn'}">${x.sc >= 0 ? '+' : ''}${f1(x.sc)}</em></div>`).join('') : '<div class="mut">None passed the bar.</div>');
    h += card(`Top bullish ${BR ? 'for ' + esc(BR.R.next) : ''}`, T('model'), BR ? pk(BR.R.pos, 1) : '<div class="mut">The Next-Day Brief is being built…</div>', "Brief.open('lists')");
    h += card(`Top bearish ${BR ? 'for ' + esc(BR.R.next) : ''}`, T('model'), BR ? pk(BR.R.neg, -1) : '<div class="mut">The Next-Day Brief is being built…</div>', "Brief.open('lists')");
    const uv = c.S.filter((x) => ok(x.volX) && x.volX >= 2 && Math.abs(x.r1) >= 0.012).sort((a, b) => b.volX - a.volX).slice(0, 8);
    h += card('Unusual volume', T('est'), uv.length ? uv.map((x) => `<div class="it-pick"><b>${esc(x.sym)}</b><span>${f1(x.volX)}× normal</span><em class="${cl(x.r1)}">${pc(x.r1)}</em></div>`).join('') : `<div class="mut">${c.sdays >= 10 ? 'No stock at 2× its usual volume with a 1.2%+ move.' : 'Needs 10+ days of NSE files (loading).'}</div>`, "Markets.open('scr');setTimeout(()=>Markets.setScr('orb'),300)");
    const uo = BR ? BR.R.stocks.filter((x) => ok(x.oiPct) && Math.abs(x.oiPct) >= 0.08).sort((a, b) => Math.abs(b.oiPct) - Math.abs(a.oiPct)).slice(0, 8) : [];
    h += card('Unusual futures OI', T(BR && BR.I.mode === 'final' ? 'eod' : 'live'), BR ? uo.length ? uo.map((x) => `<div class="it-pick"><b>${esc(x.sym)}</b><span>${esc(x.build || '')}</span><em class="${cl(x.oiPct)}">OI ${pc(x.oiPct)}</em></div>`).join('') : '<div class="mut">No stock with an 8%+ OI change.</div>' : '<div class="mut">Comes with the Brief (OI from NSE\'s file or live).</div>', "Brief.open('all')");
    let news = []; try { news = (Impact.data && Impact.data.items || []).slice().sort((a, b) => (b.str || 0) - (a.str || 0) || b.ts - a.ts).slice(0, 4); } catch (e) { /* none */ }
    h += card('Important news', T('model'), news.length ? news.map((x) => `<div class="it-news"><span class="${x.sec && x.sec[0] ? cl(x.sec[0][1]) : ''}">${'●'.repeat(x.str || 1)}</span> ${esc(x.t)}</div>`).join('') : '<div class="mut">News Impact loads in the background.</div>', "Impact.open('news')");
    const rs = Object.entries(c.res).filter(([, d]) => d <= Brief.nextWeekday(c.nextD || c.qDate)).sort((a, b) => (a[1] < b[1] ? -1 : 1)).slice(0, 10);
    h += card('Upcoming results (F&O)', T('act'), rs.length ? `<div class="why">${rs.map(([s, d]) => `<span>${esc(s)} · ${d.slice(5)}</span>`).join('')}</div>` : '<div class="mut">None in the next two sessions.</div>', "Impact.open('results')");
    h += card('Market regime', T('model'), c.reg ? `<div class="it-tags">${c.reg.tags.map((t) => `<span class="pill ${/bull|on/i.test(t) ? 'b' : /bear|off|High/i.test(t) ? 's' : 'n'}">${esc(t)}</span>`).join('')}</div><div class="it-line mut">From Nifty's 20/50-day trend, how straight it moved, and India VIX.</div>` : '<div class="mut">Needs Nifty daily candles (loading).</div>', "Intel.show('reg')");
    const st = typeof Brief !== 'undefined' ? Brief.stats(Store.pref('brief_rec' + (live() ? '' : '_demo'), {}), 'final') : null;
    h += card('Prediction audit', T('model'), st && st.days ? `<div class="it-kv"><div><small>Days checked</small><b>${st.days}</b></div><div><small>Picks right</small><b>${f0(st.hit * 100)}%</b></div><div><small>Avg next-day move</small><b class="${cl(st.edge)}">${pc(st.edge, 2)}</b></div></div>${st.days < 20 ? '<div class="it-line mut">Under 20 days: too early to judge.</div>' : ''}` : '<div class="mut">No day checked yet. Each evening\'s list is checked after the next session.</div>', "Brief.open('rec')");
    h += card('Stocks to avoid', T('act'), c.avoid.length ? `<div class="why">${c.avoid.slice(0, 10).map((x) => `<span class="${x.why[0][1] === 'r' ? 'dn' : ''}">${esc(x.sym)}</span>`).join('')}</div><div class="it-line mut">${c.banSet.size ? `${c.banSet.size} in the F&O ban` : 'No ban list today'} · results soon · thin trading · overstretched.</div>` : '<div class="mut">Nothing flagged.</div>', "Intel.show('scr')");
    h += card('Data freshness', '', fresh(), "Intel.show('use')");
    return h + '</div>';
  }
  function fresh() {
    const row = (n, t, st) => `<div class="it-fr"><span>${n}</span><b class="${st}">${t}</b></div>`;
    const age = EodCache.age(), qd = C.qDate, today = typeof istYmd === 'function' ? istYmd() : qd;
    const W = D.world, wAge = W && W.ts ? Date.now() - W.ts : null;
    return [row('F&O prices', !D.live ? 'Sample' : C.openNow ? (age < 5 * 60e3 ? 'Live' : 'Stale') : qd === today ? 'Closed (today\'s close)' : `Last session ${qd}`, !D.live ? 'mut' : C.openNow && age < 5 * 60e3 ? 'up' : 'w'),
      row('NSE files (OI, delivery)', C.sdays ? `${C.sdays} days, latest ${Brief.d8to10(Object.keys((D.H && D.H.sec) || {}).sort().pop() || '') || '–'}` : 'Not loaded', C.sdays ? 'up' : 'dn'),
      row('World markets', wAge === null ? 'Not loaded' : wAge < 10 * 60e3 ? `Updated ${hhmm(W.ts)}` : `Stale (${hhmm(W.ts)})`, wAge !== null && wAge < 10 * 60e3 ? 'up' : 'w'),
      row('FII/DII', D.fii && ok(D.fii.fii) ? `${D.fii.date || ''}${D.fii.stale ? ' (last available)' : ''}` : 'Not yet', D.fii && ok(D.fii.fii) && !D.fii.stale ? 'up' : 'w'),
      row('F&O ban list', D.ban && D.ban.date ? D.ban.date : D.ban && D.ban.err ? 'Error' : '–', D.ban && D.ban.date ? 'up' : 'w')].join('');
  }
  function strHTML() {
    const c = C, L = c.S.filter((x) => ok(x.rel)), lead = L.slice().sort((a, b) => b.rel - a.rel).slice(0, 12), lag = L.slice().sort((a, b) => a.rel - b.rel).slice(0, 12);
    const mxF = Math.max(1, ...c.SEC.map((s) => Math.abs(s.flow)));
    let h = `<div class="gd-mean"><b>आसान मतलब:</b> <b>Strength</b> = शेयर/sector आज Nifty से कितना आगे (हरा) या पीछे (लाल)। Nifty गिरे और कोई शेयर टिका रहे, तो उसमें असली माँग है। <b>Money flow</b> = traded value × चाल की दिशा, sector-वार जोड़ा। यह एक <u>अंदाज़ा</u> है, असली FII खरीद नहीं।</div>`;
    h += `<div class="it-grid"><section class="it-card">${gauge(c.moodV, c.moodL)}<div class="it-list">${c.mood.map(([n, v, t]) => `<div><span class="${cl(v)}">${v > 0.05 ? '▲' : v < -0.05 ? '▼' : '•'}</span> ${esc(n)}: ${esc(t)}</div>`).join('')}</div></section>`;
    h += `<section class="it-card wide"><div class="it-ch"><h3>Sector money flow, today</h3>${T('est')}</div><div class="mut it-small">Tap a sector to see its stocks. ₹ crore of traded value, signed by the day's move.</div>${c.SEC.slice().sort((a, b) => b.flow - a.flow).map((s) => `<button class="it-fbar ${secSel === s.ind ? 'on' : ''}" onclick="Intel.pickSec('${esc(s.ind)}')"><span>${esc(s.name)}</span><div class="t"><i style="${s.flow >= 0 ? `left:50%;width:${(Math.abs(s.flow) / mxF) * 50}%;background:var(--call)` : `right:50%;width:${(Math.abs(s.flow) / mxF) * 50}%;background:var(--put)`}"></i></div><em class="${cl(s.flow)}">${s.flow >= 0 ? '+' : '−'}${Math.abs(Math.round(s.flow)).toLocaleString('en-IN')}</em><small class="mut">#${s.rankT} today · #${s.rank5} 5D ${s.rank5 - s.rankT >= 3 ? '<b class="up">↑ rising</b>' : s.rankT - s.rank5 >= 3 ? '<b class="dn">↓ fading</b>' : ''}</small></button>`).join('')}</section></div>`;
    if (secSel) { const s = c.SEC.find((x) => x.ind === secSel); if (s) h += `<section class="mk-panel"><div class="ph"><h2>${esc(s.name)}: its F&O stocks</h2><button class="btn-ghost" onclick="Intel.pickSec(null)">Close</button></div>${stockTbl(s.L.slice().sort((a, b) => (b.rel || 0) - (a.rel || 0)))}</section>`; }
    const mx = Math.max(0.01, ...L.map((x) => Math.abs(x.rel)));
    h += `<div class="bf-cols"><section class="mk-panel"><div class="ph"><h2 class="up">Leaders vs Nifty ${T(c.openNow ? 'live' : 'act')}</h2></div>${lead.map((x) => bar(x.rel, mx, `<b>${esc(x.sym)}</b> <small class="mut">${esc(Brief.secName(x.ind))}</small>`)).join('')}</section>
      <section class="mk-panel"><div class="ph"><h2 class="dn">Laggards vs Nifty</h2></div>${lag.map((x) => bar(x.rel, mx, `<b>${esc(x.sym)}</b> <small class="mut">${esc(Brief.secName(x.ind))}</small>`)).join('')}</section></div>`;
    h += `<div class="legend">"vs Nifty" = the stock's % change minus Nifty's. "↑ rising" = the sector ranks 3+ places better today than over 5 days (leadership changing). Strong relative strength does not mean it will keep rising: leaders reverse too.</div>`;
    return h;
  }
  function stockTbl(L) {
    return `<div class="tblw"><table><thead><tr><th class="l">Stock</th><th>Price</th><th>Today</th><th>vs Nifty</th><th>5D</th><th>20D</th><th>Volume</th><th>Flow (₹ cr, est.)</th><th>Delivery</th><th></th></tr></thead><tbody>${L.map((x) => `<tr><td class="l"><b>${esc(x.sym)}</b></td><td>${f2(x.c)}</td><td class="${cl(x.r1)}">${pc(x.r1)}</td><td class="${cl(x.rel)}">${pc(x.rel)}</td><td class="${cl(x.r5)}">${pc(x.r5)}</td><td class="${cl(x.r20)}">${pc(x.r20)}</td><td>${ok(x.volX) ? f1(x.volX) + '×' : '–'}</td><td class="${cl(x.flow)}">${f0(x.flow)}</td><td>${ok(x.dp) ? f0(x.dp) + '%' : '–'}</td><td><button class="btn ghost" onclick="Brief.analyze('${esc(x.sym)}')">Analyze</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function secHTML() {
    const c = C, Wt = weights();
    const qc = { Leading: 'up', Improving: 'up', Weakening: 'w', Lagging: 'dn' };
    let h = `<div class="gd-mean"><b>आसान मतलब:</b> हर sector आज, 5 दिन और 20 दिन में Nifty से आगे है या पीछे। <b>Leading</b> = लंबे और छोटे दोनों समय में आगे; <b>Improving</b> = पीछे था पर अब सुधर रहा (नज़र रखें); <b>Weakening</b> = आगे था पर अब ढीला; <b>Lagging</b> = दोनों में पीछे। Score हमारे नियमों का (MODEL) है, guarantee नहीं।</div>`;
    h += heat(c.SEC.filter((s) => s.n >= 3), 'r1');
    h += `<section class="mk-panel" style="margin-top:12px"><div class="ph"><h2>Sector rotation ${T('model')}</h2></div><div class="tblw"><table><thead><tr><th class="l">Sector</th><th>Score</th><th class="l">Phase</th><th>Today</th><th>vs Nifty</th><th>5D</th><th>20D</th><th>Rising</th><th>Beat sector avg</th><th>Volume</th><th>Delivery vs usual</th><th>OI tilt</th><th>News</th></tr></thead><tbody>${c.SEC.map((s) => `<tr><td class="l"><button class="btn-ghost" onclick="Intel.pickSec('${esc(s.ind)}');Intel.show('str')"><b>${esc(s.name)}</b></button> <small class="mut">${s.n}</small></td>
      <td><div class="score"><i><u style="width:${s.score || 0}%;background:${(s.score || 0) >= 65 ? 'var(--call)' : (s.score || 0) >= 40 ? 'var(--warn)' : 'var(--put)'}"></u></i><b>${ok(s.score) ? s.score : '–'}</b></div></td><td class="l ${qc[s.quad] || ''}">${s.quad || '–'}</td>
      <td class="${cl(s.r1)}">${pc(s.r1)}</td><td class="${cl(s.rel)}">${pc(s.rel)}</td><td class="${cl(s.r5)}">${pc(s.r5)}</td><td class="${cl(s.r20)}">${pc(s.r20)}</td><td>${s.up}/${s.n}</td><td>${s.beat}/${s.n}</td><td>${ok(s.volX) ? f1(s.volX) + '×' : '–'}</td><td>${ok(s.dpX) ? f2(s.dpX) + '×' : '–'}</td><td class="${cl(s.oiT)}">${ok(s.oiT) ? (s.oiT > 0.4 ? 'buying' : s.oiT < -0.4 ? 'selling' : 'flat') : '–'}</td><td class="${cl(s.news)}">${ok(s.news) ? (s.news > 0 ? '▲' : '▼') : '–'}</td></tr>`).join('')}</tbody></table></div>
      <div class="legend">Score (0–100) ranks sectors on: relative strength ${Wt.rs}%, 5-day momentum ${Wt.mom}%, volume ${Wt.vol}%, breadth ${Wt.br}%, futures OI tilt ${Wt.oi}%, delivery vs usual ${Wt.inst}% (a stand-in for institutional buying, ESTIMATE), news ${Wt.news}%. Parts with no data are left out. These weights are a starting guess, not proven: change them below and watch the Track Record. Sectors are NSE's industry groups of F&O stocks (Nifty 500 list). Sector-wise FPI holdings are published by NSDL every 15 days and are not daily.</div>
      <div class="it-w">${Object.keys(W0).map((k) => `<label>${{ rs: 'Relative strength', mom: 'Momentum', vol: 'Volume', br: 'Breadth', oi: 'OI tilt', inst: 'Delivery', news: 'News' }[k]} <input type="number" min="0" max="100" value="${Wt[k]}" onchange="Intel.setW('${k}',this.value)"></label>`).join('')}<button class="btn ghost" onclick="Intel.setW()">Reset</button></div></section>`;
    return h;
  }
  function regHTML() {
    const c = C, R = c.reg;
    let h = `<div class="gd-mean"><b>आसान मतलब:</b> बाज़ार किस "मौसम" में है — तेज़ी का trend, मंदी का trend या sideways; शांत या तूफ़ानी। हर मौसम में अलग तरीका चलता है: शांत sideways बाज़ार में breakout अक्सर fail होते हैं, तूफ़ानी बाज़ार में size छोटा रखें। <b>Calm Zone</b> बताता है कौन से शेयर शांत चल रहे हैं और कौन से तूफ़ानी।</div>`;
    if (!R) h += '<div class="alert i">Needs Nifty daily candles (about 55 days). They load with the dashboard; open this again in a minute.</div>';
    else {
      const col = (t) => (/Strong bull/.test(t) ? '#00F5A0' : /Weak bull/.test(t) ? '#4fc99a' : /Strong bear/.test(t) ? '#FF3B6B' : /Weak bear/.test(t) ? '#c9566f' : '#7F93B2');
      h += `<section class="mk-panel"><div class="ph"><h2>Now ${T('model')}</h2></div><div class="it-tags it-big">${R.tags.map((t) => `<span class="pill ${/bull|on/i.test(t) ? 'b' : /bear|off|High/i.test(t) ? 's' : 'n'}">${esc(t)}</span>`).join('')}</div>
        <div class="it-kv"><div><small>Nifty vs 20-day avg</small><b class="${cl(c.NQ ? c.NQ.c - R.s20 : 0)}">${c.NQ ? pc(c.NQ.c / R.s20 - 1) : '–'}</b></div><div><small>20-day vs 50-day avg</small><b class="${cl(R.s20 - R.s50)}">${pc(R.s20 / R.s50 - 1)}</b></div><div><small>How straight (0–1)</small><b>${f2(R.er)}</b></div><div><small>India VIX</small><b>${ok(R.v) ? f2(R.v) : '–'}</b></div><div><small>VIX vs last year</small><b>${ok(R.pct) ? f0(R.pct * 100) + 'th pct' : '–'}</b></div></div>
        ${R.soon.length ? `<div class="it-line">Events: ${R.soon.slice(0, 4).map((e) => esc(`${e.date} ${e.time || ''} ${e.t}`)).join(' · ')}</div>` : ''}
        <div class="it-strip" title="Last ${R.hist.length} sessions, oldest left">${R.hist.map((t) => `<i style="background:${col(t)}" title="${esc(t)}"></i>`).join('')}</div><div class="mut it-small">Last ${R.hist.length} sessions (oldest on the left): green = bullish trend, red = bearish, grey = sideways.</div></section>`;
      h += `<section class="mk-panel"><div class="ph"><h2>What usually suits this weather</h2></div><div class="tblw"><table><tbody>${suits(R).map(([n, [k, t]]) => `<tr><td class="l"><b>${esc(n)}</b></td><td class="l ${k === 'ok' ? 'up' : k === 'bad' ? 'dn' : ''}">${k === 'ok' ? '✔ Suits' : k === 'bad' ? '✖ Careful' : '• Mixed'}</td><td class="l">${esc(t)}</td></tr>`).join('')}</tbody></table></div><div class="legend">General trading rules, not back-tested here. Use Replay and the Journal to check how YOUR trades did in each kind of market.</div></section>`;
    }
    const V = c.S.filter((x) => ok(x.rv)), calm = V.slice().sort((a, b) => a.rv - b.rv).slice(0, 12), wild = V.slice().sort((a, b) => b.rv - a.rv).slice(0, 12), mrv = med(V.map((x) => x.rv));
    const t2 = (L) => `<div class="tblw"><table><thead><tr><th class="l">Stock</th><th>Daily swing (avg high-low)</th><th>Yearly-scale volatility</th><th>Today</th></tr></thead><tbody>${L.map((x) => `<tr><td class="l"><b>${esc(x.sym)}</b> <small class="mut">${esc(Brief.secName(x.ind))}</small></td><td>${ok(x.atrP) ? pc(x.atrP).slice(1) : '–'}</td><td>${f0(x.rv * 100)}%</td><td class="${cl(x.r1)}">${pc(x.r1)}</td></tr>`).join('')}</tbody></table></div>`;
    h += `<div class="bf-cols"><section class="mk-panel"><div class="ph"><h2>Calm Zone: calmest F&O stocks ${T('est')}</h2></div>${V.length ? t2(calm) : '<div class="mut">Needs 10+ days of NSE files.</div>'}</section><section class="mk-panel"><div class="ph"><h2>Most volatile</h2></div>${V.length ? t2(wild) : ''}</section></div>
      <div class="legend">Volatility from the last 20 daily closes (NSE files), shown on a yearly scale; the median F&O stock is ${ok(mrv) ? f0(mrv * 100) + '%' : '–'}. Calm stocks suit range trades and option selling (calm can end suddenly); volatile ones need smaller size and wider stops.</div>`;
    return h;
  }
  function scrHTML() {
    const c = C, L = c.scr.slice().sort((a, b) => (sortS === 'basis' ? (b.basisA || -9) - (a.basisA || -9) : sortS === 'rsi' ? (b.rsi || 0) - (a.rsi || 0) : sortS === 'ivr' ? (b.ivr || 0) - (a.ivr || 0) : (b.iv || 0) - (a.iv || 0)));
    const th = (k, t) => `<th style="cursor:pointer" onclick="Intel.sortScr('${k}')">${t}${sortS === k ? ' ▾' : ''}</th>`;
    let h = `<div class="gd-mean"><b>आसान मतलब:</b> <b>IV</b> = options कितने महँगे हैं (ऊँचा = बाज़ार बड़ी चाल का डर/उम्मीद रख रहा है)। IV ÷ असली चाल 1.3 से ऊपर = options महँगे। <b>Basis</b> = futures, शेयर के भाव से कितना ऊपर (premium) या नीचे (discount)। <b>RSI</b> 70 से ऊपर = बहुत चढ़ा, 30 से नीचे = बहुत गिरा। <b>Avoid</b> = जिनमें अभी trade करना जोखिम भरा है।</div>`;
    h += `<section class="mk-panel"><div class="ph"><h2>Stocks to avoid now ${T('act')}</h2></div>${c.avoid.length ? `<div class="tblw"><table><thead><tr><th class="l">Stock</th><th>Today</th><th class="l">Why</th></tr></thead><tbody>${c.avoid.slice(0, 40).map((x) => `<tr><td class="l"><b>${esc(x.sym)}</b></td><td class="${cl(x.r1)}">${pc(x.r1)}</td><td class="l"><div class="why">${x.why.map(([t, k]) => `<span class="${k}">${esc(t)}</span>`).join('')}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="mut">Nothing flagged.</div>'}
      <div class="legend">F&O ban list from NSE (${D.ban && D.ban.date ? esc(D.ban.date) : 'not loaded'}): when a stock's open positions pass 95% of the market-wide limit, no new F&O positions are allowed. Results dates from the NSE calendar. "Thinly traded" = the lowest 8% of F&O stocks by 20-day traded value.</div></section>`;
    h += `<section class="mk-panel"><div class="ph"><h2>IV, futures basis and RSI ${T('eod')}</h2><span class="mut">NSE F&O file of ${esc(c.foDate || '–')}</span></div>${L.length ? `<div class="tblw"><table><thead><tr><th class="l">Stock</th>${th('iv', 'ATM IV')}<th>Real volatility (20D)</th>${th('ivr', 'IV ÷ real')}${th('basis', 'Basis (yearly)')}<th>Days to expiry</th><th>PCR</th>${th('rsi', 'RSI 14 (daily)')}<th>5D</th></tr></thead><tbody>${L.slice(0, 80).map((x) => `<tr><td class="l"><b>${esc(x.sym)}</b></td><td>${ok(x.iv) ? f0(x.iv * 100) + '%' : '–'}</td><td>${ok(x.rv) ? f0(x.rv * 100) + '%' : '–'}</td><td class="${ok(x.ivr) ? (x.ivr >= 1.3 ? 'dn' : x.ivr <= 0.8 ? 'up' : '') : ''}">${ok(x.ivr) ? f2(x.ivr) : '–'}</td><td class="${cl(x.basisA)}">${ok(x.basisA) ? pc(x.basisA) : '–'}</td><td>${ok(x.dte) ? f0(x.dte) : '–'}</td><td>${ok(x.pcr) ? f2(x.pcr) : '–'}</td><td class="${ok(x.rsi) ? (x.rsi >= 70 ? 'dn' : x.rsi <= 30 ? 'up' : '') : ''}">${ok(x.rsi) ? f0(x.rsi) : '–'}</td><td class="${cl(x.r5)}">${pc(x.r5)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mut">Needs NSE\'s F&O file (loading, or deploy the new Worker).</div>'}
      <div class="legend">ATM IV is worked out (Black-Scholes) from the closing prices of the at-the-money call and put of the next monthly expiry in NSE's file: an end-of-day number, not live. Basis = near-month future vs the stock's price, shown per year; a premium is normal (interest), a discount can mean heavy short selling or a dividend. PCR and Max Pain are not direction forecasts on their own.</div></section>`;
    return h;
  }
  function useHTML() {
    const u = usage, cu = typeof LiveSource !== 'undefined' && LiveSource.usage ? LiveSource.usage() : null;
    let h = `<div class="gd-mean"><b>आसान मतलब:</b> यहाँ दिखता है कि dashboard कितना data माँग रहा है और कौन सी free limit के पास है। Upstox एक मिनट में 500 और 30 मिनट में 2,000 calls तक देता है; उससे ऊपर कुछ देर रोक देता है। Computer और phone दोनों पर dashboard खुला हो तो खपत दोगुनी होती है।</div>`;
    h += `<div class="it-grid"><section class="it-card"><div class="it-ch"><h3>Data freshness</h3></div>${C ? fresh() : ''}</section>`;
    if (!live()) h += '<section class="it-card"><div class="mut">Demo mode: no real calls are made.</div></section>';
    else if (!u) h += '<section class="it-card"><div class="mut">Reading the Worker\'s meter…</div></section>';
    else if (u.none) h += '<section class="it-card"><div class="alert">The Worker has no usage meter yet: deploy the new Worker code.</div></section>';
    else {
      const pct = (a, b) => Math.min(100, Math.round((a / b) * 100));
      const meter = (n, a, b) => `<div class="it-m"><span>${n}</span><div class="t"><i style="width:${pct(a, b)}%;background:${pct(a, b) >= 80 ? 'var(--put)' : pct(a, b) >= 50 ? 'var(--warn)' : 'var(--call)'}"></i></div><b>${a} / ${b}</b></div>`;
      h += `<section class="it-card"><div class="it-ch"><h3>Upstox (from the Worker)</h3></div>${meter('Last minute', u.up1m, 500)}${meter('Last 30 minutes', u.up30m, 2000)}
        <div class="it-line ${u.rlWait ? 'dn' : ''}">${u.rlWait ? `⛔ Paused now for ${u.rlWait} s: ${esc(u.rlMsg)}` : 'Not paused.'} ${u.rlHits ? `Upstox said "slow down" ${u.rlHits} time${u.rlHits > 1 ? 's' : ''}${u.rlLast ? `, last at ${hhmm(u.rlLast)}` : ''}.` : 'No "slow down" since this Worker started.'}</div>
        <div class="it-line mut">AI: ${u.ai} call${u.ai === 1 ? '' : 's'}, ${u.aiFail} failed${u.aiErr ? ` (last: ${esc(u.aiErr)})` : ''}. Counts since ${hhmm(u.since)}; Cloudflare can run more than one copy of the Worker, so treat them as a rough guide.</div></section>
        <section class="it-card"><div class="it-ch"><h3>Busiest Worker endpoints</h3></div>${(u.top || []).map(([p, n]) => `<div class="it-fr"><span>${esc(p)}</span><b>${n}</b></div>`).join('')}<div class="it-line mut">${u.req} requests since ${hhmm(u.since)} (Cloudflare free plan: 100,000 a day).</div></section>`;
    }
    if (cu) h += `<section class="it-card"><div class="it-ch"><h3>This browser, last 10 minutes</h3></div>${cu.top.map(([p, n]) => `<div class="it-fr"><span>${esc(p)}</span><b>${n}</b></div>`).join('') || '<div class="mut">No calls.</div>'}<div class="it-line mut">${cu.n10} calls in 10 minutes${cu.rate ? `, ${cu.rate} "slow down" replies` : ''}. When this tab is hidden or the phone is locked, refresh slows to once a minute.</div></section>`;
    h += `<section class="it-card"><div class="it-ch"><h3>Tips to stay inside the free limits</h3></div><div class="it-list"><div>• Keep the dashboard open on one device during market hours.</div><div>• Watchlist: every extra stock adds its own option chain and candles. Remove the ones you don't need.</div><div>• Run the yearly Screener scan and the Overnight download after 3:30 pm, not during the session.</div><div>• If AI keeps failing, News Impact shows the last reading; it retries on its own.</div></div></section></div>`;
    return h;
  }
  function pickSec(k) { secSel = k; if (tab !== 'str' && k) tab = 'str'; render(); }
  function sortScr(k) { sortS = k; render(); }
  function setW(k, v) { if (!k) Store.setPref('intel_w', {}); else Store.setPref('intel_w', { ...Store.pref('intel_w', {}), [k]: Math.max(0, Math.min(100, +v || 0)) }); if (D) C = compute(D); render(); }

  /* ---------- demo (sample numbers, never used live) ---------- */
  function demoData() {
    let s = 5; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const N = [['HDFCBANK', 'Financial Services', 0.006], ['ICICIBANK', 'Financial Services', 0.006], ['SBIN', 'Financial Services', 0.006], ['AXISBANK', 'Financial Services', 0.006], ['BAJFINANCE', 'Financial Services', 0.006], ['MUTHOOTFIN', 'Financial Services', 0.006], ['INFY', 'Information Technology', -0.01], ['TCS', 'Information Technology', -0.01], ['HCLTECH', 'Information Technology', -0.01], ['WIPRO', 'Information Technology', -0.01], ['COFORGE', 'Information Technology', -0.01], ['SUNPHARMA', 'Healthcare', 0.004], ['CIPLA', 'Healthcare', 0.004], ['LUPIN', 'Healthcare', 0.004], ['DRREDDY', 'Healthcare', 0.004], ['MARUTI', 'Automobile and Auto Components', 0.002], ['M&M', 'Automobile and Auto Components', 0.002], ['TATAMOTORS', 'Automobile and Auto Components', 0.002], ['TATASTEEL', 'Metals & Mining', 0.016], ['HINDALCO', 'Metals & Mining', 0.016], ['JSWSTEEL', 'Metals & Mining', 0.016], ['BPCL', 'Oil Gas & Consumable Fuels', 0.003], ['IOC', 'Oil Gas & Consumable Fuels', 0.003], ['ONGC', 'Oil Gas & Consumable Fuels', 0.003], ['RELIANCE', 'Oil Gas & Consumable Fuels', 0.003], ['ITC', 'Fast Moving Consumer Goods', -0.003], ['HINDUNILVR', 'Fast Moving Consumer Goods', -0.003], ['NESTLEIND', 'Fast Moving Consumer Goods', -0.003], ['BEL', 'Capital Goods', 0.009], ['HAL', 'Capital Goods', 0.009], ['NTPC', 'Power', 0.001], ['POWERGRID', 'Power', 0.001], ['DLF', 'Realty', -0.012], ['GODREJPROP', 'Realty', -0.012], ['RBLBANK', 'Financial Services', -0.02], ['IDEA', 'Telecommunication', 0.02], ['BHARTIARTL', 'Telecommunication', 0.002]];
    const q = {}, sec = {}, secMap = {}, walls = {}, fut = {}, days = [];
    let d = new Date(Date.UTC(2026, 9, 14)); while (days.length < 22) { d = new Date(d.getTime() + 864e5); if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10).replace(/-/g, '')); }
    days.forEach((x) => { sec[x] = { date: Brief.d8to10(x), s: {} }; });
    N.forEach(([sym, ind, t], i) => {
      secMap[sym] = ind; let c = 200 + r() * 3000; const vol = 0.008 + r() * 0.02, v0 = 1e6 * (0.3 + r() * 3) * (sym === 'RBLBANK' ? 0.05 : 1);
      days.forEach((x) => { const p = c; c = p * (1 + t * 0.3 + (r() - 0.5) * vol * 2); sec[x].s[sym] = [c, p, p, Math.max(p, c) * (1 + vol * 0.3), Math.min(p, c) * (1 - vol * 0.3), v0 * (0.7 + r() * 0.6), 30 + r() * 30]; });
      const r1 = t + (r() - 0.5) * 0.025, cc = c * (1 + r1);
      q[sym] = { c: cc, pc: c, o: c, h: Math.max(c, cc) * 1.004, l: Math.min(c, cc) * 0.996, v: v0 * (sym === 'TATASTEEL' || sym === 'BEL' ? 2.8 : 0.8 + r() * 1.2), ts: Date.now() };
      const iv = vol * Math.sqrt(252) * (0.9 + r() * 0.8), u = cc, K = Math.round(u / 10) * 10, Ty = 20 / 365, cp = typeof bs === 'function' ? bs(u, K, Ty, iv, 'CE').price : u * 0.03, pp = typeof bs === 'function' ? bs(u, K, Ty, iv, 'PE').price : u * 0.03;
      walls[sym] = { x: '2026-12-29', ce: K * 1.05, pe: K * 0.95, pcr: 0.6 + r() * 0.8, atm: { K, c: cp, p: pp, u } };
      fut[sym] = { oi: 1e7, doi: 1e5, idx: false, near: { x: '2026-12-29', c: u * (1 + (r() - 0.3) * 0.012), u } };
    });
    const nb = 25466; q.NIFTY = { idx: true, c: nb * 1.006, pc: nb, h: nb * 1.008, l: nb * 0.998, ts: Date.now() }; q.BANKNIFTY = { idx: true, c: 57200 * 1.004, pc: 57200, ts: Date.now() }; q.SENSEX = { idx: true, c: 83100 * 1.005, pc: 83100, ts: Date.now() };
    const nd = []; let nc = 24000; for (let i = 0; i < 120; i++) { nc *= 1 + 0.0009 + (r() - 0.5) * 0.012; const dd = new Date(Date.UTC(2026, 5, 1) + i * 864e5).toISOString().slice(0, 10); nd.push([dd, nc, nc * 1.004, nc * 0.996, nc]); }
    nd[nd.length - 1][4] = nb;
    const vd = Array.from({ length: 260 }, (_, i) => ['v' + i, 0, 0, 0, 11 + 6 * r()]);
    return { live: false, E: { q }, H: { sec, fo: { date: '2026-11-18', walls, fut }, sectors: secMap }, ban: { date: '2026-11-19', syms: ['RBLBANK', 'IDEA'] }, res: { items: [{ sym: 'LUPIN', date: Brief.nextWeekday(typeof istYmd === 'function' ? istYmd() : '2026-11-19') }] },
      fii: { fii: -1240, dii: 1875, date: '19-Nov-2026' }, part: { latest: { p: { FII: { futL: 120000, futS: 210000 } } } },
      world: { ts: Date.now(), items: [['gift', 25700, 0.3], ['dowF', 44380, -0.4], ['nasF', 22040, -0.9], ['spxF', 6135, -0.5], ['nikkei', 39880, 0.6], ['hsi', 26050, 0.2], ['brent', 61.4, -1.6], ['wti', 58.2, -1.5], ['gold', 4065, 0.4], ['usdinr', 87.9, 0.05], ['dxy', 98.6, -0.25], ['us10y', 4.21, -0.6], ['usvix', 15.2, 3.1]].map(([id, price, chg]) => ({ id, price, chg, ts: Date.now() })) },
      cal: { items: [{ date: typeof istYmd === 'function' ? istYmd() : '2026-11-19', time: '19:00', t: 'US: FOMC minutes (sample)', imp: 'high' }] }, nd, vd, vix: { v: 13.4, prev: 13.1 }, miss: [], ts: Date.now() };
  }
  return { open, close, show, load, pickSec, sortScr, setW, compute, ivSolve, regimeAt, get data() { return C; } };
})();
if (typeof module !== 'undefined') module.exports = { Intel, EodCache };
