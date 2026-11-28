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
    ${setupField("setup-checking", "Checking balance ($, optional). A bank link fills this in each refresh.", "number", settings.starting_balances.checking_balance)}
    ${setupField("setup-savings", "Savings balance ($, optional). A bank link fills it in if the linked bank has a savings account.", "number", settings.starting_balances.savings_balance)}
    ${setupField("setup-retirement", "Retirement balance ($, optional). Shows on Home; a bank link fills it in for you.", "number", (settings.retirement || {}).balance)}
    ${setupField("setup-allowance", "Everyday spending per month ($, optional). The forecast takes it out of checking in weekly pieces.", "number", settings.optional_monthly_variable_spending_allowance)}`;
}

// ---- Pay schedule ----

const PAY_FREQUENCIES = [["weekly", "Every week"], ["biweekly", "Every 2 weeks"], ["semimonthly", "Twice a month"], ["monthly", "Once a month"]];

// The same boxes serve Set up (prefix "setup") and the guided first run (prefix "wizard"); only the ones for the chosen frequency show.
function payScheduleFieldsHtml(paycheck, prefix) {
  const frequency = paycheck.frequency || "weekly";
  const [firstDay, secondDay] = paycheck.semimonthly_days || [1, 15];
  const section = (kinds, html) => `<div data-pay-for="${kinds}"${kinds.split(" ").includes(frequency) ? "" : " hidden"}>${html}</div>`;
  return `<div class="pay-schedule">${setupSelect(`${prefix}-frequency`, "How often are you paid?", PAY_FREQUENCIES, frequency)}
    ${section("weekly biweekly", setupSelect(`${prefix}-weekday`, "Payday", SETUP_WEEKDAYS.map((day) => [day, day]), paycheck.pay_weekday))}
    ${section("biweekly", setupField(`${prefix}-biweekly-start`, "A recent payday (so I know which weeks you are paid)", "date", paycheck.biweekly_start_date))}
    ${section("semimonthly", setupSelect(`${prefix}-day-1`, "First payday of the month", dayOptions, String(firstDay)) + setupSelect(`${prefix}-day-2`, "Second payday of the month", dayOptions, String(secondDay)))}
    ${section("monthly", setupSelect(`${prefix}-month-day`, "Paid on day", dayOptions, String(paycheck.month_day || 1)))}</div>`;
}

// Reads those boxes into the paycheck settings. Returns "invalid" (after telling the person why) or nothing.
function readPaySchedule(prefix, paycheck, say = alert) {
  const frequency = document.getElementById(`${prefix}-frequency`).value;
  const weekday = document.getElementById(`${prefix}-weekday`).value;
  const recentPayday = inputText(`${prefix}-biweekly-start`);
  if (frequency === "biweekly") {
    if (!recentPayday) { say("Pick a recent payday so I know which weeks you are paid."); return "invalid"; }
    if (new Date(recentPayday + "T00:00:00Z").getUTCDay() !== WEEKDAY_NUMBERS[weekday]) { say(`That date is not a ${weekday}. Pick a recent ${weekday} you were paid.`); return "invalid"; }
  }
  const firstDay = Number(document.getElementById(`${prefix}-day-1`).value);
  const secondDay = Number(document.getElementById(`${prefix}-day-2`).value);
  if (frequency === "semimonthly" && firstDay === secondDay) { say("Pick two different paydays."); return "invalid"; }
  paycheck.frequency = frequency;
  paycheck.pay_weekday = weekday;
  paycheck.biweekly_start_date = recentPayday || undefined;
  paycheck.semimonthly_days = [firstDay, secondDay].sort((a, b) => a - b);
  paycheck.month_day = Number(document.getElementById(`${prefix}-month-day`).value);
}

function payScheduleText(paycheck) {
  const frequency = paycheck.frequency || "weekly";
  if (frequency === "weekly") return paycheck.pay_weekday;
  if (frequency === "biweekly") return `every other ${paycheck.pay_weekday}`;
  if (frequency === "semimonthly") return `${(paycheck.semimonthly_days || [1, 15]).join(" & ")} of the month`;
  return `day ${paycheck.month_day || 1} of the month`;
}

document.addEventListener("change", (event) => {
  if (!event.target.id || !event.target.id.endsWith("-frequency")) return;
  const schedule = event.target.closest(".pay-schedule");
  if (!schedule) return;
  for (const part of schedule.querySelectorAll("[data-pay-for]")) part.hidden = !part.dataset.payFor.split(" ").includes(event.target.value);
});

function paycheckSectionHtml(settings) {
  const overrides = Object.entries(settings.paycheck.one_time_amount_overrides || {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const rows = overrides.map(([date, amount]) => `<div class="tile-row small charge-row" data-setup-hold="override:${date}"><span>${formatDate(date)}</span>
      <span>${formatMoney(amount)}<br><button class="mark-button" data-setup-remove-override="${date}">remove</button></span></div>`).join("");
  return `${setupField("setup-takehome", "Take-home pay per paycheck ($)", "number", settings.paycheck.usual_take_home_amount)}
    ${payScheduleFieldsHtml(settings.paycheck, "setup")}
    <b class="setup-subtitle setup-heading">One-time paycheck amounts</b>
    <div class="small">For a bonus or a short check. That payday uses this amount instead of the usual one.</div>
    ${rows}
    ${setupAddBox("Add a one-time amount", `${setupField("setup-override-date", "Payday", "date")}${setupField("setup-override-amount", "Amount that day ($)", "number")}<button id="setup-add-override">Add amount</button>`)}`;
}

function spendingTabSectionHtml(settings) {
  const ruleRows = (settings.merchant_rules || []).map((rule, position) => `<div class="tile-row small charge-row" data-setup-hold="rule:${position}"><span>${escapeHtml(rule.text)}<br><span class="charge-card">${escapeHtml(CATEGORY_NAMES[rule.category] || rule.category)}</span></span>
      <span><button class="mark-button" data-setup-remove-rule="${position}">remove</button></span></div>`).join("");
  const ruleForm = `${setupField("setup-rule-text", "Charge contains (a store or word)")}
    ${setupSelect("setup-rule-category", "Count it as", Object.entries(CATEGORY_NAMES).map(([key, name]) => [key, name]), "GROCERIES")}
    <button id="setup-add-rule">Add rule</button>`;
  return `${setupField("setup-deposit-text", "Words in your bank's paycheck deposit (optional, separate with commas). Paychecks that say payroll or direct deposit are found on their own.", "text", ((settings.paycheck || {}).deposit_text_contains || []).join(", "))}
    ${setupField("setup-ignore-text", "Your savings account's name as it shows on bank charges, like your savings bank (optional, words separated with commas). These moves leave Spending and show in its Savings block.", "text", (settings.transfers_ignore_text || []).join(", "))}
    <b class="setup-subtitle setup-heading">Your own category rules</b>
    <div class="small">When a charge contains a word, it goes in the category you pick. Your rules win over the built-in ones.</div>
    ${ruleRows}
    ${setupAddBox("Add a rule", ruleForm)}`;
}

function moreCardsSectionHtml(settings) {
  const cardEntries = Object.entries(settings.credit_cards);
  const otherRows = settings.other_cards.map((otherCard, position) => `<div class="tile-row small charge-row" data-setup-hold="othercard:${position}"><span>${escapeHtml(otherCard.name)}<br><span class="charge-card">${otherCard.expires ? "expires " + otherCard.expires : "no expiry"}</span></span>
      <span><button class="mark-button" data-setup-remove-othercard="${position}">remove</button></span></div>`).join("");
  const benefitRows = settings.card_benefits.map((benefit, position) => `<div class="tile-row small charge-row" data-setup-hold="benefit:${position}"><span>${escapeHtml(benefit.name)}<br><span class="charge-card">${escapeHtml((settings.credit_cards[benefit.card] || {}).display_name || "")}</span></span>
      <span>${formatMoney(benefit.used || 0)} of ${formatMoney(benefit.total)}<br><button class="mark-button" data-setup-remove-benefit="${position}">remove</button></span></div>`).join("");
  const benefitForm = cardEntries.length
    ? `${setupSelect("setup-benefit-card", "Card", cardEntries.map(([cardKey, card]) => [cardKey, card.display_name]), cardEntries[0][0])}
       ${setupField("setup-benefit-name", "Benefit (for example: Airline fee credit)")}
       ${setupField("setup-benefit-total", "Total credit ($)", "number")}
       ${setupField("setup-benefit-used", "Already used ($, optional)", "number")}
       <button id="setup-add-benefit">Add benefit</button>`
    : '<div class="small">Add a card first.</div>';
  return `${setupField("setup-util-target", "Credit utilization goal (% of each limit to report)", "number", settings.credit_utilization.target_percent)}
    <b class="setup-subtitle setup-heading">Other cards</b>
    <div class="small">Cards you only want to track the expiry of.</div>
    ${otherRows}
    ${setupAddBox("Add another card", `${setupField("setup-other-name", "Card name")}${setupField("setup-other-expiry", "Expires (month, optional)", "month")}<button id="setup-add-other">Add card</button>`)}
    <b class="setup-subtitle setup-heading">Card benefits</b>
    ${benefitRows}
    ${setupAddBox("Add a benefit", benefitForm)}`;
}

function hsaSectionHtml(settings) {
  const hsa = settings.hsa || {};
  return `${setupField("setup-hsa-provider", "HSA provider name (optional)", "text", hsa.provider)}
    ${setupField("setup-hsa-balance", "Balance ($)", "number", hsa.balance)}
    ${setupField("setup-hsa-weekly", "Put in each week ($)", "number", hsa.weekly_contribution)}
    ${setupField("setup-hsa-bill-payment", "Medical bill payment each month ($)", "number", hsa.monthly_bill_payment)}
    ${setupField("setup-hsa-bill-left", "Medical bill still owed ($)", "number", hsa.medical_bill_remaining)}`;
}

function ptoSectionHtml(settings) {
  const buckets = ptoBucketsOf(settings.pto);
  const fields = buckets.map((bucket, position) => setupField(`setup-pto-${position}`, `${escapeHtml(bucket.name)} (hours)`, "number", bucket.hours)).join("");
  return `${fields || '<div class="small">Nothing listed.</div>'}<div class="small">Add, rename or delete these on the PTO tab.</div>`;
}

function closedAmountOf(card) {
  const closed = card ? card.balances_by_statement.find((statement) => !statement.still_accumulating) : null;
  return closed ? closed.amount : "";
}

function openAmountOf(card) {
  const open = card ? card.balances_by_statement.find((statement) => statement.still_accumulating) : null;
  return open ? open.amount : "";
}

// The most recent statement close on or before today.
function lastStatementCloseDate(card, todayDateText) {
  for (let date = todayDateText; ; date = addDays(date, -1)) if (dayOfMonthOn(date, card.statement_close_day)) return date;
}

// What you owe on a card, typed in: a closed statement (due on its date) and the open one that is still building.
function statementsFromTypedAmounts(card, closedAmount, openAmount, todayDateText) {
  const statements = [];
  const lastClose = lastStatementCloseDate(card, todayDateText);
  const closedDue = dueDateForCharge(card, lastClose);
  if (closedAmount > 0 && closedDue >= todayDateText) statements.push({ amount: closedAmount, statement_closed_on: lastClose, due_date: closedDue });
  if (openAmount > 0) {
    const closeDate = nextStatementCloseDate(card, todayDateText);
    statements.push({ amount: openAmount, statement_closes_on: closeDate, due_date: dueDateForCharge(card, closeDate), still_accumulating: true });
  }
  return statements;
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
    ${setupField("setup-card-closed", "Owed on the last closed statement ($, optional)", "number", closedAmountOf(editing))}
    ${setupField("setup-card-open", "Owed so far on the open statement ($, optional)", "number", openAmountOf(editing))}
    ${setupField("setup-card-program", "Rewards program (optional, for example: Chase points)", "text", editing && settings.rewards[cardBeingEdited] ? settings.rewards[cardBeingEdited].program : "")}
    ${setupField("setup-card-points", "Points balance (optional)", "number", editing && settings.rewards[cardBeingEdited] ? settings.rewards[cardBeingEdited].points_balance : "")}
    ${setupField("setup-card-expiry", "Card expires (month)", "month", expiry)}
    ${setupField("setup-card-fee", "Annual fee ($, leave empty if none)", "number", fee ? fee.amount : "")}
    ${setupSelect("setup-card-fee-month", "Annual fee is charged in month", Array.from({ length: 12 }, (unused, index) => [String(index + 1), new Date(2000, index, 1).toLocaleString("en-US", { month: "long" })]), fee ? String(fee.month) : "1")}`;
}

