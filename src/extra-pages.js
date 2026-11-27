// Tab bar, plus the Subscriptions, Rewards and HSA pages. Taps on dotted numbers edit them.

const PAGE_NAMES = ["home", "planner", "bills", "cards", "spending", "car", "goals", "hsa", "pto", "todo", "setup", "settings"];

const DEFAULT_EXTRA_SETTINGS = {
  rewards: {},
  hidden_tabs: [],
  card_benefits: [],
  card_expirations: {},
  annual_card_fees: [],
  other_cards: [],
  car_loan: null,
  todo_items: [],
  savings_goals: [],
  net_worth_history: [],
  credit_scores: [],
  retirement: { balance: null },
  overtime: { gross_hourly_rate: null, take_home_per_overtime_hour: null, paid_days_after_period_ends: 7 },
  pto: { pto_hours: null, comp_time_hours: null, holiday_hours: null },
  credit_utilization: { target_percent: 9 },
  hsa: { provider: "", balance: null, weekly_contribution: null, monthly_bill_payment: null, medical_bill_remaining: null },
};

// Old saved data on the phone has none of this yet, so fill in the blanks.
function addMissingExtraSettings(settings) {
  for (const sectionName of Object.keys(DEFAULT_EXTRA_SETTINGS)) {
    if (!settings[sectionName]) settings[sectionName] = structuredClone(DEFAULT_EXTRA_SETTINGS[sectionName]);
  }
  for (const cardKey of Object.keys(settings.credit_cards)) {
    settings.rewards[cardKey] = settings.rewards[cardKey] || { program: "Points", points_balance: null };
  }
  return settings;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

// A number you can tap to change. Empty means "not set yet".
function editableNumber(path, label, value, isMoney) {
  const shown = value == null ? "Tap to set" : isMoney ? formatMoney(value) : value.toLocaleString("en-US");
  return `<span class="editable" data-edit-path="${path}" data-edit-label="${escapeHtml(label)}">${shown}</span>`;
}

function showPage(pageName) {
  for (const name of PAGE_NAMES) {
    document.getElementById("page-" + name).hidden = name !== pageName;
    document.getElementById("tab-" + name).classList.toggle("active-tab", name === pageName);
  }
  document.getElementById("apply-top-button").hidden = pageName !== "setup";
  const tabLabel = document.getElementById("tab-" + pageName).dataset.title;
  document.getElementById("page-title").textContent = pageName === "home" ? "Finance OS" : tabLabel;
  setMenuOpen(false);
  window.scrollTo(0, 0);
}

function setMenuOpen(shouldBeOpen) {
  document.getElementById("side-menu").classList.toggle("open", shouldBeOpen);
  document.getElementById("menu-overlay").hidden = !shouldBeOpen;
}

document.getElementById("menu-button").addEventListener("click", () => setMenuOpen(true));

// Swipe right from the left edge to open the menu, swipe left to close it.
let swipeStart = null;
document.addEventListener("touchstart", (event) => { swipeStart = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }, { passive: true });
document.addEventListener("touchend", (event) => {
  if (!swipeStart) return;
  const sideways = event.changedTouches[0].clientX - swipeStart.x;
  const upDown = Math.abs(event.changedTouches[0].clientY - swipeStart.y);
  const menuIsOpen = document.getElementById("side-menu").classList.contains("open");
  if (!menuIsOpen && swipeStart.x < 30 && sideways > 60 && upDown < 50) setMenuOpen(true);
  else if (menuIsOpen && sideways < -60 && upDown < 50) setMenuOpen(false);
  swipeStart = null;
}, { passive: true });
document.getElementById("menu-overlay").addEventListener("click", () => setMenuOpen(false));

function payerName(settings, paidFrom) {
  return paidFrom === "checking" ? "Checking" : settings.credit_cards[paidFrom].display_name;
}

// Checking is slate; each card keeps the color it has on the Cards tab.
function payerColor(settings, paidFrom) {
  if (paidFrom === "checking") return "#94a3b8";
  const cardPosition = Math.max(0, Object.keys(settings.credit_cards).indexOf(paidFrom));
  return REWARD_COLORS[cardPosition % REWARD_COLORS.length];
}

function showMonthlyItemsPage(settings, tabName, pageTitle) {
  const items = monthlyItemsForTab(settings, tabName);
  const { monthlyTotal, totalsByPayer } = totalsForItems(items);
  const rows = items
    .map((item) => {
      const verb = item.paidFrom === "checking" ? "paid" : "charged";
      const whenText = item.refillsPerMonth ? `about ${item.refillsPerMonth}x a month, ${formatMoney(item.amountEach)} each` : `${verb} on the ${item.dayOfMonth}${ordinalEnding(item.dayOfMonth)}`;
      const amountText = `${formatMoney(item.monthlyAmount)} / month${item.isEstimate ? " (est.)" : ""}`;
      return `<div class="tile bill-tile" style="--tile-accent:${payerColor(settings, item.paidFrom)}"><div class="tile-row"><b>${escapeHtml(item.name)}</b><b>${amountText}</b></div>
        <div class="tile-row small"><span>${payerName(settings, item.paidFrom)}</span><span>${whenText}</span></div></div>`;
    }).join("");
  const payerEntries = Object.entries(totalsByPayer).sort();
  const payerBar = `<div class="payer-bar">${payerEntries.map(([paidFrom, total]) => `<div class="seg" style="width:${monthlyTotal > 0 ? (total / monthlyTotal) * 100 : 0}%;background:${payerColor(settings, paidFrom)}"></div>`).join("")}</div>`;
  const payerTotals = payerEntries.map(([paidFrom, total]) =>
    `<div class="tile-row small"><span><span class="dot" style="background:${payerColor(settings, paidFrom)}"></span>${payerName(settings, paidFrom)}</span><span>${formatMoney(total)}</span></div>`).join("");
  document.getElementById("page-" + tabName).innerHTML = `<h2>${pageTitle}</h2>
    <div class="tile bills-total-tile"><div class="small">Total per month</div><div class="huge-number">${formatMoney(monthlyTotal)}</div>${payerBar}${payerTotals}</div>${rows}`;
}

function ordinalEnding(dayNumber) {
  if (dayNumber % 100 >= 11 && dayNumber % 100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[dayNumber % 10] || "th";
}

const REWARD_COLORS = ["#5aa2ff", "#4ade80", "#a78bfa", "#fb923c", "#f472b6", "#2dd4bf"];

function showRewardsPage(settings) {
  const cardKeys = Object.keys(settings.credit_cards);
  const colorOf = (cardKey) => REWARD_COLORS[Math.max(0, cardKeys.indexOf(cardKey)) % REWARD_COLORS.length];
  const pointTiles = Object.entries(settings.credit_cards).map(([cardKey, card]) => {
    const reward = settings.rewards[cardKey];
    return `<div class="tile rewards-tile points-tile" style="--tile-accent:${colorOf(cardKey)}"><div><b>${card.display_name}</b><div class="small">${escapeHtml(reward.program)}</div></div>
      <b class="points-number">${editableNumber(`rewards.${cardKey}.points_balance`, card.display_name + " balance", reward.points_balance, false)}</b></div>`;
  }).join("");
  const benefitTiles = settings.card_benefits.map((benefit, position) => {
    const remaining = benefitRemaining(benefit);
    const percentUsed = Math.min(100, Math.round(((benefit.used || 0) / benefit.total) * 100));
    return `<div class="tile rewards-tile benefit-tile" style="--tile-accent:${colorOf(benefit.card)}"><div class="tile-row"><b>${escapeHtml(benefit.name)}</b><b class="benefit-left">${formatMoney(remaining)} left</b></div>
      <div class="bar benefit-bar"><div class="bar-fill" style="width:${percentUsed}%"></div></div>
      <div class="tile-row small"><span>${settings.credit_cards[benefit.card].display_name}</span>
        <span>used ${editableNumber(`card_benefits.${position}.used`, benefit.name + ": amount used", benefit.used || 0, true)} of ${editableNumber(`card_benefits.${position}.total`, benefit.name + ": total credit", benefit.total, true)}</span></div>
      <button class="remove-link" data-remove-benefit="${position}">remove</button></div>`;
  }).join("");
  document.getElementById("page-rewards").innerHTML = `<h2>Points</h2>${pointTiles}<h2>Card benefits</h2>${benefitTiles}
    <button id="add-benefit-button">Add benefit</button>`;
}

function expiryText(expiresMonth, settings) {
  if (!expiresMonth) return "";
  const status = cardExpiryStatus(expiresMonth, settings.starting_balances.as_of_date);
  const monthsLeft = Math.floor(status.daysLeft / 30.4);
  const timeLeft = status.daysLeft < 0 ? "expired" : status.daysLeft <= 90 ? `${status.daysLeft}d` : `${monthsLeft} mo`;
  return `<span class="${status.isExpiringSoon ? "negative" : ""}">Expires ${status.label} \u00b7 ${timeLeft}</span>`;
}

function annualFeeText(settings, cardKey) {
  const fee = nextAnnualFeeFor(settings, cardKey);
  if (!fee) return "No annual fee";
  const shortDate = new Date(fee.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${editableNumber(`annual_card_fees.${fee.feePosition}.amount`, "Annual fee ($)", fee.amount, true)} fee \u00b7 ${shortDate} (${fee.daysUntil}d)`;
}

// Big numbers: what is on statements that already closed, and what is on the statement still open.
function closedAndOpenBlocks(card) {
  const closed = card.balances_by_statement.filter((statement) => !statement.still_accumulating);
  const open = card.balances_by_statement.filter((statement) => statement.still_accumulating);
  const pendingAmount = pendingAmountOnCard(card);
  const blockFor = (label, statements, pendingExtra) => {
    // Pending charges are inside the open statement's amount, so the big number shows what is posted and pending sits under it.
    const total = statements.reduce((sum, statement) => sum + statement.amount, 0) - pendingExtra;
    const dueText = statements.length ? `due ${shortMonthDay(statements[0].due_date)}` : "nothing due";
    const pendingText = pendingExtra > 0 ? `<div class="small amber-text">+${formatMoney(pendingExtra)} pending</div>` : "";
    return `<div><div class="stat-label">${label}</div><div class="big-number">${formatMoney(total)}</div><div class="small">${dueText}</div>${pendingText}</div>`;
  };
  return `<div class="big-pair">${blockFor("Closed", closed, 0)}${blockFor("Open", open, pendingAmount)}</div>`;
}

// The pending charges behind a card's pending amount, when the bank shares them.
function pendingDetailsHtml(settings, cardKey) {
  const card = settings.credit_cards[cardKey];
  const pendingAmount = pendingAmountOnCard(card);
  if (pendingAmount <= 0) return "";
  const store = loadTransactionStore();
  const listed = pendingChargesForCard(store, settings, cardKey);
  if (listed.length === 0) return `<div class="small">Pending charges are counted in this card's open amount. The bank does not share the details.</div>`;
  return `<details class="pending-details"><summary class="small">${listed.length} pending charge${listed.length === 1 ? "" : "s"}, counted in open</summary>${listed.map((charge) => chargeRowHtml(settings, store, charge)).join("")}</details>`;
}

function shortMonthDay(dateText) {
  return new Date(dateText + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function showCreditPage(settings) {
  const targetPercent = settings.credit_utilization.target_percent;
  const cardTiles = Object.entries(settings.credit_cards).map(([cardKey, card]) => {
    const plan = cardUtilizationPlan(settings, cardKey, targetPercent);
    const barWidth = Math.min(100, Math.round((plan.projectedPercent / Math.max(targetPercent * 2, 1)) * 100));
    const verdict = plan.payDownNeeded > 0
      ? `<span class="negative">Pay ${formatMoney(plan.payDownNeeded)} by ${shortMonthDay(plan.closeDate)}</span>`
      : `<span class="positive">${formatMoney(plan.spendRoom)} room before ${shortMonthDay(plan.closeDate)}</span>`;
    const percentClass = plan.projectedPercent <= targetPercent ? "positive" : "negative";
    const estimateMark = plan.openBalanceIsGuess ? " est." : "";
    const cardColor = REWARD_COLORS[Math.max(0, Object.keys(settings.credit_cards).indexOf(cardKey)) % REWARD_COLORS.length];
    return `<div class="tile credit-tile" style="--tile-accent:${cardColor}"><div class="tile-row"><b>${card.display_name}</b><b class="percent-badge ${percentClass}">${plan.projectedPercent}%</b></div>
      <div class="bar target-bar ${percentClass === "positive" ? "bar-ok" : "bar-over"}"><div class="bar-fill" style="width:${barWidth}%"></div></div>
      ${closedAndOpenBlocks(card)}
      ${pendingDetailsHtml(settings, cardKey)}
      <div class="verdict ${plan.payDownNeeded > 0 ? "verdict-bad" : "verdict-good"}">${verdict}</div>
      <div class="stat-grid">
        <div><div class="stat-label">Plus subs</div>${formatMoney(plan.projectedStatement)}${estimateMark}</div>
        <div><div class="stat-label">Closes</div>${plan.daysUntilClose} days</div>
        <div><div class="stat-label">${targetPercent}% spend</div>${formatMoney(plan.targetAmount)}</div></div>
      <div class="tile-row small card-facts"><span>${expiryText(settings.card_expirations[cardKey], settings)}</span><span>${annualFeeText(settings, cardKey)}</span></div></div>`;
  }).join("");
  const otherCardRows = settings.other_cards.map((otherCard) =>
    `<div class="other-card-row"><span class="mini-card"></span><span class="other-card-name">${escapeHtml(otherCard.name)}</span><span class="other-card-expiry">${expiryText(otherCard.expires, settings)}</span></div>`).join("");
  const otherCardsTile = `<div class="tile other-cards-tile"><b>Other cards</b>${otherCardRows}
    <div class="other-fees"><span>Annual fees across all cards</span><b>${formatMoney(totalAnnualFees(settings))} / year</b></div></div>`;
  const noCardsYet = Object.keys(settings.credit_cards).length === 0 ? `<div class="tile small">No credit cards yet. Add them in Settings → Set up in the app.</div>` : "";
  document.getElementById("page-credit").innerHTML = `<h2>Credit utilization</h2>${noCardsYet}${cardTiles}${otherCardsTile}`;
}

let hsaMessage = ""; // one-time confirmation shown after adding money to the list
let hsaFormOpen = false;

// The money you listed: each row shows what the HSA holds right after it. Swipe a row to delete it.
function hsaExpectedHtml(hsa) {
  const today = todayText();
  const items = (hsa.expected_items || []).map((item, position) => ({ ...item, position })).sort((a, b) => (a.date < b.date ? -1 : 1));
  let running = hsa.balance || 0;
  const rows = items.map((item) => {
    const isOut = item.kind === "out";
    const counted = item.date > today;
    if (counted) running = Math.round((running + (isOut ? -item.amount : item.amount)) * 100) / 100;
    return `<div class="tile expected-tile ${isOut ? "expected-out" : "expected-in"}"><span class="timeline-icon ${isOut ? "timeline-out" : "timeline-in"}">${isOut ? "&#8595;" : "&#8593;"}</span>
      <div class="expected-body"><b>${escapeHtml(item.label || (isOut ? "Money going out" : "Money coming in"))}</b>
        <div class="small">${shortMonthDay(item.date)}${counted ? ` \u00b7 HSA then ${formatMoney(running)}` : " \u00b7 date has passed, not counted"}</div></div>
      <b class="${isOut ? "negative" : "positive"}">${isOut ? "-" : "+"}${formatMoney(item.amount)}</b>
      <button class="remove-link" data-remove-hsa-item="${item.position}">remove</button></div>`;
  }).join("");
  const totals = hsaExpectedBetween(hsa, today, "9999-12-31");
  const summary = totals.items.length ? `<div class="tile hsa-after"><div class="small">HSA after everything you listed</div><div class="big-number">${formatMoney(Math.round(((hsa.balance || 0) + totals.inTotal - totals.outTotal) * 100) / 100)}</div>
      <div class="small"><span class="positive">+${formatMoney(totals.inTotal)}</span> coming in \u00b7 <span class="negative">-${formatMoney(totals.outTotal)}</span> going out</div></div>` : "";
  const form = `<details class="tile hsa-add"${hsaFormOpen ? " open" : ""}><summary>+ Add money coming in or going out</summary>
      <div class="hsa-kind"><button class="hsa-kind-button active" data-hsa-kind="in">&#8593; Coming in</button><button class="hsa-kind-button" data-hsa-kind="out">&#8595; Going out</button></div>
      <input id="hsa-item-label" type="text" placeholder="What is it? (employer deposit, dentist...)">
      <div class="add-pay-grid"><input id="hsa-item-date" type="date" value="${today}"><input id="hsa-item-amount" type="number" inputmode="decimal" placeholder="Amount ($)"></div>
      <button id="hsa-item-add">Add</button></details>`;
  const message = hsaMessage ? `<div class="small positive hsa-message">${hsaMessage}</div>` : "";
  hsaMessage = "";
  return `<h3 class="hsa-heading">Money coming and going</h3>${summary}${rows || `<div class="tile small">Nothing listed yet. Add an employer deposit, a dentist visit, anything with a known date.</div>`}${form}${message}`;
}

function showHsaPage(settings) {
  const hsa = settings.hsa;
  const monthsLeft = hsaMonthsUntilBillPaidOff(hsa);
  const projectionCells = [1, 3, 6, 12].map((months) =>
    `<div><span class="small">In ${months} month${months > 1 ? "s" : ""}</span><b>${formatMoney(hsaBalanceAfterMonths(hsa, months, todayText()))}</b></div>`).join("");
  const payoffText = monthsLeft == null ? "Set the remaining bill amount to see the payoff date." : `About ${monthsLeft} more monthly payment${monthsLeft === 1 ? "" : "s"} to pay it off.`;
  document.getElementById("page-hsa").innerHTML = `<h2>HSA${hsa.provider ? ` (${escapeHtml(hsa.provider)})` : ""}</h2>
    <div class="tile hsa-hero"><div class="small">&#129657; Balance</div><div class="huge-number">${editableNumber("hsa.balance", "HSA balance", hsa.balance, true)}</div></div>
    <div class="horizon-grid">
      <div class="tile hsa-stat hsa-in"><div class="small">Put in each week</div><div class="big-number">${editableNumber("hsa.weekly_contribution", "Weekly HSA contribution", hsa.weekly_contribution, true)}</div>
        <div class="small">about ${formatMoney(hsaMonthlyContribution(hsa))} / month</div></div>
      <div class="tile hsa-stat hsa-out"><div class="small">Medical bill payment, monthly</div><div class="big-number">${editableNumber("hsa.monthly_bill_payment", "Monthly medical bill payment", hsa.monthly_bill_payment, true)}</div></div>
    </div>
    <div class="tile hsa-owed"><div class="small">Medical bill still owed</div><div class="big-number">${editableNumber("hsa.medical_bill_remaining", "Medical bill still owed", hsa.medical_bill_remaining, true)}</div>
      <div class="small">${payoffText}</div></div>
    <div class="tile"><b>Projected balance</b><div class="projection-grid">${projectionCells}</div>
      <div class="small">Assumes the weekly deposits keep coming and the bill is paid from the HSA${(hsa.expected_items || []).length ? ", plus the money you listed below" : ""}.</div></div>
    ${hsaExpectedHtml(hsa)}`;
}

// Add money coming in or going out on the HSA page.
document.addEventListener("click", (event) => {
  const kindButton = event.target.closest("[data-hsa-kind]");
  if (kindButton) {
    for (const button of kindButton.parentElement.children) button.classList.toggle("active", button === kindButton);
    return;
  }
  const removeButton = event.target.closest("[data-remove-hsa-item]");
  if (!event.target.closest("#hsa-item-add") && !removeButton) return;
  event.preventDefault();
  const settings = loadSettings();
  settings.hsa.expected_items = settings.hsa.expected_items || [];
  if (removeButton) {
    settings.hsa.expected_items.splice(Number(removeButton.dataset.removeHsaItem), 1);
  } else {
    const kind = document.querySelector(".hsa-kind-button.active").dataset.hsaKind;
    const date = document.getElementById("hsa-item-date").value;
    const amount = Number(document.getElementById("hsa-item-amount").value);
    const label = document.getElementById("hsa-item-label").value.trim();
    if (!date || !(amount > 0)) { alert("Pick a date and type the amount."); return; }
    settings.hsa.expected_items.push({ date, amount, kind, label });
    hsaMessage = `Added ${escapeHtml(label || (kind === "out" ? "money going out" : "money coming in"))}: ${kind === "out" ? "-" : "+"}${formatMoney(amount)} on ${shortMonthDay(date)}.`;
    hsaFormOpen = true;
  }
  saveSettings(settings);
  showHsaPage(settings);
});

function showPtoPage(settings) {
  const blocks = [["PTO", "pto_hours", "&#127796;", "#4ade80"], ["Comp Time", "comp_time_hours", "&#128260;", "#5aa2ff"], ["Holiday Hours", "holiday_hours", "&#127876;", "#fb923c"]].map(([title, key, icon, color]) => {
    const hours = settings.pto[key];
    const shown = hours == null ? "Tap to set" : `${hours.toLocaleString("en-US")}<span class="hours-unit"> hrs</span>`;
    return `<div class="tile pto-tile" style="--tile-accent:${color}"><span class="pto-icon">${icon}</span><div><div class="small">${title}</div><div class="huge-number"><span class="editable" data-edit-path="pto.${key}" data-edit-label="${title} (hours)">${shown}</span></div></div></div>`;
  }).join("");
  document.getElementById("page-pto").innerHTML = `<h2>Work time off</h2>${blocks}`;
}

let plannedOvertime = [];

function showOvertimePlanner(settings) {
  const workDateInput = document.getElementById("overtime-work-date");
  if (!workDateInput.value) {
    const asOfDate = settings.starting_balances.as_of_date;
    workDateInput.min = asOfDate;
    workDateInput.max = addDays(asOfDate, 50);
    workDateInput.value = todayText() < asOfDate ? asOfDate : todayText();
  }
  const { gross_hourly_rate, take_home_per_overtime_hour } = settings.overtime;
  const resultBox = document.getElementById("overtime-result");
  if (plannedOvertime.length === 0) { resultBox.innerHTML = ""; return; }
  const baseline = buildForecast(settings, MINIMUM_ADVICE_DAYS);
  const withOvertime = buildForecast(settingsWithOvertime(settings, plannedOvertime), MINIMUM_ADVICE_DAYS);
  const totalHours = plannedOvertime.reduce((sum, entry) => sum + entry.hours, 0);
  const extraTakeHome = Math.round(totalHours * take_home_per_overtime_hour * 100) / 100;
  const firstPayday = plannedOvertime.map((entry) => entry.payday).sort()[0];
  const lowestBefore = lowestBalanceFrom(baseline, firstPayday);
  const lowestAfter = lowestBalanceFrom(withOvertime, firstPayday);
  const dipComesFirstNote = baseline.lowest_balance_date < firstPayday
    ? `<div class="small">Your lowest point (${formatMoney(baseline.lowest_balance)} on ${formatDate(baseline.lowest_balance_date)}) comes before this pay lands, so it can't help that dip.</div>` : "";
  const rows = plannedOvertime.map((entry, position) =>
    `<div class="tile entry-tile entry-in"><span class="timeline-icon timeline-in">&#8593;</span>
      <div class="entry-body"><b>${entry.hours} hrs on ${formatDate(entry.workDate)}</b><div class="small">Paid ${formatDate(entry.payday)}</div></div>
      <b class="positive">+${formatMoney(Math.round(entry.hours * take_home_per_overtime_hour * 100) / 100)}</b>
      <button class="remove-link" data-remove-overtime="${position}">remove</button></div>`).join("");
  resultBox.innerHTML = `<div class="tile result-hero"><div class="small">Extra take-home from ${totalHours} overtime hour${totalHours === 1 ? "" : "s"}</div>
    <div class="big-number positive">+${formatMoney(extraTakeHome)}</div>
    <div class="result-pairs"><div><span class="small">In 40 days</span><b>${formatMoney(baseline.days[39].checking_balance)} &rarr; ${formatMoney(withOvertime.days[39].checking_balance)}</b></div>
      <div><span class="small">Lowest after ${formatDate(firstPayday)}</span><b>${formatMoney(lowestBefore)} &rarr; ${formatMoney(lowestAfter)}</b></div></div>
    ${dipComesFirstNote}</div>${rows}`;
}

function monthAndYear(dateText) {
  return new Date(dateText + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function showCarPage(settings) {
  const loan = settings.car_loan;
  if (!loan) {
    document.getElementById("car-summary").innerHTML = `<h2>Car loan</h2><div class="tile"><div class="small">No car loan set up. If you have one, add it in Settings → Set up in the app. If not, you can hide this tab there.</div></div>`;
    document.getElementById("car-extra-result").innerHTML = "";
    return;
  }
  const status = loanStatus(loan, todayText());
  const baseline = loanPayoffPlan(loan, status.balance, status.paymentsMade);
  const lumpSum = parseFloat(document.getElementById("car-extra-now").value) || 0;
  const extraEachMonth = parseFloat(document.getElementById("car-extra-monthly").value) || 0;
  const totalPayments = status.paymentsMade + baseline.paymentsLeft;
  const percentPaid = Math.round((status.principalPaid / loan.amount) * 100);
  const principalShare = status.totalPaid > 0 ? Math.round((status.principalPaid / status.totalPaid) * 100) : 0;
  document.getElementById("car-summary").innerHTML = `<h2>Car loan</h2>
    <div class="tile car-hero"><div class="small">Still owed (principal)</div><div class="huge-number">${formatMoney(status.balance)}</div>
      <div class="bar goal-bar"><div class="bar-fill" style="width:${percentPaid}%"></div></div>
      <div class="small">${percentPaid}% of the ${formatMoney(loan.amount)} loan paid off</div></div>
    <div class="tile car-tile"><div class="small">Paid so far</div><div class="big-number">${formatMoney(status.totalPaid)}</div>
      <div class="split-bar"><span class="split-loan" style="width:${principalShare}%"></span><span class="split-interest" style="width:${100 - principalShare}%"></span></div>
      <div class="tile-row small"><span><span class="dot dot-loan"></span>Went to the loan</span><span>${formatMoney(status.principalPaid)}</span></div>
      <div class="tile-row small"><span><span class="dot dot-interest"></span>Went to interest</span><span>${formatMoney(status.interestPaid)}</span></div>
      <div class="small">${status.paymentsMade} of ${totalPayments} payments made</div></div>
    <div class="tile car-tile"><div class="small">Paid off on</div><div class="big-number">${monthAndYear(baseline.payoffDate)}</div>
      <div class="small">${baseline.paymentsLeft} payments left of ${formatMoney(loan.payment)}. About ${formatMoney(baseline.interestRemaining)} interest still to come.</div></div>
    ${baseline.waivedPayment ? `<div class="tile result-hero"><div class="tile-row"><b>Last payment waived</b><b>${formatMoney(baseline.waivedPayment.amount)} off</b></div>
      <div class="small">${escapeHtml(baseline.waivedPayment.reason)}. The ${monthAndYear(baseline.waivedPayment.date)} payment is null.</div></div>` : ""}
    <div class="tile car-tile"><b>Loan facts</b>
      <div class="facts-grid">
        <div><span class="fact-icon">&#128663;</span><b>${formatMoney(loan.amount)}</b><span class="small">Loan amount</span></div>
        <div><span class="fact-icon">&#128200;</span><b>${loan.annual_rate_percent}%</b><span class="small">Rate</span></div>
        <div><span class="fact-icon">&#128197;</span><b>${totalPayments}</b><span class="small">Payments</span></div>
        <div><span class="fact-icon">&#128184;</span><b>${formatMoney(status.interestPaid + baseline.interestRemaining)}</b><span class="small">Total interest</span></div>
      </div></div>`;
  const resultBox = document.getElementById("car-extra-result");
  if (lumpSum <= 0 && extraEachMonth <= 0) { resultBox.innerHTML = ""; return; }
  const plan = loanPayoffPlan(loan, status.balance, status.paymentsMade, lumpSum, extraEachMonth);
  const monthsSaved = baseline.paymentsLeft - plan.paymentsLeft;
  resultBox.innerHTML = `<div class="tile result-hero"><div class="verdict">${plan.paymentsLeft === 0 ? "Paid off right now" : "Paid off " + monthAndYear(plan.payoffDate)}</div>
    <div class="tile-row"><b>Interest saved</b><b class="positive">${formatMoney(baseline.interestRemaining - plan.interestRemaining)}</b></div>
    <div class="result-rows"><div class="tile-row small"><span>Owed after extra</span><span>${formatMoney(Math.max(0, status.balance - lumpSum))}</span></div>
    <div class="tile-row small"><span>Payments left</span><span>${plan.paymentsLeft} (${monthsSaved} fewer)</span></div>
    <div class="tile-row small"><span>Interest still to come</span><span>${formatMoney(plan.interestRemaining)}</span></div></div></div>`;
}

function showBillsTotal(settings) {
  const monthlyTotal = totalsForItems(monthlyItemsForTab(settings, "subscriptions")).monthlyTotal + totalsForItems(monthlyItemsForTab(settings, "expenses")).monthlyTotal;
  const nothingAddedYet = settings.monthly_bills_paid_from_checking.length + settings.subscriptions_charged_to_cards.length === 0;
  document.getElementById("bills-total").innerHTML = nothingAddedYet
    ? `<div class="tile"><div class="small">No bills or subscriptions yet. Add them in Settings → Set up in the app.</div></div>`
    : `<div class="tile bills-total-tile"><div class="small">All bills and subscriptions</div><div class="huge-number">${formatMoney(monthlyTotal)} / month</div></div>`;
}

function showExtraPages(settings) {
  showBillsTotal(settings);
  showMonthlyItemsPage(settings, "subscriptions", "Subscriptions");
  showMonthlyItemsPage(settings, "expenses", "Expenses");
  showRewardsPage(settings);
  showCreditPage(settings);
  showHsaPage(settings);
  showPtoPage(settings);
  showCarPage(settings);
  showSpendingPage(settings);
  showSetupPage(settings);
  showTrackingPages(settings);
  showOvertimePlanner(settings);
}

function setValueAtPath(settings, path, newValue) {
  const steps = path.split(".");
  const lastStep = steps.pop();
  const container = steps.reduce((current, step) => current[step], settings);
  container[lastStep] = newValue;
}

function valueAtPath(settings, path) {
  return path.split(".").reduce((current, step) => current[step], settings);
}

function addBenefitWithPrompts(settings) {
  const cardEntries = Object.entries(settings.credit_cards);
  const name = prompt("Benefit name (for example: Airline fee credit)");
  if (!name) return;
  const cardMenu = cardEntries.map(([, card], position) => `${position + 1} = ${card.display_name}`).join("\n");
  const cardNumber = parseInt(prompt("Which card?\n" + cardMenu), 10);
  if (!cardEntries[cardNumber - 1]) return;
  const total = parseFloat(prompt("Total credit amount ($)"));
  if (!total) return;
  settings.card_benefits.push({ name, card: cardEntries[cardNumber - 1][0], total, used: 0 });
  saveSettings(settings);
  showEverything();
}

for (const inputId of ["car-extra-now", "car-extra-monthly"]) {
  document.getElementById(inputId).addEventListener("input", () => { const settings = loadSettings(); if (settings) showCarPage(settings); });
}

for (const pageName of PAGE_NAMES) {
  document.getElementById("tab-" + pageName).addEventListener("click", () => showPage(pageName));
}

document.addEventListener("click", (event) => {
  const settings = loadSettings();
  if (!settings) return;
  const editTarget = event.target.closest("[data-edit-path]");
  if (editTarget) {
    const currentValue = valueAtPath(settings, editTarget.dataset.editPath);
    const answer = prompt(editTarget.dataset.editLabel, currentValue == null ? "" : currentValue);
    if (answer === null) return;
    const newValue = answer.trim() === "" ? null : parseFloat(answer.replace(/[$,]/g, ""));
    if (Number.isNaN(newValue)) return;
    setValueAtPath(settings, editTarget.dataset.editPath, newValue);
    saveSettings(settings);
    showEverything();
  }
  const removeTarget = event.target.closest("[data-remove-benefit]");
  if (removeTarget && confirm("Remove this benefit?")) {
    settings.card_benefits.splice(Number(removeTarget.dataset.removeBenefit), 1);
    saveSettings(settings);
    showEverything();
  }
  if (event.target.id === "add-benefit-button") addBenefitWithPrompts(settings);
  if (event.target.id === "overtime-add-button") {
    const hours = parseFloat(document.getElementById("overtime-hours").value);
    if (!hours || hours <= 0) return;
    const workDate = document.getElementById("overtime-work-date").value;
    if (!workDate) return;
    plannedOvertime.push({ workDate, payday: paydayForWorkDate(settings, workDate), hours });
    document.getElementById("overtime-hours").value = "";
    showEverything();
  }
  const removeOvertimeTarget = event.target.closest("[data-remove-overtime]");
  if (removeOvertimeTarget) {
    plannedOvertime.splice(Number(removeOvertimeTarget.dataset.removeOvertime), 1);
    showEverything();
  }
});
