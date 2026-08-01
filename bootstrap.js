import { firebaseConfig } from './firebase-config.js';

await import('./app.js');

let initializeApp;
let getAuth;
let setPersistence;
let browserLocalPersistence;
let onAuthStateChanged;
let signInWithEmailAndPassword;
let signOut;
let sendPasswordResetEmail;
let initializeFirestore;
let getFirestore;
let persistentLocalCache;
let persistentMultipleTabManager;
let doc;
let getDoc;
let setDoc;
let collection;
let onSnapshot;
let writeBatch;
let serverTimestamp;


const $ = selector => document.querySelector(selector);
const configReady = Object.values(firebaseConfig).every(value => value && !String(value).includes('REPLACE_WITH'));
const screens = ['#configScreen', '#authScreen', '#householdScreen'];
let firebaseApp;
let auth;
let db;
let unsubscribeListeners = [];
let initialSources = new Set();
let lastCloudState = null;
let writeQueue = Promise.resolve();
let pendingAuthMessage = '';

window.HomeLedgerCloud = {
  currentUser: null,
  householdId: null,
  householdCode: null,
  householdName: null,
  saveState: queueStateSave
};

function showScreen(selector) {
  document.body.classList.remove('app-ready');
  document.body.classList.add('cloud-loading');
  screens.forEach(id => $(id).hidden = id !== selector);
  $('#syncBanner').hidden = true;
}

function showApp() {
  screens.forEach(id => $(id).hidden = true);
  document.body.classList.remove('cloud-loading');
  document.body.classList.add('app-ready');
  $('#syncBanner').hidden = true;
  window.HomeLedgerApp.renderAll();
}

function showSync(message = 'Synchronizing household data…') {
  $('#syncBanner').textContent = message;
  $('#syncBanner').hidden = false;
}

function setError(element, message = '') {
  element.textContent = message;
  element.hidden = !message;
}

function friendlyError(error) {
  const code = String(error?.code || '');
  const messages = {
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/email-already-in-use': 'An account already exists for this email.',
    'auth/weak-password': 'Please choose a stronger password with at least 6 characters.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/admin-restricted-operation': 'New account registration is disabled for this private app.',
    'auth/operation-not-allowed': 'This sign-in operation is not enabled.',
    'auth/user-disabled': 'This account has been disabled.',
    'permission-denied': 'Firebase denied access. Confirm that the supplied Firestore rules were published.',
    'firestore/permission-denied': 'Firebase denied access. Confirm that the supplied Firestore rules were published.'
  };
  return messages[code] || error?.message || 'Something went wrong. Please try again.';
}


function clone(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function cleanDocument(data) {
  const result = clone(data);
  delete result.id;
  return result;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function statesEqual(a, b) {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

async function initializeCloud() {
  if (!configReady) {
    showScreen('#configScreen');
    return;
  }

  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js')
    ]);
    ({ initializeApp } = appSdk);
    ({
      getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged,
      signInWithEmailAndPassword, signOut, sendPasswordResetEmail
    } = authSdk);
    ({
      initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
      doc, getDoc, setDoc, collection, onSnapshot, writeBatch, serverTimestamp
    } = firestoreSdk);

    firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    await setPersistence(auth, browserLocalPersistence);
    try {
      db = initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      });
    } catch (persistenceError) {
      console.warn('Persistent offline cache is unavailable; using the standard Firestore cache.', persistenceError);
      db = getFirestore(firebaseApp);
    }
    bindCloudEvents();
    onAuthStateChanged(auth, handleAuthChange);
  } catch (error) {
    console.error(error);
    showScreen('#configScreen');
    const p = $('#configScreen p');
    if (p) p.insertAdjacentHTML('afterend', `<p class="form-error">${friendlyError(error)}</p>`);
  }
}

function bindCloudEvents() {
  $('#authForm').addEventListener('submit', async event => {
    event.preventDefault();
    setError($('#authError'));
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const button = $('#authSubmitButton');
    button.disabled = true;
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setError($('#authError'), friendlyError(error));
    } finally {
      button.disabled = false;
    }
  });

  $('#forgotPasswordButton').addEventListener('click', async () => {
    const email = $('#authEmail').value.trim();
    if (!email) {
      setError($('#authError'), 'Enter your email first, then tap “Forgot password?”');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setError($('#authError'));
      window.HomeLedgerApp.showToast('Password-reset email sent');
    } catch (error) {
      setError($('#authError'), friendlyError(error));
    }
  });

  $('#createHouseholdForm').addEventListener('submit', createHousehold);
  $('#onboardingSignOutButton').addEventListener('click', () => signOut(auth));
  $('#signOutButton').addEventListener('click', () => signOut(auth));
}

async function handleAuthChange(user) {
  cleanupListeners();
  window.HomeLedgerCloud.currentUser = user;
  window.HomeLedgerCloud.householdId = null;
  window.HomeLedgerCloud.householdCode = null;
  lastCloudState = null;

  if (!user) {
    showScreen('#authScreen');
    setError($('#authError'), pendingAuthMessage);
    pendingAuthMessage = '';
    return;
  }

  setError($('#authError'));
  showSync('Opening your private household…');
  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email: user.email || '',
        displayName: user.displayName || user.email?.split('@')[0] || 'Household account',
        createdAt: serverTimestamp()
      }, { merge: true });
      showScreen('#householdScreen');
      return;
    }

    const householdId = userSnap.data().householdId;
    if (!householdId) {
      showScreen('#householdScreen');
      return;
    }

    const householdSnap = await getDoc(doc(db, 'households', householdId));
    if (!householdSnap.exists()) {
      await setDoc(userRef, { householdId: null }, { merge: true });
      showScreen('#householdScreen');
      return;
    }
    await attachHousehold(householdId, householdSnap.data());
  } catch (error) {
    console.error(error);
    if (String(error?.code || '').includes('permission-denied')) {
      pendingAuthMessage = 'Access was denied. Publish the private Firestore rules supplied with Home Ledger.';
      await signOut(auth);
      return;
    }
    showScreen('#householdScreen');
    setError($('#householdError'), friendlyError(error));
  }
}

