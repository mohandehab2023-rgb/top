// TOP FITNESS — Service Worker (Network-First Strategy)
// نستخدم Network-First بدلاً من Cache-First لأن البيانات تتغير لحظياً من السحابة.
// الكاش يُستخدم فقط كشبكة أمان لو الإنترنت انقطع.

const CACHE_NAME = 'topfitness-v3';
const STATIC_ASSETS = [
    './index.html',
    './style.css',
    './script.js',
    './mobile.js',
    './config.js',
    './supabase-bridge.js',
    './mock-electron.js',
    './chart.min.js',
    './assets/icon.png'
];

// Pre-cache static assets on install
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Clean up old caches on activate
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Network-first fetch strategy
self.addEventListener('fetch', event => {
    // Skip non-GET requests and Supabase API calls (always go to network)
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('supabase.co')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Cache successful responses for offline fallback
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
