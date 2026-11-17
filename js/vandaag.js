// Scherm "Vandaag": starten, pauzeren en stoppen. Uren achteraf toevoegen gebeurt op Open uren.
// Hier staan bewust geen bedragen, alleen uren.
import { h, toast, eenTegelijk, camionetteIcoon } from './hulpen.js';
import { data, staat, klant, teken, nieuweRegistratie, bewaarRegistratie, verwijderRegistratie, zetMeta } from './staat.js';
import { naarMin, isLopend, totalen, opStart, duurMin, isCamionette, camionetteTotaal, kmVan } from './rekenen.js';
import { fmtUmm, fmtDec, fmtTijd, fmtDagLang, fmtDatumKort, vandaagStr, nuTijd } from './formaat.js';
import { openBewerk } from './bewerk.js';
import { SOORT, blokRij } from './blokrij.js';

// Start, Pauze en Stop lopen nooit door elkaar, ook niet bij dubbel tikken.
const actie = eenTegelijk((fn) => fn());
// Het lopende werkblok; een camionetterit loopt los daarvan.
const lopendBlok = () => data.registraties.find((r) => isLopend(r) && !isCamionette(r));

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

// Eén helft onderaan de statuskaart: totaal van vandaag per soort.
function teller(soort, min, actief) {
  return h('div', { class: `teller ${soort}${actief ? ' actief' : ''}` },
    h('p', null, SOORT[soort]),
    h('b', null, fmtUmm(min)));
}

export function tekenVandaag() {
  const vandaag = vandaagStr();
  const nu = naarMin(nuTijd());
  const blok = lopendBlok();
  const pauze = data.meta.pauze?.datum === vandaag ? data.meta.pauze : null;
  const dag = data.registraties.filter((r) => r.datum === vandaag && r.klant_id === staat.klantId).sort(opStart);
  const t = totalen(dag, nu);
  const looptHier = blok && blok.klant_id === staat.klantId && blok.datum === vandaag ? blok : null;
  const gepauzeerd = !blok && pauze;

  // De statuskaart: wat er nu gebeurt, in één oogopslag.
  let toestand, klokMin, onder, soort = '';
  if (looptHier) {
    soort = looptHier.type;
    toestand = `${SOORT[looptHier.type]} loopt`;
    klokMin = duurMin(looptHier, nu);
    onder = `sinds ${fmtTijd(looptHier.start)}`;
  } else if (gepauzeerd) {
    soort = 'pauze';
    toestand = 'Pauze';
    klokMin = Math.max(0, nu - naarMin(pauze.sinds));
    onder = `sinds ${fmtTijd(pauze.sinds)}, tik op Hervat om verder te werken`;
  } else if (dag.length) {
    toestand = 'Gestopt';
    klokMin = t.prodMin + t.onprodMin;
    onder = `${fmtDec(t.prodMin + t.onprodMin)} uur gewerkt vandaag`;
  } else {
    toestand = 'Nog niet gestart';
    klokMin = 0;
    onder = 'Tik op Start productief om te beginnen';
  }
  const status = h('section', { class: `status ${soort}${looptHier ? ' loopt' : ''}`, 'aria-live': 'polite' },
    h('p', { class: 'toestand' }, toestand),
    h('div', { class: 'klok' }, fmtUmm(klokMin)),
    h('p', { class: 'onder' }, onder),
    h('div', { class: 'tellers' },
      teller('productief', t.prodMin, looptHier?.type === 'productief'),
      teller('onproductief', t.onprodMin, looptHier?.type === 'onproductief')));

  const meldingen = [];
  if (blok && blok.datum !== vandaag) {
    meldingen.push(h('button', { type: 'button', class: 'melding', onclick: () => openBewerk(blok) },
      `Er loopt nog een blok van ${fmtDatumKort(blok.datum)} (start ${fmtTijd(blok.start)}). Tik om het einde in te vullen.`));
  } else if (blok && !looptHier) {
    meldingen.push(h('p', { class: 'melding' }, `Er loopt een blok voor ${klant(blok.klant_id)?.naam ?? 'een andere klant'}.`));
  }

  const inhoud = [
    status,
    klant(staat.klantId)?.camionette && camionetteKaart(dag.filter(isCamionette), nu),
    meldingen,
    dag.length > 0 && h('ul', { class: 'lijst tijdlijn' }, dag.map((r) => blokRij(r, nu))),
  ];

  const loopt = (type) => String(looptHier?.type === type);
  const duim = [
    h('div', { class: 'knoppen' },
      h('button', { type: 'button', class: 'knop prod', 'aria-pressed': loopt('productief'), onclick: () => actie(() => start('productief')) }, 'Start productief'),
      h('button', { type: 'button', class: 'knop onprod', 'aria-pressed': loopt('onproductief'), onclick: () => actie(() => start('onproductief')) }, 'Start onproductief'),
      h('button', { type: 'button', class: 'knop', disabled: !blok && !pauze, onclick: () => actie(pauzeOfHervat) }, gepauzeerd ? 'Hervat' : 'Pauze'),
      h('button', { type: 'button', class: 'knop stop', disabled: !blok && !pauze, onclick: () => actie(stop) }, 'Stop')),
  ];
  return { titel: fmtDagLang(vandaag), inhoud, duim };
}

