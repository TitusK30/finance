// Forecast engine: walks day by day and tracks the checking balance.
// No money moves in here, it only reads the settings and does the math.

const WEEKDAY_NUMBERS = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

function toDateText(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateText, numberOfDays) {
  const date = new Date(dateText + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + numberOfDays);
  return toDateText(date);
}

function roundToCents(amount) {
  return Math.round(amount * 100) / 100;
}

// Day 31 in a 30-day month lands on the last day of that month.
function dayOfMonthOn(dateText, dayOfMonth) {
  const date = new Date(dateText + "T00:00:00Z");
  const lastDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return date.getUTCDate() === Math.min(dayOfMonth, lastDayOfMonth);
}

// Is this date a payday? frequency: weekly (default), biweekly (every other pay weekday, counted from biweekly_start_date),
// semimonthly (two days a month) or monthly (one day a month).
function isPaydayOn(paycheck, dateText) {
  const frequency = paycheck.frequency || "weekly";
  if (frequency === "monthly") return dayOfMonthOn(dateText, paycheck.month_day || 1);
  if (frequency === "semimonthly") return (paycheck.semimonthly_days || [1, 15]).some((day) => dayOfMonthOn(dateText, day));
  if (new Date(dateText + "T00:00:00Z").getUTCDay() !== WEEKDAY_NUMBERS[paycheck.pay_weekday]) return false;
  if (frequency === "biweekly" && paycheck.biweekly_start_date) {
    const weeksApart = Math.round((new Date(dateText + "T00:00:00Z") - new Date(paycheck.biweekly_start_date + "T00:00:00Z")) / (7 * 86400000));
    return weeksApart % 2 === 0;
  }
  return true;
}

