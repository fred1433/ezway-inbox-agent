// node test/run.js : runs every test against the real pipeline with in-memory Gmail and Sheets.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { makeWorld, readJson, ROOT, FakeLock } = require('./harness');

const E = readJson('fixtures/emails.json');
const V = Object.fromEntries(E.visible.map((m) => [m.id, m]));
const T = Object.fromEntries(E.tests.map((m) => [m.id, m]));
const results = [];
function test(group, name, fn) {
  try { fn(); results.push({ group, name, ok: true }); } catch (e) { results.push({ group, name, ok: false, err: e.message }); }
}
const tab = (w, name) => w.sheets.readTable(name);
const one = (msg, opts) => { const w = makeWorld([msg], opts); const r = w.G.processMessage(msg, w.deps); return { w, r }; };

// ---------- the five cases on the page
test('cases', 'Bahia: abbreviated address matched to the one listing, new contact and lead, draft with listed terms', () => {
  const { r } = one(V['199c4a1e7f3b0a01']);
  assert.strictEqual(r.plan.listing.listing_id, 'EZ-5000');
  assert.strictEqual(r.status, 'Listing matched');
  assert.ok(r.draft.text.includes('$327,900') && r.draft.text.includes('FHA, VA or conventional'));
});
test('cases', 'FHA buyer on a cash or hard money listing: Financing mismatch, alternatives within budget and area only', () => {
  const { r } = one(V['199c4b5d2e81c702']);
  assert.strictEqual(r.status, 'Financing mismatch');
  assert.deepStrictEqual(r.plan.facts.alternatives.map((a) => a.listing_id), ['EZ-4962', 'EZ-5000', 'EZ-4930']);
  r.plan.facts.alternatives.forEach((a) => assert.ok(a.price <= 330000));
});
test('cases', 'Returning seller: Existing lead found, interaction appended, last contact updated', () => {
  const { w, r } = one(V['199c4cc90a4f1e03']);
  assert.strictEqual(r.status, 'Existing lead found');
  assert.strictEqual(tab(w, 'Leads').filter((l) => l.contact_id === 'C-0388').length, 1);
  assert.strictEqual(tab(w, 'Leads').find((l) => l.lead_id === 'L-0291').last_contact, '2026-10-09');
});
test('cases', 'Section 8 rental in Spanish: reply in Spanish with published rent and deposit, no acceptance claimed', () => {
  const { r } = one(V['199c4e41b8d27a04']);
  assert.ok(/renta de \$1,695 al mes/.test(r.draft.text) && /depósito de seguridad de \$1,695/.test(r.draft.text));
  assert.ok(!/aceptad|aprobad/i.test(r.draft.text));
});
test('cases', 'Amendment: transaction found, change waits in Review, closing date in the transaction unchanged', () => {
  const { w, r } = one(V['199c4f2a6c0e9b05']);
  assert.strictEqual(r.status, 'Change needs review');
  assert.strictEqual(tab(w, 'Transactions').find((x) => x.txn_id === 'T-0117').closing_date, '2026-10-23');
  const rev = tab(w, 'Review')[0];
  assert.strictEqual(rev.current_value, '2026-10-23'); assert.strictEqual(rev.proposed_value, '2026-11-06');
});
test('cases', 'Sender with a Spanish name writing in English gets an English reply', () => {
  const { r } = one(V['199c4b5d2e81c702']);
  assert.ok(r.draft.text.startsWith('Hi Luis'));
});

// ---------- R1: the page comes from this run
test('page', 'site/data.js regenerates identically from the repository', () => {
  const { render } = require('../tools/build_page_data');
  assert.strictEqual(render(), fs.readFileSync(path.join(ROOT, 'site', 'data.js'), 'utf8'));
});

// ---------- R6: no send
test('safety', 'No send operation anywhere in src/', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
    const s = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    assert.ok(!/\.send\s*\(|sendEmail|\.sendMessage|GmailApp\.send|MailApp/.test(s), f + ' contains a send call');
  }
});
test('safety', 'Draft is a reply in the same thread, to the sender only, with the right subject', () => {
  const { w, r } = one(V['199c4a1e7f3b0a01']);
  const d = w.mailbox.drafts[0];
  assert.strictEqual(w.mailbox.drafts.length, 1);
  assert.strictEqual(d.threadId, V['199c4a1e7f3b0a01'].threadId);
  assert.strictEqual(d.to, 'tanya.brooks@example.com');
  assert.strictEqual(d.subject, 'Re: 8303 Bahia still available?');
  assert.strictEqual(r.draft.id, d.id);
});
test('safety', 'Hostile email: extra model fields dropped, draft with a foreign address and an invented price blocked, nothing else written', () => {
  const { w, r } = one(T['t-hostile']);
  assert.ok(!('forward_to' in r.extraction) && !('operations' in r.extraction));
  assert.strictEqual(w.mailbox.drafts.length, 0);
  assert.strictEqual(r.status, 'Draft held for review');
  assert.ok(/email address leads@grab-list.example/.test(tab(w, 'Review').at(-1).source));
  assert.ok(/free text contains a number: \$299,000/.test(tab(w, 'Review').at(-1).source));
  assert.deepStrictEqual(tab(w, 'Transactions').map((x) => x.status), ['Under contract', 'Under contract', 'Under contract']);
});
test('safety', 'Text from an email starting with = is written as text, never as a formula', () => {
  const { w } = one(T['t-formula']);
  assert.strictEqual(w.sheets.formulas.length, 0);
  const row = tab(w, 'Interactions').at(-1);
  assert.ok(row.summary.startsWith('=IMPORTXML('));
});
test('safety', 'Writes outside the closed list are refused (a contract date, an unknown tab)', () => {
  const w = makeWorld([]);
  const t = w.G.loadTables(w.sheets);
  assert.throws(() => w.G.applyOps([{ op: 'update', tab: 'Leads', key: ['lead_id', 'L-0291'], fields: { stage: 'Closed' } }], w.sheets, t), /refused/);
  assert.throws(() => w.G.applyOps([{ op: 'update', tab: 'Transactions', key: ['txn_id', 'T-0117'], fields: { closing_date: '2026-11-06' } }], w.sheets, t), /refused/);
});

