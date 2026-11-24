// 4-digit PIN lock. Only a salted hash of the PIN is stored on this phone, never the PIN itself.
// This keeps casual snoopers out. It does not encrypt your data.

const PIN_STORAGE_KEY = "finance_os_pin";
const RELOCK_AFTER_SECONDS = 30;

async function hashPin(pin, salt) {
  const bytes = new TextEncoder().encode(salt + ":" + pin);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

if (typeof module !== "undefined") module.exports = { hashPin };

if (typeof document !== "undefined") {
  const lockScreen = document.getElementById("lock-screen");
  const lockMessage = document.getElementById("lock-message");
  const lockError = document.getElementById("lock-error");
  const lockDots = [...document.querySelectorAll("#lock-dots span")];
  const lockPad = document.getElementById("lock-pad");
  const lockSideButton = document.getElementById("lock-side-button");
  const KEYPAD_LETTERS = { 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ" };
  let appIsLocked = false;
  let pendingRequest = null;
  let typedDigits = "";

  const readSavedPin = () => JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) || "null");

  // Phone-style number pad: 1-9, then a gap and 0.
  for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0]) {
    const key = document.createElement("button");
    if (digit === null) { key.className = "pad-gap"; key.disabled = true; }
    else { key.dataset.digit = digit; key.innerHTML = `${digit}${KEYPAD_LETTERS[digit] ? `<small>${KEYPAD_LETTERS[digit]}</small>` : ""}`; }
    lockPad.appendChild(key);
  }

  function refreshPinScreen() {
    lockDots.forEach((dot, position) => dot.classList.toggle("filled", position < typedDigits.length));
    const sideText = typedDigits.length > 0 ? "Delete" : pendingRequest && pendingRequest.canCancel ? "Cancel" : "";
    lockSideButton.textContent = sideText;
    lockSideButton.hidden = sideText === "";
  }

  function finishRequest(answer) {
    const { resolve } = pendingRequest;
    pendingRequest = null;
    typedDigits = "";
    lockScreen.hidden = true;
    resolve(answer);
  }

  lockPad.addEventListener("click", (event) => {
    const key = event.target.closest("[data-digit]");
    if (!key || !pendingRequest || typedDigits.length >= 4) return;
    typedDigits += key.dataset.digit;
    refreshPinScreen();
    if (typedDigits.length === 4) {
      const answer = typedDigits;
      setTimeout(() => { if (pendingRequest) finishRequest(answer); }, 150);
    }
  });

  lockSideButton.addEventListener("click", () => {
    if (typedDigits.length > 0) { typedDigits = typedDigits.slice(0, -1); refreshPinScreen(); }
    else if (pendingRequest && pendingRequest.canCancel) finishRequest(null);
  });

  // Shows the PIN screen and gives back the 4 digits typed, or null if cancelled.
  function askForPin(message, canCancel, errorText = "") {
    return new Promise((resolve) => {
      pendingRequest = { resolve, canCancel };
      typedDigits = "";
      lockMessage.textContent = message;
      lockError.textContent = errorText;
      lockScreen.hidden = false;
      refreshPinScreen();
    });
  }

  async function pinIsCorrect(enteredPin) {
    const saved = readSavedPin();
    return (await hashPin(enteredPin, saved.salt)) === saved.hash;
  }

  async function lockAppIfPinSet() {
    if (!readSavedPin() || appIsLocked) return;
    appIsLocked = true;
    let errorText = "";
    while (true) {
      const enteredPin = await askForPin("Enter Passcode", false, errorText);
      if (await pinIsCorrect(enteredPin)) break;
      errorText = "Wrong PIN. Try again.";
    }
    appIsLocked = false;
  }

  async function setOrChangePin() {
    if (readSavedPin()) {
      const currentPin = await askForPin("Enter your current PIN", true);
      if (currentPin === null) return;
      if (!(await pinIsCorrect(currentPin))) return alert("That is not your current PIN.");
    }
    const firstEntry = await askForPin("Choose a new 4-digit PIN", true);
    if (firstEntry === null) return;
    const secondEntry = await askForPin("Type it again to confirm", true);
    if (secondEntry === null) return;
    if (firstEntry !== secondEntry) return alert("The two PINs did not match. Nothing changed.");
    const salt = crypto.randomUUID();
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ salt, hash: await hashPin(firstEntry, salt) }));
    alert("PIN is set. The app asks for it when you open it.");
  }

  async function removePin() {
    if (!readSavedPin()) return alert("There is no PIN set.");
    const currentPin = await askForPin("Enter your PIN to remove it", true);
    if (currentPin === null) return;
    if (!(await pinIsCorrect(currentPin))) return alert("Wrong PIN. It was not removed.");
    localStorage.removeItem(PIN_STORAGE_KEY);
    alert("PIN removed.");
  }

  let leftTheAppAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) leftTheAppAt = Date.now();
    else if (Date.now() - leftTheAppAt > RELOCK_AFTER_SECONDS * 1000) lockAppIfPinSet();
  });

  // The Data buttons sit further down the page than this script, so wait for the page to finish loading.
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("set-pin-button").addEventListener("click", setOrChangePin);
    document.getElementById("remove-pin-button").addEventListener("click", removePin);
  });
  lockAppIfPinSet();
}
