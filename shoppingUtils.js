/**
 * shoppingUtils.js — One Pot
 * ============================================================================
 * Realistisk pris- og indkøbsmotor, der bygger ovenpå PRICES_DA/PRICES_EN
 * (data.js). Hvor den gamle prisberegning i app.js (estimatePrice/
 * estimateRecipePrice) ganger en teoretisk grampris med den nøjagtige mængde
 * en opskrift beder om, tager dette modul højde for hvordan man *rent
 * faktisk* handler ind: man ruller op til hele pakker/bakker, respekterer
 * en mindste indkøbsmængde, og ender ofte med lidt i overskud.
 *
 * Modulet er skrevet som et rigtigt ES-modul (export/import), men da resten
 * af Onepot.dk (data.js/app.js) er klassiske <script>-tags uden bundler,
 * deler alle scripts på siden samme globale "script scope" — derfor kan
 * funktionerne herunder læse PRICES_DA, PRICES_EN, SYN_DA/EN osv. direkte,
 * uden import. Er de ikke tilgængelige (fx ved standalone test), falder
 * modulet tilbage til et lille indbygget datasæt, så det aldrig crasher.
 *
 * ---------------------------------------------------------------------------
 * Eksempler:
 *
 *   import { generateShoppingList, calculateRealisticCost } from './shoppingUtils.js';
 *
 *   const list = generateShoppingList(RECIPES_DA[0].ing, { servings: 2 });
 *   // => { items:[...], byCategory:{produce:[...], dairy:[...]}, totalCost, ... }
 *
 *   const kr = calculateRealisticCost(RECIPES_DA[0].ing);
 *   // => 87   (realistisk pris for hele pakker, ikke bare grampris * mængde)
 *
 *   normalizeIngredientName('Hvidløg, presset');       // => 'hvidløg'
 *   normalizeIngredientName('Garlic, crushed');         // => 'garlic'
 *
 *   getItemPrice('Fløde', 1, 'dl');
 *   // => købes som helt 2.5 dl karton (min. indkøb), 1.5 dl til overs
 *
 *   updatePrice('hvidløg', { packPrice: 4 });           // opdatér pris on-the-fly
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Ambiente data fra data.js (delt script-scope). Falder tilbage til et lille
// indbygget datasæt, hvis modulet bruges uden data.js indlæst.
// ---------------------------------------------------------------------------
function ambient(name, fallback) {
  try { return typeof globalThis !== 'undefined' && typeof globalThis[name] !== 'undefined' ? globalThis[name] : fallback; }
  catch (e) { return fallback; }
}
// eslint-disable-next-line no-undef
const _PRICES_DA = typeof PRICES_DA !== 'undefined' ? PRICES_DA : ambient('PRICES_DA', null);
// eslint-disable-next-line no-undef
const _PRICES_EN = typeof PRICES_EN !== 'undefined' ? PRICES_EN : ambient('PRICES_EN', null);
// eslint-disable-next-line no-undef
const _STRIP_RE_DA = typeof STRIP_RE_DA !== 'undefined' ? STRIP_RE_DA : null;
// eslint-disable-next-line no-undef
const _STRIP_RE_EN = typeof STRIP_RE_EN !== 'undefined' ? STRIP_RE_EN : null;
// eslint-disable-next-line no-undef
const _SYN_DA = typeof SYN_DA !== 'undefined' ? SYN_DA : {};
// eslint-disable-next-line no-undef
const _SYN_EN = typeof SYN_EN !== 'undefined' ? SYN_EN : {};
// eslint-disable-next-line no-undef
const _OR_SPLIT_DA = typeof OR_SPLIT_DA !== 'undefined' ? OR_SPLIT_DA : / el\.| eller /;
// eslint-disable-next-line no-undef
const _OR_SPLIT_EN = typeof OR_SPLIT_EN !== 'undefined' ? OR_SPLIT_EN : / or /;

// Minimalt fallback-datasæt, så modulet virker (om end upræcist) helt uden data.js.
const FALLBACK_PRICES = {
  'default': { unit: 'stk', typicalPackSize: 1, minPurchase: 1, packPrice: 8, category: 'other' },
};

function currentLang(explicit) {
  if (explicit === 'da' || explicit === 'en') return explicit;
  // eslint-disable-next-line no-undef
  if (typeof lang !== 'undefined' && (lang === 'da' || lang === 'en')) return lang;
  return 'da';
}
function priceTableFor(l) {
  return l === 'en' ? _PRICES_EN : _PRICES_DA;
}
function stripReFor(l) { return l === 'en' ? _STRIP_RE_EN : _STRIP_RE_DA; }
function synFor(l) { return l === 'en' ? _SYN_EN : _SYN_DA; }
function orSplitFor(l) { return l === 'en' ? _OR_SPLIT_EN : _OR_SPLIT_DA; }

const WATER_WORDS = new Set(['vand', 'water']);

// Hvor mange "opskrifts-enheder" der typisk er i ÉN købt pakke, når opskriftens
// enhed ikke er den samme som købs-enheden (unit). Dette er bevidst grove,
// dokumenterede tommelfingerregler — fx "et fed hvidløg" findes ikke i butikken,
// man køber et helt hvidløgshoved (~10 fed).
const UNIT_YIELD = {
  fed: 10, clove: 10,          // 1 hvidløgshoved ≈ 10 fed/cloves
  'håndf.': 3, handful: 3,     // 1 bundt/potte krydderurt ≈ 3 håndfulde
  blade: 15, leaves: 15,       // 1 bundt salvie ≈ 15 blade
  tsk: 12, tsp: 12,            // 1 krydderiglas ≈ 12 tsk
  spsk: 12, tbsp: 12,          // 1 flaske/glas sauce/pesto ≈ 12 spsk
  knsp: 20, pinch: 20,         // 1 glas ≈ 20 knivspidser
  dl: 40,                      // 1 æske bouillonterninger ≈ 40 dl færdig bouillon
};

const CATEGORY_ORDER = ['produce', 'meat', 'fish', 'dairy', 'pasta', 'canned', 'condiments', 'spices', 'oil', 'dry_goods', 'other'];

const MSG = {
  da: {
    unknownIngredient: (n) => `Ukendt ingrediens "${n}" — bruger et fladt gæt på pris.`,
    highWaste: (n, p) => `${n}: højt spild (~${Math.round(p)}%) i forhold til hvad opskriften bruger.`,
  },
  en: {
    unknownIngredient: (n) => `Unknown ingredient "${n}" — using a flat price guess.`,
    highWaste: (n, p) => `${n}: high waste (~${Math.round(p)}%) relative to what the recipe uses.`,
  },
};

// ---------------------------------------------------------------------------
// Override-lag til priser: updatePrice() SKRIVER ALDRIG i PRICES_DA/EN direkte,
// men lægger et lag ovenpå, så de kuraterede grunddata altid kan gendannes.
// ---------------------------------------------------------------------------
const PRICE_OVERRIDES = { da: {}, en: {} };

/**
 * Opdatér prisdata for en ingrediens on-the-fly (fx fra en admin-UI eller et
 * prisfeed), uden at ændre de statiske PRICES_DA/PRICES_EN i data.js.
 *
 * @param {string} name  Ingrediensnavn (fri form — normaliseres automatisk)
 * @param {object} patch Felter der skal opdateres, fx {packPrice: 14, typicalPackSize: 400}
 * @param {'da'|'en'} [lang] Sprog for opslaget (autodetekteres hvis udeladt)
 * @returns {object} Den sammenlagte, opdaterede prisrække
 *
 * @example
 *   updatePrice('kyllingebryst', { packPrice: 42, typicalPackSize: 450 });
 */
