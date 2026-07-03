(function (root, factory) {
  const api = factory();
  root.PriceCharting = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KNOWN_SET_PAIRS = {
    "phantasmal flames": ["inferno x"],
    "perfect order": ["nihil zero"]
  };

  const NON_ENGLISH_MARKERS = [
    "japanese",
    "korean",
    "chinese",
    "german",
    "french",
    "italian",
    "spanish",
    "portuguese",
    "dutch",
    "indonesian",
    "thai"
  ];

  function decodeHtml(value) {
    return String(value || "")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }

  function stripTags(value) {
    return decodeHtml(
      String(value || "")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  function absoluteUrl(value) {
    if (!value) return "";
    if (/^https:\/\//i.test(value)) return decodeHtml(value);
    return `https://www.pricecharting.com${decodeHtml(value)}`;
  }

  function normalizeName(value) {
    return decodeHtml(value)
      .toLowerCase()
      .replace(/pok[eé]mon/g, "pokemon")
      .replace(/\s*#\s*\d+[a-z]?\b/gi, " ")
      .replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeSet(value) {
    return decodeHtml(value)
      .toLowerCase()
      .replace(/^\s*pok[eé]mon\s+/i, "")
      .replace(/^\s*[a-z]{1,5}\d{1,3}\s*:\s*/i, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractPriceFromCell(row, className) {
    const pattern = new RegExp(
      `<td[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
      "i"
    );
    const cell = row.match(pattern);
    if (!cell) return null;
    const price = stripTags(cell[1]).match(/\$[\d,.]+/);
    return price ? price[0] : null;
  }

  function parseSearchResults(html) {
    const results = [];
    const rowPattern = /<tr[^>]*\bid=["']product-(\d+)["'][^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(String(html || "")))) {
      const row = rowMatch[2];
      const titleCell = row.match(/<td[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
      if (!titleCell) continue;

      const titleLink = titleCell[1].match(
        /<a[^>]*href=["']([^"']*\/game\/pokemon[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
      );
      if (!titleLink) continue;

      const setLink = row.match(
        /<a[^>]*href=["'][^"']*\/console\/pokemon[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
      );
      const image = row.match(/<img[^>]*class=["'][^"']*\bphoto\b[^"']*["'][^>]*src=["']([^"']+)["']/i) ||
        row.match(/<img[^>]*src=["']([^"']+)["'][^>]*class=["'][^"']*\bphoto\b/i);
      const title = stripTags(titleLink[2]);
      const numberMatch = title.match(/#\s*(\d+[a-z]?)/i);
      const set = setLink ? stripTags(setLink[1]) : "";
      const url = absoluteUrl(titleLink[1]);

      results.push({
        id: rowMatch[1],
        title,
        name: title.replace(/\s*#\s*\d+[a-z]?\s*$/i, "").trim(),
        number: numberMatch ? numberMatch[1] : "",
        set,
        url,
        image: image ? absoluteUrl(image[1]) : "",
        language: isJapanese({ set, url }) ? "japanese" : "english",
        prices: {
          ungraded: extractPriceFromCell(row, "used_price"),
          grade7: extractPriceFromCell(row, "cib_price"),
          grade8: extractPriceFromCell(row, "new_price")
        }
      });
    }

    return results;
  }

  function extractDetailPrice(html, id) {
    const pattern = new RegExp(
      `<td[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/td>`,
      "i"
    );
    const cell = String(html || "").match(pattern);
    if (!cell) return null;

    const primaryPrice = cell[1].match(
      /<span[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    );
    const text = stripTags(primaryPrice ? primaryPrice[1] : cell[1]);
    const price = text.match(/\$[\d,.]+/);
    return price ? price[0] : null;
  }

  function parseProductDetail(html) {
    return {
      ungraded: extractDetailPrice(html, "used_price"),
      grade7: extractDetailPrice(html, "complete_price"),
      grade8: extractDetailPrice(html, "new_price"),
      grade9: extractDetailPrice(html, "graded_price"),
      grade95: extractDetailPrice(html, "box_only_price"),
      psa10: extractDetailPrice(html, "manual_only_price")
    };
  }

  function isJapanese(product) {
    return /(?:^|[\s/-])japanese(?:[\s/-]|$)/i.test(`${product.set || ""} ${product.url || ""}`);
  }

  function isEnglish(product) {
    const haystack = `${product.set || ""} ${product.url || ""}`.toLowerCase();
    return !NON_ENGLISH_MARKERS.some((marker) => haystack.includes(marker));
  }

  function tokenSimilarity(left, right) {
    const a = new Set(normalizeName(left).split(" ").filter(Boolean));
    const b = new Set(normalizeName(right).split(" ").filter(Boolean));
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection += 1;
    return intersection / new Set([...a, ...b]).size;
  }

  function hasKnownSetPair(cardSet, productSet, sourceIsJapanese, language) {
    if (!cardSet || !productSet) return false;
    if (language === "english" && sourceIsJapanese) {
      for (const [englishSet, japaneseSets] of Object.entries(KNOWN_SET_PAIRS)) {
        if (japaneseSets.some((set) => cardSet.includes(set)) && productSet.includes(englishSet)) return true;
      }
      return false;
    }
    if (language === "japanese" && !sourceIsJapanese) {
      const pairedSets = KNOWN_SET_PAIRS[cardSet] || [];
      return pairedSets.some((set) => productSet.includes(set));
    }
    return false;
  }

  function scoreProduct(product, card, language, searchIndex) {
    const productName = normalizeName(product.name || product.title);
    const cardName = normalizeName(card.name);
    let score = tokenSimilarity(productName, cardName) * 100;

    if (productName === cardName) score += 120;
    if (productName.includes(cardName) || cardName.includes(productName)) score += 30;

    const productSet = normalizeSet(product.set);
    const cardSet = normalizeSet(card.set);
    const sourceIsJapanese = cardSet.includes("japanese");
    const pairMatched = hasKnownSetPair(cardSet, productSet, sourceIsJapanese, language);
    if (language === "english") {
      if (!sourceIsJapanese) {
        if (cardSet && productSet === cardSet) score += 110;
        else if (cardSet && (productSet.includes(cardSet) || cardSet.includes(productSet))) score += 45;
        if (card.number && String(product.number).toLowerCase() === String(card.number).toLowerCase()) score += 100;
      } else {
        if (pairMatched) score += 90;
      }
    } else {
      if (sourceIsJapanese) {
        if (productSet === cardSet) score += 110;
        else if (productSet.includes(cardSet) || cardSet.includes(productSet)) score += 45;
        if (card.number && String(product.number).toLowerCase() === String(card.number).toLowerCase()) score += 100;
      } else {
        if (pairMatched) score += 90;
      }
    }

    return {
      score: score - searchIndex * 0.25,
      pairMatched
    };
  }

  function rankResults(results, card, language, limit) {
    const eligible = results.filter(language === "japanese" ? isJapanese : isEnglish);
    return eligible
      .map((product, index) => ({
        ...product,
        ...scoreProduct(product, card, language, index)
      }))
      .filter((product) => product.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit || 6);
  }

  return {
    decodeHtml,
    normalizeName,
    normalizeSet,
    parseSearchResults,
    parseProductDetail,
    rankResults,
    scoreProduct,
    isEnglish,
    isJapanese
  };
});
