// Car loan math. Matches the lender spreadsheet: interest = balance x rate / 12, rounded to cents each month.
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
  return loanDueDates(loan, 200).filter((dueDate) => dueDate <= todayDate).length;
}

function loanStatus(loan, todayDate) {
  const paymentsMade = loanPaymentsMade(loan, todayDate);
  let balance = loan.amount;
  let interestPaid = 0;
  for (let paymentNumber = 0; paymentNumber < paymentsMade; paymentNumber++) {
    const interest = roundToCents((balance * loan.annual_rate_percent) / 1200);
    interestPaid += interest;
    balance = roundToCents(balance - (loan.payment - interest));
  }
  return {
    paymentsMade,
    balance,
    interestPaid: roundToCents(interestPaid),
    principalPaid: roundToCents(loan.amount - balance),
    totalPaid: roundToCents(paymentsMade * loan.payment),
  };
}

// What happens from here if you pay a lump sum now and/or extra every month.
function loanPayoffPlan(loan, balanceNow, paymentsMade, lumpSumNow = 0, extraEachMonth = 0) {
  const dueDates = loanDueDates(loan, paymentsMade + 200);
  let balance = Math.max(0, roundToCents(balanceNow - lumpSumNow));
  let interestRemaining = 0;
  let paymentsLeft = 0;
  let payoffDate = null;
  let lastPayment = null;
  while (balance > 0 && paymentsLeft < 200) {
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

if (typeof module !== "undefined") {
  module.exports = { loanDueDates, loanPaymentsMade, loanStatus, loanPayoffPlan };
}
