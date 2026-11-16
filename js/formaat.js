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