function cardsSectionHtml(settings) {
  const editing = cardBeingEdited ? settings.credit_cards[cardBeingEdited] : null;
  const rows = Object.entries(settings.credit_cards).map(([cardKey, card]) => `<div class="tile-row small charge-row" data-setup-hold="card:${cardKey}">
      <span>${escapeHtml(card.display_name)}<br><span class="charge-card">${formatMoney(card.credit_limit)} limit · closes day ${card.statement_close_day} · due day ${card.payment_due_day}</span></span>
      <span><button class="mark-button" data-setup-edit-card="${cardKey}">edit</button><br><button class="mark-button" data-setup-remove-card="${cardKey}">remove</button></span></div>`).join("");
  return `${rows || '<div class="small">No cards yet.</div>'}
    ${setupAddBox(editing ? "Change this card" : "Add a card", `${cardFormFieldsHtml(settings)}
    <button id="setup-save-card">${editing ? "Save changes" : "Add card"}</button>${editing ? '<button id="setup-cancel-card" class="small-button">Cancel</button>' : ""}`)}`;
}

function billsSectionHtml(settings) {
  const rows = settings.monthly_bills_paid_from_checking.map((bill, position) => `<div class="tile-row small charge-row" data-setup-hold="bill:${position}">
      <span>${escapeHtml(bill.name)}<br><span class="charge-card">day ${bill.day_of_month}${bill.amount_changes_every_month ? " · amount changes" : ""}</span></span>
      <span>${formatMoney(bill.amount)}<br><button class="mark-button" data-setup-remove-bill="${position}">remove</button></span></div>`).join("");
  return `${rows || '<div class="small">None yet.</div>'}
    ${setupAddBox("Add a bill", `${billFormFieldsHtml()}<button id="setup-add-bill">Add bill</button>`)}`;
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
  const rows = settings.subscriptions_charged_to_cards.map((subscription, position) => `<div class="tile-row small charge-row" data-setup-hold="sub:${position}">
      <span>${escapeHtml(subscription.name)}<br><span class="charge-card">${escapeHtml((settings.credit_cards[subscription.card] || {}).display_name || "")} · day ${subscription.day_of_month || (subscription.assumed_days_of_month || []).join("/")}</span></span>
      <span>${formatMoney(subscription.amount)}<br><button class="mark-button" data-setup-remove-subscription="${position}">remove</button></span></div>`).join("");
  const form = Object.keys(settings.credit_cards).length ? `${subFormFieldsHtml(settings)}<button id="setup-add-subscription">Add subscription</button>` : '<div class="small">Add a card first.</div>';
  return `${rows || '<div class="small">None yet.</div>'}${setupAddBox("Add a subscription", form)}`;
}

