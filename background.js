importScripts("pricecharting.js");

const SEARCH_CACHE_TTL = 15 * 60 * 1000;
const DETAIL_CACHE_TTL = 15 * 60 * 1000;
const searchCache = new Map();
const detailCache = new Map();

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
  const prices = await cached(detailCache, product.url, DETAIL_CACHE_TTL, async () => {
    const html = await fetchText(product.url);
    return PriceCharting.parseProductDetail(html);
  });

  return {
    ...product,
    prices: { ...product.prices, ...Object.fromEntries(Object.entries(prices).filter(([, value]) => value)) }
  };
}

function pickCandidate(candidates, preferredUrl) {
  return candidates.find((candidate) => candidate.url === preferredUrl) || candidates[0] || null;
}

async function lookup(card, preferred) {
  const results = await searchPriceCharting(card);
  const englishCandidates = PriceCharting.rankResults(results, card, "english", 6);
  const japaneseCandidates = PriceCharting.rankResults(results, card, "japanese", 6);
  const english = pickCandidate(englishCandidates, preferred && preferred.english);
  const japanese = pickCandidate(japaneseCandidates, preferred && preferred.japanese);
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

  if (!message || !["PC_LOOKUP", "PC_DETAIL", "PC_DETAILS_BATCH"].includes(message.type)) return undefined;

  (async () => {
    if (message.type === "PC_LOOKUP") {
      return lookup(message.card || {}, message.preferred || {});
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
