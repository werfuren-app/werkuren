// Rekenregels uit CLAUDE.md §2. Geen schermcode, geen opslag: alleen rekenen.
// Tijden zijn "UU:MM", duur is in minuten, bedragen in hele centen.

// Een datum die meer dan zoveel dagen vóór een eerder ingevoerde datum ligt, is verdacht.
export const VOLGORDE_DAGEN = 7;

export function naarMin(tijd) {
  const [u, m] = tijd.split(':').map(Number);
  return u * 60 + m;
}

export const tariefCent = (tarief) => Math.round(Number(tarief) * 100);

// Deelt twee gehele getallen en rondt af naar het dichtste gehele getal (helften naar boven).
export function rondDeel(teller, noemer) {
  return Math.floor((2 * teller + noemer) / (2 * noemer));
}

// Een camionetterit is een eigen soort blok: hij telt niet mee bij de werkuren
// en loopt los van productief, onproductief en pauze.
export const isCamionette = (r) => r.type === 'camionette';

// Gereden kilometers van een rit (0 zolang begin of einde ontbreekt, of als het einde kleiner is).
export function kmVan(r) {
  return r.km_start != null && r.km_einde != null && r.km_einde >= r.km_start ? r.km_einde - r.km_start : 0;
}

// Een blok loopt nog als het een start heeft, maar geen einde en geen duur.
export const isLopend = (r) => !!r.start && !r.einde && r.duur_min == null;

// Duur in minuten. Voor een lopend blok telt de tijd tot `nuMin` (als die is meegegeven).
export function duurMin(r, nuMin = null) {
  if (r.duur_min != null) return r.duur_min;
  if (r.start && r.einde) return naarMin(r.einde) - naarMin(r.start);
  if (r.start && nuMin != null) return Math.max(0, nuMin - naarMin(r.start));
  return 0;
}

// Moet dit blok van productief afgetrokken worden?
// - pauze met alleen een duur ("middagpauze 20 min"): altijd;
// - pauze of onproductief met uren: alleen als het binnen een productief blok
//   van dezelfde dag en klant ligt. Tijd tússen twee blokken telt sowieso niet mee.
export function berekenBinnenDagblok(r, dag) {
  if (r.type === 'productief' || isCamionette(r)) return false;
  if (r.duur_min != null) return r.type === 'pauze';
  if (!r.start || !r.einde) return false;
  const s = naarMin(r.start), e = naarMin(r.einde);
  return dag.some((x) => x.id !== r.id && x.type === 'productief' && x.klant_id === r.klant_id
    && x.start && x.einde && naarMin(x.start) <= s && e <= naarMin(x.einde));
}

// Geeft de blokken van één dag waarvan `binnen_dagblok` moet veranderen.
export function zetBinnenDagblok(dag) {
  const wijzigingen = [];
  for (const r of dag) {
    const waarde = berekenBinnenDagblok(r, dag);
    if (!!r.binnen_dagblok !== waarde) wijzigingen.push({ reg: r, waarde });
  }
  return wijzigingen;
}

// Minuten per soort en tarief. Sleutel: "productief|2500" (tarief in centen).
// Per dag kan productief niet onder nul zakken: een pauze trekt nooit meer af dan er die dag gewerkt is.
function minutenPerTarief(regs, nuMin) {
  const perDag = new Map();
  const tel = (r, soort, tarief, min) => {
    const sleutel = `${r.datum}|${soort}|${tarief}`;
    perDag.set(sleutel, (perDag.get(sleutel) || 0) + min);
  };
  for (const r of regs) {
    const d = duurMin(r, nuMin);
    const tp = tariefCent(r.tarief_productief);
    if (r.type === 'productief') tel(r, 'productief', tp, d);
    else {
      if (r.type === 'onproductief') tel(r, 'onproductief', tariefCent(r.tarief_onproductief), d);
      if (r.binnen_dagblok) tel(r, 'productief', tp, -d);
    }
  }
  const groepen = new Map();
  for (const [sleutel, min] of perDag) {
    const soortTarief = sleutel.slice(sleutel.indexOf('|') + 1);
    groepen.set(soortTarief, (groepen.get(soortTarief) || 0) + Math.max(0, min));
  }
  return groepen;
}

