// Extras on the Spending page: search and filter, this month vs last month, daily pace, budgets,
// the recurring-charge detector and merchant rules. The math lives in spending-tools.js.

let spendingFilter = emptySpendingFilter(); // kept in memory only, so the page opens normally next time
let spendingSearchTimer = null;
const RECURRING_DISMISSED_KEY = "finance_os_recurring_dismissed";

function loadDismissedRecurring() {
  try { return JSON.parse(localStorage.getItem(RECURRING_DISMISSED_KEY)) || []; } catch (error) { return []; }
}

// ---- Search box and Filter button, above everything else on the page.
function spendingToolbarHtml() {
  return `<div class="spend-tools"><input id="spending-search" type="search" placeholder="Search charges" autocomplete="off" autocapitalize="off" value="${escapeHtml(spendingFilter.search)}">
    <button id="spending-filter-button" class="filter-chip"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>Filter</button></div>`;
}

function describeSpendingFilter(settings, store) {
  const filter = spendingFilter;
  const parts = [];
  if (filter.search.trim()) parts.push(`“${filter.search.trim()}”`);
  if (filter.cards.length) parts.push(filter.cards.map((accountId) => cardNameForAccount(settings, store, accountId)).join(", "));
  if (filter.categories.length) parts.push(filter.categories.map(categoryDisplayName).join(", "));
  if (filter.minAmount != null && filter.maxAmount != null) parts.push(`${formatMoney(filter.minAmount)} to ${formatMoney(filter.maxAmount)}`);
  else if (filter.minAmount != null) parts.push(`${formatMoney(filter.minAmount)} and up`);
  else if (filter.maxAmount != null) parts.push(`up to ${formatMoney(filter.maxAmount)}`);
  if (filter.pendingOnly) parts.push("pending only");
  const periodLabel = SPENDING_PERIODS.find(([key]) => key === filter.period)[1];
  parts.push(filter.period === "shown" ? monthLabel(spendingMonthShown) : periodLabel);
  return parts.join(" · ");
}

// Shows the matching charges in place of the usual tiles while a search or filter is on, and the usual tiles otherwise.
function refreshSpendingResults(settings) {
  const results = document.getElementById("spending-results");
  const main = document.getElementById("spending-main");
  const filterButton = document.getElementById("spending-filter-button");
  if (!results || !main) return;
  const searchOnly = { ...spendingFilter, search: "" };
  if (filterButton) filterButton.classList.toggle("is-on", spendingFilterIsOn(searchOnly));
  const on = spendingFilterIsOn(spendingFilter);
  results.hidden = !on;
  main.hidden = on;
  if (!on) { results.innerHTML = ""; return; }
  const store = loadTransactionStore();
  const matches = filterCharges(spendingCharges(store), spendingFilter, spendingMonthShown, todayText());
  const totals = chargeTotals(matches);
  const rows = matches.slice(0, 150).map((charge) => chargeRowHtml(settings, store, charge)).join("");
  results.innerHTML = `<div class="tile"><div class="small">${escapeHtml(describeSpendingFilter(settings, store))}</div>
      <div class="huge-number">${formatMoney(totals.total)}</div>
      <div class="split-columns"><div><div class="small">Charges</div><div class="split-number">${totals.count}</div></div>
        <div class="split-right"><div class="small">Average · biggest</div><div class="split-number">${formatMoney(totals.average)} · ${formatMoney(totals.biggest)}</div></div></div></div>
    <div class="tile">${rows || `<div class="small">No charges match.</div>`}${matches.length > 150 ? `<div class="small">Showing the newest 150 of ${matches.length}. Narrow the filter to see the rest.</div>` : ""}</div>`;
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "spending-search") return;
  spendingFilter.search = event.target.value;
  clearTimeout(spendingSearchTimer);
  spendingSearchTimer = setTimeout(() => refreshSpendingResults(loadSettings()), 150);
});