function paychecksPerYear(paycheck) {
  return { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[paycheck.frequency || "weekly"] || 52;
}

// Which statement a new charge lands on, and the date that statement is due.
function dueDateForCharge(card, chargeDate) {
  let closeDate = chargeDate.slice(0, 8) + String(card.statement_close_day).padStart(2, "0");
  if (closeDate < chargeDate) closeDate = addDays(closeDate.slice(0, 8) + "01", 32).slice(0, 8) + String(card.statement_close_day).padStart(2, "0");
  const closeMonthStart = new Date(closeDate.slice(0, 8) + "01T00:00:00Z");
  const monthsToAdd = card.payment_due_in_following_month ? 1 : 0;
  const dueMonth = new Date(Date.UTC(closeMonthStart.getUTCFullYear(), closeMonthStart.getUTCMonth() + monthsToAdd, card.payment_due_day));
  return toDateText(dueMonth);
}

// How many days from today until the statement due on dueDate closes (0 when it closes today).
function daysUntilStatementCloses(card, dueDate, today) {
  const monthsBack = card.payment_due_in_following_month ? 1 : 0;
  const dueMonthStart = new Date(dueDate.slice(0, 8) + "01T00:00:00Z");
  const closeDate = toDateText(new Date(Date.UTC(dueMonthStart.getUTCFullYear(), dueMonthStart.getUTCMonth() - monthsBack, card.statement_close_day)));
  return Math.max(0, Math.round((Date.parse(closeDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000));
}

// whatIfPurchases: [{ label, amount, date, paid_with: "checking" or a card key }]
// Paydays whose paycheck already arrived early (set from the bank's deposits), so the forecast does not add it twice.
let paidEarlyDates = [];
function setPaidEarlyDates(dates) { paidEarlyDates = dates || []; }
// Bills paid from checking that are due today and not yet seen leaving the bank ([{name, amount, varies}]); they come out today.
let unpaidBillsDueToday = [];
function setUnpaidBillsDueToday(bills) { unpaidBillsDueToday = bills || []; }
// Paychecks typed in by hand ([{date, amount}]) that are added on their own date.
let typedPaychecks = [];
function setTypedPaychecks(paychecks) { typedPaychecks = paychecks || []; }

function buildForecast(settings, horizonDays, whatIfPurchases = []) {
  const startDate = settings.starting_balances.as_of_date;
  const lastDate = addDays(startDate, horizonDays);
  // Optional everyday spending: the monthly allowance, taken out of checking in one weekly piece each Sunday.
  const weeklyEverydaySpending = roundToCents(((settings.optional_monthly_variable_spending_allowance || 0) * 12) / 52);

  // Card payments coming out of checking, keyed by due date.
  const cardPaymentsByDueDate = {};
  // isOpen: the amount comes from a statement still accumulating (it can grow); otherwise the statement is closed and final.
  function scheduleCardPayment(dueDate, amount, label, isOpen = true, card = null) {
    cardPaymentsByDueDate[dueDate] = cardPaymentsByDueDate[dueDate] || [];
    const existingPayment = cardPaymentsByDueDate[dueDate].find((payment) => payment.label === label);
    if (existingPayment) { existingPayment.amount = roundToCents(existingPayment.amount + amount); existingPayment.isOpen = existingPayment.isOpen || isOpen; }
    else cardPaymentsByDueDate[dueDate].push({ label, amount, isOpen, card });
  }

  for (const card of Object.values(settings.credit_cards)) {
    for (const statement of card.balances_by_statement) {
      // Past due and still owed: it comes out today.
      scheduleCardPayment(statement.due_date < startDate ? startDate : statement.due_date, statement.amount, card.display_name + " payment", Boolean(statement.still_accumulating), card);
    }
  }

  // Future subscription charges pile onto the statement they fall in.
  const subscriptions = settings.subscriptions_charged_to_cards || [];
  for (let date = addDays(startDate, 1); date <= lastDate; date = addDays(date, 1)) {
    for (const subscription of subscriptions) {
      const chargeDays = subscription.assumed_days_of_month || [subscription.day_of_month];
      const isChargedToday = chargeDays.some((day) => day && dayOfMonthOn(date, day));
      if (!isChargedToday) continue;
      const card = settings.credit_cards[subscription.card];
      scheduleCardPayment(dueDateForCharge(card, date), subscription.amount, card.display_name + " payment", true, card);
    }
    // Annual fees post once a year on their month and day.
    for (const fee of settings.annual_card_fees || []) {
      if (Number(date.slice(5, 7)) !== fee.month || !dayOfMonthOn(date, fee.day)) continue;
      const card = settings.credit_cards[fee.card];
      scheduleCardPayment(dueDateForCharge(card, date), fee.amount, card.display_name + " payment", true, card);
    }
  }

  // What-if purchases: a card purchase joins its statement, a checking purchase hits that day.
  const whatIfCheckingPurchases = [];
  const firstForecastDate = addDays(startDate, 1);
  for (const originalPurchase of whatIfPurchases) {
    const purchase = { ...originalPurchase, date: originalPurchase.date < firstForecastDate ? firstForecastDate : originalPurchase.date };
    if (purchase.paid_with === "checking") {
      whatIfCheckingPurchases.push(purchase);
    } else {
      const card = settings.credit_cards[purchase.paid_with];
      scheduleCardPayment(dueDateForCharge(card, purchase.date), purchase.amount, card.display_name + " payment", true, card);
    }
  }

  const days = [];
  let checkingBalance = settings.starting_balances.checking_balance;

  // Today: a card statement due today that the bank still shows as owed has not left checking yet, so it comes out now.
  const todayBills = unpaidBillsDueToday.map((bill) => ({ label: bill.name, amount: -bill.amount, is_estimate: Boolean(bill.varies) }));
  const todayEvents = [...todayBills, ...(cardPaymentsByDueDate[startDate] || []).map((cardPayment) => ({ label: cardPayment.label, amount: -cardPayment.amount, card_state: cardPayment.isOpen ? "open" : "closed" }))];
  for (const event of todayEvents) checkingBalance = roundToCents(checkingBalance + event.amount);
  const today = { date: startDate, events: todayEvents, checking_balance: checkingBalance };

  for (let date = addDays(startDate, 1); date <= lastDate; date = addDays(date, 1)) {
    const events = [];
    const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();

    if (isPaydayOn(settings.paycheck, date) && !paidEarlyDates.includes(date)) {
      const paycheckAmount = settings.paycheck.one_time_amount_overrides[date] ?? settings.paycheck.usual_take_home_amount;
      events.push({ label: "Paycheck", amount: paycheckAmount });
    }
    for (const typed of typedPaychecks) if (typed.date === date || (date === firstForecastDate && typed.date <= startDate)) events.push({ label: "Paycheck", amount: typed.amount });

    if (weeklyEverydaySpending > 0 && dayOfWeek === 0) events.push({ label: "Everyday spending", amount: -weeklyEverydaySpending, is_estimate: true });

    for (const bill of settings.monthly_bills_paid_from_checking) {
      if (dayOfMonthOn(date, bill.day_of_month)) {
        events.push({ label: bill.name, amount: -bill.amount, is_estimate: Boolean(bill.is_estimate) });
      }
    }

    for (const purchase of whatIfCheckingPurchases) {
      if (purchase.date === date) events.push({ label: purchase.label, amount: -purchase.amount });
    }

    for (const cardPayment of cardPaymentsByDueDate[date] || []) {
      const cardEvent = { label: cardPayment.label, amount: -cardPayment.amount, card_state: cardPayment.isOpen ? "open" : "closed" };
      if (cardPayment.isOpen && cardPayment.card) cardEvent.days_until_close = daysUntilStatementCloses(cardPayment.card, date, startDate);
      events.push(cardEvent);
    }

    for (const event of events) checkingBalance = roundToCents(checkingBalance + event.amount);
    days.push({ date, events, checking_balance: checkingBalance });
  }

  const lowestDay = days.reduce((lowest, day) => (day.checking_balance < lowest.checking_balance ? day : lowest), today);
  const floor = settings.minimum_checking_floor;
  const firstDayBelowFloor = days.find((day) => day.checking_balance < floor) || null;

  return {
    today,
    days,
    lowest_balance: lowestDay.checking_balance,
    lowest_balance_date: lowestDay.date,
    first_day_below_floor: firstDayBelowFloor ? firstDayBelowFloor.date : null,
    // Move this much from savings to keep the lowest point at the floor.
    savings_transfer_needed: roundToCents(Math.max(0, floor - lowestDay.checking_balance)),
    // The move has to land before checking first slips under the floor.
    savings_transfer_by_date: firstDayBelowFloor ? firstDayBelowFloor.date : null,
  };
}

// The most you could put on your cards over the whole forecast, all cards together, and still stay above the floor.
// Careful by design: it counts the spending as coming out of checking on the tightest day.
function cardRoom(forecast, floor) {
  const tightest = forecast.days.reduce((lowest, day) => (day.checking_balance < lowest.checking_balance ? day : lowest), forecast.days[0]);
  return { amount: roundToCents(Math.max(0, tightest.checking_balance - floor)), tightestDate: tightest.date, days: forecast.days.length };
}

function balanceOn(forecast, dateText) {
  return forecast.days.find((day) => day.date === dateText)?.checking_balance;
}

// Lets the same file run in a browser (plain script) and in the tests.
if (typeof module !== "undefined") module.exports = { setUnpaidBillsDueToday, setTypedPaychecks, setPaidEarlyDates, buildForecast, cardRoom, balanceOn, dueDateForCharge, isPaydayOn, paychecksPerYear };