// Totalen van een reeks blokken: minuten productief en onproductief, en het exacte bedrag.
export function totalen(regs, nuMin = null) {
  let prodMin = 0, onprodMin = 0, centMin = 0;
  for (const [sleutel, min] of minutenPerTarief(regs, nuMin)) {
    const [soort, tarief] = sleutel.split('|');
    if (soort === 'productief') prodMin += min; else onprodMin += min;
    centMin += min * Number(tarief);
  }
  return { prodMin, onprodMin, bedragCent: rondDeel(centMin, 60) };
}

// Camionette: uren × uurtarief + gereden km × km-tarief (tarieven vastgelegd op elke rit).
export function camionetteTotaal(regs, nuMin = null) {
  let min = 0, km = 0, centMin = 0, kmCent = 0;
  for (const r of regs.filter(isCamionette)) {
    const d = duurMin(r, nuMin), k = kmVan(r);
    min += d;
    km += k;
    centMin += d * tariefCent(r.tarief_camionette || 0);
    kmCent += k * tariefCent(r.tarief_km || 0);
  }
  return { min, km, bedragCent: rondDeel(centMin, 60) + kmCent };
}

// Factuurlijnen zoals ze in Dexxter komen: één lijn per soort en tarief.
// afronden = true: aantal uren op 2 decimalen, bedrag = aantal × prijs (klopt met Dexxter).
// afronden = false: exact gerekend (historiek F1–F4).
export function factuurTotaal(regs, factuur) {
  const lijnen = [];
  let centMin = 0;
  for (const [sleutel, min] of minutenPerTarief(regs, null)) {
    if (min <= 0) continue;
    const [soort, tarief] = sleutel.split('|');
    const prijsCent = Number(tarief);
    const aantalHonderdsten = rondDeel(min * 100, 60);
    const bedragCent = factuur.afronden
      ? rondDeel(aantalHonderdsten * prijsCent, 100)
      : rondDeel(min * prijsCent, 60);
    centMin += min * prijsCent;
    lijnen.push({ soort, prijsCent, min, aantalHonderdsten, bedragCent });
  }
  // Camionette: een lijn per uurtarief en een lijn per km-tarief.
  const camUren = new Map(), camKm = new Map();
  for (const r of regs.filter(isCamionette)) {
    const tc = tariefCent(r.tarief_camionette || 0), tk = tariefCent(r.tarief_km || 0);
    camUren.set(tc, (camUren.get(tc) || 0) + duurMin(r));
    camKm.set(tk, (camKm.get(tk) || 0) + kmVan(r));
  }
  for (const [prijsCent, min] of camUren) {
    if (min <= 0) continue;
    const aantalHonderdsten = rondDeel(min * 100, 60);
    const bedragCent = factuur.afronden ? rondDeel(aantalHonderdsten * prijsCent, 100) : rondDeel(min * prijsCent, 60);
    centMin += min * prijsCent;
    lijnen.push({ soort: 'camionette', prijsCent, min, aantalHonderdsten, bedragCent });
  }
  let kmCent = 0;
  for (const [prijsCent, km] of camKm) {
    if (km <= 0) continue;
    kmCent += km * prijsCent;
    lijnen.push({ soort: 'km', prijsCent, km, aantalHonderdsten: km * 100, bedragCent: km * prijsCent });
  }
  const volgorde = { productief: 0, onproductief: 1, camionette: 2, km: 3 };
  lijnen.sort((a, b) => volgorde[a.soort] - volgorde[b.soort] || b.prijsCent - a.prijsCent);
  const exclCent = factuur.afronden
    ? lijnen.reduce((som, l) => som + l.bedragCent, 0)
    : rondDeel(centMin, 60) + kmCent;
  const btwPct = factuur.btw_verlegd ? 0 : Number(factuur.btw_pct) || 0;
  const btwCent = rondDeel(exclCent * btwPct, 100);
  return { lijnen, exclCent, btwCent, inclCent: exclCent + btwCent };
}

