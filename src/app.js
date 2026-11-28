const STORAGE_KEY = "finance_os_settings";
const MINIMUM_ADVICE_DAYS = 60;

function formatMoney(amount) {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(dateText) {
  return new Date(dateText + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function daysBetween(fromDateText, toDateText) {
  return Math.round((new Date(toDateText) - new Date(fromDateText)) / 86400000);
}

function todayText() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function loadSettings() {
  const savedText = localStorage.getItem(STORAGE_KEY);
  return savedText ? addMissingExtraSettings(JSON.parse(savedText)) : null;
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function showBalances(settings) {
  const { checking_balance, savings_balance } = settings.starting_balances;
  document.getElementById("balance-tiles").innerHTML = `<div class="horizon-grid">
    <div class="tile balance-tile balance-checking"><div class="small">Checking</div><div class="big-number">${formatMoney(checking_balance)}</div></div>
    <div class="tile balance-tile balance-savings"><div class="small">Savings</div><div class="big-number">${settings.account_masks && settings.account_masks.savings ? formatMoney(savings_balance) : editableNumber("starting_balances.savings_balance", "Savings balance", savings_balance, true)}</div></div>
    <div class="tile balance-tile balance-retirement"><div class="small">Retirement</div><div class="big-number">${settings.retirement.linked ? formatMoney(settings.retirement.balance) : editableNumber("retirement.balance", "Retirement balance", settings.retirement.balance, true)}</div></div>
    <div class="tile balance-tile balance-networth"><div class="small">Net worth</div><div class="big-number">${formatMoney(netWorth(settings))}</div></div></div>`;
}

function adviceDaysFor(settings, purchases) {
  let neededDays = MINIMUM_ADVICE_DAYS;
  for (const purchase of purchases) {
    const paymentDate = purchase.paid_with === "checking" ? purchase.date : dueDateForCharge(settings.credit_cards[purchase.paid_with], purchase.date);
    neededDays = Math.max(neededDays, daysBetween(settings.starting_balances.as_of_date, paymentDate) + 1);
  }
  return neededDays;
}

function transferSentence(settings, forecast) {
  const savingsBalance = settings.starting_balances.savings_balance;
  const sentence = `Move ${formatMoney(forecast.savings_transfer_needed)} from savings by ${formatDate(forecast.savings_transfer_by_date)}`;
  return forecast.savings_transfer_needed > savingsBalance
    ? `${sentence}. Savings only has ${formatMoney(savingsBalance)}, so you are ${formatMoney(forecast.savings_transfer_needed - savingsBalance)} short`
    : sentence;
}

function showTransferAdvice(settings, forecast) {
  const box = document.getElementById("transfer-advice");
  const floor = formatMoney(settings.minimum_checking_floor);
  if (forecast.savings_transfer_needed > 0) {
    box.innerHTML = `<div class="tile warning"><b>${transferSentence(settings, forecast)}</b>
      <div class="small">Checking drops to ${formatMoney(forecast.lowest_balance)} on ${formatDate(forecast.lowest_balance_date)}, under your ${floor} floor.</div></div>`;
  } else {
    box.innerHTML = `<div class="tile good"><b>No transfer needed</b><div class="small">Checking stays above ${floor} for the next ${forecast.days.length} days.</div></div>`;
  }
}

// Line chart of the predicted checking balance, one point per day: a single line with a soft fill, a dashed floor and the lowest day marked.
function showBalanceChart(settings, forecast) {
  // Day 1 is today, at the balance the bank shows now; the 39 days after it follow.
  const days = [forecast.today, ...forecast.days].slice(0, 40);
  const balances = days.map((day) => day.checking_balance);
  const floor = settings.minimum_checking_floor;
  const low = Math.min(...balances, floor);
  const high = Math.max(...balances, floor);
  const spread = high - low || 1;
  const left = 50, right = 346, top = 16, bottom = 168;
  const xFor = (dayNumber) => left + ((dayNumber - 1) / (days.length - 1)) * (right - left);
  const yFor = (balance) => bottom - ((balance - low) / spread) * (bottom - top);
  const linePoints = balances.map((balance, position) => `${xFor(position + 1).toFixed(1)},${yFor(balance).toFixed(1)}`).join(" ");
  const areaPoints = `${left},${bottom} ${linePoints} ${right},${bottom}`;
  const gridLines = [low, (low + high) / 2, high].map((balance) =>
    `<line x1="${left}" y1="${yFor(balance)}" x2="${right}" y2="${yFor(balance)}" stroke="var(--bar-track)" stroke-width="1" opacity="0.6"/>
     <text x="${left - 8}" y="${yFor(balance) + 4}" text-anchor="end" class="chart-label">$${Math.round(balance).toLocaleString("en-US")}</text>`).join("");
  const dateLabels = [1, 10, 20, 30, 40].map((dayNumber) =>
    `<text x="${xFor(dayNumber)}" y="${bottom + 18}" text-anchor="${dayNumber === 1 ? "start" : dayNumber === 40 ? "end" : "middle"}" class="chart-label">${dayNumber === 1 ? (days[0].date === todayText() ? "Today" : shortMonthDay(days[0].date)) : shortMonthDay(days[dayNumber - 1].date)}</text>`).join("");
  const lowestPosition = balances.indexOf(Math.min(...balances));
  const lowestX = xFor(lowestPosition + 1), lowestY = yFor(balances[lowestPosition]);
  const lowestIsSafe = balances[lowestPosition] >= floor;
  const lowestColor = lowestIsSafe ? "var(--good)" : "var(--bad)";
  const calloutAbove = lowestY > top + 26;
  document.getElementById("balance-chart").innerHTML = `<div class="chart-headline"><div class="small">Lowest point</div>
      <div class="chart-low ${lowestIsSafe ? "positive" : "negative"}">${formatMoney(balances[lowestPosition])}</div>
      <div class="small">${formatDate(days[lowestPosition].date)} \u00b7 ${lowestIsSafe ? "above" : "below"} your ${formatMoney(floor)} floor</div></div>
    <svg viewBox="0 0 360 196" width="100%">
    <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" style="stop-color:var(--accent);stop-opacity:0.35"/><stop offset="100%" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>
    ${gridLines}
    <polygon points="${areaPoints}" fill="url(#chart-fill)"/>
    <line x1="${left}" y1="${yFor(floor)}" x2="${right}" y2="${yFor(floor)}" stroke="var(--bad)" stroke-dasharray="5 4" stroke-width="1.5"/>
    <text x="${right}" y="${yFor(floor) - 5}" text-anchor="end" class="chart-label" style="fill:var(--bad)">floor</text>
    <polyline points="${linePoints}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${xFor(1)}" cy="${yFor(balances[0])}" r="4" fill="var(--accent)"/>
    <circle cx="${lowestX}" cy="${lowestY}" r="9" fill="${lowestColor}" opacity="0.25"/>
    <circle cx="${lowestX}" cy="${lowestY}" r="5" fill="${lowestColor}" stroke="var(--tile-background)" stroke-width="2"/>
    <text x="${Math.min(Math.max(lowestX, left + 22), right - 22)}" y="${calloutAbove ? lowestY - 14 : lowestY + 22}" text-anchor="middle" class="chart-label" style="fill:${lowestColor};font-weight:600">$${Math.round(balances[lowestPosition]).toLocaleString("en-US")}</text>
    ${dateLabels}</svg>`;
}

// One row like "Due   Dec 5 · 11d". Turns red or amber when the date is close.
function dateRow(label, dateText, today, redWithinDays, amberWithinDays) {
  const daysLeft = daysBetween(today, dateText);
  const colorClass = daysLeft <= redWithinDays ? "negative" : daysLeft <= amberWithinDays ? "amber" : "";
  return `<div class="date-row"><span>${label}</span><b class="${colorClass}">${shortMonthDay(dateText)}${daysLeft < 0 ? "" : " \u00b7 " + (daysLeft === 0 ? "today" : daysLeft + "d")}</b></div>`;
}

function showCards(settings) {
  const today = todayText();
  // Farthest statement close date first, closest last.
  // The statement stays open until its close day. Once the bank shows that statement as issued (even on the close day itself),
  // nothing more can be added to it, so the open cycle's close date moves to the following month.
  const closeDateOf = (card) => {
    const closeDate = nextStatementCloseDate(card, addDaysToDateText(today, -1));
    // Issued = the bank's closed statement closed on/after this date, or is due on the date that close date's statement is due.
    const bankAlreadyIssued = card.balances_by_statement.some((statement) => !statement.still_accumulating && (statement.statement_closed_on >= closeDate || statement.due_date === dueDateForCharge(card, closeDate)));
    return bankAlreadyIssued ? nextStatementCloseDate(card, addDaysToDateText(closeDate, 1)) : closeDate;
  };
  const cardsByCloseDate = Object.values(settings.credit_cards).sort((first, second) => closeDateOf(second).localeCompare(closeDateOf(first)));
  const html = cardsByCloseDate.map((card) => {
    const closeDate = closeDateOf(card);
    const closed = card.balances_by_statement.filter((statement) => !statement.still_accumulating);
    const open = card.balances_by_statement.filter((statement) => statement.still_accumulating);
    const closedTotal = closed.reduce((sum, statement) => sum + statement.amount, 0);
    const pendingAmount = pendingAmountOnCard(card);
    const openTotal = open.reduce((sum, statement) => sum + statement.amount, 0) - pendingAmount; // posted only; pending shows on its own line
    const pendingRow = pendingAmount > 0 ? `<div class="date-row"><span>Pending</span><b class="amber">+${formatMoney(pendingAmount)}</b></div>` : "";
    const closedDueRow = closed.length ? dateRow("Due", closed[0].due_date, today, 7, 14) : `<div class="date-row"><span>Nothing due</span></div>`;
    const openDueRow = open.length ? dateRow("Due", open[0].due_date, today, -1, -1) : "";
    return `<div class="tile card-tile"><div class="tile-row"><b>${card.display_name}</b><b class="big-number">${formatMoney(card.current_balance)}</b></div>
      <div class="statement-pair">
        <div class="statement-panel closed-panel"><div class="stat-label">CLOSED</div><div class="big-number">${formatMoney(closedTotal)}</div>${closedDueRow}</div>
        <div class="statement-panel open-panel"><div class="stat-label">OPEN</div><div class="big-number">${formatMoney(openTotal)}</div>
          ${pendingRow}${dateRow("Closes", closeDate, today, -1, 7)}${openDueRow}</div></div></div>`;
  });
  document.getElementById("card-list").innerHTML = html.join("");
}

// One line of the timeline: an icon, the label (with a card's open or closed tag) and the amount.
function timelineEventHtml(event) {
  const isIncome = event.amount >= 0;
  const estimateTag = event.is_estimate ? " (est.)" : "";
  return `<div class="timeline-event"><span class="timeline-icon ${isIncome ? "timeline-in" : "timeline-out"}">${isIncome ? "&#8593;" : "&#8595;"}</span>
    <span class="timeline-label">${event.label}${estimateTag}${event.card_state ? `<span class="pay-chip">${event.card_state}${event.days_until_close !== undefined ? ` \u00b7 ${event.days_until_close}d` : ""}</span>` : ""}</span><b class="${isIncome ? "positive" : "negative"}">${formatMoney(event.amount)}</b></div>`;
}

// A timeline: one row per day that has something happening, with the date on a rail, the events as lines and the day's ending balance.
function showCalendar(forecast, settings) {
  const dayBlocks = forecast.days.slice(0, 40).filter((day) => day.events.length > 0).map((day) => {
    const dateParts = new Date(day.date + "T00:00:00Z");
    const weekday = dateParts.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    const month = dateParts.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const eventLines = day.events.map(timelineEventHtml).join("");
    const belowFloor = day.checking_balance < settings.minimum_checking_floor;
    return `<div class="timeline-day"><div class="timeline-date"><span class="small">${weekday}</span><b>${dateParts.getUTCDate()}</b><span class="small">${month}</span></div>
      <div class="timeline-dot"></div>
      <div class="tile timeline-card">${eventLines}<div class="timeline-balance small">balance <b class="${belowFloor ? "negative" : ""}">${formatMoney(day.checking_balance)}</b></div></div></div>`;
  });
  // First row is today: the balance the bank shows now, plus any typed-in paycheck the balance already holds.
  const todayParts = new Date(settings.starting_balances.as_of_date + "T00:00:00Z");
  const depositsToday = payDeposits(loadTransactionStore(), settings, (transaction) => transaction.date === todayText())
    .map((deposit) => `<div class="timeline-event"><span class="timeline-icon timeline-in">&#8593;</span><span class="timeline-label">Paycheck${deposit.pending ? " (pending)" : ""} \u00b7 already in your balance</span><b class="positive">${formatMoney(-deposit.amount)}</b></div>`).join("");
  const alreadyInBalance = depositsToday + expectedPaychecks(loadTransactionStore(), settings, todayText()).list.filter((entry) => entry.in_balance)
    .map((entry) => `<div class="timeline-event"><span class="timeline-icon timeline-in">&#8593;</span><span class="timeline-label">Paycheck (already in your balance)</span><b class="positive">${formatMoney(entry.amount)}</b></div>`).join("");
  const todayIsQuiet = !alreadyInBalance && forecast.today.events.length === 0;
  dayBlocks.unshift(`<div class="timeline-day"><div class="timeline-date"><span class="small">${todayParts.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span><b>${todayParts.getUTCDate()}</b><span class="small">${todayParts.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span></div>
      <div class="timeline-dot"></div>
      ${todayIsQuiet ? `<div class="tile today-hero"><div class="today-eyebrow">Today \u00b7 Checking</div><div class="today-number">${formatMoney(forecast.today.checking_balance)}</div><div class="small">Nothing scheduled today</div></div>`
        : `<div class="tile timeline-card"><div class="timeline-event"><span class="timeline-label">Today</span></div>${alreadyInBalance}${forecast.today.events.map(timelineEventHtml).join("")}<div class="timeline-balance small">balance <b>${formatMoney(forecast.today.checking_balance)}</b></div></div>`}</div>`);
  document.getElementById("calendar-list").innerHTML = `<div class="timeline">${dayBlocks.join("")}</div>`;
}

let whatIfPurchases = [];

function showWhatIf(settings) {
  const resultBox = document.getElementById("what-if-result");
  if (whatIfPurchases.length === 0) { resultBox.innerHTML = ""; return; }
  const lookAheadDays = adviceDaysFor(settings, whatIfPurchases);
  const whatIfForecast = buildForecast(settings, lookAheadDays, whatIfPurchases);
  const realForecast = buildForecast(settings, lookAheadDays);
  const purchaseRows = whatIfPurchases.map((purchase, position) => {
    const payerName = purchase.paid_with === "checking" ? "checking" : settings.credit_cards[purchase.paid_with].display_name;
    return `<div class="tile entry-tile entry-out"><span class="timeline-icon timeline-out">&#8595;</span>
      <div class="entry-body"><b>${purchase.label}</b><div class="small">${formatDate(purchase.date)} &middot; ${payerName}</div></div>
      <b class="negative">-${formatMoney(purchase.amount)}</b>
      <button class="remove-link" data-whatif-remove data-position="${position}">remove</button></div>`;
  }).join("");
  const lowestChange = whatIfForecast.lowest_balance - realForecast.lowest_balance;
  const dipsUnderFloor = whatIfForecast.lowest_balance < settings.minimum_checking_floor;
  const verdict = whatIfForecast.savings_transfer_needed > 0 ? transferSentence(settings, whatIfForecast) : "No transfer needed";
  resultBox.innerHTML = `<div class="tile result-hero ${dipsUnderFloor ? "result-warn" : ""}"><div class="verdict">${dipsUnderFloor ? "&#9888;&#65039;" : "&#9989;"} ${verdict}</div>
    <div class="result-pairs"><div><span class="small">Lowest checking</span><b>${formatMoney(whatIfForecast.lowest_balance)}</b></div>
      <div><span class="small">${formatDate(whatIfForecast.lowest_balance_date)}</span><b class="${lowestChange < 0 ? "negative" : ""}">${lowestChange < 0 ? "-" : "+"}${formatMoney(Math.abs(lowestChange))} vs now</b></div></div></div>${purchaseRows}`;
}

function fillWhatIfChoices(settings) {
  const choices = [`<option value="checking">Checking</option>`].concat(
    Object.entries(settings.credit_cards).map(([cardKey, card]) => `<option value="${cardKey}">${card.display_name}</option>`));
  const paidWithMenu = document.getElementById("what-if-paid-with");
  if (paidWithMenu.options.length === 0) paidWithMenu.innerHTML = choices.join("");
  document.getElementById("what-if-date").value ||= todayText();
}

// "Updated 5 min ago" under the Home title, or the balance date if nothing has refreshed yet.
function minutesAgoText(minutes) {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} d ago`;
}

function showStatusLine(settings = loadSettings()) {
  if (!settings) return;
  const lastRefresh = Number(localStorage.getItem("finance_last_refresh_ms") || 0);
  document.getElementById("data-status").textContent = lastRefresh
    ? `Updated ${minutesAgoText((Date.now() - lastRefresh) / 60000)}`
    : `Bank balances as of ${formatDate(settings.starting_balances.as_of_date)}`;
}
setInterval(() => { if (!document.hidden && document.getElementById("data-status").textContent !== "Refreshing...") showStatusLine(); }, 30000);

// Pull down on Home to refresh.
const PULL_DISTANCE_TO_REFRESH = 80;
let pullStart = null;
let pullDistance = 0;
document.addEventListener("touchstart", (event) => {
  const onHome = !document.getElementById("page-home").hidden && !document.getElementById("side-menu").classList.contains("open");
  pullStart = onHome && window.scrollY <= 0 && event.touches[0].clientX > 30 ? event.touches[0].clientY : null;
  pullDistance = 0;
}, { passive: true });
document.addEventListener("touchmove", (event) => {
  if (pullStart === null) return;
  pullDistance = Math.max(0, event.touches[0].clientY - pullStart);
  const indicator = document.getElementById("pull-indicator");
  indicator.hidden = pullDistance < 12;
  indicator.textContent = pullDistance >= PULL_DISTANCE_TO_REFRESH ? "Release to refresh" : "Pull to refresh";
  indicator.style.opacity = String(Math.min(1, pullDistance / PULL_DISTANCE_TO_REFRESH));
}, { passive: true });
document.addEventListener("touchend", () => {
  document.getElementById("pull-indicator").hidden = true;
  if (pullStart !== null && pullDistance >= PULL_DISTANCE_TO_REFRESH) refreshFromBank();
  pullStart = null;
  pullDistance = 0;
}, { passive: true });

const HIDE_START_HERE_KEY = "finance_os_hide_start_here";

// Enough to draw a forecast: a paycheck or a checking balance.
function basicsAreSet(settings) {
  return settings.paycheck.usual_take_home_amount > 0 || settings.starting_balances.checking_balance > 0;
}

// A short checklist on Home until pay, a card and a bill or subscription are in.
function showStartHere(settings) {
  const steps = [
    ["Add your pay and checking balance", basicsAreSet(settings)],
    ["Add a credit card", Object.keys(settings.credit_cards).length > 0],
    ["Add a bill or subscription", settings.monthly_bills_paid_from_checking.length + settings.subscriptions_charged_to_cards.length > 0],
  ];
  const box = document.getElementById("start-here");
  box.hidden = steps.every(([label, done]) => done) || localStorage.getItem(HIDE_START_HERE_KEY) === "yes";
  box.innerHTML = `<b>Start here</b>${steps.map(([label, done]) => `<div class="tile-row small"><span>${done ? "&#9989;" : "&#11036;"} ${label}</span></div>`).join("")}
    <div class="small">Bank linking is optional. You can do it later.</div>
    <button id="start-here-setup-button">Open Set up</button><button id="hide-start-here-button" class="small-button">Hide this</button>`;
}

document.addEventListener("click", (event) => {
  if (event.target.id === "hide-start-here-button") {
    localStorage.setItem(HIDE_START_HERE_KEY, "yes");
    document.getElementById("start-here").hidden = true;
  }
  if (event.target.id === "load-file-button") document.getElementById("settings-file-input").click();
});

function showEverything() {
  const settings = loadSettings();
  setMerchantRules(settings && settings.merchant_rules);
  setTransactionCategories(settings && settings.transaction_categories);
  document.getElementById("setup").hidden = Boolean(settings);
  document.getElementById("home-content").hidden = !settings || !basicsAreSet(settings);
  if (!settings) { document.getElementById("start-here").hidden = true; return; }
  showStartHere(settings);
  const typedPay = expectedPaychecks(loadTransactionStore(), settings, todayText());
  setPaidEarlyDates([...paidEarlyPaydays(loadTransactionStore(), settings, todayText()), ...typedPay.replacedPaydays]);
  const billsUnseenThisMonth = (matchBills(settings, loadTransactionStore(), loadBillMarks(), todayText()).byMonth[todayText().slice(0, 7)] || { unseen: [] }).unseen;
  setUnpaidBillsDueToday(billsUnseenThisMonth.filter((bill) => bill.kind === "bill" && bill.expected === todayText()));
  setTypedPaychecks(typedPay.list.filter((entry) => !entry.in_balance)); // one the bank balance already holds must not be added again
  const forecast = buildForecast(settings, MINIMUM_ADVICE_DAYS);
  showStatusLine(settings);
  showBalances(settings);
  try { showMonthOutlook(settings); } catch (error) { document.getElementById("month-outlook").innerHTML = ""; }
  showTransferAdvice(settings, forecast);
  showBalanceChart(settings, forecast);
  showCards(settings);
  showCalendar(forecast, settings);
  fillWhatIfChoices(settings);
  showWhatIf(settings);
  showExtraPages(settings);
}

document.getElementById("settings-file-input").addEventListener("change", async (event) => {
  const chosenFile = event.target.files[0];
  if (!chosenFile) return;
  const incomingSettings = JSON.parse(await chosenFile.text());
  // Keep what you typed into the Rewards and HSA pages if the file doesn't have it.
  const previousSettings = loadSettings();
  for (const sectionName of ["rewards", "card_benefits", "hsa", "retirement", "credit_utilization", "overtime", "pto", "car_loan", "todo_items", "savings_goals", "net_worth_history", "credit_scores", "annual_card_fees", "card_expirations", "other_cards", "account_masks", "card_masks", "hidden_tabs", "expected_money", "transfers_ignore_text", "merchant_rules", "transaction_categories", "category_budgets", "optional_monthly_variable_spending_allowance"]) {
    if (!incomingSettings[sectionName] && previousSettings) incomingSettings[sectionName] = previousSettings[sectionName];
  }
  keepBankAndTypedData(incomingSettings, previousSettings);
  saveSettings(incomingSettings);
  localStorage.setItem(STORAGE_KEY + "_file_name", chosenFile.name);
  event.target.value = "";
  showEverything();
  showDataNote(`Settings file "${chosenFile.name}" loaded at ${timeNowText()}.`);
});

// The settings file holds set-up values only. Balances and statements (from the bank refresh) and savings (typed in the app) stay as they are on the phone.
function keepBankAndTypedData(incomingSettings, previousSettings) {
  const previous = previousSettings || {};
  const previousBalances = previous.starting_balances || {};
  incomingSettings.starting_balances = {
    as_of_date: previousBalances.as_of_date || todayText(),
    checking_balance: previousBalances.checking_balance ?? 0,
    savings_balance: previousBalances.savings_balance ?? 0,
    ...incomingSettings.starting_balances,
  };
  for (const [cardKey, card] of Object.entries(incomingSettings.credit_cards || {})) {
    const previousCard = (previous.credit_cards || {})[cardKey] || {};
    card.current_balance = card.current_balance ?? previousCard.current_balance ?? 0;
    card.balances_by_statement = card.balances_by_statement || previousCard.balances_by_statement || [];
  }
}

function timeNowText() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Message under the Data section of Settings.
// A small message that slides up from the bottom for a moment, so a tap on a button always gets an answer.
let toastTimer = null;
function showToast(text) {
  if (!text) return;
  let toast = document.getElementById("toast");
  if (!toast) { toast = document.createElement("div"); toast.id = "toast"; document.body.appendChild(toast); }
  toast.textContent = text;
  toast.classList.add("toast-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("toast-show"), 3500);
}
for (const noteId of ["data-note", "refresh-note"]) {
  new MutationObserver(() => showToast(document.getElementById(noteId).textContent)).observe(document.getElementById(noteId), { childList: true, characterData: true, subtree: true });
}

function showDataNote(text) {
  document.getElementById("data-note").textContent = text;
}

// "Update app" reloads with ?fresh=...; say so once the new files are in, then tidy the address.
if (location.search.includes("fresh=")) {
  showDataNote(`App updated at ${timeNowText()}.`);
  history.replaceState(null, "", location.pathname);
}

// A new web address makes iOS fetch the latest files. Your saved data is not touched.
document.getElementById("update-app-button").addEventListener("click", () => {
  location.href = location.pathname + "?fresh=" + Date.now();
});

document.getElementById("export-backup-button").addEventListener("click", () => {
  const savedText = localStorage.getItem(STORAGE_KEY);
  if (!savedText) { showDataNote("Nothing to back up yet."); return; }
  const downloadLink = document.createElement("a");
  downloadLink.href = URL.createObjectURL(new Blob([savedText], { type: "application/json" }));
  downloadLink.download = `finance_backup_${todayText()}.json`;
  downloadLink.click();
  showDataNote("Backup saved to a file.");
});

// Spending history (every saved charge, plus the bills you marked by hand) in one file you can keep. Settings have their own backup above.
document.getElementById("export-history-button").addEventListener("click", () => {
  const history = { finance_os_backup: "spending_history", saved_on: todayText(), transactions: loadTransactionStore(), bill_marks: loadBillMarks() };
  const downloadLink = document.createElement("a");
  downloadLink.href = URL.createObjectURL(new Blob([JSON.stringify(history)], { type: "application/json" }));
  downloadLink.download = `finance_spending_history_${todayText()}.json`;
  downloadLink.click();
  showDataNote(`Saved ${Object.keys(history.transactions.transactions).length} charges to a file.`);
});

document.getElementById("history-file-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  let merged = null;
  try { merged = mergeHistoryBackup(loadTransactionStore(), JSON.parse(await file.text())); } catch (error) { merged = null; }
  if (!merged) { showDataNote("That is not a spending history backup."); return; }
  saveTransactionStore(merged.store);
  saveBillMarks([...new Set([...loadBillMarks(), ...merged.billMarks])]);
  showDataNote(`Restored. ${merged.addedCount} charges added back.`);
  showEverything();
});

document.getElementById("what-if-add-button").addEventListener("click", () => {
  const amount = parseFloat(document.getElementById("what-if-amount").value);
  const date = document.getElementById("what-if-date").value;
  if (!amount || !date) return;
  whatIfPurchases.push({
    label: document.getElementById("what-if-label").value || "Purchase",
    amount,
    date,
    paid_with: document.getElementById("what-if-paid-with").value,
  });
  document.getElementById("what-if-label").value = "";
  document.getElementById("what-if-amount").value = "";
  showEverything();
});

document.getElementById("what-if-result").addEventListener("click", (event) => {
  const position = event.target.dataset.position;
  if (position === undefined) return;
  whatIfPurchases.splice(Number(position), 1);
  showEverything();
});

showEverything();

// ---- Refresh from the bank (through the relay) ----

const RELAY_ADDRESS_KEY = "finance_relay_address";
const RELAY_APP_KEY_KEY = "finance_relay_key";
const BEFORE_REFRESH_KEY = "finance_os_before_refresh";
const LAST_REFRESH_KEY = "finance_last_refresh_ms";
const AUTO_REFRESH_AFTER_MINUTES = 30;

// Makes a long random app key for people setting up their own relay.
function makeAppKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function connectToRelay() {
  const note = document.getElementById("refresh-note");
  const address = prompt("Relay address (the https://...workers.dev link from Cloudflare)", localStorage.getItem(RELAY_ADDRESS_KEY) || "https://");
  if (!address) return;
  const typedKey = prompt("App key. Leave it empty to make a new one (then paste it into Cloudflare as the APP_KEY secret).");
  if (typedKey === null) return;
  const appKey = typedKey.trim() || makeAppKey();
  if (!typedKey.trim()) prompt("Your new app key. Copy it now and paste it into Cloudflare as the secret named APP_KEY.", appKey);
  const cleanAddress = address.trim().replace(/\/+$/, "");
  localStorage.setItem(RELAY_ADDRESS_KEY, cleanAddress);
  localStorage.setItem(RELAY_APP_KEY_KEY, appKey);
  note.textContent = "Testing the connection...";
  try {
    const response = await fetch(cleanAddress + "/diag", { headers: { "x-finance-key": appKey } });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) note.textContent = "The relay is there, but the app key does not match the APP_KEY secret in Cloudflare.";
    else if (!response.ok) note.textContent = "The relay answered with a problem: " + (result.error || response.status) + ".";
    else if (result.client_id_length !== 24 || result.secret_length < 20) note.textContent = "Connected, but the Plaid keys in Cloudflare look wrong or missing. Re-paste PLAID_CLIENT_ID and PLAID_SECRET.";
    else note.textContent = "Connected and working (" + result.plaid_env + "). Open your relay address plus /link in Safari to link a bank.";
  } catch (error) {
    note.textContent = "Could not reach that address. Check the link, and that ALLOWED_ORIGIN in Cloudflare is this site's address.";
  }
}

async function refreshFromBank(quiet = false) {
  const say = (text) => { document.getElementById("refresh-note").textContent = text; document.getElementById("data-status").textContent = text; };
  const relayAddress = localStorage.getItem(RELAY_ADDRESS_KEY);
  const relayAppKey = localStorage.getItem(RELAY_APP_KEY_KEY);
  if (!relayAddress || !relayAppKey) { if (!quiet) say("Bank linking is optional. To turn it on, connect to the relay in Settings (the README has the steps)."); return; }
  if (!quiet) say("Refreshing...");
  let refresh;
  try {
    const response = await fetch(relayAddress.replace(/\/$/, "") + "/refresh", { headers: { "x-finance-key": relayAppKey } });
    refresh = await response.json();
    if (!response.ok) throw new Error(refresh.error);
  } catch (error) { if (!quiet) say("Refresh failed: " + error.message); return; }

  // Transactions come in a second call. If it fails, balances still refresh and pending falls back to the bank's available credit.
  let transactionStore = loadTransactionStore();
  let transactionProblems = [];
  try {
    const transactionResponse = await fetch(relayAddress.replace(/\/$/, "") + "/transactions", {
      method: "POST", headers: { "x-finance-key": relayAppKey, "Content-Type": "application/json" }, body: JSON.stringify({ cursors: transactionStore.cursors }),
    });
    const transactionReply = await transactionResponse.json();
    if (transactionResponse.ok) {
      transactionStore = applyTransactionChanges(transactionStore, transactionReply, todayText());
      saveTransactionStore(transactionStore);
      transactionProblems = transactionReply.problems || [];
    }
  } catch (error) {
    // Keep going without transactions.
  }
  const pendingTotals = pendingTotalsByAccount(transactionStore);

  const settings = loadSettings();
  if (!settings) { if (!quiet) say("Bank data came through, but this phone has no set-up yet. Load a settings file or backup (Settings), or finish Set up, then refresh again."); return; }
  localStorage.setItem(BEFORE_REFRESH_KEY, JSON.stringify(settings));
  let result = applyRefresh(settings, refresh, todayText(), pendingTotals);
  if (result.needChoice.length > 0 && !quiet) {
    // Ask once which account is which. The answer is remembered by last four digits.
    const withAnswers = structuredClone(settings);
    for (const question of result.needChoice) {
      const list = question.candidates.map((account, position) => `${position + 1}. ${account.name} (${account.mask})`).join("\n");
      const chosen = question.candidates[Number(prompt(`Which one is ${question.label}? Enter its number, or cancel to skip.\n${list}`)) - 1];
      if (chosen) withAnswers[question.maskGroup] = { ...withAnswers[question.maskGroup], [question.slot]: chosen.mask };
    }
    result = applyRefresh(withAnswers, refresh, todayText(), pendingTotals);
  }
  // Each refresh also records today's net worth, so the Track history builds itself.
  if (result.changed.length > 0) result.settings.net_worth_history = addEntryForDate(result.settings.net_worth_history, { date: todayText(), net_worth: netWorth(result.settings) });
  saveSettings(result.settings);
  localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
  const problems = [...(refresh.problems || []), ...transactionProblems].map((problem) => `${problem.login}: ${problem.error}`);
  say(`Updated ${result.changed.length} items at ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`
    + (result.skipped.length ? " Skipped: " + result.skipped.join(", ") + "." : "")
    + (problems.length ? " Problems: " + problems.join(", ") + "." : ""));
  showEverything();
}

document.getElementById("connect-relay-button").addEventListener("click", connectToRelay);
// Shows what the bank link sent (names, kinds, last 4 digits, no balances) so a missing account can be traced.
document.getElementById("show-accounts-button").addEventListener("click", async () => {
  const note = document.getElementById("refresh-note");
  const address = localStorage.getItem(RELAY_ADDRESS_KEY), appKey = localStorage.getItem(RELAY_APP_KEY_KEY);
  if (!address || !appKey) { note.textContent = "Connect to the relay first."; return; }
  note.textContent = "Asking the relay...";
  try {
    const response = await fetch(address + "/refresh", { headers: { "x-finance-key": appKey } });
    const data = await response.json();
    if (!response.ok) { note.textContent = "Relay said: " + (data.error || response.status); return; }
    const lines = data.accounts.map((account) => account.login + ": " + account.name + " | " + account.type + " | " + account.subtype + " | ..." + account.mask);
    (data.problems || []).forEach((problem) => lines.push(problem.login + ": PROBLEM " + problem.error));
    note.textContent = lines.length ? lines.join("\n") : "No accounts are linked yet.";
    note.style.whiteSpace = "pre-wrap";
  } catch (error) { note.textContent = "Could not reach the relay."; }
});
document.getElementById("refresh-button").addEventListener("click", () => refreshFromBank());
document.getElementById("refresh-top-button").addEventListener("click", () => refreshFromBank());
document.getElementById("undo-refresh-button").addEventListener("click", () => {
  const before = localStorage.getItem(BEFORE_REFRESH_KEY);
  if (!before) { document.getElementById("refresh-note").textContent = "Nothing to undo."; return; }
  saveSettings(JSON.parse(before));
  document.getElementById("refresh-note").textContent = "Put back what you had before the last refresh.";
  showEverything();
});

// Refresh by itself when the app opens or comes back to the front, at most every 30 minutes. Never asks questions.
function refreshIfStale() {
  const minutesSince = (Date.now() - Number(localStorage.getItem(LAST_REFRESH_KEY) || 0)) / 60000;
  if (document.visibilityState === "visible" && minutesSince >= AUTO_REFRESH_AFTER_MINUTES) refreshFromBank(true);
}
document.addEventListener("visibilitychange", refreshIfStale);
refreshIfStale();
