// Goals tab (savings goals) and Track tab (net worth history, credit score log, monthly recap).

function showGoalsPage(settings) {
  const goals = settings.savings_goals;
  const savingsBalance = settings.starting_balances.savings_balance;
  const setAside = goals.reduce((sum, goal) => sum + goal.saved, 0);
  const notAssigned = Math.round((savingsBalance - setAside) * 100) / 100;
  const tiles = goals.map((goal, position) => {
    const { percent, remaining } = goalProgress(goal);
    return `<div class="tile"><div class="tile-row"><b>${escapeHtml(goal.name)}</b><button class="remove-link" data-remove-goal="${position}">remove</button></div>
      <div class="tile-row"><span>${editableNumber(`savings_goals.${position}.saved`, goal.name + ": saved so far ($)", goal.saved, true)}</span>
        <span class="small">of ${editableNumber(`savings_goals.${position}.target`, goal.name + ": goal amount ($)", goal.target, true)}</span></div>
      <div class="bar"><div class="bar-fill" style="width:${percent}%"></div></div>
      <div class="small">${percent}% there, ${formatMoney(remaining)} to go</div></div>`;
  }).join("");
  document.getElementById("goals-list").innerHTML = `<h2>Savings goals</h2>
    <div class="tile"><div class="small">In savings</div><div class="big-number">${formatMoney(savingsBalance)}</div>
      <div class="tile-row small"><span>Set aside for goals</span><span>${formatMoney(setAside)}</span></div>
      <div class="tile-row small"><span>Not assigned to a goal</span><span class="${notAssigned < 0 ? "negative" : ""}">${formatMoney(notAssigned)}</span></div>
      ${notAssigned < 0 ? `<div class="small negative">Your goals add up to more than what is in savings.</div>` : ""}</div>
    ${tiles || `<div class="tile small">No goals yet.</div>`}
    <button id="add-goal-button">Add goal</button>`;
  showExpectedMoney(settings);
  showGoalDatePlanner(settings);
  showWhatIfSaving(settings);
}

function savingsPlanWeekly(settings) {
  return (settings.savings_plan && settings.savings_plan.weekly_amount) || 0;
}

// One row per listed amount that counts (green = reaches savings, red = leaves), plus a note for any that do not count.
function expectedMoneyRows(expected) {
  const row = (item, isOut) => `<div class="tile-row small"><span>${escapeHtml(item.label || (isOut ? "Money going out" : "Money coming in"))}, ${formatDate(item.date)}</span><span class="${isOut ? "negative" : "positive"}">${isOut ? "-" : "+"}${formatMoney(item.amount)}</span></div>`;
  const skippedNote = expected.skipped.length
    ? `<div class="small warning">Not counted: ${expected.skipped.map((item) => `${escapeHtml(item.label || "an item")} (${item.reason})`).join(", ")}.</div>` : "";
  return expected.inItems.map((item) => row(item, false)).join("") + expected.outItems.map((item) => row(item, true)).join("") + skippedNote;
}

