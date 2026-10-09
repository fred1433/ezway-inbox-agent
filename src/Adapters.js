/**
 * Adapters.js: the only file that touches Gmail and Sheets.
 *
 * The mailbox adapter can do four things: list messages, create a draft reply in the thread, look for a draft or
 * a reply in a thread, and add a label. There is no send operation anywhere in this repository (R6), and the
 * model never chooses a recipient, an operation or a URL: createDraftReply answers the sender of the message.
 */

function AppsScriptMailbox(config) {
  this.config = config;
  this.me = Session.getEffectiveUser().getEmail().toLowerCase();
}
/** Every incoming message received since sinceMs, all pages of the search. The pipeline removes finished ones. */
AppsScriptMailbox.prototype.listCandidates = function (query, sinceMs) {
  var me = this.me, out = [], q = query + ' after:' + Math.floor(sinceMs / 1000), page = 50;
  for (var start = 0; start < 2000; start += page) {
    var threads = GmailApp.search(q, start, page);
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        if (m.isDraft() || m.isInTrash()) return;
        if (m.getDate().getTime() < sinceMs) return; // older messages of a recent thread are never picked up
        if (normEmail(m.getFrom()) === me) return;
        out.push({ id: m.getId(), threadId: thread.getId(), from: m.getFrom(), to: m.getTo(), subject: m.getSubject(), date: m.getDate().toISOString(), body: m.getPlainBody().slice(0, 8000) });
      });
    });
    if (threads.length < page) break;
  }
  return out;
};
AppsScriptMailbox.prototype.createDraftReply = function (messageId, body) {
  return GmailApp.getMessageById(messageId).createDraftReply(body).getId();
};
AppsScriptMailbox.prototype.findDraftInThread = function (threadId, sinceMs) {
  var hit = GmailApp.getDrafts().filter(function (d) {
    var m = d.getMessage();
    return m.getThread().getId() === threadId && m.getDate().getTime() >= sinceMs - 60000;
  })[0];
  return hit ? hit.getId() : null;
};
AppsScriptMailbox.prototype.threadHasReplyAfter = function (threadId, sinceMs) {
  var me = this.me;
  return GmailApp.getThreadById(threadId).getMessages().some(function (m) {
    return !m.isDraft() && normEmail(m.getFrom()) === me && m.getDate().getTime() >= sinceMs - 60000;
  });
};
AppsScriptMailbox.prototype.addLabel = function (threadId, name) {
  var label = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  GmailApp.getThreadById(threadId).addLabel(label);
};

/** Sheets: one tab per table, header on row 1. Every string is written as a literal (no formula from an email). */
function AppsScriptSheets(spreadsheetId) {
  this.ss = SpreadsheetApp.openById(spreadsheetId);
}
AppsScriptSheets.prototype.sheet_ = function (tab) {
  var sh = this.ss.getSheetByName(tab);
  if (!sh) throw new Error('missing tab ' + tab);
  return sh;
};
AppsScriptSheets.prototype.header_ = function (sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
};
AppsScriptSheets.prototype.readTable = function (tab) {
  var sh = this.sheet_(tab), last = sh.getLastRow();
  if (last < 2) return [];
  var head = this.header_(sh);
  var tz = this.ss.getSpreadsheetTimeZone();
  return sh.getRange(2, 1, last - 1, head.length).getValues().map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], tz, 'yyyy-MM-dd') : r[i]; });
    return o;
  });
};
AppsScriptSheets.prototype.appendRow = function (tab, obj) {
  var sh = this.sheet_(tab), head = this.header_(sh);
  sh.appendRow(head.map(function (h) { return literal(obj[h] === undefined || obj[h] === null ? '' : obj[h]); }));
};
AppsScriptSheets.prototype.updateRow = function (tab, keyField, keyValue, patch) {
  var sh = this.sheet_(tab), head = this.header_(sh), col = head.indexOf(keyField) + 1;
  var keys = sh.getRange(2, col, Math.max(1, sh.getLastRow() - 1), 1).getDisplayValues().map(function (r) { return r[0]; });
  var idx = keys.indexOf(String(keyValue));
  if (idx < 0) throw new Error('row not found ' + keyField + '=' + keyValue);
  Object.keys(patch).forEach(function (k) {
    var c = head.indexOf(k);
    if (c >= 0) sh.getRange(idx + 2, c + 1).setValue(literal(patch[k]));
  });
};

function ScriptLock() { this.lock = LockService.getScriptLock(); }
ScriptLock.prototype.tryLock = function (ms) { return this.lock.tryLock(ms); };
ScriptLock.prototype.releaseLock = function () { this.lock.releaseLock(); };

var SystemClock = { now: function () { return new Date(); } };
