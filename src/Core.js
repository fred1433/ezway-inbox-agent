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
    if (m.suffix && a.suffix && m.suffix !== a.suffix) return false;
    if (m.unit && a.unit && m.unit !== a.unit) return false;
    if (m.city && a.city && m.city !== a.city) return false;
    return true;
  });
  var parts = [];
  if (m.number) parts.push('house number ' + m.number);
  parts.push('street "' + m.name.join(' ') + '"');
  if (m.suffix) parts.push('street type "' + m.suffix + '"');
  if (m.dirs.length) parts.push('direction ' + m.dirs.join(' ').toUpperCase());
  if (m.unit) parts.push('unit ' + m.unit.toUpperCase());
  if (m.city) parts.push('city ' + m.city);
  var basis = parts.join(' and ');
  if (hits.length === 1) return { status: 'unique', record: hits[0], candidates: hits, reason: basis + ' matched 1 of ' + records.length + ' ' + noun };
  if (hits.length > 1) return { status: 'ambiguous', candidates: hits, reason: basis + ' matched ' + hits.length + ' of ' + records.length + ' ' + noun + ', so a person picks' };
  return { status: 'none', candidates: [], reason: basis + ' matched none of ' + records.length + ' ' + noun };
}


/* ---------------------------------------------------------------- sender identity (C1, C2) */

var EMAIL_RE = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[a-z]{2,}$/i;

/**
 * Parses one address header. The mailbox address is the one between < >; the display name is never searched for
 * an address. Several addresses, an address inside the display name, or a malformed address make the header ambiguous.
 */
function parseMailbox(header) {
  var h = String(header || '').trim();
  if (!h) return { email: '', name: '', ambiguous: true, reason: 'empty header' };
  var angles = h.match(/<[^<>]*>/g) || [];
  if (angles.length > 1) return { email: '', name: '', ambiguous: true, reason: 'several addresses in "' + h + '"' };
  var email, name;
  if (angles.length === 1) {
    email = angles[0].slice(1, -1).trim();
    name = h.slice(0, h.indexOf(angles[0])).trim().replace(/^"(.*)"$/, '$1').trim();
    if (/@/.test(name)) return { email: '', name: '', ambiguous: true, reason: 'an address inside the display name of "' + h + '"' };
  } else {
    email = h; name = '';
  }
  if (!EMAIL_RE.test(email)) return { email: '', name: '', ambiguous: true, reason: 'malformed address in "' + h + '"' };
  return { email: email.toLowerCase(), name: name, ambiguous: false, reason: '' };
}

/** Kept for simple lookups: the canonical mailbox address of a header, or '' when it is ambiguous. */
function normEmail(header) {
  var p = parseMailbox(header);
  return p.ambiguous ? '' : p.email;
}

/**
 * The identity used to read private records is the canonical From. A Reply-To that differs (web forms, services)
 * means the person cannot be tied to existing records: public listing facts only.
 */
function senderIdentity(msg) {
  var from = parseMailbox(msg.from);
  if (from.ambiguous) return { status: 'ambiguous', reason: from.reason, from: from, replyTo: null, recipient: '' };
  var replyTo = msg.replyTo ? parseMailbox(msg.replyTo) : null;
  if (replyTo && replyTo.ambiguous) return { status: 'ambiguous', reason: 'Reply-To: ' + replyTo.reason, from: from, replyTo: replyTo, recipient: '' };
  if (replyTo && replyTo.email !== from.email) {
    return { status: 'unclear', reason: 'From ' + from.email + ' but Reply-To ' + replyTo.email, from: from, replyTo: replyTo, recipient: replyTo.email };
  }
  return { status: 'clear', reason: '', from: from, replyTo: replyTo, recipient: from.email };
}

function money(n) {
  if (n === null || n === undefined || n === '') return null;
  return '$' + Number(n).toLocaleString('en-US');
}

var FINANCING_WORDS = {
  'FHA/VA/Conv': { en: 'FHA, VA or conventional financing, or cash', es: 'financiamiento FHA, VA o convencional, o efectivo', accepts: ['fha', 'va', 'conventional', 'cash'] },
  'Cash/Hard.M': { en: 'cash or hard money only', es: 'solo efectivo o préstamo de dinero privado (hard money)', accepts: ['cash', 'hard_money'] }
};

