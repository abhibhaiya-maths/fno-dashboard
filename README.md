# ✅ नया (11 नवंबर 2026, भाग 5): Journal + Alerts (अपने लेवल + झटका डिटेक्टर) — यही सबसे ताज़ा वर्ज़न है

**अपलोड:** इस ZIP का `web`, `worker`, `firebase`, `README.md` GitHub पर डालें → Commit → साइट पर Ctrl + Shift + R। Worker वही है जो भाग 4 में था (इस बार Worker में कोई नया बदलाव नहीं); अगर भाग 4 वाला Worker deploy नहीं किया, तो `worker/src/index.js` अब deploy कर दें।

**1. Journal (ऊपर "Journal" बटन):** हर पेपर ट्रेड और हर सिग्नल के साथ अब उस वक़्त की हालत सेव होती है (समय, VIX, expiry, रिपोर्ट कार्ड नंबर, Market Brain, daily trend, ख़बरें, दिन का प्रकार, ADX)। Journal बताता है कहाँ आप जीतते हैं और कहाँ हारते हैं, जैसे "Expiry day: won 22%" या "FOMO टैग वाले ट्रेड: 22%"। "Warn me here" दबाने पर वही हालत दोबारा आने पर रिपोर्ट कार्ड चेतावनी देता है (सिर्फ़ सलाह, कुछ रोकता या ग्रेड नहीं बदलता)। "My Trades & Tags" में हर ट्रेड पर टैग लगाएँ: Followed plan, FOMO, Revenge trade, Early exit, Late exit, Moved my SL, Too big, News trade। सबक़ 8+ ट्रेड या 20+ सिग्नल के बाद ही दिखते हैं।

**2. Alerts (ऊपर "Alerts" बटन):** अपने भाव पर अलर्ट (ऊपर/नीचे, एक बार या हर 10 मिनट, नोट बोलकर), एक टैप में resistance/support/day high/low पर अलर्ट। **झटका डिटेक्टर:** अचानक बड़ी candle, 3 मिनट में तेज़ चाल, India VIX का उछाल, या बड़ी ख़बर। अगर उल्टी पोज़िशन है तो पहले "आपकी कॉल/पुट ख़तरे में है"। लाल बैनर + बीप + हिंदी आवाज़। Off / Normal / Sensitive। ये तभी चलते हैं जब डैशबोर्ड खुला हो (फ़ोन पर स्क्रीन ऑन रखें)। Telegram अभी नहीं जोड़ा गया।

CALL/PUT सिग्नल, स्कोर, ग्रेड और पेपर ट्रेडिंग के नियम पहले जैसे हैं।

---

# ✅ नया (11 नवंबर 2026, भाग 4): हर इंस्ट्रूमेंट के लिए World cues + AI से नतीजों की तारीख़ — यही सबसे ताज़ा वर्ज़न है

**अपलोड:** इस ZIP का `web`, `worker`, `firebase`, `README.md` GitHub पर डालें → Commit। **Worker भी दोबारा Deploy करें** (`worker/src/index.js`): नतीजों का कैलेंडर अब पिछले 20 और अगले 30 दिन का है, और NSE रोके तो ख़बरों से तारीख़ें निकालता है। कोई नई key नहीं।

**1. World cues अब चुने हुए इंस्ट्रूमेंट के लिए:** ऊपर की पट्टी "World cues for Nifty / SENSEX / BANK NIFTY / WIPRO / CRUDEOIL…" दिखाती है। हर इंस्ट्रूमेंट के लिए अलग हिसाब: Bank Nifty = बैंक ADR + US yields; IT शेयर = Nasdaq + Infosys ADR + कमज़ोर रुपया अच्छा; फ़ार्मा = कमज़ोर रुपया अच्छा; मेटल = चीन + डॉलर; OMC/एयरलाइन/पेंट = सस्ता क्रूड अच्छा; ONGC = महँगा क्रूड अच्छा; MCX crude/gold/silver/gas = उनके अपने विश्व भाव (बाकी "not relevant")। नीचे वाली World markets तालिका का कॉलम भी "For <इंस्ट्रूमेंट>" दिखाता है। Pre-market checklist पूरे बाज़ार (Nifty) का ही रहता है। इंजन (स्कोर, सिग्नल, ग्रेड, Market Brain) पहले जैसा Nifty वाला हिसाब ही इस्तेमाल करता है, उसमें कोई बदलाव नहीं।

