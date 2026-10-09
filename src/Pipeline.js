/**
 * Pipeline.js: one pipeline for every run. The model adapter (fixture or Gemini), the mailbox adapter and the
 * sheet adapter are passed in; identity, matching, decisions, validation and sheet writes are this file, always.
 */

var CATEGORIES = ['buyer_inquiry', 'rental_inquiry', 'seller_lead', 'contract_update', 'investor', 'contractor_application', 'spam', 'other'];
var FINANCING = ['fha', 'va', 'conventional', 'cash', 'hard_money', 'section8_voucher', 'unknown'];
var CHANGE_FIELDS = ['closing_date', 'price', 'seller_credit', 'inspection_period', 'other'];

/** The closed set of sheet writes (R8). Anything else is refused before it reaches a sheet. */
var WRITABLE = {
  Contacts: { append: true, update: ['last_contact'] },
  Leads: { append: true, update: ['last_contact', 'property_address'] },
  Interactions: { append: true, update: [] },
  Review: { append: true, update: [] }
};
/** Fields that may only be filled when empty (a provisional seller lead getting its address, C7). */
var FILL_ONLY = { Leads: ['property_address'] };

/** Dates are stored as YYYY-MM-DD, without spaces (C6). */
function normalizeDateValue(v, refIso) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var d = datesIn(s, refIso);
  return d.length === 1 ? d[0] : s;
}

/** Keeps only the known fields of the model's extraction, with their types. Unknown keys are dropped (R6). */
function cleanExtraction(raw, msg) {
  var problems = [];
  if (!raw || typeof raw !== 'object') return { value: null, problems: ['extraction is not an object'] };
  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max || 400) : null; }
  var v = {
    category: CATEGORIES.indexOf(raw.category) >= 0 ? raw.category : null,
    language: raw.language === 'es' ? 'es' : raw.language === 'en' ? 'en' : null,
    sender_name: str(raw.sender_name, 80),
    property_mentions: Array.isArray(raw.property_mentions) ? raw.property_mentions.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 3).map(function (x) { return x.trim(); }) : [],
    financing: FINANCING.indexOf(raw.financing) >= 0 ? raw.financing : 'unknown',
    budget_max: typeof raw.budget_max === 'number' && raw.budget_max > 0 ? raw.budget_max : null,
    area: str(raw.area, 60),
    seller_property: str(raw.seller_property, 120) || null,
    details: Array.isArray(raw.details) ? raw.details.filter(function (x) { return typeof x === 'string'; }).slice(0, 6).map(function (x) { return x.slice(0, 160); }) : [],
    contract_change: null,
    summary: str(raw.summary, 300) || '',
    confidence: raw.confidence === 'high' ? 'high' : 'low'
  };
  if (raw.contract_change && typeof raw.contract_change === 'object') {
    var c = raw.contract_change, field = CHANGE_FIELDS.indexOf(c.field) >= 0 ? c.field : 'other';
    v.contract_change = {
      field: field,
      proposed: field === 'closing_date' || field === 'inspection_period' ? normalizeDateValue(c.proposed, msg && msg.date) : str(String(c.proposed === undefined ? '' : c.proposed), 60),
      quote: str(c.quote, 300)
    };
  }
  if (!v.category) problems.push('category missing or unknown');
  if (!v.language) problems.push('language missing');
  if (v.confidence !== 'high') problems.push('model marked the result as uncertain');
  return { value: v, problems: problems };
}

function nowParts(clock, tz) {
  var d = clock.now();
  var date = typeof Utilities !== 'undefined' ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  return { date: date, iso: d.toISOString(), ms: d.getTime() };
}

function nextId(rows, field, prefix, taken) {
  var max = 0;
  rows.concat(taken || []).forEach(function (r) { var n = parseInt(String(r[field] || '').replace(/\D/g, ''), 10); if (n > max) max = n; });
  return prefix + String(max + 1).padStart(4, '0');
}

function knownCities(t, config) {
  return t.Listings.map(function (l) { return l.city; }).concat(config.EXTRA_CITIES || []);
}

/**
 * Pure decision step. From the message, the sender identity, the cleaned extraction (with its provenance check)
 * and the current tables, returns a serializable plan: trace, sheet operations with stable ids, status, facts and
 * the one next action the draft may take. No Google service is touched here.
 */