// The filter sheet: cards, categories, an amount range, pending only and which months, then Show.
function openSpendingFilter(settings) {
  const store = loadTransactionStore();
  const draft = { ...spendingFilter, cards: new Set(spendingFilter.cards), categories: new Set(spendingFilter.categories) };
  const accountIds = Object.keys(store.accounts).filter((accountId) => ["credit", "depository"].includes(store.accounts[accountId].type));
  const cover = document.createElement("div");
  cover.className = "date-cover category-picker filter-sheet";
  const readAmounts = () => {
    const low = cover.querySelector("#spend-filter-min");
    const high = cover.querySelector("#spend-filter-max");
    if (low) draft.minAmount = low.value === "" ? null : Number(low.value);
    if (high) draft.maxAmount = high.value === "" ? null : Number(high.value);
  };
  const chip = (isOn, attribute, value, color, label) => `<button class="choice-button${isOn ? " is-current" : ""}" ${attribute}="${escapeHtml(value)}" style="--dot:${color}"><i class="choice-dot"></i><b>${escapeHtml(label)}</b></button>`;
  const draw = () => {
    cover.innerHTML = `<div class="date-box"><div class="date-question">Filter spending</div>
      <div class="filter-label">Card or account <span class="small">(none picked = all)</span></div>
      <div class="choice-list">${accountIds.map((accountId) => chip(draft.cards.has(accountId), "data-card", accountId, "var(--accent)", cardNameForAccount(settings, store, accountId))).join("")}</div>
      <div class="filter-label">Category</div>
      <div class="choice-list">${spendingCategoryChoices(settings).map((category) => chip(draft.categories.has(category), "data-category", category, CATEGORY_COLORS[category] || "#9ca3af", categoryDisplayName(category))).join("")}</div>
      <div class="filter-label">Amount</div>
      <div class="filter-amounts"><input id="spend-filter-min" type="number" inputmode="decimal" placeholder="From ($)" value="${draft.minAmount ?? ""}"><input id="spend-filter-max" type="number" inputmode="decimal" placeholder="To ($)" value="${draft.maxAmount ?? ""}"></div>
      <div class="choice-list">${chip(draft.pendingOnly, "data-pending-toggle", "yes", "var(--warning)", "Pending only")}</div>
      <div class="filter-label">Months</div>
      <div class="choice-list">${SPENDING_PERIODS.map(([key, label]) => chip(draft.period === key, "data-period", key, "var(--accent)", label)).join("")}</div>
      <div class="choice-list filter-actions"><button class="choice-button is-wide is-apply" data-filter-apply><b>Show</b></button><button class="choice-button is-wide" data-filter-reset><b>Clear filters</b></button></div></div>`;
  };
  draw();
  cover.addEventListener("click", (event) => {
    const toggle = (set, value) => { set.has(value) ? set.delete(value) : set.add(value); };
    const cardButton = event.target.closest("[data-card]");
    const categoryButton = event.target.closest("[data-category]");
    const periodButton = event.target.closest("[data-period]");
    const pendingButton = event.target.closest("[data-pending-toggle]");
    if (cardButton || categoryButton || periodButton || pendingButton) {
      readAmounts();
      if (cardButton) toggle(draft.cards, cardButton.dataset.card);
      if (categoryButton) toggle(draft.categories, categoryButton.dataset.category);
      if (periodButton) draft.period = periodButton.dataset.period;
      if (pendingButton) draft.pendingOnly = !draft.pendingOnly;
      draw();
      return;
    }
    const apply = event.target.closest("[data-filter-apply]");
    const reset = event.target.closest("[data-filter-reset]");
    if (!apply && !reset && event.target !== cover) return;
    if (apply) {
      readAmounts();
      spendingFilter = { ...draft, cards: [...draft.cards], categories: [...draft.categories], search: spendingFilter.search };
    }
    if (reset) {
      spendingFilter = emptySpendingFilter();
      const searchBox = document.getElementById("spending-search");
      if (searchBox) searchBox.value = "";
    }
    cover.remove();
    if (apply || reset) refreshSpendingResults(settings);
  });
  document.body.appendChild(cover);
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("#spending-filter-button")) return;
  const settings = loadSettings();
  if (settings) openSpendingFilter(settings);
});

