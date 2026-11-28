// Goals tab (savings goals) and Track tab (net worth history, credit score log, monthly recap).

function showGoalsPage(settings) {
  const savingsBalance = settings.starting_balances.savings_balance;
  const goals = goalsWithSaved(settings.savings_goals, savingsBalance);
  const followsSavings = goals.some((goal) => goal.tracks_savings);
  // A goal that follows savings holds the whole balance, so nothing is left unassigned.
  const setAside = followsSavings ? savingsBalance : goals.reduce((sum, goal) => sum + goal.saved, 0);
  const notAssigned = followsSavings ? 0 : Math.round((savingsBalance - setAside) * 100) / 100;
  const setAsideShare = savingsBalance > 0 ? Math.max(0, Math.min(100, Math.round((setAside / savingsBalance) * 100))) : 0;
  const tiles = goals.map((goal, position) => {
    const { percent, remaining } = goalProgress(goal);
    const savedText = goal.tracks_savings ? formatMoney(goal.saved) : editableNumber(`savings_goals.${position}.saved`, goal.name + ": saved so far ($)", goal.saved, true);
    return `<div class="tile goal-tile" data-item-hold="goal:${position}"><div class="tile-row"><b class="goal-name">${escapeHtml(goal.name)}</b><span class="goal-percent">${percent}%</span>
        <button class="remove-link" data-remove-goal="${position}">remove</button></div>
      <div class="goal-amounts"><span class="goal-saved">${savedText}</span>
        <span class="small">of ${editableNumber(`savings_goals.${position}.target`, goal.name + ": goal amount ($)", goal.target, true)}</span></div>
      <div class="bar goal-bar"><div class="bar-fill" style="width:${percent}%"></div></div>
      <div class="tile-row small"><span>${percent}% there, ${formatMoney(remaining)} to go</span>
        <button class="goal-mode" data-toggle-goal-tracking="${position}">${goal.tracks_savings ? "Follows my savings" : "Separate tally"}</button></div></div>`;
  }).join("");
  document.getElementById("goals-list").innerHTML = `<h2>Savings goals</h2>
    <div class="tile savings-hero"><div class="small">In savings</div><div class="huge-number">${formatMoney(savingsBalance)}</div>
      <div class="payer-bar"><div class="seg" style="width:${setAsideShare}%;background:var(--accent)"></div></div>
      <div class="tile-row small"><span><span class="dot" style="background:var(--accent)"></span>Set aside for goals</span><span>${formatMoney(setAside)}</span></div>
      <div class="tile-row small"><span><span class="dot" style="background:var(--bar-track)"></span>Not assigned to a goal</span><span class="${notAssigned < 0 ? "negative" : ""}">${formatMoney(notAssigned)}</span></div>
      ${notAssigned < 0 ? `<div class="small negative">Your goals add up to more than what is in savings.</div>` : ""}</div>
    ${tiles || `<div class="tile small">No goals yet.</div>`}
    <button id="add-goal-button">Add goal</button>`;
  showExpectedMoney(settings);
  showGoalDatePlanner(settings);
  showWhatIfSaving(settings);
}

// One row per listed amount that counts (green = reaches savings, red = leaves), plus a note for any that do not count.
function expectedMoneyRows(expected) {
  const row = (item, isOut) => `<div class="tile-row small"><span>${escapeHtml(item.label || (isOut ? "Money going out" : "Money coming in"))}, ${formatDate(item.date)}</span><span class="${isOut ? "negative" : "positive"}">${isOut ? "-" : "+"}${formatMoney(item.amount)}</span></div>`;
  const skippedNote = expected.skipped.length
    ? `<div class="small warning">Not counted: ${expected.skipped.map((item) => `${escapeHtml(item.label || "an item")} (${item.reason})`).join(", ")}.</div>` : "";
  return expected.inItems.map((item) => row(item, false)).join("") + expected.outItems.map((item) => row(item, true)).join("") + skippedNote;
}

