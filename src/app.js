import "./styles.css";

const API_BASE =
  "https://5ecvq3d6ri.execute-api.eu-west-2.amazonaws.com/api/sheet/";
const API_DICT_URL =
  "https://5ecvq3d6ri.execute-api.eu-west-2.amazonaws.com/api/sheet/api_dict/default/";

/** Populated from api_dict on load; each item has { id, label, url }. */
let DECK_OPTIONS = [];
let DEFAULT_DECK = "realities";
const DB_NAME = "flashback-db";
const DB_STORE = "deck";
const API_DICT_CACHE_KEY = "api_dict";

const state = {
  rawDeck: [],
  deck: [],
  index: 0,
  flipped: false,
  shuffle: false,
  usingCache: false,
  deckId: DEFAULT_DECK,
};

const elements = {
  card: document.getElementById("card"),
  cardText: document.getElementById("cardText"),
  progress: document.getElementById("progressText"),
  infoBtn: document.getElementById("infoBtn"),
  infoBackdrop: document.getElementById("infoBackdrop"),
  infoPanel: document.getElementById("infoPanel"),
  infoCloseBtn: document.getElementById("infoCloseBtn"),
  infoOnline: document.getElementById("infoOnline"),
  infoDeck: document.getElementById("infoDeck"),
  infoCount: document.getElementById("infoCount"),
  infoLastSynced: document.getElementById("infoLastSynced"),
  infoTimeSinceSync: document.getElementById("infoTimeSinceSync"),
  infoShuffle: document.getElementById("infoShuffle"),
  infoVersion: document.getElementById("infoVersion"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  flipBtn: document.getElementById("flipBtn"),
  shuffleToggle: document.getElementById("shuffleToggle"),
  reloadBtn: document.getElementById("reloadBtn"),
  deckSelect: document.getElementById("deckSelect"),
};

const storage = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage errors
    }
  },
};

function openDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbSet(key, value) {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch {
    storage.set(key, value);
  }
}

