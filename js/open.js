// Scherm "Open uren": alles wat nog niet gefactureerd is, en het blad "Factuur afsluiten".
import { h, keuze, veld, openBlad, sluitBlad, eenTegelijk } from './hulpen.js';
import * as db from './db.js';
import { data, staat, klant, maakId, herlaad, teken } from './staat.js';
import { isLopend, totalen, factuurTotaal, perDag, controles, opStart } from './rekenen.js';
import { fmtUmm, fmtDec, fmtEuro, fmtDag, fmtDatumKort, vandaagStr, volgendNummer } from './formaat.js';
import { urenToevoegen } from './vandaag.js';
import { blokRij } from './blokrij.js';

export const BTW_KEUZES = [['verlegd', 'Verlegd'], ['0', '0 %'], ['6', '6 %'], ['21', '21 %']];
export const btwKeuzeVan = (x) => (x.btw_verlegd ? 'verlegd' : String(Number(x.btw_pct) || 0));
export const btwUitKeuze = (k) => ({ btw_verlegd: k === 'verlegd', btw_pct: k === 'verlegd' ? 0 : Number(k) });

const openRegs = () => data.registraties.filter((r) => r.klant_id === staat.klantId && !r.factuur_id);

// Totalenlijst excl. btw, btw en incl. btw.
export function bedragenLijst(totaal, btwKeuze) {
  return h('dl', { class: 'som' },
    h('div', null, h('dt', null, 'Excl. btw'), h('dd', null, fmtEuro(totaal.exclCent))),
    h('div', null, h('dt', null, btwKeuze === 'verlegd' ? 'Btw verlegd' : `Btw ${btwKeuze} %`), h('dd', null, fmtEuro(totaal.btwCent))),
    h('div', { class: 'groot' }, h('dt', null, 'Incl. btw'), h('dd', null, fmtEuro(totaal.inclCent))));
}

function dagRij({ datum, blokken }) {
  const t = totalen(blokken);
  const open = staat.openDagen.has(datum);
  const wissel = () => { open ? staat.openDagen.delete(datum) : staat.openDagen.add(datum); teken(); };
  return h('li', null,
    h('button', { type: 'button', class: 'rij', 'aria-expanded': String(open), onclick: wissel },
      h('span', { class: 'tijd' }, fmtDag(datum)),
      h('span', { class: 'wat' }, fmtEuro(t.bedragCent)),
      h('span', { class: 'duur' }, fmtUmm(t.prodMin + t.onprodMin))),
    open && h('ul', { class: 'lijst binnen' }, [...blokken].sort(opStart).map((r) => blokRij(r))));
}

export function tekenOpen() {
  const regs = openRegs();
  const k = klant(staat.klantId);
  const t = totalen(regs);
  // Het bedrag zoals het op de factuur komt: uren afgerond op 2 decimalen × prijs.
  const factuur = factuurTotaal(regs, { afronden: true, btw_verlegd: true, btw_pct: 0 });
  const waarschuwingen = controles(regs, vandaagStr());

  const inhoud = regs.length ? [
    h('ul', { class: 'lijst' }, perDag(regs).map(dagRij)),
    h('dl', { class: 'som' },
      h('div', null, h('dt', null, 'Productief'), h('dd', null, `${fmtUmm(t.prodMin)} (${fmtDec(t.prodMin)} u)`)),
      h('div', null, h('dt', null, 'Onproductief'), h('dd', null, `${fmtUmm(t.onprodMin)} (${fmtDec(t.onprodMin)} u)`)),
      h('div', { class: 'groot' }, h('dt', null, 'Te factureren'), h('dd', null, fmtEuro(factuur.exclCent)))),
    factuur.exclCent !== t.bedragCent && h('p', { class: 'klein' },
      'Voor de factuur worden de uren afgerond op 2 decimalen, zoals in Dexxter. Daardoor kan het totaal enkele cent verschillen van de som van de dagen.'),
    waarschuwingen.length
      ? h('div', { class: 'melding waarschuwing' }, h('strong', null, 'Kijk dit na'),
        h('ul', null, waarschuwingen.map((w) => h('li', null, `${fmtDatumKort(w.datum)}: ${w.tekst}`))))
      : h('p', { class: 'klein' }, 'Geen waarschuwingen.'),
  ] : [h('p', { class: 'leeg' }, `Alles van ${k.naam} is gefactureerd. Nieuwe uren verschijnen hier, of voeg ze toe met Uren toevoegen.`)];

  const snel = (tekst, min) => h('button', { type: 'button', onclick: () => urenToevoegen(min) }, tekst);
  const duim = [
    h('div', { class: 'snel' }, snel('30 min', 30), snel('1 u', 60), snel('4 u', 240)),
    h('div', { class: 'knoppen' },
    h('button', { type: 'button', class: 'knop', onclick: () => urenToevoegen() }, 'Uren toevoegen'),
    h('button', { type: 'button', class: 'knop donker', disabled: !regs.length, onclick: openAfsluiten }, 'Factuur afsluiten')),
  ];
  return { titel: 'Open uren', inhoud, duim };
}