// "If I save $X a week for N weeks, what will savings be?" Counts the money you listed as coming in. Typing here does not change your plan until you press the button.
function showWhatIfSaving(settings) {
  const weeklyBox = document.getElementById("plan-weekly-amount");
  const planAmount = savingsPlanWeekly(settings);
  if (!weeklyBox.dataset.typed) weeklyBox.value = planAmount || "";
  document.getElementById("plan-current-note").textContent = planAmount ? `My plan right now: ${formatMoney(planAmount)} a week` : "No weekly plan set yet";
  const resultBox = document.getElementById("plan-what-if-result");
  const weeklyAmount = parseFloat(weeklyBox.value) || 0;
  const weeks = parseInt(document.getElementById("plan-weeks").value, 10) || 0;
  if (weeklyAmount <= 0 || weeks <= 0) { resultBox.innerHTML = ""; return; }
  const goal = settings.savings_goals[document.getElementById("goal-plan-goal").value];
  const result = savingsAfterWeeks(settings.starting_balances.savings_balance, weeklyAmount, weeks, todayText(), settings.expected_money, goal);
  resultBox.innerHTML = `<div class="tile good"><div class="small">In ${weeks} week${weeks === 1 ? "" : "s"} (${formatDate(result.endDate)}) savings would be</div>
    <div class="big-number">${formatMoney(result.finalBalance)}</div>
    <div class="tile-row small"><span>Savings today</span><span>${formatMoney(settings.starting_balances.savings_balance)}</span></div>
    <div class="tile-row small"><span>${formatMoney(weeklyAmount)} x ${weeks} weeks</span><span>+${formatMoney(result.fromSaving)}</span></div>
    ${expectedMoneyRows(result.expected)}
    ${goal && result.goalPercent !== null ? `<div class="small">${result.goalPercent}% of ${escapeHtml(goal.name)}</div>` : ""}
    <button id="make-weekly-plan-button" data-weekly="${weeklyAmount}">Make ${formatMoney(weeklyAmount)} a week my plan</button></div>`;
}

