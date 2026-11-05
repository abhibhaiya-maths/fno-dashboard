/* ===== शुरुआत और लूप ===== */
let cur = Store.pref('index', 'NIFTY');
if (!CFG[cur]) cur = 'NIFTY';
const A = {};
const DEMO = !APP_CONFIG.WORKER_URL || new URLSearchParams(location.search).has('demo');
const Source = DEMO ? DemoSource : LiveSource;
let orderFor = null;

function refreshAll() {
  for (const k of KEYS) { const D = Source.get(k); A[k] = D ? analyze(D) : null; }
  if (A[cur]) Paper.onTick();
  renderAll();
}
function renderAll() {
  renderTickers(); renderStatus();
  const a = A[cur];
  $('main').style.display = a ? '' : 'none';
  if (!a) return;
  renderControls(); renderScore(); renderSetup(); renderLevels(); renderTab(); drawChart(); Paper.render();
  if (orderFor !== cur || !$('oStrike').value) { orderFor = cur; Paper.renderOrderForm(); } else Paper.updateEstimate();
}
function renderStatus() {
  let h = '';
  if (DEMO) h = `<span class="badge">डेमो डेटा</span><span class="mut">सब कुछ नकली और तेज़ है। लाइव के लिए README देखें।</span>`;
  else {
    const st = Source.status, u = Store.user, e = Source.error;
    h = `<span class="badge live">लाइव</span>${u ? `<span class="mut">${esc(u.email)}</span>` : ''}`;
    if (st && !st.upstox) h += `<button class="go up-btn" onclick="connectUpstox()">🔗 Upstox से कनेक्ट करें (रोज़ एक बार)</button>`;
    else if (st) h += `<span class="up">● Upstox जुड़ा है</span>${st.ai ? '<span class="mut">· AI चालू</span>' : '<span class="mut">· AI बंद</span>'}`;
    if (e && e.code !== 'UPSTOX_LOGIN') h += `<span class="down">⚠ ${esc(e.message)}</span>`;
    h += `<button class="btn" onclick="Store.signOut()">लॉग आउट</button>`;
  }
  $('statusBar').innerHTML = h;
}
async function connectUpstox() { const t = await Store.idToken(); location.href = LiveSource.connectUrl(t); }

function pick(k) { cur = k; Store.setPref('index', k); renderAll(); }
function setTF(t) { tf = t; renderControls(); drawChart(); }
function togOV(k) { OV[k] = !OV[k]; Store.setPref('overlays', OV); renderControls(); drawChart(); }
function setSub(k) { sub = k; renderControls(); if (CI) drawSub(CI, Math.max(0, CI.k.length - VIEW[tf])); }
function setTab(k) { tab = k; renderControls(); renderTab(); }

function gate(html) { $('gate').innerHTML = html; $('gate').style.display = html ? 'flex' : 'none'; }

async function startLive() {
  try { await LiveSource.init(); }
  catch (e) { gate(`<div class="gbox"><h2>Worker से कनेक्शन नहीं हुआ</h2><p>${esc(e.message)}</p><p class="mut">Worker URL, ALLOWED_EMAIL और FIREBASE_API_KEY जाँचें।</p><button class="go" onclick="Store.signOut()">दूसरे ईमेल से लॉगिन</button></div>`); return; }
  gate('');
  const first = async () => { await Promise.all([LiveSource.refreshSnapshot(), LiveSource.refreshCandles()]); refreshAll(); };
  await first();
  LiveSource.refreshNews().then(refreshAll);
  setInterval(async () => { await LiveSource.refreshSnapshot(); refreshAll(); }, APP_CONFIG.POLL.SNAPSHOT_MS);
  setInterval(async () => { await LiveSource.refreshCandles(); refreshAll(); }, APP_CONFIG.POLL.CANDLES_MS);
  setInterval(async () => { await LiveSource.refreshNews(); refreshAll(); }, APP_CONFIG.POLL.NEWS_MS);
}

(async function boot() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('upstox')) {
    setTimeout(() => toast(qs.get('upstox') === 'connected' ? '✅ Upstox जुड़ गया' : '⚠ ' + (qs.get('msg') || 'Upstox लॉगिन नहीं हुआ')), 800);
    history.replaceState(null, '', location.pathname + (DEMO ? '?demo=1' : ''));
  }
  if (DEMO) {
    Store.init(true, () => {});
    DemoSource.init(); await Paper.load(); refreshAll();
    setInterval(() => { if (DemoSource.tick()) refreshAll(); }, DemoSource.TICK_MS);
    return;
  }
  if (!Store.hasFirebase()) { gate(`<div class="gbox"><h2>सेटअप अधूरा है</h2><p>js/config.js में Firebase की जानकारी भरें।</p><a class="go" href="?demo=1">तब तक डेमो देखें</a></div>`); return; }
  let started = false;
  Store.init(false, async (u) => {
    if (!u) { gate(`<div class="gbox"><h2>📊 F&O डैशबोर्ड</h2><p>आगे बढ़ने के लिए लॉगिन करें।</p><button class="go" onclick="Store.signIn().catch(e=>toast(e.message))">Google से लॉगिन</button><p><a href="?demo=1">डेमो देखें</a></p></div>`); renderStatus(); return; }
    if (started) return; started = true;
    gate('<div class="gbox"><p>डेटा लोड हो रहा है…</p></div>');
    await Paper.load();
    startLive();
  });
})();
window.addEventListener('resize', () => drawChart());