**2. Ask बॉक्स में नतीजों की तारीख़:** "11 तारीख को किसके रिजल्ट आने हैं", "kal kaun se results aaye", "is hafte kiske results hain", "Friday ko", "15 November", "Reliance ka result kab hai"। जवाब: F&O कंपनियाँ अलग, बाकी अलग; जिनके नतीजे आ चुके उनका मुनाफ़ा YoY (Results Radar से); हिंदी में बोलकर; AI चालू हो तो सिर्फ़ इसी लिस्ट से छोटा सार (वो कोई नाम या तारीख़ ख़ुद नहीं जोड़ सकता)।

---

# ✅ नया (11 नवंबर 2026, भाग 3): Overnight पेज (BTST + गैप रडार + Reversal Radar) — यही सबसे ताज़ा वर्ज़न है

**अपलोड का पूरा तरीका (रिपोर्ट कार्ड + Impact + Overnight, तीनों एक साथ):**
1. **GitHub:** इस ZIP का `web`, `worker`, `firebase` और `README.md` रिपो में पुरानी फ़ाइलों के ऊपर डालें → Commit। Vercel अपने-आप लाइव करेगा।
2. **Cloudflare Worker (ज़रूरी):** `worker/src/index.js` का पूरा कोड Edit code में पेस्ट करके **Deploy**। नए हिस्से: `/api/impact`, `/api/earnings`, `/api/eod`। कोई नई key या सेटिंग नहीं।
3. साइट खोलकर एक बार **Ctrl + Shift + R**।
4. **Overnight** बटन → "Download history from Upstox" (लगभग 2 मिनट, सिर्फ़ एक बार)। उसके बाद रोज़ 3:30 के बाद पेज खोलने पर आज का दिन अपने-आप जुड़ जाता है।
5. **Screener** → "Run First Scan" (Results Radar के 52-हफ़्ते वाले भाव के लिए)।

**Overnight पेज में क्या है:**
- **Overnight Edge:** हर F&O शेयर और Nifty/Bank Nifty/Sensex के लिए: पिछले 2 साल में "आज जैसे दिनों" के बाद अगली सुबह गैप-अप कितनी बार हुआ, औसत गैप, अगले दिन बंद होने तक फ़ायदा कितनी बार, रेंज, और कितने दिनों पर आधारित। तीन लिस्ट: Top BTST buys, Gap-up watch, Gap-down alerts। 30 से कम दिन मिलें तो सबके ब्लेंड से, और बहुत कम हों तो "INSUFFICIENT DATA"।
- **"How good is this?":** पिछले 250 दिनों पर ईमानदार टेस्ट (हर दिन सिर्फ़ उससे पहले का डेटा देखकर), BTST के असली चार्ज जोड़कर, और calibration तालिका।
- **Reversal Radar:** इंडेक्स बड़ा गिरे तो बताता है कि वापसी असली दिखती है, short covering है, कमज़ोर bounce है या कुछ नहीं, और पिछले ऐसे दिनों के बाद अगले दिन क्या हुआ।
- **BTST Paper & Record:** अलग BTST पेपर खाता (इंट्राडे पेपर ट्रेडिंग और 3:29 वाले स्क्वेयर-ऑफ़ से बिल्कुल अलग), और "लाइव रिकॉर्ड": हर दिन 3–3:30 के बीच पेज खुला हो तो उसकी लिस्ट सेव होती है और अगले दिन जाँची जाती है।
- सेटिंग्स: `web/js/config.js` → `BTST` (₹ प्रति ट्रेड, बेचने का तरीका, चार्ज)।

कॉल/पुट सिग्नल, स्कोर, ग्रेड और इंट्राडे पेपर ट्रेडिंग पर इनमें से किसी का कोई असर नहीं।

---

# ✅ नया (11 नवंबर 2026, भाग 2): News Impact + Results Radar

**1. GitHub:** नई फ़ाइल `web/js/impact.js`; बदली: `web/index.html`, `web/style.css`, `web/js/report.js`।

