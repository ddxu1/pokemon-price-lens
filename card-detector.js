(function (root, factory) {
  const api = factory();
  root.PokeCardDetector = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cardNumber(value) {
    const fraction = clean(value).match(/(?:#\s*)?(\d{1,4}[a-z]?)\s*\/\s*\d{1,4}[a-z]?/i);
    if (fraction) return fraction[1];
    const hash = clean(value).match(/#\s*(\d{1,4}[a-z]?)/i);
    return hash ? hash[1] : "";
  }

  function fullCardNumber(value) {
    const fraction = clean(value).match(/(?:#\s*)?(\d{1,4}[a-z]?)\s*\/\s*(\d{1,4}[a-z]?)/i);
    return fraction ? `${fraction[1]}/${fraction[2]}` : "";
  }

  function cleanCardName(value) {
    return clean(value)
      .replace(/\s*[-|–—]\s*#?\d{1,4}[a-z]?\s*\/\s*\d{1,4}[a-z]?.*$/i, "")
      .replace(/\s*#\s*\d{1,4}[a-z]?\s*$/i, "")
      .replace(/\s+prices?\s*$/i, "")
      .trim();
  }

  function parseCollectrTitle(title) {
    const value = clean(title);
    const match = value.match(
      /^(.+?)\s+-\s+(\d{1,4}[a-z]?)\s*\/\s*(\d{1,4}[a-z]?)\s+-\s+(.+?)\s+Pokemon\s+-\s+Collectr$/i
    );
    if (!match) return null;
    return { source: "collectr", name: clean(match[1]), number: match[2], fullNumber: `${match[2]}/${match[3]}`, set: clean(match[4]) };
  }

  function parseTcgplayerTitle(title) {
    const value = clean(title).replace(/\s*\|\s*TCGplayer.*$/i, "");
    const number = cardNumber(value);
    if (!number) return null;

    const pieces = value.split(/\s+-\s+/).map(clean).filter(Boolean);
    const numberIndex = pieces.findIndex((piece) => /\d{1,4}[a-z]?\s*\/\s*\d{1,4}[a-z]?/i.test(piece));
    const name = cleanCardName(numberIndex > 0 ? pieces.slice(0, numberIndex).join(" - ") : pieces[0]);
    const set = pieces
      .slice(numberIndex + 1)
      .find((piece) => !/^(pok[eé]mon|tcgplayer|near mint|lightly played)$/i.test(piece)) || "";
    return name ? { source: "tcgplayer", name, number, fullNumber: fullCardNumber(value), set: clean(set) } : null;
  }

  function textOf(document, selector) {
    const element = document.querySelector(selector);
    return element ? clean(element.textContent || element.getAttribute("content")) : "";
  }

  function metaContent(document, property) {
    const element = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
    return element ? clean(element.getAttribute("content")) : "";
  }

  function detectTcgSet(document, titleCard) {
    if (titleCard && titleCard.set) return titleCard.set;
    const selectors = [
      '[data-testid*="set-name"]',
      '.product-details__set-name',
      '.breadcrumb a[href*="/pokemon/"]',
      'a[href*="setName="]'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const value = clean(element.textContent || element.getAttribute("content"));
        if (value && !/^(pok[eé]mon|home|shop)$/i.test(value)) {
          return value.replace(/^\w{1,5}\d{1,3}:\s*/i, "");
        }
      }
    }
    return "";
  }

  function detectCard(document, location) {
    const host = location.hostname.toLowerCase();
    const pathname = location.pathname;
    const title = document.title || metaContent(document, "og:title");

    if (host === "app.getcollectr.com" && /\/explore\/product\//i.test(pathname)) {
      const parsed = parseCollectrTitle(title) || parseCollectrTitle(metaContent(document, "og:title"));
      if (parsed) return parsed;

      const heading = textOf(document, "h1");
      const nearby = `${heading} ${title}`;
      if (heading && cardNumber(nearby)) {
        return { source: "collectr", name: cleanCardName(heading), number: cardNumber(nearby), fullNumber: fullCardNumber(nearby), set: "" };
      }
      return null;
    }

    if (/tcgplayer\.com$/.test(host) && /\/product\//i.test(pathname)) {
      const metaTitle = metaContent(document, "og:title");
      const titleCard = parseTcgplayerTitle(metaTitle) || parseTcgplayerTitle(title);
      const heading = textOf(document, "h1") || textOf(document, '[data-testid*="product-title"]');
      const combined = `${heading} ${metaTitle} ${title}`;
      const name = heading && !/tcgplayer/i.test(heading)
        ? cleanCardName(heading)
        : titleCard && titleCard.name;
      const number = cardNumber(combined) || (titleCard && titleCard.number);
      if (!name || !number) return null;
      return {
        source: "tcgplayer",
        name,
        number,
        fullNumber: fullCardNumber(combined),
        set: detectTcgSet(document, titleCard)
      };
    }

    return null;
  }

  return { cardNumber, fullCardNumber, cleanCardName, parseCollectrTitle, parseTcgplayerTitle, detectCard };
});
