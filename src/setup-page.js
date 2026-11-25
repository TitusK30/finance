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
  return `${setupField("setup-floor", "Lowest checking balance you want to stay above ($)", "number", settings.minimum_checking_floor)}
    ${setupField("setup-checking", "Checking balance now ($). The bank refresh keeps this up to date.", "number", settings.starting_balances.checking_balance)}
    ${setupField("setup-savings", "Savings balance ($)", "number", settings.starting_balances.savings_balance)}
    ${setupField("setup-takehome", "Take-home pay per paycheck ($)", "number", settings.paycheck.usual_take_home_amount)}
    ${setupSelect("setup-weekday", "Payday", SETUP_WEEKDAYS.map((day) => [day, day]), settings.paycheck.pay_weekday)}`;
}

function cardFormFieldsHtml(settings) {
  const editing = cardBeingEdited ? settings.credit_cards[cardBeingEdited] : null;
  const expiry = editing ? settings.card_expirations[cardBeingEdited] || "" : "";
  const fee = editing ? settings.annual_card_fees.find((entry) => entry.card === cardBeingEdited) : null;
  return `${setupField("setup-card-name", "Card name (for example: Visa Rewards)", "text", editing ? editing.display_name : "")}
    ${setupField("setup-card-limit", "Credit limit ($)", "number", editing ? editing.credit_limit : "")}
    ${setupSelect("setup-card-close", "Statement closes on day", dayOptions, editing ? String(editing.statement_close_day) : "1")}
    ${setupSelect("setup-card-due", "Payment is due on day", dayOptions, editing ? String(editing.payment_due_day) : "1")}
    <label class="small setup-label"><input id="setup-card-next-month" type="checkbox"${!editing || editing.payment_due_in_following_month ? " checked" : ""}> The due date falls in the month after the statement closes</label>
    ${setupField("setup-card-expiry", "Card expires (month)", "month", expiry)}
    ${setupField("setup-card-fee", "Annual fee ($, leave empty if none)", "number", fee ? fee.amount : "")}
    ${setupSelect("setup-card-fee-month", "Annual fee is charged in month", Array.from({ length: 12 }, (unused, index) => [String(index + 1), new Date(2000, index, 1).toLocaleString("en-US", { month: "long" })]), fee ? String(fee.month) : "1")}`;
}

function cardsSectionHtml(settings) {
  const editing = cardBeingEdited ? settings.credit_cards[cardBeingEdited] : null;
  const rows = Object.entries(settings.credit_cards).map(([cardKey, card]) => `<div class="tile-row small charge-row">
      <span>${escapeHtml(card.display_name)}<br><span class="charge-card">${formatMoney(card.credit_limit)} limit · closes day ${card.statement_close_day} · due day ${card.payment_due_day}</span></span>
      <span><button class="mark-button" data-setup-edit-card="${cardKey}">edit</button><br><button class="mark-button" data-setup-remove-card="${cardKey}">remove</button></span></div>`).join("");
  return `${rows || '<div class="small">No cards yet.</div>'}
    <b class="setup-subtitle">${editing ? "Change this card" : "Add a card"}</b>
    ${cardFormFieldsHtml(settings)}
    <button id="setup-save-card">${editing ? "Save changes" : "Add card"}</button>${editing ? '<button id="setup-cancel-card" class="small-button">Cancel</button>' : ""}`;
}

function billsSectionHtml(settings) {
  const rows = settings.monthly_bills_paid_from_checking.map((bill, position) => `<div class="tile-row small charge-row">
      <span>${escapeHtml(bill.name)}<br><span class="charge-card">day ${bill.day_of_month}${bill.amount_changes_every_month ? " · amount changes" : ""}</span></span>
      <span>${formatMoney(bill.amount)}<br><button class="mark-button" data-setup-remove-bill="${position}">remove</button></span></div>`).join("");
  return `${rows || '<div class="small">None yet.</div>'}
    <b class="setup-subtitle">Add a bill</b>
    ${billFormFieldsHtml()}
    <button id="setup-add-bill">Add bill</button>`;
}

