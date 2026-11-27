// The Spending page, plus the phone's saved copy of your transactions.
// Transactions are kept on this phone only, apart from your settings.

const TRANSACTIONS_KEY = "finance_os_transactions";
const BILL_MARKS_KEY = "finance_os_bill_marks";
let spendingMonthShown = null;
let earnedTileOpen = false; // stays open after adding or removing a typed paycheck

function loadTransactionStore() {
  try {
    return JSON.parse(localStorage.getItem(TRANSACTIONS_KEY)) || emptyTransactionStore();
  } catch (error) {
    return emptyTransactionStore();
  }
}

function saveTransactionStore(store) {
  try {
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(store));
  } catch (error) {
    // Storage full: skip. Balances still work, and the next refresh tries again.
  }
}

// Charges you marked as bills by hand ("merchant|amount"), kept on this phone.
function loadBillMarks() {
  try {
    return JSON.parse(localStorage.getItem(BILL_MARKS_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function saveBillMarks(marks) {
  try {
    localStorage.setItem(BILL_MARKS_KEY, JSON.stringify(marks));
  } catch (error) {
    // Storage full: skip.
  }
}

// Card name if this account is one of your tracked cards, otherwise the bank's name for the account.
function cardNameForAccount(settings, store, accountId) {
  const account = store.accounts[accountId];
  if (!account) return "";
  const cardKey = Object.keys(settings.credit_cards).find((key) => (settings.card_masks || {})[key] === account.mask && account.type === "credit");
  return cardKey ? settings.credit_cards[cardKey].display_name : account.name;
}

function chargeRowHtml(settings, store, charge, markButton = "") {
  const pendingTag = charge.pending ? ` <span class="pending-tag">pending</span>` : "";
  const cardName = cardNameForAccount(settings, store, charge.account_id);
  return `<div class="tile-row small charge-row" data-charge-id="${charge.transaction_id}"><span>${shortMonthDay(charge.date)} · ${escapeHtml(merchantName(charge))}${pendingTag}<br><span class="charge-card">${escapeHtml(cardName)}</span></span><span>${formatMoney(charge.amount)}<br>${markButton}</span></div>`;
}

function monthLabel(yearMonth) {
  return new Date(yearMonth + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// One color per spending category, used for the tile edge and its bar.
const CATEGORY_COLORS = { GROCERIES: "#4ade80", AMAZON: "#fb923c", TOLLS: "#2dd4bf", FOOD_AND_DRINK: "#f87171", GENERAL_MERCHANDISE: "#a78bfa", TRANSPORTATION: "#5aa2ff", TRAVEL: "#22d3ee", ENTERTAINMENT: "#f472b6", RENT_AND_UTILITIES: "#fbbf24", GENERAL_SERVICES: "#818cf8", PERSONAL_CARE: "#fb7185", MEDICAL: "#ef4444", BANK_FEES: "#9ca3af", OTHER: "#9ca3af" };

// Charges that are not bills, with refill-style subscription charges (the toll tag) moved to the Tolls category.
function nonBillCharges(settings, store, billMatches) {
  const refillBills = recurringBills(settings).filter((bill) => bill.anyDay);
  return spendingCharges(store).filter((charge) => !billMatches.billCharges[charge.transaction_id])
    .map((charge) => refillBills.some((bill) => textMatches(bill, charge)) ? { ...charge, category: "TOLLS" } : charge);
}

// Paydays still ahead (after today) in the current month, each worth your usual bank pay deposit (no overtime).
function paydaysAhead(settings, store, yearMonth) {
  const usualPay = usualPayDeposit(store, settings) ?? settings.paycheck.usual_take_home_amount;
  const result = { count: 0, amount: 0, usualPay, known: Boolean(settings.paycheck) && yearMonth === todayText().slice(0, 7) };
  if (!result.known) return result;
  const lastDayOfMonth = new Date(Date.UTC(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)), 0)).getUTCDate();
  const typedPay = expectedPaychecks(store, settings, todayText());
  const paidEarly = [...paidEarlyPaydays(store, settings, todayText()), ...typedPay.replacedPaydays];
  for (const typed of typedPay.list) if (typed.date.startsWith(yearMonth)) { result.count++; result.amount += typed.amount; }
  for (let day = Number(todayText().slice(8, 10)) + 1; day <= lastDayOfMonth; day++) {
    const dateText = `${yearMonth}-${String(day).padStart(2, "0")}`;
    if (isPaydayOn(settings.paycheck, dateText) && !paidEarly.includes(dateText)) { result.count++; result.amount += usualPay; }
  }
  return result;
}

// Home: this month at a glance. Earned and expected pay against everything spent plus bills still to pay.
// Bills and subscriptions due and not charged yet, plus the ones still to come later this month, soonest first.
function billsStillToPay(billMatches, yearMonth) {
  const month = billMatches.byMonth[yearMonth] || {};
  return [...(month.unseen || []), ...(month.upcoming || [])].sort((first, second) => first.expected.localeCompare(second.expected));
}

function showMonthOutlook(settings) {
  const box = document.getElementById("month-outlook");
  const store = loadTransactionStore();
  const yearMonth = todayText().slice(0, 7);
  if (spendingCharges(store).length === 0) { box.innerHTML = ""; return; }
  const billMatches = matchBills(settings, store, loadBillMarks(), todayText());
  // Everything else = non-bill spending, plus money sent out by Zelle, Venmo and transfers, minus money received that way.
  const transfers = transfersInMonth(store, yearMonth, settings, (charge) => Boolean(billMatches.billCharges[charge.transaction_id]));
  const everythingElse = monthlyBreakdown(nonBillCharges(settings, store, billMatches), yearMonth).total + transfers.totalOut - transfers.totalIn;
  const billsCharged = Object.values(store.transactions).filter((charge) => billMatches.billCharges[charge.transaction_id] && charge.date.startsWith(yearMonth) && charge.amount > 0).reduce((sum, charge) => sum + charge.amount, 0);
  const billsUnpaid = billsStillToPay(billMatches, yearMonth).reduce((sum, bill) => sum + bill.amount, 0);
  const earnedSoFar = earnedInMonth(store, yearMonth, settings).total;
  const ahead = paydaysAhead(settings, store, yearMonth);
  const money = (amount) => formatMoney(Math.round(amount * 100) / 100);
  const estimatedEarned = earnedSoFar + ahead.amount;
  const estimatedSpent = everythingElse + billsCharged + billsUnpaid;
  const left = estimatedEarned - estimatedSpent;
  const scale = Math.max(estimatedEarned, estimatedSpent, 1);
  const percent = (amount) => Math.max(0, Math.min(100, (amount / scale) * 100));
  const legend = (className, label, amount) => `<div class="outlook-legend-item"><span class="dot ${className}"></span><span class="small">${label}</span><b>${money(amount)}</b></div>`;
  box.innerHTML = `<div class="tile outlook-tile ${left >= 0 ? "good" : "warning"}">
    <div class="small">Left to spend this month (estimate)</div>
    <div class="huge-number ${left >= 0 ? "positive" : "negative"}">${money(left)}</div>
    <div class="outlook-bar">
      <div class="seg seg-else" style="width:${percent(everythingElse)}%"></div>
      <div class="seg seg-bills" style="width:${percent(billsCharged)}%"></div>
      <div class="seg seg-unpaid" style="width:${percent(billsUnpaid)}%"></div>
      <div class="seg seg-left" style="width:${percent(left)}%"></div>
    </div>
    <div class="outlook-legend">
      ${legend("dot-else", "Spent", everythingElse)}${legend("dot-bills", "Bills paid", billsCharged)}
      ${legend("dot-unpaid", "Bills to pay", billsUnpaid)}${legend("dot-left", "Left", Math.max(left, 0))}
    </div>
    <div class="outlook-rows">
      <div class="tile-row"><span>Earned so far</span><b class="positive">${money(earnedSoFar)}</b></div>
      <div class="tile-row"><span>${ahead.known ? `${ahead.count} more payday${ahead.count === 1 ? "" : "s"}` : "More paydays"}</span><b>+${money(ahead.amount)}</b></div>
      <div class="tile-row outlook-total"><span>Estimated earned</span><b>${money(estimatedEarned)}</b></div>
      <div class="tile-row"><span>Estimated spent, with bills still to pay</span><b>&minus;${money(estimatedSpent)}</b></div>
    </div></div>`;
}

function showSpendingPage(settings) {
  const page = document.getElementById("page-spending");
  const store = loadTransactionStore();
  const marks = loadBillMarks();
  const billMatches = matchBills(settings, store, marks, todayText());
  const isBill = (charge) => Boolean(billMatches.billCharges[charge.transaction_id]);
  const allCharges = spendingCharges(store);
  const charges = nonBillCharges(settings, store, billMatches);
  if (allCharges.length === 0) {

  page.innerHTML = `<h2>Spending</h2><div class="tile small">${localStorage.getItem("finance_relay_address") ? "No transactions yet. Tap the refresh button at the top. The bank shares about the last 90 days, and the app keeps everything it receives from then on." : "This page fills in from your bank, so it stays empty until you link one. Linking is optional; Settings and the README explain how."}</div>`;
    return;
  }
  const months = monthsWithSpending(allCharges);
  if (!months.includes(spendingMonthShown)) spendingMonthShown = months[0];
  const position = months.indexOf(spendingMonthShown);
  const month = monthlyBreakdown(charges, spendingMonthShown);
  const transfers = transfersInMonth(store, spendingMonthShown, settings, isBill);
  const everythingElseTotal = Math.round((month.total + transfers.totalOut - transfers.totalIn) * 100) / 100;
  const olderMonth = months[position + 1];
  const newerMonth = months[position - 1];
  const monthButton = (label, target) => target ? `<button class="small-button" data-spending-month="${target}">${label}</button>` : `<button class="small-button" disabled>${label}</button>`;

    // Bills and subscriptions in this month (leftover from the totals above) and the ones not seen yet.
  const billRows = Object.values(store.transactions).filter((charge) => isBill(charge) && charge.date.startsWith(spendingMonthShown) && charge.amount > 0).sort((first, second) => first.date.localeCompare(second.date));
  const billsTotal = billRows.reduce((sum, charge) => sum + charge.amount, 0);
  const notSeen = billsStillToPay(billMatches, spendingMonthShown);
  const stillToPay = Math.round(notSeen.reduce((sum, bill) => sum + bill.amount, 0) * 100) / 100;
  const billsSharePercent = billsTotal > 0 ? Math.round((billsTotal / (billsTotal + everythingElseTotal)) * 100) : 0;
  const stillToPayLine = spendingMonthShown === todayText().slice(0, 7) ? `<div class="small">${formatMoney(stillToPay)} of bills and subscriptions still to pay this month</div>` : "";
  const billsTile = billRows.length || notSeen.length ? `<details class="tile category-tile spending-accent" style="--tile-accent:var(--warning)"><summary><div class="tile-row"><b>Bills and subscriptions</b><b>${formatMoney(billsTotal)}</b></div>
      <div class="small">${billRows.length} charge${billRows.length === 1 ? "" : "s"}</div></summary>
    ${billRows.map((charge) => {
      const markedByHand = billMatches.billCharges[charge.transaction_id] === "Marked by you";
      const button = markedByHand ? `<button class="mark-button" data-unmark-bill="${charge.transaction_id}">not a bill</button>` : "";
      return chargeRowHtml(settings, store, { ...charge, merchant_name: billMatches.billCharges[charge.transaction_id] + " · " + merchantName(charge) }, button);
    }).join("")}
    ${notSeen.length ? `<div class="small not-seen"><b>Still to pay this month</b>${notSeen.map((bill) => `<div class="tile-row small"><span>${escapeHtml(bill.name)} (due ${shortMonthDay(bill.expected)})</span><span>${formatMoney(bill.amount)}</span></div>`).join("")}</div>` : ""}</details>` : "";

  const pending = pendingCharges(store).filter((charge) => !isBill(charge) && charge.date.startsWith(spendingMonthShown));
  const pendingTile = pending.length ? `<details class="tile category-tile spending-accent" style="--tile-accent:var(--warning)"><summary><div class="tile-row"><b>Pending</b><b class="amber-text">${formatMoney(pending.reduce((sum, charge) => sum + charge.amount, 0))}</b></div>
</summary>${pending.map((charge) => chargeRowHtml(settings, store, charge)).join("")}</details>` : "";

  const categoryRows = month.categories.map((entry) => `<details class="tile category-tile spending-accent" style="--tile-accent:${CATEGORY_COLORS[entry.category] || "var(--muted-text)"}">
    <summary><div class="tile-row"><b>${entry.name}</b><b>${formatMoney(entry.total)}</b></div>
      <div class="bar"><div class="bar-fill" style="width:${entry.share}%"></div></div>
      <div class="small">${entry.share}% of the month · ${entry.charges.length} charge${entry.charges.length === 1 ? "" : "s"}</div></summary>
    ${entry.charges.map((charge) => chargeRowHtml(settings, store, charge, `<button class="mark-button" data-mark-bill="${charge.transaction_id}">mark as bill</button>`)).join("")}</details>`).join("");

  const isCurrentMonthShown = spendingMonthShown === todayText().slice(0, 7);
  const earned = earnedInMonth(store, spendingMonthShown, settings);
  const ahead = paydaysAhead(settings, store, spendingMonthShown);
  const paydaysLeft = ahead.count;
  const expectedPayLeft = ahead.amount;
  const expectedLine = ahead.known ? `${earned.count} deposit${earned.count === 1 ? "" : "s"} \u00b7 ${formatMoney(earned.total + expectedPayLeft)} expected by month end` : `${earned.count} deposit${earned.count === 1 ? "" : "s"}`;
  const payRow = (dateText, amount, extra = "", chips = "") => `<div class="pay-row${extra}"><span>${shortMonthDay(dateText)}${chips}</span><b class="positive">${formatMoney(amount)}</b></div>`;
  const depositRows = earned.deposits.map((deposit) => payRow(deposit.date, -deposit.amount, "", deposit.pending ? `<span class="pay-chip">pending</span>` : "")).join("");
  // Paychecks typed in by hand: tap the chip to say whether the bank balance already holds it; swipe the row to delete.
  const typedPayRows = isCurrentMonthShown ? expectedPaychecks(store, settings, todayText()).list.map((entry) => `<div class="pay-row tile-row"><span>${shortMonthDay(entry.date)}<span class="pay-chip">upcoming</span><button class="pay-chip pay-chip-button${entry.in_balance ? " pay-chip-good" : ""}" data-toggle-typed-pay="${entry.date}">${entry.in_balance ? "in balance \u2713" : "arrives that day"}</button></span><b class="positive">${formatMoney(entry.amount)}</b><button class="remove-link" data-remove-typed-pay="${entry.date}">remove</button></div>`).join("") : "";
  const typedPayForm = isCurrentMonthShown ? `<details class="add-pay"><summary>+ Add upcoming paycheck</summary>
    <div class="add-pay-grid"><input id="typed-pay-date" type="date" value="${todayText()}"><input id="typed-pay-amount" type="number" inputmode="decimal" placeholder="Amount ($)"></div>
    <select id="typed-pay-in-balance"><option value="">Arrives on that date</option><option value="yes">Already in my bank balance</option></select>
    <button id="typed-pay-add">Add</button><div id="typed-pay-message" class="small"></div></details>` : "";
  const earnedTile = `<details class="tile category-tile spending-accent no-swipe-parent" style="--tile-accent:var(--good)"${earnedTileOpen ? " open" : ""}><summary><div class="small">Earned this month</div><div class="big-number positive">${formatMoney(earned.total)}</div>
    <div class="small">${expectedLine}</div></summary>${depositRows}${typedPayRows}${typedPayForm}</details>`;

  // Estimated month: pay earned plus paychecks still ahead, minus everything spent plus bills still to pay.
  const isCurrentMonth = spendingMonthShown === todayText().slice(0, 7);
  const estimatedEarned = earned.total + expectedPayLeft;
  const estimatedSpent = everythingElseTotal + billsTotal + (isCurrentMonth ? stillToPay : 0);
  const leftToSpend = Math.round((estimatedEarned - estimatedSpent) * 100) / 100;
  const leftTile = `<div class="tile ${leftToSpend >= 0 ? "good" : "warning"}"><div class="small">${isCurrentMonth ? "Estimated left to spend this month" : "Left over this month"}</div>
    <div class="big-number ${leftToSpend >= 0 ? "positive" : "negative"}">${formatMoney(leftToSpend)}</div>
    <div class="tile-row small"><span>${isCurrentMonth ? "Estimated earned" : "Earned"}</span><span>${formatMoney(estimatedEarned)}</span></div>
    <div class="tile-row small"><span>Total spent${isCurrentMonth ? " + unpaid bills" : ""}</span><span>&minus;${formatMoney(estimatedSpent)}</span></div></div>`;

  const transferRows = transfers.items.map((transfer) => `<div class="tile-row small"><span>${shortMonthDay(transfer.date)} · ${escapeHtml(merchantName(transfer))}</span><span class="amount-nowrap ${transfer.amount < 0 ? "positive" : "negative"}">${transfer.amount < 0 ? "+" : "&minus;"}${formatMoney(Math.abs(transfer.amount))}</span></div>`).join("");
  const netTransfers = Math.round((transfers.totalIn - transfers.totalOut) * 100) / 100;
  const transfersTile = transfers.items.length ? `<details class="tile category-tile spending-accent" style="--tile-accent:${netTransfers >= 0 ? "var(--good)" : "var(--bad)"}"><summary><div class="tile-row"><b>Transfers</b><b class="${netTransfers >= 0 ? "positive" : "negative"}">${netTransfers >= 0 ? "+" : "&minus;"}${formatMoney(Math.abs(netTransfers))}</b></div>
    <div class="small">${transfers.items.length} transfer${transfers.items.length === 1 ? "" : "s"}</div></summary>${transferRows}</details>` : "";

  const biggestMerchant = Math.max(1, ...month.topMerchants.map((merchant) => merchant.amount));
  const merchantRows = month.topMerchants.map((merchant, position) => `<div class="place-row"><div class="tile-row"><span><span class="place-rank">${position + 1}</span>${escapeHtml(merchant.name)}</span><b>${formatMoney(merchant.amount)}</b></div>
    <div class="bar"><div class="bar-fill" style="width:${Math.round((merchant.amount / biggestMerchant) * 100)}%"></div></div></div>`).join("");

  page.innerHTML = `<h2>Spending</h2>
    <div class="tile-row month-nav">${monthButton("‹", olderMonth)}<b>${monthLabel(spendingMonthShown)}</b>${monthButton("›", newerMonth)}</div>
    <div class="tile"><div class="small">Total spent this month</div>
      <div class="huge-number">${formatMoney(Math.round((everythingElseTotal + billsTotal) * 100) / 100)}</div>
      <div class="split-bar"><div class="split-bills" style="width:${billsSharePercent}%"></div></div>
      <div class="split-columns">
        <div><div class="small"><span class="dot dot-bills"></span>Bills and subscriptions</div><div class="split-number">${formatMoney(billsTotal)}</div></div>
        <div class="split-right"><div class="small"><span class="dot dot-else"></span>Everything else</div><div class="split-number">${formatMoney(everythingElseTotal)}</div>${month.pendingTotal > 0 ? `<div class="small">incl. ${formatMoney(month.pendingTotal)} pending</div>` : ""}</div>
      </div>
      ${stillToPayLine}</div>
    ${earnedTile}
    ${leftTile}
    ${pendingTile}${categoryRows}${billsTile}${transfersTile}
    <div class="tile"><b>Top places</b>${merchantRows}</div>`;
}

document.addEventListener("click", (event) => {
  const monthButton = event.target.closest("[data-spending-month]");
  if (!monthButton) return;
  spendingMonthShown = monthButton.dataset.spendingMonth;
  earnedTileOpen = false;
  showSpendingPage(loadSettings());
});

document.addEventListener("click", (event) => {
  const markButton = event.target.closest("[data-mark-bill]");
  const unmarkButton = event.target.closest("[data-unmark-bill]");
  if (!markButton && !unmarkButton) return;
  event.preventDefault();
  const store = loadTransactionStore();
  const charge = store.transactions[(markButton || unmarkButton).dataset.markBill || (markButton || unmarkButton).dataset.unmarkBill];
  if (!charge) return;
  const key = billMarkKey(charge);
  const marks = loadBillMarks().filter((existing) => existing !== key);
  saveBillMarks(markButton ? [...marks, key] : marks);
  showSpendingPage(loadSettings());
});

// Type in an upcoming paycheck (date and amount) or remove one. It lives in settings.paycheck.expected_paychecks.
document.addEventListener("click", (event) => {
  const addButton = event.target.closest("#typed-pay-add");
  const removeButton = event.target.closest("[data-remove-typed-pay]");
  const toggleButton = event.target.closest("[data-toggle-typed-pay]");
  if (!addButton && !removeButton && !toggleButton) return;
  event.preventDefault();
  const settings = loadSettings();
  const typed = (settings.paycheck.expected_paychecks || []).filter((entry) => entry.date >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  if (addButton) {
    const date = document.getElementById("typed-pay-date").value;
    const amount = Number(document.getElementById("typed-pay-amount").value);
    if (!date || !(amount > 0)) { document.getElementById("typed-pay-message").textContent = "Pick the pay date and type the amount."; return; }
    settings.paycheck.expected_paychecks = [...typed.filter((entry) => entry.date !== date), { date, amount, in_balance: document.getElementById("typed-pay-in-balance").value === "yes" }];
  } else if (toggleButton) {
    settings.paycheck.expected_paychecks = typed.map((entry) => entry.date === toggleButton.dataset.toggleTypedPay ? { ...entry, in_balance: !entry.in_balance } : entry);
  } else {
    settings.paycheck.expected_paychecks = typed.filter((entry) => entry.date !== removeButton.dataset.removeTypedPay);
  }
  saveSettings(settings);
  earnedTileOpen = true;
  showEverything();
  showSpendingPage(settings);
});

// Pick a category for one charge. "Other..." asks for a new category name; "Back to automatic" clears your choice.
async function chooseCategoryForCharge(transactionId) {
  const settings = loadSettings();
  const charge = loadTransactionStore().transactions[transactionId];
  if (!settings || !charge) return;
  const overrides = settings.transaction_categories || {};
  const current = categoryOf(charge);
  const choices = spendingCategoryChoices(settings).map((category) => ({ title: categoryDisplayName(category), detail: "", value: category, current: category === current, color: CATEGORY_COLORS[category] || "#9ca3af" }));
  const otherPosition = choices.findIndex((choice) => choice.value === "OTHER");
  choices.splice(otherPosition, 1);
  choices.push({ title: "New category\u2026", detail: "Type a name", value: "__new__", wide: true });
  if (overrides[transactionId]) choices.push({ title: "Back to automatic", detail: "Use the keyword rules again", value: "__auto__", wide: true });
  const picked = await askChoice(`${merchantName(charge)} \u00b7 ${formatMoney(charge.amount)}`, choices, "category-picker");
  if (!picked) return;
  const openTiles = [...document.querySelectorAll("#page-spending details")].map((tile) => tile.open);
  let category = picked;
  if (picked === "__new__") {
    category = (prompt("Name for the new category") || "").trim();
    if (!category) return;
  }
  settings.transaction_categories = { ...overrides };
  if (category === "__auto__") delete settings.transaction_categories[transactionId];
  else settings.transaction_categories[transactionId] = category === "Other" ? "OTHER" : category;
  saveSettings(settings);
  setTransactionCategories(settings.transaction_categories);
  showSpendingPage(settings);
  [...document.querySelectorAll("#page-spending details")].forEach((tile, position) => { tile.open = Boolean(openTiles[position]); });
  showToast(category === "__auto__" ? "Back to automatic." : `Moved to ${categoryDisplayName(settings.transaction_categories[transactionId])}.`);
}
