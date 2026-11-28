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
  return `<div class="spend-tools"><div class="spend-search${spendingFilter.search ? " has-text" : ""}"><input id="spending-search" type="search" placeholder="Search charges" autocomplete="off" autocapitalize="off" value="${escapeHtml(spendingFilter.search)}">
    <button class="spend-search-clear" data-clear-search aria-label="Clear search">&#10005;</button></div>
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
  event.target.parentElement.classList.toggle("has-text", event.target.value !== "");
  clearTimeout(spendingSearchTimer);
  spendingSearchTimer = setTimeout(() => refreshSpendingResults(loadSettings()), 150);
});

// The round x in the search box empties it in one tap and keeps the keyboard up for a new word.
document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-clear-search]")) return;
  event.preventDefault();
  const searchBox = document.getElementById("spending-search");
  spendingFilter.search = "";
  searchBox.value = "";
  searchBox.parentElement.classList.remove("has-text");
  searchBox.focus();
  refreshSpendingResults(loadSettings());
  showToast("Search cleared.");
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

// A small rounded pill for a change: up is soft red (more spending), down is soft green.
function trendPillHtml(difference, text) {
  const direction = difference > 0 ? "is-up" : difference < 0 ? "is-down" : "is-flat";
  const arrow = difference > 0 ? "&#9650; " : difference < 0 ? "&#9660; " : "";
  return `<span class="trend-pill ${direction}">${arrow}${text}</span>`;
}

// ---- This month against last month, by category (last month cut at the same day while this month is still going).
function vsLastMonthHtml(charges, yearMonth) {
  const isCurrent = yearMonth === todayText().slice(0, 7);
  const upToDay = isCurrent ? Number(todayText().slice(8, 10)) : 31;
  const comparison = monthComparison(charges, yearMonth, upToDay);
  if (!comparison.hasPrevious) return "";
  const percent = comparison.previousTotal > 0 ? Math.round((Math.abs(comparison.difference) / comparison.previousTotal) * 100) : 0;
  const lastMonthName = monthLabel(comparison.previousMonth).slice(0, 3);
  const headPill = comparison.difference === 0 ? trendPillHtml(0, "Same as last month") : trendPillHtml(comparison.difference, `${formatMoney(Math.abs(comparison.difference))} ${comparison.difference > 0 ? "more" : "less"} \u00b7 ${percent}%`);
  const biggest = Math.max(1, ...comparison.categories.map((entry) => Math.max(entry.total, entry.previousTotal)));
  const rows = comparison.categories.slice(0, 6).map((entry) => `<div class="vs-row" style="--row-color:${CATEGORY_COLORS[entry.category] || "#9ca3af"}">
      <div class="vs-row-head"><span class="vs-name"><i class="vs-dot"></i>${escapeHtml(entry.name)}</span>${entry.difference === 0 ? trendPillHtml(0, "same") : trendPillHtml(entry.difference, (entry.difference > 0 ? "+" : "&minus;") + formatMoney(Math.abs(entry.difference)))}</div>
      <div class="vs-bars"><div class="vs-bar"><i style="width:${Math.round((entry.total / biggest) * 100)}%"></i></div><div class="vs-bar is-last"><i style="width:${Math.round((entry.previousTotal / biggest) * 100)}%"></i></div></div>
      <div class="vs-row-foot"><span>${formatMoney(entry.total)} now</span><span>${formatMoney(entry.previousTotal)} in ${lastMonthName}</span></div></div>`).join("");
  return `<details class="tile category-tile spending-accent insight-tile" style="--tile-accent:#818cf8"><summary><div class="insight-head"><b>Vs last month</b>${headPill}</div>
      <div class="insight-stats"><div class="insight-stat"><span>${isCurrent ? "This month so far" : "This month"}</span><b>${formatMoney(comparison.total)}</b></div>
        <div class="insight-stat"><span>${lastMonthName}${isCurrent ? ` by day ${upToDay}` : ""}</span><b>${formatMoney(comparison.previousTotal)}</b></div></div></summary>
    ${rows}<div class="small insight-foot">Bright bar is this month, faded bar is ${lastMonthName}.</div></details>`;
}

// ---- Daily pace: a running total through the month, this month against last month.
function paceTileHtml(allCharges, yearMonth) {
  const pace = dailyPace(allCharges, yearMonth, todayText());
  if (pace.thisMonth.length === 0 || (!pace.hasLastMonth && pace.thisToDate <= 0)) return "";
  const width = 300;
  const height = 120;
  const pad = 8;
  const top = Math.max(1, ...pace.thisMonth, ...pace.lastMonth);
  const x = (day) => pad + ((day - 1) / Math.max(1, pace.daysInMonth - 1)) * (width - 2 * pad);
  const y = (amount) => height - pad - (Math.max(0, amount) / top) * (height - 2 * pad);
  const line = (series) => series.map((amount, position) => `${x(position + 1).toFixed(1)},${y(amount).toFixed(1)}`).join(" ");
  const lastPoint = pace.thisMonth.length;
  const areaUnderThisMonth = `${line(pace.thisMonth)} ${x(lastPoint).toFixed(1)},${height - pad} ${x(1).toFixed(1)},${height - pad}`;
  const headPill = !pace.hasLastMonth ? "" : pace.difference === 0 ? trendPillHtml(0, "On last month's pace") : trendPillHtml(pace.difference, `${formatMoney(Math.abs(pace.difference))} ${pace.difference > 0 ? "ahead" : "behind"}`);
  const thisMonthName = monthLabel(yearMonth).slice(0, 3);
  const lastMonthName = monthLabel(previousYearMonth(yearMonth)).slice(0, 3);
  return `<div class="tile spending-accent insight-tile pace-tile" style="--tile-accent:var(--accent)"><div class="insight-head"><b>Spending pace</b>${headPill}</div>
    <div class="small insight-sub">Running total through the month${pace.hasLastMonth ? `, against ${lastMonthName}` : ""}</div>
    <svg viewBox="0 0 ${width} ${height}" class="pace-chart" role="img" aria-label="Running spending total by day, this month and last month">
      <defs><linearGradient id="pace-fill-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      <polygon class="pace-area" points="${areaUnderThisMonth}"/>
      ${pace.hasLastMonth ? `<polyline class="pace-last" points="${line(pace.lastMonth)}"/>` : ""}<polyline class="pace-this" points="${line(pace.thisMonth)}"/>
      <circle class="pace-halo" cx="${x(lastPoint).toFixed(1)}" cy="${y(pace.thisToDate).toFixed(1)}" r="9"/><circle class="pace-dot" cx="${x(lastPoint).toFixed(1)}" cy="${y(pace.thisToDate).toFixed(1)}" r="4"/></svg>
    <div class="pace-axis"><span>Day 1</span><span>Day ${pace.daysInMonth}</span></div>
    <div class="insight-stats"><div class="insight-stat"><span><i class="dot pace-key-this"></i>${thisMonthName} by day ${pace.lastDayShown}</span><b>${formatMoney(pace.thisToDate)}</b></div>
      ${pace.hasLastMonth ? `<div class="insight-stat"><span><i class="dot pace-key-last"></i>${lastMonthName} by day ${pace.lastDayShown}</span><b>${formatMoney(pace.lastAtSameDay)}</b></div>` : ""}</div>
    <div class="small insight-foot">Card and bank purchases. Transfers are left out.</div></div>`;
}

// ---- Budgets: a monthly limit per category. Each budget is a small card: its bar fills in the category's color
// (amber when close, red when over), a thin tick marks how far through the month you are, and the line under it
// says what is left. Hold a card to edit it, swipe it to delete it.
function budgetsTileHtml(settings, month) {
  const rows = budgetRows(settings, month);
  const overCount = rows.filter((row) => row.state === "over").length;
  const isCurrentMonth = spendingMonthShown === todayText().slice(0, 7);
  const today = Number(todayText().slice(8, 10));
  const [year, monthNumber] = spendingMonthShown.split("-").map(Number);
  const daysInShownMonth = new Date(year, monthNumber, 0).getDate();
  const daysLeftIncludingToday = daysInShownMonth - today + 1;
  const monthPacePercent = Math.round((today / daysInShownMonth) * 100);
  const stateColor = (row) => row.state === "over" ? "#e88b8b" : CATEGORY_COLORS[row.category] || "var(--accent)";
  const statePill = (row) => row.state === "over" ? `<span class="budget-state">over</span>` : row.state === "near" ? `<span class="budget-state">close</span>` : "";
  const cards = rows.map((row) => {
    const color = stateColor(row);
    const perDay = isCurrentMonth && row.left > 0 ? ` \u00b7 about ${formatMoney(row.left / daysLeftIncludingToday)} a day for ${daysLeftIncludingToday} day${daysLeftIncludingToday === 1 ? "" : "s"}` : "";
    return `<div class="charge-row budget-card budget-${row.state}" data-budget-hold="${escapeHtml(row.category)}" style="--budget-color:${color};--category-color:${CATEGORY_COLORS[row.category] || "#9ca3af"}">
      <div class="budget-head"><span class="budget-name"><i class="budget-dot"></i>${escapeHtml(row.name)}</span><span class="budget-amounts"><b>${formatMoney(row.spent)}</b> / ${formatMoney(row.limit)}</span></div>
      <div class="budget-track"><div class="budget-fill" style="width:${Math.min(100, row.percent)}%"></div>${isCurrentMonth ? `<i class="budget-pace" style="left:${monthPacePercent}%"></i>` : ""}</div>
      <div class="budget-foot"><span class="${row.left < 0 ? "negative" : ""}">${row.left >= 0 ? formatMoney(row.left) + " left" : formatMoney(-row.left) + " over"}${perDay}</span><b class="budget-percent">${statePill(row)}${row.percent}%</b></div>
      <button class="remove-link" data-remove-budget="${escapeHtml(row.category)}">remove</button></div>`;
  }).join("");
  const totalSpent = rows.reduce((sum, row) => sum + row.spent, 0);
  const totalLimit = rows.reduce((sum, row) => sum + row.limit, 0);
  const note = !rows.length ? "None set yet" : overCount ? `<span class="negative">${overCount} over budget</span>` : `<span class="positive">All on track</span>`;
  const totals = rows.length ? `<span class="budget-amounts"><b>${formatMoney(totalSpent)}</b> / ${formatMoney(totalLimit)}</span>` : "";
  const hint = rows.length ? `<div class="small budget-hint">Hold a budget to change it, swipe it to delete.${isCurrentMonth ? " The thin line is today." : ""}</div>` : "";
  return `<details class="tile category-tile spending-accent budget-tile no-swipe-parent" style="--tile-accent:#8b9cf7"><summary><div class="tile-row"><b>Budgets</b>${totals}</div><div class="small">${note}</div></summary>
    ${cards}<button class="budget-add" data-add-budget="yes">+ Add a budget</button>${hint}</details>`;
}

// How much went to one category in a month (bills left out, like the budget bars).
function categorySpentInMonth(settings, category, yearMonth) {
  const store = loadTransactionStore();
  const month = monthlyBreakdown(nonBillCharges(settings, store, matchBills(settings, store, loadBillMarks(), todayText())), yearMonth);
  return (month.categories.find((entry) => entry.category === category) || {}).total || 0;
}

function saveBudget(settings, category, limit) {
  settings.category_budgets = { ...(settings.category_budgets || {}) };
  if (limit > 0) settings.category_budgets[category] = limit; else delete settings.category_budgets[category];
  saveSettings(settings);
  showSpendingKeepingOpen(settings);
}

// Bottom sheet to set or change a category's monthly budget, with last month's spending as a one-tap suggestion.
function openBudgetSheet(category) {
  const settings = loadSettings();
  const current = (settings.category_budgets || {})[category];
  const lastMonthSpent = categorySpentInMonth(settings, category, previousYearMonth(spendingMonthShown || todayText().slice(0, 7)));
  const suggestion = lastMonthSpent > 0 ? Math.ceil(lastMonthSpent / 50) * 50 : 0;
  const color = CATEGORY_COLORS[category] || "#9ca3af";
  const cover = document.createElement("div");
  cover.className = "date-cover category-picker filter-sheet bill-editor";
  let typed = current ? String(current) : "";
  let errorText = "";
  const draw = () => {
    cover.innerHTML = `<div class="date-box"><div class="date-question"><i class="budget-dot" style="--category-color:${color}"></i>${escapeHtml(categoryDisplayName(category))} budget</div>
      <div class="filter-label">Monthly limit ($)</div><input id="budget-sheet-amount" inputmode="decimal" placeholder="for example 300" value="${escapeHtml(typed)}" autocomplete="off">
      ${suggestion ? `<div class="choice-list"><button class="choice-button is-wide budget-suggest" data-budget-suggest="${suggestion}"><b>Use ${formatMoney(suggestion)}</b><span class="small">Last month you spent ${formatMoney(lastMonthSpent)}</span></button></div>` : ""}
      ${errorText ? `<div class="editor-error">${escapeHtml(errorText)}</div>` : ""}
      <div class="choice-list filter-actions"><button class="choice-button is-wide is-apply" data-budget-save><b>Save</b></button><button class="choice-button is-wide" data-budget-cancel><b>Cancel</b></button></div></div>`;
  };
  draw();
  cover.addEventListener("click", (event) => {
    const suggestButton = event.target.closest("[data-budget-suggest]");
    if (suggestButton) { typed = suggestButton.dataset.budgetSuggest; errorText = ""; draw(); return; }
    if (event.target.closest("[data-budget-save]")) {
      typed = cover.querySelector("#budget-sheet-amount").value.trim();
      const limit = parseFloat(typed.replace(/[$,]/g, ""));
      if (!(limit > 0)) { errorText = "Type an amount more than 0, like 250."; draw(); return; }
      cover.remove();
      saveBudget(settings, category, Math.round(limit * 100) / 100);
      showToast(`${categoryDisplayName(category)}: ${formatMoney(limit)} a month.`);
      return;
    }
    if (event.target.closest("[data-budget-cancel]") || event.target === cover) cover.remove();
  });
  document.body.appendChild(cover);
}

function showSpendingKeepingOpen(settings) {
  const openTiles = [...document.querySelectorAll("#spending-main details")].map((tile) => tile.open);
  showSpendingPage(settings);
  [...document.querySelectorAll("#spending-main details")].forEach((tile, position) => { tile.open = Boolean(openTiles[position]); });
}

document.addEventListener("click", async (event) => {
  const removeButton = event.target.closest("[data-remove-budget]");
  const addButton = event.target.closest("[data-add-budget]");
  if (!removeButton && !addButton) return;
  event.preventDefault();
  if (removeButton) {
    const category = removeButton.dataset.removeBudget;
    saveBudget(loadSettings(), category, 0);
    showToast(`${categoryDisplayName(category)} budget removed.`);
    return;
  }
  const settings = loadSettings();
  const budgeted = Object.keys(settings.category_budgets || {});
  const choices = spendingCategoryChoices(settings).filter((category) => !budgeted.includes(category)).map((category) => ({ title: categoryDisplayName(category), detail: "", value: category, color: CATEGORY_COLORS[category] || "#9ca3af" }));
  const picked = await askChoice("Budget for which category?", choices, "category-picker");
  if (picked) openBudgetSheet(picked);
});

// ---- Recurring detector: charges that repeat every month and are not in Bills yet.
function recurringCandidatesNow(settings, store) {
  const billMatches = matchBills(settings, store, loadBillMarks(), todayText());
  return recurringCandidates(nonBillCharges(settings, store, billMatches), todayText(), loadDismissedRecurring());
}

function recurringTileHtml(settings, store) {
  const candidates = recurringCandidatesNow(settings, store);
  if (!candidates.length) return "";
  const rows = candidates.map((candidate) => openRowHtml(badgeHtml("day", "~" + candidate.day), escapeHtml(candidate.name),
      `${candidate.monthsSeen} months in a row · ${escapeHtml(cardNameForAccount(settings, store, candidate.accountId))}`, formatMoney(candidate.amount), ` class="open-row"`,
      `<div class="open-row-actions"><button class="pill-button pill-button-main" data-add-recurring="${escapeHtml(candidate.key)}">Add to Bills</button><button class="pill-button" data-dismiss-recurring="${escapeHtml(candidate.key)}">Not recurring</button></div>`)).join("");
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
