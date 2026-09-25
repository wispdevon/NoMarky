const DEFAULT_BLOCKED_CREATORS = [
  "markiplier",
  "markipliergame",
  "markiplier highlights",
  "markiplier twitch",
  "markiplier en espanol",
  "markiplier en español",
  "unus annus"
];

const extensionApi = globalThis.browser ?? globalThis.chrome;

const state = {
  enabled: true,
  autoJump: true,
  blockedCreators: DEFAULT_BLOCKED_CREATORS,
  lastAutoJumpVideoId: null,
  autoJumpInProgress: false,
  fallbackInProgress: false,
  lastCandidateToastAt: 0,
  lastVerboseToastAt: 0,
  scanTimer: null
};

const SIDEBAR_ITEM_SELECTORS = [
  "ytd-compact-video-renderer",
  "ytd-compact-radio-renderer",
  "ytd-compact-playlist-renderer"
].join(",");

const WATCH_LINK_SELECTOR = "a[href]";
const FALLBACK_TARGET_KEY = "nomarkyFallbackTarget";
const REJECTED_VIDEO_IDS_KEY = "nomarkyRejectedVideoIds";
const FALLBACK_PAGE_URLS = [
  "https://www.youtube.com/feed/subscriptions",
  "https://www.youtube.com/"
];

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function storageGet(defaults, callback) {
  const result = extensionApi.storage.sync.get(defaults, callback);

  if (result?.then) {
    result.then(callback);
  }
}

function normalize(value) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getVideoId(url = window.location.href) {
  try {
    return new URL(url).searchParams.get("v");
  } catch {
    return null;
  }
}