// ---- This month against last month, by category (last month cut at the same day while this month is still going).
function vsLastMonthHtml(charges, yearMonth) {
  const isCurrent = yearMonth === todayText().slice(0, 7);
  const upToDay = isCurrent ? Number(todayText().slice(8, 10)) : 31;
  const comparison = monthComparison(charges, yearMonth, upToDay);
  if (!comparison.hasPrevious) return "";
  const up = comparison.difference > 0;
  const percent = Math.round((Math.abs(comparison.difference) / comparison.previousTotal) * 100);
  const biggest = Math.max(1, ...comparison.categories.map((entry) => Math.max(entry.total, entry.previousTotal)));
  const headline = comparison.difference === 0 ? "Same as last month" : `<span class="${up ? "negative" : "positive"}">${up ? "▲" : "▼"} ${formatMoney(Math.abs(comparison.difference))} (${percent}%) ${up ? "more" : "less"}</span> than ${monthLabel(comparison.previousMonth)}${isCurrent ? ` by day ${upToDay}` : ""}`;
  const rows = comparison.categories.slice(0, 6).map((entry) => `<div class="place-row"><div class="tile-row small"><span>${escapeHtml(entry.name)}</span><span class="${entry.difference > 0 ? "negative" : entry.difference < 0 ? "positive" : ""}">${entry.difference > 0 ? "▲ +" : entry.difference < 0 ? "▼ −" : ""}${formatMoney(Math.abs(entry.difference))}</span></div>
      <div class="bar"><div class="bar-fill" style="width:${Math.round((entry.total / biggest) * 100)}%;background:${CATEGORY_COLORS[entry.category] || "var(--accent)"}"></div></div>
      <div class="bar"><div class="bar-fill compare-last" style="width:${Math.round((entry.previousTotal / biggest) * 100)}%"></div></div>
      <div class="tile-row small"><span>This month ${formatMoney(entry.total)}</span><span>Last month ${formatMoney(entry.previousTotal)}</span></div></div>`).join("");
  return `<details class="tile category-tile spending-accent" style="--tile-accent:var(--accent)"><summary><div class="tile-row"><b>Vs last month</b></div><div class="small">${headline}</div></summary>${rows}</details>`;
}

// ---- Daily pace: a running total through the month, this month against last month.
function paceTileHtml(allCharges, yearMonth) {
  const pace = dailyPace(allCharges, yearMonth, todayText());
  if (pace.thisMonth.length === 0 || (!pace.hasLastMonth && pace.thisToDate <= 0)) return "";
  const width = 300;
  const height = 110;
  const pad = 8;
  const top = Math.max(1, ...pace.thisMonth, ...pace.lastMonth);
  const x = (day) => pad + ((day - 1) / Math.max(1, pace.daysInMonth - 1)) * (width - 2 * pad);
  const y = (amount) => height - pad - (Math.max(0, amount) / top) * (height - 2 * pad);
  const line = (series) => series.map((amount, position) => `${x(position + 1).toFixed(1)},${y(amount).toFixed(1)}`).join(" ");
  const up = pace.difference > 0;
  const compareLine = !pace.hasLastMonth ? "" : pace.difference === 0 ? "Right on last month's pace" : `<span class="${up ? "negative" : "positive"}">${up ? "▲" : "▼"} ${formatMoney(Math.abs(pace.difference))} ${up ? "ahead of" : "behind"}</span> last month's pace`;
  const lastPoint = pace.thisMonth.length;
  return `<div class="tile pace-tile"><b>Spending pace</b><div class="small">${compareLine}</div>
    <svg viewBox="0 0 ${width} ${height}" class="pace-chart" role="img" aria-label="Running spending total by day, this month and last month">
      <polyline class="pace-last" points="${line(pace.lastMonth)}"/><polyline class="pace-this" points="${line(pace.thisMonth)}"/>
      <circle class="pace-dot" cx="${x(lastPoint).toFixed(1)}" cy="${y(pace.thisToDate).toFixed(1)}" r="4"/></svg>
    <div class="tile-row small"><span><span class="dot pace-key-this"></span>${monthLabel(yearMonth).split(" ")[0]} day ${pace.lastDayShown}</span><b>${formatMoney(pace.thisToDate)}</b></div>
    ${pace.hasLastMonth ? `<div class="tile-row small"><span><span class="dot pace-key-last"></span>${monthLabel(previousYearMonth(yearMonth)).split(" ")[0]} by day ${pace.lastDayShown}</span><b>${formatMoney(pace.lastAtSameDay)}</b></div>` : ""}
    <div class="small">Card and bank purchases. Transfers are left out.</div></div>`;
}

