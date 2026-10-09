# EZ Way Houses inbox agent (Google Apps Script)

An inbox agent for a company that buys, renovates, sells and rents houses around Tampa. It reads new email in one
Gmail account, works out what each message is about, matches it to the listing, lead, contact or transaction it
belongs to, writes what changed in Google Sheets, and leaves a reply in Gmail **as a draft**. The code never sends.

Live demo of the five sample cases: https://theaipipe.com/demos/ezway-inbox/

## What has been tested

| Part | Status |
|---|---|
| Matching, decisions, sheet writes, draft checks | **Run**: 58 automated tests (`npm test`, also on every push) with an in-memory Gmail and Sheets; the demo page is generated from this same pipeline |
| Retries, duplicates, sender identity, aliases | **Tested with simulated failures**: stop after the draft, failure before the draft, model failure after the sheet writes, retries outside the search window, overlapping runs, From vs Reply-To, owner aliases |
| Reading emails and wording replies | **Recorded outputs** (`fixtures/model_outputs.json`), prepared with Claude for the demo |
| Gmail and Sheets calls (`src/Adapters.js`) | **Written, not yet run on a real account** (see "Before a pilot") |
| Gemini (`GeminiModel` in `src/Models.js`) | **Not run**: written from the Gemini Interactions API documentation read on 2026-10-09 |
| Installation at EZ Way Houses | **Not done** |

See `VERIFICATION.md` for how each item was checked.

## How a message is handled

One pipeline (`src/Pipeline.js`) for every run. Two model adapters share the same two methods, `extract()` and
`draft()`: `FixtureModel` returns recorded outputs (tests and demo), `GeminiModel` calls the API. Identity, matching,
decisions, checks and sheet writes are the same code in both cases.

1. **Which messages.** Each run first retries, by Gmail message id, the messages the journal lists as unfinished,
   whatever their age or folder. It then searches new mail received after the later of `INSTALLED_AT` (recorded when
   the trigger is installed) and a three-day look-back; older messages in a recent thread are not picked up. The
   search is paged, and finished messages are removed before the batch is cut, so new mail is not stuck behind old
   mail. Messages from the mailbox owner or any send-as alias are not treated as incoming. In a thread, only the
   latest incoming message gets a draft; earlier ones are logged without one.
2. **Sender identity.** The address between `< >` in From is the identity used to read private records; the display
   name is never searched for an address. A header with several addresses, a malformed address or an address inside
   the display name goes to `Review` with no lookup and no draft. If Reply-To differs from From (web forms do this),
   the message is not attached to any existing contact, lead or transaction, the reply uses public listing facts
   only, and the item is marked "Sender identity unclear". The recipient shown is the Reply-To, which is where
   `createDraftReply()` addresses the draft.
3. **Extraction.** The model returns JSON in a closed schema. Unknown fields are dropped; dates are stored as
   `YYYY-MM-DD`. An uncertain result goes to `Review`.
