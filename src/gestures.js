// Swipe left on a row to reveal Delete. The Delete button presses the row's own remove control,
// so every existing "are you sure" check still applies.

const DELETE_CONTROLS = "[data-remove-todo], [data-remove-goal], [data-remove-entry], [data-remove-expected], [data-remove-benefit], [data-remove-overtime], [data-whatif-remove], [data-setup-remove-card], [data-setup-remove-bill], [data-setup-remove-subscription], [data-setup-remove-override], [data-setup-remove-othercard], [data-setup-remove-benefit]";
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
    if (element.querySelectorAll(DELETE_CONTROLS).length > 1) break;
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

document.addEventListener("touchend", () => {
  if (!swipeRow || !swipeIsHorizontal) { swipeRow = null; return; }
  swipeRow.style.transition = "";
  const open = swipeDistance <= -SWIPE_TO_OPEN_PIXELS;
  swipeRow.classList.toggle("swiped", open);
  swipeRow.style.transform = open ? `translateX(-${SWIPE_REVEAL_PIXELS}px)` : "";
  if (open && navigator.vibrate) navigator.vibrate(8);
  swipeRow = null;
}, { passive: true });

document.addEventListener("click", (event) => {
  if (!event.target.classList.contains("swipe-delete")) return;
  event.stopPropagation();
  const row = event.target.closest(".swipe-row");
  const control = row.querySelector(DELETE_CONTROLS);
  row.classList.remove("swiped");
  row.style.transform = "";
  control.click();
}, true);