function planMessage(msg, ex, t, config, today, identity, base, prov) {
  var trace = [], ops = [], planned = {};
  var plan = { extraction: ex, trace: trace, ops: ops, status: null, statusTone: 'ok', facts: buildFacts(null), nextAction: null, draftMode: 'model', listing: null, lead: null, review: null, problems: [], identity: identity.status, recipient: identity.recipient, first_name: '', language: ex.language };
  var cities = knownCities(t, config);
  function newId(tab, field, prefix) { var id = nextId(t[tab], field, prefix, planned[tab] || []); (planned[tab] = planned[tab] || []).push(fieldObj(field, id)); return id; }
  function fieldObj(f, v) { var o = {}; o[f] = v; return o; }
  function addReview(field, current, proposed, source, ref) {
    ops.push({ op: 'append', tab: 'Review', row: { review_id: newId('Review', 'review_id', 'R-'), ref: ref || msg.id, field: field, current_value: current || '', proposed_value: proposed || '', source: source, status: 'To review', created: today, op_id: base + ':review:' + field } });
  }
  function interaction(contactId, leadId) {
    ops.push({ op: 'append', tab: 'Interactions', row: { interaction_id: newId('Interactions', 'interaction_id', 'I-'), contact_id: contactId || '', lead_id: leadId || '', gmail_message_id: msg.id, received_at: msg.date, category: ex.category, summary: ex.summary, op_id: base + ':interaction' } });
    trace.push({ step: 'Interaction', result: 'Logged ' + planned.Interactions[planned.Interactions.length - 1].interaction_id, why: 'message ' + msg.id });
  }

  if (ex.category === 'spam') {
    plan.status = 'Spam, left alone'; plan.statusTone = 'quiet'; plan.draftMode = 'none';
    trace.push({ step: 'Category', result: 'Spam: no record written, no reply drafted.' });
    return plan;
  }

  // Provenance first (C4): a value the email does not support never reaches a record or a draft.
  if (prov && prov.length) {
    plan.problems = prov.slice();
    var c0 = identity.status === 'clear' ? t.Contacts.filter(function (c) { return normEmail(c.email) === identity.from.email; })[0] : null;
    addReview(ex.contract_change ? ex.contract_change.field : 'extraction', '', '', 'Extraction disagrees with the email: ' + prov.join('; ') + (ex.contract_change && ex.contract_change.quote ? '. Quote: "' + ex.contract_change.quote + '"' : ''));
    interaction(c0 ? c0.contact_id : '', '');
    plan.review = { field: 'extraction', reason: prov.join('; ') };
    plan.status = 'Needs a person'; plan.statusTone = 'review'; plan.draftMode = 'generic';
    plan.first_name = c0 ? firstName(c0.name) : '';
    trace.push({ step: 'Check', result: 'Extracted values held back', why: prov.join('; ') });
    return plan;
  }

  // 1. Contact, only for a clear sender (C1, C2)
  var contact = null;
  if (identity.status === 'clear') {
    var email = identity.from.email;
    contact = t.Contacts.filter(function (c) { return normEmail(c.email) === email; })[0];
    var roleBy = { buyer_inquiry: 'buyer', rental_inquiry: 'tenant', seller_lead: 'seller', contract_update: 'agent', investor: 'investor', contractor_application: 'contractor', other: 'unknown' };
    if (contact) {
      trace.push({ step: 'Contact', result: 'Found ' + contact.contact_id + ' (' + contact.name + ')', why: 'same sender address ' + email });
      ops.push({ op: 'update', tab: 'Contacts', key: ['contact_id', contact.contact_id], fields: { last_contact: today } });
    } else {
      contact = { contact_id: newId('Contacts', 'contact_id', 'C-'), name: identity.from.name || ex.sender_name || email, email: email, role: roleBy[ex.category], language: ex.language, first_seen: today, last_contact: today, op_id: base + ':contact' };
      trace.push({ step: 'Contact', result: 'New contact ' + contact.contact_id, why: 'no contact with ' + email });
      ops.push({ op: 'append', tab: 'Contacts', row: contact });
    }
    plan.first_name = firstName(contact.name);
  } else {
    trace.push({ step: 'Sender', result: 'Sender identity unclear', why: identity.reason + '; no existing contact, lead or transaction is used' });
    addReview('sender identity', identity.from.email, identity.recipient, 'Sender identity unclear: ' + identity.reason);
    plan.review = { field: 'sender identity', reason: identity.reason };
  }

  // 2. The property: listing (public), then the lead or the transaction (private, clear sender only)
  var lead = null, listing = null, review = null;
  if (ex.category === 'buyer_inquiry' || ex.category === 'rental_inquiry' || ex.category === 'contract_update') {
    var pool = ex.category === 'rental_inquiry' ? t.Listings.filter(function (l) { return l.status === 'FOR RENT'; }) : t.Listings;
    var mention = ex.property_mentions[0];
    var m = mention ? matchAddress(mention, pool, function (l) { return l.address + (l.unit ? ' unit ' + l.unit : '') + ' ' + l.city; }, cities, ex.category === 'rental_inquiry' ? 'rental listings' : 'listings') : { status: 'none', candidates: [], reason: 'no address in the email' };
    if (m.status !== 'unique') {
      review = { field: 'listing', current: '', proposed: (m.candidates || []).map(function (c) { return c.address + ', ' + c.city; }).join(' | '), reason: m.reason };
      trace.push({ step: 'Listing', result: m.status === 'ambiguous' ? 'Ambiguous: ' + m.candidates.length + ' listings fit' : 'No listing found', why: m.reason });
    } else {
      listing = m.record; plan.listing = listing;
      trace.push({ step: 'Listing', result: listing.address + ', ' + listing.city + ' (' + listing.status.toLowerCase() + ')', why: m.reason });
    }
  }

  var priorLead = t.Leads.filter(function (l) { return l.op_id === base + ':lead'; })[0];
  var leadIsNew = false;
  function newLead(kind, address, listingId, stage) {
    lead = { lead_id: newId('Leads', 'lead_id', 'L-'), contact_id: contact.contact_id, kind: kind, property_address: address, listing_id: listingId, stage: stage, created: today, last_contact: today, source_message_id: msg.id, thread_id: msg.threadId, op_id: base + ':lead' };
    ops.push({ op: 'append', tab: 'Leads', row: lead }); leadIsNew = true;
  }
  function touch(l) { ops.push({ op: 'update', tab: 'Leads', key: ['lead_id', l.lead_id], fields: { last_contact: today } }); }

  if (contact && listing && (ex.category === 'buyer_inquiry' || ex.category === 'rental_inquiry')) {
    if (priorLead) { lead = priorLead; leadIsNew = true; trace.push({ step: 'Lead', result: 'Lead ' + lead.lead_id + ' (created by an earlier attempt on this email)', why: 'same operation id' }); }
    else {
      lead = t.Leads.filter(function (l) { return l.contact_id === contact.contact_id && l.listing_id === listing.listing_id; })[0];
      if (lead) { trace.push({ step: 'Lead', result: 'Existing lead ' + lead.lead_id, why: 'same contact and same listing' }); touch(lead); }
      else { newLead(ex.category === 'rental_inquiry' ? 'rental' : 'buyer', listing.address + ', ' + listing.city, listing.listing_id, 'New inquiry'); trace.push({ step: 'Lead', result: 'New ' + lead.kind + ' lead ' + lead.lead_id, why: 'no lead yet for this contact on this listing' }); }
    }
  }

  if (contact && ex.category === 'seller_lead') {
    var own = t.Leads.filter(function (l) { return l.contact_id === contact.contact_id && l.kind === 'seller'; });
    var withAddr = own.filter(function (l) { return String(l.property_address || '').trim(); });
    var provisional = own.filter(function (l) { return !String(l.property_address || '').trim(); });
    if (priorLead) {
      lead = priorLead; leadIsNew = true;
      trace.push({ step: 'Lead', result: 'Lead ' + lead.lead_id + ' (created by an earlier attempt on this email)', why: 'same operation id' });
    } else if (ex.seller_property) {
      var sm = matchAddress(ex.seller_property, withAddr, function (l) { return l.property_address; }, cities, withAddr.length === 1 ? 'seller lead of this contact' : 'seller leads of this contact');
      if (sm.status === 'unique') { lead = sm.record; touch(lead); trace.push({ step: 'Lead', result: 'Existing seller lead ' + lead.lead_id, why: sm.reason }); }
      else if (sm.status === 'ambiguous') { review = { field: 'seller lead', current: '', proposed: sm.candidates.map(function (c) { return c.property_address; }).join(' | '), reason: sm.reason }; trace.push({ step: 'Lead', result: 'Ambiguous seller lead', why: sm.reason }); }
      else if (provisional.length === 0) {
        newLead('seller', ex.seller_property, '', 'New seller lead');
        trace.push({ step: 'Lead', result: 'New seller lead ' + lead.lead_id, why: 'this contact has no lead for ' + ex.seller_property });
      } else if (provisional.length === 1 && provisional[0].thread_id === msg.threadId) {
        lead = provisional[0];
        ops.push({ op: 'update', tab: 'Leads', key: ['lead_id', lead.lead_id], fields: { property_address: ex.seller_property, last_contact: today } });
        trace.push({ step: 'Lead', result: 'Seller lead ' + lead.lead_id + ' gets its address', why: 'same contact, same thread, and the lead had no address yet' });
      } else {
        review = { field: 'seller lead', current: '', proposed: ex.seller_property, reason: provisional.length > 1 ? 'this contact has ' + provisional.length + ' seller leads without an address' : 'the seller lead without an address belongs to another thread' };
        trace.push({ step: 'Lead', result: 'Which seller lead gets this address?', why: review.reason });
      }
    } else if (own.length === 1) {
      lead = own[0]; touch(lead);
      trace.push({ step: 'Lead', result: 'Existing seller lead ' + lead.lead_id, why: 'no address in this email, and ' + lead.lead_id + ' is the only seller lead of this contact' });
    } else if (own.length > 1) {
      review = { field: 'seller lead', current: '', proposed: own.map(function (c) { return c.property_address || c.lead_id; }).join(' | '), reason: 'no address in this email, and this contact has ' + own.length + ' seller leads' };
      trace.push({ step: 'Lead', result: 'Ambiguous seller lead', why: review.reason });
    } else {
      newLead('seller', '', '', 'New seller lead, no address yet');
      trace.push({ step: 'Lead', result: 'New seller lead ' + lead.lead_id + ' (no address yet)', why: 'kept with this thread until the address arrives' });
    }
  }

  // Transactions are private: used only when unique for the property AND the sender is a recorded party (C3).
  var txn = null, txnVerified = false;
  if (ex.category === 'contract_update' && listing) {
    var open = t.Transactions.filter(function (x) { return x.listing_id === listing.listing_id && x.status !== 'Closed'; });
    if (open.length === 1 && contact && [normEmail(open[0].buyer_agent), normEmail(open[0].seller_agent)].indexOf(identity.from.email) >= 0) {
      txn = open[0]; txnVerified = true;
      trace.push({ step: 'Transaction', result: txn.txn_id + ', closing ' + txn.closing_date, why: 'the only open transaction on ' + listing.listing_id + ', and the sender is its recorded agent' });
    } else {
      review = { field: 'transaction', current: '', proposed: '', reason: open.length !== 1 ? open.length + ' open transactions for this property' : 'the sender is not a party recorded on the transaction' };
      trace.push({ step: 'Transaction', result: 'Not used', why: review.reason });
    }
  }
  if (txnVerified) {
    var ch = ex.contract_change;
    if (ch && ch.field && ch.proposed) {
      var current = txn[ch.field] !== undefined ? String(txn[ch.field]) : '';
      addReview(ch.field, current, ch.proposed, msg.id + ': "' + (ch.quote || '') + '"', txn.txn_id);
      trace.push({ step: 'Change', result: ch.field.replace('_', ' ') + ' ' + current + ' kept; ' + ch.proposed + ' waits for review', why: 'the current value stays in the transaction; the proposal waits for a person' });
    } else {
      review = { field: 'contract change', current: '', proposed: '', reason: 'change not identified' };
    }
  }

  // 3. Interaction, for every non-spam message
  interaction(contact ? contact.contact_id : '', lead ? lead.lead_id : (txn ? txn.txn_id : ''));
  plan.lead = lead;

  if (review) {
    addReview(review.field, review.current, review.proposed, review.reason);
    plan.review = review; plan.status = 'Needs a person'; plan.statusTone = 'review';
    plan.draftMode = ex.category === 'contract_update' && listing ? 'generic' : 'none';
    return plan;
  }

  // 4. Status, facts and the one next action the draft may take
  var f = buildFacts(listing);
  if (identity.status !== 'clear') {
    plan.status = 'Sender identity unclear'; plan.statusTone = 'review';
    if (!listing || ex.category === 'contract_update') { plan.draftMode = 'generic'; plan.facts = f; return plan; }
  }
  if (ex.category === 'seller_lead') {
    f.seller_property = lead.property_address || null;
    plan.status = leadIsNew ? 'New seller lead' : 'Existing lead found';
    f.next_action = f.seller_property ? 'acknowledge_seller_details' : 'acknowledge';
  } else if (ex.category === 'contract_update') {
    f.current_value = txn[ex.contract_change.field];
    f.proposed_value = ex.contract_change.proposed;
    plan.status = 'Change needs review'; plan.statusTone = 'review';
    f.next_action = 'acknowledge_amendment';
  } else if (ex.category === 'rental_inquiry') {
    if (identity.status === 'clear') plan.status = 'Rental, terms from the listing';
    f.next_action = 'quote_published_terms';
  } else if (ex.category === 'buyer_inquiry') {
    var mismatch = ex.financing !== 'unknown' && f.financing_accepts.length && f.financing_accepts.indexOf(ex.financing) < 0;
    if (listing.status === 'UNDER CONTRACT') {
      if (identity.status === 'clear') { plan.status = 'Under contract'; plan.statusTone = 'review'; }
      f.next_action = f.backup_offers_ok ? 'offer_backup' : 'team_will_confirm';
    } else if (mismatch) {
      if (identity.status === 'clear') { plan.status = 'Financing mismatch'; plan.statusTone = 'warn'; }
      if (ex.budget_max && ex.area) {
        f.alternatives = t.Listings.filter(function (l) {
          var acc = l.financing_listed && FINANCING_WORDS[l.financing_listed] ? FINANCING_WORDS[l.financing_listed].accepts : [];
          return l.status === 'FOR SALE' && l.listing_id !== listing.listing_id && acc.indexOf(ex.financing) >= 0 && Number(l.price) <= ex.budget_max && l.city.toLowerCase() === ex.area.toLowerCase();
        }).sort(function (a, b) { return Number(a.price) - Number(b.price) || a.address.localeCompare(b.address); }).slice(0, 3)
          .map(function (l) { return { listing_id: l.listing_id, address: l.address, city: l.city, price: Number(l.price), beds: l.beds, baths: l.baths }; });
        f.alternatives_basis = { financing: ex.financing, area: ex.area, budget: ex.budget_max };
        f.next_action = f.alternatives.length ? 'suggest_alternatives' : 'no_alternatives_in_budget';
        trace.push({ step: 'Alternatives', result: f.alternatives.length + ' listed with ' + ex.financing.toUpperCase() + ' in ' + ex.area + ' at or under ' + money(ex.budget_max), why: 'budget and area written in the email' });
      } else {
        f.next_action = 'ask_budget_and_area';
      }
    } else {
      if (identity.status === 'clear') plan.status = lead && !leadIsNew ? 'Existing lead found' : 'Listing matched';
      f.next_action = 'confirm_listed_terms_and_showing';
    }
  } else if (ex.category === 'contractor_application') {
    plan.status = 'Contractor, form link sent'; f.next_action = 'point_to_contractor_form';
  } else {
    plan.status = 'Logged for the team'; f.next_action = 'acknowledge';
  }
  plan.facts = f; plan.nextAction = f.next_action;
  return plan;
}

