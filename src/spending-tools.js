// Spending tools: search and filter, the daily pace line, budgets, merchant rules from one charge, and the recurring-charge detector.
// Pure math. It never touches the page or the network.
if (typeof require !== "undefined" && typeof categoryOf === "undefined") { var { categoryOf, merchantName, plainMerchantText, previousYearMonth, categoryDisplayName } = require("./spending.js"); }

const SPENDING_PERIODS = [["shown", "Month shown"], ["this", "This month"], ["last", "Last month"], ["all", "All history"]];

function centsOf(amount) {
  return Math.round(amount * 100) / 100;
}

function emptySpendingFilter() {
  return { cards: [], categories: [], minAmount: null, maxAmount: null, pendingOnly: false, period: "shown", search: "" };
}

function spendingFilterIsOn(filter) {
  return Boolean(String(filter.search || "").trim()) || filter.cards.length > 0 || filter.categories.length > 0 || filter.minAmount != null || filter.maxAmount != null || filter.pendingOnly || filter.period !== "shown";
}

// Charges that pass every part of the filter. Every word typed in search must appear in the charge's text or category name.
function filterCharges(charges, filter, shownMonth, todayDate) {
  const words = plainMerchantText({ name: filter.search }).split(" ").filter(Boolean);
  const thisMonth = todayDate.slice(0, 7);
  const monthWanted = { shown: shownMonth, this: thisMonth, last: previousYearMonth(thisMonth), all: null }[filter.period];
  return charges.filter((charge) => {
    if (monthWanted && !charge.date.startsWith(monthWanted)) return false;
    if (filter.cards.length && !filter.cards.includes(charge.account_id)) return false;
    const category = categoryOf(charge);
    if (filter.categories.length && !filter.categories.includes(category)) return false;
    if (filter.pendingOnly && !charge.pending) return false;
    if (filter.minAmount != null && charge.amount < filter.minAmount) return false;
    if (filter.maxAmount != null && charge.amount > filter.maxAmount) return false;
    const haystack = plainMerchantText(charge) + " " + categoryDisplayName(category).toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

function chargeTotals(charges) {
  const spent = charges.filter((charge) => charge.amount > 0);
  const total = centsOf(charges.reduce((sum, charge) => sum + charge.amount, 0));
  return { count: charges.length, total, average: spent.length ? centsOf(spent.reduce((sum, charge) => sum + charge.amount, 0) / spent.length) : 0, biggest: spent.length ? Math.max(...spent.map((charge) => charge.amount)) : 0 };
}

// ---- Daily pace: running total by day for the month shown and for the month before it.
function daysInYearMonth(yearMonth) {
  return new Date(Date.UTC(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)), 0)).getUTCDate();
}

function runningTotalByDay(charges, yearMonth, lastDay) {
  const perDay = new Array(lastDay + 1).fill(0);
  for (const charge of charges) if (charge.date.startsWith(yearMonth) && Number(charge.date.slice(8, 10)) <= lastDay) perDay[Number(charge.date.slice(8, 10))] += charge.amount;
  const running = [];
  let sum = 0;
  for (let day = 1; day <= lastDay; day++) { sum += perDay[day]; running.push(centsOf(sum)); }
  return running;
}

function dailyPace(charges, yearMonth, todayDate) {
  const previousMonth = previousYearMonth(yearMonth);
  const isCurrent = todayDate.startsWith(yearMonth);
  const lastDayShown = isCurrent ? Number(todayDate.slice(8, 10)) : daysInYearMonth(yearMonth);
  const thisMonth = runningTotalByDay(charges, yearMonth, lastDayShown);
  const lastMonth = runningTotalByDay(charges, previousMonth, daysInYearMonth(previousMonth));
  const lastAtSameDay = lastMonth[Math.min(lastDayShown, lastMonth.length) - 1] || 0;
  const thisToDate = thisMonth[thisMonth.length - 1] || 0;
  return { thisMonth, lastMonth, lastDayShown, daysInMonth: Math.max(daysInYearMonth(yearMonth), lastMonth.length), thisToDate, lastAtSameDay, difference: centsOf(thisToDate - lastAtSameDay), hasLastMonth: lastMonth.some((amount) => amount !== 0) };
}

// ---- Budgets: settings.category_budgets = { CATEGORY: monthly limit }. Spent = that category's total for the month.
function budgetRows(settings, monthBreakdown) {
  const spentByCategory = Object.fromEntries(monthBreakdown.categories.map((entry) => [entry.category, entry.total]));
  return Object.entries(settings.category_budgets || {}).filter(([, limit]) => limit > 0).map(([category, limit]) => {
    const spent = spentByCategory[category] || 0;
    const percent = Math.round((spent / limit) * 100);
    return { category, name: categoryDisplayName(category), limit, spent, percent, left: centsOf(limit - spent), state: percent > 100 ? "over" : percent >= 85 ? "near" : "ok" };
  }).sort((first, second) => second.percent - first.percent);
}

// ---- Merchant rules: the words of a charge's merchant (up to three, no numbers) become a rule for every charge with that text.
function merchantRuleText(charge) {
  const source = charge.merchant_name || charge.name || "";
  const words = plainMerchantText({ name: source }).split(" ").filter((word) => word && !/^\d+$/.test(word));
  const text = words.slice(0, 3).join(" ");
  return text.length >= 3 ? text : "";
}

function chargesWithText(charges, ruleText) {
  return ruleText ? charges.filter((charge) => plainMerchantText(charge).includes(ruleText)) : [];
}

// Saves the rule (replacing an older rule for the same text) and clears hand-picked categories on those charges so the rule applies.
function applyMerchantRule(settings, ruleText, category, matchingCharges) {
  settings.merchant_rules = [...(settings.merchant_rules || []).filter((rule) => rule.text !== ruleText), { text: ruleText, category }];
  settings.transaction_categories = { ...(settings.transaction_categories || {}) };
  for (const charge of matchingCharges) delete settings.transaction_categories[charge.transaction_id];
}

// ---- Recurring detector: a merchant charged once a month, about the same amount and day, in each of the last few months in a row.
function monthCounter(yearMonth) {
  return Number(yearMonth.slice(0, 4)) * 12 + Number(yearMonth.slice(5, 7));
}

function recurringCandidates(charges, todayDate, dismissedKeys = []) {
  const byKey = {};
  for (const charge of charges) {
    if (charge.pending || !(charge.amount > 0)) continue;
    const key = merchantRuleText(charge);
    if (!key || dismissedKeys.includes(key)) continue;
    (byKey[key] = byKey[key] || []).push(charge);
  }
  const candidates = [];
  for (const [key, list] of Object.entries(byKey)) {
    const byMonth = {};
    for (const charge of list) (byMonth[charge.date.slice(0, 7)] = byMonth[charge.date.slice(0, 7)] || []).push(charge);
    const months = Object.keys(byMonth).sort().reverse();
    if (monthCounter(todayDate.slice(0, 7)) - monthCounter(months[0]) > 1) continue; // not charged this month or last month
    const run = [];
    for (const month of months) {
      if (run.length && monthCounter(run[run.length - 1]) - monthCounter(month) !== 1) break;
      if (byMonth[month].length !== 1) break;
      run.push(month);
    }
    if (run.length < 2) continue;
    const runCharges = run.map((month) => byMonth[month][0]);
    const amounts = runCharges.map((charge) => charge.amount);
    const days = runCharges.map((charge) => Number(charge.date.slice(8, 10)));
    if (Math.max(...amounts) - Math.min(...amounts) > Math.max(1, Math.max(...amounts) * 0.05)) continue;
    if (Math.max(...days) - Math.min(...days) > 4) continue;
    const latest = runCharges[0];
    candidates.push({ key, name: merchantName(latest), amount: latest.amount, day: Number(latest.date.slice(8, 10)), accountId: latest.account_id, monthsSeen: run.length });
  }
  return candidates.sort((first, second) => second.amount - first.amount);
}

// Where a detected charge would live in settings: a card subscription (the card's saved key) or a checking bill.
function payerForAccount(settings, account) {
  if (!account) return null;
  if (account.type === "credit") {
    const cardKey = Object.keys(settings.credit_cards || {}).find((key) => (settings.card_masks || {})[key] === account.mask);
    return cardKey ? { kind: "sub", cardKey } : null;
  }
  return account.type === "depository" ? { kind: "bill" } : null;
}

function addRecurringToSettings(settings, candidate, payer) {
  const words = plainMerchantText({ name: candidate.name }).split(" ").filter((word) => word.length >= 3);
  const item = { name: candidate.name, amount: candidate.amount, day_of_month: candidate.day, ...(words.length ? { charge_text_contains: words } : {}) };
  if (payer.kind === "sub") settings.subscriptions_charged_to_cards = [...(settings.subscriptions_charged_to_cards || []), { ...item, card: payer.cardKey }];
  else settings.monthly_bills_paid_from_checking = [...(settings.monthly_bills_paid_from_checking || []), item];
}

if (typeof module !== "undefined") module.exports = { SPENDING_PERIODS, emptySpendingFilter, spendingFilterIsOn, filterCharges, chargeTotals, dailyPace, budgetRows, merchantRuleText, chargesWithText, applyMerchantRule, recurringCandidates, payerForAccount, addRecurringToSettings };
