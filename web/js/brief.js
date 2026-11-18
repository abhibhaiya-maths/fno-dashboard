/* ===== Next-Day Brief: which F&O stocks look strong and weak for tomorrow, and WHY =====
   Two versions a day:
   • Provisional, from 3:00 pm: live prices plus live futures OI (compared with yesterday's NSE file), yesterday's delivery.
   • Final, in the evening (after NSE publishes its files, about 6–7 pm) or late at night: today's NSE F&O bhavcopy (OI),
     today's delivery %, plus FII/DII, world cues and news as they stand when you open it.
   Every stock gets points from simple, visible rules (price vs Nifty, where it closed in the day's range, OI buildup,
   delivery, volume, 1/2/5-day trend, its sector, news, world cues). The top 5 and bottom 5 are shown with the reasons,
   so you can check each one yourself. Results due tomorrow are listed apart (the gap can go either way).
   Honest limits: NSE does not publish what FIIs bought or sold in a single stock or a sector each day. OI buildup and
   delivery are the closest public signs of big money. The list is research, not a guarantee: every day's picks are saved
   and checked against the next day's close (Track Record tab). Nothing here places, changes or grades a trade. */
const Brief = (() => {
  const live = () => typeof Source !== 'undefined' && Source.mode === 'live';
  const $b = (id) => document.getElementById(id);
  let tab = 'lists', B = null, busy = '', err = '', sortK = 'sc', notified = {};

  /* ---------- small helpers ---------- */
  const ist = () => new Date(Date.now() + 5.5 * 3600e3);
  const ymd8 = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const d8to10 = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const nice = (s) => { if (!s) return ''; const d = new Date(s.length === 8 ? d8to10(s) : s); return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };
  const pc = (x, d = 1) => (ok(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : '–');
  const cl = (x) => (ok(x) && x !== 0 ? (x > 0 ? 'up' : 'dn') : '');
  const cap = (x, m) => Math.max(-m, Math.min(m, x));
  const mean = (a) => { const b = a.filter(ok); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : null; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function nextWeekday(s10) { const d = new Date(s10 + 'T00:00:00Z'); do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10); }
  const crore = (x) => (ok(x) ? `₹${Math.abs(Math.round(x)).toLocaleString('en-IN')} cr` : '–');

  /* ---------- reading NSE files (pure; also run in Node tests) ---------- */
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('NSE file is not a zip');
    const cd = dv.getUint32(e + 16, true); if (dv.getUint32(cd, true) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = dv.getUint16(cd + 10, true), csize = dv.getUint32(cd + 20, true), lho = dv.getUint32(cd + 42, true);
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), data = u8.subarray(start, start + csize);
    if (method === 0) return new TextDecoder().decode(data);
    if (method !== 8) throw new Error('Zip method ' + method + ' not supported');
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip files (update it)');
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }
  function split(l) { if (l.indexOf('"') < 0) return l.split(','); const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; }
  function table(text) { const L = String(text || '').split(/\r?\n/).filter((x) => x.trim()); const head = L.length ? split(L[0]).map((h) => h.trim().toLowerCase()) : []; return { head, rows: L.slice(1).map(split), col: (n) => head.indexOf(n.toLowerCase()) }; }
  const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  function normDate(s) { s = String(s || '').trim(); let m = s.match(/^(\d{4})-(\d\d)-(\d\d)/); if (m) return m[0]; m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/); if (m) return `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`; m = s.match(/^(\d\d)\/(\d\d)\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`; return ''; }
  // F&O bhavcopy (UDiFF format): futures OI by stock (all expiries summed), nearest future, option walls (next expiry)
  function parseFO(text) {
    const T = table(text), c = T.col;
    const iS = c('TckrSymb'), iT = c('FinInstrmTp'), iId = c('FinInstrmId'), iX = c('XpryDt'), iK = c('StrkPric'), iO = c('OptnTp'), iC = c('ClsPric'), iP = c('PrvsClsgPric'), iOI = c('OpnIntrst'), iD = c('ChngInOpnIntrst'), iDt = c('TradDt'), iU = c('UndrlygPric');
    if (iS < 0 || iT < 0 || iOI < 0 || iX < 0) throw new Error('NSE changed the F&O file format');
    let date = ''; for (const r of T.rows) { date = normDate(iDt >= 0 ? r[iDt] : ''); if (date) break; }
    const fut = {}, opt = {};
    for (const r of T.rows) {
      const tp = (r[iT] || '').trim(), s = (r[iS] || '').trim(), x = normDate(r[iX]); if (!s || !x) continue;
      const oi = +r[iOI] || 0, d = +r[iD] || 0;
      if (tp === 'STF' || tp === 'IDF') {
        const f = fut[s] || (fut[s] = { oi: 0, doi: 0, toks: [], near: null, idx: tp === 'IDF' });
        f.oi += oi; f.doi += d; f.toks.push([+r[iId] || 0, x, oi]);
        if (!f.near || x < f.near.x) f.near = { x, c: +r[iC] || null, pc: +r[iP] || null, u: iU >= 0 ? +r[iU] || null : null, tok: +r[iId] || 0 };
      } else if ((tp === 'STO' || tp === 'IDO') && x > date) {
        const o = opt[s] || (opt[s] = { x, ce: {}, pe: {} });
        if (x < o.x) { o.x = x; o.ce = {}; o.pe = {}; } if (x !== o.x) continue;
        const K = +r[iK], side = (r[iO] || '').trim() === 'CE' ? 'ce' : 'pe'; if (ok(K)) o[side][K] = (o[side][K] || 0) + oi;
      }
    }
    const walls = {};
    for (const s in opt) { const o = opt[s], top = (m) => { let k = null, v = 0; for (const K in m) if (m[K] > v) { v = m[K]; k = +K; } return k; }, sum = (m) => Object.values(m).reduce((a, b) => a + b, 0), ce = sum(o.ce), pe = sum(o.pe); walls[s] = { x: o.x, ce: top(o.ce), pe: top(o.pe), pcr: ce ? pe / ce : null }; }
    return { date, fut, walls };
  }
  // full equity bhavcopy with delivery: [close, prevClose, open, high, low, volume, delivery %]
  function parseSec(text, keep) {
    const T = table(text), c = T.col, i = { s: c('SYMBOL'), sr: c('SERIES'), d: c('DATE1'), pc: c('PREV_CLOSE'), o: c('OPEN_PRICE'), h: c('HIGH_PRICE'), l: c('LOW_PRICE'), c: c('CLOSE_PRICE'), q: c('TTL_TRD_QNTY'), dp: c('DELIV_PER') };
    if (i.s < 0 || i.c < 0) throw new Error('NSE changed the delivery file format');
    let date = ''; const s = {};
    for (const r of T.rows) {
      const sym = (r[i.s] || '').trim(), sr = (r[i.sr] || '').trim(); if (!sym || (sr && sr !== 'EQ')) continue; if (keep && !keep.has(sym)) continue;
      if (!date) date = normDate(r[i.d]);
      const n = (k) => { const v = parseFloat((r[i[k]] || '').trim()); return ok(v) ? v : null; };
      s[sym] = [n('c'), n('pc'), n('o'), n('h'), n('l'), n('q'), n('dp')];
    }
    return { date, s };
  }
  function parseN500(text) { const T = table(text), iS = T.col('Symbol'), iI = T.col('Industry'), m = {}; if (iS < 0 || iI < 0) return m; T.rows.forEach((r) => { const s = (r[iS] || '').trim(); if (s) m[s] = (r[iI] || '').trim(); }); return m; }

  /* ---------- rules: sector links for world cues and news ---------- */
  const SET = (s) => new Set(s.split(' '));
  const OMC = SET('BPCL HINDPETRO IOC'), CRUDE_USE = SET('ASIANPAINT BERGEPAINT PIDILITIND INDIGO APOLLOTYRE MRF BALKRISIND CEATLTD SRF UPL'), UPSTREAM = SET('ONGC OIL'), GOLDFIN = SET('MUTHOOTFIN MANAPPURAM');
  const isIT = (s, ind) => /information technology/i.test(ind || '');
  const CUES = [
    { id: 'nasF', name: 'Nasdaq futures', min: 0.6, w: 0.5, sign: 1, test: isIT, why: 'Indian IT earns mostly from the US; a strong Nasdaq usually helps, a weak one hurts' },
    { id: 'usdinr', name: 'Dollar vs rupee', min: 0.25, w: 0.25, sign: 1, test: isIT, why: 'a weaker rupee raises IT export earnings' },
    { id: 'brent', name: 'Brent crude', min: 1, w: 0.5, sign: -1, test: (s) => OMC.has(s), why: 'crude is the raw material of oil marketing companies: cheaper crude helps, costlier hurts' },
    { id: 'brent', name: 'Brent crude', min: 1, w: 0.4, sign: -1, test: (s) => CRUDE_USE.has(s), why: 'crude is a big cost for paints, tyres, chemicals and airlines' },
    { id: 'brent', name: 'Brent crude', min: 1, w: 0.5, sign: 1, test: (s) => UPSTREAM.has(s), why: 'oil producers earn more when crude rises' },
    { id: 'gold', name: 'Gold', min: 1, w: 0.3, sign: 1, test: (s) => GOLDFIN.has(s), why: 'gold-loan companies gain when gold rises' },
  ];
  const NEWS_SEC = { 'Financial Services': ['Banks', 'PSU Banks', 'NBFC & Finance', 'Insurance'], 'Information Technology': ['IT'], Healthcare: ['Pharma & Healthcare'], 'Fast Moving Consumer Goods': ['FMCG'], 'Automobile and Auto Components': ['Auto', 'Tyres & Auto parts'], 'Metals & Mining': ['Metals & Mining'], 'Oil Gas & Consumable Fuels': ['Oil marketing (OMCs)', 'Upstream oil & gas', 'Gas utilities'], Power: ['Power'], 'Capital Goods': ['Capital goods & Infra', 'Defence'], Construction: ['Capital goods & Infra'], 'Construction Materials': ['Cement'], Realty: ['Realty'], Telecommunication: ['Telecom'], Chemicals: ['Paints & Chemicals', 'Fertilisers & Agri'], 'Consumer Durables': ['Consumer durables'], 'Consumer Services': ['Retail & Consumer', 'Hotels & Travel', 'Aviation'], 'Media Entertainment & Publication': ['Media'], Services: ['Logistics & Shipping'], Textiles: ['Textiles'] };
  const SHORT = { 'Financial Services': 'Financials', 'Information Technology': 'IT', Healthcare: 'Pharma & Health', 'Fast Moving Consumer Goods': 'FMCG', 'Automobile and Auto Components': 'Auto', 'Metals & Mining': 'Metals', 'Oil Gas & Consumable Fuels': 'Oil & Gas', 'Capital Goods': 'Capital Goods', 'Construction Materials': 'Cement', 'Telecommunication': 'Telecom', 'Consumer Durables': 'Consumer Durables', 'Consumer Services': 'Consumer Services', 'Media Entertainment & Publication': 'Media' };
  const secName = (ind) => SHORT[ind] || ind || 'Other';

  /* ---------- scoring (pure) ----------
     I: { date, mode, px{SYM:{c,pc,o,h,l,v}}, hist{SYM:[[c,pc,o,h,l,v,dp],… oldest first]}, dToday{SYM:dp|null}, dNote,
          oi{SYM:{oi,doi}}, oiNote, walls{}, sector{SYM:industry}, nifty{c,pc,h,l}, newsCo{SYM:{sc,t}}, newsSec{name:sc},
          world{id:{chg,price}}, fii, part, results{SYM:date}, next } */
  function score(I) {
    const nf = I.nifty && I.nifty.pc ? I.nifty.c / I.nifty.pc - 1 : null, S = [], bySec = {};
    for (const sym in I.px) {
      const p = I.px[sym], H = (I.hist && I.hist[sym]) || []; if (!p || !(p.c > 0) || !(p.pc > 0)) continue;
      const closes = [...H.map((r) => r[0]).filter(ok), p.c], n = closes.length;
      const r1 = p.c / p.pc - 1, r2 = n >= 3 ? p.c / closes[n - 3] - 1 : null, r5 = n >= 6 ? p.c / closes[n - 6] - 1 : null;
      let streak = 0; for (let i = n - 1; i > 0; i--) { const s = Math.sign(closes[i] - closes[i - 1]); if (!s || (streak && Math.sign(streak) !== s)) break; streak += s; }
      const v5 = mean(H.map((r) => r[5])), d5 = mean(H.map((r) => r[6])), volX = v5 && p.v ? p.v / v5 : null;
      const x = { sym, ind: (I.sector && I.sector[sym]) || '', price: p.c, r1, r2, r5, streak, volX, deliv: I.dToday ? I.dToday[sym] : null, d5, loc: p.h > p.l ? (p.c - p.l) / (p.h - p.l) : null, f: [], info: [] };
      const o = I.oi && I.oi[sym];
      if (o && o.oi > 0 && ok(o.doi)) { x.oiPct = o.doi / Math.max(1, o.oi - o.doi); x.oiNow = o.oi; }
      x.wall = I.walls && I.walls[sym];
      x.res = I.results && I.results[sym];
      S.push(x); (bySec[x.ind] || (bySec[x.ind] = [])).push(x);
    }
    // sectors: F&O stocks of each industry
    const SEC = Object.entries(bySec).filter(([k, L]) => k && L.length >= 2).map(([k, L]) => {
      const oiT = L.reduce((s, x) => s + (ok(x.oiPct) && Math.abs(x.oiPct) >= 0.03 ? (x.r1 >= 0 ? 1 : -1) * (x.oiPct > 0 ? 1 : 0.5) : 0), 0);
      const ns = (NEWS_SEC[k] || []).map((n) => I.newsSec && I.newsSec[n]).filter(ok);
      return { ind: k, name: secName(k), n: L.length, r1: mean(L.map((x) => x.r1)), r2: mean(L.map((x) => x.r2)), r5: mean(L.map((x) => x.r5)), up: L.filter((x) => x.r1 > 0).length, oiT, news: ns.length ? mean(ns) : null };
    }).sort((a, b) => b.r1 - a.r1);
    const secOf = {}; SEC.forEach((s) => { secOf[s.ind] = s; });
    const W = I.world || {};
    S.forEach((x) => {
      const add = (k, pts, t, kind) => { if (Math.abs(pts) >= 0.05) x.f.push({ k, pts, t, kind: kind || '' }); };
      // 1. today's move against the Nifty
      const rel = ok(nf) ? x.r1 - nf : x.r1;
      let m1 = cap(rel / 0.015, 1.5); if (ok(x.volX) && x.volX >= 1.8) m1 *= 1.3;
      add('move', m1, `${x.r1 >= 0 ? 'Up' : 'Down'} ${pc(Math.abs(x.r1)).slice(1)} today${ok(nf) ? `, ${Math.abs(rel) < 0.002 ? 'in line with' : rel > 0 ? pc(rel).slice(1) + ' better than' : pc(-rel).slice(1) + ' worse than'} Nifty` : ''}${ok(x.volX) && x.volX >= 1.8 ? ` on ${f1(x.volX)}× its usual volume` : ''}.`);
      // 2. where it closed in the day's range
      if (ok(x.loc) && x.loc >= 0.8) add('close', 0.75, 'Closed near the day\'s high: buyers held control till the end.');
      else if (ok(x.loc) && x.loc <= 0.2) add('close', -0.75, 'Closed near the day\'s low: sellers held control till the end.');
      // 3. futures OI buildup (where big traders add or cut positions)
      if (ok(x.oiPct) && Math.abs(x.oiPct) >= 0.03 && Math.abs(x.r1) >= 0.004) {
        const g = Math.min(1, Math.abs(x.oiPct) / 0.15), up = x.r1 > 0, add2 = x.oiPct > 0, oiT = `futures OI ${pc(x.oiPct)}`;
        if (up && add2) { x.build = 'Long buildup'; add('oi', 1 + 0.5 * g, `Long buildup: price up and ${oiT} = fresh BUY positions being added.`); }
        else if (!up && add2) { x.build = 'Short buildup'; add('oi', -(1 + 0.5 * g), `Short buildup: price down and ${oiT} = fresh SELL (short) positions being added.`); }
        else if (up && !add2) { x.build = 'Short covering'; add('oi', 0.5 + 0.25 * g, `Short covering: price up but ${oiT} = sellers exiting. The rise can fade without fresh buyers.`); }
        else { x.build = 'Long unwinding'; add('oi', -(0.5 + 0.25 * g), `Long unwinding: price down and ${oiT} = buyers exiting.`); }
      }
      // 4. delivery: shares actually taken home, not just traded in the day
      const dl = ok(x.deliv) ? x.deliv : null;
      if (ok(dl) && ok(x.d5) && x.d5 > 0 && dl >= 30 && dl >= x.d5 * 1.25 && Math.abs(x.r1) >= 0.005) {
        const w = I.dNote === 'yesterday' ? 0.35 : 0.75;
        add('deliv', x.r1 > 0 ? w : -w, `Delivery ${f0(dl)}% vs its usual ${f0(x.d5)}%${I.dNote === 'yesterday' ? ' (yesterday\'s file)' : ''}: ${x.r1 > 0 ? 'real buying, people are holding the shares' : 'real selling, holders are getting out'}.`);
      }
      // 5. trend over 2 and 5 days
      if (ok(x.r5) && ok(x.r2)) {
        if (x.r5 >= 0.04 && x.r2 > 0) add('trend', x.r5 >= 0.12 ? 0.25 : 0.6, `${x.streak >= 3 ? `Up ${x.streak} days in a row, ` : ''}${pc(x.r5)} in 5 days: the trend is up.`);
        else if (x.r5 <= -0.04 && x.r2 < 0) add('trend', x.r5 <= -0.12 ? -0.25 : -0.6, `${x.streak <= -3 ? `Down ${-x.streak} days in a row, ` : ''}${pc(x.r5)} in 5 days: the trend is down.`);
        if (Math.abs(x.r5) >= 0.12) x.info.push(`Already ${x.r5 > 0 ? 'up' : 'down'} ${pc(Math.abs(x.r5)).slice(1)} in 5 days: a pause or bounce-back is common after such a run.`);
      }
      // 6. its sector
      const sc = secOf[x.ind];
      if (sc && ok(sc.r1)) { const sp = cap(sc.r1 / 0.012, 0.6) + (ok(sc.r5) ? cap(sc.r5 / 0.04, 0.15) : 0); if (Math.abs(sc.r1) >= 0.004) add('sector', sp, `Sector ${sc.name} ${sc.r1 >= 0 ? 'strong' : 'weak'}: its F&O stocks ${pc(sc.r1)} today${ok(sc.r5) ? `, ${pc(sc.r5)} in 5 days` : ''} (${sc.up} of ${sc.n} up).`); }
      // 7. news
      const nc = I.newsCo && I.newsCo[x.sym];
      if (nc && ok(nc.sc) && Math.abs(nc.sc) >= 0.3) add('news', cap(nc.sc / 2, 1), `News ${nc.sc > 0 ? 'good' : 'bad'} for the company: "${String(nc.t || '').slice(0, 110)}"`, 'news');
      else if (sc && ok(sc.news) && Math.abs(sc.news) >= 0.6) add('news', cap(sc.news / 4, 0.5), `News ${sc.news > 0 ? 'helps' : 'hurts'} the ${sc.name} sector today.`, 'news');
      // 8. world cues for this kind of company
      CUES.forEach((c) => { const q = W[c.id]; if (!q || !ok(q.chg) || Math.abs(q.chg) < c.min || !c.test(x.sym, x.ind)) return; const s = Math.sign(q.chg) * c.sign; add('world', s * c.w, `${c.name} ${q.chg >= 0 ? '+' : ''}${f1(q.chg)}%: ${c.why}.`); });
      // info only: option walls (next expiry) and results
      if (x.wall && (x.wall.ce || x.wall.pe)) x.info.push(`Option walls: most call OI at ${x.wall.ce || '–'} (works as resistance), most put OI at ${x.wall.pe || '–'} (support)${ok(x.wall.pcr) ? `, PCR ${f2(x.wall.pcr)}` : ''}.`);
      x.sc = x.f.reduce((s, y) => s + y.pts, 0);
      x.agree = x.f.filter((y) => Math.abs(y.pts) >= 0.3 && Math.sign(y.pts) === Math.sign(x.sc)).length;
      x.against = x.f.filter((y) => Math.abs(y.pts) >= 0.3 && Math.sign(y.pts) !== Math.sign(x.sc)).length;
    });
    const nextD = I.next || (I.date ? nextWeekday(I.date) : '');
    const resTom = S.filter((x) => x.res && x.res <= nextD && x.res > I.date).sort((a, b) => Math.abs(b.sc) - Math.abs(a.sc));
    const elig = S.filter((x) => !(x.res && x.res <= nextD && x.res > I.date) && x.agree >= 3 && x.against <= 1);
    const pos = elig.filter((x) => x.sc >= 1.75).sort((a, b) => b.sc - a.sc).slice(0, 5), neg = elig.filter((x) => x.sc <= -1.75).sort((a, b) => a.sc - b.sc).slice(0, 5);
    return { stocks: S, sectors: SEC, pos, neg, resTom, market: market(I, S, nf), next: nextD };
  }
  // the whole market: breadth, FII/DII, world, GIFT Nifty → a tone
  function market(I, S, nf) {
    const up = S.filter((x) => x.r1 > 0).length, dn = S.filter((x) => x.r1 < 0).length, W = I.world || {}, pts = [], add = (p, en, hi) => pts.push({ p, en, hi });
    if (ok(nf)) add(cap(nf / 0.006, 1), `Nifty ${pc(nf, 2)} today`, `Nifty आज ${pc(nf, 2)}`);
    if (up + dn) { const b = (up - dn) / (up + dn); add(cap(b * 1.5, 1), `${up} of ${up + dn} F&O stocks rose`, `${up + dn} में से ${up} F&O शेयर बढ़े`); }
    const F = I.fii;
    if (F && ok(F.fii)) add(cap(F.fii / 3000, 1), `FII ${F.fii >= 0 ? 'bought' : 'sold'} ${crore(F.fii)} in cash, DII ${F.dii >= 0 ? 'bought' : 'sold'} ${crore(F.dii)}${F.date ? ` (${F.date})` : ''}`, `FII ने cash में ${crore(F.fii)} के शेयर ${F.fii >= 0 ? 'खरीदे' : 'बेचे'}, DII ने ${crore(F.dii)} के ${F.dii >= 0 ? 'खरीदे' : 'बेचे'}`);
    const P = I.part && I.part.latest && I.part.latest.p && I.part.latest.p.FII, P0 = I.part && I.part.prev && I.part.prev.p && I.part.prev.p.FII;
    if (P && P.futL + P.futS > 0) { const lr = P.futL / (P.futL + P.futS), lr0 = P0 && P0.futL + P0.futS > 0 ? P0.futL / (P0.futL + P0.futS) : null;
      add(cap((lr - 0.5) * 2, 0.6) + (ok(lr0) ? cap((lr - lr0) * 20, 0.4) : 0), `FII index futures: ${f0(lr * 100)}% long${ok(lr0) ? ` (${lr >= lr0 ? 'up' : 'down'} from ${f0(lr0 * 100)}%)` : ''}${I.part.latest.date ? `, ${I.part.latest.date}` : ''}`, `FII के index futures में ${f0(lr * 100)}% सौदे खरीद (long) के हैं${ok(lr0) ? ` — कल ${f0(lr0 * 100)}% थे` : ''}`); }
    const g = W.gift, nC = I.nifty && I.nifty.c;
    if (g && ok(g.price) && nC) { const gap = g.price / nC - 1; add(cap(gap / 0.004, 1), `GIFT Nifty ${f0(g.price)}: ${pc(gap, 2)} vs Nifty's ${f0(nC)} (includes a small futures premium)`, `GIFT Nifty, Nifty से ${pc(gap, 2)} पर है`); }
    const us = W.nasF || W.dowF; if (us && ok(us.chg)) add(cap(us.chg / 0.8, 0.7), `US futures: Nasdaq ${W.nasF && ok(W.nasF.chg) ? pc(W.nasF.chg / 100) : '–'}, Dow ${W.dowF && ok(W.dowF.chg) ? pc(W.dowF.chg / 100) : '–'}`, `अमेरिकी futures: Nasdaq ${W.nasF && ok(W.nasF.chg) ? pc(W.nasF.chg / 100) : '–'}, Dow ${W.dowF && ok(W.dowF.chg) ? pc(W.dowF.chg / 100) : '–'}`);
    const br = W.brent; if (br && ok(br.chg) && Math.abs(br.chg) >= 0.8) add(cap(-br.chg / 3, 0.4), `Brent ${f1(br.price || 0) !== '0.0' ? '$' + f1(br.price) + ' ' : ''}${pc(br.chg / 100)}${W.wti && ok(W.wti.chg) ? `, WTI ${pc(W.wti.chg / 100)}` : ''}`, `Brent crude ${pc(br.chg / 100)} (${br.chg < 0 ? 'सस्ता: भारत के लिए अच्छा' : 'महँगा: भारत के लिए बुरा'})`);
    const v = W.usvix; if (v && ok(v.chg) && v.chg >= 8) add(-0.4, `US fear gauge (VIX) up ${f0(v.chg)}%`, `अमेरिका का डर-सूचक VIX ${f0(v.chg)}% ऊपर`);
    const tot = pts.reduce((s, x) => s + x.p, 0), tone = tot >= 1.5 ? 'positive' : tot >= 0.5 ? 'mildly positive' : tot <= -1.5 ? 'negative' : tot <= -0.5 ? 'mildly negative' : 'mixed';
    const toneHi = { positive: 'positive (अच्छा)', 'mildly positive': 'हल्का positive', negative: 'negative (कमज़ोर)', 'mildly negative': 'हल्का negative', mixed: 'मिला-जुला (साफ़ दिशा नहीं)' }[tone];
    return { up, dn, pts, tot, tone, toneHi };
  }

  /* ---------- live data ---------- */
  function idb(mode, fn) { return new Promise((res) => { try { const o = indexedDB.open('fno_bt', 1); o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onsuccess = () => { try { const tx = o.result.transaction('kv', mode), q = fn(tx.objectStore('kv')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => res(null); } catch (e) { res(null); } }; o.onerror = () => res(null); } catch (e) { res(null); } }); }
  const idbGet = (k) => idb('readonly', (s) => s.get(k)), idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k)), idbDel = (k) => idb('readwrite', (s) => s.delete(k));
  async function nse(f, d) {
    const t = await Store.idToken();
    const r = await fetch(APP_CONFIG.WORKER_URL.replace(/\/$/, '') + `/api/nsefile?f=${f}${d ? '&d=' + d : ''}`, { headers: { Authorization: 'Bearer ' + t } });
    if (r.status === 404) { const j = await r.json().catch(() => ({})); if (j.code === 'NSE_NOFILE') return null; throw new Error('Deploy the new Worker code (the /api/nsefile endpoint is missing).'); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'NSE file: HTTP ' + r.status); }
    return f === 'fo' ? unzip(await r.arrayBuffer()) : r.text();
  }
  const NOFILE = () => Store.pref('brief_nofile', {});
  async function secFor(d8, keep) {
    const k = 'brief_sec_' + d8, c = await idbGet(k); if (c) return c;
    if (NOFILE()[d8]) return null;
    const txt = await nse('sec', d8);
    if (!txt) { if (d8 < ymd8(new Date(ist().getTime() - 2 * 864e5))) Store.setPref('brief_nofile', { ...NOFILE(), [d8]: 1 }); return null; }
    const p = parseSec(txt, keep); if (!p.date || Object.keys(p.s).length < 20) return null;
    await idbSet(k, p);
    const idx = (await idbGet('brief_sec_idx')) || []; if (!idx.includes(d8)) idx.push(d8); idx.sort();
    while (idx.length > 20) await idbDel('brief_sec_' + idx.shift());
    await idbSet('brief_sec_idx', idx);
    return p;
  }
  async function foFor(d8) {
    const k = 'brief_fo_' + d8, c = await idbGet(k); if (c) return c;
    const txt = await nse('fo', d8); if (!txt) return null;
    const p = parseFO(txt); if (!p.date) return null;
    const old = await idbGet('brief_fo_last'); if (old && old !== d8) await idbDel('brief_fo_' + old);
    await idbSet(k, p); await idbSet('brief_fo_last', d8);
    return p;
  }
  async function sectors() {
    const c = Store.pref('brief_n500', null); if (c && c.ts > Date.now() - 7 * 864e5 && c.m) return c.m;
    try { const t = await nse('n500'); const m = t ? parseN500(t) : {}; if (Object.keys(m).length > 100) { Store.setPref('brief_n500', { ts: Date.now(), m }); return m; } } catch (e) { /* use old */ }
    return (c && c.m) || {};
  }
  const safe = async (p, miss, what) => { try { return await p; } catch (e) { miss.push(what + ': ' + e.message); return null; } };

  async function collect(force) {
    const miss = [], now = ist(), hmin = now.getUTCHours() * 60 + now.getUTCMinutes(), wd = now.getUTCDay(), today8 = ymd8(now), today = d8to10(today8);
    busy = 'Reading today\'s prices…'; render();
    const eod = await safe(Source.raw('/api/eod'), miss, 'Live prices');
    const Q = (eod && eod.q) || {}, nq = Q.NIFTY, tradedToday = nq && nq.ts ? new Date(+nq.ts || Date.parse(nq.ts)).getTime() + 5.5 * 3600e3 > Date.parse(today) : wd > 0 && wd < 6;
    // which F&O file is the newest? (today's comes in the evening)
    busy = 'Reading NSE\'s F&O file (OI)…'; render();
    const cands = []; for (let i = 0; cands.length < 12 && i < 25; i++) { const d = new Date(now.getTime() - i * 864e5); if (d.getUTCDay() > 0 && d.getUTCDay() < 6) cands.push(ymd8(d)); }
    let fo = null, foD = '';
    for (const d of cands.slice(0, 6)) { if (d === today8 && hmin < 17 * 60) continue; fo = await safe(foFor(d), miss, 'NSE F&O file'); if (fo) { foD = d; break; } if (miss.length && /Deploy/.test(miss[miss.length - 1])) break; }
    const keep = fo ? new Set(Object.keys(fo.fut).filter((s) => !fo.fut[s].idx)) : new Set(Object.keys(Q).filter((s) => !Q[s].idx));
    busy = 'Reading NSE delivery files (last 6 trading days)…'; render();
    const sec = {};
    for (const d of cands) { if (Object.keys(sec).length >= 7) break; if (d === today8 && hmin < 17 * 60) continue; const p = await safe(secFor(d, keep), miss, 'NSE delivery file'); if (p) sec[d] = p; if (miss.length && /Deploy/.test(miss[miss.length - 1])) break; }
    const sd = Object.keys(sec).sort(), lastSec = sd[sd.length - 1] || '';
    // provisional (3 pm on a trading day, before NSE's evening files) or final
    const prov = force === 'prov' || (tradedToday && wd > 0 && wd < 6 && hmin >= 15 * 60 && lastSec < today8 && Object.keys(Q).length > 20);
    const D = prov ? today8 : lastSec || foD; if (!D) throw new Error(miss[0] || 'No NSE data yet');
    const hist = {}, px = {}, dToday = {}; let dNote = 'today';
    const past = sd.filter((d) => d < D).slice(-5);
    keep.forEach((s) => { hist[s] = past.map((d) => sec[d].s[s]).filter(Boolean); });
    if (prov) {
      keep.forEach((s) => { const q = Q[s]; if (q && q.c > 0) px[s] = { c: q.c, pc: q.pc, o: q.o, h: q.h, l: q.l, v: q.v }; });
      const y = sec[past[past.length - 1]]; if (y) { keep.forEach((s) => { if (y.s[s]) dToday[s] = y.s[s][6]; }); dNote = 'yesterday'; }
    } else {
      const T = sec[D]; if (T) for (const s in T.s) { const r = T.s[s]; px[s] = { c: r[0], pc: r[1], o: r[2], h: r[3], l: r[4], v: r[5] }; dToday[s] = r[6]; }
    }
    // futures OI
    const oi = {}; let oiNote = '';
    const liveOI = fo && (prov || (foD < D && D === today8 && Object.keys(Q).length > 20)); // evening before NSE's F&O file: Upstox still shows today's closing OI
    if (fo && !liveOI) { for (const s in fo.fut) if (!fo.fut[s].idx) oi[s] = { oi: fo.fut[s].oi, doi: fo.fut[s].doi }; oiNote = foD === D ? 'NSE F&O file of ' + nice(D) : `NSE F&O file of ${nice(foD)} (today's not out yet)`; }
    if (liveOI) {
      busy = 'Reading live futures OI…'; render();
      const toks = []; for (const s in fo.fut) if (!fo.fut[s].idx) fo.fut[s].toks.forEach(([t, x]) => { if (t && x > today) toks.push(t); });
      const L = await safe(Source.raw('/api/foq?t=' + toks.join(',')), miss, 'Live futures OI');
      if (L && L.q) { for (const s in fo.fut) { if (fo.fut[s].idx) continue; let b = 0, n = 0, got = 0; fo.fut[s].toks.forEach(([t, x, o]) => { if (!(x > today)) return; b += o; const q = L.q[t]; if (q) { n += q[1]; got++; } }); if (got && b > 0) oi[s] = { oi: n, doi: n - b }; } oiNote = `live futures OI vs NSE's ${nice(foD)} file`; }
    }
    busy = 'Reading sectors, FII/DII, world cues, news, results…'; render();
    const [secMap, fii, part, world, rescal] = await Promise.all([safe(sectors(), miss, 'Sectors'), safe(Source.raw('/api/fiidii'), miss, 'FII/DII'), safe(Source.raw('/api/participant'), miss, 'FII futures'), safe(Source.raw('/api/world'), miss, 'World cues'), safe(Source.raw('/api/rescal'), miss, 'Results calendar')]);
    try { if (typeof Impact !== 'undefined' && !Impact.data && Impact.load) await Impact.load(true); } catch (e) { miss.push('News: ' + e.message); }
    const W = {}; ((world && world.items) || []).forEach((x) => { W[x.id] = x; });
    const newsCo = {}, newsSec = {};
    try { (Impact.companies() || []).forEach((c) => { newsCo[c.sym] = { sc: c.sc, t: c.heads && c.heads[0] && c.heads[0].t }; }); (Impact.sectors() || []).forEach((s) => { newsSec[s.n] = s.sc; }); } catch (e) { /* no news */ }
    const results = {}; ((rescal && rescal.items) || []).forEach((x) => { if (x.sym && x.date >= d8to10(D)) results[x.sym] = results[x.sym] && results[x.sym] < x.date ? results[x.sym] : x.date; });
    const nifty = nq && (prov || D === today8) ? { c: nq.c, pc: nq.pc, h: nq.h, l: nq.l } : fo && fo.fut.NIFTY && fo.fut.NIFTY.near ? { c: fo.fut.NIFTY.near.c, pc: fo.fut.NIFTY.near.pc, fut: true } : null;
    // average volume for the ORB scanner's "volume pace"
    try { const v = {}; keep.forEach((s) => { const a = mean((hist[s] || []).map((r) => r[5])); if (a) v[s] = a; }); idbSet('brief_sec_avg', { ts: Date.now(), v }); } catch (e) { /* fine */ }
    const I = { date: d8to10(D), mode: prov ? 'prov' : 'final', px, hist, dToday, dNote, oi, oiNote, walls: fo ? fo.walls : {}, sector: secMap || {}, nifty, newsCo, newsSec, world: W, fii: fii && !fii.none ? fii : null, part: part && !part.none ? part : null, results };
    return { I, miss, ts: Date.now(), files: { fo: foD, sec: sd }, live: true, secCache: sec };
  }

  /* ---------- track record: every day's picks checked against the next day ---------- */
  const recKey = () => 'brief_rec' + (live() ? '' : '_demo');
  function saveRec(R, I) {
    // only picks made before the next session opens count (a brief rebuilt during the next day would see that day's news)
    const nx = nextWeekday(I.date), nowS = ist().toISOString().slice(0, 16).replace('T', ' ');
    if (nowS >= nx + ' 09:15') return;
    const rec = Store.pref(recKey(), {}), d = I.date, e = rec[d] || {};
    e[I.mode] = { ts: Date.now(), picks: [...R.pos.map((x) => ({ s: x.sym, side: 1, sc: +x.sc.toFixed(2), c: x.price })), ...R.neg.map((x) => ({ s: x.sym, side: -1, sc: +x.sc.toFixed(2), c: x.price }))] };
    if (I.nifty && !I.nifty.fut && I.mode === 'final') e.nifty = [I.nifty.c, I.nifty.pc];
    rec[d] = e; const keys = Object.keys(rec).sort(); while (keys.length > 120) delete rec[keys.shift()];
    Store.setPref(recKey(), rec);
  }
  // checks picks of day d with the next trading day's NSE file (close vs the day's close)
  function evaluate(secByDate) {
    const rec = Store.pref(recKey(), {}), days = Object.keys(rec).sort(); let dirty = false;
    days.forEach((d) => {
      const e = rec[d]; if (e.res) return;
      const nd = Object.keys(secByDate).map(d8to10).filter((x) => x > d).sort()[0]; if (!nd) return;
      const T = secByDate[nd.replace(/-/g, '')], base = secByDate[d.replace(/-/g, '')]; if (!T) return;
      const nf = rec[nd] && rec[nd].nifty ? rec[nd].nifty[0] / rec[nd].nifty[1] - 1 : null;
      e.res = {}; ['prov', 'final'].forEach((m) => { if (!e[m]) return; e.res[m] = e[m].picks.map((p) => { const r = T.s[p.s], c0 = base && base.s[p.s] ? base.s[p.s][0] : p.c; if (!r || !c0) return null; return { s: p.s, side: p.side, gap: r[2] / c0 - 1, mv: r[0] / c0 - 1, nf }; }).filter(Boolean); });
      e.next = nd; dirty = true;
    });
    if (dirty) Store.setPref(recKey(), rec);
    return rec;
  }
  function stats(rec, mode) {
    const L = []; Object.keys(rec).sort().forEach((d) => { const e = rec[d]; if (e.res && e.res[mode]) e.res[mode].forEach((x) => L.push({ d, ...x })); });
    const pos = L.filter((x) => x.side > 0), neg = L.filter((x) => x.side < 0), days = new Set(L.map((x) => x.d)).size;
    const hit = (A) => (A.length ? A.filter((x) => x.side * x.mv > 0).length / A.length : null);
    const avg = (A, f) => (A.length ? A.reduce((s, x) => s + f(x), 0) / A.length : null);
    const vsN = L.filter((x) => ok(x.nf));
    return { n: L.length, days, pos: pos.length, neg: neg.length, hitPos: hit(pos), hitNeg: hit(neg), edge: avg(L, (x) => x.side * x.mv), gapEdge: avg(L, (x) => x.side * x.gap), vsN: avg(vsN, (x) => x.side * (x.mv - x.nf)), nVs: vsN.length };
  }

  /* ---------- build ---------- */
  async function build(force) {
    if (busy) return; err = '';
    try {
      let C;
      if (!live()) C = demoCollect(force);
      else C = await collect(force);
      busy = 'Working it out…'; render(); await sleep(10);
      const R = score(C.I);
      B = { ...C, R };
      saveRec(R, C.I);
      try { const all = C.secCache || {}; const idx = live() ? (await idbGet('brief_sec_idx')) || [] : []; for (const d of idx) if (!all[d]) { const p = await idbGet('brief_sec_' + d); if (p) all[d] = p; } evaluate(all); } catch (e) { /* later */ }
    } catch (e) { err = e.message; }
    busy = ''; render();
  }

  /* ---------- page ---------- */
  function mk() {
    if ($b('bf')) return;
    const el = document.createElement('div'); el.id = 'bf'; el.className = 'rp bf'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Next-day brief');
    el.innerHTML = `<div class="rp-top"><div class="mk-tabs" role="tablist"><button data-t="lists" onclick="Brief.show('lists')">Tomorrow's Lists</button><button data-t="sectors" onclick="Brief.show('sectors')">Sectors</button><button data-t="all" onclick="Brief.show('all')">All F&O Stocks</button><button data-t="rec" onclick="Brief.show('rec')">Track Record</button><button data-t="how" onclick="Brief.show('how')">How It Works</button></div>
      <span class="mut" id="bfNote"></span><button class="x" onclick="Brief.close()" aria-label="Close">✕</button></div><div id="bfBody"></div>`;
    document.body.appendChild(el);
  }
  function open(t) { mk(); $b('bf').classList.add('on'); document.body.style.overflow = 'hidden'; show(t || tab); if (!B || Date.now() - B.ts > 10 * 60e3) build(); }
  function close() { const el = $b('bf'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; }
  function show(t) { tab = t; render(); }
  function sort(k) { sortK = k; render(); }
  function render() {
    const b = $b('bfBody'); if (!b) return;
    document.querySelectorAll('#bf .mk-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === tab));
    let h = '';
    if (busy) h += `<div class="alert i">${esc(busy)}</div>`;
    if (err) h += `<div class="alert">${esc(err)}</div>`;
    if (tab === 'how') h += howHTML();
    else if (tab === 'rec') h += recHTML();
    else if (B) h += tab === 'lists' ? listsHTML() : tab === 'sectors' ? sectorsHTML() : allHTML();
    else if (!busy && !err) h += '<div class="mut">Loading…</div>';
    b.innerHTML = h;
    const n = $b('bfNote'); if (n) n.textContent = B ? `${B.I.mode === 'prov' ? 'Provisional (live)' : 'Final'} brief from ${nice(B.I.date)}'s data, for ${nice(B.R.next)} · made ${new Date(B.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}${B.live ? '' : ' · sample data'}` : '';
  }
  function head() {
    const I = B.I, R = B.R, M = R.market, now = ist(), hmin = now.getUTCHours() * 60 + now.getUTCMinutes();
    let h = '';
    h += `<div class="bf-mode ${I.mode}"><b>${I.mode === 'prov' ? '⏳ Provisional brief' : '✅ Final brief'}</b> <span>${I.mode === 'prov' ? 'Live prices and live futures OI; delivery is yesterday\'s. NSE publishes today\'s files around 6–7 pm: open this again tonight for the final version.' : `Built from NSE's files for ${nice(I.date)}. FII/DII, GIFT Nifty, US futures and crude are as of now${hmin < 9 * 60 + 15 && I.date < istYmd() ? ' (morning: check GIFT Nifty again before 9:15)' : ''}.`}</span>
      <button class="btn ghost" onclick="Brief.build()">Refresh</button>${live() && hmin >= 9 * 60 + 15 && hmin < 15 * 60 + 30 && I.mode !== 'prov' ? '<button class="btn ghost" onclick="Brief.build(\'prov\')">Live preview now</button>' : ''}</div>`;
    const S = R.sectors.filter((s) => s.n >= 3), best = S.slice(0, 2), worst = S.slice(-2).reverse();
    const hi = [...M.pts.map((x) => x.hi)];
    if (best.length) hi.push(`सबसे मज़बूत sector: ${best.map((s) => `${s.name} (${pc(s.r1)})`).join(', ')}; सबसे कमज़ोर: ${worst.map((s) => `${s.name} (${pc(s.r1)})`).join(', ')}`);
    h += `<div class="gd-mean bf-sum"><b>आसान भाषा में:</b> ${hi.map(esc).join('। ')}। <b>कुल मिलाकर कल का माहौल: ${esc(M.toneHi)}.</b> नीचे की list research के लिए है — हर शेयर के कारण पढ़कर खुद chart पर जाँचें, यह guarantee नहीं है।</div>`;
    h += `<div class="bf-mkt">${M.pts.map((x) => `<span class="${cl(x.p)}">${x.p > 0.05 ? '▲' : x.p < -0.05 ? '▼' : '•'} ${esc(x.en)}</span>`).join('')}<span class="bf-tone ${cl(M.tot)}">Tone for ${nice(R.next)}: <b>${M.tone}</b></span></div>`;
    if (B.miss && B.miss.length) h += `<div class="alert i" style="font-size:12.5px">Not available this time (the brief works without them): ${B.miss.map(esc).join(' · ')}</div>`;
    return h;
  }
  function card(x, side) {
    const sup = x.f.filter((y) => Math.sign(y.pts) === side).sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)), opp = x.f.filter((y) => Math.sign(y.pts) === -side && Math.abs(y.pts) >= 0.2);
    return `<div class="bf-card ${side > 0 ? 'pos' : 'neg'}"><div class="bf-ch"><b>${esc(x.sym)}</b><span class="mut">${esc(secName(x.ind))}</span><span>${f2(x.price)} <em class="${cl(x.r1)}">${pc(x.r1)}</em></span>
      <span class="bf-sc ${side > 0 ? 'up' : 'dn'}" title="Points from the rules below">${x.sc >= 0 ? '+' : ''}${f1(x.sc)}</span></div>
      <div class="bf-agree">${x.agree} signs agree${x.against ? `, ${x.against} disagree` : ''}${x.build ? ` · <b>${x.build}</b>` : ''}</div>
      <ul>${sup.map((y) => `<li class="ok">✔ ${esc(y.t)}</li>`).join('')}${opp.map((y) => `<li class="no">✖ ${esc(y.t)}</li>`).join('')}${x.info.map((t) => `<li class="inf">ℹ ${esc(t)}</li>`).join('')}</ul>
      <button class="btn ghost" onclick="Brief.analyze('${esc(x.sym)}')">Analyze</button></div>`;
  }
  function listsHTML() {
    const R = B.R; let h = head();
    h += `<div class="bf-cols"><section><div class="ph"><h2 class="up">▲ Top ${R.pos.length || ''} positive for ${nice(R.next)}</h2></div>${R.pos.length ? R.pos.map((x) => card(x, 1)).join('') : '<div class="mut">No stock passed the bar today (at least 3 signs agreeing, +1.75 points). That is an answer too: no clear long idea.</div>'}</section>
      <section><div class="ph"><h2 class="dn">▼ Top ${R.neg.length || ''} negative for ${nice(R.next)}</h2></div>${R.neg.length ? R.neg.map((x) => card(x, -1)).join('') : '<div class="mut">No stock passed the bar today (at least 3 signs agreeing, −1.75 points).</div>'}</section></div>`;
    if (R.resTom.length) h += `<section class="mk-panel" style="margin-top:12px"><div class="ph"><h2>⚠ Results due ${nice(R.next)} (left out of the lists)</h2></div><div class="mut" style="font-size:13px;margin-bottom:6px">A results day can gap 5–10% either way; the signs above don't predict that.</div><div class="why">${R.resTom.map((x) => `<span class="${cl(x.sc)}">${esc(x.sym)} · ${x.res} · today ${pc(x.r1)}</span>`).join('')}</div></section>`;
    h += `<div class="legend">Points come from simple rules you can see on each card (How It Works tab). "Signs agree" counts the rules pointing the same way; a pick needs at least 3 and at most 1 against. ${B.I.oiNote ? `OI: ${esc(B.I.oiNote)}.` : 'OI: not available this time.'} NSE does not publish daily FII buying or selling in single stocks or sectors; OI buildup and delivery are the closest public signs. Research only, not a recommendation. Check the Track Record tab before trusting it.</div>`;
    return h;
  }
  function sectorsHTML() {
    const R = B.R; let h = head();
    h += `<section class="mk-panel"><div class="ph"><h2>Sector momentum (F&O stocks of each sector)</h2></div><div class="tblw"><table><thead><tr><th class="l">Sector</th><th>Stocks</th><th>Today</th><th>2 days</th><th>5 days</th><th>Rising today</th><th>OI tilt</th><th>News</th></tr></thead><tbody>${R.sectors.map((s) => `<tr><td class="l"><b>${esc(s.name)}</b></td><td>${s.n}</td><td class="${cl(s.r1)}">${pc(s.r1)}</td><td class="${cl(s.r2)}">${pc(s.r2)}</td><td class="${cl(s.r5)}">${pc(s.r5)}</td><td>${s.up} of ${s.n}</td><td class="${cl(s.oiT)}">${s.oiT > 0.4 ? 'buying' : s.oiT < -0.4 ? 'selling' : '–'}</td><td class="${cl(s.news)}">${ok(s.news) ? (s.news > 0 ? '▲' : '▼') : '–'}</td></tr>`).join('')}</tbody></table></div>
      <div class="legend">Sectors from NSE's Nifty 500 list (industry). "OI tilt" adds up long buildups and short coverings (buying) against short buildups and long unwindings (selling) in the sector's stock futures. Sector FII holdings are published by NSDL only every 15 days, so they are not used here.</div></section>`;
    return h;
  }
  function allHTML() {
    const R = B.R, L = R.stocks.slice().sort((a, b) => (sortK === 'sym' ? (a.sym < b.sym ? -1 : 1) : sortK === 'r1' ? b.r1 - a.r1 : sortK === 'r5' ? (b.r5 || 0) - (a.r5 || 0) : sortK === 'oi' ? (b.oiPct || 0) - (a.oiPct || 0) : b.sc - a.sc));
    const th = (k, t) => `<th class="${k === 'sym' ? 'l' : ''}" style="cursor:pointer" onclick="Brief.sort('${k}')">${t}${sortK === k ? ' ▾' : ''}</th>`;
    return head() + `<div class="tblw"><table><thead><tr>${th('sym', 'Stock')}<th class="l">Sector</th>${th('r1', 'Today')}<th>2D</th>${th('r5', '5D')}${th('oi', 'Fut OI')}<th class="l">Buildup</th><th>Delivery</th><th>Volume</th>${th('sc', 'Points')}<th class="l">Main reasons</th></tr></thead><tbody>${L.map((x) => `<tr>
      <td class="l"><b>${esc(x.sym)}</b>${x.res ? ` <small class="dn">results ${x.res.slice(5)}</small>` : ''}</td><td class="l mut">${esc(secName(x.ind))}</td><td class="${cl(x.r1)}">${pc(x.r1)}</td><td class="${cl(x.r2)}">${pc(x.r2)}</td><td class="${cl(x.r5)}">${pc(x.r5)}</td><td class="${cl(x.oiPct)}">${pc(x.oiPct)}</td><td class="l">${x.build || '–'}</td>
      <td>${ok(x.deliv) ? f0(x.deliv) + '%' : '–'}${ok(x.d5) ? ` <small class="mut">(${f0(x.d5)})</small>` : ''}</td><td>${ok(x.volX) ? f1(x.volX) + '×' : '–'}</td><td class="${cl(x.sc)}"><b>${x.sc >= 0 ? '+' : ''}${f1(x.sc)}</b></td>
      <td class="l" style="font-size:12px">${x.f.slice().sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 2).map((y) => esc(y.t)).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function recHTML() {
    const rec = Store.pref(recKey(), {}), F = stats(rec, 'final'), P = stats(rec, 'prov');
    const row = (n, s) => `<tr><td class="l"><b>${n}</b></td><td>${s.days}</td><td>${s.pos ? `${f0(s.hitPos * 100)}% <small class="mut">of ${s.pos}</small>` : '–'}</td><td>${s.neg ? `${f0(s.hitNeg * 100)}% <small class="mut">of ${s.neg}</small>` : '–'}</td><td class="${cl(s.gapEdge)}">${pc(s.gapEdge, 2)}</td><td class="${cl(s.edge)}">${pc(s.edge, 2)}</td><td class="${cl(s.vsN)}">${s.nVs ? pc(s.vsN, 2) : '–'}</td></tr>`;
    let h = `<div class="gd-mean"><b>आसान मतलब:</b> हर दिन की list यहाँ save होती है और अगले दिन के close से जाँची जाती है। "Positive सही" = जितने positive शेयर अगले दिन सच में ऊपर बंद हुए। 50% से ऊपर लगातार रहे, तभी list पर भरोसा बढ़ाइए। कम से कम 20 दिन का record देखें।</div>`;
    const few = F.days < 20;
    h += `<div class="tblw"><table><thead><tr><th class="l">Version</th><th>Days checked</th><th>Positive picks closed up</th><th>Negative picks closed down</th><th>Avg next-day gap (in pick's direction)</th><th>Avg next-day close move</th><th>vs Nifty</th></tr></thead><tbody>${row('Final (evening)', F)}${row('Provisional (3 pm)', P)}</tbody></table></div>`;
    h += `<div class="alert ${few ? 'i' : F.edge > 0 ? 'i' : 'd'}">${F.days ? few ? `Only ${F.days} day${F.days > 1 ? 's' : ''} checked so far: too few to judge (needs at least 20). Keep opening the brief each evening.` : F.edge > 0.002 ? 'So far the picks moved in their direction on average. Keep watching: an edge can fade.' : 'So far the picks have NOT beaten a coin flip. Treat the lists as a reading of today, not a forecast.' : 'No day checked yet. Each brief is checked after the next trading day\'s NSE file is out.'}</div>`;
    const days = Object.keys(rec).sort().reverse().slice(0, 15);
    if (days.length) h += `<section class="mk-panel"><div class="ph"><h2>Last days</h2></div>${days.map((d) => { const e = rec[d], r = e.res && (e.res.final || e.res.prov), P2 = (e.final || e.prov || { picks: [] }).picks;
      return `<div class="bf-day"><b>${nice(d)}</b> <span class="mut">${e.final ? 'final' : 'provisional'}${e.next ? ` → checked on ${nice(e.next)}` : ' → waiting for the next day'}</span><div class="why">${(r || P2).map((p) => { const mv = p.mv; return `<span class="${ok(mv) ? (p.side * mv > 0 ? 'up' : 'dn') : ''}">${p.side > 0 ? '▲' : '▼'} ${esc(p.s)}${ok(mv) ? ` ${pc(mv)}` : ''}</span>`; }).join('') || '<span class="mut">no picks</span>'}</div></div>`; }).join('')}</section>`;
    h += `<div class="legend">Move = next trading day's close vs the brief day's close (NSE files). Gap = next day's open vs that close. Saved in this browser${live() ? '' : ' (sample data)'}.</div>`;
    return h;
  }
  function howHTML() {
    return `<div class="gd-mean"><b>आसान मतलब:</b> यह page शाम को (या 3 बजे के बाद) बताता है कि कल किन F&O शेयरों में मज़बूती या कमज़ोरी दिख रही है, और क्यों। हर कारण नीचे के नियमों से आता है — कोई जादू या AI का अंदाज़ा नहीं।</div>
    <section class="mk-panel"><div class="ph"><h2>The rules (points for each stock)</h2></div><div class="tblw"><table><thead><tr><th class="l">Sign</th><th>Points</th><th class="l">In simple words</th></tr></thead><tbody>
    <tr><td class="l">Move vs Nifty</td><td>up to ±1.5 (×1.3 on heavy volume)</td><td class="l">Beating the Nifty today = strength. Heavy volume makes it count more.</td></tr>
    <tr><td class="l">Close in the day's range</td><td>±0.75</td><td class="l">Closing near the high = buyers held on till the end (and the reverse).</td></tr>
    <tr><td class="l">Futures OI buildup</td><td>±1 to ±1.5 (buildup), ±0.5 to ±0.75 (covering / unwinding)</td><td class="l">Price ↑ + OI ↑ = long buildup (new buyers). Price ↓ + OI ↑ = short buildup (new sellers). Price ↑ + OI ↓ = short covering. Price ↓ + OI ↓ = long unwinding. Final: NSE's F&O file. Provisional: live OI vs yesterday's file.</td></tr>
    <tr><td class="l">Delivery %</td><td>±0.75 (±0.35 with yesterday's)</td><td class="l">Delivery well above the stock's own 5-day average on a big move = real buying or selling, not just day trading.</td></tr>
    <tr><td class="l">Trend (2 and 5 days)</td><td>±0.6 (±0.25 after a 12%+ run)</td><td class="l">Moving the same way for days. After a very big run, a pause is common, so it counts less.</td></tr>
    <tr><td class="l">Sector</td><td>up to ±0.75</td><td class="l">Its sector's F&O stocks moving together (financials, IT, pharma, auto…).</td></tr>
    <tr><td class="l">News</td><td>up to ±1 (company), ±0.5 (sector)</td><td class="l">From the Impact page's reading of today's headlines.</td></tr>
    <tr><td class="l">World cues</td><td>±0.25 to ±0.5</td><td class="l">Nasdaq and the rupee for IT; Brent for oil marketers, paints, tyres, airlines (cheaper = good) and oil producers (dearer = good); gold for gold-loan firms.</td></tr>
    <tr><td class="l">Option walls, PCR</td><td>info only</td><td class="l">Strikes with the most call OI (resistance) and put OI (support) for the next expiry.</td></tr>
    </tbody></table></div>
    <p class="mut" style="font-size:13px">A stock makes the Top 5 with at least +1.75 (or −1.75) points, 3 or more signs pointing the same way and at most 1 against. Results due the next day are listed apart. The market tone (Nifty, breadth, FII/DII cash, FII index-futures long %, GIFT Nifty, US futures, crude, US VIX) is shown on top; it doesn't change the ranking, it tells you whether the whole market is likely to help or fight your idea.</p>
    <p class="mut" style="font-size:13px"><b>What is not available:</b> FII or DII buying and selling in a single stock or a sector for a day is not published by NSE or SEBI. FII totals (cash) and FII positions in index futures and options are published daily, and both are used. Sector-wise FII holdings come from NSDL every 15 days.</p>
    <p class="mut" style="font-size:13px"><b>When:</b> the provisional brief from 3:00 pm (live), the final one after NSE's files are out (usually 6–7 pm). Open it again late at night or before 9:15 am for the latest GIFT Nifty, US futures and crude. Data files: NSE F&O bhavcopy, NSE full bhavcopy with delivery, NSE Nifty 500 list, plus the dashboard's own FII/DII, world, news and results feeds.</p></section>`;
  }
  async function analyze(sym) {
    if (!live()) return toast('Adding stocks works in live mode.');
    let key = null, lot = null, name = sym;
    try { const u = await Source.raw('/api/universe'); const x = (u.items || []).find((i) => i.sym === sym); if (x) { key = x.key; lot = x.lot; name = x.name || sym; } } catch (e) { return toast(e.message); }
    if (!key) return toast('Could not find ' + sym);
    close(); addWatch({ id: sym.replace(/[^A-Z0-9&]/g, '').slice(0, 20), label: sym, name, key, ukey: key, exch: 'NSE', kind: 'EQ', fo: true, lot, sym });
  }

  /* ---------- auto: tell the user when a brief is ready (while the dashboard is open) ---------- */
  function auto() {
    if (!live()) return;
    const n = ist(), hmin = n.getUTCHours() * 60 + n.getUTCMinutes(), wd = n.getUTCDay(), d = istYmd();
    if (wd === 0 || wd === 6) return;
    const say = (k, t, hi) => { if (notified[k]) return; notified[k] = 1; Store.setPref('brief_note', { ...Store.pref('brief_note', {}), [k]: 1 });
      toast(t); try { if (typeof Voice !== 'undefined' && Voice.say) Voice.say(hi); } catch (e) { /* no voice */ } };
    notified = { ...Store.pref('brief_note', {}), ...notified };
    if (hmin >= 15 * 60 + 5 && hmin < 15 * 60 + 30 && !notified[d + 'p']) say(d + 'p', 'Next-Day Brief: the provisional (3 pm) version is ready. Open "Brief" on top.', 'कल के लिए provisional brief तैयार है। ऊपर Brief खोलिए।');
    if (hmin >= 19 * 60 && hmin < 23 * 60 + 30 && !notified[d + 'f']) {
      if (busy) return;
      build().then(() => { if (B && B.I.mode === 'final' && B.I.date === d) say(d + 'f', 'Next-Day Brief: the final version (with NSE\'s OI and delivery files) is ready.', 'कल के लिए final brief तैयार है।'); }).catch(() => {});
    }
  }
  setTimeout(() => { auto(); setInterval(auto, 60e3); }, 20000);

  /* ---------- demo (sample numbers, never used in live mode) ---------- */
  function demoCollect(force) {
    let s = 11; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const L = [['HDFCBANK', 'Financial Services'], ['ICICIBANK', 'Financial Services'], ['SBIN', 'Financial Services'], ['AXISBANK', 'Financial Services'], ['KOTAKBANK', 'Financial Services'], ['BAJFINANCE', 'Financial Services'], ['MUTHOOTFIN', 'Financial Services'], ['INFY', 'Information Technology'], ['TCS', 'Information Technology'], ['HCLTECH', 'Information Technology'], ['WIPRO', 'Information Technology'], ['TECHM', 'Information Technology'], ['COFORGE', 'Information Technology'], ['SUNPHARMA', 'Healthcare'], ['CIPLA', 'Healthcare'], ['LUPIN', 'Healthcare'], ['DRREDDY', 'Healthcare'], ['MARUTI', 'Automobile and Auto Components'], ['M&M', 'Automobile and Auto Components'], ['TATAMOTORS', 'Automobile and Auto Components'], ['APOLLOTYRE', 'Automobile and Auto Components'], ['TATASTEEL', 'Metals & Mining'], ['HINDALCO', 'Metals & Mining'], ['JSWSTEEL', 'Metals & Mining'], ['BPCL', 'Oil Gas & Consumable Fuels'], ['IOC', 'Oil Gas & Consumable Fuels'], ['ONGC', 'Oil Gas & Consumable Fuels'], ['RELIANCE', 'Oil Gas & Consumable Fuels'], ['ITC', 'Fast Moving Consumer Goods'], ['HINDUNILVR', 'Fast Moving Consumer Goods'], ['ASIANPAINT', 'Consumer Durables'], ['TITAN', 'Consumer Durables'], ['LT', 'Construction'], ['BEL', 'Capital Goods'], ['HAL', 'Capital Goods'], ['NTPC', 'Power'], ['INDIGO', 'Services'], ['TRENT', 'Consumer Services']];
    const secT = { 'Financial Services': 0.007, 'Information Technology': -0.011, Healthcare: 0.004, 'Metals & Mining': 0.015, 'Oil Gas & Consumable Fuels': 0.003 };
    const px = {}, hist = {}, dToday = {}, oi = {}, sector = {}, walls = {};
    L.forEach(([sym, ind], i) => {
      sector[sym] = ind; const base = 300 + r() * 3000, tr = (r() - 0.5) * 0.02 + (secT[ind] || 0) * 0.4, H = []; let c = base;
      for (let k = 0; k < 5; k++) { const p = c; c = p * (1 + tr + (r() - 0.5) * 0.012); H.push([c, p, p, Math.max(p, c) * 1.005, Math.min(p, c) * 0.995, 1e6 * (0.7 + r() * 0.6), 30 + r() * 25]); }
      const r1 = (secT[ind] || 0) + (r() - 0.5) * 0.03 + tr, cc = c * (1 + r1), hi = Math.max(c, cc) * (1 + r() * 0.006), lo = Math.min(c, cc) * (1 - r() * 0.006);
      px[sym] = { c: cc, pc: c, o: c, h: r1 > 0.01 ? cc * 1.001 : hi, l: r1 < -0.01 ? cc * 0.999 : lo, v: 1e6 * (0.8 + r() * 2) };
      hist[sym] = H; dToday[sym] = 30 + r() * 40 + (Math.abs(r1) > 0.015 ? 15 : 0);
      const o0 = 2e7 * (0.5 + r()), d = o0 * (r() - 0.35) * 0.18; oi[sym] = { oi: o0 + d, doi: d };
      walls[sym] = { ce: Math.round(cc * 1.05 / 10) * 10, pe: Math.round(cc * 0.95 / 10) * 10, pcr: 0.6 + r() * 0.8 };
    });
    const d = istYmd(), prov = force === 'prov';
    const I = { date: d, mode: prov ? 'prov' : 'final', px, hist, dToday, dNote: prov ? 'yesterday' : 'today', oi, oiNote: 'sample data', walls, sector, nifty: { c: 25620, pc: 25466, h: 25650, l: 25440 },
      newsCo: { BEL: { sc: 1.4, t: 'BEL bags orders worth ₹1,150 crore from the defence ministry' }, TRENT: { sc: -1.2, t: 'Analysts cut target price on Trent after a weak quarter' } }, newsSec: { IT: -1.2, 'Metals & Mining': 1.1 },
      world: { gift: { price: 25700, chg: 0.3 }, nasF: { chg: -0.9 }, dowF: { chg: -0.4 }, brent: { chg: -1.6, price: 61.4 }, wti: { chg: -1.5 }, usdinr: { chg: 0.1 } },
      fii: { fii: -1240, dii: 1875, date: nice(d) }, part: { latest: { date: d, p: { FII: { futL: 120000, futS: 210000 } } }, prev: { p: { FII: { futL: 112000, futS: 215000 } } } }, results: { LUPIN: nextWeekday(d) } };
    return { I, miss: [], ts: Date.now(), files: {}, live: false };
  }

  return { open, close, show, build, sort, analyze, score, parseFO, parseSec, parseN500, unzip, evaluate, stats, nextWeekday, get data() { return B; } };
})();
if (typeof module !== 'undefined') module.exports = Brief;
