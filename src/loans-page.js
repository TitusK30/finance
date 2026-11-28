// The Loans tab: one chip per loan (car, mortgage, personal, any other), an "All" overview, and add / edit / remove.
// The math lives in loan.js. Loans are saved in settings.loans.

let loanShown = "all"; // index of the loan on screen, or "all" for the overview
const LOAN_COLORS = ["#5aa2ff", "#4ade80", "#fb923c", "#a78bfa", "#f472b6", "#2dd4bf"];

function loanIcon(loan) {
  return (LOAN_KINDS[loan.kind] || LOAN_KINDS.car)[1];
}

function loanPayoffText(plan) {
  return plan.paymentsLeft > 0 ? monthAndYear(plan.payoffDate) : "Paid off";
}

// Checks one loan's due dates against checking-account charges. null when the loan has no bank text saved.
function loanBankCheck(loan) {
  const store = loadTransactionStore();
  const charges = Object.values(store.transactions).filter((charge) => store.accounts[charge.account_id] && store.accounts[charge.account_id].type === "depository");
  const oldestKnown = charges.map((charge) => charge.date).sort()[0];
  return loanPaymentCheck(loan, todayText(), charges, oldestKnown);
}

function loanStatusNow(loan) {
  const check = loanBankCheck(loan);
  return { check, status: loanStatus(loan, todayText(), check && check.paid) };
}

// The last few due dates and what the bank shows for each.
function loanBankCheckHtml(loan, check) {
  if (!check) return `<div class="small loan-hint">Payments are assumed paid on their due dates. Tap Edit this loan and add the bank text of your payment to check them against your bank.</div>`;
  const recent = loanDueDates(loan, 600).filter((dueDate) => dueDate <= todayText()).slice(-4).reverse();
  const rows = recent.map((dueDate) => {
    const found = check.found[dueDate];
    const text = found ? `<span class="positive">\u2713 paid ${shortMonthDay(found.date)} \u00b7 ${formatMoney(found.amount)}</span>`
      : check.waiting.includes(dueDate) ? `<span class="amber-text">\u23f3 not posted yet</span>`
      : check.missed.includes(dueDate) ? `<span class="negative">\u26a0 not found, not counted</span>`
      : `<span class="small">before your bank history</span>`;
    return `<div class="tile-row small"><span>${shortMonthDay(dueDate)} payment</span>${text}</div>`;
  }).join("");
  return `<div class="tile car-tile"><b>Bank check</b>${rows}<div class="small">Looks for charges with: ${escapeHtml(loan.payment_text_contains.join(", "))}</div></div>`;
}

function loanChipsHtml(loans) {
  const chip = (key, label) => `<button class="loan-chip${String(loanShown) === String(key) ? " is-on" : ""}" data-loan-pick="${key}">${label}</button>`;
  return `<div class="loan-chips">${loans.length > 1 ? chip("all", "All") : ""}${loans.map((loan, position) => chip(position, `${loanIcon(loan)} ${escapeHtml(loan.name)}`)).join("")}<button class="loan-chip loan-chip-add" data-loan-add="yes">+ Add</button></div>`;
}

function loansOverviewHtml(loans) {
  const overview = loanOverview(loans, todayText(), (loan) => { const check = loanBankCheck(loan); return check && check.paid; });
  const percentPaid = Math.round((overview.principalPaid / overview.borrowed) * 100);
  const rows = overview.rows.map((row, position) => {
    const paid = Math.round((row.status.principalPaid / row.loan.amount) * 100);
    return `<div class="tile loan-row" data-loan-pick="${position}" style="--tile-accent:${LOAN_COLORS[position % LOAN_COLORS.length]}"><div class="tile-row"><b>${loanIcon(row.loan)} ${escapeHtml(row.loan.name)}</b><b>${formatMoney(row.status.balance)}</b></div>
      <div class="bar goal-bar"><div class="bar-fill" style="width:${paid}%"></div></div>
      <div class="tile-row small"><span>${paid}% paid · ${formatMoney(row.loan.payment)} a month</span><span>${row.plan.paymentsLeft > 0 ? "Paid off " : ""}${loanPayoffText(row.plan)}</span></div></div>`;
  }).join("");
  return `<div class="tile car-hero"><div class="small">Still owed on all loans</div><div class="huge-number">${formatMoney(overview.owed)}</div>
      <div class="bar goal-bar"><div class="bar-fill" style="width:${percentPaid}%"></div></div>
      <div class="small">${percentPaid}% of the ${formatMoney(overview.borrowed)} borrowed is paid off</div></div>
    <div class="tile car-tile"><div class="small">Loan payments each month</div><div class="big-number">${formatMoney(overview.monthlyPayments)}</div>
      <div class="small">About ${formatMoney(overview.interestRemaining)} interest still to come.${overview.lastPayoffDate ? ` The last loan is paid off ${monthAndYear(overview.lastPayoffDate)}.` : ""}</div></div>
    ${rows}`;
}

