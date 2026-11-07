/* ===== स्क्रीन पर दिखाना: टिकर, सिग्नल ग्लोब, चार्ट, टैब, स्कोर, लेवल, ख़बरें ===== */
const COL = {
  call: '#00F5A0', put: '#FF3B6B', wait: '#8FA3BF', brass: '#FFB547', text: '#E6F1FF', muted: '#7F93B2', dim: '#4A5B78', cyan: '#00E5FF', violet: '#8B6CFF',
  grid: 'rgba(0,229,255,.07)', line: 'rgba(0,229,255,.16)', vwap: '#00E5FF', ema20: '#B69CFF', ema50: '#FF7AE0', bb: '#5B7BA6', cpr: '#4DA3FF', orb: '#E6F1FF', panel: 'rgba(6,12,22,.9)',
};
const FONT = '600 12px Rajdhani, system-ui, sans-serif';
let lastActiveTk = null, sub = 'rsi', tab = 'chain', tf = 5, CI = null, newsTab = 'all', newsMore = false, lastOrb = null;
const OV = Store.pref('overlays', { vwap: true, ema20: true, ema50: false, bb: false, st: true, fib: true, cpr: true, piv: false, orb: false, vp: false });
const OVL = { vwap: 'VWAP', ema20: 'EMA 20', ema50: 'EMA 50', bb: 'Bollinger', st: 'Supertrend', fib: 'Fibonacci', cpr: 'CPR', piv: 'Pivots', orb: 'Opening range', vp: 'Volume profile' };
const OVC = { vwap: COL.vwap, ema20: COL.ema20, ema50: COL.ema50, bb: COL.bb, st: COL.call, fib: COL.brass, cpr: COL.cpr, piv: COL.muted, orb: COL.text, vp: COL.vwap };
const VIEW = { 1: 90, 5: 75, 15: 50, 60: 21 }, TFL = { 1: '1m', 5: '5m', 15: '15m', 60: '1h' };
const FIB_KEY = [0.382, 0.5, 0.618];
const ALL_HV = ['HDFC Bank', 'ICICI Bank', 'Reliance', 'Infosys', 'Bharti Airtel', 'L&T', 'ITC', 'TCS', 'SBI', 'Kotak', 'Axis Bank', 'IndusInd', 'Federal Bank', 'AU Bank'];

function dirOf(a) { const s = signalFor(a); return s.state === 'CE' ? 'ce' : s.state === 'PE' ? 'pe' : 'wait'; }
const DIRTXT = { ce: 'CALL', pe: 'PUT', wait: 'WAIT' };
const dirTxt = (a, d) => (a && !a.cf.opt && d !== 'wait' ? (d === 'ce' ? 'BULL' : 'BEAR') : DIRTXT[d]);
const KIND = { INDEX: 'Index', EQ: 'Stock', FUT: 'Futures' };

