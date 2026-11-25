// Finance OS relay (Cloudflare Worker).
// Holds the Plaid keys and bank links so neither sits on the phone or in the public repo.
// Sends back balances and card statement details only. It never returns a bank link token.

const ALLOWED_ORIGIN = "https://YOUR-GITHUB-USERNAME.github.io"; // change this to your own site
const FRESH_ENOUGH_DAYS = 3;


// The one-time bank link page. It holds no secrets and lives on the relay's own address,
// so it is kept apart from the Finance OS app and its saved data.
const LINK_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link a bank</title>
<style>
body{background:#0d0f14;color:#e8eaf0;font-family:-apple-system,system-ui,sans-serif;margin:0;padding:24px 16px}
main{max-width:480px;margin:0 auto}
.tile{background:#1a1d24;border-radius:16px;padding:16px}
label{display:block;color:#8b92a1;font-size:14px;margin:12px 0 4px}
input,select{width:100%;box-sizing:border-box;background:#0d0f14;color:#e8eaf0;border:1px solid #2a2e38;border-radius:12px;padding:14px;font-size:16px}
button{width:100%;margin-top:16px;padding:16px;font-size:17px;border:0;border-radius:12px;background:#3b82f6;color:#fff}
#status{color:#8b92a1;font-size:14px;margin-top:12px}
</style></head><body><main>
<h2>Link a bank</h2>
<div class="tile">
<label>App key</label><input id="app-key" type="password" autocomplete="off">
<label>Name for this login (Chase, Capital One, Citi, Empower)</label><input id="login-label">
<label>Type</label><select id="login-kind"><option value="bank">Bank or credit card</option><option value="investments">Retirement / investments</option></select>
<button id="link-button">Link</button>
<div id="status"></div>
</div></main>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
<script>
var keyInput = document.getElementById("app-key");
var labelInput = document.getElementById("login-label");
var kindInput = document.getElementById("login-kind");
var statusLine = document.getElementById("status");
keyInput.value = localStorage.getItem("relay_key") || "";
labelInput.value = localStorage.getItem("relay_label") || "";
function askRelay(path, body) {
  return fetch(path, { method: "POST", headers: { "x-finance-key": keyInput.value, "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "Relay said no"); return data; }); });
}
function openPlaid(linkToken, receivedRedirectUri) {
  Plaid.create({
    token: linkToken,
    receivedRedirectUri: receivedRedirectUri,
    onSuccess: function (publicToken) {
      statusLine.textContent = "Saving...";
      askRelay("/exchange", { public_token: publicToken, label: labelInput.value })
        .then(function () { statusLine.textContent = "Linked. You can close this page."; localStorage.removeItem("relay_link_token"); })
        .catch(function (error) { statusLine.textContent = "Could not save: " + error.message; });
    },
    onExit: function () { if (statusLine.textContent.indexOf("Linked") !== 0) statusLine.textContent = "Closed before finishing."; }
  }).open();
}
document.getElementById("link-button").addEventListener("click", function () {
  localStorage.setItem("relay_key", keyInput.value);
  localStorage.setItem("relay_label", labelInput.value);
  statusLine.textContent = "Starting...";
  askRelay("/link-token", { kind: kindInput.value })
    .then(function (data) { localStorage.setItem("relay_link_token", data.link_token); openPlaid(data.link_token); })
    .catch(function (error) { statusLine.textContent = "Could not start: " + error.message; });
});
if (location.search.indexOf("oauth_state_id") !== -1) {
  var savedToken = localStorage.getItem("relay_link_token");
  if (savedToken) openPlaid(savedToken, location.href);
}
</script></body></html>`;

function plaidBaseUrl(env) {
  return env.PLAID_ENV === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com";
}

async function callPlaid(env, path, body) {
  const response = await fetch(plaidBaseUrl(env) + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID, "PLAID-SECRET": env.PLAID_SECRET },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_code || "PLAID_ERROR");
  return data;
}

function sameText(first, second) {
  if (typeof first !== "string" || typeof second !== "string" || first.length !== second.length) return false;
  let differences = 0;
  for (let position = 0; position < first.length; position++) differences |= first.charCodeAt(position) ^ second.charCodeAt(position);
  return differences === 0;
}

function jsonReply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Headers": "content-type, x-finance-key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

// "bank" covers checking, savings and credit cards. "investments" covers retirement.
function linkTokenRequest(kind, relayAddress) {
  const base = { client_name: "Finance OS", language: "en", country_codes: ["US"], user: { client_user_id: "owner" }, redirect_uri: relayAddress + "/link" };
  if (kind === "investments") return { ...base, products: ["investments"] };
  return { ...base, products: ["transactions"], required_if_supported_products: ["liabilities"] };
}

async function accountsWithBalances(env, accessToken) {
  const oldestAcceptable = new Date(Date.now() - FRESH_ENOUGH_DAYS * 86400000).toISOString();
  try {
    return (await callPlaid(env, "/accounts/balance/get", { access_token: accessToken, options: { min_last_updated_datetime: oldestAcceptable } })).accounts;
  } catch (error) {
    return (await callPlaid(env, "/accounts/get", { access_token: accessToken })).accounts; // cached balances
  }
}

async function cardDetailsByAccount(env, accessToken) {
  try {
    const credit = (await callPlaid(env, "/liabilities/get", { access_token: accessToken })).liabilities?.credit || [];
    return Object.fromEntries(credit.map((card) => [card.account_id, {
      statement_balance: card.last_statement_balance,
      statement_issue_date: card.last_statement_issue_date,
      next_due_date: card.next_payment_due_date,
      minimum_payment: card.minimum_payment_amount,
      is_overdue: card.is_overdue,
      last_payment_date: card.last_payment_date,
      last_payment_amount: card.last_payment_amount,
    }]));
  } catch (error) {
    return {}; // this login has no cards, or the bank doesn't share card details
  }
}

async function refreshEverything(env) {
  const stored = await env.TOKENS.list({ prefix: "item:" });
  const accounts = [];
  const problems = [];
  for (const entry of stored.keys) {
    const item = JSON.parse(await env.TOKENS.get(entry.name));
    try {
      const [itemAccounts, cardDetails] = await Promise.all([accountsWithBalances(env, item.access_token), cardDetailsByAccount(env, item.access_token)]);
      for (const account of itemAccounts) {
        accounts.push({
          login: item.label,
          account_id: account.account_id,
          name: account.name,
          official_name: account.official_name,
          mask: account.mask,
          type: account.type,
          subtype: account.subtype,
          current: account.balances.current,
          available: account.balances.available,
          limit: account.balances.limit,
          ...(cardDetails[account.account_id] || {}),
        });
      }
    } catch (error) {
      problems.push({ login: item.label, error: error.message });
    }
  }
  return { as_of: new Date().toISOString(), accounts, problems };
}

// Plaid errors that only mean "this login has no transactions" (for example a retirement login).
const LOGINS_WITHOUT_TRANSACTIONS = ["INVALID_PRODUCT", "PRODUCTS_NOT_SUPPORTED"];

function slimTransaction(transaction) {
  return {
    transaction_id: transaction.transaction_id,
    account_id: transaction.account_id,
    date: transaction.date,
    authorized_date: transaction.authorized_date,
    name: transaction.name,
    merchant_name: transaction.merchant_name,
    amount: transaction.amount, // Plaid: positive = money out, negative = money in
    pending: transaction.pending,
    pending_transaction_id: transaction.pending_transaction_id,
    category: transaction.personal_finance_category?.primary || null,
    category_detail: transaction.personal_finance_category?.detailed || null,
  };
}

// Pulls everything new since the cursor the phone sends. Nothing is stored here: the phone keeps the history.
async function transactionChanges(env, accessToken, startingCursor) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const changes = { added: [], modified: [], removed: [], accounts: [], next_cursor: startingCursor || null };
    try {
      for (let page = 0; page < 20; page++) {
        const reply = await callPlaid(env, "/transactions/sync", { access_token: accessToken, cursor: changes.next_cursor || undefined, count: 500 });
        changes.added.push(...reply.added.map(slimTransaction));
        changes.modified.push(...reply.modified.map(slimTransaction));
        changes.removed.push(...reply.removed.map((entry) => entry.transaction_id));
        changes.accounts = reply.accounts.map((account) => ({ account_id: account.account_id, mask: account.mask, name: account.name, type: account.type, subtype: account.subtype }));
        changes.next_cursor = reply.next_cursor;
        if (!reply.has_more) return changes;
      }
      return changes; // very large backlog: the next refresh continues from this cursor
    } catch (error) {
      if (error.message !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" || attempt === 1) throw error;
    }
  }
}

async function allTransactionChanges(env, cursorsByItem) {
  const stored = await env.TOKENS.list({ prefix: "item:" });
  const items = [];
  const problems = [];
  for (const entry of stored.keys) {
    const itemId = entry.name.slice("item:".length);
    const item = JSON.parse(await env.TOKENS.get(entry.name));
    try {
      items.push({ item_id: itemId, login: item.label, ...(await transactionChanges(env, item.access_token, cursorsByItem[itemId])) });
    } catch (error) {
      if (!LOGINS_WITHOUT_TRANSACTIONS.includes(error.message)) problems.push({ login: item.label, error: error.message });
    }
  }
  return { items, problems };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return jsonReply({});
    if (request.method === "GET" && new URL(request.url).pathname === "/link") {
      return new Response(LINK_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (!env.APP_KEY) return jsonReply({ error: "APP_KEY not set" }, 500);
    if (!sameText(request.headers.get("x-finance-key"), env.APP_KEY)) return jsonReply({ error: "no" }, 401);
    const path = new URL(request.url).pathname;
    try {
      if (path === "/link-token" && request.method === "POST") {
        const { kind } = await request.json();
        const { link_token } = await callPlaid(env, "/link/token/create", linkTokenRequest(kind, new URL(request.url).origin));
        return jsonReply({ link_token });
      }
      if (path === "/exchange" && request.method === "POST") {
        const { public_token, label } = await request.json();
        const { access_token, item_id } = await callPlaid(env, "/item/public_token/exchange", { public_token });
        await env.TOKENS.put("item:" + item_id, JSON.stringify({ access_token, label: String(label || "Bank").slice(0, 40) }));
        return jsonReply({ item_id });
      }
      if (path === "/diag" && request.method === "GET") {
        // Lengths only, never the values. A Plaid client ID is 24 characters; a secret is 30.
        const clientId = env.PLAID_CLIENT_ID || "";
        const secret = env.PLAID_SECRET || "";
        return jsonReply({ plaid_env: env.PLAID_ENV, client_id_length: clientId.length, secret_length: secret.length, client_id_has_space: clientId !== clientId.trim(), secret_has_space: secret !== secret.trim() });
      }
      if (path === "/refresh" && request.method === "GET") return jsonReply(await refreshEverything(env));
      if (path === "/transactions" && request.method === "POST") {
        const { cursors } = await request.json();
        return jsonReply(await allTransactionChanges(env, cursors || {}));
      }
      return jsonReply({ error: "not found" }, 404);
    } catch (error) {
      return jsonReply({ error: error.message }, 502);
    }
  },
};
