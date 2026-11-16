// Service worker: zorgt dat de app ook zonder netwerk opent.
// Verhoog VERSIE bij elke nieuwe versie van de app, dan halen toestellen de nieuwe bestanden op.
const VERSIE = 'werkuren-v7';
const BESTANDEN = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-512.png',
  'js/app.js', 'js/bewerk.js', 'js/blokrij.js', 'js/db.js', 'js/facturen.js', 'js/formaat.js', 'js/historiek.js',
  'js/hulpen.js', 'js/instellingen.js', 'js/open.js', 'js/rekenen.js', 'js/staat.js', 'js/sync.js', 'js/vandaag.js',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSIE).then((c) => c.addAll(BESTANDEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys()
    .then((namen) => Promise.all(namen.filter((n) => n !== VERSIE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

// Eerst uit de cache (snel, werkt offline); op de achtergrond halen we een verse versie op.
self.addEventListener('fetch', (ev) => {
  const verzoek = ev.request;
  if (verzoek.method !== 'GET' || new URL(verzoek.url).origin !== self.location.origin) return;
  ev.respondWith(caches.open(VERSIE).then(async (cache) => {
    const bewaard = await cache.match(verzoek, { ignoreSearch: true });
    const vers = fetch(verzoek).then((antwoord) => {
      if (antwoord.ok) cache.put(verzoek, antwoord.clone());
      return antwoord;
    }).catch(() => null);
    if (bewaard) { ev.waitUntil(vers); return bewaard; }
    return (await vers) ?? new Response('Geen netwerk.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
