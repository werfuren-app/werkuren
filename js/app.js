// Start van de app: laadt de data, tekent het gekozen scherm en regelt de tabs.
import { h, dialoogOpen, toast, openBlad, sluitBlad } from './hulpen.js';
import { fmtGetal } from './formaat.js';
import { tariefCent } from './rekenen.js';
import { staat, data, herlaad, zetTeken, teken, zetMeta } from './staat.js';
import { tekenVandaag } from './vandaag.js';
import { tekenOpen } from './open.js';
import { tekenFacturen } from './facturen.js';
import { tekenInstellingen, tekenWelkom, openKlant } from './instellingen.js';
import { startSync, zetStatusLuisteraar } from './sync.js';

const SCHERMEN = { vandaag: tekenVandaag, open: tekenOpen, facturen: tekenFacturen, instellingen: tekenInstellingen };
const $ = (id) => document.getElementById(id);

// De klant bovenaan is een knop: tik om van klant te wisselen of een klant toe te voegen.
function klantKiezer() {
  const huidig = data.klanten.find((k) => k.id === staat.klantId);
  return h('button', { type: 'button', class: 'klant', 'aria-label': `Klant: ${huidig?.naam ?? ''}. Tik om te wisselen.`,
    onclick: openKlantKeuze }, huidig?.naam ?? '');
}

function openKlantKeuze() {
  const kies = async (id) => {
    staat.klantId = id;
    staat.factuurId = null;
    await zetMeta('klant', id);
    sluitBlad();
    teken();
  };
  openBlad(h('div', null,
    h('h2', null, 'Klant kiezen'),
    h('ul', { class: 'lijst' }, data.klanten.map((k) => h('li', null,
      h('button', { type: 'button', class: 'rij', 'aria-pressed': String(k.id === staat.klantId), onclick: () => kies(k.id) },
        h('span', { class: 'wat' }, k.naam,
          h('small', null, `€ ${fmtGetal(tariefCent(k.tarief_productief))} productief, € ${fmtGetal(tariefCent(k.tarief_onproductief))} onproductief`)),
        h('span', { class: 'duur' }, k.id === staat.klantId ? 'Gekozen' : ''))))),
    h('div', { class: 'knoppen' },
      h('button', { type: 'button', class: 'knop', onclick: sluitBlad }, 'Sluit'),
      h('button', { type: 'button', class: 'knop donker', onclick: () => openKlant(null) }, 'Klant toevoegen'))));
}

function tekenScherm() {
  if (!data.klanten.some((k) => k.id === staat.klantId)) staat.klantId = data.klanten[0]?.id ?? null;
  // Zonder klant valt er niets te registreren: toon dan het welkomscherm (behalve op Instellingen).
  const scherm = !data.klanten.length && staat.tab !== 'instellingen' ? tekenWelkom() : SCHERMEN[staat.tab]();
  const inhoud = $('inhoud');
  const scroll = inhoud.scrollTop;
  $('titel').textContent = scherm.titel;
  $('kop-rechts').replaceChildren(scherm.zonderKlant ? '' : klantKiezer());
  inhoud.replaceChildren(...scherm.inhoud.flat(Infinity).filter((x) => x != null && x !== false));
  inhoud.scrollTop = scroll;
  $('duim').replaceChildren(...scherm.duim);
  $('duim').hidden = !scherm.duim.length;
  for (const knop of document.querySelectorAll('#tabs button')) {
    if (knop.dataset.tab === staat.tab) knop.setAttribute('aria-current', 'page'); else knop.removeAttribute('aria-current');
  }
}

async function begin() {
  zetTeken(tekenScherm);
  await herlaad();
  staat.klantId = data.meta.klant ?? null;

  for (const knop of document.querySelectorAll('#tabs button')) {
    knop.addEventListener('click', () => {
      if (knop.dataset.tab === 'facturen' && staat.tab === 'facturen') staat.factuurId = null;
      staat.tab = knop.dataset.tab;
      $('inhoud').scrollTop = 0;
      teken();
    });
  }
  teken();

  // De tellers lopen mee: elke 15 seconden en zodra de app weer in beeld komt.
  const ververs = () => {
    const bezigMetInvoer = ['SELECT', 'INPUT'].includes(document.activeElement?.tagName);
    if (staat.tab === 'vandaag' && !dialoogOpen() && !document.hidden && !bezigMetInvoer) teken();
  };
  setInterval(ververs, 15000);
  document.addEventListener('visibilitychange', ververs);

  // Toon de syncstatus zodra die verandert (alleen zichtbaar op Instellingen).
  zetStatusLuisteraar(() => { if (staat.tab === 'instellingen' && !dialoogOpen()) teken(); });
  startSync();

  // Vraag de browser om de gegevens niet zomaar op te ruimen.
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

begin().catch((fout) => {
  console.error(fout);
  toast('De app kon niet starten. Sluit de app en open ze opnieuw.');
});
