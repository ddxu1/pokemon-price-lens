(function (root, factory) {
  const api = factory();
  root.PokeNavigation = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/pok[eé]mon/g, "pokemon")
      .replace(/\s*#\s*\d+[a-z]?\b/gi, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeSet(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/^\s*pok[eé]mon\s+/i, "")
      .replace(/^\s*[a-z]{1,5}\d{1,3}\s*:\s*/i, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cardKey(card) {
    const name = normalizeName(card && card.name);
    const set = normalizeSet(card && card.set);
    const number = String(card && card.number || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return `poke-price-lens:links:${name}|${set}|${number}`;
  }

  function searchQuery(card) {
    const number = card && card.fullNumber || (card && card.number ? `#${card.number}` : "");
    return [card && card.name, number, card && card.set]
      .filter(Boolean)
      .join(" ");
  }

  function collectrSearchUrl(card) {
    const query = `site:app.getcollectr.com/explore/product ${searchQuery(card)}`;
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }

  function tcgplayerSearchUrl(card) {
    return `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&view=grid&q=${encodeURIComponent(searchQuery(card))}`;
  }

  function pricechartingSearchUrl(card, language) {
    const suffix = language === "japanese" ? " Japanese" : "";
    return `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(`${card && card.name || ""}${suffix}`.trim())}`;
  }

  function ebaySearchUrl(card, options) {
    const sold = Boolean(options && options.sold);
    const params = new URLSearchParams({ _nkw: searchQuery(card) });
    if (sold) {
      params.set("LH_Sold", "1");
      params.set("LH_Complete", "1");
    }
    return `https://www.ebay.com/sch/i.html?${params.toString()}`;
  }

  function hostname(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  function samePage(left, right) {
    try {
      const a = new URL(left);
      const b = new URL(right);
      return a.origin === b.origin && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
    } catch (_error) {
      return false;
    }
  }

  function isJapaneseProduct(product) {
    return /(?:^|[\s/-])japanese(?:[\s/-]|$)/i.test(`${product && product.set || ""} ${product && product.url || ""}`);
  }

  function resolveLinks(card, lookup, knownLinks, currentUrl, options) {
    const known = knownLinks || {};
    const soldMode = Boolean(options && options.soldComps);
    const currentHost = hostname(currentUrl);
    const englishProduct = lookup && lookup.english && lookup.english.selected;
    const japaneseProduct = lookup && lookup.japanese && lookup.japanese.selected;
    const currentIsCollectr = currentHost === "app.getcollectr.com";
    const currentIsTcgplayer = /tcgplayer\.com$/.test(currentHost);
    const currentIsEbay = /ebay\.com$/.test(currentHost) && /\/itm\//i.test(String(currentUrl || ""));

    const collectrExact = currentIsCollectr ? currentUrl : known.collectr;
    const tcgplayerExact = currentIsTcgplayer ? currentUrl : known.tcgplayer;

    return [
      {
        id: "collectr",
        label: "Collectr",
        url: collectrExact || collectrSearchUrl(card),
        exact: Boolean(collectrExact),
        current: currentIsCollectr
      },
      {
        id: "tcgplayer",
        label: "TCGplayer",
        url: tcgplayerExact || tcgplayerSearchUrl(card),
        exact: Boolean(tcgplayerExact),
        current: currentIsTcgplayer
      },
      {
        id: "pricecharting-english",
        label: "PriceCharting EN",
        url: englishProduct && englishProduct.url || pricechartingSearchUrl(card, "english"),
        exact: Boolean(englishProduct),
        current: Boolean(englishProduct && samePage(currentUrl, englishProduct.url))
      },
      {
        id: "pricecharting-japanese",
        label: "PriceCharting JP",
        url: japaneseProduct && japaneseProduct.url || pricechartingSearchUrl(card, "japanese"),
        exact: Boolean(japaneseProduct),
        current: Boolean(japaneseProduct && samePage(currentUrl, japaneseProduct.url))
      },
      {
        id: "ebay",
        label: soldMode ? "eBay sold" : "eBay",
        url: currentIsEbay && !soldMode ? currentUrl : ebaySearchUrl(card, { sold: soldMode }),
        exact: currentIsEbay,
        current: currentIsEbay && !soldMode
      }
    ];
  }

  function lookupForPriceChartingProduct(product) {
    if (!product) return {};
    const group = { selected: product, candidates: [product] };
    return isJapaneseProduct(product) ? { japanese: group } : { english: group };
  }

  return {
    normalizeName,
    normalizeSet,
    cardKey,
    searchQuery,
    collectrSearchUrl,
    tcgplayerSearchUrl,
    pricechartingSearchUrl,
    ebaySearchUrl,
    resolveLinks,
    lookupForPriceChartingProduct,
    isJapaneseProduct
  };
});
