/* ===== Live data: Cloudflare Worker → Upstox / news / AI, plus Upstox WebSocket tick stream ===== */
const LiveSource = (() => {
  const HDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const raw = {}; KEYS.forEach((k) => (raw[k] = { days: null, news: [], newsAI: false, bars: {} }));
  let snap = null, status = null, lastErr = null, lastOk = 0, resultsData = { ai: false, items: [] };

  async function api(path, opts = {}) {
    const t = await Store.idToken();
    const r = await fetch(APP_CONFIG.WORKER_URL.replace(/\/$/, '') + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({ error: 'Bad response from Worker (' + r.status + ')' }));
    if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.code = j.code; e.status = r.status; throw e; }
    return j;
  }
  const fail = (e) => { lastErr = e; if (e.code === 'UPSTOX_LOGIN') status = { ...(status || {}), upstox: false }; };

  async function init() { status = await api('/api/status'); return status; }
  async function refreshSnapshot() {
    try {
      const s = await api('/api/snapshot');
      // keep the freshest streamed ticks: the stream is newer than a REST snapshot
      if (snap && Stream.connected) Stream.carryOver(snap, s);
      snap = s; lastOk = Date.now(); lastErr = null; Stream.syncKeys(snap);
    } catch (e) { fail(e); }
  }
  async function refreshCandles() {
    await Promise.all(KEYS.map(async (k) => { try { const j = await api('/api/candles?index=' + k); raw[k].days = j.days; raw[k].today = j.today; } catch (e) { fail(e); } }));
  }
  async function refreshNews() {
    await Promise.all(KEYS.map(async (k) => {
      try {
        const j = await api('/api/news?index=' + k);
        raw[k].newsAI = j.ai; raw[k].sources = j.sources || null;
        raw[k].news = (j.items || []).map((n) => ({ t: n.t, s: n.s, imp: n.imp, link: n.link, src: n.src, ago: agoText(n.ts) }));
      } catch (e) { fail(e); }
    }));
  }
  async function refreshResults() {
    try { const j = await api('/api/results'); resultsData = { ai: j.ai, items: (j.items || []).map((n) => ({ co: n.co, q: n.q, t: n.t, s: n.s, link: n.link, src: n.src, ago: agoText(n.ts) })) }; } catch (e) { fail(e); }
  }
  function agoText(ts) { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : 'yesterday'; }

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
      for (const k of KEYS) {
        const ch = s.chains && s.chains[k]; if (!ch || ch.error || !ch.rows || !ch.rows.length) continue;
        const px = s.indices[k] && s.indices[k].price, rows = ch.rows;
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
        } else if (m.t === 'opt') {
          const ch = snap.chains[m.k]; if (!ch || !ch.rows) continue;
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
    // build 1-minute candles from ticks, so the chart moves tick by tick
    function barTick(k, px) {
      const m = istMin(); if (m < 0 || m > 374) return;
      const b = raw[k].bars, cur = b[m];
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
    }
    return { connect, syncKeys, carryOver, get connected() { return connected; }, get lag() { return lag; }, get ticks() { return ticks; }, get lastTick() { return lastTick; }, get everConnected() { return everConnected; }, get fails() { return fails; } };
  })();

  function get(key) {
    const r = raw[key];
    if (!r.days || r.days.length < 2 || !snap) return null;
    const days = r.days.slice(-3), off = 3 - days.length, candles = [];
    days.forEach((d, i) => d.c.forEach(([m, o, h, l, c, v]) => candles.push({ d: i + off, m, o, h, l, c, v })));
    const lastDay = days[days.length - 1].date, nowM = istMin();
    const sessionLive = lastDay === istYmd() && nowM >= 0 && nowM < 375;
    const q = snap.indices && snap.indices[key];
    const price = q && ok(q.price) ? q.price : candles[candles.length - 1].c;
    if (sessionLive) {
      // merge tick-built 1-minute bars newer than (or equal to) the last REST candle
      let last = candles[candles.length - 1];
      Object.keys(r.bars).map(Number).sort((a, b) => a - b).forEach((m) => {
        const b = r.bars[m];
        if (m < last.m) return;
        if (m === last.m) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; }
        else { last = { d: 2, m, o: b.o, h: b.h, l: b.l, c: b.c, v: 0 }; candles.push(last); }
      });
      // and the current minute with the latest price
      const m = clamp(nowM, 0, 374);
      if (q) {
        if (m > last.m) candles.push({ d: 2, m, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0 });
        else { last.c = price; last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); }
      }
    }
    const labels = days.map((d) => (d.date === istYmd() ? 'Today' : HDAY[new Date(d.date + 'T00:00:00Z').getUTCDay()]));
    while (labels.length < 3) labels.unshift('');
    const ch = snap.chains && snap.chains[key];
    let chain = { rows: [] };
    if (ch && !ch.error) {
      const expMs = Date.parse(ch.expiry + 'T15:30:00+05:30');
      chain = { expiry: ch.expiry, lot: ch.lot, rows: JSON.parse(JSON.stringify(ch.rows)), dte: Math.max((expMs - Date.now()) / 86400e3, 0.01) };
    }
    const fd = Store.getFII();
    return {
      key, candles, price, prevClose: q ? q.prevClose : null, sessionLive, dayLabels: labels, chain,
      vix: snap.vix, fii: fd ? fd.fii : null, dii: fd ? fd.dii : null, hv: (snap.hv && snap.hv[key]) || [], news: r.news,
    };
  }
  function clock() {
    const n = istNow(), m = istMin();
    const t = [n.getUTCHours(), n.getUTCMinutes(), n.getUTCSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
    const open = m >= 0 && m < 375 && n.getUTCDay() > 0 && n.getUTCDay() < 6;
    const stale = !Stream.connected && lastOk && Date.now() - lastOk > 30000 ? ', data paused' : '';
    return { min: m, date: istYmd(), label: (open ? `${Stream.connected ? 'Streaming' : 'Live'} ${t}` : `Market closed, ${t}`) + stale };
  }
  async function ask(question, context, history) { return api('/api/ask', { method: 'POST', body: JSON.stringify({ question, context, history: history || [] }) }); }
  function connectUrl(idToken) { return APP_CONFIG.WORKER_URL.replace(/\/$/, '') + '/auth/login?id_token=' + encodeURIComponent(idToken); }
  return { mode: 'live', init, refreshSnapshot, refreshCandles, refreshNews, refreshResults, get, clock, ask, connectUrl, results: () => resultsData, stream: Stream,
    get status() { return status; }, get error() { return lastErr; }, newsAI: (k) => raw[k].newsAI, newsSources: (k) => raw[k].sources };
})();
