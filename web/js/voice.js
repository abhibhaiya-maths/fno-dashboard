/* ===== वॉइस: बोलकर पूछो, बोलकर जवाब ===== */
const Voice = (() => {
  let recog = null, listening = false;
  const hint = (t) => ($('hint').textContent = t);
  function say(t) {
    if (!t || !('speechSynthesis' in window) || !$('tts') || !$('tts').checked) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t); u.lang = 'hi-IN';
    const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('hi'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return hint('इस ब्राउज़र में वॉइस सपोर्ट नहीं है। Chrome में खोलें या टाइप करें।');
    if (listening) return recog.stop();
    recog = new SR(); recog.lang = 'hi-IN'; recog.interimResults = true; recog.maxAlternatives = 1;
    recog.onstart = () => { listening = true; $('mic').classList.add('rec'); hint('सुन रहा हूँ… बोलिए'); };
    recog.onresult = (e) => { let t = ''; for (const r of e.results) t += r[0].transcript; $('q').value = t; if (e.results[e.results.length - 1].isFinal) ask(); };
    recog.onerror = (e) => hint(e.error === 'not-allowed' ? 'माइक की अनुमति नहीं मिली। ब्राउज़र में इजाज़त दें (साइट https पर होनी चाहिए)।' : 'आवाज़ समझ नहीं आई, फिर से कोशिश करें।');
    recog.onend = () => { listening = false; $('mic').classList.remove('rec'); };
    try { recog.start(); } catch { hint('माइक शुरू नहीं हो पाया, फिर से दबाएँ।'); }
  }
  function parseQ(raw) {
    const t = raw.replace(/[०-९]/g, (d) => '०१२३४५६७८९'.indexOf(d)).replace(/(\d)[,\s](?=\d{3}\b)/g, '$1').toLowerCase();
    let key = null;
    if (/bank\s*nifty|banknifty|बैंक\s*निफ़?्टी|बैंकनिफ्टी/.test(t)) key = 'BANKNIFTY';
    else if (/sensex|सेंसेक्स|सेनसेक्स/.test(t)) key = 'SENSEX';
    else if (/nifty|निफ़?्टी/.test(t)) key = 'NIFTY';
    let type = null;
    if (/\bput\b|पुट|\bpe\b/.test(t)) type = 'PE'; else if (/\bcall\b|कॉल|काल|\bce\b/.test(t)) type = 'CE';
    const m = t.match(/\d{4,6}/);
    const hold = /होल्ड|hold|exit|एग्जिट|एग्ज़िट|बेच|निकल/.test(t);
    return { key, type, K: m ? +m[0] : null, hold };
  }
  function show(h, s) { $('answer').innerHTML = h; $('answer').classList.add('show'); hint('माइक दबाकर अगला सवाल पूछो।'); say(s); }

  async function ask() {
    const raw = $('q').value.trim(); if (!raw) return hint('पहले कुछ पूछिए।');
    const q = parseQ(raw);
    if (q.key && q.key !== cur) { cur = q.key; renderAll(); }
    const a = A[cur]; if (!a) return hint('डेटा अभी लोड हो रहा है…');
    const cf = a.cf;
    // खुली पोज़िशन के बारे में सवाल: "होल्ड करूँ या एग्जिट?"
    const op = Paper.openTrades().filter((t) => t.key === cur && (!q.K || t.K === Math.round(q.K / cf.step) * cf.step));
    if (q.hold && op.length) {
      const t = op[0], adv = t.advice || { title: 'होल्ड करो', why: [] };
      return show(`<h3>${t.label} ${t.K} ${t.type} (आपकी पोज़िशन)</h3><div class="adv ${{ HOLD: 'b', WARN: 'w', BOOK: 'o', EXIT: 's' }[adv.state] || 'b'}"><b>${adv.title}</b><div>${adv.why.map(esc).join(' · ')}</div></div>
        <div class="row"><span>ख़रीद → अभी</span><b>${f2(t.entry)} → ${f2(t.ltp)}</b></div><div class="row"><span>SL</span><b class="down">${f2(t.sl)}</b></div>`,
        `${adv.title.replace(/^\S+\s/, '')}। ${adv.why.join('। ')}।`);
    }
    if (!q.type) return show(`<h3>${cf.label}</h3>कॉल लेना है या पुट, ये बताइए। जैसे: "${cf.voice} ${a.ch.atm} कॉल लूँ क्या?" या खुली पोज़िशन के लिए "होल्ड करूँ या एग्जिट?"`, 'कॉल लेना है या पुट, ये बताइए।');
    let K = q.K ? Math.round(q.K / cf.step) * cf.step : a.ch.atm, note = '';
    if (q.K && K !== q.K) note = `(${q.K} स्ट्राइक नहीं है, नज़दीकी ${K} लिया)`;
    if (Math.abs(K - a.price) / a.price > 0.08) return show(`<h3>${cf.label} ${K} ${q.type}</h3>ये स्ट्राइक मौजूदा भाव ${f0(a.price)} से बहुत दूर है।`, 'ये स्ट्राइक मौजूदा भाव से बहुत दूर है।');
    const o = optQuote(a, K, q.type), b = bs(a.price, K, a.ch.T, o.iv, q.type), dir = q.type === 'CE' ? 1 : -1, ds = q.type === 'CE' ? a.score : 100 - a.score;
    const pro = a.sigs.filter((x) => x.w > 0 && x.s * dir > 0).sort((x, y) => y.w - x.w), con = a.sigs.filter((x) => x.w > 0 && x.s * dir < 0).sort((x, y) => y.w - x.w);
    const t = setupFor(a, q.type), dl = Math.abs(o.delta || 0.5), pSL = tick05(Math.max(0.05, o.ltp - dl * t.risk)), pT = tick05(o.ltp + dl * t.risk * 1.5);
    const mny = q.type === 'CE' ? (K < a.price ? 'इन-द-मनी' : K > a.price ? 'आउट-ऑफ़-द-मनी' : 'एट-द-मनी') : K > a.price ? 'इन-द-मनी' : K < a.price ? 'आउट-ऑफ़-द-मनी' : 'एट-द-मनी';
    const vd = ds >= 65 ? ['up', 'ज़्यादातर संकेत आपकी दिशा के पक्ष में हैं'] : ds >= 55 ? ['up', 'संकेत हल्के से आपके पक्ष में हैं'] : ds >= 45 ? ['', 'संकेत मिले-जुले हैं, साफ़ दिशा नहीं'] : ['down', 'ज़्यादातर संकेत आपकी दिशा के ख़िलाफ़ हैं'];
    const al = alertsFor(a, q.type).filter((x) => x[0] !== 'i');
    const li = (arr) => arr.slice(0, 4).map((x) => `<li>${esc(x.n)}: ${esc(x.v)}</li>`).join('') || '<li>कोई नहीं</li>';
    const html = `<h3>${cf.label} ${K} ${q.type === 'CE' ? 'कॉल' : 'पुट'} <span class="mut" style="font-size:12px;font-weight:400">${note}</span></h3>
      <div class="row"><span>आपकी दिशा का स्कोर</span><b class="${vd[0]}">${ds}/100 · ${vd[1]}</b></div>
      <div class="row"><span>प्रीमियम · ${mny}</span><b>${rs(o.ltp)}</b></div>
      <div class="row"><span>डेल्टा · थीटा/दिन · IV</span><span>${f2(o.delta)} · ₹${f1(o.theta)} · ${f1(o.iv * 100)}%</span></div>
      <div class="row"><span>एक्सपायरी पर ITM होने की गणितीय संभावना</span><b>${Math.round(b.pitm * 100)}%</b></div>
      <div class="two" style="margin-top:8px"><div><b class="up">पक्ष में (${pro.length})</b><ul>${li(pro)}</ul></div><div><b class="down">ख़िलाफ़ (${con.length})</b><ul>${li(con)}</ul></div></div>
      <div class="lv"><div><small>इंडेक्स SL</small><b class="down">${f0(t.sl)}</b></div><div><small>प्रीमियम SL</small><b class="down">${rs(pSL)}</b></div><div><small>प्रीमियम टारगेट</small><b class="up">${rs(pT)}</b></div></div>
      ${al.map(([c, x]) => `<div class="alert ${c === 'd' ? 'd' : ''}">${x}</div>`).join('')}
      <div id="aiAns"></div>
      <button class="btn" style="margin-top:8px" onclick="Paper.openFromAsk(${K},'${q.type}')">इस पर पेपर ट्रेड लो</button>
      <div class="legend" style="margin-top:8px">ये संभावना है, गारंटी नहीं। फ़ैसला आपका।</div>`;
    const sayTxt = `${cf.voice} ${K} ${q.type === 'CE' ? 'कॉल' : 'पुट'}। आपकी दिशा का स्कोर ${ds} है, यानी ${vd[1]}। ${pro.length} संकेत पक्ष में और ${con.length} ख़िलाफ़ हैं। प्रीमियम लगभग ${Math.round(o.ltp)} रुपये है। स्टॉप-लॉस इंडेक्स पर ${Math.round(t.sl)}, या प्रीमियम पर लगभग ${Math.round(pSL)} रुपये। ${al.length ? al[0][1] : ''}`;
    const useAI = Source.mode === 'live' && Source.status && Source.status.ai;
    show(html, useAI ? '' : sayTxt);
    if (useAI) {
      $('aiAns').innerHTML = '<div class="alert i">🤖 AI विश्लेषण तैयार हो रहा है…</div>';
      try {
        const ctx = { index: cf.label, price: a.price, chgPct: a.chg, score: a.score, yourDirectionScore: ds, option: { strike: K, type: q.type, premium: o.ltp, iv: o.iv, delta: o.delta, thetaPerDay: o.theta, moneyness: mny, daysToExpiry: a.ch.dte },
          signalsFor: pro.map((x) => `${x.n}: ${x.v}`), signalsAgainst: con.map((x) => `${x.n}: ${x.v}`), nearestResistance: a.res, nearestSupport: a.sup, atr5m: a.atr,
          suggestedStopLoss: { index: t.sl, premium: pSL }, target: { premium: pT }, vix: a.vix, pcr: a.ch.pcr, maxPain: a.ch.mp, warnings: al.map((x) => x[1]) };
        const r = await Source.ask(raw, ctx);
        $('aiAns').innerHTML = `<div class="alert i"><b>🤖 AI विश्लेषण</b><br>${esc(r.answer)}</div>`;
        say(r.answer);
      } catch (e) { $('aiAns').innerHTML = ''; say(sayTxt); }
    }
  }
  return { say, toggleMic, ask };
})();
