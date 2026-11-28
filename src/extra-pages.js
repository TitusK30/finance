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

// ---- Bills filter: which card or account pays, and when in the month. Saved on this phone only.
const BILLS_FILTER_KEY = "finance_os_bills_filter";
const BILLS_RANGES = [["all", "Whole month"], ["first", "Days 1\u201315"], ["second", "Days 16\u201331"], ["next7", "Next 7 days"], ["next14", "Next 14 days"], ["next30", "Next 30 days"]];

function loadBillsFilter() {
  try { return { payers: null, range: "all", ...JSON.parse(localStorage.getItem(BILLS_FILTER_KEY) || "{}") }; } catch (error) { return { payers: null, range: "all" }; }
}

function billsFilterIsOn(filter) {
  return filter.range !== "all" || Boolean(filter.payers && filter.payers.length);
}

function itemPassesBillsFilter(item, filter) {
  if (filter.payers && filter.payers.length && !filter.payers.includes(item.paidFrom)) return false;
  const days = item.daysOfMonth || [item.dayOfMonth];
  if (filter.range === "first") return days.some((day) => day <= 15);
  if (filter.range === "second") return days.some((day) => day >= 16);
  const nextDays = { next7: 7, next14: 14, next30: 30 }[filter.range];
  return nextDays ? days.some((day) => daysUntilNextDayOfMonth(day, todayText()) <= nextDays) : true;
}

function filteredItemsForTab(settings, tabName) {
  const filter = loadBillsFilter();
  return monthlyItemsForTab(settings, tabName).filter((item) => itemPassesBillsFilter(item, filter));
}

function billsFilterSummary(settings, filter) {
  const payers = filter.payers && filter.payers.length ? filter.payers.map((key) => payerName(settings, key)).join(", ") : "All cards and accounts";
  return `${payers} \u00b7 ${BILLS_RANGES.find(([key]) => key === filter.range)[1]}`;
}

function showMonthlyItemsPage(settings, tabName, pageTitle) {
  const items = filteredItemsForTab(settings, tabName);
  const { monthlyTotal, totalsByPayer } = totalsForItems(items);
  const rows = items
    .map((item) => {
      const verb = item.paidFrom === "checking" ? "paid" : "charged";
      const whenText = item.refillsPerMonth ? `about ${item.refillsPerMonth}x a month, ${formatMoney(item.amountEach)} each` : `${verb} on the ${item.dayOfMonth}${ordinalEnding(item.dayOfMonth)}`;
      const amountText = `${formatMoney(item.monthlyAmount)} / month${item.isEstimate ? " (est.)" : ""}`;
      return `<div class="tile bill-tile" data-bill-source="${item.source}" data-bill-index="${item.index}" style="--tile-accent:${payerColor(settings, item.paidFrom)}"><div class="tile-row"><b>${escapeHtml(item.name)}</b><b>${amountText}</b></div>
        <div class="tile-row small"><span>${payerName(settings, item.paidFrom)}</span><span>${whenText}</span></div>
        <button class="remove-link" data-remove-bill-item="${item.source}:${item.index}">remove</button></div>`;
    }).join("");
  const payerEntries = Object.entries(totalsByPayer).sort();
  const payerBar = `<div class="payer-bar">${payerEntries.map(([paidFrom, total]) => `<div class="seg" style="width:${monthlyTotal > 0 ? (total / monthlyTotal) * 100 : 0}%;background:${payerColor(settings, paidFrom)}"></div>`).join("")}</div>`;
  const payerTotals = payerEntries.map(([paidFrom, total]) =>
    `<div class="tile-row small"><span><span class="dot" style="background:${payerColor(settings, paidFrom)}"></span>${payerName(settings, paidFrom)}</span><span>${formatMoney(total)}</span></div>`).join("");
  document.getElementById("page-" + tabName).innerHTML = `<h2>${pageTitle}</h2>
    <div class="tile bills-total-tile"><div class="small">Total per month</div><div class="huge-number">${formatMoney(monthlyTotal)}</div>${payerBar}${payerTotals}</div>${rows || (billsFilterIsOn(loadBillsFilter()) ? `<div class="tile"><div class="small">Nothing here matches your filter.</div></div>` : "")}`;
}

