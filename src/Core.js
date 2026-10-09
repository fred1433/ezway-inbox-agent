/**
 * Core.js: pure functions, no Google services. Runs the same in Apps Script and in Node (tests, page build).
 * Address normalization, record matching, typed facts, slot rendering and draft validation.
 */

var SUFFIXES = {
  avenue: 'ave', ave: 'ave', av: 'ave', street: 'st', st: 'st', drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln',
  circle: 'cir', cir: 'cir', court: 'ct', ct: 'ct', road: 'rd', rd: 'rd', boulevard: 'blvd', blvd: 'blvd',
  place: 'pl', pl: 'pl', terrace: 'ter', ter: 'ter', way: 'way', trail: 'trl', trl: 'trl', parkway: 'pkwy', pkwy: 'pkwy'
};
var DIRECTIONS = { n: 'n', north: 'n', s: 's', south: 's', e: 'e', east: 'e', w: 'w', west: 'w', ne: 'ne', nw: 'nw', se: 'se', sw: 'sw' };
var FILLER = { the: 1, house: 1, home: 1, on: 1, at: 1, property: 1, la: 1, casa: 1, de: 1, en: 1, fl: 1, florida: 1, unit: 1, apt: 1 };

/** Splits an address into comparable parts, keeping unit, direction and city (never dropped). */
function parseAddress(text, knownCities) {
  var s = String(text || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  var unit = null;
  var unitMatch = s.match(/(?:#|unit |apt )\s*([a-z0-9]+)/);
  if (unitMatch) { unit = unitMatch[1]; s = s.replace(unitMatch[0], ' '); }
  var city = null;
  (knownCities || []).forEach(function (c) {
    var lc = c.toLowerCase();
    if (!city && new RegExp('\\b' + lc + '\\b').test(s)) { city = lc; s = s.replace(lc, ' '); }
  });
  var tokens = s.split(' ').filter(Boolean).filter(function (t) { return !/^\d{5}$/.test(t); });
  var number = null, dirs = [], name = [], suffix = null;
  tokens.forEach(function (t, i) {
    if (number === null && /^\d{1,6}$/.test(t) && name.length === 0) { number = t; return; }
    if (DIRECTIONS[t] && (name.length === 0 || i === tokens.length - 1 || SUFFIXES[tokens[i - 1]])) { dirs.push(DIRECTIONS[t]); return; }
    if (SUFFIXES[t] && name.length > 0) { suffix = SUFFIXES[t]; return; }
    if (FILLER[t]) return;
    if (/^[a-z]$/.test(t) && suffix) { unit = unit || t; return; }
    name.push(t);
  });
  return { number: number, dirs: dirs, name: name, suffix: suffix, unit: unit, city: city };
}

function listingAddressText(l) {
  return l.address + (l.unit ? ', ' + l.unit : '') + ', ' + l.city + ', FL ' + l.zip;
}

/**
 * Finds the record an address mention points to. A match needs every street-name word of the mention;
 * a house number, direction, unit or city in the mention must agree when the record has one.
 * Returns { status: 'unique' | 'ambiguous' | 'none', record, candidates, reason }.
 */
function matchAddress(mention, records, addressOf, knownCities, noun) {
  noun = noun || 'records';
  var m = parseAddress(mention, knownCities);
  if (m.name.length === 0) return { status: 'none', candidates: [], reason: 'No street name in "' + mention + '".' };
  var hits = records.filter(function (r) {
    var a = parseAddress(addressOf(r), knownCities);
    if (m.number && a.number !== m.number) return false;
    if (!m.name.every(function (w) { return a.name.indexOf(w) >= 0; })) return false;
    if (m.dirs.length && a.dirs.length && m.dirs.join() !== a.dirs.join()) return false;
    if (m.unit && a.unit && m.unit !== a.unit) return false;
    if (m.city && a.city && m.city !== a.city) return false;
    return true;
  });
  var parts = [];
  if (m.number) parts.push('house number ' + m.number);
  parts.push('street "' + m.name.join(' ') + '"');
  if (m.dirs.length) parts.push('direction ' + m.dirs.join(' ').toUpperCase());
  if (m.unit) parts.push('unit ' + m.unit.toUpperCase());
  if (m.city) parts.push('city ' + m.city);
  var basis = parts.join(' and ');
  if (hits.length === 1) return { status: 'unique', record: hits[0], candidates: hits, reason: basis + ' matched 1 of ' + records.length + ' ' + noun };
  if (hits.length > 1) return { status: 'ambiguous', candidates: hits, reason: basis + ' matched ' + hits.length + ' of ' + records.length + ' ' + noun + ', so a person picks' };
  return { status: 'none', candidates: [], reason: basis + ' matched none of ' + records.length + ' ' + noun };
}

function normEmail(e) {
  var m = String(e || '').match(/[^\s<>"]+@[^\s<>"]+/);
  return m ? m[0].toLowerCase() : '';
}

function money(n) {
  if (n === null || n === undefined || n === '') return null;
  return '$' + Number(n).toLocaleString('en-US');
}

var FINANCING_WORDS = {
  'FHA/VA/Conv': { en: 'FHA, VA or conventional financing, or cash', es: 'financiamiento FHA, VA o convencional, o efectivo', accepts: ['fha', 'va', 'conventional', 'cash'] },
  'Cash/Hard.M': { en: 'cash or hard money only', es: 'solo efectivo o préstamo de dinero privado (hard money)', accepts: ['cash', 'hard_money'] }
};

/**
 * The facts object: the only source of the numbers and terms a draft may state (R9).
 * Typed, with the source URL and capture date of the listing it came from.
 */
function buildFacts(listing, extra) {
  var fin = listing && listing.financing_listed ? FINANCING_WORDS[listing.financing_listed] : null;
  var f = {
    listing_id: listing ? listing.listing_id : null,
    address: listing ? listing.address + (listing.unit ? ', ' + listing.unit : '') : null,
    city: listing ? listing.city : null,
    status: listing ? listing.status : null,
    price: listing && listing.price ? Number(listing.price) : null,
    rent: listing && listing.rent ? Number(listing.rent) : null,
    deposit: listing && listing.deposit ? Number(listing.deposit) : null,
    beds: listing ? listing.beds : null,
    baths: listing ? listing.baths : null,
    financing_listed: listing ? listing.financing_listed : null,
    financing_accepts: fin ? fin.accepts : [],
    section8_welcome: listing ? listing.section8_welcome === true || listing.section8_welcome === 'TRUE' : false,
    backup_offers_ok: listing ? listing.backup_offers_ok === true || listing.backup_offers_ok === 'TRUE' : false,
    source_url: listing ? listing.source_url : null,
    captured_at: listing ? listing.captured_at : null,
    alternatives: [],
    extra_addresses: [],
    next_action: null
  };
  Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
  return f;
}

var ALLOWED_SLOTS = ['first_name', 'address', 'city', 'price', 'financing_listed', 'rent', 'deposit', 'beds', 'baths',
  'alternatives', 'seller_property', 'current_value', 'proposed_value', 'office_phone', 'contractor_form_url', 'signature'];

/** Inserts the committing parts (amounts, terms, addresses) from the facts object. The model never types them. */
function renderDraft(template, facts, ctx) {
  var lang = ctx.language === 'es' ? 'es' : 'en';
  var fin = facts.financing_listed ? FINANCING_WORDS[facts.financing_listed] : null;
  var values = {
    first_name: ctx.first_name || '',
    address: facts.address,
    city: facts.city,
    price: money(facts.price),
    financing_listed: fin ? fin[lang] : null,
    rent: money(facts.rent),
    deposit: money(facts.deposit),
    beds: facts.beds,
    baths: facts.baths,
    alternatives: (facts.alternatives || []).map(function (a) {
      return lang === 'es' ? '- ' + a.address + ', ' + a.city + ': ' + money(a.price) : '- ' + a.address + ', ' + a.city + ': ' + money(a.price) + ', ' + a.beds + ' bed / ' + a.baths + ' bath';
    }).join('\n'),
    seller_property: facts.seller_property || null,
    current_value: facts.current_value || null,
    proposed_value: facts.proposed_value || null,
    office_phone: ctx.config.OFFICE_PHONE,
    contractor_form_url: ctx.config.CONTRACTOR_FORM_URL,
    signature: lang === 'es' ? ctx.config.SIGNATURE_ES : ctx.config.SIGNATURE
  };
  var missing = [];
  var text = String(template).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, function (all, key) {
    if (ALLOWED_SLOTS.indexOf(key) < 0) { missing.push('unknown slot ' + key); return all; }
    var v = values[key];
    if (v === null || v === undefined || v === '') { missing.push('no value for ' + key); return all; }
    return String(v);
  });
  return { text: text, problems: missing };
}

var BANNED = [
  /\bineligible\b/i, /\bnot eligible\b/i, /\bdoes not qualify\b/i, /\bno califica\b/i,
  /\byou(?:'re| are) approved\b/i, /\bapproved for this\b/i, /\bqueda aprobad[oa]\b/i,
  /\bguarantee/i, /\bgarantiza/i, /\bis accepted\b/i, /\bfue aceptad[oa]\b/i
];

/**
 * Checks the rendered draft against the facts (v2 #6 and R9):
 * every amount and street address must exist in the facts, rent and deposit are never swapped,
 * no email address, phone or URL other than the allowed ones, no eligibility or approval claims.
 */
function validateDraft(text, facts, config) {
  var problems = [];
  var amounts = [facts.price, facts.rent, facts.deposit].filter(Boolean).map(Number);
  (facts.alternatives || []).forEach(function (a) { amounts.push(Number(a.price)); });
  (text.match(/\$\s?[\d,]+(?:\.\d{2})?/g) || []).forEach(function (m) {
    var n = Number(m.replace(/[$,\s]/g, ''));
    if (amounts.indexOf(n) < 0) problems.push('amount ' + m + ' is not in the matched record');
  });
  var rentRe = /\b(rent|renta|alquiler)\b[^$\n]{0,30}\$\s?([\d,]+)/gi, depRe = /\b(deposit|dep[oó]sito)\b[^$\n]{0,30}\$\s?([\d,]+)/gi, mm;
  while ((mm = rentRe.exec(text))) if (Number(mm[2].replace(/,/g, '')) !== Number(facts.rent)) problems.push('rent stated as $' + mm[2] + ' but the record says ' + money(facts.rent));
  while ((mm = depRe.exec(text))) if (Number(mm[2].replace(/,/g, '')) !== Number(facts.deposit)) problems.push('deposit stated as $' + mm[2] + ' but the record says ' + money(facts.deposit));

  var allowedAddr = [facts.address, facts.seller_property].concat((facts.alternatives || []).map(function (a) { return a.address; })).concat(facts.extra_addresses || []).filter(Boolean);
  var allowedParsed = allowedAddr.map(function (a) { return parseAddress(a); });
  var addrRe = /\b(\d{2,6})\s+((?:[NSEW]\.?\s+)?[A-Z0-9][A-Za-z0-9]*(?:\s+[A-Z][a-z]+)?)/g;
  while ((mm = addrRe.exec(text))) {
    var p = parseAddress(mm[0]);
    if (!p.name.length || /^\d{4}$/.test(mm[1]) && /^(and|to|at|in|or)$/i.test(p.name[0])) continue;
    var ok = allowedParsed.some(function (a) { return a.number === p.number && p.name.every(function (w) { return a.name.indexOf(w) >= 0 || a.suffix === SUFFIXES[w]; }); });
    var looksLikeStreet = /[A-Z]/.test(mm[2].charAt(0)) && !/^(bed|bath|day|days|minutes|am|pm)$/i.test(p.name[0]);
    if (!ok && looksLikeStreet && !/^20\d\d$/.test(mm[1])) problems.push('address "' + mm[0].trim() + '" is not in the matched record');
  }
  (text.match(/[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}/gi) || []).forEach(function (e) { problems.push('email address ' + e + ' in the draft'); });
  (text.match(/https?:\/\/[^\s)]+/gi) || []).forEach(function (u) {
    if ([config.CONTRACTOR_FORM_URL, facts.source_url].indexOf(u) < 0) problems.push('link ' + u + ' is not on the allowed list');
  });
  (text.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g) || []).forEach(function (ph) {
    if (ph.replace(/\D/g, '') !== String(config.OFFICE_PHONE).replace(/\D/g, '')) problems.push('phone ' + ph + ' is not the office line');
  });
  BANNED.forEach(function (re) { if (re.test(text)) problems.push('claim not allowed: ' + re.source); });
  if (/\{\{/.test(text)) problems.push('unfilled slot');
  return problems;
}

/** Spreadsheet text is written as a literal: a leading = + - @ never becomes a formula (R8). */
function literal(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

