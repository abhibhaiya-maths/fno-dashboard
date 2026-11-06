/* ===== शुरुआत और लूप ===== */
let cur = Store.pref('index', 'NIFTY');
HZ = Store.pref('hz', 'intra'); // analysis.js loads before store.js, so read the saved horizon here
const A = {};
const DEMO = !APP_CONFIG.WORKER_URL || new URLSearchParams(location.search).has('demo');
const Source = DEMO ? DemoSource : LiveSource;
let orderFor = null;
const MAX_WATCH = 12;

function refreshAll() {
  // Nifty first: other instruments compare themselves with it
  for (const k of KEYS) { const D = Source.get(k); A[k] = D ? applyHz(analyze(D)) : null; }
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
  renderControls(); renderHorizons(); renderScore(); renderSetup(); renderLevels(); renderTab(); renderNews(); renderGlobal(); renderOrb(); Engine.renderProjection(); Engine.renderFeed(); Engine.renderTicker(); Engine.renderStatus(); drawChart(); Paper.render();
  $('orderDrawer').style.display = a.cf.opt ? '' : 'none';
  if (orderFor !== cur || !$('oStrike').value) { orderFor = cur; Paper.renderOrderForm(); } else Paper.updateEstimate();
}
function renderStatus() {
  let h = '';
  if (DEMO) h = `<span class="tag demo">Demo data</span><span class="mut">Simulated prices, fast clock</span>`;
  else {
    const st = Source.status, u = Store.user, e = Source.error;
    if (st && !st.upstox) h += `<button class="btn-up" onclick="connectUpstox()">Connect Upstox</button>`;
    else if (st) h += `<span class="tag ok">${LiveSource.stream.connected ? 'Live stream' : LiveSource.stream.everConnected ? 'Reconnecting…' : 'Upstox connected'}</span>${st.ai ? `<span class="tag ai">AI on${st.aiVia ? ': ' + esc(st.aiVia) : ''}</span>` : '<span class="tag" title="Add GEMINI_API_KEY or a Workers AI binding in the Worker">AI off</span>'}`;
    if (st && st.v !== 2) h += `<span class="err" title="Deploy the new worker-index.js to Cloudflare">⚠ Old Worker code: watchlist and global cues need the new Worker</span>`;
    if (e && e.code !== 'UPSTOX_LOGIN') h += `<span class="err" title="${esc(e.message)}">⚠ ${esc(e.message.slice(0, 60))}</span>`;
    const a0 = A[cur];
    if (a0 && a0.D.fromTicks) h += `<span class="err" title="${esc(a0.D.todayErr || '')}">⚠ Upstox candles delayed: chart built from live ticks</span>`;
    else if (a0 && !a0.sessionLive && a0.D.marketOpenNow) h += `<span class="err" title="${esc(a0.D.todayErr || '')}">⚠ Waiting for today's candles from Upstox</span>`;
    if (u) h += `<button class="btn-ghost" onclick="Store.signOut()" title="${esc(u.email)}">Log out</button>`;
  }
  $('statusBar').innerHTML = h;
}
async function connectUpstox() { const t = await Store.idToken(); location.href = LiveSource.connectUrl(t); }

function pick(k) {
  if (!CFG[k]) return;
  cur = k; Store.setPref('index', k); renderAll();
  // the selected instrument gets its extras right away
  if (!DEMO && CFG[k] && !CFG[k].core) Promise.all([LiveSource.refreshChains(k), LiveSource.refreshFut(k)]).then(refreshAll);
}
function setHz(h) { if (!HZ_INFO[h] || HZ === h) return; HZ = h; Store.setPref('hz', h); orderFor = null; refreshAll(); toast(`Signals now on the ${HZ_INFO[h].name} engine (${HZ_INFO[h].tf}, ${HZ_INFO[h].horizon})`); }
function setTF(t) { tf = t; renderControls(); drawChart(); }
function togOV(k) { OV[k] = !OV[k]; Store.setPref('overlays', OV); renderControls(); drawChart(); }
function setSub(k) { sub = k; renderControls(); if (CI) drawSub(CI, Math.max(0, CI.k.length - VIEW[tf])); }
function setTab(k) { tab = k; renderControls(); renderTab(); }

function gate(html) { $('gate').innerHTML = html; $('gate').style.display = html ? 'flex' : 'none'; }

