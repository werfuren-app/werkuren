// Scherm "Vandaag": starten, pauzeren, stoppen en snel een duur toevoegen.
// Hier staan bewust geen bedragen, alleen uren.
import { h, toast, eenTegelijk } from './hulpen.js';
import { data, staat, klant, teken, nieuweRegistratie, bewaarRegistratie, verwijderRegistratie, zetMeta } from './staat.js';
import { naarMin, isLopend, totalen, opStart } from './rekenen.js';
import { fmtUmm, fmtDec, fmtTijd, fmtDagLang, fmtDatumKort, vandaagStr, nuTijd } from './formaat.js';
import { openBewerk } from './bewerk.js';
import { SOORT, blokRij } from './blokrij.js';

// Start, Pauze en Stop lopen nooit door elkaar, ook niet bij dubbel tikken.
const actie = eenTegelijk((fn) => fn());
const lopendBlok = () => data.registraties.find(isLopend);

// Sluit het lopende blok af op het huidige uur. Geeft false als dat niet kon.
async function stopLopend(blok) {
  if (blok.datum !== vandaagStr()) {
    openBewerk(blok, `Dit blok is gestart op ${fmtDatumKort(blok.datum)}. Vul het einde in.`);
    return false;
  }
  const nu = nuTijd();
  if (naarMin(nu) < naarMin(blok.start)) {
    openBewerk(blok, `Dit blok start om ${fmtTijd(blok.start)}, later dan nu. Kijk de uren na.`);
    return false;
  }
  if (nu === blok.start) await verwijderRegistratie(blok);   // nog geen minuut gewerkt
  else await bewaarRegistratie({ ...blok, einde: nu });
  return true;
}

async function start(type, omschrijving = '') {
  const nu = nuTijd();          // het uur van de tik, niet van het moment waarop het bewaren klaar is
  const blok = lopendBlok();
  if (blok && blok.type === type && blok.klant_id === staat.klantId && blok.datum === vandaagStr()) {
    toast(`${SOORT[type]} loopt al.`);
    return;
  }
  if (blok && !(await stopLopend(blok))) return;
  await zetMeta('pauze', null);
  await bewaarRegistratie(nieuweRegistratie({ type, start: nu, omschrijving }));
}

async function pauzeOfHervat() {
  const blok = lopendBlok();
  const pauze = data.meta.pauze;
  if (blok) {
    // Tijd tussen twee blokken telt niet mee: er komt dus geen pauzeregel.
    await zetMeta('pauze', { type: blok.type, klant_id: blok.klant_id, omschrijving: blok.omschrijving, sinds: nuTijd(), datum: blok.datum });
    if (!(await stopLopend(blok))) await zetMeta('pauze', null);
  } else if (pauze) {
    if (klant(pauze.klant_id)) staat.klantId = pauze.klant_id;
    await start(pauze.type, pauze.omschrijving);
  }
}

async function stop() {
  const blok = lopendBlok();
  await zetMeta('pauze', null);
  if (blok) await stopLopend(blok);
  else teken();
}

function teller(soort, min, actief, onder) {
  return h('div', { class: `teller ${soort}${actief ? ' actief' : ''}` },
    h('p', null, SOORT[soort]),
    h('div', { class: 'klok' }, fmtUmm(min)),
    h('small', null, onder || ' '));
}

export function tekenVandaag() {
  const vandaag = vandaagStr();
  const nu = naarMin(nuTijd());
  const blok = lopendBlok();
  const pauze = data.meta.pauze?.datum === vandaag ? data.meta.pauze : null;
  const dag = data.registraties.filter((r) => r.datum === vandaag && r.klant_id === staat.klantId).sort(opStart);
  const t = totalen(dag, nu);
  const looptHier = blok && blok.klant_id === staat.klantId && blok.datum === vandaag ? blok : null;
  const sinds = looptHier ? `loopt sinds ${fmtTijd(looptHier.start)}` : '';

  const meldingen = [];
  if (blok && blok.datum !== vandaag) {
    meldingen.push(h('button', { type: 'button', class: 'melding', onclick: () => openBewerk(blok) },
      `Er loopt nog een blok van ${fmtDatumKort(blok.datum)} (start ${fmtTijd(blok.start)}). Tik om het einde in te vullen.`));
  } else if (blok && !looptHier) {
    meldingen.push(h('p', { class: 'melding' }, `Er loopt een blok voor ${klant(blok.klant_id)?.naam ?? 'een andere klant'}.`));
  }
  if (!blok && pauze) meldingen.push(h('p', { class: 'melding' }, `Pauze sinds ${fmtTijd(pauze.sinds)}. Tik op Hervat om verder te werken.`));

  const inhoud = [
    h('div', { class: 'tellers' },
      teller('productief', t.prodMin, looptHier?.type === 'productief', looptHier?.type === 'productief' && sinds),
      teller('onproductief', t.onprodMin, looptHier?.type === 'onproductief', looptHier?.type === 'onproductief' && sinds)),
    meldingen,
    dag.length
      ? h('ul', { class: 'lijst' }, dag.map((r) => blokRij(r, nu)))
      : h('p', { class: 'leeg' }, 'Nog niets geregistreerd vandaag. Tik op Start productief om te beginnen.'),
    dag.length > 0 && h('div', { class: 'totaal' }, h('span', null, 'Vandaag'), h('b', null, fmtUmm(t.prodMin + t.onprodMin))),
    dag.length > 0 && h('p', { class: 'klein' }, `${fmtDec(t.prodMin + t.onprodMin)} uur samen`),
  ];

  const snel = (tekst, min) => h('button', { type: 'button',
    onclick: () => openBewerk(nieuweRegistratie(min ? { duur_min: min } : {})) }, tekst);
  const duim = [
    h('div', { class: 'snel' }, snel('30 min', 30), snel('1 u', 60), snel('4 u', 240), snel('Andere', 0)),
    h('div', { class: 'knoppen' },
      h('button', { type: 'button', class: 'knop prod', onclick: () => actie(() => start('productief')) }, 'Start productief'),
      h('button', { type: 'button', class: 'knop onprod', onclick: () => actie(() => start('onproductief')) }, 'Start onproductief'),
      h('button', { type: 'button', class: 'knop', disabled: !blok && !pauze, onclick: () => actie(pauzeOfHervat) }, !blok && pauze ? 'Hervat' : 'Pauze'),
      h('button', { type: 'button', class: 'knop stop', disabled: !blok && !pauze, onclick: () => actie(stop) }, 'Stop')),
  ];
  return { titel: fmtDagLang(vandaag), inhoud, duim };
}