async function dbGet(key) {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readonly");
    const value = await new Promise((resolve, reject) => {
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return value;
  } catch {
    return storage.get(key, null);
  }
}

function normalizeDeck(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function normalizeDeckId(value) {
  if (!DECK_OPTIONS.length) return value || DEFAULT_DECK;
  return DECK_OPTIONS.some((d) => d.id === value) ? value : DEFAULT_DECK;
}

function getDeckUrl(deckId) {
  const deck = DECK_OPTIONS.find((d) => d.id === deckId);
  return deck ? deck.url : `${API_BASE}${deckId}`;
}

function humanizeLabel(apiKey) {
  return apiKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildDeckOptionsFromRaw(data) {
  if (!Array.isArray(data) || !data.length) return null;
  return data.map(({ api_key, api_url }) => ({
    id: api_key,
    label: humanizeLabel(api_key),
    url: api_url,
  }));
}

function getFallbackDeckOptions() {
  return [
    { id: "realities", label: "Realities", url: `${API_BASE}flashback/realities/` },
    { id: "verses", label: "Verses", url: `${API_BASE}flashback/verses/` },
  ];
}

function applyDeckOptions(options) {
  DECK_OPTIONS = options;
  DEFAULT_DECK = DECK_OPTIONS[0]?.id ?? "realities";
  populateDeckSelect();
}

/** Load deck options from cache; returns null if none. */
async function getCachedDeckOptions() {
  const raw = await dbGet(API_DICT_CACHE_KEY);
  return buildDeckOptionsFromRaw(raw);
}

/** Fetch api_dict from network, cache it, update DECK_OPTIONS. Returns new options or null. */
async function fetchDeckOptionsFromNetwork() {
  try {
    const response = await fetch(API_DICT_URL, { mode: "cors" });
    if (!response.ok) throw new Error("API dict unavailable");
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) throw new Error("No decks");
    await dbSet(API_DICT_CACHE_KEY, data);
    const options = buildDeckOptionsFromRaw(data);
    if (options) {
      DECK_OPTIONS = options;
      DEFAULT_DECK = DECK_OPTIONS[0].id;
    }
    return options;
  } catch {
    const cached = await getCachedDeckOptions();
    if (cached) return cached;
    const fallback = getFallbackDeckOptions();
    DECK_OPTIONS = fallback;
    DEFAULT_DECK = DECK_OPTIONS[0].id;
    return fallback;
  }
}

function populateDeckSelect() {
  elements.deckSelect.innerHTML = "";
  for (const deck of DECK_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = deck.id;
    opt.textContent = deck.label;
    elements.deckSelect.appendChild(opt);
  }
}

/**
 * Read all deck ids from URL search params. Supports both "deck" and "api_key" (multiple values allowed).
 * @returns {string[]} The deck ids to allow; empty means no restriction (all decks).
 */
function getDeckIdsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const deck = params.getAll("deck");
  const apiKey = params.getAll("api_key");
  const ids = [...deck, ...apiKey].filter(Boolean);
  return [...new Set(ids)];
}

/**
 * First deck id from URL (for initial selection). Uses getDeckIdsFromUrl()[0] or null.
 * @returns {string|null}
 */
function getDeckIdFromUrl() {
  const ids = getDeckIdsFromUrl();
  return ids.length ? ids[0] : null;
}

/**
 * Filter (or build) deck options to only those allowed by URL params.
 * If an allowed id is not in the full list, add it with a constructed URL.
 * @param {{ id: string, label: string, url: string }[]} options - full options from api_dict/cache/fallback
 * @param {string[]} allowedIds - from getDeckIdsFromUrl(); empty = no filter
 * @returns {{ id: string, label: string, url: string }[]}
 */
function filterOptionsByAllowedIds(options, allowedIds) {
  if (!allowedIds.length) return options;
  const optionMap = new Map(options.map((o) => [o.id, o]));
  const result = [];
  for (const id of allowedIds) {
    const existing = optionMap.get(id);
    result.push(
      existing ?? {
        id,
        label: humanizeLabel(id),
        url: `${API_BASE}${id}`,
      },
    );
  }
  return result;
}

function getCacheKey(deckId) {
  return `deck:${deckId}`;
}

function getIndexKey(deckId) {
  return `flashback:index:${deckId}`;
}

function getFlippedKey(deckId) {
  return `flashback:flipped:${deckId}`;
}

function getLastSyncedKey(deckId) {
  return `flashback:lastSynced:${deckId}`;
}

function formatLastSynced(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return "—";
  }
}

function formatTimeSinceSync(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 0) return "—";
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (sec < 60) return rtf.format(-sec, "second");
    const min = Math.floor(sec / 60);
    if (min < 60) return rtf.format(-min, "minute");
    const hr = Math.floor(min / 60);
    if (hr < 24) return rtf.format(-hr, "hour");
    const day = Math.floor(hr / 24);
    return rtf.format(-day, "day");
  } catch {
    return "—";
  }
}

