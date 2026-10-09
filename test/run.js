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
  assert.ok(/renta mensual de \$1,695/.test(r.draft.text) && /depósito de \$1,695/.test(r.draft.text));
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
  assert.ok(/amount \$299,000/.test(tab(w, 'Review').at(-1).source));
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
test('facts', 'An amount or an address not in the matched record blocks the draft', () => {
  const w = makeWorld([]);
  const facts = w.G.buildFacts(w.tables.Listings.find((l) => l.listing_id === 'EZ-5000'));
  assert.strictEqual(w.G.validateDraft('8303 Bahia Ave is $327,900.', facts, w.deps.config).length, 0);
  assert.ok(w.G.validateDraft('It is $319,000.', facts, w.deps.config).length);
  assert.ok(w.G.validateDraft('You may like 1134 Engman St too.', facts, w.deps.config).length);
});
test('facts', 'Rent and deposit are never swapped', () => {
  const extra = { listing_id: 'EZ-TEST', address: '12 Test Ln', unit: null, city: 'Tampa', state: 'FL', zip: '33610', status: 'FOR RENT', type: 'SFM', financing_listed: null, price: null, rent: 1500, deposit: 2000, beds: 3, baths: 1, section8_welcome: false, source_url: 'x', captured_at: '2026-10-09' };
  const w = makeWorld([], { extraListings: [extra] });
  const facts = w.G.buildFacts(extra);
  const out = w.G.renderDraft('Rent is {{rent}} per month and the deposit is {{deposit}}.', facts, { language: 'en', config: w.deps.config });
  assert.strictEqual(out.text, 'Rent is $1,500 per month and the deposit is $2,000.');
  assert.strictEqual(w.G.validateDraft(out.text, facts, w.deps.config).length, 0);
  assert.ok(w.G.validateDraft('The deposit is $1,500 and the rent is $2,000.', facts, w.deps.config).length >= 2);
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
  assert.ok(r2.sentByPerson);
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

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + '[' + r.group + '] ' + r.name + (r.ok ? '' : '\n      ' + r.err));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
fs.writeFileSync(path.join(ROOT, 'test', 'last_run.txt'), results.map((r) => (r.ok ? 'PASS ' : 'FAIL ') + '[' + r.group + '] ' + r.name).join('\n') + '\n\n' + (results.length - failed.length) + '/' + results.length + ' passed\n');
process.exit(failed.length ? 1 : 0);