// The wizard's first-loan boxes (name, type, amount, rate, payment, first date). Loans are managed on the Loans tab.
function loanWizardFieldsHtml() {
  return `${setupSelect("setup-loan-kind", "Type of loan", Object.entries(LOAN_KINDS).map(([kind, [label]]) => [kind, label]), "car")}
    ${setupField("setup-loan-name", "Name (optional)")}
    ${setupField("setup-loan-amount", "Amount borrowed ($)", "number")}
    ${setupField("setup-loan-rate", "Yearly interest rate (%)", "number")}
    ${setupField("setup-loan-payment", "Monthly payment ($)", "number")}
    ${setupField("setup-loan-first", "First payment date", "date")}`;
}

// Set up lists your loans; adding, changing and removing happen on the Loans tab.
function loanSectionHtml(settings) {
  const rows = loansOf(settings).map((loan) => `<div class="tile-row small charge-row"><span>${escapeHtml(loan.name)}<br><span class="charge-card">${formatMoney(loan.payment)} a month \u00b7 ${loan.annual_rate_percent}%</span></span></div>`).join("");
  return `${rows || '<div class="small">No loans yet.</div>'}<button id="setup-open-loans" class="small-button">Add or change loans on the Loans tab</button>`;
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

const SETUP_ICONS = { basics: ["&#127974;", "#5aa2ff"], paycheck: ["&#128181;", "#4ade80"], overtime: ["&#9201;&#65039;", "#f87171"], cards: ["&#128179;", "#a78bfa"], morecards: ["&#127873;", "#f472b6"],
  bills: ["&#129534;", "#fbbf24"], subscriptions: ["&#128257;", "#2dd4bf"], spendingtab: ["&#128722;", "#fb923c"], loan: ["&#128663;", "#94a3b8"], hsa: ["&#129658;", "#ff6b6b"], pto: ["&#127796;", "#86efac"], tabs: ["&#129517;", "#8c909b"] };

// A tinted box around a small "add something" form, so it is obvious where to type.
function setupAddBox(title, bodyHtml) {
  return `<div class="setup-add"><b class="setup-subtitle">${title}</b>${bodyHtml}</div>`;
}

const openSetupSections = new Set();

function setupSection(id, title, summary, bodyHtml) {
  const [icon, color] = SETUP_ICONS[id] || ["&#9881;&#65039;", "#5aa2ff"];
  return `<details class="tile setup-section" data-setup-section="${id}" style="--section-color:${color}"${openSetupSections.has(id) ? " open" : ""}>
    <summary><span class="section-icon">${icon}</span><span class="section-text"><b>${title}</b><span class="small">${summary}</span></span></summary><div class="setup-body">${bodyHtml}</div></details>`;
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
  const loans = loansOf(settings);
  const overtimeRate = settings.overtime.gross_hourly_rate;
  const tabsHidden = settings.hidden_tabs.length;
  page.innerHTML = `<h2>Set up</h2>
    <div class="small">Tap a section to open it. Boxes save with Apply (top right) or Save changes at the bottom. Add buttons save right away.</div>
    <button id="wizard-start-button" class="small-button">Start the guided set-up</button>
    ${setupSection("basics", "Basics", `Floor ${formatMoney(settings.minimum_checking_floor)}`, basicsSectionHtml(settings))}
    ${setupSection("paycheck", "Paycheck", `${formatMoney(settings.paycheck.usual_take_home_amount)} · ${payScheduleText(settings.paycheck)}`, paycheckSectionHtml(settings))}
    ${setupSection("overtime", "Overtime", overtimeRate ? `${formatMoney(overtimeRate)} an hour` : "Not set", overtimeSectionHtml(settings))}
    ${setupSection("cards", "Credit cards", plural(Object.keys(settings.credit_cards).length, "card"), cardsSectionHtml(settings))}
    ${setupSection("morecards", "Card extras", `${plural(settings.card_benefits.length, "benefit")} · ${plural(settings.other_cards.length, "other card")}`, moreCardsSectionHtml(settings))}
    ${setupSection("bills", "Bills", plural(bills, "bill"), billsSectionHtml(settings))}
    ${setupSection("subscriptions", "Subscriptions", plural(subscriptions, "subscription"), subscriptionsSectionHtml(settings))}
    ${setupSection("spendingtab", "Spending tab", "Paycheck match · ignored transfers", spendingTabSectionHtml(settings))}
    ${setupSection("loan", "Loans", loans.length ? `${loans.length} loan${loans.length === 1 ? "" : "s"}` : "None", loanSectionHtml(settings))}
    ${setupSection("hsa", "HSA", settings.hsa && settings.hsa.provider ? escapeHtml(settings.hsa.provider) : "Not set", hsaSectionHtml(settings))}
    ${setupSection("pto", "Time off", "PTO, comp time, holiday", ptoSectionHtml(settings))}
    ${setupSection("tabs", "Menu tabs", tabsHidden ? `${tabsHidden} hidden` : "All shown", menuTabsSectionHtml(settings))}
    <button id="apply-bottom-button" class="apply-bottom">Save changes</button>`;
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
  { icon: "&#128075;", title: "Let's set up your app", intro: true, button: "Let's go",
    hint: "About five minutes, one question at a time. Skip anything you don't have. Everything can be changed later in Settings → Set up in the app, and nothing leaves your phone." },
  { icon: "&#128181;", title: "How often are you paid?", fields: (s) => payScheduleFieldsHtml(s.paycheck, "wizard"), save: (s) => readPaySchedule("wizard", s.paycheck) },
  { icon: "&#128176;", title: "How much is each paycheck, after tax?", fields: (s) => setupField("wizard-takehome", "Take-home pay ($)", "number", s.paycheck.usual_take_home_amount || ""), save: (s) => { s.paycheck.usual_take_home_amount = inputNumber("wizard-takehome") ?? 0; } },
  { icon: "&#127974;", title: "What is in checking right now?", hint: "A bank link fills this in for you later. Type it now if you like.", fields: (s) => setupField("wizard-checking", "Checking balance ($)", "number", s.starting_balances.checking_balance || ""), save: (s) => { s.starting_balances.checking_balance = inputNumber("wizard-checking") ?? 0; s.starting_balances.as_of_date = todayText(); } },
  { icon: "&#128055;", title: "How much is in savings?", hint: "Optional. Leave it empty if you don't keep a savings balance here.", fields: (s) => setupField("wizard-savings", "Savings balance ($)", "number", s.starting_balances.savings_balance || ""), save: (s) => { s.starting_balances.savings_balance = inputNumber("wizard-savings") ?? 0; } },
  { icon: "&#128735;&#65039;", title: "What is the lowest checking balance you want to stay above?", hint: "The app warns you before checking drops below this.", fields: (s) => setupField("wizard-floor", "Lowest balance ($)", "number", s.minimum_checking_floor), save: (s) => { s.minimum_checking_floor = inputNumber("wizard-floor") ?? 500; } },
  { icon: "&#128179;", title: "Add a credit card", hint: "What you owe on it helps the forecast plan the payments. Leave the name empty to skip. You can add more.", repeat: "card", fields: (s) => cardFormFieldsHtml(s), save: (s) => saveCardFromForm(s) },
  { icon: "&#129534;", title: "Add a monthly bill paid from checking", hint: "Rent, car payment, power. Leave the name empty to skip.", repeat: "bill", fields: () => billFormFieldsHtml(), save: (s) => saveBillFromForm(s) },
  { icon: "&#128257;", title: "Add a subscription charged to a card", hint: "Netflix, a gym, anything that bills a card each month. Leave the name empty to skip.", repeat: "subscription", needsCard: true, fields: (s) => subFormFieldsHtml(s), save: (s) => saveSubscriptionFromForm(s) },
  { icon: "&#128663;", title: "Do you have a loan?", hint: "A car loan, mortgage or any other. Optional; leave it empty to skip. You can add more on the Loans tab.", fields: () => loanWizardFieldsHtml(), save: (s) => readLoanBoxes(s) },
  { icon: "&#9201;&#65039;", title: "Do you work overtime?", hint: "Optional. This powers the Planner tab. Leave it empty to skip.", fields: (s) => overtimeSectionHtml(s), save: (s) => readOvertimeBoxes(s) },
  { icon: "&#128722;", title: "About how much do you spend each month on everyday things?", hint: "Optional. Groceries, gas, going out. The forecast takes it out of checking in weekly pieces so the low point is realistic.", fields: (s) => setupField("wizard-allowance", "Everyday spending per month ($)", "number", s.optional_monthly_variable_spending_allowance ?? ""), save: (s) => { s.optional_monthly_variable_spending_allowance = inputNumber("wizard-allowance"); } },
  { icon: "&#128200;", title: "What is in your retirement account?", hint: "Optional. A bank link fills this in for you later.", fields: (s) => setupField("wizard-retirement", "Retirement balance ($)", "number", (s.retirement || {}).balance ?? ""), save: (s) => { s.retirement = { ...(s.retirement || {}), balance: inputNumber("wizard-retirement") }; } },
  { icon: "&#129658;", title: "Do you have an HSA?", hint: "Optional. Leave it empty to skip.", fields: (s) => hsaSectionHtml(s), save: (s) => readHsaBoxes(s) },
  { icon: "&#127796;", title: "How much time off do you have?", hint: "Optional. Hours of PTO, comp time and holiday time.", fields: (s) => ptoSectionHtml(s), save: (s) => readPtoBoxes(s) },
  { icon: "&#129517;", title: "Which tabs do you want in the menu?", hint: "Untick anything you will not use. You can bring it back any time in Set up.", fields: (s) => hideableTabs().map((name) => `<label class="small setup-label"><input type="checkbox" data-setup-tab="${name}"${s.hidden_tabs.includes(name) ? "" : " checked"}> ${document.getElementById("tab-" + name).dataset.title}</label>`).join(""), save: (s) => readHiddenTabs(s) },
  { icon: "&#128279;", title: "Link your bank (optional)", info: true, button: "Got it",
    hint: "A free bank link fills in balances, card statements and your spending on its own. It needs a small free relay, and the README walks through it step by step. You can do this any time in Settings. The app works fine without it." },
];

function wizardSummaryHtml(settings) {
  const facts = [["&#128179;", plural(Object.keys(settings.credit_cards).length, "card")], ["&#129534;", plural(settings.monthly_bills_paid_from_checking.length, "bill")], ["&#128257;", plural(settings.subscriptions_charged_to_cards.length, "subscription")]];
  return `<div class="wizard-facts">${facts.map(([icon, text]) => `<div><span>${icon}</span><b>${text}</b></div>`).join("")}</div>`;
}

function showWizard(settings, page) {
  const lastStep = WIZARD_STEPS.length;
  const step = WIZARD_STEPS[wizardStep];
  const percent = Math.round((wizardStep / lastStep) * 100);
  const progress = `<div class="wizard-progress"><div class="progress"><div class="progress-fill" style="width:${percent}%"></div></div><div class="small">${wizardStep >= lastStep ? "All done" : `Step ${wizardStep + 1} of ${lastStep}`}</div></div>`;
  const card = (icon, title, hint, body, buttons) => `${progress}<div class="wizard-card"><div class="wizard-icon">${icon}</div><h2>${title}</h2>${hint ? `<div class="wizard-hint">${hint}</div>` : ""}${body}</div>${buttons}`;
  if (wizardStep >= lastStep) {
    page.innerHTML = card("&#127881;", "You are set up", "Everything can be changed later in Settings → Set up in the app.", wizardSummaryHtml(settings),
      `<div class="wizard-buttons"><button id="wizard-back-button" class="small-button">Back</button><button id="wizard-finish-button">Go to Home</button></div>`);
    return;
  }
  if (wizardAskingAgain) {
    page.innerHTML = card("&#9989;", "Saved", `Add another ${step.repeat}?`, "",
      `<div class="wizard-buttons"><button id="wizard-again-button" class="small-button">Add another</button><button id="wizard-continue-button">Continue</button></div>`);
    return;
  }
  const body = step.needsCard && Object.keys(settings.credit_cards).length === 0
    ? '<div class="small">You have not added a card yet, so there is nothing to charge it to. Tap Skip to move on.</div>'
    : step.fields ? `<div class="wizard-body">${step.fields(settings)}</div>` : "";
  const nextLabel = step.button || (step.repeat ? "Save and continue" : "Next");
  const canSkip = !step.intro && !step.info;
  page.innerHTML = card(step.icon, step.title, step.hint, body,
    `<div class="wizard-buttons"><button id="wizard-back-button" class="small-button"${wizardStep === 0 ? " disabled" : ""}>Back</button><button id="wizard-next-button">${nextLabel}</button></div>
    ${canSkip ? '<button id="wizard-skip-button" class="mark-button">Skip this step</button>' : ""}
    <button id="wizard-exit-button" class="mark-button">Skip the guide and show everything</button>`);
}

function wizardNext(settings) {
  const step = WIZARD_STEPS[wizardStep];
  if (step.needsCard && Object.keys(settings.credit_cards).length === 0) { wizardStep += 1; return showEverything(); }
  const result = step.save ? step.save(settings) : undefined;
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
  const closedTyped = inputNumber("setup-card-closed") || 0;
  const openTyped = inputNumber("setup-card-open") || 0;
  const amountsChanged = closedTyped !== (closedAmountOf(previous.balances_by_statement ? previous : null) || 0) || openTyped !== (openAmountOf(previous.balances_by_statement ? previous : null) || 0);
  if (amountsChanged) {
    settings.credit_cards[cardKey].balances_by_statement = statementsFromTypedAmounts(settings.credit_cards[cardKey], closedTyped, openTyped, todayText());
    settings.credit_cards[cardKey].current_balance = Math.round((closedTyped + openTyped) * 100) / 100;
  }
  settings.rewards = settings.rewards || {};
  const previousReward = settings.rewards[cardKey] || {};
  settings.rewards[cardKey] = { program: inputText("setup-card-program") || previousReward.program || "Points", points_balance: inputNumber("setup-card-points") ?? previousReward.points_balance ?? null };
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
  showToast("Saved.");
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

function readHsaBoxes(settings) {
  settings.hsa = { ...(settings.hsa || {}), provider: inputText("setup-hsa-provider"), balance: inputNumber("setup-hsa-balance"), weekly_contribution: inputNumber("setup-hsa-weekly"),
    monthly_bill_payment: inputNumber("setup-hsa-bill-payment"), medical_bill_remaining: inputNumber("setup-hsa-bill-left") };
}

function readPtoBoxes(settings) {
  const buckets = ptoBucketsOf(settings.pto);
  settings.pto = { buckets: buckets.map((bucket, position) => document.getElementById(`setup-pto-${position}`) ? { ...bucket, hours: inputNumber(`setup-pto-${position}`) } : bucket) };
}

function readOvertimeBoxes(settings) {
  settings.overtime = { gross_hourly_rate: inputNumber("setup-ot-gross"), take_home_per_overtime_hour: inputNumber("setup-ot-takehome"), paid_days_after_period_ends: inputNumber("setup-ot-days") ?? 7 };
}

function readHiddenTabs(settings) {
  settings.hidden_tabs = hideableTabs().filter((name) => !document.querySelector(`[data-setup-tab="${name}"]`).checked);
}

// The wizard's loan boxes. All blank adds nothing; part-filled is refused (returns "invalid") with a message.
function readLoanBoxes(settings, say = alert) {
  const values = { name: inputText("setup-loan-name"), kind: document.getElementById("setup-loan-kind").value, amount: inputText("setup-loan-amount"), rate: inputText("setup-loan-rate"), payment: inputText("setup-loan-payment"), first: inputText("setup-loan-first") };
  if (!values.amount && !values.payment && !values.first) return;
  const result = loanFromInputs(values);
  if (result.error) { say(result.error); return "invalid"; }
  saveLoansTo(settings, [...loansOf(settings), result.loan]);
}

// Copies every plain box on the page into the settings. Quiet mode (used before an Add or Remove button re-draws the page)
// skips anything half-filled instead of complaining, so nothing typed is lost.
function readPlainBoxes(settings, quiet = false) {
  if (!document.getElementById("setup-floor")) return;
  const say = quiet ? () => {} : alert;
  settings.minimum_checking_floor = inputNumber("setup-floor") ?? 0;
  settings.starting_balances.checking_balance = inputNumber("setup-checking") ?? 0;
  settings.starting_balances.savings_balance = inputNumber("setup-savings") ?? 0;
  settings.paycheck.usual_take_home_amount = inputNumber("setup-takehome") ?? 0;
  const scheduleBefore = JSON.stringify(settings.paycheck);
  if (readPaySchedule("setup", settings.paycheck, say) === "invalid") { if (!quiet) return "invalid"; settings.paycheck = JSON.parse(scheduleBefore); }
  settings.retirement = { ...(settings.retirement || {}), balance: inputNumber("setup-retirement") };
  settings.optional_monthly_variable_spending_allowance = inputNumber("setup-allowance");
  settings.credit_utilization = { ...(settings.credit_utilization || {}), target_percent: inputNumber("setup-util-target") ?? 9 };
  readHsaBoxes(settings);
  readPtoBoxes(settings);
  const depositWords = textHintsFromInput("setup-deposit-text");
  if (depositWords) settings.paycheck.deposit_text_contains = depositWords; else delete settings.paycheck.deposit_text_contains;
  settings.transfers_ignore_text = textHintsFromInput("setup-ignore-text") || [];

  readOvertimeBoxes(settings);
  readHiddenTabs(settings);
}

// Apply: saves everything in the plain boxes on this page in one go.
function applySetupPage(settings) {
  if (readPlainBoxes(settings) === "invalid") return;
  saveAndRefresh(settings);
  const applyButton = document.getElementById("apply-top-button");
  applyButton.textContent = "Applied ✓";
  setTimeout(() => { applyButton.textContent = "Apply"; }, 1500);
  showToast("Saved. Everything is updated.");
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target.id === "open-setup-button" || target.id === "start-setup-button" || target.id === "start-here-setup-button") return openSetupPage();
  const settings = loadSettings();
  if (!settings || document.getElementById("page-setup").hidden) return;

  if (target.id === "apply-top-button" || target.id === "apply-bottom-button") return applySetupPage(settings);

  // Add, save and remove buttons re-draw the page, so keep what was typed in the plain boxes first.
  if (/^setup-(add|save|remove)/.test(target.id) || Object.keys(target.dataset).some((key) => key.startsWith("setupRemove") || key === "setupEditCard")) readPlainBoxes(settings, true);

  if (target.id === "wizard-start-button") { wizardActive = true; wizardStep = 0; wizardAskingAgain = false; showSetupPage(settings); document.getElementById("apply-top-button").hidden = true; return; }
  if (target.id === "wizard-next-button") return wizardNext(settings);
  if (target.id === "wizard-skip-button") { wizardStep += 1; return showSetupPage(settings); }
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

  if (target.id === "setup-add-override") {
    const date = inputText("setup-override-date");
    const amount = inputNumber("setup-override-amount");
    if (!date || amount == null) { alert("Pick the payday and the amount for that day."); return; }
    settings.paycheck.one_time_amount_overrides = { ...(settings.paycheck.one_time_amount_overrides || {}), [date]: amount };
    openSetupSections.add("paycheck");
    return saveAndRefresh(settings);
  }
  if (target.dataset.setupRemoveOverride) {
    delete settings.paycheck.one_time_amount_overrides[target.dataset.setupRemoveOverride];
    return saveAndRefresh(settings);
  }
  if (target.id === "setup-add-rule") {
    const text = inputText("setup-rule-text");
    if (!text) { alert("Type a store name or word to look for."); return; }
    settings.merchant_rules = [...(settings.merchant_rules || []), { text, category: document.getElementById("setup-rule-category").value }];
    openSetupSections.add("spendingtab");
    return saveAndRefresh(settings);
  }
  if (target.dataset.setupRemoveRule) {
    settings.merchant_rules.splice(Number(target.dataset.setupRemoveRule), 1);
    return saveAndRefresh(settings);
  }
  if (target.id === "setup-add-other") {
    const name = inputText("setup-other-name");
    if (!name) { alert("Give the card a name."); return; }
    const expires = inputText("setup-other-expiry");
    settings.other_cards.push({ name, ...(expires ? { expires } : {}) });
    openSetupSections.add("morecards");
    return saveAndRefresh(settings);
  }
  if (target.dataset.setupRemoveOthercard) {
    settings.other_cards.splice(Number(target.dataset.setupRemoveOthercard), 1);
    return saveAndRefresh(settings);
  }
  if (target.id === "setup-add-benefit") {
    const name = inputText("setup-benefit-name");
    const total = inputNumber("setup-benefit-total");
    if (!name || !total) { alert("Give the benefit a name and a total amount."); return; }
    settings.card_benefits.push({ name, card: document.getElementById("setup-benefit-card").value, total, used: inputNumber("setup-benefit-used") || 0 });
    openSetupSections.add("morecards");
    return saveAndRefresh(settings);
  }
  if (target.dataset.setupRemoveBenefit) {
    settings.card_benefits.splice(Number(target.dataset.setupRemoveBenefit), 1);
    return saveAndRefresh(settings);
  }

  if (target.id === "setup-open-loans") return showPage("car");
});