function billFormFieldsHtml() {
  return `${setupField("setup-bill-name", "Name (for example: Rent)")}
    ${setupField("setup-bill-amount", "Amount ($)", "number")}
    ${setupSelect("setup-bill-day", "Due on day", dayOptions, "1")}
    <label class="small setup-label"><input id="setup-bill-varies" type="checkbox"> The amount is different every month (like electricity)</label>
    ${setupField("setup-bill-text", "Text on the bank statement, if different from the name (optional, separate with commas)")}`;
}

function subFormFieldsHtml(settings) {
  const cardOptions = Object.entries(settings.credit_cards).map(([cardKey, card]) => [cardKey, card.display_name]);
  return `${setupField("setup-sub-name", "Name (for example: Netflix)")}
    ${setupField("setup-sub-amount", "Amount ($)", "number")}
    ${setupSelect("setup-sub-day", "Charged on day", dayOptions, "1")}
    ${setupSelect("setup-sub-card", "Charged to card", cardOptions, cardOptions[0][0])}
    ${setupField("setup-sub-text", "Text on the card statement, if different from the name (optional, separate with commas)")}`;
}

function subscriptionsSectionHtml(settings) {
  const rows = settings.subscriptions_charged_to_cards.map((subscription, position) => `<div class="tile-row small charge-row">
      <span>${escapeHtml(subscription.name)}<br><span class="charge-card">${escapeHtml((settings.credit_cards[subscription.card] || {}).display_name || "")} · day ${subscription.day_of_month || (subscription.assumed_days_of_month || []).join("/")}</span></span>
      <span>${formatMoney(subscription.amount)}<br><button class="mark-button" data-setup-remove-subscription="${position}">remove</button></span></div>`).join("");
  const form = Object.keys(settings.credit_cards).length ? `${subFormFieldsHtml(settings)}<button id="setup-add-subscription">Add subscription</button>` : '<div class="small">Add a card first.</div>';
  return `${rows || '<div class="small">None yet.</div>'}<b class="setup-subtitle">Add a subscription</b>${form}`;
}

function loanSectionHtml(settings) {
  const loan = settings.car_loan || {};
  return `${setupField("setup-loan-amount", "Amount borrowed ($)", "number", loan.amount)}
    ${setupField("setup-loan-rate", "Yearly interest rate (%)", "number", loan.annual_rate_percent)}
    ${setupField("setup-loan-payment", "Monthly payment ($)", "number", loan.payment)}
    ${setupField("setup-loan-first", "First payment date", "date", loan.first_payment_date)}
    ${settings.car_loan ? '<button id="setup-remove-loan" class="small-button">Remove car loan</button>' : ""}`;
}

function overtimeSectionHtml(settings) {
  const overtime = settings.overtime;
  return `${setupField("setup-ot-gross", "Hourly rate before tax ($)", "number", overtime.gross_hourly_rate)}
    ${setupField("setup-ot-takehome", "Take-home per overtime hour ($)", "number", overtime.take_home_per_overtime_hour)}
    ${setupField("setup-ot-days", "Paid this many days after the pay period ends", "number", overtime.paid_days_after_period_ends)}`;
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
  return `<div class="small">Untick any tab you do not use, then tap Apply to take it out of the menu. Tick it again and Apply whenever you want it back.</div>${rows}`;
}

// ---- Collapsible sections (the normal view) ----

const openSetupSections = new Set();