// ---- Budgets: set a monthly limit for a category; its bar fills and turns red when you pass it.
function budgetsTileHtml(settings, month) {
  const rows = budgetRows(settings, month);
  const overCount = rows.filter((row) => row.state === "over").length;
  const note = rows.length ? (overCount ? `${overCount} over budget` : "All on track") : "None set yet";
  const barColor = { ok: "var(--good)", near: "var(--warning)", over: "var(--bad)" };
  const rowHtml = rows.map((row) => `<div class="place-row"><div class="tile-row"><span>${escapeHtml(row.name)}</span><span class="${row.state === "over" ? "negative" : ""}">${formatMoney(row.spent)} of ${formatMoney(row.limit)}</span></div>
      <div class="bar"><div class="bar-fill" style="width:${Math.min(100, row.percent)}%;background:${barColor[row.state]}"></div></div>
      <div class="tile-row small"><span>${row.left >= 0 ? formatMoney(row.left) + " left" : formatMoney(-row.left) + " over"}</span><button class="mark-button" data-edit-budget="${escapeHtml(row.category)}">edit</button></div></div>`).join("");
  return `<details class="tile category-tile spending-accent" style="--tile-accent:var(--good)"><summary><div class="tile-row"><b>Budgets</b></div><div class="small">${note}</div></summary>${rowHtml}<button class="mark-button" data-add-budget="yes">+ Add a budget</button></details>`;
}

async function setBudgetFor(category) {
  const settings = loadSettings();
  const current = (settings.category_budgets || {})[category];
  const answer = prompt(`Monthly budget for ${categoryDisplayName(category)} ($). Leave blank to remove it.`, current || "");
  if (answer === null) return;
  const limit = Number(answer);
  if (answer.trim() !== "" && !(limit >= 0)) { showToast("Type a number, like 250."); return; }
  settings.category_budgets = { ...(settings.category_budgets || {}) };
  if (answer.trim() === "" || limit === 0) delete settings.category_budgets[category];
  else settings.category_budgets[category] = limit;
  saveSettings(settings);
  showSpendingKeepingOpen(settings);
  showToast(settings.category_budgets[category] ? `Budget set: ${formatMoney(limit)} a month.` : "Budget removed.");
}

function showSpendingKeepingOpen(settings) {
  const openTiles = [...document.querySelectorAll("#spending-main details")].map((tile) => tile.open);
  showSpendingPage(settings);
  [...document.querySelectorAll("#spending-main details")].forEach((tile, position) => { tile.open = Boolean(openTiles[position]); });
}

