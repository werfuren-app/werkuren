// Scherm "Instellingen": klanten, historiek importeren en reservekopie.
import { h, keuze, veld, openBlad, sluitBlad, vraag, toast, eenTegelijk } from './hulpen.js';
import * as db from './db.js';
import { data, staat, maakId, herlaad, teken, zetMeta } from './staat.js';
import { leesCsv, historiekNaarRecords } from './historiek.js';
import { fmtGetal } from './formaat.js';
import { tariefCent } from './rekenen.js';
import { BTW_KEUZES, btwKeuzeVan, btwUitKeuze } from './open.js';
import { syncStatus, isGekoppeld, syncEmail, meldAan, meldAf, syncNu } from './sync.js';

export const VERSIE = '0.6';

const SYNC_TEKST = {
  uit: 'Niet gekoppeld. Alles staat alleen op dit toestel.',
  bezig: 'Bezig met synchroniseren…',
  ok: 'Alles is gesynchroniseerd.',
  offline: 'Geen netwerk. De app synchroniseert zodra er weer verbinding is.',
  fout: 'Synchroniseren lukte niet.',
  login: 'Meld je opnieuw aan om te synchroniseren.',
};

function openKoppelen() {
  const c = data.meta.sync ?? {};
  const url = h('input', { type: 'text', value: c.url || '', placeholder: 'https://….supabase.co', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', inputmode: 'url' });
  const sleutel = h('input', { type: 'text', value: c.sleutel || '', placeholder: 'sb_publishable_…', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const email = h('input', { type: 'text', value: c.email || '', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', autocorrect: 'off' });
  const wachtwoord = h('input', { type: 'password', autocomplete: 'current-password' });
  const fout = h('p', { class: 'fout', role: 'alert', hidden: true });
  const knop = h('button', { class: 'knop donker', type: 'submit' }, 'Meld aan');

  const bewaar = eenTegelijk(async () => {
    fout.hidden = true;
    if (!url.value.trim() || !sleutel.value.trim() || !email.value.trim() || !wachtwoord.value) {
      fout.textContent = 'Vul de vier velden in.'; fout.hidden = false; return;
    }
    knop.textContent = 'Bezig…';
    try {
      await meldAan(url.value, sleutel.value, email.value, wachtwoord.value);
      sluitBlad();
      teken();
      toast('Aangemeld. De app synchroniseert nu vanzelf.');
    } catch (e) {
      fout.textContent = e.message; fout.hidden = false;
    } finally { knop.textContent = 'Meld aan'; }
  });

  openBlad(h('form', { onsubmit: bewaar, novalidate: true },
    h('h2', null, 'Koppel met Supabase'),
    h('p', { class: 'klein' }, 'Eén keer per toestel. Je wachtwoord wordt niet bewaard; het toestel blijft daarna aangemeld.'),
    veld('Adres van je project (Project URL)', url),
    veld('Publieke sleutel (publishable key)', sleutel),
    veld('E-mail', email),
    veld('Wachtwoord', wachtwoord),
    fout,
    h('div', { class: 'knoppen' },
      h('button', { class: 'knop', type: 'button', onclick: sluitBlad }, 'Annuleer'), knop)));
}

function syncBlok() {
  const s = syncStatus();
  const gekoppeld = isGekoppeld();
  const laatst = s.laatst ? new Date(s.laatst).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' }) : 'nog nooit';
  return [
    h('h3', null, 'Synchronisatie'),
    h('p', { class: `melding${s.toestand === 'fout' || s.toestand === 'login' ? ' waarschuwing' : ''}` },
      SYNC_TEKST[s.toestand], s.toestand === 'fout' && s.fout ? ` (${s.fout})` : ''),
    gekoppeld && h('p', { class: 'klein' },
      `Aangemeld als ${syncEmail()}. Laatste sync: ${laatst}. ${s.wachtend ? `${s.wachtend} ${s.wachtend === 1 ? 'wijziging wacht' : 'wijzigingen wachten'} nog.` : ''}`),
    gekoppeld
      ? [h('button', { type: 'button', class: 'knop breed smal', disabled: s.toestand === 'bezig', onclick: () => syncNu() }, 'Synchroniseer nu'),
        h('button', { type: 'button', class: 'knop tekstknop breed', onclick: async () => {
          if (await vraag('Afmelden op dit toestel? Je gegevens blijven hier staan, maar synchroniseren stopt.', 'Meld af')) { await meldAf(); teken(); }
        } }, 'Meld af')]
      : h('button', { type: 'button', class: 'knop donker breed smal', onclick: openKoppelen },
        s.toestand === 'login' ? 'Meld opnieuw aan' : data.meta.sync ? 'Meld aan' : 'Koppel met Supabase'),
  ];
}

export function openKlant(k) {
  const nieuw = !k;
  k ??= { id: maakId(), naam: '', tarief_productief: '', tarief_onproductief: '', btw_pct: 0, btw_verlegd: true, deleted_at: null };
  let btw = btwKeuzeVan(k);
  const naam = h('input', { type: 'text', value: k.naam, maxlength: 60, required: true });
  const prijs = (v) => h('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: v });
  const tp = prijs(k.tarief_productief), to = prijs(k.tarief_onproductief);
  const fout = h('p', { class: 'fout', role: 'alert', hidden: true });

  const bewaar = eenTegelijk(async () => {
    const toon = (tekst) => { fout.textContent = tekst; fout.hidden = false; };
    const n = naam.value.trim();
    if (!n) return toon('Vul een naam in.');
    if (data.klanten.some((x) => x.id !== k.id && x.naam.toLowerCase() === n.toLowerCase())) return toon('Er bestaat al een klant met deze naam.');
    const a = Number(tp.value), b = Number(to.value);
    if (tp.value === '' || to.value === '' || !(a >= 0) || !(b >= 0)) return toon('Vul twee geldige tarieven in.');
    await db.bewaar('klanten', { ...k, naam: n, tarief_productief: a, tarief_onproductief: b, ...btwUitKeuze(btw) });
    await herlaad();
    if (nieuw) { staat.klantId = k.id; await zetMeta('klant', k.id); }
    sluitBlad();
    teken();
  });

  openBlad(h('form', { onsubmit: bewaar, novalidate: true },
    h('h2', null, nieuw ? 'Klant toevoegen' : 'Klant aanpassen'),
    veld('Naam', naam),
    h('div', { class: 'twee' }, veld('Productief (€/u)', tp), veld('Onproductief (€/u)', to)),
    h('div', { class: 'veld' }, h('span', null, 'Btw, standaard voor deze klant'), keuze(BTW_KEUZES, btw, (w) => { btw = w; })),
    h('p', { class: 'klein' }, 'Nieuwe tarieven gelden voor nieuwe blokken. Bestaande blokken houden hun tarief.'),
    fout,
    h('div', { class: 'knoppen' },
      h('button', { class: 'knop', type: 'button', onclick: sluitBlad }, 'Annuleer'),
      h('button', { class: 'knop donker', type: 'submit' }, 'Bewaar'))));
}

const importeer = eenTegelijk(async (bestand) => {
  if (!bestand) return;
  if (data.meta.historiek_geimporteerd
    && !(await vraag('De historiek is al eens geïmporteerd. Nog eens importeren maakt alles dubbel.', 'Toch importeren', { gevaar: true }))) return;
  try {
    if (isGekoppeld()) await syncNu();   // haal eerst bestaande klanten op, anders ontstaat er een dubbele
    const rijen = leesCsv(await bestand.text());
    if (!rijen.length) throw new Error('Het bestand bevat geen regels.');
    const nieuw = historiekNaarRecords(rijen, data.klanten, maakId);
    // Volgnummers laten aansluiten op facturen die er al zijn.
    for (const f of nieuw.facturen) {
      f.volgnr += Math.max(0, ...data.facturen.filter((x) => x.klant_id === f.klant_id).map((x) => x.volgnr || 0));
    }
    await db.bewaarSamen(nieuw, { historiek_geimporteerd: new Date().toISOString() });
    await herlaad();
    teken();
    toast(`${nieuw.registraties.length} blokken en ${nieuw.facturen.length} facturen geïmporteerd.`);
  } catch (fout) {
    toast(`Importeren lukte niet. ${fout.message}`);
  }
});

const reservekopie = eenTegelijk(async () => {
  const naam = `werkuren-reservekopie-${new Date().toISOString().slice(0, 10)}.json`;
  const tekst = JSON.stringify(await db.reservekopie(), null, 1);
  // Op de iPhone werkt een gewone download niet in een beginscherm-app: gebruik het deelblad.
  const bestand = new File([tekst], naam, { type: 'application/json' });
  if (navigator.canShare?.({ files: [bestand] })) {
    try { await navigator.share({ files: [bestand], title: 'Werkuren reservekopie' }); } catch { /* geannuleerd */ }
    return;
  }
  const blob = new Blob([tekst], { type: 'application/json' });
  const link = h('a', { href: URL.createObjectURL(blob), download: naam });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
});

// Eerste start op een toestel: nog geen klant. Koppel om bestaande gegevens op te halen, of begin nieuw.
export function tekenWelkom() {
  const inhoud = [
    h('p', { class: 'leeg' }, 'Welkom. Op dit toestel staan nog geen gegevens.'),
    h('p', null, 'Gebruik je de app al op een ander toestel? Koppel dan met Supabase: je klanten en uren komen vanzelf mee.'),
    h('p', null, 'Begin je nieuw? Voeg dan eerst een klant toe met de tarieven per uur.'),
  ];
  const duim = [h('div', { class: 'knoppen' },
    h('button', { type: 'button', class: 'knop', onclick: openKoppelen }, isGekoppeld() ? 'Opnieuw koppelen' : 'Koppel met Supabase'),
    h('button', { type: 'button', class: 'knop donker', onclick: () => openKlant(null) }, 'Klant toevoegen'))];
  return { titel: 'Werkuren', inhoud, duim, zonderKlant: true };
}

export function tekenInstellingen() {
  const kiesBestand = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true,
    onchange: (ev) => { importeer(ev.target.files[0]); ev.target.value = ''; } });
  const inhoud = [
    h('h3', null, 'Klanten'),
    h('ul', { class: 'lijst' }, data.klanten.map((k) => h('li', null,
      h('button', { type: 'button', class: 'rij', onclick: () => openKlant(k) },
        h('span', { class: 'wat' }, k.naam,
          h('small', null, `€ ${fmtGetal(tariefCent(k.tarief_productief))} productief, € ${fmtGetal(tariefCent(k.tarief_onproductief))} onproductief, ${k.btw_verlegd ? 'btw verlegd' : `${k.btw_pct} % btw`}`)),
        h('span', { class: 'duur' }, 'Wijzig'))))),
    h('button', { type: 'button', class: 'knop breed smal', onclick: () => openKlant(null) }, 'Klant toevoegen'),
    syncBlok(),
    h('h3', null, 'Gegevens'),
    kiesBestand,
    h('button', { type: 'button', class: 'knop breed smal', onclick: () => kiesBestand.click() }, 'Historiek importeren (historiek.csv)'),
    h('button', { type: 'button', class: 'knop breed smal', onclick: reservekopie }, 'Reservekopie downloaden'),
    h('p', { class: 'klein' }, `Werkuren, versie ${VERSIE}`),
  ];
  return { titel: 'Instellingen', inhoud, duim: [], zonderKlant: true };
}
