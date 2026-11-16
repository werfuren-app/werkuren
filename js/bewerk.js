// Blad om een registratie toe te voegen, aan te passen of te verwijderen.
import { h, keuze, veld, openBlad, sluitBlad, vraag, toast, eenTegelijk } from './hulpen.js';
import { data, staat, klant, isVergrendeld, bewaarRegistratie, verwijderRegistratie } from './staat.js';
import { naarMin, isLopend, dagenTussen, VOLGORDE_DAGEN } from './rekenen.js';
import { vandaagStr, fmtDatum } from './formaat.js';

const TYPES = [['productief', 'Productief'], ['onproductief', 'Onproductief'], ['pauze', 'Pauze']];

export function openBewerk(reg, melding = '') {
  if (isVergrendeld(reg)) {
    toast('Dit blok zit in een afgesloten factuur. Ontgrendel eerst de factuur.');
    return;
  }
  const nieuw = !data.registraties.some((r) => r.id === reg.id);
  const magLopen = !nieuw && isLopend(reg);   // alleen het lopende blok mag zonder einde blijven
  let type = reg.type;
  let wijze = reg.duur_min != null ? 'duur' : 'tijden';

  const datum = h('input', { type: 'date', value: reg.datum, required: true });
  const start = h('input', { type: 'time', value: reg.start || '' });
  const einde = h('input', { type: 'time', value: reg.einde || '' });
  const uren = h('input', { type: 'number', min: 0, max: 24, inputmode: 'numeric', value: reg.duur_min != null ? Math.floor(reg.duur_min / 60) : '' });
  const minuten = h('input', { type: 'number', min: 0, max: 59, inputmode: 'numeric', value: reg.duur_min != null ? reg.duur_min % 60 : '' });
  const klantKeuze = h('select', { value: reg.klant_id },
    data.klanten.map((k) => h('option', { value: k.id }, k.naam)));
  const omschrijving = h('input', { type: 'text', value: reg.omschrijving || '', placeholder: 'Bv. Lassen, Inladen', maxlength: 200 });
  const fout = h('p', { class: 'fout', role: 'alert', hidden: true });

  const metTijden = h('div', { class: 'twee' },
    veld('Start', start),
    veld('Einde', einde, magLopen ? 'Leeg = loopt nog' : null));
  const metDuur = h('div', { class: 'twee' }, veld('Uren', uren), veld('Minuten', minuten));
  const toonWijze = () => { metTijden.hidden = wijze !== 'tijden'; metDuur.hidden = wijze !== 'duur'; };
  toonWijze();

  const toonFout = (tekst) => { fout.textContent = tekst; fout.hidden = false; };

  const bewaar = eenTegelijk(async () => {
    fout.hidden = true;
    const v = { ...reg, type, datum: datum.value, klant_id: klantKeuze.value, omschrijving: omschrijving.value.trim() };
    if (!v.datum) return toonFout('Kies een datum.');
    if (wijze === 'tijden') {
      if (!start.value) return toonFout('Vul het startuur in.');
      if (!einde.value && !magLopen) return toonFout('Vul het einduur in.');
      if (einde.value && naarMin(einde.value) <= naarMin(start.value)) return toonFout('Het einde moet na de start liggen.');
      Object.assign(v, { start: start.value, einde: einde.value || null, duur_min: null });
    } else {
      const duur = (Number(uren.value) || 0) * 60 + (Number(minuten.value) || 0);
      if (duur <= 0) return toonFout('Vul een duur in.');
      if (duur > 24 * 60) return toonFout('Een duur kan niet langer zijn dan 24 uur.');
      Object.assign(v, { start: null, einde: null, duur_min: duur });
    }
    // De tarieven horen bij de klant op het moment van registreren.
    if (nieuw || v.klant_id !== reg.klant_id) {
      const k = klant(v.klant_id);
      v.tarief_productief = k.tarief_productief;
      v.tarief_onproductief = k.tarief_onproductief;
    }
    // Controle op een datum die uit volgorde ligt (typfout).
    if (v.datum !== reg.datum || nieuw) {
      const vandaag = vandaagStr();
      const laatste = data.registraties.filter((r) => r.id !== v.id && r.klant_id === v.klant_id && r.datum <= vandaag)
        .reduce((max, r) => (r.datum > max ? r.datum : max), '');
      let twijfel = '';
      if (v.datum > vandaag) twijfel = `${fmtDatum(v.datum)} ligt in de toekomst.`;
      else if (laatste && dagenTussen(v.datum, laatste) > VOLGORDE_DAGEN) {
        twijfel = `${fmtDatum(v.datum)} ligt ${dagenTussen(v.datum, laatste)} dagen voor je laatste registratie.`;
      }
      if (twijfel && !(await vraag(`${twijfel} Klopt de datum?`, 'Ja, bewaar'))) return;
    }
    await bewaarRegistratie(v, [reg.datum]);
    sluitBlad();
  });

  async function verwijder() {
    if (!(await vraag('Dit blok verwijderen?', 'Verwijder', { gevaar: true }))) return;
    await verwijderRegistratie(reg);
    sluitBlad();
  }

  openBlad(h('form', { onsubmit: bewaar, novalidate: true },
    h('h2', null, nieuw ? 'Blok toevoegen' : 'Blok aanpassen'),
    melding && h('p', { class: 'melding' }, melding),
    veld('Datum', datum),
    h('div', { class: 'veld' }, h('span', null, 'Soort'), keuze(TYPES, type, (w) => { type = w; })),
    h('div', { class: 'veld' }, h('span', null, 'Invoer'),
      keuze([['tijden', 'Met uren'], ['duur', 'Alleen duur']], wijze, (w) => { wijze = w; toonWijze(); })),
    metTijden, metDuur,
    data.klanten.length > 1 && veld('Klant', klantKeuze),
    veld('Omschrijving', omschrijving),
    fout,
    h('div', { class: 'knoppen' },
      h('button', { class: 'knop', type: 'button', onclick: sluitBlad }, 'Annuleer'),
      h('button', { class: 'knop donker', type: 'submit' }, 'Bewaar'),
      !nieuw && h('button', { class: 'knop tekstknop breed', type: 'button', onclick: verwijder }, 'Verwijder dit blok')),
  ));
}
