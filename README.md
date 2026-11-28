# Finance OS

### 👉 **Want to set it up? Follow the step-by-step guide: [titusk30.github.io/finance/guide.html](https://titusk30.github.io/finance/guide.html)**

A private cash-flow forecaster for your iPhone: a weather forecast for your bank account. It predicts your checking balance day by day for the next 40 days, warns you before it would drop below the floor you set (and tells you when to move money from savings), tracks each card's closed and open statements and due dates, and shows where your spending goes. Optionally it pulls live balances from your banks.

- Plain HTML and JavaScript. No frameworks, no build step, no server you pay for.
- Your numbers live **only on your phone**. The public code contains none of them.
- $0/month at personal scale (see [Limits and costs](#limits-and-costs)).

**See it in action:** [animated preview with sample data](https://titusk30.github.io/finance/preview.html)

> Not financial advice. Not affiliated with Plaid, Cloudflare, GitHub or any bank.

This page is the reference: what each piece is, what each value means, and how the app works. The guide has the steps.

---

## How the pieces fit

```
iPhone app (GitHub Pages)  --app key-->  Relay (Cloudflare Worker)  -->  Plaid  -->  your banks
   your numbers stay here                holds Plaid keys + bank links      read-only
```

| Piece | What it is | Cost |
|---|---|---|
| **App** | Your own copy of this repo, published as a website on GitHub Pages and added to your Home Screen | Free |
| **Relay** | A tiny Cloudflare Worker that talks to Plaid for you, so Plaid's keys never sit on your phone or in GitHub | Free |
| **Plaid** | The service that reads your bank balances and transactions (read-only) | Free Trial plan |

The bank link is optional. Without it you type your balances in and everything else works.

The relay returns balances and transactions only. It never returns a bank token and cannot move money.

---

## The values you will meet

### Cloudflare relay values

Set in the Worker under **Settings → Variables and Secrets**.

| Name | Type | What it is |
|---|---|---|
| `PLAID_CLIENT_ID` | Secret | Your Plaid client ID. 24 characters. |
| `PLAID_SECRET` | Secret | Your Plaid secret for the environment you chose. 30 characters. |
| `APP_KEY` | Secret | A long random password you make. It is the only thing that lets your phone, and the bank-link page, talk to the relay. |
| `PLAID_ENV` | Plain text | `production` for real banks. Anything else (use `sandbox`) means Plaid's fake test banks. |
| `ALLOWED_ORIGIN` | Plain text | Your app's website, like `https://yourname.github.io`: no path, no trailing slash. The relay only answers browser requests from this site. |
| `TOKENS` | KV binding | Where the relay keeps your bank links. The variable name must be exactly `TOKENS`. |

Rules that save time:
- A **Secret** hides its value after saving. To change one later, use **Rotate**.
- The Plaid secret must match `PLAID_ENV`. A Production secret with `sandbox` (or the reverse) gives `INVALID_API_KEYS` even when typed correctly.
- Type or paste values with no spaces before or after.
- Use **Deploy** after any change. A greyed-out Deploy means nothing changed.
- The relay's browser address (`https://<name>.<you>.workers.dev`) is your **relay address**. With the key set, opening it shows `{"error":"no"}`: it is running and locked.

### The three addresses

| Address | Looks like | Used for |
|---|---|---|
| App address | `https://yourname.github.io/finance/` | Opening the app, adding it to the Home Screen |
| Relay address | `https://finance-relay.yourname.workers.dev` | Settings → Connect to relay, and Plaid's redirect list |
| Bank link page | relay address + `/link` | Linking banks (open in Safari, not the Home Screen app) |

Plaid's **Allowed redirect URIs** list needs the bank link page address exactly: HTTPS, no query string. Banks that use OAuth (Chase is one) need it.

### The app key

- You make it once (the app can generate one: Settings → Connect to relay, leave the key empty).
- It lives in three places only: Cloudflare's `APP_KEY` secret, your password manager, and the browser storage of each phone you connect.
- It is the only thing between the internet and your balances. If it ever shows up in a chat or screenshot, change `APP_KEY` in Cloudflare and re-enter it on your phones.
- Check the relay's secrets without revealing them: a `GET` to `/diag` with the header `x-finance-key: <app key>` returns only lengths (client ID 24, secret 30) and flags stray spaces.

### Plaid

- **Environments:** Sandbox gives fake banks to practise with (test login `user_good` / `pass_good`). Production is real banks and may need a short application with Plaid first.
- **Products used:** Balance, Transactions, Liabilities and Investments.
- **Link types:** *Bank* (checking, savings, credit cards) and *Retirement / investments* (401(k), IRA).
- **Slots:** each linked login uses one Plaid "Item". The Trial plan allows about 10, and removing one does **not** give the slot back. Link only what you will use.
- **Bank quirks:** some banks ask for an **app-specific password** made in their security settings; your normal password is rejected. Some banks label a cash account "checking". HSA providers may not be supported (keep that balance typed in). Capital One card balances can be a day behind and show no pending charges.
- **`ADDITIONAL_CONSENT_REQUIRED`:** Plaid wants extra approval for some data on that login. Balances may still work; if numbers go stale, re-approve that login with Plaid.

---

## What a refresh does

Tap **↻** (or open the app after 30 minutes away).

| Item | Source |
|---|---|
| Checking | Available balance, as of today |
| Savings | A savings, cash management or money market account. If your bank calls it "checking", the manual refresh asks once which account is your savings and remembers it. Otherwise stays as typed |
| Each card | Balance, limit, **Closed** and **Open** amounts, due dates |
| Retirement and HSA | Linked investment and HSA accounts |
| Net worth | Recalculated from your accounts |
| Transactions | Saved on the phone, used by the Spending page |

- **Automatic:** on opening or returning to the app, it refreshes quietly if the last refresh was over 30 minutes ago. It never shows errors and keeps your old numbers if it cannot connect.
- **Manual (↻):** shows progress and errors, and asks which account is which if it cannot tell. Your answer is remembered by the account's last 4 digits.
- **Undo last refresh** is in Settings. A web app cannot refresh while closed; that is an iPhone limit.
- **Settings → Show linked accounts** lists what each bank sent (name, type, subtype, last 4 digits), which helps when an account does not land where you expect.
- Everything else (the forecast, chart, card countdowns, Cards, Goals) is calculated from those numbers, so it all updates together.
- **Pull down** on Home also refreshes.

---

## What is in the app

Menu: **Home**, **Spending**, **Cards**, **Bills**, **Tasks**, **Goals**, **Planner**, **HSA**, **PTO**, **Loans**, **Set up**, **Settings**. Open it with the top-left button or a swipe from the left edge. Tabs you do not use can be hidden in Set up.

| Page | What it gives you |
|---|---|
| **Home** | Left to spend this month (needs a bank link), checking, savings, retirement and net worth, your credit score (tap the number to log a new one), a "move money from savings" warning or "no transfer needed", a 40-day chart of your checking balance, each card's closed and open statements with due and close dates, and a 40-day timeline of paydays, bills and card payments |
| **Spending** | The month at a glance, then categories you can tap open, pending charges, bills and subscriptions, transfers, and top places. Browse earlier months with the arrows (needs a bank link) |
| **Cards** | Each card's utilization plan (how much you can spend before its statement closes to stay under your target), expiry and annual fee, your other cards, and rewards points and card benefits |
| **Bills** | Bills from checking and subscriptions on cards, with one monthly total |
| **Goals** | Savings goals with a finish-by-date planner |
| **Planner** | Overtime planner and a what-if simulator |
| **Tasks, HSA, PTO, Loans** | Dated to-dos, HSA and PTO numbers (the HSA page also takes money you expect to put in or pay out on a date, and shows the balance after each), loan payoff |
| **Set up** | Every setting, in sections (Basics, Paycheck, Cards, Bills and more) |
| **Settings** | Load a settings file, export a backup, back up and restore spending history, update the app, refresh, connect to the relay, show linked accounts, undo the last refresh, PIN |

### How the numbers work

- **Forecast:** day by day from your checking balance, adding paydays and subtracting bills, subscriptions, card payments on their due dates, and annual fees. It looks about 60 days ahead for the transfer warning and shows 40 days on Home. Paydays follow your pay schedule: weekly, every two weeks, twice a month or monthly. An optional everyday spending number adds a weekly estimate for groceries and gas.
- **Closed** = last statement balance minus payments since it was issued. **Open** = current balance minus the unpaid closed amount, plus pending charges. Open is an estimate; banks do not report it.
- **Pending charges** show in a card's Open amount (so the forecast and utilization include them). They are worked out from the bank's available credit, so it works even for banks that do not list pending items.
- **Spending** groups every charge by month and category. Card payments, transfers and paychecks are left out; refunds count against their category. Categories come from Plaid and are sometimes wrong, so add your own rules (Set up → Spending tab). Transactions live only on the phone and anything older than about 400 days is dropped.
- **Earned this month** adds deposits to your bank accounts that the bank calls income or that mention payroll or direct deposit. If your pay is not picked up, add a word from its description under **Set up → Paycheck**.
- **Bills are left out of Spending.** Bills and subscriptions are matched to charges by account, charge text and date (within 5 days of the due date), never by amount. If one slips through, tap **mark as bill** on it. If your bank writes a bill differently from its name, put the bank's wording in the bill's "text on the bank statement" box.
- **Goals:** "Finish by a date" shows the weekly amount to save. "Save a set amount" shows what savings would be by a date. "Money coming and going" lists known amounts; money in counts toward both results and money out lowers them. Goals never change Home.
- **Typed in by you:** savings (unless linked), rewards, benefits, loans, goals, credit scores, PTO, tasks.
- Swipe left on a task, goal or Set up row to reveal **Delete**.

---

## Sharing with a spouse or partner

Your partner can see the same accounts on their own phone without linking any bank again, so no extra Plaid slots are used. Give them three things:

| Give them | Where you find it |
|---|---|
| **The app address** | Your GitHub Pages address, like `https://yourname.github.io/finance/` |
| **The relay address** | Your Cloudflare Worker's `.workers.dev` address |
| **The app key** | Your password manager. Hand it over in person or through a password manager, never by text or email |

Then on their phone:

1. Open the app address in Safari and add it to the Home Screen.
2. **Settings → Connect to relay**: enter the relay address and the app key. The app tests the connection.
3. Bring your set-up across: on **your** phone use **Settings → Export backup**. This saves a JSON file. Send it to them privately (AirDrop or the Files app, not email).
4. On **their** phone use **Settings → Load settings file** and pick that file.
5. Tap **↻**. Their balances, statements and spending fill in from the same banks.

Bank-fed numbers (balances, statements, spending) match on both phones. Things typed in (tasks, goals, credit scores, PTO, edits) stay on the phone where you typed them, and a change to bills or cards on one phone has to be repeated on the other (or send a fresh backup). Only share the app key with someone you would hand your bank statements to.

---

## Prefer a settings file to the in-app Set up?

You never have to use the in-app Set up. If you would rather fill in one file on a computer and load it, you can:

1. Copy `finance_settings.example.json` to `finance_settings.json` and replace the fake values. It shows every field; leave out anything you don't use.
2. Send it to your phone privately (AirDrop or the Files app, not email).
3. In the app: **Settings → Load settings file**.

The same button loads a backup made with **Export backup**, which is how you move your set-up between phones. Loading a file only changes what it contains. It never wipes balances, statements, tasks, goals or tab choices already on the phone. Dates are `YYYY-MM-DD`; card expiry is `YYYY-MM`. Never commit `finance_settings.json` to GitHub; the included `.gitignore` leaves it out.

<details>
<summary><b>Every field the settings file can hold</b></summary>

| Key | What it is |
|---|---|
| `minimum_checking_floor` | Lowest checking balance you want to stay above |
| `paycheck` | `usual_take_home_amount`, `frequency` (`weekly`, `biweekly`, `semimonthly`, `monthly`), then `pay_weekday` (weekly or biweekly), `biweekly_start_date` (biweekly), `semimonthly_days` like `[1, 15]` (twice a month) or `month_day` (monthly). Optional: `one_time_amount_overrides` (`{"2026-12-25": 1650}`) and `deposit_text_contains` (words that mark your pay deposits) |
| `credit_cards` | Per card: `display_name`, `credit_limit`, `statement_close_day`, `payment_due_day`, `payment_due_in_following_month` |
| `card_expirations`, `annual_card_fees`, `other_cards`, `card_benefits`, `rewards`, `credit_utilization` | Card extras: expiry (`YYYY-MM`), yearly fee (card, amount, month, day), cards without a limit tracked, credits like a travel credit (`total`, `used`), points program name, target utilization percent |
| `monthly_bills_paid_from_checking`, `subscriptions_charged_to_cards` | Name, amount, `day_of_month` (subscriptions also name the `card`). Optional `charge_text_contains` words to match the bank's wording |
| `optional_monthly_variable_spending_allowance` | A monthly everyday-spending number for the forecast. `null` keeps it off |
| `merchant_rules`, `transfers_ignore_text` | Your own category rules (`text`, `category`) and words for transfers to leave out of Spending |
| `category_budgets` | Optional monthly limit per spending category, like `{ "GROCERIES": 400 }`. Set from the Spending tab. |
| `loans` | A list of loans: `name`, `kind` (`car`, `mortgage`, `personal`, `other`), `amount`, `annual_rate_percent`, `payment`, `first_payment_date`, `skipped_months`. `payment_text_contains` (optional words from the bank text of the payment, so the loan counts a payment only when your checking account shows it). An older single `car_loan` with the same fields still shows up as the first loan |
| `overtime`, `hsa`, `pto`, `retirement`, `hidden_tabs` | Overtime rates, HSA and PTO numbers, retirement balance, and menu tabs to hide |

Category names for rules: `FOOD_AND_DRINK`, `GROCERIES`, `AMAZON`, `TOLLS`, `GENERAL_MERCHANDISE`, `TRANSPORTATION`, `TRAVEL`, `ENTERTAINMENT`, `RENT_AND_UTILITIES`, `GENERAL_SERVICES`, `PERSONAL_CARE`, `MEDICAL`, `BANK_FEES`, `OTHER`. The Set up page has a dropdown, so you only need these names for the file.

Category names for rules: `FOOD_AND_DRINK`, `GROCERIES`, `AMAZON`, `TOLLS`, `GENERAL_MERCHANDISE`, `TRANSPORTATION`, `TRAVEL`, `ENTERTAINMENT`, `RENT_AND_UTILITIES`, `GENERAL_SERVICES`, `PERSONAL_CARE`, `MEDICAL`, `BANK_FEES`, `OTHER`.
</details>

---

## Security

| Where | What is there |
|---|---|
| Public GitHub repo | App code and relay code only |
| Cloudflare secrets and KV | Plaid keys, app key, bank links |
| Plaid | Your bank connections (read-only) |
| Your phone | Settings, transactions, relay address, app key, PIN hash |

- Secrets go only into Cloudflare's secrets boxes. Never into code, GitHub, chat or screenshots.
- The relay rejects any request without the right key and allows browser calls only from your own site.
- Read-only Plaid products cannot move money.
- Turn on two-factor sign-in for GitHub, Cloudflare and Plaid. Plaid's setting is on its personal page, `dashboard.plaid.com/personal/security`, not in the team settings.
- The PIN keeps casual snoopers out; it is not encryption. **Export backup** now and then, because iOS can clear a web app's storage.
- Before every push of your own changes: search the code for your name, banks, cards, amounts and addresses, and confirm `finance_settings.json` is not staged.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `INVALID_API_KEYS` on the link page | Secret and environment do not match. Check `/diag` lengths and `PLAID_ENV` |
| "Could not start" or `{"error":"no"}` while linking | App key wrong or changed. Re-enter it exactly |
| Settings → Connect to relay says the key does not match | The key you typed differs from the `APP_KEY` secret in Cloudflare |
| Connect to relay says it cannot reach the address | Wrong relay address, or `ALLOWED_ORIGIN` is not your app's website |
| Bank sign-in loops or fails after the bank page | Redirect address missing from Plaid's list, has a query string, or you are in the Home Screen app instead of Safari |
| Bank rejects your password | It may need an app-specific password from the bank's security settings |
| Cloudflare editor will not accept edits | Select the newest version first |
| Refresh says this phone has no set-up | Load a settings file or backup, or finish Set up, then refresh |
| Spending page is empty | The relay is missing the `/transactions` route. Paste the latest `relay/worker.mjs`, Deploy, refresh |
| A card is not updating | Its statement details are missing from the bank. The refresh reports it skipped and leaves it alone |
| Wrong account matched | Run a manual refresh; it asks which is which |
| Savings or another account is not filling in | Settings → **Show linked accounts** shows how the bank labels it |
| A number is a day behind | Some banks (Capital One cards, for example) cache balances |
| App shows the old layout after an update | Settings → Update app, then close and reopen it |

### Updating your copy

If you change the code, `index.html` loads scripts as `src/x.js?v=VERSION`. Change `VERSION` every time you publish, or the phone keeps old files. After publishing, wait a few minutes, open the app, then **Settings → Update app**. To pull in newer versions from the original repo, use **Sync fork** on your copy's GitHub page.

---

## Limits and costs

At the time of writing every piece here was free for personal use: GitHub Pages on a public repo, one Cloudflare Worker with one KV namespace, and Plaid's Trial plan. Free plans change. Check each provider's pricing page, and never add a paid service without checking the cost first.

---

## Files

```
index.html               app shell and menu (bump the ?v= tag when you publish)
guide.html               the step-by-step set-up guide
preview.html             animated preview with sample data
src/forecast.js          day-by-day cash forecast
src/summaries.js         statements, utilization, net worth
src/spending.js          transactions: merge, categories, pending math
src/bills.js             matches charges to your bills and subscriptions
src/spending-page.js     Spending page
src/spending-tools.js    Search, filter, pace, budgets, merchant rules, recurring detector (math)
src/spending-extras.js   Their tiles and sheets on the Spending page
src/setup-page.js        Set up page and guided set-up
src/plaid-sync.js        turns relay data into your settings
src/app.js               pages, storage, refresh, auto-refresh
src/lock.js              4-digit PIN lock
src/loan.js              loan math (car, mortgage, any other)
src/tracking*.js         goals, to-dos, credit score
src/extra-pages.js       bills, rewards, HSA, PTO pages
src/loans-page.js        Loans tab: one chip per loan, All overview, add and edit
src/gestures.js          swipe to delete, menu swipe
relay/worker.mjs         Cloudflare Worker
finance_settings.example.json   fake data showing the file format
```
