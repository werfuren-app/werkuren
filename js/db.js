// Opslag op het toestel (IndexedDB). Werkt volledig offline.
// Elke rij krijgt updated_at en vuil = true, zodat de latere sync weet wat te versturen.
// Verwijderen is altijd een soft delete (deleted_at).

const NAAM = 'werkuren';
const VERSIE = 1;
const TABELLEN = ['klanten', 'registraties', 'facturen'];
let dbBelofte;

// De sync wil weten wanneer er lokaal iets gewijzigd is.
let bijWijziging = () => {};
export const zetWijzigingLuisteraar = (fn) => { bijWijziging = fn; };
const meld = (resultaat) => { bijWijziging(); return resultaat; };

function open() {
  dbBelofte ??= new Promise((klaar, mislukt) => {
    const vraag = indexedDB.open(NAAM, VERSIE);
    vraag.onupgradeneeded = () => {
      const d = vraag.result;
      for (const t of TABELLEN) d.createObjectStore(t, { keyPath: 'id' });
      d.createObjectStore('meta', { keyPath: 'sleutel' });
    };
    vraag.onsuccess = () => klaar(vraag.result);
    vraag.onerror = () => mislukt(vraag.error);
  });
  return dbBelofte;
}

// Voert `werk` uit binnen één transactie en wacht tot die volledig is weggeschreven.
async function tx(tabel, wijze, werk) {
  const d = await open();
  return new Promise((klaar, mislukt) => {
    const t = d.transaction(tabel, wijze);
    const vraag = werk(t.objectStore(tabel));
    t.oncomplete = () => klaar(vraag?.result);
    t.onerror = t.onabort = () => mislukt(t.error);
  });
}

function stempel(rij) {
  // Altijd later dan de vorige versie van de rij, ook als de klok van een ander toestel voorloopt:
  // anders zou de server deze wijziging als "ouder" weigeren.
  const vorige = Date.parse(rij.updated_at) || 0;
  const nu = new Date(Math.max(Date.now(), vorige + 1)).toISOString();
  rij.created_at ??= nu;
  rij.updated_at = nu;
  rij.vuil = true;
  return rij;
}

// Alle rijen die niet verwijderd zijn.
export async function alle(tabel) {
  return (await tx(tabel, 'readonly', (o) => o.getAll())).filter((r) => !r.deleted_at);
}

export function bewaar(tabel, rij) {
  return tx(tabel, 'readwrite', (o) => o.put(stempel(rij))).then(meld);
}

// Bewaart meerdere rijen in één transactie: alles of niets.
export function bewaarVeel(tabel, rijen) {
  return tx(tabel, 'readwrite', (o) => { for (const r of rijen) o.put(stempel(r)); }).then(meld);
}

// Bewaart rijen in meerdere tabellen in één transactie: alles of niets.
// `perTabel`: { klanten: [...], facturen: [...], registraties: [...] }; `meta`: { sleutel: waarde }.
export async function bewaarSamen(perTabel, meta = {}) {
  const d = await open();
  const namen = [...Object.keys(perTabel), ...(Object.keys(meta).length ? ['meta'] : [])];
  return new Promise((klaar, mislukt) => {
    const t = d.transaction(namen, 'readwrite');
    for (const [tabel, rijen] of Object.entries(perTabel)) {
      for (const r of rijen) t.objectStore(tabel).put(stempel(r));
    }
    for (const [sleutel, waarde] of Object.entries(meta)) t.objectStore('meta').put({ sleutel, waarde });
    t.oncomplete = () => klaar(meld());
    t.onerror = t.onabort = () => mislukt(t.error);
  });
}

// --- Voor de sync ---

// Markeert alle rijen als te versturen, zonder hun wijzigingstijd aan te passen.
export async function markeerAllesVuil() {
  for (const tabel of TABELLEN) {
    const rijen = await tx(tabel, 'readonly', (o) => o.getAll());
    await tx(tabel, 'readwrite', (o) => { for (const r of rijen) o.put({ ...r, vuil: true }); });
  }
}

// Alle rijen die nog naar de server moeten (ook verwijderde).
export async function vuile(tabel) {
  return (await tx(tabel, 'readonly', (o) => o.getAll())).filter((r) => r.vuil);
}

// Leest en schrijft rijen in één transactie. `beslis(lokaal, rij)` geeft de rij om te bewaren, of null.
async function werkBij(tabel, rijen, beslis) {
  const d = await open();
  let aantal = 0;
  return new Promise((klaar, mislukt) => {
    const t = d.transaction(tabel, 'readwrite');
    const o = t.objectStore(tabel);
    for (const rij of rijen) {
      const vraag = o.get(rij.id);
      vraag.onsuccess = () => {
        const nieuw = beslis(vraag.result, rij);
        if (nieuw) { o.put(nieuw); aantal++; }
      };
    }
    t.oncomplete = () => klaar(aantal);
    t.onerror = t.onabort = () => mislukt(t.error);
  });
}

// Past rijen van de server toe. Een lokale wijziging die nog niet verstuurd is,
// blijft alleen staan als ze nieuwer is (laatste wijziging wint). Geeft het aantal gewijzigde rijen.
export function pasServerToe(tabel, serverRijen) {
  return werkBij(tabel, serverRijen, (lokaal, server) => {
    if (lokaal) {
      const l = Date.parse(lokaal.updated_at), s = Date.parse(server.updated_at);
      if (lokaal.vuil && l > s) return null;
      if (!lokaal.vuil && l === s) return null;     // al gelijk
    }
    return { ...server, vuil: false };
  });
}

// Na een geslaagde verzending: de rij hoeft niet meer verstuurd te worden,
// tenzij ze intussen opnieuw gewijzigd is.
export function markeerVerstuurd(tabel, verstuurd) {
  return werkBij(tabel, verstuurd, (lokaal, rij) =>
    (lokaal && lokaal.updated_at === rij.updated_at ? { ...lokaal, vuil: false } : null));
}

export async function verwijder(tabel, id) {
  const rij = await tx(tabel, 'readonly', (o) => o.get(id));
  if (!rij) return;
  rij.deleted_at = new Date().toISOString();
  return bewaar(tabel, rij);
}

export async function alleMeta() {
  const rijen = await tx('meta', 'readonly', (o) => o.getAll());
  return Object.fromEntries(rijen.map((r) => [r.sleutel, r.waarde]));
}

export function zetMeta(sleutel, waarde) {
  return tx('meta', 'readwrite', (o) => o.put({ sleutel, waarde }));
}

// Alles, ook verwijderde rijen: voor de reservekopie.
export async function reservekopie() {
  const uit = {};
  for (const t of TABELLEN) uit[t] = await tx(t, 'readonly', (o) => o.getAll());
  return uit;
}