/* ---------- Watchlist ---------- */
const saveWatch = () => Store.saveWatch(watchItems(), DEMO);
async function addWatch(it) {
  if (CFG[it.id]) { pick(it.id); closeSearch(); return; }
  if (watchItems().length >= MAX_WATCH) return toast(`Watchlist is full (${MAX_WATCH}). Remove one first.`);
  closeSearch();
  if (!DEMO && it.ukey && it.kind !== 'FUT') {
    // confirm F&O and lot size from Upstox's option contracts
    try { const inf = await LiveSource.instInfo(it.ukey); it.fo = !!inf.fo; if (inf.lot) it.lot = inf.lot; } catch (e) { /* keep search info */ }
  }
  addInst(it); saveWatch();
  toast(`${it.label} added${it.fo ? ` (F&O, lot ${it.lot || '?'})` : it.exch === 'MCX' ? ' (MCX futures)' : ' (no F&O: price signals only)'}`);
  cur = it.id; Store.setPref('index', cur);
  renderTickers();
  if (DEMO) { refreshAll(); return; }
  await Promise.all([LiveSource.refreshSnapshot(), LiveSource.refreshCandles(it.id), LiveSource.refreshChains(it.id), LiveSource.refreshFut(it.id), LiveSource.refreshDaily(it.id)]);
  refreshAll();
  LiveSource.refreshNews(it.id).then(refreshAll);
}
function removeWatch(id, ev) {
  if (ev) ev.stopPropagation();
  if (!CFG[id] || CFG[id].core) return;
  if (Paper.openTrades().some((t) => t.key === id)) return toast('Close the open paper position first.');
  const lbl = CFG[id].label;
  removeInst(id); delete A[id]; Source.drop(id); saveWatch();
  if (cur === id) { cur = 'NIFTY'; Store.setPref('index', cur); }
  toast(`${lbl} removed`); refreshAll();
}
// MCX futures roll every month: swap an expired contract for the current one
async function rollExpired(list) {
  const today = istYmd();
  for (const it of list) {
    if (it.exch !== 'MCX' || !it.expiry || it.expiry >= today) continue;
    try { const r = await LiveSource.search(it.sym); const n = r.items.find((x) => x.exch === 'MCX' && x.id === it.id); if (n) Object.assign(it, { key: n.key, expiry: n.expiry, lot: n.lot }); } catch (e) { /* keep old */ }
  }
  return list;
}

async function startLive() {
  try { await LiveSource.init(); }
  catch (e) { gate(`<div class="gbox"><h2>Can’t reach the Worker</h2><p>${esc(e.message)}</p><p class="mut">Check the Worker URL, ALLOWED_EMAIL and FIREBASE_API_KEY.</p><button class="go" onclick="Store.signOut()">Log in with another email</button></div>`); return; }
  gate('');
  const wl = await rollExpired(await Store.loadWatch(false));
  wl.slice(0, MAX_WATCH).forEach(addInst); saveWatch();
  if (!CFG[cur]) cur = 'NIFTY';
  const P = APP_CONFIG.POLL;
  await Promise.all([LiveSource.refreshSnapshot(), LiveSource.refreshCandles()]);
  await LiveSource.refreshChains();
  refreshAll();
  Promise.all([LiveSource.refreshFut(), LiveSource.refreshDaily(), LiveSource.refreshGlobal(), LiveSource.refreshCalendar(), LiveSource.refreshFII()]).then(refreshAll);
  LiveSource.refreshNews().then(refreshAll);
  LiveSource.refreshResults().then(refreshAll);
  LiveSource.refreshOfficial().then(refreshAll);
  // Live tick stream: redraw at most every RENDER_MS (tiny buffer, keeps the page smooth)
  let pending = false;
  const onTick = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; refreshAll(); }, P.RENDER_MS); };
  if (APP_CONFIG.STREAM !== false) LiveSource.stream.connect(onTick);
  const anyOpen = () => KEYS.some((k) => A[k] && A[k].sessionLive);
  const slow = (ms) => (anyOpen() ? ms : Math.max(ms, 60000)); // market closed: poll gently (saves your free quota)
  // REST snapshot: every 5 s without the stream, every 20 s with it (OI change, ATM window, new strikes)
  const snapLoop = async () => { await LiveSource.refreshSnapshot(); refreshAll(); setTimeout(snapLoop, slow(LiveSource.stream.connected ? P.STREAM_SNAPSHOT_MS : P.SNAPSHOT_MS)); };
  setTimeout(snapLoop, P.SNAPSHOT_MS);
  // watchlist option chains (selected one first)
  const chainLoop = async () => { await LiveSource.refreshChains(); refreshAll(); setTimeout(chainLoop, slow(LiveSource.stream.connected ? 30000 : 15000)); };
  setTimeout(chainLoop, 15000);
  const minLoop = async () => { await Promise.all([LiveSource.refreshCandles(), LiveSource.refreshFut(), LiveSource.refreshGlobal()]); refreshAll(); setTimeout(minLoop, slow(P.CANDLES_MS)); };
  setTimeout(minLoop, P.CANDLES_MS);
  setInterval(async () => { await Promise.all([LiveSource.refreshNews(), LiveSource.refreshResults(), LiveSource.refreshOfficial(), LiveSource.refreshFII()]); refreshAll(); }, P.NEWS_MS);
  setInterval(async () => { await Promise.all([LiveSource.refreshCalendar(), LiveSource.refreshDaily()]); refreshAll(); }, 30 * 60000);
}

(async function boot() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('upstox')) {
    setTimeout(() => toast(qs.get('upstox') === 'connected' ? 'Upstox connected' : '⚠ ' + (qs.get('msg') || 'Upstox login failed')), 800);
    history.replaceState(null, '', location.pathname + (DEMO ? '?demo=1' : ''));
  }
  if (DEMO) {
    Store.init(true, () => {});
    (await Store.loadWatch(true)).slice(0, MAX_WATCH).forEach(addInst);
    if (!CFG[cur]) cur = 'NIFTY';
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