function ordinalEnding(dayNumber) {
  if (dayNumber % 100 >= 11 && dayNumber % 100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[dayNumber % 10] || "th";
}

const REWARD_COLORS = ["#5aa2ff", "#4ade80", "#a78bfa", "#fb923c", "#f472b6", "#2dd4bf"];

function showRewardsPage(settings) {
  const cardKeys = Object.keys(settings.credit_cards);
  const colorOf = (cardKey) => REWARD_COLORS[Math.max(0, cardKeys.indexOf(cardKey)) % REWARD_COLORS.length];
  const shownCards = Object.entries(settings.credit_cards).filter(([cardKey]) => !settings.rewards[cardKey].hidden);
  const hiddenCount = cardKeys.length - shownCards.length;
  const pointTiles = shownCards.map(([cardKey, card]) => {
    const reward = settings.rewards[cardKey];
    return `<div class="tile rewards-tile points-tile" style="--tile-accent:${colorOf(cardKey)}"><div><b>${card.display_name}</b><div class="small">${escapeHtml(reward.program)}</div></div>
      <b class="points-number">${editableNumber(`rewards.${cardKey}.points_balance`, card.display_name + " balance", reward.points_balance, false)}</b>
      <button class="remove-link" data-remove-points="${cardKey}">remove</button></div>`;
  }).join("");
  const showPointsButton = hiddenCount ? `<button class="mark-button points-show-button" data-show-points="yes">+ Show points for ${hiddenCount} hidden card${hiddenCount === 1 ? "" : "s"}</button>` : "";
  const benefitTiles = settings.card_benefits.map((benefit, position) => {
    const remaining = benefitRemaining(benefit);
    const percentUsed = Math.min(100, Math.round(((benefit.used || 0) / benefit.total) * 100));
    return `<div class="tile rewards-tile benefit-tile" data-setup-hold="benefit:${position}" style="--tile-accent:${colorOf(benefit.card)}"><div class="tile-row"><b>${escapeHtml(benefit.name)}</b><b class="benefit-left">${formatMoney(remaining)} left</b></div>
      <div class="bar benefit-bar"><div class="bar-fill" style="width:${percentUsed}%"></div></div>
      <div class="tile-row small"><span>${settings.credit_cards[benefit.card].display_name}</span>
        <span>used ${formatMoney(benefit.used || 0)} of ${formatMoney(benefit.total)}</span></div>
      <button class="remove-link" data-remove-benefit="${position}">remove</button></div>`;
  }).join("");
  document.getElementById("page-rewards").innerHTML = `<h2>Points</h2>${pointTiles}${showPointsButton}<h2>Card benefits</h2>${benefitTiles}${benefitTiles ? `<div class="small benefit-hint">Hold a benefit to change it, swipe it to delete.</div>` : ""}
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

// Subscriptions and fees due on this card before it closes: a small line like the pending one, tap to list them.
// They are not in the open amount yet; the list ends with what the statement should read at close.
function expectedChargesHtml(plan, estimateMark) {
  const coming = plan.comingCharges;
  if (!coming.length) return "";
  const comingRows = coming.map((charge) => `<div class="tile-row small"><span>${shortMonthDay(charge.date)} \u00b7 ${escapeHtml(charge.name)}</span><span>${formatMoney(charge.amount)}</span></div>`).join("");
  return `<details class="pending-details expected-details"><summary class="small">+${formatMoney(plan.comingTotal)} expected, not counted in open</summary>${comingRows}
    <div class="tile-row small expected-at-close"><span>On the statement at close \u00b7 ${shortMonthDay(plan.closeDate)}</span><b>${formatMoney(plan.projectedStatement)}${estimateMark}</b></div></details>`;
}

// Days until the statement closes and the dollar amount of the utilization target.
function closeChipsHtml(plan, targetPercent) {
  return `<div class="close-chips"><span>Closes in <b>${plan.daysUntilClose} day${plan.daysUntilClose === 1 ? "" : "s"}</b></span><span>${targetPercent}% target <b>${formatMoney(plan.targetAmount)}</b></span></div>`;
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
      ${expectedChargesHtml(plan, estimateMark)}
      <div class="verdict ${plan.payDownNeeded > 0 ? "verdict-bad" : "verdict-good"}">${verdict}</div>
      ${closeChipsHtml(plan, targetPercent)}
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
    return `<div class="tile expected-tile ${isOut ? "expected-out" : "expected-in"}" data-item-hold="hsa:${item.position}"><span class="timeline-icon ${isOut ? "timeline-out" : "timeline-in"}">${isOut ? "&#8595;" : "&#8593;"}</span>
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
  // The projection counts the money listed below unless the toggle on the tile is set to "Regular only".
  const hasListed = (hsa.expected_items || []).length > 0;
  const includeListed = hasListed && hsa.projection_includes_listed !== false;
  const projectionCells = [1, 3, 6, 12].map((months) =>
    `<div><span class="small">In ${months} month${months > 1 ? "s" : ""}</span><b>${formatMoney(hsaBalanceAfterMonths(hsa, months, includeListed ? todayText() : undefined))}</b></div>`).join("");
  const projectionToggle = hasListed ? `<div class="hsa-kind"><button class="hsa-kind-button${includeListed ? "" : " active"}" data-hsa-projection="plain">Regular only</button><button class="hsa-kind-button${includeListed ? " active" : ""}" data-hsa-projection="listed">With my listed money</button></div>` : "";
  const payoffShort = monthsLeft == null ? "set amounts for payoff" : `${monthsLeft} payment${monthsLeft === 1 ? "" : "s"} left`;
  document.getElementById("page-hsa").innerHTML = `<h2>HSA${hsa.provider ? ` (${escapeHtml(hsa.provider)})` : ""}</h2>
    <div class="tile hsa-hero"><div class="hsa-eyebrow">&#129657; Balance</div><div class="huge-number">${editableNumber("hsa.balance", "HSA balance", hsa.balance, true)}</div>
      <div class="hsa-cells">
        <div class="hsa-cell hsa-cell-in"><span class="hsa-cell-label">In each week</span><b>${editableNumber("hsa.weekly_contribution", "Weekly HSA contribution", hsa.weekly_contribution, true)}</b><span class="small">about ${formatMoney(hsaMonthlyContribution(hsa))} / month</span></div>
        <div class="hsa-cell hsa-cell-out"><span class="hsa-cell-label">Bill payment / month</span><b>${editableNumber("hsa.monthly_bill_payment", "Monthly medical bill payment", hsa.monthly_bill_payment, true)}</b></div>
        <div class="hsa-cell hsa-cell-owed"><span class="hsa-cell-label">Bill still owed</span><b>${editableNumber("hsa.medical_bill_remaining", "Medical bill still owed", hsa.medical_bill_remaining, true)}</b><span class="small">${payoffShort}</span></div>
      </div></div>
    <h3 class="hsa-heading">Projected balance</h3>
    <div class="tile hsa-projection">${projectionToggle}<div class="projection-grid">${projectionCells}</div>
      <div class="small">Assumes the weekly deposits keep coming and the bill is paid from the HSA${includeListed ? ", plus the money you listed below" : ""}.</div></div>
    ${hsaExpectedHtml(hsa)}`;
}

// Add money coming in or going out on the HSA page.
document.addEventListener("click", (event) => {
  const projectionButton = event.target.closest("[data-hsa-projection]");
  if (projectionButton) {
    const settings = loadSettings();
    settings.hsa.projection_includes_listed = projectionButton.dataset.hsaProjection === "listed";
    saveSettings(settings);
    showHsaPage(settings);
    return;
  }
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

// Time off is a list of buckets ({ name, hours }). Older copies kept three fixed numbers; they read as the first three buckets.
const PTO_STARTER_BUCKETS = [["PTO", "pto_hours"], ["Comp Time", "comp_time_hours"], ["Holiday Hours", "holiday_hours"]];
function ptoBucketsOf(pto) {
  if (pto && Array.isArray(pto.buckets)) return pto.buckets;
  return PTO_STARTER_BUCKETS.map(([name, oldKey]) => ({ name, hours: pto && pto[oldKey] != null ? pto[oldKey] : null }));
}

// Icon and color by name, so the starter buckets keep their look and new ones get their own.
function ptoLook(name, position) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("holiday")) return ["&#127876;", "#fb923c"];
  if (lowerName.includes("comp")) return ["&#128260;", "#5aa2ff"];
  if (lowerName.includes("pto") || lowerName.includes("vacation")) return ["&#127796;", "#4ade80"];
  if (lowerName.includes("sick")) return ["&#129658;", "#f87171"];
  return ["&#9201;&#65039;", ["#a78bfa", "#f472b6", "#2dd4bf", "#fbbf24"][position % 4]];
}

// Tap the hours to change them, hold a bucket to rename it, swipe it to delete.
function showPtoPage(settings) {
  if (!Array.isArray((settings.pto || {}).buckets)) { settings.pto = { buckets: ptoBucketsOf(settings.pto) }; saveSettings(settings); }
  const blocks = settings.pto.buckets.map((bucket, position) => {
    const [icon, color] = ptoLook(bucket.name, position);
    const shown = bucket.hours == null ? "Tap to set" : `${bucket.hours.toLocaleString("en-US")}<span class="hours-unit"> hrs</span>`;
    return `<div class="tile pto-tile" style="--tile-accent:${color}" data-item-hold="pto:${position}"><span class="pto-icon">${icon}</span><div><div class="small">${escapeHtml(bucket.name)}</div><div class="huge-number"><span class="editable" data-edit-path="pto.buckets.${position}.hours" data-edit-label="${escapeHtml(bucket.name)} (hours)">${shown}</span></div></div>
      <button class="remove-link" data-remove-pto="${position}">remove</button></div>`;
  }).join("");
  document.getElementById("page-pto").innerHTML = `<h2>Work time off</h2>${blocks || `<div class="tile small">Nothing listed. Add PTO, sick time, comp time or anything you track in hours.</div>`}
    <button id="add-pto-button">Add item</button>`;
}

document.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-pto]");
  if (!removeButton && !event.target.closest("#add-pto-button")) return;
  const settings = loadSettings();
  if (!settings) return;
  settings.pto = { buckets: ptoBucketsOf(settings.pto) };
  if (removeButton) {
    const [removed] = settings.pto.buckets.splice(Number(removeButton.dataset.removePto), 1);
    saveSettings(settings);
    showPtoPage(settings);
    showToast(`${removed.name} removed.`);
    return;
  }
  openSetupItemSheet({
    title: "Add time off",
    fields: [{ id: "name", label: "Name (for example: Sick time)", value: "" }, { id: "hours", label: "Hours you have now (optional)", isMoney: true, value: "" }],
    save: (values) => {
      if (!values.name) return "Give it a name.";
      settings.pto.buckets.push({ name: values.name, hours: values.hours >= 0 ? values.hours : null });
    },
  }, () => saveAndRefresh(settings));
});

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