**2. Cloudflare Worker (इस बार ज़रूरी):** `worker/src/index.js` का पूरा कोड Edit code में पेस्ट करके **Deploy**। इसमें दो नए हिस्से जुड़े हैं: `/api/impact` (ख़बर → सेक्टर/कंपनी पर असर) और `/api/earnings` (नतीजों की हेडलाइन से profit/revenue YoY)। कोई नई key या सेटिंग नहीं: पहले वाला AI (Gemini या Workers AI) ही काम आता है। बाकी Worker वैसा ही है।

**नया क्या है:** ऊपर **Impact** बटन। (1) News Impact: आज की ख़बरों से किस सेक्टर/कंपनी को फ़ायदा या नुक़सान, Nifty पर कुल झुकाव, आपकी वॉचलिस्ट पर असर। (2) Results Radar: अच्छे नतीजे पर गिरा हुआ भाव (bounce watch), कमज़ोर नतीजे पर ऊँचा भाव (fall risk), कमज़ोर नतीजे + बुरी ख़बर, अच्छे नतीजे + 52-हफ़्ते के हाई के पास। भाव वाले हिस्से के लिए Screener का scan एक बार चलाएँ। रिपोर्ट कार्ड में एक नया सवाल: "Is today's news with you?" कॉल/पुट सिग्नल, स्कोर और ग्रेड पर इसका कोई असर नहीं।

---

# ✅ नया (11 नवंबर 2026): ट्रेड रिपोर्ट कार्ड — अपलोड चेकलिस्ट

**1. GitHub (Vercel अपने-आप लाइव करेगा):** `web` फ़ोल्डर की ये फ़ाइलें बदलें/जोड़ें:
- नई: `web/js/report.js`
- बदली: `web/index.html`, `web/style.css`, `web/js/paper.js`, `web/js/config.js`

**2. Cloudflare Worker:** रिपोर्ट कार्ड के लिए कोई बदलाव नहीं। पर ध्यान दें: `worker/src/index.js` का **पूरा नया वर्ज़न** (Map, Screener, Replay, World cues, FII positions, voice recording वाला) ही deploy होना चाहिए। साइट में Map खोलने पर "deploy the new Worker code" लिखा आए, तो यही फ़ाइल Edit code में पेस्ट करके **Deploy** करें।

**नया क्या है:** लाइव सिग्नल के नीचे **📋 Full report card** बटन: 12 सवालों की जाँच, 0–100 का स्कोर, पैसे का हिसाब (SL पर कितना जाएगा, टारगेट पर कितना आएगा, चार्ज जोड़कर), "हम ग़लत हैं अगर…", सीनियर ट्रेडर की सलाह (सिर्फ़ चेतावनी, कुछ रोकता नहीं), हर ग्रेड का असली रिकॉर्ड, और हिंदी में सुनने का बटन। सलाह की सीमाएँ `web/js/config.js` → `RISK` में बदलें।

---

# ✅ फ़ाइनल वर्ज़न (नवंबर 2026: वॉचलिस्ट + प्रो टूल) — अपलोड चेकलिस्ट

**1. GitHub (Vercel अपने-आप लाइव करेगा):** `web` फ़ोल्डर की **सारी** फ़ाइलें बदलें (हर फ़ाइल बदली है):
- `web/index.html`, `web/style.css`
- `web/js/`: `analysis.js`, `config.js`, `data-demo.js`, `data-live.js`, `engine.js`, `indicators.js`, `main.js`, `paper.js`, `store.js`, `ui.js`, `voice.js`

**2. Cloudflare Worker (`fno-worker`):** `worker/src/index.js` का पूरा कोड Edit code में पेस्ट करके **Deploy**। कोई नई सेटिंग या key नहीं चाहिए। पुराना Worker रहा तो साइट ऊपर "Old Worker code" लिखेगी।

**मोबाइल पर हिंदी दिखे तो:** पेज अब Google Translate को रोकता है और हर फ़ाइल नए वर्ज़न नंबर से लोड होती है। फिर भी दिखे तो Chrome में ⋮ → Settings → Site settings → साइट का डेटा साफ़ करें, या ⋮ → Translate → "Never translate English"।

