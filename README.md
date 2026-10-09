# EZ Way Houses inbox agent (Google Apps Script)

An inbox agent for a company that buys, renovates, sells and rents houses around Tampa. It reads new email in one
Gmail account, works out what each message is about, matches it to the listing, lead, contact or transaction it
belongs to, writes what changed in Google Sheets, and leaves a reply in Gmail **as a draft**. It never sends.

Live demo of the five sample cases: https://theaipipe.com/demos/ezway-inbox/

## What has been tested

| Part | Status |
|---|---|
| Matching and sheet writes | **Run**: 30 automated tests (`npm test`) with an in-memory Gmail and Sheets; the demo page is generated from this same run |
| Resume after a stop, duplicates | **Tested with simulated failures**: stop after the draft, person sends the draft, two overlapping runs |
| Reading emails and wording replies | **Recorded outputs** (`fixtures/model_outputs.json`), prepared with Claude for the demo |
| Gmail and Sheets calls (`src/Adapters.js`) | **Written, not yet run on a real account** |
| Gemini (`GeminiModel` in `src/Models.js`) | **Not run**: written from the Gemini Interactions API documentation read on 2026-10-09 |
| Installation at EZ Way Houses | **Not done** |

See `VERIFICATION.md` for how each item was checked.

## How a message is handled

One pipeline (`src/Pipeline.js`) for every run. Two model adapters share the same two methods, `extract()` and
`draft()`: `FixtureModel` returns recorded outputs (tests and demo), `GeminiModel` calls the API. Matching, decisions,
validation and sheet writes are the same code in both cases.

1. **Journal check.** The `Journal` tab is keyed by mailbox + Gmail message id. A finished message is skipped. The Gmail
   label `EZ/processed` is only there for people; progress is never read from it, so a new message in an old thread
   is still handled.
2. **Extraction.** The model returns JSON in a closed schema (category, language, addresses as written, financing,
   budget, area, contract change with the quoted sentence). Unknown fields are dropped. An uncertain result goes to
   the `Review` tab with the label `EZ/needs review`.
3. **Resolution, in this order:** contact (same sender address), then the property's lead or transaction, then a new
   interaction. Address matching keeps the house number, street name, direction, unit and city: "8303 Bahia" is linked
   when exactly one record fits; "the house on 82nd" fits two listings and is sent to a person.
4. **Decision, by the code.** Status (for example *Existing lead found*, *Financing mismatch*, *Change needs review*)
   and one allowed next action. A buyer whose financing is not among the listing's announced terms is offered other
   listings only when the email gives a budget and an area; otherwise the reply asks for them. An under-contract
   house gets "the team will confirm" unless the listing row allows backup offers.
5. **Sheet writes, from a closed list.** New contact, lead, interaction; `last_contact` dates. A proposed closing date,
   price or term is added to `Review` with the current value kept in place. The model never picks a sheet, a range or a
   field. Text from email is written as a literal: `=IMPORTXML(...)` stays text.
6. **Draft.** The model writes a template with slots (`{{price}}`, `{{rent}}`, `{{deposit}}`, `{{address}}`, ...).
   The code fills them from a typed facts object (listing id, source URL, capture date, price, rent, deposit, announced
   financing, status). The result is checked again: every amount and street address must exist in the matched record,
   rent and deposit cannot be swapped, no email address, no phone other than the office line, no link outside an
   allow list, no "approved", "eligible" or "accepted" claim. A draft that fails is held for review.
7. **Gmail.** `createDraftReply` on the original message: same thread, addressed to the sender. The repository contains
   no send call (a test checks it). After a stop between "draft requested" and "draft recorded", the next run adopts
   the draft already in the thread, or sees that a person already sent a reply, instead of making a second one.

Runs are bounded: at most `MAX_PER_RUN` messages (default 10) and about four minutes per run, a script lock against
overlapping runs, and failures written to the journal; after three failed attempts a message goes to review.

## Install (pilot on one mailbox)

The script runs as the Gmail account that authorizes it. Start with the one mailbox that receives these emails.
Rolling it out to more of the team depends on which inboxes actually receive them and who owns the spreadsheets;
several independent copies do not coordinate with each other.

1. Create a spreadsheet with the tabs `Listings`, `Contacts`, `Leads`, `Interactions`, `Transactions`, `Review`,
   `Journal`. Header rows are in `data/sample/operations.json` (`headers`). `Listings` can start from
   `data/listings_snapshot.json`.
2. Create an Apps Script project from that account and copy the files in `src/` (or `clasp push`).
3. In Project Settings > Script properties, set:
   - `SPREADSHEET_ID`
   - `GEMINI_API_KEY`: for real email, use a key from a billed Google Cloud project of the company, or move the adapter
     to Vertex AI.
   - `GEMINI_MODEL` (optional): defaults to `gemini-3.8-flash`, a starting point to evaluate on representative messages
     for speed and cost; `gemini-3.1-pro-preview` is the option to compare, and it is still a preview model.
   - `MAX_PER_RUN` (optional).
   Script properties are readable by anyone with edit access to the project.
4. Run `processInbox` once by hand: Apps Script asks the account owner to approve Gmail, Sheets and external requests.
   Apps Script handles much of the authorization; the settings above are the account-specific part.
5. Run `installTrigger` to check the inbox every 10 minutes. The trigger is periodic, not instant.

## Data in this repository

- `data/listings_snapshot.json`: the public listings on ezwayhouses.com as read on 2026-10-09 (13 for sale, 3 under
  contract, 5 for rent), each with its source URL. On the live site the listings stay on the website; for the demo
  they were loaded into a sheet.
- `data/sample/operations.json`: **fictional** contacts, leads, interactions and transactions.
- `fixtures/emails.json`: sample emails (fictional senders) for the five demo cases and the test cases (spam,
  contractor, investor, ambiguous address, hostile instructions, formula injection, two houses from one seller,
  under contract, FHA without budget, new message in an old thread).

## Layout

```
src/Core.js        address matching, facts, slot filling, draft checks (pure)
src/Pipeline.js    extraction cleanup, decisions, sheet writes, journal, batch runs
src/Models.js      FixtureModel and GeminiModel
src/Adapters.js    Gmail (read, draft reply, label) and Sheets, Apps Script only
src/Main.js        settings, processInbox, installTrigger
test/              in-memory Gmail/Sheets and the test suite
tools/             builds the demo page data from a pipeline run
site/              the demo page
```

`npm test` runs the suite; `npm run build` regenerates `site/data.js` (a test checks it is identical).

Built by The AI Pipe (https://theaipipe.com).