// ---------- R9: facts
test('facts', 'An amount or an address typed by the model is rejected; the same facts as code-built clauses pass', () => {
  const w = makeWorld([]);
  const ctx = { allowedClauses: ['sale_terms', 'home_size'], placeWords: w.G.placeWords(w.tables, w.deps.config.EXTRA_CITIES) };
  assert.strictEqual(w.G.freeTextProblems('{{greeting}} Thanks. {{sale_terms}} {{home_size}} {{signature}}', ctx).length, 0);
  assert.ok(w.G.freeTextProblems('It is $319,000.', ctx).length);
  assert.ok(w.G.freeTextProblems('You may like 1134 Engman St too.', ctx).length);
  assert.ok(w.G.freeTextProblems('{{rental_terms}}', ctx).some((p) => /not allowed/.test(p)));
});
test('facts', 'Rent and deposit keep their roles: the rental clause is built from the record (rent $1,695, deposit $2,500)', () => {
  const extra = { listing_id: 'EZ-TEST', address: '12 Test Ln', unit: null, city: 'Tampa', state: 'FL', zip: '33610', status: 'FOR RENT', type: 'SFM', financing_listed: null, price: null, rent: 1695, deposit: 2500, beds: 3, baths: 1, section8_welcome: false, source_url: 'x', captured_at: '2026-10-09' };
  const w = makeWorld([], { extraListings: [extra] });
  const built = w.G.buildClauses(w.G.buildFacts(extra), { language: 'en', config: w.deps.config });
  assert.strictEqual(built.clauses.rental_terms, '12 Test Ln, Tampa is listed for rent on our website at $1,695 per month, with a security deposit of $2,500.');
  assert.strictEqual(w.G.validateDraft(built.clauses.rental_terms, w.G.buildFacts(extra), w.deps.config).length, 0);
  assert.ok(w.G.validateDraft('The deposit is $1,695 and the rent is $2,500.', w.G.buildFacts(extra), w.deps.config).length >= 2);
});
test('facts', 'Under contract with no backup field: the draft says the team will confirm, no backup offer', () => {
  const { r } = one(T['t-under-contract']);
  assert.strictEqual(r.status, 'Under contract');
  assert.strictEqual(r.plan.nextAction, 'team_will_confirm');
  assert.ok(!/backup/i.test(r.draft.text));
});
test('facts', 'FHA on a cash listing with no budget or area: the draft asks for them and suggests no house', () => {
  const { r } = one(T['t-fha-nobudget']);
  assert.strictEqual(r.plan.nextAction, 'ask_budget_and_area');
  assert.strictEqual(r.plan.facts.alternatives.length, 0);
  assert.ok(/budget/.test(r.draft.text));
});

// ---------- R10: contacts, leads, interactions
test('records', 'One person selling two houses has two leads', () => {
  const w = makeWorld([T['t-two-1'], T['t-two-2']]);
  w.G.processMessage(T['t-two-1'], w.deps); w.G.processMessage(T['t-two-2'], w.deps);
  const c = tab(w, 'Contacts').filter((x) => x.email === 'nwebb@example.com');
  assert.strictEqual(c.length, 1);
  assert.strictEqual(tab(w, 'Leads').filter((l) => l.contact_id === c[0].contact_id).length, 2);
});
test('records', '"82nd" fits two listings: shown as ambiguous, sent to Review, no draft', () => {
  const { w, r } = one(T['t-ambiguous']);
  assert.strictEqual(r.status, 'Needs a person');
  assert.ok(/4922 S 82nd St/.test(tab(w, 'Review').at(-1).proposed_value) && /8231 82nd Avenue N/.test(tab(w, 'Review').at(-1).proposed_value));
  assert.strictEqual(w.mailbox.drafts.length, 0);
});
test('records', 'Unit, direction and city are kept when matching', () => {
  const w = makeWorld([]);
  const L = w.tables.Listings, cities = L.map((l) => l.city);
  const addr = (l) => l.address + (l.unit ? ' unit ' + l.unit : '') + ' ' + l.city;
  assert.strictEqual(w.G.matchAddress('95 7th St NE unit B', L, addr, cities).status, 'unique');
  assert.strictEqual(w.G.matchAddress('95 7th St NW', L, addr, cities).status, 'none');
  assert.strictEqual(w.G.matchAddress('8303 Bahia, Clearwater', L, addr, cities).status, 'none');
});
test('records', 'Spam: labelled, nothing written, no draft', () => {
  const { w, r } = one(T['t-spam']);
  assert.strictEqual(r.status, 'Spam, left alone');
  assert.strictEqual(tab(w, 'Interactions').length, 4);
  assert.strictEqual(w.mailbox.drafts.length, 0);
});
test('records', 'Contractor and investor: contact and interaction, short acknowledgement, form link from config only', () => {
  const a = one(T['t-contractor']);
  assert.ok(a.r.draft.text.includes('https://www.ezwayhouses.com/Home/ApplicationHandyMan'));
  const b = one(T['t-investor']);
  assert.strictEqual(b.r.status, 'Logged for the team');
});

