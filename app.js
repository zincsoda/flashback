const API_URL =
  "https://5ecvq3d6ri.execute-api.eu-west-2.amazonaws.com/api/sheet/hanzi/realities";
const DB_NAME = "flashback-db";
const DB_STORE = "deck";
const DB_KEY = "latest";

const state = {
  rawDeck: [],
  deck: [],
  index: 0,
  flipped: false,
  shuffle: false,
  usingCache: false,
};

const elements = {
  card: document.getElementById("card"),
  cardText: document.getElementById("cardText"),
  progress: document.getElementById("progressText"),
  status: document.getElementById("statusText"),
  banner: document.getElementById("banner"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  flipBtn: document.getElementById("flipBtn"),
  shuffleToggle: document.getElementById("shuffleToggle"),
  reloadBtn: document.getElementById("reloadBtn"),
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
  const savedIndex = storage.get("flashback:index", 0);
  state.index = options.useSavedIndex ? savedIndex : 0;
  state.index = Math.min(state.index, Math.max(state.deck.length - 1, 0));
  state.flipped = storage.get("flashback:flipped", false);
  renderCard();
}

function renderCard() {
  if (!state.deck.length) {
    elements.cardText.textContent = "No cards available";
    elements.progress.textContent = "Card 0 / 0";
    elements.card.classList.remove("back");
    return;
  }

  const card = state.deck[state.index];
  const faceText = state.flipped ? card.back : card.front;
  elements.cardText.textContent = faceText || "";
  elements.progress.textContent = `Card ${state.index + 1} / ${state.deck.length}`;
  elements.card.classList.toggle("back", state.flipped);

  storage.set("flashback:index", state.index);
  storage.set("flashback:flipped", state.flipped);
}

function showStatus() {
  const online = navigator.onLine;
  elements.status.textContent = online ? "Online" : "Offline";
  elements.status.style.color = online ? "#38bdf8" : "#f87171";
}

function showBanner(show) {
  elements.banner.hidden = !show;
}

async function fetchDeck() {
  elements.cardText.textContent = "Loading…";
  showBanner(false);
  state.usingCache = false;
  try {
    const response = await fetch(API_URL, { mode: "cors" });
    if (!response.ok) throw new Error("Network error");
    const data = await response.json();
    const deck = normalizeDeck(data);
    if (!deck.length) throw new Error("Empty deck");
    await dbSet(DB_KEY, deck);
    applyDeck(deck, { useSavedIndex: true });
  } catch {
    const cachedDeck = await dbGet(DB_KEY);
    if (cachedDeck && cachedDeck.length) {
      state.usingCache = true;
      showBanner(true);
      applyDeck(cachedDeck, { useSavedIndex: true });
    } else {
      elements.cardText.textContent = "Unable to load deck";
      elements.progress.textContent = "Card 0 / 0";
    }
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
    navigator.serviceWorker.register("sw.js");
  }
}

function init() {
  state.shuffle = storage.get("flashback:shuffle", false);
  elements.shuffleToggle.checked = state.shuffle;
  showStatus();
  fetchDeck();
  registerServiceWorker();

  elements.card.addEventListener("click", flipCard);
  elements.prevBtn.addEventListener("click", prevCard);
  elements.nextBtn.addEventListener("click", nextCard);
  elements.flipBtn.addEventListener("click", flipCard);
  elements.shuffleToggle.addEventListener("change", (event) => {
    state.shuffle = event.target.checked;
    storage.set("flashback:shuffle", state.shuffle);
    applyDeck(state.rawDeck, { useSavedIndex: false });
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
