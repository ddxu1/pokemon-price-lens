importScripts("pricecharting.js");

const SEARCH_CACHE_TTL = 15 * 60 * 1000;
const DETAIL_CACHE_TTL = 15 * 60 * 1000;
const COUNTERPART_PREFIX = "poke-price-lens:counterpart:";
const SAVED_LINKS_KEY = "poke-price-lens:saved-pricecharting-links:v1";
const searchCache = new Map();
const detailCache = new Map();
const setPairsReady = loadSetPairs();

async function loadSetPairs() {
  try {
    const response = await fetch(chrome.runtime.getURL("set-pairs.json"));
    if (!response.ok) throw new Error(`Set-pair dataset returned HTTP ${response.status}`);
    PriceCharting.configureSetPairs(await response.json());
  } catch (error) {
    console.warn("Poké Price Lens could not load set-pairs.json:", error);
  }
}

function cached(cache, key, ttl, loader) {
  const existing = cache.get(key);
  if (existing && Date.now() - existing.createdAt < ttl) return existing.value;

  const value = Promise.resolve()
    .then(loader)
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, { createdAt: Date.now(), value });
  return value;
}

async function fetchText(url) {
  const response = await fetch(url, {
    credentials: "omit",
    headers: { Accept: "text/html,application/xhtml+xml" }
  });
  if (!response.ok) throw new Error(`PriceCharting returned HTTP ${response.status}`);
  return response.text();
}

async function searchPriceCharting(card) {
  const query = PriceCharting.normalizeName(card.name);
  if (!query) throw new Error("No card name was detected on this page.");

  const results = await cached(searchCache, query, SEARCH_CACHE_TTL, async () => {
    const url = `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(query)}`;
    const html = await fetchText(url);
    return PriceCharting.parseSearchResults(html);
  });

  if (!results.length) throw new Error("PriceCharting did not return any Pokémon card matches.");
  return results;
}

async function addDetail(product) {
  if (!product) return null;
  const detail = await cached(detailCache, product.url, DETAIL_CACHE_TTL, async () => {
    const html = await fetchText(product.url);
    return PriceCharting.parseProductDetail(html);
  });

  return {
    ...product,
    prices: {
      ...product.prices,
      ...Object.fromEntries(Object.entries(detail.prices || {}).filter(([, value]) => value))
    },
    stats: {
      ...(product.stats || {}),
      ...(detail.stats || {})
    }
  };
}

function pickCandidate(candidates, preferredUrl) {
  return candidates.find((candidate) => candidate.url === preferredUrl) || candidates[0] || null;
}

function counterpartKey(url) {
  return `${COUNTERPART_PREFIX}${String(url || "").trim()}`;
}

function getStoredValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (stored) => {
      if (chrome.runtime.lastError) return resolve("");
      resolve(stored[key] || "");
    });
  });
}

async function getPinnedCounterpartUrl(url) {
  if (!url) return "";
  return getStoredValue(counterpartKey(url));
}

function setStoredValues(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
}

function candidateByUrl(candidates, url) {
  return (candidates || []).find((candidate) => candidate.url === url) || null;
}

async function pinCounterpartPair(englishUrl, japaneseUrl) {
  if (!englishUrl || !japaneseUrl) throw new Error("Both English and Japanese PriceCharting links are required.");
  await setStoredValues({
    [counterpartKey(englishUrl)]: japaneseUrl,
    [counterpartKey(japaneseUrl)]: englishUrl
  });
  return { englishUrl, japaneseUrl, pinnedAt: Date.now() };
}

function getSavedLinks() {
  return new Promise((resolve) => {
    chrome.storage.local.get(SAVED_LINKS_KEY, (stored) => {
      if (chrome.runtime.lastError) return resolve([]);
      resolve(Array.isArray(stored[SAVED_LINKS_KEY]) ? stored[SAVED_LINKS_KEY] : []);
    });
  });
}

function setSavedLinks(links) {
  return setStoredValues({ [SAVED_LINKS_KEY]: links });
}

async function saveCardLink(card) {
  if (!card || !card.url) throw new Error("No PriceCharting card URL was provided.");
  const existing = await getSavedLinks();
  const withoutCurrent = existing.filter((item) => item.url !== card.url);
  const savedCard = {
    url: card.url,
    title: card.title || `${card.name || ""}${card.number ? ` #${card.number}` : ""}`.trim(),
    name: card.name || "",
    number: card.number || "",
    set: card.set || "",
    language: card.language || (PriceCharting.isJapanese(card) ? "japanese" : "english"),
    savedAt: Date.now()
  };
  const next = [savedCard, ...withoutCurrent].slice(0, 250);
  await setSavedLinks(next);
  return { saved: savedCard, count: next.length };
}

async function clearSavedLinks() {
  await setSavedLinks([]);
  return { cleared: true, count: 0 };
}