function setupSection(id, title, summary, bodyHtml) {
  return `<details class="tile setup-section" data-setup-section="${id}"${openSetupSections.has(id) ? " open" : ""}>
    <summary><b>${title}</b><span class="small">${summary}</span></summary><div class="setup-body">${bodyHtml}</div></details>`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function showSetupPage(settings) {
  applyHiddenTabs(settings);
  const page = document.getElementById("page-setup");
  if (wizardActive) return showWizard(settings, page);
  const bills = settings.monthly_bills_paid_from_checking.length;
  const subscriptions = settings.subscriptions_charged_to_cards.length;
  const loan = settings.car_loan;
  const overtimeRate = settings.overtime.gross_hourly_rate;
  const tabsHidden = settings.hidden_tabs.length;
  page.innerHTML = `<h2>Set up</h2>
    <div class="small">Open a section to change it. Tap Apply (top right) to save the basics, car loan, overtime and menu tabs. Cards, bills and subscriptions save with their own Add buttons.</div>
    <button id="wizard-start-button" class="small-button">Start the guided set-up</button>
    ${setupSection("basics", "Basics", `Pay ${formatMoney(settings.paycheck.usual_take_home_amount)} · ${settings.paycheck.pay_weekday}`, basicsSectionHtml(settings))}
    ${setupSection("cards", "Credit cards", plural(Object.keys(settings.credit_cards).length, "card"), cardsSectionHtml(settings))}
    ${setupSection("bills", "Bills", plural(bills, "bill"), billsSectionHtml(settings))}
    ${setupSection("subscriptions", "Subscriptions", plural(subscriptions, "subscription"), subscriptionsSectionHtml(settings))}
    ${setupSection("loan", "Car loan", loan ? `${formatMoney(loan.payment)} a month` : "None", loanSectionHtml(settings))}
    ${setupSection("overtime", "Overtime", overtimeRate ? `${formatMoney(overtimeRate)} an hour` : "Not set", overtimeSectionHtml(settings))}
    ${setupSection("tabs", "Menu tabs", tabsHidden ? `${tabsHidden} hidden` : "All shown", menuTabsSectionHtml(settings))}`;
}

// A details element does not bubble its toggle, so listen on the way down.
document.addEventListener("toggle", (event) => {
  const section = event.target.dataset && event.target.dataset.setupSection;
  if (!section) return;
  if (event.target.open) openSetupSections.add(section);
  else openSetupSections.delete(section);
}, true);

// ---- Guided first run: one question per screen ----

const SETUP_DONE_KEY = "finance_os_setup_done";
let wizardActive = false;
let wizardStep = 0;
let wizardAskingAgain = false; // after saving a card, bill or subscription: "add another?"

const WIZARD_STEPS = [
  { title: "What day are you paid?", fields: (s) => setupSelect("wizard-weekday", "Payday", SETUP_WEEKDAYS.map((day) => [day, day]), s.paycheck.pay_weekday), save: (s) => { s.paycheck.pay_weekday = document.getElementById("wizard-weekday").value; } },
  { title: "How much is each paycheck, after tax?", fields: (s) => setupField("wizard-takehome", "Take-home pay ($)", "number", s.paycheck.usual_take_home_amount || ""), save: (s) => { s.paycheck.usual_take_home_amount = inputNumber("wizard-takehome") ?? 0; } },
  { title: "What is in checking right now?", hint: "If you link your bank later, it fills this in for you.", fields: (s) => setupField("wizard-checking", "Checking balance ($)", "number", s.starting_balances.checking_balance || ""), save: (s) => { s.starting_balances.checking_balance = inputNumber("wizard-checking") ?? 0; s.starting_balances.as_of_date = todayText(); } },
  { title: "How much is in savings?", fields: (s) => setupField("wizard-savings", "Savings balance ($)", "number", s.starting_balances.savings_balance || ""), save: (s) => { s.starting_balances.savings_balance = inputNumber("wizard-savings") ?? 0; } },
  { title: "What is the lowest checking balance you want to stay above?", hint: "The app warns you before checking drops below this.", fields: (s) => setupField("wizard-floor", "Lowest balance ($)", "number", s.minimum_checking_floor), save: (s) => { s.minimum_checking_floor = inputNumber("wizard-floor") ?? 500; } },
  { title: "Add a credit card", hint: "Leave the name empty to skip. You can add more later.", repeat: "card", fields: (s) => cardFormFieldsHtml(s), save: (s) => saveCardFromForm(s) },
  { title: "Add a monthly bill paid from checking", hint: "Rent, car payment, power. Leave the name empty to skip.", repeat: "bill", fields: () => billFormFieldsHtml(), save: (s) => saveBillFromForm(s) },
  { title: "Add a subscription charged to a card", hint: "Netflix, a gym, anything that bills a card each month. Leave the name empty to skip.", repeat: "subscription", needsCard: true, fields: (s) => subFormFieldsHtml(s), save: (s) => saveSubscriptionFromForm(s) },
];

function showWizard(settings, page) {
  const lastStep = WIZARD_STEPS.length;
  const step = WIZARD_STEPS[wizardStep];
  const percent = Math.round((wizardStep / lastStep) * 100);
  const progress = `<div class="progress"><div class="progress-fill" style="width:${percent}%"></div></div><div class="small">${wizardStep >= lastStep ? "All done" : `Step ${wizardStep + 1} of ${lastStep}`}</div>`;
  if (wizardStep >= lastStep) {
    page.innerHTML = `${progress}<h2>You are set up</h2>
      <div class="tile small">${plural(Object.keys(settings.credit_cards).length, "card")}, ${plural(settings.monthly_bills_paid_from_checking.length, "bill")}, ${plural(settings.subscriptions_charged_to_cards.length, "subscription")}.<br>Everything can be changed later in Settings → Set up in the app. Linking your bank is optional; the README explains how.</div>
      <div class="wizard-buttons"><button id="wizard-back-button" class="small-button">Back</button><button id="wizard-finish-button">Go to Home</button></div>`;
    return;
  }
  if (wizardAskingAgain) {
    page.innerHTML = `${progress}<h2>Saved</h2><div class="small">Add another ${step.repeat}?</div>
      <div class="wizard-buttons"><button id="wizard-again-button" class="small-button">Add another</button><button id="wizard-continue-button">Continue</button></div>`;
    return;
  }
  const body = step.needsCard && Object.keys(settings.credit_cards).length === 0
    ? '<div class="small">You have not added a card yet, so there is nothing to charge it to. Tap Next to skip this.</div>'
    : step.fields(settings);
  page.innerHTML = `${progress}<h2>${step.title}</h2>${step.hint ? `<div class="small">${step.hint}</div>` : ""}<div class="wizard-body">${body}</div>
    <div class="wizard-buttons"><button id="wizard-back-button" class="small-button"${wizardStep === 0 ? " disabled" : ""}>Back</button><button id="wizard-next-button">${step.repeat ? "Save and continue" : "Next"}</button></div>
    <button id="wizard-exit-button" class="mark-button">Skip the guide and show everything</button>`;
}

function wizardNext(settings) {
  const step = WIZARD_STEPS[wizardStep];
  if (step.needsCard && Object.keys(settings.credit_cards).length === 0) { wizardStep += 1; return showEverything(); }
  const result = step.save(settings);
  if (result === "invalid") return;
  saveSettings(settings);
  if (result === "saved") wizardAskingAgain = true;
  else wizardStep += 1;
  showEverything();
}

function finishWizard() {
  wizardActive = false;
  localStorage.setItem(SETUP_DONE_KEY, "yes");
  showEverything();
  showPage("home");
}

// ---- Saving one card, bill or subscription from its form. Returns "saved", "blank" or "invalid". ----

function saveCardFromForm(settings) {
  const name = inputText("setup-card-name");
  const limit = inputNumber("setup-card-limit");
  if (!name && limit == null) return "blank";
  if (!name || limit == null) { alert("Give the card a name and a credit limit."); return "invalid"; }
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
  return "saved";
}

function saveBillFromForm(settings) {
  const name = inputText("setup-bill-name");
  const amount = inputNumber("setup-bill-amount");
  if (!name && amount == null) return "blank";
  if (!name || amount == null) { alert("Give the bill a name and an amount."); return "invalid"; }
  const varies = document.getElementById("setup-bill-varies").checked;
  settings.monthly_bills_paid_from_checking.push({
    name, amount, day_of_month: Number(document.getElementById("setup-bill-day").value),
    ...(varies ? { is_estimate: true, amount_changes_every_month: true } : {}),
    ...(textHintsFromInput("setup-bill-text") ? { charge_text_contains: textHintsFromInput("setup-bill-text") } : {}),
  });
  return "saved";
}

function saveSubscriptionFromForm(settings) {
  const name = inputText("setup-sub-name");
  const amount = inputNumber("setup-sub-amount");
  if (!name && amount == null) return "blank";
  if (!name || amount == null) { alert("Give the subscription a name and an amount."); return "invalid"; }
  settings.subscriptions_charged_to_cards.push({
    name, amount, card: document.getElementById("setup-sub-card").value, day_of_month: Number(document.getElementById("setup-sub-day").value),
    ...(textHintsFromInput("setup-sub-text") ? { charge_text_contains: textHintsFromInput("setup-sub-text") } : {}),
  });
  return "saved";
}

function saveAndRefresh(settings) {
  saveSettings(settings);
  showEverything();
}

// Opens Set up. A first-timer (no cards, bills or subscriptions yet) gets the guided version.
function openSetupPage() {
  if (!loadSettings()) saveSettings(blankSettings());
  const settings = loadSettings();
  const nothingAddedYet = Object.keys(settings.credit_cards).length + settings.monthly_bills_paid_from_checking.length + settings.subscriptions_charged_to_cards.length === 0;
  wizardActive = nothingAddedYet && localStorage.getItem(SETUP_DONE_KEY) !== "yes";
  wizardStep = 0;
  wizardAskingAgain = false;
  showEverything();
  showPage("setup");
  document.getElementById("apply-top-button").hidden = wizardActive;
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
  if (target.id === "open-setup-button" || target.id === "start-setup-button" || target.id === "start-here-setup-button") return openSetupPage();
  const settings = loadSettings();
  if (!settings || document.getElementById("page-setup").hidden) return;

  if (target.id === "apply-top-button") return applySetupPage(settings);

  if (target.id === "wizard-start-button") { wizardActive = true; wizardStep = 0; wizardAskingAgain = false; showSetupPage(settings); document.getElementById("apply-top-button").hidden = true; return; }
  if (target.id === "wizard-next-button") return wizardNext(settings);
  if (target.id === "wizard-back-button") { wizardAskingAgain = false; wizardStep = Math.max(0, wizardStep - 1); return showSetupPage(settings); }
  if (target.id === "wizard-again-button") { wizardAskingAgain = false; return showSetupPage(settings); }
  if (target.id === "wizard-continue-button") { wizardAskingAgain = false; wizardStep += 1; return showSetupPage(settings); }
  if (target.id === "wizard-finish-button") return finishWizard();
  if (target.id === "wizard-exit-button") { wizardActive = false; localStorage.setItem(SETUP_DONE_KEY, "yes"); showSetupPage(settings); document.getElementById("apply-top-button").hidden = false; return; }

  if (target.id === "setup-save-card") { if (saveCardFromForm(settings) === "saved") saveAndRefresh(settings); return; }
  if (target.id === "setup-cancel-card") { cardBeingEdited = null; return showSetupPage(settings); }
  if (target.dataset.setupEditCard) { cardBeingEdited = target.dataset.setupEditCard; openSetupSections.add("cards"); return showSetupPage(settings); }
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

  if (target.id === "setup-add-bill") { if (saveBillFromForm(settings) === "saved") saveAndRefresh(settings); return; }
  if (target.dataset.setupRemoveBill) {
    settings.monthly_bills_paid_from_checking.splice(Number(target.dataset.setupRemoveBill), 1);
    return saveAndRefresh(settings);
  }

  if (target.id === "setup-add-subscription") { if (saveSubscriptionFromForm(settings) === "saved") saveAndRefresh(settings); return; }
  if (target.dataset.setupRemoveSubscription) {
    settings.subscriptions_charged_to_cards.splice(Number(target.dataset.setupRemoveSubscription), 1);
    return saveAndRefresh(settings);
  }

  if (target.id === "setup-remove-loan" && confirm("Remove the car loan?")) {
    settings.car_loan = null;
    return saveAndRefresh(settings);
  }
});
