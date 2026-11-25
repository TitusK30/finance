# Finance OS

A private cash-flow forecaster for your iPhone. It shows how much will be in checking 10, 20, 30 and 40 days from now, which card statements are closed or still open, when each is due, and how your net worth moves. Optionally it pulls live balances from your banks every time you open it.

- Plain HTML and JavaScript. No frameworks, no build step, no server you pay for.
- Your numbers live **only on your phone** (browser storage). The public code contains none of them.
- Costs $0/month at personal scale (see [Limits](#limits-and-costs)).

> Not financial advice, and not affiliated with Plaid, Cloudflare, GitHub or any bank.

---

## How the pieces fit

```
iPhone app (GitHub Pages)  --x-finance-key-->  Relay (Cloudflare Worker)  -->  Plaid  -->  your banks
   your numbers stay here                      holds Plaid keys + bank links      read-only
```

| Piece | Job | Holds secrets? |
|---|---|---|
| **App** (`index.html`, `src/`) | Draws everything, does all the math on the phone | No. Only the relay address and your app key, in this phone's storage |
| **Relay** (`relay/worker.mjs`) | Talks to Plaid for you and returns balances only | Yes: Plaid keys, bank links, app key. Stored in Cloudflare, never in code |
| **Plaid** | Reads balances from your banks (read-only products) | Your bank logins stay with Plaid and the bank |
| **GitHub Pages** | Hosts the public app code | No |

The relay never returns a bank access token. It cannot move money: it only requests read-only products.

**You can use the app without any of the bank linking.** Skip Steps 3 to 5 and type your balances yourself.

---

## What you need

- An iPhone (the app is built for the Home Screen) and a computer for setup.
- Accounts (all free to start): **GitHub**, **Cloudflare**, **Plaid**.
- A password manager. You will create a long random "app key".
- About 1 to 2 hours the first time.

Turn on two-factor sign-in for GitHub, Cloudflare and Plaid. Plaid's setting is on its personal page: `dashboard.plaid.com/personal/security` (not the team security page, which is empty for individual accounts).

---

## Step 1. Put the app on GitHub Pages

1. Fork or copy this repo into your own GitHub account. It must be **public** for free Pages hosting.
2. Repo **Settings → Pages**: source **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your app address is `https://<your-github-username>.github.io/<repo-name>/`.
4. On your iPhone, open that address in **Safari**, tap **Share → Add to Home Screen**.

**Keep the repo free of personal data.** Only code goes public. Never commit your settings file, backups, notes or keys. The included `.gitignore` already excludes `finance_settings.json`, `test/`, `PLAN.md` and `node_modules/`. Check before every push.

**Cache busting (important on iOS).** `index.html` loads scripts as `src/x.js?v=VERSION`. Change `VERSION` every time you publish, or the phone keeps old files. After publishing, wait about 10 minutes, then open the app and tap **Settings → Update app**.

---

## Step 2. Load your own numbers

The public app is a blank shell. Your data comes from a settings file that you load once.

1. Copy `finance_settings.example.json` to a file named `finance_settings.json` (already git-ignored).
2. Replace every example value with yours:
   - `starting_balances`, `minimum_checking_floor`, `paycheck` (take-home, weekday, frequency).
   - Each entry in `credit_cards`: `credit_limit`, `statement_close_day`, `payment_due_day`, and `payment_due_in_following_month` (true when the due date falls in the month after the close).
   - `monthly_bills_paid_from_checking`, `subscriptions_charged_to_cards` (`card` is a key from `credit_cards`).
   - Optional: `card_benefits`, `annual_card_fees`, `car_loan`, `todo_items`, `overtime`, `hsa`. Use `null` for things you do not have.
   - Formats: dates are `YYYY-MM-DD`, card expiry months are `YYYY-MM` (for example `2030-01`).
3. Get the file to your phone privately (AirDrop or the Files app). Do not email it or put it in a public folder.
4. In the app: **menu → Settings → Load settings file**.
5. Optional but recommended: **Settings → Set / change PIN**. It keeps casual snoopers out. It does not encrypt your data.
6. Use **Settings → Export backup** now and then. Browser storage can be cleared by iOS, and the backup is your only copy.

---

## Step 3. Plaid (the bank data source)

1. Sign up at `plaid.com` (free Trial plan).
2. In the Dashboard open **Developers → Keys** (older layouts: Team Settings → Keys). Note your **client ID** and your **Production secret**. Treat the secret like a password.
3. Pick **one environment and stay in it.** The secret you copy must match the environment you set in the relay (Step 4). Mixing a Production secret with `sandbox`, or the reverse, gives `INVALID_API_KEYS` even when the keys are typed correctly.
4. In the Dashboard under **Developers → API**, find **Allowed redirect URIs** and add exactly:
   `https://<your-worker-name>.<your-subdomain>.workers.dev/link`
   It must be HTTPS and have no query string. Banks that use OAuth (Chase is one) need it. You will know the address after Step 4, so you can come back to this.

Never paste the secret into chat, code, GitHub, or screenshots.

---

## Step 4. The relay on Cloudflare

1. Create a free Cloudflare account. Go to **Workers & Pages → Create → Worker**, name it, and deploy the starter. (Menu names shift over time; the ideas stay the same.)
2. Open **Edit code**. Replace everything with `relay/worker.mjs` from this repo.
3. **Edit one line** near the top so only your app can call the relay:
   `const ALLOWED_ORIGIN = "https://<your-github-username>.github.io";`
   (origin only: no path, no trailing slash).
4. Click **Deploy**.
5. Create storage: **Storage & Databases → KV → Create namespace**. Then in the Worker: **Settings → Bindings → Add → KV namespace**, variable name exactly **`TOKENS`**.
6. In **Settings → Variables and Secrets**, add:

| Name | Type | Value |
|---|---|---|
| `PLAID_CLIENT_ID` | Secret | your Plaid client ID |
| `PLAID_SECRET` | Secret | your Plaid secret |
| `APP_KEY` | Secret | a long random string from your password manager |
| `PLAID_ENV` | Plain text | `production` (anything else means sandbox) |

7. Deploy again so the new settings apply.
8. Open `https://<your-worker-name>.<your-subdomain>.workers.dev` in a browser. You should see `{"error":"no"}`. That means it is running and locked.

**Check your secrets without revealing them.** Send a `GET` to `/diag` with the header `x-finance-key: <your app key>`. It returns only lengths: a Plaid client ID is 24 characters and a secret is 30, and it flags stray spaces. If the lengths are wrong or `plaid_env` is not what you expect, fix the secret.

**Cloudflare quirks that cost time:**
- The code editor is read-only unless the **newest version** is selected.
- Use **Deploy**, not "Save version", to make changes live. A greyed-out Deploy button usually means the pasted code did not change.
- To change a secret, use **Rotate** (it replaces the stored value).
- The built-in HTTP tester needs the full URL, not just `/diag`.
- Do not screenshot the secrets panel. Type the app key by hand on your phone rather than copy-pasting it through chat.

---

## Step 5. Link your banks

Do this in **Safari**, not in the Home Screen app. The bank hand-off back to the page fails inside the Home Screen app.

1. Open `https://<your-worker-name>.<your-subdomain>.workers.dev/link`.
2. Enter your app key. Give the login a short name (for example the bank's name).
3. Choose the type:
   - **Bank** for checking, savings and credit cards. This requests transactions, plus liabilities where the bank supports it (card statement balance, due date, minimum).
   - **Retirement / investments** for 401(k), IRA and similar.
4. Tap connect, choose the institution, sign in. If Plaid shows saved logins, you can reuse them. The phone-number prompt is optional.
5. Repeat for each login.

**Limits to plan around:**
- Each linked login uses one Plaid "Item". On the Trial plan the allowance is 10 in total, and removing one does **not** give the slot back. Link only what you will use. Verify the current limit on Plaid's pricing page.
- HSA providers may not be supported (some require a passkey or app approval). If linking fails, keep the HSA balance manual.
- Capital One does not provide real-time card balances. Numbers can be a day or two behind. The relay falls back to cached balances when live ones are unavailable.

---

## Step 6. Connect the app and refresh

1. In the app: **Settings → Connect to relay**. Enter the relay address (`https://<your-worker-name>.<your-subdomain>.workers.dev`) and your app key. Both are stored only in this phone's browser storage, separate from your settings.
2. Tap **Refresh balances** (or the **↻** button in the top bar).

**What refresh updates**

| Item | Source |
|---|---|
| Checking | Available balance. Sets the "as of" date to today |
| Savings | Updated only if one savings account is linked (or you picked one). Otherwise stays as typed |
| Each card | Current balance, credit limit, **Closed** and **Open** amounts, due dates |
| Retirement | Sum of every linked investment account that is not an HSA |
| HSA | Any linked account the bank labels HSA |
| Net worth | Recomputed, and today's value is saved to the Track history |
| Transactions | Pulled in a second call and saved on the phone (see Spending and pending below) |

Everything else (forecast, 10/20/30/40-day cards, chart, Next 40 days, Cards, Goals, Track) is calculated from those saved numbers, so it all updates together.

**Behavior**
- **Automatic:** when you open the app or return to it, it refreshes quietly if the last refresh was over 30 minutes ago. It never asks questions and never shows errors. If it cannot connect, it keeps your old numbers.
- **Manual (↻):** shows progress and errors, and asks once if it cannot tell which account is which. Your answer is remembered by the account's last four digits.
- **Undo last refresh:** in Settings, restores what you had before.
- A web app cannot refresh while it is closed. That is an iPhone limit.
- Still manual: bills, subscriptions, expenses, rewards, benefits, car loan, goals, credit score, PTO, tasks, and any account you did not link.

**Spending page and pending charges**
- The **Spending** page groups every charge by month and category (tap a category to see its charges), lists top places, and lists pending charges. Card payments, transfers and paychecks are left out; refunds count against their category. Categories come from Plaid and are sometimes wrong.
- Transactions are kept **only on the phone**, in storage separate from your settings, and the relay never stores them. The app sends back a bookmark (cursor) per login so each refresh only downloads what is new. Anything older than about 400 days is dropped.
- **History is limited.** Plaid requests 90 days when a login is first linked (it can be set up to 730 at link time, but only then). Capital One only shares 90 days, so the app keeps charges from the first refresh onward.
- **Pending charges** are charges the bank has seen but not added to your balance. They are counted in the card's Open statement (so the forecast and utilization include them) and shown as a separate "+ pending" line. The app works out the pending total from the bank's available credit (`limit - balance - available`), which also works for banks that do not share pending details. If available credit is missing it falls back to the pending charges in the transaction feed. If the bank already counts pending charges in the balance, nothing is added twice. Capital One does not provide pending transactions, so you may see an amount without a charge list.
- If the transactions call fails, balances still refresh.

**How Closed and Open are worked out**
- **Closed** = the last statement balance, minus any payment made since that statement was issued. Shown only if it is still due.
- **Open** = current balance minus the unpaid closed amount, plus pending charges. This is an estimate, because banks do not report it directly. The big Open number on screen is the posted part, and pending sits under it.
- Open's close and due dates come from your `statement_close_day` and `payment_due_day`, which the refresh leaves alone.

---

## Security model

| Where | What is there |
|---|---|
| Public GitHub repo | App code and the relay code only. No keys, balances, names or settings |
| Cloudflare secrets and KV | Plaid keys, app key, bank links |
| Plaid | Your bank connections (read-only) |
| Your phone | Settings file contents, transactions, relay address, app key, PIN hash |
| Your computer (private) | `finance_settings.json`, backups, notes |

Rules that kept this safe:
- Secrets go only into Cloudflare's secrets boxes. Never into code, GitHub, chat or screenshots.
- The app key is the only thing between the internet and your balances. Make it long and random. If it ever appears on a screen or in a chat, **rotate it** in Cloudflare and re-enter it on the phone.
- The relay refuses any request without the right `x-finance-key` before doing anything else (the one exception is the public link page, which holds no secrets), and allows browser calls only from your own site.
- The one-time link page is served from the relay's own address, not from the app's address, so it never shares browser storage with your data.
- Read-only Plaid products cannot move money.
- Turn on two-factor sign-in everywhere.

**Before every push:** search the code for your name, bank and card names, amounts and addresses; confirm `finance_settings.json` is not staged; confirm no key-like strings.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `INVALID_API_KEYS` on the link page | Secret and environment do not match. Check `/diag` lengths and `PLAID_ENV` |
| "Could not start" / `{"error":"no"}` while linking | App key typed wrong or changed. Re-enter it exactly |
| Bank sign-in loops or fails after the bank page | Redirect address missing from Plaid's allowed list, has a query string, or you are in the Home Screen app instead of Safari |
| Cloudflare editor will not accept edits | Select the newest version first |
| Deploy button greyed out | Nothing changed, or an old version is selected |
| App shows old layout after you publish | Bump the `?v=` tag, wait about 10 minutes, tap **Update app** |
| Spending page is empty | The relay is missing the `/transactions` route. Paste the latest `relay/worker.mjs` and Deploy, then refresh |
| A card is not updating | Its statement details are missing from the bank. The refresh reports it as skipped and leaves it alone |
| Wrong account matched | Run a manual refresh. It asks which is which when it cannot tell |
| A number is a day behind | Some banks (for example Capital One cards) cache balances |

---

## Limits and costs

At the time of writing (late 2026) every piece used here was free for personal use: GitHub Pages on a public repo, a Cloudflare Worker with one KV namespace, and Plaid's Trial plan with Balance, Transactions, Liabilities and Investments. Free plans change. Confirm current limits on each provider's pricing page before relying on this, and never add a paid service without checking the cost first.

---

## Files

```
index.html               app shell and menu (bump the ?v= tag when you publish)
src/forecast.js          day-by-day cash forecast
src/summaries.js         statements, utilization, net worth
src/spending.js          transactions: merge, monthly categories, pending math
src/spending-page.js     Spending page and the phone's transaction copy
src/plaid-sync.js        turns relay data into your settings (pure math)
src/app.js               pages, storage, refresh, auto-refresh
src/lock.js              4-digit PIN lock
src/loan.js              car-loan math
src/tracking*.js         goals, tracking, tasks
src/extra-pages.js       bills, rewards, HSA, PTO, car loan pages
relay/worker.mjs         Cloudflare Worker (edit ALLOWED_ORIGIN)
finance_settings.example.json   fake data showing the file format
```

**Bills are left out of Spending.** Recurring bills and subscriptions from your settings file are matched to charges by account, charge text and date (within 5 days of the due date). Amounts are not used, so rent or a tax-adjusted sub can drift. The text to look for is the bill's name by default; if the bank prints something different, add `"charge_text_contains": ["landlord text", "other text"]` to that bill. Matched charges are removed from the totals, categories and pending list and shown in a "Bills and subscriptions" tile. If one slips through, tap "mark as bill" on it.
