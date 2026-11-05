// ===== यहाँ अपनी सेटिंग भरें =====
// WORKER_URL ख़ाली छोड़ेंगे तो डैशबोर्ड डेमो मोड (नकली डेटा) में चलेगा।
// लाइव मोड में भी डेमो देखना हो तो URL के आख़िर में ?demo=1 लगा दें।

window.APP_CONFIG = {
  WORKER_URL: 'https://fno-worker.raiabhinaykumar.workers.dev',

  // Firebase Console → Project settings → Your apps → Web app → config
  FIREBASE: {
    apiKey: 'AIzaSyCCPXD940xB5UhK39bLDzh-oANyy84uxOQ',
    authDomain: 'fno-dashboard-fa291.firebaseapp.com',
    projectId: 'fno-dashboard-fa291',
    appId: '1:84389860026:web:a7846125d91d8db471a883',
  },

  // पेपर ट्रेडिंग
  PAPER: {
    START_CAPITAL: 100000, // शुरुआती डमी पैसा (₹)
    SLIPPAGE_PCT: 0.5,     // bid/ask न मिले तो LTP पर इतना % स्लिपेज
    SQUARE_OFF_TIME: '15:20', // इस समय खुली पोज़िशन अपने-आप बंद
  },

  // ऑप्शन ख़रीद-बिक्री के चार्ज (अक्टूबर 2026 के हिसाब से, बदलें तो यहाँ अपडेट करें)
  CHARGES: {
    BROKERAGE: 20,         // ₹ प्रति ऑर्डर
    STT_SELL: 0.0015,      // बिक्री प्रीमियम पर 0.15% (1 अप्रैल 2026 से)
    NSE_TXN: 0.0003503,    // NSE ट्रांज़ैक्शन चार्ज
    BSE_TXN: 0.000325,     // BSE (Sensex) ट्रांज़ैक्शन चार्ज
    SEBI: 0.000001,        // ₹10 प्रति करोड़
    STAMP_BUY: 0.00003,    // ख़रीद पर 0.003%
    GST: 0.18,             // ब्रोकरेज + ट्रांज़ैक्शन + SEBI पर
  },

  // अगर API से लॉट साइज़ न मिले तो ये इस्तेमाल होंगे (2026)
  LOT_FALLBACK: { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 },

  // कितनी देर में डेटा रिफ़्रेश हो (मिलीसेकंड)
  POLL: { SNAPSHOT_MS: 5000, CANDLES_MS: 30000, NEWS_MS: 600000 },
};
