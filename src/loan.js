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

function loanStatus(loan, todayDate) {
  const duePaymentsCount = loanPaymentsMade(loan, todayDate);
  let balance = loan.amount;
  let interestPaid = 0;
  let totalPaid = 0;
  let paymentsMade = 0;
  // A loan that is paid off stops there: the last payment is only what was left, and later due dates add nothing.
  while (paymentsMade < duePaymentsCount && balance > 0) {
    const interest = roundToCents((balance * loan.annual_rate_percent) / 1200);
    const thisPayment = Math.min(loan.payment, roundToCents(balance + interest));
    interestPaid += interest;
    totalPaid += thisPayment;
    balance = roundToCents(balance - (thisPayment - interest));
    paymentsMade++;
  }
  return {
    paymentsMade,
    balance,
    interestPaid: roundToCents(interestPaid),
    principalPaid: roundToCents(loan.amount - balance),
    totalPaid: roundToCents(totalPaid),
  };
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
  return { loan: { ...existing, name: String(values.name || "").trim() || LOAN_KINDS[kind][0], kind, amount, annual_rate_percent: rate, payment, first_payment_date: first, skipped_months: existing.skipped_months || [] } };
}

// Every loan's status and payoff plan today, plus totals for the "All" view.
function loanOverview(loans, todayDate) {
  const rows = loans.map((loan) => {
    const status = loanStatus(loan, todayDate);
    return { loan, status, plan: loanPayoffPlan(loan, status.balance, status.paymentsMade) };
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
  module.exports = { loanDueDates, loanPaymentsMade, loanStatus, loanPayoffPlan, LOAN_KINDS, loansOf, saveLoansTo, loanFromInputs, loanOverview };
}