/** Applies the planned writes. Each append carries a stable operation id, so replaying a plan writes nothing twice. */
function applyOps(ops, sheets, t) {
  var applied = [];
  ops.forEach(function (o) {
    var rule = WRITABLE[o.tab];
    if (!rule) throw new Error('write refused: tab ' + o.tab);
    if (o.op === 'append') {
      var idField = Object.keys(o.row)[0];
      var dupe = t[o.tab].filter(function (r) {
        return (o.row.op_id && r.op_id === o.row.op_id) || (o.tab === 'Contacts' && normEmail(r.email) === normEmail(o.row.email)) || (o.tab === 'Interactions' && r.gmail_message_id === o.row.gmail_message_id);
      })[0];
      if (dupe) { applied.push({ tab: o.tab, id: dupe[idField], kind: 'already there', before: dupe, after: dupe }); return; }
      sheets.appendRow(o.tab, o.row);
      t[o.tab].push(o.row);
      applied.push({ tab: o.tab, id: o.row[idField], kind: 'added', before: null, after: o.row });
    } else if (o.op === 'update') {
      Object.keys(o.fields).forEach(function (k) { if (rule.update.indexOf(k) < 0) throw new Error('write refused: ' + o.tab + '.' + k); });
      var row = t[o.tab].filter(function (r) { return r[o.key[0]] === o.key[1]; })[0];
      if (!row) throw new Error('row not found: ' + o.key.join('='));
      var before = JSON.parse(JSON.stringify(row));
      var patch = {};
      Object.keys(o.fields).forEach(function (k) {
        if ((FILL_ONLY[o.tab] || []).indexOf(k) >= 0 && String(row[k] || '').trim() && String(row[k]) !== String(o.fields[k])) throw new Error('write refused: ' + o.tab + '.' + k + ' already filled');
        if (String(row[k]) !== String(o.fields[k])) patch[k] = o.fields[k];
      });
      if (Object.keys(patch).length) { sheets.updateRow(o.tab, o.key[0], o.key[1], patch); Object.keys(patch).forEach(function (k) { row[k] = patch[k]; }); }
      applied.push({ tab: o.tab, id: o.key[1], kind: Object.keys(patch).length ? 'updated' : 'unchanged', before: before, after: JSON.parse(JSON.stringify(row)) });
    } else {
      throw new Error('write refused: op ' + o.op);
    }
  });
  return applied;
}