document.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-budget]");
  const addButton = event.target.closest("[data-add-budget]");
  if (!editButton && !addButton) return;
  event.preventDefault();
  if (editButton) { setBudgetFor(editButton.dataset.editBudget); return; }
  const settings = loadSettings();
  const budgeted = Object.keys(settings.category_budgets || {});
  const choices = spendingCategoryChoices(settings).filter((category) => !budgeted.includes(category)).map((category) => ({ title: categoryDisplayName(category), detail: "", value: category, color: CATEGORY_COLORS[category] || "#9ca3af" }));
  const picked = await askChoice("Budget for which category?", choices, "category-picker");
  if (picked) setBudgetFor(picked);
});

// ---- Recurring detector: charges that repeat every month and are not in Bills yet.
function recurringCandidatesNow(settings, store) {
  const billMatches = matchBills(settings, store, loadBillMarks(), todayText());
  return recurringCandidates(nonBillCharges(settings, store, billMatches), todayText(), loadDismissedRecurring());
}

function recurringTileHtml(settings, store) {
  const candidates = recurringCandidatesNow(settings, store);
  if (!candidates.length) return "";
  const rows = candidates.map((candidate) => `<div class="place-row"><div class="tile-row"><span>${escapeHtml(candidate.name)}</span><b>${formatMoney(candidate.amount)}</b></div>
      <div class="tile-row small"><span>around the ${candidate.day}${ordinalEnding(candidate.day)} · ${candidate.monthsSeen} months in a row · ${escapeHtml(cardNameForAccount(settings, store, candidate.accountId))}</span></div>
      <div class="tile-row small"><button class="mark-button" data-add-recurring="${escapeHtml(candidate.key)}">add to Bills</button><button class="mark-button" data-dismiss-recurring="${escapeHtml(candidate.key)}">not recurring</button></div></div>`).join("");
  return `<details class="tile category-tile spending-accent" style="--tile-accent:var(--warning)"><summary><div class="tile-row"><b>Looks recurring</b><b>${candidates.length}</b></div><div class="small">Charged every month, not in Bills yet</div></summary>${rows}</details>`;
}

document.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-recurring]");
  const dismissButton = event.target.closest("[data-dismiss-recurring]");
  if (!addButton && !dismissButton) return;
  event.preventDefault();
  const settings = loadSettings();
  const store = loadTransactionStore();
  if (dismissButton) {
    localStorage.setItem(RECURRING_DISMISSED_KEY, JSON.stringify([...loadDismissedRecurring(), dismissButton.dataset.dismissRecurring]));
    showSpendingKeepingOpen(settings);
    showToast("Okay, it won't be suggested again.");
    return;
  }
  const candidate = recurringCandidatesNow(settings, store).find((entry) => entry.key === addButton.dataset.addRecurring);
  if (!candidate) return;
  const payer = payerForAccount(settings, store.accounts[candidate.accountId]);
  if (!payer) { showToast("Add that card in Set up first, then try again."); return; }
  addRecurringToSettings(settings, candidate, payer);
  saveSettings(settings);
  showEverything();
  showSpendingPage(settings);
  showToast(`Added ${candidate.name} to Bills.`);
});

// ---- Merchant rule: after picking a category for one charge, offer to use it for every charge from that merchant.
// Returns the rule's text when one was saved, otherwise "".
async function askAboutMerchantRule(settings, charge, category) {
  const ruleText = merchantRuleText(charge);
  const matching = chargesWithText(spendingCharges(loadTransactionStore()), ruleText);
  if (matching.length < 2) return "";
  const picked = await askChoice(`Use ${categoryDisplayName(category)} for all ${matching.length} charges from ${merchantName(charge)}?`, [
    { title: "Just this charge", detail: "", value: "one", wide: true },
    { title: `All ${matching.length}, and future ones too`, detail: `Saves a rule for “${ruleText}”`, value: "rule", wide: true },
  ], "category-picker");
  if (picked !== "rule") return "";
  applyMerchantRule(settings, ruleText, category, matching);
  return ruleText;
}
