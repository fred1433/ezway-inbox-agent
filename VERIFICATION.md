# Verification log

| Date | What | How | Result |
|---|---|---|---|
| 2026-10-09 | Listing snapshot | Read every listing page on ezwayhouses.com (home page, For Rent, Land and Lots, county pages for the 3 under-contract homes) with a headless browser; parsed address, status, price, rent, deposit, financing, beds, baths, "Section 8 Welcome" | 21 listings: 13 for sale, 3 under contract (4415 Booker T Dr, 8711 River Forest Cir, 110 Virginia Ave), 5 for rent; 7705 Coral Vine Ln says "Section 8 Welcome!", rent $1,695, deposit $1,695 |
| 2026-10-09 | Gemini request format | Read ai.google.dev: models page and Interactions API (POST v1beta/interactions, x-goog-api-key, response_format with JSON schema, text in steps[].content[]) | Adapter written to that contract; not run |
| 2026-10-09 | Model ids | Read the models page | gemini-3.8-flash listed as stable, gemini-3.1-pro-preview as preview |
| 2026-10-09 | Pipeline, matching, sheet writes, drafts | `npm test`, in-memory Gmail and Sheets, fixture model | 38/38 pass (see `test/last_run.txt`) |
| 2026-10-09 | Journal and resume | Tests 1 to 7 in the journal group: replay, new message in old thread, stop after draft, uncertain result, edited draft, sent draft, overlapping runs | Pass |
| 2026-10-09 | Demo page = pipeline output | Test "site/data.js regenerates identically" | Pass |
| 2026-10-09 | Points from a fresh review that ran the code | Tests added: fresh install with an old message in a recent thread, one draft per thread, waiting draft kept, 30 finished messages ahead of a new one, model failure then rerun (one lead), seller without address, draft check on amounts without $, dates, percentages, lowercase addresses, qualify/aceptamos, "82nd Ave" | Pass |
| not done | Gmail and Sheets adapters on a real account | | Not run |
| not done | Gemini adapter against the API | | Not run |
| not done | Installation at EZ Way Houses | | Not done |
