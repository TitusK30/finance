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

// Which statement a new charge lands on, and the date that statement is due.
function dueDateForCharge(card, chargeDate) {
  let closeDate = chargeDate.slice(0, 8) + String(card.statement_close_day).padStart(2, "0");
  if (closeDate < chargeDate) closeDate = addDays(closeDate.slice(0, 8) + "01", 32).slice(0, 8) + String(card.statement_close_day).padStart(2, "0");
  const closeMonthStart = new Date(closeDate.slice(0, 8) + "01T00:00:00Z");
  const monthsToAdd = card.payment_due_in_following_month ? 1 : 0;
  const dueMonth = new Date(Date.UTC(closeMonthStart.getUTCFullYear(), closeMonthStart.getUTCMonth() + monthsToAdd, card.payment_due_day));
  return toDateText(dueMonth);
}

// whatIfPurchases: [{ label, amount, date, paid_with: "checking" or a card key }]
function buildForecast(settings, horizonDays, whatIfPurchases = []) {
  const startDate = settings.starting_balances.as_of_date;
  const lastDate = addDays(startDate, horizonDays);
  const payWeekdayNumber = WEEKDAY_NUMBERS[settings.paycheck.pay_weekday];

  // Card payments coming out of checking, keyed by due date.
  const cardPaymentsByDueDate = {};
  function scheduleCardPayment(dueDate, amount, label) {
    cardPaymentsByDueDate[dueDate] = cardPaymentsByDueDate[dueDate] || [];
    const existingPayment = cardPaymentsByDueDate[dueDate].find((payment) => payment.label === label);
    if (existingPayment) existingPayment.amount = roundToCents(existingPayment.amount + amount);
    else cardPaymentsByDueDate[dueDate].push({ label, amount });
  }

  for (const card of Object.values(settings.credit_cards)) {
    for (const statement of card.balances_by_statement) {
      scheduleCardPayment(statement.due_date, statement.amount, card.display_name + " payment");
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
      scheduleCardPayment(dueDateForCharge(card, date), subscription.amount, card.display_name + " payment");
    }
    // Annual fees post once a year on their month and day.
    for (const fee of settings.annual_card_fees || []) {
      if (Number(date.slice(5, 7)) !== fee.month || !dayOfMonthOn(date, fee.day)) continue;
      const card = settings.credit_cards[fee.card];
      scheduleCardPayment(dueDateForCharge(card, date), fee.amount, card.display_name + " payment");
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
      scheduleCardPayment(dueDateForCharge(card, purchase.date), purchase.amount, card.display_name + " payment");
    }
  }

  const days = [];
  let checkingBalance = settings.starting_balances.checking_balance;

  for (let date = addDays(startDate, 1); date <= lastDate; date = addDays(date, 1)) {
    const events = [];
    const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();

    if (dayOfWeek === payWeekdayNumber) {
      const paycheckAmount = settings.paycheck.one_time_amount_overrides[date] ?? settings.paycheck.usual_take_home_amount;
      events.push({ label: "Paycheck", amount: paycheckAmount });
    }

    for (const bill of settings.monthly_bills_paid_from_checking) {
      if (dayOfMonthOn(date, bill.day_of_month)) {
        events.push({ label: bill.name, amount: -bill.amount, is_estimate: Boolean(bill.is_estimate) });
      }
    }

    for (const purchase of whatIfCheckingPurchases) {
      if (purchase.date === date) events.push({ label: purchase.label, amount: -purchase.amount });
    }

    for (const cardPayment of cardPaymentsByDueDate[date] || []) {
      events.push({ label: cardPayment.label, amount: -cardPayment.amount });
    }

    for (const event of events) checkingBalance = roundToCents(checkingBalance + event.amount);
    days.push({ date, events, checking_balance: checkingBalance });
  }

  const lowestDay = days.reduce((lowest, day) => (day.checking_balance < lowest.checking_balance ? day : lowest), days[0]);
  const floor = settings.minimum_checking_floor;
  const firstDayBelowFloor = days.find((day) => day.checking_balance < floor) || null;

  return {
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

// How much checking can spare before the next paycheck, keeping the floor, after bills and card payments.
function safeToSpend(forecast, startingBalance, floor) {
  const paydayIndex = forecast.days.findIndex((day) => day.events.some((event) => event.label === "Paycheck"));
  const daysUntilPayday = paydayIndex === -1 ? forecast.days.length : paydayIndex + 1;
  const daysBeforePayday = paydayIndex === -1 ? forecast.days : forecast.days.slice(0, paydayIndex);
  let lowest = { balance: startingBalance, date: null };
  for (const day of daysBeforePayday) if (day.checking_balance < lowest.balance) lowest = { balance: day.checking_balance, date: day.date };
  const amount = roundToCents(Math.max(0, lowest.balance - floor));
  return {
    amount,
    perDay: roundToCents(amount / daysUntilPayday),
    daysUntilPayday,
    paydayDate: paydayIndex === -1 ? null : forecast.days[paydayIndex].date,
    lowestBeforePayday: lowest.balance,
    lowestDate: lowest.date,
  };
}

// Known one-off amounts leaving checking (tuition, a course). Each lowers every balance from its date on. Items from before the forecast starts are ignored.
function withExpectedExpenses(forecast, items) {
  const leaving = (items || []).filter((item) => item.kind === "out" && item.amount > 0);
  const firstDate = forecast.days[0].date;
  return { ...forecast, days: forecast.days.map((day) => {
    const gone = leaving.filter((item) => item.date >= firstDate && item.date <= day.date).reduce((sum, item) => sum + item.amount, 0);
    return { ...day, checking_balance: roundToCents(day.checking_balance - gone) };
  }) };
}

// How much you can spend in each window and still move weeklySavings out of checking every week and keep the floor.
// Savings leave checking a little each day (weekly / 7), so the lowest day in the window decides the room.
// rawRoom can go negative: that is how far short checking would fall, and the window is then not affordable.
function spendingRoom(forecast, floor, weeklySavings) {
  const savingsPerDay = weeklySavings / 7;
  const firstMonth = forecast.days[0].date.slice(0, 7);
  const daysLeftInMonth = forecast.days.filter((day) => day.date.slice(0, 7) === firstMonth).length;
  function roomForDays(numberOfDays) {
    const days = forecast.days.slice(0, Math.min(numberOfDays, forecast.days.length));
    let tightest = { room: Infinity, date: null };
    days.forEach((day, position) => {
      const room = day.checking_balance - floor - savingsPerDay * (position + 1);
      if (room < tightest.room) tightest = { room, date: day.date };
    });
    return { days: days.length, rawRoom: roundToCents(tightest.room), room: roundToCents(Math.max(0, tightest.room)), tightestDate: tightest.date };
  }
  const week = roomForDays(7);
  const month = roomForDays(daysLeftInMonth);
  // The most you could set aside every week over the next 28 days without breaking the floor.
  const lookAhead = forecast.days.slice(0, 28);
  const mostPerWeek = roundToCents(Math.max(0, Math.min(...lookAhead.map((day, position) => ((day.checking_balance - floor) * 7) / (position + 1)))));
  return { week, month, perDayThisWeek: roundToCents(week.room / week.days), mostPerWeek };
}

// How much you can put on each card today. A card purchase leaves checking on the due date of the statement it lands on,
// so a card is limited by the lowest checking day from that due date onward (floor kept, weekly savings still moving out).
// The card whose bill is due farthest away comes first: it gives the longest wait and never allows less than a nearer one.
function spendToday(settings, forecast, floor, weeklySavings, todayDate) {
  const savingsPerDay = weeklySavings / 7;
  const lastDate = forecast.days[forecast.days.length - 1].date;
  function allowedFrom(payDate, perDay) {
    const from = payDate > lastDate ? lastDate : payDate;
    let tightest = { room: Infinity, date: null };
    forecast.days.forEach((day, position) => {
      if (day.date < from) return;
      const room = day.checking_balance - floor - perDay * (position + 1);
      if (room < tightest.room) tightest = { room, date: day.date };
    });
    return { amount: roundToCents(Math.max(0, tightest.room)), tightestDate: tightest.date };
  }
  const cards = Object.entries(settings.credit_cards).map(([cardKey, card]) => {
    const payDate = dueDateForCharge(card, todayDate);
    const creditLeft = card.credit_limit ? roundToCents(card.credit_limit - (card.current_balance || 0)) : null;
    const capped = (amount) => (creditLeft === null ? amount : Math.max(0, Math.min(amount, creditLeft)));
    const withoutPlan = allowedFrom(payDate, 0);
    const withPlan = allowedFrom(payDate, savingsPerDay);
    return { cardKey, name: card.display_name, payDate, creditLeft, noPlan: capped(withoutPlan.amount), withPlan: capped(withPlan.amount), tightestDate: withPlan.tightestDate };
  }).sort((a, b) => (a.payDate < b.payDate ? 1 : a.payDate > b.payDate ? -1 : b.noPlan - a.noPlan));
  return { cards, best: cards[0] };
}

function balanceOn(forecast, dateText) {
  return forecast.days.find((day) => day.date === dateText)?.checking_balance;
}

// Lets the same file run in a browser (plain script) and in the tests.
if (typeof module !== "undefined") module.exports = { buildForecast, safeToSpend, spendingRoom, withExpectedExpenses, spendToday, balanceOn, dueDateForCharge };
