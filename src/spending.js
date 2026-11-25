// Spending math: keeps the phone's copy of your transactions up to date and groups them by month and category.
// Pure math. It never talks to the network. Plaid sends amounts as positive = money out, negative = money in.

// Not spending: paychecks, moving money between your own accounts, and loan or card payments.
const NOT_SPENDING_CATEGORIES = ["INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"];
const KEEP_TRANSACTIONS_DAYS = 400;

const CATEGORY_NAMES = {
  FOOD_AND_DRINK: "Food and drink",
  GROCERIES: "Groceries",
  AMAZON: "Amazon",
  TOLLS: "Tolls",
  GENERAL_MERCHANDISE: "Shopping",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  ENTERTAINMENT: "Entertainment",
  RENT_AND_UTILITIES: "Rent and utilities",
  GENERAL_SERVICES: "Services",
  PERSONAL_CARE: "Personal care",
  MEDICAL: "Medical",
  BANK_FEES: "Bank fees",
  OTHER: "Other",
};

function roundCents(amount) {
  return Math.round(amount * 100) / 100;
}

function emptyTransactionStore() {
  return { cursors: {}, accounts: {}, transactions: {} };
}

function oldestDateToKeep(todayText) {
  const oldest = new Date(todayText + "T00:00:00Z");
  oldest.setUTCDate(oldest.getUTCDate() - KEEP_TRANSACTIONS_DAYS);
  return oldest.toISOString().slice(0, 10);
}

// Merges what the relay sent (new, changed and removed transactions) into the phone's saved copy.
function applyTransactionChanges(store, relayReply, todayText) {
  const updated = structuredClone(store);
  for (const item of relayReply.items || []) {
    updated.cursors[item.item_id] = item.next_cursor;
    for (const account of item.accounts || []) updated.accounts[account.account_id] = { ...account, login: item.login };
    for (const transaction of [...item.added, ...item.modified]) {
      // A posted charge replaces the pending one it came from.
      if (transaction.pending_transaction_id) delete updated.transactions[transaction.pending_transaction_id];
      updated.transactions[transaction.transaction_id] = transaction;
    }
    for (const removedId of item.removed) delete updated.transactions[removedId];
  }
  const oldest = oldestDateToKeep(todayText);
  for (const [transactionId, transaction] of Object.entries(updated.transactions)) {
    if (transaction.date < oldest) delete updated.transactions[transactionId];
  }
  return updated;
}

// Store names that override the bank's category. Names are compared with punctuation removed ("Trader Joe's" becomes "trader joes").
const GROCERY_STORES = /sprouts|trader joes?|whole foods|brookshire|kroger|walmart|target|\bheb\b|tom thumb|family dollar/;
const FOOD_STORES = /bucees/;
const TOLL_TEXT = /toll/;