// "If I save $X a week for N weeks, what will savings be?" Counts the money you listed as coming in.
function showWhatIfSaving(settings) {
  const weeklyBox = document.getElementById("plan-weekly-amount");
  const resultBox = document.getElementById("plan-what-if-result");
  const weeklyAmount = parseFloat(weeklyBox.value) || 0;
  const endDate = document.getElementById("plan-end-date").value;
  if (weeklyAmount <= 0 || !endDate) { resultBox.innerHTML = ""; return; }
  const goal = goalsWithSaved(settings.savings_goals, settings.starting_balances.savings_balance)[document.getElementById("goal-plan-goal").value];
  const result = savingsUntilDate(settings.starting_balances.savings_balance, weeklyAmount, endDate, todayText(), settings.expected_money, goal);
  if (!result) { resultBox.innerHTML = `<div class="tile warning">Pick a date after today.</div>`; return; }
  const weeks = result.weeks;
  resultBox.innerHTML = `<div class="tile result-hero"><div class="small">By ${formatDate(result.endDate)} &middot; ${weeks} week${weeks === 1 ? "" : "s"}, savings would be</div>
    <div class="big-number">${formatMoney(result.finalBalance)}</div>
    ${goal && result.goalPercent !== null ? `<div class="result-goal"><div class="bar goal-bar"><div class="bar-fill" style="width:${Math.min(100, result.goalPercent)}%"></div></div><div class="small">${result.goalPercent}% of ${escapeHtml(goal.name)}</div></div>` : ""}
    <div class="result-rows"><div class="tile-row small"><span>Savings today</span><span>${formatMoney(settings.starting_balances.savings_balance)}</span></div>
    <div class="tile-row small"><span>${formatMoney(weeklyAmount)} x ${weeks} weeks</span><span class="positive">+${formatMoney(result.fromSaving)}</span></div>
    ${expectedMoneyRows(result.expected)}</div></div>`;
}

