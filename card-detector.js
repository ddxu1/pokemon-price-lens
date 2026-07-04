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
    const fractionMatch = value.match(
      /^(.+?)\s+-\s+(\d{1,4}[a-z]?)\s*\/\s*(\d{1,4}[a-z]?)\s+-\s+(.+?)\s+Pokemon\s+-\s+Collectr$/i
    );
    if (fractionMatch) {
      return { source: "collectr", name: clean(fractionMatch[1]), number: fractionMatch[2], fullNumber: `${fractionMatch[2]}/${fractionMatch[3]}`, set: clean(fractionMatch[4]) };
    }
    const simpleMatch = value.match(
      /^(.+?)\s+-\s+(\d{1,4}[a-z]?)\s+-\s+(.+?)\s+Pokemon\s+-\s+Collectr$/i
    );
    if (!simpleMatch) return null;
    return { source: "collectr", name: clean(simpleMatch[1]), number: simpleMatch[2], fullNumber: "", set: clean(simpleMatch[3]) };
  }

  function parseTcgplayerTitle(title) {
    const value = clean(title).replace(/\s*\|\s*TCGplayer.*$/i, "");
    const number = cardNumber(value);
    const pieces = value.split(/\s+-\s+/).map(clean).filter(Boolean);
    const numberIndex = pieces.findIndex((piece) => /\d{1,4}[a-z]?\s*\/\s*\d{1,4}[a-z]?/i.test(piece));
    const name = cleanCardName(numberIndex > 0 ? pieces.slice(0, numberIndex).join(" - ") : pieces[0]);
    const setCandidates = numberIndex >= 0 ? pieces.slice(numberIndex + 1) : pieces.slice(1);
    const set = setCandidates
      .find((piece) => !/^(pok[eé]mon|tcgplayer|near mint|lightly played)$/i.test(piece)) || "";
    return name ? { source: "tcgplayer", name, number, fullNumber: fullCardNumber(value), set: clean(set) } : null;
  }

  function titleCaseWords(value) {
    return clean(value)
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function parseTcgplayerSlug(pathname) {
    const match = String(pathname || "").match(/\/product\/\d+\/([^/?#]+)/i);
    if (!match) return null;
    const tokens = match[1]
      .split("-")
      .map(clean)
      .filter(Boolean);
    if (!tokens.length) return null;

    const gameIndex = tokens.findIndex((token) => /^pok[eé]mon$/i.test(token));
    const parts = gameIndex >= 0 ? tokens.slice(gameIndex + 1) : tokens;
    if (parts.length < 2) return null;

    if (parts.length >= 3 && /^set$/i.test(parts[parts.length - 2])) {
      return {
        source: "tcgplayer",
        name: titleCaseWords(parts.slice(-1).join(" ")),
        number: "",
        fullNumber: "",
        set: titleCaseWords(parts.slice(0, -1).join(" "))
      };
    }

    for (let size = Math.min(5, parts.length - 1); size >= 1; size -= 1) {
      const nameTokens = parts.slice(-size);
      const setTokens = parts.slice(0, -size);
      if (!setTokens.length) continue;
      return {
        source: "tcgplayer",
        name: titleCaseWords(nameTokens.join(" ")),
        number: "",
        fullNumber: "",
        set: titleCaseWords(setTokens.join(" "))
      };
    }
    return null;
  }

  function cleanEbayCardName(title, fullNumber) {
    let value = clean(title).replace(/\s*\|\s*eBay.*$/i, "");
    if (fullNumber) value = value.split(new RegExp(fullNumber.replace("/", "\\s*\\/\\s*"), "i"))[0];
    else value = value.replace(/\s*#\s*\d+[a-z]?.*$/i, "");
    return clean(value)
      .replace(/\b(?:19|20)\d{2}\b/g, " ")
      .replace(/\b(?:pok[eé]mon|tcg|card|cards|english|japanese|jpn)\b/gi, " ")
      .replace(/\b(?:sir|sar|holo|foil|rare|mint|nm|graded|ungraded|psa|bgs|cgc)\b(?:\s*\d+(?:\.\d+)?)?/gi, " ")
      .replace(/^[\s\-|–—:]+|[\s\-|–—:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function inferEbaySet(title, fullNumber) {
    if (!fullNumber) return "";
    const pattern = new RegExp(fullNumber.replace("/", "\\s*\\/\\s*"), "i");
    const tail = clean(title).split(pattern)[1] || "";
    return clean(tail)
      .replace(/\s*\|\s*eBay.*$/i, "")
      .replace(/^\s*[\-|–—:]\s*/, "")
      .replace(/\b(?:pok[eé]mon|tcg|card|cards|english|japanese|jpn|psa\s*\d+|bgs\s*\d+(?:\.\d+)?|cgc\s*\d+(?:\.\d+)?|sir|sar|holo|foil|rare|mint|nm|condition|pack fresh)\b/gi, " ")
      .replace(/^\s*[a-z]{1,5}\d{1,3}\s*:\s*/i, "")
      .replace(/[()[\]]/g, " ")
      .replace(/[\s\-|–—:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseEbayListingTitle(title, specifics) {
    const details = specifics || {};
    const fullNumber = fullCardNumber(details.cardNumber || title);
    const number = cardNumber(details.cardNumber || title);
    const rawLanguage = clean(details.language || title);
    const language = /\b(?:japanese|jpn|jp)\b/i.test(rawLanguage) ? "japanese" : "english";
    const evidence = `${details.grade || ""} ${details.condition || ""} ${title || ""}`;
    const grade = /\bPSA\s*10\b/i.test(evidence)
      ? "psa10"
      : /\b(?:PSA|BGS|CGC|TAG|SGC)\s*9(?:\.0)?\b/i.test(evidence) ? "grade9" : "ungraded";
    let set = clean(details.set) || inferEbaySet(title, fullNumber);
    if (language === "japanese" && set && !/japanese/i.test(set)) set = `Pokemon Japanese ${set}`;
    const name = clean(details.cardName) || cleanEbayCardName(title, fullNumber);
    if (!name || !number) return null;
    return { source: "ebay", name, number, fullNumber, set, listingLanguage: language, listingGrade: grade };
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

  function ebaySpecific(document, label) {
    const expected = label.toLowerCase();
    const rows = document.querySelectorAll('.ux-labels-values, [class*="ux-labels-values"]');
    for (const row of rows) {
      const labelElement = row.querySelector('.ux-labels-values__labels, [class*="__labels"]');
      const valueElement = row.querySelector('.ux-labels-values__values, [class*="__values"]');
      const actual = clean(labelElement && labelElement.textContent).replace(/:$/, "").toLowerCase();
      if (actual === expected && valueElement) return clean(valueElement.textContent);
    }
    return "";
  }

  function ebayPrice(document) {
    const meta = document.querySelector('meta[itemprop="price"], meta[property="product:price:amount"]');
    const metaValue = meta && meta.getAttribute("content");
    if (metaValue && /\d/.test(metaValue)) {
      const amount = Number(String(metaValue).replace(/[^\d.]/g, ""));
      if (Number.isFinite(amount)) return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    const element = document.querySelector('.x-price-primary .ux-textspans, [data-testid="x-price-primary"] .ux-textspans, [itemprop="price"]');
    const match = clean(element && (element.getAttribute("content") || element.textContent)).match(/(?:US\s*)?\$\s*[\d,.]+/i);
    return match ? match[0].replace(/^US\s*/i, "") : "";
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
      const slugCard = parseTcgplayerSlug(pathname);
      const heading = textOf(document, "h1") || textOf(document, '[data-testid*="product-title"]');
      const combined = `${heading} ${metaTitle} ${title}`;
      const name = heading && !/tcgplayer/i.test(heading)
        ? cleanCardName(heading)
        : (titleCard && titleCard.name) || (slugCard && slugCard.name);
      const number = cardNumber(combined) || (titleCard && titleCard.number) || "";
      if (!name) return null;
      return {
        source: "tcgplayer",
        name,
        number,
        fullNumber: fullCardNumber(combined),
        set: detectTcgSet(document, titleCard) || (slugCard && slugCard.set) || ""
      };
    }

    if (/ebay\.com$/.test(host) && /\/(?:itm|p)\//i.test(pathname)) {
      const heading = textOf(document, "h1.x-item-title__mainTitle") || textOf(document, "h1");
      const rawTitle = heading || metaContent(document, "og:title") || title;
      const parsed = parseEbayListingTitle(rawTitle, {
        cardName: ebaySpecific(document, "Card Name"),
        cardNumber: ebaySpecific(document, "Card Number"),
        set: ebaySpecific(document, "Set"),
        language: ebaySpecific(document, "Language"),
        grade: ebaySpecific(document, "Grade"),
        condition: ebaySpecific(document, "Condition")
      });
      if (!parsed) return null;
      return { ...parsed, listingPrice: ebayPrice(document), listingTitle: rawTitle };
    }

    return null;
  }

  return { cardNumber, fullCardNumber, cleanCardName, parseCollectrTitle, parseTcgplayerTitle, parseEbayListingTitle, parseTcgplayerSlug, detectCard };
});