function sparkSVG(a) {
  const pts = a.I5.k.filter((x) => x.d === 2).map((x) => x.c);
  if (pts.length < 2) return '';
  const W = 120, H = 34, mn = Math.min(...pts, a.PC), mx = Math.max(...pts, a.PC), r = mx - mn || 1;
  const X = (i) => (i / (pts.length - 1)) * W, Y = (v) => 2 + (1 - (v - mn) / r) * (H - 4);
  const col = a.price >= a.PC ? COL.call : COL.put;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${W}" y1="${Y(a.PC).toFixed(1)}" y2="${Y(a.PC).toFixed(1)}" stroke="${COL.dim}" stroke-dasharray="2 3" stroke-width="1"/>
    <polyline fill="none" stroke="${col}" stroke-width="1.6" points="${pts.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/></svg>`;
}
function renderTickers() {
  $('tickers').innerHTML = KEYS.map((k) => {
    const a = A[k], cf = CFG[k];
    const rm = cf.core ? '' : `<button class="tk-x" onclick="removeWatch('${k}', event)" aria-label="Remove ${esc(cf.label)} from watchlist" title="Remove">✕</button>`;
    const tag = cf.core ? '' : `<span class="tk-tag">${KIND[cf.kind] || ''}${cf.opt ? ' · F&O' : ''}</span>`;
    if (!a) return `<div class="tk-wrap"><button class="tk ${k === cur ? 'active' : ''}" onclick="pick('${k}')"><div><div class="tk-name">${esc(cf.label)}${tag}</div><div class="tk-px mut">Loading</div></div></button>${rm}</div>`;
    const d = dirOf(a);
    return `<div class="tk-wrap"><button class="tk ${k === cur ? 'active' : ''}" onclick="pick('${k}')" aria-pressed="${k === cur}">
      <div><div class="tk-name">${esc(a.cf.label)}${tag}</div><div class="tk-px">${f2(a.price)}</div>
      <div class="tk-chg ${a.chg >= 0 ? 'up' : 'down'}">${a.chg >= 0 ? '▲' : '▼'} ${f2(Math.abs(a.price - a.PC))} (${f2(a.chg)}%)</div></div>
      <div class="tk-right"><span class="dirchip ${d}">${dirTxt(a, d)} ${a.score}</span>${sparkSVG(a)}</div></button>${rm}</div>`;
  }).join('') + `<button class="tk-add" onclick="openSearch()" aria-label="Add a stock, index or MCX future"><span>+</span>Add stock / MCX</button>`;
  if (lastActiveTk !== cur) { lastActiveTk = cur; const el = document.querySelector('.tk.active'); if (el && el.parentElement.scrollIntoView) el.parentElement.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  $('clock').textContent = Source.clock().label;
  $('clock').classList.toggle('open', !!(A[cur] && A[cur].sessionLive));
}

/* सिग्नल ग्लोब: कॉल पर हरा, पुट पर लाल, बाक़ी समय शांत */
function renderOrb() {
  const a = A[cur], o = $('orb'); if (!a) return;
  const d = dirOf(a);
  o.classList.remove('ce', 'pe', 'wait'); o.classList.add(d);
  $('orbDir').textContent = dirTxt(a, d);
  $('orbSub').textContent = `${a.cf.label}  ${a.score}/100`;
  o.setAttribute('aria-label', `${a.cf.label}: ${dirTxt(a, d)}, score ${a.score}`);
  const key = cur + d;
  if (lastOrb && lastOrb !== key) { o.classList.remove('pop'); void o.offsetWidth; o.classList.add('pop'); }
  lastOrb = key;
}
function orbClick() { $('signalPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function openAsk() { $('askPanel').classList.add('open'); }
function closeAsk() { $('askPanel').classList.remove('open'); }

function renderControls() {
  const a = A[cur]; if (!a) return;
  $('tfBtns').innerHTML = [1, 5, 15, 60].map((t) => `<button class="btn ${t === tf ? 'on' : ''}" onclick="setTF(${t})">${TFL[t]}</button>`).join('');
  $('ovChips').innerHTML = Object.keys(OV).map((k) => `<button class="chip ${OV[k] ? 'on' : ''}" onclick="togOV('${k}')" aria-pressed="${OV[k]}"><span class="sw" style="background:${OVC[k]}"></span>${k === 'vwap' && !a.hasVol ? 'TWAP' : k === 'vp' && !a.hasVol ? 'TPO profile' : OVL[k]}</button>`).join('');
  $('subBtns').innerHTML = [['rsi', 'RSI'], ['macd', 'MACD'], ['adx', 'ADX']].map(([k, l]) => `<button class="btn ${k === sub ? 'on' : ''}" onclick="setSub('${k}')">${l}</button>`).join('');
  $('chartTitle').textContent = `${a.cf.label} · ${TFL[tf]} chart`;
  $('tabs').innerHTML = [['chain', a.cf.opt ? 'Option chain' : 'Futures & volatility'], ['mood', 'Market mood'], ['struct', 'Structure & OI'], ['sig', `All ${a.intra.sigs.length + (a.short ? a.short.sigs.length : 0) + (a.long ? a.long.sigs.length : 0)} signals`]].map(([k, l]) => `<button class="btn ${k === tab ? 'on' : ''}" onclick="setTab('${k}')">${l}</button>`).join('');
  $('newsTabs').innerHTML = [['all', 'All'], ['official', 'Official'], ['market', a.cf.core ? 'Market' : a.cf.label], ['results', 'Results'], ['watch', 'Watchlist']].map(([k, l]) => `<button class="${k === newsTab ? 'on' : ''}" onclick="setNewsTab('${k}')" aria-pressed="${k === newsTab}">${esc(l)}</button>`).join('');
  const cf = a.cf;
  $('qchips').innerHTML = (cf.opt ? [`Should I buy ${cf.label} ${a.ch.atm} CE?`, `Should I buy ${cf.label} ${a.ch.atm} PE?`] : [`Is ${cf.label} bullish or bearish now?`, `Where is the stop-loss for ${cf.label}?`]).concat([`How far did ${cf.label} move today?`, 'Hold or exit my position?'])
    .map((t) => `<button class="chip" onclick="$('q').value='${t}';Voice.ask()">${t}</button>`).join('');
}

/* स्कोर: आधा-गोल मीटर */
function gaugeSVG(s) {
  const cx = 85, cy = 88, r = 70, P = (v) => { const t = Math.PI * (1 - v / 100); return [cx + r * Math.cos(t), cy - r * Math.sin(t)]; };
  const arc = (a, b, c) => { const [x1, y1] = P(a), [x2, y2] = P(b); return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${c}" stroke-width="10" fill="none" stroke-linecap="butt"/>`; };
  const t = Math.PI * (1 - s / 100), nx = cx + (r - 18) * Math.cos(t), ny = cy - (r - 18) * Math.sin(t);
  const ticks = [42, 58].map((v) => { const t2 = Math.PI * (1 - v / 100); return `<line x1="${(cx + (r - 9) * Math.cos(t2)).toFixed(1)}" y1="${(cy - (r - 9) * Math.sin(t2)).toFixed(1)}" x2="${(cx + (r + 9) * Math.cos(t2)).toFixed(1)}" y2="${(cy - (r + 9) * Math.sin(t2)).toFixed(1)}" stroke="#0A1220" stroke-width="2"/>`; }).join('');
  return `<svg viewBox="0 0 170 100" role="img" aria-label="Score ${s}">
    ${arc(0, 42, COL.put)}${arc(42, 58, COL.wait)}${arc(58, 100, COL.call)}${ticks}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${COL.text}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="5" fill="${COL.text}"/>
    <text x="8" y="99" fill="${COL.muted}" font-size="10" font-family="Rajdhani, sans-serif">PUT</text>
    <text x="162" y="99" fill="${COL.muted}" font-size="10" text-anchor="end" font-family="Rajdhani, sans-serif">CALL</text></svg>`;
}
/* ---------- Three horizons: Short (1m) | Intraday (5m) | Long run (daily) ---------- */
function hzCard(a, key, title, sub, h, horizon) {
  const sel = HZ === key, on = `role="button" tabindex="0" aria-pressed="${sel}" onclick="setHz('${key}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setHz('${key}')}"`;
  if (!h) return `<div class="hz-c na${sel ? ' sel' : ''}" ${on}><div class="hz-t">${title}<small>${sub}</small></div><div class="hz-d">–</div><div class="hz-r mut">${key === 'long' ? 'Daily history loading' : 'Needs more candles'}</div></div>`;
  const d = h.dir === 'CE' ? 'ce' : h.dir === 'PE' ? 'pe' : 'wait';
  const why = h.dir ? (h.reasons[0] ? h.reasons.slice(0, 2).map((x) => x.n.replace(/\s*\(.*?\)/, '')).join(', ') : '') : (h.gate || 'Mixed signals');
  return `<div class="hz-c ${d}${sel ? ' sel' : ''}" ${on} title="Use the ${title} engine for signals"><div class="hz-t">${title}<small>${sub}</small></div>
    <div class="hz-d">${dirTxt(a, d)}${h.strength === 'strong' ? '<span class="hz-s">strong</span>' : ''}</div>
    <div class="hz-bar"><i style="width:${h.score}%"></i></div>
    <div class="hz-n"><span>${h.score}</span><span>${h.dir === 'PE' ? h.dn : h.dir === 'CE' ? h.up : Math.max(h.up, h.dn)}/${h.coreN} core</span></div>
    <div class="hz-r">${esc(why)}</div><div class="hz-h">${esc(horizon)}</div></div>`;
}
function hzVerdict(a) {
  const S = a.short && a.short.dir, I = a.intra.dir, L = a.long && a.long.dir, nm = (x) => (x === 'CE' ? (a.cf.opt ? 'CALL' : 'up') : a.cf.opt ? 'PUT' : 'down');
  if (S && I && L && S === I && I === L) return ['al', `All three horizons point ${nm(I)}: the highest-conviction setup.`];
  if (S && I && S === I) return ['ok', `Short and intraday agree on ${nm(I)}.${L && L !== I ? ` The daily trend is the other way: trade small and book quickly.` : ''}`];
  if (I && S && S !== I && a.stx && a.stx.state === 'pullback' && a.stx.trend === (I === 'CE' ? 1 : -1)) return ['wr', `Short-term ${S === 'CE' ? 'bounce' : 'pullback'} against the intraday ${nm(I)} trend, but the 5-minute structure calls it a pullback (nothing broken). Not a reversal unless ${f0(a.stx.prot)} breaks on a 5-minute close.`];
  if (I && S && S !== I && a.stx && a.stx.state === 'noise' && a.stx.trend === (I === 'CE' ? 1 : -1)) return ['n', `The 1-minute leans ${nm(S)}, but on the 5-minute this is only noise (${f0(a.stx.pull)} pts, no swing broken). The intraday ${nm(I)} trend stands.`];
  if (I && S && S !== I) return ['wr', `Short-term ${S === 'CE' ? 'bounce' : 'pullback'} against the intraday ${nm(I)} trend. For a fresh entry, wait for the 1-minute to turn back to ${nm(I)}. If you already hold ${nm(S === 'CE' ? 'PE' : 'CE')}, tighten the stop.`];
  if (!I && S) return ['wr', `Only the 1-minute shows ${nm(S)} so far. It is the earliest warning, not yet a trend; watch whether intraday follows.`];
  if (I && !S) return ['n', `Intraday ${nm(I)}, but the last few minutes are flat. Better entries come when the 1-minute confirms.`];
  return ['n', 'No horizon has a clear direction. Waiting is a position too.'];
}
function renderHorizons() {
  const a = A[cur], box = $('hz'); if (!box) return;
  const I = a.intra, ip = I.sigs.filter((x) => x.w > 0 && x.s * (I.dir === 'CE' ? 1 : -1) > 0).sort((x, y) => y.w - x.w);
  const intra = { score: I.score, dir: I.dir, gate: I.gate, strength: I.dir ? (a.hz === 'intra' ? signalFor(a).strength : null) : null, up: I.coreUp, dn: I.coreDn, coreN: I.coreN, reasons: I.dir ? ip.slice(0, 3) : [] };
  const v = hzVerdict(a), info = HZ_INFO[a.hz];
  const fb = a.hzWanted !== a.hz ? ` (${HZ_INFO[a.hzWanted].name} needs more data, so Intraday is used for now)` : '';
  box.innerHTML = `<div class="hz-basis">Signal below is based on: <b>${info.name}</b>, ${info.tf} candles, ${info.horizon}${fb}. <span class="mut">Tap a card to switch.</span></div><div class="hz-row">${hzCard(a, 'short', 'Short', '1-minute', a.short, 'Next 5–15 min')}${hzCard(a, 'intra', 'Intraday', '5-minute', intra, 'Next 30–90 min')}${hzCard(a, 'long', 'Long run', 'daily', a.long, 'Next 3–10 sessions')}</div><div class="hz-v ${v[0]}">${esc(v[1])}</div>`;
}
function renderSigTab(a) {
  const lb = { 1: ['b', 'Bullish'], 0: ['n', 'Neutral'], '-1': ['s', 'Bearish'] };
  const L = (x) => (x.w ? lb[x.s > 0.2 ? 1 : x.s < -0.2 ? -1 : 0] : ['n', 'Not counted']);
  const table = (sigs) => { let g = ''; return `<div class="tbl"><table><thead><tr><th class="l">Signal</th><th>Value</th><th>Direction</th><th>Weight</th></tr></thead><tbody>` +
    sigs.map((x) => { const r = x.g !== g ? `<tr><td colspan="4" class="l mut" style="padding-top:12px">${esc(x.g)}${x.t === 'c' ? ' (context, max 25% of score)' : ''}</td></tr>` : ''; g = x.g; const l = L(x);
      return r + `<tr><td class="l">${esc(x.n)}</td><td>${esc(x.v)}</td><td><span class="pill ${l[0]}">${l[1]}</span></td><td>${x.w}</td></tr>`; }).join('') + '</tbody></table></div>'; };
  let h = `<div class="sec">Intraday engine, 5-minute (score ${a.intra.score}: price action ${a.intra.paScore ?? '–'}, context ${a.intra.cxScore ?? '–'})</div>` + table(a.intra.sigs);
  if (a.short) h += `<div class="sec" style="margin-top:16px">Short-term engine, 1-minute (score ${a.short.score})</div>` + table(a.short.sigs);
  if (a.long) h += `<div class="sec" style="margin-top:16px">Long-run engine, daily (score ${a.long.score}, ${a.long.days} days of history)</div>` + table(a.long.sigs);
  h += `<div class="legend">Each engine: score = 50 + 50 × (Σ weight × direction) ÷ Σ weight. A direction needs 60% of that engine's core trend tools on its side. Intraday weighs price action 75% and context 25%. IV percentile and event risk don't move scores; they downgrade setups to "mild".</div>`;
  $('tabBody').innerHTML = h;
}
function renderScore() {
  const a = A[cur], s = a.score;
  $('gauge').innerHTML = gaugeSVG(s);
  $('score').textContent = s; $('score').className = 'score ' + (s >= 58 ? 'up' : s <= 42 ? 'down' : '');
  $('verdict').textContent = s >= 65 ? 'Most signals lean CALL' : s >= 58 ? 'Signals lean mildly CALL' : s <= 35 ? 'Most signals lean PUT' : s <= 42 ? 'Signals lean mildly PUT' : 'Mixed signals';
  $('scoreSub').textContent = `${HZ_INFO[a.hz].name} engine (${HZ_INFO[a.hz].tf}): ${a.active} live signals, re-checked on every tick`;
  const act = a.sigs.filter((x) => x.w > 0), b = act.filter((x) => x.s > 0).length, n = act.filter((x) => x.s === 0).length, d = act.filter((x) => x.s < 0).length;
  $('counts').innerHTML = `<div class="up"><b>${b}</b>Bullish</div><div><b>${n}</b>Neutral</div><div class="down"><b>${d}</b>Bearish</div>`;
}
function renderSetup() {
  const a = A[cur], s = a.score, dir = a.dir; let h = '';
  if (!dir) h += `<div class="dirbox n">No clear setup right now<br><small>${a.gate ? esc(a.gate) : `Score ${s}. Waiting is a position too.`}</small></div>`;
  else {
    const t = setupFor(a, dir);
    h += `<div class="dirbox ${dir === 'CE' ? 'b' : 's'}">${a.cf.opt ? `${dir === 'CE' ? 'CALL' : 'PUT'} bias, ${t.K} ${dir}` : `${dir === 'CE' ? 'Bullish (long)' : 'Bearish (short)'} bias`}</div>
      <div class="sec">${a.isIdx ? 'Index' : a.isMCX ? 'Futures' : 'Stock'} levels</div><div class="lv"><div><small>Entry</small><b>${f0(t.e)}</b></div><div><small>Stop-loss</small><b class="down">${f0(t.sl)}</b></div><div><small>Target 1 / 2</small><b class="up">${f0(t.t1)} / ${f0(t.t2)}</b></div></div>
      ${a.cf.opt ? `<div class="sec">Option premium</div><div class="lv"><div><small>Premium</small><b>${rs(t.P)}</b></div><div><small>Premium SL</small><b class="down">${rs(t.pSL)}</b></div><div><small>Premium T1</small><b class="up">${rs(t.pT1)}</b></div></div>` : ''}
      <div class="row"><span>Risk : reward</span><b>1 : 1.5 and 1 : 2.5</b></div><div class="row"><span>Stop-loss basis</span><span>1.5 × ATR (5m) = ${f0(t.risk)} pts</span></div>`;
  }
  h += alertsFor(a, dir).map(([c, t]) => `<div class="alert ${c === 'd' ? 'd' : c === 'i' ? 'i' : ''}">${t}</div>`).join('');
  $('setup').innerHTML = h;
}
function lrow(n, v, a, key) { const near = Math.abs(v - a.price) < a.atr * 0.5; return `<div class="row"><span class="${key ? 'lvl-key' : ''}">${n}</span><b class="${near ? 'cur' : v > a.price ? 'down' : 'up'}">${f1(v)}${near ? ' ◀ near' : ''}</b></div>`; }
function renderLevels() {
  const a = A[cur];
  let h = `<div class="row"><span>Current price</span><b class="cur">${f1(a.price)}</b></div><div class="row"><span>ATR (14, 5m)</span><b>${f1(a.atr)}</b></div>`;
  if (a.pb && a.pb.state !== 'trend') {
    const pb = a.pb, up = pb.trend === 'CE';
    h += `<div class="sec">${pb.state === 'failed' ? 'Pullback failed' : `Pullback in ${up ? 'uptrend' : 'downtrend'}`}: ${Math.round(pb.retr * 100)}% retraced</div>` +
      lrow(`Last ${up ? 'high' : 'low'} (100%)`, pb.ext, a) + lrow('Buy-the-dip zone top (38.2%)'.replace('Buy-the-dip', up ? 'Buy-the-dip' : 'Sell-the-rally'), pb.z382, a) + lrow('Golden zone (61.8%)', pb.z618, a) + lrow('Reversal line (78.6%)', pb.z786, a) + lrow(`Leg start (${up ? 'low' : 'high'})`, pb.base, a);
  }
  if (a.vol && ok(a.vol.hi52)) h += '<div class="sec">Bigger picture, daily candles</div>' + lrow('52-week high', a.vol.hi52, a) + (ok(a.vol.pwH) ? lrow('Previous week high', a.vol.pwH, a) + lrow('Previous week low', a.vol.pwL, a) : '') + lrow('52-week low', a.vol.lo52, a);
  h += '<div class="sec">Pivots and CPR, from previous session</div>';
  ['R3', 'R2', 'R1'].forEach((k) => (h += lrow(k, a.piv[k], a)));
  h += lrow('CPR TC', a.tc, a) + lrow('Pivot P', a.p, a, true) + lrow('CPR BC', a.bc, a);
  ['S1', 'S2', 'S3'].forEach((k) => (h += lrow(k, a.piv[k], a)));
  h += `<div class="sec">Fibonacci retracement, today's ${a.upSwing ? 'low → high' : 'high → low'}</div>`;
  a.fib.forEach((f) => (h += lrow(`${(f.r * 100).toFixed(1)}%${f.r === 0.5 || f.r === 0.618 ? ' (golden zone)' : ''}`, f.v, a, FIB_KEY.includes(f.r))));
  h += `<div class="legend">Levels marked ● (38.2%, 50%, 61.8%) matter most.</div>`;
  h += `<div class="sec">Opening range and ${a.hasVol ? 'volume' : 'TPO'} profile</div>` + lrow('Opening high (15m)', a.ORH, a) + lrow('Opening low (15m)', a.ORL, a) + lrow('VAH', a.VP.VAH, a) + lrow('POC', a.VP.POC, a, true) + lrow('VAL', a.VP.VAL, a);
  $('levels').innerHTML = h;
}
// Futures OI buildup + volatility regime (pro tools shared by the chain tab and no-options instruments)
function futVolHTML(a) {
  const F = a.fut, V = a.vol || {}, pill = (x) => (x ? `<span class="pill ${x[1] > 0 ? 'b' : 's'}">${x[0]}</span>` : '<span class="pill n">Flat</span>');
  let h = '<div class="sec" style="margin-top:14px">Futures open interest</div>';
  h += F ? `<div class="stats" style="margin-top:6px"><div><small>Last 30 minutes</small>${pill(F.m30)}<br><small>OI ${ok(F.d30) ? sgn(F.d30) + f2(F.d30) + '%' : '–'}</small></div>
      <div><small>Since yesterday</small>${pill(F.day)}<br><small>OI ${ok(F.doi) ? sgn(F.doi) + f1(F.doi) + '%' : '–'}</small></div>
      <div><small>Futures price${F.expiry ? ', ' + esc(F.expiry) : ''}</small><b>${f1(F.px)}</b><br><small>${a.isMCX ? 'This is the traded contract' : `basis ${sgn(F.basis)}${f1(F.basis)} vs spot`}</small></div></div>
      <div class="legend">Price up + OI up = long buildup (bullish). Price down + OI up = short buildup (bearish). Price up + OI down = short covering. Price down + OI down = long unwinding.</div>`
    : `<div class="mut">${a.isIdx || a.cf.opt || a.isMCX ? 'Futures data loads with the next minute refresh.' : 'This stock has no futures contract.'}</div>`;
  h += '<div class="sec" style="margin-top:14px">Volatility regime</div><div class="stats" style="margin-top:6px">';
  if (ok(V.ivp)) h += `<div><small>IV percentile (${esc(V.src)})</small><b class="${V.ivp >= 80 ? 'down' : V.ivp <= 20 ? 'up' : ''}">${V.ivp}</b><br><small>${V.ivp >= 80 ? 'Options expensive' : V.ivp <= 20 ? 'Options cheap' : 'Normal range'}</small></div><div><small>IV rank</small><b>${V.ivr}</b></div>`;
  if (a.cf.opt && a.ch.rows.length) h += `<div><small>ATM IV</small><b>${f1(a.ch.atmIV * 100)}%</b></div>`;
  h += `<div><small>Realised vol (20 day)</small><b>${ok(V.hv20) ? f1(V.hv20 * 100) + '%' : '–'}</b></div>`;
  if (ok(V.ivhv)) h += `<div><small>ATM IV ÷ realised vol</small><b class="${V.ivhv > 1.4 ? 'down' : V.ivhv < 0.8 ? 'up' : ''}">${f2(V.ivhv)}×</b><br><small>${V.ivhv > 1.4 ? 'Premiums rich' : V.ivhv < 0.8 ? 'Premiums cheap' : 'Fair'}</small></div>`;
  return h + '</div>';
}
function renderTab() {
  const a = A[cur], ch = a.ch; let h = '';
  if (tab === 'sig') return renderSigTab(a);
  if (tab === 'struct') return renderStructTab(a);
  if (tab === 'chain') {
    if (!a.cf.opt) { $('tabBody').innerHTML = `<div class="mut">${esc(a.cf.label)} ${a.isMCX ? 'is an MCX futures contract. Upstox does not provide an MCX option chain' : 'has no options on NSE/BSE'}, so this tab shows futures and volatility tools instead.</div>` + futVolHTML(a); return; }
    if (!ch.rows.length) { $('tabBody').innerHTML = '<div class="mut">No option chain data yet. It refreshes every 15–30 seconds.</div>' + futVolHTML(a); return; }
    const L = (v) => f1(v / 1e5), mxOI = Math.max(...ch.view.map((r) => Math.max(r.ce.oi, r.pe.oi))) || 1;
    const bar = (v, c) => `<span class="oibar" style="width:${Math.round((v / mxOI) * 46)}px;background:${c}"></span>`;
    h = `<div class="tbl"><table><thead><tr><th>CE OI (L)</th><th>OI chg</th><th>IV</th><th>Delta</th><th>CE LTP</th><th class="k">Strike</th><th class="l">PE LTP</th><th class="l">Delta</th><th class="l">IV</th><th class="l">OI chg</th><th class="l">PE OI (L)</th></tr></thead><tbody>` +
      ch.view.map((r) => {
        const ci = r.K < a.price ? 'itm' : '', pi = r.K > a.price ? 'itm' : '', cc = r.ce.oi - (r.ce.poi || r.ce.oi), pc = r.pe.oi - (r.pe.poi || r.pe.oi);
        return `<tr class="${r.K === ch.atm ? 'atm' : ''}"><td class="${ci}">${bar(r.ce.oi, COL.put)}${L(r.ce.oi)}</td><td class="${ci} ${cc >= 0 ? 'up' : 'down'}">${sgn(cc)}${L(cc)}</td><td class="${ci}">${f1(r.ce.iv * 100)}</td><td class="${ci}">${f2(r.ce.de)}</td><td class="${ci}">${f2(r.ce.ltp)}</td>
        <td class="k">${r.K}</td><td class="l ${pi}">${f2(r.pe.ltp)}</td><td class="l ${pi}">${f2(r.pe.de)}</td><td class="l ${pi}">${f1(r.pe.iv * 100)}</td><td class="l ${pi} ${pc >= 0 ? 'up' : 'down'}">${sgn(pc)}${L(pc)}</td><td class="l ${pi}">${L(r.pe.oi)} ${bar(r.pe.oi, COL.call)}</td></tr>`;
      }).join('') + `</tbody></table></div>
      <div class="stats"><div><small>PCR (OI)</small><b>${f2(ch.pcr)}</b></div><div><small>Max pain</small><b>${f0(ch.mp)}</b></div><div><small>ATM IV</small><b>${f1(ch.atmIV * 100)}%</b></div>
      <div><small>ATM straddle</small><b>${rs(ch.straddle)}</b></div><div><small>Expected range to expiry</small><b>${f0(a.price - ch.straddle)} – ${f0(a.price + ch.straddle)}</b></div>
      <div><small>Call OI wall (resistance)</small><b class="down">${f0(ch.maxCE)}</b></div><div><small>Put OI wall (support)</small><b class="up">${f0(ch.maxPE)}</b></div>
      <div><small>ATM gamma / vega</small><b>${ch.atmRow ? ch.atmRow.ce.ga.toFixed(4) : '–'} / ${ch.atmRow ? f2(ch.atmRow.ce.ve) : '–'}</b></div><div><small>ATM theta per day (CE)</small><b class="down">${ch.atmRow ? '₹' + f1(ch.atmRow.ce.th) : '–'}</b></div>
      <div><small>Expiry, lot</small><b>${esc(ch.expiry)}, ${a.lot}</b><br><small>${f1(ch.dte)} days left</small></div></div>
      <div class="legend">Shaded cells are in the money. Red bars show call writers' walls, green bars show put writers' walls. ${Source.mode === 'live' ? 'Prices and greeks from Upstox.' : 'Demo: prices and greeks from Black-Scholes.'}</div>` + futVolHTML(a);
  } else if (tab === 'mood') {
    const v = a.vix;
    h = `<div class="stats" style="margin-top:0"><div><small>India VIX</small>${v ? `<span class="vix ${v.v < v.prev ? 'up' : 'down'}">${f2(v.v)}</span><br><small>${v.v < v.prev ? '▼ fear easing' : '▲ fear rising'}, prev ${f2(v.prev)}</small>` : '<b>–</b>'}</div>
      <div><small>FII cash (₹ cr)</small><b class="${a.fii > 0 ? 'up' : 'down'}">${ok(a.fii) ? sgn(a.fii) + f0(a.fii) : '–'}</b></div><div><small>DII cash (₹ cr)</small><b class="${a.dii > 0 ? 'up' : 'down'}">${ok(a.dii) ? sgn(a.dii) + f0(a.dii) : '–'}</b></div></div>`;
    const fa = Source.fiiAuto ? Source.fiiAuto() : null;
    h += `<div class="legend" style="margin-top:6px">FII/DII source: ${fa && ok(fa.fii) ? `NSE (automatic), ${esc(fa.date || '')}${fa.stale ? ', last available day' : ''}` : 'not available automatically right now (NSE sometimes blocks cloud servers). Enter it below.'}</div>`;
    if (Source.mode === 'live' && !(fa && ok(fa.fii) && !fa.stale)) h += `<div class="fii"><span class="mut">Enter today's figures from NSE or the news:</span>
      <div class="frow"><input id="fiiIn" type="number" placeholder="FII ₹ cr, e.g. -1200" value="${ok(a.fii) ? a.fii : ''}"><input id="diiIn" type="number" placeholder="DII ₹ cr" value="${ok(a.dii) ? a.dii : ''}"><button class="go" onclick="saveFII()">Save</button></div></div>`;
    if (a.glob && a.glob.items.length) h += `<div class="sec" style="margin-top:16px">${a.isMCX ? 'Global crude' : 'Global cues'}</div><div class="gl-row">${a.glob.items.map((g) => `<span class="gl-chip ${g.chg >= 0 ? 'up' : 'down'}">${esc(shortG(g.name))} <b>${sgn(g.chg)}${f2(g.chg)}%</b></span>`).join('')}</div>`;
    if (!a.cf.core) {
      const rs2 = a.sigs.find((x) => x.n.startsWith('Relative strength')), bm = a.sigs.find((x) => x.n.startsWith('Broad market'));
      if (rs2) h += `<div class="sec" style="margin-top:16px">Versus the market</div><div class="row"><span>Relative strength vs Nifty</span><b>${esc(rs2.v)}</b></div><div class="row"><span>Nifty score</span><b>${esc(bm ? bm.v : '–')}</b></div>`;
      $('tabBody').innerHTML = h; return;
    }
    h += `<div class="sec" style="margin-top:16px">Heavyweight stocks (approx. weights)</div>` + (a.hv.length ? `<div class="tbl"><table><thead><tr><th class="l">Stock</th><th>Weight</th><th>Change</th><th>Index impact</th></tr></thead><tbody>` +
      a.hv.map((x) => `<tr><td class="l">${esc(x.n)}</td><td>${f1(x.w)}%</td><td class="${x.c >= 0 ? 'up' : 'down'}">${sgn(x.c)}${f2(x.c)}%</td><td class="${x.pts >= 0 ? 'up' : 'down'}">${sgn(x.pts)}${f1(x.pts)} pts</td></tr>`).join('') +
      `</tbody></table></div><div class="row" style="margin-top:6px"><span>Weighted heavyweight change</span><b class="${a.hvW >= 0 ? 'up' : 'down'}">${sgn(a.hvW)}${f2(a.hvW)}%</b></div>` : '<div class="mut">No data.</div>');
  } else {
    const lb = { 1: ['b', 'Bullish'], 0: ['n', 'Neutral'], '-1': ['s', 'Bearish'] }; let g = '';
    h = `<div class="tbl"><table><thead><tr><th class="l">Signal</th><th>Value</th><th>Direction</th><th>Weight</th></tr></thead><tbody>` +
      a.sigs.map((x) => { const r = x.g !== g ? `<tr><td colspan="4" class="l mut" style="padding-top:12px">${x.g}</td></tr>` : ''; g = x.g; const l = x.w ? lb[x.s] : ['n', 'Not counted'];
        return r + `<tr><td class="l">${esc(x.n)}</td><td>${esc(x.v)}</td><td><span class="pill ${l[0]}">${l[1]}</span></td><td>${x.w}</td></tr>`; }).join('') +
      `</tbody></table></div><div class="legend">Score = 50 + 50 × (Σ weight × direction) ÷ Σ weight. Every signal is re-checked on every tick. Signals with no data are left out of the score. IV percentile and event risk don't move the score; they downgrade a setup to "mild" and show as warnings.</div>`;
  }
  $('tabBody').innerHTML = h;
}

/* ख़बरें और तिमाही नतीजे */
const sentLb = (s) => (s > 0.15 ? ['b', 'Bullish'] : s < -0.15 ? ['s', 'Bearish'] : ['n', 'Neutral']);
/* ---------- News and results as tiles: trusted sources, tier badge, impact, tags, de-duplicated ---------- */
const SRC_SHORT = [[/^NSE/, 'NSE'], [/^BSE/, 'BSE'], [/^RBI/, 'RBI'], [/^SEBI/, 'SEBI'], [/^PIB/, 'PIB'], [/^ET /, 'Economic Times'], [/^Business Standard/, 'Business Standard'], [/^Moneycontrol/, 'Moneycontrol'], [/^Mint/, 'Mint']];
const srcShort = (s) => { const m = SRC_SHORT.find(([re]) => re.test(s || '')); return m ? m[1] : s || 'News'; };
function srcTier(s) {
  s = s || '';
  if (/^(NSE|BSE)/.test(s)) return ['ex', 'Exchange'];
  if (/^(RBI|SEBI)/.test(s)) return ['reg', 'Regulator'];
  if (/^PIB/.test(s)) return ['gov', 'Govt'];
  if (/reuters|bloomberg|\bpti\b/i.test(s)) return ['wire', 'Wire'];
  if (/cnbc/i.test(s)) return ['tv', 'TV'];
  if (/moneycontrol/i.test(s)) return ['web', 'Portal'];
  if (/demo/i.test(s)) return ['web', 'Demo'];
  return ['np', 'Newspaper'];
}
const NEWS_RES = /\b(Q[1-4]|quarter(ly)?|results?|earnings|net profit|PAT|EBITDA|revenue)\b/i;
const normT = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
// "5 min ago" / "3 hours ago" / "yesterday" → timestamp (demo headlines and older cached items carry only text)
function agoMs(t) {
  const m = String(t || '').match(/(\d+)\s*(minutes?|mins?|hours?|hrs?|h|days?|d)\b/i), now = Date.now();
  if (/yesterday/i.test(t)) return now - 864e5;
  if (!m) return null;
  const u = m[2].toLowerCase(), n = +m[1];
  return now - n * (u.startsWith('m') ? 60e3 : u.startsWith('h') ? 3600e3 : 864e5);
}
function newsPool(a) {
  const watch = KEYS.filter((k) => !CFG[k].core).map((k) => ({ k, re: new RegExp('\\b(' + [k, ...(CFG[k].name || CFG[k].label).split(/\s+/).filter((w) => w.length > 3 && !/^(bank|india|limited|ltd|industries|fut)$/i.test(w)).slice(0, 2)].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i'), label: CFG[k].label }));
  const watchOf = (txt) => watch.find((w) => w.re.test(txt));
  const now = Date.now(), out = [], seen = new Map();
  const push = (n, cat) => {
    if (!n || !n.t) return;
    const key = normT(n.t); if (!key) return;
    const ts = n.ts || agoMs(n.ago) || now - (n._i || 0) * 20 * 60e3;
    const txt = (n.co || '') + ' ' + n.t, w = watchOf(txt);
    const cats = new Set([cat]); if (NEWS_RES.test(n.t) || cat === 'results' || /result/i.test(n.src || '')) cats.add('results'); if (w || n._watch) cats.add('watch');
    const prev = seen.get(key);
    if (prev) { cats.forEach((c) => prev.cats.add(c)); prev.n = Math.max(prev.n, n.n || 1) + (prev.src !== n.src ? 1 : 0); return; }
    const tags = [];
    if (n._watch || w) tags.push(n._watch || w.label);
    if (/\bnifty\b(?! bank)/i.test(n.t)) tags.push('Nifty');
    if (/bank|\brbi\b|lender|nbfc|repo/i.test(n.t)) tags.push('Bank Nifty');
    if (/sensex|\bbse\b/i.test(n.t)) tags.push('Sensex');
    if (cats.has('results')) tags.push('Results');
    const it = { t: n.t, co: n.co || '', src: n.src || (Source.mode === 'demo' ? 'Demo' : ''), link: n.link || '', ts, ago: n.ago || '', s: ok(n.s) ? n.s : 0, imp: n.imp || 'medium', n: n.n || 1, also: n.alsoBy || [], cats, tags: [...new Set(tags)].slice(0, 3) };
    seen.set(key, it); out.push(it);
  };
  const O = Source.official ? Source.official() : { items: [] }, R = Source.results ? Source.results() : { items: [] };
  O.items.forEach((n, i) => push({ ...n, _i: i }, 'official'));
  (a.news || []).forEach((n, i) => push({ ...n, _i: i }, 'market'));
  (R.items || []).forEach((n, i) => push({ ...n, _i: i }, 'results'));
  KEYS.filter((k) => !CFG[k].core && k !== cur && A[k]).forEach((k) => (A[k].news || []).forEach((n, i) => push({ ...n, _i: i, _watch: CFG[k].label }, 'watch')));
  // newest first, but fresh high-impact news (last 4 hours) stays on top
  const rank = (x) => (x.imp === 'high' && now - x.ts < 4 * 3600e3 ? 1e13 : 0) + x.ts;
  return out.sort((x, y) => rank(y) - rank(x));
}
/* What the market actually did after a headline: index (or the watchlist stock) 15 and 30 minutes later */
function reactionFor(n) {
  const wk = KEYS.find((k) => !CFG[k].core && n.tags.includes(CFG[k].label));
  const key = wk || (n.tags.includes('Bank Nifty') && !n.tags.includes('Nifty') ? 'BANKNIFTY' : n.tags.includes('Sensex') && !n.tags.includes('Nifty') ? 'SENSEX' : 'NIFTY');
  const a = A[key]; if (!a || !n.ts) return null;
  const C = a.D.candles, S = a.cf.sess || SESS.NSE; if (!C || !C.length) return null;
  let d, m;
  if (Source.mode === 'demo') {
    // demo clock runs fast: place the headline by "minutes ago" relative to the demo session
    let back = Math.round((Date.now() - n.ts) / 60000); d = 2; m = a.curMin - back;
    while (m < S.o && d > 0) { d--; m += S.c - S.o; }
    if (m < S.o) return null;
  } else {
    const t = new Date(n.ts + 5.5 * 3600e3), date = t.toISOString().slice(0, 10);
    d = (a.D.dayDates || []).indexOf(date); m = t.getUTCHours() * 60 + t.getUTCMinutes() - 555;
    if (d < 0) return null;
  }
  const day = C.filter((x) => x.d === d); if (!day.length) return null;
  if (m >= S.c) return { key, closed: true };
  const pre = m < day[0].m, base = pre ? day[0].o : (day.filter((x) => x.m <= m).pop() || day[0]).c;
  const t0 = pre ? day[0].m : m, at = (k) => day.find((x) => x.m >= t0 + k && x.m <= t0 + k + 2);
  const last = day[day.length - 1], pc = (v) => ((v - base) / base) * 100;
  const c15 = at(15), c30 = at(30);
  return { key, pre, p15: c15 ? pc(c15.c) : null, p30: c30 ? pc(c30.c) : null, sofar: !c30 ? pc(last.c) : null, mins: last.m - t0 };
}
function rxHTML(n) {
  const r = reactionFor(n); if (!r) return '';
  const nm = { NIFTY: 'Nifty', BANKNIFTY: 'Bank Nifty', SENSEX: 'Sensex' }[r.key] || (CFG[r.key] ? CFG[r.key].label : r.key);
  if (r.closed) return '';
  const v = (x) => `<b class="${x >= 0 ? 'up' : 'down'}">${x >= 0 ? '+' : ''}${f2(x)}%</b>`;
  const big = [r.p30, r.p15, r.sofar].find(ok), moved = ok(big) && Math.abs(big) >= (CFG[r.key].kind === 'EQ' ? 1.5 : 0.4);
  const txt = ok(r.p30) ? `15m ${ok(r.p15) ? v(r.p15) : '–'} · 30m ${v(r.p30)}` : ok(r.sofar) && r.mins > 0 ? `${r.mins}m so far ${v(r.sofar)}` : '';
  if (!txt) return '';
  return `<div class="nt-rx${moved ? ' big' : ''}" title="How ${nm} moved after this headline${r.pre ? ' (published before the open, measured from the open)' : ''}">${nm} after${r.pre ? ' open' : ''}: ${txt}${moved ? ' <span class="nt-mv">moved the market</span>' : ''}</div>`;
}
function newsTile(n) {
  const [tc, tl] = srcTier(n.src), d = n.s > 0.15 ? ['b', '▲ Bullish'] : n.s < -0.15 ? ['s', '▼ Bearish'] : ['n', 'Neutral'];
  const title = n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.t)}</a>` : esc(n.t);
  const more = n.n > 1 ? `<span class="nt-tag" title="${esc(n.also.join(', '))}">${n.n} sources</span>` : '';
  return `<article class="nt ${d[0]}${n.imp === 'high' ? ' hi' : ''}">
    <div class="nt-top"><span class="nt-src">${esc(srcShort(n.src))}${tl === 'Demo' ? '' : `<span class="nt-tier ${tc}">${tl}</span>`}</span><span>${esc(n.ago || '')}</span></div>
    ${n.co ? `<div class="nt-co">${esc(n.co)}</div>` : ''}<h4>${title}</h4>
    ${rxHTML(n)}<div class="nt-foot"><span class="nt-imp ${d[0]}">${d[1]}</span>${more}${n.tags.map((x) => `<span class="nt-tag">${esc(x)}</span>`).join('')}</div></article>`;
}
function renderNews() {
  const a = A[cur], pool = newsPool(a), f = newsTab === 'all' ? pool : pool.filter((x) => x.cats.has(newsTab));
  const mob = window.matchMedia('(max-width: 860px)').matches, show = mob && !newsMore ? f.slice(0, 6) : f.slice(0, 40);
  const avg = sentLb(a.newsAvg);
  $('newsNote').innerHTML = `Trusted sources only · ${esc(a.cf.label)} news mood <span class="pill ${avg[0]}">${avg[1]}${a.news.length ? ' ' + f2(a.newsAvg) : ''}</span>`;
  const empty = { official: 'Nothing from NSE, BSE, RBI, SEBI or PIB yet.', market: 'No market news yet.', results: 'No quarterly results in the feeds yet.', watch: KEYS.some((k) => !CFG[k].core) ? 'No news about your watchlist companies in the last 3 days.' : 'Add stocks with "+ Add stock / MCX" to see their news here.', all: 'No news yet. Feeds are checked every 10 minutes.' }[newsTab];
  const O = Source.official ? Source.official() : { sources: {} }, NS = Source.newsSources ? Source.newsSources(cur) || {} : {};
  const src = Object.entries({ ...O.sources, ...NS }).filter(([, c]) => c != null).map(([n, c]) => `${esc(n.replace('Google News: ', ''))} ${c}`).join(' · ');
  $('newsBody').innerHTML = (show.length ? `<div class="nw-grid">${show.map(newsTile).join('')}</div>` : `<div class="mut nw-empty">${empty}</div>`) +
    (mob && f.length > 6 ? `<button class="nw-more" onclick="newsMore=!newsMore;renderNews()">${newsMore ? 'Show fewer' : `Show more (${f.length - 6})`}</button>` : '') +
    `<div class="srcline">${Source.mode === 'live' ? 'Sources: ' + (src || 'loading') : 'Demo headlines'}</div>`;
}
/* Global cues, economic calendar, FII/DII (side panel) */
const GNAME = [[/gift|sgx/i, 'GIFT Nifty'], [/dow|\^dji|us 30/i, 'Dow'], [/s&p|gspc/i, 'S&P 500'], [/us tech|ndx|nasdaq/i, 'Nasdaq 100'], [/nikkei/i, 'Nikkei'], [/hang seng/i, 'Hang Seng'], [/dax/i, 'DAX'], [/ftse/i, 'FTSE'], [/cac/i, 'CAC 40'], [/brent|bzusd/i, 'Brent'], [/wti/i, 'WTI'], [/usd ?inr/i, 'USD/INR']];
function shortG(n) { const m = GNAME.find(([re]) => re.test(n)); return m ? m[1] : n; }
function renderGlobal() {
  const C = Source.calendar ? Source.calendar() : { items: [] };
  const CK = premarketChecklist(), W = CK.W;
  let h = `<div class="g-a"><div class="sec" style="margin-top:0">Before you trade: ${CK.good} supportive, ${CK.bad} against</div>` +
    CK.items.map((x) => `<div class="ck ${x.st}"><div><b>${esc(x.t)}</b><span>${esc(x.v)}</span></div><small>${esc(x.m)}</small></div>`).join('') +
    '<div class="legend">Green = supportive for Nifty, red = against, grey = neutral. A professional checks these before the first trade; none of them decides the day alone.</div>';
  h += '</div><div class="g-b"><div class="sec" style="margin-top:0">World markets and what they mean for India</div>';
  if (W) {
    const groups = [...new Set(W.rows.map((x) => x.cue.grp))];
    h += `<div class="tbl wtbl"><table><thead><tr><th class="l">Market</th><th>Last</th><th>Change</th><th class="l">For Nifty</th><th class="l">Why it matters</th></tr></thead><tbody>` +
      groups.map((g) => `<tr><td colspan="5" class="l mut" style="padding-top:12px">${esc(g)}</td></tr>` + W.rows.filter((x) => x.cue.grp === g).map((x) => `<tr><td class="l"><b>${esc(x.name)}</b>${x.note ? `<br><small class="mut">${esc(x.note)}</small>` : ''}</td><td>${pxFmt(x)}</td><td class="${x.chg >= 0 ? 'up' : 'down'}">${ok(x.chg) ? sgn(x.chg) + f2(x.chg) + '%' : '–'}</td><td class="l"><span class="pill ${x.imp > 0 ? 'b' : x.imp < 0 ? 's' : 'n'}">${x.imp > 0 ? 'Positive' : x.imp < 0 ? 'Negative' : 'Neutral'}</span></td><td class="l why">${esc(x.cue.why)}</td></tr>`).join('')).join('') + '</tbody></table></div>';
    const wi = worldItems();
    h += `<div class="legend">Inverse markets: crude, the dollar index, US yields, USD/INR and US VIX are bad for Nifty when they rise. "Neutral" means the move is too small to matter. Sources: Yahoo Finance (world, 1–15 min delayed), NSE (GIFT Nifty), Upstox.${wi.stale ? ' Showing the last saved values; live fetch failed.' : ''}${wi.missing.length ? ` Not available now: ${esc(wi.missing.slice(0, 6).join(', '))}${wi.missing.length > 6 ? '…' : ''}.` : ''}</div>`;
  } else h += `<div class="mut">World markets load from the Worker (/api/world). If this stays empty, deploy the latest Worker code.</div>`;
  // calendar
  const today = istYmd(), tom = new Date(Date.now() + 5.5 * 3600e3 + 864e5).toISOString().slice(0, 10);
  const exp = KEYS.filter((k) => A[k] && A[k].cf.opt && A[k].ch.expiry && A[k].ch.expiry !== 'Demo' && A[k].ch.dte <= 7).map((k) => ({ date: A[k].ch.expiry, time: '15:30', t: `${A[k].cf.label} options expiry`, imp: A[k].cf.core ? 'high' : 'medium', src: 'Exchange' }));
  const seen = new Set(), ev = [...(C.items || []), ...exp].filter((e) => { const k = e.date + e.t; if (seen.has(k)) return false; seen.add(k); return e.date >= today; }).sort((x, y) => (x.date + x.time < y.date + y.time ? -1 : 1)).slice(0, 9);
  const dl = (d) => (d === today ? 'Today' : d === tom ? 'Tomorrow' : new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
  h += '</div><div class="g-c"><div class="sec">Event calendar, next 10 days (IST)</div>' + (ev.length ? ev.map((e) => `<div class="ev ${e.imp}"><span class="ev-d">${dl(e.date)}<br><small>${esc(e.time)}</small></span><span>${esc(e.t)}${e.fc ? `<br><small class="mut">Forecast ${esc(e.fc)}, previous ${esc(e.pv)}</small>` : ''}</span></div>`).join('') : '<div class="mut">No high-impact events found.</div>');
  if (C.sources) h += `<div class="srcline">Calendar: ${Object.entries(C.sources).map(([n, c]) => `${esc(n)} ${c}`).join(', ')}</div>`;
  const Gx = Source.geo ? Source.geo() : null;
  if (Gx) {
    const lc = { High: 'down', Elevated: 'warn', Normal: '', Low: 'up', Unknown: 'mut' }[Gx.level] || '';
    h += `</div><div class="g-d"><div class="geo-h"><span class="sec" style="margin:0">Geopolitical risk (GDELT, world news)</span><span class="geo-lv ${lc}">${esc(Gx.level || '–')}${ok(Gx.ratio) ? ` · ${f1(Gx.ratio)}× 3-day avg` : ''}</span></div>
      <div class="geo-list">${(Gx.items || []).slice(0, 4).map((n) => `<div class="geo-i"><span class="mut">${esc(String(n.src || '').replace(/^www\./, ''))} · ${esc(n.ago || '')}</span>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.t)}</a>` : esc(n.t)}</div>`).join('') || '<span class="mut">No major headlines from trusted outlets in the last 12 hours.</span>'}</div>`;
  }
  $('globalBody').innerHTML = h + '</div>';
}
function setNewsTab(k) { newsTab = k; newsMore = false; renderControls(); renderNews(); }
function saveFII() { const f = $('fiiIn').value, d = $('diiIn').value; Store.setFII({ fii: f === '' ? null : +f, dii: d === '' ? null : +d }); toast('FII/DII saved'); refreshAll(); }

/* ---------- चार्ट ---------- */
function prepCanvas(c) { const ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight; c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); return { ctx, W, H }; }
function drawChart() {
  const a = A[cur]; if (!a) return;
  CI = tf === 5 ? a.I5 : ind(agg(a.D.candles, tf), a.hasVol);
  const I = CI, k = I.k, n = VIEW[tf], s0 = Math.max(0, k.length - n), view = k.slice(s0);
  const { ctx, W, H } = prepCanvas($('chart'));
  const padR = 62, volH = a.hasVol ? H * 0.12 : 0, top = 10, bot = H - volH - 20, pw = W - padR;
  const lines = [];
  if (OV.vwap) lines.push([I.vwap, COL.vwap]); if (OV.ema20) lines.push([I.ema20, COL.ema20]); if (OV.ema50) lines.push([I.ema50, COL.ema50]);
  if (OV.bb) lines.push([I.bb.up, COL.bb], [I.bb.mid, COL.grid], [I.bb.lo, COL.bb]);
  let mx = -Infinity, mn = Infinity; view.forEach((x) => { mx = Math.max(mx, x.h); mn = Math.min(mn, x.l); });
  const inc = (arr) => { for (let i = s0; i < k.length; i++) if (arr[i] != null) { mx = Math.max(mx, arr[i]); mn = Math.min(mn, arr[i]); } };
  lines.forEach((l) => inc(l[0])); if (OV.st) inc(I.st.st);
  // दाईं तरफ़ अगले 30 मिनट का अनुमान (कोन) दिखाने की जगह
  const PJ = Engine.projection(a), lastC = view[view.length - 1].c, per = PJ.perCandle * Math.sqrt(tf / 5), steps = Math.max(1, Math.round(30 / tf));
  const cone = per * Math.sqrt(steps);
  mx = Math.max(mx, lastC + cone); mn = Math.min(mn, lastC - cone);
  if (PJ.dir) { mx = Math.max(mx, PJ.t1, PJ.sl); mn = Math.min(mn, PJ.t1, PJ.sl); }
  const pd = (mx - mn) * 0.05 || 1; mx += pd; mn -= pd;
  const projW = Math.round(pw * 0.15), cpw = pw - projW;
  const y = (v) => top + ((mx - v) / (mx - mn)) * (bot - top), cw = cpw / view.length, X = (i) => i * cw + cw / 2;
  ctx.font = FONT; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) { const v = mn + ((mx - mn) * i) / 5, yy = Math.round(y(v)) + 0.5; ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke(); ctx.fillStyle = COL.muted; ctx.fillText(f0(v), pw + 6, yy + 4); }
  for (let i = 1; i < view.length; i++) if (view[i].d !== view[i - 1].d) { ctx.strokeStyle = COL.line; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(i * cw, top); ctx.lineTo(i * cw, H - 16); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.muted; ctx.fillText(a.dayLabels[view[i].d] || '', i * cw + 4, top + 10); }
  if (OV.vp) {
    const vp = a.VP, mv = Math.max(...vp.vol) || 1;
    vp.vol.forEach((v, i) => { const p1 = vp.DL + i * vp.bw, p2 = p1 + vp.bw; if (p2 < mn || p1 > mx) return; const y1 = y(Math.min(p2, mx)), y2 = y(Math.max(p1, mn)), len = (v / mv) * pw * 0.22;
      ctx.fillStyle = i === vp.poc ? 'rgba(255,181,71,.4)' : i >= vp.lo && i <= vp.hi ? 'rgba(0,229,255,.16)' : 'rgba(127,147,178,.1)'; ctx.fillRect(pw - len, y1, len, Math.max(1, y2 - y1 - 1)); });
  }
  const later = []; // लेबल सबसे आख़िर में, ताकि कैंडल्स उन्हें न ढकें
  // Fibonacci का गोल्डन ज़ोन (50% से 61.8%)
  if (OV.fib) {
    const g1 = a.fib.find((f) => f.r === 0.5).v, g2 = a.fib.find((f) => f.r === 0.618).v;
    const ya = y(Math.max(g1, g2)), yb = y(Math.min(g1, g2));
    if (yb > top && ya < bot) { ctx.fillStyle = 'rgba(255,181,71,.09)'; ctx.fillRect(0, Math.max(top, ya), pw, Math.min(bot, yb) - Math.max(top, ya)); later.push(['Golden zone', pw - 70, Math.max(top, ya) + 12, COL.brass]); }
  }
  const lv = [];
  if (OV.cpr) lv.push(['TC', a.tc, COL.cpr, 1], ['P', a.p, COL.cpr, 1], ['BC', a.bc, COL.cpr, 1]);
  if (OV.piv) [['R1', COL.put], ['R2', COL.put], ['R3', COL.put], ['S1', COL.call], ['S2', COL.call], ['S3', COL.call]].forEach(([nm, c]) => lv.push([nm, a.piv[nm], c, 1]));
  if (OV.fib) a.fib.forEach((f) => lv.push([`Fib ${(f.r * 100).toFixed(1)}%`, f.v, COL.brass, FIB_KEY.includes(f.r) ? 1.6 : 0.8]));
  if (OV.orb) lv.push(['OR high', a.ORH, COL.text, 1], ['OR low', a.ORL, COL.text, 1]);
  // लाइनें खींचो, लेबल तभी जब पास वाले लेबल से टकराए नहीं
  const placed = [];
  lv.filter(([, v]) => v >= mn && v <= mx).sort((p, q) => q[3] - p[3]).forEach(([nm, v, c, w]) => {
    const yy = Math.round(y(v)) + 0.5; ctx.strokeStyle = c; ctx.lineWidth = w; ctx.globalAlpha = w > 1 ? 0.9 : 0.5; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (placed.every((py) => Math.abs(py - yy) > 13)) { placed.push(yy); later.push([nm, 5, yy - 3, c]); }
  });
  ctx.lineWidth = 1;
  view.forEach((q, i) => { const x = Math.round(X(i)) + 0.5, col = q.c >= q.o ? COL.call : COL.put; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, y(q.h)); ctx.lineTo(x, y(q.l)); ctx.stroke(); ctx.fillStyle = col; ctx.fillRect(x - cw * 0.34, y(Math.max(q.o, q.c)), Math.max(1, cw * 0.68), Math.max(1, Math.abs(y(q.o) - y(q.c)))); });
  ctx.lineWidth = 1.6;
  lines.forEach(([arr, c]) => { ctx.strokeStyle = c; ctx.beginPath(); let s = false; for (let i = s0; i < k.length; i++) { if (arr[i] == null) { s = false; continue; } const x = X(i - s0), yy = y(arr[i]); if (!s) { ctx.moveTo(x, yy); s = true; } else ctx.lineTo(x, yy); } ctx.stroke(); });
  if (OV.st) { ctx.lineWidth = 2; for (let i = s0 + 1; i < k.length; i++) { if (I.st.st[i] == null || I.st.st[i - 1] == null || I.st.dir[i] !== I.st.dir[i - 1]) continue; ctx.strokeStyle = I.st.dir[i] === 1 ? COL.call : COL.put; ctx.beginPath(); ctx.moveTo(X(i - 1 - s0), y(I.st.st[i - 1])); ctx.lineTo(X(i - s0), y(I.st.st[i])); ctx.stroke(); } }
  ctx.lineWidth = 1;
  {
    const x0 = X(view.length - 1), x1 = pw - 6, xs = (i) => x0 + ((x1 - x0) * i) / steps;
    const cc = PJ.dir === 'CE' ? '0,245,160' : PJ.dir === 'PE' ? '255,59,107' : '0,229,255';
    ctx.fillStyle = 'rgba(0,229,255,.035)'; ctx.fillRect(cpw + cw / 2, top, pw - cpw - cw / 2, bot - top);
    ctx.beginPath(); for (let i = 0; i <= steps; i++) ctx.lineTo(xs(i), y(lastC + per * Math.sqrt(i))); for (let i = steps; i >= 0; i--) ctx.lineTo(xs(i), y(lastC - per * Math.sqrt(i))); ctx.closePath();
    const gr = ctx.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, `rgba(${cc},.28)`); gr.addColorStop(1, `rgba(${cc},.06)`); ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = `rgba(${cc},.55)`; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    later.push(['Next 30 min projection', cpw + cw / 2 + 4, bot - 6, COL.cyan]);
    if (PJ.dir) {
      const c = PJ.dir === 'CE' ? COL.call : COL.put;
      ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.shadowColor = c; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(x0, y(lastC)); ctx.lineTo(x1, y(PJ.t1)); ctx.stroke(); ctx.shadowBlur = 0;
      const ang = Math.atan2(y(PJ.t1) - y(lastC), x1 - x0); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x1, y(PJ.t1)); ctx.lineTo(x1 - 9 * Math.cos(ang - 0.45), y(PJ.t1) - 9 * Math.sin(ang - 0.45)); ctx.lineTo(x1 - 9 * Math.cos(ang + 0.45), y(PJ.t1) - 9 * Math.sin(ang + 0.45)); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = COL.put; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x0, y(PJ.sl)); ctx.lineTo(x1, y(PJ.sl)); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      later.push([`T1 ${f0(PJ.t1)}`, Math.max(x0 + 2, x1 - 64), y(PJ.t1) + (PJ.dir === 'CE' ? -6 : 16), c], [`SL ${f0(PJ.sl)}`, Math.max(x0 + 2, x1 - 64), y(PJ.sl) + (PJ.dir === 'CE' ? 16 : -6), COL.put]);
    }
  }
  later.forEach(([t, x, yy, c]) => { const tw = ctx.measureText(t).width; ctx.fillStyle = COL.panel; ctx.fillRect(x - 3, yy - 11, tw + 6, 14); ctx.fillStyle = c; ctx.fillText(t, x, yy); });
  Paper.openTrades().filter((t) => t.key === cur).forEach((t) => { if (t.openIdx < mn || t.openIdx > mx) return; const yy = y(t.openIdx); ctx.fillStyle = t.type === 'CE' ? COL.call : COL.put; ctx.beginPath(); ctx.arc(8, yy, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillText(`${t.type} entry`, 16, yy + 4); });
  if (a.hasVol) { const mvv = Math.max(...view.map((x) => x.v)) || 1; view.forEach((q, i) => { const hh = (q.v / mvv) * volH; ctx.fillStyle = q.c >= q.o ? 'rgba(0,245,160,.32)' : 'rgba(255,59,107,.32)'; ctx.fillRect(X(i) - cw * 0.34, H - 16 - hh, Math.max(1, cw * 0.68), hh); }); }
  const lp = view[view.length - 1].c, ly = Math.round(y(lp)) + 0.5, lc = lp >= a.PC ? COL.call : COL.put;
  ctx.strokeStyle = lc; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(pw, ly); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = lc; ctx.fillRect(pw, ly - 10, padR, 20); ctx.fillStyle = '#021018'; ctx.font = '600 ' + FONT; ctx.fillText(f0(lp), pw + 6, ly + 4); ctx.font = FONT;
  ctx.fillStyle = COL.muted; const stp = Math.max(1, Math.ceil(view.length / 6)); for (let i = 0; i < view.length; i += stp) ctx.fillText(hm(view[i].m), X(i) - 14, H - 3);
  drawSub(I, s0);
}
function drawSub(I, s0) {
  const { ctx, W, H } = prepCanvas($('sub')), k = I.k, pw = W - 62, n = k.length - s0, cw = (pw - Math.round(pw * 0.15)) / n, X = (i) => i * cw + cw / 2;
  ctx.font = FONT; const L = k.length - 1; let mn, mx, txt = '', y;
  const plot = (arr, c, w = 1.5) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); let s = false; for (let i = s0; i < k.length; i++) { if (arr[i] == null) { s = false; continue; } const x = X(i - s0), yy = y(arr[i]); if (!s) { ctx.moveTo(x, yy); s = true; } else ctx.lineTo(x, yy); } ctx.stroke(); };
  const hl = (v, c) => { const yy = Math.round(y(v)) + 0.5; ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.muted; ctx.fillText(String(v), pw + 6, yy + 4); };
  if (sub === 'rsi') {
    mn = 0; mx = 100; y = (v) => 4 + ((mx - v) / (mx - mn)) * (H - 8);
    ctx.fillStyle = 'rgba(0,229,255,.04)'; ctx.fillRect(0, y(70), pw, y(30) - y(70));
    hl(70, COL.put); hl(50, COL.line); hl(30, COL.call); plot(I.rsi, COL.ema20); txt = `RSI (14): ${f1(I.rsi[L])}`;
  } else if (sub === 'macd') {
    let m = 0; for (let i = s0; i < k.length; i++) [I.macd.line[i], I.macd.sig[i], I.macd.hist[i]].forEach((v) => { if (v != null) m = Math.max(m, Math.abs(v)); });
    m = m || 1; mn = -m * 1.1; mx = m * 1.1; y = (v) => 4 + ((mx - v) / (mx - mn)) * (H - 8);
    for (let i = s0; i < k.length; i++) { const v = I.macd.hist[i]; if (v == null) continue; ctx.fillStyle = v >= 0 ? 'rgba(0,245,160,.45)' : 'rgba(255,59,107,.45)'; ctx.fillRect(X(i - s0) - cw * 0.34, Math.min(y(0), y(v)), Math.max(1, cw * 0.68), Math.abs(y(v) - y(0))); }
    hl(0, COL.line); plot(I.macd.line, COL.vwap); plot(I.macd.sig, COL.brass); txt = `MACD ${f2(I.macd.line[L])}, signal ${f2(I.macd.sig[L])}, hist ${f2(I.macd.hist[L])}`;
  } else {
    mn = 0; mx = 60; for (let i = s0; i < k.length; i++) [I.adx.adx[i], I.adx.pdi[i], I.adx.mdi[i]].forEach((v) => { if (v != null) mx = Math.max(mx, v + 5); });
    y = (v) => 4 + ((mx - v) / (mx - mn)) * (H - 8); hl(20, COL.line); plot(I.adx.pdi, COL.call, 1.2); plot(I.adx.mdi, COL.put, 1.2); plot(I.adx.adx, COL.text, 2);
    txt = `ADX ${f1(I.adx.adx[L])}, +DI ${f1(I.adx.pdi[L])}, −DI ${f1(I.adx.mdi[L])}`;
  }
  $('subVal').textContent = txt;
}