function loanDetailHtml(loan, position) {
  const { check, status } = loanStatusNow(loan);
  const baseline = loanPayoffPlan(loan, status.balance, status.dueCount);
  const totalPayments = status.paymentsMade + baseline.paymentsLeft;
  const percentPaid = Math.round((status.principalPaid / loan.amount) * 100);
  const principalShare = status.totalPaid > 0 ? Math.round((status.principalPaid / status.totalPaid) * 100) : 0;
  return `<div class="tile car-hero"><div class="small">Still owed (principal)</div><div class="huge-number">${formatMoney(status.balance)}</div>
      <div class="bar goal-bar"><div class="bar-fill" style="width:${percentPaid}%"></div></div>
      <div class="small">${percentPaid}% of the ${formatMoney(loan.amount)} loan paid off</div>
      ${status.missedPayments ? `<div class="small negative">\u26a0 ${status.missedPayments} payment${status.missedPayments === 1 ? "" : "s"} not found in your bank, so not counted</div>` : ""}</div>
    <div class="tile car-tile"><div class="small">Paid so far</div><div class="big-number">${formatMoney(status.totalPaid)}</div>
      <div class="split-bar"><span class="split-loan" style="width:${principalShare}%"></span><span class="split-interest" style="width:${100 - principalShare}%"></span></div>
      <div class="tile-row small"><span><span class="dot dot-loan"></span>Went to the loan</span><span>${formatMoney(status.principalPaid)}</span></div>
      <div class="tile-row small"><span><span class="dot dot-interest"></span>Went to interest</span><span>${formatMoney(status.interestPaid)}</span></div>
      <div class="small">${status.paymentsMade} of ${totalPayments} payments made</div></div>
    <div class="tile car-tile"><div class="small">Paid off on</div><div class="big-number">${loanPayoffText(baseline)}</div>
      <div class="small">${baseline.paymentsLeft} payments left of ${formatMoney(loan.payment)}. About ${formatMoney(baseline.interestRemaining)} interest still to come.</div></div>
    ${baseline.waivedPayment ? `<div class="tile result-hero"><div class="tile-row"><b>Last payment waived</b><b>${formatMoney(baseline.waivedPayment.amount)} off</b></div>
      <div class="small">${escapeHtml(baseline.waivedPayment.reason)}. The ${monthAndYear(baseline.waivedPayment.date)} payment is null.</div></div>` : ""}
    <div class="tile car-tile"><b>Loan facts</b>
      <div class="facts-grid">
        <div><span class="fact-icon">${loanIcon(loan)}</span><b>${formatMoney(loan.amount)}</b><span class="small">Loan amount</span></div>
        <div><span class="fact-icon">&#128200;</span><b>${loan.annual_rate_percent}%</b><span class="small">Rate</span></div>
        <div><span class="fact-icon">&#128197;</span><b>${totalPayments}</b><span class="small">Payments</span></div>
        <div><span class="fact-icon">&#128184;</span><b>${formatMoney(status.interestPaid + baseline.interestRemaining)}</b><span class="small">Total interest</span></div>
      </div></div>
    ${loanBankCheckHtml(loan, check)}
    <button class="small-button" data-loan-edit="${position}">Edit this loan</button>`;
}

