// Runs the real pipeline on the five sample emails (fixture model, in-memory Gmail and Sheets) and writes
// site/data.js. Nothing on the page is typed by hand: statuses, matches, row changes and drafts come from here.
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWorld, readJson, ROOT } = require('../test/harness');

const PHOTOS = { 'EZ-5000': 'img/5000.jpg', 'EZ-5009': 'img/5009.jpg', 'EZ-4828': 'img/4828.jpg', 'EZ-4961': 'img/4961.jpg' };
// fields shown for a new row; for an updated row, every field that changed is shown
const SHOWN_ADDED = {
  Contacts: ['name', 'role', 'language'],
  Leads: ['kind', 'property_address', 'stage'],
  Interactions: ['lead_id', 'summary'],
  Review: ['ref', 'field', 'current_value', 'proposed_value']
};

function build() {
  const emails = readJson('fixtures/emails.json').visible;
  const snap = readJson('data/listings_snapshot.json');
  const { G, deps } = makeWorld(emails);
  const cases = emails.map((msg) => {
    const r = deps && G.processMessage(msg, deps);
    const plan = r.plan;
    const l = plan.listing;
    const changes = r.applied.filter((a) => a.kind !== 'unchanged' || a.tab !== 'Contacts').map((a) => {
      const rows = a.kind === 'added'
        ? (SHOWN_ADDED[a.tab] || []).filter((f) => a.after[f] !== '' && a.after[f] !== undefined).map((f) => ({ field: f, before: null, after: String(a.after[f]) }))
        : Object.keys(a.after).filter((f) => String(a.before[f]) !== String(a.after[f])).map((f) => ({ field: f, before: String(a.before[f]), after: String(a.after[f]) }));
      return { tab: a.tab, id: a.id, kind: a.kind, rows };
    }).filter((c) => c.rows.length);
    // the extra slot values the code inserted, so the page can mark them in the draft
    const f = plan.facts;
    const inserted = [f.address, f.city, f.price && '$' + f.price.toLocaleString('en-US'), f.rent && '$' + f.rent.toLocaleString('en-US'), f.deposit && '$' + f.deposit.toLocaleString('en-US'), f.seller_property, f.current_value, f.proposed_value]
      .concat((f.alternatives || []).flatMap((a) => [a.address, '$' + a.price.toLocaleString('en-US')]))
      .concat(f.financing_listed ? [G.FINANCING_WORDS[f.financing_listed][r.extraction.language]] : [])
      .filter(Boolean);
    return {
      id: msg.id, time: msg.time, from: msg.from.replace(/\s*<.*$/, ''), email: msg.from.match(/<([^>]+)>/)[1], subject: msg.subject,
      body: msg.body, attachments: msg.attachments || [], threadNote: msg.threadNote || null,
      status: r.status, tone: plan.statusTone,
      extraction: r.extraction,
      mentions: r.extraction.property_mentions.concat(r.extraction.seller_property ? [r.extraction.seller_property] : []),
      trace: plan.trace,
      listing: l ? { id: l.listing_id, address: l.address, city: l.city, zip: l.zip, status: l.status, type: l.type, financing: l.financing_listed, price: l.price, rent: l.rent, deposit: l.deposit, beds: l.beds, baths: l.baths, section8: l.section8_welcome, url: l.source_url, captured: l.captured_at, photo: PHOTOS[l.listing_id] || null } : null,
      alternatives: f.alternatives || [],
      changes,
      draft: r.draft ? { to: r.draft.to, subject: r.draft.subject, text: r.draft.text, problems: r.draft.problems, inserted, language: r.extraction.language } : null
    };
  });
  return { snapshot: { date: snap.captured_at, count: snap.listings.length, forSale: snap.listings.filter((x) => x.status === 'FOR SALE').length, underContract: snap.listings.filter((x) => x.status === 'UNDER CONTRACT').length, forRent: snap.listings.filter((x) => x.status === 'FOR RENT').length }, cases };
}

function render() { return 'window.EZ = ' + JSON.stringify(build(), null, 1) + ';\n'; }

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'site', 'data.js'), render());
  console.log('site/data.js written');
}
module.exports = { render };
