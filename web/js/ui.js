/* ===== स्क्रीन पर दिखाना: टिकर, चार्ट, टैब, स्कोर, लेवल ===== */
let sub = 'rsi', tab = 'chain', tf = 5, CI = null;
const OV = Store.pref('overlays', { vwap: true, ema20: true, ema50: false, bb: false, st: true, fib: false, cpr: true, piv: false, orb: false, vp: false });
const OVL = { vwap: 'VWAP', ema20: 'EMA 20', ema50: 'EMA 50', bb: 'Bollinger', st: 'Supertrend', fib: 'Fibonacci', cpr: 'CPR', piv: 'पिवट', orb: 'ओपनिंग रेंज', vp: 'वॉल्यूम प्रोफ़ाइल' };
const VIEW = { 1: 90, 5: 75, 15: 50, 60: 21 }, TFL = { 1: '1 मिनट', 5: '5 मिनट', 15: '15 मिनट', 60: '1 घंटा' };

function renderTickers() {
  $('tickers').innerHTML = KEYS.map((k) => {
    const a = A[k];
    if (!a) return `<div class="tk"><div class="n"><span>${CFG[k].label}</span></div><div class="p mut">लोड हो रहा…</div></div>`;
    const s = signalFor(a), tag = s.state === 'CE' ? '<span class="up">कॉल ▲</span>' : s.state === 'PE' ? '<span class="down">पुट ▼</span>' : '<span class="mut">रुको</span>';
    return `<div class="tk ${k === cur ? 'active' : ''}" onclick="pick('${k}')"><div class="n"><span>${a.cf.label}</span><span>स्कोर ${a.score} · ${tag}</span></div>
      <div class="p">${f2(a.price)}</div><div class="${a.chg >= 0 ? 'up' : 'down'}">${a.chg >= 0 ? '▲' : '▼'} ${f2(Math.abs(a.price - a.PC))} (${f2(a.chg)}%)</div></div>`;
  }).join('');
  $('clock').textContent = Source.clock().label;
}
function renderControls() {
  const a = A[cur]; if (!a) return;
  $('tfBtns').innerHTML = [1, 5, 15, 60].map((t) => `<button class="btn ${t === tf ? 'on' : ''}" onclick="setTF(${t})">${TFL[t]}</button>`).join('');
  $('ovChips').innerHTML = Object.keys(OV).map((k) => `<button class="chip ${OV[k] ? 'on' : ''}" onclick="togOV('${k}')">${k === 'vwap' && !a.hasVol ? 'TWAP' : k === 'vp' && !a.hasVol ? 'TPO प्रोफ़ाइल' : OVL[k]}</button>`).join('');
  $('subBtns').innerHTML = [['rsi', 'RSI'], ['macd', 'MACD'], ['adx', 'ADX']].map(([k, l]) => `<button class="btn ${k === sub ? 'on' : ''}" onclick="setSub('${k}')">${l}</button>`).join('');
  $('chartTitle').textContent = `${a.cf.label} · ${TFL[tf]}`;
  $('tabs').innerHTML = [['chain', 'ऑप्शन चेन'], ['mood', 'मार्केट मूड'], ['news', 'न्यूज़'], ['sig', 'सभी संकेत']].map(([k, l]) => `<button class="btn ${k === tab ? 'on' : ''}" onclick="setTab('${k}')">${l}</button>`).join('');
  const cf = a.cf;
  $('qchips').innerHTML = [`${cf.voice} ${a.ch.atm} कॉल लूँ क्या?`, `${cf.voice} ${a.ch.atm} पुट लूँ क्या?`, 'मेरी पोज़िशन होल्ड करूँ या एग्जिट?']
    .map((t) => `<button class="chip" onclick="$('q').value='${t}';Voice.ask()">${t}</button>`).join('');
}
function renderScore() {
  const a = A[cur], s = a.score;
  $('score').textContent = s; $('score').className = 'score ' + (s >= 58 ? 'up' : s <= 42 ? 'down' : '');
  $('verdict').textContent = s >= 65 ? 'ज़्यादातर संकेत कॉल की तरफ़' : s >= 58 ? 'संकेत हल्के कॉल की तरफ़' : s <= 35 ? 'ज़्यादातर संकेत पुट की तरफ़' : s <= 42 ? 'संकेत हल्के पुट की तरफ़' : 'मिले-जुले संकेत, साफ़ दिशा नहीं';
  $('needle').style.left = `calc(${s}% - 2px)`;
  const act = a.sigs.filter((x) => x.w > 0), b = act.filter((x) => x.s > 0).length, n = act.filter((x) => x.s === 0).length, d = act.filter((x) => x.s < 0).length;
  $('scoreSub').textContent = `${a.active} संकेतों पर आधारित`;
  $('counts').innerHTML = `<div class="up"><b>${b}</b>बुलिश</div><div class="mut"><b>${n}</b>न्यूट्रल</div><div class="down"><b>${d}</b>बेयरिश</div>`;
}
function renderSetup() {
  const a = A[cur], s = a.score, dir = s >= 58 ? 'CE' : s <= 42 ? 'PE' : null; let h = '';
  if (!dir) h += `<div class="dirbox n">अभी कोई साफ़ सेटअप नहीं<br><small style="font-weight:400">स्कोर ${s}: इंतज़ार करना भी एक पोज़िशन है</small></div>`;
  else {
    const t = setupFor(a, dir);
    h += `<div class="dirbox ${dir === 'CE' ? 'b' : 's'}">${dir === 'CE' ? 'कॉल (CE)' : 'पुट (PE)'} की तरफ़ झुकाव · ${t.K} ${dir}</div>
      <div class="sec">इंडेक्स लेवल</div><div class="lv"><div><small>एंट्री</small><b>${f0(t.e)}</b></div><div><small>स्टॉप-लॉस</small><b class="down">${f0(t.sl)}</b></div><div><small>टारगेट 1 / 2</small><b class="up">${f0(t.t1)} / ${f0(t.t2)}</b></div></div>
      <div class="sec">ऑप्शन प्रीमियम</div><div class="lv"><div><small>प्रीमियम</small><b>${rs(t.P)}</b></div><div><small>प्रीमियम SL</small><b class="down">${rs(t.pSL)}</b></div><div><small>प्रीमियम T1</small><b class="up">${rs(t.pT1)}</b></div></div>
      <div class="row"><span>रिस्क : रिवॉर्ड</span><b>1 : 1.5 / 1 : 2.5</b></div><div class="row"><span>स्टॉप-लॉस आधार</span><span>1.5 × ATR (5मि) = ${f0(t.risk)} पॉइंट</span></div>`;
  }
  h += alertsFor(a, dir).map(([c, t]) => `<div class="alert ${c === 'd' ? 'd' : c === 'i' ? 'i' : ''}">${t}</div>`).join('');
  $('setup').innerHTML = h;
}
function lrow(n, v, a) { const near = Math.abs(v - a.price) < a.atr * 0.5; return `<div class="row"><span>${n}</span><b class="${near ? 'cur' : v > a.price ? 'down' : 'up'}">${f1(v)}${near ? ' ◀ पास' : ''}</b></div>`; }
function renderLevels() {
  const a = A[cur];
  let h = `<div class="row"><span>मौजूदा भाव</span><b class="cur">${f1(a.price)}</b></div><div class="row"><span>ATR (14, 5मि)</span><b>${f1(a.atr)}</b></div>`;
  h += '<div class="sec">पिवट और CPR (पिछले सत्र से)</div>';
  ['R3', 'R2', 'R1'].forEach((k) => (h += lrow(k, a.piv[k], a)));
  h += lrow('CPR TC', a.tc, a) + lrow('पिवट P', a.p, a) + lrow('CPR BC', a.bc, a);
  ['S1', 'S2', 'S3'].forEach((k) => (h += lrow(k, a.piv[k], a)));
  h += `<div class="sec">Fibonacci (${a.upSwing ? 'लो → हाई, नीचे की ओर रिट्रेसमेंट' : 'हाई → लो, ऊपर की ओर रिट्रेसमेंट'})</div>`;
  a.fib.forEach((f) => (h += lrow(`${(f.r * 100).toFixed(1)}%`, f.v, a)));
  h += `<div class="sec">ओपनिंग रेंज और ${a.hasVol ? 'वॉल्यूम' : 'TPO'} प्रोफ़ाइल</div>` + lrow('ओपनिंग हाई (15मि)', a.ORH, a) + lrow('ओपनिंग लो (15मि)', a.ORL, a) + lrow('VAH', a.VP.VAH, a) + lrow('POC', a.VP.POC, a) + lrow('VAL', a.VP.VAL, a);
  $('levels').innerHTML = h;
}
function renderTab() {
  const a = A[cur], ch = a.ch, cf = a.cf; let h = '';
  if (tab === 'chain') {
    if (!ch.rows.length) { $('tabBody').innerHTML = '<div class="mut">ऑप्शन चेन का डेटा अभी नहीं मिला।</div>'; return; }
    const L = (v) => f1(v / 1e5);
    h = `<div class="tbl"><table><thead><tr><th>OI (लाख)</th><th>OI बदलाव</th><th>IV</th><th>डेल्टा</th><th>CE भाव</th><th>स्ट्राइक</th><th>PE भाव</th><th>डेल्टा</th><th>IV</th><th>OI बदलाव</th><th>OI (लाख)</th></tr></thead><tbody>` +
      ch.view.map((r) => {
        const ci = r.K < a.price ? 'itm' : '', pi = r.K > a.price ? 'itm' : '', cc = r.ce.oi - (r.ce.poi || r.ce.oi), pc = r.pe.oi - (r.pe.poi || r.pe.oi);
        return `<tr class="${r.K === ch.atm ? 'atm' : ''}"><td class="${ci}">${L(r.ce.oi)}</td><td class="${ci} ${cc >= 0 ? 'up' : 'down'}">${sgn(cc)}${L(cc)}</td><td class="${ci}">${f1(r.ce.iv * 100)}</td><td class="${ci}">${f2(r.ce.de)}</td><td class="${ci}">${f2(r.ce.ltp)}</td>
        <td class="k">${r.K}</td><td class="${pi}">${f2(r.pe.ltp)}</td><td class="${pi}">${f2(r.pe.de)}</td><td class="${pi}">${f1(r.pe.iv * 100)}</td><td class="${pi} ${pc >= 0 ? 'up' : 'down'}">${sgn(pc)}${L(pc)}</td><td class="${pi}">${L(r.pe.oi)}</td></tr>`;
      }).join('') + `</tbody></table></div>
      <div class="stats"><div><small>PCR (OI)</small><b>${f2(ch.pcr)}</b></div><div><small>मैक्स पेन</small><b>${f0(ch.mp)}</b></div><div><small>ATM IV</small><b>${f1(ch.atmIV * 100)}%</b></div>
      <div><small>ATM स्ट्रैडल</small><b>${rs(ch.straddle)}</b></div><div><small>अनुमानित रेंज (एक्सपायरी तक)</small><b>${f0(a.price - ch.straddle)} – ${f0(a.price + ch.straddle)}</b></div>
      <div><small>CE OI दीवार (रेज़िस्टेंस)</small><b class="down">${f0(ch.maxCE)}</b></div><div><small>PE OI दीवार (सपोर्ट)</small><b class="up">${f0(ch.maxPE)}</b></div>
      <div><small>ATM गामा / वेगा</small><b>${ch.atmRow ? ch.atmRow.ce.ga.toFixed(4) : '–'} / ${ch.atmRow ? f2(ch.atmRow.ce.ve) : '–'}</b></div><div><small>ATM थीटा / दिन (CE)</small><b class="down">${ch.atmRow ? '₹' + f1(ch.atmRow.ce.th) : '–'}</b></div>
      <div><small>एक्सपायरी · लॉट</small><b>${esc(ch.expiry)} · ${a.lot}</b><br><small>${f1(ch.dte)} दिन बाक़ी</small></div></div>
      <div class="legend" style="margin-top:8px">पीला = इन-द-मनी। ${Source.mode === 'live' ? 'भाव और ग्रीक्स Upstox से।' : 'डेमो: भाव और ग्रीक्स Black-Scholes से।'}</div>`;
  } else if (tab === 'mood') {
    const v = a.vix;
    h = `<div class="stats" style="margin-top:0"><div><small>India VIX</small>${v ? `<span class="vix ${v.v < v.prev ? 'up' : 'down'}">${f2(v.v)}</span><br><small>${v.v < v.prev ? '▼ डर घटा' : '▲ डर बढ़ा'} (कल ${f2(v.prev)})</small>` : '<b>–</b>'}</div>
      <div><small>FII कैश (₹ करोड़)</small><b class="${a.fii > 0 ? 'up' : 'down'}">${ok(a.fii) ? sgn(a.fii) + f0(a.fii) : '–'}</b></div><div><small>DII कैश (₹ करोड़)</small><b class="${a.dii > 0 ? 'up' : 'down'}">${ok(a.dii) ? sgn(a.dii) + f0(a.dii) : '–'}</b></div></div>`;
    if (Source.mode === 'live') h += `<div class="fii"><span class="mut">FII/DII का मुफ़्त API नहीं है। NSE या ख़बरों से आज का आँकड़ा देखकर यहाँ डालें (पिछले दिन का भी चलेगा):</span>
      <div class="ask" style="margin-top:6px"><input id="fiiIn" type="number" placeholder="FII ₹ करोड़ (जैसे -1200)" value="${ok(a.fii) ? a.fii : ''}"><input id="diiIn" type="number" placeholder="DII ₹ करोड़" value="${ok(a.dii) ? a.dii : ''}"><button class="go" onclick="saveFII()">सेव</button></div></div>`;
    h += `<div class="sec" style="margin-top:14px">हैवीवेट शेयर (वज़न अनुमानित)</div>` + (a.hv.length ? `<div class="tbl"><table><thead><tr><th style="text-align:left">शेयर</th><th>वज़न</th><th>बदलाव</th><th>इंडेक्स पर असर</th></tr></thead><tbody>` +
      a.hv.map((x) => `<tr><td style="text-align:left">${esc(x.n)}</td><td>${f1(x.w)}%</td><td class="${x.c >= 0 ? 'up' : 'down'}">${sgn(x.c)}${f2(x.c)}%</td><td class="${x.pts >= 0 ? 'up' : 'down'}">${sgn(x.pts)}${f1(x.pts)} पॉइंट</td></tr>`).join('') +
      `</tbody></table></div><div class="row" style="margin-top:6px"><span>हैवीवेट का भारित बदलाव</span><b class="${a.hvW >= 0 ? 'up' : 'down'}">${sgn(a.hvW)}${f2(a.hvW)}%</b></div>` : '<div class="mut">डेटा नहीं मिला।</div>');
  } else if (tab === 'news') {
    const lb = (s) => (s > 0.15 ? ['b', 'बुलिश'] : s < -0.15 ? ['s', 'बेयरिश'] : ['n', 'न्यूट्रल']);
    if (!a.news.length) h = '<div class="mut">अभी कोई ख़बर नहीं मिली।</div>';
    else {
      const avg = lb(a.newsAvg);
      h = `<div class="row"><span>औसत सेंटिमेंट ${Source.mode === 'live' ? (Source.newsAI(cur) ? '(AI स्कोर)' : '(शब्दों पर आधारित, AI key नहीं)') : '(डेमो)'}</span><span class="pill ${avg[0]}">${avg[1]} (${f2(a.newsAvg)})</span></div>` +
        a.news.map((n) => { const l = lb(n.s); return `<div class="news"><p>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.t)}</a>` : esc(n.t)}</p><small><span class="pill ${l[0]}">${l[1]} ${sgn(n.s)}${n.s.toFixed(1)}</span> · असर: ${esc(n.imp)} · ${esc(n.ago || '')}${n.src ? ' · ' + esc(n.src) : ''}</small></div>`; }).join('');
    }
  } else {
    const lb = { 1: ['b', 'बुलिश'], 0: ['n', 'न्यूट्रल'], '-1': ['s', 'बेयरिश'] }; let g = '';
    h = `<div class="tbl"><table><thead><tr><th style="text-align:left">संकेत</th><th>वैल्यू</th><th>दिशा</th><th>वज़न</th></tr></thead><tbody>` +
      a.sigs.map((x) => { const r = x.g !== g ? `<tr><td colspan="4" style="text-align:left" class="mut">${x.g}</td></tr>` : ''; g = x.g; const l = x.w ? lb[x.s] : ['n', 'शामिल नहीं'];
        return r + `<tr><td style="text-align:left">${esc(x.n)}</td><td>${esc(x.v)}</td><td><span class="pill ${l[0]}">${l[1]}</span></td><td>${x.w}</td></tr>`; }).join('') +
      `</tbody></table></div><div class="legend" style="margin-top:8px">स्कोर = 50 + 50 × (Σ वज़न × दिशा) ÷ Σ वज़न। वज़न 0 वाले संकेत (डेटा न होने पर) स्कोर में नहीं गिने जाते।</div>`;
  }
  $('tabBody').innerHTML = h;
}
function saveFII() { const f = $('fiiIn').value, d = $('diiIn').value; Store.setFII({ fii: f === '' ? null : +f, dii: d === '' ? null : +d }); toast('FII/DII सेव हो गया'); refreshAll(); }

/* ---------- चार्ट ---------- */
function prepCanvas(c) { const ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight; c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); return { ctx, W, H }; }
function drawChart() {
  const a = A[cur]; if (!a) return;
  CI = tf === 5 ? a.I5 : ind(agg(a.D.candles, tf), a.hasVol);
  const I = CI, k = I.k, n = VIEW[tf], s0 = Math.max(0, k.length - n), view = k.slice(s0);
  const { ctx, W, H } = prepCanvas($('chart'));
  const padR = 58, volH = a.hasVol ? H * 0.13 : 0, top = 8, bot = H - volH - 18, pw = W - padR;
  const lines = [];
  if (OV.vwap) lines.push([I.vwap, '#3b82f6']); if (OV.ema20) lines.push([I.ema20, '#a855f7']); if (OV.ema50) lines.push([I.ema50, '#ec4899']);
  if (OV.bb) lines.push([I.bb.up, '#64748b'], [I.bb.mid, '#475569'], [I.bb.lo, '#64748b']);
  let mx = -Infinity, mn = Infinity; view.forEach((x) => { mx = Math.max(mx, x.h); mn = Math.min(mn, x.l); });
  const inc = (arr) => { for (let i = s0; i < k.length; i++) if (arr[i] != null) { mx = Math.max(mx, arr[i]); mn = Math.min(mn, arr[i]); } };
  lines.forEach((l) => inc(l[0])); if (OV.st) inc(I.st.st);
  const pd = (mx - mn) * 0.05 || 1; mx += pd; mn -= pd;
  const y = (v) => top + ((mx - v) / (mx - mn)) * (bot - top), cw = pw / view.length, X = (i) => i * cw + cw / 2;
  ctx.font = '11px system-ui'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = mn + ((mx - mn) * i) / 4, yy = y(v); ctx.strokeStyle = '#1a2540'; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke(); ctx.fillStyle = '#8592ad'; ctx.fillText(f0(v), pw + 4, yy + 4); }
  for (let i = 1; i < view.length; i++) if (view[i].d !== view[i - 1].d) { ctx.strokeStyle = '#334155'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(i * cw, top); ctx.lineTo(i * cw, H - 14); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#8592ad'; ctx.fillText(a.dayLabels[view[i].d] || '', i * cw + 3, top + 10); }
  if (OV.vp) {
    const vp = a.VP, mv = Math.max(...vp.vol) || 1;
    vp.vol.forEach((v, i) => { const p1 = vp.DL + i * vp.bw, p2 = p1 + vp.bw; if (p2 < mn || p1 > mx) return; const y1 = y(Math.min(p2, mx)), y2 = y(Math.max(p1, mn)), len = (v / mv) * pw * 0.25;
      ctx.fillStyle = i === vp.poc ? 'rgba(245,158,11,.45)' : i >= vp.lo && i <= vp.hi ? 'rgba(59,130,246,.22)' : 'rgba(133,146,173,.13)'; ctx.fillRect(pw - len, y1, len, Math.max(1, y2 - y1 - 1)); });
  }
  const lv = [];
  if (OV.cpr) lv.push(['TC', a.tc, '#06b6d4'], ['P', a.p, '#06b6d4'], ['BC', a.bc, '#06b6d4']);
  if (OV.piv) [['R1', '#ef4444'], ['R2', '#ef4444'], ['R3', '#ef4444'], ['S1', '#22c55e'], ['S2', '#22c55e'], ['S3', '#22c55e']].forEach(([nm, c]) => lv.push([nm, a.piv[nm], c]));
  if (OV.fib) a.fib.forEach((f) => lv.push([`Fib ${(f.r * 100).toFixed(1)}%`, f.v, '#f59e0b']));
  if (OV.orb) lv.push(['OR हाई', a.ORH, '#e2e8f0'], ['OR लो', a.ORL, '#e2e8f0']);
  lv.forEach(([nm, v, c]) => { if (v < mn || v > mx) return; const yy = y(v); ctx.strokeStyle = c; ctx.globalAlpha = 0.7; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fillText(nm, 4, yy - 3); });
  view.forEach((q, i) => { const x = X(i), col = q.c >= q.o ? '#22c55e' : '#ef4444'; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, y(q.h)); ctx.lineTo(x, y(q.l)); ctx.stroke(); ctx.fillStyle = col; ctx.fillRect(x - cw * 0.35, y(Math.max(q.o, q.c)), Math.max(1, cw * 0.7), Math.max(1, Math.abs(y(q.o) - y(q.c)))); });
  ctx.lineWidth = 1.6;
  lines.forEach(([arr, c]) => { ctx.strokeStyle = c; ctx.beginPath(); let s = false; for (let i = s0; i < k.length; i++) { if (arr[i] == null) { s = false; continue; } const x = X(i - s0), yy = y(arr[i]); if (!s) { ctx.moveTo(x, yy); s = true; } else ctx.lineTo(x, yy); } ctx.stroke(); });
  if (OV.st) { ctx.lineWidth = 2; for (let i = s0 + 1; i < k.length; i++) { if (I.st.st[i] == null || I.st.st[i - 1] == null || I.st.dir[i] !== I.st.dir[i - 1]) continue; ctx.strokeStyle = I.st.dir[i] === 1 ? '#22c55e' : '#ef4444'; ctx.beginPath(); ctx.moveTo(X(i - 1 - s0), y(I.st.st[i - 1])); ctx.lineTo(X(i - s0), y(I.st.st[i])); ctx.stroke(); } }
  ctx.lineWidth = 1;
  // पेपर पोज़िशन की एंट्री का निशान
  Paper.openTrades().filter((t) => t.key === cur).forEach((t) => { if (t.openIdx < mn || t.openIdx > mx) return; ctx.fillStyle = t.type === 'CE' ? '#22c55e' : '#ef4444'; ctx.fillText(`● ${t.type} एंट्री`, 4, y(t.openIdx) + 12); });
  if (a.hasVol) { const mvv = Math.max(...view.map((x) => x.v)) || 1; view.forEach((q, i) => { const hh = (q.v / mvv) * volH; ctx.fillStyle = q.c >= q.o ? 'rgba(34,197,94,.45)' : 'rgba(239,68,68,.45)'; ctx.fillRect(X(i) - cw * 0.35, H - 14 - hh, Math.max(1, cw * 0.7), hh); }); }
  const lp = view[view.length - 1].c, ly = y(lp);
  ctx.strokeStyle = '#3b82f6'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(pw, ly); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(pw, ly - 9, padR, 18); ctx.fillStyle = '#fff'; ctx.fillText(f0(lp), pw + 4, ly + 4);
  ctx.fillStyle = '#8592ad'; const stp = Math.max(1, Math.ceil(view.length / 5)); for (let i = 0; i < view.length; i += stp) ctx.fillText(hm(view[i].m), X(i) - 14, H - 2);
  drawSub(I, s0);
}
function drawSub(I, s0) {
  const { ctx, W, H } = prepCanvas($('sub')), k = I.k, pw = W - 58, n = k.length - s0, cw = pw / n, X = (i) => i * cw + cw / 2;
  ctx.font = '11px system-ui'; const L = k.length - 1; let mn, mx, txt = '', y;
  const plot = (arr, c, w = 1.5) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); let s = false; for (let i = s0; i < k.length; i++) { if (arr[i] == null) { s = false; continue; } const x = X(i - s0), yy = y(arr[i]); if (!s) { ctx.moveTo(x, yy); s = true; } else ctx.lineTo(x, yy); } ctx.stroke(); };
  const hl = (v, c) => { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(0, y(v)); ctx.lineTo(pw, y(v)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#8592ad'; ctx.fillText(String(v), pw + 4, y(v) + 4); };
  if (sub === 'rsi') { mn = 0; mx = 100; y = (v) => 4 + ((mx - v) / (mx - mn)) * (H - 8); hl(70, '#ef4444'); hl(50, '#334155'); hl(30, '#22c55e'); plot(I.rsi, '#a855f7'); txt = `RSI (14): ${f1(I.rsi[L])}`; }
  else if (sub === 'macd') {
    let m = 0; for (let i = s0; i < k.length; i++) [I.macd.line[i], I.macd.sig[i], I.macd.hist[i]].forEach((v) => { if (v != null) m = Math.max(m, Math.abs(v)); });
    m = m || 1; mn = -m * 1.1; mx = m * 1.1; y = (v) => 4 + ((mx - v) / (mx - mn)) * (H - 8);
    for (let i = s0; i < k.length; i++) { const v = I.macd.hist[i]; if (v == null) continue; ctx.fillStyle = v >= 0 ? 'rgba(34,197,94,.55)' : 'rgba(239,68,68,.55)'; ctx.fillRect(X(i - s0) - cw * 0.35, Math.min(y(0), y(v)), Math.max(1, cw * 0.7), Math.abs(y(v) - y(0))); }
    hl(0, '#334155'); plot(I.macd.line, '#3b82f6'); plot(I.macd.sig, '#f59e0b'); txt = `MACD ${f2(I.macd.line[L])} · सिग्नल ${f2(I.macd.sig[L])} · हिस्टो ${f2(I.macd.hist[L])}`;
  } else {
    mn = 0; mx = 60; for (let i = s0; i < k.length; i++) [I.adx.adx[i], I.adx.pdi[i], I.adx.mdi[i]].forEach((v) => { if (v != null) mx = Math.max(mx, v + 5); });
    y = (v) => 4 + ((mx - v) / (mx - mn)) * (H - 8); hl(20, '#334155'); plot(I.adx.pdi, '#22c55e', 1.2); plot(I.adx.mdi, '#ef4444', 1.2); plot(I.adx.adx, '#e2e8f0', 2);
    txt = `ADX ${f1(I.adx.adx[L])} · +DI ${f1(I.adx.pdi[L])} · −DI ${f1(I.adx.mdi[L])}`;
  }
  $('subVal').textContent = txt;
}