// Hold a Set up row to edit it in a sheet, like holding a bill on the Bills tab.
// holdKey is "kind:key", for example "bill:2" or "override:2026-12-25".
function editSetupItem(holdKey) {
  const kind = holdKey.slice(0, holdKey.indexOf(":"));
  const key = holdKey.slice(holdKey.indexOf(":") + 1);
  if (kind === "bill" || kind === "sub") return editBillItem(kind, Number(key));
  const settings = loadSettings();
  if (!settings) return;
  readPlainBoxes(settings, true); // keep anything typed in the plain boxes, the page re-draws after saving
  if (kind === "card") { cardBeingEdited = key; openSetupSections.add("cards"); return showSetupPage(settings); }
  const cardOptions = Object.entries(settings.credit_cards).map(([cardKey, card]) => [cardKey, card.display_name]);
  const overrides = settings.paycheck.one_time_amount_overrides || {};
  const editors = {
    override: () => ({
      title: "Edit one-time paycheck",
      fields: [{ id: "date", label: "Payday", type: "date", value: key }, { id: "amount", label: "Amount that day ($)", isMoney: true, value: overrides[key] }],
      save: (values) => {
        if (!values.date || !(values.amount > 0)) return "Pick a payday and an amount more than 0.";
        delete overrides[key];
        settings.paycheck.one_time_amount_overrides = { ...overrides, [values.date]: values.amount };
      },
    }),
    rule: (rule = settings.merchant_rules[Number(key)]) => ({
      title: "Edit category rule",
      fields: [{ id: "text", label: "Charge contains (a store or word)", value: rule.text }, { id: "category", label: "Count it as", options: [...Object.entries(CATEGORY_NAMES), ...(CATEGORY_NAMES[rule.category] ? [] : [[rule.category, rule.category]])], value: rule.category }],
      save: (values) => {
        if (!values.text) return "Type a store name or word to look for.";
        settings.merchant_rules[Number(key)] = { ...rule, text: values.text, category: values.category };
      },
    }),
    othercard: (otherCard = settings.other_cards[Number(key)]) => ({
      title: "Edit card",
      fields: [{ id: "name", label: "Card name", value: otherCard.name }, { id: "expires", label: "Expires (month, optional)", type: "month", value: otherCard.expires || "" }],
      save: (values) => {
        if (!values.name) return "Give the card a name.";
        const updated = { ...otherCard, name: values.name, expires: values.expires };
        if (!values.expires) delete updated.expires;
        settings.other_cards[Number(key)] = updated;
      },
    }),
    benefit: (benefit = settings.card_benefits[Number(key)]) => ({
      title: "Edit benefit", icon: "&#127873;", accent: "#a78bfa",
      fields: [{ id: "name", label: "Benefit", value: benefit.name }, { id: "card", label: "Card", chips: cardChipsFor(settings), value: benefit.card },
        { id: "total", label: "Total credit ($)", isMoney: true, value: benefit.total }, { id: "used", label: "Already used ($)", isMoney: true, value: benefit.used || 0 }],
      save: (values) => {
        if (!values.name || !(values.total > 0)) return "Give the benefit a name and a total amount.";
        settings.card_benefits[Number(key)] = { ...benefit, name: values.name, card: values.card, total: values.total, used: values.used || 0 };
      },
    }),
  };
  if (!editors[kind]) return;
  const editor = editors[kind]();
  openSetupItemSheet(editor, () => saveAndRefresh(settings));
}

