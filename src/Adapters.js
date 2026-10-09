/**
 * Adapters.js: the only file that touches Gmail and Sheets.
 *
 * The mailbox adapter can do these things only: list or fetch messages, create a draft reply in the thread, look for
 * a draft or a reply in a thread, add a label. There is no send operation anywhere in this repository (R6), and the
 * model never chooses a recipient, an operation or a URL: createDraftReply answers the message (its Reply-To, or
 * its sender).
 */

var BODY_MAX_CHARS = 8000;

function AppsScriptMailbox(config) {
  this.config = config;
  this.owners = [Session.getEffectiveUser().getEmail()].concat(GmailApp.getAliases()).map(function (e) { return String(e).toLowerCase(); });
}
/** The mailbox owner and every send-as alias: their messages are never treated as incoming (C8). */
AppsScriptMailbox.prototype.ownerAddresses = function () { return this.owners.slice(); };
AppsScriptMailbox.prototype.toMsg_ = function (m) {
  // Attachments are not read; the body is cut at BODY_MAX_CHARS characters.
  return { id: m.getId(), threadId: m.getThread().getId(), from: m.getFrom(), replyTo: m.getReplyTo(), to: m.getTo(), subject: m.getSubject(), date: m.getDate().toISOString(), body: m.getPlainBody().slice(0, BODY_MAX_CHARS) };
};
/** Every message received since sinceMs, all pages of the search. The pipeline removes owner and finished ones. */
AppsScriptMailbox.prototype.listCandidates = function (query, sinceMs) {
  var self = this, out = [], q = query + ' after:' + Math.floor(sinceMs / 1000), page = 50;
  for (var start = 0; start < 2000; start += page) {
    var threads = GmailApp.search(q, start, page);
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        if (m.isDraft() || m.isInTrash()) return;
        if (m.getDate().getTime() < sinceMs) return; // older messages of a recent thread are never picked up
        out.push(self.toMsg_(m));
      });
    });
    if (threads.length < page) break;
  }
  return out;
};
/** Fetches one message by id, for retries outside the search window (C10). */
AppsScriptMailbox.prototype.getMessage = function (id) {
  try { var m = GmailApp.getMessageById(id); return m ? this.toMsg_(m) : null; } catch (e) { return null; }
};
/** Gmail addresses the draft to the Reply-To of the message when there is one, otherwise to its sender. */
AppsScriptMailbox.prototype.createDraftReply = function (messageId, body) {
  return GmailApp.getMessageById(messageId).createDraftReply(body).getId();
};
AppsScriptMailbox.prototype.findDraftInThread = function (threadId, sinceMs) {
  var hit = GmailApp.getDrafts().filter(function (d) {
    var m = d.getMessage();
    return m.getThread().getId() === threadId && m.getDate().getTime() >= sinceMs;
  })[0];
  return hit ? hit.getId() : null;
};
/** True only for a message sent by the owner or an alias strictly after afterMs (no tolerance, C9). */
AppsScriptMailbox.prototype.threadHasReplyAfter = function (threadId, afterMs, owners) {
  return GmailApp.getThreadById(threadId).getMessages().some(function (m) {
    return !m.isDraft() && owners.indexOf(normEmail(m.getFrom())) >= 0 && m.getDate().getTime() > afterMs;
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

/** Pending spreadsheet changes are written before the script lock is released (C11). */
AppsScriptSheets.prototype.flush = function () { SpreadsheetApp.flush(); };

function ScriptLock() { this.lock = LockService.getScriptLock(); }
ScriptLock.prototype.tryLock = function (ms) { return this.lock.tryLock(ms); };
ScriptLock.prototype.releaseLock = function () { this.lock.releaseLock(); };

var SystemClock = { now: function () { return new Date(); } };
