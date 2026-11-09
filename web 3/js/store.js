/* ===== लॉगिन (Firebase) और सेव करना: Firestore या इसी ब्राउज़र में ===== */
const Store = (() => {
  let auth = null, db = null, user = null, cloud = false, lsKey = 'fno_paper_local';
  const hasFirebase = () => { const f = APP_CONFIG.FIREBASE; return !!(f && f.apiKey && f.projectId && window.firebase); };
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* स्टोरेज बंद */ } },
  };

  function init(demo, onUser) {
    lsKey = demo ? 'fno_paper_demo' : 'fno_paper_local';
    if (demo || !hasFirebase()) { onUser(null); return; }
    firebase.initializeApp(APP_CONFIG.FIREBASE);
    auth = firebase.auth(); db = firebase.firestore();
    auth.onAuthStateChanged((u) => { user = u; cloud = !!u; onUser(u); });
  }
  async function signIn() {
    const p = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(p); } catch (e) {
      if (/popup/i.test(e.code || '')) await auth.signInWithRedirect(p); else throw e;
    }
  }
  const signOut = () => auth && auth.signOut();
  const idToken = async () => (user ? user.getIdToken() : null);
  const base = () => db.collection('users').doc(user.uid);

  async function load() {
    if (cloud) {
      const [acc, tr, sg] = await Promise.all([
        base().get(),
        base().collection('trades').orderBy('openedTs', 'desc').limit(300).get(),
        base().collection('signals').orderBy('ts', 'desc').limit(500).get(),
      ]);
      return { account: acc.exists ? acc.data().account : null, trades: tr.docs.map((d) => d.data()), signals: sg.docs.map((d) => d.data()) };
    }
    return ls.get(lsKey, { account: null, trades: [], signals: [] });
  }
  let localCache = null;
  function local() { if (!localCache) localCache = ls.get(lsKey, { account: null, trades: [], signals: [] }); return localCache; }
  async function saveAccount(account) {
    if (cloud) return base().set({ account }, { merge: true });
    const s = local(); s.account = account; ls.set(lsKey, s);
  }
  async function saveTrade(t) {
    if (cloud) return base().collection('trades').doc(t.id).set(t);
    const s = local(), i = s.trades.findIndex((x) => x.id === t.id);
    if (i >= 0) s.trades[i] = t; else s.trades.unshift(t);
    s.trades = s.trades.slice(0, 300); ls.set(lsKey, s);
  }
  async function saveSignal(x) {
    if (cloud) return base().collection('signals').doc(x.id).set(x);
    const s = local(), i = s.signals.findIndex((y) => y.id === x.id);
    if (i >= 0) s.signals[i] = x; else s.signals.unshift(x);
    s.signals = s.signals.slice(0, 500); ls.set(lsKey, s);
  }
  // what: { trades: bool, signals: bool } (default both)
  async function resetAll(what) {
    const W = what || { trades: true, signals: true }, cols = ['trades', 'signals'].filter((c) => W[c]);
    if (cloud) {
      for (const col of cols) {
        const snap = await base().collection(col).limit(500).get();
        const b = db.batch(); snap.docs.forEach((d) => b.delete(d.ref)); await b.commit();
      }
      return base().set({ account: null }, { merge: true });
    }
    const L = local(); localCache = { account: null, trades: W.trades ? [] : L.trades || [], signals: W.signals ? [] : L.signals || [] }; ls.set(lsKey, localCache);
  }
  // FII/DII (हाथ से डाला गया, आज की तारीख़ के लिए)
  const getFII = () => ls.get('fno_fii_' + istYmd(), null);
  const setFII = (v) => ls.set('fno_fii_' + istYmd(), v);
  // Watchlist: synced to Firestore when logged in (so phone and laptop share it), else this browser
  async function loadWatch(demo) {
    const lk = demo ? 'fno_watch_demo' : 'fno_watch';
    if (cloud) { try { const d = await base().get(); const w = d.exists && d.data().watch; if (Array.isArray(w)) { ls.set(lk, w); return w; } } catch (e) { /* offline: local copy */ } }
    return ls.get(lk, []);
  }
  async function saveWatch(list, demo) {
    ls.set(demo ? 'fno_watch_demo' : 'fno_watch', list);
    if (cloud) { try { await base().set({ watch: list }, { merge: true }); } catch (e) { /* keep local */ } }
  }
  const pref = (k, d) => ls.get('fno_pref_' + k, d);
  const setPref = (k, v) => ls.set('fno_pref_' + k, v);
  return { init, signIn, signOut, idToken, load, loadWatch, saveWatch, saveAccount, saveTrade, saveSignal, resetAll, getFII, setFII, pref, setPref, hasFirebase,
    get user() { return user; }, get cloud() { return cloud; } };
})();