function loadTables(sheets) {
  var t = {};
  ['Listings', 'Contacts', 'Leads', 'Interactions', 'Transactions', 'Review'].forEach(function (n) { t[n] = sheets.readTable(n); });
  return t;
}

function ownerAddresses(deps) {
  var list = deps.mailbox.ownerAddresses ? deps.mailbox.ownerAddresses() : [deps.mailboxId];
  return list.map(function (e) { return String(e).toLowerCase(); });
}

function reviewOnlyPlan(msg, t, today, base, field, reason, status) {
  return {
    extraction: null, trace: [{ step: 'Sender', result: status, why: reason }], status: status, statusTone: 'review', facts: buildFacts(null), nextAction: null,
    draftMode: 'none', listing: null, lead: null, review: { field: field, reason: reason }, problems: [reason], identity: 'ambiguous', recipient: '', first_name: '', language: 'en',
    ops: [{ op: 'append', tab: 'Review', row: { review_id: nextId(t.Review, 'review_id', 'R-'), ref: msg.id, field: field, current_value: '', proposed_value: '', source: reason, status: 'To review', created: today, op_id: base + ':review:' + field } }]
  };
}

function genericAck(plan, cfg) {
  var es = plan.language === 'es';
  var greet = es ? (plan.first_name ? 'Hola ' + plan.first_name + ':' : 'Hola:') : (plan.first_name ? 'Hi ' + plan.first_name + ',' : 'Hello,');
  return greet + '\n\n' + (es ? 'Gracias por su mensaje. Nuestro equipo lo revisará y le responderá.' : 'Thanks for your email. Our team will review it and get back to you.') + '\n\n' + (es ? cfg.SIGNATURE_ES : cfg.SIGNATURE);
}