// ---------- R7: journal, resume, duplicates (seven tests)
test('journal', '1. Replaying a finished message creates no lead and no draft', () => {
  const m = V['199c4a1e7f3b0a01'];
  const { w } = one(m);
  const leads = tab(w, 'Leads').length;
  const again = w.G.processMessage(m, w.deps);
  assert.ok(again.skipped);
  assert.strictEqual(tab(w, 'Leads').length, leads);
  assert.strictEqual(w.mailbox.drafts.length, 1);
});
test('journal', '2. A new message in an already processed thread is processed', () => {
  const { w, r } = one(T['t-old-thread']);
  assert.ok(!r.skipped);
  assert.strictEqual(r.status, 'Existing lead found');
  assert.strictEqual(w.mailbox.drafts.length, 1);
});
test('journal', '3. A stop right after the draft is created is reconciled without a second draft', () => {
  const m = V['199c4a1e7f3b0a01'];
  const w = makeWorld([m]);
  w.mailbox.crashAfterDraft = true;
  assert.throws(() => w.G.processMessage(m, w.deps));
  assert.strictEqual(w.deps.journal.get('inbox@ezway.example:' + m.id).state, 'DRAFT_PENDING');
  const r = w.G.processMessage(m, w.deps);
  assert.ok(r.resumed && r.adopted);
  assert.strictEqual(w.mailbox.drafts.length, 1);
  assert.strictEqual(w.deps.journal.get('inbox@ezway.example:' + m.id).state, 'DONE');
});
test('journal', '4. An uncertain model result becomes a Review item', () => {
  const m = T['t-investor'];
  const out = JSON.parse(JSON.stringify(readJson('fixtures/model_outputs.json')['t-investor']));
  out.extract.confidence = 'low';
  const { w, r } = one(m, { outputs: { 't-investor': out } });
  assert.strictEqual(r.status, 'Needs a person');
  assert.strictEqual(w.deps.journal.get('inbox@ezway.example:t-investor').state, 'REVIEW');
  assert.strictEqual(w.mailbox.drafts.length, 0);
  assert.ok(w.mailbox.labels['t-investor'].has('EZ/needs review'));
});
test('journal', '5. A draft edited by a person is kept as is', () => {
  const m = V['199c4cc90a4f1e03'];
  const { w } = one(m);
  w.mailbox.drafts[0].body = 'Edited by Yosvani';
  w.G.processMessage(m, w.deps);
  assert.strictEqual(w.mailbox.drafts.length, 1);
  assert.strictEqual(w.mailbox.drafts[0].body, 'Edited by Yosvani');
});
test('journal', '6. A draft already sent is not created again (finished run, and a stop before the journal caught up)', () => {
  const m = V['199c4e41b8d27a04'];
  const { w } = one(m);
  w.mailbox.personSends(w.mailbox.drafts[0].id);
  w.G.processMessage(m, w.deps);
  assert.strictEqual(w.mailbox.drafts.length, 1);
  const w2 = makeWorld([m]);
  w2.mailbox.crashAfterDraft = true;
  assert.throws(() => w2.G.processMessage(m, w2.deps));
  w2.mailbox.personSends(w2.mailbox.drafts[0].id);
  const r2 = w2.G.processMessage(m, w2.deps);
  assert.ok(r2.answered);
  assert.strictEqual(w2.mailbox.drafts.length, 1);
});
test('journal', '7. Two runs at the same time do not apply the same operation twice', () => {
  const shared = { held: false };
  const msgs = E.visible;
  const a = makeWorld(msgs, { sharedLock: shared });
  // run B shares run A's sheets and mailbox but has its own lock handle on the same script lock
  const bDeps = { ...a.deps, lock: new FakeLock(shared) };
  shared.held = true; // run A is in progress
  const b = a.G.runBatch(bDeps);
  assert.ok(b.locked);
  shared.held = false;
  a.G.runBatch(a.deps);
  a.G.runBatch(bDeps);
  assert.strictEqual(tab(a, 'Interactions').length, 4 + msgs.length);
  assert.strictEqual(a.mailbox.drafts.length, msgs.length);
});

// ---------- R5: bounded runs, visible failures
test('runs', 'A run stops at MAX_PER_RUN and the next run continues', () => {
  const w = makeWorld(E.visible);
  w.deps.config = { ...w.deps.config, MAX_PER_RUN: 2 };
  assert.strictEqual(w.G.runBatch(w.deps).processed.filter((x) => !x.skipped).length, 2);
  assert.strictEqual(w.G.runBatch(w.deps).processed.filter((x) => !x.skipped).length, 2);
  assert.strictEqual(w.mailbox.drafts.length, 4);
});
test('runs', 'A failing message is recorded in the journal and goes to review after three attempts', () => {
  const m = { ...T['t-spam'], id: 't-missing', threadId: 't-missing' };
  const w = makeWorld([m]);
  for (let i = 0; i < 3; i++) w.G.runBatch(w.deps);
  const j = w.deps.journal.get('inbox@ezway.example:t-missing');
  assert.strictEqual(Number(j.attempts), 3);
  assert.strictEqual(j.state, 'REVIEW');
  assert.ok(/no recorded output/.test(j.error));
});

