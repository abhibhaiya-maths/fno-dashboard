/* ===== Trade report card: every tool on one screen, in plain words =====
   Opens from the live signal ("Full report card"). It only READS what the engine already worked out
   (signal, setup, Market Brain, structure, levels, OI flow, opening, gap, volatility, your paper record)
   and never changes a signal, a grade or a trade. Warnings are advice only: nothing is blocked.
   Screen text is English like the rest of the dashboard; the spoken summary is Hindi. */
const Report = (() => {
  let key = null, timer = null;
  const $c = (id) => document.getElementById(id);
  // soft limits for the advice lines: % of the money you put into the paper account (change in config.js → RISK)
  const RISK = () => ({ TRADE_PCT: 2, DAY_PCT: 5, MAX_TRADES: 6, ...((typeof APP_CONFIG !== 'undefined' && APP_CONFIG.RISK) || {}) });
  const ICON = { ok: '✓', warn: '!', bad: '✗', info: 'i' };
  const PTS = { ok: 1, warn: 0.5, bad: 0 };

  /* ---------- the checklist: each item is one question a careful trader asks ---------- */
  function checklist(a, s) {
    const d = s.state === 'CE' ? 1 : -1, nm = d > 0 ? (a.cf.opt ? 'CALL' : 'long') : a.cf.opt ? 'PUT' : 'short', L = [];
    const add = (id, w, st, q, txt, hi) => L.push({ id, w, st, q, txt, hi });
    // 1. trend tools
    const coreFor = d > 0 ? a.coreUp : a.coreDn, coreN = a.coreN || 5;
    add('core', 2, coreFor >= 4 ? 'ok' : coreFor >= 3 ? 'warn' : 'bad', 'Do the main trend tools agree?',
      `${coreFor} of ${coreN} trend tools (VWAP/TWAP, Supertrend, EMAs, swings, last 30 min) point ${d > 0 ? 'up' : 'down'}.`, 'ट्रेंड के मुख्य संकेत');
    // 2. overall score
    const ds = s.dirScore ?? (d > 0 ? a.score : 100 - a.score);
    add('score', 1.5, ds >= 65 ? 'ok' : ds >= 55 ? 'warn' : 'bad', 'How strong is the overall score?',
      `Score ${ds}/100 in your direction${ds >= 65 ? ': clear lean' : ds >= 55 ? ': a mild lean only' : ': barely leaning your way'}.`, 'कुल स्कोर');
    // 3. market context
    const br = a.brain;
    if (br && ok(br.score)) {
      const c = br.score * d;
      add('brain', 1.5, c >= 15 ? 'ok' : c <= -25 ? 'bad' : 'warn', 'Is the wider market with you?',
        `Market Brain ${sgn(br.score)}${br.score} (${br.lean})${c >= 15 ? ': world cues, heavyweights, news and flows back this trade' : c <= -25 ? ': the wider market leans the other way' : ': no strong help from the wider market'}.`, 'बाज़ार का माहौल');
    }
    // 4. daily trend
    const dd = a.long && a.long.dir;
    add('daily', 1.5, !dd ? 'warn' : dd === s.state ? 'ok' : 'bad', 'Is it with the bigger (daily) trend?',
      !dd ? 'The daily chart has no clear trend.' : dd === s.state ? `The daily trend is also ${d > 0 ? 'up' : 'down'}.` : `The daily trend is ${d > 0 ? 'down' : 'up'}. In your backtests, trades against it were right far less often.`, 'बड़ा ट्रेंड');
    // 5. 5-minute structure
    const X = a.stx;
    if (X) {
      const st = X.state === 'choch' && X.dir === -d ? 'bad' : X.trend === d ? 'ok' : X.trend === -d ? 'bad' : 'warn';
      add('stx', 1.5, st, 'What is the chart structure saying?', X.label + '.', 'चार्ट की बनावट');
    }
    // 6. room to move before the next wall
    const wall = d > 0 ? a.res : a.sup, lvA = a.lvw && (d > 0 ? a.lvw.above : a.lvw.below);
    if (wall && a.atr) {
      const room = Math.abs(wall[1] - a.price) / a.atr, hold = lvA && lvA.near && lvA.verdict === 'hold';
      add('room', 1.5, hold || room < 0.5 ? 'bad' : room < 1 ? 'warn' : 'ok', 'Is there room before the next wall?',
        `${wall[0]} at ${f0(wall[1])} is ${f0(Math.abs(wall[1] - a.price))} pts away (${f1(room)} × the normal 5-minute move).${hold ? ` It looks likely to ${d > 0 ? 'reject' : 'bounce'} price.` : room < 1 ? ' Close: the move may stall there.' : ''}`, 'आगे की रुकावट');
    }
    // 7. option writers
    if (a.cf.opt) {
      if (a.oif && a.oif.ready) {
        const b = a.oif.bias * d;
        add('oi', 1, b >= 0.3 ? 'ok' : b <= -0.3 ? 'bad' : 'warn', 'What are option sellers doing (last 15 min)?', a.oif.read + '.', 'ऑप्शन राइटर');
      } else if (ok(a.ch.pcr)) {
        const p = a.ch.pcr, b = d > 0 ? p > 1.1 : p < 0.9, c = d > 0 ? p < 0.8 : p > 1.25;
        add('oi', 0.75, b ? 'ok' : c ? 'bad' : 'warn', 'What does the option chain say?', `PCR ${f2(p)}: ${p > 1.2 ? 'heavy put selling (support below)' : p < 0.8 ? 'heavy call selling (pressure above)' : 'balanced'}.`, 'ऑप्शन चेन');
      }
    }
    // 8. time of day
    const SS = a.SS, left = SS.c - a.curMin;
    add('time', 1, left <= 30 ? 'bad' : a.curMin < SS.o + 15 || left <= 75 ? 'warn' : 'ok', 'Is this a good time of day?',
      left <= 30 ? `Only ${left} minutes left: little time for the move, fast time decay.` : a.curMin < SS.o + 15 ? 'Opening 15 minutes: fake moves are common.' : left <= 75 ? `Late session (${left} min left): less time for the move.` : `Mid-session, ${left} minutes left.`, 'समय');
    // 9. events and volatility
    const ev = a.events && a.events.length, ivp = a.vol && a.vol.ivp, vix = a.vix && a.vix.v;
    add('vol', 1, ev ? 'bad' : (ok(ivp) && ivp >= 80) || (ok(vix) && vix > 18) ? 'warn' : 'ok', 'Any event or costly premiums?',
      ev ? `Event risk: ${a.events[0].t}. Prices can jump either way.` : ok(ivp) && ivp >= 80 ? `Premiums are expensive (IV percentile ${ivp}). You need a quick, strong move.` : ok(vix) && vix > 18 ? `India VIX ${f1(vix)} is high: wide swings.` : 'No big event; premiums are normally priced.', 'इवेंट और वोलैटिलिटी');
    // 10. chasing
    if (ok(a.extATR) || (ok(a.e20) && a.atr)) {
      const ext = ok(a.extATR) ? a.extATR : ((a.price - a.e20) * d) / a.atr;
      add('chase', 1, ext > 3 ? 'bad' : ext > 2 ? 'warn' : 'ok', 'Am I chasing a move that already happened?',
        ext > 2 ? `Price is already ${f1(ext)}× the normal move away from its average. Late entries lose most often.` : 'No: price is still close to its average.', 'देर से एंट्री');
    }
    // 11. target vs charges, expiry
    if (s.setup && a.cf.opt && a.lot) {
      const gain = (s.setup.pT1 - s.setup.P) * a.lot, cost = 47.2 + s.setup.P * a.lot * 0.00236;
      add('cost', 1, gain >= 3 * cost ? 'ok' : gain >= 1.5 * cost ? 'warn' : 'bad', 'Is the target worth the charges?',
        `Target 1 is about ₹${f0(gain)} per lot against roughly ₹${f0(cost)} of charges.`, 'चार्ज');
      if (ok(a.ch.dte) && a.ch.dte <= 1) add('expiry', 0.75, 'warn', 'Is expiry close?', `Expiry in ${a.ch.dte < 1 ? 'less than a day' : '1 day'}: the premium melts fast if price stalls.`, 'एक्सपायरी');
    }
    // 12. today's news for this instrument (from the News Impact page; advice only)
    const NI = typeof Impact !== 'undefined' && Impact.forInstrument ? Impact.forInstrument(a) : null;
    if (NI && ok(NI.s)) {
      const c = NI.s * d;
      add('news', 1, c >= 0.12 ? 'ok' : c <= -0.25 ? 'bad' : 'warn', 'Is today\'s news with you?',
        `News leans ${NI.lean} for ${a.cf.label} (${NI.n} stor${NI.n === 1 ? 'y' : 'ies'})${NI.top ? `. Biggest: "${String(NI.top.t).slice(0, 90)}"` : ''}.`, 'आज की ख़बरें');
    }
    // 13. how this grade has really done for you
    if (s.grade && typeof Paper !== 'undefined' && Paper.gradeStats) {
      const g = Paper.gradeStats().find((x) => x.g === s.grade), n = g ? g.sig.dec : 0, pct = g ? g.sig.pct : null;
      add('record', 1, n < 20 ? 'info' : pct >= 55 ? 'ok' : pct >= 45 ? 'warn' : 'bad', `How has grade ${s.grade} really done?`,
        n < 20 ? `Only ${n} checked ${s.grade} signals so far: too few to trust either way.` : `${pct}% of ${n} past ${s.grade} signals were right after 30 minutes.`, 'ग्रेड का रिकॉर्ड');
    }
    return { items: L, nm, d };
  }
  function quality(items) {
    const sc = items.filter((x) => x.st !== 'info'), w = sc.reduce((t, x) => t + x.w, 0);
    return w ? Math.round((sc.reduce((t, x) => t + x.w * PTS[x.st], 0) / w) * 100) : null;
  }
  function verdictOf(q, items, s) {
    const hardBad = items.some((x) => x.st === 'bad' && ['stx', 'vol', 'time', 'daily'].includes(x.id));
    let v = q >= 75 ? 'good' : q >= 60 ? 'ok' : q >= 45 ? 'weak' : 'poor';
    if (hardBad && v === 'good') v = 'ok';
    if (s.grade === 'S' && (v === 'good' || v === 'ok')) v = 'weak';
    return {
      good: ['Good trade: the setup and the market agree', 'b', 'अच्छा ट्रेड: सेटअप और बाज़ार दोनों साथ हैं'],
      ok: ['Okay trade: take it with a small size', 'g', 'ठीक-ठाक ट्रेड: छोटे साइज़ में लें'],
      weak: [s.grade === 'S' ? 'Scalp: practise on paper or 1 lot only' : 'Weak trade: better to skip, or paper only', 'g', s.grade === 'S' ? 'स्कैल्प है: पेपर पर या एक लॉट' : 'कमज़ोर ट्रेड: छोड़ दें या सिर्फ़ पेपर पर'],
      poor: ['Poor trade: too much is against it, skip', 's', 'ख़राब ट्रेड: बहुत कुछ ख़िलाफ़ है, छोड़ दें'],
    }[v].concat(v);
  }

  /* ---------- money: what you pay, what you can lose, what you can make ---------- */
  function money(a, s) {
    if (!s.setup || !a.cf.opt || !a.lot) return null;
    const st = s.setup, q = optQuote(a, st.K, st.dir), slipPct = (APP_CONFIG.PAPER && APP_CONFIG.PAPER.SLIPPAGE_PCT) || 0.5;
    const px = q.ask > 0 ? q.ask : tick05(q.ltp * (1 + slipPct / 100) + 0.05);
    const lots = s.lots || (Paper.opts ? Paper.opts().lots : 1), qty = lots * a.lot;
    const slP = tick05(Math.max(0.05, px - (st.P - st.pSL))), tgP = tick05(px + (st.pT1 - st.P));
    const ch = (side, p) => (Paper.charges ? Paper.charges(side, p, qty, a.cf.exch).total : 0);
    const buyC = ch('BUY', px), loss = (px - slP) * qty + buyC + ch('SELL', slP), gain = (tgP - px) * qty - buyC - ch('SELL', tgP);
    const theta = ok(q.theta) ? Math.abs(q.theta) * qty : null;
    const acc = Paper.account, put = acc ? acc.start + (acc.deposits || 0) - (acc.withdrawals || 0) : APP_CONFIG.PAPER.START_CAPITAL;
    return { K: st.K, dir: st.dir, px, lots, qty, cost: px * qty + buyC, slP, tgP, loss, gain, rr: loss > 0 ? gain / loss : null, theta, put, cash: acc ? acc.cash : null, idxSL: st.sl, idxT1: st.t1, idxT2: st.t2 };
  }

  /* ---------- advice from a senior trader sitting next to you (never blocks anything) ---------- */
  function advice(a, s, M) {
    const out = [], R = RISK(), D = Paper.dayInfo ? Paper.dayInfo() : null;
    if (M) {
      const lim = (M.put * R.TRADE_PCT) / 100;
      const fit = Math.floor((lim / M.loss) * M.lots);
      if (M.loss > lim) out.push(['w', `If the stop-loss hits you lose about ₹${f0(M.loss)}, more than ${R.TRADE_PCT}% of your money (₹${f0(lim)}). ${fit >= 1 && fit < M.lots ? `${fit} lot${fit > 1 ? 's' : ''} would keep it inside the line.` : M.lots === 1 ? 'Even 1 lot is past the line: the stop is far for this strike.' : 'Even 1 lot is past the line.'}`, `स्टॉप-लॉस लगा तो लगभग ${Math.round(M.loss)} रुपये जाएँगे, ये आपकी सीमा से ज़्यादा है।`]);
      if (ok(M.cash) && M.cost > M.cash) out.push(['d', `This trade needs ${rs(M.cost)} but you have ${rs(M.cash)} free.`, 'इतना पैसा खाते में नहीं है।']);
      if (ok(M.rr) && M.rr < 1) out.push(['w', `You risk about ₹${f0(M.loss)} to make ₹${f0(M.gain)} at target 1: the loss would be bigger than the win.`, 'यहाँ नुक़सान, फ़ायदे से बड़ा है।']);
      const g = s.grade ? GRADE_INFO[s.grade] : null, full = Paper.opts ? Paper.opts().lots : 1;
      if (g && g.mul < 1 && M.lots > Math.max(1, Math.round(full * g.mul))) out.push(['w', `${g.name} is meant for ${g.size.toLowerCase()}. You are using ${M.lots} lots.`, 'इस ग्रेड के लिए साइज़ ज़्यादा है।']);
    }
    if (D) {
      const dayLim = (D.put * R.DAY_PCT) / 100;
      if (D.net < 0 && -D.net >= dayLim) out.push(['d', `Today you are already down ₹${f0(-D.net)}, past your ${R.DAY_PCT}% day line (₹${f0(dayLim)}). Many big losses start with "one more trade to win it back".`, `आज ${Math.round(-D.net)} रुपये का नुक़सान हो चुका है। नुक़सान वापस लाने के लिए ट्रेड न करें।`]);
      else if (D.net < 0 && -D.net >= dayLim * 0.6) out.push(['w', `Today you are down ₹${f0(-D.net)}, close to your ${R.DAY_PCT}% day line (₹${f0(dayLim)}).`, 'आज का नुक़सान सीमा के पास है।']);
      if (D.lossRun >= 2) out.push(['w', `Your last ${D.lossRun} trades today were losses. A short break before the next one often helps.`, `लगातार ${D.lossRun} ट्रेड में नुक़सान हुआ है, थोड़ा रुकें।`]);
      if (D.lastLossMin != null && D.lastLossMin < 10) out.push(['w', `Your last loss was ${D.lastLossMin < 1 ? 'just now' : D.lastLossMin + ' min ago'}. Is this trade from the plan, or to win that back?`, 'पिछला नुक़सान अभी-अभी हुआ है। ये ट्रेड प्लान से है या ग़ुस्से में?']);
      if (D.count >= R.MAX_TRADES) out.push(['w', `${D.count} trades today already. More trades mostly add charges, not profit.`, 'आज बहुत ट्रेड हो चुके हैं।']);
      const same = D.open.filter((t) => t.key === a.key);
      if (same.length) out.push(['i', `You already hold ${same.length} position${same.length > 1 ? 's' : ''} on ${a.cf.label} (${same.map((t) => `${t.K} ${t.type}`).join(', ')}). A new one adds to the same bet.`, 'इसी पर पहले से पोज़िशन है।']);
    }
    return out;
  }

  /* ---------- when are we wrong: decide it before entering ---------- */
  function wrongIf(a, s, M) {
    const d = s.state === 'CE' ? 1 : -1, out = [], X = a.stx;
    if (M) out.push(`The index ${d > 0 ? 'falls to' : 'rises to'} ${f0(M.idxSL)} (your stop-loss). Premium stop about ${rs(M.slP)}.`);
    else if (s.setup) out.push(`Price ${d > 0 ? 'falls to' : 'rises to'} ${f0(s.setup.sl)} (the stop-loss).`);
    if (X && ok(X.prot) && X.trend === d) out.push(`A 5-minute candle closes ${d > 0 ? 'below' : 'above'} ${f0(X.prot)}: the ${d > 0 ? 'uptrend' : 'downtrend'} changes character.`);
    if (ok(a.vw)) out.push(`Price closes a 5-minute candle on the ${d > 0 ? 'lower' : 'upper'} side of ${a.hasVol ? 'VWAP' : 'TWAP'} (${f0(a.vw)}).`);
    if (s.src === 'star') out.push('20 minutes pass and the trade has not moved: time decay starts to win.');
    if (s.src === 'scalp') out.push('15 minutes pass without a real move, or the 1-minute chart turns against you.');
    const lvA = a.lvw && (d > 0 ? a.lvw.above : a.lvw.below);
    if (lvA && lvA.near) out.push(`At ${f0(lvA.v)} (${lvA.name}): ${lvA.confirmHold.charAt(0).toLowerCase() + lvA.confirmHold.slice(1)} means the level is holding against you.`);
    return out;
  }

  /* ---------- the wider picture (folded away) ---------- */
  function picture(a) {
    const P = [], row = (n, v) => `<div class="row"><span>${n}</span><span class="rc-v">${v}</span></div>`;
    const br = a.brain;
    if (br) {
      if (br.day) P.push(['Kind of day', row(esc(br.day.name), esc(br.day.tip))]);
      if (br.rows && br.rows.length) P.push(['Market Brain: what moves the market today', br.rows.map((r) => row(`${esc(r.label)} <b class="${r.s > 0.1 ? 'up' : r.s < -0.1 ? 'down' : ''}">${esc(String(r.val))}</b>`, esc(r.txt))).join('')]);
    }
    if (a.stx) P.push(['Chart structure (5-minute)', `<p class="rc-p">${esc(a.stx.label)}. ${esc(a.stx.detail)}</p>${a.stx.sweepTxt ? `<p class="rc-p">${esc(a.stx.sweepTxt)}</p>` : ''}`]);
    if (a.lvw) {
      const lv = (L) => L ? `<div class="rc-lv"><b>${L.kind} ${f0(L.v)}</b> <span class="mut">${esc(L.name)}, ${f0(L.dist)} pts away</span> · <span class="${L.verdict === 'break' ? 'up' : L.verdict === 'hold' ? 'down' : ''}">${L.vTxt}</span>
        <ul>${[...L.hold.map((x) => `<li>Hold: ${esc(x[1])}</li>`), ...L.brk.map((x) => `<li>Break: ${esc(x[1])}</li>`)].join('')}</ul></div>` : '';
      const h = lv(a.lvw.above) + lv(a.lvw.below);
      if (h) P.push(['Nearest levels: hold or break?', h]);
    }
    if (a.oif && a.oif.ready) P.push(['Option sellers, last 15 minutes', `<p class="rc-p">${esc(a.oif.read)}.</p>${a.oif.notes.map((x) => `<p class="rc-p">${esc(x[2])}</p>`).join('')}`]);
    else if (a.cf.opt && a.ch.rows.length) P.push(['Option chain', row('PCR / max pain', `${f2(a.ch.pcr)} / ${f0(a.ch.mp)}`) + row('Call wall / put wall', `${f0(a.ch.maxCE)} / ${f0(a.ch.maxPE)}`) + row('Expected range to expiry', ok(a.ch.straddle) ? `${f0(a.price - a.ch.straddle)} – ${f0(a.price + a.ch.straddle)}` : '–')]);
    if (a.open) P.push(['How the day opened', `<p class="rc-p"><b>${esc(a.open.name)}.</b> ${esc(a.open.note)}</p>${a.open.trap ? `<p class="rc-p down">${esc(a.open.trap)}</p>` : ''}`]);
    if (a.gap && a.gap.today && a.gap.today.side !== 'flat') {
      const T = a.gap.today, b = T.base;
      P.push(['Today\'s gap', `<p class="rc-p">Gap ${T.side === 'up' ? 'up' : 'down'} ${f0(Math.abs(T.pts))} pts (${sgn(T.pct)}${f2(T.pct)}%), ${T.filled ? 'already filled' : `${Math.round((T.fillPct || 0) * 100)}% filled`}.${b && b.n ? ` Over the past year, similar gaps closed in the gap's direction ${Math.round((b.same / b.n) * 100)}% of the time and got filled ${Math.round((b.fill / b.n) * 100)}% of the time (${b.n} days).` : ''}</p>${a.gap.driver && a.gap.driver.verdict ? `<p class="rc-p">${esc(a.gap.driver.verdict)}.</p>` : ''}`]);
    }
    const vb = [];
    if (a.vix && ok(a.vix.v)) vb.push(row('India VIX', `${f2(a.vix.v)}${ok(a.vix.prev) ? ` (${a.vix.v < a.vix.prev ? 'falling' : 'rising'})` : ''}`));
    if (a.vol && ok(a.vol.ivp)) vb.push(row('IV percentile (1 year)', `${a.vol.ivp}${a.vol.ivp >= 80 ? ': expensive' : a.vol.ivp <= 20 ? ': cheap' : ''}`));
    if (a.events && a.events.length) vb.push(...a.events.slice(0, 3).map((e) => row('Event', `${esc(e.t)} (${e.time} IST)`)));
    if (vb.length) P.push(['Volatility and events', vb.join('')]);
    const N = a.news && a.news.slice(0, 4);
    if (N && N.length) P.push(['Latest news', N.map((n) => `<p class="rc-p"><i class="rc-dot ${n.s > 0.15 ? 'b' : n.s < -0.15 ? 's' : 'n'}"></i>${esc(n.t)} <span class="mut">${esc(n.ago || '')}</span></p>`).join('')]);
    return P;
  }

  /* ---------- your record by grade (honest, every time) ---------- */
  function record(s) {
    if (!Paper.gradeStats) return '';
    const G = Paper.gradeStats();
    return `<div class="tbl"><table><thead><tr><th class="l">Grade</th><th>Paper trades</th><th>Won</th><th>Net</th><th>Signals right (30 min)</th></tr></thead><tbody>${G.map((r) => `<tr class="${r.g === s.grade ? 'rc-me' : ''}"><td class="l"><span class="gb g-${r.g === '★' ? 'P' : r.g}">${r.g}</span> ${GRADE_INFO[r.g].name}</td><td>${r.n}</td><td>${r.win == null ? '–' : r.win + '%'}</td><td class="${r.net >= 0 ? 'up' : 'down'}">${r.n ? sgn(r.net) + rs(r.net) : '–'}</td><td>${r.sig.pct == null ? '–' : r.sig.pct + '%'} <small class="mut">(${r.sig.dec})</small></td></tr>`).join('')}</tbody></table></div>
      <div class="legend">No grade is a guarantee, ★ included: in the 1-year backtest ★ made about ₹105–140 back for every ₹100 lost, and still lost on many days. Trust a grade only after 20+ of your own results.</div>`;
  }

  /* ---------- build the page ---------- */
  function build() {
    if ($c('rc')) return;
    const el = document.createElement('div'); el.id = 'rc'; el.className = 'rp rc'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Trade report card');
    el.innerHTML = '<div class="rc-wrap"><div class="rp-top rc-top"><h2 id="rcTitle">Report card</h2><span class="mut" id="rcSub"></span><button class="x" onclick="Report.close()" aria-label="Close">✕</button></div><div id="rcBody"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
  }
  function open(k) {
    key = k || (typeof cur !== 'undefined' ? cur : 'NIFTY');
    if (!A[key]) return toast('Data is still loading…');
    build(); $c('rc').classList.add('on'); document.body.style.overflow = 'hidden';
    render(); clearInterval(timer); timer = setInterval(render, 5000);
  }
  function close() { clearInterval(timer); timer = null; const el = $c('rc'); if (el) el.classList.remove('on'); document.body.style.overflow = ''; }

  let last = null;
  function render() {
    const a = A[key], body = $c('rcBody'); if (!a || !body) return;
    const openSec = new Set([...body.querySelectorAll('details[open]')].map((x) => x.dataset.k));
    const s = signalFor(a), live = a.sessionLive;
    $c('rcTitle').textContent = `${a.cf.label} report card`;
    $c('rcSub').textContent = `${Source.clock().label} · price ${f1(a.price)} (${sgn(a.chg)}${f2(a.chg)}%) · updates every 5 s`;
    let h = '';
    if (s.state !== 'CE' && s.state !== 'PE') {
      // no trade: say why, and what to wait for
      const t = a.trendDir || (a.score >= 55 ? 'CE' : a.score <= 45 ? 'PE' : null), Lw = a.lvw || {};
      const wait = [];
      if (Lw.above) wait.push(`Up: ${Lw.above.confirmBreak}.`);
      if (Lw.below) wait.push(`Down: ${Lw.below.confirmBreak}.`);
      h += `<div class="rc-verdict n"><div class="rc-vk">Verdict</div><div class="rc-vt">No trade right now</div><div class="rc-vs">${esc(s.title)}. ${esc(s.sub || '')}</div></div>
        ${t ? `<div class="alert i">The market leans ${t === 'CE' ? 'up' : 'down'} (score ${a.score}), but not enough tools agree yet to call it a setup. Waiting is a position too.</div>` : ''}
        ${wait.length ? `<div class="sec">What would start a trade</div>${wait.map((x) => `<div class="rc-li">${esc(x)}</div>`).join('')}` : ''}`;
      last = { say: `${a.cf.voice}: अभी कोई ट्रेड नहीं। ${t ? `झुकाव ${t === 'CE' ? 'ऊपर' : 'नीचे'} का है, पर संकेत पूरे नहीं।` : 'संकेत मिले-जुले हैं।'} इंतज़ार करें।` };
    } else {
      const C = checklist(a, s), q = quality(C.items), V = verdictOf(q, C.items, s), M = money(a, s), adv = advice(a, s, M), W = wrongIf(a, s, M);
      const okN = C.items.filter((x) => x.st === 'ok').length, badN = C.items.filter((x) => x.st === 'bad').length;
      const worst = C.items.filter((x) => x.st === 'bad').sort((x, y) => y.w - x.w)[0] || C.items.filter((x) => x.st === 'warn').sort((x, y) => y.w - x.w)[0];
      h += `<div class="rc-verdict ${V[1]}"><div class="rc-vk">${s.grade ? `<span class="gb g-${s.grade === '★' ? 'P' : s.grade}">${s.grade}</span> ` : ''}${esc(s.title)}${M ? ` · ${M.K} ${M.dir}` : ''}</div>
        <div class="rc-vrow"><div class="rc-q"><b>${q ?? '–'}</b><small>/ 100</small></div><div><div class="rc-vt">${V[0]}</div><div class="rc-vs">${okN} checks in favour, ${badN} against${worst ? `. Biggest worry: ${esc(worst.q.replace(/\?$/, '').toLowerCase())}` : ''}.</div></div></div>
        <button class="btn-ghost rc-say" onclick="Report.say()">🔊 सुनें (Hindi)</button></div>`;
      // the checklist
      h += `<div class="sec">The full check (${C.items.length} questions)</div><div class="rc-list">${C.items.map((x) => `<div class="rc-item ${x.st}"><span class="rc-ic">${ICON[x.st]}</span><div><b>${esc(x.q)}</b><span>${esc(x.txt)}</span></div></div>`).join('')}</div>`;
      // money
      if (M) h += `<div class="sec">Money on this trade (${M.lots} lot × ${a.lot} = ${M.qty})</div>
        <div class="lv rc-m"><div><small>You pay</small><b>${rs(M.cost)}</b><small>${M.K} ${M.dir} at ${rs(M.px)}</small></div><div><small>If stop-loss hits</small><b class="down">−₹${f0(M.loss)}</b><small>premium ${rs(M.slP)} · index ${f0(M.idxSL)}</small></div><div><small>If target 1 hits</small><b class="up">+₹${f0(M.gain)}</b><small>premium ${rs(M.tgP)} · index ${f0(M.idxT1)}</small></div></div>
        <div class="row"><span>Win : loss size</span><b>${ok(M.rr) ? `1 : ${f2(M.rr)}` : '–'}</b></div>${ok(M.theta) ? `<div class="row"><span>Time decay if price stands still</span><b class="down">about ₹${f0(M.theta)} a day</b></div>` : ''}<div class="legend">After brokerage, STT, exchange charges, stamp duty and GST. A stop-loss can fill worse in a fast market.</div>`;
      else if (s.setup) h += `<div class="sec">Levels</div><div class="lv"><div><small>Entry</small><b>${f1(s.setup.e)}</b></div><div><small>Stop-loss</small><b class="down">${f1(s.setup.sl)}</b></div><div><small>Target 1 / 2</small><b class="up">${f1(s.setup.t1)} / ${f1(s.setup.t2)}</b></div></div>`;
      // we are wrong if
      if (W.length) h += `<div class="sec">We are wrong if… (decide now, not after entering)</div>${W.map((x) => `<div class="rc-li">${esc(x)}</div>`).join('')}`;
      // advice
      h += `<div class="sec">Senior trader's advice</div>${adv.length ? adv.map(([c, t]) => `<div class="alert ${c === 'd' ? 'd' : c === 'i' ? 'i' : ''}">${esc(t)}</div>`).join('') : '<div class="alert i">Nothing worrying about your size, your day or your recent trades.</div>'}<div class="legend">Advice only. Nothing here blocks a trade.</div>`;
      h += `<div class="rc-act">${M && live ? `<button class="big ${s.state === 'CE' ? 'b' : 's'}" onclick="Report.take()">Take paper trade: ${M.lots} lot, ${rs(M.cost)}</button>` : ''}${Source.mode === 'live' && Source.status && Source.status.ai ? '<button class="btn-ghost" onclick="Report.ai()">Ask AI for a second opinion</button>' : ''}</div><div id="rcAI"></div>`;
      last = { say: `${a.cf.voice} ${M ? M.K + ' ' + (s.state === 'CE' ? 'कॉल' : 'पुट') : ''}। रिपोर्ट कार्ड ${q} में से 100। ${V[2]}। ${okN} बातें पक्ष में, ${badN} ख़िलाफ़।${worst ? ` सबसे बड़ी चिंता: ${worst.hi}।` : ''}${M ? ` स्टॉप-लॉस लगा तो लगभग ${Math.round(M.loss)} रुपये का नुक़सान, टारगेट पर लगभग ${Math.round(M.gain)} रुपये का फ़ायदा।` : ''}${adv.length ? ` सलाह: ${adv[0][2]}` : ''} ये गारंटी नहीं, अंदाज़ा है।` };
    }
    // the wider picture and the grade record, folded
    picture(a).forEach(([t, inner], i) => { h += `<details class="rc-d" data-k="p${i}" ${openSec.has('p' + i) ? 'open' : ''}><summary>${esc(t)}</summary><div>${inner}</div></details>`; });
    h += `<details class="rc-d" data-k="rec" ${openSec.has('rec') || s.grade ? 'open' : ''}><summary>Your real record by grade</summary><div>${record(s)}</div></details>`;
    h += '<div class="legend rc-foot">This report reads the same engine as the dashboard. It is a careful second look, not a guarantee. The decision and the risk are yours.</div>';
    const ai = $c('rcAI') ? $c('rcAI').innerHTML : '';
    body.innerHTML = h;
    if (ai && $c('rcAI')) $c('rcAI').innerHTML = ai;
  }
  function say() { if (last && last.say) Voice.say(last.say); }
  function take() { const a = A[key], s = a && signalFor(a); if (!s || !s.setup) return; close(); if (key === cur) Paper.takeSignal(); else Paper.takeBest(key); }
  async function ai() {
    const a = A[key], box = $c('rcAI'); if (!a || !box) return;
    box.innerHTML = '<div class="alert i">AI is reading the report…</div>';
    try {
      const s = signalFor(a), q = `Give a careful second opinion on this trade: ${a.cf.label} ${s.setup ? s.setup.K + ' ' + s.state : s.state}. In simple words: the 3 strongest reasons for it, the 3 biggest risks, and whether you would take it now, wait, or skip. Keep it short.`;
      const r = await Source.ask(q, Voice.ctx(a), []);
      box.innerHTML = `<div class="alert i"><b>AI second opinion</b><br>${esc(r.answer).replace(/\n/g, '<br>')}</div>`;
      if (r.speak) Voice.say(r.speak);
    } catch (e) { box.innerHTML = `<div class="alert">AI couldn't answer: ${esc(String(e.message).slice(0, 200))}</div>`; }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $c('rc') && $c('rc').classList.contains('on')) close(); });
  return { open, close, say, take, ai, checklist, quality };
})();
