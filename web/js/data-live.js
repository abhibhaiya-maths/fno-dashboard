/* ===== लाइव डेटा: Cloudflare Worker → Upstox / न्यूज़ / AI ===== */
const LiveSource = (() => {
  const HDAY = ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'];
  const raw = {}; KEYS.forEach((k) => (raw[k] = { days: null, news: [], newsAI: false }));
  let snap = null, status = null, lastErr = null, lastOk = 0, resultsData = { ai: false, items: [] };

  async function api(path, opts = {}) {
    const t = await Store.idToken();
    const r = await fetch(APP_CONFIG.WORKER_URL.replace(/\/$/, '') + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({ error: 'Worker से ख़राब जवाब (' + r.status + ')' }));
    if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.code = j.code; e.status = r.status; throw e; }
    return j;
  }
  const fail = (e) => { lastErr = e; if (e.code === 'UPSTOX_LOGIN') status = { ...(status || {}), upstox: false }; };

  async function init() { status = await api('/api/status'); return status; }
  async function refreshSnapshot() { try { snap = await api('/api/snapshot'); lastOk = Date.now(); lastErr = null; } catch (e) { fail(e); } }
  async function refreshCandles() {
    await Promise.all(KEYS.map(async (k) => { try { const j = await api('/api/candles?index=' + k); raw[k].days = j.days; raw[k].today = j.today; } catch (e) { fail(e); } }));
  }
  async function refreshNews() {
    await Promise.all(KEYS.map(async (k) => {
      try {
        const j = await api('/api/news?index=' + k);
        raw[k].newsAI = j.ai;
        raw[k].news = (j.items || []).map((n) => ({ t: n.hi || n.t, orig: n.t, s: n.s, imp: n.imp, link: n.link, src: n.src, ago: agoText(n.ts) }));
      } catch (e) { fail(e); }
    }));
  }
  async function refreshResults() {
    try { const j = await api('/api/results'); resultsData = { ai: j.ai, items: (j.items || []).map((n) => ({ co: n.co, q: n.q, t: n.hi || n.t, orig: n.t, s: n.s, link: n.link, src: n.src, ago: agoText(n.ts) })) }; } catch (e) { fail(e); }
  }
  function agoText(ts) { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? `${m} मिनट पहले` : m < 1440 ? `${Math.round(m / 60)} घंटे पहले` : 'कल'; }

  function get(key) {
    const r = raw[key];
    if (!r.days || r.days.length < 2 || !snap) return null;
    const days = r.days.slice(-3), off = 3 - days.length, candles = [];
    days.forEach((d, i) => d.c.forEach(([m, o, h, l, c, v]) => candles.push({ d: i + off, m, o, h, l, c, v })));
    const lastDay = days[days.length - 1].date, nowM = istMin();
    const sessionLive = lastDay === istYmd() && nowM >= 0 && nowM < 375;
    const q = snap.indices && snap.indices[key];
    const price = q && ok(q.price) ? q.price : candles[candles.length - 1].c;
    // अधूरी (चालू मिनट की) कैंडल को लाइव भाव से अपडेट करो
    if (sessionLive && q) {
      const last = candles[candles.length - 1], m = clamp(nowM, 0, 374);
      if (m > last.m) candles.push({ d: 2, m, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0 });
      else { last.c = price; last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); }
    }
    const labels = days.map((d) => (d.date === istYmd() ? 'आज' : HDAY[new Date(d.date + 'T00:00:00Z').getUTCDay()]));
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
    const t = String(n.getUTCHours()).padStart(2, '0') + ':' + String(n.getUTCMinutes()).padStart(2, '0');
    const open = m >= 0 && m < 375 && n.getUTCDay() > 0 && n.getUTCDay() < 6;
    const stale = lastOk && Date.now() - lastOk > 30000 ? ' · डेटा रुका हुआ' : '';
    return { min: m, date: istYmd(), label: (open ? `लाइव ${t}` : `बाज़ार बंद · ${t}`) + stale };
  }
  async function ask(question, context) { return api('/api/ask', { method: 'POST', body: JSON.stringify({ question, context }) }); }
  function connectUrl(idToken) { return APP_CONFIG.WORKER_URL.replace(/\/$/, '') + '/auth/login?id_token=' + encodeURIComponent(idToken); }
  return { mode: 'live', init, refreshSnapshot, refreshCandles, refreshNews, refreshResults, get, clock, ask, connectUrl, results: () => resultsData,
    get status() { return status; }, get error() { return lastErr; }, newsAI: (k) => raw[k].newsAI };
})();
