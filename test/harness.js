// Loads the Apps Script sources into one Node context (they share globals, like in Apps Script)
// and provides in-memory stand-ins for Gmail, Sheets, the script lock and the clock.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = ['Core.js', 'Pipeline.js', 'Models.js', 'Adapters.js'];

function loadSources() {
  const ctx = vm.createContext({ console, Intl, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, parseInt });
  for (const f of SRC) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), ctx, { filename: f });
  return new Proxy({}, { get: (_, name) => vm.runInContext(String(name), ctx) });
}

/** A sheet that behaves like Sheets for the part that matters: a string starting with = becomes a formula. */
class FakeSheets {
  constructor(tables, headers) {
    this.headers = headers;
    this.cells = {};
    this.formulas = [];
    for (const tab of Object.keys(headers)) this.cells[tab] = (tables[tab] || []).map((r) => headers[tab].map((h) => (r[h] === undefined || r[h] === null ? '' : r[h])));
  }
  store_(tab, v) {
    if (typeof v === 'string' && v.startsWith("'")) return v.slice(1); // shown as text, never evaluated
    if (typeof v === 'string' && v.startsWith('=')) { this.formulas.push({ tab, v }); return { formula: v }; }
    return v;
  }
  readTable(tab) {
    const head = this.headers[tab];
    return this.cells[tab].map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] && r[i].formula ? '#FORMULA' : r[i]])));
  }
  appendRow(tab, obj, internal, literalFn) {
    const lit = literalFn || this.literal;
    this.cells[tab].push(this.headers[tab].map((h) => this.store_(tab, lit(obj[h] === undefined || obj[h] === null ? '' : obj[h]))));
  }
  updateRow(tab, keyField, keyValue, patch) {
    const head = this.headers[tab];
    const row = this.cells[tab].find((r) => String(r[head.indexOf(keyField)]) === String(keyValue));
    if (!row) throw new Error('row not found ' + keyValue);
    for (const k of Object.keys(patch)) { const i = head.indexOf(k); if (i >= 0) row[i] = this.store_(tab, this.literal(patch[k])); }
  }
}

class FakeMailbox {
  constructor(messages) {
    this.messages = messages;
    this.drafts = [];
    this.replies = [];
    this.labels = {};
    this.seq = 0;
    this.crashAfterDraft = false;
    this.clockMs = () => Date.parse('2026-10-09T12:30:00Z');
  }
  listCandidates(query, max) { return this.messages.slice(0, max); }
  createDraftReply(messageId, body) {
    const m = this.messages.find((x) => x.id === messageId);
    const id = 'r-' + String(++this.seq).padStart(4, '0');
    this.drafts.push({ id, messageId, threadId: m.threadId, to: (m.from.match(/<([^>]+)>/) || [, m.from])[1].toLowerCase(), subject: 'Re: ' + m.subject.replace(/^re:\s*/i, ''), body, createdMs: this.clockMs() });
    if (this.crashAfterDraft) { this.crashAfterDraft = false; throw new Error('simulated stop after the draft was created'); }
    return id;
  }
  findDraftInThread(threadId, sinceMs) {
    const d = this.drafts.find((x) => x.threadId === threadId && !x.sent && x.createdMs >= sinceMs - 60000);
    return d ? d.id : null;
  }
  threadHasReplyAfter(threadId, sinceMs) { return this.replies.some((r) => r.threadId === threadId && r.ms >= sinceMs - 60000); }
  addLabel(threadId, name) { (this.labels[threadId] = this.labels[threadId] || new Set()).add(name); }
  // used by tests only: a person sends a draft from Gmail
  personSends(draftId) { const d = this.drafts.find((x) => x.id === draftId); d.sent = true; this.replies.push({ threadId: d.threadId, ms: this.clockMs() }); }
}

class FakeLock {
  constructor(shared) { this.shared = shared || { held: false }; }
  tryLock() { if (this.shared.held) return false; this.shared.held = true; return true; }
  releaseLock() { this.shared.held = false; }
}

const fixedClock = (iso) => ({ now: () => new Date(iso) });

const CONFIG = {
  MAX_PER_RUN: 10, MAX_RUN_MS: 240000, TIMEZONE: 'America/New_York', QUERY: 'in:inbox newer_than:3d',
  LABEL_PROCESSED: 'EZ/processed', LABEL_REVIEW: 'EZ/needs review', OFFICE_PHONE: '(813) 446-3257',
  CONTRACTOR_FORM_URL: 'https://www.ezwayhouses.com/Home/ApplicationHandyMan', SIGNATURE: 'The EZ Way Houses team',
  SIGNATURE_ES: 'El equipo de EZ Way Houses', EXTRA_CITIES: ['Brandon', 'Riverview', 'Valrico', 'Plant City', 'Lutz', 'Wesley Chapel', 'St. Petersburg']
};

function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }

/** A fresh world: sample sheets + listing snapshot + mailbox, wired to the real pipeline with the fixture model. */
function makeWorld(messages, opts = {}) {
  const G = loadSources();
  const ops = readJson('data/sample/operations.json');
  const snap = readJson('data/listings_snapshot.json');
  const tables = JSON.parse(JSON.stringify({ ...ops, Listings: snap.listings.concat(opts.extraListings || []) }));
  const sheets = new FakeSheets(tables, ops.headers);
  sheets.literal = G.literal;
  const mailbox = new FakeMailbox(messages);
  const outputs = { ...readJson('fixtures/model_outputs.json'), ...(opts.outputs || {}) };
  const model = new G.FixtureModel(outputs);
  const deps = {
    config: CONFIG, mailboxId: 'inbox@ezway.example', mailbox, sheets, journal: new G.SheetJournal(sheets),
    model, lock: new FakeLock(opts.sharedLock), clock: fixedClock(opts.now || '2026-10-09T12:30:00Z')
  };
  return { G, deps, sheets, mailbox, tables };
}

module.exports = { loadSources, FakeSheets, FakeMailbox, FakeLock, makeWorld, readJson, CONFIG, ROOT };