/* ---------------------------------------------------------------- provenance of extracted values (C4) */

var MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
var MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function squash(s) {
  return String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Dates written in a sentence, in order, as YYYY-MM-DD (year taken from the email date, rolled forward if earlier). */
function datesIn(text, refIso) {
  var ref = new Date(refIso || '2026-01-01T00:00:00Z'), year = ref.getUTCFullYear(), refMonth = ref.getUTCMonth();
  var out = [], s = squash(text), re = new RegExp('\\b(' + MONTHS_EN.concat(MONTHS_ES).concat(['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']).join('|') + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(\\d{1,2})\\s+de\\s+(' + MONTHS_ES.join('|') + ')\\b|\\b(\\d{4})-(\\d{2})-(\\d{2})\\b|\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b', 'g');
  var m;
  function monthIndex(w) {
    var i = MONTHS_EN.indexOf(w); if (i >= 0) return i;
    i = MONTHS_ES.indexOf(w); if (i >= 0) return i;
    return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w === 'sept' ? 'sep' : w);
  }
  function push(y, mo, d) {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return;
    if (y === null) y = mo < refMonth ? year + 1 : year;
    out.push(y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
  }
  while ((m = re.exec(s))) {
    if (m[1]) push(null, monthIndex(m[1]), Number(m[2]));
    else if (m[3]) push(null, monthIndex(m[4]), Number(m[3]));
    else if (m[5]) push(Number(m[5]), Number(m[6]) - 1, Number(m[7]));
    else if (m[8]) push(m[10] ? (m[10].length === 2 ? 2000 + Number(m[10]) : Number(m[10])) : null, Number(m[8]) - 1, Number(m[9]));
  }
  return out;
}

/** Amounts written in a text: $330,000, 330000, $330k. */
function amountsIn(text) {
  var out = [], m, re = /\$?\s?(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d{2})?|\$\s?(\d{1,3})\s?k\b/gi;
  while ((m = re.exec(String(text || '')))) out.push(m[1] ? Number(m[1].replace(/,/g, '')) : Number(m[2]) * 1000);
  return out;
}

/** True when every part of an address (number, street words, city) is written in the text. */
function addressWrittenIn(address, text, cities) {
  var a = parseAddress(address, cities), t = ' ' + squash(text).replace(/[.,;:!?()"]/g, ' ') + ' ';
  if (!a.name.length) return false;
  if (a.number && t.indexOf(' ' + a.number + ' ') < 0) return false;
  if (!a.name.every(function (w) { return t.indexOf(' ' + w + ' ') >= 0; })) return false;
  if (a.city && t.indexOf(' ' + a.city + ' ') < 0) return false;
  return true;
}

/**
 * Checks the values the model extracted against the email itself, in two steps: the quotation is in the body word
 * for word, and the normalized value follows from it. Returns the list of disagreements (empty when all hold).
 */
function checkProvenance(ex, msg, cities) {
  var problems = [], body = msg.subject + '\n' + msg.body;
  (ex.property_mentions || []).forEach(function (p) {
    if (!addressWrittenIn(p, body, cities)) problems.push('address "' + p + '" is not written in the email');
  });
  if (ex.seller_property && !addressWrittenIn(ex.seller_property, body, cities)) problems.push('seller address "' + ex.seller_property + '" is not written in the email');
  if (ex.budget_max && amountsIn(body).indexOf(ex.budget_max) < 0) problems.push('budget ' + money(ex.budget_max) + ' is not written in the email');
  var c = ex.contract_change;
  if (c) {
    if (!c.quote || squash(body).indexOf(squash(c.quote)) < 0) {
      problems.push('the quoted sentence is not in the email');
    } else if (c.field === 'closing_date' || c.field === 'inspection_period') {
      var dates = datesIn(c.quote, msg.date);
      var expected = /\bfrom\b.+\bto\b/i.test(c.quote) || /\bdel?\b.+\bal?\b/i.test(c.quote) ? dates.slice(-1) : dates;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.proposed || '') || expected.indexOf(c.proposed) < 0) {
        problems.push('extracted value ' + (c.proposed || '(none)') + ' does not follow from the quoted text');
      }
    } else if (c.field === 'price' || c.field === 'seller_credit') {
      if (amountsIn(c.quote).indexOf(Number(String(c.proposed).replace(/[$,\s]/g, ''))) < 0) problems.push('extracted value ' + c.proposed + ' does not follow from the quoted text');
    }
  }
  return problems;
}

/* ---------------------------------------------------------------- facts and code-built clauses (R9, C5) */

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
    alternatives_basis: null,
    seller_property: null,
    current_value: null,
    proposed_value: null,
    next_action: null
  };
  Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
  return f;
}