**नया क्या है:**
- **+ Add stock / MCX**: Reliance, Wipro, HDFC Bank, Nifty IT, Crude Oil, Gold… कुछ भी खोजकर जोड़ें (अधिकतम 12)। हर एक पर वही इंजन: चार्ट, स्कोर, लेवल, कंपनी न्यूज़। F&O वाले शेयरों पर ऑप्शन चेन और पेपर ट्रेडिंग भी। MCX पर Upstox ऑप्शन चेन नहीं देता, इसलिए वहाँ futures के लेवल। वॉचलिस्ट Firestore में सेव होती है (फ़ोन और लैपटॉप दोनों पर एक जैसी)।
- **Futures OI buildup** (long/short buildup, short covering, long unwinding), **IV percentile** (India VIX, 1 साल), **IV ÷ realised vol** (शेयर), 52-हफ़्ते और पिछले हफ़्ते के लेवल।
- **Global cues**: GIFT Nifty (गैप-अप/डाउन संकेत), Dow, S&P, Nasdaq, Nikkei, Hang Seng, Brent, USD/INR (Upstox से, मुफ़्त)।
- **Event calendar**: RBI पॉलिसी, US Fed, US के बड़े डेटा (ForexFactory), India CPI, एक्सपायरी। इवेंट वाले दिन सेटअप अपने-आप "mild" और चेतावनी।
- **FII/DII अपने-आप** (NSE से; NSE ब्लॉक करे तो हाथ से डालने का बॉक्स)।
- **Official** टैब: NSE कॉर्पोरेट announcements, RBI press releases/notifications, SEBI।

**3. Worker की सेटिंग्स (Settings → Variables and Secrets / Bindings):**

| नाम | टाइप | ज़रूरी? |
|---|---|---|
| `UPSTOX_ACCESS_TOKEN` | Secret | ✅ (Upstox Analytics Token, 1 साल चलता है) |
| `ALLOWED_EMAIL` | Text | ✅ `raiabhinaykumar@gmail.com` |
| `FIREBASE_API_KEY` | Text | ✅ |
| `FRONTEND_URL` | Text | ✅ जैसे `https://fno-dashboard-web.vercel.app,https://padhleindia.live` |
| `KV` | KV binding | ✅ `fno-kv` |
| `GEMINI_API_KEY` | Secret | वैकल्पिक, मुफ़्त (AI से कुछ भी पूछने के लिए) |
| `AI` | Workers AI binding | वैकल्पिक, मुफ़्त, बिना key |

मुफ़्त सीमा: Cloudflare 1 लाख रिक्वेस्ट/दिन और KV 1000 writes/दिन। बाज़ार बंद होने पर साइट अपने-आप धीमे polling पर चली जाती है, इसलिए 12 instruments तक आराम से सीमा के अंदर।

**4. Firebase:** Authentication → Authorized domains में अपनी साइट के डोमेन जोड़ें।

**5. जाँच:** बाज़ार खुलने पर साइट में ऊपर **"Live stream"** और इंजन पट्टी में **"tick lag … ms"** दिखना चाहिए। स्ट्रीम न जुड़े तो डैशबोर्ड अपने-आप हर 5 सेकंड वाले polling पर चलता रहेगा।

स्क्रीन English में है, बोलकर जवाब और अलर्ट हिंदी में।

---

# 📊 F&O एनालिटिक्स डैशबोर्ड — सेटअप गाइड

Nifty, Sensex और Bank Nifty के लिए आपका निजी डैशबोर्ड। इसमें ये सब है:

- 20 संकेतों से कॉल/पुट का प्रोबेबिलिटी स्कोर
- चार्ट पर इंडिकेटर्स, ऑप्शन चेन, न्यूज़ सेंटिमेंट और वॉइस से सवाल
- **पेपर ट्रेडिंग**: डमी पैसे से असली जैसी ट्रेडिंग, बड़ा कॉल/पुट/रुको सिग्नल, हर पोज़िशन पर होल्ड/एग्जिट की सलाह, और ये रिकॉर्ड कि सिग्नल कितने % सही निकले