// ---------- review of 2026-10-09: blocking points
const mk = (id, threadId, date, from, body, subject) => ({ id, threadId, date, from, to: 'info@ezwayhouses.com', subject: subject || 'Selling my house', body });
const sellerOut = (name, addr) => ({ extract: { category: 'seller_lead', language: 'en', sender_name: name, property_mentions: [], financing: 'unknown', seller_property: addr, summary: 'Wants to sell.', confidence: 'high' }, draft: '{{greeting}}\n\nThanks, someone from our team will contact you.\n\n{{signature}}' });

test('install', 'Fresh install: an old message in a recent thread is never processed, the thread gets one draft', () => {
  const old = mk('g-old', 'th-1', '2026-09-24T13:41:00Z', 'Ray Cole <ray@example.com>', 'I want to sell my house.');
  const neu = mk('g-new', 'th-1', '2026-10-09T11:00:00Z', 'Ray Cole <ray@example.com>', 'Following up.', 'Re: Selling my house');
  const w = makeWorld([old, neu], { outputs: { 'g-old': sellerOut('Ray Cole', null), 'g-new': sellerOut('Ray Cole', null) } });
  w.deps.config = { ...w.deps.config, INSTALLED_AT: '2026-10-09T08:00:00Z' };
  const run = w.G.runBatch(w.deps);
  assert.strictEqual(run.processed.length, 1);
  assert.strictEqual(w.mailbox.drafts.length, 1);
  assert.strictEqual(w.mailbox.drafts[0].messageId, 'g-new');
  assert.strictEqual(w.deps.journal.get('inbox@ezway.example:g-old'), null);
});
test('install', 'Two unprocessed messages in one thread: only the latest gets a draft, the earlier one is still logged', () => {
  const a = mk('h-1', 'th-2', '2026-10-09T10:00:00Z', 'Ray Cole <ray@example.com>', 'I want to sell my house.');
  const b = mk('h-2', 'th-2', '2026-10-09T11:00:00Z', 'Ray Cole <ray@example.com>', 'Also, it has a pool.', 'Re: Selling my house');
  const w = makeWorld([b, a], { outputs: { 'h-1': sellerOut('Ray Cole', null), 'h-2': sellerOut('Ray Cole', null) } });
  w.G.runBatch(w.deps);
  assert.strictEqual(w.mailbox.drafts.length, 1);
  assert.strictEqual(w.mailbox.drafts[0].messageId, 'h-2');
  assert.strictEqual(tab(w, 'Interactions').filter((x) => x.gmail_message_id === 'h-1' || x.gmail_message_id === 'h-2').length, 2);
  assert.strictEqual(tab(w, 'Leads').filter((l) => l.contact_id === tab(w, 'Contacts').find((c) => c.email === 'ray@example.com').contact_id).length, 1);
});
test('install', 'A thread that already has an unsent draft never gets a second one', () => {
  const a = mk('k-1', 'th-3', '2026-10-09T10:00:00Z', 'Ray Cole <ray@example.com>', 'I want to sell my house.');
  const b = mk('k-2', 'th-3', '2026-10-09T12:00:00Z', 'Ray Cole <ray@example.com>', 'Any news?', 'Re: Selling my house');
  const w = makeWorld([a], { outputs: { 'k-1': sellerOut('Ray Cole', null), 'k-2': sellerOut('Ray Cole', null) } });
  w.G.runBatch(w.deps);
  w.mailbox.messages.push(b);
  const r = w.G.runBatch(w.deps).processed[0];
  assert.strictEqual(r.status, 'Draft already waiting in thread');
  assert.strictEqual(w.mailbox.drafts.length, 1);
  assert.ok(/already has an unsent draft/.test(tab(w, 'Review').at(-1).source));
});
test('install', 'Finished messages never starve new mail: 30 done messages ahead, the new one is handled in the first run', () => {
  const done = Array.from({ length: 30 }, (_, i) => mk('d-' + i, 'td-' + i, '2026-10-09T09:' + String(10 + i).padStart(2, '0') + ':00Z', 'X <x' + i + '@example.com>', 'old'));
  const yam = { ...V['199c4e41b8d27a04'] };
  const w = makeWorld(done.concat([yam]));
  done.forEach((m) => w.deps.journal.put('inbox@ezway.example:' + m.id, { message_id: m.id, thread_id: m.threadId, state: 'DONE' }));
  const run = w.G.runBatch(w.deps);
  assert.strictEqual(run.processed.length, 1);
  assert.strictEqual(run.processed[0].key, 'inbox@ezway.example:' + yam.id);
  assert.strictEqual(w.mailbox.drafts.length, 1);
});
test('rerun', 'Model failure after the sheet writes, then a rerun: one lead only (seller with no address)', () => {
  const m = mk('f-1', 'tf-1', '2026-10-09T11:00:00Z', 'Ray Cole <ray@example.com>', 'I want to sell my house, no address yet.');
  const w = makeWorld([m], { outputs: { 'f-1': sellerOut('Ray Cole', null) } });
  const realDraft = w.deps.model.draft.bind(w.deps.model);
  let calls = 0;
  w.deps.model.draft = (...a) => { if (calls++ === 0) throw new Error('Gemini HTTP 503'); return realDraft(...a); };
  const first = w.G.runBatch(w.deps).processed[0];
  assert.ok(/503/.test(first.error));
  w.G.runBatch(w.deps);
  const cid = tab(w, 'Contacts').find((c) => c.email === 'ray@example.com').contact_id;
  assert.strictEqual(tab(w, 'Leads').filter((l) => l.contact_id === cid).length, 1);
  assert.strictEqual(tab(w, 'Contacts').filter((c) => c.email === 'ray@example.com').length, 1);
  assert.strictEqual(tab(w, 'Interactions').filter((x) => x.gmail_message_id === 'f-1').length, 1);
  assert.strictEqual(w.mailbox.drafts.length, 1);
});
test('rerun', 'The same seller writing again with no address is attached to the existing seller lead', () => {
  const a = mk('s-1', 'ts-1', '2026-10-09T10:00:00Z', 'Ray Cole <ray@example.com>', 'I want to sell my house.');
  const b = mk('s-2', 'ts-2', '2026-10-09T11:00:00Z', 'Ray Cole <ray@example.com>', 'Me again.');
  const w = makeWorld([a, b], { outputs: { 's-1': sellerOut('Ray Cole', null), 's-2': sellerOut('Ray Cole', null) } });
  w.G.processMessage(a, w.deps);
  const r = w.G.processMessage(b, w.deps);
  assert.strictEqual(r.status, 'Existing lead found');
  const cid = tab(w, 'Contacts').find((c) => c.email === 'ray@example.com').contact_id;
  assert.strictEqual(tab(w, 'Leads').filter((l) => l.contact_id === cid).length, 1);
});
test('facts', 'Review 1 phrases are rejected in the model text: amounts without $, dates, percentages, lowercase addresses, eligibility or acceptance', () => {
  const w = makeWorld([]);
  const ctx = { allowedClauses: ['sale_terms'], placeWords: w.G.placeWords(w.tables, w.deps.config.EXTRA_CITIES) };
  ['It is 299,000 dollars.', 'The price could drop to 315000.', 'We can close by October 30 with 3% down.', 'You may like 8309 tupelo dr too.', 'You qualify for this one.', 'Aceptamos su voucher de Sección 8.', 'Your application is approved.']
    .forEach((t) => assert.ok(w.G.freeTextProblems(t, ctx).length > 0, 'not caught: ' + t));
});
test('records', '"82nd Ave" resolves to the only avenue; "82nd" alone stays ambiguous', () => {
  const w = makeWorld([]);
  const L = w.tables.Listings, cities = L.map((l) => l.city);
  const addr = (l) => l.address + ' ' + l.city;
  const r = w.G.matchAddress('the house on 82nd Ave', L, addr, cities);
  assert.strictEqual(r.status, 'unique'); assert.strictEqual(r.record.listing_id, 'EZ-4973');
  assert.strictEqual(w.G.matchAddress('82nd', L, addr, cities).status, 'ambiguous');
});

