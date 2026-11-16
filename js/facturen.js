// Scherm "Facturen": lijst per klant en een factuur met kant-en-klare lijnen voor Dexxter.
import { h, keuze, veld, openBlad, sluitBlad, vraag, toast, kopieer, eenTegelijk } from './hulpen.js';
import * as db from './db.js';
import { data, staat, klant, herlaad, teken } from './staat.js';
import { totalen, factuurTotaal, perDag } from './rekenen.js';
import { fmtUmm, fmtGetal, fmtEuro, fmtDag, periodeTekst, volgendNummer } from './formaat.js';
import { bedragenLijst, btwKeuzeVan, btwUitKeuze, BTW_KEUZES } from './open.js';

const regsVan = (f) => data.registraties.filter((r) => r.factuur_id === f.id);
const naamVan = (f) => (f.nummer ? `Factuur ${f.nummer}` : 'Factuur zonder nummer');

export function tekenFacturen() {
  const factuur = data.facturen.find((f) => f.id === staat.factuurId && f.klant_id === staat.klantId);
  return factuur ? tekenFactuur(factuur) : tekenLijst();
}

// Som van alle facturen van één klant (excl. btw, btw, incl. btw), in centen.
function klantTotaal(klantId) {
  const som = { aantal: 0, exclCent: 0, btwCent: 0, inclCent: 0 };
  for (const f of data.facturen.filter((x) => x.klant_id === klantId)) {
    const t = factuurTotaal(regsVan(f), f);
    som.aantal++;
    som.exclCent += t.exclCent;
    som.btwCent += t.btwCent;
    som.inclCent += t.inclCent;
  }
  return som;
}

function tekenLijst() {
  const k = klant(staat.klantId);
  const lijst = data.facturen.filter((f) => f.klant_id === staat.klantId).sort((a, b) => b.periode_tot.localeCompare(a.periode_tot) || b.volgnr - a.volgnr);
  const som = klantTotaal(staat.klantId);
  const andere = data.klanten.filter((x) => klantTotaal(x.id).aantal > 0);
  const inhoud = lijst.length
    ? [
      h('section', { class: 'kaart' },
        h('p', { class: 'kaart-titel' }, `${k.naam}, ${som.aantal} ${som.aantal === 1 ? 'factuur' : 'facturen'}`),
        h('dl', { class: 'som' },
          h('div', null, h('dt', null, 'Excl. btw'), h('dd', null, fmtEuro(som.exclCent))),
          h('div', null, h('dt', null, 'Btw'), h('dd', null, fmtEuro(som.btwCent))),
          h('div', { class: 'groot' }, h('dt', null, 'Totaal gefactureerd'), h('dd', null, fmtEuro(som.inclCent))))),
      h('ul', { class: 'lijst' }, lijst.map((f) => {
        const totaal = factuurTotaal(regsVan(f), f);
        return h('li', null, h('button', { type: 'button', class: 'rij', onclick: () => { staat.factuurId = f.id; teken(); } },
          h('span', { class: 'wat' }, naamVan(f), h('small', null, `${periodeTekst(f.periode_van, f.periode_tot)}${f.status === 'open' ? ', ontgrendeld' : ''}`)),
          h('span', { class: 'duur' }, fmtEuro(totaal.inclCent))));
      })),
    ]
    : [h('p', { class: 'leeg' }, `Nog geen facturen voor ${k.naam}. Sluit er een af op het tabblad Open uren.`)];
  // Met meer dan één klant: per klant het totaal, en alles samen.
  if (andere.length > 1) {
    const totalen_ = andere.map((x) => ({ k: x, som: klantTotaal(x.id) }));
    inhoud.push(h('h3', null, 'Alle klanten'), h('dl', { class: 'som' },
      totalen_.map(({ k: x, som: s }) => h('div', null, h('dt', null, `${x.naam} (${s.aantal})`), h('dd', null, fmtEuro(s.inclCent)))),
      h('div', { class: 'groot' }, h('dt', null, 'Samen, incl. btw'), h('dd', null, fmtEuro(totalen_.reduce((a, t) => a + t.som.inclCent, 0))))));
  }
  return { titel: 'Facturen', inhoud, duim: [] };
}

// Eén veld met een grote kopieerknop. `kopie` is wat op het klembord komt (standaard de getoonde tekst).
function kopieerRij(label, tekst, kopie = tekst) {
  const knop = h('button', { type: 'button', class: 'k', onclick: async () => {
    if (await kopieer(kopie)) {
      knop.textContent = 'Gekopieerd';
      knop.classList.add('klaar');
      setTimeout(() => { knop.textContent = 'Kopieer'; knop.classList.remove('klaar'); }, 2000);
    } else toast('Kopiëren lukte niet. Houd de tekst ingedrukt om te kopiëren.');
  } }, 'Kopieer');
  return h('div', { class: 'kopieer' }, h('div', null, h('small', null, label), h('b', null, tekst)), knop);
}