function fmtDateLong(iso, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return iso;
  var p = String(iso).split('-').map(Number);
  var en = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return lang === 'es' ? p[2] + ' de ' + MONTHS_ES[p[1] - 1] : en[p[1] - 1] + ' ' + p[2];
}

/** Which clauses the draft may use, by next action. The model picks among these and writes the words in between. */
var CLAUSES_BY_ACTION = {
  confirm_listed_terms_and_showing: ['sale_terms', 'home_size'],
  suggest_alternatives: ['sale_terms', 'alternatives'],
  ask_budget_and_area: ['sale_terms'],
  no_alternatives_in_budget: ['sale_terms'],
  team_will_confirm: ['under_contract'],
  offer_backup: ['under_contract'],
  quote_published_terms: ['rental_terms', 'home_size', 'section8_statement'],
  acknowledge_seller_details: ['seller_property'],
  acknowledge_amendment: ['amendment_ack'],
  point_to_contractor_form: ['contractor_form'],
  acknowledge: []
};

/**
 * Builds the complete factual clauses from the facts object: each amount with its role and period, the full
 * property identity, the advertised financing as published. Returns { clauses, values } (values = the inserted
 * facts, so the page can underline them).
 */
function buildClauses(facts, ctx) {
  var es = ctx.language === 'es', c = {}, values = [];
  var where = facts.address ? facts.address + ', ' + facts.city : null;
  var fin = facts.financing_listed ? FINANCING_WORDS[facts.financing_listed] : null;
  function v(x) { if (x) values.push(String(x)); return x; }
  c.greeting = es ? (ctx.first_name ? 'Hola ' + ctx.first_name + ':' : 'Hola:') : (ctx.first_name ? 'Hi ' + ctx.first_name + ',' : 'Hello,');
  c.signature = es ? ctx.config.SIGNATURE_ES : ctx.config.SIGNATURE;
  if (where && facts.price && fin) {
    c.sale_terms = es
      ? v(where) + ' está publicada en venta en nuestro sitio a ' + v(money(facts.price)) + '. La publicación indica estas condiciones de financiamiento: ' + v(fin.es) + '.'
      : v(where) + ' is listed for sale on our website at ' + v(money(facts.price)) + '. The listing states these financing terms: ' + v(fin.en) + '.';
  }
  if (facts.beds !== null && facts.beds !== undefined && facts.baths !== null && facts.baths !== undefined && Number(facts.beds) > 0) {
    c.home_size = es ? 'Tiene ' + facts.beds + ' habitaciones y ' + facts.baths + (Number(facts.baths) === 1 ? ' baño.' : ' baños.') : 'It is a ' + facts.beds + ' bed, ' + facts.baths + ' bath home.';
  }
  if (where && facts.status === 'UNDER CONTRACT') {
    c.under_contract = es ? v(where) + ' está actualmente bajo contrato.' : v(where) + ' is currently under contract.';
  }
  if (where && facts.rent && facts.deposit) {
    c.rental_terms = es
      ? 'La publicación de ' + v(where) + ' en nuestro sitio indica una renta de ' + v(money(facts.rent)) + ' al mes y un depósito de seguridad de ' + v(money(facts.deposit)) + '.'
      : v(where) + ' is listed for rent on our website at ' + v(money(facts.rent)) + ' per month, with a security deposit of ' + v(money(facts.deposit)) + '.';
  }
  if (facts.section8_welcome) c.section8_statement = es ? 'La publicación dice «Section 8 Welcome».' : 'The listing says "Section 8 Welcome".';
  if (facts.alternatives && facts.alternatives.length && facts.alternatives_basis) {
    var b = facts.alternatives_basis;
    c.alternatives = (es ? 'Estas casas de nuestro sitio se publican con financiamiento ' + b.financing.toUpperCase() + ', en ' + v(b.area) + ', por ' + v(money(b.budget)) + ' o menos:\n' : 'These homes on our website are listed with ' + b.financing.toUpperCase() + ' financing, in ' + v(b.area) + ', at or under ' + v(money(b.budget)) + ':\n')
      + facts.alternatives.map(function (a) { return '- ' + v(a.address) + ', ' + a.city + ': ' + v(money(a.price)) + ', ' + a.beds + ' bed / ' + a.baths + ' bath'; }).join('\n');
  }
  if (facts.seller_property) c.seller_property = v(facts.seller_property);
  if (where && facts.current_value && facts.proposed_value) {
    c.amendment_ack = es
      ? 'Recibimos la enmienda de ' + v(where) + ', que propone mover el cierre del ' + v(fmtDateLong(facts.current_value, 'es')) + ' al ' + v(fmtDateLong(facts.proposed_value, 'es')) + '.'
      : 'We received the amendment for ' + v(where) + ' proposing to move the closing date from ' + v(fmtDateLong(facts.current_value, 'en')) + ' to ' + v(fmtDateLong(facts.proposed_value, 'en')) + '.';
  }
  if (ctx.config.CONTRACTOR_FORM_URL) c.contractor_form = (es ? 'Puede postularse como contratista aquí: ' : 'You can apply as a contractor here: ') + ctx.config.CONTRACTOR_FORM_URL;
  return { clauses: c, values: values };
}