function updatePrice(name, patch, lang) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('updatePrice: "name" skal være en ikke-tom streng.');
  }
  if (!patch || typeof patch !== 'object') {
    throw new TypeError('updatePrice: "patch" skal være et objekt med felter der skal opdateres.');
  }
  const l = currentLang(lang);
  const base = normalizeIngredientName(name, l);
  const existing = { ...(priceTableFor(l)[base] || {}), ...(PRICE_OVERRIDES[l][base] || {}) };
  const merged = { ...existing, ...patch };
  PRICE_OVERRIDES[l][base] = merged;
  return merged;
}

function getPriceRow(base, lang) {
  const l = currentLang(lang);
  const table = priceTableFor(l) || {};
  const override = PRICE_OVERRIDES[l][base];
  const row = table[base];
  if (!row && !override) return null;
  return { ...(row || {}), ...(override || {}) };
}

// ---------------------------------------------------------------------------
// Navnenormalisering (DA/EN + variationer) — samme princip som app.js'
// baseIngredient(), men samlet ét sted og uafhængigt af aktiv UI-sprog.
// ---------------------------------------------------------------------------

/**
 * Normalisér et frit ingrediensnavn (dansk eller engelsk, med evt.
 * tilberedningsbeskrivelse efter komma) til den kanoniske pris-nøgle.
 *
 * @param {string} name  Fx "Hvidløg, presset" / "Garlic, crushed"
 * @param {'da'|'en'} [lang] Tving et bestemt sprogs normaliseringsregler.
 *   Udelades den, forsøges dansk først og derefter engelsk — den variant der
 *   matcher en kendt pris-nøgle vindes.
 * @returns {string} Kanonisk grund-ingrediens, fx "hvidløg" / "garlic"
 *
 * @example
 *   normalizeIngredientName('Frisk spinat')      // 'spinat'
 *   normalizeIngredientName('Fresh spinach')     // 'spinach'
 *   normalizeIngredientName('Cherrytomat')       // 'cherrytomater'
 */