function tekenFactuur(f) {
  const regs = regsVan(f);
  const totaal = factuurTotaal(regs, f);
  const periode = periodeTekst(f.periode_van, f.periode_tot);
  const afgesloten = f.status === 'afgesloten';

  const lijnen = totaal.lijnen.map((l) => h('section', { class: 'lijn' },
    kopieerRij('Omschrijving', `${l.soort === 'productief' ? 'Productieve' : 'Onproductieve'} uren ${periode}`),
    kopieerRij('Aantal (uur)', fmtGetal(l.aantalHonderdsten)),
    kopieerRij('Prijs per uur, excl. btw', fmtGetal(l.prijsCent)),
    f.btw_verlegd
      ? kopieerRij('Btw', 'Btw verlegd (0 %)', 'Btw verlegd')
      : kopieerRij('Btw %', `${Number(f.btw_pct) || 0} %`, String(Number(f.btw_pct) || 0)),
    h('p', { class: 'klein' }, `Totaal van deze lijn: ${fmtEuro(l.bedragCent)}`)));

  const inhoud = [
    h('button', { type: 'button', class: 'terug', onclick: () => { staat.factuurId = null; teken(); } }, 'Alle facturen'),
    h('button', { type: 'button', class: 'nummer', onclick: () => wijzigFactuur() },
      h('span', null, h('small', null, 'Factuurnummer'), h('b', null, f.nummer || 'Nog geen nummer')),
      h('span', { class: 'k' }, 'Wijzig')),
    h('p', { class: 'klein' }, `${periode}, ${f.btw_verlegd ? 'btw verlegd' : `${f.btw_pct} % btw`}. ${afgesloten ? 'Vergrendeld.' : 'Ontgrendeld: de blokken zijn aanpasbaar.'}`),
    lijnen,
    bedragenLijst(totaal, btwKeuzeVan(f)),
    !f.afronden && h('p', { class: 'klein' }, 'Geïmporteerde historiek: exact gerekend, zonder afronding van de uren.'),
    h('p', { class: 'klein' }, afgesloten
      ? 'De pdf-urenstaat (bijlage bij je Dexxter-factuur) maakt de laptop aan in de map OneClaude\Urenstaten, na de volgende synchronisatie.'
      : 'Vergrendel de factuur om de pdf-urenstaat te laten aanmaken.'),
    h('h3', null, 'Dagen'),
    h('ul', { class: 'lijst' }, perDag(regs).map(({ datum, blokken }) => {
      const t = totalen(blokken);
      return h('li', { class: 'rij vast' }, h('span', { class: 'tijd' }, fmtDag(datum)),
        h('span', { class: 'wat' }, t.onprodMin ? `waarvan ${fmtUmm(t.onprodMin)} onproductief` : ''),
        h('span', { class: 'duur' }, fmtUmm(t.prodMin + t.onprodMin)));
    })),
  ];

  async function zetStatus(status) {
    // Bij opnieuw vergrendelen volgt de periode de blokken, die intussen aangepast kunnen zijn.
    const datums = regs.map((r) => r.datum).sort();
    const periodeNu = status === 'afgesloten' && datums.length
      ? { periode_van: datums[0], periode_tot: datums[datums.length - 1] } : {};
    await db.bewaar('facturen', { ...f, ...periodeNu, status });
    await herlaad();
    teken();
  }
  async function ontgrendel() {
    if (await vraag('Ontgrendelen? Daarna kun je de blokken van deze factuur weer aanpassen. Denk eraan de factuur in Dexxter ook aan te passen.', 'Ontgrendel')) await zetStatus('open');
  }
  async function maakOngedaan() {
    if (!(await vraag('Factuur ongedaan maken? De blokken komen terug bij Open uren.', 'Maak ongedaan', { gevaar: true }))) return;
    await db.bewaarSamen({
      registraties: regs.map((r) => ({ ...r, factuur_id: null })),
      facturen: [{ ...f, deleted_at: new Date().toISOString() }],
    });
    await herlaad();
    staat.factuurId = null;
    teken();
  }
  // Het nummer mag altijd aangepast worden; de btw alleen als de factuur ontgrendeld is.
  function wijzigFactuur() {
    const nummer = h('input', { type: 'text', value: f.nummer || volgendNummer(data.facturen.filter((x) => x.id !== f.id)), maxlength: 40 });
    let btw = btwKeuzeVan(f);
    openBlad(h('form', { onsubmit: eenTegelijk(async () => {
      await db.bewaar('facturen', { ...f, nummer: nummer.value.trim(), ...(afgesloten ? {} : btwUitKeuze(btw)) });
      await herlaad();
      sluitBlad();
      teken();
    }) },
      h('h2', null, afgesloten ? 'Factuurnummer' : 'Nummer en btw'),
      veld('Factuurnummer uit Dexxter', nummer),
      afgesloten
        ? h('p', { class: 'klein' }, 'Ontgrendel de factuur om de btw te wijzigen.')
        : h('div', { class: 'veld' }, h('span', null, 'Btw'), keuze(BTW_KEUZES, btw, (w) => { btw = w; })),
      h('div', { class: 'knoppen' },
        h('button', { class: 'knop', type: 'button', onclick: sluitBlad }, 'Annuleer'),
        h('button', { class: 'knop donker', type: 'submit' }, 'Bewaar'))));
  }

  const duim = [h('div', { class: 'knoppen' },
    // Het nummer wijzig je bovenaan; ontgrendeld kan hier ook de btw.
    !afgesloten && h('button', { type: 'button', class: 'knop', onclick: wijzigFactuur }, 'Nummer en btw'),
    afgesloten
      ? h('button', { type: 'button', class: 'knop breed', onclick: ontgrendel }, 'Ontgrendel')
      : h('button', { type: 'button', class: 'knop donker', onclick: () => zetStatus('afgesloten') }, 'Vergrendel'),
    !afgesloten && h('button', { type: 'button', class: 'knop tekstknop breed', onclick: maakOngedaan }, 'Maak factuur ongedaan'))];
  return { titel: naamVan(f), inhoud, duim };
}
