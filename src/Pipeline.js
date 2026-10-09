/**
 * Pipeline.js: one pipeline for every run. The model adapter (fixture or Gemini), the mailbox adapter and the
 * sheet adapter are passed in; matching, decisions, validation and sheet writes are this file, always.
 */

var CATEGORIES = ['buyer_inquiry', 'rental_inquiry', 'seller_lead', 'contract_update', 'investor', 'contractor_application', 'spam', 'other'];
var FINANCING = ['fha', 'va', 'conventional', 'cash', 'hard_money', 'section8_voucher', 'unknown'];
var CHANGE_FIELDS = ['closing_date', 'price', 'seller_credit', 'inspection_period', 'other'];

/** The closed set of sheet writes (R8). Anything else is refused before it reaches a sheet. */
var WRITABLE = {
  Contacts: { append: true, update: ['last_contact'] },
  Leads: { append: true, update: ['last_contact'] },
  Interactions: { append: true, update: [] },
  Review: { append: true, update: [] }
};

/** Keeps only the known fields of the model's extraction, with their types. Unknown keys are dropped (R6). */
function cleanExtraction(raw) {
  var problems = [];
  if (!raw || typeof raw !== 'object') return { value: null, problems: ['extraction is not an object'] };
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 400) : null; }
  var v = {
    category: CATEGORIES.indexOf(raw.category) >= 0 ? raw.category : null,
    language: raw.language === 'es' ? 'es' : raw.language === 'en' ? 'en' : null,
    sender_name: str(raw.sender_name, 80),
    property_mentions: Array.isArray(raw.property_mentions) ? raw.property_mentions.filter(function (x) { return typeof x === 'string'; }).slice(0, 3) : [],
    financing: FINANCING.indexOf(raw.financing) >= 0 ? raw.financing : 'unknown',
    budget_max: typeof raw.budget_max === 'number' && raw.budget_max > 0 ? raw.budget_max : null,
    area: str(raw.area, 60),
    seller_property: str(raw.seller_property, 120),
    details: Array.isArray(raw.details) ? raw.details.filter(function (x) { return typeof x === 'string'; }).slice(0, 6).map(function (x) { return x.slice(0, 160); }) : [],
    contract_change: null,
    summary: str(raw.summary, 300) || '',
    confidence: raw.confidence === 'high' ? 'high' : 'low'
  };
  if (raw.contract_change && typeof raw.contract_change === 'object') {
    var c = raw.contract_change;
    v.contract_change = {
      field: CHANGE_FIELDS.indexOf(c.field) >= 0 ? c.field : 'other',
      proposed: str(c.proposed, 60),
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

function nextId(rows, field, prefix) {
  var max = 0;
  rows.forEach(function (r) { var n = parseInt(String(r[field] || '').replace(/\D/g, ''), 10); if (n > max) max = n; });
  var width = prefix === 'I-' ? 4 : 4;
  return prefix + String(max + 1).padStart(width, '0');
}

function fmtDateLong(iso, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return iso;
  var p = iso.split('-').map(Number);
  var en = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var es = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return lang === 'es' ? p[2] + ' de ' + es[p[1] - 1] : en[p[1] - 1] + ' ' + p[2];
}

/**
 * Pure decision step: from the message, the cleaned extraction and the current tables, returns the trace
 * (contact, then the property's lead, then the interaction), the sheet operations, the status shown to
 * the team and the facts object the draft may use. No Google service is touched here.
 */
function planMessage(msg, ex, t, config, today) {
  var trace = [], ops = [], review = null;
  var email = normEmail(msg.from);
  var cities = t.Listings.map(function (l) { return l.city; }).concat(config.EXTRA_CITIES || []);
  var plan = { trace: trace, ops: ops, status: null, statusTone: 'ok', facts: buildFacts(null), nextAction: null, draft: true, listing: null, review: null };

  if (ex.category === 'spam') {
    plan.status = 'Spam, left alone'; plan.statusTone = 'quiet'; plan.draft = false;
    trace.push({ step: 'Category', result: 'Spam: no record written, no reply drafted.' });
    return plan;
  }

  // 1. Contact
  var contact = t.Contacts.filter(function (c) { return normEmail(c.email) === email; })[0];
  var roleBy = { buyer_inquiry: 'buyer', rental_inquiry: 'tenant', seller_lead: 'seller', contract_update: 'agent', investor: 'investor', contractor_application: 'contractor', other: 'unknown' };
  if (contact) {
    trace.push({ step: 'Contact', result: 'Found ' + contact.contact_id + ' (' + contact.name + ')', why: 'same sender address ' + email });
    ops.push({ op: 'update', tab: 'Contacts', key: ['contact_id', contact.contact_id], fields: { last_contact: today } });
  } else {
    contact = { contact_id: nextId(t.Contacts, 'contact_id', 'C-'), name: ex.sender_name || email, email: email, role: roleBy[ex.category], language: ex.language, first_seen: today, last_contact: today };
    trace.push({ step: 'Contact', result: 'New contact ' + contact.contact_id, why: 'no contact with ' + email });
    ops.push({ op: 'append', tab: 'Contacts', row: contact });
  }

  // 2. The property and its lead or transaction
  var lead = null, listing = null;
  function findListing(pool, noun) {
    var mention = ex.property_mentions[0];
    if (!mention) return { status: 'none', reason: 'no address in the email' };
    return matchAddress(mention, pool, function (l) { return l.address + (l.unit ? ' unit ' + l.unit : '') + ' ' + l.city; }, cities, noun);
  }

  if (ex.category === 'buyer_inquiry' || ex.category === 'rental_inquiry' || ex.category === 'contract_update') {
    var pool = ex.category === 'rental_inquiry' ? t.Listings.filter(function (l) { return l.status === 'FOR RENT'; }) : t.Listings;
    var m = findListing(pool, ex.category === 'rental_inquiry' ? 'rental listings' : 'listings');
    if (m.status !== 'unique') {
      review = { field: 'listing', current: '', proposed: (m.candidates || []).map(function (c) { return c.address + ', ' + c.city; }).join(' | '), reason: m.reason };
      trace.push({ step: 'Listing', result: m.status === 'ambiguous' ? 'Ambiguous: ' + m.candidates.length + ' listings fit' : 'No listing found', why: m.reason });
    } else {
      listing = m.record; plan.listing = listing;
      trace.push({ step: 'Listing', result: listing.address + ', ' + listing.city + ' (' + listing.status.toLowerCase() + ')', why: m.reason });
    }
  }

  // A lead already created from this very message (an earlier attempt that stopped half way) is reused: the source
  // message id is the stable key, so a rerun never makes a second lead.
  var priorLead = t.Leads.filter(function (l) { return l.source_message_id === msg.id; })[0];
  function reusePrior() {
    lead = priorLead;
    trace.push({ step: 'Lead', result: 'Lead ' + lead.lead_id + ' (created by an earlier attempt on this email)', why: 'same source message ' + msg.id });
  }

  if (listing && (ex.category === 'buyer_inquiry' || ex.category === 'rental_inquiry')) {
    lead = priorLead || t.Leads.filter(function (l) { return l.contact_id === contact.contact_id && l.listing_id === listing.listing_id; })[0];
    if (priorLead) {
      reusePrior();
    } else if (lead) {
      trace.push({ step: 'Lead', result: 'Existing lead ' + lead.lead_id, why: 'same contact and same listing' });
      ops.push({ op: 'update', tab: 'Leads', key: ['lead_id', lead.lead_id], fields: { last_contact: today } });
    } else {
      lead = { lead_id: nextId(t.Leads, 'lead_id', 'L-'), contact_id: contact.contact_id, kind: ex.category === 'rental_inquiry' ? 'rental' : 'buyer', property_address: listing.address + ', ' + listing.city, listing_id: listing.listing_id, stage: 'New inquiry', created: today, last_contact: today, source_message_id: msg.id };
      trace.push({ step: 'Lead', result: 'New ' + lead.kind + ' lead ' + lead.lead_id, why: 'no lead yet for this contact on this listing' });
      ops.push({ op: 'append', tab: 'Leads', row: lead });
    }
  }

  if (ex.category === 'seller_lead') {
    var own = t.Leads.filter(function (l) { return l.contact_id === contact.contact_id && l.kind === 'seller'; });
    var sm;
    if (priorLead) sm = { status: 'prior' };
    else if (ex.seller_property) sm = matchAddress(ex.seller_property, own, function (l) { return l.property_address; }, cities, own.length === 1 ? 'seller lead of this contact' : 'seller leads of this contact');
    else if (own.length === 1) sm = { status: 'unique', record: own[0], reason: 'no address in this email, and ' + own[0].lead_id + ' is the only seller lead of this contact' };
    else if (own.length > 1) sm = { status: 'ambiguous', candidates: own, reason: 'no address in this email, and this contact has ' + own.length + ' seller leads' };
    else sm = { status: 'none' };
    if (sm.status === 'prior') {
      reusePrior();
    } else if (sm.status === 'unique') {
      lead = sm.record;
      trace.push({ step: 'Lead', result: 'Existing seller lead ' + lead.lead_id, why: sm.reason });
      ops.push({ op: 'update', tab: 'Leads', key: ['lead_id', lead.lead_id], fields: { last_contact: today } });
    } else if (sm.status === 'ambiguous') {
      review = { field: 'seller lead', current: '', proposed: sm.candidates.map(function (c) { return c.property_address; }).join(' | '), reason: sm.reason };
      trace.push({ step: 'Lead', result: 'Ambiguous seller lead', why: sm.reason });
    } else {
      lead = { lead_id: nextId(t.Leads, 'lead_id', 'L-'), contact_id: contact.contact_id, kind: 'seller', property_address: ex.seller_property || '', listing_id: '', stage: 'New seller lead', created: today, last_contact: today, source_message_id: msg.id };
      trace.push({ step: 'Lead', result: 'New seller lead ' + lead.lead_id, why: ex.seller_property ? 'this contact has no lead for ' + ex.seller_property : 'no address given yet' });
      ops.push({ op: 'append', tab: 'Leads', row: lead });
    }
  }

  var txn = null;
  if (ex.category === 'contract_update' && listing) {
    txn = t.Transactions.filter(function (x) { return x.listing_id === listing.listing_id && x.status !== 'Closed'; })[0];
    if (!txn) {
      review = { field: 'transaction', current: '', proposed: '', reason: 'no open transaction for ' + listing.address };
      trace.push({ step: 'Transaction', result: 'No open transaction', why: 'none linked to ' + listing.listing_id });
    } else {
      trace.push({ step: 'Transaction', result: txn.txn_id + ', closing ' + txn.closing_date, why: 'open transaction on ' + listing.listing_id });
      var ch = ex.contract_change;
      if (ch && ch.field && ch.proposed) {
        var current = txn[ch.field] !== undefined ? String(txn[ch.field]) : '';
        ops.push({ op: 'append', tab: 'Review', row: { review_id: nextId(t.Review, 'review_id', 'R-'), ref: txn.txn_id, field: ch.field, current_value: current, proposed_value: ch.proposed, source: msg.id + ': "' + (ch.quote || '') + '"', status: 'To review', created: today } });
        trace.push({ step: 'Change', result: ch.field.replace('_', ' ') + ' ' + current + ' kept; ' + ch.proposed + ' waits for review', why: 'contract terms are never overwritten by the script' });
      } else {
        review = { field: 'contract change', current: '', proposed: '', reason: 'change not identified' };
      }
    }
  }

  // 3. Interaction, always, for every non-spam message
  var interaction = { interaction_id: nextId(t.Interactions, 'interaction_id', 'I-'), contact_id: contact.contact_id, lead_id: lead ? lead.lead_id : (txn ? txn.txn_id : ''), gmail_message_id: msg.id, received_at: msg.date, category: ex.category, summary: ex.summary };
  ops.push({ op: 'append', tab: 'Interactions', row: interaction });
  trace.push({ step: 'Interaction', result: 'Logged ' + interaction.interaction_id, why: 'message ' + msg.id });

  if (review) {
    ops.push({ op: 'append', tab: 'Review', row: { review_id: nextId(t.Review, 'review_id', 'R-'), ref: msg.id, field: review.field, current_value: review.current, proposed_value: review.proposed, source: review.reason, status: 'To review', created: today } });
    plan.review = review; plan.draft = false; plan.status = 'Needs a person'; plan.statusTone = 'review';
    return plan;
  }

  // 4. Status, facts and the one next action the draft may take
  var leadIsNew = !!lead && (lead === priorLead || ops.some(function (o) { return o.op === 'append' && o.tab === 'Leads'; }));
  var f = buildFacts(listing, { first_name: firstName(contact.name) });
  if (ex.category === 'seller_lead') {
    f.seller_property = lead.property_address;
    plan.status = leadIsNew ? 'New seller lead' : 'Existing lead found';
    f.next_action = 'acknowledge_seller_details';
  } else if (ex.category === 'contract_update') {
    f.current_value = fmtDateLong(txn[ex.contract_change.field], ex.language);
    f.proposed_value = fmtDateLong(ex.contract_change.proposed, ex.language);
    plan.status = 'Change needs review'; plan.statusTone = 'review';
    f.next_action = 'acknowledge_amendment';
  } else if (ex.category === 'rental_inquiry') {
    plan.status = 'Rental, terms from the listing';
    f.next_action = 'quote_published_terms';
  } else if (ex.category === 'buyer_inquiry') {
    if (listing.status === 'UNDER CONTRACT') {
      plan.status = 'Under contract'; plan.statusTone = 'review';
      f.next_action = f.backup_offers_ok ? 'offer_backup' : 'team_will_confirm';
    } else if (ex.financing !== 'unknown' && f.financing_accepts.length && f.financing_accepts.indexOf(ex.financing) < 0) {
      plan.status = 'Financing mismatch'; plan.statusTone = 'warn';
      if (ex.budget_max && ex.area) {
        f.alternatives = t.Listings.filter(function (l) {
          var acc = l.financing_listed && FINANCING_WORDS[l.financing_listed] ? FINANCING_WORDS[l.financing_listed].accepts : [];
          return l.status === 'FOR SALE' && l.listing_id !== listing.listing_id && acc.indexOf(ex.financing) >= 0 && Number(l.price) <= ex.budget_max && l.city.toLowerCase() === ex.area.toLowerCase();
        }).sort(function (a, b) { return Number(a.price) - Number(b.price) || a.address.localeCompare(b.address); }).slice(0, 3)
          .map(function (l) { return { listing_id: l.listing_id, address: l.address, city: l.city, price: Number(l.price), beds: l.beds, baths: l.baths }; });
        f.next_action = f.alternatives.length ? 'suggest_alternatives' : 'no_alternatives_in_budget';
        trace.push({ step: 'Alternatives', result: f.alternatives.length + ' listed with ' + ex.financing.toUpperCase() + ' in ' + ex.area + ' at or under ' + money(ex.budget_max), why: 'budget and area stated in the email' });
      } else {
        f.next_action = 'ask_budget_and_area';
      }
    } else {
      plan.status = lead && !leadIsNew ? 'Existing lead found' : 'Listing matched';
      f.next_action = 'confirm_listed_terms_and_showing';
    }
  } else if (ex.category === 'contractor_application') {
    plan.status = 'Contractor, form link sent'; f.next_action = 'point_to_contractor_form';
  } else {
    plan.status = 'Logged for the team'; f.next_action = 'acknowledge';
  }
  plan.facts = f; plan.nextAction = f.next_action; plan.lead = lead;
  return plan;
}

/** Applies the planned writes, each one idempotent, and returns before/after for every row touched. */
function applyOps(ops, sheets, t) {
  var applied = [];
  ops.forEach(function (o) {
    var rule = WRITABLE[o.tab];
    if (!rule) throw new Error('write refused: tab ' + o.tab);
    if (o.op === 'append') {
      var idField = Object.keys(o.row)[0];
      var dupe = o.tab === 'Interactions' ? t.Interactions.filter(function (r) { return r.gmail_message_id === o.row.gmail_message_id; })[0]
        : o.tab === 'Review' ? t.Review.filter(function (r) { return r.ref === o.row.ref && r.field === o.row.field && r.proposed_value === o.row.proposed_value; })[0]
          : t[o.tab].filter(function (r) { return r[idField] === o.row[idField]; })[0];
      if (dupe) { applied.push({ tab: o.tab, id: dupe[idField], kind: 'already there', before: dupe, after: dupe }); return; }
      sheets.appendRow(o.tab, o.row);
      t[o.tab].push(o.row);
      applied.push({ tab: o.tab, id: o.row[idField], kind: 'added', before: null, after: o.row });
    } else if (o.op === 'update') {
      Object.keys(o.fields).forEach(function (k) { if (rule.update.indexOf(k) < 0) throw new Error('write refused: ' + o.tab + '.' + k); });
      var row = t[o.tab].filter(function (r) { return r[o.key[0]] === o.key[1]; })[0];
      if (!row) throw new Error('row not found: ' + o.key.join('='));
      var before = JSON.parse(JSON.stringify(row));
      var changed = Object.keys(o.fields).some(function (k) { return String(row[k]) !== String(o.fields[k]); });
      if (changed) { sheets.updateRow(o.tab, o.key[0], o.key[1], o.fields); Object.keys(o.fields).forEach(function (k) { row[k] = o.fields[k]; }); }
      applied.push({ tab: o.tab, id: o.key[1], kind: changed ? 'updated' : 'unchanged', before: before, after: JSON.parse(JSON.stringify(row)) });
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

/**
 * Processes one message end to end. The journal row (mailbox + Gmail message id) is the source of truth for
 * progress; the Gmail label is only for people (R7).
 */
function processMessage(msg, deps, opts) {
  opts = opts || {};
  var cfg = deps.config, journal = deps.journal, key = deps.mailboxId + ':' + msg.id;
  var now = nowParts(deps.clock, cfg.TIMEZONE);
  var j = journal.get(key);
  if (j && (j.state === 'DONE' || j.state === 'REVIEW')) return { key: key, skipped: true, state: j.state };

  // Resume after a stop between "draft requested" and "draft recorded": adopt the draft, never make a second one.
  if (j && j.state === 'DRAFT_PENDING') {
    var found = deps.mailbox.findDraftInThread(msg.threadId, Number(j.pending_since));
    if (found) {
      journal.put(key, { state: 'DONE', draft_id: found, error: '' });
      deps.mailbox.addLabel(msg.threadId, cfg.LABEL_PROCESSED);
      return { key: key, resumed: true, adopted: found };
    }
    if (deps.mailbox.threadHasReplyAfter(msg.threadId, Number(j.pending_since))) {
      journal.put(key, { state: 'DONE', draft_id: 'sent-by-person', error: '' });
      return { key: key, resumed: true, sentByPerson: true };
    }
  }

  var t = loadTables(deps.sheets);
  var raw = deps.model.extract(msg, { listingsCount: t.Listings.length });
  var cleaned = cleanExtraction(raw);
  var result = { key: key, message: msg, extraction: cleaned.value, plan: null, applied: [], draft: null };
  if (cleaned.problems.length) {
    var r = { review_id: nextId(t.Review, 'review_id', 'R-'), ref: msg.id, field: 'extraction', current_value: '', proposed_value: '', source: cleaned.problems.join('; '), status: 'To review', created: now.date };
    result.applied = applyOps([{ op: 'append', tab: 'Review', row: r }], deps.sheets, t);
    journal.put(key, { message_id: msg.id, thread_id: msg.threadId, state: 'REVIEW', record: '', sheet_ops: 'Review', error: cleaned.problems.join('; ') });
    deps.mailbox.addLabel(msg.threadId, cfg.LABEL_REVIEW);
    result.status = 'Needs a person'; result.reviewReason = cleaned.problems.join('; ');
    return result;
  }

  var plan = planMessage(msg, cleaned.value, t, cfg, now.date);
  result.plan = plan;
  result.applied = applyOps(plan.ops, deps.sheets, t);
  var record = plan.trace.filter(function (s) { return s.step === 'Listing' || s.step === 'Lead' || s.step === 'Transaction'; }).map(function (s) { return s.result; }).join(' / ');
  journal.put(key, { message_id: msg.id, thread_id: msg.threadId, state: 'SHEET_DONE', record: record, sheet_ops: result.applied.map(function (a) { return a.tab + ' ' + a.id + ' ' + a.kind; }).join('; '), error: '' });

  if (plan.draft && opts.noDraft) {
    journal.put(key, { state: 'DONE', draft_id: 'none: a later message in this thread gets the reply' });
    deps.mailbox.addLabel(msg.threadId, cfg.LABEL_PROCESSED);
    result.status = plan.status; result.superseded = true;
    return result;
  }

  if (!plan.draft) {
    var state = plan.review ? 'REVIEW' : 'DONE';
    journal.put(key, { state: state });
    deps.mailbox.addLabel(msg.threadId, plan.review ? cfg.LABEL_REVIEW : cfg.LABEL_PROCESSED);
    result.status = plan.status;
    return result;
  }

  var d = deps.model.draft(msg, cleaned.value, plan.facts, plan.nextAction);
  var template = d && typeof d.template === 'string' ? d.template : '';
  var rendered = renderDraft(template, plan.facts, { language: cleaned.value.language, first_name: plan.facts.first_name, config: cfg });
  var problems = rendered.problems.concat(validateDraft(rendered.text, plan.facts, cfg, msg.subject + '\n' + msg.body));
  result.draft = { text: rendered.text, template: template, problems: problems, to: normEmail(msg.from), subject: /^re:/i.test(msg.subject) ? msg.subject : 'Re: ' + msg.subject };
  if (problems.length) {
    applyOps([{ op: 'append', tab: 'Review', row: { review_id: nextId(t.Review, 'review_id', 'R-'), ref: msg.id, field: 'draft', current_value: '', proposed_value: '', source: 'draft blocked: ' + problems.join('; '), status: 'To review', created: now.date } }], deps.sheets, t);
    journal.put(key, { state: 'REVIEW', error: problems.join('; ') });
    deps.mailbox.addLabel(msg.threadId, cfg.LABEL_REVIEW);
    result.status = 'Draft held for review';
    return result;
  }

  // One draft per thread: if an unsent draft is already waiting in this thread, it is kept and flagged for a person.
  var waiting = deps.mailbox.findDraftInThread(msg.threadId, 0);
  if (waiting) {
    applyOps([{ op: 'append', tab: 'Review', row: { review_id: nextId(t.Review, 'review_id', 'R-'), ref: msg.id, field: 'draft', current_value: waiting, proposed_value: '', source: 'new message in a thread that already has an unsent draft; that draft was kept', status: 'To review', created: now.date } }], deps.sheets, t);
    journal.put(key, { state: 'DONE', draft_id: 'kept ' + waiting, error: '' });
    deps.mailbox.addLabel(msg.threadId, cfg.LABEL_REVIEW);
    result.status = 'Draft already waiting in thread';
    return result;
  }

  journal.put(key, { state: 'DRAFT_PENDING', pending_since: String(now.ms) });
  var draftId = deps.mailbox.createDraftReply(msg.id, rendered.text);
  journal.put(key, { state: 'DONE', draft_id: draftId, error: '' });
  deps.mailbox.addLabel(msg.threadId, cfg.LABEL_PROCESSED);
  result.draft.id = draftId;
  result.status = plan.status;
  return result;
}

/**
 * One timed run (R5, R7): a lock against overlapping runs; only messages received after the later of the look-back
 * window and INSTALLED_AT; messages already finished in the journal are removed BEFORE the batch is cut, so new mail is
 * never starved; in each thread only the latest incoming message gets a draft, earlier ones are logged without one.
 */
function runBatch(deps) {
  var lock = deps.lock, cfg = deps.config;
  if (!lock.tryLock(5000)) return { locked: true, processed: [] };
  var started = deps.clock.now().getTime(), out = [];
  try {
    var since = Math.max(started - (cfg.LOOKBACK_MS || 3 * 24 * 3600 * 1000), cfg.INSTALLED_AT ? Date.parse(cfg.INSTALLED_AT) : 0);
    var finished = deps.journal.finishedKeys();
    var keyOf = function (m) { return deps.mailboxId + ':' + m.id; };
    var fresh = deps.mailbox.listCandidates(cfg.QUERY, since).filter(function (m) { return Date.parse(m.date) >= since && !finished[keyOf(m)]; });
    var latest = {};
    fresh.forEach(function (m) { if (!latest[m.threadId] || Date.parse(m.date) > Date.parse(latest[m.threadId].date)) latest[m.threadId] = m; });
    fresh.sort(function (x, y) { return Date.parse(x.date) - Date.parse(y.date); });
    for (var i = 0; i < fresh.length && out.length < cfg.MAX_PER_RUN; i++) {
      if (deps.clock.now().getTime() - started > cfg.MAX_RUN_MS) break;
      var m = fresh[i], key = keyOf(m);
      try {
        out.push(processMessage(m, deps, { noDraft: latest[m.threadId] !== m }));
      } catch (e) {
        var j = deps.journal.get(key) || {};
        var attempts = Number(j.attempts || 0) + 1;
        deps.journal.put(key, { message_id: m.id, thread_id: m.threadId, state: attempts >= 3 ? 'REVIEW' : (j.state || 'ERROR'), attempts: attempts, error: String(e && e.message || e) });
        if (attempts >= 3) deps.mailbox.addLabel(m.threadId, cfg.LABEL_REVIEW);
        out.push({ key: key, error: String(e && e.message || e), attempts: attempts });
      }
    }
  } finally {
    lock.releaseLock();
  }
  return { locked: false, processed: out };
}

/** Journal kept in the "Journal" tab, keyed by mailbox + Gmail message id. */
function SheetJournal(sheets) {
  this.sheets = sheets;
}
SheetJournal.prototype.get = function (key) {
  return this.sheets.readTable('Journal').filter(function (r) { return r.key === key; })[0] || null;
};
SheetJournal.prototype.finishedKeys = function () {
  var out = {};
  this.sheets.readTable('Journal').forEach(function (r) { if (r.state === 'DONE' || r.state === 'REVIEW') out[r.key] = true; });
  return out;
};
SheetJournal.prototype.put = function (key, fields) {
  var existing = this.get(key);
  var stamp = { updated: new Date().toISOString() };
  if (existing) {
    var patch = {}; Object.keys(fields).forEach(function (k) { patch[k] = fields[k]; }); patch.updated = stamp.updated;
    this.sheets.updateRow('Journal', 'key', key, patch, true);
  } else {
    var row = { key: key, message_id: '', thread_id: '', state: '', record: '', sheet_ops: '', draft_id: '', attempts: 0, pending_since: '', updated: stamp.updated, error: '' };
    Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
    this.sheets.appendRow('Journal', row, true);
  }
};
