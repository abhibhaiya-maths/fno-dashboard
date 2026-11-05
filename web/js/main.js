/* ===== शुरुआत और लूप ===== */
let cur = Store.pref('index', 'NIFTY');
if (!CFG[cur]) cur = 'NIFTY';
const A = {};
const DEMO = !APP_CONFIG.WORKER_URL || new URLSearchParams(location.search).has('demo');
const Source = DEMO ? DemoSource : LiveSource;
let orderFor = null;

function refreshAll() {
  for (const k of KEYS) { const D = Source.get(k); A[k] = D ? analyze(D) : null; }
  if (A[cur]) Engine.scan();
  if (A[cur]) Paper.onTick();
  renderAll();
}
function renderAll() {
  renderTickers(); renderStatus();
  const a = A[cur];
  $('main').style.display = a ? '' : 'none';
  $('orb').style.display = a ? '' : 'none';
  if (!a) return;
  renderControls(); renderScore(); renderSetup(); renderLevels(); renderTab(); renderNews(); renderOrb(); Engine.renderProjection(); Engine.renderFeed(); Engine.renderTicker(); Engine.renderStatus(); drawChart(); Paper.render();
  if (orderFor !== cur || !$('oStrike').value) { orderFor = cur; Paper.renderOrderForm(); } else Paper.updateEstimate();
}
function renderStatus() {
  let h = '';
  if (DEMO) h = `<span class="tag demo">Demo data</span><span class="mut">Simulated prices, fast clock</span>`;
  else {
    const st = Source.status, u = Store.user, e = Source.error;
    if (st && !st.upstox) h += `<button class="btn-up" onclick="connectUpstox()">Connect Upstox</button>`;
    else if (st) h += `<span class="tag ok">${LiveSource.stream.connected ? 'Live stream' : LiveSource.stream.everConnected ? 'Reconnecting…' : 'Upstox connected'}</span>${st.ai ? `<span class="tag ai">AI on${st.aiVia ? ': ' + esc(st.aiVia) : ''}</span>` : '<span class="tag" title="Add GEMINI_API_KEY or a Workers AI binding in the Worker">AI off</span>'}`;
    if (e && e.code !== 'UPSTOX_LOGIN') h += `<span class="err" title="${esc(e.message)}">⚠ ${esc(e.message.slice(0, 60))}</span>`;
    if (u) h += `<button class="btn-ghost" onclick="Store.signOut()" title="${esc(u.email)}">Log out</button>`;
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
  catch (e) { gate(`<div class="gbox"><h2>Can’t reach the Worker</h2><p>${esc(e.message)}</p><p class="mut">Check the Worker URL, ALLOWED_EMAIL and FIREBASE_API_KEY.</p><button class="go" onclick="Store.signOut()">Log in with another email</button></div>`); return; }
  gate('');
  const first = async () => { await Promise.all([LiveSource.refreshSnapshot(), LiveSource.refreshCandles()]); refreshAll(); };
  await first();
  LiveSource.refreshNews().then(refreshAll);
  LiveSource.refreshResults().then(refreshAll);
  // Live tick stream: redraw at most every RENDER_MS (tiny buffer, keeps the page smooth)
  let pending = false;
  const onTick = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; refreshAll(); }, APP_CONFIG.POLL.RENDER_MS); };
  if (APP_CONFIG.STREAM !== false) LiveSource.stream.connect(onTick);
  // REST snapshot: every 5 s without the stream, every 20 s with it (OI change, ATM window, new strikes)
  const snapLoop = async () => { await LiveSource.refreshSnapshot(); refreshAll(); setTimeout(snapLoop, LiveSource.stream.connected ? APP_CONFIG.POLL.STREAM_SNAPSHOT_MS : APP_CONFIG.POLL.SNAPSHOT_MS); };
  setTimeout(snapLoop, APP_CONFIG.POLL.SNAPSHOT_MS);
  setInterval(async () => { await LiveSource.refreshCandles(); refreshAll(); }, APP_CONFIG.POLL.CANDLES_MS);
  setInterval(async () => { await Promise.all([LiveSource.refreshNews(), LiveSource.refreshResults()]); refreshAll(); }, APP_CONFIG.POLL.NEWS_MS);
}

(async function boot() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('upstox')) {
    setTimeout(() => toast(qs.get('upstox') === 'connected' ? 'Upstox connected' : '⚠ ' + (qs.get('msg') || 'Upstox login failed')), 800);
    history.replaceState(null, '', location.pathname + (DEMO ? '?demo=1' : ''));
  }
  if (DEMO) {
    Store.init(true, () => {});
    DemoSource.init(); await Paper.load(); refreshAll();
    setInterval(() => { if (DemoSource.tick()) refreshAll(); }, DemoSource.TICK_MS);
    return;
  }
  if (!Store.hasFirebase()) { gate(`<div class="gbox"><h2>Setup incomplete</h2><p>Add your Firebase details in js/config.js.</p><a class="go" href="?demo=1">Open the demo meanwhile</a></div>`); return; }
  let started = false;
  Store.init(false, async (u) => {
    if (!u) { gate(`<div class="gbox"><h2>F&O Terminal</h2><p class="mut">Log in with your Google account.</p><button class="go" onclick="Store.signIn().catch(e=>toast(e.message))">Log in with Google</button><a class="mut" href="?demo=1">Open the demo</a></div>`); renderStatus(); return; }
    if (started) return; started = true;
    gate('<div class="gbox"><p>Loading market data…</p></div>');
    await Paper.load();
    startLive();
  });
})();
window.addEventListener('resize', () => drawChart());
