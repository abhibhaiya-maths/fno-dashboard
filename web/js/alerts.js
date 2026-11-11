/* ===== Alerts: your own price levels + a shock detector =====
   Works while the dashboard is open (also on the phone with the screen on). Spoken in Hindi, beeps, a red banner.
   1. Price alerts: "tell me when Nifty crosses 25,600" or "Reliance falls below 1,400". Once, or repeat every 10 minutes.
   2. Shock detector: a sudden giant candle, a fast 3-minute move, an India VIX jump, or a fresh high-impact headline,
      on any instrument on screen. If you hold a paper position against the move, it says so first.
   Advice only: it never opens, closes or changes a trade or a signal. */
const Alerts = (() => {
  const $a = (id) => document.getElementById(id);
  const list = () => Store.pref('price_alerts', []);
  const save = (L) => Store.setPref('price_alerts', L);
  const sens = () => Store.pref('shock_sens', 'normal');
  const cool = {}, vixHist = [], seenNews = new Set(), log = [];
  let timer = null, started = false;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const voice = (k) => (CFG[k] ? CFG[k].voice || CFG[k].label : k);
  const fmt = (v) => (v >= 1000 ? f1(v) : f2(v));

  /* ---------- the banner ---------- */
  function banner(kind, text, k) {
    let el = $a('shockBar');
    if (!el) { el = document.createElement('div'); el.id = 'shockBar'; el.className = 'shockbar'; el.setAttribute('role', 'alert'); document.body.appendChild(el); }
    el.className = 'shockbar on ' + kind;
    el.innerHTML = `<span>${esc(text)}</span>${k && A[k] ? `<button class="btn-ghost" onclick="Alerts.hide();pick('${esc(k)}');Report.open('${esc(k)}')">Report card</button>` : ''}<button class="x" onclick="Alerts.hide()" aria-label="Close">✕</button>`;
    clearTimeout(banner._t); banner._t = setTimeout(hide, 90000);
  }
  function hide() { const el = $a('shockBar'); if (el) el.classList.remove('on'); }
  function note(kind, text, hi, k) {
    log.unshift({ ts: Date.now(), kind, text }); if (log.length > 30) log.length = 30;
    banner(kind, text, k); beep(kind === 'shock' ? 330 : 700); toast(text);
    if (typeof Paper !== 'undefined' && Paper.speak) Paper.speak('imp', 'al' + kind + text.slice(0, 40), hi); else Voice.say(hi);
    if ($a('al') && $a('al').classList.contains('on')) render();
  }

  /* ---------- 1. price alerts ---------- */
  function checkPrices() {
    const L = list(); let changed = false;
    L.forEach((x) => {
      const a = A[x.k]; if (!a || !ok(a.price) || x.done) return;
      const hit = x.dir === 'above' ? a.price >= x.level : a.price <= x.level; if (!hit) return;
      if (x.last && Date.now() - x.last < 10 * 60e3) return;
      x.last = Date.now(); x.n = (x.n || 0) + 1; if (!x.repeat) x.done = true; changed = true;
      note('price', `🔔 ${a.cf.label} ${x.dir === 'above' ? 'crossed above' : 'fell below'} ${fmt(x.level)} (now ${fmt(a.price)})${x.note ? ': ' + x.note : ''}`,
        `${voice(x.k)} ${Math.round(x.level)} के ${x.dir === 'above' ? 'ऊपर गया' : 'नीचे आया'}, अभी ${Math.round(a.price)}।${x.note ? ' ' + x.note : ''}`, x.k);
    });
    if (changed) save(L);
  }
  function add() {
    const k = $a('alK').value, a = A[k], dir = $a('alDir').value, level = +$a('alLv').value, nt = ($a('alNote').value || '').trim().slice(0, 80), rep = $a('alRep').checked;
    if (!a) return toast('Data not loaded yet.');
    if (!(level > 0)) return toast('Enter a price.');
    if (dir === 'above' ? a.price >= level : a.price <= level) return toast(`${a.cf.label} is already ${dir} ${fmt(level)} (now ${fmt(a.price)}). Pick a level it hasn't reached.`);
    const L = list(); if (L.length >= 40) return toast('40 alerts is the limit. Remove some first.');
    L.unshift({ id: uid(), k, label: a.cf.label, dir, level, note: nt, repeat: rep, ts: Date.now() }); save(L);
    $a('alLv').value = ''; $a('alNote').value = ''; render(); toast(`Alert set: ${a.cf.label} ${dir} ${fmt(level)}`);
  }
  function quick(k, dir, level, nt) {
    const a = A[k]; if (!a) return;
    const L = list(); L.unshift({ id: uid(), k, label: a.cf.label, dir, level: Math.round(level * 100) / 100, note: nt, repeat: false, ts: Date.now() }); save(L); render(); toast(`Alert set: ${a.cf.label} ${dir} ${fmt(level)}`);
  }
  function del(id) { save(list().filter((x) => x.id !== id)); render(); }
  function rearm(id) { const L = list(), x = L.find((y) => y.id === id); if (x) { x.done = false; x.last = 0; save(L); render(); } }

  /* ---------- 2. shock detector ---------- */
  function fire(k, type, dir, text, hi) {
    const ck = k + type + dir, ck2 = k + 'any' + dir; // one warning per instrument per move, even if several checks see it
    if ((cool[ck] && Date.now() - cool[ck] < 10 * 60e3) || (cool[ck2] && Date.now() - cool[ck2] < 60e3)) return; cool[ck] = cool[ck2] = Date.now();
    // your paper positions on this instrument against the move come first
    const op = typeof Paper !== 'undefined' ? Paper.openTrades().filter((t) => t.key === k && ((t.type === 'CE' && dir < 0) || (t.type === 'PE' && dir > 0))) : [];
    if (op.length) { text = `⚠ Your ${op.map((t) => `${t.K} ${t.type}`).join(', ')} is at risk. ${text} Tighten the stop-loss.`; hi = `आपकी ${op[0].type === 'CE' ? 'कॉल' : 'पुट'} पोज़िशन ख़तरे में है। ${hi} स्टॉप-लॉस कड़ा करें।`; }
    note('shock', text, hi, k);
  }
  function checkShocks() {
    const S = sens(); if (S === 'off') return;
    const f = S === 'sensitive' ? 0.75 : 1;
    for (const k of KEYS) {
      const a = A[k]; if (!a || !a.sessionLive || !ok(a.price)) continue;
      const today = a.D.candles.filter((c) => c.d === 2); if (today.length < 6) continue;
      const idx = a.cf.core || a.cf.kind === 'INDEX', mcx = a.cf.exch === 'MCX';
      const thr3 = (k === 'BANKNIFTY' ? 0.0045 : idx ? 0.0035 : mcx ? 0.008 : 0.01) * f;
      // fast 3-minute move
      const back = today.filter((c) => c.m <= a.curMin - 3).pop();
      if (back) { const mv = a.price / back.c - 1; if (Math.abs(mv) >= thr3) fire(k, 'move', Math.sign(mv), `⚡ ${a.cf.label} ${mv > 0 ? 'jumped' : 'fell'} ${mv > 0 ? '+' : ''}${(mv * 100).toFixed(2)}% in 3 minutes (now ${fmt(a.price)}).`, `${voice(k)} में अचानक ${mv > 0 ? 'तेज़ी' : 'गिरावट'}, तीन मिनट में ${Math.abs(mv * 100).toFixed(1).replace('.', ' दशमलव ')} प्रतिशत।`); }
      // a giant one-minute candle
      const last = today[today.length - 1], rng = last.h - last.l, base = (a.short && a.short.atr) || null;
      if (base && rng >= 3.5 * base * f && rng / a.price >= (idx ? 0.0015 : 0.004) * f) { const dir = last.c >= last.o ? 1 : -1; fire(k, 'bar', dir, `⚡ ${a.cf.label}: a sudden ${dir > 0 ? 'green' : 'red'} candle ${(rng / base).toFixed(1)}× the normal 1-minute size (${f1(rng)} pts).`, `${voice(k)} में अचानक बड़ी ${dir > 0 ? 'हरी' : 'लाल'} कैंडल।`); }
      // a fresh high-impact headline for this instrument
      (a.news || []).forEach((n) => { if (!n.ts || Date.now() - n.ts > 20 * 60e3 || n.imp !== 'high' || !(Math.abs(n.s) >= 0.5)) return; const key = k + String(n.t).slice(0, 60); if (seenNews.has(key)) return; seenNews.add(key);
        fire(k, 'news' + seenNews.size, n.s > 0 ? 1 : -1, `📰 Big news for ${a.cf.label} (${n.s > 0 ? 'positive' : 'negative'}): "${String(n.t).slice(0, 110)}"`, `${voice(k)} के लिए बड़ी ${n.s > 0 ? 'अच्छी' : 'बुरी'} ख़बर आई है।`); });
    }
    // India VIX jump over about 5 minutes
    const N = A.NIFTY;
    if (N && N.sessionLive && N.vix && ok(N.vix.v)) {
      vixHist.push([Date.now(), N.vix.v]); while (vixHist.length && Date.now() - vixHist[0][0] > 6 * 60e3) vixHist.shift();
      const old = vixHist.find((x) => Date.now() - x[0] >= 4 * 60e3);
      if (old) { const j = N.vix.v / old[1] - 1; if (j >= 0.04 * f) fire('NIFTY', 'vix', -1, `⚡ India VIX up ${(j * 100).toFixed(1)}% in 5 minutes (now ${f2(N.vix.v)}): fear is rising, swings get bigger.`, `इंडिया विक्स अचानक बढ़ा, डर बढ़ रहा है, उतार-चढ़ाव बड़े होंगे।`); }
    }
  }
  function tick() { try { checkPrices(); checkShocks(); } catch (e) { /* data mid-update */ } }
  function start() { if (started) return; started = true; timer = setInterval(tick, 2000); }

  /* ---------- page ---------- */
  function build() {
    if ($a('al')) return;
    const el = document.createElement('div'); el.id = 'al'; el.className = 'rp al'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Alerts');
    el.innerHTML = '<div class="rc-wrap"><div class="rp-top rc-top"><h2>Alerts</h2><span class="mut">Price alerts and the shock detector work while this dashboard is open (on the phone, keep the screen on).</span><button class="x" onclick="Alerts.close()" aria-label="Close">✕</button></div><div id="alBody"></div></div>';
    document.body.appendChild(el); el.addEventListener('click', (e) => { if (e.target === el) close(); });
  }
  function open() { build(); $a('al').classList.add('on'); document.body.style.overflow = 'hidden'; render(); }
  function close() { const el = $a('al'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; }
  function render() {
    const b = $a('alBody'); if (!b) return;
    const a = A[cur], L = list(), S = sens();
    const ae = document.activeElement; if (ae && ae.closest && ae.closest('#alForm') && /INPUT|SELECT/.test(ae.tagName)) return; // don't wipe what you're typing
    let h = `<div class="sec" style="margin-top:0">New price alert</div><div class="al-f" id="alForm">
      <label><small>Instrument</small><select id="alK">${KEYS.filter((k) => A[k]).map((k) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(CFG[k].label)}</option>`).join('')}</select></label>
      <label><small>When it goes</small><select id="alDir"><option value="above">Above</option><option value="below">Below</option></select></label>
      <label><small>Price</small><input id="alLv" type="number" step="0.05" inputmode="decimal" placeholder="${a ? fmt(a.price) : ''}"></label>
      <label class="al-n"><small>Note (spoken too)</small><input id="alNote" type="text" maxlength="80" placeholder="e.g. breakout, book profit"></label>
      <label class="al-c"><input id="alRep" type="checkbox"> Repeat (every 10 min)</label>
      <button class="btn-solid ce" onclick="Alerts.add()">Add alert</button></div>`;
    if (a) {
      const q = [];
      if (a.res) q.push(`<button class="btn-ghost" onclick='Alerts.quick(${JSON.stringify(cur)},"above",${a.res[1]},${JSON.stringify("Resistance " + a.res[0])})'>Above resistance ${fmt(a.res[1])}</button>`);
      if (a.sup) q.push(`<button class="btn-ghost" onclick='Alerts.quick(${JSON.stringify(cur)},"below",${a.sup[1]},${JSON.stringify("Support " + a.sup[0])})'>Below support ${fmt(a.sup[1])}</button>`);
      if (ok(a.DH)) q.push(`<button class="btn-ghost" onclick='Alerts.quick(${JSON.stringify(cur)},"above",${a.DH},"New day high")'>New day high ${fmt(a.DH)}</button>`);
      if (ok(a.DL)) q.push(`<button class="btn-ghost" onclick='Alerts.quick(${JSON.stringify(cur)},"below",${a.DL},"New day low")'>New day low ${fmt(a.DL)}</button>`);
      if (q.length) h += `<div class="al-q"><small class="mut">One tap for ${esc(a.cf.label)}:</small>${q.join('')}</div>`;
    }
    h += `<div class="sec">Your alerts (${L.length})</div>${L.length ? L.map((x) => { const p = A[x.k] && A[x.k].price; return `<div class="al-i ${x.done ? 'done' : ''}"><div><b>${esc(x.label)} ${x.dir} ${fmt(x.level)}</b><span class="mut">${x.note ? esc(x.note) + ' · ' : ''}${x.repeat ? 'repeats' : 'once'}${ok(p) ? ` · now ${fmt(p)} (${f1(Math.abs(p - x.level))} away)` : ''}${x.n ? ` · fired ${x.n}×` : ''}</span></div>${x.done ? `<button class="btn-ghost" onclick="Alerts.rearm('${x.id}')">Re-arm</button>` : ''}<button class="btn-ghost" onclick="Alerts.del('${x.id}')">Delete</button></div>`; }).join('') : '<div class="mut al-p">No alerts yet.</div>'}`;
    h += `<div class="sec">Shock detector</div><p class="al-p">Watches every instrument on screen for a sudden giant candle, a fast 3-minute move, an India VIX jump, or a fresh high-impact headline. If you hold a paper position against the move, it warns you about that first.</p>
      <div class="seg al-seg">${[['off', 'Off'], ['normal', 'Normal'], ['sensitive', 'Sensitive']].map(([k, n]) => `<button class="${S === k ? 'on' : ''}" onclick="Alerts.sens('${k}')">${n}</button>`).join('')}</div>
      <div class="legend">Normal: Nifty 0.35% / Bank Nifty 0.45% / stocks 1% in 3 minutes, a 1-minute candle 3.5× its usual size, VIX +4% in 5 minutes. Sensitive fires at three-quarters of that.</div>`;
    h += `<div class="sec">Today's alerts</div>${log.length ? log.map((x) => `<div class="al-log ${x.kind}"><span class="mut">${new Date(x.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span> ${esc(x.text)}</div>`).join('') : '<div class="mut al-p">Nothing yet.</div>'}
      <div class="legend">Alerts are saved in this browser. Voice follows the setting in Paper trading (Important only / All / Off).</div>`;
    b.innerHTML = h;
  }
  function setSens(k) { Store.setPref('shock_sens', k); render(); toast(`Shock detector: ${k}`); }
  window.addEventListener('load', () => setTimeout(start, 3000));
  return { open, close, add, quick, del, rearm, hide, sens: setSens, check: tick, start, get log() { return log; } };
})();