function normalizeIngredientName(name, lang) {
  if (typeof name !== 'string') return '';
  const normalizeWith = (l) => {
    const stripRe = stripReFor(l);
    const syn = synFor(l);
    const orSplit = orSplitFor(l);
    let n = name.split(',')[0].trim().toLowerCase();
    if (stripRe) n = n.replace(stripRe, '').trim();
    n = n.replace(/\s+/g, ' ').trim();
    if (orSplit) n = n.split(orSplit)[0].trim();
    return syn[n] || n;
  };
  if (lang === 'da' || lang === 'en') return normalizeWith(lang);
  // Ingen sprog angivet: prøv dansk, derefter engelsk, foretræk hvad der findes i prisdata.
  const asDa = normalizeWith('da');
  if (_PRICES_DA && _PRICES_DA[asDa]) return asDa;
  const asEn = normalizeWith('en');
  if (_PRICES_EN && _PRICES_EN[asEn]) return asEn;
  // Ingen af dem matcher kendt prisdata — returnér bedste gæt (dansk-normaliseret).
  return asDa;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Omregn en mængde fra opskriftens enhed til købs-enheden (priceRow.unit).
// Returnerer null hvis enhederne ikke kan forliges (kalder falder da tilbage
// til at antage én hel pakke, ligesom den gamle prislogik i app.js gjorde).
function toPurchaseUnitAmount(amount, recipeUnit, priceRow) {
  const ru = (recipeUnit || '').toLowerCase();
  const pu = priceRow.unit;
  if (ru === pu) return amount;
  if (ru === '' && pu === 'stk') return amount; // tomt enhedsfelt = stk (tælleligt), fx "Løg","1",""
  const yieldPerPack = UNIT_YIELD[ru];
  if (yieldPerPack) return amount / yieldPerPack;
  return null;
}

// ---------------------------------------------------------------------------
// Kernelogik: rund altid op til hele pakker og respekter minPurchase.
// ---------------------------------------------------------------------------
function computeItemPurchase(amountRaw, recipeUnit, priceRow, opts) {
  const options = opts || {};
  if (!priceRow) {
    // Helt ukendt ingrediens: fladt gæt, matcher den gamle "+8 kr"-logik i app.js.
    const fb = FALLBACK_PRICES.default;
    return {
      purchasedAmount: null, packsNeeded: 1, totalCost: fb.packPrice,
      surplus: null, surplusInRecipeUnit: null, wastePercent: null,
      purchaseUnit: fb.unit, category: fb.category, unknownIngredient: true,
    };
  }
  const packSize = priceRow.typicalPackSize || priceRow.minPurchase || 1;
  const packPrice = priceRow.packPrice != null ? priceRow.packPrice : (priceRow.pack || 0);

  // Data-drevet "altid på hånden"-stabel (fx salt & peber): minPurchase 0 => intet at købe.
  if (priceRow.minPurchase === 0) {
    return {
      purchasedAmount: 0, packsNeeded: 0, totalCost: 0,
      surplus: 0, surplusInRecipeUnit: 0, wastePercent: 0,
      purchaseUnit: priceRow.unit, category: priceRow.category, assumedOwned: true,
    };
  }

  const amount = toNumber(amountRaw);
  if (amount === null) {
    // Ingen mængde angivet ("Persille","","til pynt") — antag man skal bruge mindst én pakke.
    const purchasedAmount = Math.max(priceRow.minPurchase || packSize, packSize);
    const packsNeeded = Math.max(1, Math.round(purchasedAmount / packSize));
    return {
      purchasedAmount, packsNeeded, totalCost: packsNeeded * packPrice,
      surplus: purchasedAmount, surplusInRecipeUnit: null, wastePercent: 100,
      purchaseUnit: priceRow.unit, category: priceRow.category, noQuantitySpecified: true,
    };
  }

  const scaled = amount * (options.multiplier || 1);
  const neededInPurchaseUnit = toPurchaseUnitAmount(scaled, recipeUnit, priceRow);

  if (neededInPurchaseUnit === null) {
    // Ukendt enheds-omregning: fald tilbage til gammel logik (én pakke à packPrice).
    return {
      purchasedAmount: packSize, packsNeeded: 1, totalCost: packPrice,
      surplus: null, surplusInRecipeUnit: null, wastePercent: null,
      purchaseUnit: priceRow.unit, category: priceRow.category, fallbackUsed: true,
    };
  }

  const packsNeeded = Math.max(1, Math.ceil(neededInPurchaseUnit / packSize));
  let purchasedAmount = packsNeeded * packSize;
  if (purchasedAmount < priceRow.minPurchase) purchasedAmount = priceRow.minPurchase; // sikkerhedsnet
  const totalCost = packsNeeded * packPrice;
  const surplus = Math.max(0, purchasedAmount - neededInPurchaseUnit);
  const wastePercent = purchasedAmount > 0 ? (surplus / purchasedAmount) * 100 : 0;
  const yieldPerPack = UNIT_YIELD[(recipeUnit || '').toLowerCase()];
  const surplusInRecipeUnit = yieldPerPack ? surplus * yieldPerPack : (recipeUnit === priceRow.unit ? surplus : null);

  return {
    purchasedAmount, packsNeeded, totalCost, surplus, surplusInRecipeUnit, wastePercent,
    purchaseUnit: priceRow.unit, category: priceRow.category, neededInPurchaseUnit,
  };
}

/**
 * Beregn den mest realistiske pris for ÉN ingrediens-linje: hvor meget skal
 * man reelt købe (hele pakker, min. indkøb respekteret), og hvad koster det.
 *
 * @param {string} ingredient Ingrediensnavn, fx "Hvidløg, presset"
 * @param {number|string|null} amount Mængde fra opskriften (kan være "" / null)
 * @param {string} unit Opskriftens enhed, fx "fed"
 * @param {object} [options] { lang, multiplier }
 * @returns {object} Detaljeret prisopslag, se computeItemPurchase()
 *
 * @example
 *   getItemPrice('Fløde', 1, 'dl')
 *   // => { purchasedAmount: 2.5, purchaseUnit:'dl', totalCost:12, surplus:1.5, wastePercent:60, ... }
 */
function getItemPrice(ingredient, amount, unit, options) {
  const opts = options || {};
  const lang = currentLang(opts.lang);
  const base = normalizeIngredientName(ingredient, lang);
  const priceRow = getPriceRow(base, lang);
  const result = computeItemPurchase(amount, unit, priceRow, opts);
  return { name: ingredient, base, neededAmount: toNumber(amount), neededUnit: unit || '', lang, ...result };
}

function flattenIngredients(input) {
  if (!Array.isArray(input)) {
    throw new TypeError('generateShoppingList/calculateRealisticCost: forventer et array af ingredienser.');
  }
  const out = [];
  input.forEach((entry) => {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && entry.length <= 3 && !Array.isArray(entry[0])) {
      out.push(entry); // [name, amount, unit]
    } else if (Array.isArray(entry)) {
      entry.forEach((sub) => out.push(sub)); // liste af lister (flere opskrifter)
    } else if (entry && Array.isArray(entry.ing)) {
      entry.ing.forEach((sub) => out.push(sub)); // opskrift-objekt {ing:[...]}
    }
  });
  return out;
}