/* ---------------------------------------------------------------- the model's own words (C5) */

var NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'half', 'dozen',
  'cero', 'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'doce', 'quince', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento', 'mil', 'millón', 'millones'];
var DAY_WORDS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo', 'tomorrow', 'tonight', 'mañana'];
var PERIOD_WORDS = ['weekly', 'monthly', 'yearly', 'annually', 'annual', 'biweekly', 'semanal', 'mensual', 'anual', 'quincenal'];
var PERIOD_PHRASES = [/\bper (?:month|week|year|day)\b/i, /\ba (?:month|week|year)\b/i, /\bal (?:mes|año)\b/i, /\bpor (?:mes|semana|año)\b/i];
var MONEY_WORDS = ['dollar', 'dollars', 'usd', 'dólar', 'dólares', 'bucks', 'grand'];
var FINANCING_TERMS = [/\bFHA\b/i, /\bVA\b/, /\bconventional\b/i, /\bconvencional\b/i, /\bcash\b/i, /\befectivo\b/i, /\bhard\s+money\b/i, /\bdinero privado\b/i, /\bsection\b/i, /\bsecci[oó]n\b/i, /\bUSDA\b/i, /\bmortgage\b/i, /\bhipoteca\b/i];

var BANNED = [
  /\bineligible\b/i, /\bnot eligible\b/i, /\beligible\b/i, /\belegible\b/i, /\bdoes not qualify\b/i, /\bno califica\b/i,
  /\bqualif(?:y|ies|ied)\b/i, /\bcalific(?:a|an|ado|ada)\b/i, /\bapproved\b/i, /\baprobad[oa]s?\b/i,
  /\bguarantee/i, /\bgarantiza/i, /\baccepted\b/i, /\bacept(?:a|amos|an|ado|ada|ados|adas)\b/i
];

/**
 * The model's free text (the template with the clause slots removed) carries no fact: no digit, number word, month,
 * day, money word, rent period, financing term, street or city name, and no eligibility or acceptance claim.
 */
