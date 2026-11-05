/* ===== Live data: Cloudflare Worker → Upstox / news / AI, plus Upstox WebSocket tick stream ===== */
const LiveSource = (() => {
  const HDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const raw = {};
  const R = (k) => raw[k] || (raw[k] = { days: null, news: [], newsAI: false, bars: {}, fut: null, daily: null, chain: null });
  let snap = null, status = null, lastErr = null, lastOk = 0, resultsData = { ai: false, items: [] };
  let glob = [], cal = { items: [], sources: {} }, fii = null, off = { items: [], sources: {} }, vixDaily = null;

  async function api(path, opts = {}) {
    const t = await Store.idToken();
    const r = await fetch(APP_CONFIG.WORKER_URL.replace(/\/$/, '') + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({ error: 'Bad response from Worker (' + r.status + ')' }));
    if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.code = j.code; e.status = r.status; throw e; }
    return j;
  }
  const fail = (e) => { lastErr = e; if (e.code === 'UPSTOX_LOGIN') status = { ...(status || {}), upstox: false }; };
  const soft = (e) => { if (e.code === 'UPSTOX_LOGIN' || e.code === 'UPSTOX_TOKEN_BAD') fail(e); }; // optional extras: don't flag the whole page
  const enc = encodeURIComponent;
  const watchKeys = () => KEYS.filter((k) => !CFG[k].core);
  const sessQ = (k) => (CFG[k].exch === 'MCX' ? '&s=MCX' : '');

  async function init() { status = await api('/api/status'); return status; }
  async function refreshSnapshot() {
    try {
      const w = watchKeys().map((k) => CFG[k].key).filter(Boolean);
      const s = await api('/api/snapshot' + (w.length ? '?w=' + w.map(enc).join(',') : ''));
      s.watch = s.watch || {};
      // keep the freshest streamed ticks: the stream is newer than a REST snapshot
      if (snap && Stream.connected) Stream.carryOver(snap, s);
      snap = s; lastOk = Date.now(); lastErr = null; Stream.syncKeys(snap);
    } catch (e) { fail(e); }
  }
  // Option chains of watchlist stocks/indices that have F&O (the three main indices come with the snapshot)
  async function refreshChains(only) {
    await Promise.all(watchKeys().filter((k) => CFG[k].opt && CFG[k].ukey && (!only || only === k)).map(async (k) => {
      try { R(k).chain = await api('/api/chain?u=' + enc(CFG[k].ukey)); if (R(k).chain.lot) CFG[k].lot = R(k).chain.lot; } catch (e) { soft(e); if (e.code === 'NO_OPTIONS') CFG[k].opt = false; }
    }));
    if (snap) Stream.syncKeys(snap);
  }
  async function refreshCandles(only) {
    await Promise.all(KEYS.filter((k) => !only || only === k).map(async (k) => {
      const cf = CFG[k], q = cf.core ? '?index=' + k : '?key=' + enc(cf.key) + sessQ(k);
      try { const j = await api('/api/candles' + q); R(k).days = j.days; R(k).today = j.today; } catch (e) { cf.core ? fail(e) : soft(e); }
    }));
  }
  // Futures OI buildup data (indices and F&O stocks; MCX futures carry OI in their own candles)
  async function refreshFut(only) {
    await Promise.all(KEYS.filter((k) => (!only || only === k) && CFG[k].exch !== 'MCX' && (CFG[k].core || CFG[k].opt)).map(async (k) => {
      const cf = CFG[k];
      try { const j = await api('/api/fut' + (cf.core ? '?index=' + k : `?u=${enc(cf.ukey || cf.key)}&sym=${enc(cf.sym || k)}&exch=${cf.exch}`)); R(k).fut = j.none ? null : j; } catch (e) { soft(e); }
    }));
  }
  // Daily candles (1 year): realised volatility, 52-week range, previous week; India VIX for IV percentile
  async function refreshDaily(only) {
    const jobs = KEYS.filter((k) => (!only || only === k) && !R(k).daily).map(async (k) => {
      try { R(k).daily = await api('/api/daily?key=' + enc(CFG[k].key)); } catch (e) { soft(e); }
    });
    if (!vixDaily) jobs.push(api('/api/daily?key=' + enc('NSE_INDEX|India VIX')).then((j) => (vixDaily = j.rows)).catch(soft));
    await Promise.all(jobs);
  }
  async function refreshNews(only) {
    await Promise.all(KEYS.filter((k) => !only || only === k).map(async (k) => {
      const cf = CFG[k];
      try {
        const j = await api(cf.core ? '/api/news?index=' + k : `/api/news?id=${enc(k)}&name=${enc(cf.name || cf.label)}`);
        R(k).newsAI = j.ai; R(k).sources = j.sources || null;
        R(k).news = (j.items || []).map((n) => ({ t: n.t, s: n.s, imp: n.imp, link: n.link, src: n.src, ago: agoText(n.ts) }));
      } catch (e) { cf.core ? fail(e) : soft(e); }
    }));
  }
  async function refreshResults() {
    try { const j = await api('/api/results'); resultsData = { ai: j.ai, items: (j.items || []).map((n) => ({ co: n.co, q: n.q, t: n.t, s: n.s, link: n.link, src: n.src, ago: agoText(n.ts) })) }; } catch (e) { fail(e); }
  }
  async function refreshGlobal() { try { glob = (await api('/api/global')).items || []; } catch (e) { soft(e); } }
  async function refreshCalendar() { try { cal = await api('/api/calendar'); } catch (e) { soft(e); } }
  async function refreshFII() { try { const j = await api('/api/fiidii'); fii = j.none ? null : j; } catch (e) { soft(e); } }
  async function refreshOfficial() { try { const j = await api('/api/official'); off = { items: (j.items || []).map((n) => ({ ...n, ago: agoText(n.ts) })), sources: j.sources || {} }; } catch (e) { soft(e); } }
  async function search(q) { return api('/api/search?q=' + enc(q)); }
  async function instInfo(ukey) { return api('/api/inst?u=' + enc(ukey)); }
  function agoText(ts) { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; }

  // ===== Upstox WebSocket stream (Market Data Feed V3) =====
  // Tiny protobuf decoder for Upstox's MarketDataFeedV3.proto (only the fields we use; unknown fields are skipped)
  const PB = (() => {
    const QUOTE = { 1: ['bidQ', 'v'], 2: ['bidP', 'd'], 3: ['askQ', 'v'], 4: ['askP', 'd'] };
    const GREEKS = { 1: ['delta', 'd'], 2: ['theta', 'd'], 3: ['gamma', 'd'], 4: ['vega', 'd'], 5: ['rho', 'd'] };
    const LTPC = { 1: ['ltp', 'd'], 2: ['ltt', 'v'], 3: ['ltq', 'v'], 4: ['cp', 'd'] };
    const MLEVEL = { 1: ['bidAskQuote', 'm', QUOTE, true] };
    const MFF = { 1: ['ltpc', 'm', LTPC], 2: ['marketLevel', 'm', MLEVEL], 3: ['optionGreeks', 'm', GREEKS], 5: ['atp', 'd'], 6: ['vtt', 'v'], 7: ['oi', 'd'], 8: ['iv', 'd'] };
    const IFF = { 1: ['ltpc', 'm', LTPC] };
    const FULL = { 1: ['marketFF', 'm', MFF], 2: ['indexFF', 'm', IFF] };
    const FLG = { 1: ['ltpc', 'm', LTPC], 2: ['firstDepth', 'm', QUOTE], 3: ['optionGreeks', 'm', GREEKS], 4: ['vtt', 'v'], 5: ['oi', 'd'], 6: ['iv', 'd'] };
    const FEED = { 1: ['ltpc', 'm', LTPC], 2: ['fullFeed', 'm', FULL], 3: ['firstLevelWithGreeks', 'm', FLG], 4: ['requestMode', 'v'] };
    const ENTRY = { 1: ['key', 's'], 2: ['value', 'm', FEED] };
    const RESP = { 1: ['type', 'v'], 2: ['feeds', 'map', ENTRY], 3: ['currentTs', 'v'] };
    const td = new TextDecoder();
    function decode(u8, schema, start = 0, end = u8.length) {
      const out = {}, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      let p = start;
      const varint = () => { let r = 0, mul = 1, b; do { b = u8[p++]; r += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80 && p < end); return r; };
      while (p < end) {
        const tag = varint(), fno = Math.floor(tag / 8), wt = tag & 7, f = schema[fno];
        if (wt === 0) { const v = varint(); if (f) out[f[0]] = v; }
        else if (wt === 1) { const v = dv.getFloat64(p, true); p += 8; if (f) out[f[0]] = v; }
        else if (wt === 5) { p += 4; }
        else if (wt === 2) {
          const len = varint(), s0 = p; p += len;
          if (!f) continue;
          if (f[1] === 's') out[f[0]] = td.decode(u8.subarray(s0, p));
          else if (f[1] === 'm') { const v = decode(u8, f[2], s0, p); if (f[3]) (out[f[0]] = out[f[0]] || []).push(v); else out[f[0]] = v; }
          else if (f[1] === 'map') { const e = decode(u8, f[2], s0, p); (out[f[0]] = out[f[0]] || {})[e.key || ''] = e.value || {}; }
        } else break; // unknown wire type: stop safely
      }
      return out;
    }
    return { decode: (u8) => decode(u8, RESP) };
  })();

  const Stream = (() => {
    let ws = null, connected = false, wanted = new Set(), subscribed = new Set(), keyMap = {}, onTick = () => {};
    let lag = null, ticks = 0, lastTick = 0, fails = 0, stopped = false, retryT = null, everConnected = false;
    const num = (v) => (v == null ? null : typeof v === 'object' && v.toNumber ? v.toNumber() : +v);

    // which instrument keys do we need, and what do they mean?
    function syncKeys(s) {
      if (!s || !s.keys) return;
      const map = {}, ltpc = [], opt = [];
      KEYS.forEach((k) => { if (s.keys[k]) { map[s.keys[k]] = { t: 'idx', k }; ltpc.push(s.keys[k]); } });
      if (s.keys.vix) { map[s.keys.vix] = { t: 'vix' }; ltpc.push(s.keys.vix); }
      for (const k of KEYS) (s.hv && s.hv[k] || []).forEach((h, i) => { if (h.k) { (map[h.k] = map[h.k] || { t: 'hv', refs: [] }).refs.push([k, i]); if (!ltpc.includes(h.k)) ltpc.push(h.k); } });
      watchKeys().forEach((k) => { const ik = CFG[k].key; if (!ik) return; if (map[ik] && map[ik].t === 'hv') map[ik].also = k; else map[ik] = { t: 'w', k }; if (!ltpc.includes(ik)) ltpc.push(ik); });
      for (const k of KEYS) {
        const ch = CFG[k].core ? s.chains && s.chains[k] : raw[k] && raw[k].chain; if (!ch || ch.error || !ch.rows || !ch.rows.length) continue;
        const q = CFG[k].core ? s.indices[k] : s.watch && s.watch[CFG[k].key], px = q && q.price, rows = ch.rows; if (!ok(px)) continue;
        let ai = 0; rows.forEach((r, i) => { if (Math.abs(r.K - px) < Math.abs(rows[ai].K - px)) ai = i; });
        rows.slice(Math.max(0, ai - 10), ai + 11).forEach((r) => {
          if (r.ce && r.ce.key) { map[r.ce.key] = { t: 'opt', k, K: r.K, side: 'ce' }; opt.push(r.ce.key); }
          if (r.pe && r.pe.key) { map[r.pe.key] = { t: 'opt', k, K: r.K, side: 'pe' }; opt.push(r.pe.key); }
        });
      }
      keyMap = map;
      wanted = new Set([...ltpc.map((x) => 'ltpc|' + x), ...opt.map((x) => 'option_greeks|' + x)]);
      resubscribe();
    }
    function send(method, mode, keys) {
      if (!ws || ws.readyState !== 1 || !keys.length) return;
      const msg = { guid: Math.random().toString(36).slice(2), method, data: mode ? { mode, instrumentKeys: keys } : { instrumentKeys: keys } };
      ws.send(new TextEncoder().encode(JSON.stringify(msg)));
    }
    function resubscribe() {
      if (!connected) return;
      const add = [...wanted].filter((x) => !subscribed.has(x)), drop = [...subscribed].filter((x) => !wanted.has(x));
      if (drop.length) send('unsub', null, drop.map((x) => x.split('|').slice(1).join('|')));
      ['ltpc', 'option_greeks'].forEach((mode) => { const ks = add.filter((x) => x.startsWith(mode + '|')).map((x) => x.slice(mode.length + 1)); if (ks.length) send('sub', mode, ks); });
      subscribed = new Set(wanted);
    }

    function apply(feeds) {
      if (!snap) return;
      for (const ik in feeds) {
        const m = keyMap[ik]; if (!m) continue;
        const f = feeds[ik];
        const lt = f.ltpc || (f.fullFeed && (f.fullFeed.indexFF || f.fullFeed.marketFF || {}).ltpc) || (f.firstLevelWithGreeks && f.firstLevelWithGreeks.ltpc);
        const ltp = lt ? num(lt.ltp) : null, cp = lt ? num(lt.cp) : null;
        if (m.t === 'idx' && ok(ltp) && ltp > 0) {
          const q = snap.indices[m.k] || (snap.indices[m.k] = {});
          q.price = ltp; if (ok(cp) && cp > 0) { q.prevClose = cp; q.chg = ((ltp - cp) / cp) * 100; }
          barTick(m.k, ltp);
        } else if (m.t === 'vix' && ok(ltp) && ltp > 0) {
          snap.vix = { v: ltp, prev: ok(cp) && cp > 0 ? cp : (snap.vix ? snap.vix.prev : ltp) };
        } else if (m.t === 'hv' && ok(ltp) && ok(cp) && cp > 0) {
          m.refs.forEach(([k, i]) => { if (snap.hv[k] && snap.hv[k][i]) snap.hv[k][i].c = ((ltp - cp) / cp) * 100; });
          if (m.also) wTick(m.also, ltp, cp);
        } else if (m.t === 'w' && ok(ltp) && ltp > 0) {
          wTick(m.k, ltp, cp);
        } else if (m.t === 'opt') {
          const ch = CFG[m.k] && CFG[m.k].core ? snap.chains[m.k] : raw[m.k] && raw[m.k].chain; if (!ch || !ch.rows) continue;
          const row = ch.rows.find((r) => r.K === m.K); if (!row) continue;
          const o = row[m.side], g = f.firstLevelWithGreeks || (f.fullFeed && f.fullFeed.marketFF) || {};
          if (ok(ltp) && ltp > 0) o.ltp = ltp;
          const d = g.firstDepth || (g.marketLevel && g.marketLevel.bidAskQuote && g.marketLevel.bidAskQuote[0]);
          if (d) { const b = num(d.bidP), as = num(d.askP); if (b > 0) o.bid = b; if (as > 0) o.ask = as; }
          if (ok(num(g.oi)) && num(g.oi) > 0) o.oi = num(g.oi);
          const iv = num(g.iv); if (ok(iv) && iv > 0) o.iv = iv > 3 ? iv / 100 : iv;
          const gr = g.optionGreeks; if (gr) { if (ok(num(gr.delta)) && num(gr.delta) !== 0) o.de = num(gr.delta); if (ok(num(gr.theta))) o.th = num(gr.theta); if (ok(num(gr.gamma))) o.ga = num(gr.gamma); if (ok(num(gr.vega))) o.ve = num(gr.vega); }
        }
      }
    }
    function wTick(k, ltp, cp) {
      if (!CFG[k]) return;
      const q = snap.watch[CFG[k].key] || (snap.watch[CFG[k].key] = {});
      q.price = ltp; if (ok(cp) && cp > 0) { q.prevClose = cp; q.chg = ((ltp - cp) / cp) * 100; }
      barTick(k, ltp);
    }
    // build 1-minute candles from ticks, so the chart moves tick by tick
    function barTick(k, px) {
      const S = (CFG[k] && CFG[k].sess) || SESS.NSE, m = istMin(); if (m < S.o || m >= S.c) return;
      const b = R(k).bars, cur = b[m];
      if (!cur) b[m] = { o: px, h: px, l: px, c: px }; else { cur.h = Math.max(cur.h, px); cur.l = Math.min(cur.l, px); cur.c = px; }
    }

    async function connect(cb) {
      if (cb) onTick = cb;
      clearTimeout(retryT);
      try {
        const { url } = await api('/api/feed-url');
        ws = new WebSocket(url); ws.binaryType = 'arraybuffer';
        ws.onopen = () => { connected = true; everConnected = true; fails = 0; subscribed = new Set(); resubscribe(); onTick(); };
        ws.onmessage = (e) => {
          try {
            const msg = PB.decode(new Uint8Array(e.data));
            if (msg.currentTs) lag = Date.now() - num(msg.currentTs);
            if (msg.feeds) { apply(msg.feeds); ticks++; lastTick = Date.now(); onTick(); }
          } catch (err) { /* ignore a bad frame */ }
        };
        ws.onclose = () => { const was = connected; connected = false; ws = null; if (!stopped) retry(was); };
        ws.onerror = () => { /* onclose follows */ };
      } catch (e) { connected = false; retry(false); }
    }
    function retry(was) {
      fails = was ? 1 : fails + 1;
      const wait = [1000, 2000, 4000, 8000, 15000, 30000][Math.min(fails - 1, 5)];
      retryT = setTimeout(() => connect(), wait);
      onTick();
    }
    // when a REST snapshot arrives, don't let it overwrite newer streamed prices
    function carryOver(oldS, newS) {
      KEYS.forEach((k) => { if (oldS.indices[k] && newS.indices[k] && lastTick && Date.now() - lastTick < 10000) Object.assign(newS.indices[k], { price: oldS.indices[k].price, prevClose: oldS.indices[k].prevClose, chg: oldS.indices[k].chg }); });
      if (oldS.vix && lastTick && Date.now() - lastTick < 10000) newS.vix = oldS.vix;
      if (oldS.watch && newS.watch && lastTick && Date.now() - lastTick < 10000) for (const k in oldS.watch) if (newS.watch[k] && oldS.watch[k].price) Object.assign(newS.watch[k], { price: oldS.watch[k].price, prevClose: oldS.watch[k].prevClose, chg: oldS.watch[k].chg });
    }
    return { connect, syncKeys, carryOver, get connected() { return connected; }, get lag() { return lag; }, get ticks() { return ticks; }, get lastTick() { return lastTick; }, get everConnected() { return everConnected; }, get fails() { return fails; } };
  })();

  const isOpenDay = () => { const d = istNow().getUTCDay(); return d > 0 && d < 6; };
  function get(key) {
    const r = raw[key], cf = CFG[key];
    if (!cf || !r || !r.days || r.days.length < 2 || !snap) return null;
    const S = cf.sess || SESS.NSE;
    const days = r.days.slice(-3), off3 = 3 - days.length, candles = [];
    days.forEach((d, i) => d.c.forEach(([m, o, h, l, c, v, oi]) => candles.push({ d: i + off3, m, o, h, l, c, v, oi: oi || 0 })));
    const lastDay = days[days.length - 1].date, nowM = istMin();
    const sessionLive = lastDay === istYmd() && isOpenDay() && nowM >= S.o && nowM < S.c;
    const q = cf.core ? snap.indices && snap.indices[key] : snap.watch && snap.watch[cf.key];
    const price = q && ok(q.price) ? q.price : candles[candles.length - 1].c;
    if (sessionLive) {
      // merge tick-built 1-minute bars newer than (or equal to) the last REST candle
      let last = candles[candles.length - 1];
      Object.keys(r.bars).map(Number).sort((a, b) => a - b).forEach((m) => {
        const b = r.bars[m];
        if (m < last.m) return;
        if (m === last.m) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; }
        else { last = { d: 2, m, o: b.o, h: b.h, l: b.l, c: b.c, v: 0, oi: last.oi }; candles.push(last); }
      });
      // and the current minute with the latest price
      const m = clamp(nowM, S.o, S.c - 1);
      if (q && ok(q.price)) {
        if (m > last.m) candles.push({ d: 2, m, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0, oi: last.oi });
        else { last.c = price; last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); }
      }
    }
    const labels = days.map((d) => (d.date === istYmd() ? 'Today' : HDAY[new Date(d.date + 'T00:00:00Z').getUTCDay()]));
    while (labels.length < 3) labels.unshift('');
    const ch = cf.core ? snap.chains && snap.chains[key] : r.chain;
    let chain = { rows: [] };
    if (ch && !ch.error && ch.rows) {
      const expMs = Date.parse(ch.expiry + 'T15:30:00+05:30');
      chain = { expiry: ch.expiry, lot: ch.lot, rows: JSON.parse(JSON.stringify(ch.rows)), dte: Math.max((expMs - Date.now()) / 86400e3, 0.01) };
    }
    // FII/DII: NSE (automatic) first, else what you typed in for today
    const man = Store.getFII(), auto = fii && ok(fii.fii) ? fii : null;
    const F = auto || man;
    const dly = r.daily && r.daily.rows || [];
    const nifty = A.NIFTY;
    return {
      key, candles, price, prevClose: q && ok(q.prevClose) ? q.prevClose : null, sessionLive, dayLabels: labels, chain,
      vix: snap.vix, fii: F ? F.fii : null, dii: F ? F.dii : null, fiiSrc: auto ? (auto.stale ? 'NSE, ' + auto.date : 'NSE') : man ? 'manual' : null,
      hv: cf.core ? (snap.hv && snap.hv[key]) || [] : [], news: r.news,
      fut: r.fut, daily: r.daily, vixDaily, prevOi: dly.length ? dly[dly.length - 1][6] : null, glob, events: cal.items || [],
      mkt: key !== 'NIFTY' && nifty ? { chg: nifty.chg, score: nifty.score } : null,
    };
  }
  function clock() {
    const n = istNow(), m = istMin();
    const t = [n.getUTCHours(), n.getUTCMinutes(), n.getUTCSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
    const open = m >= 0 && m < 375 && isOpenDay();
    const mcx = !open && isOpenDay() && m >= -15 && m < 870 && KEYS.some((k) => CFG[k].exch === 'MCX');
    const stale = !Stream.connected && lastOk && Date.now() - lastOk > 30000 ? ', data paused' : '';
    return { min: m, date: istYmd(), label: (open ? `${Stream.connected ? 'Streaming' : 'Live'} ${t}` : mcx ? `NSE closed, MCX ${Stream.connected ? 'streaming' : 'live'} ${t}` : `Market closed, ${t}`) + stale };
  }
  async function ask(question, context, history) { return api('/api/ask', { method: 'POST', body: JSON.stringify({ question, context, history: history || [] }) }); }
  function connectUrl(idToken) { return APP_CONFIG.WORKER_URL.replace(/\/$/, '') + '/auth/login?id_token=' + encodeURIComponent(idToken); }
  return { mode: 'live', init, refreshSnapshot, refreshChains, refreshCandles, refreshFut, refreshDaily, refreshNews, refreshResults, refreshGlobal, refreshCalendar, refreshFII, refreshOfficial,
    search, instInfo, get, clock, ask, connectUrl, results: () => resultsData, stream: Stream, drop: (k) => { delete raw[k]; },
    global: () => glob, calendar: () => cal, official: () => off, fiiAuto: () => fii,
    get status() { return status; }, get error() { return lastErr; }, newsAI: (k) => R(k).newsAI, newsSources: (k) => R(k).sources };
})();