/**
 * Byg en realistisk indkøbsliste ud fra én eller flere opskrifters
 * ingrediensliste(r). Runder altid op til hele pakker, respekterer
 * minPurchase, og grupperer varerne efter category.
 *
 * @param {Array} recipeIngredients  Enten [[navn,mængde,enhed], ...] for én
 *   opskrift, eller et array af sådanne lister / opskrift-objekter {ing:[...]}
 *   for flere opskrifter samlet (fx en ugeplan).
 * @param {object} [options]
 * @param {'da'|'en'} [options.lang] Sprog (autodetekteres via aktiv UI ellers 'da')
 * @param {number} [options.servings=1] Portionsfaktor (alias: multiplier)
 * @param {number} [options.maxWastePercent] Flag varer med højere spild end dette
 * @returns {{items: object[], byCategory: object, categoryOrder: string[],
 *   totalCost: number, totalSurplusValue: number, warnings: string[]}}
 *
 * @example
 *   const list = generateShoppingList(RECIPES_DA[0].ing, { servings: 2, maxWastePercent: 70 });
 *   list.byCategory.produce.forEach(item => console.log(item.displayName, item.purchasedAmount));
 */
function generateShoppingList(recipeIngredients, options) {
  const opts = options || {};
  const lang = currentLang(opts.lang);
  const multiplier = opts.servings || opts.multiplier || 1;
  const flat = flattenIngredients(recipeIngredients);
  const waterWord = lang === 'en' ? 'water' : 'vand';

  // Aggregér på grund-ingrediens: konvertér til købs-enhed FØR sammenlægning,
  // så flere opskrifter der bruger forskellige mål (fx "1 fed" og "2 fed") kan lægges sammen korrekt.
  const agg = new Map();
  flat.forEach(([name, amountRaw, unit]) => {
    if (!name || WATER_WORDS.has(name.trim().toLowerCase()) || name.trim().toLowerCase() === waterWord) return;
    const base = normalizeIngredientName(name, lang);
    const priceRow = getPriceRow(base, lang);
    const amount = toNumber(amountRaw);
    let entry = agg.get(base);
    if (!entry) {
      entry = { base, displayName: base.charAt(0).toUpperCase() + base.slice(1), priceRow, totalPurchaseUnits: 0, hasAnyQuantity: false, hasUnconvertible: false, recipeUnit: unit || '' };
      agg.set(base, entry);
    }
    if (amount !== null) {
      entry.hasAnyQuantity = true;
      const scaled = amount * multiplier;
      const converted = priceRow ? toPurchaseUnitAmount(scaled, unit, priceRow) : null;
      if (converted === null) entry.hasUnconvertible = true;
      else entry.totalPurchaseUnits += converted;
    }
  });

  const items = [];
  const byCategory = {};
  const warnings = [];
  let totalCost = 0;
  let totalSurplusValue = 0;

  agg.forEach((entry) => {
    const priceRow = entry.priceRow;
    let purchase;
    if (!priceRow) {
      purchase = computeItemPurchase(null, entry.recipeUnit, null, { multiplier });
      warnings.push(MSG[lang].unknownIngredient(entry.displayName));
    } else if (entry.hasUnconvertible || !entry.hasAnyQuantity) {
      // Fald tilbage til pr.-linje-beregning når mængder ikke kan lægges sammen entydigt.
      purchase = computeItemPurchase(entry.hasAnyQuantity ? 1 : null, priceRow.unit, priceRow, { multiplier: 1 });
    } else {
      const packSize = priceRow.typicalPackSize || priceRow.minPurchase || 1;
      const packPrice = priceRow.packPrice != null ? priceRow.packPrice : (priceRow.pack || 0);
      if (priceRow.minPurchase === 0) {
        purchase = { purchasedAmount: 0, packsNeeded: 0, totalCost: 0, surplus: 0, surplusInRecipeUnit: 0, wastePercent: 0, purchaseUnit: priceRow.unit, category: priceRow.category, assumedOwned: true };
      } else {
        const packsNeeded = Math.max(1, Math.ceil(entry.totalPurchaseUnits / packSize));
        let purchasedAmount = packsNeeded * packSize;
        if (purchasedAmount < priceRow.minPurchase) purchasedAmount = priceRow.minPurchase;
        const surplus = Math.max(0, purchasedAmount - entry.totalPurchaseUnits);
        const wastePercent = purchasedAmount > 0 ? (surplus / purchasedAmount) * 100 : 0;
        const yieldPerPack = UNIT_YIELD[(entry.recipeUnit || '').toLowerCase()];
        const surplusInRecipeUnit = yieldPerPack ? surplus * yieldPerPack : (entry.recipeUnit === priceRow.unit ? surplus : null);
        purchase = {
          purchasedAmount, packsNeeded, totalCost: packsNeeded * packPrice, surplus, surplusInRecipeUnit,
          wastePercent, purchaseUnit: priceRow.unit, category: priceRow.category, neededInPurchaseUnit: entry.totalPurchaseUnits,
        };
      }
    }

    const category = purchase.category || 'other';
    const item = { base: entry.base, displayName: entry.displayName, category, ...purchase };
    if (opts.maxWastePercent != null && typeof item.wastePercent === 'number' && item.wastePercent > opts.maxWastePercent) {
      item.highWaste = true;
      warnings.push(MSG[lang].highWaste(entry.displayName, item.wastePercent));
    }
    items.push(item);
    (byCategory[category] = byCategory[category] || []).push(item);
    totalCost += item.totalCost || 0;
    if (item.totalCost && typeof item.wastePercent === 'number') {
      totalSurplusValue += item.totalCost * (item.wastePercent / 100);
    }
  });

  const categoryOrder = CATEGORY_ORDER.filter((c) => byCategory[c]).concat(Object.keys(byCategory).filter((c) => !CATEGORY_ORDER.includes(c)));

  return { items, byCategory, categoryOrder, totalCost, totalSurplusValue, warnings, meta: { lang, servings: multiplier } };
}

