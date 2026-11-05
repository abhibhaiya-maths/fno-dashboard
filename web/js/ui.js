/* ===== स्क्रीन पर दिखाना: टिकर, सिग्नल ग्लोब, चार्ट, टैब, स्कोर, लेवल, ख़बरें ===== */
const COL = {
  call: '#2EBD85', put: '#F0506E', wait: '#7A8BA6', brass: '#C9A227', text: '#E8E4DA', muted: '#8C94A1', dim: '#5F6875',
  grid: '#232A34', line: '#2A323D', vwap: '#5B8DEF', ema20: '#A78BFA', ema50: '#E879F9', bb: '#6B7686', cpr: '#38BDF8', orb: '#E8E4DA',
};
const FONT = '11px "IBM Plex Sans", "IBM Plex Sans Devanagari", system-ui, sans-serif';
let sub = 'rsi', tab = 'chain', tf = 5, CI = null, newsTab = 'news', lastOrb = null;
const OV = Store.pref('overlays', { vwap: true, ema20: true, ema50: false, bb: false, st: true, fib: true, cpr: true, piv: false, orb: false, vp: false });
const OVL = { vwap: 'VWAP', ema20: 'EMA 20', ema50: 'EMA 50', bb: 'Bollinger', st: 'Supertrend', fib: 'Fibonacci', cpr: 'CPR', piv: 'पिवट', orb: 'ओपनिंग रेंज', vp: 'वॉल्यूम प्रोफ़ाइल' };
const OVC = { vwap: COL.vwap, ema20: COL.ema20, ema50: COL.ema50, bb: COL.bb, st: COL.call, fib: COL.brass, cpr: COL.cpr, piv: COL.muted, orb: COL.text, vp: COL.vwap };
const VIEW = { 1: 90, 5: 75, 15: 50, 60: 21 }, TFL = { 1: '1 मिनट', 5: '5 मिनट', 15: '15 मिनट', 60: '1 घंटा' };
const FIB_KEY = [0.382, 0.5, 0.618];
const ALL_HV = ['HDFC Bank', 'ICICI Bank', 'Reliance', 'Infosys', 'Bharti Airtel', 'L&T', 'ITC', 'TCS', 'SBI', 'Kotak', 'Axis Bank', 'IndusInd', 'Federal Bank', 'AU Bank'];

function dirOf(a) { const s = signalFor(a); return s.state === 'CE' ? 'ce' : s.state === 'PE' ? 'pe' : 'wait'; }
const DIRTXT = { ce: 'कॉल', pe: 'पुट', wait: 'रुकें' };

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
    const a = A[k];
    if (!a) return `<button class="tk"><div><div class="tk-name">${CFG[k].label}</div><div class="tk-px mut">लोड हो रहा है</div></div></button>`;
    const d = dirOf(a);
    return `<button class="tk ${k === cur ? 'active' : ''}" onclick="pick('${k}')" aria-pressed="${k === cur}">
      <div><div class="tk-name">${a.cf.label}</div><div class="tk-px">${f2(a.price)}</div>
      <div class="tk-chg ${a.chg >= 0 ? 'up' : 'down'}">${a.chg >= 0 ? '▲' : '▼'} ${f2(Math.abs(a.price - a.PC))} (${f2(a.chg)}%)</div></div>
      <div class="tk-right"><span class="dirchip ${d}">${DIRTXT[d]} ${a.score}</span>${sparkSVG(a)}</div></button>`;
  }).join('');
  $('clock').textContent = Source.clock().label;
  $('clock').classList.toggle('open', !!(A[cur] && A[cur].sessionLive));
}