function numericPrice(value) {
  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

async function enrichSavedCard(savedCard) {
  const card = {
    source: "pricecharting",
    name: savedCard.name || String(savedCard.title || "").replace(/\s*#\s*\d+[a-z]?\s*$/i, "").trim(),
    number: savedCard.number || ((String(savedCard.title || "").match(/#\s*(\d+[a-z]?)/i) || [])[1] || ""),
    set: savedCard.set || ""
  };
  const result = await lookup(card, {});
  const english = result.english && result.english.selected;
  const japanese = result.japanese && result.japanese.selected;
  const englishPsa10 = numericPrice(english && english.prices && english.prices.psa10);
  const japanesePsa10 = numericPrice(japanese && japanese.prices && japanese.prices.psa10);
  const delta = englishPsa10 != null && japanesePsa10 != null ? englishPsa10 - japanesePsa10 : null;
  const deltaPercent = delta != null && japanesePsa10 ? delta / japanesePsa10 * 100 : null;
  const warnings = [];
  if (!english || !english.prices || !english.prices.psa10) warnings.push("missing_en_psa10");
  if (!japanese || !japanese.prices || !japanese.prices.psa10) warnings.push("missing_jp_psa10");
  if (english && english.score && english.score < 170) warnings.push("low_confidence_en");
  if (japanese && japanese.score && japanese.score < 170) warnings.push("low_confidence_jp");

  return {
    saved: savedCard,
    english,
    japanese,
    deltaUsd: delta,
    deltaPercent,
    warning: warnings.join("|")
  };
}

async function exportSavedLinks() {
  const savedLinks = await getSavedLinks();
  const rows = [];
  for (const savedCard of savedLinks) {
    rows.push(await enrichSavedCard(savedCard));
  }
  return rows;
}

async function lookup(card, preferred) {
  await setPairsReady;
  const results = await searchPriceCharting(card);
  const englishCandidates = PriceCharting.rankResults(results, card, "english", 6);
  const japaneseCandidates = PriceCharting.rankResults(results, card, "japanese", 6);
  let english = pickCandidate(englishCandidates, preferred && preferred.english);
  let japanese = pickCandidate(japaneseCandidates, preferred && preferred.japanese);

  const preferredEnglish = preferred && preferred.english;
  const preferredJapanese = preferred && preferred.japanese;
  if (!preferredJapanese && english) {
    const pinnedJapaneseUrl = await getPinnedCounterpartUrl(english.url);
    japanese = candidateByUrl(japaneseCandidates, pinnedJapaneseUrl) || japanese;
  }
  if (!preferredEnglish && japanese) {
    const pinnedEnglishUrl = await getPinnedCounterpartUrl(japanese.url);
    english = candidateByUrl(englishCandidates, pinnedEnglishUrl) || english;
  }

  const [englishDetail, japaneseDetail] = await Promise.all([
    addDetail(english),
    addDetail(japanese)
  ]);

  return {
    english: { selected: englishDetail, candidates: englishCandidates },
    japanese: { selected: japaneseDetail, candidates: japaneseCandidates },
    fetchedAt: Date.now()
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "PC_OPEN_TABS") {
    const urls = Array.from(new Set(Array.isArray(message.urls) ? message.urls : []))
      .filter((url) => /^https:\/\//i.test(url))
      .slice(0, 6);

    (async () => {
      const baseIndex = sender.tab && Number.isInteger(sender.tab.index) ? sender.tab.index + 1 : undefined;
      for (let index = 0; index < urls.length; index += 1) {
        await chrome.tabs.create({
          url: urls[index],
          active: false,
          ...(baseIndex == null ? {} : { index: baseIndex + index })
        });
      }
      return { opened: urls.length };
    })()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (!message || !["PC_LOOKUP", "PC_DETAIL", "PC_DETAILS_BATCH", "PC_PIN_COUNTERPART", "PC_SAVE_CARD_LINK", "PC_GET_SAVED_LINKS", "PC_CLEAR_SAVED_LINKS", "PC_EXPORT_SAVED_LINKS"].includes(message.type)) return undefined;

  (async () => {
    if (message.type === "PC_LOOKUP") {
      return lookup(message.card || {}, message.preferred || {});
    }
    if (message.type === "PC_SAVE_CARD_LINK") {
      return saveCardLink(message.card || {});
    }
    if (message.type === "PC_GET_SAVED_LINKS") {
      return getSavedLinks();
    }
    if (message.type === "PC_CLEAR_SAVED_LINKS") {
      return clearSavedLinks();
    }
    if (message.type === "PC_EXPORT_SAVED_LINKS") {
      return exportSavedLinks();
    }
    if (message.type === "PC_PIN_COUNTERPART") {
      return pinCounterpartPair(message.englishUrl, message.japaneseUrl);
    }
    if (message.type === "PC_DETAILS_BATCH") {
      const products = Array.isArray(message.products) ? message.products.slice(0, 10) : [];
      return Promise.all(products.map(async (product) => {
        try {
          return { ok: true, url: product.url, product: await addDetail(product) };
        } catch (error) {
          return { ok: false, url: product.url, error: error.message || String(error) };
        }
      }));
    }
    return addDetail(message.product);
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "PC_TOGGLE_PANEL" }).catch(() => {});
});