/**
 * Beregn den samlede, realistiske pris for en opskrift/ugeplan — dvs. hvad
 * det faktisk koster at handle ind til den (hele pakker), IKKE den teoretiske
 * grampris ganget med opskriftens nøjagtige mængde.
 *
 * @param {Array} recipeIngredients Se generateShoppingList()
 * @param {object} [options] Se generateShoppingList()
 * @returns {number} Samlet pris i DKK
 *
 * @example
 *   calculateRealisticCost(RECIPES_DA[0].ing) // => 87
 */
function calculateRealisticCost(recipeIngredients, options) {
  return generateShoppingList(recipeIngredients, options).totalCost;
}

// ---------------------------------------------------------------------------
// Eksportér som rigtigt ES-modul...
// ---------------------------------------------------------------------------
export {
  generateShoppingList,
  calculateRealisticCost,
  normalizeIngredientName,
  getItemPrice,
  updatePrice,
};

// ...men gør funktionerne globalt tilgængelige, så det eksisterende
// klassiske (ikke-modul) app.js også kan kalde dem direkte, ligesom resten
// af Onepot.dk's arkitektur. Modul-scripts er deferred, så på det tidspunkt
// en bruger trykker på en knap i app.js, er dette allerede kørt.
if (typeof window !== 'undefined') {
  Object.assign(window, {
    generateShoppingList, calculateRealisticCost, normalizeIngredientName, getItemPrice, updatePrice,
  });
}