// Groepeert blokken per datum, oudste dag eerst.
export function perDag(regs) {
  const dagen = new Map();
  for (const r of regs) {
    if (!dagen.has(r.datum)) dagen.set(r.datum, []);
    dagen.get(r.datum).push(r);
  }
  return [...dagen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([datum, blokken]) => ({ datum, blokken }));
}

// Sorteert de blokken van een dag: eerst op startuur, blokken met alleen een duur achteraan.
export function opStart(a, b) {
  if (a.start && b.start) return naarMin(a.start) - naarMin(b.start);
  if (a.start) return -1;
  if (b.start) return 1;
  return (a.created_at || '').localeCompare(b.created_at || '') || (a.volgnr || 0) - (b.volgnr || 0);
}

export function dagenTussen(vroeg, laat) {
  const dag = (d) => { const [j, m, dd] = d.split('-').map(Number); return Date.UTC(j, m - 1, dd); };
  return Math.round((dag(laat) - dag(vroeg)) / 86400000);
}

// Controles: geeft een lijst waarschuwingen { datum, tekst }.
export function controles(regs, vandaag = null) {
  const w = [];
  const opInvoer = [...regs].sort((a, b) =>
    (a.created_at || '').localeCompare(b.created_at || '') || (a.volgnr || 0) - (b.volgnr || 0));
  let laatste = null;
  for (const r of opInvoer) {
    if (r.start && r.einde && naarMin(r.einde) <= naarMin(r.start)) {
      w.push({ datum: r.datum, tekst: `het einde (${r.einde}) ligt niet na de start (${r.start}).` });
    }
    if (isLopend(r) && vandaag && r.datum < vandaag) {
      w.push({ datum: r.datum, tekst: `het blok van ${r.start} loopt nog. Vul het einde in.` });
    }
    if (vandaag && r.datum > vandaag) {
      w.push({ datum: r.datum, tekst: 'deze datum ligt in de toekomst.' });
      continue;
    }
    if (laatste && dagenTussen(r.datum, laatste) > VOLGORDE_DAGEN) {
      w.push({ datum: r.datum, tekst: `ligt ${dagenTussen(r.datum, laatste)} dagen voor een dag die eerder is ingevoerd. Typfout in de datum?` });
    }
    if (!laatste || r.datum > laatste) laatste = r.datum;
  }
  // Overlappende blokken op dezelfde dag bij dezelfde klant.
  for (const { datum, blokken } of perDag(regs)) {
    // Een camionetterit mag gewoon samenvallen met werkuren.
    const metUren = blokken.filter((r) => !isCamionette(r) && r.start && r.einde && naarMin(r.einde) > naarMin(r.start));
    for (let i = 0; i < metUren.length; i++) {
      for (let j = i + 1; j < metUren.length; j++) {
        const a = metUren[i], b = metUren[j];
        if (a.klant_id !== b.klant_id) continue;
        const overlapt = naarMin(a.start) < naarMin(b.einde) && naarMin(b.start) < naarMin(a.einde);
        // Onproductief of pauze bínnen een dagblok is geen fout: dat wordt afgetrokken.
        const aftrek = (a.type === 'productief') !== (b.type === 'productief')
          && (a.type === 'productief' ? b : a).binnen_dagblok;
        if (overlapt && !aftrek) {
          w.push({ datum, tekst: `de blokken ${a.start}–${a.einde} en ${b.start}–${b.einde} overlappen.` });
        }
      }
    }
  }
  return w;
}
