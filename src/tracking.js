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

// Your listed money between today and endDate. Coming in adds to savings; going out is money that will not reach savings.
// Items dated in the past or after endDate are not counted, and come back in `skipped` so the screen can say so.
function expectedMoneyBetween(items, todayDate, endDate) {
  const real = (items || []).filter((item) => item.amount > 0);
  const counted = real.filter((item) => item.date > todayDate && item.date <= endDate);
  const skipped = real.filter((item) => !(item.date > todayDate && item.date <= endDate)).map((item) => ({ ...item, reason: item.date <= todayDate ? "date has passed" : "after the end date" }));
  const inItems = counted.filter((item) => item.kind !== "out");
  const outItems = counted.filter((item) => item.kind === "out");
  const sumOf = (list) => roundTrackedMoney(list.reduce((sum, item) => sum + item.amount, 0));
  return { inItems, outItems, skipped, totalIn: sumOf(inItems), totalOut: sumOf(outItems) };
}

// How much to save each week to finish by a chosen date. Rounds up so the goal is really reached.
// Money you list as coming in lowers what is left to save; money going out raises it.
function weeklySavingsNeeded(goal, todayDate, targetDate, expectedMoney) {
  const daysLeft = Math.round((new Date(targetDate + "T12:00:00") - new Date(todayDate + "T12:00:00")) / 86400000);
  if (daysLeft <= 0) return null;
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
  const { remaining: remainingBeforeExpected } = goalProgress(goal);
  const expected = expectedMoneyBetween(expectedMoney, todayDate, targetDate);
  const remaining = Math.max(0, roundTrackedMoney(remainingBeforeExpected - expected.totalIn + expected.totalOut));
  const perWeek = Math.ceil((remaining / weeksLeft) * 100) / 100;
  return { weeksLeft, remaining, remainingBeforeExpected, expected, perWeek, perMonth: roundTrackedMoney((perWeek * 52) / 12) };
}

// "If I save this much a week until this date, what will savings be?" Money coming in is added and money going out is subtracted.
// Part of a week counts as a whole week, the same as the finish-by-a-date plan.
function savingsUntilDate(startingSavings, weeklyAmount, endDate, todayDate, expectedMoney, goal) {
  const daysLeft = Math.round((new Date(endDate + "T12:00:00Z") - new Date(todayDate + "T12:00:00Z")) / 86400000);
  if (daysLeft <= 0) return null;
  const weeks = Math.max(1, Math.ceil(daysLeft / 7));
  const expected = expectedMoneyBetween(expectedMoney, todayDate, endDate);
  const fromSaving = roundTrackedMoney(weeklyAmount * weeks);
  const net = roundTrackedMoney(expected.totalIn - expected.totalOut);
  const finalBalance = roundTrackedMoney(startingSavings + fromSaving + net);
  const goalPercent = goal && goal.target > 0 ? Math.max(0, Math.min(100, Math.round(((goal.saved + fromSaving + net) / goal.target) * 100))) : null;
  return { endDate, weeks, fromSaving, expected, finalBalance, goalPercent };
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
  module.exports = { expectedMoneyBetween, goalProgress, weeklySavingsNeeded, savingsUntilDate, dueUrgency, sortedTodoItems, addEntryForDate, entriesWithChange, changeDuringMonth, monthlyRecap };
}