// The list of money you know is coming in (goes to savings) or going out (leaves checking).
function showExpectedMoney(settings) {
  const items = (settings.expected_money || []).map((item, position) => ({ ...item, position })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const rows = items.map((item) => {
    const isOut = item.kind === "out";
    return `<div class="tile expected-tile ${isOut ? "expected-out" : "expected-in"}" data-item-hold="expected:${item.position}"><span class="timeline-icon ${isOut ? "timeline-out" : "timeline-in"}">${isOut ? "&#8595;" : "&#8593;"}</span>
      <div class="expected-body"><b>${escapeHtml(item.label || (isOut ? "Money going out" : "Money coming in"))}</b>
        <div class="small">${formatDate(item.date)}${isOut ? " (out of checking)" : " (into savings)"}${item.date <= todayText() ? " - date has passed, not counted" : ""}</div></div>
      <b class="${isOut ? "negative" : "positive"}">${isOut ? "-" : "+"}${formatMoney(item.amount)}</b>
      <button class="remove-link" data-remove-expected="${item.position}">remove</button></div>`;
  }).join("");
  document.getElementById("expected-money-list").innerHTML = `${rows || `<div class="tile small">Nothing listed. Add a bonus, gift, tuition or any amount with a known date.</div>`}
    <div class="expected-buttons"><button id="add-expected-in-button">Add money coming in</button><button id="add-expected-out-button">Add money going out</button></div>`;
}

for (const inputId of ["plan-weekly-amount", "plan-end-date"]) {
  document.getElementById(inputId).addEventListener("input", () => {
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
  const goal = goalsWithSaved(settings.savings_goals, settings.starting_balances.savings_balance)[goalMenu.value];
  const targetDate = document.getElementById("goal-plan-date").value;
  if (!goal) { resultBox.innerHTML = `<div class="small">Add a goal first.</div>`; return; }
  if (!targetDate) { resultBox.innerHTML = ""; return; }
  const plan = weeklySavingsNeeded(goal, todayText(), targetDate, settings.expected_money);
  if (!plan) { resultBox.innerHTML = `<div class="tile warning">Pick a date after today.</div>`; return; }
  const paycheck = settings.paycheck.usual_take_home_amount;
  const percentOfPaycheck = Math.round(((plan.perWeek * 52) / paychecksPerYear(settings.paycheck) / paycheck) * 100);
  const expectedLines = expectedMoneyRows(plan.expected);
  const hasListedMoney = plan.expected.inItems.length + plan.expected.outItems.length > 0;
  resultBox.innerHTML = plan.remaining === 0
    ? `<div class="tile result-hero"><b>${escapeHtml(goal.name)} ${hasListedMoney ? "is covered by the money you listed. Nothing to save each week." : "is already fully funded."}</b>${expectedLines}</div>`
    : `<div class="tile result-hero"><div class="small">To finish ${escapeHtml(goal.name)} by ${formatDate(targetDate)}, save</div>
      <div class="big-number">${formatMoney(plan.perWeek)}<span class="per-week"> a week</span></div>
      <div class="result-stats"><div><b>${formatMoney(plan.perMonth)}</b><span class="small">per month</span></div><div><b>${plan.weeksLeft}</b><span class="small">weeks left</span></div><div><b>${percentOfPaycheck}%</b><span class="small">of a ${formatMoney(paycheck)} check</span></div></div>
      <div class="result-rows"><div class="tile-row small"><span>Left to reach the goal</span><span>${formatMoney(plan.remainingBeforeExpected)}</span></div>${expectedLines}
      <div class="tile-row small"><span>To save</span><span>${formatMoney(plan.remaining)}</span></div></div></div>`;
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
  return `<svg class="net-spark" viewBox="0 0 300 60" width="100%" height="70" preserveAspectRatio="none"><defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><polygon points="0,60 ${points} 300,60" fill="url(#spark-fill)"/><polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
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

// The latest credit score on Home. Tap the number to log a new one; open the tile for one entry per month (the last log of that month).
function showCreditScoreTile(settings) {
  const scores = settings.credit_scores;
  const latest = scores[scores.length - 1];
  const band = !latest ? "" : latest.score >= 740 ? "score-great" : latest.score >= 670 ? "score-good" : "score-low";
  const lastLogOfMonth = {};
  for (const entry of [...scores].sort((a, b) => (a.date < b.date ? -1 : 1))) lastLogOfMonth[entry.date.slice(0, 7)] = entry;
  const months = Object.keys(lastLogOfMonth).sort().reverse();
  const monthRows = months.map((month, position) => {
    const entry = lastLogOfMonth[month];
    const earlier = lastLogOfMonth[months[position + 1]];
    const monthName = new Date(month + "-15T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    return `<div class="tile-row small"><span>${monthName}${entry.source ? ` (${escapeHtml(entry.source)})` : ""}</span><span>${entry.score} ${earlier ? changeText(entry.score - earlier.score, false) : ""}</span></div>`;
  }).join("");
  document.getElementById("credit-score-tile").innerHTML = `<details class="tile score-home ${band}"><summary>
    <div><div class="small">Credit score &middot; tap the number to log a new one</div>
      <button id="add-score-button" class="score-number">${latest ? latest.score : "Log a score"}</button>
      ${latest ? `<div class="small">${latest.source ? escapeHtml(latest.source) + " &middot; " : ""}${formatDate(latest.date)}</div>` : ""}</div>
    ${months.length ? `<span class="score-chevron">&#9662;</span>` : ""}</summary>
    ${months.length ? `<div class="score-history">${monthRows}</div>` : ""}</details>`;
}

const URGENCY_WORDS = { overdue: "overdue", soon: "due soon", upcoming: "coming up", later: "later", none: "no date" };

function showTodoPage(settings) {
  const today = todayText();
  const tiles = sortedTodoItems(settings.todo_items).map((item) => {
    const { level, daysLeft } = item.done ? { level: "done", daysLeft: null } : dueUrgency(item.due_date, today);
    const countdown = daysLeft === null ? "" : daysLeft < 0 ? `${-daysLeft} days overdue` : daysLeft === 0 ? "due today" : `${daysLeft} days left`;
    return `<div class="tile todo-tile todo-${level}" data-item-hold="todo:${item.position}">
      <button class="todo-check ${item.done ? "is-done" : ""}" data-toggle-todo="${item.position}" aria-label="${item.done ? "Mark not done" : "Mark done"}"><span>&#10003;</span></button>
      <div class="todo-body"><b class="todo-name ${item.done ? "todo-finished" : ""}">${escapeHtml(item.name)}</b>
        <div class="todo-meta"><span class="todo-date editable" data-todo-date="${item.position}">${item.due_date ? formatDate(item.due_date) : "Tap to set a date"}</span>
          ${item.done ? `<span class="todo-pill">done</span>` : countdown ? `<span class="todo-pill">${countdown}</span>` : ""}</div></div>
      <button class="remove-link" data-remove-todo="${item.position}">remove</button></div>`;
  }).join("");
  document.getElementById("page-todo").innerHTML = `<h2>To do</h2>
    <div class="small legend"><span class="legend-pill"><span class="dot todo-dot-soon"></span>within 7 days or overdue</span><span class="legend-pill"><span class="dot todo-dot-upcoming"></span>within 30 days</span><span class="legend-pill"><span class="dot todo-dot-later"></span>later</span></div>
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

// A pop-up with a question and buttons whose labels say what they do. Resolves with the chosen value (or undefined if dismissed).
function askChoice(question, choices, extraClass = "") {
  return new Promise((resolve) => {
    const cover = document.createElement("div");
    cover.className = "date-cover " + extraClass;
    cover.innerHTML = `<div class="date-box"><div class="date-question"></div><div class="choice-list">${choices.map((choice, position) =>
      `<button class="choice-button${choice.current ? " is-current" : ""}${choice.wide ? " is-wide" : ""}" data-choice="${position}" ${choice.color ? `style="--dot:${choice.color}"` : ""}>${choice.color ? '<i class="choice-dot"></i>' : ""}<b>${escapeHtml(choice.title)}</b><span class="small">${escapeHtml(choice.detail)}</span></button>`).join("")}</div></div>`;
    cover.querySelector(".date-question").textContent = question;
    cover.addEventListener("click", (event) => {
      const button = event.target.closest("[data-choice]");
      if (button) { cover.remove(); resolve(choices[Number(button.dataset.choice)].value); }
      else if (event.target === cover) { cover.remove(); resolve(undefined); }
    });
    document.body.appendChild(cover);
  });
}

function showTrackingPages(settings) {
  showTodoPage(settings);
  showGoalsPage(settings);
  showCreditScoreTile(settings);
}

// Ticking a task off: the circle fills and the name is struck through first, then the task moves to done.
document.addEventListener("click", (event) => {
  const checkButton = event.target.closest(".todo-check");
  if (!checkButton || checkButton.classList.contains("is-done") || checkButton.dataset.ticked) return;
  event.stopPropagation();
  checkButton.dataset.ticked = "yes";
  checkButton.closest(".todo-tile").classList.add("todo-ticking");
  setTimeout(() => checkButton.click(), 380);
}, true);

document.addEventListener("click", async (event) => {
  const settings = loadSettings();
  if (!settings) return;
  if (event.target.id === "add-expected-in-button" || event.target.id === "add-expected-out-button") {
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
    const tally = await askChoice("How should this goal count what you've saved?", [
      { title: "Follow my savings account", detail: "Saved amount always equals your savings balance", value: "follow" },
      { title: "Keep its own tally", detail: "You type in how much is saved toward it", value: "separate" },
    ]);
    if (!tally) return;
    if (tally === "follow") {
      settings.savings_goals.push({ name, target, saved: settings.starting_balances.savings_balance, tracks_savings: true });
    } else {
      const saved = parseFloat(prompt("Already saved toward it ($)", "0")) || 0;
      settings.savings_goals.push({ name, target, saved });
    }
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
  } else if (event.target.closest("[data-toggle-goal-tracking]")) {
    const goal = settings.savings_goals[Number(event.target.closest("[data-toggle-goal-tracking]").dataset.toggleGoalTracking)];
    // Switching to a separate tally keeps today's amount, so the number does not jump.
    if (goal.tracks_savings) { goal.saved = settings.starting_balances.savings_balance; goal.tracks_savings = false; } else { goal.tracks_savings = true; }
  } else if (event.target.closest("[data-remove-goal]")) {
    if (!confirm("Remove this goal?")) return;
    settings.savings_goals.splice(Number(event.target.closest("[data-remove-goal]").dataset.removeGoal), 1);
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

// Hold a task, a goal or a "money coming in or going out" item to edit it in a sheet (the same sheet Set up uses).
// holdKey is "kind:position", for example "todo:2".
function editTrackedItem(holdKey) {
  const [kind, positionText] = holdKey.split(":");
  const position = Number(positionText);
  const settings = loadSettings();
  if (!settings) return;
  const editors = {
    todo: (task = settings.todo_items[position]) => ({
      title: "Edit task",
      fields: [{ id: "name", label: "Task", value: task.name }, { id: "date", label: "Due date (optional)", type: "date", value: task.due_date || "" }],
      save: (values) => {
        if (!values.name) return "Give the task a name.";
        settings.todo_items[position] = { ...task, name: values.name, due_date: values.date || null };
      },
    }),
    goal: (goal = settings.savings_goals[position]) => ({
      title: "Edit goal",
      fields: [{ id: "name", label: "Goal name", value: goal.name }, { id: "target", label: "Goal amount ($)", isMoney: true, value: goal.target },
        ...(goal.tracks_savings ? [] : [{ id: "saved", label: "Saved so far ($)", isMoney: true, value: goal.saved || 0 }])],
      save: (values) => {
        if (!values.name || !(values.target > 0)) return "Give the goal a name and an amount more than 0.";
        const updated = { ...goal, name: values.name, target: values.target };
        if (!goal.tracks_savings) updated.saved = values.saved >= 0 ? values.saved : 0;
        settings.savings_goals[position] = updated;
      },
    }),
    expected: (item = settings.expected_money[position]) => ({
      title: "Edit expected money",
      fields: [{ id: "label", label: "What is it (optional)", value: item.label || "" },
        { id: "kind", label: "Direction", options: [["in", "Coming in (into savings)"], ["out", "Going out (out of checking)"]], value: item.kind === "out" ? "out" : "in" },
        { id: "date", label: "Date", type: "date", value: item.date }, { id: "amount", label: "Amount ($)", isMoney: true, value: item.amount }],
      save: (values) => {
        if (!values.date || !(values.amount > 0)) return "Pick a date and an amount more than 0.";
        settings.expected_money[position] = { ...item, label: values.label, kind: values.kind, date: values.date, amount: values.amount };
      },
    }),
  };
  if (!editors[kind]) return;
  openSetupItemSheet(editors[kind](), () => saveAndRefresh(settings));
}
