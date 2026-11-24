// Turns what the relay returns (balances and card statement details) into this app's settings.
// Math only. It never talks to the network.

const syncTools = typeof module !== "undefined" ? { ...require("./forecast.js"), ...require("./summaries.js") } : { dueDateForCharge, nextStatementCloseDate };

const BANK_WORDS = ["capital", "one", "chase", "citi", "citibank", "card", "credit", "visa", "mastercard"];

function cents(amount) {
  return Math.round(amount * 100) / 100;
}

function plainWords(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

// "Capital One Venture X" -> ["venture"]. The bank's own name for the card has to contain every one.
function findCardAccount(card, creditAccounts, savedMask) {
  const bySavedMask = savedMask && creditAccounts.find((account) => account.mask === savedMask);
  if (bySavedMask) return bySavedMask;
  const wanted = plainWords(card.display_name).filter((word) => word.length > 1 && !BANK_WORDS.includes(word));
  if (wanted.length === 0) return null;
  const matches = creditAccounts.filter((account) => {
    const bankName = plainWords(account.name + " " + (account.official_name || ""));
    return wanted.every((word) => bankName.includes(word));
  });
  return matches.length === 1 ? matches[0] : null;
}

function findDepositAccount(subtype, depositAccounts, savedMask) {
  const sameKind = depositAccounts.filter((account) => account.subtype === subtype);
  const bySavedMask = savedMask && sameKind.find((account) => account.mask === savedMask);
  if (bySavedMask) return bySavedMask;
  return sameKind.length === 1 ? sameKind[0] : null;
}

// Closed = last statement still owed. Open = everything charged since.
function statementsFromBank(card, account, todayText) {
  const paidSinceStatement = account.last_payment_date && account.last_payment_date >= account.statement_issue_date ? account.last_payment_amount || 0 : 0;
  const closedOwed = cents(Math.max(0, account.statement_balance - paidSinceStatement));
  const closedIsStillDue = closedOwed > 0.005 && Boolean(account.next_due_date) && account.next_due_date >= todayText;
  const statements = [];
  if (closedIsStillDue) statements.push({ amount: closedOwed, statement_closed_on: account.statement_issue_date, due_date: account.next_due_date });
  const openAmount = cents(Math.max(0, account.current - (closedIsStillDue ? closedOwed : 0)));
  if (openAmount > 0.005) {
    const closeDate = syncTools.nextStatementCloseDate(card, todayText);
    statements.push({ amount: openAmount, statement_closes_on: closeDate, due_date: syncTools.dueDateForCharge(card, closeDate), still_accumulating: true });
  }
  return statements;
}

// Returns the updated settings, plus questions for anything the app could not match on its own.
function applyRefresh(settings, refresh, todayText) {
  const updated = structuredClone(settings);
  updated.account_masks = updated.account_masks || {};
  updated.card_masks = updated.card_masks || {};
  const result = { settings: updated, changed: [], skipped: [], needChoice: [] };
  const deposits = refresh.accounts.filter((account) => account.type === "depository");
  const credits = refresh.accounts.filter((account) => account.type === "credit");

  for (const slot of ["checking", "savings"]) {
    const account = findDepositAccount(slot, deposits, updated.account_masks[slot]);
    const candidates = deposits.filter((candidate) => candidate.subtype === slot);
    if (account) {
      updated.account_masks[slot] = account.mask;
      updated.starting_balances[slot + "_balance"] = account.available ?? account.current;
      if (slot === "checking") updated.starting_balances.as_of_date = todayText;
      result.changed.push(slot);
    } else if (candidates.length > 1) {
      result.needChoice.push({ label: "your " + slot, maskGroup: "account_masks", slot, candidates });
    }
  }

  // Retirement = every investment account that is not an HSA. HSA = any account the bank calls an HSA.
  const investments = refresh.accounts.filter((account) => account.type === "investment" || account.subtype === "hsa");
  const hsaAccounts = investments.filter((account) => account.subtype === "hsa");
  const retirementAccounts = investments.filter((account) => account.subtype !== "hsa");
  if (retirementAccounts.length > 0) {
    updated.retirement = { ...updated.retirement, balance: cents(retirementAccounts.reduce((sum, account) => sum + (account.current || 0), 0)) };
    result.changed.push("retirement");
  }
  if (hsaAccounts.length > 0) {
    updated.hsa = { ...updated.hsa, balance: cents(hsaAccounts.reduce((sum, account) => sum + (account.current || 0), 0)) };
    result.changed.push("HSA");
  }

  const claimedMasks = [];
  for (const [cardKey, card] of Object.entries(updated.credit_cards)) {
    const account = findCardAccount(card, credits, updated.card_masks[cardKey]);
    if (!account) continue;
    claimedMasks.push(account.mask);
    if (account.statement_balance == null || !account.statement_issue_date) { result.skipped.push(card.display_name + " (no statement details from the bank)"); continue; }
    updated.card_masks[cardKey] = account.mask;
    card.current_balance = account.current;
    if (account.limit) card.credit_limit = account.limit;
    card.balances_by_statement = statementsFromBank(card, account, todayText);
    result.changed.push(card.display_name);
  }
  const leftoverCredits = credits.filter((account) => !claimedMasks.includes(account.mask));
  for (const [cardKey, card] of Object.entries(updated.credit_cards)) {
    if (!updated.card_masks[cardKey] && leftoverCredits.length > 0) result.needChoice.push({ label: card.display_name, maskGroup: "card_masks", slot: cardKey, candidates: leftoverCredits });
  }
  return result;
}

if (typeof module !== "undefined") module.exports = { applyRefresh, findCardAccount };
