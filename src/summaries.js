// Plain math for the Subscriptions, Rewards and HSA pages. No screen code in here.

function roundMoney(amount) {
  return Math.round(amount * 100) / 100;
}

// The toll tag refills about 3 times a month, so its monthly cost is amount x refills.
function monthlyAmountOfSubscription(subscription) {
  const chargesPerMonth = subscription.assumed_days_of_month ? subscription.assumed_days_of_month.length : 1;
  return roundMoney(subscription.amount * chargesPerMonth);
}

// Everything on this list shows on the Expenses tab. Anything else shows on Subs.
const EXPENSE_ITEM_NAMES = ["Auto/Renters insurance", "Toll tag (auto refill)", "Car payment", "Electricity", "Rent (first half)", "Rent (second half)"];

// Card subscriptions and checking bills in one list, filtered to one tab.
function monthlyItemsForTab(settings, tabName) {
  const itemsOnCards = settings.subscriptions_charged_to_cards.map((subscription) => ({
    name: subscription.name,
    paidFrom: subscription.card,
    monthlyAmount: monthlyAmountOfSubscription(subscription),
    amountEach: subscription.amount,
    dayOfMonth: subscription.day_of_month || null,
    refillsPerMonth: subscription.assumed_days_of_month ? subscription.assumed_days_of_month.length : null,
    firstAssumedDay: subscription.assumed_days_of_month ? subscription.assumed_days_of_month[0] : null,
    isEstimate: Boolean(subscription.assumed_days_of_month),
  }));
  const itemsFromChecking = settings.monthly_bills_paid_from_checking.map((bill) => ({
    name: bill.name,
    paidFrom: "checking",
    monthlyAmount: bill.amount,
    amountEach: bill.amount,
    dayOfMonth: bill.day_of_month,
    refillsPerMonth: null,
    isEstimate: Boolean(bill.is_estimate),
  }));
  // Sorted by day of the month. The toll tag has no fixed day, so it sits at its first assumed refill day.
  const dayToSortBy = (item) => item.dayOfMonth || item.firstAssumedDay;
  return [...itemsOnCards, ...itemsFromChecking]
    .filter((item) => (EXPENSE_ITEM_NAMES.includes(item.name) ? "expenses" : "subscriptions") === tabName)
    .sort((first, second) => dayToSortBy(first) - dayToSortBy(second) || first.name.localeCompare(second.name));
}

function totalsForItems(items) {
  const totalsByPayer = {};
  let monthlyTotal = 0;
  for (const item of items) {
    monthlyTotal = roundMoney(monthlyTotal + item.monthlyAmount);
    totalsByPayer[item.paidFrom] = roundMoney((totalsByPayer[item.paidFrom] || 0) + item.monthlyAmount);
  }
  return { monthlyTotal, totalsByPayer };
}

function benefitRemaining(benefit) {
  return roundMoney(Math.max(0, benefit.total - (benefit.used || 0)));
}

function hsaMonthlyContribution(hsa) {
  return roundMoney(((hsa.weekly_contribution || 0) * 52) / 12);
}

function hsaMonthsUntilBillPaidOff(hsa) {
  if (hsa.medical_bill_remaining == null || !hsa.monthly_bill_payment) return null;
  return Math.ceil(hsa.medical_bill_remaining / hsa.monthly_bill_payment);
}

// Balance after N months of contributions, minus bill payments until the bill is gone.
function hsaBalanceAfterMonths(hsa, months) {
  const billPaymentsIfNoLimit = months * (hsa.monthly_bill_payment || 0);
  const billPaid = hsa.medical_bill_remaining == null ? billPaymentsIfNoLimit : Math.min(hsa.medical_bill_remaining, billPaymentsIfNoLimit);
  return roundMoney((hsa.balance || 0) + months * (((hsa.weekly_contribution || 0) * 52) / 12) - billPaid);
}

// ---- Credit utilization planner ----

function addDaysToDateText(dateText, numberOfDays) {
  const date = new Date(dateText + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + numberOfDays);
  return date.toISOString().slice(0, 10);
}

// Day 31 in a 30-day month lands on the last day of that month.
function isDayOfMonth(dateText, dayOfMonth) {
  const [year, month, day] = dateText.split("-").map(Number);
  return day === Math.min(dayOfMonth, new Date(Date.UTC(year, month, 0)).getUTCDate());
}

// The first statement close after the as-of date.
function nextStatementCloseDate(card, asOfDateText) {
  for (let offset = 1; offset <= 31; offset++) {
    const date = addDaysToDateText(asOfDateText, offset);
    if (isDayOfMonth(date, card.statement_close_day)) return date;
  }
}

function cardPurchasesBetween(settings, cardKey, afterDateText, throughDateText) {
  let total = 0;
  for (let date = addDaysToDateText(afterDateText, 1); date <= throughDateText; date = addDaysToDateText(date, 1)) {
    for (const subscription of settings.subscriptions_charged_to_cards) {
      if (subscription.card !== cardKey) continue;
      const chargeDays = subscription.assumed_days_of_month || [subscription.day_of_month];
      if (chargeDays.some((chargeDay) => chargeDay && isDayOfMonth(date, chargeDay))) total = roundMoney(total + subscription.amount);
    }
    for (const fee of settings.annual_card_fees || []) {
      if (fee.card === cardKey && Number(date.slice(5, 7)) === fee.month && isDayOfMonth(date, fee.day)) total = roundMoney(total + fee.amount);
    }
  }
  return total;
}