/* सिग्नल ग्लोब: कॉल पर हरा, पुट पर लाल, बाक़ी समय शांत */
function renderOrb() {
  const a = A[cur], o = $('orb'); if (!a) return;
  const d = dirOf(a);
  o.classList.remove('ce', 'pe', 'wait'); o.classList.add(d);
  $('orbDir').textContent = DIRTXT[d];
  $('orbSub').textContent = `${a.cf.label}  ${a.score}/100`;
  o.setAttribute('aria-label', `${a.cf.label}: ${DIRTXT[d]}, स्कोर ${a.score}`);
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
  $('ovChips').innerHTML = Object.keys(OV).map((k) => `<button class="chip ${OV[k] ? 'on' : ''}" onclick="togOV('${k}')" aria-pressed="${OV[k]}"><span class="sw" style="background:${OVC[k]}"></span>${k === 'vwap' && !a.hasVol ? 'TWAP' : k === 'vp' && !a.hasVol ? 'TPO प्रोफ़ाइल' : OVL[k]}</button>`).join('');
  $('subBtns').innerHTML = [['rsi', 'RSI'], ['macd', 'MACD'], ['adx', 'ADX']].map(([k, l]) => `<button class="btn ${k === sub ? 'on' : ''}" onclick="setSub('${k}')">${l}</button>`).join('');
  $('chartTitle').textContent = `${a.cf.label}, ${TFL[tf]} चार्ट`;
  $('tabs').innerHTML = [['chain', 'ऑप्शन चेन'], ['mood', 'मार्केट मूड'], ['sig', 'सभी 20 संकेत']].map(([k, l]) => `<button class="btn ${k === tab ? 'on' : ''}" onclick="setTab('${k}')">${l}</button>`).join('');
  $('newsTabs').innerHTML = [['news', 'ख़बरें'], ['results', 'तिमाही नतीजे']].map(([k, l]) => `<button class="btn ${k === newsTab ? 'on' : ''}" onclick="setNewsTab('${k}')">${l}</button>`).join('');
  const cf = a.cf;
  $('qchips').innerHTML = [`${cf.voice} ${a.ch.atm} कॉल लूँ क्या?`, `${cf.voice} ${a.ch.atm} पुट लूँ क्या?`, 'मेरी पोज़िशन होल्ड करूँ या एग्जिट?']
    .map((t) => `<button class="chip" onclick="$('q').value='${t}';Voice.ask()">${t}</button>`).join('');
}

