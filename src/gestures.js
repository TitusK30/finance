// Swipe left on a row to reveal Delete. The Delete button presses the row's own remove control,
// so every existing "are you sure" check still applies.

const DELETE_CONTROLS = "[data-remove-todo], [data-remove-goal], [data-remove-entry], [data-remove-expected], [data-remove-benefit], [data-remove-overtime], [data-whatif-remove], [data-setup-remove-card], [data-setup-remove-bill], [data-setup-remove-subscription], [data-setup-remove-override], [data-setup-remove-othercard], [data-setup-remove-benefit], [data-setup-remove-rule], [data-remove-typed-pay], [data-remove-hsa-item]";
const SWIPE_REVEAL_PIXELS = 90;
const SWIPE_TO_OPEN_PIXELS = 50;
let swipeRow = null;
let swipeFrom = null;
let swipeDistance = 0;
let swipeIsHorizontal = false;

// The biggest block around the touch that holds exactly one remove control (so a whole task, not a whole list).
function rowToSwipe(target) {
  let found = null;
  for (let element = target.closest(".charge-row, .tile, .tile-row"); element; element = element.parentElement) {
    if (element.querySelectorAll(DELETE_CONTROLS).length > 1 || element.matches(".no-swipe-parent")) break; // a tile marked no-swipe-parent is never swiped as a whole
    if (element.querySelectorAll(DELETE_CONTROLS).length === 1 && element.matches(".charge-row, .tile, .tile-row")) found = element;
  }
  return found;
}

function closeSwipedRows(exceptRow) {
  for (const row of document.querySelectorAll(".swiped")) {
    if (row === exceptRow) continue;
    row.classList.remove("swiped");
    row.style.transform = "";
  }
}

document.addEventListener("touchstart", (event) => {
  const touch = event.touches[0];
  const row = rowToSwipe(event.target);
  closeSwipedRows(row);
  swipeRow = row;
  swipeFrom = { x: touch.clientX, y: touch.clientY };
  swipeDistance = 0;
  swipeIsHorizontal = false;
  if (row && !row.querySelector(".swipe-delete")) {
    row.classList.add("swipe-row");
    const deleteButton = document.createElement("button");
    deleteButton.className = "swipe-delete";
    deleteButton.textContent = "Delete";
    row.appendChild(deleteButton);
  }
}, { passive: true });

document.addEventListener("touchmove", (event) => {
  if (!swipeRow) return;
  const sideways = event.touches[0].clientX - swipeFrom.x;
  const upDown = event.touches[0].clientY - swipeFrom.y;
  if (!swipeIsHorizontal && Math.abs(sideways) > 10 && Math.abs(sideways) > Math.abs(upDown) * 1.5) swipeIsHorizontal = true;
  if (!swipeIsHorizontal) return;
  const alreadyOpen = swipeRow.classList.contains("swiped") ? -SWIPE_REVEAL_PIXELS : 0;
  swipeDistance = Math.max(-SWIPE_REVEAL_PIXELS, Math.min(0, alreadyOpen + sideways));
  swipeRow.style.transition = "none";
  swipeRow.style.transform = `translateX(${swipeDistance}px)`;
  event.preventDefault(); // a sideways swipe on a row moves only the row, never the page
}, { passive: false });

function finishSwipe() {
  if (!swipeRow || !swipeIsHorizontal) { swipeRow = null; return; }
  swipeRow.style.transition = "";
  const open = swipeDistance <= -SWIPE_TO_OPEN_PIXELS;
  swipeRow.classList.toggle("swiped", open);
  swipeRow.style.transform = open ? `translateX(-${SWIPE_REVEAL_PIXELS}px)` : "";
  if (open && navigator.vibrate) navigator.vibrate(8);
  swipeRow = null;
}
document.addEventListener("touchend", finishSwipe, { passive: true });
document.addEventListener("touchcancel", finishSwipe, { passive: true }); // iOS can cancel a touch mid-swipe; snap open or shut instead of sticking halfway

