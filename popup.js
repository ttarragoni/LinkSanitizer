document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleStatus');
  const statusLabel = document.getElementById('statusLabel');
  const counterEl = document.getElementById('counter');
  const btnResetCounter = document.getElementById('btnResetCounter');
  const txtWhitelist = document.getElementById('txtWhitelist');

  // Chiede lo stato aggiornato al background
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (!response) return;
    counterEl.textContent = response.cleanedCount || 0;
    toggle.checked = response.enabled !== undefined ? response.enabled : true;
    updateUIState(toggle.checked);
    if (response.allowlist) {
      txtWhitelist.value = response.allowlist.join('\n');
    }
  });

  // Salva la Whitelist Utente quando digita
  txtWhitelist.addEventListener('input', () => {
    const lines = txtWhitelist.value.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    chrome.storage.local.set({ allowlist: lines });
  });

  // Interruttore ON/OFF
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: isEnabled }, () => {
      updateUIState(isEnabled);
    });
  });

  function updateUIState(enabled) {
    if (enabled) {
      statusLabel.textContent = "● ATTIVO";
      statusLabel.style.color = "#00ff9d";
    } else {
      statusLabel.textContent = "○ DISATTIVATO";
      statusLabel.style.color = "#e53e3e";
    }
  }

  // Bottone Reset
  btnResetCounter.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: "RESET_COUNT" }, () => {
      counterEl.textContent = 0;
    });
  });
});