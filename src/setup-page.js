// In-app set-up: an alternative to loading a settings file. The file method works exactly as before.
// Everything here edits the same settings the file would have filled in.

const SETUP_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
let cardBeingEdited = null; // key of the card whose form is open for changes

function blankSettings() {
  return {
    starting_balances: { as_of_date: todayText(), checking_balance: 0, savings_balance: 0 },
    minimum_checking_floor: 500,
    paycheck: { usual_take_home_amount: 0, pay_weekday: "Friday", one_time_amount_overrides: {} },
    credit_cards: {},
    monthly_bills_paid_from_checking: [],
    subscriptions_charged_to_cards: [],
    optional_monthly_variable_spending_allowance: null,
  };
}

function cardKeyFromName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "card";
}

function inputNumber(id) {
  const value = parseFloat(document.getElementById(id).value);
  return Number.isNaN(value) ? null : value;
}

function inputText(id) {
  return document.getElementById(id).value.trim();
}

function setupField(id, label, type = "text", value = "", extra = "") {
  const inputMode = type === "number" ? ' inputmode="decimal" step="any"' : "";
  return `<label class="small setup-label">${label}<input id="${id}" type="${type}"${inputMode} value="${escapeHtml(value ?? "")}" ${extra}></label>`;
}

function setupSelect(id, label, options, selected) {
  return `<label class="small setup-label">${label}<select id="${id}">${options.map(([value, text]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

const dayOptions = Array.from({ length: 31 }, (unused, index) => [String(index + 1), String(index + 1)]);

function textHintsFromInput(id) {
  const words = inputText(id).split(",").map((word) => word.trim()).filter(Boolean);
  return words.length ? words : undefined;
}

function basicsSectionHtml(settings) {
  return `<div class="tile"><b>The basics</b>
    ${setupField("setup-floor", "Lowest checking balance you want to stay above ($)", "number", settings.minimum_checking_floor)}
    ${setupField("setup-checking", "Checking balance now ($). The bank refresh keeps this up to date.", "number", settings.starting_balances.checking_balance)}
    ${setupField("setup-savings", "Savings balance ($)", "number", settings.starting_balances.savings_balance)}
    ${setupField("setup-takehome", "Take-home pay per paycheck ($)", "number", settings.paycheck.usual_take_home_amount)}
    ${setupSelect("setup-weekday", "Payday", SETUP_WEEKDAYS.map((day) => [day, day]), settings.paycheck.pay_weekday)}
</div>`;
}

function cardsSectionHtml(settings) {
  const editing = cardBeingEdited ? settings.credit_cards[cardBeingEdited] : null;
  const expiry = editing ? settings.card_expirations[cardBeingEdited] || "" : "";
  const fee = editing ? settings.annual_card_fees.find((entry) => entry.card === cardBeingEdited) : null;
  const rows = Object.entries(settings.credit_cards).map(([cardKey, card]) => `<div class="tile-row small charge-row">
      <span>${escapeHtml(card.display_name)}<br><span class="charge-card">${formatMoney(card.credit_limit)} limit · closes day ${card.statement_close_day} · due day ${card.payment_due_day}</span></span>
      <span><button class="mark-button" data-setup-edit-card="${cardKey}">edit</button><br><button class="mark-button" data-setup-remove-card="${cardKey}">remove</button></span></div>`).join("");
  return `<div class="tile"><b>Credit cards</b>${rows || '<div class="small">No cards yet.</div>'}</div>
    <div class="tile"><b>${editing ? "Change this card" : "Add a card"}</b>
    ${setupField("setup-card-name", "Card name (for example: Visa Rewards)", "text", editing ? editing.display_name : "")}
    ${setupField("setup-card-limit", "Credit limit ($)", "number", editing ? editing.credit_limit : "")}
    ${setupSelect("setup-card-close", "Statement closes on day", dayOptions, editing ? String(editing.statement_close_day) : "1")}
    ${setupSelect("setup-card-due", "Payment is due on day", dayOptions, editing ? String(editing.payment_due_day) : "1")}
    <label class="small setup-label"><input id="setup-card-next-month" type="checkbox"${!editing || editing.payment_due_in_following_month ? " checked" : ""}> The due date falls in the month after the statement closes</label>
    ${setupField("setup-card-expiry", "Card expires (month)", "month", expiry)}
    ${setupField("setup-card-fee", "Annual fee ($, leave empty if none)", "number", fee ? fee.amount : "")}
    ${setupSelect("setup-card-fee-month", "Annual fee is charged in month", Array.from({ length: 12 }, (unused, index) => [String(index + 1), new Date(2000, index, 1).toLocaleString("en-US", { month: "long" })]), fee ? String(fee.month) : "1")}
    <button id="setup-save-card">${editing ? "Save changes" : "Add card"}</button>${editing ? '<button id="setup-cancel-card" class="small-button">Cancel</button>' : ""}</div>`;
}

function billsSectionHtml(settings) {
  const rows = settings.monthly_bills_paid_from_checking.map((bill, position) => `<div class="tile-row small charge-row">
      <span>${escapeHtml(bill.name)}<br><span class="charge-card">day ${bill.day_of_month}${bill.amount_changes_every_month ? " · amount changes" : ""}</span></span>
      <span>${formatMoney(bill.amount)}<br><button class="mark-button" data-setup-remove-bill="${position}">remove</button></span></div>`).join("");
  return `<div class="tile"><b>Monthly bills paid from checking</b>${rows || '<div class="small">None yet.</div>'}</div>
    <div class="tile"><b>Add a bill</b>
    ${setupField("setup-bill-name", "Name (for example: Rent)")}
    ${setupField("setup-bill-amount", "Amount ($)", "number")}
    ${setupSelect("setup-bill-day", "Due on day", dayOptions, "1")}
    <label class="small setup-label"><input id="setup-bill-varies" type="checkbox"> The amount is different every month (like electricity)</label>
    ${setupField("setup-bill-text", "Text on the bank statement, if different from the name (optional, separate with commas)")}
    <button id="setup-add-bill">Add bill</button></div>`;
}

function subscriptionsSectionHtml(settings) {
  const cardOptions = Object.entries(settings.credit_cards).map(([cardKey, card]) => [cardKey, card.display_name]);
  const rows = settings.subscriptions_charged_to_cards.map((subscription, position) => `<div class="tile-row small charge-row">
      <span>${escapeHtml(subscription.name)}<br><span class="charge-card">${escapeHtml((settings.credit_cards[subscription.card] || {}).display_name || "")} · day ${subscription.day_of_month || (subscription.assumed_days_of_month || []).join("/")}</span></span>
      <span>${formatMoney(subscription.amount)}<br><button class="mark-button" data-setup-remove-subscription="${position}">remove</button></span></div>`).join("");
  const form = cardOptions.length
    ? `${setupField("setup-sub-name", "Name (for example: Netflix)")}
       ${setupField("setup-sub-amount", "Amount ($)", "number")}
       ${setupSelect("setup-sub-day", "Charged on day", dayOptions, "1")}
       ${setupSelect("setup-sub-card", "Charged to card", cardOptions, cardOptions[0][0])}
       ${setupField("setup-sub-text", "Text on the card statement, if different from the name (optional, separate with commas)")}
       <button id="setup-add-subscription">Add subscription</button>`
    : '<div class="small">Add a card first.</div>';
  return `<div class="tile"><b>Subscriptions on your cards</b>${rows || '<div class="small">None yet.</div>'}</div><div class="tile"><b>Add a subscription</b>${form}</div>`;
}

function carAndOvertimeSectionHtml(settings) {
  const loan = settings.car_loan || {};
  const overtime = settings.overtime;
  return `<div class="tile"><b>Car loan (optional)</b>
    ${setupField("setup-loan-amount", "Amount borrowed ($)", "number", loan.amount)}
    ${setupField("setup-loan-rate", "Yearly interest rate (%)", "number", loan.annual_rate_percent)}
    ${setupField("setup-loan-payment", "Monthly payment ($)", "number", loan.payment)}
    ${setupField("setup-loan-first", "First payment date", "date", loan.first_payment_date)}
    ${settings.car_loan ? '<button id="setup-remove-loan" class="small-button">Remove</button>' : ""}</div>
    <div class="tile"><b>Overtime (optional)</b>
    ${setupField("setup-ot-gross", "Hourly rate before tax ($)", "number", overtime.gross_hourly_rate)}
    ${setupField("setup-ot-takehome", "Take-home per overtime hour ($)", "number", overtime.take_home_per_overtime_hour)}
    ${setupField("setup-ot-days", "Paid this many days after the pay period ends", "number", overtime.paid_days_after_period_ends)}
</div>`;
}

// Menu tabs you can hide. Home, Settings and Set up always stay.
const ALWAYS_SHOWN_TABS = ["home", "settings", "setup"];

function hideableTabs() {
  return PAGE_NAMES.filter((name) => !ALWAYS_SHOWN_TABS.includes(name));
}

function applyHiddenTabs(settings) {
  for (const name of hideableTabs()) document.getElementById("tab-" + name).hidden = settings.hidden_tabs.includes(name);
}

function menuTabsSectionHtml(settings) {
  const rows = hideableTabs().map((name) => {
    const tabButton = document.getElementById("tab-" + name);
    return `<label class="small setup-label"><input type="checkbox" data-setup-tab="${name}"${settings.hidden_tabs.includes(name) ? "" : " checked"}> ${tabButton.dataset.title}</label>`;
  }).join("");
  return `<div class="tile"><b>Menu tabs</b><div class="small">Untick any tab you do not use, then tap Apply to take it out of the menu. Tick it again and Apply whenever you want it back.</div>${rows}</div>`;
}

function showSetupPage(settings) {
  applyHiddenTabs(settings);
  document.getElementById("page-setup").innerHTML = `<h2>Set up</h2>
    <div class="small">Fill these in here instead of loading a settings file. Both ways work, and you can mix them. Tap Apply (top right) to save the basics, car loan, overtime and menu tabs. Cards, bills and subscriptions save with their own Add buttons. Balances and statements come from the bank refresh or the file.</div>
    ${basicsSectionHtml(settings)}${cardsSectionHtml(settings)}${billsSectionHtml(settings)}${subscriptionsSectionHtml(settings)}${carAndOvertimeSectionHtml(settings)}${menuTabsSectionHtml(settings)}`;
}

function saveAndRefresh(settings) {
  saveSettings(settings);
  showEverything();
}

// Starts the in-app set-up, creating empty settings first when nothing is on this phone yet.
function openSetupPage() {
  if (!loadSettings()) saveSettings(blankSettings());
  showEverything();
  showPage("setup");
}

// Apply: saves everything in the plain boxes on this page (basics, car loan, overtime, menu tabs) in one go.
function applySetupPage(settings) {
  settings.minimum_checking_floor = inputNumber("setup-floor") ?? 0;
  settings.starting_balances.checking_balance = inputNumber("setup-checking") ?? 0;
  settings.starting_balances.savings_balance = inputNumber("setup-savings") ?? 0;
  settings.paycheck.usual_take_home_amount = inputNumber("setup-takehome") ?? 0;
  settings.paycheck.pay_weekday = document.getElementById("setup-weekday").value;

  const loanAmount = inputNumber("setup-loan-amount");
  const loanPayment = inputNumber("setup-loan-payment");
  const loanFirstPayment = inputText("setup-loan-first");
  const loanFilledIn = loanAmount != null || loanPayment != null || loanFirstPayment;
  if (loanFilledIn && (loanAmount == null || loanPayment == null || !loanFirstPayment)) return alert("The car loan needs an amount, a monthly payment and a first payment date. Fill all three or clear them.");
  if (loanFilledIn) settings.car_loan = { ...(settings.car_loan || {}), amount: loanAmount, annual_rate_percent: inputNumber("setup-loan-rate") ?? 0, payment: loanPayment, first_payment_date: loanFirstPayment, skipped_months: (settings.car_loan || {}).skipped_months || [] };

  settings.overtime = { gross_hourly_rate: inputNumber("setup-ot-gross"), take_home_per_overtime_hour: inputNumber("setup-ot-takehome"), paid_days_after_period_ends: inputNumber("setup-ot-days") ?? 7 };
  settings.hidden_tabs = hideableTabs().filter((name) => !document.querySelector(`[data-setup-tab="${name}"]`).checked);

  saveAndRefresh(settings);
  const applyButton = document.getElementById("apply-top-button");
  applyButton.textContent = "Applied ✓";
  setTimeout(() => { applyButton.textContent = "Apply"; }, 1500);
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target.id === "open-setup-button" || target.id === "start-setup-button") return openSetupPage();
  const settings = loadSettings();
  if (!settings || document.getElementById("page-setup").hidden) return;

  if (target.id === "apply-top-button") return applySetupPage(settings);

  if (target.id === "setup-save-card") {
    const name = inputText("setup-card-name");
    const limit = inputNumber("setup-card-limit");
    if (!name || limit == null) return alert("Give the card a name and a credit limit.");
    const cardKey = cardBeingEdited || cardKeyFromName(name);
    const previous = settings.credit_cards[cardKey] || {};
    settings.credit_cards[cardKey] = {
      display_name: name,
      credit_limit: limit,
      current_balance: previous.current_balance ?? 0,
      balances_by_statement: previous.balances_by_statement || [],
      statement_close_day: Number(document.getElementById("setup-card-close").value),
      payment_due_day: Number(document.getElementById("setup-card-due").value),
      payment_due_in_following_month: document.getElementById("setup-card-next-month").checked,
    };
    const expiry = inputText("setup-card-expiry");
    if (expiry) settings.card_expirations[cardKey] = expiry;
    else delete settings.card_expirations[cardKey];
    settings.annual_card_fees = settings.annual_card_fees.filter((entry) => entry.card !== cardKey);
    const fee = inputNumber("setup-card-fee");
    if (fee) settings.annual_card_fees.push({ card: cardKey, amount: fee, month: Number(document.getElementById("setup-card-fee-month").value), day: 1 });
    cardBeingEdited = null;
    return saveAndRefresh(settings);
  }
  if (target.id === "setup-cancel-card") { cardBeingEdited = null; return showSetupPage(settings); }
  if (target.dataset.setupEditCard) { cardBeingEdited = target.dataset.setupEditCard; return showSetupPage(settings); }
  if (target.dataset.setupRemoveCard) {
    const cardKey = target.dataset.setupRemoveCard;
    if (!confirm(`Remove ${settings.credit_cards[cardKey].display_name}? Its subscriptions, fees and benefits are removed too.`)) return;
    delete settings.credit_cards[cardKey];
    delete settings.card_expirations[cardKey];
    delete settings.rewards[cardKey];
    settings.annual_card_fees = settings.annual_card_fees.filter((entry) => entry.card !== cardKey);
    settings.card_benefits = settings.card_benefits.filter((entry) => entry.card !== cardKey);
    settings.subscriptions_charged_to_cards = settings.subscriptions_charged_to_cards.filter((entry) => entry.card !== cardKey);
    return saveAndRefresh(settings);
  }

  if (target.id === "setup-add-bill") {
    const name = inputText("setup-bill-name");
    const amount = inputNumber("setup-bill-amount");
    if (!name || amount == null) return alert("Give the bill a name and an amount.");
    const varies = document.getElementById("setup-bill-varies").checked;
    settings.monthly_bills_paid_from_checking.push({
      name, amount, day_of_month: Number(document.getElementById("setup-bill-day").value),
      ...(varies ? { is_estimate: true, amount_changes_every_month: true } : {}),
      ...(textHintsFromInput("setup-bill-text") ? { charge_text_contains: textHintsFromInput("setup-bill-text") } : {}),
    });
    return saveAndRefresh(settings);
  }
  if (target.dataset.setupRemoveBill) {
    settings.monthly_bills_paid_from_checking.splice(Number(target.dataset.setupRemoveBill), 1);
    return saveAndRefresh(settings);
  }

  if (target.id === "setup-add-subscription") {
    const name = inputText("setup-sub-name");
    const amount = inputNumber("setup-sub-amount");
    if (!name || amount == null) return alert("Give the subscription a name and an amount.");
    settings.subscriptions_charged_to_cards.push({
      name, amount, card: document.getElementById("setup-sub-card").value, day_of_month: Number(document.getElementById("setup-sub-day").value),
      ...(textHintsFromInput("setup-sub-text") ? { charge_text_contains: textHintsFromInput("setup-sub-text") } : {}),
    });
    return saveAndRefresh(settings);
  }
  if (target.dataset.setupRemoveSubscription) {
    settings.subscriptions_charged_to_cards.splice(Number(target.dataset.setupRemoveSubscription), 1);
    return saveAndRefresh(settings);
  }

  if (target.id === "setup-remove-loan" && confirm("Remove the car loan?")) {
    settings.car_loan = null;
    return saveAndRefresh(settings);
  }
});
