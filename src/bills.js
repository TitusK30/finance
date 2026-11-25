// Finds which charges are your recurring monthly bills and subscriptions, so the Spending page can leave them out.
// Pure math. It never talks to the network.
//
// A charge counts as a bill when it fits a bill from your settings by amount, timing and account:
//  - subscriptions are on a card: the charge must be on that card
//  - bills are paid from checking: the charge must be on a bank (deposit) account
// Bills whose amount changes every month (like electricity) are matched by timing plus a utilities-style category.

const BILL_DATE_WINDOW_DAYS = 4;
const VARIABLE_BILL_WINDOW_DAYS = 7;

function dayNumber(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

function dueDateInMonth(yearMonth, dayOfMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return yearMonth + "-" + String(Math.min(dayOfMonth, lastDay)).padStart(2, "0");
}

function monthBefore(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function nameWords(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length >= 4);
}

// Your bills and subscriptions as one list.
function recurringBills(settings) {
  const bills = (settings.monthly_bills_paid_from_checking || []).map((bill) => ({
    name: bill.name, amount: bill.amount, days: [bill.day_of_month], kind: "bill", cardKey: null,
    varies: Boolean(bill.amount_changes_every_month), anyDay: false,
  }));
  const subscriptions = (settings.subscriptions_charged_to_cards || []).map((subscription) => ({
    name: subscription.name, amount: subscription.amount, days: subscription.assumed_days_of_month || [subscription.day_of_month], kind: "subscription",
    cardKey: subscription.card, varies: false, anyDay: Boolean(subscription.refills_when_needed),
  }));
  return [...bills, ...subscriptions];
}

function billMarkKey(charge) {
  return String(charge.merchant_name || charge.name || "").toLowerCase().trim() + "|" + charge.amount.toFixed(2);
}

function onRightAccount(bill, charge, store, settings) {
  const account = store.accounts[charge.account_id];
  if (!account) return false;
  if (bill.kind === "bill") return account.type === "depository";
  return account.type === "credit" && account.mask === (settings.card_masks || {})[bill.cardKey];
}

function amountFits(bill, charge) {
  if (bill.varies) return charge.amount >= bill.amount * 0.3 && charge.amount <= bill.amount * 3;
  return Math.abs(charge.amount - bill.amount) <= Math.max(1, bill.amount * 0.05);
}

function categoryHint(bill, charge) {
  const detail = String(charge.category_detail || "");
  if (bill.varies) return charge.category === "RENT_AND_UTILITIES" || /ELECTRIC|UTILIT/.test(detail);
  if (bill.anyDay) return /TOLL/.test(detail) || nameWords(bill.name).some((word) => String(charge.merchant_name || charge.name || "").toLowerCase().includes(word));
  return true;
}

// userMarks: ["merchant|12.34", ...] charges you marked as bills by hand.
// Returns { billCharges: { transactionId: billName }, byMonth: { "2026-11": { seen: [{bill, charge}], unseen: [bill] } } }
function matchBills(settings, store, userMarks = [], todayText = "9999-12-31") {
  const bills = recurringBills(settings);
  const charges = Object.values(store.transactions).filter((charge) => charge.amount > 0).sort((first, second) => first.date.localeCompare(second.date));
  const billCharges = {};
  const byMonth = {};
  if (charges.length === 0) return { billCharges, byMonth };
  const firstDate = charges[0].date;
  const months = [...new Set(charges.map((charge) => charge.date.slice(0, 7)))].sort();
  const monthsToCheck = [...new Set([...months, ...months.map(monthBefore)])].sort();

  for (const yearMonth of monthsToCheck) {
    const seen = [];
    const unseen = [];
    for (const bill of bills) {
      for (const day of bill.days) {
        const expected = dueDateInMonth(yearMonth, day);
        const window = bill.anyDay ? 31 : bill.varies ? VARIABLE_BILL_WINDOW_DAYS : BILL_DATE_WINDOW_DAYS;
        const candidates = charges.filter((charge) => !billCharges[charge.transaction_id] && onRightAccount(bill, charge, store, settings) && amountFits(bill, charge) && categoryHint(bill, charge)
          && (bill.anyDay ? charge.date.startsWith(yearMonth) : Math.abs(dayNumber(charge.date) - dayNumber(expected)) <= window));
        // A refill-style bill can show up several times a month. Others match once per due day, nearest date first.
        const best = bill.anyDay ? candidates : candidates.sort((first, second) => Math.abs(dayNumber(first.date) - dayNumber(expected)) - Math.abs(dayNumber(second.date) - dayNumber(expected))).slice(0, 1);
        for (const charge of best) { billCharges[charge.transaction_id] = bill.name; seen.push({ bill, charge }); }
        if (best.length === 0 && !bill.anyDay && expected <= todayText && expected >= firstDate) unseen.push({ ...bill, expected });
      }
    }
    byMonth[yearMonth] = { seen, unseen };
  }
  for (const charge of charges) {
    if (!billCharges[charge.transaction_id] && userMarks.includes(billMarkKey(charge))) billCharges[charge.transaction_id] = "Marked by you";
  }
  return { billCharges, byMonth };
}

if (typeof module !== "undefined") module.exports = { matchBills, recurringBills, billMarkKey };
