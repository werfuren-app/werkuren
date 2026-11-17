// Eén rij voor een blok, gebruikt op Vandaag en op Open uren. Tik = aanpassen.
import { h } from './hulpen.js';
import { duurMin, kmVan } from './rekenen.js';
import { fmtUmm, fmtTijd } from './formaat.js';
import { openBewerk } from './bewerk.js';

export const SOORT = { productief: 'Productief', onproductief: 'Onproductief', pauze: 'Pauze', camionette: 'Camionette' };

// `nuMin`: het huidige uur in minuten, als een lopend blok mag meetellen (alleen vandaag).
export function blokRij(r, nuMin = null) {
  const tijd = r.duur_min != null ? 'Duur'
    : `${fmtTijd(r.start)} – ${r.einde ? fmtTijd(r.einde) : nuMin != null ? 'nu' : 'loopt'}`;
  return h('li', null, h('button', { type: 'button', class: 'rij', onclick: () => openBewerk(r) },
    h('i', { class: `stip ${r.type}` }),
    h('span', { class: 'tijd' }, tijd),
    h('span', { class: 'wat' }, SOORT[r.type],
      (r.omschrijving || kmVan(r) > 0) && h('small', null, [kmVan(r) > 0 && `${kmVan(r)} km`, r.omschrijving].filter(Boolean).join(', '))),
    h('span', { class: 'duur' }, fmtUmm(duurMin(r, nuMin)))));
}