function showBillsTotal(settings) {
  const filter = loadBillsFilter();
  const monthlyTotal = totalsForItems(filteredItemsForTab(settings, "subscriptions")).monthlyTotal + totalsForItems(filteredItemsForTab(settings, "expenses")).monthlyTotal;
  const nothingAddedYet = settings.monthly_bills_paid_from_checking.length + settings.subscriptions_charged_to_cards.length === 0;
  const filterOn = billsFilterIsOn(filter);
  const filterRow = nothingAddedYet ? "" : `<div class="bills-filter-row"><span class="small">${filterOn ? escapeHtml(billsFilterSummary(settings, filter)) : "Showing everything"}</span>
    <button id="bills-filter-button" class="filter-chip${filterOn ? " is-on" : ""}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>Filter</button></div>`;
  document.getElementById("bills-total").innerHTML = nothingAddedYet
    ? `<div class="tile"><div class="small">No bills or subscriptions yet. Add them in Settings → Set up in the app.</div></div>`
    : `${filterRow}<div class="tile bills-total-tile"><div class="small">${filterOn ? "Matching your filter" : "All bills and subscriptions"}</div><div class="huge-number">${formatMoney(monthlyTotal)} / month</div></div>`;
}

// The filter sheet: tap chips to pick cards or accounts and a time range, then Show.
function openBillsFilter(settings) {
  const saved = loadBillsFilter();
  const draft = { payers: new Set(saved.payers || []), range: saved.range };
  const payerKeys = ["checking", ...Object.keys(settings.credit_cards)];
  const cover = document.createElement("div");
  cover.className = "date-cover category-picker filter-sheet";
  const draw = () => {
    cover.innerHTML = `<div class="date-box"><div class="date-question">Filter bills</div>
      <div class="filter-label">Paid from <span class="small">(none picked = all)</span></div>
      <div class="choice-list">${payerKeys.map((key) => `<button class="choice-button${draft.payers.has(key) ? " is-current" : ""}" data-payer="${key}" style="--dot:${payerColor(settings, key)}"><i class="choice-dot"></i><b>${escapeHtml(payerName(settings, key))}</b></button>`).join("")}</div>
      <div class="filter-label">When</div>
      <div class="choice-list">${BILLS_RANGES.map(([key, label]) => `<button class="choice-button${draft.range === key ? " is-current" : ""}" data-range="${key}" style="--dot:var(--accent)"><b>${label}</b></button>`).join("")}</div>
      <div class="choice-list filter-actions"><button class="choice-button is-wide is-apply" data-filter-apply><b>Show</b></button><button class="choice-button is-wide" data-filter-reset><b>Clear filters</b></button></div></div>`;
  };
  draw();
  cover.addEventListener("click", (event) => {
    const payerButton = event.target.closest("[data-payer]");
    const rangeButton = event.target.closest("[data-range]");
    if (payerButton) { const key = payerButton.dataset.payer; draft.payers.has(key) ? draft.payers.delete(key) : draft.payers.add(key); draw(); return; }
    if (rangeButton) { draft.range = rangeButton.dataset.range; draw(); return; }
    const reset = event.target.closest("[data-filter-reset]");
    const apply = event.target.closest("[data-filter-apply]");
    if (!reset && !apply && event.target !== cover) return;
    if (reset) { draft.payers.clear(); draft.range = "all"; }
    if (reset || apply) {
      const allPicked = draft.payers.size === payerKeys.length;
      localStorage.setItem(BILLS_FILTER_KEY, JSON.stringify({ payers: draft.payers.size && !allPicked ? [...draft.payers] : null, range: draft.range }));
      showBillsTotal(settings);
      showMonthlyItemsPage(settings, "subscriptions", "Subscriptions");
      showMonthlyItemsPage(settings, "expenses", "Expenses");
    }
    cover.remove();
  });
  document.body.appendChild(cover);
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("#bills-filter-button")) return;
  const settings = loadSettings();
  if (settings) openBillsFilter(settings);
});

