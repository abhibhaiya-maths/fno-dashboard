/* ===== Journal: learn from your own record =====
   Every paper trade and every recorded signal now carries a snapshot of the market at that moment (Journal.snap, saved by
   paper.js). This page groups them by condition (time of day, expiry day, VIX, report-card score, Market Brain, daily trend,
   news, kind of day, grade, direction, instrument, weekday, your own tags) and finds where you win and where you lose.
   You can switch any finding into a warning: the report card then shows it when the same situation comes up.
   It never changes a signal, a grade or a trade by itself. */
const Journal = (() => {
  const $j = (id) => document.getElementById(id);
  const TAGS = ['Followed plan', 'FOMO', 'Revenge trade', 'Early exit', 'Late exit', 'Moved my SL', 'Too big', 'News trade'];
  let sample = null, tab = 'lessons';
  const rules = () => Store.pref('journal_rules', []);
  const setRules = (r) => Store.setPref('journal_rules', r);

  /* ---------- the snapshot saved with each trade / signal ---------- */
  function snap(a, dir) {
    if (!a) return null;
    const d = dir === 'PE' ? -1 : 1, s = signalFor(a);
    let q = null;
    try { if (typeof Report !== 'undefined') { const ss = s.state === dir ? s : { ...s, state: dir, setup: null, grade: null, dirScore: dir === 'CE' ? a.score : 100 - a.score }; q = Report.quality(Report.checklist(a, ss).items); } } catch (e) { q = null; }
    let news = null; try { const n = typeof Impact !== 'undefined' ? Impact.forInstrument(a) : null; if (n && ok(n.s)) news = Math.round(n.s * d * 100) / 100; } catch (e) { /* no news */ }
    return { m: a.curMin, vix: a.vix && ok(a.vix.v) ? Math.round(a.vix.v * 100) / 100 : null, dte: a.ch && ok(a.ch.dte) ? Math.round(a.ch.dte * 100) / 100 : null,
      brain: a.brain && ok(a.brain.score) ? a.brain.score * d : null, q, news, day: a.brain && a.brain.day ? a.brain.day.kind : null,
      daily: a.long && a.long.dir ? (a.long.dir === dir ? 'with' : 'against') : 'none', adx: ok(a.adx) ? Math.round(a.adx) : null, core: !!a.cf.core };
  }

  /* ---------- how each condition is grouped ---------- */
  const DIMS = [
    ['time', 'Time of day', (r) => { const m = r.m; return !ok(m) ? null : m < 45 ? '9:15–10:00' : m < 165 ? '10:00–12:00' : m < 285 ? '12:00–14:00' : '14:00–15:30'; }],
    ['exp', 'Expiry', (r) => (r.c && ok(r.c.dte) ? (r.c.dte <= 1 ? 'Expiry day (≤1 day left)' : r.c.dte <= 3 ? '2–3 days to expiry' : '4+ days to expiry') : null)],
    ['vix', 'India VIX', (r) => (r.c && ok(r.c.vix) ? (r.c.vix < 13 ? 'VIX below 13' : r.c.vix < 16 ? 'VIX 13–16' : r.c.vix < 20 ? 'VIX 16–20' : 'VIX 20+') : null)],
    ['q', 'Report-card score', (r) => (r.c && ok(r.c.q) ? (r.c.q < 45 ? 'Report card under 45' : r.c.q < 60 ? 'Report card 45–59' : r.c.q < 75 ? 'Report card 60–74' : 'Report card 75+') : null)],
    ['brain', 'Market Brain', (r) => (r.c && ok(r.c.brain) ? (r.c.brain >= 15 ? 'Market Brain with you' : r.c.brain <= -15 ? 'Market Brain against you' : 'Market Brain neutral') : null)],
    ['daily', 'Daily trend', (r) => (r.c && r.c.daily ? { with: 'With the daily trend', against: 'Against the daily trend', none: 'No daily trend' }[r.c.daily] : null)],
    ['news', 'Today\'s news', (r) => (r.c && ok(r.c.news) ? (r.c.news >= 0.12 ? 'News with you' : r.c.news <= -0.12 ? 'News against you' : 'News neutral') : null)],
    ['day', 'Kind of day', (r) => (r.c && r.c.day ? { trend: 'Trend day', range: 'Range day', normal: 'Normal day' }[r.c.day] : null)],
    ['adx', 'Trend strength (ADX)', (r) => (r.c && ok(r.c.adx) ? (r.c.adx < 18 ? 'ADX under 18 (weak trend)' : r.c.adx < 25 ? 'ADX 18–25' : 'ADX 25+ (strong trend)') : null)],
    ['grade', 'Grade', (r) => (r.g ? `Grade ${r.g}` : null)],
    ['dir', 'Direction', (r) => (r.dir === 'CE' ? 'CALL' : r.dir === 'PE' ? 'PUT' : null)],
    ['inst', 'Instrument', (r) => r.inst || null],
    ['wd', 'Weekday', (r) => (r.date && /^\d{4}-/.test(r.date) ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(r.date + 'T00:00:00Z').getUTCDay()] : null)],
    ['tag', 'Your tags', (r) => r.tags || null],
  ];
  const OUT = { 'सही': 'right', 'ग़लत': 'wrong', 'फ़्लैट': 'flat' };
  // one common shape for trades and signals
  function rowsTrades() {
    if (sample) return sample.trades;
    return (Paper.allTrades ? Paper.allTrades() : []).filter((t) => t.status === 'closed' && ok(t.net)).map((t) => ({ id: t.id, win: t.net > 0, val: t.net, m: t.openedMin, c: t.ctx, g: t.grade, dir: t.type, inst: t.label, date: t.openedDate, tags: t.tags && t.tags.length ? t.tags : null, t }));
  }
  function rowsSignals() {
    if (sample) return sample.signals;
    return (Paper.allSignals ? Paper.allSignals() : []).map((x) => ({ x, o: OUT[x.r30] || x.r30 })).filter((z) => z.o === 'right' || z.o === 'wrong')
      .map(({ x, o }) => ({ win: o === 'right', val: null, m: x.min, c: x.ctx, g: x.grade, dir: x.dir, inst: CFG[x.key] ? CFG[x.key].label : x.key, date: x.date }));
  }
  function groups(rows) {
    const G = {};
    DIMS.forEach(([id, name, f]) => rows.forEach((r) => { let b = f(r); if (b == null) return; (Array.isArray(b) ? b : [b]).forEach((bb) => { const k = id + '|' + bb, g = G[k] || (G[k] = { id, name, b: bb, n: 0, w: 0, sum: 0 }); g.n++; if (r.win) g.w++; if (ok(r.val)) g.sum += r.val; }); }));
    return Object.values(G);
  }
  function lessons(rows, kind) {
    const n = rows.length; if (!n) return { n: 0, rate: null, list: [], G: [] };
    const rate = rows.filter((r) => r.win).length / n, minN = kind === 'trades' ? 8 : 20, G = groups(rows);
    const list = G.filter((g) => g.n >= minN && g.n < n).map((g) => ({ ...g, rate: g.w / g.n, diff: g.w / g.n - rate })).filter((g) => Math.abs(g.diff) >= 0.12)
      .sort((x, y) => Math.abs(y.diff) * Math.sqrt(y.n) - Math.abs(x.diff) * Math.sqrt(x.n));
    return { n, rate, list, G };
  }
  const pc = (x) => (ok(x) ? Math.round(x * 100) + '%' : '–');
  function sentence(g, kind, base) {
    return kind === 'trades' ? `${g.b}: you won ${pc(g.rate)} of ${g.n} paper trades${ok(g.sum) && g.sum ? `, net ${g.sum >= 0 ? '+' : '−'}₹${f0(Math.abs(g.sum))}` : ''} (overall ${pc(base)}).`
      : `${g.b}: signals were right ${pc(g.rate)} of ${g.n} times after 30 min (overall ${pc(base)}).`;
  }

  /* ---------- warnings for the report card (advice only) ---------- */
  function warnings(a, s) {
    const R = rules(); if (!R.length || !a) return [];
    const dir = s && (s.state === 'CE' || s.state === 'PE') ? s.state : null; if (!dir) return [];
    const now = { win: false, m: a.curMin, c: snap(a, dir), g: s.grade, dir, inst: a.cf.label, date: istYmd(), tags: null };
    const out = [];
    R.forEach((r) => { const D = DIMS.find((x) => x[0] === r.id); if (!D) return; const b = D[2](now); if (b === r.b || (Array.isArray(b) && b.includes(r.b))) out.push(r.text); });
    return out;
  }
  function toggleRule(id, b, text) {
    const R = rules(), i = R.findIndex((r) => r.id === id && r.b === b);
    if (i >= 0) R.splice(i, 1); else R.push({ id, b, text });
    setRules(R); render(); toast(i >= 0 ? 'Warning removed' : 'Warning added: the report card will show it when this situation comes up');
  }

  /* ---------- page ---------- */
  function build() {
    if ($j('jr')) return;
    const el = document.createElement('div'); el.id = 'jr'; el.className = 'rp jr'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Journal');
    el.innerHTML = `<div class="rp-top"><div class="mk-tabs" role="tablist"><button data-t="lessons" onclick="Journal.show('lessons')">Lessons</button><button data-t="table" onclick="Journal.show('table')">Full Breakdown</button><button data-t="trades" onclick="Journal.show('trades')">My Trades & Tags</button></div>
      <span class="mut" id="jrNote"></span><button class="x" onclick="Journal.close()" aria-label="Close">✕</button></div><div id="jrBody"></div>`;
    document.body.appendChild(el);
  }
  function open(t) { build(); $j('jr').classList.add('on'); document.body.style.overflow = 'hidden'; show(t || tab); }
  function close() { const el = $j('jr'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; }
  function show(t) { tab = t; render(); }
  function render() {
    const b = $j('jrBody'); if (!b) return;
    document.querySelectorAll('#jr .mk-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
    const T = rowsTrades(), S = rowsSignals(), LT = lessons(T, 'trades'), LS = lessons(S, 'signals'), withCtx = [...T, ...S].filter((r) => r.c).length;
    $j('jrNote').textContent = `${T.length} closed paper trades · ${S.length} checked signals · ${withCtx} with full market conditions${sample ? ' · SAMPLE DATA (demo)' : ''}`;
    let h = '';
    if (sample) h += '<div class="alert">Sample data for the demo: made-up records so you can see how the page works. Your own record replaces it in live mode.</div>';
    h += `<div class="lv jr-sum"><div><small>Paper trades won</small><b>${pc(LT.rate)}</b><small>${LT.n} closed</small></div><div><small>Net after charges</small><b class="${T.reduce((x, r) => x + (r.val || 0), 0) >= 0 ? 'up' : 'down'}">${T.length ? (T.reduce((x, r) => x + (r.val || 0), 0) >= 0 ? '+' : '−') + '₹' + f0(Math.abs(T.reduce((x, r) => x + (r.val || 0), 0))) : '–'}</b></div><div><small>Signals right (30 min)</small><b>${pc(LS.rate)}</b><small>${LS.n} checked</small></div></div>`;
    if (tab === 'lessons') h += lessonsHTML(LT, LS, T, S);
    else if (tab === 'table') h += tableHTML(LT, LS);
    else h += tradesHTML(T);
    b.innerHTML = h;
  }
  function lessonCard(g, kind, base) {
    const on = rules().some((r) => r.id === g.id && r.b === g.b), bad = g.diff < 0, txt = sentence(g, kind, base);
    const warnTxt = `${g.b}: ${kind === 'trades' ? `you won only ${pc(g.rate)} of ${g.n} paper trades here` : `signals were right only ${pc(g.rate)} of ${g.n} times here`} (overall ${pc(base)}).`;
    return `<div class="jr-l ${bad ? 'bad' : 'good'}"><span class="jr-ic">${bad ? '▼' : '▲'}</span><div><b>${esc(g.name)}</b><span>${esc(txt)}</span></div>${bad ? `<button class="${on ? 'btn-solid pe' : 'btn-ghost'}" onclick='Journal.rule(${JSON.stringify(g.id)},${JSON.stringify(g.b)},${JSON.stringify(warnTxt)})'>${on ? 'Warning on ✓' : 'Warn me here'}</button>` : ''}</div>`;
  }
  function lessonsHTML(LT, LS, T, S) {
    let h = '';
    const need = (T.length < 8 && S.length < 20);
    if (need) h += `<div class="alert i">Not enough record yet: ${T.length} closed paper trades and ${S.length} checked signals. Lessons appear once a condition has 8+ trades or 20+ signals and differs from your average by 12 points or more. Keep paper trading; every trade and signal is now saved with the market conditions at that moment.${Source.mode !== 'live' ? ' <button class="btn-ghost" onclick="Journal.demo()">Show sample data</button>' : ''}</div>`;
    if (LT.list.length) h += `<div class="sec">From your paper trades</div>${LT.list.slice(0, 10).map((g) => lessonCard(g, 'trades', LT.rate)).join('')}`;
    if (LS.list.length) h += `<div class="sec">From the engine's signals</div>${LS.list.slice(0, 12).map((g) => lessonCard(g, 'signals', LS.rate)).join('')}`;
    if (!need && !LT.list.length && !LS.list.length) h += '<div class="alert i">No condition stands out yet: your results look about the same everywhere. That itself is useful: no single situation is dragging you down.</div>';
    const R = rules();
    h += `<div class="sec">Warnings switched on (${R.length})</div>${R.length ? R.map((r) => `<div class="jr-r"><span>${esc(r.text)}</span><button class="btn-ghost" onclick='Journal.rule(${JSON.stringify(r.id)},${JSON.stringify(r.b)},"")'>Remove</button></div>`).join('') : '<div class="mut jr-p">None yet. Tap "Warn me here" on a weak spot above; the report card will then flag it when the same situation comes up.</div>'}`;
    h += '<div class="legend">Small samples mislead: a condition needs many trades before it means something, so lessons only appear past the minimums above. A warning is advice only, it never blocks a trade or changes a grade. Market conditions are saved from today on; older records only have time, grade, direction, instrument and weekday.</div>';
    return h;
  }
  function tableHTML(LT, LS) {
    const by = (L, kind) => { const G = L.G.slice().sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : y.n - x.n)); if (!G.length) return '<div class="mut jr-p">No records yet.</div>';
      let cur = '', h = `<div class="tblw"><table><thead><tr><th class="l">Condition</th><th>${kind === 'trades' ? 'Trades' : 'Signals'}</th><th>${kind === 'trades' ? 'Won' : 'Right'}</th>${kind === 'trades' ? '<th>Net</th>' : ''}<th>vs your average</th></tr></thead><tbody>`;
      G.forEach((g) => { if (g.name !== cur) { cur = g.name; h += `<tr><td colspan="${kind === 'trades' ? 5 : 4}" class="l mut jr-gh">${esc(g.name)}</td></tr>`; } const r = g.w / g.n, d = r - L.rate;
        h += `<tr><td class="l">${esc(g.b)}</td><td>${g.n}</td><td>${pc(r)}</td>${kind === 'trades' ? `<td class="${g.sum >= 0 ? 'up' : 'down'}">${g.sum >= 0 ? '+' : '−'}₹${f0(Math.abs(g.sum))}</td>` : ''}<td class="${g.n < (kind === 'trades' ? 8 : 20) ? 'mut' : d >= 0.05 ? 'up' : d <= -0.05 ? 'down' : ''}">${d >= 0 ? '+' : ''}${Math.round(d * 100)} pts${g.n < (kind === 'trades' ? 8 : 20) ? ' (few)' : ''}</td></tr>`; });
      return h + '</tbody></table></div>'; };
    return `<div class="sec">Paper trades by condition</div>${by(LT, 'trades')}<div class="sec">Signals by condition (right after 30 minutes)</div>${by(LS, 'signals')}`;
  }
  function tradesHTML(T) {
    if (!T.length) return '<div class="mut jr-p">No closed paper trades yet.</div>';
    return `<p class="mut jr-p">Tag each trade honestly. After a few weeks the Lessons tab shows what each habit costs you (for example "trades tagged FOMO: won 25%").</p>` + T.slice(0, 40).map((r) => {
      const t = r.t || {}, tags = r.tags || [];
      return `<div class="jr-t"><div class="jr-th"><b>${esc(r.inst || '')} ${t.K || ''} ${r.dir || ''}</b>${r.g ? ` <span class="gb g-${r.g === '★' ? 'P' : r.g}">${r.g}</span>` : ''}<span class="mut">${esc(String(r.date || '').replace(/^DEMO-\w+/, 'demo'))} ${ok(r.m) ? hm(r.m) : ''}</span><b class="${r.val >= 0 ? 'up' : 'down'}">${r.val >= 0 ? '+' : '−'}₹${f0(Math.abs(r.val || 0))}</b></div>
        ${t.reason ? `<div class="mut jr-p">${esc(t.reason)}${r.c && ok(r.c.q) ? ` · report card ${r.c.q}` : ''}${r.c && ok(r.c.vix) ? ` · VIX ${f1(r.c.vix)}` : ''}</div>` : ''}
        <div class="jr-tags">${TAGS.map((g) => `<button class="${tags.includes(g) ? 'on' : ''}" onclick='Journal.tag(${JSON.stringify(r.id)},${JSON.stringify(g)})'>${g}</button>`).join('')}</div></div>`;
    }).join('');
  }
  async function tag(id, g) {
    if (sample) { const r = sample.trades.find((x) => x.id === id); if (r) { r.tags = r.tags || []; r.tags = r.tags.includes(g) ? r.tags.filter((x) => x !== g) : [...r.tags, g]; if (!r.tags.length) r.tags = null; } render(); return; }
    const t = (Paper.allTrades() || []).find((x) => x.id === id); if (!t) return;
    const cur = t.tags || [], nx = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
    await Paper.tagTrade(id, nx); render();
  }

  /* ---------- demo sample (never saved) ---------- */
  function demo() {
    const r = rng(99), S = [], T = [], insts = ['NIFTY 50', 'BANK NIFTY', 'SENSEX'], gr = ['★', 'A', 'A', 'B', 'S'];
    const mk = (i) => { const m = Math.floor(r() * 370), c = { m, vix: 11 + r() * 12, dte: r() * 7, brain: (r() - 0.5) * 100, q: Math.round(30 + r() * 60), news: (r() - 0.5) * 0.8, day: ['trend', 'normal', 'range'][Math.floor(r() * 3)], daily: ['with', 'against', 'none'][Math.floor(r() * 3)], adx: Math.round(12 + r() * 25) };
      let p = 0.52 + (c.q - 60) / 250 + (c.daily === 'with' ? 0.06 : c.daily === 'against' ? -0.08 : 0) - (m > 285 ? 0.12 : 0) - (c.dte <= 1 ? 0.1 : 0) + (c.brain > 15 ? 0.05 : c.brain < -15 ? -0.05 : 0);
      return { m, c, p, g: gr[Math.floor(r() * gr.length)], dir: r() > 0.5 ? 'CE' : 'PE', inst: insts[Math.floor(r() * 3)], date: (() => { const n = Math.floor(i / 6), d = Date.UTC(2026, 8, 7) + (Math.floor(n / 5) * 7 + (n % 5)) * 864e5; return new Date(d).toISOString().slice(0, 10); })() }; }; // weekdays only
    for (let i = 0; i < 420; i++) { const x = mk(i); S.push({ ...x, win: r() < x.p, val: null }); }
    for (let i = 0; i < 90; i++) { const x = mk(i * 4); const fomo = r() < 0.2, rev = !fomo && r() < 0.12, p = x.p - (fomo ? 0.2 : 0) - (rev ? 0.25 : 0), win = r() < p; T.push({ ...x, id: 'd' + i, win, val: Math.round(win ? 600 + r() * 2400 : -(500 + r() * 1800)), tags: fomo ? ['FOMO'] : rev ? ['Revenge trade'] : r() < 0.5 ? ['Followed plan'] : null, t: { K: 25500, reason: win ? 'Target 1' : 'Stop-loss hit' } }); }
    sample = { trades: T, signals: S }; render();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $j('jr') && $j('jr').classList.contains('on')) close(); });
  return { snap, open, close, show, warnings, rule: toggleRule, tag, demo, lessons, rowsTrades, rowsSignals };
})();