/**
 * Processes one message end to end. The plan is saved in the journal before its first write; a retry replays that
 * plan instead of asking the model again (C6). The Gmail label is only for people (R7).
 */
function processMessage(msg, deps, opts) {
  opts = opts || {};
  var cfg = deps.config, journal = deps.journal, base = deps.mailboxId + ':' + msg.id, key = base;
  var now = nowParts(deps.clock, cfg.TIMEZONE), owners = opts.owners || ownerAddresses(deps);
  var msgMs = Date.parse(msg.date);
  var j = journal.get(key);
  if (j && (j.state === 'DONE' || j.state === 'REVIEW')) return { key: key, skipped: true, state: j.state };

  // Resume after a stop between "draft requested" and "draft recorded" (C9): adopt our draft, or accept a reply
  // from the owner strictly after this message; anything else goes to a person.
  if (j && j.state === 'DRAFT_PENDING') {
    var found = deps.mailbox.findDraftInThread(msg.threadId, Number(j.pending_since));
    if (found) {
      journal.put(key, { state: 'DONE', draft_id: found, error: '' });
      deps.mailbox.addLabel(msg.threadId, cfg.LABEL_PROCESSED);
      return { key: key, resumed: true, adopted: found };
    }
    if (deps.mailbox.threadHasReplyAfter(msg.threadId, msgMs, owners)) {
      journal.put(key, { state: 'DONE', draft_id: 'answered by the owner after this message', error: '' });
      return { key: key, resumed: true, answered: true };
    }
    journal.put(key, { state: 'REVIEW', error: 'draft creation was interrupted and no draft was found; check the thread' });
    deps.mailbox.addLabel(msg.threadId, cfg.LABEL_REVIEW);
    return { key: key, resumed: true, review: true, status: 'Needs a person' };
  }

  var t = loadTables(deps.sheets), plan, resumed = false;
  if (j && j.plan_json) {
    plan = JSON.parse(j.plan_json); resumed = true;
  } else {
    var identity = senderIdentity(msg);
    if (identity.status === 'ambiguous') {
      plan = reviewOnlyPlan(msg, t, now.date, base, 'sender', 'Sender header unclear: ' + identity.reason, 'Sender unclear, needs a person');
    } else {
      var cleaned = cleanExtraction(deps.model.extract(msg, { listingsCount: t.Listings.length }), msg);
      if (cleaned.problems.length) {
        plan = reviewOnlyPlan(msg, t, now.date, base, 'extraction', cleaned.problems.join('; '), 'Needs a person');
        plan.extraction = cleaned.value; plan.identity = identity.status;
      } else {
        var prov = checkProvenance(cleaned.value, msg, knownCities(t, cfg));
        plan = planMessage(msg, cleaned.value, t, cfg, now.date, identity, base, prov);
      }
    }
    journal.put(key, { message_id: msg.id, thread_id: msg.threadId, sender: normEmail(msg.from), state: 'PLANNED', plan_json: JSON.stringify(plan), error: '' });
  }

  var result = { key: key, message: msg, extraction: plan.extraction, plan: plan, applied: applyOps(plan.ops, deps.sheets, t), draft: null, problems: plan.problems || [], resumed: resumed, status: plan.status };
  var record = plan.trace.filter(function (s) { return s.step === 'Listing' || s.step === 'Lead' || s.step === 'Transaction'; }).map(function (s) { return s.result; }).join(' / ');
  journal.put(key, { state: 'SHEET_DONE', record: record, sheet_ops: result.applied.map(function (a) { return a.tab + ' ' + a.id + ' ' + a.kind; }).join('; '), error: '' });
  var doneLabel = plan.review ? cfg.LABEL_REVIEW : cfg.LABEL_PROCESSED;

  if (plan.draftMode === 'none') {
    journal.put(key, { state: plan.review ? 'REVIEW' : 'DONE' });
    deps.mailbox.addLabel(msg.threadId, doneLabel);
    return result;
  }
  if (opts.noDraft) {
    journal.put(key, { state: 'DONE', draft_id: 'none: a later message in this thread gets the reply' });
    deps.mailbox.addLabel(msg.threadId, doneLabel);
    result.superseded = true;
    return result;
  }
  // Re-check the thread right before drafting, on the first pass as on a retry (C9).
  if (deps.mailbox.threadHasReplyAfter(msg.threadId, msgMs, owners)) {
    journal.put(key, { state: 'DONE', draft_id: 'none: already answered by the owner', error: '' });
    deps.mailbox.addLabel(msg.threadId, doneLabel);
    result.status = 'Already answered';
    return result;
  }
  var waiting = deps.mailbox.findDraftInThread(msg.threadId, 0);
  if (waiting) {
    applyOps([{ op: 'append', tab: 'Review', row: { review_id: nextId(t.Review, 'review_id', 'R-'), ref: msg.id, field: 'draft', current_value: waiting, proposed_value: '', source: 'new message in a thread that already has an unsent draft; that draft was kept', status: 'To review', created: now.date, op_id: base + ':review:draft' } }], deps.sheets, t);
    journal.put(key, { state: 'DONE', draft_id: 'kept ' + waiting, error: '' });
    deps.mailbox.addLabel(msg.threadId, cfg.LABEL_REVIEW);
    result.status = 'Draft already waiting in thread';
    return result;
  }

  var text, problems = [], template = '', values = [];
  if (plan.draftMode === 'generic') {
    text = genericAck(plan, cfg);
  } else {
    var built = buildClauses(plan.facts, { language: plan.language, first_name: plan.first_name, config: cfg });
    var allowed = (CLAUSES_BY_ACTION[plan.nextAction] || []).filter(function (k) { return built.clauses[k]; });
    var d = deps.model.draft(msg, plan.extraction, plan.facts, plan.nextAction, allowed.map(function (k) { return { slot: k, text: built.clauses[k] }; }));
    template = d && typeof d.template === 'string' ? d.template : '';
    problems = freeTextProblems(template, { allowedClauses: allowed, placeWords: placeWords(t, cfg.EXTRA_CITIES) });
    var rendered = renderDraft(template, built);
    text = rendered.text; values = built.values;
    problems = problems.concat(rendered.problems).concat(validateDraft(text, plan.facts, cfg));
  }
  result.draft = { text: text, template: template, problems: problems, to: plan.recipient, subject: /^re:/i.test(msg.subject) ? msg.subject : 'Re: ' + msg.subject, values: values, generic: plan.draftMode === 'generic' };
  if (problems.length) {
    applyOps([{ op: 'append', tab: 'Review', row: { review_id: nextId(t.Review, 'review_id', 'R-'), ref: msg.id, field: 'draft', current_value: '', proposed_value: '', source: 'draft blocked: ' + problems.join('; '), status: 'To review', created: now.date, op_id: base + ':review:draft-blocked' } }], deps.sheets, t);
    journal.put(key, { state: 'REVIEW', error: problems.join('; ') });
    deps.mailbox.addLabel(msg.threadId, cfg.LABEL_REVIEW);
    result.status = 'Draft held for review';
    return result;
  }

  journal.put(key, { state: 'DRAFT_PENDING', pending_since: String(now.ms) });
  var draftId = deps.mailbox.createDraftReply(msg.id, text);
  journal.put(key, { state: 'DONE', draft_id: draftId, error: '' });
  deps.mailbox.addLabel(msg.threadId, doneLabel);
  result.draft.id = draftId;
  return result;
}