// What one card will most likely report at its next statement close.
function cardUtilizationPlan(settings, cardKey, targetPercent) {
  const card = settings.credit_cards[cardKey];
  const asOfDate = settings.starting_balances.as_of_date;
  const closeDate = nextStatementCloseDate(card, asOfDate);
  const openStatement = card.balances_by_statement.find((statement) => statement.still_accumulating);
  const openBalanceNow = openStatement ? openStatement.amount : 0;
  const projectedStatement = roundMoney(openBalanceNow + cardPurchasesBetween(settings, cardKey, asOfDate, closeDate));
  const targetAmount = roundMoney((card.credit_limit * targetPercent) / 100);
  return {
    closeDate,
    daysUntilClose: Math.round((new Date(closeDate) - new Date(asOfDate)) / 86400000),
    openBalanceIsGuess: !openStatement,
    projectedStatement,
    projectedPercent: roundMoney((projectedStatement / card.credit_limit) * 100),
    targetAmount,
    spendRoom: roundMoney(Math.max(0, targetAmount - projectedStatement)),
    payDownNeeded: roundMoney(Math.max(0, projectedStatement - targetAmount)),
  };
}

// Everything you have minus what you owe on cards. Unset balances count as zero.
function netWorth(settings) {
  const owedOnCards = Object.values(settings.credit_cards).reduce((sum, card) => sum + card.current_balance, 0);
  return roundMoney(
    settings.starting_balances.checking_balance + settings.starting_balances.savings_balance +
    (settings.retirement.balance || 0) + (settings.hsa.balance || 0) - owedOnCards);
}

// ---- Overtime planner ----

const PAY_WEEKDAY_NUMBERS = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

// The pay period ends on payday's weekday (Friday 11:59pm). Overtime is paid one week after that.
function paydayForWorkDate(settings, workDateText) {
  const periodEndsOnWeekday = PAY_WEEKDAY_NUMBERS[settings.paycheck.pay_weekday];
  let periodEndDate = workDateText;
  while (new Date(periodEndDate + "T00:00:00Z").getUTCDay() !== periodEndsOnWeekday) periodEndDate = addDaysToDateText(periodEndDate, 1);
  return addDaysToDateText(periodEndDate, settings.overtime.paid_days_after_period_ends ?? 7);
}

// The lowest checking balance on or after a date.
function lowestBalanceFrom(forecast, fromDateText) {
  return Math.min(...forecast.days.filter((day) => day.date >= fromDateText).map((day) => day.checking_balance));
}

// A copy of the settings where planned overtime is added onto those paychecks.
// plannedOvertime: [{ payday, hours }]
function settingsWithOvertime(settings, plannedOvertime) {
  const plannedSettings = structuredClone(settings);
  const overrides = plannedSettings.paycheck.one_time_amount_overrides;
  for (const entry of plannedOvertime) {
    const paycheckBeforeOvertime = overrides[entry.payday] ?? plannedSettings.paycheck.usual_take_home_amount;
    overrides[entry.payday] = roundMoney(paycheckBeforeOvertime + entry.hours * settings.overtime.take_home_per_overtime_hour);
  }
  return plannedSettings;
}

// ---- Card expiry and annual fees ----

// The next time a month/day comes around, strictly after the as-of date.
function nextYearlyDate(asOfDateText, month, day) {
  for (let offset = 1; offset <= 366; offset++) {
    const date = addDaysToDateText(asOfDateText, offset);
    if (Number(date.slice(5, 7)) === month && isDayOfMonth(date, day)) return date;
  }
}

// A card is good through the last day of its expiry month. expiresMonth looks like "2027-03".
function cardExpiryStatus(expiresMonth, asOfDateText) {
  const [year, month] = expiresMonth.split("-").map(Number);
  const lastGoodDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const daysLeft = Math.round((new Date(lastGoodDate) - new Date(asOfDateText)) / 86400000);
  return { label: `${String(month).padStart(2, "0")}/${String(year).slice(2)}`, lastGoodDate, daysLeft, isExpiringSoon: daysLeft <= 90 };
}

function nextAnnualFeeFor(settings, cardKey) {
  const feePosition = (settings.annual_card_fees || []).findIndex((fee) => fee.card === cardKey);
  if (feePosition === -1) return null;
  const fee = settings.annual_card_fees[feePosition];
  const asOfDate = settings.starting_balances.as_of_date;
  const date = nextYearlyDate(asOfDate, fee.month, fee.day);
  return { feePosition, amount: fee.amount, date, daysUntil: Math.round((new Date(date) - new Date(asOfDate)) / 86400000) };
}

function totalAnnualFees(settings) {
  return roundMoney((settings.annual_card_fees || []).reduce((sum, fee) => sum + fee.amount, 0));
}

if (typeof module !== "undefined") {
  module.exports = { monthlyAmountOfSubscription, monthlyItemsForTab, totalsForItems, benefitRemaining, hsaMonthlyContribution, hsaMonthsUntilBillPaidOff, hsaBalanceAfterMonths, nextStatementCloseDate, cardUtilizationPlan, netWorth, paydayForWorkDate, lowestBalanceFrom, settingsWithOvertime, nextYearlyDate, cardExpiryStatus, nextAnnualFeeFor, totalAnnualFees };
}
