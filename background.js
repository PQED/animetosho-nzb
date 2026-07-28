// ==== background.js (service‑worker) ====
// -------------------------------------------------------------------
// 1️⃣  CONFIGURATION (kept in one place for easy tweaking)
// -------------------------------------------------------------------
const CONFIG = {
  // Public JSON feed that contains *all* releases.
  // The feed is an array of objects, each with at least:
  //   id, title, size, created_at (ISO string)
  FEED_URL: "https://feed.animetosho.org/json",

  // How long we keep the feed in chrome.storage.local before we refresh it.
  CACHE_TTL_MS: 6 * 60 * 60 * 1000, // 6 hours

  // Optional: a private API token for hidden releases.
  // Store it once with: chrome.storage.sync.set({animetoshoToken: "YOUR_TOKEN"});
  // The token will be added as a Bearer header automatically.
};

// -------------------------------------------------------------------
// 2️⃣  SMALL HELPERS (time, storage, fetch)
// -------------------------------------------------------------------
const now = () => Date.now();

async function getCache(key) {
  const obj = await chrome.storage.local.get(key);
  return obj[key];
}
async function setCache(key, value) {
  await chrome.storage.local.set({[key]: value});
}

/**
 * Fetch the whole feed from animetosho.org.
 * Returns an array of normalized release objects or `null` on error.
 */
async function fetchFeed() {
  try {
    const token = (await chrome.storage.sync.get("animetoshoToken")).animetoshoToken;
    const headers = token ? {Authorization: `Bearer ${token}`} : {};

    const resp = await fetch(CONFIG.FEED_URL, {headers, cache: "no-store"});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const raw = await resp.json(); // could be an object or plain array
    const releases = Array.isArray(raw) ? raw : raw.releases || [];

    // Normalise to the shape Hayase expects.
    return releases.map(r => ({
      id: r.id,
      title: r.title,
      size: r.size,
      date: r.created_at,
      nzb_url: `https://animetosho.org/api/nzb/${r.id}`
    }));
  } catch (e) {
    console.error("[animetosho] fetchFeed error:", e);
    return null;
  }
}

/**
 * Return the cached feed if it is still fresh, otherwise re‑download.
 */
async function getFeed(forceRefresh = false) {
  const CACHE_KEY = "animetoshoFeed";

  if (!forceRefresh) {
    const cached = await getCache(CACHE_KEY);
    if (cached && (now() - cached.timestamp) < CONFIG.CACHE_TTL_MS) {
      return cached.releases; // may be null if a previous fetch failed
    }
  }

  const fresh = await fetchFeed();
  await setCache(CACHE_KEY, {timestamp: now(), releases: fresh});
  return fresh;
}

/**
 * Filter an array of releases by a case‑insensitive substring in the title.
 */
function filterReleases(releases, query) {
  if (!query) return releases;
  const lc = query.toLowerCase();
  return releases.filter(r => r.title.toLowerCase().includes(lc));
}

/**
 * Download a single NZB file and turn it into a blob URL.
 * Returns `{blobUrl, filename}`.
 */
async function downloadNzb(nzbUrl, title) {
  try {
    const token = (await chrome.storage.sync.get("animetoshoToken")).animetoshoToken;
    const headers = token ? {Authorization: `Bearer ${token}`} : {};

    const resp = await fetch(nzbUrl, {headers, cache: "no-store"});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const blob = await resp.blob(); // content‑type = application/x-nzb
    const blobUrl = URL.createObjectURL(blob);
    const filename = `${title}.nzb`;
    return {blobUrl, filename};
  } catch (e) {
    console.error("[animetosho] downloadNzb error:", e);
    throw e;
  }
}

// -------------------------------------------------------------------
// 3️⃣  MESSAGE HANDLER (popup ↔ background)
// -------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // ---------------------------------------------------------------
  // LIST – return the full (cached) list, optionally forcing a refresh.
  // ---------------------------------------------------------------
  if (msg.type === "list") {
    getFeed(!!msg.forceRefresh).then(releases => {
      if (!releases) {
        sendResponse({ok: false, error: "Failed to load feed"});
        return;
      }
      sendResponse({ok: true, providers: releases});
    }).catch(err => sendResponse({ok: false, error: err.message}));
    return true; // keep channel open for async reply
  }

  // ---------------------------------------------------------------
  // SEARCH – filter the cached feed client‑side.
  // ---------------------------------------------------------------
  if (msg.type === "search") {
    const query = (msg.query || "").trim();
    getFeed().then(releases => {
      if (!releases) {
        sendResponse({ok: false, error: "Failed to load feed"});
        return;
      }
      const filtered = filterReleases(releases, query);
      sendResponse({ok: true, providers: filtered});
    }).catch(err => sendResponse({ok: false, error: err.message}));
    return true;
  }

  // ---------------------------------------------------------------
  // DOWNLOAD – fetch the NZB, turn it into a blob URL, and hand it back.
  // ---------------------------------------------------------------
  if (msg.type === "download") {
    const {nzb_url, title} = msg;
    downloadNzb(nzb_url, title).then(({blobUrl, filename}) => {
      // Hayase expects a message with `type:"nzb"` and a blob URL.
      sendResponse({ok: true, type: "nzb", url: blobUrl, filename});
    }).catch(err => sendResponse({ok: false, error: err.message}));
    return true;
  }

  // ---------------------------------------------------------------
  // UNKNOWN MESSAGE
  // ---------------------------------------------------------------
  sendResponse({ok: false, error: "unknown message type"});
  return false;
});