function openAfsluiten() {
  const regs = openRegs();
  const k = klant(staat.klantId);
  const datums = regs.map((r) => r.datum).sort();
  let btw = btwKeuzeVan(k);
  const van = h('input', { type: 'date', value: datums[0] });
  const tot = h('input', { type: 'date', value: datums[datums.length - 1] });
  // Het volgende nummer staat al ingevuld; pas het aan als Dexxter een ander nummer geeft.
  const nummer = h('input', { type: 'text', value: volgendNummer(data.facturen), placeholder: 'Mag je later invullen', maxlength: 40 });
  const overzicht = h('div');
  const fout = h('p', { class: 'fout', role: 'alert', hidden: true });

  const keuzeRegs = () => regs.filter((r) => r.datum >= van.value && r.datum <= tot.value);
  function toonOverzicht() {
    const sel = keuzeRegs();
    const totaal = factuurTotaal(sel, { afronden: true, ...btwUitKeuze(btw) });
    const dagen = new Set(sel.map((r) => r.datum)).size;
    overzicht.replaceChildren(bedragenLijst(totaal, btw),
      h('p', { class: 'klein' }, `${dagen} ${dagen === 1 ? 'dag' : 'dagen'} en ${sel.length} ${sel.length === 1 ? 'blok' : 'blokken'} worden vergrendeld.`));
  }
  van.oninput = tot.oninput = toonOverzicht;
  toonOverzicht();

  const sluitAf = eenTegelijk(async () => {
    const sel = keuzeRegs();
    const toon = (tekst) => { fout.textContent = tekst; fout.hidden = false; };
    if (!van.value || !tot.value || van.value > tot.value) return toon('Kies een geldige periode.');
    if (!sel.length) return toon('In deze periode staan geen open uren.');
    if (sel.some(isLopend)) return toon('Er loopt nog een blok in deze periode. Stop het eerst.');
    const volgnr = Math.max(0, ...data.facturen.filter((f) => f.klant_id === k.id).map((f) => f.volgnr || 0)) + 1;
    const factuur = {
      id: maakId(), volgnr, nummer: nummer.value.trim(), klant_id: k.id,
      periode_van: van.value, periode_tot: tot.value, datum: vandaagStr(),
      ...btwUitKeuze(btw), afronden: true, status: 'afgesloten', deleted_at: null,
    };
    await db.bewaarSamen({ facturen: [factuur], registraties: sel.map((r) => ({ ...r, factuur_id: factuur.id })) });
    await herlaad();
    sluitBlad();
    staat.tab = 'facturen';
    staat.factuurId = factuur.id;
    teken();
  });

  openBlad(h('form', { onsubmit: sluitAf, novalidate: true },
    h('h2', null, `Factuur afsluiten voor ${k.naam}`),
    h('div', { class: 'twee' }, veld('Van', van), veld('Tot en met', tot)),
    h('div', { class: 'veld' }, h('span', null, 'Btw'), keuze(BTW_KEUZES, btw, (w) => { btw = w; toonOverzicht(); })),
    veld('Factuurnummer uit Dexxter', nummer, 'Voorgesteld: één hoger dan je vorige factuur. Je kunt het aanpassen.'),
    overzicht, fout,
    h('div', { class: 'knoppen' },
      h('button', { class: 'knop', type: 'button', onclick: sluitBlad }, 'Annuleer'),
      h('button', { class: 'knop donker', type: 'submit' }, 'Sluit af'))));
}