function showExtraPages(settings) {
  showBillsTotal(settings);
  showMonthlyItemsPage(settings, "subscriptions", "Subscriptions");
  showMonthlyItemsPage(settings, "expenses", "Expenses");
  showRewardsPage(settings);
  showCreditPage(settings);
  showHsaPage(settings);
  showPtoPage(settings);
  showLoansPage(settings);
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
  document.getElementById(inputId).addEventListener("input", () => { const settings = loadSettings(); if (settings) showLoansPage(settings); });
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

// ---- Hold a bill or subscription to edit it. Changes go straight into your settings, so the forecast, matching and totals follow.
function editBillItem(source, index) {
  const settings = loadSettings();
  if (!settings) return;
  const original = (source === "bill" ? settings.monthly_bills_paid_from_checking : settings.subscriptions_charged_to_cards)[index];
  if (!original) return;
  const refillDays = original.assumed_days_of_month || null;
  const currentPayer = source === "bill" ? "checking" : original.card;
  const payerKeys = [...(refillDays ? [] : ["checking"]), ...Object.keys(settings.credit_cards)];
  let payer = currentPayer;
  const cover = document.createElement("div");
  cover.className = "date-cover category-picker filter-sheet bill-editor";
  const values = { name: original.name, amount: original.amount, days: (refillDays || [original.day_of_month]).join(", ") };
  let errorText = "";
  const draw = () => {
    cover.innerHTML = `<div class="date-box"><div class="date-question">Edit ${escapeHtml(original.name)}</div>
      <div class="filter-label">Name</div><input id="edit-bill-name" value="${escapeHtml(values.name)}" autocomplete="off">
      <div class="filter-label">Amount ($)${refillDays ? ' <span class="small">(each charge)</span>' : ""}</div><input id="edit-bill-amount" inputmode="decimal" value="${values.amount}">
      <div class="filter-label">${refillDays ? "Days of the month" : "Day of the month"}${refillDays ? ' <span class="small">(like 5, 15, 25)</span>' : ""}</div><input id="edit-bill-days" inputmode="numeric" value="${escapeHtml(values.days)}">
      <div class="filter-label">Paid from</div>
      <div class="choice-list">${payerKeys.map((key) => `<button class="choice-button${payer === key ? " is-current" : ""}" data-edit-payer="${key}" style="--dot:${payerColor(settings, key)}"><i class="choice-dot"></i><b>${escapeHtml(payerName(settings, key))}</b></button>`).join("")}</div>
      ${errorText ? `<div class="editor-error">${escapeHtml(errorText)}</div>` : ""}
      <div class="choice-list filter-actions"><button class="choice-button is-wide is-apply" data-edit-save><b>Save</b></button><button class="choice-button is-wide" data-edit-cancel><b>Cancel</b></button></div></div>`;
  };
  const readFields = () => {
    for (const [key, id] of [["name", "edit-bill-name"], ["amount", "edit-bill-amount"], ["days", "edit-bill-days"]]) { const input = cover.querySelector("#" + id); if (input) values[key] = input.value; }
  };
  draw();
  cover.addEventListener("click", (event) => {
    const payerButton = event.target.closest("[data-edit-payer]");
    if (payerButton) { readFields(); payer = payerButton.dataset.editPayer; draw(); return; }
    if (event.target.closest("[data-edit-save]")) {
      readFields();
      const name = values.name.trim();
      const amount = parseFloat(String(values.amount).replace(/[$,]/g, ""));
      const days = String(values.days).split(/[ ,]+/).filter(Boolean).map(Number);
      const daysOk = days.length > 0 && days.every((day) => Number.isInteger(day) && day >= 1 && day <= 31) && (refillDays ? true : days.length === 1);
      errorText = !name ? "Give it a name." : !(amount > 0) ? "Amount needs to be more than 0." : !daysOk ? (refillDays ? "Days should be numbers from 1 to 31, like 5, 15, 25." : "Day should be one number from 1 to 31.") : "";
      if (errorText) { draw(); return; }
      applyBillEdit(settings, source, index, { name, amount, days, payer });
      cover.remove();
      showEverything();
      showToast(`${name} updated.`);
      return;
    }
    if (event.target.closest("[data-edit-cancel]") || event.target === cover) cover.remove();
  });
  document.body.appendChild(cover);
}

// Writes the edit into settings. Keeps the match words so renaming does not break matching, keeps expenses on the Expenses tab,
// and moves the item between the checking bills and card subscriptions when "paid from" crosses over.
function applyBillEdit(settings, source, index, { name, amount, days, payer }) {
  const sourceList = source === "bill" ? settings.monthly_bills_paid_from_checking : settings.subscriptions_charged_to_cards;
  const original = sourceList[index];
  const updated = { ...original, name, amount };
  if (name !== original.name && !(original.charge_text_contains && original.charge_text_contains.length) && nameWords(original.name).length) updated.charge_text_contains = nameWords(original.name);
  if (EXPENSE_ITEM_NAMES.includes(original.name)) updated.is_expense = true;
  if (original.assumed_days_of_month) updated.assumed_days_of_month = days; else updated.day_of_month = days[0];
  if (source === "bill" && payer === "checking") { sourceList[index] = updated; return; }
  if (source === "sub" && payer !== "checking") { updated.card = payer; sourceList[index] = updated; return; }
  sourceList.splice(index, 1);
  if (source === "bill") {
    const { amount_changes_every_month, is_estimate, ...rest } = updated;
    settings.subscriptions_charged_to_cards.push({ ...rest, card: payer });
  } else {
    const { card, ...rest } = updated;
    settings.monthly_bills_paid_from_checking.push(rest);
  }
}

// Bills tab: swipe a bill or subscription to delete it. Points: swipe a card's points to hide them, the button brings them back.
document.addEventListener("click", async (event) => {
  const removeBillButton = event.target.closest("[data-remove-bill-item]");
  const removePointsButton = event.target.closest("[data-remove-points]");
  const showPointsButton = event.target.closest("[data-show-points]");
  if (!removeBillButton && !removePointsButton && !showPointsButton) return;
  event.preventDefault();
  const settings = loadSettings();
  if (!settings) return;
  if (removeBillButton) {
    const [source, index] = removeBillButton.dataset.removeBillItem.split(":");
    const list = source === "bill" ? settings.monthly_bills_paid_from_checking : settings.subscriptions_charged_to_cards;
    const [removed] = list.splice(Number(index), 1);
    saveSettings(settings);
    showEverything();
    showToast(`${removed.name} removed.`);
    return;
  }
  if (removePointsButton) {
    const cardKey = removePointsButton.dataset.removePoints;
    settings.rewards[cardKey].hidden = true;
    saveSettings(settings);
    showRewardsPage(settings);
    showToast(`${settings.credit_cards[cardKey].display_name} points hidden.`);
    return;
  }
  const hiddenChoices = Object.entries(settings.credit_cards).filter(([cardKey]) => settings.rewards[cardKey].hidden)
    .map(([cardKey, card]) => ({ title: card.display_name, detail: settings.rewards[cardKey].program || "", value: cardKey, color: REWARD_COLORS[Object.keys(settings.credit_cards).indexOf(cardKey) % REWARD_COLORS.length] }));
  const picked = await askChoice("Show points for which card?", hiddenChoices, "category-picker");
  if (!picked) return;
  delete settings.rewards[picked].hidden;
  saveSettings(settings);
  showRewardsPage(settings);
  showToast(`${settings.credit_cards[picked].display_name} points shown.`);
});
