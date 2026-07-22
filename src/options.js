"use strict";

const select = document.querySelector("#inspect-modifier");
const save = document.querySelector("#save");
const status = document.querySelector("#status");
const modifierKey = document.querySelector("#inspect-modifier-key");
const togglePanelShortcut = document.querySelector("#toggle-panel-shortcut");

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const modifierLabels = {
  Alt: isMac ? "Option" : "Alt",
  Control: isMac ? "Control" : "Ctrl",
  Shift: "Shift",
  Meta: isMac ? "Command" : "Windows",
};

function renderModifierKey() {
  modifierKey.textContent = modifierLabels[select.value] || select.value;
}

function renderKeyGroup(container, shortcut) {
  container.replaceChildren();
  const parts = shortcut.split("+");
  const commandKeyLabels = {
    Alt: isMac ? "Option" : "Alt",
    Command: "Command",
    Ctrl: isMac ? "Command" : "Ctrl",
    MacCtrl: "Control",
    Option: "Option",
  };
  parts.forEach((part, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.textContent = "+";
      container.append(separator);
    }
    const key = document.createElement("kbd");
    key.textContent = commandKeyLabels[part] || part;
    container.append(key);
  });
}

chrome.storage.local.get({ inspectModifier: "Alt" }).then((settings) => {
  select.value = settings.inspectModifier;
  renderModifierKey();
});

chrome.commands.getAll().then((commands) => {
  const toggleCommand = commands.find((command) => command.name === "toggle-panel");
  if (toggleCommand?.shortcut) renderKeyGroup(togglePanelShortcut, toggleCommand.shortcut);
});

select.addEventListener("change", renderModifierKey);

save.addEventListener("click", async () => {
  await chrome.storage.local.set({ inspectModifier: select.value });
  status.textContent = "Saved.";
  setTimeout(() => { status.textContent = ""; }, 1_500);
});
