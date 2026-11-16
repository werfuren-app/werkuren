// Synchronisatie met Supabase. De app werkt altijd eerst lokaal; dit bestand stuurt
// wijzigingen door en haalt op wat op andere toestellen veranderd is.
// Geen extra bibliotheek: we spreken de Supabase-API rechtstreeks aan met fetch.
// Conflictregel: de laatste wijziging wint (updated_at). Verwijderen = deleted_at.
import * as db from './db.js';
import { data, herlaad, teken, zetMeta } from './staat.js';

// Volgorde telt: klanten eerst, dan facturen, dan registraties (verwijzingen).
const VELDEN = {
  klanten: ['id', 'naam', 'tarief_productief', 'tarief_onproductief', 'btw_pct', 'btw_verlegd',
    'created_at', 'updated_at', 'deleted_at'],
  facturen: ['id', 'volgnr', 'nummer', 'klant_id', 'periode_van', 'periode_tot', 'datum', 'btw_pct',
    'btw_verlegd', 'afronden', 'status', 'created_at', 'updated_at', 'deleted_at'],
  registraties: ['id', 'datum', 'start', 'einde', 'duur_min', 'type', 'klant_id', 'omschrijving',
    'binnen_dagblok', 'tarief_productief', 'tarief_onproductief', 'factuur_id', 'camionette',
    'km_start', 'km_einde', 'volgnr', 'created_at', 'updated_at', 'deleted_at'],
};
const TABELLEN = Object.keys(VELDEN);
const GETALLEN = ['tarief_productief', 'tarief_onproductief', 'btw_pct'];
const PAGINA = 1000;
const PAKKET = 200;
const OVERLAP_MS = 2 * 60 * 1000;

class LoginNodig extends Error {}

// toestand: 'uit' (niet gekoppeld), 'bezig', 'ok', 'offline', 'fout' of 'login' (opnieuw aanmelden)
const status = { toestand: 'uit', laatst: null, fout: '', wachtend: 0 };
let bijStatus = () => {};
export const syncStatus = () => status;
export const zetStatusLuisteraar = (fn) => { bijStatus = fn; };
function zetStatus(toestand, fout = '') {
  Object.assign(status, { toestand, fout });
  bijStatus();
}

const config = () => data.meta.sync ?? null;
export const isGekoppeld = () => !!config()?.sessie;
export const syncEmail = () => config()?.email ?? '';

function kop(sleutel, token) {
  return { apikey: sleutel, Authorization: `Bearer ${token ?? sleutel}`, 'Content-Type': 'application/json' };
}

async function foutTekst(antwoord) {
  try {
    const j = await antwoord.json();
    return j.msg || j.error_description || j.message || j.error || `fout ${antwoord.status}`;
  } catch { return `fout ${antwoord.status}`; }
}

