// One-time page for connecting a bank login through Plaid. It holds no secrets:
// the relay address and app key are typed in and kept only in this browser.

const relayAddressInput = document.getElementById("relay-address");
const appKeyInput = document.getElementById("app-key");
const loginLabelInput = document.getElementById("login-label");
const loginKindInput = document.getElementById("login-kind");
const linkStatus = document.getElementById("link-status");

relayAddressInput.value = localStorage.getItem("finance_relay_address") || "";
appKeyInput.value = localStorage.getItem("finance_relay_key") || "";
loginLabelInput.value = localStorage.getItem("finance_link_label") || "";

async function askRelay(path, body) {
  const response = await fetch(relayAddressInput.value.replace(/\/$/, "") + path, {
    method: body ? "POST" : "GET",
    headers: { "x-finance-key": appKeyInput.value, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Relay said no");
  return data;
}

function openPlaidLink(linkToken, receivedRedirectUri) {
  const handler = Plaid.create({
    token: linkToken,
    receivedRedirectUri,
    onSuccess: async (publicToken) => {
      linkStatus.textContent = "Saving...";
      try {
        await askRelay("/exchange", { public_token: publicToken, label: loginLabelInput.value });
        linkStatus.textContent = "Linked. You can close this page.";
        localStorage.removeItem("finance_link_token");
      } catch (error) { linkStatus.textContent = "Could not save: " + error.message; }
    },
    onExit: () => { if (!linkStatus.textContent.startsWith("Linked")) linkStatus.textContent = "Closed before finishing."; },
  });
  handler.open();
}

document.getElementById("link-button").addEventListener("click", async () => {
  localStorage.setItem("finance_relay_address", relayAddressInput.value);
  localStorage.setItem("finance_relay_key", appKeyInput.value);
  localStorage.setItem("finance_link_label", loginLabelInput.value);
  linkStatus.textContent = "Starting...";
  try {
    const { link_token } = await askRelay("/link-token", { kind: loginKindInput.value });
    localStorage.setItem("finance_link_token", link_token);
    openPlaidLink(link_token);
  } catch (error) { linkStatus.textContent = "Could not start: " + error.message; }
});

// Coming back from a bank's own login page: reopen Link where it left off.
if (window.location.search.includes("oauth_state_id")) {
  const savedToken = localStorage.getItem("finance_link_token");
  if (savedToken) openPlaidLink(savedToken, window.location.href);
}
