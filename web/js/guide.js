/* ===== Guide: every page and every number in simple Hindi, plus a one-line "आसान मतलब" on top of each page =====
   Read-only help. It adds a short strip under each page's title bar and a Guide page; it changes nothing else. */
const Guide = (() => {
  const $g = (id) => document.getElementById(id);
  // one line per page / tab, shown on top of that page
  const TIP = {
    home: 'यह मुख्य screen है: हर instrument के लिए engine बताता है CALL लें, PUT लें या रुकें (WAIT)। ★ सबसे अच्छा setup है, A छोटा size, B और Scalp सिर्फ़ 1 lot या paper। हर signal पर "Report card" खोलकर पूरी जाँच देखें।',
    'rc': 'Report card इस एक trade की पूरी जाँच है: कितनी बातें साथ हैं, कितनी खिलाफ़, पुराने दिनों में ऐसे plan का क्या हुआ (Time Machine), और कितने पैसे दांव पर हैं।',
    'mk:map': 'Market Map: आज index को किन शेयरों ने ऊपर या नीचे खींचा। बड़ा डिब्बा = index में ज़्यादा वज़न, हरा = बढ़ा, लाल = गिरा।',
    'mk:scr': 'Screener: सभी F&O शेयरों में से तैयार filters (dip, breakout, momentum, red flags, ORB…)। ये research की lists हैं, buy/sell signal नहीं। बाईं ओर से screen चुनें।',
    rp: 'Replay: पुराने दिन दोबारा चलाकर अभ्यास करें और देखें engine उन दिनों में कैसा चलता। Time Machine के लिए एक बार "Download From Upstox" दबाकर history ले लें।',
    'ov:edge': 'Overnight Edge: आज जैसे दिनों के बाद अगली सुबह भाव ऊपर खुला या नीचे — पुराने record की गिनती। "No edge" का मतलब है रात भर रखने में कोई साफ़ फ़ायदा नहीं दिखा।',
    'ov:rev': 'Reversal Radar: बहुत गिरे या बहुत चढ़े शेयर, जिनमें पलटने के पुराने संकेत दिखे। जोखिम ज़्यादा है, chart पर पुष्टि ज़रूरी।',
    'ov:book': 'BTST Paper: आज खरीदकर कल बेचने के paper सौदे और उनका पूरा record (खर्चा जोड़कर)। असली पैसा नहीं लगता।',
    'im:news': 'News Impact: आज की खबरें किन sectors और कंपनियों के लिए अच्छी हैं (▲) या बुरी (▼)। यह बताता है भाव क्यों हिल रहा है; CALL/PUT signal इसे नहीं पढ़ता।',
    'im:results': 'Results Radar: जिन कंपनियों के नतीजे आए — अच्छे नतीजे पर गिरा शेयर (bounce की संभावना) या खराब नतीजे पर ऊँचा शेयर (गिरने का खतरा)।',
    'jr:lessons': 'Journal: आपके अपने trades से सीख — किस समय, किस grade, किस हालात में आप जीतते हैं और कहाँ हारते हैं। "Warn me here" से वहाँ चेतावनी लगवा सकते हैं।',
    'jr:table': 'Full Breakdown: हर हालात (समय, VIX, grade, दिन…) में आपकी जीत-हार की पूरी गिनती।',
    'jr:trades': 'My Trades & Tags: हर trade पर tag लगाएँ (जैसे "जल्दबाज़ी", "plan के हिसाब से") ताकि Journal सीख सके।',
    al: 'Alerts: अपने भाव पर alert लगाएँ, और Shock detector अचानक बड़ी चाल पर तुरंत आवाज़ और लाल पट्टी से बताता है। Dashboard खुला रहना चाहिए।',
    'bf:lists': 'Next-Day Brief: कल के लिए मज़बूत 5 और कमज़ोर 5 F&O शेयर, हर एक के कारण के साथ। 3 बजे के बाद provisional, शाम 7 बजे के बाद final। यह research है, guarantee नहीं।',
    'bf:sectors': 'Sectors: हर sector (financial, IT, pharma, auto…) आज, 2 दिन और 5 दिन में कितना चला, और futures में खरीदारी या बिकवाली का झुकाव।',
    'bf:all': 'All F&O Stocks: हर शेयर के points और कारण। column के नाम पर tap करके sort करें।',
    gd: 'यह Guide है: हर page और हर शब्द का आसान मतलब।',
  };
  const SECTIONS = [
    ['start', 'शुरुआत: रोज़ कैसे इस्तेमाल करें', `<ol>
      <li><b>सुबह 9:00–9:15:</b> ऊपर की पट्टी में GIFT Nifty और world cues देखें। रात का <b>Brief</b> खोलकर कल की lists देखें।</li>
      <li><b>9:15–9:30:</b> पहले 15 मिनट जल्दबाज़ी न करें। 9:30 के बाद Screener → <b>Intraday Breakouts (ORB)</b> देखें।</li>
      <li><b>Market में:</b> मुख्य screen पर CALL/PUT signal आए तो <b>Report card</b> खोलें: checklist, Time Machine और पैसे का हिसाब देखकर ही फ़ैसला करें।</li>
      <li><b>3:00–3:15 pm:</b> <b>Brief</b> का provisional version देखें; BTST सोच रहे हों तो <b>Overnight</b> भी देखें।</li>
      <li><b>शाम 7 बजे के बाद:</b> final Brief देखें; <b>Journal</b> में आज के trades पर tag लगाएँ।</li></ol>
      <p>याद रखें: कोई भी signal या list guarantee नहीं है। ★ भी सिर्फ़ "पुराने record में सबसे अच्छा" है, पक्का नहीं। Stop-loss हमेशा रखें।</p>`],
    ['it', 'Overview (पूरा बाज़ार एक page पर)', `<p>ऊपर पहला बटन <b>Overview</b>। इसमें: बाज़ार का मूड (risk-on / risk-off की सुई), दुनिया के बाज़ार, Nifty/Bank Nifty/Sensex/VIX, FII/DII, sector heatmap, कल के मज़बूत-कमज़ोर शेयर, असामान्य volume और OI, ज़रूरी खबरें, आने वाले results, market regime, prediction audit, बचने वाले शेयर और data कितना ताज़ा है।</p>
      <p><b>लेबल:</b> ACTUAL = NSE/exchange ने बताया; LIVE = broker का अभी का भाव; EOD FILE = NSE की शाम की file; ESTIMATE = भाव और volume से निकाला अंदाज़ा (जैसे money flow); MODEL = हमारे नियमों का score; N/A = data नहीं। जो data नहीं है वहाँ "–" दिखता है, कुछ भी गढ़ा नहीं जाता।</p>
      <p><b>Strength & Money Flow:</b> Nifty से आगे/पीछे वाले शेयर और sector-वार पैसे का अंदाज़ा; "↑ rising" = sector की रैंक सुधर रही है। <b>Sector Rotation:</b> Leading / Improving / Weakening / Lagging और 0–100 score (weights आप बदल सकते हैं)। <b>Regime & Calm Zone:</b> बाज़ार का मौसम, पिछले ~60 दिन की रंगीन पट्टी, किस मौसम में कौन सा तरीका, और शांत/तूफ़ानी शेयर। <b>IV, Basis & Avoid:</b> options कितने महँगे, futures premium/discount, daily RSI, और F&O ban / कल results / कम trading वाले शेयर। <b>Data & Usage:</b> Upstox और AI की limit कितनी भरी है।</p>`],
    ['tools', 'नए छोटे औज़ार', `<p><b>Ctrl+K या / दबाएँ</b> (या ऊपर 🔎): कुछ भी टाइप करें — "brief", "orb", "INFY" — और सीधे वहाँ पहुँचें।</p>
      <p><b>Chart पर "Options range":</b> chart के chips में इसे चालू करें — options आज के लिए जितनी चाल price कर रहे हैं (कल के close ± ATM IV), उसकी दो बैंगनी लकीरें। लगभग 3 में से 2 दिन भाव इसके अंदर रहता है।</p>
      <p><b>Option chain की तस्वीर:</b> chain tab में ऊपर हर strike पर call OI (लाल) और put OI (हरा), आज जोड़ा/घटाया, भाव और max pain की लकीर।</p>
      <p><b>Radar (Screener → Intraday Radar & ORB):</b> असामान्य तेज़ चाल (इस समय के हिसाब से), volume spike, futures OI का उछाल, दिन का high/low।</p>
      <p><b>Brief का Track Record:</b> अब हर list Firestore में हमेशा के लिए save (कभी बदली नहीं जाती), अगले दिन की सबसे अच्छी/बुरी चाल (MFE/MAE), और दो सीधे नियमों से तुलना — ताकि पता चले पूरा model कुछ फ़ायदा देता है या नहीं।</p>
      <p class="mut">यह dashboard research और पढ़ाई के लिए है, निवेश सलाह नहीं; यह SEBI-registered adviser या research analyst नहीं है। फ़ैसला और जोखिम आपका।</p>`],
    ['setup', 'Chart: Manual tools या Auto setup', `<p>Chart के ऊपर दो बटन हैं। <b>🛠 Manual tools</b> = पहले जैसा, आप खुद chips दबाकर tools चालू/बंद करें। <b>🎯 Auto setup</b> = chart खुद एक professional trader की तरह setup बनाता है, आप बस देखें।</p>
      <p><b>Auto setup क्या करता है:</b> (1) आज के दिन के हिसाब से tools चुनता है — trend day पर VWAP, EMA 20, Supertrend, Opening range (जो चाल के साथ चलते हैं); range day पर CPR, Volume profile (जो किनारे बताते हैं)। (2) <b>Zones</b>: जहाँ 2 या ज़्यादा tools एक ही भाव पर मिलते हैं (call/put wall, VAH/VAL/POC, कल का high/low, pivot, CPR, swing) — लाल पट्टी = रुकावट (R), हरी = support (S); ब्रैकेट में कितने tools मिले। (3) <b>Liquidity</b>: पीली बिंदीदार लकीर = जहाँ आम तौर पर stop-loss जमा होते हैं (अंदाज़ा)। (4) <b>Candles पर निशान</b>: ▲▼ = VWAP पार या Supertrend पलटा; <b>BOS</b> = पिछले घंटे का high/low तोड़कर बंद हुआ (trend जारी); <b>Sweep</b> = high/low के पार गया पर वापस अंदर बंद हुआ (stops लेकर पलटा)।</p>
      <p><b>Chart के नीचे:</b> Engine अभी CALL/PUT/WAIT क्यों कह रहा है — हर tool की हरी/लाल बत्ती और हिंदी में मतलब; पीले किनारे वाले tools खिलाफ़ हैं (वही जोखिम)। ऊपर-नीचे के zones, volume profile का मतलब, और <b>"Which tool worked"</b>: हर tool ने जब दिशा बताई, 30 मिनट बाद भाव सच में उधर गया या नहीं — आज, आज के नए signals, और पिछले कुछ sessions।</p>
      <p class="mut">Auto setup सिर्फ़ दिखाता और समझाता है; CALL/PUT signal वही रहता है। कोई नई data call नहीं लगती।</p>`],
    ['wr', 'Option writers और 3-scenario plan', `<p><b>Option chain tab</b> में ऊपर "Writers' read": हर strike पर OI बदलाव + premium बदलाव। <b>OI ↑ + premium ↓ = writing</b> (call writing = ऊपर रुकावट, put writing = नीचे support); <b>OI ↑ + premium ↑ = buying</b> (call buying = तेज़ी के दांव, put buying = मंदी के दांव); <b>OI ↓ = unwinding</b> (वह स्तर कमज़ोर हो रहा है)। <b>ITM writing</b> सबसे मज़बूत संकेत है। ATM पर भारी OI "साफ़ नहीं" माना जाता है।</p>
      <p><b>OI-change PCR</b> = जोड़े गए put OI ÷ जोड़े गए call OI (±8 strikes): 0.7 से नीचे bearish, 1.3 से ऊपर bullish। <b>Walls</b> = जहाँ आज सबसे ज़्यादा OI जुड़ा। <b>Squeeze</b>: भाव सबसे बड़ी call-writing strike के ऊपर निकल जाए तो writers फँसते हैं, तेज़ उछाल आ सकता है (नीचे के लिए उल्टा)।</p>
      <p><b>Report card</b> में: gap %, दिन की range में position, VWAP, "sell the news", volume ÷ 20-दिन औसत, futures buildup (OI 10%+ और भाव 2%+ = मज़बूत), चेतावनियाँ (expiry week, hedge, बड़ी गिरावट के बाद short नहीं, FII net short + Nifty गिर रहा), और <b>3 scenario</b>: gap-up / range में / gap-down — हर एक का trigger (5–10 मिनट टिकना ज़रूरी), stop-loss (VWAP या wall के पार), targets (अगली wall, फिर pivot)।</p>
      <p><b>Brief</b> रात को NSE की file से सभी F&O शेयरों पर यही writers' read लगाता है (Upstox का कोई खर्च नहीं)।</p>
      <p class="mut">"Writing" एक अंदाज़ा है: exchange नहीं बताता कि सौदा किसने शुरू किया; hedge से भी OI बढ़ता है; खबर पर walls टूट जाती हैं।</p>
      <button class="gd-btn" onclick="Guide.test()">Reliance वाला test चलाएँ</button><div id="gdTest"></div>`],
    ['home', 'मुख्य screen: CALL / PUT / WAIT', `<p><b>CALL (CE)</b> = engine को ऊपर की चाल दिख रही है। <b>PUT (PE)</b> = नीचे की चाल। <b>WAIT</b> = अभी साफ़ मौका नहीं।</p>
      <p><b>Grade:</b> ★ Prime = trend वाले दिन का pullback, पुराने test में सबसे अच्छा (पूरा size)। <b>A</b> = अच्छा, आधा size। <b>B</b> = कुछ बातें खिलाफ़, कम से कम size। <b>S (Scalp)</b> = 1 मिनट की छोटी चाल, पुराने record में खर्चे के बाद घाटा — सिर्फ़ paper या 1 lot।</p>
      <p><b>Score:</b> कितनी बातें signal के साथ हैं। <b>Entry / SL / Target:</b> कहाँ घुसें, कहाँ गलत मानें (stop-loss), कहाँ मुनाफ़ा लें। <b>Market Brain:</b> पूरे बाज़ार का मूड (trend day है या range day)।</p>`],
    ['rc', 'Report card और Time Machine', `<p>Report card एक trade की पूरी जाँच है — हर बात ✔ (साथ), ✖ (खिलाफ़) या • (बीच में)। ऊपर का कुल score और "We are wrong if" (किस भाव पर idea गलत) ज़रूर पढ़ें।</p>
      <p><b>Time Machine:</b> यही plan (इसी समय entry, इतनी ही दूरी पर SL और target) पिछले ~60 दिनों में हर दिन चलाकर देखा जाता है — पहले target लगा या SL। फिर "आज जैसे दिन" (VWAP के ऊपर/नीचे, पिछले 30 मिनट की दिशा) और 10,000 नकली रास्ते (असली 1-मिनट चालों से बने)। <b>Avg R</b> = औसत नतीजा, 1R = SL जितना घाटा। +0.2R का मतलब औसतन SL के 20% जितना फ़ायदा। Nifty, Bank Nifty, Sensex पर, Replay की history download होने पर चलता है।</p>`],
    ['paper', 'Paper trading और "Lots by risk"', `<p>Paper trading में नकली पैसे से सौदे होते हैं, ताकि बिना नुकसान के अभ्यास हो। सारे खर्चे (brokerage, GST, STT, slippage) जोड़े जाते हैं।</p>
      <p><b>Lots: Fixed</b> = हर बार उतने ही lots जितने आपने रखे। <b>By risk</b> = lots अपने आप ऐसे तय होंगे कि SL लगने पर घाटा आपकी पूँजी के 2% से ज़्यादा न हो, फिर grade के हिसाब से (★ पूरा, A आधा, B/Scalp 1 lot)। कम से कम 1 lot। यह सिर्फ़ size बदलता है, signal नहीं।</p>`],
    ['mk', 'Map और Screener (ORB भी)', `<p><b>Map:</b> index के शेयर डिब्बों में — बड़ा डिब्बा = ज़्यादा वज़न। "Points" = उस शेयर ने index को कितने अंक हिलाया।</p>
      <p><b>Screener:</b> तैयार filters। पहली बार "Run First Scan" (लगभग 1 मिनट) दबाएँ, रोज़ 3:30 के बाद एक बार।</p>
      <p><b>Intraday Breakouts (ORB):</b> 9:15–9:30 का high-low एक डिब्बा है। भाव ऊपर निकले (▲) तो खरीदार मज़बूत, नीचे (▼) तो बेचने वाले। <b>Volume pace</b> 1.5× से ज़्यादा = असली ताक़त। <b>Clean</b> = भारी volume, पतला डिब्बा और डिब्बे से बहुत दूर नहीं। <b>Stop if wrong</b> = डिब्बे का दूसरा किनारा। 2% से ज़्यादा दूर निकल चुका हो तो देर हो चुकी है। Breakout अक्सर fail भी होते हैं, खासकर कम volume पर और 2 बजे के बाद।</p>`],
    ['rp', 'Replay', `<p>पुराने दिन को मिनट-दर-मिनट दोबारा चलाकर अभ्यास करें, और backtest देखें कि engine उन दिनों कैसा करता। "Download From Upstox" से 1-मिनट की history आती है (Time Machine भी इसी को पढ़ता है)।</p>`],
    ['ov', 'Overnight: BTST, gap radar, Reversal', `<p><b>BTST</b> = आज खरीदो, कल बेचो। यह page गिनता है कि आज जैसे दिनों के बाद अगली सुबह gap up कितनी बार हुआ, खर्चे जोड़कर। "<b>Too few</b>" = गिनती कम, भरोसा नहीं। "<b>No edge</b>" = कोई फ़ायदा नहीं दिखा। BTST Paper में नकली सौदे करके record बनाइए।</p>`],
    ['im', 'Impact: खबरें और नतीजे', `<p>AI हर खबर पढ़कर बताता है किस sector/कंपनी पर असर (जैसे crude सस्ता = airlines, paints अच्छे; oil producers बुरे)। AI गलत भी हो सकता है, और बाज़ार खबर को कुछ मिनटों में पचा लेता है।</p>
      <p><b>Results Radar:</b> नतीजों के बाद के मौके — "Strong results, beaten down" (bounce watch), "Weak results, still high" (गिरने का खतरा)।</p>`],
    ['jr', 'Journal', `<p>आपके अपने trades और signals से सीख। कम से कम 8 trades या 20 signals होने पर lessons दिखते हैं (12 अंक से बड़ा फ़र्क हो तभी)। "Warn me here" दबाने पर उस हालात में Report card पर चेतावनी आएगी — रोक नहीं, सिर्फ़ सलाह।</p>`],
    ['al', 'Alerts और Shock detector', `<p>अपने भाव पर alert (ऊपर जाए / नीचे गिरे)। <b>Shock detector</b>: 3 मिनट में बड़ी चाल (Nifty 0.35%, Bank Nifty 0.45%, शेयर 1%), अचानक बहुत बड़ी candle, VIX का उछाल या बड़ी खबर — तुरंत आवाज़ और लाल पट्टी। खुली position पर खतरा हो तो पहले वही बताता है। Dashboard खुला रहना ज़रूरी है।</p>`],
    ['bf', 'Next-Day Brief', `<p>कल के लिए <b>Top 5 positive</b> और <b>Top 5 negative</b> F&O शेयर, हर कारण के साथ, ताकि आप खुद जाँच सकें।</p>
      <p><b>कब:</b> 3:00 बजे के बाद <b>provisional</b> (live भाव + live futures OI, delivery कल की)। शाम ~7 बजे NSE की files आने के बाद <b>final</b>। देर रात या सुबह 9:15 से पहले दोबारा खोलें तो GIFT Nifty, US futures और crude ताज़ा हो जाते हैं।</p>
      <p><b>कारण कहाँ से:</b> Nifty से तुलना, दिन के high/low के पास close, futures OI buildup, delivery %, 2 और 5 दिन का trend, sector की चाल, खबरें, world cues (Nasdaq→IT, crude→OMC/paints/airlines)। ऊपर बाज़ार का माहौल: FII/DII, FII index futures, GIFT Nifty, US futures, Brent।</p>
      <p><b>ईमानदारी से:</b> NSE किसी एक शेयर या sector में FII की रोज़ की खरीद-बिक्री नहीं बताता। OI buildup और delivery उसके सबसे नज़दीकी public संकेत हैं। हर दिन की list save होती है और अगले दिन जाँची जाती है (Track Record)। 20 दिन का record देखे बिना भरोसा न करें। जिनके नतीजे कल हैं, वे list से बाहर अलग दिखते हैं।</p>`],
    ['ask', 'Ask (सवाल पूछें)', `<p>ऊपर की पट्टी में लिखकर या mic से पूछें: "Bank Nifty 57300 CE लूँ?", "कल किसके results हैं?"। जवाब dashboard के data से आता है।</p>`],
    ['words', 'शब्दकोश (आसान मतलब)', `<dl class="gd-dl">
      <dt>CE / PE</dt><dd>Call option (ऊपर जाने पर फ़ायदा) / Put option (नीचे जाने पर फ़ायदा)।</dd>
      <dt>Strike</dt><dd>option का भाव-स्तर, जैसे 57300।</dd>
      <dt>SL (stop-loss)</dt><dd>वह भाव जहाँ मान लें कि idea गलत था और निकल जाएँ।</dd>
      <dt>R</dt><dd>जोखिम की इकाई। 1R = SL लगने पर जितना घाटा। 2R = उसका दुगना फ़ायदा।</dd>
      <dt>ATR</dt><dd>औसतन एक candle/दिन में भाव कितना हिलता है।</dd>
      <dt>VWAP / TWAP</dt><dd>दिन का औसत भाव। उसके ऊपर = खरीदार मज़बूत, नीचे = बेचने वाले।</dd>
      <dt>OI (Open Interest)</dt><dd>कितने futures/options सौदे अभी खुले हैं। बढ़ना = नए सौदे, घटना = लोग निकल रहे हैं।</dd>
      <dt>Long buildup</dt><dd>भाव ↑ और OI ↑ = नए खरीदार।</dd><dt>Short buildup</dt><dd>भाव ↓ और OI ↑ = नए बेचने वाले।</dd>
      <dt>Short covering</dt><dd>भाव ↑ और OI ↓ = बेचने वाले भाग रहे हैं (तेज़ी टिकाऊ नहीं भी हो सकती)।</dd><dt>Long unwinding</dt><dd>भाव ↓ और OI ↓ = खरीदार निकल रहे हैं।</dd>
      <dt>Delivery %</dt><dd>आज के सौदों में से कितने शेयर लोग घर ले गए (intraday नहीं)। ज़्यादा = असली खरीद/बिक्री।</dd>
      <dt>PCR</dt><dd>Put OI ÷ Call OI। ऊँचा = नीचे support मज़बूत, नीचा = ऊपर रुकावट।</dd>
      <dt>Option wall</dt><dd>जिस strike पर सबसे ज़्यादा call OI (रुकावट) या put OI (support)।</dd>
      <dt>FII / DII</dt><dd>विदेशी और देसी बड़े संस्थान (funds, बैंक, बीमा)।</dd>
      <dt>GIFT Nifty</dt><dd>भारत के बाहर (GIFT City) चलने वाला Nifty futures, जो सुबह के gap का अंदाज़ा देता है।</dd>
      <dt>VIX</dt><dd>डर का पैमाना। ऊँचा = बड़े झटके, महँगे options।</dd>
      <dt>ORB</dt><dd>Opening Range Breakout: 9:15–9:30 के high/low से बाहर निकलना।</dd>
      <dt>BTST</dt><dd>आज खरीदो, कल बेचो।</dd>
      <dt>Win rate / Profit factor</dt><dd>कितने % सौदे फ़ायदे में / कुल फ़ायदा ÷ कुल घाटा (1 से ऊपर = फ़ायदेमंद)।</dd>
      <dt>Provisional / Final</dt><dd>3 बजे का कच्चा अंदाज़ा / शाम की NSE files के बाद का पक्का हिसाब।</dd></dl>`],
  ];
  function build() {
    if ($g('gd')) return;
    const el = document.createElement('div'); el.id = 'gd'; el.className = 'rp gd'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Guide');
    el.innerHTML = `<div class="rc-wrap"><div class="rp-top rc-top"><h2>Guide</h2><span class="mut">हर page और हर शब्द, आसान भाषा में</span><button class="x" onclick="Guide.close()" aria-label="Close">✕</button></div>
      <div class="gd-toc">${SECTIONS.map(([k, t]) => `<button onclick="Guide.go('${k}')">${t}</button>`).join('')}</div>
      ${SECTIONS.map(([k, t, b]) => `<section class="gd-sec" id="gd-${k}"><h3>${t}</h3>${b}</section>`).join('')}</div>`;
    document.body.appendChild(el);
  }
  function open(k) { build(); $g('gd').classList.add('on'); document.body.style.overflow = 'hidden'; if (k) setTimeout(() => go(k), 30); else $g('gd').scrollTop = 0; }
  function close() { const el = $g('gd'); if (el) el.classList.remove('on'); if (!document.querySelector('.rp.on')) document.body.style.overflow = ''; }
  function go(k) { const s = $g('gd-' + k); if (s) s.scrollIntoView({ block: 'start' }); }
  // which guide section belongs to which page
  const SEC_OF = { rc: 'rc', mk: 'mk', rp: 'rp', ov: 'ov', im: 'im', jr: 'jr', al: 'al', bf: 'bf', it: 'it' };
  function keyOf(el) { const t = el.querySelector('.mk-tabs button.on'); return t && t.dataset.t ? el.id + ':' + t.dataset.t : el.id; }
  function tips() {
    document.querySelectorAll('.rp.on').forEach((el) => {
      if (el.id === 'gd') return;
      const k = keyOf(el), txt = TIP[k] || TIP[el.id]; if (!txt) return;
      const top = el.querySelector('.rp-top'); if (!top) return;
      let s = top.nextElementSibling;
      if (!s || !s.classList.contains('gd-tip')) { s = document.createElement('div'); s.className = 'gd-tip'; top.insertAdjacentElement('afterend', s); }
      if (s.dataset.k !== k) { s.dataset.k = k; s.innerHTML = `<b>आसान मतलब:</b> ${txt} <button onclick="Guide.open('${SEC_OF[el.id] || 'start'}')">पूरा समझें →</button>`; }
    });
  }
  function home() {
    const top = document.querySelector('header.topbar'); if (!top || $g('gdHome') || Store.pref('gd_home_hide', false)) return;
    const s = document.createElement('div'); s.id = 'gdHome'; s.className = 'gd-tip gd-home';
    s.innerHTML = `<b>आसान मतलब:</b> ${TIP.home} <button onclick="Guide.open('start')">Guide खोलें →</button><button class="gd-x" onclick="Guide.hideHome()" aria-label="Hide">✕</button>`;
    top.insertAdjacentElement('afterend', s);
  }
  function hideHome() { Store.setPref('gd_home_hide', true); const s = $g('gdHome'); if (s) s.remove(); }
  /* first-visit tour: 6 short steps pointing at the buttons */
  const TOUR = [
    ['.navbtns .itbtn', 'Overview: पूरे बाज़ार का एक page — मूड, दुनिया, FII/DII, sectors, कल के शेयर, खबरें। शुरुआत यहीं से करें।'],
    ['.navbtns .bfbtn', 'Brief: 3 बजे के बाद और शाम को — कल के लिए 5 मज़बूत और 5 कमज़ोर F&O शेयर, कारणों के साथ।'],
    ['.navbtns [onclick^="Markets.open(\'scr\')"]', 'Screener: तैयार lists। "Intraday Radar & ORB" में market के दौरान असामान्य चाल और breakouts।'],
    ['#q', 'यहाँ सवाल पूछें, जैसे "Bank Nifty 57300 CE लूँ?" या "कल किसके results हैं?" — mic से बोल भी सकते हैं।'],
    ['.navbtns .palbtn', 'Search (Ctrl+K): कोई भी page या शेयर टाइप करके सीधे खोलें।'],
    ['.navbtns .gdbtn', 'Guide: हर page और हर शब्द आसान हिंदी में। हर page के ऊपर "आसान मतलब" की पट्टी भी है।'],
  ];
  let ti = -1;
  function tour() { ti = 0; step(); }
  function tourEnd() { ti = -1; Store.setPref('tour_done', true); const o = $g('gdTour'); if (o) o.remove(); }
  function step() {
    let o = $g('gdTour'); if (!o) { o = document.createElement('div'); o.id = 'gdTour'; o.className = 'gd-tour'; document.body.appendChild(o); }
    while (ti < TOUR.length && !document.querySelector(TOUR[ti][0])) ti++;
    if (ti >= TOUR.length) return tourEnd();
    const el = document.querySelector(TOUR[ti][0]); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(), W = window.innerWidth;
    const top = r.bottom + 10, left = Math.max(12, Math.min(W - 332, r.left));
    o.innerHTML = `<div class="gd-hole" style="left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px"></div>
      <div class="gd-step" style="left:${left}px;top:${top}px"><b>${ti + 1} / ${TOUR.length}</b><p>${TOUR[ti][1]}</p><div><button onclick="Guide.tourEnd()">Skip</button><button class="go" onclick="Guide.next()">${ti === TOUR.length - 1 ? 'Done' : 'Next →'}</button></div></div>`;
  }
  function next() { ti++; if (ti >= TOUR.length) tourEnd(); else step(); }
  setTimeout(() => { if (!Store.pref('tour_done', false) && !document.querySelector('.rp.on') && !/[?&]notour/.test(location.search) && !navigator.webdriver) tour(); }, 3500);
  setInterval(tips, 700);
  setTimeout(home, 1500);
  function test() { const el = $g('gdTest'); if (el && typeof Writers !== 'undefined') el.innerHTML = Writers.testHTML(); }
  return { open, close, go, hideHome, TIP, tour, tourEnd, next, test };
})();