/* ---------- Search and add to watchlist ---------- */
let sTimer = null, sSeq = 0, sLast = [];
function openSearch() {
  $('srch').classList.add('open'); $('srchIn').value = ''; $('srchRes').innerHTML = `<div class="mut">Type a company, index or commodity: Reliance, HDFC Bank, Wipro, Nifty IT, crude oil, gold…</div>`;
  setTimeout(() => $('srchIn').focus(), 30);
}
function closeSearch() { $('srch').classList.remove('open'); }
function onSearch(v) {
  clearTimeout(sTimer);
  if (v.trim().length < 2) return;
  sTimer = setTimeout(async () => {
    const my = ++sSeq; $('srchRes').innerHTML = '<div class="mut">Searching…</div>';
    try {
      const r = await Source.search(v.trim()); if (my !== sSeq) return;
      sLast = r.items || [];
      $('srchRes').innerHTML = sLast.length ? sLast.map((x, i) => `<button class="sr" onclick="addWatch(sLast[${i}])">
          <span class="sr-n"><b>${esc(x.label)}</b><small>${esc(x.name || '')}</small></span>
          <span class="sr-t"><span class="pill n">${x.exch} ${KIND[x.kind] || x.kind}</span>${x.fo ? `<span class="pill b">F&O lot ${x.lot || '?'}</span>` : x.exch === 'MCX' ? `<span class="pill g">Lot ${x.lot || '?'}${x.expiry ? ', exp ' + esc(x.expiry) : ''}</span>` : '<span class="pill">No F&O</span>'}${CFG[x.id] ? '<span class="pill g">Added</span>' : ''}</span></button>`).join('')
        : '<div class="mut">Nothing found. Try the NSE symbol (e.g. HDFCBANK) or a commodity name (CRUDEOIL, GOLD, SILVER, NATURALGAS).</div>';
    } catch (e) { if (my === sSeq) $('srchRes').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }, 280);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('srch') && $('srch').classList.contains('open')) closeSearch(); });