> ⚠️ ये टूल सिर्फ़ विश्लेषण और प्रैक्टिस के लिए है, निवेश सलाह नहीं। कोई भी संकेत गारंटी नहीं है। ये कोई असली ऑर्डर नहीं लगाता।

---

## 📁 फ़ोल्डर में क्या है

```
fno-dashboard/
├── web/                  ← वेबसाइट (Vercel पर जाएगी)
│   ├── index.html
│   ├── style.css
│   └── js/
│       ├── config.js     ← ✏️ सिर्फ़ ये फ़ाइल आपको भरनी है
│       ├── indicators.js   इंडिकेटर्स के फ़ॉर्मूले
│       ├── analysis.js     स्कोर, सिग्नल, सेटअप
│       ├── paper.js        पेपर ट्रेडिंग
│       ├── data-live.js    लाइव डेटा
│       ├── data-demo.js    डेमो डेटा
│       └── ...
├── worker/               ← बैकएंड (Cloudflare पर जाएगा)
│   ├── src/index.js
│   └── wrangler.toml
└── firebase/
    └── firestore.rules   ← Firebase डेटाबेस की सुरक्षा
```

---

## 0️⃣ पहले डेमो देख लें (0 मिनट)

`web/index.html` पर डबल-क्लिक करें। नकली डेटा पर सब कुछ चलेगा, जिसमें पेपर ट्रेडिंग भी शामिल है। समय तेज़ चलता है: हर 2 सेकंड = 1 मिनट।

---

## लाइव सेटअप: इसी क्रम में करें (लगभग 1–1.5 घंटा)

### 1️⃣ Firebase (लॉगिन + ट्रेड हिस्ट्री) — 15 मिनट

1. https://console.firebase.google.com पर जाएँ → **Add project** → नाम डालें, जैसे `fno-dashboard`।
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save**।
3. **Build → Firestore Database → Create database** → लोकेशन `asia-south1 (Mumbai)` → **Production mode**।
4. Firestore में **Rules** टैब खोलें → `firebase/firestore.rules` का सारा कोड पेस्ट करें → `your-email@gmail.com` की जगह **अपना Gmail** डालें → **Publish**।
5. ⚙️ **Project settings → General → Your apps → `</>` (Web)** → नाम डालें → **Register**। जो `firebaseConfig` दिखे, उसमें से `apiKey`, `authDomain`, `projectId`, `appId` कॉपी कर लें।
6. **Authentication → Settings → Authorized domains → Add domain** → वो डोमेन डालें जिस पर साइट चलेगी, जैसे `trade.padhleindia.com`।

### 2️⃣ Cloudflare Worker (बैकएंड) — 15 मिनट

1. https://dash.cloudflare.com → **Workers & Pages → Create → Create Worker** → नाम `fno-worker` → **Deploy**।
2. **Edit code** → पहले से लिखा सारा कोड हटाएँ → `worker/src/index.js` का पूरा कोड पेस्ट करें → **Deploy**।
3. Worker का URL नोट करें, जैसे `https://fno-worker.आपका-नाम.workers.dev`।
4. **Storage & Databases → KV → Create** → नाम `fno-kv`।
5. Worker → **Settings → Bindings → Add → KV namespace** → Variable name: `KV`, namespace: `fno-kv` → Save।
6. Worker → **Settings → Variables and Secrets → Add**:

| नाम | टाइप | वैल्यू |
|---|---|---|
| `FRONTEND_URL` | Text | `https://trade.padhleindia.com` (आपकी साइट, आख़िर में `/` नहीं) |
| `ALLOWED_EMAIL` | Text | आपका Gmail (वही जो Firebase rules में डाला) |
| `FIREBASE_API_KEY` | Text | Firebase का `apiKey` |
| `UPSTOX_ACCESS_TOKEN` | **Secret** | Upstox Analytics Token (स्टेप 3) |
| `UPSTOX_API_KEY`, `UPSTOX_API_SECRET`, `UPSTOX_REDIRECT_URI` | | सिर्फ़ पुराने OAuth तरीक़े में (स्टेप 3-B) |
| `ANTHROPIC_API_KEY` | **Secret** | वैकल्पिक, स्टेप 4 |

