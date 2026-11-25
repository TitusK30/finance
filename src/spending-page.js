// The Spending page, plus the phone's saved copy of your transactions.
// Transactions are kept on this phone only, apart from your settings.

const TRANSACTIONS_KEY = "finance_os_transactions";
const BILL_MARKS_KEY = "finance_os_bill_marks";
let spendingMonthShown = null;

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
  return `<div class="tile-row small charge-row"><span>${shortMonthDay(charge.date)} · ${escapeHtml(merchantName(charge))}${pendingTag}<br><span class="charge-card">${escapeHtml(cardName)}</span></span><span>${formatMoney(charge.amount)}<br>${markButton}</span></div>`;
}

function monthLabel(yearMonth) {
  return new Date(yearMonth + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function showSpendingPage(settings) {
  const page = document.getElementById("page-spending");
  const store = loadTransactionStore();
  const marks = loadBillMarks();
  const billMatches = matchBills(settings, store, marks, todayText());
  const isBill = (charge) => Boolean(billMatches.billCharges[charge.transaction_id]);
  const allCharges = spendingCharges(store);
  // Charges that fit your refill-style subscription (the toll tag) by text go to the Tolls category.
  const refillBills = recurringBills(settings).filter((bill) => bill.anyDay);
  const charges = allCharges.filter((charge) => !isBill(charge)).map((charge) => refillBills.some((bill) => textMatches(bill, charge)) ? { ...charge, category: "TOLLS" } : charge);
  if (allCharges.length === 0) {

  page.innerHTML = `<h2>Spending</h2><div class="tile small">${localStorage.getItem("finance_relay_address") ? "No transactions yet. Tap the refresh button at the top. The bank shares about the last 90 days, and the app keeps everything it receives from then on." : "This page fills in from your bank, so it stays empty until you link one. Linking is optional; Settings and the README explain how."}</div>`;
    return;
  }
  const months = monthsWithSpending(allCharges);
  if (!months.includes(spendingMonthShown)) spendingMonthShown = months[0];
  const position = months.indexOf(spendingMonthShown);
  const month = monthlyBreakdown(charges, spendingMonthShown);
  const olderMonth = months[position + 1];
  const newerMonth = months[position - 1];
  const monthButton = (label, target) => target ? `<button class="small-button" data-spending-month="${target}">${label}</button>` : `<button class="small-button" disabled>${label}</button>`;

    // Bills and subscriptions in this month (leftover from the totals above) and the ones not seen yet.
  const billRows = Object.values(store.transactions).filter((charge) => isBill(charge) && charge.date.startsWith(spendingMonthShown) && charge.amount > 0).sort((first, second) => first.date.localeCompare(second.date));
  const billsTotal = billRows.reduce((sum, charge) => sum + charge.amount, 0);
  const notSeen = (billMatches.byMonth[spendingMonthShown] || { unseen: [] }).unseen;
  const stillToPay = Math.round(notSeen.reduce((sum, bill) => sum + bill.amount, 0) * 100) / 100;
  const stillToPayLine = spendingMonthShown === todayText().slice(0, 7) ? `<div class="small">${formatMoney(stillToPay)} of bills and subscriptions still to pay this month</div>` : "";
  const billsTile = billRows.length || notSeen.length ? `<details class="tile category-tile"><summary><div class="tile-row"><b>Bills and subscriptions</b><b>${formatMoney(billsTotal)}</b></div>
      <div class="small">${billRows.length} charge${billRows.length === 1 ? "" : "s"}, not counted in the totals above</div></summary>
    ${billRows.map((charge) => {
      const markedByHand = billMatches.billCharges[charge.transaction_id] === "Marked by you";
      const button = markedByHand ? `<button class="mark-button" data-unmark-bill="${charge.transaction_id}">not a bill</button>` : "";
      return chargeRowHtml(settings, store, { ...charge, merchant_name: billMatches.billCharges[charge.transaction_id] + " · " + merchantName(charge) }, button);
    }).join("")}
    ${notSeen.length ? `<div class="small not-seen"><b>Not seen yet this month</b>${notSeen.map((bill) => `<div class="tile-row small"><span>${escapeHtml(bill.name)} (due ${shortMonthDay(bill.expected)})</span><span>${formatMoney(bill.amount)}</span></div>`).join("")}</div>` : ""}</details>` : "";

  const pending = pendingCharges(store).filter((charge) => !isBill(charge));
  const pendingTile = pending.length ? `<details class="tile category-tile"><summary><div class="tile-row"><b>Pending</b><b class="amber-text">${formatMoney(pending.reduce((sum, charge) => sum + charge.amount, 0))}</b></div>
    <div class="small">Charged, but not on your balance yet. Some banks do not share these.</div></summary>${pending.map((charge) => chargeRowHtml(settings, store, charge)).join("")}</details>` : "";

  const categoryRows = month.categories.map((entry) => `<details class="tile category-tile">
    <summary><div class="tile-row"><b>${entry.name}</b><b>${formatMoney(entry.total)}</b></div>
      <div class="bar"><div class="bar-fill" style="width:${entry.share}%"></div></div>
      <div class="small">${entry.share}% of the month · ${entry.charges.length} charge${entry.charges.length === 1 ? "" : "s"}</div></summary>
    ${entry.charges.map((charge) => chargeRowHtml(settings, store, charge, `<button class="mark-button" data-mark-bill="${charge.transaction_id}">mark as bill</button>`)).join("")}</details>`).join("");

  // This month against last month. A month still in progress is compared with the same days last month.
  const thisMonthText = todayText().slice(0, 7);
  const comparison = monthComparison(charges, spendingMonthShown, spendingMonthShown === thisMonthText ? Number(todayText().slice(8, 10)) : 31);
  const changeText = (difference) => difference === 0 ? "same" : `${difference > 0 ? "&#9650;" : "&#9660;"} ${formatMoney(Math.abs(difference))}`;
  const changeClass = (difference) => difference > 0 ? "up-text" : difference < 0 ? "down-text" : "";
  const comparisonTile = comparison.hasPrevious ? `<div class="tile"><div class="tile-row"><b>${spendingMonthShown === thisMonthText ? "Vs the same days last month" : "Vs the month before"}</b><b class="${changeClass(comparison.difference)}">${changeText(comparison.difference)}</b></div>
    <div class="small">${formatMoney(comparison.total)} now, ${formatMoney(comparison.previousTotal)} then</div>
    ${comparison.categories.filter((entry) => entry.difference !== 0).slice(0, 5).map((entry) => `<div class="tile-row small"><span>${entry.name}</span><span class="${changeClass(entry.difference)}">${changeText(entry.difference)}</span></div>`).join("")}</div>` : "";

  const earned = earnedInMonth(store, spendingMonthShown, settings);
  // Pay weekdays still ahead (after today) in the month being shown, only for the current month.
  const payWeekdayNumber = PAY_WEEKDAY_NUMBERS[settings.paycheck && settings.paycheck.pay_weekday];
  let paydaysLeft = 0;
  let expectedPayLeft = 0;
  const usualPay = usualPayDeposit(store, settings) ?? settings.paycheck.usual_take_home_amount;
  if (spendingMonthShown === todayText().slice(0, 7) && payWeekdayNumber !== undefined) {
    const lastDayOfMonth = new Date(Date.UTC(Number(spendingMonthShown.slice(0, 4)), Number(spendingMonthShown.slice(5, 7)), 0)).getUTCDate();
    for (let day = Number(todayText().slice(8, 10)) + 1; day <= lastDayOfMonth; day++) {
      const dayText = `${spendingMonthShown}-${String(day).padStart(2, "0")}`;
      if (new Date(dayText + "T00:00:00Z").getUTCDay() === payWeekdayNumber) {
        paydaysLeft++;
        expectedPayLeft += usualPay;
      }
    }
  }
  const paydaysLine = spendingMonthShown === todayText().slice(0, 7) && payWeekdayNumber !== undefined ? `<div class="small">${paydaysLeft} more payday${paydaysLeft === 1 ? "" : "s"} this month: ${formatMoney(earned.total + expectedPayLeft)}</div>` : "";
  const depositRows = earned.deposits.map((deposit) => `<div class="tile-row small"><span>${deposit.date}</span><span class="positive">${formatMoney(-deposit.amount)}</span></div>`).join("");
  const earnedTile = `<details class="tile category-tile"><summary><div class="small">Earned this month</div><div class="big-number positive">${formatMoney(earned.total)}</div>
    <div class="small">${earned.count} deposit${earned.count === 1 ? "" : "s"} to your bank accounts that look like pay</div>
    ${paydaysLine}</summary>${depositRows}</details>`;

  // Estimated month: pay earned plus paychecks still ahead, minus everything spent plus bills still to pay.
  const isCurrentMonth = spendingMonthShown === todayText().slice(0, 7);
  const estimatedEarned = earned.total + expectedPayLeft;
  const estimatedSpent = month.total + billsTotal + (isCurrentMonth ? stillToPay : 0);
  const leftToSpend = Math.round((estimatedEarned - estimatedSpent) * 100) / 100;
  const leftTile = `<div class="tile"><div class="small">${isCurrentMonth ? "Estimated left to spend this month" : "Left over this month"}</div>
    <div class="big-number ${leftToSpend >= 0 ? "positive" : "negative"}">${formatMoney(leftToSpend)}</div>
    <div class="tile-row small"><span>${isCurrentMonth ? "Estimated earned" : "Earned"}</span><span>${formatMoney(estimatedEarned)}</span></div>
    <div class="tile-row small"><span>Spent, bills and subscriptions${isCurrentMonth ? ", including unpaid" : ""}</span><span>&minus;${formatMoney(estimatedSpent)}</span></div></div>`;

  const merchantRows = month.topMerchants.map((merchant) => `<div class="tile-row small"><span>${escapeHtml(merchant.name)}</span><span>${formatMoney(merchant.amount)}</span></div>`).join("");

  page.innerHTML = `<h2>Spending</h2>
    <div class="tile-row month-nav">${monthButton("‹", olderMonth)}<b>${monthLabel(spendingMonthShown)}</b>${monthButton("›", newerMonth)}</div>
    <div class="tile"><div class="small">Spent this month</div><div class="big-number">${formatMoney(month.total)}</div>
      ${month.pendingTotal > 0 ? `<div class="small">includes ${formatMoney(month.pendingTotal)} pending</div>` : ""}
      <div class="small">Bills and subscriptions are left out.</div></div>
    <div class="tile"><div class="small">Total spent</div><div class="big-number">${formatMoney(Math.round((month.total + billsTotal) * 100) / 100)}</div>
      <div class="small">Spending plus ${formatMoney(billsTotal)} of bills and subscriptions that have already been charged</div>
      ${stillToPayLine}</div>
    ${earnedTile}
    ${leftTile}
    ${comparisonTile}${pendingTile}${categoryRows}${billsTile}
    <div class="tile"><b>Top places</b>${merchantRows}</div>
    <div class="small">Bills and subscriptions are matched by amount, timing and account, so a few may slip through: tap \"mark as bill\" on one and its twins are left out from then on. Card payments, transfers and paychecks are left out. Refunds count against the category. Categories come from the bank and Plaid, except that grocery stores, Amazon and tolls get their own categories by name, so a few will be off.</div>`;
}

document.addEventListener("click", (event) => {
  const monthButton = event.target.closest("[data-spending-month]");
  if (!monthButton) return;
  spendingMonthShown = monthButton.dataset.spendingMonth;
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