// The list of money you know is coming in (goes to savings) or going out (leaves checking).
function showExpectedMoney(settings) {
  const items = (settings.expected_money || []).map((item, position) => ({ ...item, position })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const rows = items.map((item) => `<div class="tile"><div class="tile-row"><b>${escapeHtml(item.label || (item.kind === "out" ? "Money going out" : "Money coming in"))}</b>
      <button class="remove-link" data-remove-expected="${item.position}">remove</button></div>
    <div class="tile-row small"><span>${formatDate(item.date)}${item.kind === "out" ? " (out of checking)" : " (into savings)"}${item.date <= todayText() ? " - date has passed, not counted" : ""}</span>
      <span class="${item.kind === "out" ? "negative" : "positive"}">${item.kind === "out" ? "-" : "+"}${formatMoney(item.amount)}</span></div></div>`).join("");
  document.getElementById("expected-money-list").innerHTML = `${rows || `<div class="tile small">Nothing listed. Add a bonus, gift, tuition or any amount with a known date.</div>`}
    <button id="add-expected-in-button">Add money coming in</button> <button id="add-expected-out-button">Add money going out</button>`;
}

for (const inputId of ["plan-weekly-amount", "plan-weeks"]) {
  document.getElementById(inputId).addEventListener("input", () => {
    if (inputId === "plan-weekly-amount") document.getElementById(inputId).dataset.typed = "yes";
    const settings = loadSettings();
    if (settings) showWhatIfSaving(settings);
  });
}

// "What if I want it done by this date?" Picks a goal and a date, shows the weekly amount.
function showGoalDatePlanner(settings) {
  const goalMenu = document.getElementById("goal-plan-goal");
  const previousChoice = goalMenu.value;
  goalMenu.innerHTML = settings.savings_goals.map((goal, position) => `<option value="${position}">${escapeHtml(goal.name)}</option>`).join("");
  if (previousChoice && goalMenu.options[previousChoice]) goalMenu.value = previousChoice;
  const resultBox = document.getElementById("goal-plan-result");
  const goal = settings.savings_goals[goalMenu.value];
  const targetDate = document.getElementById("goal-plan-date").value;
  if (!goal) { resultBox.innerHTML = `<div class="small">Add a goal first.</div>`; return; }
  if (!targetDate) { resultBox.innerHTML = ""; return; }
  const plan = weeklySavingsNeeded(goal, todayText(), targetDate, settings.expected_money);
  if (!plan) { resultBox.innerHTML = `<div class="tile warning">Pick a date after today.</div>`; return; }
  const paycheck = settings.paycheck.usual_take_home_amount;
  const percentOfPaycheck = Math.round((plan.perWeek / paycheck) * 100);
  const expectedLines = expectedMoneyRows(plan.expected);
  const hasListedMoney = plan.expected.inItems.length + plan.expected.outItems.length > 0;
  resultBox.innerHTML = plan.remaining === 0
    ? `<div class="tile good"><b>${escapeHtml(goal.name)} ${hasListedMoney ? "is covered by the money you listed. Nothing to save each week." : "is already fully funded."}</b>${expectedLines}</div>`
    : `<div class="tile good"><div class="big-number">${formatMoney(plan.perWeek)} a week</div>
      <div class="tile-row small"><span>Left to reach the goal</span><span>${formatMoney(plan.remainingBeforeExpected)}</span></div>${expectedLines}
      <div class="tile-row small"><span>To save</span><span>${formatMoney(plan.remaining)}</span></div>
      <div class="tile-row small"><span>Weeks until ${formatDate(targetDate)}</span><span>${plan.weeksLeft}</span></div>
      <div class="tile-row small"><span>About per month</span><span>${formatMoney(plan.perMonth)}</span></div>
      <div class="tile-row small"><span>Share of a ${formatMoney(paycheck)} paycheck</span><span>${percentOfPaycheck}%</span></div>
      <button id="use-weekly-plan-button" data-weekly="${plan.perWeek}">Use ${formatMoney(plan.perWeek)} a week as my plan</button></div>`;
}

for (const inputId of ["goal-plan-goal", "goal-plan-date"]) {
  document.getElementById(inputId).addEventListener("input", () => { const settings = loadSettings(); if (settings) { showGoalDatePlanner(settings); showWhatIfSaving(settings); } });
}

function netWorthSparkline(history) {
  if (history.length < 2) return "";
  const values = history.map((entry) => entry.net_worth);
  const low = Math.min(...values);
  const spread = Math.max(...values) - low || 1;
  const points = values.map((value, position) => `${(position / (values.length - 1)) * 300},${56 - ((value - low) / spread) * 52}`).join(" ");
  return `<svg viewBox="0 0 300 60" width="100%" height="60"><polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>`;
}

function changeText(change, isMoney) {
  if (change === null) return "";
  const shown = isMoney ? formatMoney(Math.abs(change)) : Math.abs(change);
  return `<span class="${change < 0 ? "negative" : "positive"}">${change < 0 ? "-" : "+"}${shown}</span>`;
}

function historyRows(entries, valueKey, listName, isMoney, labelFor) {
  return entriesWithChange(entries, valueKey).map((entry) => {
    const position = entries.findIndex((original) => original.date === entry.date);
    return `<div class="tile-row small"><span>${formatDate(entry.date)}${labelFor(entry)}</span>
      <span>${isMoney ? formatMoney(entry[valueKey]) : entry[valueKey]} ${changeText(entry.change, isMoney)}
      <button class="remove-link" data-remove-entry="${listName}:${position}">x</button></span></div>`;
  }).join("");
}

function showTrackPage(settings) {
  const history = settings.net_worth_history;
  const scores = settings.credit_scores;
  const today = todayText();
  const yearMonth = today.slice(0, 7);
  const monthName = new Date(today + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const fixedCosts = totalsForItems(monthlyItemsForTab(settings, "subscriptions")).monthlyTotal
    + totalsForItems(monthlyItemsForTab(settings, "expenses")).monthlyTotal + totalAnnualFees(settings) / 12;
  const recap = monthlyRecap({
    netWorthHistory: history, creditScores: scores, goals: settings.savings_goals,
    monthlyIncome: (settings.paycheck.usual_take_home_amount * 52) / 12, monthlyFixedCosts: fixedCosts, yearMonth,
  });
  const recapRows = [
    ["Net worth this month", recap.netWorthChange === null ? "—" : changeText(recap.netWorthChange, true)],
    ["Credit score this month", recap.creditScoreChange === null ? "—" : changeText(recap.creditScoreChange, false)],
    ["Saved toward goals", settings.savings_goals.length ? `${formatMoney(recap.goalsSaved)} of ${formatMoney(recap.goalsTarget)}` : "No goals yet"],
    ["Typical month: paychecks", formatMoney(recap.monthlyIncome)],
    ["Typical month: bills, subs, fees", formatMoney(recap.monthlyFixedCosts)],
  ].map(([label, value]) => `<div class="tile-row small"><span>${label}</span><span>${value}</span></div>`).join("");

  document.getElementById("page-track").innerHTML = `<h2>${monthName} recap</h2>
    <div class="tile">${recapRows}
      <div class="tile-row"><b>Typical month left over</b><b class="${recap.leftOver < 0 ? "negative" : "positive"}">${formatMoney(recap.leftOver)}</b></div>
      <div class="small">A dash means there is not a snapshot or score from both last month and this month yet. Typical month is an estimate from your paycheck and recurring bills, not real spending.</div></div>
    <h2>Net worth</h2>
    <div class="tile"><div class="small">Right now</div><div class="big-number">${formatMoney(netWorth(settings))}</div>
      <div class="small">Checking + savings + retirement + HSA, minus card balances. Car value and loan are not in it.</div>
      ${netWorthSparkline(history)}${historyRows(history, "net_worth", "net_worth_history", true, () => "")}</div>
    <button id="save-net-worth-button">Save today's snapshot</button>
    <h2>Credit score</h2>
    <div class="tile">${scores.length ? `<div class="big-number">${scores[scores.length - 1].score}</div>` : `<div class="small">No scores logged yet.</div>`}
      ${historyRows(scores, "score", "credit_scores", false, (entry) => (entry.source ? ` (${escapeHtml(entry.source)})` : ""))}</div>
    <button id="add-score-button">Log a score</button>`;
}

const URGENCY_WORDS = { overdue: "overdue", soon: "due soon", upcoming: "coming up", later: "later", none: "no date" };

function showTodoPage(settings) {
  const today = todayText();
  const tiles = sortedTodoItems(settings.todo_items).map((item) => {
    const { level, daysLeft } = item.done ? { level: "done", daysLeft: null } : dueUrgency(item.due_date, today);
    const countdown = daysLeft === null ? "" : daysLeft < 0 ? `${-daysLeft} days overdue` : daysLeft === 0 ? "due today" : `${daysLeft} days left`;
    return `<div class="tile todo-${level}">
      <div class="tile-row"><b class="${item.done ? "todo-finished" : ""}">${escapeHtml(item.name)}</b>
        <button class="remove-link" data-remove-todo="${item.position}">remove</button></div>
      <div class="tile-row small"><span class="editable" data-todo-date="${item.position}">${item.due_date ? formatDate(item.due_date) : "Tap to set a date"}</span><span>${item.done ? "done" : countdown}</span></div>
      <button class="small-button" data-toggle-todo="${item.position}">${item.done ? "Mark not done" : "Mark done"}</button></div>`;
  }).join("");
  document.getElementById("page-todo").innerHTML = `<h2>To do</h2>
    <div class="small legend"><span class="dot todo-dot-soon"></span>within 7 days or overdue <span class="dot todo-dot-upcoming"></span>within 30 days <span class="dot todo-dot-later"></span>later</div>
    ${tiles || `<div class="tile small">Nothing on the list.</div>`}
    <button id="add-todo-button">Add item</button>`;
}

// Opens the phone's own calendar picker. Resolves to "YYYY-MM-DD", null (clear the date), or undefined (cancelled).
function askForDate(question, currentDate) {
  return new Promise((resolve) => {
    const cover = document.createElement("div");
    cover.className = "date-cover";
    cover.innerHTML = `<div class="date-box"><div class="date-question"></div>
      <input type="date" class="date-input">
      <div class="date-buttons"><button data-date-cancel>Cancel</button><button data-date-clear>No date</button><button data-date-ok class="primary">Set</button></div></div>`;
    cover.querySelector(".date-question").textContent = question;
    const input = cover.querySelector(".date-input");
    input.value = currentDate || "";
    const finish = (value) => { cover.remove(); resolve(value); };
    cover.addEventListener("click", (event) => {
      if (event.target === cover || event.target.hasAttribute("data-date-cancel")) finish(undefined);
      else if (event.target.hasAttribute("data-date-clear")) finish(null);
      else if (event.target.hasAttribute("data-date-ok")) finish(input.value || undefined);
    });
    document.body.appendChild(cover);
  });
}

function showTrackingPages(settings) {
  showTodoPage(settings);
  showGoalsPage(settings);
  showTrackPage(settings);
}

document.addEventListener("click", async (event) => {
  const settings = loadSettings();
  if (!settings) return;
  if (event.target.id === "use-weekly-plan-button" || event.target.id === "make-weekly-plan-button") {
    settings.savings_plan = { weekly_amount: parseFloat(event.target.dataset.weekly) || 0 };
    delete document.getElementById("plan-weekly-amount").dataset.typed;
  } else if (event.target.id === "add-expected-in-button" || event.target.id === "add-expected-out-button") {
    const kind = event.target.id === "add-expected-out-button" ? "out" : "in";
    const date = await askForDate(kind === "out" ? "Date the money leaves?" : "Date the money arrives?", "");
    if (!date) return;
    const amount = parseFloat(prompt("Amount ($)"));
    if (!amount || amount <= 0) return;
    const label = prompt(kind === "out" ? "What is it for? (for example: tuition)" : "What is it? (for example: bonus)") || "";
    settings.expected_money = [...(settings.expected_money || []), { date, amount, kind, label }];
  } else if (event.target.closest("[data-remove-expected]")) {
    if (!confirm("Remove this item?")) return;
    settings.expected_money.splice(Number(event.target.closest("[data-remove-expected]").dataset.removeExpected), 1);
  } else if (event.target.id === "add-goal-button") {
    const name = prompt("Goal name (for example: Emergency fund)");
    if (!name) return;
    const target = parseFloat(prompt("Goal amount ($)"));
    if (!target || target <= 0) return;
    const saved = parseFloat(prompt("Already saved toward it ($)", "0")) || 0;
    settings.savings_goals.push({ name, target, saved });
  } else if (event.target.id === "add-todo-button") {
    const name = prompt("What do you need to do?");
    if (!name) return;
    const dueDate = await askForDate("Due date?", "");
    settings.todo_items.push({ name, due_date: dueDate === undefined ? null : dueDate, done: false });
  } else if (event.target.closest("[data-todo-date]")) {
    const item = settings.todo_items[Number(event.target.closest("[data-todo-date]").dataset.todoDate)];
    const newDate = await askForDate(`Due date for "${item.name}"?`, item.due_date);
    if (newDate === undefined) return;
    item.due_date = newDate;
  } else if (event.target.closest("[data-toggle-todo]")) {
    const item = settings.todo_items[Number(event.target.closest("[data-toggle-todo]").dataset.toggleTodo)];
    item.done = !item.done;
  } else if (event.target.closest("[data-remove-todo]")) {
    if (!confirm("Remove this item?")) return;
    settings.todo_items.splice(Number(event.target.closest("[data-remove-todo]").dataset.removeTodo), 1);
  } else if (event.target.closest("[data-remove-goal]")) {
    if (!confirm("Remove this goal?")) return;
    settings.savings_goals.splice(Number(event.target.closest("[data-remove-goal]").dataset.removeGoal), 1);
  } else if (event.target.id === "save-net-worth-button") {
    settings.net_worth_history = addEntryForDate(settings.net_worth_history, { date: todayText(), net_worth: netWorth(settings) });
  } else if (event.target.id === "add-score-button") {
    const score = parseInt(prompt("Credit score"), 10);
    if (!score || score < 300 || score > 850) return;
    const source = prompt("Where is it from? (optional, for example: Credit Karma)") || "";
    settings.credit_scores = addEntryForDate(settings.credit_scores, { date: todayText(), score, source });
  } else if (event.target.closest("[data-remove-entry]")) {
    const [listName, position] = event.target.closest("[data-remove-entry]").dataset.removeEntry.split(":");
    if (!confirm("Remove this entry?")) return;
    settings[listName].splice(Number(position), 1);
  } else {
    return;
  }
  saveSettings(settings);
  showEverything();
});
