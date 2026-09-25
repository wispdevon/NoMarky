const DEFAULT_BLOCKED_CREATORS = [
  "markiplier",
  "markipliergame",
  "markiplier highlights",
  "markiplier twitch",
  "markiplier en espanol",
  "markiplier en español",
  "unus annus"
];

const textarea = document.querySelector("#blockedCreators");
const saveButton = document.querySelector("#save");
const restoreButton = document.querySelector("#restore");
const status = document.querySelector("#status");
const extensionApi = globalThis.browser ?? globalThis.chrome;

function storageGet(defaults, callback) {
  const result = extensionApi.storage.sync.get(defaults, callback);

  if (result?.then) {
    result.then(callback);
  }
}

function storageSet(values, callback) {
  const result = extensionApi.storage.sync.set(values, callback);

  if (result?.then) {
    result.then(() => callback?.());
  }
}

function showStatus(message) {
  status.textContent = message;
  window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

function setTextarea(creators) {
  textarea.value = creators.join("\n");
}

storageGet(
  { blockedCreators: DEFAULT_BLOCKED_CREATORS },
  ({ blockedCreators }) => {
    setTextarea(Array.isArray(blockedCreators) ? blockedCreators : DEFAULT_BLOCKED_CREATORS);
  }
);

saveButton.addEventListener("click", () => {
  const blockedCreators = textarea.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  storageSet({ blockedCreators }, () => showStatus("Saved"));
});

restoreButton.addEventListener("click", () => {
  storageSet(
    { blockedCreators: DEFAULT_BLOCKED_CREATORS },
    () => {
      setTextarea(DEFAULT_BLOCKED_CREATORS);
      showStatus("Defaults restored");
    }
  );
});