### 3️⃣ Upstox API — 5 मिनट (आसान तरीक़ा: Analytics Token ⭐)

1. Upstox में **My Apps → Analytics** टैब खोलें → **Analytics Token** बनाएँ। ये मुफ़्त है और 1 साल चलता है।
2. टोकन के बगल वाले कॉपी आइकन से उसे कॉपी करें।
3. Worker में **Secret** बनाएँ: नाम `UPSTOX_ACCESS_TOKEN`, value में टोकन पेस्ट करें, फिर Deploy करें।
4. बस! इस तरीक़े में **रोज़ लॉगिन नहीं** करना पड़ता, और `UPSTOX_API_KEY`, `UPSTOX_API_SECRET`, `UPSTOX_REDIRECT_URI` की ज़रूरत नहीं।
5. साल भर बाद टोकन एक्सपायर हो, तो नया बनाकर यही Secret अपडेट कर दें। डैशबोर्ड पर एरर आएगी तो पता चल जाएगा।

### 3️⃣-B Upstox API — पुराना तरीक़ा (OAuth, रोज़ लॉगिन), सिर्फ़ तभी जब Analytics Token न मिले

1. Upstox पर डीमैट/ट्रेडिंग अकाउंट खोलें, अगर नहीं है। ट्रेडिंग आप Groww पर ही करते रह सकते हैं, यहाँ सिर्फ़ डेटा लेना है।
2. Upstox में लॉगिन करके **Developer Apps** पेज पर जाएँ (Upstox ऐप/वेब में "API" या "Developer" सेक्शन) → **New App**।
3. **Redirect URL** में वही डालें जो `UPSTOX_REDIRECT_URI` में डाला: `https://fno-worker.आपका-नाम.workers.dev/auth/callback`।
4. App बनने पर **API Key** और **API Secret** मिलेंगे → इन्हें Worker के Secrets `UPSTOX_API_KEY` और `UPSTOX_API_SECRET` में डालें → **Deploy**।
5. Upstox की मौजूदा API फ़ीस और नियम उनकी साइट पर एक बार ज़रूर जाँच लें।

### 4️⃣ AI (मुफ़्त) — 5 मिनट, वैकल्पिक

AI से वॉइस/टाइप करके डैशबोर्ड से कुछ भी पूछ सकते हैं, और ख़बरों का सेंटिमेंट बेहतर निकलता है। दोनों तरीक़े मुफ़्त हैं, एक या दोनों लगा सकते हैं:

**A. Google Gemini (बेहतर हिंदी, मुफ़्त key):**
1. https://aistudio.google.com पर Google अकाउंट से लॉगिन करें → **Get API key → Create API key**।
2. Worker में **Secret** बनाएँ: `GEMINI_API_KEY` = वो key → Deploy।
3. मुफ़्त प्लान में रोज़ के सवालों की एक सीमा होती है; सीमा पूरी होने पर Worker अपने-आप Cloudflare AI (B) पर चला जाता है।

**B. Cloudflare Workers AI (बिना किसी key के):**
1. Worker → **Settings → Bindings → Add → Workers AI** → Variable name: `AI` → Save/Deploy।
2. Cloudflare रोज़ एक मुफ़्त कोटा देता है। ख़बरों का स्कोर पहले इसी से निकलता है ताकि Gemini का कोटा आपके सवालों के लिए बचा रहे।

(पेड Anthropic key `ANTHROPIC_API_KEY` भी चलती है, पर ज़रूरी नहीं।)

**ख़बरें:** किसी key की ज़रूरत नहीं। Worker Google News, ET, Moneycontrol, Mint और Business Standard की मुफ़्त RSS फ़ीड ख़ुद पढ़ता है। ख़बरों वाले पैनल के नीचे दिखता है कि किस स्रोत से कितनी ख़बरें आईं।

### 5️⃣ `web/js/config.js` भरें — 2 मिनट

```js
WORKER_URL: 'https://fno-worker.आपका-नाम.workers.dev',
FIREBASE: {
  apiKey: '...',
  authDomain: '...',
  projectId: '...',
  appId: '...',
},
```

