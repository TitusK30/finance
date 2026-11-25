// Pure math for savings goals, history logs and the monthly recap.

function roundTrackedMoney(amount) {
  return Math.round(amount * 100) / 100;
}

function goalProgress(goal) {
  const percent = goal.target > 0 ? Math.min(100, Math.round((goal.saved / goal.target) * 100)) : 0;
  return { percent, remaining: Math.max(0, roundTrackedMoney(goal.target - goal.saved)) };
}

// One entry per date: saving twice on the same day replaces the first.
function addEntryForDate(entries, newEntry) {
  return [...entries.filter((entry) => entry.date !== newEntry.date), newEntry].sort((a, b) => a.date.localeCompare(b.date));
}

// Newest first, each with how much it moved since the entry before it.
function entriesWithChange(entries, valueKey) {
  return entries
    .map((entry, position) => ({ ...entry, change: position === 0 ? null : roundTrackedMoney(entry[valueKey] - entries[position - 1][valueKey]) }))
    .reverse();
}

function lastEntryInMonth(entries, yearMonth) {
  return [...entries].reverse().find((entry) => entry.date.slice(0, 7) === yearMonth) || null;
}

function lastEntryBeforeMonth(entries, yearMonth) {
  return [...entries].reverse().find((entry) => entry.date.slice(0, 7) < yearMonth) || null;
}

function changeDuringMonth(entries, valueKey, yearMonth) {
  const inMonth = lastEntryInMonth(entries, yearMonth);
  const before = lastEntryBeforeMonth(entries, yearMonth);
  if (!inMonth || !before) return null;
  return roundTrackedMoney(inMonth[valueKey] - before[valueKey]);
}

// How much to save each week to finish by a chosen date. Rounds up so the goal is really reached.
// Optional expectedMoney {date, amount}: money you know is coming (a bonus, a gift) before the finish date counts toward the goal.
function weeklySavingsNeeded(goal, todayDate, targetDate, expectedMoney) {
  const daysLeft = Math.round((new Date(targetDate + "T12:00:00") - new Date(todayDate + "T12:00:00")) / 86400000);
  if (daysLeft <= 0) return null;
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
  const { remaining: remainingBeforeExpected } = goalProgress(goal);
  const expectedCounts = Boolean(expectedMoney && expectedMoney.amount > 0 && expectedMoney.date > todayDate && expectedMoney.date <= targetDate);
  const expectedAmount = expectedCounts ? expectedMoney.amount : 0;
  const remaining = Math.max(0, roundTrackedMoney(remainingBeforeExpected - expectedAmount));
  const perWeek = Math.ceil((remaining / weeksLeft) * 100) / 100;
  return { weeksLeft, remaining, remainingBeforeExpected, expectedAmount, perWeek, perMonth: roundTrackedMoney((perWeek * 52) / 12) };
}

// To-do colors: red when overdue or due within a week, amber within a month, green after that.
function dueUrgency(dueDate, todayDate) {
  if (!dueDate) return { level: "none", daysLeft: null };
  const daysLeft = Math.round((new Date(dueDate + "T12:00:00Z") - new Date(todayDate + "T12:00:00Z")) / 86400000);
  const level = daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "soon" : daysLeft <= 30 ? "upcoming" : "later";
  return { level, daysLeft };
}

// Open items first (soonest date first, undated last), finished items at the bottom. Keeps each item's original position for editing.
function sortedTodoItems(items) {
  return items
    .map((item, position) => ({ ...item, position }))
    .sort((a, b) => (a.done - b.done) || ((a.due_date || "9999") < (b.due_date || "9999") ? -1 : (a.due_date || "9999") > (b.due_date || "9999") ? 1 : 0));
}

function monthlyRecap({ netWorthHistory, creditScores, goals, monthlyIncome, monthlyFixedCosts, yearMonth }) {
  return {
    netWorthChange: changeDuringMonth(netWorthHistory, "net_worth", yearMonth),
    creditScoreChange: changeDuringMonth(creditScores, "score", yearMonth),
    goalsSaved: roundTrackedMoney(goals.reduce((sum, goal) => sum + goal.saved, 0)),
    goalsTarget: roundTrackedMoney(goals.reduce((sum, goal) => sum + goal.target, 0)),
    monthlyIncome: roundTrackedMoney(monthlyIncome),
    monthlyFixedCosts: roundTrackedMoney(monthlyFixedCosts),
    leftOver: roundTrackedMoney(monthlyIncome - monthlyFixedCosts),
  };
}

if (typeof module !== "undefined") {
  module.exports = { goalProgress, weeklySavingsNeeded, dueUrgency, sortedTodoItems, addEntryForDate, entriesWithChange, changeDuringMonth, monthlyRecap };
}