function bewaarSessie(c, j) {
  const sessie = { access_token: j.access_token, refresh_token: j.refresh_token,
    verloopt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return zetMeta('sync', { ...c, sessie });
}

// Meldt aan met e-mail en wachtwoord. Het wachtwoord wordt nergens bewaard;
// het toestel houdt alleen de sessie bij en verlengt die zelf.
export async function meldAan(url, sleutel, email, wachtwoord) {
  const basis = url.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(basis)) throw new Error('Het adres moet beginnen met https:// en mag geen pad bevatten.');
  let antwoord;
  try {
    antwoord = await fetch(`${basis}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: kop(sleutel.trim()), body: JSON.stringify({ email: email.trim(), password: wachtwoord }),
    });
  } catch { throw new Error('Geen verbinding met Supabase. Kijk het adres en je netwerk na.'); }
  if (!antwoord.ok) throw new Error(`Aanmelden lukte niet: ${await foutTekst(antwoord)}.`);
  // Een ander project of een ander account: begin de sync opnieuw, anders zou de bestaande
  // data nooit naar de nieuwe plek gaan.
  const vorige = config();
  if (vorige && (vorige.url !== basis || vorige.email !== email.trim())) {
    await db.markeerAllesVuil();
    for (const t of TABELLEN) await zetMeta(`sync_cursor_${t}`, null);
    await zetMeta('sync_laatst', null);
    status.laatst = null;
  }
  await bewaarSessie({ url: basis, sleutel: sleutel.trim(), email: email.trim() }, await antwoord.json());
  syncNu();
}

// Meldt af op dit toestel. De gegevens blijven op het toestel staan.
export async function meldAf() {
  const c = config();
  if (c) await zetMeta('sync', { url: c.url, sleutel: c.sleutel, email: c.email, afgemeld: true });
  zetStatus('uit');
}

// Geeft een geldig toegangstoken; verlengt de sessie als die bijna verloopt.
async function token() {
  let c = config();
  if (!c?.sessie) throw new LoginNodig();
  if (c.sessie.verloopt - Date.now() > 60000) return c.sessie.access_token;
  const antwoord = await fetch(`${c.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: kop(c.sleutel), body: JSON.stringify({ refresh_token: c.sessie.refresh_token }),
  });
  if ([400, 401, 403].includes(antwoord.status)) {
    await zetMeta('sync', { url: c.url, sleutel: c.sleutel, email: c.email });
    throw new LoginNodig();
  }
  if (!antwoord.ok) throw new Error(await foutTekst(antwoord));
  await bewaarSessie(c, await antwoord.json());
  c = config();
  return c.sessie.access_token;
}

function naarServer(tabel, rij) {
  const uit = {};
  for (const v of VELDEN[tabel]) uit[v] = rij[v] ?? null;
  if ('omschrijving' in uit) uit.omschrijving ??= '';
  if ('nummer' in uit) uit.nummer ??= '';
  return uit;
}

function vanServer(tabel, rij) {
  const uit = {};
  for (const v of VELDEN[tabel]) uit[v] = rij[v] ?? null;
  for (const v of GETALLEN) if (uit[v] != null) uit[v] = Number(uit[v]);
  for (const v of ['start', 'einde']) if (uit[v]) uit[v] = uit[v].slice(0, 5);   // "08:30:00" -> "08:30"
  return uit;
}

// Haalt op wat sinds de vorige keer op de server veranderd is. Geeft het aantal toegepaste rijen.
async function haalOp(tabel, tk) {
  const c = config();
  const sleutel = `sync_cursor_${tabel}`;
  // Twee minuten overlap: een wijziging van een ander toestel kan iets later bevestigd worden
  // met een vroegere servertijd. Dubbel ophalen is onschadelijk, missen niet.
  const cursor = data.meta[sleutel];
  const sinds = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
  const rijen = [];
  for (let vanaf = 0; ; vanaf += PAGINA) {
    const adres = `${c.url}/rest/v1/${tabel}?select=*&gesynct_op=gte.${encodeURIComponent(sinds)}`
      + `&order=gesynct_op.asc,id.asc&limit=${PAGINA}&offset=${vanaf}`;
    const antwoord = await fetch(adres, { headers: kop(c.sleutel, tk) });
    if (antwoord.status === 401) throw new LoginNodig();
    if (!antwoord.ok) throw new Error(`${tabel} ophalen: ${await foutTekst(antwoord)}`);
    const pagina = await antwoord.json();
    rijen.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  if (!rijen.length) return 0;
  const toegepast = await db.pasServerToe(tabel, rijen.map((r) => vanServer(tabel, r)));
  await zetMeta(sleutel, rijen[rijen.length - 1].gesynct_op);
  return toegepast;
}

// Verstuurt alle lokale wijzigingen van één tabel.
async function verstuur(tabel, tk) {
  const c = config();
  const vuil = await db.vuile(tabel);
  for (let i = 0; i < vuil.length; i += PAKKET) {
    const pakket = vuil.slice(i, i + PAKKET);
    const antwoord = await fetch(`${c.url}/rest/v1/${tabel}?on_conflict=id`, {
      method: 'POST',
      headers: { ...kop(c.sleutel, tk), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(pakket.map((r) => naarServer(tabel, r))),
    });
    if (antwoord.status === 401) throw new LoginNodig();
    if (!antwoord.ok) throw new Error(`${tabel} versturen: ${await foutTekst(antwoord)}`);
    await db.markeerVerstuurd(tabel, pakket);
  }
}

async function telWachtend() {
  let n = 0;
  for (const t of TABELLEN) n += (await db.vuile(t)).length;
  status.wachtend = n;
}

let bezig = false;
let nogEens = false;

// Eén volledige sync: eerst ophalen, dan versturen. Loopt nooit twee keer tegelijk.
export async function syncNu() {
  if (!isGekoppeld()) {
    await telWachtend();
    const c = config();
    return zetStatus(c && !c.afgemeld ? 'login' : 'uit');   // 'login' alleen als de sessie verlopen is
  }
  if (bezig) { nogEens = true; return undefined; }
  bezig = true;
  zetStatus('bezig');
  try {
    do {
      nogEens = false;
      const tk = await token();
      let toegepast = 0;
      for (const t of TABELLEN) toegepast += await haalOp(t, tk);
      for (const t of TABELLEN) await verstuur(t, tk);
      if (toegepast) { await herlaad(); teken(); }
    } while (nogEens);
    status.laatst = new Date().toISOString();
    await zetMeta('sync_laatst', status.laatst);
    await telWachtend();
    zetStatus('ok');
  } catch (fout) {
    await telWachtend();
    if (fout instanceof LoginNodig) zetStatus('login');
    else if (fout instanceof TypeError || !navigator.onLine) zetStatus('offline');   // fetch faalt = geen netwerk
    else zetStatus('fout', fout.message);
  } finally {
    bezig = false;
  }
  return undefined;
}

// Start de automatische sync: bij opstart, na elke wijziging, bij terugkeer van netwerk
// of van de app, en elke 5 minuten.
export function startSync() {
  status.laatst = data.meta.sync_laatst ?? null;
  let timer;
  const straks = () => { clearTimeout(timer); timer = setTimeout(syncNu, 2000); };
  db.zetWijzigingLuisteraar(() => {
    if (!config()) return;
    telWachtend().then(bijStatus);
    if (isGekoppeld()) straks();
  });
  window.addEventListener('online', syncNu);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNu(); });
  setInterval(syncNu, 5 * 60 * 1000);
  syncNu();
}
