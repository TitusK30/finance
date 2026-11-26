# Finance OS

A private cash-flow forecaster for your iPhone. It shows what will be in checking 10, 20, 30 and 40 days from now, which card statements are closed or open and when they are due, where your spending goes, and how your net worth moves. Optionally it pulls live balances and transactions from your banks every time you open it.

- Plain HTML and JavaScript. No frameworks, no build step, no server you pay for.
- Your numbers live **only on your phone**. The public code contains none of them.
- $0/month at personal scale (see [Limits and costs](#limits-and-costs)).

> Not financial advice. Not affiliated with Plaid, Cloudflare, GitHub or any bank.

---

## Pick your path

| | Path A: no bank link | Path B: full (live bank data) |
|---|---|---|
| Time | about 15 minutes | 1 to 2 hours |
| Accounts needed | GitHub | GitHub, Cloudflare, Plaid |
| You type | balances, bills, cards | only the set-up values; balances come from your banks |

Start with Path A. You can add Path B later without losing anything. On a brand-new phone the app opens with a welcome card and a short Start here checklist, and empty pages tell you what to add.

**Path A:** do Step 1 and Step 2, then stop.
**Path B:** do Steps 1 to 7 in order. The order matters; it avoids going back and forth between sites.

You need: an iPhone, a computer for set-up, and a password manager (you will create a long random "app key"). Turn on two-factor sign-in for GitHub, Cloudflare and Plaid. Plaid's setting is on its personal page, `dashboard.plaid.com/personal/security`, not the empty team security page.

---

## How the pieces fit (Path B)

```
iPhone app (GitHub Pages)  --app key-->  Relay (Cloudflare Worker)  -->  Plaid  -->  your banks
   your numbers stay here                holds Plaid keys + bank links      read-only
```

The relay returns balances and transactions only. It never returns a bank token and cannot move money.

---

## Step 1. Put the app on GitHub Pages

1. Fork this repo into your own GitHub account. It must be **public** for free Pages hosting.
2. Repo **Settings → Pages**: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your app address is `https://<your-github-username>.github.io/<repo-name>/` (ready after a minute or two).
4. On your iPhone open that address in **Safari**, then **Share → Add to Home Screen**.

Keep the repo free of personal data. Never commit your settings file, backups or keys. The included `.gitignore` already excludes `finance_settings.json`, `test/`, `PLAN.md` and `node_modules/`.

**Publishing changes later (iPhone caching):** `index.html` loads scripts as `src/x.js?v=VERSION`. Change `VERSION` every time you publish, or the phone keeps old files. After publishing, wait a few minutes, open the app, then **Settings → Update app**. The Data section confirms "App updated".

---

## Step 2. Set up in the app

No files and no computer. Everything happens on your phone, and nothing leaves it.

1. Open the app from your Home Screen. A brand-new app shows a **Welcome to Finance OS** card.
2. Tap **Set up in the app (about 5 minutes)**. A guided set-up asks one question at a time, with **Back**, **Next** and **Skip** on every step.
3. Answer what you know and skip the rest. Every answer can be changed later.

**What the guided set-up asks**

| Step | What to have ready | Needed? |
|---|---|---|
| How often you are paid | Weekly, every two weeks, twice a month or monthly, and which day | Yes |
| Each paycheck, after tax | Your usual take-home amount | Yes |
| Checking balance | Today's balance (a bank link fills it later) | Yes, unless you link a bank |
| Savings balance | Today's balance | Optional |
| Lowest checking balance | The amount you never want to drop below. The app warns you before it happens | Yes |
| Credit cards | Name, limit, the day the statement closes, the day it is due. Optional: what you owe on the closed and open statements, rewards, expiry, annual fee | Optional, add as many as you like |
| Monthly bills from checking | Name, amount, due day (rent, car payment, power) | Optional, add as many as you like |
| Subscriptions on a card | Name, amount, day, which card | Optional |
| Car loan | Amount, rate, payment, first payment date | Optional |
| Overtime | Your hourly rates, for the Planner tab | Optional |
| Everyday spending | About how much a month on groceries, gas and going out, so the forecast's low point is realistic | Optional |
| Retirement, HSA, time off | Balances and hours | Optional |
| Menu tabs | Untick tabs you will not use | Optional |

Tip: a card's statement-close and due days are on its monthly statement or in the card's app.

**Changing things later:** Menu → **Settings → Set up in the app**. It is a list of sections with icons (Basics, Paycheck, Overtime, Credit cards, Card extras, Bills, Subscriptions, Spending tab, Car loan, HSA, Time off, Menu tabs). Tap a section to open it.
- Cards, bills and subscriptions save with their own **Add** buttons. Swipe a row left to delete it.
- Everything else saves when you tap **Apply** at the top right.
- **Spending tab** (only matters with a bank link): your own category rules (for example, a store that always counts as Groceries), and words for transfers to your own savings so they are not counted as spending.
- If your bank writes a bill differently from its name, put the bank's wording in the bill's "text on the bank statement" box.

Then, recommended:
- **Settings → Set / change PIN** keeps casual snoopers out (it is not encryption).
- **Settings → Export backup** now and then. iOS can clear a web app's storage, and the backup is your only copy.

<details>
<summary><b>Optional: a settings file instead (you can skip this)</b></summary>

Most people never need this. It is for anyone who would rather type everything once on a computer, or move set-up between phones.

1. Copy `finance_settings.example.json` to `finance_settings.json` and replace the fake values. It shows every field. Leave out anything you don't use.
2. Send it to your phone privately (AirDrop or the Files app, not email).
3. In the app: **Settings → Load settings file**.

Loading a file only changes what it contains. It never wipes balances, statements, tasks, goals or tab choices already on the phone. Dates are `YYYY-MM-DD`; card expiry is `YYYY-MM`. Category names for rules: `FOOD_AND_DRINK`, `GROCERIES`, `AMAZON`, `TOLLS`, `GENERAL_MERCHANDISE`, `TRANSPORTATION`, `TRAVEL`, `ENTERTAINMENT`, `RENT_AND_UTILITIES`, `GENERAL_SERVICES`, `PERSONAL_CARE`, `MEDICAL`, `BANK_FEES`, `OTHER`.

Never commit `finance_settings.json` to GitHub. The included `.gitignore` already leaves it out.
</details>

**Path A ends here.** Type your checking and savings balances in the app and update them when you like.

---

## Step 3. Cloudflare: create the relay (no secrets yet)

1. Free Cloudflare account. **Workers & Pages → Create → Worker**, name it, deploy the starter.
2. **Edit code**: replace everything with `relay/worker.mjs` from this repo.
3. Click **Deploy**. (You tell it which website may call it in Step 5, with a variable, so you never edit the code.)
4. **Storage & Databases → KV → Create namespace**. In the Worker: **Settings → Bindings → Add → KV namespace**, variable name exactly **`TOKENS`**.
5. Write down your relay address: `https://<worker-name>.<your-subdomain>.workers.dev`. Step 4 needs it.

Cloudflare quirks that cost time:
- The editor is read-only unless the **newest version** is selected.
- Use **Deploy**, not "Save version". A greyed-out Deploy means nothing changed.
- On iPhone, to replace the code: editor menu / Command Palette → **Select All**, then paste.
- To change a secret later, use **Rotate**.
- The built-in HTTP tester needs the full URL.

---

## Step 4. Plaid: keys and redirect address

1. Sign up at `plaid.com`. Production keys may require Plaid to approve a short application first; allow time for that. Check Plaid's current rules.
2. Dashboard → **Developers → Keys**: note your **client ID** and **Production secret**.
3. **Want to try it before Production is approved?** Use the Sandbox secret and set `PLAID_ENV` to `sandbox` in Step 5. Linking then shows Plaid's fake test banks, so you can check the whole set-up with no real accounts. Switch both the secret and `PLAID_ENV` to Production when you are ready.
4. **Pick one environment and stay in it.** The secret must match the environment you set in Step 5. A Production secret with `sandbox` (or the reverse) gives `INVALID_API_KEYS` even when typed correctly.
5. **Developers → API → Allowed redirect URIs**: add exactly
   `https://<worker-name>.<your-subdomain>.workers.dev/link`
   HTTPS, no query string. Banks that use OAuth (Chase is one) need it.

Never paste the secret into chat, code, GitHub or screenshots.

---

## Step 5. Cloudflare: add the secrets

Worker **Settings → Variables and Secrets**:

| Name | Type | Value |
|---|---|---|
| `PLAID_CLIENT_ID` | Secret | your Plaid client ID |
| `PLAID_SECRET` | Secret | your Plaid secret |
| `APP_KEY` | Secret | a long random string from your password manager |
| `PLAID_ENV` | Plain text | `production` (anything else means sandbox) |
| `ALLOWED_ORIGIN` | Plain text | `https://<your-github-username>.github.io` (origin only, no path, no trailing slash) |

No app key yet? In the app, **Settings → Connect to relay**, leave the key empty and it makes a long random one for you to paste into `APP_KEY`.

**Deploy again.** Then open the relay address in a browser. You should see `{"error":"no"}`: it is running and locked.

Check the secrets without revealing them: send a `GET` to `/diag` with the header `x-finance-key: <app key>`. It returns only lengths: a Plaid client ID is 24 characters and a secret is 30, and it flags stray spaces. Fix anything that is off.

Do not screenshot the secrets panel. Type the app key by hand on your phone instead of copy-pasting it through chat.

---

## Step 6. Link your banks

Do this in **Safari**, not the Home Screen app. The bank hand-off back to the page fails inside the Home Screen app.

1. Open `https://<worker-name>.<your-subdomain>.workers.dev/link`.
2. Enter the app key and a short name for the login (the bank's name works).
3. Choose the type:
   - **Bank**: checking, savings and credit cards (transactions, plus statement balance and due date where supported).
   - **Retirement / investments**: 401(k), IRA and similar.
4. Connect, pick the institution, sign in. Repeat for each login.

Limits to plan around:
- Each login uses one Plaid "Item". The Trial plan allows 10 in total and removing one does **not** return the slot. Link only what you will use, and check Plaid's current limit.
- HSA providers may not be supported. If linking fails, keep the HSA balance typed in.
- Capital One does not give real-time card balances (a day or two behind) and no pending transactions.
- If a bank says `ADDITIONAL_CONSENT_REQUIRED`, that login needs you to re-approve access with Plaid.

---

## Step 7. Connect the app and refresh

1. In the app: **Settings → Connect to relay**. Enter the relay address and the app key (or leave the key empty to make one). Both are stored only in this phone's browser storage. The app then tests the connection and tells you in plain words what is wrong, if anything (wrong key, bad Plaid keys, wrong site address).
2. Tap **↻** in the top bar (or Settings → Refresh balances).

What a refresh updates:

| Item | Source |
|---|---|
| Checking | Available balance, as of today |
| Savings | A savings, cash management or money market account. If your bank calls it "checking", the manual refresh asks once which account is your savings and remembers it. Otherwise stays as typed |
| Each card | Balance, limit, **Closed** and **Open** amounts, due dates |
| Retirement and HSA | Linked investment and HSA accounts |
| Net worth | Recalculated, and saved to your history |
| Transactions | Saved on the phone, used by the Spending page |

Everything else (forecast, 10/20/30/40-day cards, chart, Cards, Goals) is calculated from those numbers, so it all updates together.

- **Automatic:** on opening or returning to the app, it refreshes quietly if the last refresh was over 30 minutes ago. It never shows errors and keeps your old numbers if it cannot connect.
- **Manual (↻):** shows progress and errors, and asks which account is which if it cannot tell. Your answer is remembered.
- **Undo last refresh** is in Settings. A web app cannot refresh while closed; that is an iPhone limit.

### Sharing with a partner

A second phone can show the same bank data without linking anything again (no extra Plaid logins used):

1. On the second phone, open the same app address in Safari and **Add to Home Screen**.
2. Run **Set up in the app** there (pay, bills and cards are kept per phone).
3. **Settings → Connect to relay** with the **same relay address and app key**, then tap **↻**.

Bank-fed numbers (balances, statements, spending) match on both phones. Things you type in (tasks, goals, credit scores, PTO) stay on the phone where you typed them. Only share the app key with someone you would hand your bank statements to.

---

## What is in the app

Menu: **Home**, **Spending**, **Cards**, **Bills**, **Tasks**, **Goals**, **Planner**, **HSA**, **PTO**, **Car loan**, **Set up**, **Settings**. Open it with the top-left button or a swipe from the left edge. Tabs you do not use can be hidden in Set up.

- **Home:** left to spend this month, checking, savings, retirement, net worth, credit score (tap the number to log one), whether a savings transfer is needed, 10/20/30/40-day outlook and a 40-day chart, card countdowns.
- **Spending:** this month by category with pending charges, earned vs spent, top places.
- **Cards:** utilization plan, closed and open amounts, due dates, expiry, fees, rewards and benefits.
- **Goals, Planner, Tasks, HSA, PTO, Car loan:** savings goals and a finish-by-date planner, overtime planner and what-if, dated to-dos, HSA and PTO numbers, loan payoff.

## Using the app

- **Closed** = last statement balance minus payments since it was issued. **Open** = current balance minus the unpaid closed amount, plus pending charges. Open is an estimate; banks do not report it.
- **Pending charges** show in a card's Open amount (so the forecast and utilization include them) with a separate "+ pending" line. They are worked out from the bank's available credit, so it works even for banks that do not list pending items.
- **Spending** groups every charge by month and category and lists top places. Card payments, transfers and paychecks are left out; refunds count against their category. Categories come from Plaid and are sometimes wrong. Transactions live only on the phone, and anything older than about 400 days is dropped. Plaid usually provides about 90 days when a login is first linked.
- **Bills are left out of Spending.** Your bills and subscriptions are matched to charges by account, charge text and date (within 5 days of the due date). Amounts are not used, so rent or a tax-adjusted sub can drift. Matched charges show in a "Bills and subscriptions" tile. If one slips through, tap **mark as bill** on it.
- **Home** shows how much is left to spend today and how much room your cards have. Pull down on Home to refresh; the line under the title shows when it last updated.
- **Spending** compares this month with last month by category (a month in progress is compared with the same days last month).
- Swipe left on a task, goal or Set up row to reveal **Delete**.
- Still typed in by you: savings (unless linked), rewards, benefits, car loan, goals, credit scores, PTO, tasks.

---

## Security

| Where | What is there |
|---|---|
| Public GitHub repo | App code and relay code only |
| Cloudflare secrets and KV | Plaid keys, app key, bank links |
| Plaid | Your bank connections (read-only) |
| Your phone | Settings, transactions, relay address, app key, PIN hash |

- Secrets go only into Cloudflare's secrets boxes. Never into code, GitHub, chat or screenshots.
- The app key is the only thing between the internet and your balances. Make it long and random. If it ever shows up on a screen or in a chat, **rotate it** in Cloudflare and re-enter it on the phone.
- The relay rejects any request without the right key and allows browser calls only from your own site.
- Read-only Plaid products cannot move money.
- Before every push: search the code for your name, banks, cards, amounts and addresses; confirm `finance_settings.json` is not staged.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `INVALID_API_KEYS` on the link page | Secret and environment do not match. Check `/diag` lengths and `PLAID_ENV` |
| "Could not start" or `{"error":"no"}` while linking | App key wrong or changed. Re-enter it exactly |
| Bank sign-in loops or fails after the bank page | Redirect address missing from Plaid's list, has a query string, or you are in the Home Screen app instead of Safari |
| Cloudflare editor will not accept edits | Select the newest version first |
| Deploy button greyed out | Nothing changed, or an old version is selected |
| App shows the old layout after publishing | Bump the `?v=` tag, wait, then Settings → Update app |
| Spending page is empty | The relay is missing the `/transactions` route. Paste the latest `relay/worker.mjs`, Deploy, refresh |
| A card is not updating | Its statement details are missing from the bank. The refresh reports it skipped and leaves it alone |
| Wrong account matched | Run a manual refresh; it asks which is which |
| A number is a day behind | Some banks (Capital One cards, for example) cache balances |
| A login says `ADDITIONAL_CONSENT_REQUIRED` | Plaid wants extra approval for some data on that login. Balances may still work; if numbers go stale, re-approve that login with Plaid |
| Savings or another account is not filling in | Settings → **Show linked accounts** lists what each bank sent (name, type, subtype, last 4 digits) so you can see how the bank labels it |
| Wrong set-up numbers after loading a file | The file only changes what it contains; fix the rest in Set up |

---

## Limits and costs

At the time of writing every piece here was free for personal use: GitHub Pages on a public repo, one Cloudflare Worker with one KV namespace, and Plaid's Trial plan (Balance, Transactions, Liabilities, Investments). Free plans change. Check each provider's pricing page, and never add a paid service without checking the cost first.

---

## Files

```
index.html               app shell and menu (bump the ?v= tag when you publish)
src/forecast.js          day-by-day cash forecast
src/summaries.js         statements, utilization, net worth
src/spending.js          transactions: merge, categories, pending math
src/bills.js             matches charges to your bills and subscriptions
src/spending-page.js     Spending page
src/setup-page.js        Set up page (the no-file alternative)
src/plaid-sync.js        turns relay data into your settings
src/app.js               pages, storage, refresh, auto-refresh
src/lock.js              4-digit PIN lock
src/loan.js              car-loan math
src/tracking*.js         goals, tracking, tasks
src/extra-pages.js       bills, rewards, HSA, PTO, car loan pages
relay/worker.mjs         Cloudflare Worker (set ALLOWED_ORIGIN as a variable)
relay/wrangler.toml      optional: deploy with `npx wrangler deploy` instead of pasting
finance_settings.example.json   fake data showing the file format
```

### Spending tab
- "Earned this month" adds deposits to your bank accounts that the bank calls income or that mention payroll or direct deposit. If your pay is not picked up, add a word from its description in **Set up → Paycheck** ("Pay deposit text").
- Category rules: **Set up → Spending tab → Your own category rules** (for example, a store name that always counts as Groceries). Transfers to your own savings are hidden with "Transfers to leave out".

### Goals tab
- "Finish by a date" shows how much to save each week to reach a goal by a date.
- "Save a set amount" shows what savings would be by a date you pick, at a weekly amount you type.
- "Money coming and going" lists known amounts with dates. Money coming in counts toward both results; money going out lowers them.
- Goals stay on the Goals tab. Nothing there changes Home.
- "Room to put on your cards" (Home): the lowest checking day in the next 60 days minus your floor, counting statements (open ones too), pending, bills, subs and fees.
