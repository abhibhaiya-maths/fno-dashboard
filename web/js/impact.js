/* ===== News impact and results radar =====
   1. News impact: which Indian sectors and companies today's big headlines help or hurt (crude, rates, tariffs, policy…),
      and which of YOUR watchlist names are hit.
   2. Results radar: quarterly results (profit / revenue growth from results headlines) next to the price picture from the
      Screener's last scan: strong results at a beaten-down price (bounce watch), weak results while the price is still high
      or the news is bad (fall risk).
   Read-only and advice only: the call/put engine, scores and grades never read anything from here.
   The report card shows one extra line from it ("Is the news with you?"), which is advice too. */
const Impact = (() => {
  let imp = null, earn = null, scan = null, tab = 'news', secPick = null, scr = 'bounce', err = { imp: '', earn: '' }, loading = false, last = 0;
  const $i = (id) => document.getElementById(id);
  const live = () => Source.mode === 'live';
  const HZ = { d: 'today', w: 'days–weeks', m: 'months' };
  const HALF = 12 * 3600e3; // a 12-hour-old headline counts half
  const wOf = (x) => x.str * Math.pow(0.5, Math.max(0, Date.now() - x.ts) / HALF);
  const pct = (x, d = 0) => (ok(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}%` : '–');
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const mySyms = () => new Set((typeof KEYS !== 'undefined' ? KEYS : []).filter((k) => CFG[k] && !CFG[k].core).map((k) => String(CFG[k].sym || k).toUpperCase()));

  /* ---------- data ---------- */
  let pending = null, wantEarn = false;
  // the Overnight page asks for results too (shown as context next to each stock)
  function loadEarnings() { wantEarn = true; return earn ? Promise.resolve() : load(true); }
  function load(force) {
    if (pending) return pending; // one request at a time; callers share it
    if (!force && Date.now() - last < 5 * 60e3 && imp) return Promise.resolve();
    pending = load0().finally(() => { pending = null; });
    return pending;
  }
  async function load0() {
    loading = true; last = Date.now();
    if (!live()) { imp = demoImpact(); earn = demoEarnings(); scan = demoScan(); loading = false; return; }
    await Promise.all([
      Source.raw('/api/impact').then((j) => { imp = j; err.imp = ''; }).catch((e) => { err.imp = /404|Not found/i.test(e.message) ? 'Deploy the new Worker code (it adds /api/impact).' : e.message; }),
      tab === 'results' || earn || wantEarn ? Source.raw('/api/earnings').then((j) => { earn = j; err.earn = ''; }).catch((e) => { err.earn = /404|Not found/i.test(e.message) ? 'Deploy the new Worker code (it adds /api/earnings).' : e.message; }) : null,
      idbGet('scan').then((s) => { if (s) scan = s; }),
    ]);
    loading = false;
  }
  function idbGet(k) { return new Promise((res) => { try { const o = indexedDB.open('fno_bt', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onsuccess = () => { try { const q = o.result.transaction('kv', 'readonly').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); } catch (e) { res(null); } }; o.onerror = () => res(null); } catch (e) { res(null); } }); }
  // background refresh so the report card has it too (cached by the Worker for 30 minutes)
  function start() { setTimeout(() => load(true), live() ? 25000 : 500); setInterval(() => load(true), 30 * 60e3); }

  /* ---------- sums ---------- */
  function sectors() {
    const S = {};
    (imp && imp.items || []).forEach((x) => x.sec.forEach(([n, d]) => { const s = S[n] || (S[n] = { n, sc: 0, k: 0, up: 0, dn: 0 }); s.sc += d * wOf(x); s.k++; if (d > 0) s.up++; else s.dn++; }));
    return Object.values(S).sort((a, b) => b.sc - a.sc);
  }
  function companies() {
    const C = {};
    (imp && imp.items || []).forEach((x) => x.co.forEach((c) => { const o = C[c.sym] || (C[c.sym] = { ...c, sc: 0, k: 0, heads: [] }); o.sc += c.d * wOf(x); o.k++; o.heads.push(x); }));
    return Object.values(C).sort((a, b) => Math.abs(b.sc) - Math.abs(a.sc));
  }
  function niftyLean() {
    const L = (imp && imp.items || []).filter((x) => ok(x.nifty) && x.nifty !== 0); if (!L.length) return null;
    const w = L.reduce((s, x) => s + wOf(x), 0); return w ? L.reduce((s, x) => s + x.nifty * wOf(x), 0) / w : null;
  }
  const leanTxt = (v) => (!ok(v) ? 'no clear lean' : v >= 0.35 ? 'clearly positive' : v >= 0.12 ? 'mildly positive' : v <= -0.35 ? 'clearly negative' : v <= -0.12 ? 'mildly negative' : 'neutral');
  // for the report card: is the news with this instrument's trade? { s: -1..1, n, top }
  function forInstrument(a) {
    if (!imp || !imp.items || !imp.items.length || !a) return null;
    let s = null, n = 0, top = null;
    if (a.cf.core) {
      const nl = niftyLean(); if (!ok(nl)) return null;
      s = nl; n = imp.items.filter((x) => x.nifty).length;
      if (/BANK/.test(a.key)) { const b = sectors().find((x) => x.n === 'Banks'); if (b && b.k) s = (nl + Math.max(-1, Math.min(1, b.sc / 3))) / 2; }
      top = imp.items.slice().sort((x, y) => Math.abs(y.nifty) * wOf(y) - Math.abs(x.nifty) * wOf(x))[0];
    } else {
      const sym = String(a.cf.sym || a.key).toUpperCase(), c = companies().find((x) => x.sym === sym); if (!c) return null;
      s = Math.max(-1, Math.min(1, c.sc / 3)); n = c.k; top = c.heads.slice().sort((x, y) => wOf(y) - wOf(x))[0];
    }
    return { s, n, top, lean: leanTxt(s) };
  }

  /* ---------- page ---------- */
  function build() {
    if ($i('im')) return;
    const el = document.createElement('div'); el.id = 'im'; el.className = 'rp im'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'News impact and results radar');
    el.innerHTML = `<div class="rp-top"><div class="mk-tabs" role="tablist"><button data-t="news" onclick="Impact.show('news')">News Impact</button><button data-t="results" onclick="Impact.show('results')">Results Radar</button></div>
      <span class="mut" id="imNote"></span><button class="x" onclick="Impact.close()" aria-label="Close">✕</button></div><div id="imBody"></div>`;
    document.body.appendChild(el);
  }
  async function open(t) { build(); $i('im').classList.add('on'); document.body.style.overflow = 'hidden'; await show(t || tab); }
  function close() { const el = $i('im'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; }
  async function show(t) {
    tab = t; document.querySelectorAll('#im .mk-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    render();
    if (!imp || (t === 'results' && !earn && live())) { $i('imBody').insertAdjacentHTML('afterbegin', '<div class="mut im-load">Reading the news…</div>'); await load(true); }
    else if (t === 'results' && live()) idbGet('scan').then((s) => { if (s) { scan = s; render(); } });
    render();
  }
  function render() { const b = $i('imBody'); if (!b) return; b.innerHTML = tab === 'news' ? newsHTML() : resultsHTML(); }

  function newsHTML() {
    if (err.imp && !imp) return `<div class="alert">${esc(err.imp)}</div>`;
    if (!imp) return '';
    if (!imp.items || !imp.items.length) return `<div class="alert i">${esc(imp.note || 'No headline with a clear sector effect right now.')}</div>`;
    $i('imNote').textContent = `${imp.items.length} headlines with a market effect (of ${imp.read || imp.items.length} read) · updated ${ago(imp.ts)}${imp.stale ? ' · AI busy, showing the last reading' : ''}`;
    const S = sectors(), C = companies(), nl = niftyLean(), mine = mySyms(), mx = Math.max(1, ...S.map((x) => Math.abs(x.sc)));
    const bar = (s) => `<div class="cb"><span>${esc(s.n)}</span><div class="t"><i style="${s.sc >= 0 ? `left:50%;width:${(Math.abs(s.sc) / mx) * 50}%;background:var(--call)` : `right:50%;width:${(Math.abs(s.sc) / mx) * 50}%;background:var(--put)`}"></i></div><em class="${cls(s.sc)}">${s.sc >= 0 ? '▲' : '▼'} ${s.k}</em></div>`;
    const hits = C.filter((c) => mine.has(c.sym));
    let h = `<div class="im-lean ${cls(nl)}"><b>News lean for the Nifty: ${leanTxt(nl)}</b><span>${ok(nl) ? `${nl >= 0 ? '+' : ''}${nl.toFixed(2)} on a −1 to +1 scale, newer and bigger stories count more` : ''}</span></div>`;
    if (hits.length) h += `<div class="alert ${hits.reduce((s, c) => s + c.sc, 0) >= 0 ? 'i' : 'd'}"><b>Your watchlist in the news:</b> ${hits.map((c) => `<span class="${cls(c.sc)}">${esc(c.sym)} ${c.sc >= 0 ? '▲' : '▼'}</span>`).join(', ')}</div>`;
    h += `<div class="mk-grid im-grid"><section class="mk-panel"><div class="ph"><h2>Sectors: who gains, who loses</h2></div>
      <div class="mut im-small">Tap a sector to see the headlines behind it. The number is how many stories touched it.</div>
      ${S.map((s) => `<button class="im-sec ${secPick === s.n ? 'on' : ''}" onclick="Impact.pick('${esc(s.n)}')">${bar(s)}</button>`).join('')}</section>
      <section class="mk-panel"><div class="ph"><h2>Companies named</h2></div>${C.length ? C.slice(0, 16).map((c) => `<div class="im-co"><b class="${cls(c.sc)}">${c.sc >= 0 ? '▲' : '▼'} ${esc(c.sym)}</b><span class="mut">${esc(c.name || '')}${c.fo ? ' · F&O' : ''}${mine.has(c.sym) ? ' · <span class="im-me">in your watchlist</span>' : ''}</span>${c.fo && c.key ? `<button class="btn-ghost" onclick="Impact.analyze('${esc(c.sym)}')">Analyze</button>` : ''}</div>`).join('') : '<div class="mut">No company named directly.</div>'}</section></div>`;
    const list = (imp.items || []).filter((x) => !secPick || x.sec.some(([n]) => n === secPick)).sort((a, b) => wOf(b) - wOf(a));
    h += `<section class="mk-panel" style="margin-top:12px"><div class="ph"><h2>${secPick ? esc(secPick) + ': the headlines' : 'The headlines and their effect'}</h2>${secPick ? '<button class="btn-ghost" onclick="Impact.pick(null)">Show all</button>' : ''}</div>
      ${list.map((x) => `<div class="im-h"><div class="im-ht"><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.t)}</a><span class="mut"> · ${esc(x.src || '')}, ${ago(x.ts)}${x.n > 1 ? `, ${x.n} outlets` : ''}</span></div>
        <div class="im-why"><span class="im-str" title="How big: ${x.str} of 3">${'●'.repeat(x.str)}<i>${'●'.repeat(3 - x.str)}</i></span> ${esc(x.why)} <span class="mut">(lasts ${HZ[x.hz]})</span></div>
        <div class="im-tags">${x.sec.map(([n, d]) => `<span class="pill ${d > 0 ? 'b' : 's'}">${d > 0 ? '▲' : '▼'} ${esc(n)}</span>`).join('')}${x.co.map((c) => `<span class="pill ${c.d > 0 ? 'b' : 's'}">${esc(c.sym)}</span>`).join('')}${x.nifty ? `<span class="pill n">Nifty ${x.nifty > 0 ? '+' : ''}${x.nifty.toFixed(1)}</span>` : ''}</div></div>`).join('')}</section>
      <div class="legend">The AI reads each headline and judges the likely effect, including second-order ones (cheaper crude helps airlines and paints, hurts oil producers). It can be wrong, and markets often price news in within minutes: by the time you read it, the first move may be over. Use it to know WHY a sector moves, not as a buy or sell signal. The call/put signals don't use this.</div>`;
    return h;
  }

  /* ---------- results radar ---------- */
  const SCR = [
    ['bounce', 'Strong results, beaten down', 'Profit growing fast (or a clear beat), but the stock is far below its 52-week high or near its low. Bounce watch: confirm on the chart first.'],
    ['fall', 'Weak results, still high', 'Profit falling (or a clear miss) while the stock still sits near its highs: room to fall if the market re-rates it.'],
    ['badnews', 'Weak results + bad news', 'A weak quarter and negative headlines about the company today.'],
    ['leaders', 'Strong results near highs', 'Fast profit growth and the price near its 52-week high: strength confirming strength.'],
    ['all', 'All results', 'Every company whose results made the headlines in the last 3 weeks, newest first.'],
  ];
  function rows() {
    const R = (earn && earn.items) || [], S = (scan && scan.rows) || [], C = companies();
    return R.map((x) => {
      const r = S.find((y) => y.sym === x.sym) || null, c = C.find((y) => y.sym === x.sym) || null;
      const strong = ok(x.pat) ? x.pat >= 20 : x.s >= 0.6, weak = ok(x.pat) ? x.pat <= -10 : x.s <= -0.5;
      const beaten = r ? (ok(r.offHi) && r.offHi <= -25) || (ok(r.lo52) && r.price <= r.lo52 * 1.15) || (ok(r.r20) && r.r20 <= -10) : false;
      const high = r ? ok(r.offHi) && r.offHi >= -8 : false;
      return { x, r, c, strong, weak, beaten, high, bad: !!(c && c.sc < 0) };
    });
  }
  function pick(list) {
    if (scr === 'bounce') return list.filter((z) => z.strong && z.beaten).sort((a, b) => (b.x.pat ?? 50) - (a.x.pat ?? 50));
    if (scr === 'fall') return list.filter((z) => z.weak && z.high).sort((a, b) => (a.x.pat ?? -50) - (b.x.pat ?? -50));
    if (scr === 'badnews') return list.filter((z) => z.weak && z.bad);
    if (scr === 'leaders') return list.filter((z) => z.strong && z.high).sort((a, b) => (b.x.pat ?? 50) - (a.x.pat ?? 50));
    return list;
  }
  function resultsHTML() {
    if (err.earn && !earn) return `<div class="alert">${esc(err.earn)}</div>`;
    if (!earn) return '';
    $i('imNote').textContent = `${(earn.items || []).length} companies' results from ${earn.read || '–'} headlines · updated ${ago(earn.ts)}${scan ? ` · prices from the Screener scan of ${scan.day}` : ''}`;
    const L = rows(), S = SCR.find((s) => s[0] === scr), list = pick(L), mine = mySyms();
    const counts = {}; const keep = scr; SCR.forEach(([k]) => { scr = k; counts[k] = pick(L).length; }); scr = keep;
    let h = `<section class="mk-panel scr"><aside><div class="sec" style="margin-top:0">Screens</div><div class="presets">${SCR.map(([k, n, d]) => `<button class="preset ${k === scr ? 'on' : ''} ${k === 'fall' || k === 'badnews' ? 'red' : ''}" onclick="Impact.setScr('${k}')"><em>${counts[k]}</em><b>${n}</b><small>${d}</small></button>`).join('')}</div></aside><div>`;
    if (!scan && scr !== 'all' && scr !== 'badnews') h += `<div class="alert i">These screens compare results with the price (52-week high and low, last month). That price data comes from the Screener's scan, which hasn't run in this browser yet. <button class="btn-ghost" onclick="Impact.close();Markets.open('scr')">Open Screener and run the scan (about 1 minute)</button></div>`;
    h += `<div class="ph"><h2>${S[1]}</h2></div><p class="mut" style="font-size:13px;margin:-6px 0 10px">${S[2]}</p>`;
    h += list.length ? `<div class="tblw"><table><thead><tr><th class="l">Stock</th><th>Profit YoY</th><th>Revenue YoY</th><th>Price</th><th>From 52W high</th><th>1M</th><th class="l">News today</th><th class="l">Headline</th><th></th></tr></thead><tbody>${list.map(({ x, r, c }) => `<tr>
        <td class="l nm"><b>${esc(x.sym)}${mine.has(x.sym) ? ' <span class="im-me">★</span>' : ''}</b><small>${esc(x.co)}${x.q ? ' · ' + esc(x.q) : ''}${x.fo ? ' · F&O' : ''}</small></td>
        <td class="${cls(x.pat)}">${ok(x.pat) ? pct(x.pat) : `<span class="mut">${x.s >= 0.5 ? 'beat' : x.s <= -0.5 ? 'miss' : '–'}</span>`}</td><td class="${cls(x.rev)}">${pct(x.rev)}</td>
        <td>${r ? f2(r.price) : '–'}</td><td>${r ? pct(r.offHi, 1) : '–'}</td><td class="${cls(r && r.r20)}">${r ? pct(r.r20, 1) : '–'}</td>
        <td class="l">${c ? `<span class="${cls(c.sc)}">${c.sc >= 0 ? '▲ positive' : '▼ negative'}</span>` : '<span class="mut">–</span>'}</td>
        <td class="l im-hl"><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.t)}</a><br><small class="mut">${esc(x.src || '')}, ${ago(x.ts)}</small></td>
        <td>${x.fo && x.key ? `<button class="btn-ghost" onclick="Impact.analyze('${esc(x.sym)}')">Analyze</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="mut">${scan || scr === 'all' || scr === 'badnews' ? 'No stock fits this screen right now.' : 'Run the Screener scan to fill this screen.'}</div>`;
    h += `<div class="legend">Profit and revenue growth are read from results headlines on trusted business sites, not from the filings: a headline can round, or quote a different profit line. Check the company's results before acting. Strong results with a falling price can also mean the market expected even more, or worries about the next quarter. These screens find stocks to study; the chart and your report card decide the trade.</div></div></section>`;
    return h;
  }
  function setScr(k) { scr = k; render(); }
  function pickSec(n) { secPick = n; render(); }
  function analyze(sym) {
    if (!live()) return toast('Adding stocks works in live mode.');
    const c = companies().find((x) => x.sym === sym) || (earn && earn.items.find((x) => x.sym === sym));
    if (!c || !c.key) return;
    close();
    addWatch({ id: sym.replace(/[^A-Z0-9&]/g, '').slice(0, 20), label: sym, name: c.name || c.co || sym, key: c.key, ukey: c.key, exch: 'NSE', kind: 'EQ', fo: true, lot: c.lot || null, sym });
  }

  /* ---------- demo data (so every part can be tried in demo mode) ---------- */
  function demoImpact() {
    const t = Date.now(), H = (m) => t - m * 60e3;
    const co = (sym, d, name) => ({ sym, d, fo: true, key: '', name, lot: null });
    return { ts: t, ai: true, read: 36, items: [
      { t: 'Brent crude slides to $90 a barrel as Middle East tensions ease (demo)', src: 'Reuters', link: '#', ts: H(40), n: 4, nifty: 0.5, str: 3, hz: 'w', sec: [['Aviation', 1], ['Oil marketing (OMCs)', 1], ['Paints & Chemicals', 1], ['Upstream oil & gas', -1]], co: [co('INDIGO', 1, 'InterGlobe Aviation'), co('BPCL', 1, 'Bharat Petroleum'), co('ASIANPAINT', 1, 'Asian Paints'), co('ONGC', -1, 'ONGC')], why: 'Cheaper crude cuts fuel and raw-material costs; oil producers earn less per barrel.' },
      { t: 'US Fed signals a pause; 10-year Treasury yield falls (demo)', src: 'CNBC', link: '#', ts: H(180), n: 3, nifty: 0.3, str: 2, hz: 'w', sec: [['Banks', 1], ['NBFC & Finance', 1], ['IT', -1]], co: [co('HDFCBANK', 1, 'HDFC Bank'), co('BAJFINANCE', 1, 'Bajaj Finance')], why: 'Lower US yields draw foreign money back to India; a softer dollar trims IT exporters\' rupee gains.' },
      { t: 'Government raises import duty on steel to curb cheap Chinese supply (demo)', src: 'Economic Times', link: '#', ts: H(300), n: 2, nifty: 0.05, str: 2, hz: 'm', sec: [['Metals & Mining', 1], ['Auto', -1], ['Capital goods & Infra', -1]], co: [co('TATASTEEL', 1, 'Tata Steel'), co('JSWSTEEL', 1, 'JSW Steel')], why: 'Domestic steel makers get pricing power; steel users pay more.' },
      { t: 'US proposes 25% tariff on generic drug imports (demo)', src: 'Mint', link: '#', ts: H(420), n: 2, nifty: -0.2, str: 2, hz: 'm', sec: [['Pharma & Healthcare', -1]], co: [co('SUNPHARMA', -1, 'Sun Pharma'), co('CIPLA', -1, 'Cipla')], why: 'US generics are a big share of Indian pharma exports.' },
      { t: 'Weak monsoon end hurts rural demand outlook (demo)', src: 'Business Standard', link: '#', ts: H(900), n: 1, nifty: -0.1, str: 1, hz: 'm', sec: [['FMCG', -1], ['Fertilisers & Agri', -1], ['Auto', -1]], co: [co('HEROMOTOCO', -1, 'Hero MotoCorp')], why: 'Rural spending on two-wheelers and staples may slow.' },
    ] };
  }
  function demoEarnings() {
    const t = Date.now(), D = (d) => t - d * 864e5;
    const e = (sym, co, pat, rev, s, d, txt) => ({ sym, co, q: 'Q2 FY27', pat, rev, s, t: txt + ' (demo)', src: 'Moneycontrol', link: '#', ts: D(d), fo: true, key: '' });
    return { ts: t, ai: true, read: 64, items: [
      e('DIXON', 'Dixon Technologies', 62, 41, 0.8, 2, 'Dixon Q2 net profit jumps 62% YoY, revenue up 41%'),
      e('LUPIN', 'Lupin', 38, 12, 0.6, 3, 'Lupin Q2 profit rises 38% on US sales'),
      e('TRENT', 'Trent', -14, 9, -0.6, 4, 'Trent Q2 profit falls 14% as margins shrink'),
      e('HEROMOTOCO', 'Hero MotoCorp', -18, -6, -0.7, 5, 'Hero MotoCorp Q2 profit falls 18% on weak rural demand'),
      e('BEL', 'Bharat Electronics', 27, 19, 0.7, 6, 'BEL Q2 profit up 27%, order book at record'),
      e('PERSISTENT', 'Persistent Systems', 31, 22, 0.7, 8, 'Persistent Q2 net profit rises 31% YoY'),
    ] };
  }
  function demoScan() {
    const r = (sym, price, offHi, lo52, r20) => ({ sym, price, offHi, lo52, r20, hi52: price / (1 + offHi / 100) });
    return { day: 'demo', ts: Date.now(), rows: [r('DIXON', 14200, -31, 13100, -12), r('LUPIN', 1880, -27, 1720, -6), r('TRENT', 6900, -4, 4500, 3), r('HEROMOTOCO', 5100, -6, 3900, 2), r('BEL', 412, -3, 250, 5), r('PERSISTENT', 6100, -2, 4200, 7)] };
  }

  window.addEventListener('load', () => start());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $i('im') && $i('im').classList.contains('on')) close(); });
  return { open, close, show, setScr, pick: pickSec, analyze, load, loadEarnings, start, forInstrument, niftyLean, sectors, companies, get data() { return imp; }, get earnings() { return earn; } };
})();
