// Import van data/historiek.csv. Geen opslag hier: alleen omzetten naar rijen.
import { zetBinnenDagblok, perDag } from './rekenen.js';

// Leest CSV-tekst (met koprij) naar een lijst objecten. Ondersteunt velden tussen aanhalingstekens.
export function leesCsv(tekst) {
  const rijen = [];
  let rij = [], veld = '', inQuote = false;
  const t = tekst.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuote) {
      if (c === '"' && t[i + 1] === '"') { veld += '"'; i++; }
      else if (c === '"') inQuote = false;
      else veld += c;
    } else if (c === '"') inQuote = true;
    else if (c === ',') { rij.push(veld); veld = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      rij.push(veld); veld = '';
      if (rij.some((v) => v !== '')) rijen.push(rij);
      rij = [];
    } else veld += c;
  }
  rij.push(veld);
  if (rij.some((v) => v !== '')) rijen.push(rij);
  const [kop, ...rest] = rijen;
  if (!kop) return [];
  return rest.map((r) => Object.fromEntries(kop.map((naam, i) => [naam.trim(), (r[i] ?? '').trim()])));
}

// Zet CSV-rijen om naar klanten, facturen en registraties.
// `bestaandeKlanten`: klanten die al in de app zitten (op naam hergebruikt).
// `maakId`: functie die een nieuw id geeft.
export function historiekNaarRecords(rijen, bestaandeKlanten, maakId) {
  const klanten = new Map(bestaandeKlanten.map((k) => [k.naam, k]));
  const nieuweKlanten = [];
  const facturen = new Map();
  const registraties = [];

  rijen.forEach((rij, i) => {
    const types = ['productief', 'onproductief', 'pauze'];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rij.datum) || !types.includes(rij.type)) {
      throw new Error(`Regel ${i + 2}: de datum of de soort is ongeldig.`);
    }
    const fout = (tekst) => { throw new Error(`Regel ${i + 2}: ${tekst}`); };
    const getal = (v) => (v === '' || v == null ? NaN : Number(v));
    const tp = getal(rij.tarief_productief), to = getal(rij.tarief_onproductief);
    if (!(tp >= 0) || !(to >= 0)) fout('het tarief ontbreekt of is ongeldig.');
    if (!rij.klant) fout('de klant ontbreekt.');
    const uur = /^([01]?\d|2[0-3]):[0-5]\d$/;
    if (rij.duur_min) {
      if (!/^\d+$/.test(rij.duur_min) || Number(rij.duur_min) <= 0) fout('de duur moet een aantal minuten zijn.');
    } else {
      if (!uur.test(rij.start) || !uur.test(rij.einde)) fout('start en einde ontbreken of zijn ongeldig.');
      const min = (t) => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]);
      if (min(rij.einde) <= min(rij.start)) fout('het einde ligt niet na de start.');
    }
    let klant = klanten.get(rij.klant);
    if (!klant) {
      klant = { id: maakId(), naam: rij.klant, tarief_productief: tp, tarief_onproductief: to,
        btw_pct: 0, btw_verlegd: true, deleted_at: null };
      klanten.set(rij.klant, klant);
      nieuweKlanten.push(klant);
    }
    let factuur = null;
    if (rij.factuur) {
      const sleutel = `${klant.id}|${rij.factuur}`;
      factuur = facturen.get(sleutel);
      if (!factuur) {
        const volgnr = [...facturen.values()].filter((f) => f.klant_id === klant.id).length + 1;
        factuur = { id: maakId(), volgnr, nummer: rij.factuur, klant_id: klant.id,
          periode_van: rij.datum, periode_tot: rij.datum, datum: rij.datum,
          btw_pct: 0, btw_verlegd: true, afronden: false, status: 'afgesloten', deleted_at: null };
        facturen.set(sleutel, factuur);
      }
      if (rij.datum < factuur.periode_van) factuur.periode_van = rij.datum;
      if (rij.datum > factuur.periode_tot) factuur.periode_tot = factuur.datum = rij.datum;
    }
    const tijd = (t) => (t ? t.padStart(5, '0') : null);
    registraties.push({
      id: maakId(), datum: rij.datum, start: tijd(rij.start), einde: tijd(rij.einde),
      duur_min: rij.duur_min ? Number(rij.duur_min) : null, type: rij.type, klant_id: klant.id,
      omschrijving: rij.opmerking || '', binnen_dagblok: false,
      tarief_productief: tp, tarief_onproductief: to, factuur_id: factuur ? factuur.id : null,
      camionette: false, km_start: null, km_einde: null, volgnr: i, deleted_at: null,
    });
  });

  for (const { blokken } of perDag(registraties)) {
    for (const { reg, waarde } of zetBinnenDagblok(blokken)) reg.binnen_dagblok = waarde;
  }
  return { klanten: nieuweKlanten, facturen: [...facturen.values()], registraties };
}
