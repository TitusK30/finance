// Loan math (car, mortgage, personal, any other). Matches the lender spreadsheet: interest = balance x rate / 12, rounded to cents each month.
// Skipped months (the lender let you skip) add no payment and no interest; the schedule just shifts later.

function roundToCents(amount) {
  return Math.round(amount * 100) / 100;
}

function twoDigits(number) {
  return String(number).padStart(2, "0");
}

// Calendar due dates in order, leaving out skipped months.
function loanDueDates(loan, howMany) {
  const [firstYear, firstMonth, dayOfMonth] = loan.first_payment_date.split("-").map(Number);
  const dueDates = [];
  let monthsAfterFirst = 0;
  while (dueDates.length < howMany) {
    const monthNumber = firstMonth - 1 + monthsAfterFirst;
    const year = firstYear + Math.floor(monthNumber / 12);
    const yearMonth = `${year}-${twoDigits((monthNumber % 12) + 1)}`;
    if (!(loan.skipped_months || []).includes(yearMonth)) dueDates.push(`${yearMonth}-${twoDigits(dayOfMonth)}`);
    monthsAfterFirst++;
  }
  return dueDates;
}

// Autopay assumed: every due date that has arrived counts as paid.
function loanPaymentsMade(loan, todayDate) {
  return loanDueDates(loan, 600).filter((dueDate) => dueDate <= todayDate).length;
}

// paidDueDates (optional): the due dates the bank confirmed. Leave it out to assume every due date was paid (autopay).
// A due date that was not paid adds no payment; the loan simply stays where it was.
function loanStatus(loan, todayDate, paidDueDates = null) {
  const dueDates = loanDueDates(loan, 600).filter((dueDate) => dueDate <= todayDate);
  let balance = loan.amount;
  let interestPaid = 0;
  let totalPaid = 0;
  let paymentsMade = 0;
  let missedPayments = 0;
  // A loan that is paid off stops there: the last payment is only what was left, and later due dates add nothing.
  for (const dueDate of dueDates) {
    if (balance <= 0) break;
    if (paidDueDates && !paidDueDates.has(dueDate)) { missedPayments++; continue; }
    const interest = roundToCents((balance * loan.annual_rate_percent) / 1200);
    const thisPayment = Math.min(loan.payment, roundToCents(balance + interest));
    interestPaid += interest;
    totalPaid += thisPayment;
    balance = roundToCents(balance - (thisPayment - interest));
    paymentsMade++;
  }
  return {
    paymentsMade,
    dueCount: dueDates.length,
    missedPayments,
    balance,
    interestPaid: roundToCents(interestPaid),
    principalPaid: roundToCents(loan.amount - balance),
    totalPaid: roundToCents(totalPaid),
  };
}

// Checks each due date that has passed against the bank. loan.payment_text_contains = words that must all appear in the
// bank's text for the payment (like ["zelle", "jane"]). charges = money-out bank transactions; oldestKnownDate = the first
// date the app has bank data for, so older due dates are assumed paid. A payment can post a few days early or late.
// Returns null when no words are saved. Otherwise { paid: Set of due dates counted as paid, found: { due: charge },
// waiting: due dates still inside the posting window, missed: due dates with no payment found }.
const LOAN_EARLY_DAYS = 5;
const LOAN_LATE_DAYS = 10;

function dayDifference(firstDate, secondDate) {
  return Math.round((new Date(firstDate + "T12:00:00Z") - new Date(secondDate + "T12:00:00Z")) / 86400000);
}

function loanPaymentCheck(loan, todayDate, charges, oldestKnownDate) {
  const words = (loan.payment_text_contains || []).map((word) => String(word).toLowerCase().trim()).filter(Boolean);
  if (!words.length || !oldestKnownDate) return null;
  const textOf = (charge) => (String(charge.merchant_name || "") + " " + String(charge.name || "")).toLowerCase();
  const candidates = charges.filter((charge) => charge.amount > 0 && words.every((word) => textOf(charge).includes(word)));
  const claimed = new Set();
  const result = { paid: new Set(), found: {}, waiting: [], missed: [], assumed: [] };
  for (const dueDate of loanDueDates(loan, 600).filter((date) => date <= todayDate)) {
    if (dayDifference(dueDate, oldestKnownDate) < LOAN_EARLY_DAYS) { result.paid.add(dueDate); result.assumed.push(dueDate); continue; }
    const match = candidates.filter((charge) => !claimed.has(charge.transaction_id) && dayDifference(charge.date, dueDate) >= -LOAN_EARLY_DAYS && dayDifference(charge.date, dueDate) <= LOAN_LATE_DAYS)
      .sort((first, second) => Math.abs(dayDifference(first.date, dueDate)) - Math.abs(dayDifference(second.date, dueDate)))[0];
    if (match) { claimed.add(match.transaction_id); result.paid.add(dueDate); result.found[dueDate] = match; continue; }
    if (dayDifference(todayDate, dueDate) <= LOAN_LATE_DAYS) { result.paid.add(dueDate); result.waiting.push(dueDate); } else result.missed.push(dueDate);
  }
  return result;
}