function freeTextProblems(template, ctx) {
  var problems = [];
  var free = String(template || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, function (all, k) {
    if ((ctx.allowedClauses || []).indexOf(k) < 0 && k !== 'greeting' && k !== 'signature') problems.push('clause ' + k + ' is not allowed for this message');
    return ' ';
  });
  var words = squash(free).replace(/[^a-z0-9À-ſ$' -]/g, ' ').split(/\s+/).filter(Boolean);
  if (/\d/.test(free)) problems.push('free text contains a number: ' + (free.match(/[$\d][\d,.$]*/g) || []).join(' '));
  if (/\$/.test(free)) problems.push('free text contains an amount');
  words.forEach(function (w) {
    if (NUMBER_WORDS.indexOf(w) >= 0) problems.push('free text contains a number word: ' + w);
    if (MONTHS_EN.indexOf(w) >= 0 || MONTHS_ES.indexOf(w) >= 0) problems.push('free text contains a month: ' + w);
    if (DAY_WORDS.indexOf(w) >= 0) problems.push('free text contains a day: ' + w);
    if (PERIOD_WORDS.indexOf(w) >= 0) problems.push('free text contains a rent period: ' + w);
    if (MONEY_WORDS.indexOf(w) >= 0) problems.push('free text contains a money word: ' + w);
    if ((ctx.placeWords || {})[w]) problems.push('free text contains a street or city name: ' + w);
  });
  PERIOD_PHRASES.forEach(function (re) { if (re.test(free)) problems.push('free text contains a rent period: ' + free.match(re)[0]); });
  FINANCING_TERMS.forEach(function (re) { if (re.test(free)) problems.push('free text contains a financing term: ' + free.match(re)[0]); });
  BANNED.forEach(function (re) { if (re.test(free)) problems.push('claim not allowed: ' + free.match(re)[0]); });
  (free.match(/[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}/gi) || []).forEach(function (e) { problems.push('email address ' + e + ' in the draft'); });
  (free.match(/https?:\/\/\S+|www\.\S+/gi) || []).forEach(function (u) { problems.push('link ' + u + ' in the draft'); });
  return problems;
}

/** Street and city words of every known record: the model's free text may not name a place. */
function placeWords(tables, extraCities) {
  var out = {}, stop = { n: 1, s: 1, e: 1, w: 1, ne: 1, nw: 1, se: 1, sw: 1 };
  function add(addr) { parseAddress(addr).name.forEach(function (w) { if (!/\d/.test(w) && !stop[w] && w.length > 1) out[w] = true; }); }
  (tables.Listings || []).forEach(function (l) { add(l.address); squash(l.city).split(' ').forEach(function (w) { out[w] = true; }); });
  (tables.Leads || []).forEach(function (l) { add(String(l.property_address || '').split(',')[0]); });
  (tables.Transactions || []).forEach(function (x) { add(String(x.address || '').split(',')[0]); });
  (extraCities || []).forEach(function (c) { squash(c).split(' ').forEach(function (w) { if (w.length > 2) out[w] = true; }); });
  return out;
}

/** Fills the clause slots. Unknown or empty slots are problems. */
function renderDraft(template, built) {
  var problems = [];
  var text = String(template).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, function (all, key) {
    var v = built.clauses[key];
    if (v === null || v === undefined || v === '') { problems.push('no value for ' + key); return all; }
    return String(v);
  });
  return { text: text, problems: problems };
}

/** Last checks on the finished draft: links, phones, email addresses, rent and deposit roles, claims. */
function validateDraft(text, facts, config) {
  var problems = [], mm;
  var rentRe = /\b(rent|renta)\b[^$\n.]{0,30}\$\s?([\d,]+)/gi, depRe = /\b(deposit|dep[oó]sito)\b[^$\n.]{0,30}\$\s?([\d,]+)/gi;
  while ((mm = rentRe.exec(text))) if (Number(mm[2].replace(/,/g, '')) !== Number(facts.rent)) problems.push('rent stated as $' + mm[2] + ' but the record says ' + money(facts.rent));
  while ((mm = depRe.exec(text))) if (Number(mm[2].replace(/,/g, '')) !== Number(facts.deposit)) problems.push('deposit stated as $' + mm[2] + ' but the record says ' + money(facts.deposit));
  (text.match(/[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}/gi) || []).forEach(function (e) { problems.push('email address ' + e + ' in the draft'); });
  (text.match(/https?:\/\/[^\s)]+/gi) || []).forEach(function (u) {
    if ([config.CONTRACTOR_FORM_URL, facts.source_url].indexOf(u) < 0) problems.push('link ' + u + ' is not on the allowed list');
  });
  (text.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g) || []).forEach(function (ph) {
    if (ph.replace(/\D/g, '') !== String(config.OFFICE_PHONE).replace(/\D/g, '')) problems.push('phone ' + ph + ' is not the office line');
  });
  BANNED.forEach(function (re) { if (re.test(text)) problems.push('claim not allowed: ' + text.match(re)[0]); });
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
