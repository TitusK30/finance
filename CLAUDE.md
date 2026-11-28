# Finance OS: notes for Claude

Read this first in every session. Keep it current: when a change alters the architecture, the file list, a convention or the settings model, update this file in the same commit.

## Where we left off
Update this section in every commit (generic wording, no personal data): the last thing built, the version tag, the test count, and anything unfinished or waiting for the user to confirm on the phone.
- Last built: credit score sheet: preset source buttons (`CREDIT_SCORE_SOURCES`: FICO, VantageScore, the three bureaus, Credit Karma, Chase Credit Journey, Capital One CreditWise), names from history added once (spelling and spaces ignored by `sameSourceName`), plus an optional "type another" box. Before that: Home credit score tile with gauge and hold to log.
- Version tag 20261128zm, 158 tests passing.
- Waiting on the user to confirm on the phone: score sheet buttons; change triangles from tomorrow; Coming up; Customize Home.

## What it is
A private cash-flow forecaster, a "weather forecast for a bank account". Plain HTML and JS, no frameworks, no build step, $0 a month. Runs as an iPhone Home Screen web app. All numbers live in the phone's localStorage; the repo is code only. A Cloudflare Worker (`relay/worker.mjs`) holds the Plaid keys. The live app is served by GitHub Pages from `main`.

## Setup docs (keep them in step with the app)
- `README.md`: the full breakdown: how the pieces fit, the Cloudflare relay values and secrets, the three addresses (app, relay, GitHub), the app key, Plaid linking, what a refresh does, security, troubleshooting, updating a copy, sharing with a partner, and the file list.
- `guide.html`: the step-by-step set-up guide for a new user (served at titusk30.github.io/finance/guide.html); it asks for the person's own details and walks through relay, Plaid and the app. `preview.html`: animated sample-data preview.
- When a feature or setup step changes, update the README and guide.html in the same commit. Friends never use the owner's live app or relay; each person runs their own copy with their own relay.

## Rules that never change
- The public repo must contain no personal names, employers, cities, account names, amounts or card numbers. Examples in the UI and docs use generic text.
- Never put keys or secrets in chat, code or GitHub. Secrets live only in Cloudflare's Secrets box.
- Never full card numbers or CVV in the app. Never add a paid service without asking.
- Code style: minimal, surgical changes; simple human-readable code; very descriptive variable names.
- UI style: keep the same information when restyling; swipe-to-delete only on lists (no visible remove buttons); show a toast when a button does something; everything configurable in the app's Set up page.
- **Set up happens in the app, not in a JSON file.** The Set up page (and its guided wizard) is the main path for every user; the settings file is an optional extra, collapsed in the README and never required. Any new setting must be editable in the app. Don't add features that only work by hand-editing JSON (the few file-only items, like skipped loan months, are leftovers to move into the app when touched). The README's main path stays "Set up in the app", plus its "Sharing with a partner" section.
- Finance advice: say you are not a financial advisor.

## Publishing every change
1. Edit the files, then `node --check src/*.js`.
2. Run the tests (see below), all must pass before pushing.
3. Personal-data scan (must print nothing; the repo handle `titusk30` and `currentTarget` are fine): `grep -rniE "<private word list kept in the project instructions>" index.html README.md src relay guide.html preview.html finance_settings.example.json`
4. Bump the version tag in `index.html` (scripts and CSS load as `src/x.js?v=TAG`). Without a new tag the phone keeps old files. Check with `grep -o "v=20[0-9a-z]*" index.html | sort | uniq -c` that every line shows the new tag.
5. Commit with `git -c user.name="Claude" -c user.email="noreply@anthropic.com"` and end the message with the attribution trailers the session gives, then `git push -q origin HEAD:main`.
6. Tell the user to tap Update app, then fully close and reopen.
Never `git commit --amend` to undo something: use `git revert --no-edit <hash>` (it does not accept `-q`).

## Tests
Node's built-in runner, CommonJS, files in `test/*.test.js` plus a fixture. They are kept private (they hold real-shaped data), so they are not in this repo. If `test/` is missing, restore it from the private bundle in the project files. Run: copy `src/*.js` next to the tests' `../src`, then `node --test test/*.test.js`. Pure modules end with `if (typeof module !== "undefined") module.exports = {...}`.

