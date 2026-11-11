/* ===== Ask about results dates: "11 तारीख को किसके रिजल्ट आने हैं?", "kal kaun se results aaye", "Reliance ka result kab hai" =====
   Answers straight from the results calendar (NSE event calendar, or results-date headlines when NSE blocks the Worker)
   plus the Results Radar numbers for companies that already reported. The AI (if on) gets only this focused list,
   so it can't invent names or dates. Screen text English, spoken summary Hindi, like the rest of the Ask box. */
const ResultsAsk = (() => {
  let cal = null, at = 0;
  const MON = { jan: 0, january: 0, जनवरी: 0, feb: 1, february: 1, फरवरी: 1, फ़रवरी: 1, mar: 2, march: 2, मार्च: 2, apr: 3, april: 3, अप्रैल: 3, may: 4, मई: 4, jun: 5, june: 5, जून: 5, jul: 6, july: 6, जुलाई: 6,
    aug: 7, august: 7, अगस्त: 7, sep: 8, sept: 8, september: 8, सितंबर: 8, सितम्बर: 8, oct: 9, october: 9, अक्टूबर: 9, nov: 10, november: 10, नवंबर: 10, नवम्बर: 10, dec: 11, december: 11, दिसंबर: 11, दिसम्बर: 11 };
  const WD = { sunday: 0, sun: 0, रविवार: 0, monday: 1, mon: 1, सोमवार: 1, tuesday: 2, tue: 2, मंगलवार: 2, wednesday: 3, wed: 3, बुधवार: 3, thursday: 4, thu: 4, गुरुवार: 4, friday: 5, fri: 5, शुक्रवार: 5, saturday: 6, sat: 6, शनिवार: 6 };
  const RES_RE = /result|रिजल्ट|रिज़ल्ट|नतीजे|नतीजा|earnings|quarter|तिमाही|q[1-4]\b|board meeting/i;
  const PAST_RE = /\b(aaye|aaya|aayi|aa gaye|aa gaya|aa chuke|declared|announced|came|reported|was|were|out)\b|आए|आया|आई|आ गए|आ गया|आ चुके|घोषित/i;
  const FUT_RE = /\b(aane|aayenge|aayega|aayegi|will|upcoming|coming|due|next|hone)\b|आने|आएँगे|आएंगे|आएगा|आएगी|होने|आगे/i;
  const ymdOf = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
  const todayMs = () => Date.parse(istYmd() + 'T00:00:00+05:30');
  const dLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dHi = (d) => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCDate()} ${['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'][x.getUTCMonth()]}`; };

  function match(raw) { return RES_RE.test(raw); }
  // which day(s) is the question about? → { from, to, past, label } or null
  function when(raw) {
    const t = raw.toLowerCase().replace(/[०-९]/g, (d) => '०१२३४५६७८९'.indexOf(d)).replace(/\bq[1-4]\s*(fy\s*\d{2,4})?\b|\bfy\s*\d{2,4}\b|\b(19|20)\d{2}-\d{2}\b/g, ' '), T = todayMs(), day = 864e5;
    const past = PAST_RE.test(t) && !FUT_RE.test(t), fut = FUT_RE.test(t);
    const one = (ms, label) => ({ from: ymdOf(ms), to: ymdOf(ms), label, past: ms < T || (ms === T && past) });
    if (/\btoday\b|\baaj\b|आज/.test(t)) return one(T, 'today');
    if (/\bday after tomorrow\b|parso|परसों/.test(t)) return past ? one(T - 2 * day, 'day before yesterday') : one(T + 2 * day, 'day after tomorrow');
    if (/\btomorrow\b/.test(t)) return one(T + day, 'tomorrow');
    if (/\byesterday\b/.test(t)) return one(T - day, 'yesterday');
    if (/\bkal\b|कल/.test(t)) return past && !fut ? one(T - day, 'yesterday') : one(T + day, 'tomorrow'); // Hindi "kal" means both: the verb decides
    if (/this week|is hafte|इस हफ़्ते|इस हफ्ते|is week/.test(t)) { const wd = new Date(T + 5.5 * 3600e3).getUTCDay(); return { from: ymdOf(T - ((wd + 6) % 7) * day), to: ymdOf(T + ((7 - wd) % 7) * day), label: 'this week', past: false, range: true }; }
    if (/next week|agle hafte|अगले हफ़्ते|अगले हफ्ते/.test(t)) { const wd = new Date(T + 5.5 * 3600e3).getUTCDay(), mon = T + ((8 - wd) % 7 || 7) * day; return { from: ymdOf(mon), to: ymdOf(mon + 6 * day), label: 'next week', past: false, range: true }; }
    if (/last week|pichle hafte|पिछले हफ़्ते|पिछले हफ्ते/.test(t)) { const wd = new Date(T + 5.5 * 3600e3).getUTCDay(), mon = T - (((wd + 6) % 7) + 7) * day; return { from: ymdOf(mon), to: ymdOf(mon + 6 * day), label: 'last week', past: true, range: true }; }
    // weekday name
    for (const w in WD) if (new RegExp(`(^|[^a-z\\u0900-\\u097F])${w}([^a-z\\u0900-\\u097F]|$)`).test(t)) {
      const wd = new Date(T + 5.5 * 3600e3).getUTCDay(); let diff = (WD[w] - wd + 7) % 7; if (past && diff > 0) diff -= 7; return one(T + diff * day, w);
    }
    // explicit date: 12/11, 12-11-2026, "12 nov", "12th november", "12 तारीख", "12 नवंबर"
    let m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
    let dd = null, mm = null, yy = null;
    if (m) { dd = +m[1]; mm = +m[2] - 1; yy = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null; }
    else {
      m = t.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:tarikh|tareekh|तारीख|तारीख़|date)?\s*(?:ko|को|of|,)?\s*([a-zऀ-ॿ]+)?/);
      if (m && +m[1] >= 1 && +m[1] <= 31 && (m[2] ? true : /tarikh|tareekh|तारीख|\b\d{1,2}(st|nd|rd|th)\b|date|\bko\b|को/.test(t))) { dd = +m[1]; if (m[2] && MON[m[2]] != null) mm = MON[m[2]]; }
      if (dd && mm == null) { for (const k in MON) if (new RegExp(`(^|[^a-z\\u0900-\\u097F])${k}([^a-z\\u0900-\\u097F]|$)`).test(t)) { mm = MON[k]; break; } }
    }
    if (dd && dd <= 31) {
      const n = new Date(T + 5.5 * 3600e3); let y = yy || n.getUTCFullYear(), mo = mm != null ? mm : n.getUTCMonth();
      let ms = Date.parse(`${y}-${String(mo + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}T00:00:00+05:30`);
      if (mm == null && ms < T - 20 * day && !past) { mo = (mo + 1) % 12; if (mo === 0) y++; ms = Date.parse(`${y}-${String(mo + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}T00:00:00+05:30`); }
      if (isFinite(ms)) return one(ms, dLabel(ymdOf(ms)));
    }
    if (fut || /kab|कब|when/.test(t)) return null; // "Reliance ka result kab hai": a company question, no date
    return { from: ymdOf(T), to: ymdOf(T + 7 * day), label: 'the next 7 days', past: false, range: true };
  }
  async function load() {
    if (cal && Date.now() - at < 30 * 60e3) return cal;
    if (Source.mode !== 'live') { cal = demo(); at = Date.now(); return cal; }
    try { cal = await Source.raw('/api/rescal'); at = Date.now(); } catch (e) { cal = { items: [], error: /404|Not found/i.test(e.message) ? 'Deploy the new Worker code.' : e.message }; }
    return cal;
  }
  function company(raw, items) {
    const t = raw.toLowerCase();
    const W = (s) => String(s || '').toLowerCase().replace(/\b(ltd|limited|the|india|industries|company)\b/g, '').replace(/[^a-z0-9& ]/g, ' ').trim();
    let hit = items.find((x) => x.sym && x.sym.length >= 3 && new RegExp(`\\b${x.sym.toLowerCase().replace(/[&]/g, '\\&')}\\b`).test(t));
    if (!hit) hit = items.find((x) => { const w = W(x.co).split(/\s+/).filter((z) => z.length >= 4); return w.length && t.includes(w.slice(0, 2).join(' ')); });
    if (!hit && typeof Voice !== 'undefined') { /* Hindi names (रिलायंस, इंफोसिस…) via the dashboard's own name list */ try { const id = (Voice.nameIn ? Voice.nameIn(t) : null); if (id) hit = items.find((x) => x.sym === id); } catch (e) { /* no name list */ } }
    return hit || null;
  }
  const earnOf = (sym) => { try { return (Impact.earnings && Impact.earnings.items || []).find((x) => x.sym === sym) || null; } catch (e) { return null; } };
  const mine = () => new Set((typeof KEYS !== 'undefined' ? KEYS : []).filter((k) => CFG[k] && !CFG[k].core).map((k) => String(CFG[k].sym || k).toUpperCase()));

  async function answer(raw, show, say) {
    show('<div class="alert i">Checking the results calendar…</div>', '');
    const C = await load(), items = (C && C.items) || [];
    try { if (typeof Impact !== 'undefined' && Impact.loadEarnings) await Promise.race([Impact.loadEarnings(), new Promise((r) => setTimeout(r, 4000))]); } catch (e) { /* optional */ }
    if (!items.length) return show(`<h3>Results calendar</h3><div class="alert">${esc(C && C.error ? C.error : 'No results dates available right now.')} NSE sometimes blocks cloud servers; the Worker then tries results-date headlines, which also came back empty.</div>`, 'अभी नतीजों का कैलेंडर नहीं मिल पाया।');
    const srcNote = `<div class="legend">Source: ${esc(C.src || 'NSE event calendar')}${C.stale ? ' (last saved copy)' : ''}. ${/news/.test(C.src || '') ? 'These dates come from news headlines, not the exchange: check NSE before acting. ' : ''}Companies can move a board meeting; the exchange filing is final.</div>`;
    // one company: when is its result?
    const co = company(raw, items);
    if (co && !/\d{1,2}|aaj|आज|kal|कल|tomorrow|yesterday|week|hafte|हफ़्ते|हफ्ते/i.test(raw.replace(/q[1-4]/ig, ''))) {
      const all = items.filter((x) => x.sym === co.sym).sort((a, b) => (a.date < b.date ? -1 : 1)), td = istYmd(), next = all.find((x) => x.date >= td), prev = all.filter((x) => x.date < td).pop(), E = earnOf(co.sym);
      const h = `<h3>${esc(co.co || co.sym)} (${esc(co.sym)}): results</h3>${next ? `<div class="row"><span>Next results date</span><b>${dLabel(next.date)}</b></div>` : ''}${prev ? `<div class="row"><span>Last results date</span><b>${dLabel(prev.date)}</b></div>` : ''}
        ${E ? `<div class="row"><span>Reported (${esc(E.q || 'latest')})</span><b class="${E.pat > 0 || E.s > 0.3 ? 'up' : E.pat < 0 || E.s < -0.3 ? 'down' : ''}">${ok(E.pat) ? `profit ${E.pat >= 0 ? '+' : ''}${Math.round(E.pat)}% YoY` : E.s >= 0.3 ? 'strong' : E.s <= -0.3 ? 'weak' : 'mixed'}${ok(E.rev) ? `, revenue ${E.rev >= 0 ? '+' : ''}${Math.round(E.rev)}%` : ''}</b></div><div class="mut" style="font-size:12px">${esc(E.t)}</div>` : ''}${srcNote}`;
      return show(h, `${co.co || co.sym} ${next ? `के नतीजे ${dHi(next.date)} को आने हैं।` : prev ? `के नतीजे ${dHi(prev.date)} को आ चुके हैं।` : 'की तारीख़ कैलेंडर में नहीं मिली।'}${E && ok(E.pat) ? ` पिछले नतीजों में मुनाफ़ा ${Math.abs(Math.round(E.pat))} प्रतिशत ${E.pat >= 0 ? 'बढ़ा' : 'घटा'}।` : ''}`);
    }
    let W = when(raw), miss = '';
    if (!W) { // "X ka result kab hai" with X not in the calendar, or "results kab aayenge": show the coming week
      const T = todayMs(); W = { from: ymdOf(T), to: ymdOf(T + 7 * 864e5), label: 'the next 7 days', past: false, range: true };
      if (!/^\W*(q[1-4]\s*)?(results?|रिजल्ट|नतीजे)/i.test(raw.trim())) miss = '<div class="alert">That company isn\'t in the results calendar for the next 30 days (or its name didn\'t match). Here is the coming week instead.</div>';
    }
    const list = items.filter((x) => x.date >= W.from && x.date <= W.to), M = mine();
    const fo = list.filter((x) => x.fo), rest = list.filter((x) => !x.fo);
    const span = W.from === W.to ? dLabel(W.from) : `${dLabel(W.from)} to ${dLabel(W.to)}`;
    const row = (x) => { const E = earnOf(x.sym); return `<tr><td class="l"><b>${esc(x.sym)}</b>${M.has(x.sym) ? ' <span class="im-me">★</span>' : ''}<br><small class="mut">${esc(x.co || '')}</small></td>${W.range ? `<td>${dLabel(x.date)}</td>` : ''}<td class="l">${E ? `<span class="${E.pat > 0 || E.s > 0.3 ? 'up' : E.pat < 0 || E.s < -0.3 ? 'down' : ''}">${ok(E.pat) ? `profit ${E.pat >= 0 ? '+' : ''}${Math.round(E.pat)}%` : E.s >= 0.3 ? 'strong' : E.s <= -0.3 ? 'weak' : 'mixed'}</span>` : `<span class="mut">${x.date < istYmd() ? 'numbers not in the news yet' : 'due'}</span>`}</td>${x.fo && Source.mode === 'live' ? `<td><button class="btn-ghost" onclick="ResultsAsk.analyze('${esc(x.sym)}')">Analyze</button></td>` : '<td></td>'}</tr>`; };
    const table = (L) => `<div class="tbl"><table><thead><tr><th class="l">Company</th>${W.range ? '<th>Date</th>' : ''}<th class="l">${W.past ? 'How it went' : 'Status'}</th><th></th></tr></thead><tbody>${L.map(row).join('')}</tbody></table></div>`;
    let h = `<h3>Results ${W.past ? 'declared' : 'due'}: ${span}</h3>${miss}`;
    if (!list.length) h += `<div class="mut">No results ${W.past ? 'were declared' : 'are scheduled'} ${W.from === W.to ? 'on this day' : 'in this period'} in the calendar.${new Date(W.from + 'T00:00:00Z').getUTCDay() % 6 === 0 && W.from === W.to ? ' It\'s a weekend.' : ''}</div>`;
    else {
      h += `<div class="row"><span>F&O companies</span><b>${fo.length}</b></div><div class="row"><span>Other listed companies</span><b>${rest.length}</b></div>`;
      if (fo.length) h += `<div class="sec">F&O stocks (options available)</div>${table(fo.slice(0, 60))}`;
      if (rest.length) h += `<details class="rc-d"><summary>Other companies (${rest.length})</summary><div>${table(rest.slice(0, 150))}${rest.length > 150 ? `<div class="mut">…and ${rest.length - 150} more</div>` : ''}</div></details>`;
    }
    h += srcNote + '<div id="aiAns"></div>';
    const names = fo.slice(0, 6).map((x) => x.co ? x.co.replace(/\s+(Ltd|Limited)\.?$/i, '') : x.sym).join(', ');
    const hi = !list.length ? `${W.from === W.to ? dHi(W.from) : W.label} के लिए कैलेंडर में कोई नतीजा नहीं मिला।`
      : `${W.from === W.to ? dHi(W.from) + ' को' : W.label === 'this week' ? 'इस हफ़्ते' : W.label === 'next week' ? 'अगले हफ़्ते' : W.label === 'last week' ? 'पिछले हफ़्ते' : 'अगले सात दिनों में'} ${list.length} कंपनियों के नतीजे ${W.past ? 'आए' : 'आने हैं'}, जिनमें ${fo.length} F&O वाली हैं${names ? `, जैसे ${names}` : ''}।`;
    show(h, hi);
    // optional AI summary from ONLY this list (it can't add names or dates)
    if (Source.mode === 'live' && Source.status && Source.status.ai && list.length && $('aiAns')) {
      try {
        const ctx = { question: raw, period: { from: W.from, to: W.to, past: W.past }, source: C.src, foCompanies: fo.slice(0, 60).map((x) => { const E = earnOf(x.sym); return { sym: x.sym, company: x.co, date: x.date, profitYoYPct: E ? E.pat : null, revenueYoYPct: E ? E.rev : null, headline: E ? E.t : null }; }), otherCompaniesCount: rest.length,
          rules: 'Use ONLY these companies and dates. Do not add any company or date that is not listed. Mention which are big index names (Nifty/Sensex/Bank Nifty weights) if you know it.' };
        $('aiAns').innerHTML = '<div class="alert i">AI is reading the list…</div>';
        const r = await Source.ask(`${raw}\n(Answer only from the results list in the data. Short: which F&O names matter most for the market and why.)`, ctx, []);
        $('aiAns').innerHTML = `<div class="alert i"><b>AI summary</b><br>${esc(r.answer).replace(/\n/g, '<br>')}</div>`;
      } catch (e) { $('aiAns').innerHTML = ''; }
    }
  }
  function analyze(sym) {
    const x = (cal && cal.items || []).find((i) => i.sym === sym); if (!x) return;
    (async () => { try { const r = await Source.search(sym); const it = r.items.find((y) => y.id === sym) || r.items[0]; if (it) { if (typeof closeAsk === 'function') closeAsk(); addWatch(it); } } catch (e) { toast(e.message); } })();
  }
  function demo() {
    const T = todayMs(), d = (n) => ymdOf(T + n * 864e5);
    const L = [['TATAMOTORS', 'Tata Motors', 0, true], ['HEROMOTOCO', 'Hero MotoCorp', 0, true], ['NYKAA', 'FSN E-Commerce (Nykaa)', 0, true], ['IRCON', 'Ircon International', 0, false], ['GRASIM', 'Grasim Industries', 1, true], ['BAJAJ-AUTO', 'Bajaj Auto', 1, true], ['DIVISLAB', 'Divi\'s Laboratories', 1, true], ['MUTHOOTFIN', 'Muthoot Finance', 1, true], ['SJVN', 'SJVN', 1, false],
      ['HINDALCO', 'Hindalco Industries', 2, true], ['BOSCHLTD', 'Bosch', 2, true], ['ZYDUSLIFE', 'Zydus Lifesciences', 3, true], ['DIXON', 'Dixon Technologies', -1, true], ['LUPIN', 'Lupin', -1, true], ['TRENT', 'Trent', -2, true], ['BEL', 'Bharat Electronics', -3, true], ['PERSISTENT', 'Persistent Systems', -6, true]];
    return { ts: Date.now(), src: 'demo calendar', items: L.map(([sym, co, n, fo]) => ({ sym, co, date: d(n), fo, src: 'demo' })) };
  }
  return { match, when, answer, analyze, load, get data() { return cal; } };
})();