function plainMerchantText(transaction) {
  return (String(transaction.merchant_name || "") + " " + String(transaction.name || "")).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

function categoryOf(transaction) {
  const text = plainMerchantText(transaction);
  if (/amazon|amzn/.test(text)) return "AMAZON";
  if (/TOLL/.test(String(transaction.category_detail || "")) || TOLL_TEXT.test(text)) return "TOLLS";
  if (GROCERY_STORES.test(text)) return "GROCERIES";
  if (FOOD_STORES.test(text)) return "FOOD_AND_DRINK";
  if (/sephora/.test(text) || transaction.category === "HOME_IMPROVEMENT") return "GENERAL_MERCHANDISE";
  if (/walgreens|lone star/.test(text)) return "MEDICAL";
  if (/csc serviceworks|airup|7eleven/.test(text)) return "TRANSPORTATION";
  if (/onxmaps/.test(text)) return "GENERAL_SERVICES";
  if (transaction.category === "GOVERNMENT_AND_NON_PROFIT") return "GENERAL_SERVICES";
  return transaction.category && CATEGORY_NAMES[transaction.category] ? transaction.category : "OTHER";
}

function merchantName(transaction) {
  return transaction.merchant_name || transaction.name || "Unknown";
}

// Everything that counts as spending (card and bank purchases, refunds as negatives), newest first.
function spendingCharges(store) {
  return Object.values(store.transactions)
    .filter((transaction) => !NOT_SPENDING_CATEGORIES.includes(transaction.category))
    .sort((first, second) => second.date.localeCompare(first.date));
}

function monthsWithSpending(charges) {
  return [...new Set(charges.map((charge) => charge.date.slice(0, 7)))].sort().reverse();
}

// One month, grouped by category, biggest first. Pending charges are included and counted separately too.
function monthlyBreakdown(charges, yearMonth) {
  const inMonth = charges.filter((charge) => charge.date.startsWith(yearMonth));
  const byCategory = {};
  for (const charge of inMonth) {
    const category = categoryOf(charge);
    byCategory[category] = byCategory[category] || { category, name: CATEGORY_NAMES[category], total: 0, charges: [] };
    byCategory[category].total = roundCents(byCategory[category].total + charge.amount);
    byCategory[category].charges.push(charge);
  }
  const categories = Object.values(byCategory).filter((entry) => entry.total > 0).sort((first, second) => second.total - first.total);
  const total = roundCents(categories.reduce((sum, entry) => sum + entry.total, 0));
  for (const entry of categories) entry.share = total > 0 ? Math.round((entry.total / total) * 100) : 0;
  const merchantTotals = {};
  for (const charge of inMonth) merchantTotals[merchantName(charge)] = roundCents((merchantTotals[merchantName(charge)] || 0) + charge.amount);
  const topMerchants = Object.entries(merchantTotals).filter(([, amount]) => amount > 0).sort((first, second) => second[1] - first[1]).slice(0, 5).map(([name, amount]) => ({ name, amount }));
  const pendingTotal = roundCents(inMonth.filter((charge) => charge.pending && charge.amount > 0).reduce((sum, charge) => sum + charge.amount, 0));
  return { yearMonth, total, categories, topMerchants, pendingTotal };
}

// This month against last month, by category. upToDay limits last month to the same days
// (for a month still in progress), so a half month is not compared with a whole one.
function previousYearMonth(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function monthComparison(charges, yearMonth, upToDay = 31) {
  const previousMonth = previousYearMonth(yearMonth);
  const current = monthlyBreakdown(charges, yearMonth);
  const previousCharges = charges.filter((charge) => Number(charge.date.slice(8, 10)) <= upToDay);
  const previous = monthlyBreakdown(previousCharges, previousMonth);
  const previousByCategory = Object.fromEntries(previous.categories.map((entry) => [entry.category, entry.total]));
  const names = new Set([...current.categories.map((entry) => entry.category), ...previous.categories.map((entry) => entry.category)]);
  const currentByCategory = Object.fromEntries(current.categories.map((entry) => [entry.category, entry.total]));
  const categories = [...names].map((category) => {
    const total = currentByCategory[category] || 0;
    const before = previousByCategory[category] || 0;
    return { category, name: CATEGORY_NAMES[category], total, previousTotal: before, difference: roundCents(total - before) };
  }).sort((first, second) => Math.abs(second.difference) - Math.abs(first.difference));
  return { previousMonth, total: current.total, previousTotal: previous.total, difference: roundCents(current.total - previous.total), hasPrevious: previous.total > 0, categories };
}

function pendingCharges(store) {
  return Object.values(store.transactions).filter((transaction) => transaction.pending && transaction.amount > 0).sort((first, second) => second.date.localeCompare(first.date));
}

// { accountId: total of that account's pending charges }
function pendingTotalsByAccount(store) {
  const totals = {};
  for (const charge of pendingCharges(store)) totals[charge.account_id] = roundCents((totals[charge.account_id] || 0) + charge.amount);
  return totals;
}

// Which bank account is this card? The refresh remembers each card by its last four digits.
function accountIdForCard(store, settings, cardKey) {
  const mask = (settings.card_masks || {})[cardKey];
  const match = Object.entries(store.accounts).find(([, account]) => account.mask === mask && account.type === "credit");
  return match ? match[0] : null;
}

function pendingChargesForCard(store, settings, cardKey) {
  const accountId = accountIdForCard(store, settings, cardKey);
  return accountId ? pendingCharges(store).filter((charge) => charge.account_id === accountId) : [];
}

// How much of this card's open statement is pending charges (0 if none).
function pendingAmountOnCard(card) {
  return roundCents(card.balances_by_statement.reduce((sum, statement) => sum + (statement.pending_amount || 0), 0));
}

if (typeof module !== "undefined") module.exports = { categoryOf, pendingAmountOnCard, emptyTransactionStore, applyTransactionChanges, spendingCharges, monthsWithSpending, monthlyBreakdown, monthComparison, previousYearMonth, pendingCharges, pendingTotalsByAccount, accountIdForCard, pendingChargesForCard, merchantName, CATEGORY_NAMES };
