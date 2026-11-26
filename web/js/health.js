/* ===== Data Health: is every feed fresh, from the right day, and confirmed by a second source where one exists? =====
   Runs every minute in the browser (no extra data calls except one read of the NSE file already saved). Each check is
   ✅ OK, 🟡 watch, ⛔ problem, or "closed / not needed now". A small badge in the top bar shows the worst one; when live
   prices stop during market hours a red strip warns that signals are being built on old prices. */
const Health = (() => {
  const live = () => typeof Source !== 'undefined' && Source.mode === 'live';
  let last = { checks: [], worst: 'ok', ts: 0 }, recon = null, reconAt = 0;
  const ist = () => new Date(Date.now() + 5.5 * 3600e3);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  const normD = (s) => { s = String(s || ''); let m = s.match(/(\d{4})-(\d\d)-(\d\d)/); if (m) return m[0]; m = s.match(/(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]*(\d{4})/); return m ? `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}` : ''; };
  const hol = () => new Set((live() && Source.calendar && Source.calendar().holidays) || []);
  const isSession = (d, H) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w > 0 && w < 6 && !H.has(d); };
  const prevSession = (d, H) => { let x = new Date(d + 'T00:00:00Z'); do x = new Date(x.getTime() - 864e5); while (!isSession(ymd(x), H)); return ymd(x); };
  // the latest session whose end-of-day data should be out by now (published around `hh` IST)
  const expected = (hh, H) => { const n = ist(), d = ymd(n), hm = n.getUTCHours() + n.getUTCMinutes() / 60; return isSession(d, H) && hm >= hh ? d : prevSession(d, H); };
  const age = (t) => (t ? Date.now() - t : null), mins = (ms) => (ms == null ? '–' : ms < 90e3 ? `${Math.round(ms / 1000)} s` : ms < 5400e3 ? `${Math.round(ms / 60e3)} min` : `${(ms / 3600e3).toFixed(1)} h`);
  function idbGet(k) { return new Promise((res) => { try { const o = indexedDB.open('fno_bt', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onsuccess = () => { try { const q = o.result.transaction('kv', 'readonly').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }; o.onerror = () => res(null); } catch (e) { res(null); } }); }

  // Upstox's previous close vs NSE's official closing price (the NSE file the Brief already saved)
  async function reconcile() {
    if (Date.now() - reconAt < 10 * 60e3) return recon; reconAt = Date.now();
    try {
      const E = typeof EodCache !== 'undefined' ? EodCache.peek() : null; if (!E || !E.q) return (recon = null);
      const idx = (await idbGet('brief_sec_idx')) || []; if (!idx.length) return (recon = null);
      const d8 = idx[idx.length - 1], S = await idbGet('brief_sec_' + d8); if (!S) return (recon = null);
      const sd = `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}`, nq = E.q.NIFTY, qd = nq && nq.ts ? ymd(new Date((+nq.ts || Date.parse(nq.ts)) + 5.5 * 3600e3)) : '';
      const useClose = qd === sd; // evening: today's Upstox close vs today's NSE file; otherwise Upstox's previous close vs the last NSE file
      let n = 0, bad = [];
      for (const s in E.q) { const q = E.q[s], r = S.s[s]; if (q.idx || !r || !ok(r[0])) continue; const v = useClose ? q.c : q.pc; if (!ok(v) || !v) continue; n++; if (Math.abs(v / r[0] - 1) > 0.002) bad.push(`${s} ${f2(v)} vs NSE ${f2(r[0])}`); }
      if (!useClose && qd && prevSession(qd, hol()) !== sd) return (recon = { skip: `NSE file is from ${sd}, prices from ${qd}: not comparable yet` });
      return (recon = { n, bad, sd });
    } catch (e) { return (recon = null); }
  }

  async function run() {
    if (!live()) { last = { checks: [{ id: 'demo', name: 'Demo mode', st: 'na', d: 'Sample data: nothing to check.' }], worst: 'ok', ts: Date.now() }; paint(); return last; }
    const H = hol(), n = ist(), today = ymd(n), hm = n.getUTCHours() * 60 + n.getUTCMinutes(), session = isSession(today, H), open = session && hm >= 555 && hm <= 930;
    const F = Source.fresh ? Source.fresh() : {}, C = [], add = (id, name, st, d, help) => C.push({ id, name, st, d, help });
    // 1. live prices
    if (!open) add('px', 'Live prices', 'na', session ? (hm < 555 ? 'Market opens at 9:15.' : 'Market closed for the day.') : 'No session today (weekend or NSE holiday).');
    else { const tk = age(F.tick), sn = age(F['/api/snapshot']);
      if (F.streaming && tk != null && tk < 15e3) add('px', 'Live prices', 'ok', `Streaming, last tick ${mins(tk)} ago.`);
      else if (sn != null && sn < 45e3) add('px', 'Live prices', 'ok', `Updating every few seconds (last ${mins(sn)} ago).`);
      else if (sn != null && sn < 150e3) add('px', 'Live prices', 'warn', `Last update ${mins(sn)} ago.`, 'Slow updates: internet or Upstox busy.');
      else add('px', 'Live prices', 'bad', `No price update for ${mins(sn)}.`, 'Signals are being built on old prices. Check internet, Upstox login (Connect), or the Data & Usage tab for a rate limit.'); }
    // 2. candles: is the latest 1-minute candle current?
    if (open && typeof A !== 'undefined' && A.NIFTY && A.NIFTY.D) { const c = (A.NIFTY.D.candles || []).filter((x) => x.d === 2), lm = c.length ? c[c.length - 1].m : null, cur = hm - 555, lag = lm == null ? null : cur - lm;
      add('cdl', 'Candles (Nifty, 1-minute)', lag == null ? 'bad' : lag <= 2 ? 'ok' : lag <= 5 ? 'warn' : 'bad', lag == null ? 'No candles for today yet.' : `Latest candle ${hhm(lm)} (${lag} min behind).`, lag > 2 ? 'Candles lag: the chart and indicators are behind the price.' : ''); }
    else add('cdl', 'Candles', 'na', 'Checked during market hours.');
    // 3. option chain and futures
    const ch = age(F['/api/chain']), fu = age(F['/api/fut']);
    add('chain', 'Option chain', !open ? 'na' : ch == null ? 'warn' : ch < 200e3 ? 'ok' : ch < 400e3 ? 'warn' : 'bad', ch == null ? 'Not loaded yet.' : `Updated ${mins(ch)} ago.`);
    add('fut', 'Futures OI', !open ? 'na' : fu == null ? 'warn' : fu < 300e3 ? 'ok' : 'warn', fu == null ? 'Not loaded yet.' : `Updated ${mins(fu)} ago.`);
    // 4. world markets: freshness and how many were confirmed by two sources
    const W = Source.world ? Source.world() : null, wi = (W && W.items) || [];
    if (!wi.length) add('world', 'World markets', 'warn', 'Not loaded.', 'GIFT Nifty, US futures, crude and the dollar are missing from the world cues.');
    else { const v = wi.filter((x) => x.verified === 'verified' || x.verified === 'resolved').length, one = wi.filter((x) => x.verified === 'single' || !x.verified).length, hid = wi.filter((x) => x.verified === 'hidden');
      const wAge = age(W.ts);
      add('world', 'World markets', hid.length || wAge > 15 * 60e3 ? 'warn' : 'ok', `${v} of ${wi.length} confirmed by two sources, ${one} from one source${hid.length ? `, ${hid.length} hidden (sources disagree: ${hid.map((x) => x.name).join(', ')})` : ''}. Fetched ${mins(wAge)} ago.`, hid.length ? 'Hidden numbers are not used anywhere until the sources agree again.' : ''); }
    const g = wi.find((x) => x.id === 'gift');
    add('gift', 'GIFT Nifty', !g ? 'warn' : g.verified === 'verified' ? 'ok' : 'warn', !g ? 'Not available (NSE IX and Upstox both failed).' : `${f0(g.price)} · ${g.verified === 'verified' ? 'NSE IX and Upstox agree' : 'one source: ' + (g.src || '')}.`);
    // 5. FII/DII and FII futures: from the right day?
    const fa = Source.fiiAuto ? Source.fiiAuto() : null, fe = expected(19.5, H), fd = fa ? normD(fa.date) : '';
    add('fii', 'FII / DII cash', !fa || fa.none ? 'bad' : fd === fe ? 'ok' : fd && fd === prevSession(fe, H) ? 'warn' : 'bad', !fa || fa.none ? 'Not available (NSE did not answer).' : `Data for ${fd || fa.date}${fd === fe ? ' (latest)' : `; expected ${fe}`}${fa.stale ? ', last saved copy' : ''}.`, fd !== fe ? 'NSE publishes around 6–7:30 pm. Until then the previous day is shown, labelled.' : '');
    const P = Source.participant ? Source.participant() : null, pd = P && P.latest ? normD(P.latest.date) : '', pe = expected(20, H);
    add('part', 'FII index futures (NSE file)', !pd ? 'warn' : pd === pe ? 'ok' : 'warn', pd ? `File of ${pd}${pd === pe ? ' (latest)' : `; expected ${pe}`}.` : 'Not loaded.');
    // 6. calendar and holidays
    const cal = Source.calendar ? Source.calendar() : null, cs = (cal && cal.sources) || {};
    add('cal', 'Event calendar', !cal || !cal.ts ? 'warn' : cs.ForexFactory ? 'ok' : 'warn', cal && cal.ts ? `RBI, Fed, GDP dates${cs.ForexFactory ? ', ForexFactory' : ' (ForexFactory did not load)'}${cs['NSE holidays'] ? `, ${cs['NSE holidays']} NSE holidays` : ', NSE holiday list missing'}; plus events named in today's headlines.` : 'Not loaded.');
    // 7. news
    const N = (typeof A !== 'undefined' && A.NIFTY && A.NIFTY.news) || [], newest = N.reduce((m, x) => Math.max(m, x.ts || 0), 0), dis = N.filter((x) => x.disputed).length;
    add('news', 'News', !N.length ? 'warn' : age(newest) < (open ? 3 : 14) * 3600e3 ? 'ok' : 'warn', N.length ? `${N.length} headlines, newest ${mins(age(newest))} old${dis ? `; ${dis} where the AI's reading and the wording disagree (set to neutral)` : ''}.` : 'No headlines loaded.');
    // 8. NSE end-of-day files (Brief) and Upstox vs NSE closing prices
    const idx = (await idbGet('brief_sec_idx')) || [], ld = idx.length ? idx[idx.length - 1] : '', ldd = ld ? `${ld.slice(0, 4)}-${ld.slice(4, 6)}-${ld.slice(6, 8)}` : '', ee = expected(19, H);
    add('nse', 'NSE end-of-day files', !ld ? 'na' : ldd === ee ? 'ok' : 'warn', ld ? `Latest saved: ${ldd}${ldd === ee ? '' : `; ${ee} expected (open the Brief to fetch it)`}.` : 'Open the Brief or Overview once to load them.');
    const R = await reconcile();
    if (R && R.n) add('recon', 'Upstox prices vs NSE official close', R.bad.length <= Math.max(1, R.n * 0.02) ? 'ok' : 'bad', `${R.n - R.bad.length} of ${R.n} F&O stocks match NSE's close for ${R.sd} (within 0.2%)${R.bad.length ? `; differ: ${R.bad.slice(0, 5).join(', ')}` : ''}.`, R.bad.length ? 'A few can differ after corporate actions (split, bonus). Many differences mean a data problem.' : '');
    else add('recon', 'Upstox prices vs NSE official close', 'na', R && R.skip ? R.skip + '.' : 'Runs once the Brief or Overview has loaded an NSE file.');
    // 9. Upstox budget
    const rw = Source.rateWait ? Source.rateWait() : 0;
    add('rate', 'Upstox limit', rw ? 'warn' : 'ok', rw ? `Paused for ${rw} s by Upstox (prices and candles keep retrying).` : 'Within limits.');
    const rank = { bad: 3, warn: 2, ok: 1, na: 0 }, worst = C.reduce((w, c) => (rank[c.st] > rank[w] ? c.st : w), 'ok');
    last = { checks: C, worst, ts: Date.now(), open, pxBad: C.find((c) => c.id === 'px' && c.st === 'bad') };
    paint(); return last;
  }
  const hhm = (m) => { const t = m + 555; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const ICON = { ok: '✅', warn: '🟡', bad: '⛔', na: '·' };
  function paint() {
    let b = document.getElementById('healthBadge');
    const bar = document.getElementById('statusBar');
    if (!b && bar) { b = document.createElement('button'); b.id = 'healthBadge'; b.className = 'hb'; b.onclick = () => { if (typeof Intel !== 'undefined') Intel.open('use'); }; bar.parentNode.insertBefore(b, bar); }
    if (b) { const bad = last.checks.filter((c) => c.st === 'bad').length, warn = last.checks.filter((c) => c.st === 'warn').length;
      b.className = 'hb ' + last.worst; b.innerHTML = last.worst === 'bad' ? `⛔ Data: ${bad} problem${bad > 1 ? 's' : ''}` : last.worst === 'warn' ? `🟡 Data: ${warn} to watch` : '✅ Data OK'; b.title = 'Data Health: tap for details'; }
    let s = document.getElementById('staleStrip');
    if (last.pxBad) { if (!s) { s = document.createElement('div'); s.id = 'staleStrip'; s.className = 'stale-strip'; const top = document.querySelector('header.topbar'); if (top) top.insertAdjacentElement('afterend', s); } if (s) s.innerHTML = `⚠ ${esc(last.pxBad.d)} Signals and the chart are on old prices until updates resume. <button onclick="Intel.open('use')">Why?</button>`; }
    else if (s) s.remove();
  }
  function html() {
    return `<section class="mk-panel hl"><div class="ph"><h2>Data Health</h2><span class="mut">checked ${last.ts ? new Date(last.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '–'}</span><button class="btn ghost" onclick="Health.run().then(()=>Intel.show('use'))">Check now</button></div>
      <div class="tblw"><table><tbody>${last.checks.map((c) => `<tr class="${c.st}"><td>${ICON[c.st]}</td><td class="l"><b>${esc(c.name)}</b></td><td class="l">${esc(c.d)}${c.help ? `<br><small class="mut">${esc(c.help)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="legend">✅ fresh and (where possible) confirmed by a second source · 🟡 older than it should be, or only one source · ⛔ wrong day, stopped, or sources disagree. World markets come from Yahoo, CNBC and Upstox and are matched; a number whose sources disagree is hidden, never guessed. Prices, candles, option chain and OI come from the exchange through Upstox; once a day they are compared with NSE's official closing file.</div></section>`;
  }
  setTimeout(() => { run(); setInterval(run, 60e3); }, 12000);
  return { run, html, get last() { return last; }, expected, prevSession, isSession, hol };
})();