/* ---------- Structure and pre-alerts (signal panel card + Structure tab) ---------- */
const TONE = { call: 'up', put: 'dn', warn: 'wr', info: 'n' };
function stxRows(a) {
  const X = a.stx, rows = [];
  if (a.open && a.sessionLive && a.curMin < a.SS.o + 120) rows.push(['Opening', a.open.trap ? 'wr' : a.open.dir > 0 ? 'up' : a.open.dir < 0 ? 'dn' : 'n', a.open.trap ? 'Possible opening fake-out' : a.open.name, a.open.trap || a.open.note]);
  if (X) rows.push(['5-min structure', TONE[X.tone] || 'n', X.label, X.detail + (X.sweepTxt ? ' ' + X.sweepTxt : '')]);
  if (X && X.micro) rows.push(['1-min', X.microTrend > 0 ? 'up' : X.microTrend < 0 ? 'dn' : 'n', `1-minute trend ${X.microTrend > 0 ? 'up' : X.microTrend < 0 ? 'down' : 'flat'}`, `Last: ${evName(X.micro).toLowerCase()} ${X.micro.dir > 0 ? 'up' : 'down'} through ${f0(X.micro.lvl)} at ${evTime(X.micro)}.${X.state === 'noise' && X.micro.dir === -X.trend ? ' The 5-minute calls it noise.' : ''}`]);
  const near = a.lvw ? [a.lvw.above, a.lvw.below].filter((l) => l && l.near) : [];
  near.forEach((l) => rows.push(['Pre-alert', l.verdict === 'break' ? (l.R ? 'up' : 'dn') : l.verdict === 'hold' ? 'wr' : 'n', `${l.kind} ${f0(l.v)} is ${f0(l.dist)} pts away: ${l.vTxt.toLowerCase()}`, `${l.name}. ${l.act} Breaks if: ${l.confirmBreak}. Holds if: ${l.confirmHold}.`]));
  if (!near.length && a.lvw) { const u = a.lvw.above, d = a.lvw.below; rows.push(['Next levels', 'n', `${u ? `R ${f0(u.v)} (+${f0(u.dist)})` : 'No resistance found'} · ${d ? `S ${f0(d.v)} (−${f0(d.dist)})` : 'No support found'}`, `Pre-alerts start when price is within 0.6 ATR (${f0(0.6 * a.atr)} pts) of a level.`]); }
  if (a.cf.opt) {
    const F = a.oif;
    if (F && F.ready) rows.push(['OI flow', F.bias >= 0.3 ? 'up' : F.bias <= -0.3 ? 'dn' : 'n', F.read, F.notes.length ? F.notes[0][2] : `Call OI near the money ${sgn(F.ce15)}${f1(F.ce15 / 1e5)}L, put OI ${sgn(F.pe15)}${f1(F.pe15 / 1e5)}L in 15 minutes.`]);
    else if (a.sessionLive) rows.push(['OI flow', 'n', 'Building live OI history', `${F ? F.mins : 0} of 15 minutes recorded. OI-switch alerts start after that; keep the tab open.`]);
  }
  const G = a.gap && a.gap.today;
  if (G && G.side !== 'flat' && G.base && G.base.n >= 5) {
    const b = G.base, up = G.side === 'up';
    rows.push(['Gap', up ? 'up' : 'dn', `${a.sessionLive ? 'Today' : 'Last session'}: gap-${up ? 'up' : 'down'} ${sgn(G.pts)}${f0(G.pts)} pts (${sgn(G.pct)}${f2(G.pct)}%), ${G.filled ? 'gap filled' : `${Math.round(G.fillPct * 100)}% filled`}`, `Past year, similar gaps: ${Math.round((b.same / b.n) * 100)}% closed ${up ? 'green' : 'red'}, ${Math.round((b.fill / b.n) * 100)}% filled the gap (${b.n} days). ${a.gap.driver && a.gap.driver.verdict ? a.gap.driver.verdict + '.' : ''}`]);
  }
  return rows;
}
function renderStx() {
  const a = A[cur], box = $('stx'); if (!box || !a) return;
  const rows = stxRows(a);
  const open = box.dataset.open === '1';
  box.innerHTML = rows.length ? `<div class="stx${open ? ' open' : ''}" onclick="if(event.target.closest('button'))return;const b=$('stx');b.dataset.open=b.dataset.open==='1'?'':'1';renderStx()" title="Tap to show or hide the explanations"><div class="stx-h"><span>Structure and pre-alerts</span><button class="lnk" onclick="setTab('struct');document.querySelector('.p-tabs').scrollIntoView({behavior:'smooth'})">Details</button></div>` +
    rows.map((r) => `<div class="stx-r ${r[1]}"><span class="stx-k">${r[0]}</span><div><b>${esc(r[2])}</b><small>${esc(r[3])}</small></div></div>`).join('') + `<div class="stx-more">${open ? 'Tap to hide the explanations' : 'Tap for the full explanation and confirmations'}</div></div>` : '';
}
function renderStructTab(a) {
  const X = a.stx, L = (v) => f1(v / 1e5) + 'L';
  let h = '<div class="sec">Market structure, 5-minute (breaks count only on candle closes)</div>';
  if (X) {
    h += `<div class="alert ${X.tone === 'warn' ? '' : 'i'}"><b>${esc(X.label)}</b><br>${esc(X.detail)}</div>${X.sweepTxt ? `<div class="alert">${esc(X.sweepTxt)}</div>` : ''}`;
    if (ok(X.prot)) h += `<div class="row"><span>${X.trend > 0 ? 'Protected low (must hold for the uptrend)' : 'Protected high (must hold for the downtrend)'}</span><b>${f1(X.prot)}</b></div>`;
    if (ok(X.ext)) h += `<div class="row"><span>${X.trend > 0 ? 'Trend high' : 'Trend low'}</span><b>${f1(X.ext)}</b></div>`;
    if (X.events.length) h += `<div class="tbl"><table><thead><tr><th class="l">Time</th><th class="l">Event</th><th>Direction</th><th>Level</th></tr></thead><tbody>${X.events.slice().reverse().map((e) => `<tr><td class="l">${evTime(e)}</td><td class="l">${evName(e)}</td><td><span class="pill ${e.dir > 0 ? 'b' : 's'}">${e.dir > 0 ? 'Up' : 'Down'}</span></td><td>${f1(e.lvl)}</td></tr>`).join('')}</tbody></table></div>`;
  } else h += '<div class="mut">Not enough candles yet.</div>';
  h += `<div class="legend">Noise: under 0.6 ATR, no swing broken. Pullback: price retraces but the protected swing holds. Break of structure (BOS): a close beyond the last swing in the trend's direction, so the trend continues. Change of character (CHoCH): the first close beyond the opposite swing, the earliest sign a trend may be turning; it is confirmed when the next swing fails. Liquidity sweep: a wick through a swing that closes back inside, typically stop-loss hunting.</div>`;
  if (a.lvw) {
    h += '<div class="sec" style="margin-top:16px">Level pre-alerts: will the next level hold or break?</div>';
    [a.lvw.above, a.lvw.below].forEach((l) => {
      if (!l) return;
      h += `<div class="lvw ${l.verdict}"><div class="lvw-h"><b>${l.kind} ${f1(l.v)}</b><span>${esc(l.name)} · ${f0(l.dist)} pts (${f1(l.distATR)} ATR) away</span><span class="pill ${l.verdict === 'hold' ? 'n' : l.R ? 'b' : 's'}">${l.vTxt}</span></div>
        <div class="lvw-c"><div><small>Points to ${l.R ? 'a rejection' : 'a bounce'} (${f1(l.hs)})</small>${l.hold.map((x) => `<p>${esc(x[1])}</p>`).join('') || '<p class="mut">None</p>'}</div><div><small>Points to a break (${f1(l.bs)})</small>${l.brk.map((x) => `<p>${esc(x[1])}</p>`).join('') || '<p class="mut">None</p>'}</div></div>
        <div class="lvw-f"><span><b>Break confirmed:</b> ${esc(l.confirmBreak)}</span><span><b>Hold confirmed:</b> ${esc(l.confirmHold)}</span><span>${esc(l.act)}</span></div></div>`;
    });
    h += '<div class="legend">These are odds from price behaviour and option writers, not certainties. Wait for the confirmation line before acting.</div>';
  }
  if (a.cf.opt) {
    const F = a.oif;
    h += '<div class="sec" style="margin-top:16px">Option OI flow, near the money (live, last 15 minutes)</div>';
    if (F && F.ready) {
      h += `<div class="alert i"><b>${esc(F.read)}</b>${ok(F.prevBias) ? `<br>15 minutes earlier: ${F.prevBias >= 0.3 ? 'put writers dominated' : F.prevBias <= -0.3 ? 'call writers dominated' : 'balanced'}.` : ''}</div>` + F.notes.map((n) => `<div class="alert ${n[0] === 'put' ? '' : 'i'}">${esc(n[2])}</div>`).join('');
      h += `<div class="row"><span>Call OI wall (resistance)</span><b>${F.cw ? F.cw[0] : '–'}${F.cw0 && F.cw && F.cw0[0] !== F.cw[0] ? ` (was ${F.cw0[0]})` : ''}</b></div><div class="row"><span>Put OI wall (support)</span><b>${F.pw ? F.pw[0] : '–'}${F.pw0 && F.pw && F.pw0[0] !== F.pw[0] ? ` (was ${F.pw0[0]})` : ''}</b></div>`;
      h += `<div class="tbl"><table><thead><tr><th>CE OI</th><th>CE Δ 15m</th><th class="k">Strike</th><th class="l">PE Δ 15m</th><th class="l">PE OI</th></tr></thead><tbody>${F.per.map((r) => `<tr class="${r.K === a.ch.atm ? 'atm' : ''}"><td>${L(r.ce)}</td><td class="${r.dce >= 0 ? 'down' : 'up'}">${sgn(r.dce)}${L(r.dce)}</td><td class="k">${r.K}</td><td class="l ${r.dpe >= 0 ? 'up' : 'down'}">${sgn(r.dpe)}${L(r.dpe)}</td><td class="l">${L(r.pe)}</td></tr>`).join('')}</tbody></table></div>`;
      h += '<div class="legend">Option buyers in India are mostly retail; writers (sellers) are mostly institutions. Writers adding calls above price = they expect a cap (bearish). Writers adding puts below = they expect support (bullish). When the side that was adding starts cutting, the character is switching.</div>';
    } else h += `<div class="mut">Recording live OI: ${F ? F.mins : 0} of 15 minutes so far. The browser keeps a minute-by-minute OI history while the dashboard is open.</div>`;
  }
  // opening type and gap
  h += '<div class="sec" style="margin-top:16px">Opening type and gap</div>';
  if (a.open) h += `<div class="alert ${a.open.trap ? '' : 'i'}"><b>${esc(a.open.name)}</b><br>${esc(a.open.note)}${a.open.trap ? `<br><b>${esc(a.open.trap)}</b>` : ''}</div>`;
  const GS = a.gap;
  if (GS) {
    const T = GS.today;
    if (T) h += `<div class="row"><span>${a.sessionLive ? "Today's" : 'Last session'} open vs previous close</span><b class="${T.pts >= 0 ? 'up' : 'down'}">${sgn(T.pts)}${f1(T.pts)} pts (${sgn(T.pct)}${f2(T.pct)}%, ${f1(Math.abs(T.g))} daily ATR)</b></div>` + (T.side !== 'flat' ? `<div class="row"><span>Gap filled so far</span><b>${T.filled ? 'Yes, fully' : Math.round(T.fillPct * 100) + '%'}</b></div>` : '');
    if (GS.driver && GS.driver.items.length) h += `<div class="sec">What is behind the gap</div>` + GS.driver.items.map((x) => `<div class="ck ${x[0]}">${esc(x[1])}</div>`).join('') + `<div class="alert i"><b>${esc(GS.driver.verdict)}</b></div>`;
    const pct = (b, x) => (b.n ? Math.round((b[x] / b.n) * 100) + '%' : '–'), row = (lab, b) => `<tr><td class="l">${lab}</td><td>${b.n}</td><td>${pct(b, 'same')}</td><td>${pct(b, 'go')}</td><td>${pct(b, 'fill')}</td></tr>`;
    h += `<div class="sec">How gaps behaved, last ${GS.days} sessions of ${esc(a.cf.label)}</div><div class="tbl"><table><thead><tr><th class="l">Gap</th><th>Days</th><th>Closed in gap direction</th><th>Kept going after open</th><th>Gap filled</th></tr></thead><tbody>
      ${row('Small gap-up (0.15–0.5 ATR)', GS.st.up.small)}${row('Big gap-up (over 0.5 ATR)', GS.st.up.big)}${row('Small gap-down', GS.st.dn.small)}${row('Big gap-down', GS.st.dn.big)}</tbody></table></div>
      <div class="legend">"Closed in gap direction": a gap-up day closed above the previous close (or a gap-down below it). "Kept going": closed beyond the open in the gap's direction (gap-and-go). "Gap filled": price touched the previous close during the day. A gap does not decide the close by itself; the cause and the first 30 minutes do.</div>`;
  } else h += '<div class="mut">Gap statistics need about 40 days of daily candles (they load a few seconds after start).</div>';
  $('tabBody').innerHTML = h;
}