ये चारों वैल्यू पब्लिक होती हैं, इन्हें GitHub पर डालना ठीक है। **Upstox secret और Anthropic key कभी भी इस फ़ाइल में न डालें**, वो सिर्फ़ Worker में रहती हैं।

### 6️⃣ GitHub + Vercel — 10 मिनट

1. GitHub पर नई **private** रिपॉज़िटरी बनाएँ, जैसे `fno-dashboard`, और ये पूरा फ़ोल्डर अपलोड करें।
2. https://vercel.com → **Add New → Project** → वो रिपॉज़िटरी चुनें।
3. **Root Directory: `web`** → Framework Preset: **Other** → **Deploy**।
4. **Settings → Domains** → `trade.padhleindia.com` जोड़ें। Vercel जो CNAME रिकॉर्ड बताए, उसे अपने DNS (जैसे Cloudflare DNS) में डालें।

### 7️⃣ पहली बार चलाएँ

1. साइट खोलें → **Google से लॉगिन** करें।
2. Analytics Token वाले तरीक़े में ऊपर सीधे "● Upstox जुड़ा है" दिखेगा। बस इतना ही करना है।
3. (सिर्फ़ OAuth तरीक़े में) ऊपर **"🔗 Upstox से कनेक्ट करें"** दबाएँ। ये **रोज़ सुबह एक बार** करना होगा।

---

## 🧪 पेपर ट्रेडिंग कैसे काम करती है

- **बड़ा सिग्नल बैनर:** 📈 कॉल का सेटअप (हरा), 📉 पुट का सेटअप (लाल), या ⏸ रुको (ग्रे)।
  - स्कोर ≥ 70 पर "मज़बूत", 58–69 पर "हल्का"। ADX 20 से कम हो तो सिग्नल हमेशा "हल्का" दिखेगा।
  - पहले 15 मिनट (9:30 तक) और 3:00 के बाद कोई नया सिग्नल नहीं आता।
- **भाव असली जैसे:** ख़रीद ask भाव पर और बिक्री bid भाव पर होती है। bid/ask न मिलें तो LTP ± 0.5% स्लिपेज लगता है। लॉट साइज़ Upstox से आता है।
- **हर ट्रेड पर चार्ज:** ₹20 ब्रोकरेज, बिक्री पर 0.15% STT, ट्रांज़ैक्शन चार्ज, SEBI फ़ीस, स्टांप ड्यूटी और GST। ये `config.js` में बदले जा सकते हैं।
- **खुली पोज़िशन पर लाइव सलाह:**
  - 🟢 **होल्ड करो**: संकेत अब भी आपकी दिशा में हैं।
  - 🟡 **सावधान**: संकेत कमज़ोर हो रहे हैं, लेवल पास है, या SL को एंट्री पर लाने का समय है।
  - 🟠 **मुनाफ़ा बुक करो**: 1.5R मुनाफ़ा, टारगेट पास, या RSI एक्सट्रीम।
  - 🔴 **एग्जिट का संकेत**: स्कोर उलट गया, Supertrend पलट गया, भाव VWAP/TWAP के ग़लत तरफ़ और MACD उलटा, या 3 बजे के बाद।
  - सलाह बदलते ही बीप और आवाज़ से अलर्ट आता है।
- **ऑटो ट्रेलिंग SL:** मुनाफ़ा 1R होने पर SL अपने-आप ऊपर खिसकता है, और टारगेट छूने पर मुनाफ़ा लॉक हो जाता है।
- **एग्जिट संकेत पर अपने-आप बेचो:** ये चालू करेंगे तो 🔴 आते ही पोज़िशन अपने-आप बंद हो जाएगी।
- **3:20 पर ऑटो स्क्वेयर-ऑफ़** होता है।
- **सिग्नल का रिकॉर्ड:** हर सिग्नल के 15 और 30 मिनट बाद देखा जाता है कि भाव सही दिशा में 0.25 ATR से ज़्यादा चला या नहीं। "मज़बूत" और "हल्के" सिग्नल का हिसाब अलग रखा जाता है। ये भी दिखता है कि एग्जिट संकेत अनदेखा करने से कितना फ़र्क़ पड़ा।
- **सारा डेटा Firebase में सेव होता है**, यानी फ़ोन और लैपटॉप दोनों पर वही खाता दिखेगा।