function shuffleDeck(deck) {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function applyDeck(deck, options = { useSavedIndex: true }) {
  state.rawDeck = deck;
  state.deck = state.shuffle ? shuffleDeck(deck) : deck;
  const savedIndex = storage.get(getIndexKey(state.deckId), 0);
  state.index = options.useSavedIndex ? savedIndex : 0;
  state.index = Math.min(state.index, Math.max(state.deck.length - 1, 0));
  state.flipped = storage.get(getFlippedKey(state.deckId), false);
  renderCard();
  updateInfoStats();
}

function renderCard() {
  if (!state.deck.length) {
    elements.cardText.textContent = "No cards available";
    elements.progress.textContent = "Card 0 / 0";
    elements.card.classList.remove("back");
    updateInfoStats();
    return;
  }

  const card = state.deck[state.index];
  const faceText = state.flipped ? card.back : card.front;
  elements.cardText.textContent = faceText || "";
  elements.progress.textContent = `Card ${state.index + 1} / ${state.deck.length}`;
  elements.card.classList.toggle("back", state.flipped);

  storage.set(getIndexKey(state.deckId), state.index);
  storage.set(getFlippedKey(state.deckId), state.flipped);
  updateInfoStats();
}

function showStatus() {
  const online = navigator.onLine;
  elements.infoOnline.textContent = online ? "Online" : "Offline";
  elements.infoOnline.style.color = online ? "#38bdf8" : "#f87171";
}

async function updateInfoStats() {
  const deckLabel =
    DECK_OPTIONS.find((deck) => deck.id === state.deckId)?.label ??
    state.deckId;
  elements.infoDeck.textContent = deckLabel;
  elements.infoCount.textContent = `${state.deck.length}`;
  const lastSynced = storage.get(getLastSyncedKey(state.deckId), null);
  elements.infoLastSynced.textContent = formatLastSynced(lastSynced);
  elements.infoTimeSinceSync.textContent = formatTimeSinceSync(lastSynced);
  elements.infoShuffle.textContent = state.shuffle ? "On" : "Off";
  if (import.meta.env.DEV) {
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/__version__`);
      elements.infoVersion.textContent = res.ok ? await res.text() : "—";
    } catch {
      elements.infoVersion.textContent = "—";
    }
  } else {
    elements.infoVersion.textContent =
      typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "—";
  }
}

function setInfoOpen(open) {
  elements.infoPanel.hidden = !open;
  elements.infoBackdrop.hidden = !open;
  elements.infoBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    void updateInfoStats();
  }
}

/**
 * Load deck: show cached immediately if backgroundRefresh and cache exists,
 * then optionally fetch in background and update. Otherwise fetch and show loading.
 * @param {string} [deckId] - deck to load (defaults to state.deckId)
 * @param {{ backgroundRefresh?: boolean }} [options] - if true, use cache first then refresh in background
 */
async function fetchDeck(deckId = state.deckId, options = {}) {
  const { backgroundRefresh = false } = options;
  const cacheKey = getCacheKey(deckId);

  if (backgroundRefresh) {
    const cachedDeck = await dbGet(cacheKey);
    if (cachedDeck && cachedDeck.length) {
      state.usingCache = true;
      applyDeck(cachedDeck, { useSavedIndex: true });
      refreshDeckInBackground(deckId);
      return;
    }
  }

  elements.cardText.textContent = "Loading…";
  state.usingCache = false;
  try {
    const response = await fetch(getDeckUrl(deckId), { mode: "cors" });
    if (!response.ok) throw new Error("Network error");
    const data = await response.json();
    const deck = normalizeDeck(data);
    if (!deck.length) throw new Error("Empty deck");
    await dbSet(cacheKey, deck);
    storage.set(getLastSyncedKey(deckId), new Date().toISOString());
    applyDeck(deck, { useSavedIndex: true });
  } catch {
    const cachedDeck = await dbGet(cacheKey);
    if (cachedDeck && cachedDeck.length) {
      state.usingCache = true;
      applyDeck(cachedDeck, { useSavedIndex: true });
    } else {
      elements.cardText.textContent = "Unable to load deck";
      elements.progress.textContent = "Card 0 / 0";
      updateInfoStats();
    }
  }
}

/** Fetch deck from network in background and update UI when done. */
async function refreshDeckInBackground(deckId) {
  try {
    const response = await fetch(getDeckUrl(deckId), { mode: "cors" });
    if (!response.ok) return;
    const data = await response.json();
    const deck = normalizeDeck(data);
    if (!deck.length) return;
    await dbSet(getCacheKey(deckId), deck);
    storage.set(getLastSyncedKey(deckId), new Date().toISOString());
    if (state.deckId === deckId) {
      state.usingCache = false;
      applyDeck(deck, { useSavedIndex: true });
    }
  } catch {
    // Keep showing cached deck
  }
}

function nextCard() {
  if (!state.deck.length) return;
  state.index = (state.index + 1) % state.deck.length;
  state.flipped = false;
  renderCard();
}

function prevCard() {
  if (!state.deck.length) return;
  state.index = (state.index - 1 + state.deck.length) % state.deck.length;
  state.flipped = false;
  renderCard();
}

function flipCard() {
  if (!state.deck.length) return;
  state.flipped = !state.flipped;
  renderCard();
}

function attachSwipeHandlers() {
  let startX = 0;
  let startY = 0;
  const threshold = 45;

  elements.card.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
  });

  elements.card.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    const diffX = touch.clientX - startX;
    const diffY = touch.clientY - startY;
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > threshold) {
      if (diffX < 0) {
        nextCard();
      } else {
        prevCard();
      }
    }
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    const baseUrl = import.meta.env.BASE_URL || "/";
    navigator.serviceWorker.register(`${baseUrl}sw.js`);
  }
}

async function init() {
  const allowedDeckIds = getDeckIdsFromUrl();

  // Use cached api_dict immediately so the user can use the app without waiting
  let options = await getCachedDeckOptions();
  if (!options) options = getFallbackDeckOptions();
  options = filterOptionsByAllowedIds(options, allowedDeckIds);
  applyDeckOptions(options);

  const urlDeckId = getDeckIdFromUrl();
  const savedDeckId = storage.get("flashback:deckId", DEFAULT_DECK);
  if (urlDeckId && DECK_OPTIONS.some((d) => d.id === urlDeckId)) {
    state.deckId = urlDeckId;
    storage.set("flashback:deckId", urlDeckId);
  } else {
    state.deckId = normalizeDeckId(savedDeckId);
  }
  elements.deckSelect.value = state.deckId;
  state.shuffle = storage.get("flashback:shuffle", false);
  elements.shuffleToggle.checked = state.shuffle;
  showStatus();

  // Show cached deck immediately if we have it, then refresh in background
  fetchDeck(state.deckId, { backgroundRefresh: true });

  // Refresh api_dict in background; when URL params specify decks, only those are kept in the list
  fetchDeckOptionsFromNetwork().then((newOptions) => {
    if (newOptions && newOptions.length) {
      const filtered = filterOptionsByAllowedIds(newOptions, allowedDeckIds);
      applyDeckOptions(filtered);
      const urlDeckId = getDeckIdFromUrl();
      if (urlDeckId && DECK_OPTIONS.some((d) => d.id === urlDeckId)) {
        state.deckId = urlDeckId;
        storage.set("flashback:deckId", urlDeckId);
        elements.deckSelect.value = urlDeckId;
        fetchDeck(urlDeckId, { backgroundRefresh: true });
      } else {
        state.deckId = normalizeDeckId(state.deckId);
        elements.deckSelect.value = state.deckId;
      }
    }
  });

  registerServiceWorker();

  elements.infoBtn.addEventListener("click", () => setInfoOpen(true));
  elements.infoBackdrop.addEventListener("click", () => setInfoOpen(false));
  elements.infoCloseBtn.addEventListener("click", () => setInfoOpen(false));

  elements.card.addEventListener("click", flipCard);
  elements.prevBtn.addEventListener("click", prevCard);
  elements.nextBtn.addEventListener("click", nextCard);
  elements.flipBtn.addEventListener("click", flipCard);
  elements.shuffleToggle.addEventListener("change", (event) => {
    state.shuffle = event.target.checked;
    storage.set("flashback:shuffle", state.shuffle);
    applyDeck(state.rawDeck, { useSavedIndex: false });
  });
  elements.deckSelect.addEventListener("change", async (event) => {
    const selected = normalizeDeckId(event.target.value);
    state.deckId = selected;
    storage.set("flashback:deckId", selected);
    await fetchDeck(selected, { backgroundRefresh: true });
  });
  elements.reloadBtn.addEventListener("click", async () => {
    await fetchDeck();
    applyDeck(state.rawDeck, { useSavedIndex: false });
  });

  attachSwipeHandlers();

  window.addEventListener("online", showStatus);
  window.addEventListener("offline", showStatus);
}

init();
