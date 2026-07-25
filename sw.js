// NosFit service worker — offline shell + background reminders
const CACHE = 'nosfit-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

// ---- shared kv (same shape as app) ----
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('nosfit', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function getSched() {
  return idb().then(db => new Promise((res) => {
    const g = db.transaction('kv', 'readonly').objectStore('kv').get('sched');
    g.onsuccess = () => res(g.result || null);
    g.onerror = () => res(null);
  }));
}
function putSched(obj) {
  return idb().then(db => { db.transaction('kv', 'readwrite').objectStore('kv').put(obj, 'sched'); });
}
function show(title, body) {
  return self.registration.showNotification(title, {
    body, icon: './icon-192.png', badge: './icon-192.png',
    tag: title + body, renotify: true, vibrate: [120, 60, 120]
  });
}

// Core check: fire pill + rest reminders based on clock + stored flags
async function runCheck() {
  const s = await getSched();
  if (!s || !s.enabled) return;
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  // new day resets fired flags implicitly (they are keyed by day in the app)
  if (s.day !== today) return; // app will refresh the record when opened
  const mins = now.getHours() * 60 + now.getMinutes();
  let changed = false;
  if (!s.pillTaken && mins >= 20 * 60 + 45 && mins < 21 * 60 && !s.firedPre) {
    await show('💊 NosFit', 'Faltam 15 min para a pilula da Daddys Girl!'); s.firedPre = true; changed = true;
  }
  if (!s.pillTaken && mins >= 21 * 60 && mins < 22 * 60 && !s.firedDue) {
    await show('💊 NosFit', 'Esta na hora da pilula! Sao 21:00.'); s.firedDue = true; changed = true;
  }
  if ((s.restGirl || s.restDaddy) && now.getHours() >= 9 && !s.firedRest) {
    await show('😴 NosFit', 'Hoje e dia de descanso — recupera e hidrata-te.'); s.firedRest = true; changed = true;
  }
  if (changed) await putSched(s);
}

self.addEventListener('periodicsync', e => { if (e.tag === 'nosfit') e.waitUntil(runCheck()); });
self.addEventListener('sync', e => { if (e.tag === 'nosfit') e.waitUntil(runCheck()); });
self.addEventListener('message', e => { if (e.data === 'check') e.waitUntil(runCheck()); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('./');
  }));
});