## Architecture
Classic `<script>` globals, loaded in this order: lock, forecast, summaries, spending, spending-tools, plaid-sync, loan, bills, spending-page, spending-extras, tracking, tracking-pages, extra-pages, loans-page, gestures, setup-page, app. Top-level names are shared, so check for name clashes before adding one (`grep -nE "(function|const|let|var) name\b" src/*.js`).
- **forecast.js**: day-by-day checking forecast (`buildForecast`, `isPaydayOn` is the single source of truth for payday, card due dates, bills, subscriptions, optional weekly everyday-spending event).
- **summaries.js**: statements, card utilization (`cardUtilizationPlan`, `cardChargesBetween`), net worth, bills/expense items for the Bills tab (`monthlyItemsForTab`), overtime.
- **spending.js**: transaction merge, categories (`categoryOf`, `setMerchantRules`, per-charge overrides), pending math, transfers, earned, `monthlyBreakdown`, `monthComparison`.
- **spending-tools.js**: pure search/filter (`filterCharges`), `dailyPace`, `budgetRows`, merchant rules from one charge, recurring-charge detector.
- **bills.js**: `matchBills` links bank charges to bills/subscriptions by account, text words and a 5-day window (amount only breaks ties). Output per month: `seen`, `unseen`, `upcoming`, `neverCharged`.
- **plaid-sync.js**: turns relay data into settings. **loan.js**: loan math, several loans (`loansOf`, `loanFromInputs`, `loanStatus`, `loanPayoffPlan`, `loanPaymentCheck` matches payments to checking charges, `loanOverview`).
- **Pages**: spending-page.js (Spending tab), spending-extras.js (search/filter bar, pace, vs last month, budget cards and budget sheet, recurring tile, merchant-rule prompt), tracking-pages.js (goals, planner, credit score, `askChoice` bottom-sheet chooser), extra-pages.js (Bills tab with filter and hold-to-edit, Cards/credit page, rewards, HSA, PTO), loans-page.js (Loans tab: chips, All overview, add/edit sheet), setup-page.js (Set up + guided wizard, hold-to-edit sheets), app.js (storage, refresh, settings tab, toasts, cards page close dates), gestures.js (swipe-to-delete, edge-swipe menu, long-press to edit, swipe-down to close sheets), lock.js (PIN).
- **Swipe-to-delete**: gestures.js `DELETE_CONTROLS` lists each list's remove control; the row keeps that control but CSS hides it, and the swipe's Delete presses it (so confirms and toasts still run). A new list needs its control added to `DELETE_CONTROLS` and hidden in style.css. Never give a swipe row an animation with fill-mode `both`/`forwards` that sets `transform`: it overrides the swipe's inline transform (use `backwards`).
- **Hold-to-edit**: gestures.js long-press covers Spending charges (`data-charge-id`), Bills items (`data-bill-source`) card benefits on the Cards tab (`data-setup-hold="benefit:N"`, same `editSetupItem`), budget cards (`data-budget-hold`, opens `openBudgetSheet` in spending-extras.js), tasks, goals, expected money, HSA items, PTO buckets, points tiles and the Home credit score (`data-item-hold="todo|goal|expected|hsa|pto|otherpoints:position"`, `"points:cardKey"` or `"score:latest"`, handled by `editTrackedItem` in tracking-pages.js) and Set up rows (`data-setup-hold="kind:key"`, handled by `editSetupItem` in setup-page.js; kinds: card, bill, sub, override, rule, othercard, benefit). `openSetupItemSheet` is the shared edit sheet (fields, Save, Cancel; optional `icon`/`accent` badge, `saveLabel`, field `placeholder`, `chips` fields). Use it for every new add or edit pop-up instead of `prompt()`. A new Set up list gets a `data-setup-hold` and an entry in `editSetupItem`.
- **Bottom sheets**: elements with class `date-cover category-picker`; closing = clicking the dimmed background, which every sheet treats as cancel.
- **Home blocks**: each Home block is a `<div data-home-block="key">` in `#home-blocks`; `HOME_BLOCK_NAMES` in app.js lists them. A new Home block needs a wrapper there and an entry in `HOME_BLOCK_NAMES`.
- **Menu**: Home, Spending, Cards, Bills (with Subscriptions and Expenses), Tasks, Goals, Planner, HSA, PTO, Loans, Set up, Settings. Tab keys are unchanged internally (`car` is the Loans tab).

## Settings model
Stored on the phone, never in git. See `finance_settings.example.json` (fake data) and the README table. Key parts: `minimum_checking_floor`, `paycheck`, `credit_cards`, `card_masks`, `monthly_bills_paid_from_checking`, `subscriptions_charged_to_cards` (optional `charge_text_contains`), `loans` (older single `car_loan` still reads as the first loan; saving moves it to `loans`), `merchant_rules`, `transaction_categories` (per-charge overrides), `category_budgets`, `transfers_ignore_text`, `hidden_tabs`, `home_layout`, `other_points`, `rewards[card].hidden`, `pto.buckets` (`ptoBucketsOf` in extra-pages.js reads older `pto_hours`/`comp_time_hours`/`holiday_hours`; the PTO page migrates them on first show). Bank refresh fills balances, statements and masks. Typed data is never wiped by loading a settings file; add new keys to the preserved list in `app.js` (the file-import handler) and do not put them in the defaults object if an older stored value must still be read.
Browser-only extras: Bills filter, bill marks, dismissed recurring suggestions, whether the Home Left to spend tile is open, daily balance snapshots for the Home change triangles (localStorage). The Spending filter is memory-only on purpose.

## Behaviors worth remembering
- Bills: monthly items match charges by account/text/date, never by amount. A new subscription is not flagged missing before its first charge. Unpaid items past their day show a warning; items never charged after month end go to "Never charged (not counted)". Hold a Bills item to edit name, amount, day and card.
- Cards: a closed statement stays until the bank shows it paid (the card's own statement is the trusted signal). The open statement's close date moves to next month once the bank shows that statement issued. Subscriptions and fees due before close (`cardUtilizationPlan().comingCharges`) show as a small purple collapsible line (`expectedChargesHtml` in extra-pages.js), never added to Open.
- Loans: with `payment_text_contains` set, a due date counts as paid only if a checking charge with all those words posts 5 days before to 10 days after it; recent ones wait; older than the app's bank history are assumed paid. Without it, every due date is assumed paid.
- Spending: transfers are excluded from spending lists; bills are split from everything else. `isMoneyMovedNotSpent` (spending.js) drops card payments (`isCardPayment`: Plaid's CREDIT_CARD_PAYMENT detail or issuer payment text) and savings moves (`isSavingsMove`: words from `transfers_ignore_text`, set with `setSavingsAccountWords` next to `setMerchantRules`) from spending, pending, transfers and earned. `savingsMovesInMonth` feeds the Savings block (bank side only; the savings account's own copy, by `account_masks.savings`, is skipped).

## Known caveats
Phone data is separate per phone and per browser. Plaid Trial allows about 10 linked logins. Some card balances lag a day. Old git history holds a few early commits with example text that was later made generic; history was not rewritten.
