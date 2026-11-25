// The Spending page, plus the phone's saved copy of your transactions.
// Transactions are kept on this phone only, apart from your settings.

const TRANSACTIONS_KEY = "finance_os_transactions";
let spendingMonthShown = null;

function loadTransactionStore() {
  try {
    return JSON.parse(localStorage.getItem(TRANSACTIONS_KEY)) || emptyTransactionStore();
  } catch (error) {
    return emptyTransactionStore();
  }
}

function saveTransactionStore(store) {
  try {
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(store));
  } catch (error) {
    // Storage full: skip. Balances still work, and the next refresh tries again.
  }
}

// Card name if this account is one of your tracked cards, otherwise the bank's name for the account.
function cardNameForAccount(settings, store, accountId) {
  const account = store.accounts[accountId];
  if (!account) return "";
  const cardKey = Object.keys(settings.credit_cards).find((key) => (settings.card_masks || {})[key] === account.mask && account.type === "credit");
  return cardKey ? settings.credit_cards[cardKey].display_name : account.name;
}

function chargeRowHtml(settings, store, charge) {
  const pendingTag = charge.pending ? ` <span class="pending-tag">pending</span>` : "";
  const cardName = cardNameForAccount(settings, store, charge.account_id);
  return `<div class="tile-row small charge-row"><span>${shortMonthDay(charge.date)} · ${escapeHtml(merchantName(charge))}${pendingTag}<br><span class="charge-card">${escapeHtml(cardName)}</span></span><span>${formatMoney(charge.amount)}</span></div>`;
}

function monthLabel(yearMonth) {
  return new Date(yearMonth + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function showSpendingPage(settings) {
  const page = document.getElementById("page-spending");
  const store = loadTransactionStore();
  const charges = spendingCharges(store);
  if (charges.length === 0) {
    page.innerHTML = `<h2>Spending</h2><div class="tile small">No transactions yet. Tap the refresh button at the top. The bank shares about the last 90 days, and the app keeps everything it receives from then on.</div>`;
    return;
  }
  const months = monthsWithSpending(charges);
  if (!months.includes(spendingMonthShown)) spendingMonthShown = months[0];
  const position = months.indexOf(spendingMonthShown);
  const month = monthlyBreakdown(charges, spendingMonthShown);
  const olderMonth = months[position + 1];
  const newerMonth = months[position - 1];
  const monthButton = (label, target) => target ? `<button class="small-button" data-spending-month="${target}">${label}</button>` : `<button class="small-button" disabled>${label}</button>`;

  const pending = pendingCharges(store);
  const pendingTile = pending.length ? `<div class="tile"><div class="tile-row"><b>Pending</b><b class="amber-text">${formatMoney(pending.reduce((sum, charge) => sum + charge.amount, 0))}</b></div>
    <div class="small">Charged, but not on your balance yet. Some banks do not share these.</div>${pending.map((charge) => chargeRowHtml(settings, store, charge)).join("")}</div>` : "";

  const categoryRows = month.categories.map((entry) => `<details class="tile category-tile">
    <summary><div class="tile-row"><b>${entry.name}</b><b>${formatMoney(entry.total)}</b></div>
      <div class="bar"><div class="bar-fill" style="width:${entry.share}%"></div></div>
      <div class="small">${entry.share}% of the month · ${entry.charges.length} charge${entry.charges.length === 1 ? "" : "s"}</div></summary>
    ${entry.charges.map((charge) => chargeRowHtml(settings, store, charge)).join("")}</details>`).join("");

  const merchantRows = month.topMerchants.map((merchant) => `<div class="tile-row small"><span>${escapeHtml(merchant.name)}</span><span>${formatMoney(merchant.amount)}</span></div>`).join("");

  page.innerHTML = `<h2>Spending</h2>
    <div class="tile-row month-nav">${monthButton("‹", olderMonth)}<b>${monthLabel(spendingMonthShown)}</b>${monthButton("›", newerMonth)}</div>
    <div class="tile"><div class="small">Spent this month</div><div class="big-number">${formatMoney(month.total)}</div>
      ${month.pendingTotal > 0 ? `<div class="small">includes ${formatMoney(month.pendingTotal)} pending</div>` : ""}</div>
    ${pendingTile}${categoryRows}
    <div class="tile"><b>Top places</b>${merchantRows}</div>
    <div class="small">Card payments, transfers and paychecks are left out. Refunds count against the category. Categories come from the bank and Plaid, so a few will be off.</div>`;
}

document.addEventListener("click", (event) => {
  const monthButton = event.target.closest("[data-spending-month]");
  if (!monthButton) return;
  spendingMonthShown = monthButton.dataset.spendingMonth;
  showSpendingPage(loadSettings());
});