function showToast(message, tone = "info") {
  let container = document.querySelector(".nomarky-toast-stack");

  if (!container) {
    container = document.createElement("div");
    container.className = "nomarky-toast-stack";
    document.documentElement.append(container);
  }

  const toast = document.createElement("div");
  toast.className = `nomarky-toast nomarky-toast-${tone}`;
  toast.textContent = message;
  container.append(toast);

  window.setTimeout(() => {
    toast.classList.add("nomarky-toast-exiting");
    window.setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function debugLog(message, data = {}) {
  console.info(`[NoMarky] ${message}`, data);
}

function showVerboseToast(message, tone = "info") {
  const now = Date.now();

  if (now - state.lastVerboseToastAt < 1200) {
    return;
  }

  state.lastVerboseToastAt = now;
  showToast(message, tone);
}

function creatorMatches(channelName) {
  const normalizedChannel = normalize(channelName);

  if (!normalizedChannel) {
    return false;
  }

  return state.blockedCreators.some((creator) => {
    const normalizedCreator = normalize(creator);
    return (
      normalizedCreator &&
      (normalizedChannel === normalizedCreator ||
        normalizedChannel.includes(normalizedCreator))
    );
  });
}

function blockedTextMatches(value) {
  const normalizedValue = normalize(value);

  if (!normalizedValue) {
    return false;
  }

  return state.blockedCreators.some((creator) => {
    const normalizedCreator = normalize(creator);
    return normalizedCreator && normalizedValue.includes(normalizedCreator);
  });
}

function getSidebar() {
  return document.querySelector("ytd-watch-next-secondary-results-renderer");
}

function getCurrentFallbackTarget() {
  return sessionStorage.getItem(FALLBACK_TARGET_KEY);
}

function getRejectedVideoIds() {
  try {
    const ids = JSON.parse(sessionStorage.getItem(REJECTED_VIDEO_IDS_KEY) || "[]");
    return Array.isArray(ids) ? ids.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function rememberRejectedVideoId(videoId) {
  if (!videoId) {
    return;
  }

  const ids = [videoId, ...getRejectedVideoIds().filter((id) => id !== videoId)].slice(0, 12);
  sessionStorage.setItem(REJECTED_VIDEO_IDS_KEY, JSON.stringify(ids));
  debugLog("Remembering blocked/rejected video id", { videoId, rejectedVideoIds: ids });
}

function isRejectedVideoId(videoId) {
  return Boolean(videoId && getRejectedVideoIds().includes(videoId));
}

function setNextFallbackTarget() {
  const currentTarget = getCurrentFallbackTarget();
  const currentIndex = FALLBACK_PAGE_URLS.indexOf(currentTarget);
  const nextTarget = FALLBACK_PAGE_URLS[currentIndex + 1] || "";

  if (nextTarget) {
    sessionStorage.setItem(FALLBACK_TARGET_KEY, nextTarget);
  } else {
    sessionStorage.removeItem(FALLBACK_TARGET_KEY);
  }

  return nextTarget;
}

function getCreatorFromRecommendation(item) {
  const owner =
    item.querySelector("ytd-channel-name #text a") ||
    item.querySelector("#channel-name #text a") ||
    item.querySelector("#channel-name a") ||
    item.querySelector("a.yt-simple-endpoint[href^='/@']") ||
    item.querySelector("a.yt-simple-endpoint[href^='/channel/']") ||
    item.querySelector("a.yt-simple-endpoint[href^='/c/']") ||
    item.querySelector("a.yt-simple-endpoint[href^='/user/']");

  return owner?.textContent?.trim() || "";
}

function getVideoItemFromLink(link) {
  return link.closest(
    [
      SIDEBAR_ITEM_SELECTORS,
      "ytd-rich-item-renderer",
      "ytd-video-renderer",
      "ytd-grid-video-renderer",
      "ytd-compact-video-renderer",
      "ytd-reel-item-renderer",
      "ytd-rich-grid-media"
    ].join(",")
  );
}

function getCandidateTitle(link, item) {
  const title =
    item?.querySelector("#video-title")?.textContent ||
    item?.querySelector("a#video-title")?.getAttribute("title") ||
    link.getAttribute("aria-label") ||
    link.getAttribute("title") ||
    link.textContent;

  return (title || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function describeCandidate(link, item, url) {
  return {
    title: getCandidateTitle(link, item) || "(untitled)",
    creator: item ? getCreatorFromRecommendation(item) || "(unknown creator)" : "(no card)",
    videoId: getVideoId(url) || "(no id)",
    url
  };
}

function getRecommendationUrl(item) {
  const link =
    item.querySelector("a#thumbnail[href*='watch']") ||
    item.querySelector("a#video-title[href*='watch']") ||
    item.querySelector("a.yt-simple-endpoint[href*='watch']");

  const href = link?.getAttribute("href") || link?.href;

  if (!href) {
    return null;
  }

  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return null;
  }
}

function isDifferentVideo(url) {
  const currentVideoId = getVideoId();
  const targetVideoId = getVideoId(url);

  return Boolean(targetVideoId && targetVideoId !== currentVideoId);
}

function isPlainWatchVideo(url) {
  try {
    const parsed = new URL(url);
    return Boolean(
      parsed.hostname.endsWith("youtube.com") &&
      parsed.pathname === "/watch" &&
      parsed.searchParams.get("v") &&
      !parsed.searchParams.has("list")
    );
  } catch {
    return false;
  }
}

function isSafeRecommendation(item) {
  const creator = getCreatorFromRecommendation(item);

  if (creator && creatorMatches(creator)) {
    return false;
  }

  return !blockedTextMatches(item.textContent);
}

function getPageCandidateItems() {
  return [
    ...document.querySelectorAll(
      [
        SIDEBAR_ITEM_SELECTORS,
        "ytd-rich-item-renderer",
        "ytd-video-renderer",
        "ytd-grid-video-renderer"
      ].join(",")
    )
  ];
}

function getAllAnchorLinks() {
  return [...document.links, ...document.querySelectorAll(WATCH_LINK_SELECTOR)];
}

function markBlockedRecommendations() {
  const sidebar = getSidebar();

  if (!sidebar) {
    return [];
  }

  const safeUrls = [];

  sidebar.querySelectorAll(SIDEBAR_ITEM_SELECTORS).forEach((item) => {
    const creator = getCreatorFromRecommendation(item);
    const isBlocked = creatorMatches(creator) || blockedTextMatches(item.textContent);

    item.classList.toggle("nomarky-hidden", state.enabled && isBlocked);
    item.dataset.nomarkyCreator = creator;

    if (state.enabled && !isBlocked) {
      const url = getRecommendationUrl(item);
      const videoId = getVideoId(url || "");

      if (url && isDifferentVideo(url) && isPlainWatchVideo(url) && !isRejectedVideoId(videoId)) {
        safeUrls.push(url);
      }
    }
  });

  return safeUrls;
}

function getCurrentCreator() {
  const selectors = [
    "#owner ytd-channel-name #text a",
    "#upload-info ytd-channel-name #text a",
    "ytd-video-owner-renderer ytd-channel-name #text a",
    "#owner #channel-name #text a"
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function toAbsoluteUrl(href) {
  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return null;
  }
}

function getSafeWatchUrlFromItem(item) {
  if (!isSafeRecommendation(item)) {
    return null;
  }

  const link =
    item.querySelector("a#thumbnail[href*='watch?v=']") ||
    item.querySelector("a#video-title[href*='watch?v=']") ||
    item.querySelector(WATCH_LINK_SELECTOR);
  const href = link?.getAttribute("href") || link?.href;
  const url = href ? toAbsoluteUrl(href) : null;

  if (
    !url ||
    !isDifferentVideo(url) ||
    !isPlainWatchVideo(url) ||
    isRejectedVideoId(getVideoId(url))
  ) {
    return null;
  }

  return url;
}

function getSafeWatchUrlFromLink(link) {
  const href = link.getAttribute("href") || link.href;
  const url = href ? toAbsoluteUrl(href) : null;

  if (!url || !isDifferentVideo(url) || !isPlainWatchVideo(url)) {
    return null;
  }

  const item = getVideoItemFromLink(link);
  const textToCheck = item?.textContent || link.getAttribute("aria-label") || link.textContent;

  if (blockedTextMatches(textToCheck)) {
    return null;
  }

  if (item && !isSafeRecommendation(item)) {
    return null;
  }

  return url;
}

function getSafeWatchUrlFromPage({ report = false } = {}) {
  const links = getAllAnchorLinks();
  const seen = new Set();
  let anchorCount = 0;
  let watchCandidateCount = 0;
  let duplicateCount = 0;
  let playlistCount = 0;
  let blockedCount = 0;
  let rememberedBlockedCount = 0;
  const rejectedSamples = [];

  for (const link of links) {
    anchorCount += 1;
    const href = link.getAttribute("href") || link.href;
    const url = href ? toAbsoluteUrl(href) : null;

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);

    let targetVideoId = "";

    try {
      const parsed = new URL(url);

      if (!parsed.hostname.endsWith("youtube.com") || parsed.pathname !== "/watch") {
        continue;
      }

      if (!parsed.searchParams.get("v")) {
        continue;
      }

      watchCandidateCount += 1;
      targetVideoId = parsed.searchParams.get("v") || "";

      if (parsed.searchParams.has("list")) {
        playlistCount += 1;
        rejectedSamples.push({ reason: "playlist", url });
        continue;
      }
    } catch {
      continue;
    }

    if (!isDifferentVideo(url)) {
      duplicateCount += 1;
      rejectedSamples.push({ reason: "current video", url });
      continue;
    }

    if (isRejectedVideoId(targetVideoId)) {
      rememberedBlockedCount += 1;
      rejectedSamples.push({ reason: "recently blocked video id", videoId: targetVideoId, url });
      continue;
    }

    const item = getVideoItemFromLink(link);
    const textToCheck = item?.textContent || link.getAttribute("aria-label") || link.textContent;

    if (blockedTextMatches(textToCheck) || (item && !isSafeRecommendation(item))) {
      blockedCount += 1;
      rejectedSamples.push({
        reason: "blocked text or creator",
        ...describeCandidate(link, item, url)
      });
      continue;
    }

    const picked = describeCandidate(link, item, url);
    debugLog("Picked safe candidate", picked);
    showToast(`Playing: ${picked.title} (${picked.videoId})`, "success");
    return url;
  }

  for (const item of getPageCandidateItems()) {
    const url = getSafeWatchUrlFromItem(item);

    if (url) {
      return url;
    }
  }

  if (report) {
    const now = Date.now();

    if (now - state.lastCandidateToastAt > 2500) {
      state.lastCandidateToastAt = now;
      showToast(
        `Checked ${anchorCount} links, ${watchCandidateCount} videos: ${blockedCount} blocked, ${rememberedBlockedCount} recent, ${playlistCount} playlists, ${duplicateCount} current.`,
        "info"
      );
      debugLog("No safe candidate found", {
        page: window.location.href,
        anchorCount,
        watchCandidateCount,
        blockedCount,
        rememberedBlockedCount,
        playlistCount,
        duplicateCount,
        rejectedVideoIds: getRejectedVideoIds(),
        rejectedSamples: rejectedSamples.slice(0, 8)
      });
    }
  }

  return null;
}

function pauseCurrentVideo() {
  document.querySelector("video")?.pause();
}

function nudgeFeedLoading(attempt) {
  if (attempt > 0 && attempt % 8 === 0) {
    window.scrollBy({ top: Math.round(window.innerHeight * 0.8), behavior: "smooth" });
  }
}

async function waitForAlternativeVideoUrl() {
  for (let i = 0; i < 40; i += 1) {
    const [safeUrl] = markBlockedRecommendations();

    if (safeUrl) {
      showToast(`Found safe sidebar video (${getVideoId(safeUrl)}). Switching now.`, "success");
      debugLog("Picked sidebar candidate", { videoId: getVideoId(safeUrl), url: safeUrl });
      return safeUrl;
    }

    if (i === 0) {
      showToast("Blocked creator detected. Looking through sidebar recommendations.", "warn");
    }

    await delay(250);
  }

  return getSafeWatchUrlFromPage({ report: true });
}

async function continueFallbackIfNeeded() {
  const target = getCurrentFallbackTarget();

  if (state.fallbackInProgress || !target || window.location.pathname.startsWith("/watch")) {
    return;
  }

  state.fallbackInProgress = true;
  showToast("Looking for a safe video on this page.", "info");

  for (let i = 0; i < 40; i += 1) {
    nudgeFeedLoading(i);
    const url = getSafeWatchUrlFromPage({ report: i % 10 === 0 });

    if (url) {
      sessionStorage.removeItem(FALLBACK_TARGET_KEY);
      showToast("Found a safe video. Playing it now.", "success");
      window.location.assign(url);
      return;
    }

    await delay(250);
  }

  const nextTarget = setNextFallbackTarget();
  state.fallbackInProgress = false;

  if (nextTarget) {
    showToast("No safe video here. Trying another YouTube page.", "warn");
    window.location.assign(nextTarget);
    return;
  }

  showToast("No safe videos found on subscriptions or home.", "error");
}

async function autoJumpIfNeeded() {
  if (
    !state.enabled ||
    !state.autoJump ||
    state.autoJumpInProgress ||
    !window.location.pathname.startsWith("/watch")
  ) {
    return;
  }

  const videoId = getVideoId();
  const creator = getCurrentCreator();

  if (!videoId || !creatorMatches(creator) || state.lastAutoJumpVideoId === videoId) {
    return;
  }

  state.lastAutoJumpVideoId = videoId;
  state.autoJumpInProgress = true;
  rememberRejectedVideoId(videoId);
  pauseCurrentVideo();
  showToast(`Paused blocked video from ${creator} (${videoId}).`, "warn");
  debugLog("Blocked current video", { videoId, creator, url: window.location.href });

  const safeUrl = await waitForAlternativeVideoUrl();

  if (safeUrl) {
    sessionStorage.removeItem(FALLBACK_TARGET_KEY);
    window.location.assign(safeUrl);
    return;
  }

  sessionStorage.setItem(FALLBACK_TARGET_KEY, FALLBACK_PAGE_URLS[0]);
  showToast("No safe sidebar video yet. Trying your subscriptions/home feed.", "warn");
  window.location.assign(FALLBACK_PAGE_URLS[0]);
}

function scan() {
  markBlockedRecommendations();
  continueFallbackIfNeeded();
  autoJumpIfNeeded();
}

function scheduleScan() {
  window.clearTimeout(state.scanTimer);
  state.scanTimer = window.setTimeout(scan, 150);
}

function loadSettings() {
  storageGet(
    {
      enabled: true,
      autoJump: true,
      blockedCreators: DEFAULT_BLOCKED_CREATORS
    },
    (settings) => {
      state.enabled = Boolean(settings.enabled);
      state.autoJump = Boolean(settings.autoJump);
      state.blockedCreators = Array.isArray(settings.blockedCreators)
        ? settings.blockedCreators
        : DEFAULT_BLOCKED_CREATORS;
      debugLog("Loaded settings", {
        enabled: state.enabled,
        autoJump: state.autoJump,
        blockedCreators: state.blockedCreators
      });
      scheduleScan();
    }
  );
}

function watchYouTubeNavigation() {
  document.addEventListener("yt-navigate-finish", () => {
    state.lastAutoJumpVideoId = null;
    state.autoJumpInProgress = false;
    state.fallbackInProgress = false;
    scheduleScan();
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

extensionApi.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") {
    return;
  }

  if (changes.enabled) {
    state.enabled = Boolean(changes.enabled.newValue);
  }

  if (changes.autoJump) {
    state.autoJump = Boolean(changes.autoJump.newValue);
  }

  if (changes.blockedCreators) {
    state.blockedCreators = Array.isArray(changes.blockedCreators.newValue)
      ? changes.blockedCreators.newValue
      : DEFAULT_BLOCKED_CREATORS;
    debugLog("Updated blocked creators", { blockedCreators: state.blockedCreators });
  }

  scheduleScan();
});

loadSettings();
watchYouTubeNavigation();
