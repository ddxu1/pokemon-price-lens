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
  let soldCompsMode = false;
  const PANEL_LAYOUT_KEY = "poke-price-lens:panel-layout:v1";
  const SOLD_COMPS_KEY = "poke-price-lens:sold-comps-mode:v1";
  const PANEL_MIN_WIDTH = 760;
  const PANEL_MIN_HEIGHT = 260;
  const PANEL_MARGIN = 12;
  const COMPACT_PANEL_WIDTH = 360;
  const COMPACT_PANEL_HEIGHT = 160;
  let panelLayout = null;

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

  function loadSoldCompsMode() {
    return new Promise((resolve) => {
      chrome.storage.local.get(SOLD_COMPS_KEY, (stored) => {
        if (chrome.runtime.lastError) return resolve(false);
        resolve(Boolean(stored[SOLD_COMPS_KEY]));
      });
    });
  }

  function saveSoldCompsMode(nextValue) {
    soldCompsMode = Boolean(nextValue);
    chrome.storage.local.set({ [SOLD_COMPS_KEY]: soldCompsMode });
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

  function defaultPanelLayout() {
    const width = Math.min(1080, Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MARGIN * 2));
    const height = Math.min(440, Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_MARGIN * 2));
    return {
      width,
      height,
      left: Math.max(PANEL_MARGIN, Math.round((window.innerWidth - width) / 2)),
      top: PANEL_MARGIN
    };
  }

  function compactPanelLayout() {
    const width = Math.min(COMPACT_PANEL_WIDTH, Math.max(320, window.innerWidth - PANEL_MARGIN * 2));
    const height = Math.min(COMPACT_PANEL_HEIGHT, Math.max(140, window.innerHeight - PANEL_MARGIN * 2));
    return {
      width,
      height,
      left: Math.max(PANEL_MARGIN, Math.round((window.innerWidth - width) / 2)),
      top: PANEL_MARGIN
    };
  }

  function clampPanelLayout(layout) {
    const maxWidth = Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MARGIN * 2);
    const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_MARGIN * 2);
    const width = Math.min(Math.max(PANEL_MIN_WIDTH, Math.round(layout.width || 0)), maxWidth);
    const height = Math.min(Math.max(PANEL_MIN_HEIGHT, Math.round(layout.height || 0)), maxHeight);
    const left = Math.min(
      Math.max(PANEL_MARGIN, Math.round(layout.left || 0)),
      Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN)
    );
    const top = Math.min(
      Math.max(PANEL_MARGIN, Math.round(layout.top || 0)),
      Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN)
    );
    return { width, height, left, top };
  }

  function applyPanelLayout(nextLayout) {
    if (!shadow) return;
    const panel = shadow.querySelector(".panel");
    if (!panel) return;
    panelLayout = clampPanelLayout(nextLayout || panelLayout || defaultPanelLayout());
    panel.style.left = `${panelLayout.left}px`;
    panel.style.top = `${panelLayout.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${panelLayout.width}px`;
    panel.style.height = minimized ? "auto" : `${panelLayout.height}px`;
  }

  function persistPanelLayout() {
    if (!panelLayout) return;
    chrome.storage.local.set({ [PANEL_LAYOUT_KEY]: panelLayout });
  }

  function loadPanelLayout() {
    chrome.storage.local.get(PANEL_LAYOUT_KEY, (stored) => {
      if (chrome.runtime.lastError) return;
      if (stored[PANEL_LAYOUT_KEY]) applyPanelLayout(stored[PANEL_LAYOUT_KEY]);
    });
  }

  function isInteractiveTarget(target) {
    return Boolean(target && target.closest("button, a, select, option, input, textarea"));
  }

  function bindPanelInteractions() {
    const panel = shadow.querySelector(".panel");
    const header = shadow.querySelector(".header");
    const resizeHandle = shadow.querySelector(".resize-handle");
    if (!panel || !header || !resizeHandle) return;

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) return;
      applyPanelLayout(panelLayout || defaultPanelLayout());
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { ...panelLayout };
      header.setPointerCapture(event.pointerId);

      const onMove = (moveEvent) => {
        applyPanelLayout({
          ...origin,
          left: origin.left + (moveEvent.clientX - startX),
          top: origin.top + (moveEvent.clientY - startY)
        });
      };

      const finish = () => {
        header.removeEventListener("pointermove", onMove);
        header.removeEventListener("pointerup", finish);
        header.removeEventListener("pointercancel", finish);
        persistPanelLayout();
      };

      header.addEventListener("pointermove", onMove);
      header.addEventListener("pointerup", finish);
      header.addEventListener("pointercancel", finish);
    });

    resizeHandle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || minimized) return;
      applyPanelLayout(panelLayout || defaultPanelLayout());
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { ...panelLayout };
      resizeHandle.setPointerCapture(event.pointerId);

      const onMove = (moveEvent) => {
        applyPanelLayout({
          ...origin,
          width: origin.width + (moveEvent.clientX - startX),
          height: origin.height + (moveEvent.clientY - startY)
        });
      };

      const finish = () => {
        resizeHandle.removeEventListener("pointermove", onMove);
        resizeHandle.removeEventListener("pointerup", finish);
        resizeHandle.removeEventListener("pointercancel", finish);
        persistPanelLayout();
      };

      resizeHandle.addEventListener("pointermove", onMove);
      resizeHandle.addEventListener("pointerup", finish);
      resizeHandle.addEventListener("pointercancel", finish);
    });

    window.addEventListener("resize", () => {
      if (panelLayout) applyPanelLayout(panelLayout);
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
          left: 12px;
          top: 12px;
          z-index: 2147483647;
          width: min(1080px, calc(100vw - 24px));
          height: min(440px, calc(100vh - 24px));
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
        .header { display: flex; align-items: center; gap: 9px; min-height: 52px; padding: 10px 11px 10px 14px; border-bottom: 1px solid #1e293b; cursor: move; user-select: none; }
        .mark { display: grid; place-items: center; width: 29px; height: 29px; flex: none; border-radius: 50%; background: linear-gradient(#ef4444 0 45%, #f8fafc 45% 100%); border: 2px solid #020617; box-shadow: inset 0 0 0 1px rgba(255,255,255,.3); }
        .mark::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #f8fafc; border: 2px solid #020617; }
        .heading { min-width: 0; flex: 1; }
        .brand { color: #f8fafc; font-size: 14px; font-weight: 750; letter-spacing: -.01em; }
        .card-label { overflow: hidden; color: #94a3b8; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .header button { cursor: pointer; }
        .icon-button { display: grid; place-items: center; width: 29px; height: 29px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: #94a3b8; cursor: pointer; font: 17px/1 sans-serif; }
        .icon-button:hover { background: #1e293b; color: #f8fafc; }
        .content { height: calc(100% - 53px); overflow: auto; }
        .panel.minimized .content { display: none; }
        .panel.minimized { min-height: 0; }
        .panel.minimized .resize-handle { display: none; }
        .status { display: flex; min-height: 190px; align-items: center; justify-content: center; padding: 26px; color: #94a3b8; text-align: center; }
        .spinner { width: 20px; height: 20px; margin: 0 auto 11px; border: 2px solid #334155; border-top-color: #60a5fa; border-radius: 50%; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .overview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 12px; align-content: start; }
        .full-span { grid-column: 1 / -1; }
        .site-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px 13px; border: 1px solid rgba(30, 41, 59, .9); border-radius: 12px; background: rgba(15, 23, 42, .48); }
        .site-nav-title { display: flex; align-items: center; gap: 10px; color: #7f8ea3; font-size: 10px; letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; }
        .site-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
        .site-grid { display: flex; flex-wrap: wrap; gap: 8px; }
        .site-link { position: relative; display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center; border: 1px solid rgba(100, 116, 139, .4); border-radius: 10px; background: rgba(17, 27, 46, .58); color: #dbeafe; font-size: 10px; font-weight: 800; text-decoration: none; letter-spacing: .04em; }
        a.site-link:hover { border-color: rgba(147, 197, 253, .7); background: rgba(30, 58, 95, .7); }
        .site-link.current { border-color: #60a5fa; background: rgba(30, 64, 175, .26); color: #f8fafc; cursor: default; }
        .site-state { display: none; }
        .open-all { height: 32px; padding: 0 10px; border: 1px solid rgba(96, 165, 250, .55); border-radius: 8px; background: rgba(29, 78, 216, .32); color: #dbeafe; cursor: pointer; font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; }
        .open-all:hover { background: rgba(29, 78, 216, .5); color: white; }
        .listing-comparison { padding: 12px 14px 13px; border: 1px solid rgba(30, 41, 59, .9); border-radius: 12px; background: rgba(15, 23, 42, .48); }
        .comparison-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: #7f8ea3; font-size: 10px; letter-spacing: .07em; text-transform: uppercase; }
        .comparison-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
        .comparison-value { padding: 9px; border: 1px solid rgba(100, 116, 139, .38); border-radius: 9px; background: rgba(17, 27, 46, .62); }
        .comparison-value span { display: block; color: #7f8ea3; font-size: 9px; text-transform: uppercase; }
        .comparison-value strong { color: #f8fafc; font-size: 15px; font-variant-numeric: tabular-nums; }
        .comparison-verdict { margin-top: 8px; color: #cbd5e1; font-size: 11px; }
        .comparison-verdict.good { color: #86efac; }
        .comparison-verdict.high { color: #fca5a5; }
        .comparison-note { margin-top: 3px; color: #64748b; font-size: 9px; }
        .language { padding: 14px; border: 1px solid rgba(30, 41, 59, .9); border-radius: 12px; background: rgba(15, 23, 42, .48); }
        .language-top { display: flex; align-items: center; gap: 11px; }
        .thumb { width: 52px; height: 72px; flex: none; border-radius: 5px; background: #172033; object-fit: cover; box-shadow: 0 2px 10px rgba(0,0,0,.28); }
        .meta { min-width: 0; flex: 1; }
        .language-name-row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
        .language-name { color: #93c5fd; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
        .product-link { display: block; overflow: hidden; color: #f8fafc; font-size: 14px; font-weight: 680; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
        .product-link:hover { color: #93c5fd; }
        .set { overflow: hidden; color: #94a3b8; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .match-indicator {
          display: inline-grid;
          place-items: center;
          width: 14px;
          height: 14px;
          border: 1px solid rgba(96, 165, 250, .55);
          border-radius: 999px;
          background: rgba(30, 64, 175, .18);
          color: #93c5fd;
          font-size: 10px;
          font-weight: 700;
          line-height: 1;
          cursor: help;
        }
        .prices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin-top: 12px; }
        .price {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 9px;
          border: 1px solid rgba(100, 116, 139, .38);
          border-radius: 9px;
          background: rgba(17, 27, 46, .62);
          color: inherit;
          text-decoration: none;
          transition: border-color .12s ease, background .12s ease, transform .12s ease;
        }
        a.price:hover {
          border-color: rgba(147, 197, 253, .72);
          background: rgba(30, 58, 95, .78);
          transform: translateY(-1px);
        }
        .price-label { color: #7f8ea3; font-size: 10px; text-transform: uppercase; white-space: nowrap; }
        .price-value { color: #f8fafc; font-size: 14px; font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .stats { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .stat-pill { display: inline-flex; align-items: center; min-height: 24px; padding: 0 8px; border-radius: 999px; background: rgba(30, 41, 59, .7); color: #cbd5e1; font-size: 10px; white-space: nowrap; }
        .stat-pill.good { background: rgba(22, 101, 52, .26); color: #86efac; }
        .stat-pill.warn { background: rgba(127, 29, 29, .26); color: #fca5a5; }
        .picker-label { display: block; margin-top: 10px; color: #7f8ea3; font-size: 10px; text-transform: uppercase; }
        select { width: 100%; height: 31px; margin-top: 4px; padding: 0 27px 0 8px; border: 1px solid rgba(100, 116, 139, .55); border-radius: 7px; background: rgba(17, 24, 39, .78); color: #cbd5e1; font: 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .empty { padding: 15px; border: 1px dashed #334155; border-radius: 10px; color: #94a3b8; }
        .footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 2px 0; color: #64748b; font-size: 10px; }
        .footer a { color: #93c5fd; text-decoration: none; }
        .footer-actions { display: flex; align-items: center; gap: 8px; }
        .secondary-button { padding: 6px 8px; border: 1px solid rgba(96, 165, 250, .45); border-radius: 7px; background: rgba(29, 78, 216, .16); color: #dbeafe; cursor: pointer; font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .secondary-button:hover { background: rgba(29, 78, 216, .3); color: #fff; }
        .retry { padding: 7px 10px; border: 1px solid #3b82f6; border-radius: 7px; background: #1d4ed8; color: white; cursor: pointer; font: 600 12px/1 sans-serif; }
        .resize-handle {
          position: absolute;
          right: 0;
          bottom: 0;
          width: 18px;
          height: 18px;
          cursor: nwse-resize;
          opacity: .75;
        }
        .resize-handle::before {
          content: "";
          position: absolute;
          right: 4px;
          bottom: 4px;
          width: 10px;
          height: 10px;
          border-right: 2px solid rgba(147, 197, 253, .65);
          border-bottom: 2px solid rgba(147, 197, 253, .65);
        }
        @media (max-width: 900px) {
          .overview { grid-template-columns: 1fr; }
          .site-nav { flex-wrap: wrap; }
          .site-actions { width: 100%; justify-content: space-between; }
          .prices { grid-template-columns: 1fr; }
          .comparison-grid { grid-template-columns: 1fr; }
        }
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
        <div class="resize-handle" aria-hidden="true"></div>
      </section>
    `;
    document.documentElement.appendChild(host);
    applyPanelLayout(defaultPanelLayout());
    bindPanelInteractions();
    loadPanelLayout();

    shadow.querySelector(".close").addEventListener("click", () => {
      hidden = true;
      host.style.display = "none";
    });
    shadow.querySelector(".minimize").addEventListener("click", () => {
      minimized = !minimized;
      shadow.querySelector(".panel").classList.toggle("minimized", minimized);
      shadow.querySelector(".minimize").textContent = minimized ? "+" : "−";
      shadow.querySelector(".minimize").title = minimized ? "Expand" : "Minimize";
      applyPanelLayout(panelLayout || defaultPanelLayout());
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
    applyPanelLayout(compactPanelLayout());
    shadow.querySelector(".content").innerHTML = `
      <div class="status"><div><div class="spinner"></div>Finding English and Japanese matches…</div></div>
    `;
  }

  function candidateLabel(candidate) {
    return `${candidate.title}${candidate.set ? ` · ${candidate.set.replace(/^Pokémon\s+/i, "")}` : ""}`;
  }

  function priceBox(label, value, url) {
    return `
      <a class="price" href="${escapeHtml(url || "#")}" target="_blank" rel="noreferrer" title="Open this card on PriceCharting">
        <span class="price-label">${label}</span><span class="price-value">${escapeHtml(value || "—")}</span>
      </a>
    `;
  }

  function liquidityClass(label) {
    return label === "high" ? "good" : label === "low" ? "warn" : "";
  }

  function statsBlock(product) {
    const stats = product && product.stats || {};
    const pills = [
      stats.psa10Pop != null ? `Pop ${stats.psa10Pop}` : "",
      stats.totalGraded != null ? `Graded ${stats.totalGraded}` : "",
      stats.psa10Percentage || "",
      stats.volumeText || ""
    ].filter(Boolean);
    if (!pills.length) return "";
    return `
      <div class="stats">
        ${pills.map((pill, index) => `<span class="stat-pill ${index === pills.length - 1 ? liquidityClass(stats.liquidityLabel) : ""}">${escapeHtml(pill)}</span>`).join("")}
      </div>
    `;
  }

  function deltaBlock(language) {
    if (language !== "japanese" || !currentResult || !currentResult.english || !currentResult.japanese) return "";
    const english = currentResult.english.selected;
    const japanese = currentResult.japanese.selected;
    const englishPrice = numericPrice(english && english.prices && english.prices.psa10);
    const japanesePrice = numericPrice(japanese && japanese.prices && japanese.prices.psa10);
    if (englishPrice == null || japanesePrice == null || !japanesePrice) return "";
    if (englishPrice === japanesePrice) {
      return `<div class="stats"><span class="stat-pill">EN = JP</span></div>`;
    }
    const ratio = englishPrice > japanesePrice ? englishPrice / japanesePrice : japanesePrice / englishPrice;
    const tone = englishPrice > japanesePrice ? "good" : "warn";
    const label = englishPrice > japanesePrice ? `EN is ${ratio.toFixed(1)}× JP` : `JP is ${ratio.toFixed(1)}× EN`;
    return `<div class="stats"><span class="stat-pill ${tone}">${escapeHtml(label)}</span></div>`;
  }

  function matchIndicator(language, group) {
    const product = group && group.selected;
    if (!product || !currentCard) return "";

    const candidates = (group.candidates || []).filter(Boolean);
    const selectedScore = Number(product.score || 0);
    const otherTop = candidates.find((candidate) => candidate.url !== product.url);
    const scoreGap = otherTop ? selectedScore - Number(otherTop.score || 0) : selectedScore;
    const warnings = [];
    const sourceIsJapanese = /(?:^|[\s/-])japanese(?:[\s/-]|$)/i.test(String(currentCard.set || ""));
    const targetIsJapanese = language.toLowerCase() === "japanese";
    const oppositeLanguage = sourceIsJapanese !== targetIsJapanese;

    if (!currentCard.number) {
      warnings.push("The source page did not expose a card number, so this match is based on name and set.");
    }
    if (oppositeLanguage && !product.pairMatched) {
      warnings.push("This opposite-language match is unverified. The set pairing is not confirmed, so treat it as a likely candidate, not a guaranteed counterpart.");
    }
    if (selectedScore > 0 && selectedScore < 170) {
      warnings.push("PriceCharting does not appear to have a strong exact match for this version.");
    }
    if (oppositeLanguage && currentCard.number && product.number && String(currentCard.number).toLowerCase() !== String(product.number).toLowerCase()) {
      warnings.push("The opposite-language candidate has a different card number, so verify the card art and promo details before trusting the price.");
    }
    if (otherTop && scoreGap < 24) {
      warnings.push(`Another ${language.toLowerCase()} candidate scored similarly, so double-check the selected set and numbering.`);
    }

    if (!warnings.length) return "";
    return `<span class="match-indicator" title="${escapeHtml(warnings[0])}" aria-label="${escapeHtml(warnings[0])}">i</span>`;
  }

  function siteIcon(id) {
    return ({
      collectr: "CL",
      tcgplayer: "TCG",
      "pricecharting-english": "EN",
      "pricecharting-japanese": "JP",
      ebay: "EB"
    })[id] || "↗";
  }

  function navigationBlock() {
    if (!currentNavigation.length) return "";
    const links = currentNavigation.map((item) => {
      const state = item.current ? "Here" : item.exact ? "Exact" : "Search";
      const inner = `<span aria-hidden="true">${escapeHtml(siteIcon(item.id))}</span><span class="site-state">${state}</span>`;
      return item.current
        ? `<span class="site-link current" title="${escapeHtml(`${item.label} · ${state}`)}" aria-label="${escapeHtml(`${item.label} · ${state}`)}">${inner}</span>`
        : `<a class="site-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer" title="${escapeHtml(`${item.label} · ${state}`)}" aria-label="${escapeHtml(`${item.label} · ${state}`)}">${inner}</a>`;
    }).join("");
    return `
      <nav class="site-nav full-span" aria-label="Open this card on another site">
        <div class="site-nav-title"><span>Card navigator</span></div>
        <div class="site-grid">${links}</div>
        <div class="site-actions">
          <label><input type="checkbox" data-sold-toggle ${soldCompsMode ? "checked" : ""}> Sold comps</label>
          <button class="open-all" type="button" data-open-all>Open all</button>
        </div>
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
            <div class="language-name-row">
              <div class="language-name">${label}</div>
              ${matchIndicator(label, group)}
            </div>
            <a class="product-link" href="${escapeHtml(product.url)}" target="_blank" rel="noreferrer">${escapeHtml(product.title)}</a>
            <div class="set">${escapeHtml(product.set)}</div>
          </div>
        </div>
        <div class="prices">
          ${priceBox("Ungraded", product.prices && product.prices.ungraded, product.url)}
          ${priceBox("Grade 9", product.prices && product.prices.grade9, product.url)}
          ${priceBox("PSA 10", product.prices && product.prices.psa10, product.url)}
        </div>
        ${statsBlock(product)}
        ${deltaBlock(language)}
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
    const listingBlock = listingComparisonBlock();
    shadow.querySelector(".content").innerHTML = `
      <div class="overview">
      ${navigationBlock()}
      ${listingBlock ? `<div class="full-span">${listingBlock}</div>` : ""}
      ${languageBlock("english", "English", currentResult.english)}
      ${languageBlock("japanese", "Japanese", currentResult.japanese)}
      <div class="footer full-span">
        <span>PriceCharting · checked ${escapeHtml(when)}</span>
        <span class="footer-actions">
          ${currentResult.english && currentResult.english.selected && currentResult.japanese && currentResult.japanese.selected ? `<button class="secondary-button" type="button" data-pin-pair>Pin pair</button>` : ""}
          <a href="${escapeHtml(genericSearchUrl(currentCard))}" target="_blank" rel="noreferrer">View all matches ↗</a>
        </span>
      </div>
      </div>
    `;

    for (const picker of shadow.querySelectorAll("[data-match-picker]")) {
      picker.addEventListener("change", () => changeMatch(picker.dataset.matchPicker, picker.value));
    }
    const openAll = shadow.querySelector("[data-open-all]");
    if (openAll) openAll.addEventListener("click", () => openAllSites(openAll));
    const soldToggle = shadow.querySelector("[data-sold-toggle]");
    if (soldToggle) soldToggle.addEventListener("change", toggleSoldCompsMode);
    const pinButton = shadow.querySelector("[data-pin-pair]");
    if (pinButton) pinButton.addEventListener("click", () => pinCurrentPair(pinButton));
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

  function refreshNavigation() {
    currentNavigation = navigation.resolveLinks(currentCard, currentResult, currentKnownLinks, location.href, {
      soldComps: soldCompsMode
    });
  }

  function toggleSoldCompsMode(event) {
    saveSoldCompsMode(event.currentTarget.checked);
    if (currentCard && currentResult) {
      refreshNavigation();
      renderResult();
    }
  }

  async function pinCurrentPair(button) {
    const english = currentResult && currentResult.english && currentResult.english.selected;
    const japanese = currentResult && currentResult.japanese && currentResult.japanese.selected;
    if (!english || !japanese) return;
    button.disabled = true;
    button.textContent = "Pinning…";
    try {
      await sendMessage({
        type: "PC_PIN_COUNTERPART",
        englishUrl: english.url,
        japaneseUrl: japanese.url
      });
      button.textContent = "Pinned";
    } catch (error) {
      button.textContent = "Couldn’t pin";
      button.title = error.message;
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
      refreshNavigation();
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
    applyPanelLayout(compactPanelLayout());
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
    applyPanelLayout(compactPanelLayout());
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
      const [preferred, knownLinks, storedSoldCompsMode] = await Promise.all([
        getPreferred(card),
        rememberCurrentSite(card),
        loadSoldCompsMode()
      ]);
      soldCompsMode = storedSoldCompsMode;
      currentKnownLinks = knownLinks;
      const result = await sendMessage({ type: "PC_LOOKUP", card, preferred });
      if (token !== lookupToken) return;
      currentResult = result;
      refreshNavigation();
      applyPanelLayout(panelLayout && panelLayout.width >= PANEL_MIN_WIDTH ? panelLayout : defaultPanelLayout());
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