// Camionette: een eigen teller die los van de werkuren loopt, ook tijdens een pauze.
// De kilometerstanden vul je in de kaart zelf in; ze horen bij de laatste rit van vandaag.
function camionetteKaart(ritten, nu) {
  const loopt = ritten.find(isLopend);
  const laatste = loopt || [...ritten].sort(opStart).pop();
  const c = camionetteTotaal(ritten, nu);
  const startStop = () => actie(async () => {
    if (loopt) { await stopLopend(loopt); return; }
    await bewaarRegistratie(nieuweRegistratie({ type: 'camionette', start: nuTijd() }));
  });
  const kmVeld = (label, veld) => h('label', { class: 'cam-veld' }, h('span', null, label),
    h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: laatste[veld] ?? '', placeholder: 'Stand',
      onchange: async (ev) => {
        const v = ev.target.value === '' ? null : Math.round(Number(ev.target.value));
        if (v != null && !(v >= 0)) { toast('Vul een geldige kilometerstand in.'); return; }
        await bewaarRegistratie({ ...laatste, [veld]: v });
      } }));
  let gereden = 'Vul de begin- en eindstand in';
  if (laatste && laatste.km_start != null && laatste.km_einde != null) {
    gereden = laatste.km_einde < laatste.km_start ? 'De eindstand is lager dan de beginstand' : `${kmVan(laatste)} km gereden`;
  } else if (laatste && laatste.km_start != null) gereden = 'Vul de eindstand in bij aankomst';
  return h('section', { class: `cam-kaart${loopt ? ' loopt' : ''}` },
    h('div', { class: 'cam-kop' },
      camionetteIcoon(),
      h('div', { class: 'cam-tekst' },
        h('b', { class: 'cam-klok' }, fmtUmm(c.min)),
        h('small', null, loopt ? `Camionette loopt sinds ${fmtTijd(loopt.start)}` : ritten.length ? `Camionette, ${c.km} km vandaag` : 'Camionette')),
      h('button', { type: 'button', class: `cam-knop${loopt ? ' stop' : ''}`, onclick: startStop }, loopt ? 'Stop' : 'Start')),
    laatste && h('div', { class: 'cam-km' }, kmVeld('Begin km', 'km_start'), kmVeld('Eind km', 'km_einde')),
    laatste && h('p', { class: `cam-gereden${laatste.km_einde != null && laatste.km_start != null && laatste.km_einde < laatste.km_start ? ' fout' : ''}` }, gereden));
}

// Voor Open uren: een blok achteraf toevoegen voor de gekozen klant.
export const urenToevoegen = () => openBewerk(nieuweRegistratie({}));
