/* ===== Quick search (Ctrl+K or /): jump to any page, tab, instrument or F&O stock by typing a few letters ===== */
const Palette = (() => {
  const $p = (id) => document.getElementById(id);
  let items = [], sel = 0, list = [];
  const closeAll = () => { ['it', 'bf', 'mk', 'rp', 'ov', 'im', 'jr', 'al', 'gd', 'rc'].forEach((id) => { const e = $p(id); if (e) e.classList.remove('on'); }); document.body.style.overflow = ''; };
  function base() {
    const P = [
      ['Overview: whole market on one page', 'Intel.open("ov")', 'overview home summary pulse'], ['Strength & money flow', 'Intel.open("str")', 'relative strength leaders laggards flow mood'],
      ['Sector rotation', 'Intel.open("sec")', 'sectors heatmap rotation'], ['Market regime & Calm Zone', 'Intel.open("reg")', 'regime volatility calm trend vix'],
      ['IV, futures basis & stocks to avoid', 'Intel.open("scr")', 'iv basis rsi avoid ban screener'], ['Data freshness & usage (limits)', 'Intel.open("use")', 'usage limit quota rate upstox ai'],
      ['Next-Day Brief: tomorrow\'s lists', 'Brief.open("lists")', 'brief tomorrow top 5 positive negative'], ['Brief: track record', 'Brief.open("rec")', 'audit accuracy record predictions'],
      ['Brief: all F&O stocks', 'Brief.open("all")', 'oi buildup delivery'], ['Market map', 'Markets.open("map")', 'map heatmap index'],
      ['Screener', 'Markets.open("scr")', 'screener scan'], ['Intraday radar & ORB breakouts', 'Markets.open("scr");setTimeout(()=>Markets.setScr("orb"),300)', 'orb radar breakout opening range unusual volume oi'],
      ['Replay & backtest', 'Replay.open()', 'replay backtest practice history time machine'], ['Overnight: BTST & gap radar', 'Overnight.open("edge")', 'overnight btst gap'],
      ['Reversal radar', 'Overnight.open("rev")', 'reversal bounce'], ['News impact', 'Impact.open("news")', 'news impact headlines'], ['Results radar', 'Impact.open("results")', 'results earnings'],
      ['Journal: lessons', 'Journal.open("lessons")', 'journal lessons mistakes'], ['Alerts & shock detector', 'Alerts.open()', 'alerts price shock'],
      ['Guide (simple Hindi)', 'Guide.open()', 'guide help hindi meaning'], ['Guide: glossary', 'Guide.open("words")', 'glossary words oi pcr'], ['Take the tour again', 'Guide.tour()', 'tour onboarding start help'],
    ].map(([t, run, k]) => ({ t, run, k, kind: 'Page' }));
    const I = (typeof KEYS !== 'undefined' ? KEYS : []).map((k) => ({ t: (typeof CFG !== 'undefined' && CFG[k] ? CFG[k].label : k), run: `pick("${k}")`, k: k + ' ' + (CFG[k] && CFG[k].name ? CFG[k].name : ''), kind: 'Watchlist' }));
    const E = typeof EodCache !== 'undefined' && EodCache.peek() ? Object.keys(EodCache.peek().q || {}).filter((s) => !EodCache.peek().q[s].idx) : [];
    const S = (E.length ? E : (typeof Brief !== 'undefined' && Brief.data ? Brief.data.R.stocks.map((x) => x.sym) : [])).map((s) => ({ t: 'Analyze ' + s, run: `Brief.analyze("${s}")`, k: s, kind: 'F&O stock' }));
    return [...P, ...I, ...S];
  }
  function score(it, q) {
    if (!q) return it.kind === 'Page' ? 1 : 0;
    const h = (it.t + ' ' + it.k).toLowerCase(), w = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!w.every((x) => h.includes(x))) return 0;
    return (it.t.toLowerCase().startsWith(w[0]) ? 3 : 1) + (it.kind === 'Page' ? 1 : 0) + (it.k.toLowerCase() === q.toLowerCase() ? 5 : 0);
  }
  function build() {
    if ($p('pal')) return;
    const el = document.createElement('div'); el.id = 'pal'; el.className = 'pal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Quick search');
    el.innerHTML = `<div class="pal-box"><input id="palQ" placeholder="Type a page, tab or stock… (Esc to close)" autocomplete="off" aria-label="Search"><div id="palL" role="listbox"></div><div class="pal-foot">↑ ↓ to move · Enter to open · Ctrl+K or / anytime</div></div>`;
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    document.body.appendChild(el);
    const q = $p('palQ');
    q.addEventListener('input', draw);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { go(sel); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
  }
  function draw() { const q = $p('palQ').value.trim(); list = items.map((it) => [score(it, q), it]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 12).map((x) => x[1]); sel = 0; paint(); }
  function paint() { $p('palL').innerHTML = list.length ? list.map((it, i) => `<button class="pal-i ${i === sel ? 'on' : ''}" role="option" aria-selected="${i === sel}" onclick="Palette.go(${i})"><span>${esc(it.t)}</span><small>${it.kind}</small></button>`).join('') : '<div class="mut" style="padding:10px">Nothing found.</div>'; }
  function go(i) { const it = list[i]; if (!it) return; close(); if (it.kind !== 'Watchlist') closeAll(); else closeAll(); try { (0, eval)(it.run); } catch (e) { toast(e.message); } }
  function open() { build(); items = base(); $p('pal').classList.add('on'); $p('palQ').value = ''; draw(); setTimeout(() => $p('palQ').focus(), 20); }
  function close() { const e = $p('pal'); if (e) e.classList.remove('on'); }
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '') || (document.activeElement && document.activeElement.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); open(); }
  });
  return { open, close, go };
})();