// A bottom sheet with one box per field, Save and Cancel. editor.save returns an error message, or nothing when it worked.
// Optional: editor.icon and editor.accent put a colored badge beside the title; editor.saveLabel renames Save;
// a field with chips: [[value, name, color]] shows tap-to-pick buttons instead of a box.
function openSetupItemSheet(editor, afterSave) {
  const cover = document.createElement("div");
  cover.className = "date-cover category-picker filter-sheet bill-editor";
  const typedValues = Object.fromEntries(editor.fields.map((field) => [field.id, field.value ?? ""]));
  let errorText = "";
  const fieldHtml = (field) => `<div class="filter-label">${field.label}</div>` + (field.chips
    ? `<div class="choice-list sheet-chips">${field.chips.map(([value, name, color]) => `<button class="choice-button${String(typedValues[field.id]) === String(value) ? " is-current" : ""}" data-sheet-chip="${field.id}" data-chip-value="${escapeHtml(value)}" style="--dot:${color || "var(--accent)"}"><i class="choice-dot"></i><b>${escapeHtml(name)}</b></button>`).join("")}</div>`
    : field.options
    ? `<select id="setup-sheet-${field.id}">${field.options.map(([value, name]) => `<option value="${escapeHtml(value)}"${String(typedValues[field.id]) === String(value) ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select>`
    : `<input id="setup-sheet-${field.id}" type="${field.type || "text"}"${field.isMoney ? ' inputmode="decimal"' : ""}${field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : ""} value="${escapeHtml(String(typedValues[field.id]))}" autocomplete="off">`);
  const badge = editor.icon ? `<span class="sheet-badge" style="--badge-color:${editor.accent || "var(--accent)"}">${editor.icon}</span>` : "";
  const draw = () => {
    cover.innerHTML = `<div class="date-box" style="--sheet-accent:${editor.accent || "var(--accent)"}"><div class="date-question sheet-title">${badge}<span>${escapeHtml(editor.title)}</span></div>
      ${editor.fields.map(fieldHtml).join("")}
      ${errorText ? `<div class="editor-error">${escapeHtml(errorText)}</div>` : ""}
      <div class="choice-list filter-actions"><button class="choice-button is-wide is-apply" data-setup-sheet-save><b>${escapeHtml(editor.saveLabel || "Save")}</b></button><button class="choice-button is-wide" data-setup-sheet-cancel><b>Cancel</b></button></div></div>`;
  };
  // Keep what was typed in the boxes before the sheet re-draws (picking a chip re-draws it).
  const readTypedBoxes = () => { for (const field of editor.fields) { const box = cover.querySelector("#setup-sheet-" + field.id); if (box) typedValues[field.id] = box.value.trim(); } };
  draw();
  cover.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-sheet-chip]");
    if (chip) { readTypedBoxes(); typedValues[chip.dataset.sheetChip] = chip.dataset.chipValue; draw(); return; }
    if (event.target.closest("[data-setup-sheet-save]")) {
      readTypedBoxes();
      const values = Object.fromEntries(editor.fields.map((field) => [field.id, field.isMoney ? parseFloat(String(typedValues[field.id]).replace(/[$,]/g, "")) : typedValues[field.id]]));
      errorText = editor.save(values) || "";
      if (errorText) { draw(); return; }
      cover.remove();
      afterSave();
      return;
    }
    if (event.target.closest("[data-setup-sheet-cancel]") || event.target === cover) cover.remove();
  });
  document.body.appendChild(cover);
}