function showLoansPage(settings) {
  const loans = loansOf(settings);
  const summary = document.getElementById("car-summary");
  const extraCard = document.getElementById("car-extra-card");
  const resultBox = document.getElementById("car-extra-result");
  if (!loans.length) {
    summary.innerHTML = `<h2>Loans</h2><div class="tile"><div class="small">No loans yet. Add a car loan, a mortgage or any other loan to see what is still owed and when it will be paid off.</div></div><button data-loan-add="yes">+ Add a loan</button>`;
    extraCard.hidden = true;
    resultBox.innerHTML = "";
    return;
  }
  if (loans.length === 1) loanShown = 0;
  if (loanShown !== "all" && !loans[loanShown]) loanShown = loans.length > 1 ? "all" : 0;
  summary.innerHTML = `<h2>Loans</h2>${loanChipsHtml(loans)}${loanShown === "all" ? loansOverviewHtml(loans) : loanDetailHtml(loans[loanShown], loanShown)}`;
  extraCard.hidden = loanShown === "all";
  if (loanShown === "all") { resultBox.innerHTML = ""; return; }
  // What paying extra would do to the loan on screen.
  const loan = loans[loanShown];
  const { status } = loanStatusNow(loan);
  const baseline = loanPayoffPlan(loan, status.balance, status.dueCount);
  const lumpSum = parseFloat(document.getElementById("car-extra-now").value) || 0;
  const extraEachMonth = parseFloat(document.getElementById("car-extra-monthly").value) || 0;
  if (lumpSum <= 0 && extraEachMonth <= 0) { resultBox.innerHTML = ""; return; }
  const plan = loanPayoffPlan(loan, status.balance, status.dueCount, lumpSum, extraEachMonth);
  const monthsSaved = baseline.paymentsLeft - plan.paymentsLeft;
  resultBox.innerHTML = `<div class="tile result-hero"><div class="verdict">${plan.paymentsLeft === 0 ? "Paid off right now" : "Paid off " + monthAndYear(plan.payoffDate)}</div>
    <div class="tile-row"><b>Interest saved</b><b class="positive">${formatMoney(baseline.interestRemaining - plan.interestRemaining)}</b></div>
    <div class="result-rows"><div class="tile-row small"><span>Owed after extra</span><span>${formatMoney(Math.max(0, status.balance - lumpSum))}</span></div>
    <div class="tile-row small"><span>Payments left</span><span>${plan.paymentsLeft} (${monthsSaved} fewer)</span></div>
    <div class="tile-row small"><span>Interest still to come</span><span>${formatMoney(plan.interestRemaining)}</span></div></div></div>`;
}

for (const inputId of ["car-extra-now", "car-extra-monthly"]) {
  document.getElementById(inputId).addEventListener("input", () => { const settings = loadSettings(); if (settings) showLoansPage(settings); });
}

