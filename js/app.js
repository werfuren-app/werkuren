// Start van de app: laadt de data, tekent het gekozen scherm en regelt de tabs.
import { h, dialoogOpen, toast } from './hulpen.js';
import { staat, data, herlaad, zetTeken, teken, zetMeta } from './staat.js';
import { tekenVandaag } from './vandaag.js';
import { tekenOpen } from './open.js';
import { tekenFacturen } from './facturen.js';
import { tekenInstellingen, tekenWelkom } from './instellingen.js';
import { startSync, zetStatusLuisteraar } from './sync.js';

const SCHERMEN = { vandaag: tekenVandaag, open: tekenOpen, facturen: tekenFacturen, instellingen: tekenInstellingen };
const $ = (id) => document.getElementById(id);

function klantKiezer() {
  if (data.klanten.length < 2) return h('span', { class: 'klant' }, data.klanten[0]?.naam ?? '');
  return h('select', { class: 'klant', 'aria-label': 'Klant', value: staat.klantId,
    onchange: async (ev) => { staat.klantId = ev.target.value; staat.factuurId = null; await zetMeta('klant', staat.klantId); teken(); } },
    data.klanten.map((k) => h('option', { value: k.id }, k.naam)));
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
