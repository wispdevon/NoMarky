const enabled = document.querySelector("#enabled");
const autoJump = document.querySelector("#autoJump");
const extensionApi = globalThis.browser ?? globalThis.chrome;

function storageGet(defaults, callback) {
  const result = extensionApi.storage.sync.get(defaults, callback);

  if (result?.then) {
    result.then(callback);
  }
}

function storageSet(values) {
  extensionApi.storage.sync.set(values);
}

storageGet({ enabled: true, autoJump: true }, (settings) => {
  enabled.checked = Boolean(settings.enabled);
  autoJump.checked = Boolean(settings.autoJump);
});

enabled.addEventListener("change", () => {
  storageSet({ enabled: enabled.checked });
});

autoJump.addEventListener("change", () => {
  storageSet({ autoJump: autoJump.checked });
});
