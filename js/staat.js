// Gedeelde toestand van de app: wat er op het scherm staat en de data uit de opslag.
import * as db from './db.js';
import { zetBinnenDagblok } from './rekenen.js';
import { vandaagStr } from './formaat.js';

export const staat = {
  tab: 'vandaag',
  klantId: null,
  factuurId: null,        // geopende factuur op het tabblad Facturen
  openDagen: new Set(),   // opengeklapte dagen op het tabblad Open uren
  periode: 'maand',       // overzicht op Open uren: dag, week of maand
  periodeStap: 0,         // 0 = huidige periode, -1 = vorige, ...
};

export const data = { klanten: [], registraties: [], facturen: [], meta: {} };

let tekenFn = () => {};
export const zetTeken = (fn) => { tekenFn = fn; };
export const teken = () => tekenFn();

export async function herlaad() {
  [data.klanten, data.registraties, data.facturen, data.meta] = await Promise.all([
    db.alle('klanten'), db.alle('registraties'), db.alle('facturen'), db.alleMeta(),
  ]);
  data.klanten.sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

export const maakId = () => crypto.randomUUID();
export const klant = (id) => data.klanten.find((k) => k.id === id);
export const factuurVan = (r) => (r.factuur_id ? data.facturen.find((f) => f.id === r.factuur_id) : null);
// Een registratie in een afgesloten factuur is vergrendeld.
export const isVergrendeld = (r) => factuurVan(r)?.status === 'afgesloten';

// Nieuwe registratie voor de gekozen klant. De tarieven worden nu vastgelegd.
export function nieuweRegistratie(velden = {}) {
  const k = klant(velden.klant_id ?? staat.klantId);
  return {
    id: maakId(), datum: vandaagStr(), start: null, einde: null, duur_min: null,
    type: 'productief', klant_id: k.id, omschrijving: '', binnen_dagblok: false,
    tarief_productief: k.tarief_productief, tarief_onproductief: k.tarief_onproductief,
    tarief_camionette: k.tarief_camionette ?? 0, tarief_km: k.tarief_km ?? 0,
    factuur_id: null, camionette: false, km_start: null, km_einde: null, volgnr: 0, deleted_at: null,
    ...velden,
  };
}

// Na elke wijziging aan een dag: herbereken welke blokken van productief afgaan.
// Vergrendelde blokken blijven ongemoeid.
async function herberekenDagen(datums) {
  await herlaad();
  const gewijzigd = [];
  for (const datum of new Set(datums)) {
    const dag = data.registraties.filter((r) => r.datum === datum);
    for (const { reg, waarde } of zetBinnenDagblok(dag)) {
      if (isVergrendeld(reg)) continue;
      reg.binnen_dagblok = waarde;
      gewijzigd.push(reg);
    }
  }
  if (gewijzigd.length) await db.bewaarVeel('registraties', gewijzigd);
  await herlaad();
  teken();
}

export async function bewaarRegistratie(r, andereDatums = []) {
  await db.bewaar('registraties', r);
  await herberekenDagen([r.datum, ...andereDatums]);
}

export async function verwijderRegistratie(r) {
  await db.verwijder('registraties', r.id);
  await herberekenDagen([r.datum]);
}

export async function zetMeta(sleutel, waarde) {
  data.meta[sleutel] = waarde;
  await db.zetMeta(sleutel, waarde);
}