document.addEventListener("click", (event) => {
  if (!event.target.classList.contains("swipe-delete")) return;
  event.stopPropagation();
  const row = event.target.closest(".swipe-row");
  const control = row.querySelector(DELETE_CONTROLS);
  row.classList.remove("swiped");
  row.style.transform = "";
  control.click();
}, true);

// Long-press a charge on the Spending page to move it to another category (no animation: the list simply opens).
const LONG_PRESS_MS = 550;
let longPressTimer = null;
let longPressStart = null;
let longPressFired = false;

document.addEventListener("touchstart", (event) => {
  const row = event.target.closest("#page-spending .charge-row[data-charge-id], #page-bills .bill-tile[data-bill-source]");
  longPressFired = false;
  clearTimeout(longPressTimer);
  if (!row) return;
  longPressStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  longPressTimer = setTimeout(() => {
    longPressFired = true;
    if (row.dataset.billSource) editBillItem(row.dataset.billSource, Number(row.dataset.billIndex));
    else chooseCategoryForCharge(row.dataset.chargeId);
  }, LONG_PRESS_MS);
}, { passive: true });

document.addEventListener("touchmove", (event) => {
  if (!longPressTimer) return;
  const moved = Math.abs(event.touches[0].clientX - longPressStart.x) + Math.abs(event.touches[0].clientY - longPressStart.y);
  if (moved > 10) { clearTimeout(longPressTimer); longPressTimer = null; }
}, { passive: true });

document.addEventListener("touchend", () => { clearTimeout(longPressTimer); longPressTimer = null; }, { passive: true });
document.addEventListener("touchcancel", () => { clearTimeout(longPressTimer); longPressTimer = null; }, { passive: true });
document.addEventListener("contextmenu", (event) => { if (event.target.closest("#page-spending .charge-row, #page-bills .bill-tile")) event.preventDefault(); });
// The tap that ends a long-press must not also open or toggle anything.
document.addEventListener("click", (event) => { if (longPressFired) { longPressFired = false; event.preventDefault(); event.stopPropagation(); } }, true);

// Swipe any bottom sheet down from its top edge (the little grab bar) to close it. Tapping outside still works too.
// Closing is done by clicking the dimmed background, so each sheet's own "cancel" code runs.
(() => {
  let drag = null;
  document.addEventListener("touchstart", (event) => {
    const box = event.target.closest(".category-picker .date-box");
    if (!box || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (touch.clientY - box.getBoundingClientRect().top > 56 || box.scrollTop > 4) return;
    drag = { box, startY: touch.clientY, lastY: touch.clientY, lastTime: Date.now(), speed: 0, offset: 0 };
    box.style.transition = "none";
  }, { passive: true });
  document.addEventListener("touchmove", (event) => {
    if (!drag) return;
    const y = event.touches[0].clientY;
    const now = Date.now();
    drag.speed = (y - drag.lastY) / Math.max(1, now - drag.lastTime);
    drag.lastY = y;
    drag.lastTime = now;
    drag.offset = Math.max(0, y - drag.startY);
    drag.box.style.transform = `translateY(${drag.offset}px)`;
    event.preventDefault();
  }, { passive: false });
  const letGo = () => {
    if (!drag) return;
    const { box, offset, speed } = drag;
    drag = null;
    const cover = box.parentElement;
    box.style.transition = "transform 0.2s ease-out";
    if (offset > 110 || (offset > 30 && speed > 0.6)) {
      box.style.transform = "translateY(100%)";
      cover.style.transition = "opacity 0.2s";
      cover.style.opacity = "0";
      setTimeout(() => cover.click(), 190);
    } else {
      box.style.transform = "";
    }
  };
  document.addEventListener("touchend", letGo);
  document.addEventListener("touchcancel", letGo);
})();
