/**
 * Main.js: entry points for the Apps Script project bound to ONE mailbox (the account that authorizes it).
 *
 * Settings live in Script Properties (Project Settings > Script properties), readable by the project's editors:
 *   SPREADSHEET_ID   the spreadsheet with tabs Listings, Contacts, Leads, Interactions, Transactions, Review, Journal
 *   GEMINI_API_KEY   a key from a billed Google Cloud project of the company (or switch to Vertex AI)
 *   GEMINI_MODEL     optional, defaults to gemini-3.8-flash; gemini-3.1-pro-preview is the option to evaluate
 *   MAX_PER_RUN      optional, defaults to 10 messages per run
 */

function loadConfig_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  return {
    SPREADSHEET_ID: p.SPREADSHEET_ID,
    GEMINI_API_KEY: p.GEMINI_API_KEY,
    GEMINI_MODEL: p.GEMINI_MODEL || 'gemini-3.8-flash',
    MAX_PER_RUN: Number(p.MAX_PER_RUN || 10),
    MAX_RUN_MS: 4 * 60 * 1000,
    LOOKBACK_MS: 3 * 24 * 3600 * 1000,
    INSTALLED_AT: p.INSTALLED_AT || '',   // set by installTrigger: nothing received before it is ever processed
    TIMEZONE: 'America/New_York',
    // The label is for people only: progress is read from the Journal tab, so a new message in an
    // already labelled thread is still picked up.
    QUERY: p.QUERY || 'in:inbox newer_than:3d',
    LABEL_PROCESSED: 'EZ/processed',
    LABEL_REVIEW: 'EZ/needs review',
    OFFICE_PHONE: '(813) 446-3257',
    CONTRACTOR_FORM_URL: 'https://www.ezwayhouses.com/Home/ApplicationHandyMan',
    SIGNATURE: p.SIGNATURE || 'The EZ Way Houses team',
    SIGNATURE_ES: p.SIGNATURE_ES || 'El equipo de EZ Way Houses',
    EXTRA_CITIES: ['Brandon', 'Riverview', 'Valrico', 'Plant City', 'Lutz', 'Wesley Chapel', 'St. Petersburg']
  };
}

/** Runs one bounded batch. Called by the time-driven trigger. */
function processInbox() {
  var cfg = loadConfig_();
  var sheets = new AppsScriptSheets(cfg.SPREADSHEET_ID);
  var deps = {
    config: cfg,
    mailboxId: Session.getEffectiveUser().getEmail().toLowerCase(),
    mailbox: new AppsScriptMailbox(cfg),
    sheets: sheets,
    journal: new SheetJournal(sheets),
    model: new GeminiModel(cfg),
    lock: new ScriptLock(),
    clock: SystemClock
  };
  var out = runBatch(deps);
  console.log(JSON.stringify({ locked: out.locked, processed: out.processed.length, errors: out.processed.filter(function (r) { return r.error; }).length }));
}

/** Records the start time (INSTALLED_AT) and installs a periodic trigger (every 10 minutes). Run once by hand. */
function installTrigger() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('INSTALLED_AT')) props.setProperty('INSTALLED_AT', new Date().toISOString());
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'processInbox') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(10).create();
}
