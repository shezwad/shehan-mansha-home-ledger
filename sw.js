'use strict';

const CACHE_NAME = 'home-ledger-app';
const FIREBASE_FILES = [
  'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js'
];
const APP_FILES = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './bootstrap.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  ...FIREBASE_FILES
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isFirebaseModule = FIREBASE_FILES.includes(url.href);

  if (isFirebaseModule) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Offline and resource not cached');
      })
  );
});