// ---------- verdict on 3f0c7c6: every counterexample of the judge, with its data
const buyerOut = (name, mention, extra) => ({ extract: Object.assign({ category: 'buyer_inquiry', language: 'en', sender_name: name, property_mentions: [mention], financing: 'unknown', summary: 'Asks about ' + mention + '.', confidence: 'high' }, extra || {}), draft: '{{greeting}}\n\nThanks for writing. {{sale_terms}}\n\n{{signature}}' });
const amendOut = (proposed) => ({ extract: { category: 'contract_update', language: 'en', sender_name: 'Brian Kessler', property_mentions: ['4415 Booker T Dr'], financing: 'unknown', contract_change: { field: 'closing_date', proposed, quote: "we're proposing to move closing from October 23 to November 6" }, summary: 'Amendment.', confidence: 'high' }, draft: '{{greeting}}\n\nThanks. {{amendment_ack}} Our team will review it and get back to you.\n\n{{signature}}' });
const BRIAN = V['199c4f2a6c0e9b05'];

test('C1 identity', 'An address in the display name ("gloria.haines@example.com" <stranger@example.com>) never reaches C-0388 or L-0291', () => {
  const m = { ...V['199c4cc90a4f1e03'], id: 'c1-1', threadId: 'c1-1', from: '"gloria.haines@example.com" <stranger@example.com>' };
  const { w, r } = one(m, { outputs: { 'c1-1': readJson('fixtures/model_outputs.json')['199c4cc90a4f1e03'] } });
  assert.strictEqual(tab(w, 'Interactions').filter((x) => x.contact_id === 'C-0388' || x.lead_id === 'L-0291').length, 1); // the old Sep 24 row only
  assert.strictEqual(tab(w, 'Leads').find((l) => l.lead_id === 'L-0291').last_contact, '2026-09-24');
  assert.strictEqual(tab(w, 'Contacts').find((c) => c.contact_id === 'C-0388').last_contact, '2026-09-24');
  assert.ok(w.mailbox.drafts.every((d) => !/Gloria|2214 Windward Palms/.test(d.body)));
  assert.strictEqual(w.mailbox.drafts.length, 0);
  assert.ok(/display name/.test(tab(w, 'Review').at(-1).source));
  assert.strictEqual(r.status, 'Sender unclear, needs a person');
});
test('C1 identity', 'Several or malformed addresses in From go to Review, with no lookup and no draft', () => {
  for (const from of ['a@example.com, b@example.com', 'Tanya <tanya.brooks@example>', 'Tanya <a@example.com> <b@example.com>']) {
    const m = { ...V['199c4a1e7f3b0a01'], id: 'c1-x', threadId: 'c1-x', from };
    const { w } = one(m, { outputs: { 'c1-x': readJson('fixtures/model_outputs.json')['199c4a1e7f3b0a01'] } });
    assert.strictEqual(w.mailbox.drafts.length, 0, from);
    assert.strictEqual(tab(w, 'Contacts').length, 5, from);
  }
});
test('C1 identity', 'The canonical address is used for the contact, the journal and the recipient preview', () => {
  const { w, r } = one(V['199c4a1e7f3b0a01']);
  assert.strictEqual(r.draft.to, 'tanya.brooks@example.com');
  assert.strictEqual(w.mailbox.drafts[0].to, r.draft.to);
  assert.strictEqual(w.deps.journal.get('inbox@ezway.example:199c4a1e7f3b0a01').sender, 'tanya.brooks@example.com');
  assert.strictEqual(tab(w, 'Contacts').at(-1).email, 'tanya.brooks@example.com');
});
test('C2 reply-to', 'Two buyers through the same form From (different Reply-To) are not grouped; drafts go to Reply-To with public facts only', () => {
  const mk2 = (id, rt) => ({ id, threadId: id, date: '2026-10-09T11:00:00Z', from: 'Website Form <notifications@website-form.example>', replyTo: rt, to: 'info@ezwayhouses.com', subject: '8303 Bahia', body: 'Is 8303 Bahia still available?' });
  const a = mk2('c2-a', 'Ann Lee <ann@example.com>'), b = mk2('c2-b', 'Bo Kim <bo@example.com>');
  const w = makeWorld([a, b], { outputs: { 'c2-a': buyerOut('Ann Lee', '8303 Bahia'), 'c2-b': buyerOut('Bo Kim', '8303 Bahia') } });
  const ra = w.G.processMessage(a, w.deps), rb = w.G.processMessage(b, w.deps);
  assert.strictEqual(tab(w, 'Contacts').length, 5);
  assert.strictEqual(tab(w, 'Leads').length, 3);
  assert.strictEqual(ra.status, 'Sender identity unclear');
  assert.deepStrictEqual([ra.draft.to, rb.draft.to], ['ann@example.com', 'bo@example.com']);
  assert.deepStrictEqual(w.mailbox.drafts.map((d) => d.to), ['ann@example.com', 'bo@example.com']);
  assert.ok(w.mailbox.drafts.every((d) => d.body.startsWith('Hello,') && /\$327,900/.test(d.body)));
});
test('C3 transactions', 'An unknown sender proposing November 6 on 4415 Booker T Dr gets no "October 23" and goes to Review', () => {
  const m = { ...BRIAN, id: 'c3-1', threadId: 'c3-1', from: 'Pat Doe <pat.doe@example.com>', body: 'Hi team, for 4415 Booker T Dr we propose to move closing to November 6.' };
  const out = amendOut('2026-11-06'); out.extract.contract_change.quote = 'we propose to move closing to November 6';
  const { w, r } = one(m, { outputs: { 'c3-1': out } });
  assert.ok(r.draft && !/October 23|Oct 23|2026-10-23/.test(r.draft.text));
  assert.ok(r.draft.generic);
  assert.ok(/not a party recorded/.test(tab(w, 'Review').at(-1).source));
  assert.strictEqual(tab(w, 'Review').filter((x) => x.ref === 'T-0117').length, 0);
});
test('C4 provenance', 'proposed = "2026-12-25" with the November 6 quote: problems reported, no "December 25" anywhere in the draft', () => {
  const m = { ...BRIAN, id: 'c4-1' };
  const { w, r } = one(m, { outputs: { 'c4-1': amendOut('2026-12-25') } });
  assert.ok(r.problems.length > 0);
  assert.ok(!/December 25|2026-12-25/.test(r.draft.text));
  assert.ok(!/November 6|October 23/.test(r.draft.text));
  const row = tab(w, 'Review').at(-1);
  assert.ok(/does not follow from the quoted text/.test(row.source) && row.proposed_value === '');
});
test('C5 clauses', "The judge's six sentences are rejected in the model's own words", () => {
  const w = makeWorld([]);
  const ctx = { allowedClauses: ['sale_terms', 'rental_terms'], placeWords: w.G.placeWords(w.tables, w.deps.config.EXTRA_CITIES) };
  ['The price is three hundred thousand dollars.', 'We can close on December 3.', '9513 S Dartmouth Ave in Miami is listed at $264,900.', 'This house is listed with FHA financing.', 'The weekly rent is $1,695.', '$2,500 per month with a $1,695 security deposit.']
    .forEach((t) => assert.ok(w.G.freeTextProblems('{{greeting}} ' + t + ' {{signature}}', ctx).length > 0, 'not rejected: ' + t));
});
test('C5 clauses', 'A rejected template sends the message to Review with no draft (FHA typed on the Dartmouth reply)', () => {
  const out = JSON.parse(JSON.stringify(readJson('fixtures/model_outputs.json')['199c4b5d2e81c702']));
  out.draft = '{{greeting}}\n\nThis house is listed with FHA financing. {{sale_terms}}\n\n{{signature}}';
  const m = { ...V['199c4b5d2e81c702'], id: 'c5-1', threadId: 'c5-1' };
  const { w, r } = one(m, { outputs: { 'c5-1': out } });
  assert.strictEqual(r.status, 'Draft held for review');
  assert.strictEqual(w.mailbox.drafts.length, 0);
});
test('C6 saved plan', 'Draft failure, retry where the model now says "2026-11-06 ", then November 7: one Review row, first plan value', () => {
  const m = { ...BRIAN };
  const w = makeWorld([m], { outputs: { [m.id]: amendOut('2026-11-06') } });
  const variants = [amendOut('2026-11-06').extract, amendOut('2026-11-06 ').extract, amendOut('2026-11-07').extract];
  let extracts = 0, drafts = 0;
  const realDraft = w.deps.model.draft.bind(w.deps.model);
  w.deps.model.extract = () => JSON.parse(JSON.stringify(variants[Math.min(extracts++, 2)]));
  w.deps.model.draft = (...a) => { if (drafts++ === 0) throw new Error('Gemini HTTP 503'); return realDraft(...a); };
  w.G.runBatch(w.deps); w.G.runBatch(w.deps); w.G.runBatch(w.deps);
  const rows = tab(w, 'Review').filter((x) => x.ref === 'T-0117');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].proposed_value, '2026-11-06');
  assert.strictEqual(extracts, 1);
  assert.strictEqual(w.mailbox.drafts.length, 1);
});
test('C6 saved plan', 'Dates are stored as YYYY-MM-DD without spaces', () => {
  const w = makeWorld([]);
  assert.strictEqual(w.G.cleanExtraction(amendOut('2026-11-06 ').extract, BRIAN).value.contract_change.proposed, '2026-11-06');
  assert.strictEqual(w.G.cleanExtraction(amendOut('November 6').extract, BRIAN).value.contract_change.proposed, '2026-11-06');
});
test('C7 provisional lead', '"I want to sell my house." then "The address is 15 Lakeview Ct, Brandon." in the same thread: one lead, with the address', () => {
  const a = mk('c7-1', 'th-c7', '2026-10-09T10:00:00Z', 'Ray Cole <ray@example.com>', 'I want to sell my house.');
  const b = mk('c7-2', 'th-c7', '2026-10-09T11:00:00Z', 'Ray Cole <ray@example.com>', 'The address is 15 Lakeview Ct, Brandon.', 'Re: Selling my house');
  const w = makeWorld([a, b], { outputs: { 'c7-1': sellerOut('Ray Cole', null), 'c7-2': sellerOut('Ray Cole', '15 Lakeview Ct, Brandon') } });
  w.G.processMessage(a, w.deps); w.G.processMessage(b, w.deps);
  const cid = tab(w, 'Contacts').find((c) => c.email === 'ray@example.com').contact_id;
  const leads = tab(w, 'Leads').filter((l) => l.contact_id === cid);
  assert.strictEqual(leads.length, 1);
  assert.strictEqual(leads[0].property_address, '15 Lakeview Ct, Brandon');
});
test('C7 provisional lead', 'An address arriving in a different thread does not fill the provisional lead: Review', () => {
  const a = mk('c7-3', 'th-c7a', '2026-10-09T10:00:00Z', 'Ray Cole <ray@example.com>', 'I want to sell my house.');
  const b = mk('c7-4', 'th-c7b', '2026-10-09T11:00:00Z', 'Ray Cole <ray@example.com>', 'The address is 15 Lakeview Ct, Brandon.');
  const w = makeWorld([a, b], { outputs: { 'c7-3': sellerOut('Ray Cole', null), 'c7-4': sellerOut('Ray Cole', '15 Lakeview Ct, Brandon') } });
  w.G.processMessage(a, w.deps);
  const r = w.G.processMessage(b, w.deps);
  assert.strictEqual(r.status, 'Needs a person');
  assert.ok(/another thread/.test(tab(w, 'Review').at(-1).source));
});
test('C8 aliases', 'Reply from the alias sales@ at 11:05: the seller message of 11:00 is not superseded, no contact or draft for the alias', () => {
  const seller = mk('c8-1', 'th-c8', '2026-10-09T11:00:00Z', 'Ray Cole <ray@example.com>', 'I want to sell my house.');
  const alias = { id: 'c8-2', threadId: 'th-c8', date: '2026-10-09T11:05:00Z', from: 'EZ Way Sales <sales@ezway.example>', to: 'ray@example.com', subject: 'Re: Selling my house', body: 'Thanks Ray, we will call you.' };
  const w = makeWorld([seller, alias], { owners: ['inbox@ezway.example', 'sales@ezway.example'], outputs: { 'c8-1': sellerOut('Ray Cole', null) } });
  const run = w.G.runBatch(w.deps);
  assert.strictEqual(run.processed.length, 1);
  assert.ok(!run.processed[0].superseded);
  assert.ok(!tab(w, 'Contacts').some((c) => c.email === 'sales@ezway.example'));
  assert.ok(w.mailbox.drafts.every((d) => d.to !== 'sales@ezway.example'));
  assert.strictEqual(w.mailbox.drafts.length, 0); // already answered by the owner after the message
  assert.strictEqual(run.processed[0].status, 'Already answered');
});
test('C9 reconciliation', 'Owner reply 12:29:30, new message 12:29:50, failure at 12:30 before any draft: the retry does not end in DONE', () => {
  const owner = { id: 'c9-0', threadId: 'th-c9', date: '2026-10-09T12:29:30Z', from: 'EZ Way <inbox@ezway.example>', to: 'tanya.brooks@example.com', subject: 'Re: 8303 Bahia', body: 'Earlier reply.' };
  const neu = { ...V['199c4a1e7f3b0a01'], id: 'c9-1', threadId: 'th-c9', date: '2026-10-09T12:29:50Z' };
  const w = makeWorld([owner, neu], { outputs: { 'c9-1': readJson('fixtures/model_outputs.json')['199c4a1e7f3b0a01'] } });
  w.mailbox.failBeforeDraft = true;
  w.G.runBatch(w.deps);
  w.G.runBatch(w.deps);
  const j = w.deps.journal.get('inbox@ezway.example:c9-1');
  assert.notStrictEqual(j.state, 'DONE');
  assert.strictEqual(j.state, 'REVIEW');
  assert.strictEqual(w.mailbox.drafts.length, 0);
});
test('C9 reconciliation', 'A message already answered by the owner gets no draft on the first pass', () => {
  const neu = { ...V['199c4a1e7f3b0a01'], id: 'c9-2', threadId: 'th-c9b', date: '2026-10-09T11:00:00Z' };
  const owner = { id: 'c9-3', threadId: 'th-c9b', date: '2026-10-09T11:20:00Z', from: 'inbox@ezway.example', to: 'tanya.brooks@example.com', subject: 'Re: 8303 Bahia', body: 'Answered.' };
  const w = makeWorld([neu, owner], { outputs: { 'c9-2': readJson('fixtures/model_outputs.json')['199c4a1e7f3b0a01'] } });
  const run = w.G.runBatch(w.deps);
  assert.strictEqual(w.mailbox.drafts.length, 0);
  assert.strictEqual(run.processed[0].status, 'Already answered');
});
test('C10 retry by id', 'A failed message four days old, and an archived one, are retried by id', () => {
  const old = { ...V['199c4a1e7f3b0a01'], id: 'c10-1', threadId: 'c10-1', date: '2026-10-05T10:00:00Z' };
  const arch = { ...V['199c4b5d2e81c702'], id: 'c10-2', threadId: 'c10-2' };
  const fx = readJson('fixtures/model_outputs.json');
  const w = makeWorld([old, arch], { outputs: { 'c10-1': fx['199c4a1e7f3b0a01'], 'c10-2': fx['199c4b5d2e81c702'] } });
  w.deps.journal.put('inbox@ezway.example:c10-1', { message_id: 'c10-1', thread_id: 'c10-1', state: 'ERROR', attempts: 1, error: 'Gemini HTTP 503' });
  w.deps.journal.put('inbox@ezway.example:c10-2', { message_id: 'c10-2', thread_id: 'c10-2', state: 'ERROR', attempts: 1, error: 'Gemini HTTP 503' });
  w.mailbox.hidden.add('c10-2');
  w.G.runBatch(w.deps);
  assert.strictEqual(w.deps.journal.get('inbox@ezway.example:c10-1').state, 'DONE');
  assert.strictEqual(w.deps.journal.get('inbox@ezway.example:c10-2').state, 'DONE');
  assert.strictEqual(w.mailbox.drafts.length, 2);
});
test('C11 flush', 'Sheet writes are flushed before the lock is released, also when the run fails', () => {
  const w = makeWorld(E.visible.slice(0, 1));
  w.sheets.onFlush = () => w.lockState.events.push('flush');
  w.G.runBatch(w.deps);
  assert.deepStrictEqual(w.lockState.events.slice(-3), ['lock', 'flush', 'release']);
  w.mailbox.listCandidates = () => { throw new Error('Gmail unavailable'); };
  assert.throws(() => w.G.runBatch(w.deps));
  assert.deepStrictEqual(w.lockState.events.slice(-3), ['lock', 'flush', 'release']);
  assert.strictEqual(w.lockState.held, false);
});
test('C12 page claims', 'Every never / nothing / every / always on the page is tied to a named test', () => {
  const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
  const claims = {
    'The code never sends': 'No send operation anywhere in src/',
    'a person reviews every draft': 'No send operation anywhere in src/',
    'on every build of this page': 'site/data.js regenerates identically from the repository'
  };
  const data = fs.readFileSync(path.join(ROOT, 'site', 'data.js'), 'utf8');
  const shown = (data.match(/"(?:why|result|status)": "[^"]*"/g) || []).map((x) => x.replace(/^"\w+": "/, '').replace(/"$/, '') + '.').join(' ');
  const hits = (html + ' ' + shown).split(/(?<=[.!?])\s+/).filter((sent) => /\b(never|nothing|every|always)\b/i.test(sent));
  assert.ok(hits.length > 0);
  hits.forEach((sent) => {
    const k = Object.keys(claims).find((c) => sent.includes(c));
    assert.ok(k, 'claim without a test: ' + sent.trim());
    assert.ok(results.some((r) => r.name === claims[k] && r.ok), 'test missing or failing for: ' + k);
  });
});
test('C13 no send', 'No send, reply or forward call anywhere in the repository code', () => {
  const files = ['src', 'test', 'tools'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js') && f !== 'run.js').map((f) => path.join(ROOT, d, f))); // run.js holds the patterns themselves
  files.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n').replace(/['"`][^'"`\n]*['"`]/g, '""');
    assert.ok(!/sendEmail|\.send\s*\(|\.reply\s*\(|\.replyAll\s*\(|\.forward\s*\(|MailApp/.test(src), path.basename(f));
  });
});
test('C18 page data', 'Two successive regenerations of site/data.js are identical', () => {
  const { render } = require('../tools/build_page_data');
  assert.strictEqual(render(), render());
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + '[' + r.group + '] ' + r.name + (r.ok ? '' : '\n      ' + r.err));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
fs.writeFileSync(path.join(ROOT, 'test', 'last_run.txt'), results.map((r) => (r.ok ? 'PASS ' : 'FAIL ') + '[' + r.group + '] ' + r.name).join('\n') + '\n\n' + (results.length - failed.length) + '/' + results.length + ' passed\n');
process.exit(failed.length ? 1 : 0);