/* ---------- World cues: compact strip on top + full pre-market checklist ---------- */
const CUE_SHORT = { gift: 'GIFT Nifty', indicative: 'Pre-open', dowF: 'Dow fut', nasF: 'Nasdaq fut', spxF: 'S&P fut', dow: 'Dow', nas: 'Nasdaq', spx: 'S&P 500', usvix: 'US VIX', nikkei: 'Nikkei', hsi: 'Hang Seng', kospi: 'Kospi', sse: 'Shanghai', dax: 'DAX', ftse: 'FTSE', brent: 'Brent', wti: 'WTI', gold: 'Gold', silver: 'Silver', natgas: 'Nat gas', dxy: 'Dollar idx', us10y: 'US 10Y', usdinr: 'USD/INR', infy: 'INFY ADR', wit: 'WIT ADR', hdb: 'HDB ADR', ibn: 'IBN ADR' };
const pxFmt = (x) => (x.id === 'us10y' ? f2(x.price) + '%' : x.price >= 1000 ? f0(x.price) : f2(x.price));
function renderCues() {
  const box = $('cues'); if (!box) return;
  const W = worldRead(A[cur]);
  if (!W) { box.innerHTML = `<div class="cu-lead n"><b>World cues</b><span>${Source.mode === 'live' ? 'Loading GIFT Nifty, US futures, Asia, crude, dollar…' : 'Not available'}</span></div>`; return; }
  const order = ['gift', 'indicative', 'dowF', 'nasF', 'spxF', 'nikkei', 'hsi', 'brent', 'dxy', 'us10y', 'usdinr', 'usvix', 'gold', 'infy', 'hdb'];
  const tiles = order.map((id) => W.rows.find((x) => x.id === id)).filter(Boolean);
  const cls = W.score >= 15 ? 'up' : W.score <= -15 ? 'dn' : 'n';
  const g = W.gift, gTxt = g && ok(W.base) ? `GIFT Nifty ${sgn(g.price - W.base)}${f0(g.price - W.base)} pts ${W.beforeOpen ? '→ expected open ' + (Math.abs(g.price - W.base) < Math.max(30, W.base * 0.0015) ? 'flat' : g.price > W.base ? 'gap-up' : 'gap-down') : 'vs prev. close'}` : '';
  box.innerHTML = `<button class="cu-lead ${cls}" onclick="document.getElementById('below').scrollIntoView({behavior:'smooth'})"><b>World cues for Nifty: ${W.lean}</b><span>${gTxt || 'Score ' + W.score} · Full checklist ↓</span></button>` +
    `<div class="cu-row">${tiles.map((x) => `<div class="cu ${x.imp > 0 ? 'up' : x.imp < 0 ? 'dn' : 'n'}" title="${esc(x.cue.why)}"><small>${CUE_SHORT[x.id] || esc(x.name)}</small><b>${pxFmt(x)}</b><span>${ok(x.chg) ? sgn(x.chg) + f2(x.chg) + '%' : ''}</span><i>${x.imp > 0 ? '▲ good for Nifty' : x.imp < 0 ? '▼ bad for Nifty' : 'neutral'}</i></div>`).join('')}</div>`;
}
function premarketChecklist() {
  const N = A.NIFTY, W = worldRead(N), out = [], add = (st, t, v, m) => out.push({ st, t, v, m });
  const grp = (ids) => (W ? W.rows.filter((x) => ids.includes(x.id)) : []);
  const sum = (rows) => rows.reduce((s, x) => s + x.imp, 0), txt = (rows) => rows.map((x) => `${CUE_SHORT[x.id]} ${sgn(x.chg)}${f2(x.chg)}%`).join(', ');
  if (W && W.gift && ok(W.base)) { const gp = W.gift.price - W.base, flat = Math.abs(gp) < Math.max(30, W.base * 0.0015); add(flat ? 'n' : gp > 0 ? 'ok' : 'bad', 'GIFT Nifty', `${f0(W.gift.price)} (${sgn(gp)}${f0(gp)} pts)`, flat ? 'Points to a flat open. GIFT carries a small futures premium, so gaps under ~30 pts are basically flat.' : `Points to a gap-${gp > 0 ? 'up' : 'down'} open of about ${f0(Math.abs(gp))} pts. Check "Gap" below for how such gaps usually behave.`); }
  else add('n', 'GIFT Nifty', 'Not available', 'NSE sometimes blocks cloud servers; the Upstox global list is used when it has it.');
  [['US futures', ['dowF', 'nasF', 'spxF'], 'Live overnight: the latest read on US mood.'], ['US close', ['dow', 'nas', 'spx'], 'Last US session; mostly priced into GIFT already.'], ['Asia', ['nikkei', 'hsi', 'kospi'], 'Trades alongside India in the morning.']].forEach(([t, ids, m]) => { const r = grp(ids); if (r.length) { const s = sum(r); add(s > 0 ? 'ok' : s < 0 ? 'bad' : 'n', t, txt(r), m); } });
  const cr = grp(['brent']);
  if (cr.length) add(cr[0].imp > 0 ? 'ok' : cr[0].imp < 0 ? 'bad' : 'n', 'Crude oil (Brent)', `${f2(cr[0].price)} (${sgn(cr[0].chg)}${f2(cr[0].chg)}%)`, cr[0].chg > 0 ? 'Rising crude hurts India (importer): watch OMCs, paints, airlines. ONGC gains.' : 'Softer crude helps India: OMCs, paints, airlines benefit.');
  const fx = grp(['dxy', 'us10y', 'usdinr']);
  if (fx.length) { const s = sum(fx); add(s > 0 ? 'ok' : s < 0 ? 'bad' : 'n', 'Dollar, US yields, rupee', txt(fx), 'A stronger dollar, higher US yields or a weaker rupee push FIIs to sell Indian stocks.'); }
  if (N && N.vix) add(N.vix.v > 18 ? 'bad' : N.vix.v < 13 ? 'ok' : 'n', 'India VIX', `${f2(N.vix.v)} (${N.vix.v >= N.vix.prev ? 'rising' : 'falling'})`, N.vix.v > 18 ? 'High fear: big swings, expensive premiums. Trade smaller.' : N.vix.v < 13 ? 'Calm market: cheaper premiums, smaller ranges.' : 'Normal volatility.');
  if (N && ok(N.fii)) add(N.fii > 0 ? 'ok' : 'bad', 'FII / DII cash, previous day', `FII ${sgn(N.fii)}${f0(N.fii)} cr${ok(N.dii) ? `, DII ${sgn(N.dii)}${f0(N.dii)} cr` : ''}`, N.fii > 0 ? 'Foreign funds were buyers.' : `Foreign funds were sellers${ok(N.dii) && N.dii > -N.fii ? ', but domestic funds absorbed it' : ''}.`);
  const FP = fiiPositions();
  if (FP) add(FP.longPct >= 50 ? 'ok' : FP.longPct < 35 ? 'bad' : 'n', 'FII index futures position', `${f0(FP.longPct)}% long${ok(FP.dL) ? ` (longs ${sgn(FP.dL)}${f0(FP.dL)}, shorts ${sgn(FP.dS)}${f0(FP.dS)} contracts)` : ''}`, `FIIs are ${FP.read}. As of ${FP.date}.`);
  if (N && N.ch.rows.length) add(N.ch.pcr > 1.2 ? 'ok' : N.ch.pcr < 0.8 ? 'bad' : 'n', 'Nifty option chain', `PCR ${f2(N.ch.pcr)}, max pain ${N.ch.mp}, walls ${N.ch.maxPE}–${N.ch.maxCE}`, `Writers expect ${N.ch.maxPE} to hold as support and ${N.ch.maxCE} as resistance. ${N.ch.dte <= 1 ? 'Expiry day: decay is fast, moves pin towards max pain.' : ''}`);
  if (N) {
    // before the open, "previous day" is the session that just ended, and its CPR is built from that session
    const pre = !N.sessionLive, H = pre ? N.DH : N.PH, Lo = pre ? N.DL : N.PL, Cl = pre ? N.price : N.PC, P = (H + Lo + Cl) / 3, bc0 = (H + Lo) / 2, tc0 = 2 * P - bc0, tc = Math.max(tc0, bc0), bc = Math.min(tc0, bc0);
    const w = Math.abs(tc - bc) / N.price * 100; add(w < 0.1 ? 'ok' : 'n', pre ? 'Last session and next CPR' : 'Previous day and CPR', `High ${f0(H)}, low ${f0(Lo)}, CPR ${f0(bc)}–${f0(tc)}`, w < 0.1 ? 'Very narrow CPR: trending-day odds are higher.' : w > 0.35 ? 'Wide CPR: sideways-day odds are higher.' : 'Normal CPR. Above TC = bullish, below BC = bearish.'); }
  const ev = N ? N.events : [];
  add(ev.length ? 'bad' : 'ok', 'Event risk', ev.length ? ev.map((e) => `${e.t} ${e.time}`).join('; ') : 'No high-impact event today', ev.length ? 'Volatility spikes around the event; IV drops right after. Avoid holding options into it.' : 'Nothing scheduled to jolt the market.');
  if (N) { const fresh = (N.news || []).filter((n) => { const t = ok(n.ts) ? n.ts : agoMs(n.ago); return t && Date.now() - t < 20 * 3600e3 && (n.imp === 'high' || Math.abs(n.s) >= 0.5); }); const s = fresh.reduce((x, n) => x + Math.sign(n.s), 0); add(s > 0 ? 'ok' : s < 0 ? 'bad' : 'n', 'Overnight news', fresh.length ? `${fresh.length} high-impact (${fresh.filter((n) => n.s > 0).length} positive, ${fresh.filter((n) => n.s < 0).length} negative)` : 'Nothing high-impact', fresh[0] ? `Top: ${fresh[0].t}` : 'A gap without news tends to fade.'); }
  const geo = N && N.D.geo; if (geo) add(/High|Elevated/.test(geo.level) ? 'bad' : 'ok', 'Geopolitical risk', geo.level, /High|Elevated/.test(geo.level) ? 'Expect sudden swings; keep size small.' : 'Calm.');
  const GS = N && N.gap;
  if (GS && W && W.gift && ok(W.base) && W.beforeOpen) {
    const gA = (W.gift.price - W.base) / (GS.A || 1);
    if (Math.abs(gA) >= 0.15) { const b = GS.st[gA > 0 ? 'up' : 'dn'][Math.abs(gA) >= 0.5 ? 'big' : 'small']; if (b.n >= 5) add('n', 'If it opens with this gap', `${b.n} similar days last year`, `${Math.round((b.same / b.n) * 100)}% closed ${gA > 0 ? 'green' : 'red'}, ${Math.round((b.fill / b.n) * 100)}% filled the gap. Watch the first 30 minutes (opening type) before trusting the gap.`); }
  }
  const good = out.filter((x) => x.st === 'ok').length, bad = out.filter((x) => x.st === 'bad').length;
  return { items: out, good, bad, W };
}