👉 **सलाह:** कम से कम 3–4 हफ़्ते पेपर ट्रेड करें और "सिग्नल का रिकॉर्ड" देखें। अगर 30 मिनट बाद सही होने का % 55 से कम है, तो असली पैसा लगाने से पहले वज़न या नियम बदलें।

---

## ✅ सटीकता की जाँच

लाइव डेटा आने के बाद पहले दिन TradingView पर वही चार्ट खोलें, जैसे NIFTY 5 मिनट, और ये वैल्यू मिलाएँ: EMA 20/50, RSI 14, MACD (12, 26, 9), Supertrend (10, 3), ATR 14 और ADX 14। फ़ॉर्मूले TradingView वाले ही हैं, इसलिए ये लगभग बराबर आनी चाहिए। शुरुआती कुछ कैंडल्स में थोड़ा फ़र्क़ हो सकता है।

---

## ⚠️ ज़रूरी सीमाएँ (ईमानदारी से)

1. **इंडेक्स का वॉल्यूम नहीं आता** (NSE इंडेक्स का वॉल्यूम 0 होता है)। इसलिए VWAP की जगह **TWAP** और वॉल्यूम प्रोफ़ाइल की जगह **TPO प्रोफ़ाइल** इस्तेमाल होता है, और स्क्रीन पर ये साफ़ लिखा भी आता है।
2. **FII/DII का मुफ़्त API नहीं है।** "मार्केट मूड" टैब में आँकड़ा हाथ से डालें, नहीं तो ये संकेत स्कोर में नहीं गिना जाता।
3. **पेपर ट्रेड का SL/टारगेट तभी चेक होता है जब डैशबोर्ड खुला हो।** बंद करके वापस खोलेंगे तो उस वक़्त के भाव पर चेक होगा।
4. **हैवीवेट शेयरों के वज़न अनुमानित हैं** (`worker/src/index.js` में `HV`)। इन्हें कभी-कभी NSE/BSE से अपडेट कर लें।
5. **RSS न्यूज़ फ़ीड** कभी बदल या बंद हो सकती है। उन्हें `FEEDS` में बदल लें।
6. **चार्ज की दरें** (STT वगैरह) सरकार बदलती रहती है, `config.js` में अपडेट करें।
7. **Cloudflare का फ़्री प्लान** एक निजी यूज़र के लिए काफ़ी है। अगर "CPU limit" वाली एरर आए, तो $5/महीने का Workers Paid प्लान ले लें।

---

## 🛠️ दिक़्क़त आए तो

| दिक़्क़त | उपाय |
|---|---|
| "इस ईमेल को अनुमति नहीं है" | Worker का `ALLOWED_EMAIL` और Firebase rules का ईमेल एक जैसा होना चाहिए |
| "Upstox से कनेक्ट करें" बार-बार आता है | रोज़ सुबह एक बार कनेक्ट करना ज़रूरी है |
| Upstox लॉगिन के बाद "redirect_uri" एरर | Upstox app का Redirect URL और Worker का `UPSTOX_REDIRECT_URI` बिल्कुल एक जैसे हों |
| Google लॉगिन नहीं होता | Firebase → Authorized domains में अपनी साइट का डोमेन जोड़ें |
| CORS एरर | Worker का `FRONTEND_URL` बिल्कुल आपकी साइट का पता हो (https के साथ, आख़िर में `/` नहीं) |
| माइक नहीं चलता | Chrome इस्तेमाल करें, साइट https पर हो, और माइक की इजाज़त दें |
| ऑप्शन चेन ख़ाली | Upstox अकाउंट में F&O सेगमेंट चालू हो |
| न्यूज़ नहीं आती | Worker के `FEEDS` में दी गई फ़ीड ब्राउज़र में खोलकर देखें कि चल रही है या नहीं |

---

## 💰 ख़र्च

- Vercel, Cloudflare Workers और Firebase: फ़्री प्लान काफ़ी है
- Upstox API: उनकी मौजूदा फ़ीस जाँच लें
- Anthropic (वैकल्पिक): इस्तेमाल के हिसाब से, बहुत कम