/**
 * One timed run (R5, R7, C8, C10, C11):
 * - a lock against overlapping runs; pending sheet writes are flushed before the lock is released, on every path;
 * - unfinished messages from the journal are retried by id, whatever the search window says;
 * - new messages: received after the later of the look-back and INSTALLED_AT, not from the owner or an alias;
 * - finished messages are removed before the batch is cut, so new mail is never starved;
 * - in each thread only the latest incoming message gets a draft.
 */
function runBatch(deps) {
  var lock = deps.lock, cfg = deps.config;
  if (!lock.tryLock(5000)) return { locked: true, processed: [] };
  var started = deps.clock.now().getTime(), out = [];
  try {
    var owners = ownerAddresses(deps);
    var isOwner = function (m) { var p = parseMailbox(m.from); return !p.ambiguous && owners.indexOf(p.email) >= 0; };
    var keyOf = function (m) { return deps.mailboxId + ':' + m.id; };
    var entries = deps.journal.entries(), known = {};
    entries.forEach(function (e) { known[e.key] = e; });
    var retry = entries.filter(function (e) { return e.state && e.state !== 'DONE' && e.state !== 'REVIEW' && Number(e.attempts || 0) < 3; })
      .map(function (e) { return deps.mailbox.getMessage(e.message_id); }).filter(Boolean);
    var since = Math.max(started - (cfg.LOOKBACK_MS || 3 * 24 * 3600 * 1000), cfg.INSTALLED_AT ? Date.parse(cfg.INSTALLED_AT) : 0);
    var fresh = deps.mailbox.listCandidates(cfg.QUERY, since).filter(function (m) { return Date.parse(m.date) >= since && !known[keyOf(m)]; });
    var seen = {}, queue = [];
    retry.concat(fresh).forEach(function (m) { if (!seen[m.id] && !isOwner(m)) { seen[m.id] = true; queue.push(m); } });
    var latest = {};
    queue.forEach(function (m) { if (!latest[m.threadId] || Date.parse(m.date) > Date.parse(latest[m.threadId].date)) latest[m.threadId] = m; });
    queue.sort(function (x, y) { return Date.parse(x.date) - Date.parse(y.date); });
    for (var i = 0; i < queue.length && out.length < cfg.MAX_PER_RUN; i++) {
      if (deps.clock.now().getTime() - started > cfg.MAX_RUN_MS) break;
      var m = queue[i], key = keyOf(m);
      try {
        out.push(processMessage(m, deps, { noDraft: latest[m.threadId] !== m, owners: owners }));
      } catch (e) {
        var j = deps.journal.get(key) || {};
        var attempts = Number(j.attempts || 0) + 1;
        deps.journal.put(key, { message_id: m.id, thread_id: m.threadId, state: attempts >= 3 ? 'REVIEW' : (j.state || 'ERROR'), attempts: attempts, error: String(e && e.message || e) });
        if (attempts >= 3) deps.mailbox.addLabel(m.threadId, cfg.LABEL_REVIEW);
        out.push({ key: key, error: String(e && e.message || e), attempts: attempts });
      }
    }
  } finally {
    try { if (deps.sheets.flush) deps.sheets.flush(); } finally { lock.releaseLock(); }
  }
  return { locked: false, processed: out };
}

/** Journal kept in the "Journal" tab, keyed by mailbox + Gmail message id. */
function SheetJournal(sheets) {
  this.sheets = sheets;
}
SheetJournal.prototype.entries = function () {
  return this.sheets.readTable('Journal');
};
SheetJournal.prototype.get = function (key) {
  return this.entries().filter(function (r) { return r.key === key; })[0] || null;
};
SheetJournal.prototype.finishedKeys = function () {
  var out = {};
  this.entries().forEach(function (r) { if (r.state === 'DONE' || r.state === 'REVIEW') out[r.key] = true; });
  return out;
};
SheetJournal.prototype.put = function (key, fields) {
  var existing = this.get(key);
  var stamp = new Date().toISOString();
  if (existing) {
    var patch = {}; Object.keys(fields).forEach(function (k) { patch[k] = fields[k]; }); patch.updated = stamp;
    this.sheets.updateRow('Journal', 'key', key, patch, true);
  } else {
    var row = { key: key, message_id: '', thread_id: '', sender: '', state: '', record: '', sheet_ops: '', draft_id: '', attempts: 0, pending_since: '', plan_json: '', updated: stamp, error: '' };
    Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
    this.sheets.appendRow('Journal', row, true);
  }
};