// What happens from here if you pay a lump sum now and/or extra every month.
function loanPayoffPlan(loan, balanceNow, paymentsMade, lumpSumNow = 0, extraEachMonth = 0) {
  const dueDates = loanDueDates(loan, paymentsMade + 600);
  let balance = Math.max(0, roundToCents(balanceNow - lumpSumNow));
  let interestRemaining = 0;
  let paymentsLeft = 0;
  let payoffDate = null;
  let lastPayment = null;
  while (balance > 0 && paymentsLeft < 600) {
    const interest = roundToCents((balance * loan.annual_rate_percent) / 1200);
    const thisPayment = Math.min(loan.payment + extraEachMonth, roundToCents(balance + interest));
    balance = roundToCents(balance - (thisPayment - interest));
    interestRemaining += interest;
    payoffDate = dueDates[paymentsMade + paymentsLeft];
    lastPayment = { date: payoffDate, amount: thisPayment, interest };
    paymentsLeft++;
  }
  // The lender waived the very last payment, so it is never paid and its interest never accrues.
  let waivedPayment = null;
  if (loan.waived_last_payment && lastPayment) {
    waivedPayment = { date: lastPayment.date, amount: lastPayment.amount, reason: loan.waived_last_payment.reason };
    paymentsLeft--;
    interestRemaining -= lastPayment.interest;
    payoffDate = paymentsLeft > 0 ? dueDates[paymentsMade + paymentsLeft - 1] : null;
  }
  return { paymentsLeft, payoffDate, interestRemaining: roundToCents(interestRemaining), waivedPayment };
}

// ---- Several loans. settings.loans is the list; an older single settings.car_loan still reads as the first loan.
const LOAN_KINDS = { car: ["Car loan", "\u{1F697}"], mortgage: ["Mortgage", "\u{1F3E0}"], personal: ["Personal loan", "\u{1F4B5}"], other: ["Other loan", "\u{1F3E6}"] };

function loansOf(settings) {
  if (Array.isArray(settings.loans)) return settings.loans;
  return settings.car_loan ? [{ name: "Car loan", kind: "car", ...settings.car_loan }] : [];
}

// Saves the list and retires the old single-loan field.
function saveLoansTo(settings, loans) {
  settings.loans = loans;
  settings.car_loan = null;
}

// Typed text boxes into a loan, or a message saying what to fix. existing keeps things typed earlier (skipped months and so on).
function loanFromInputs(values, existing = {}) {
  const number = (text) => (String(text ?? "").trim() === "" ? null : Number(String(text).replace(/[$,%\s]/g, "")));
  const kind = LOAN_KINDS[values.kind] ? values.kind : "other";
  const amount = number(values.amount);
  const payment = number(values.payment);
  const rate = number(values.rate) ?? 0;
  const first = String(values.first || "").trim();
  if (!(amount > 0)) return { error: "Amount borrowed needs to be more than 0." };
  if (!(payment > 0)) return { error: "Monthly payment needs to be more than 0." };
  if (!(rate >= 0)) return { error: "Interest rate can't be negative." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || Number.isNaN(Date.parse(first))) return { error: "Pick the date of the first payment." };
  if (payment <= (amount * rate) / 1200) return { error: "That payment doesn't cover a month of interest, so the loan would never shrink." };
  const words = String(values.words || "").split(",").map((word) => word.trim().toLowerCase()).filter(Boolean);
  const loan = { ...existing, name: String(values.name || "").trim() || LOAN_KINDS[kind][0], kind, amount, annual_rate_percent: rate, payment, first_payment_date: first, skipped_months: existing.skipped_months || [] };
  if (words.length) loan.payment_text_contains = words; else delete loan.payment_text_contains;
  return { loan };
}

// Every loan's status and payoff plan today, plus totals for the "All" view.
function loanOverview(loans, todayDate, paidFor = () => null) {
  const rows = loans.map((loan) => {
    const status = loanStatus(loan, todayDate, paidFor(loan));
    return { loan, status, plan: loanPayoffPlan(loan, status.balance, status.dueCount) };
  });
  const sum = (pick) => roundToCents(rows.reduce((total, row) => total + pick(row), 0));
  const stillPaying = rows.filter((row) => row.plan.paymentsLeft > 0);
  return {
    rows,
    owed: sum((row) => row.status.balance),
    borrowed: sum((row) => row.loan.amount),
    principalPaid: sum((row) => row.status.principalPaid),
    monthlyPayments: sum((row) => (row.plan.paymentsLeft > 0 ? row.loan.payment : 0)),
    interestRemaining: sum((row) => row.plan.interestRemaining),
    lastPayoffDate: stillPaying.length ? stillPaying.map((row) => row.plan.payoffDate).sort().pop() : null,
  };
}

if (typeof module !== "undefined") {
  module.exports = { loanDueDates, loanPaymentsMade, loanStatus, loanPayoffPlan, loanPaymentCheck, LOAN_KINDS, loansOf, saveLoansTo, loanFromInputs, loanOverview };
}
