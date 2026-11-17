// Service worker: zorgt dat de app ook zonder netwerk opent.
// Verhoog VERSIE bij elke nieuwe versie van de app, dan halen toestellen de nieuwe bestanden op.
const VERSIE = 'werkuren-v12';
const BESTANDEN = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-512.png',
  'js/app.js', 'js/bewerk.js', 'js/blokrij.js', 'js/db.js', 'js/facturen.js', 'js/formaat.js', 'js/historiek.js',
  'js/hulpen.js', 'js/instellingen.js', 'js/open.js', 'js/rekenen.js', 'js/staat.js', 'js/sync.js', 'js/vandaag.js',
];

// cache: 'reload' slaat de browsercache over: anders kan een nieuwe versie oude bestanden van GitHub binnenhalen.
self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSIE)
    .then((c) => c.addAll(BESTANDEN.map((b) => new Request(b, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys()
    .then((namen) => Promise.all(namen.filter((n) => n !== VERSIE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

// Uit de cache (snel, werkt offline). De cache bevat altijd één volledige versie van de app;
// een nieuwe versie komt alleen binnen via een nieuwe VERSIE, nooit bestand per bestand,
// zodat oude en nieuwe bestanden nooit door elkaar lopen.
self.addEventListener('fetch', (ev) => {
  const verzoek = ev.request;
  if (verzoek.method !== 'GET' || new URL(verzoek.url).origin !== self.location.origin) return;
  ev.respondWith(caches.open(VERSIE).then(async (cache) => {
    const bewaard = await cache.match(verzoek, { ignoreSearch: true });
    if (bewaard) return bewaard;
    try {
      return await fetch(verzoek);
    } catch {
      return new Response('Geen netwerk.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  }));
});
