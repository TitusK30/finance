const STORAGE_KEY = "finance_os_settings";
const HORIZON_DAYS = [10, 20, 30, 40];
const MINIMUM_ADVICE_DAYS = 60;
const SPEND_LOOK_AHEAD_DAYS = 30;

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
    <div class="tile"><div class="small">Checking now</div><div class="big-number">${formatMoney(checking_balance)}</div></div>
    <div class="tile"><div class="small">Savings</div><div class="big-number">${editableNumber("starting_balances.savings_balance", "Savings balance", savings_balance, true)}</div></div>
    <div class="tile"><div class="small">Retirement</div><div class="big-number">${formatMoney(settings.retirement.balance || 0)}</div></div>
    <div class="tile"><div class="small">Net worth</div><div class="big-number">${formatMoney(netWorth(settings))}</div><div class="small">counts only what is filled in</div></div></div>`;
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

// "Safe to spend until payday": what checking can spare, after bills and card payments, keeping your floor.
// Home and Goals: how much is left to spend today and this week, keeping the checking floor and the weekly savings plan.
function showSpendingPlan(settings, forecast) {
  const weeklySavings = (settings.savings_plan && settings.savings_plan.weekly_amount) || 0;
  const allowance = dailyAllowance(forecast, settings.minimum_checking_floor, weeklySavings, SPEND_LOOK_AHEAD_DAYS);
  const today = todayText();
  const weekStart = new Date(new Date(today + "T12:00:00Z").getTime() - new Date(today + "T12:00:00Z").getUTCDay() * 86400000).toISOString().slice(0, 10);
  const spentToday = spentSince(settings, today);
  const spentThisWeek = spentSince(settings, weekStart);
  const leftToday = Math.max(0, roundMoney(allowance.perDay - spentToday));
  const leftThisWeek = Math.max(0, roundMoney(allowance.perDay * 7 - spentThisWeek));
  const floor = formatMoney(settings.minimum_checking_floor);
  const savingsText = weeklySavings > 0 ? ` and moves ${formatMoney(weeklySavings)} a week to savings` : "";
  const tile = allowance.fits
    ? `<div class="tile ${leftToday > 0 ? "good" : "warning"}"><div class="small">Left to spend today</div><div class="big-number">${formatMoney(leftToday)}</div>
        <div class="tile-row small"><span>Spent so far today</span><span>${formatMoney(spentToday)}</span></div>
        <div class="tile-row small"><span>Daily budget</span><span>${formatMoney(allowance.perDay)}</span></div>
        <div class="tile-row small"><span>Left this week</span><span>${formatMoney(leftThisWeek)}</span></div>
        <div class="small">Keeps checking at or above your ${floor} floor${savingsText}, over the next ${allowance.lookAheadDays} days, after bills, subs, card payments (open statements too) and the expenses you listed. The tightest day is ${formatDate(allowance.tightestDate)}. Bills and subs are not counted as spending.</div></div>`
    : `<div class="tile warning"><div class="small">Left to spend today</div><div class="big-number">${formatMoney(0)}</div>
        <div class="small">Saving ${formatMoney(weeklySavings)} a week does not leave room to spend while keeping your ${floor} floor over the next ${allowance.lookAheadDays} days (tightest day ${formatDate(allowance.tightestDate)}).</div>
        <div class="tile-row small"><span>Most you could save a week (spending nothing)</span><span>${formatMoney(allowance.mostPerWeek)}</span></div>
        <div class="tile-row small"><span>Daily budget if you saved nothing extra</span><span>${formatMoney(allowance.perDayWithoutSavings)}</span></div></div>`;
  const room = cardRoom(forecast, settings.minimum_checking_floor, weeklySavings);
  const roomTile = `<div class="tile ${room.amount > 0 ? "good" : "warning"}"><div class="small">Room to put on your cards, next ${room.days} days, all cards together</div>
      <div class="big-number">${formatMoney(room.amount)}</div>
      ${weeklySavings > 0 ? `<div class="tile-row small"><span>...and still saving ${formatMoney(weeklySavings)} a week</span><span>${formatMoney(room.amountWithSavings)}</span></div>` : ""}
      <div class="small">Keeps checking at or above your ${floor} floor, counting your closed and open statements, pending charges, bills, subs, fees and listed expenses. Cautious: it treats the spending as coming out on the tightest day, ${formatDate(room.tightestDate)}.</div></div>`;
  document.getElementById("spending-plan").innerHTML = tile + roomTile;
  document.getElementById("goal-spending-room").innerHTML = tile + roomTile
    + (weeklySavings > 0 ? `<div class="small">The most that fits is ${formatMoney(allowance.mostPerWeek)} a week, with nothing left to spend. With no savings plan your daily budget would be ${formatMoney(allowance.perDayWithoutSavings)}.</div>`
      : `<div class="tile small">Type a weekly amount above to see the budget with your savings plan.</div>`);
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

function showHorizonCards(settings, forecast) {
  const startDate = settings.starting_balances.as_of_date;
  const cards = HORIZON_DAYS.map((numberOfDays) => {
    const daysInWindow = forecast.days.slice(0, numberOfDays);
    const endBalance = daysInWindow[daysInWindow.length - 1].checking_balance;
    const lowestInWindow = Math.min(...daysInWindow.map((day) => day.checking_balance));
    const lowClass = lowestInWindow < settings.minimum_checking_floor ? "negative" : "positive";
    return `<div class="tile"><div class="small">${numberOfDays} days out</div>
      <div class="big-number">${formatMoney(endBalance)}</div>
      <div class="small ${lowClass}">low ${formatMoney(lowestInWindow)}</div></div>`;
  });
  document.getElementById("horizon-cards").innerHTML = `<div class="horizon-grid">${cards.join("")}</div>`;
}

// Line chart of the predicted checking balance, one point per day. Dashed line is the minimum floor.
function showBalanceChart(settings, forecast) {
  const days = forecast.days.slice(0, 40);
  const balances = days.map((day) => day.checking_balance);
  const floor = settings.minimum_checking_floor;
  const low = Math.min(...balances, floor);
  const high = Math.max(...balances, floor);
  const spread = high - low || 1;
  const left = 52, right = 350, top = 10, bottom = 170;
  const xFor = (dayNumber) => left + ((dayNumber - 1) / (days.length - 1)) * (right - left);
  const yFor = (balance) => bottom - ((balance - low) / spread) * (bottom - top);
  const linePoints = balances.map((balance, position) => `${xFor(position + 1).toFixed(1)},${yFor(balance).toFixed(1)}`).join(" ");
  const sideLabels = [low, (low + high) / 2, high].map((balance) =>
    `<text x="${left - 6}" y="${yFor(balance) + 4}" text-anchor="end" class="chart-label">$${Math.round(balance).toLocaleString("en-US")}</text>`).join("");
  const bottomLabels = [1, 10, 20, 30, 40].map((dayNumber) =>
    `<text x="${xFor(dayNumber)}" y="${bottom + 16}" text-anchor="middle" class="chart-label">${dayNumber}</text>`).join("");
  const lowestPosition = balances.indexOf(Math.min(...balances));
  document.getElementById("balance-chart").innerHTML = `<svg viewBox="0 0 360 205" width="100%">
    <line x1="${left}" y1="${yFor(floor)}" x2="${right}" y2="${yFor(floor)}" stroke="var(--bad)" stroke-dasharray="4 3" stroke-width="1"/>
    <line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="var(--bar-track)"/>
    <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="var(--bar-track)"/>
    <polyline points="${linePoints}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <circle cx="${xFor(lowestPosition + 1)}" cy="${yFor(balances[lowestPosition])}" r="4" fill="var(--accent)"/>
    ${sideLabels}${bottomLabels}
    <text x="${(left + right) / 2}" y="203" text-anchor="middle" class="chart-label">Days from now</text></svg>
    <div class="small">Lowest: ${formatMoney(balances[lowestPosition])} on ${formatDate(days[lowestPosition].date)}. Red dashes are your ${formatMoney(floor)} floor.</div>`;
}

// One row like "Due   Dec 5 · 11d". Turns red or amber when the date is close.
function dateRow(label, dateText, today, redWithinDays, amberWithinDays) {
  const daysLeft = daysBetween(today, dateText);
  const colorClass = daysLeft <= redWithinDays ? "negative" : daysLeft <= amberWithinDays ? "amber" : "";
  return `<div class="date-row"><span>${label}</span><b class="${colorClass}">${shortMonthDay(dateText)} \u00b7 ${daysLeft <= 0 ? "today" : daysLeft + "d"}</b></div>`;
}

function showCards(settings) {
  const today = todayText();
  const html = Object.values(settings.credit_cards).map((card) => {
    // The statement stays open until its close day. Starting from yesterday lets "closes today" count as 0 days.
    const closeDate = nextStatementCloseDate(card, addDaysToDateText(today, -1));
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

function showCalendar(forecast) {
  const rows = [];
  for (const day of forecast.days.slice(0, 40)) {
    for (const event of day.events) {
      const amountClass = event.amount < 0 ? "negative" : "positive";
      const estimateTag = event.is_estimate ? " (est.)" : "";
      rows.push(`<div class="tile"><div class="tile-row"><span>${formatDate(day.date)}</span><b class="${amountClass}">${formatMoney(event.amount)}</b></div>
        <div class="tile-row small"><span>${event.label}${estimateTag}</span><span>balance ${formatMoney(day.checking_balance)}</span></div></div>`);
    }
  }
  document.getElementById("calendar-list").innerHTML = rows.join("");
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
    return `<div class="tile-row small"><span>${purchase.label}: ${formatMoney(purchase.amount)} on ${formatDate(purchase.date)} (${payerName})</span>
      <button class="remove-link" data-position="${position}">remove</button></div>`;
  }).join("");
  const lowestChange = whatIfForecast.lowest_balance - realForecast.lowest_balance;
  const dipsUnderFloor = whatIfForecast.lowest_balance < settings.minimum_checking_floor;
  const verdict = whatIfForecast.savings_transfer_needed > 0 ? transferSentence(settings, whatIfForecast) : "No transfer needed";
  resultBox.innerHTML = `<div class="tile ${dipsUnderFloor ? "warning" : "good"}"><b>${verdict}</b>
    <div class="small">Lowest checking: ${formatMoney(whatIfForecast.lowest_balance)} on ${formatDate(whatIfForecast.lowest_balance_date)} (${formatMoney(lowestChange)} vs. now)</div>
    ${purchaseRows}</div>`;
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
  document.getElementById("setup").hidden = Boolean(settings);
  document.getElementById("home-content").hidden = !settings || !basicsAreSet(settings);
  if (!settings) { document.getElementById("start-here").hidden = true; return; }
  showStartHere(settings);
  const forecast = withExpectedExpenses(buildForecast(settings, MINIMUM_ADVICE_DAYS), settings.expected_money, settings.minimum_checking_floor);
  showStatusLine(settings);
  showBalances(settings);
  showSpendingPlan(settings, forecast);
  showTransferAdvice(settings, forecast);
  showHorizonCards(settings, forecast);
  showBalanceChart(settings, forecast);
  showCards(settings);
  showCalendar(forecast);
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
  for (const sectionName of ["rewards", "card_benefits", "hsa", "retirement", "credit_utilization", "overtime", "pto", "car_loan", "todo_items", "savings_goals", "net_worth_history", "credit_scores", "annual_card_fees", "card_expirations", "other_cards", "account_masks", "card_masks", "hidden_tabs", "savings_plan", "expected_money"]) {
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
  if (!savedText) return;
  const downloadLink = document.createElement("a");
  downloadLink.href = URL.createObjectURL(new Blob([savedText], { type: "application/json" }));
  downloadLink.download = `finance_backup_${todayText()}.json`;
  downloadLink.click();
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

function connectToRelay() {
  const address = prompt("Relay address", localStorage.getItem(RELAY_ADDRESS_KEY) || "https://");
  if (!address) return;
  const appKey = prompt("App key");
  if (!appKey) return;
  localStorage.setItem(RELAY_ADDRESS_KEY, address.trim());
  localStorage.setItem(RELAY_APP_KEY_KEY, appKey.trim());
  document.getElementById("refresh-note").textContent = "Connected. Tap Refresh balances.";
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