async function createHousehold(event) {
  event.preventDefault();
  setError($('#householdError'));
  const button = event.submitter;
  button.disabled = true;
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in first.');
    const householdRef = doc(collection(db, 'households'));
    const householdId = householdRef.id;
    const householdName = $('#newHouseholdName').value.trim() || 'Our Home Ledger';
    const batch = writeBatch(db);
    batch.set(householdRef, {
      name: householdName,
      ownerUid: user.uid,
      memberUids: [user.uid],
      privateAccess: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(db, 'users', user.uid), {
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Household account',
      householdId,
      updatedAt: serverTimestamp()
    }, { merge: true });
    batch.set(doc(db, 'households', householdId, 'settings', 'main'), {
      householdName,
      currency: 'USD'
    });
    const defaults = window.HomeLedgerApp.defaultState().fixedExpenses;
    defaults.forEach(item => batch.set(doc(db, 'households', householdId, 'fixedExpenses', item.id), cleanDocument(item)));
    await batch.commit();
    await attachHousehold(householdId, { name: householdName, ownerUid: user.uid, memberUids: [user.uid], privateAccess: true });
  } catch (error) {
    console.error(error);
    setError($('#householdError'), friendlyError(error));
  } finally {
    button.disabled = false;
  }
}

async function attachHousehold(householdId, household) {
  cleanupListeners();
  initialSources = new Set();
  lastCloudState = window.HomeLedgerApp.defaultState();
  lastCloudState.fixedExpenses = [];
  window.HomeLedgerCloud.householdId = householdId;
  window.HomeLedgerCloud.householdCode = null;
  window.HomeLedgerCloud.householdName = household.name || 'Home Ledger';
  showSync('Synchronizing household data…');

  const markReady = source => {
    initialSources.add(source);
    if (initialSources.size === 4) {
      window.HomeLedgerApp.applyCloudState(lastCloudState);
      showApp();
    }
  };

  unsubscribeListeners.push(onSnapshot(doc(db, 'households', householdId, 'settings', 'main'), snapshot => {
    const data = snapshot.exists() ? snapshot.data() : {};
    lastCloudState.settings = {
      householdName: data.householdName || household.name || 'Home Ledger',
      currency: data.currency || 'USD'
    };
    window.HomeLedgerApp.applyCloudState(lastCloudState);
    markReady('settings');
  }, handleSyncError));

  for (const key of ['periods', 'transactions', 'fixedExpenses']) {
    unsubscribeListeners.push(onSnapshot(collection(db, 'households', householdId, key), snapshot => {
      lastCloudState[key] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      window.HomeLedgerApp.applyCloudState(lastCloudState);
      markReady(key);
    }, handleSyncError));
  }
}

function handleSyncError(error) {
  console.error(error);
  $('#syncBanner').hidden = false;
  $('#syncBanner').textContent = friendlyError(error);
}

function cleanupListeners() {
  unsubscribeListeners.forEach(unsubscribe => { try { unsubscribe(); } catch {} });
  unsubscribeListeners = [];
}

function queueStateSave(nextState, message) {
  const householdId = window.HomeLedgerCloud.householdId;
  if (!householdId || !db) return;
  const desired = window.HomeLedgerApp.normalizeState(nextState);
  writeQueue = writeQueue
    .then(() => {
      if (window.HomeLedgerCloud.householdId !== householdId) return false;
      return syncState(desired, householdId).then(() => true);
    })
    .then(saved => { if (saved && message) window.HomeLedgerApp.showToast(message); })
    .catch(error => {
      console.error(error);
      window.HomeLedgerApp.showToast(friendlyError(error));
    });
}

async function syncState(next, householdId) {
  const previous = lastCloudState || window.HomeLedgerApp.defaultState();
  const operations = [];

  for (const key of ['periods', 'transactions', 'fixedExpenses']) {
    const previousMap = new Map((previous[key] || []).map(item => [item.id, item]));
    const nextMap = new Map((next[key] || []).map(item => [item.id, item]));
    for (const [id, item] of nextMap) {
      if (!previousMap.has(id) || !statesEqual(previousMap.get(id), item)) {
        operations.push({ type: 'set', ref: doc(db, 'households', householdId, key, id), data: cleanDocument(item) });
      }
    }
    for (const id of previousMap.keys()) {
      if (!nextMap.has(id)) operations.push({ type: 'delete', ref: doc(db, 'households', householdId, key, id) });
    }
  }

  if (!statesEqual(previous.settings, next.settings)) {
    operations.push({
      type: 'set',
      ref: doc(db, 'households', householdId, 'settings', 'main'),
      data: { householdName: next.settings.householdName || 'Home Ledger', currency: next.settings.currency || 'USD' }
    });
  }

  for (let index = 0; index < operations.length; index += 400) {
    const batch = writeBatch(db);
    operations.slice(index, index + 400).forEach(operation => {
      if (operation.type === 'set') batch.set(operation.ref, operation.data);
      else batch.delete(operation.ref);
    });
    await batch.commit();
  }
  lastCloudState = clone(next);
}

initializeCloud();
