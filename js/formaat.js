// Weergave van uren, bedragen en datums (Belgische notatie).
import { rondDeel } from './rekenen.js';

// Minuten als u:mm, bv. 1143 -> "19:03".
export function fmtUmm(min) {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// Een geheel aantal honderdsten als getal met komma, bv. 117271 -> "1.172,71".
export function fmtGetal(honderdsten) {
  const s = String(Math.abs(honderdsten)).padStart(3, '0');
  const geheel = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${honderdsten < 0 ? '-' : ''}${geheel},${s.slice(-2)}`;
}

// Minuten als decimale uren op 2 decimalen, bv. 2703 -> "45,05".
export const fmtDec = (min) => fmtGetal(rondDeel(Math.max(0, min) * 100, 60));
export const fmtEuro = (cent) => `€ ${fmtGetal(cent)}`;

// "08:30" -> "8:30"
export const fmtTijd = (t) => (t ? t.replace(/^0/, '') : '');

const delen = (d) => d.split('-').map(Number);
export const fmtDatum = (d) => { const [j, m, dd] = delen(d); return `${dd}/${m}/${j}`; };
export const fmtDatumKort = (d) => { const [, m, dd] = delen(d); return `${dd}/${m}`; };
const alsDatum = (d) => { const [j, m, dd] = delen(d); return new Date(j, m - 1, dd); };
export const fmtDag = (d) => `${alsDatum(d).toLocaleDateString('nl-BE', { weekday: 'short' })} ${fmtDatumKort(d)}`;
export function fmtDagLang(d) {
  const s = alsDatum(d).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Periode voor op de factuurlijn: "29/10–10/11/2026" of "13/11/2026".
export function periodeTekst(van, tot) {
  if (van === tot) return fmtDatum(van);
  const zelfdeJaar = van.slice(0, 4) === tot.slice(0, 4);
  return `${zelfdeJaar ? fmtDatumKort(van) : fmtDatum(van)}–${fmtDatum(tot)}`;
}

const twee = (n) => String(n).padStart(2, '0');
export function vandaagStr(nu = new Date()) {
  return `${nu.getFullYear()}-${twee(nu.getMonth() + 1)}-${twee(nu.getDate())}`;
}
export function nuTijd(nu = new Date()) {
  return `${twee(nu.getHours())}:${twee(nu.getMinutes())}`;
}

// Stelt het volgende factuurnummer voor, op basis van de laatst gemaakte factuur (alle klanten samen,
// zoals Dexxter nummert). Het laatste getal gaat één omhoog en houdt zijn voorloopnullen:
// "2026-017" -> "2026-018", "F4" -> "F5". Begint het nummer met een vorig jaar ("2026-017" in 2027),
// dan start de teller opnieuw: "2027-001". Geen bruikbaar vorig nummer: lege tekst.
export function volgendNummer(facturen, jaar = new Date().getFullYear()) {
  const metNummer = facturen.filter((f) => !f.deleted_at && (f.nummer || '').trim())
    .sort((a, b) => (a.datum || '').localeCompare(b.datum || '')
      || (a.created_at || '').localeCompare(b.created_at || '') || (a.volgnr || 0) - (b.volgnr || 0));
  const laatste = metNummer.length ? metNummer[metNummer.length - 1].nummer.trim() : '';
  const m = laatste.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return '';
  const [, voor, getal, na] = m;
  const metJaar = voor.match(/^(\d{4})(\D+)$/);
  if (metJaar && Number(metJaar[1]) < jaar) return `${jaar}${metJaar[2]}${'1'.padStart(getal.length, '0')}${na}`;
  return `${voor}${String(Number(getal) + 1).padStart(getal.length, '0')}${na}`;
}

// Begin, einde en naam van een dag, week (maandag tot zondag) of maand.
// `stap` 0 = de huidige periode, -1 = de vorige, enz.
export function periodeBereik(soort, stap = 0, vandaag = vandaagStr()) {
  const [j, m, d] = vandaag.split('-').map(Number);
  let van, tot;
  if (soort === 'dag') {
    van = tot = new Date(j, m - 1, d + stap);
  } else if (soort === 'week') {
    const weekdag = (new Date(j, m - 1, d).getDay() + 6) % 7;   // maandag = 0
    van = new Date(j, m - 1, d - weekdag + 7 * stap);
    tot = new Date(van.getFullYear(), van.getMonth(), van.getDate() + 6);
  } else {
    van = new Date(j, m - 1 + stap, 1);
    tot = new Date(j, m + stap, 0);
  }
  const vanStr = vandaagStr(van), totStr = vandaagStr(tot);
  let naam;
  if (soort === 'dag') naam = stap === 0 ? 'Vandaag' : stap === -1 ? 'Gisteren' : fmtDag(vanStr);
  else if (soort === 'week') naam = stap === 0 ? 'Deze week' : periodeTekst(vanStr, totStr);
  else {
    const maand = van.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
    naam = maand.charAt(0).toUpperCase() + maand.slice(1);
  }
  return { van: vanStr, tot: totStr, naam };
}
