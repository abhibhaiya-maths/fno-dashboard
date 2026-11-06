/* ===== Engine: re-checks every tool on each scan, writes live commentary on changes, projects the next 30 minutes ===== */
const Engine = (() => {
  const prev = {}, feed = [], cool = {};
  let scans = 0, lastScan = 0, started = false, lastTicker = '';
  const SHORT = (n) => n.replace(/\s*\(.*?\)\s*/g, ' ').replace('Price vs ', '').replace('trend strength', '').trim().slice(0, 18);

  function push(k, tone, text, min) {
    feed.unshift({ id: Date.now() + Math.random(), t: ok(min) ? hm(clamp(min, -15, 869)) : '', k, tone, text, fresh: true });
    if (feed.length > 60) feed.length = 60;
  }

  // Next 30 minutes (6 five-minute candles)
  function projection(a) {
    const atr = a.atr || a.price * 0.001, exp30 = atr * Math.sqrt(6);
    const dir = a.dir;
    // the score is a weighted lean, not a probability: map it to a realistic 15–85% band
    const upP = Math.round(clamp(50 + (a.score - 50) * 0.7, 15, 85));
    const p = { up: upP, dn: 100 - upP, dir, exp30, lo: a.price - exp30, hi: a.price + exp30, perCandle: atr };
    if (dir) {
      const st = setupFor(a, dir), d = dir === 'CE' ? 1 : -1;
      Object.assign(p, { entryLo: a.price - (d === 1 ? 0.25 : 0.1) * atr, entryHi: a.price + (d === 1 ? 0.1 : 0.25) * atr, sl: st.sl, t1: st.t1, t2: st.t2, K: st.K, P: st.P, pSL: st.pSL, pT1: st.pT1, block: d === 1 ? a.res : a.sup });
    }
    return p;
  }

  function scan() {
    scans++; lastScan = Date.now();
    if (!started) { started = true; push(null, 'info', `Engine online: watching ${A[cur] ? A[cur].sigs.length : 20} tools across ${KEYS.length} instruments.`, A[cur] ? A[cur].curMin : null); }
    for (const k of KEYS) {
      const a = A[k]; if (!a) continue;
      const s = signalFor(a), g1 = a.fib[3].v, g2 = a.fib[4].v;
      const now = {
        m: a.curMin, state: s.state, strong: a.score >= 70 ? 1 : a.score <= 30 ? -1 : 0, stD: a.stD, vw: a.price >= a.vw ? 1 : -1,
        orb: a.curMin < a.SS.o + 15 ? 0 : a.price > a.ORH ? 1 : a.price < a.ORL ? -1 : 0, rsi: a.rsi > 70 ? 1 : a.rsi < 30 ? -1 : 0,
        pcr: !ok(a.ch.pcr) ? 0 : a.ch.pcr > 1.25 ? 1 : a.ch.pcr < 0.75 ? -1 : prev[k] && Math.abs(a.ch.pcr - 1) > 0.15 ? prev[k].pcr : 0,
        gz: a.price <= Math.max(g1, g2) && a.price >= Math.min(g1, g2) ? 1 : 0,
        cpr: a.price > a.tc ? 1 : a.price < a.bc ? -1 : 0,
        sh: a.short ? a.short.dir || 'WAIT' : null, lg: a.long ? a.long.dir || 'WAIT' : null,
      };
      const p = prev[k], m = a.curMin;
      // Don't repeat the same kind of event: 10-minute cooldown per type (3 minutes for setup changes)
      const fire = (type, tone, text, gap = 10) => { const ck = k + type; if (cool[ck] != null && Math.abs(m - cool[ck]) < gap) return; cool[ck] = m; push(k, tone, text, m); };
      if (p && p.m !== undefined && a.sessionLive !== false) {
        const why = s.reasons && s.reasons.length ? ` ${s.reasons.slice(0, 2).map((x) => SHORT(x.n)).join(' and ')} in favour.` : '';
        if (now.state !== p.state) {
          if (now.state === 'CE') fire('state', 'call', `${s.strength === 'strong' ? 'Strong' : 'Mild'} CALL setup formed. Score ${a.score}.${why}`, 3);
          else if (now.state === 'PE') fire('state', 'put', `${s.strength === 'strong' ? 'Strong' : 'Mild'} PUT setup formed. Score ${a.score}.${why}`, 3);
          else if (p.state !== 'WAIT') fire('state', 'warn', `${p.state === 'CE' ? 'CALL' : 'PUT'} setup ended. No clear direction now (score ${a.score}).`, 3);
        }
        if (now.strong !== p.strong && now.strong) fire('strong', now.strong > 0 ? 'call' : 'put', `Score ${a.score}: ${now.strong > 0 ? 'upside' : 'downside'} bias is now strong.`);
        if (now.stD !== p.stD && ok(now.stD) && ok(p.stD)) fire('st', now.stD > 0 ? 'call' : 'put', `Supertrend flipped ${now.stD > 0 ? 'up (bullish)' : 'down (bearish)'} at ${f0(a.stV)}.`);
        if (now.vw !== p.vw) fire('vw', now.vw > 0 ? 'call' : 'put', `Price crossed ${now.vw > 0 ? 'above' : 'below'} ${a.hasVol ? 'VWAP' : 'TWAP'} (${f0(a.vw)}).`);
        if (now.orb !== p.orb && now.orb) fire('orb', now.orb > 0 ? 'call' : 'put', now.orb > 0 ? `Opening-range high ${f0(a.ORH)} broken (breakout).` : `Opening-range low ${f0(a.ORL)} broken (breakdown).`);
        if (now.cpr !== p.cpr && now.cpr) fire('cpr', now.cpr > 0 ? 'call' : 'put', `Price moved ${now.cpr > 0 ? 'above' : 'below'} the CPR.`);
        if (now.rsi !== p.rsi && now.rsi) fire('rsi', 'warn', `RSI ${f1(a.rsi)}: ${now.rsi > 0 ? 'overbought, the rally may tire' : 'oversold, the fall may pause'}.`);
        if (now.pcr !== p.pcr && now.pcr) fire('pcr', now.pcr > 0 ? 'call' : 'put', `PCR ${f2(a.ch.pcr)}: ${now.pcr > 0 ? 'heavy put writing, support is firm' : 'heavy call writing, pressure overhead'}.`);
        // 1-minute engine: the earliest warning (3-minute cooldown)
        if (now.sh && p.sh && now.sh !== p.sh) {
          const sh = a.short, nm = (x) => (x === 'CE' ? (a.cf.opt ? 'CALL' : 'up') : a.cf.opt ? 'PUT' : 'down');
          if (now.sh !== 'WAIT') fire('sh', now.sh === 'CE' ? 'call' : 'put', `1-minute turned ${nm(now.sh)} (short score ${sh.score}${sh.reasons[0] ? ', ' + SHORT(sh.reasons[0].n) : ''}).${s.state !== 'WAIT' && s.state !== now.sh ? ` Against the intraday ${nm(s.state)} setup: likely a ${now.sh === 'CE' ? 'bounce' : 'pullback'}.` : ''}`, 3);
          else fire('sh', 'warn', `1-minute momentum faded (short score ${sh.score}).`, 3);
        }
        if (now.lg && p.lg && now.lg !== p.lg && now.lg !== 'WAIT') fire('lg', now.lg === 'CE' ? 'call' : 'put', `Daily trend now ${now.lg === 'CE' ? 'bullish' : 'bearish'} (long-run score ${a.long.score}).`, 60);
        if (now.gz && !p.gz) fire('gz', 'info', `Price entered the Fibonacci golden zone (${f0(Math.min(g1, g2))}–${f0(Math.max(g1, g2))}). Watch for a bounce or a break.`);
      }
      prev[k] = now;
    }
  }

  function renderFeed() {
    const box = $('feed'); if (!box) return;
    if (!feed.length) { box.innerHTML = '<div class="feed-empty">Nothing has changed yet. When any tool flips, it shows up here.</div>'; return; }
    box.innerHTML = feed.slice(0, 40).map((e) => `<div class="fd-item ${e.tone}${e.fresh ? ' fresh' : ''}"><span class="fd-time">${e.t}</span><span>${e.k ? `<span class="fd-idx">${esc(CFG[e.k] ? CFG[e.k].label : e.k)}</span>` : ''}${esc(e.text)}</span></div>`).join('');
    feed.forEach((e) => (e.fresh = false));
  }

  function renderStatus() {
    const a = A[cur]; if (!a) return;
    const ago = lastScan ? Math.max(0, Math.round((Date.now() - lastScan) / 1000)) : 0;
    const S = Source.stream;
    const feed = S ? (S.connected ? `<b>LIVE STREAM</b> tick lag ${S.lag == null ? '–' : Math.max(0, S.lag) + ' ms'}, ${S.ticks} ticks` : S.everConnected ? '<b>RECONNECTING</b> polling every 5 s meanwhile' : '<b>POLLING</b> every 5 s') : '<b>DEMO FEED</b>';
    const agoTxt = Date.now() - lastScan < 1500 ? 'just now' : `${ago}s ago`;
    $('engTxt').innerHTML = `${feed}. Engine: ${a.active} of ${a.sigs.length} tools live × ${KEYS.length} instruments, last scan ${agoTxt} (#${scans})`;
    $('engTools').innerHTML = a.sigs.filter((x) => x.w > 0).map((x) => `<span class="tool ${x.s > 0 ? 'b' : x.s < 0 ? 's' : ''}">${esc(SHORT(x.n))}</span>`).join('');
  }

  function renderProjection() {
    const a = A[cur]; if (!a) return;
    const p = projection(a), dirTxt = p.dir === 'CE' ? 'Upside bias' : p.dir === 'PE' ? 'Downside bias' : 'No clear direction';
    let h = `<div class="pj-h"><b>Next 30-minute projection</b><span>${dirTxt}</span></div>
      <div class="pj-nums"><div class="u"><strong>${p.up}%</strong>Upside</div><div class="d"><strong>${p.dn}%</strong>Downside</div></div>
      <div class="pj-bar" role="img" aria-label="Upside ${p.up}%, downside ${p.dn}%"><span class="u" style="width:${p.up}%"></span><span class="d" style="width:${p.dn}%"></span></div>`;
    if (p.dir) {
      h += `<div class="pj-grid">
        <div><small>${a.cf.opt ? (p.dir === 'CE' ? 'CALL' : 'PUT') : p.dir === 'CE' ? 'Long' : 'Short'} entry zone</small><b>${f0(p.entryLo)}–${f0(p.entryHi)}</b></div>
        <div><small>Stop-loss (${a.isIdx ? 'index' : 'price'})</small><b class="down">${f0(p.sl)}</b></div>
        <div><small>Target 1 / 2</small><b class="up">${f0(p.t1)} / ${f0(p.t2)}</b></div>
        ${a.cf.opt ? `<div><small>Strike</small><b>${p.K} ${p.dir}</b></div>
        <div><small>Premium / SL / target</small><b>${f1(p.P)} / <span class="down">${f1(p.pSL)}</span> / <span class="up">${f1(p.pT1)}</span></b></div>` : `<div><small>Instrument</small><b>${esc(a.cf.label)}</b></div><div><small>Options</small><b>Not available</b></div>`}
        <div><small>First obstacle</small><b>${p.block ? f0(p.block[1]) : '–'}</b></div></div>
        <div class="pj-note">${p.block ? `First obstacle: ${esc(p.block[0])} at ${f0(p.block[1])}. ` : ''}Expected 30-minute range ${f0(p.lo)} to ${f0(p.hi)} (±${f0(p.exp30)} pts). The setup stays valid until the signal changes or the stop-loss breaks.</div>`;
    } else {
      h += `<div class="pj-grid">
        <div><small>Expected range</small><b>${f0(p.lo)}–${f0(p.hi)}</b></div>
        <div><small>Resistance above</small><b class="down">${a.res ? f0(a.res[1]) : '–'}</b></div>
        <div><small>Support below</small><b class="up">${a.sup ? f0(a.sup[1]) : '–'}</b></div></div>
        <div class="pj-note">Signals are split, so trading inside the range is best avoided. ${a.res ? `Holding above ${f0(a.res[1])} can build an upside setup; ` : ''}${a.sup ? `breaking below ${f0(a.sup[1])} can build a downside one.` : ''}</div>`;
    }
    h += `<div class="pj-note">The percentage is the weighted lean of ${a.active} tools, not a guaranteed probability. How often it is right shows up in the signal record.${a.sessionLive ? '' : ' Market is closed; this uses the last session.'}</div>`;
    $('proj').innerHTML = h;
  }

  function renderTicker() {
    const a = A[cur]; if (!a) return;
    const R = Source.results ? Source.results().items : [];
    const items = [...a.news.slice(0, 10).map((n) => ({ t: n.t, s: n.s, link: n.link })), ...R.slice(0, 6).map((n) => ({ co: n.co, t: n.t, s: n.s, link: n.link }))];
    const key = cur + JSON.stringify(items.map((x) => x.t));
    if (key === lastTicker) return; lastTicker = key;
    if (!items.length) { $('ntTrack').innerHTML = '<span class="nt-item mut">Loading news. If this stays empty, deploy the latest Worker code.</span>'; $('ntTrack').style.setProperty('--dur', '0s'); return; }
    const one = items.map((x) => { const c = x.s > 0.15 ? 'b' : x.s < -0.15 ? 's' : 'n'; return `<span class="nt-item"><i class="${c}"></i>${x.co ? `<span class="co">${esc(x.co)}</span>` : ''}${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.t)}</a>` : esc(x.t)}</span>`; }).join('');
    $('ntTrack').innerHTML = one + one;
    $('ntTrack').style.setProperty('--dur', Math.max(40, items.length * 9) + 's');
  }

  setInterval(() => { if (A[cur]) renderStatus(); }, 1000);
  return { scan, projection, renderFeed, renderStatus, renderProjection, renderTicker };
})();
