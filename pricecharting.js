(function (root, factory) {
  const api = factory();
  root.PriceCharting = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  let setPairs = {
    englishToJapanese: {
      "phantasmal flames": ["inferno x"],
      "perfect order": ["nihil zero"]
    },
    japaneseToEnglish: {
      "inferno x": ["phantasmal flames"],
      "nihil zero": ["perfect order"]
    }
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

  function buildSetPairIndex(dataset) {
    const englishToJapanese = {};
    const japaneseToEnglish = {};
    const pairs = Array.isArray(dataset && dataset.pairs) ? dataset.pairs : [];

    for (const pair of pairs) {
      const english = normalizeSet(pair && pair.english);
      const japanese = Array.isArray(pair && pair.japanese)
        ? pair.japanese.map(normalizeSet).filter(Boolean)
        : [];
      if (!english || !japanese.length) continue;
      englishToJapanese[english] = Array.from(new Set(japanese));
      for (const japaneseSet of japanese) {
        japaneseToEnglish[japaneseSet] = Array.from(new Set([
          ...(japaneseToEnglish[japaneseSet] || []),
          english
        ]));
      }
    }

    return { englishToJapanese, japaneseToEnglish };
  }

  function configureSetPairs(dataset) {
    const next = buildSetPairIndex(dataset);
    if (Object.keys(next.englishToJapanese).length) setPairs = next;
    return getSetPairs();
  }

  function getSetPairs() {
    return {
      englishToJapanese: { ...setPairs.englishToJapanese },
      japaneseToEnglish: { ...setPairs.japaneseToEnglish }
    };
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

  function extractNumber(text) {
    const match = String(text || "").match(/[\d,]+(?:\.\d+)?/);
    return match ? Number(match[0].replace(/,/g, "")) : null;
  }

  function parseVolumeMap(html) {
    const text = stripTags(html);
    const matches = Array.from(text.matchAll(/volume:\s*([^]*?)(?=volume:|$)/gi))
      .map((match) => cleanVolumeText(match[1]))
      .filter(Boolean)
      .slice(0, 6);
    const [ungraded, grade7, grade8, grade9, grade95, psa10] = matches;
    return { ungraded, grade7, grade8, grade9, grade95, psa10 };
  }

  function cleanVolumeText(value) {
    const cleaned = String(value || "")
      .replace(/\b(?:PSA\s*10\s*Pop|Total\s+Graded|POP\s+Report)\b[\s\S]*$/i, " ")
      .replace(/\+\s*$/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const liquidityMatch = cleaned.match(/\b\d+\s+sales?\s+per\s+(?:day|week|month|year)\b/i) ||
      cleaned.match(/\b1\s+sale\s+per\s+(?:day|week|month|year)\b/i) ||
      cleaned.match(/\brare\b/i);
    return liquidityMatch ? liquidityMatch[0] : cleaned;
  }

  function parseLiquidityLabel(volumeText) {
    const text = String(volumeText || "").toLowerCase();
    if (!text) return "";
    if (text.includes("per day")) return "high";
    if (text.includes("per week")) return "medium";
    if (text.includes("per month") || text.includes("per year")) return "low";
    if (text.includes("rare")) return "low";
    return "unknown";
  }

  function parsePopulationStats(html) {
    const text = stripTags(html);
    const psa10PopMatch =
      text.match(/PSA\s*10(?:\s*pop(?:ulation)?|\s*population)?[^0-9]{0,20}([\d,]+)/i) ||
      text.match(/population(?:\s*report)?[^.]{0,120}?PSA\s*10[^0-9]{0,20}([\d,]+)/i);
    const totalGradedMatch = text.match(/total\s+graded[^0-9]{0,20}([\d,]+)/i);
    const psa10PctMatch =
      text.match(/PSA\s*10\s*(?:percentage|percent(?:age)?|rate)[^0-9]{0,20}([\d,.]+\s*%?)/i) ||
      text.match(/gem\s*rate[^0-9]{0,20}([\d,.]+\s*%?)/i);

    const psa10Pop = psa10PopMatch ? extractNumber(psa10PopMatch[1]) : null;
    const totalGraded = totalGradedMatch ? extractNumber(totalGradedMatch[1]) : null;
    const psa10Percentage = psa10PctMatch
      ? `${String(psa10PctMatch[1]).replace(/\s+/g, "").replace(/%?$/, "%")}`
      : (psa10Pop != null && totalGraded ? `${(psa10Pop / totalGraded * 100).toFixed(1)}%` : null);

    return { psa10Pop, totalGraded, psa10Percentage };
  }

  function parseProductDetail(html) {
    const prices = {
      ungraded: extractDetailPrice(html, "used_price"),
      grade7: extractDetailPrice(html, "complete_price"),
      grade8: extractDetailPrice(html, "new_price"),
      grade9: extractDetailPrice(html, "graded_price"),
      grade95: extractDetailPrice(html, "box_only_price"),
      psa10: extractDetailPrice(html, "manual_only_price")
    };
    const volumes = parseVolumeMap(html);
    const preferredVolume = [
      volumes.psa10,
      volumes.grade95,
      volumes.grade9,
      volumes.grade8,
      volumes.grade7,
      volumes.ungraded
    ].find(Boolean) || "";
    const population = parsePopulationStats(html);
    return {
      prices,
      stats: {
        volumeText: preferredVolume,
        liquidityLabel: parseLiquidityLabel(preferredVolume),
        volumes,
        ...population
      }
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
      for (const [japaneseSet, englishSets] of Object.entries(setPairs.japaneseToEnglish)) {
        if (cardSet.includes(japaneseSet) && englishSets.some((set) => productSet.includes(set))) return true;
      }
      return false;
    }
    if (language === "japanese" && !sourceIsJapanese) {
      const pairedSets = setPairs.englishToJapanese[cardSet] || [];
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
    configureSetPairs,
    getSetPairs,
    decodeHtml,
    normalizeName,
    normalizeSet,
    parseSearchResults,
    parseProductDetail,
    parseLiquidityLabel,
    rankResults,
    scoreProduct,
    isEnglish,
    isJapanese
  };
});