/* स्कोर: आधा-गोल मीटर */
function gaugeSVG(s) {
  const cx = 85, cy = 88, r = 70, P = (v) => { const t = Math.PI * (1 - v / 100); return [cx + r * Math.cos(t), cy - r * Math.sin(t)]; };
  const arc = (a, b, c) => { const [x1, y1] = P(a), [x2, y2] = P(b); return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${c}" stroke-width="10" fill="none" stroke-linecap="butt"/>`; };
  const t = Math.PI * (1 - s / 100), nx = cx + (r - 18) * Math.cos(t), ny = cy - (r - 18) * Math.sin(t);
  const ticks = [42, 58].map((v) => { const t2 = Math.PI * (1 - v / 100); return `<line x1="${(cx + (r - 9) * Math.cos(t2)).toFixed(1)}" y1="${(cy - (r - 9) * Math.sin(t2)).toFixed(1)}" x2="${(cx + (r + 9) * Math.cos(t2)).toFixed(1)}" y2="${(cy - (r + 9) * Math.sin(t2)).toFixed(1)}" stroke="#181D25" stroke-width="2"/>`; }).join('');
  return `<svg viewBox="0 0 170 100" role="img" aria-label="स्कोर ${s}">
    ${arc(0, 42, COL.put)}${arc(42, 58, COL.wait)}${arc(58, 100, COL.call)}${ticks}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${COL.text}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="5" fill="${COL.text}"/>
    <text x="8" y="99" fill="${COL.muted}" font-size="10" font-family="IBM Plex Sans Devanagari, sans-serif">पुट</text>
    <text x="162" y="99" fill="${COL.muted}" font-size="10" text-anchor="end" font-family="IBM Plex Sans Devanagari, sans-serif">कॉल</text></svg>`;
}
function renderScore() {
  const a = A[cur], s = a.score;
  $('gauge').innerHTML = gaugeSVG(s);
  $('score').textContent = s; $('score').className = 'score ' + (s >= 58 ? 'up' : s <= 42 ? 'down' : '');
  $('verdict').textContent = s >= 65 ? 'ज़्यादातर संकेत कॉल की तरफ़' : s >= 58 ? 'संकेत हल्के कॉल की तरफ़' : s <= 35 ? 'ज़्यादातर संकेत पुट की तरफ़' : s <= 42 ? 'संकेत हल्के पुट की तरफ़' : 'मिले-जुले संकेत';
  $('scoreSub').textContent = `${a.active} संकेतों का भारित स्कोर, हर 5 सेकंड अपडेट`;
  const act = a.sigs.filter((x) => x.w > 0), b = act.filter((x) => x.s > 0).length, n = act.filter((x) => x.s === 0).length, d = act.filter((x) => x.s < 0).length;
  $('counts').innerHTML = `<div class="up"><b>${b}</b>बुलिश</div><div><b>${n}</b>न्यूट्रल</div><div class="down"><b>${d}</b>बेयरिश</div>`;
}
function renderSetup() {
  const a = A[cur], s = a.score, dir = s >= 58 ? 'CE' : s <= 42 ? 'PE' : null; let h = '';
  if (!dir) h += `<div class="dirbox n">अभी कोई साफ़ सेटअप नहीं<br><small>स्कोर ${s}। इंतज़ार करना भी एक पोज़िशन है।</small></div>`;
  else {
    const t = setupFor(a, dir);
    h += `<div class="dirbox ${dir === 'CE' ? 'b' : 's'}">${dir === 'CE' ? 'कॉल' : 'पुट'} की तरफ़ झुकाव, ${t.K} ${dir}</div>
      <div class="sec">इंडेक्स लेवल</div><div class="lv"><div><small>एंट्री</small><b>${f0(t.e)}</b></div><div><small>स्टॉप-लॉस</small><b class="down">${f0(t.sl)}</b></div><div><small>टारगेट 1 / 2</small><b class="up">${f0(t.t1)} / ${f0(t.t2)}</b></div></div>
      <div class="sec">ऑप्शन प्रीमियम</div><div class="lv"><div><small>प्रीमियम</small><b>${rs(t.P)}</b></div><div><small>प्रीमियम SL</small><b class="down">${rs(t.pSL)}</b></div><div><small>प्रीमियम T1</small><b class="up">${rs(t.pT1)}</b></div></div>
      <div class="row"><span>रिस्क : रिवॉर्ड</span><b>1 : 1.5 और 1 : 2.5</b></div><div class="row"><span>स्टॉप-लॉस का आधार</span><span>1.5 × ATR (5 मिनट) = ${f0(t.risk)} पॉइंट</span></div>`;
  }
  h += alertsFor(a, dir).map(([c, t]) => `<div class="alert ${c === 'd' ? 'd' : c === 'i' ? 'i' : ''}">${t}</div>`).join('');
  $('setup').innerHTML = h;
}
function lrow(n, v, a, key) { const near = Math.abs(v - a.price) < a.atr * 0.5; return `<div class="row"><span class="${key ? 'lvl-key' : ''}">${n}</span><b class="${near ? 'cur' : v > a.price ? 'down' : 'up'}">${f1(v)}${near ? ' ◀ पास' : ''}</b></div>`; }
function renderLevels() {
  const a = A[cur];
  let h = `<div class="row"><span>मौजूदा भाव</span><b class="cur">${f1(a.price)}</b></div><div class="row"><span>ATR (14, 5 मिनट)</span><b>${f1(a.atr)}</b></div>`;
  h += '<div class="sec">पिवट और CPR, पिछले सत्र से</div>';
  ['R3', 'R2', 'R1'].forEach((k) => (h += lrow(k, a.piv[k], a)));
  h += lrow('CPR TC', a.tc, a) + lrow('पिवट P', a.p, a, true) + lrow('CPR BC', a.bc, a);
  ['S1', 'S2', 'S3'].forEach((k) => (h += lrow(k, a.piv[k], a)));
  h += `<div class="sec">Fibonacci रिट्रेसमेंट, आज के ${a.upSwing ? 'लो से हाई' : 'हाई से लो'} पर</div>`;
  a.fib.forEach((f) => (h += lrow(`${(f.r * 100).toFixed(1)}%${f.r === 0.5 || f.r === 0.618 ? ' (गोल्डन ज़ोन)' : ''}`, f.v, a, FIB_KEY.includes(f.r))));
  h += `<div class="legend">● वाले लेवल (38.2%, 50%, 61.8%) सबसे अहम माने जाते हैं।</div>`;
  h += `<div class="sec">ओपनिंग रेंज और ${a.hasVol ? 'वॉल्यूम' : 'TPO'} प्रोफ़ाइल</div>` + lrow('ओपनिंग हाई (15 मिनट)', a.ORH, a) + lrow('ओपनिंग लो (15 मिनट)', a.ORL, a) + lrow('VAH', a.VP.VAH, a) + lrow('POC', a.VP.POC, a, true) + lrow('VAL', a.VP.VAL, a);
  $('levels').innerHTML = h;
}
function renderTab() {
  const a = A[cur], ch = a.ch; let h = '';
  if (tab === 'chain') {
    if (!ch.rows.length) { $('tabBody').innerHTML = '<div class="mut">ऑप्शन चेन का डेटा अभी नहीं मिला। Upstox कनेक्शन देखें।</div>'; return; }
    const L = (v) => f1(v / 1e5), mxOI = Math.max(...ch.view.map((r) => Math.max(r.ce.oi, r.pe.oi))) || 1;
    const bar = (v, c) => `<span class="oibar" style="width:${Math.round((v / mxOI) * 46)}px;background:${c}"></span>`;
    h = `<div class="tbl"><table><thead><tr><th>CE OI (लाख)</th><th>OI बदलाव</th><th>IV</th><th>डेल्टा</th><th>CE भाव</th><th class="k">स्ट्राइक</th><th class="l">PE भाव</th><th class="l">डेल्टा</th><th class="l">IV</th><th class="l">OI बदलाव</th><th class="l">PE OI (लाख)</th></tr></thead><tbody>` +
      ch.view.map((r) => {
        const ci = r.K < a.price ? 'itm' : '', pi = r.K > a.price ? 'itm' : '', cc = r.ce.oi - (r.ce.poi || r.ce.oi), pc = r.pe.oi - (r.pe.poi || r.pe.oi);
        return `<tr class="${r.K === ch.atm ? 'atm' : ''}"><td class="${ci}">${bar(r.ce.oi, COL.put)}${L(r.ce.oi)}</td><td class="${ci} ${cc >= 0 ? 'up' : 'down'}">${sgn(cc)}${L(cc)}</td><td class="${ci}">${f1(r.ce.iv * 100)}</td><td class="${ci}">${f2(r.ce.de)}</td><td class="${ci}">${f2(r.ce.ltp)}</td>
        <td class="k">${r.K}</td><td class="l ${pi}">${f2(r.pe.ltp)}</td><td class="l ${pi}">${f2(r.pe.de)}</td><td class="l ${pi}">${f1(r.pe.iv * 100)}</td><td class="l ${pi} ${pc >= 0 ? 'up' : 'down'}">${sgn(pc)}${L(pc)}</td><td class="l ${pi}">${L(r.pe.oi)} ${bar(r.pe.oi, COL.call)}</td></tr>`;
      }).join('') + `</tbody></table></div>
      <div class="stats"><div><small>PCR (OI)</small><b>${f2(ch.pcr)}</b></div><div><small>मैक्स पेन</small><b>${f0(ch.mp)}</b></div><div><small>ATM IV</small><b>${f1(ch.atmIV * 100)}%</b></div>
      <div><small>ATM स्ट्रैडल</small><b>${rs(ch.straddle)}</b></div><div><small>एक्सपायरी तक अनुमानित रेंज</small><b>${f0(a.price - ch.straddle)} से ${f0(a.price + ch.straddle)}</b></div>
      <div><small>CE OI दीवार (रेज़िस्टेंस)</small><b class="down">${f0(ch.maxCE)}</b></div><div><small>PE OI दीवार (सपोर्ट)</small><b class="up">${f0(ch.maxPE)}</b></div>
      <div><small>ATM गामा / वेगा</small><b>${ch.atmRow ? ch.atmRow.ce.ga.toFixed(4) : '–'} / ${ch.atmRow ? f2(ch.atmRow.ce.ve) : '–'}</b></div><div><small>ATM थीटा प्रति दिन (CE)</small><b class="down">${ch.atmRow ? '₹' + f1(ch.atmRow.ce.th) : '–'}</b></div>
      <div><small>एक्सपायरी, लॉट</small><b>${esc(ch.expiry)}, ${a.lot}</b><br><small>${f1(ch.dte)} दिन बाक़ी</small></div></div>
      <div class="legend">हल्की छाया वाले सेल इन-द-मनी हैं। लाल पट्टी = कॉल राइटर्स की दीवार, हरी पट्टी = पुट राइटर्स की दीवार। ${Source.mode === 'live' ? 'भाव और ग्रीक्स Upstox से।' : 'डेमो: भाव और ग्रीक्स Black-Scholes से।'}</div>`;
  } else if (tab === 'mood') {
    const v = a.vix;
    h = `<div class="stats" style="margin-top:0"><div><small>India VIX</small>${v ? `<span class="vix ${v.v < v.prev ? 'up' : 'down'}">${f2(v.v)}</span><br><small>${v.v < v.prev ? '▼ डर घटा' : '▲ डर बढ़ा'}, कल ${f2(v.prev)}</small>` : '<b>–</b>'}</div>
      <div><small>FII कैश (₹ करोड़)</small><b class="${a.fii > 0 ? 'up' : 'down'}">${ok(a.fii) ? sgn(a.fii) + f0(a.fii) : '–'}</b></div><div><small>DII कैश (₹ करोड़)</small><b class="${a.dii > 0 ? 'up' : 'down'}">${ok(a.dii) ? sgn(a.dii) + f0(a.dii) : '–'}</b></div></div>`;
    if (Source.mode === 'live') h += `<div class="fii"><span class="mut">FII/DII का मुफ़्त API नहीं है। NSE या ख़बरों से आज का आँकड़ा देखकर यहाँ डालें:</span>
      <div class="frow"><input id="fiiIn" type="number" placeholder="FII ₹ करोड़, जैसे -1200" value="${ok(a.fii) ? a.fii : ''}"><input id="diiIn" type="number" placeholder="DII ₹ करोड़" value="${ok(a.dii) ? a.dii : ''}"><button class="go" onclick="saveFII()">सेव करें</button></div></div>`;
    h += `<div class="sec" style="margin-top:16px">हैवीवेट शेयर (वज़न अनुमानित)</div>` + (a.hv.length ? `<div class="tbl"><table><thead><tr><th class="l">शेयर</th><th>वज़न</th><th>बदलाव</th><th>इंडेक्स पर असर</th></tr></thead><tbody>` +
      a.hv.map((x) => `<tr><td class="l">${esc(x.n)}</td><td>${f1(x.w)}%</td><td class="${x.c >= 0 ? 'up' : 'down'}">${sgn(x.c)}${f2(x.c)}%</td><td class="${x.pts >= 0 ? 'up' : 'down'}">${sgn(x.pts)}${f1(x.pts)} पॉइंट</td></tr>`).join('') +
      `</tbody></table></div><div class="row" style="margin-top:6px"><span>हैवीवेट का भारित बदलाव</span><b class="${a.hvW >= 0 ? 'up' : 'down'}">${sgn(a.hvW)}${f2(a.hvW)}%</b></div>` : '<div class="mut">डेटा नहीं मिला।</div>');
  } else {
    const lb = { 1: ['b', 'बुलिश'], 0: ['n', 'न्यूट्रल'], '-1': ['s', 'बेयरिश'] }; let g = '';
    h = `<div class="tbl"><table><thead><tr><th class="l">संकेत</th><th>वैल्यू</th><th>दिशा</th><th>वज़न</th></tr></thead><tbody>` +
      a.sigs.map((x) => { const r = x.g !== g ? `<tr><td colspan="4" class="l mut" style="padding-top:12px">${x.g}</td></tr>` : ''; g = x.g; const l = x.w ? lb[x.s] : ['n', 'शामिल नहीं'];
        return r + `<tr><td class="l">${esc(x.n)}</td><td>${esc(x.v)}</td><td><span class="pill ${l[0]}">${l[1]}</span></td><td>${x.w}</td></tr>`; }).join('') +
      `</tbody></table></div><div class="legend">स्कोर = 50 + 50 × (Σ वज़न × दिशा) ÷ Σ वज़न। ये सारे संकेत बिना कोई बटन दबाए हर 5 सेकंड पर अपने-आप दोबारा जाँचे जाते हैं। जिनका डेटा नहीं मिला, वो स्कोर में नहीं गिने जाते।</div>`;
  }
  $('tabBody').innerHTML = h;
}

/* ख़बरें और तिमाही नतीजे */
const sentLb = (s) => (s > 0.15 ? ['b', 'बुलिश'] : s < -0.15 ? ['s', 'बेयरिश'] : ['n', 'न्यूट्रल']);
function renderNews() {
  const a = A[cur]; let h = '';
  if (newsTab === 'news') {
    if (!a.news.length) h = '<div class="mut">अभी कोई ख़बर नहीं मिली। हर 10 मिनट पर फिर से जाँचा जाएगा।</div>';
    else {
      const pos = ((clamp(a.newsAvg, -1, 1) + 1) / 2) * 100, avg = sentLb(a.newsAvg);
      h = `<div class="row" style="border:0;padding-bottom:0"><span>${a.cf.label} पर ख़बरों का असर ${Source.mode === 'live' ? (Source.newsAI(cur) ? '(AI स्कोर)' : '(शब्दों पर आधारित)') : '(डेमो)'}</span><span class="pill ${avg[0]}">${avg[1]} ${f2(a.newsAvg)}</span></div>
        <div class="sentbar"><i style="left:calc(${pos}% - 1px)"></i></div>` +
        a.news.slice(0, 8).map((n) => { const l = sentLb(n.s); return `<div class="news"><p>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.t)}</a>` : esc(n.t)}</p><div class="meta"><span class="pill ${l[0]}">${l[1]} ${sgn(n.s)}${n.s.toFixed(1)}</span><span>असर ${esc(n.imp)}</span><span>${esc(n.ago || '')}</span>${n.src ? `<span>${esc(n.src)}</span>` : ''}</div></div>`; }).join('');
    }
  } else {
    const R = Source.results ? Source.results() : { items: [] };
    if (!R.items.length) h = '<div class="mut">पिछले 3 दिन में तिमाही नतीजों की कोई ख़बर नहीं मिली।</div>';
    else {
      h = `<div class="legend" style="margin:0 0 6px">Q2/Q3 जैसे तिमाही नतीजे, पिछले 3 दिन। ${R.ai ? 'AI ने बेहतर या कमज़ोर का अंदाज़ा लगाया है।' : ''}</div>` + R.items.slice(0, 10).map((n) => {
        const l = n.s > 0.15 ? ['b', 'बेहतर'] : n.s < -0.15 ? ['s', 'कमज़ोर'] : ['n', 'मिला-जुला'];
        const hv = n.co && ALL_HV.some((x) => n.co.toLowerCase().includes(x.toLowerCase().split(' ')[0]));
        return `<div class="news"><div class="res-co">${esc(n.co || 'कंपनी')}${n.q ? `<span class="pill n">${esc(n.q)}</span>` : ''}${hv ? '<span class="pill g">इंडेक्स हैवीवेट</span>' : ''}</div>
          <p>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.t)}</a>` : esc(n.t)}</p><div class="meta"><span class="pill ${l[0]}">${l[1]}</span><span>${esc(n.ago || '')}</span>${n.src ? `<span>${esc(n.src)}</span>` : ''}</div></div>`;
      }).join('');
    }
  }
  $('newsBody').innerHTML = h;
}
function setNewsTab(k) { newsTab = k; renderControls(); renderNews(); }
function saveFII() { const f = $('fiiIn').value, d = $('diiIn').value; Store.setFII({ fii: f === '' ? null : +f, dii: d === '' ? null : +d }); toast('FII/DII सेव हो गया'); refreshAll(); }

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
  const pd = (mx - mn) * 0.05 || 1; mx += pd; mn -= pd;
  const y = (v) => top + ((mx - v) / (mx - mn)) * (bot - top), cw = pw / view.length, X = (i) => i * cw + cw / 2;
  ctx.font = FONT; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) { const v = mn + ((mx - mn) * i) / 5, yy = Math.round(y(v)) + 0.5; ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke(); ctx.fillStyle = COL.muted; ctx.fillText(f0(v), pw + 6, yy + 4); }
  for (let i = 1; i < view.length; i++) if (view[i].d !== view[i - 1].d) { ctx.strokeStyle = COL.line; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(i * cw, top); ctx.lineTo(i * cw, H - 16); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.muted; ctx.fillText(a.dayLabels[view[i].d] || '', i * cw + 4, top + 10); }
  if (OV.vp) {
    const vp = a.VP, mv = Math.max(...vp.vol) || 1;
    vp.vol.forEach((v, i) => { const p1 = vp.DL + i * vp.bw, p2 = p1 + vp.bw; if (p2 < mn || p1 > mx) return; const y1 = y(Math.min(p2, mx)), y2 = y(Math.max(p1, mn)), len = (v / mv) * pw * 0.22;
      ctx.fillStyle = i === vp.poc ? 'rgba(201,162,39,.4)' : i >= vp.lo && i <= vp.hi ? 'rgba(91,141,239,.2)' : 'rgba(140,148,161,.12)'; ctx.fillRect(pw - len, y1, len, Math.max(1, y2 - y1 - 1)); });
  }
  const later = []; // लेबल सबसे आख़िर में, ताकि कैंडल्स उन्हें न ढकें
  // Fibonacci का गोल्डन ज़ोन (50% से 61.8%)
  if (OV.fib) {
    const g1 = a.fib.find((f) => f.r === 0.5).v, g2 = a.fib.find((f) => f.r === 0.618).v;
    const ya = y(Math.max(g1, g2)), yb = y(Math.min(g1, g2));
    if (yb > top && ya < bot) { ctx.fillStyle = 'rgba(201,162,39,.10)'; ctx.fillRect(0, Math.max(top, ya), pw, Math.min(bot, yb) - Math.max(top, ya)); later.push(['गोल्डन ज़ोन', pw - 70, Math.max(top, ya) + 12, COL.brass]); }
  }
  const lv = [];
  if (OV.cpr) lv.push(['TC', a.tc, COL.cpr, 1], ['P', a.p, COL.cpr, 1], ['BC', a.bc, COL.cpr, 1]);
  if (OV.piv) [['R1', COL.put], ['R2', COL.put], ['R3', COL.put], ['S1', COL.call], ['S2', COL.call], ['S3', COL.call]].forEach(([nm, c]) => lv.push([nm, a.piv[nm], c, 1]));
  if (OV.fib) a.fib.forEach((f) => lv.push([`Fib ${(f.r * 100).toFixed(1)}%`, f.v, COL.brass, FIB_KEY.includes(f.r) ? 1.6 : 0.8]));
  if (OV.orb) lv.push(['OR हाई', a.ORH, COL.text, 1], ['OR लो', a.ORL, COL.text, 1]);
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
  later.forEach(([t, x, yy, c]) => { const tw = ctx.measureText(t).width; ctx.fillStyle = 'rgba(24,29,37,.88)'; ctx.fillRect(x - 3, yy - 10, tw + 6, 13); ctx.fillStyle = c; ctx.fillText(t, x, yy); });
  Paper.openTrades().filter((t) => t.key === cur).forEach((t) => { if (t.openIdx < mn || t.openIdx > mx) return; const yy = y(t.openIdx); ctx.fillStyle = t.type === 'CE' ? COL.call : COL.put; ctx.beginPath(); ctx.arc(8, yy, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillText(`${t.type} एंट्री`, 16, yy + 4); });
  if (a.hasVol) { const mvv = Math.max(...view.map((x) => x.v)) || 1; view.forEach((q, i) => { const hh = (q.v / mvv) * volH; ctx.fillStyle = q.c >= q.o ? 'rgba(46,189,133,.4)' : 'rgba(240,80,110,.4)'; ctx.fillRect(X(i) - cw * 0.34, H - 16 - hh, Math.max(1, cw * 0.68), hh); }); }
  const lp = view[view.length - 1].c, ly = Math.round(y(lp)) + 0.5, lc = lp >= a.PC ? COL.call : COL.put;
  ctx.strokeStyle = lc; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(pw, ly); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = lc; ctx.fillRect(pw, ly - 10, padR, 20); ctx.fillStyle = '#0d1116'; ctx.font = '600 ' + FONT; ctx.fillText(f0(lp), pw + 6, ly + 4); ctx.font = FONT;
  ctx.fillStyle = COL.muted; const stp = Math.max(1, Math.ceil(view.length / 6)); for (let i = 0; i < view.length; i += stp) ctx.fillText(hm(view[i].m), X(i) - 14, H - 3);
  drawSub(I, s0);
}
function drawSub(I, s0) {
  const { ctx, W, H } = prepCanvas($('sub')), k = I.k, pw = W - 62, n = k.length - s0, cw = pw / n, X = (i) => i * cw + cw / 2;
  ctx.font = FONT; const L = k.length - 1; let mn, mx, txt = '', y;
  const plot = (arr, c, w = 1.5) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); let s = false; for (let i = s0; i < k.length; i++) { if (arr[i] == null) { s = false; continue; } const x = X(i - s0), yy = y(arr[i]); if (!s) { ctx.moveTo(x, yy); s = true; } else ctx.lineTo(x, yy); } ctx.stroke(); };
  const hl = (v, c) => { const yy = Math.round(y(v)) + 0.5; ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(pw, yy); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.muted; ctx.fillText(String(v), pw + 6, yy + 4); };
  if (sub === 'rsi') {
    mn = 0; mx = 100; y = (v) => 4 + ((mx - v) / (mx - mn)) * (H - 8);
    ctx.fillStyle = 'rgba(140,148,161,.06)'; ctx.fillRect(0, y(70), pw, y(30) - y(70));
    hl(70, COL.put); hl(50, COL.line); hl(30, COL.call); plot(I.rsi, COL.ema20); txt = `RSI (14): ${f1(I.rsi[L])}`;
  } else if (sub === 'macd') {
    let m = 0; for (let i = s0; i < k.length; i++) [I.macd.line[i], I.macd.sig[i], I.macd.hist[i]].forEach((v) => { if (v != null) m = Math.max(m, Math.abs(v)); });
    m = m || 1; mn = -m * 1.1; mx = m * 1.1; y = (v) => 4 + ((mx - v) / (mx - mn)) * (H - 8);
    for (let i = s0; i < k.length; i++) { const v = I.macd.hist[i]; if (v == null) continue; ctx.fillStyle = v >= 0 ? 'rgba(46,189,133,.5)' : 'rgba(240,80,110,.5)'; ctx.fillRect(X(i - s0) - cw * 0.34, Math.min(y(0), y(v)), Math.max(1, cw * 0.68), Math.abs(y(v) - y(0))); }
    hl(0, COL.line); plot(I.macd.line, COL.vwap); plot(I.macd.sig, COL.brass); txt = `MACD ${f2(I.macd.line[L])}, सिग्नल ${f2(I.macd.sig[L])}, हिस्टोग्राम ${f2(I.macd.hist[L])}`;
  } else {
    mn = 0; mx = 60; for (let i = s0; i < k.length; i++) [I.adx.adx[i], I.adx.pdi[i], I.adx.mdi[i]].forEach((v) => { if (v != null) mx = Math.max(mx, v + 5); });
    y = (v) => 4 + ((mx - v) / (mx - mn)) * (H - 8); hl(20, COL.line); plot(I.adx.pdi, COL.call, 1.2); plot(I.adx.mdi, COL.put, 1.2); plot(I.adx.adx, COL.text, 2);
    txt = `ADX ${f1(I.adx.adx[L])}, +DI ${f1(I.adx.pdi[L])}, −DI ${f1(I.adx.mdi[L])}`;
  }
  $('subVal').textContent = txt;
}
