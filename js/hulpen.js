// Kleine hulpjes voor het scherm: elementen maken, bladen, vragen en meldingen.

// Maakt een element. Tekst wordt altijd als tekst toegevoegd, nooit als HTML.
export function h(tag, attrs, ...kinderen) {
  const e = document.createElement(tag);
  let waarde;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'value') waarde = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kind of kinderen.flat(Infinity)) {
    if (kind == null || kind === false) continue;
    e.append(kind.nodeType ? kind : String(kind));
  }
  if (waarde !== undefined) e.value = waarde;   // na de kinderen, zodat het ook bij <select> werkt
  return e;
}

// Rij met keuzeknoppen waarvan er één actief is. `opties`: [[waarde, tekst], ...].
export function keuze(opties, huidig, bijKeuze) {
  const knoppen = opties.map(([waarde, tekst]) => h('button', {
    type: 'button', 'aria-pressed': String(waarde === huidig),
    onclick: () => {
      knoppen.forEach((k) => k.setAttribute('aria-pressed', String(k === knop(waarde))));
      bijKeuze(waarde);
    },
  }, tekst));
  const knop = (waarde) => knoppen[opties.findIndex(([w]) => w === waarde)];
  return h('div', { class: 'keuze', style: `grid-template-columns: repeat(${opties.length}, 1fr)` }, knoppen);
}

export function veld(label, invoer, hulp) {
  return h('label', { class: 'veld' }, h('span', null, label), invoer, hulp && h('small', null, hulp));
}

const blad = () => document.getElementById('blad');
export function openBlad(...inhoud) {
  blad().replaceChildren(...inhoud);
  if (!blad().open) blad().showModal();
}
export const sluitBlad = () => blad().close();
export const dialoogOpen = () => !!document.querySelector('dialog[open]');

// Stelt een ja/nee-vraag met grote knoppen. Geeft true bij ja.
export function vraag(tekst, jaTekst, { gevaar = false } = {}) {
  const d = document.getElementById('vraag');
  return new Promise((klaar) => {
    const kies = (antwoord) => { d.close(); klaar(antwoord); };
    d.replaceChildren(
      h('p', null, tekst),
      h('div', { class: 'knoppen' },
        h('button', { class: 'knop', type: 'button', onclick: () => kies(false) }, 'Annuleer'),
        h('button', { class: `knop ${gevaar ? 'stop' : 'donker'}`, type: 'button', onclick: () => kies(true) }, jaTekst)),
    );
    d.oncancel = () => klaar(false);
    d.showModal();
  });
}

// Maakt van een async-functie er een die niet twee keer tegelijk kan lopen (dubbel tikken).
// Een formulier-event wordt altijd tegengehouden, ook als de aanroep genegeerd wordt.
export function eenTegelijk(fn) {
  let bezig = false;
  return async (...args) => {
    args[0]?.preventDefault?.();
    if (bezig) return undefined;
    bezig = true;
    try { return await fn(...args); } finally { bezig = false; }
  };
}

let toastTimer;
export function toast(tekst) {
  const t = document.getElementById('toast');
  t.textContent = tekst;
  t.classList.add('zichtbaar');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('zichtbaar'), 3500);
}

// Kopieert tekst naar het klembord, met een terugval voor oudere browsers.
export async function kopieer(tekst) {
  try {
    await navigator.clipboard.writeText(tekst);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, tekst);
    document.body.append(ta);
    ta.select();
    const gelukt = document.execCommand('copy');
    ta.remove();
    return gelukt;
  }
}