4. **Provenance.** Every extracted address, budget and proposed change is checked against the email: the quoted
   sentence must be in the body word for word, and the normalized value must follow from it (for "from October 23 to
   November 6", the proposed date must be November 6). If not, the disagreement is written in a `Review` row and the
   reply is a plain acknowledgement that does not repeat the value.
5. **Plan, saved before any write.** Resolution, in this order: contact (canonical sender), then the property's lead
   or transaction, then a new interaction. Address matching keeps house number, street name, street type, direction,
   unit and city ("82nd Ave" is the one avenue; "the house on 82nd" fits two listings and goes to a person). A seller
   lead without an address stays tied to its thread: a follow-up in the same thread that gives the address fills it in.
   A transaction is used only when it is the only open one for the property and the sender is its recorded agent;
   otherwise `Review` and an acknowledgement without any transaction value. The plan (extraction, facts, operations)
   is written to the `Journal` tab before its first effect; a retry replays it without asking the model again. Every
   append carries a stable operation id (mailbox + message + operation), so a replay writes nothing twice.
6. **Sheet writes, from a closed list.** New contact, lead, interaction; `last_contact` dates; the address of a lead
   that had none. A proposed closing date, price or term is added to `Review` with the current value kept in place.
   The model never picks a sheet, a range or a field. Text from email is written as a literal: `=IMPORTXML(...)` stays
   text.
7. **Draft.** The code writes the facts as complete sentences ("clauses"): each amount with its role and period, the
   full property identity, the financing as published, an amendment as "from the recorded date to the date quoted in
   the email". The model only places the clauses allowed for the next action and writes the words in between. Its own
   words may not contain a digit, a number in words, a date, a month or a day, an amount or a money word, a rent period,
   a street or city name, a financing term, an email address or a link, or words such as approved, eligible, qualify
   or accepted (and their Spanish forms). A draft that fails goes to `Review`. This check is a guard, not a proof: a
   person reads every draft before sending it.
8. **Gmail.** Right before drafting (first pass and retries) the thread is checked again: if the owner or an alias
   replied after the message, no draft is made. If the script finds its own unsent draft in the thread, it does not
   create another. After a stop during draft creation, the next run adopts the draft if it exists, accepts a reply sent
   by the owner strictly after the message, and otherwise sends the message to a person.

Runs are bounded: at most `MAX_PER_RUN` messages (default 10) and about four minutes per run, a script lock against
overlapping runs, pending sheet writes flushed (`SpreadsheetApp.flush()`) before the lock is released on every path,
and failures written to the journal; after three failed attempts a message goes to review.

## What the program does not do

- **It does not send.** There is no send, reply or forward call in the repository (a test checks it). The
  permission is broader than the program: `createDraftReply()` requires the `https://mail.google.com/` scope, which
  would allow sending. The guarantee is about what this code does, not about what the authorization permits.
- **It does not refresh listings.** The `Listings` tab is read, not updated from the website. The repository's
  snapshot is dated 2026-10-09. A pilot needs someone in charge of keeping that tab current (prices, availability,
  terms).
- **It does not read attachments.** Only the plain-text body is read, cut at 8,000 characters (`BODY_MAX_CHARS` in
  `src/Adapters.js`). In the amendment example the change is written in the email itself; the PDF is not opened.

## Install (pilot on one mailbox)

The script runs as the Gmail account that authorizes it. Start with the one mailbox that receives these emails.
Rolling it out to more of the team depends on which inboxes actually receive them and who owns the spreadsheets;
several independent copies do not coordinate with each other.

1. Create a spreadsheet with the tabs `Listings`, `Contacts`, `Leads`, `Interactions`, `Transactions`, `Review`,
   `Journal`. Header rows are in `data/sample/operations.json` (`headers`). `Listings` can start from
   `data/listings_snapshot.json`.
2. Create an Apps Script project from the mailbox account and copy the files in `src/` (or `clasp push`).
3. In Project Settings > Script properties, set:
   - `SPREADSHEET_ID`
   - `GEMINI_API_KEY`: for real email, use a key from a billed Google Cloud project of the company, or move the adapter
     to Vertex AI.
   - `GEMINI_MODEL` (optional): defaults to `gemini-3.8-flash`, a starting point to evaluate on representative messages
     for speed and cost; `gemini-3.1-pro-preview` is the option to compare, and it is still a preview model.
   - `MAX_PER_RUN` (optional).
   Script properties are readable by anyone with edit access to the project.
4. Run `installTrigger` from the editor. Apps Script asks the account owner to approve Gmail, Sheets and external
   requests; it handles much of the authorization, and the settings above are the account-specific part. The function
   records `INSTALLED_AT` (nothing received before it is processed) and checks the inbox every 10 minutes. The trigger
   is periodic, not instant.

## Before a pilot

To be run on a test mailbox with synthetic messages before any real inbox. None of these has been done for the demo.

| Trial | Status |
|---|---|
| From and Reply-To different (web form notifications) | not done |
| Replies sent from a send-as alias | not done |
| A thread already answered by a person | not done |
| Recovery after failures (model error, stop during draft creation, Sheets error) | not done |
| Gmail search paging and the `after:` filter on a mailbox with more than 50 threads | not done |
| Gemini extraction and wording on representative messages | not done |

## Data in this repository

- `data/listings_snapshot.json`: the public listings on ezwayhouses.com as read on 2026-10-09 (13 for sale, 3 under
  contract, 5 for rent), each with its source URL. The live listings stay on the website; for the demo they were
  loaded into a sheet.
- `data/sample/operations.json`: **fictional** contacts, leads, interactions and transactions.
- `fixtures/emails.json`: sample emails (fictional senders) for the five demo cases and the test cases.

## Layout

```
src/Core.js        sender identity, address matching, provenance checks, facts, clauses, draft checks (pure)
src/Pipeline.js    extraction cleanup, decisions, saved plans, sheet writes, journal, batch runs
src/Models.js      FixtureModel and GeminiModel
src/Adapters.js    Gmail (read, fetch, draft reply, label) and Sheets, Apps Script only
src/Main.js        settings, processInbox, installTrigger
test/              in-memory Gmail/Sheets and the test suite
tools/             builds the demo page data from a pipeline run
site/              the demo page
```

`npm test` runs the suite; `npm run build` regenerates `site/data.js` (a test checks it is identical).

Built by The AI Pipe (https://theaipipe.com).