// The add / edit sheet. position null = a new loan.
function openLoanEditor(position) {
  const settings = loadSettings();
  if (!settings) return;
  const existing = position === null ? {} : loansOf(settings)[position];
  if (!existing) return;
  const values = { name: existing.name || "", kind: existing.kind || "car", amount: existing.amount ?? "", rate: existing.annual_rate_percent ?? "", payment: existing.payment ?? "", first: existing.first_payment_date || "", words: (existing.payment_text_contains || []).join(", ") };
  const cover = document.createElement("div");
  cover.className = "date-cover category-picker filter-sheet bill-editor";
  let errorText = "";
  const input = (id, label, field, extra = "") => `<div class="filter-label">${label}</div><input id="${id}" value="${escapeHtml(values[field])}" ${extra}>`;
  const draw = () => {
    cover.innerHTML = `<div class="date-box"><div class="date-question">${position === null ? "Add a loan" : "Edit " + escapeHtml(existing.name)}</div>
      <div class="filter-label">Type</div>
      <div class="choice-list">${Object.entries(LOAN_KINDS).map(([kind, [label, icon]]) => `<button class="choice-button${values.kind === kind ? " is-current" : ""}" data-loan-kind="${kind}" style="--dot:var(--accent)"><b>${icon} ${label}</b></button>`).join("")}</div>
      ${input("loan-edit-name", "Name", "name", 'autocomplete="off"')}
      ${input("loan-edit-amount", "Amount borrowed ($)", "amount", 'inputmode="decimal"')}
      ${input("loan-edit-rate", "Yearly interest rate (%)", "rate", 'inputmode="decimal"')}
      ${input("loan-edit-payment", "Monthly payment ($)", "payment", 'inputmode="decimal"')}
      ${input("loan-edit-first", "First payment date", "first", 'type="date"')}
      <div class="filter-label">Bank text of your payment <span class="small">(optional, commas)</span></div><input id="loan-edit-words" value="${escapeHtml(values.words)}" placeholder="like: zelle, kevin" autocomplete="off" autocapitalize="off">
      <div class="small loan-hint">With this, the loan counts a payment only when a checking charge with all these words posts near its due date.</div>
      ${errorText ? `<div class="editor-error">${escapeHtml(errorText)}</div>` : ""}
      <div class="choice-list filter-actions"><button class="choice-button is-wide is-apply" data-loan-save><b>Save</b></button>${position === null ? "" : `<button class="choice-button is-wide" data-loan-remove><b>Remove this loan</b></button>`}<button class="choice-button is-wide" data-loan-cancel><b>Cancel</b></button></div></div>`;
  };
  const readFields = () => {
    for (const [field, id] of [["name", "loan-edit-name"], ["amount", "loan-edit-amount"], ["rate", "loan-edit-rate"], ["payment", "loan-edit-payment"], ["first", "loan-edit-first"], ["words", "loan-edit-words"]]) {
      const box = cover.querySelector("#" + id);
      if (box) values[field] = box.value;
    }
  };
  draw();
  cover.addEventListener("click", (event) => {
    const kindButton = event.target.closest("[data-loan-kind]");
    if (kindButton) {
      readFields();
      const nameIsStandard = !values.name.trim() || Object.values(LOAN_KINDS).some(([label]) => label === values.name.trim());
      values.kind = kindButton.dataset.loanKind;
      if (nameIsStandard) values.name = LOAN_KINDS[values.kind][0];
      draw();
      return;
    }
    if (event.target.closest("[data-loan-save]")) {
      readFields();
      const result = loanFromInputs(values, existing);
      if (result.error) { errorText = result.error; draw(); return; }
      const loans = [...loansOf(settings)];
      if (position === null) loans.push(result.loan); else loans[position] = result.loan;
      saveLoansTo(settings, loans);
      saveSettings(settings);
      loanShown = position === null ? loans.length - 1 : position;
      cover.remove();
      showEverything();
      showToast(position === null ? `${result.loan.name} added.` : `${result.loan.name} updated.`);
      return;
    }
    if (event.target.closest("[data-loan-remove]")) {
      if (!confirm(`Remove ${existing.name}?`)) return;
      const loans = loansOf(settings).filter((unused, index) => index !== position);
      saveLoansTo(settings, loans);
      saveSettings(settings);
      loanShown = "all";
      cover.remove();
      showEverything();
      showToast(`${existing.name} removed.`);
      return;
    }
    if (event.target === cover || event.target.closest("[data-loan-cancel]")) cover.remove();
  });
  document.body.appendChild(cover);
}

document.addEventListener("click", (event) => {
  const pick = event.target.closest("[data-loan-pick]");
  const add = event.target.closest("[data-loan-add]");
  const edit = event.target.closest("[data-loan-edit]");
  if (!pick && !add && !edit) return;
  if (add) { openLoanEditor(null); return; }
  if (edit) { openLoanEditor(Number(edit.dataset.loanEdit)); return; }
  loanShown = pick.dataset.loanPick === "all" ? "all" : Number(pick.dataset.loanPick);
  document.getElementById("car-extra-now").value = "";
  document.getElementById("car-extra-monthly").value = "";
  const settings = loadSettings();
  if (settings) showLoansPage(settings);
});
