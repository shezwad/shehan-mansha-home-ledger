import { firebaseConfig } from './firebase-config.js';

await import('./app.js');

let initializeApp;
let getAuth;
let setPersistence;
let browserLocalPersistence;
let onAuthStateChanged;
let createUserWithEmailAndPassword;
let signInWithEmailAndPassword;
let updateProfile;
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
let arrayUnion;
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
    'permission-denied': 'Firebase denied access. Confirm that the supplied Firestore rules were published.',
    'firestore/permission-denied': 'Firebase denied access. Confirm that the supplied Firestore rules were published.'
  };
  return messages[code] || error?.message || 'Something went wrong. Please try again.';
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function formatCode(value) {
  const clean = normalizeCode(value);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
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
      createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
      signOut, sendPasswordResetEmail
    } = authSdk);
    ({
      initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
      doc, getDoc, setDoc, collection, onSnapshot, writeBatch, arrayUnion, serverTimestamp
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
  let signupMode = false;
  const applyMode = isSignup => {
    signupMode = isSignup;
    $('#showSignInButton').classList.toggle('active', !isSignup);
    $('#showSignUpButton').classList.toggle('active', isSignup);
    $('#displayNameField').hidden = !isSignup;
    $('#authDisplayName').required = isSignup;
    $('#authPassword').autocomplete = isSignup ? 'new-password' : 'current-password';
    $('#authTitle').textContent = isSignup ? 'Create your account' : 'Sign in';
    $('#authSubmitButton').textContent = isSignup ? 'Create account' : 'Sign in';
    $('#forgotPasswordButton').hidden = isSignup;
    setError($('#authError'));
  };

  $('#showSignInButton').addEventListener('click', () => applyMode(false));
  $('#showSignUpButton').addEventListener('click', () => applyMode(true));

  $('#authForm').addEventListener('submit', async event => {
    event.preventDefault();
    setError($('#authError'));
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const button = $('#authSubmitButton');
    button.disabled = true;
    try {
      if (signupMode) {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const displayName = $('#authDisplayName').value.trim();
        if (displayName) await updateProfile(credential.user, { displayName });
        await setDoc(doc(db, 'users', credential.user.uid), {
          email,
          displayName: displayName || email.split('@')[0],
          createdAt: serverTimestamp()
        }, { merge: true });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
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
  $('#joinHouseholdForm').addEventListener('submit', joinHousehold);
  $('#onboardingSignOutButton').addEventListener('click', () => signOut(auth));
  $('#signOutButton').addEventListener('click', () => signOut(auth));
  $('#copyHouseholdCodeButton').addEventListener('click', copyHouseholdCode);
  $('#joinCode').addEventListener('input', event => { event.target.value = formatCode(event.target.value); });
}

async function handleAuthChange(user) {
  cleanupListeners();
  window.HomeLedgerCloud.currentUser = user;
  window.HomeLedgerCloud.householdId = null;
  window.HomeLedgerCloud.householdCode = null;
  lastCloudState = null;

  if (!user) {
    showScreen('#authScreen');
    return;
  }

  showSync('Opening your household…');
  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email: user.email || '',
        displayName: user.displayName || user.email?.split('@')[0] || 'Household member',
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
    const householdRef = doc(collection(db, 'households'));
    const householdId = householdRef.id;
    const inviteCode = randomCode();
    const householdName = $('#newHouseholdName').value.trim() || 'Our Home Ledger';
    const batch = writeBatch(db);
    batch.set(householdRef, {
      name: householdName,
      ownerUid: user.uid,
      memberUids: [user.uid],
      inviteCode,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(db, 'users', user.uid), {
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Household member',
      householdId,
      updatedAt: serverTimestamp()
    }, { merge: true });
    batch.set(doc(db, 'invites', inviteCode), {
      code: inviteCode,
      householdId,
      active: true,
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });
    batch.set(doc(db, 'households', householdId, 'settings', 'main'), {
      householdName,
      currency: 'USD'
    });
    const defaults = window.HomeLedgerApp.defaultState().fixedExpenses;
    defaults.forEach(item => batch.set(doc(db, 'households', householdId, 'fixedExpenses', item.id), cleanDocument(item)));
    await batch.commit();
    await attachHousehold(householdId, { name: householdName, inviteCode, ownerUid: user.uid, memberUids: [user.uid] });
  } catch (error) {
    console.error(error);
    setError($('#householdError'), friendlyError(error));
  } finally {
    button.disabled = false;
  }
}

async function joinHousehold(event) {
  event.preventDefault();
  setError($('#householdError'));
  const button = event.submitter;
  button.disabled = true;
  try {
    const user = auth.currentUser;
    const inviteCode = normalizeCode($('#joinCode').value);
    const inviteSnap = await getDoc(doc(db, 'invites', inviteCode));
    if (!inviteSnap.exists() || inviteSnap.data().active !== true) throw new Error('That household code is invalid or no longer active.');
    const householdId = inviteSnap.data().householdId;
    const householdRef = doc(db, 'households', householdId);
    const batch = writeBatch(db);
    batch.update(householdRef, { memberUids: arrayUnion(user.uid), updatedAt: serverTimestamp() });
    batch.set(doc(db, 'users', user.uid), {
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Household member',
      householdId,
      updatedAt: serverTimestamp()
    }, { merge: true });
    await batch.commit();
    const householdSnap = await getDoc(householdRef);
    await attachHousehold(householdId, householdSnap.data());
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
  window.HomeLedgerCloud.householdCode = formatCode(household.inviteCode || '');
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

async function copyHouseholdCode() {
  const code = window.HomeLedgerCloud.householdCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const input = document.createElement('input');
    input.value = code;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  window.HomeLedgerApp.showToast('Household code copied');
}

initializeCloud();
