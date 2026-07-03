(function () {
  "use strict";

  const detector = globalThis.PokeCardDetector;
  const navigation = globalThis.PokeNavigation;
  let host = null;
  let shadow = null;
  let currentCard = null;
  let currentResult = null;
  let currentKnownLinks = {};
  let currentNavigation = [];
  let currentFingerprint = "";
  let lookupToken = 0;
  let hidden = false;
  let minimized = false;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function preferenceKey(card) {
    const identity = `${card.source}:${card.name}:${card.number || ""}`
      .toLowerCase()
      .replace(/[^a-z0-9:]+/g, "-")
      .slice(0, 160);
    return `poke-price-lens:${identity}`;
  }

  function getPreferred(card) {
    return new Promise((resolve) => {
      chrome.storage.local.get(preferenceKey(card), (stored) => {
        if (chrome.runtime.lastError) return resolve({});
        resolve(stored[preferenceKey(card)] || {});
      });
    });
  }

  function savePreferred(card, language, url) {
    const key = preferenceKey(card);
    chrome.storage.local.get(key, (stored) => {
      if (chrome.runtime.lastError) return;
      chrome.storage.local.set({
        [key]: { ...(stored[key] || {}), [language]: url }
      });
    });
  }

  function getKnownLinks(card) {
    return new Promise((resolve) => {
      const key = navigation.cardKey(card);
      chrome.storage.local.get(key, (stored) => {
        if (chrome.runtime.lastError) return resolve({});
        resolve(stored[key] || {});
      });
    });
  }

  function rememberCurrentSite(card) {
    return new Promise((resolve) => {
      const hostname = location.hostname.toLowerCase();
      const site = hostname === "app.getcollectr.com"
        ? "collectr"
        : /tcgplayer\.com$/.test(hostname) ? "tcgplayer" : "";
      if (!site) return getKnownLinks(card).then(resolve);

      const key = navigation.cardKey(card);
      chrome.storage.local.get(key, (stored) => {
        const links = { ...(stored[key] || {}), [site]: location.href };
        chrome.storage.local.set({ [key]: links }, () => resolve(links));
      });
    });
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response || !response.ok) return reject(new Error(response && response.error || "Extension request failed"));
        resolve(response.data);
      });
    });
  }

  function ensurePanel() {
    if (host) return;
    host = document.createElement("div");
    host.id = "poke-price-lens-root";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          width: min(390px, calc(100vw - 24px));
          max-height: min(760px, calc(100vh - 36px));
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, .28);
          border-radius: 16px;
          background: rgba(8, 15, 28, .78);
          color: #e5edf8;
          box-shadow: 0 18px 55px rgba(2, 6, 23, .38);
          -webkit-backdrop-filter: blur(18px) saturate(135%);
          backdrop-filter: blur(18px) saturate(135%);
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .header { display: flex; align-items: center; gap: 9px; min-height: 52px; padding: 10px 11px 10px 14px; border-bottom: 1px solid #1e293b; }
        .mark { display: grid; place-items: center; width: 29px; height: 29px; flex: none; border-radius: 50%; background: linear-gradient(#ef4444 0 45%, #f8fafc 45% 100%); border: 2px solid #020617; box-shadow: inset 0 0 0 1px rgba(255,255,255,.3); }
        .mark::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #f8fafc; border: 2px solid #020617; }
        .heading { min-width: 0; flex: 1; }
        .brand { color: #f8fafc; font-size: 14px; font-weight: 750; letter-spacing: -.01em; }
        .card-label { overflow: hidden; color: #94a3b8; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .icon-button { display: grid; place-items: center; width: 29px; height: 29px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: #94a3b8; cursor: pointer; font: 17px/1 sans-serif; }
        .icon-button:hover { background: #1e293b; color: #f8fafc; }
        .content { max-height: calc(min(760px, 100vh - 36px) - 53px); overflow: auto; }
        .panel.minimized .content { display: none; }
        .panel.minimized { width: 280px; }
        .status { display: flex; min-height: 190px; align-items: center; justify-content: center; padding: 26px; color: #94a3b8; text-align: center; }
        .spinner { width: 20px; height: 20px; margin: 0 auto 11px; border: 2px solid #334155; border-top-color: #60a5fa; border-radius: 50%; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .site-nav { padding: 12px 14px 13px; border-bottom: 1px solid #1e293b; }
        .site-nav-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; color: #7f8ea3; font-size: 10px; letter-spacing: .07em; text-transform: uppercase; }
        .site-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .site-link { position: relative; display: flex; min-width: 0; min-height: 36px; align-items: center; justify-content: space-between; gap: 6px; padding: 7px 8px; border: 1px solid rgba(100, 116, 139, .4); border-radius: 8px; background: rgba(17, 27, 46, .58); color: #dbeafe; font-size: 11px; font-weight: 650; text-decoration: none; }
        a.site-link:hover { border-color: rgba(147, 197, 253, .7); background: rgba(30, 58, 95, .7); }
        .site-link.current { border-color: #60a5fa; background: rgba(30, 64, 175, .26); color: #f8fafc; cursor: default; }
        .site-state { flex: none; color: #64748b; font-size: 8px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
        .site-link.current .site-state { color: #93c5fd; }
        .open-all { width: 100%; height: 32px; margin-top: 7px; border: 1px solid rgba(96, 165, 250, .55); border-radius: 8px; background: rgba(29, 78, 216, .32); color: #dbeafe; cursor: pointer; font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .open-all:hover { background: rgba(29, 78, 216, .5); color: white; }
        .listing-comparison { padding: 12px 14px 13px; border-bottom: 1px solid #1e293b; }
        .comparison-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: #7f8ea3; font-size: 10px; letter-spacing: .07em; text-transform: uppercase; }
        .comparison-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
        .comparison-value { padding: 9px; border: 1px solid rgba(100, 116, 139, .38); border-radius: 9px; background: rgba(17, 27, 46, .62); }
        .comparison-value span { display: block; color: #7f8ea3; font-size: 9px; text-transform: uppercase; }
        .comparison-value strong { color: #f8fafc; font-size: 15px; font-variant-numeric: tabular-nums; }
        .comparison-verdict { margin-top: 8px; color: #cbd5e1; font-size: 11px; }
        .comparison-verdict.good { color: #86efac; }
        .comparison-verdict.high { color: #fca5a5; }
        .comparison-note { margin-top: 3px; color: #64748b; font-size: 9px; }
        .language { padding: 14px; border-bottom: 1px solid #1e293b; }
        .language-top { display: flex; align-items: center; gap: 11px; }
        .thumb { width: 52px; height: 72px; flex: none; border-radius: 5px; background: #172033; object-fit: cover; box-shadow: 0 2px 10px rgba(0,0,0,.28); }
        .meta { min-width: 0; flex: 1; }
        .language-name { margin-bottom: 3px; color: #93c5fd; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
        .product-link { display: block; overflow: hidden; color: #f8fafc; font-size: 14px; font-weight: 680; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
        .product-link:hover { color: #93c5fd; }
        .set { overflow: hidden; color: #94a3b8; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .prices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 12px; }
        .price { padding: 8px 7px; border: 1px solid rgba(100, 116, 139, .38); border-radius: 9px; background: rgba(17, 27, 46, .62); }
        .price-label { display: block; margin-bottom: 2px; color: #7f8ea3; font-size: 10px; text-transform: uppercase; }
        .price-value { color: #f8fafc; font-size: 14px; font-weight: 750; font-variant-numeric: tabular-nums; }
        .picker-label { display: block; margin-top: 10px; color: #7f8ea3; font-size: 10px; text-transform: uppercase; }
        select { width: 100%; height: 31px; margin-top: 4px; padding: 0 27px 0 8px; border: 1px solid rgba(100, 116, 139, .55); border-radius: 7px; background: rgba(17, 24, 39, .78); color: #cbd5e1; font: 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .empty { padding: 15px; border: 1px dashed #334155; border-radius: 10px; color: #94a3b8; }
        .footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px 12px; color: #64748b; font-size: 10px; }
        .footer a { color: #93c5fd; text-decoration: none; }
        .retry { padding: 7px 10px; border: 1px solid #3b82f6; border-radius: 7px; background: #1d4ed8; color: white; cursor: pointer; font: 600 12px/1 sans-serif; }
      </style>
      <section class="panel" aria-label="Poké Price Lens">
        <header class="header">
          <span class="mark" aria-hidden="true"></span>
          <div class="heading">
            <div class="brand">Poké Price Lens</div>
            <div class="card-label">Waiting for a card…</div>
          </div>
          <button class="icon-button minimize" type="button" title="Minimize" aria-label="Minimize">−</button>
          <button class="icon-button close" type="button" title="Close" aria-label="Close">×</button>
        </header>
        <div class="content"><div class="status">Waiting for a card…</div></div>
      </section>
    `;
    document.documentElement.appendChild(host);

    shadow.querySelector(".close").addEventListener("click", () => {
      hidden = true;
      host.style.display = "none";
    });
    shadow.querySelector(".minimize").addEventListener("click", () => {
      minimized = !minimized;
      shadow.querySelector(".panel").classList.toggle("minimized", minimized);
      shadow.querySelector(".minimize").textContent = minimized ? "+" : "−";
      shadow.querySelector(".minimize").title = minimized ? "Expand" : "Minimize";
    });
  }

  function setCardLabel(card) {
    if (!shadow) return;
    shadow.querySelector(".card-label").textContent = card
      ? `${card.name}${card.number ? ` #${card.number}` : ""}${card.set ? ` · ${card.set}` : ""}`
      : "No card detected";
  }

  function renderLoading(card) {
    ensurePanel();
    setCardLabel(card);
    shadow.querySelector(".content").innerHTML = `
      <div class="status"><div><div class="spinner"></div>Finding English and Japanese matches…</div></div>
    `;
  }

  function candidateLabel(candidate) {
    return `${candidate.title}${candidate.set ? ` · ${candidate.set.replace(/^Pokémon\s+/i, "")}` : ""}`;
  }

  function priceBox(label, value) {
    return `<div class="price"><span class="price-label">${label}</span><span class="price-value">${escapeHtml(value || "—")}</span></div>`;
  }

  function navigationBlock() {
    if (!currentNavigation.length) return "";
    const links = currentNavigation.map((item) => {
      const state = item.current ? "Here" : item.exact ? "Exact" : "Search";
      const inner = `<span>${escapeHtml(item.label)}</span><span class="site-state">${state}</span>`;
      return item.current
        ? `<span class="site-link current" title="Current site">${inner}</span>`
        : `<a class="site-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${inner}</a>`;
    }).join("");
    return `
      <nav class="site-nav" aria-label="Open this card on another site">
        <div class="site-nav-title"><span>Card navigator</span><span>Poké Price Lens</span></div>
        <div class="site-grid">${links}</div>
        <button class="open-all" type="button" data-open-all>Open all</button>
      </nav>
    `;
  }

  function numericPrice(value) {
    const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function listingComparisonBlock() {
    if (!currentCard || currentCard.source !== "ebay") return "";
    const ask = numericPrice(currentCard.listingPrice);
    const language = currentCard.listingLanguage === "japanese" ? "japanese" : "english";
    const product = currentResult && currentResult[language] && currentResult[language].selected;
    const gradeKey = currentCard.listingGrade === "psa10"
      ? "psa10"
      : currentCard.listingGrade === "grade9" ? "grade9" : "ungraded";
    const gradeLabel = gradeKey === "psa10" ? "PSA 10" : gradeKey === "grade9" ? "Grade 9" : "Ungraded";
    const marketText = product && product.prices && product.prices[gradeKey];
    const market = numericPrice(marketText);
    let verdict = "Price comparison is unavailable for this listing.";
    let verdictClass = "";

    if (ask != null && market != null && market > 0) {
      const difference = ask - market;
      const percent = Math.abs(difference / market * 100);
      verdict = difference === 0
        ? "The asking price matches the PriceCharting value."
        : `The asking price is ${percent.toFixed(1)}% ${difference < 0 ? "below" : "above"} the matched value.`;
      verdictClass = difference < 0 ? "good" : "high";
    }

    return `
      <section class="listing-comparison">
        <div class="comparison-title"><span>eBay listing comparison</span><span>${escapeHtml(language === "japanese" ? "Japanese" : "English")}</span></div>
        <div class="comparison-grid">
          <div class="comparison-value"><span>eBay ask</span><strong>${escapeHtml(currentCard.listingPrice || "—")}</strong></div>
          <div class="comparison-value"><span>PriceCharting ${escapeHtml(gradeLabel)}</span><strong>${escapeHtml(marketText || "—")}</strong></div>
        </div>
        <div class="comparison-verdict ${verdictClass}">${escapeHtml(verdict)}</div>
        <div class="comparison-note">Asking price only; shipping, tax, bids, and offers are not included.</div>
      </section>
    `;
  }

  function languageBlock(language, label, group) {
    const product = group && group.selected;
    if (!product) {
      return `<section class="language"><div class="language-name">${label}</div><div class="empty">No confident ${label.toLowerCase()} match was found on PriceCharting.</div></section>`;
    }

    const candidates = group.candidates || [];
    const options = candidates.map((candidate) => `
      <option value="${escapeHtml(candidate.url)}" ${candidate.url === product.url ? "selected" : ""}>${escapeHtml(candidateLabel(candidate))}</option>
    `).join("");
    return `
      <section class="language" data-language="${language}">
        <div class="language-top">
          ${product.image ? `<img class="thumb" src="${escapeHtml(product.image.replace(/\/60\.jpg(?:\?.*)?$/, "/240.jpg"))}" alt="">` : ""}
          <div class="meta">
            <div class="language-name">${label}</div>
            <a class="product-link" href="${escapeHtml(product.url)}" target="_blank" rel="noreferrer">${escapeHtml(product.title)}</a>
            <div class="set">${escapeHtml(product.set)}</div>
          </div>
        </div>
        <div class="prices">
          ${priceBox("Ungraded", product.prices && product.prices.ungraded)}
          ${priceBox("Grade 9", product.prices && product.prices.grade9)}
          ${priceBox("PSA 10", product.prices && product.prices.psa10)}
        </div>
        ${candidates.length > 1 ? `<label class="picker-label">Match<select data-match-picker="${language}">${options}</select></label>` : ""}
      </section>
    `;
  }

  function genericSearchUrl(card) {
    return `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(card.name)}`;
  }

  function renderResult() {
    if (!currentCard || !currentResult) return;
    setCardLabel(currentCard);
    const when = new Date(currentResult.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    shadow.querySelector(".content").innerHTML = `
      ${navigationBlock()}
      ${listingComparisonBlock()}
      ${languageBlock("english", "English", currentResult.english)}
      ${languageBlock("japanese", "Japanese", currentResult.japanese)}
      <div class="footer">
        <span>PriceCharting · checked ${escapeHtml(when)}</span>
        <a href="${escapeHtml(genericSearchUrl(currentCard))}" target="_blank" rel="noreferrer">View all matches ↗</a>
      </div>
    `;

    for (const picker of shadow.querySelectorAll("[data-match-picker]")) {
      picker.addEventListener("change", () => changeMatch(picker.dataset.matchPicker, picker.value));
    }
    const openAll = shadow.querySelector("[data-open-all]");
    if (openAll) openAll.addEventListener("click", () => openAllSites(openAll));
  }

  async function openAllSites(button) {
    const urls = currentNavigation.filter((item) => !item.current).map((item) => item.url);
    if (!urls.length) return;
    button.disabled = true;
    button.textContent = "Opening…";
    try {
      await sendMessage({ type: "PC_OPEN_TABS", urls });
      button.textContent = "Opened";
    } catch (error) {
      button.textContent = "Couldn’t open tabs";
      button.title = error.message;
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "Open all";
      }, 1200);
    }
  }

  async function changeMatch(language, url) {
    if (!currentResult || !currentCard) return;
    const group = currentResult[language];
    const candidate = group.candidates.find((item) => item.url === url);
    if (!candidate) return;

    pickerLoading(language);
    try {
      group.selected = await sendMessage({ type: "PC_DETAIL", product: candidate });
      currentResult.fetchedAt = Date.now();
      currentNavigation = navigation.resolveLinks(currentCard, currentResult, currentKnownLinks, location.href);
      savePreferred(currentCard, language, url);
      renderResult();
    } catch (error) {
      renderError(error);
    }
  }

  function pickerLoading(language) {
    const section = shadow.querySelector(`.language[data-language="${language}"]`);
    if (!section) return;
    for (const value of section.querySelectorAll(".price-value")) value.textContent = "…";
    const picker = section.querySelector("select");
    if (picker) picker.disabled = true;
  }

  function renderError(error) {
    ensurePanel();
    setCardLabel(currentCard);
    const fallback = currentCard ? genericSearchUrl(currentCard) : "https://www.pricecharting.com/";
    shadow.querySelector(".content").innerHTML = `
      <div class="status"><div>
        <div style="color:#fca5a5;margin-bottom:12px">${escapeHtml(error.message || String(error))}</div>
        <a class="retry" href="${escapeHtml(fallback)}" target="_blank" rel="noreferrer">Open PriceCharting search</a>
      </div></div>
    `;
  }

  function renderNotDetected() {
    ensurePanel();
    setCardLabel(null);
    shadow.querySelector(".content").innerHTML = `
      <div class="status">Open an individual Pokémon card product page on Collectr or TCGplayer.</div>
    `;
  }

  async function loadCard(card) {
    const token = ++lookupToken;
    currentCard = card;
    currentResult = null;
    currentNavigation = [];
    ensurePanel();
    if (!hidden) host.style.display = "block";
    renderLoading(card);

    try {
      const [preferred, knownLinks] = await Promise.all([
        getPreferred(card),
        rememberCurrentSite(card)
      ]);
      currentKnownLinks = knownLinks;
      const result = await sendMessage({ type: "PC_LOOKUP", card, preferred });
      if (token !== lookupToken) return;
      currentResult = result;
      currentNavigation = navigation.resolveLinks(card, result, knownLinks, location.href);
      renderResult();
    } catch (error) {
      if (token !== lookupToken) return;
      renderError(error);
    }
  }

  function detectAndLoad() {
    const card = detector && detector.detectCard(document, location);
    const fingerprint = card ? JSON.stringify(card) : "";
    if (!card || fingerprint === currentFingerprint) return;
    currentFingerprint = fingerprint;
    loadCard(card);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "PC_TOGGLE_PANEL") return;
    ensurePanel();
    hidden = host.style.display !== "none";
    host.style.display = hidden ? "none" : "block";
    if (!hidden && !currentCard) {
      const card = detector && detector.detectCard(document, location);
      if (card) {
        currentFingerprint = JSON.stringify(card);
        loadCard(card);
      } else {
        renderNotDetected();
      }
    }
  });

  detectAndLoad();
  setInterval(detectAndLoad, 1000);
})();
