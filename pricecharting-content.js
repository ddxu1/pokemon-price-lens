(function () {
  "use strict";

  const navigation = globalThis.PokeNavigation;
  const observedRows = new WeakSet();
  const queued = new Map();
  let flushTimer = null;
  let openPopover = null;
  let soldCompsMode = false;
  let savedPreviewRows = [];
  const DETAIL_DOCK_LAYOUT_KEY = "poke-price-lens:detail-dock-layout:v1";
  const SOLD_COMPS_KEY = "poke-price-lens:sold-comps-mode:v1";

  const style = document.createElement("style");
  style.id = "poke-price-lens-pricecharting-style";
  style.textContent = `
    .ppl-psa10-badge {
      -webkit-appearance: none;
      appearance: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin: 5px 0 0 0;
      padding: 4px 8px;
      border: 1px solid rgba(147, 197, 253, .55);
      border-radius: 999px;
      background: rgba(8, 15, 28, .82);
      color: #e5edf8;
      box-shadow: 0 4px 14px rgba(2, 6, 23, .24);
      -webkit-backdrop-filter: blur(10px) saturate(135%);
      backdrop-filter: blur(10px) saturate(135%);
      font: 700 10px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: .02em;
      white-space: nowrap;
      box-sizing: border-box;
      cursor: pointer;
    }
    .ppl-psa10-badge::before {
      content: "";
      width: 6px;
      height: 6px;
      flex: none;
      border-radius: 50%;
      background: #60a5fa;
      box-shadow: 0 0 0 2px rgba(96, 165, 250, .16);
    }
    .ppl-psa10-badge .ppl-brand {
      color: #93c5fd;
      font-size: 9px;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .ppl-psa10-badge .ppl-divider { color: #475569; }
    .ppl-psa10-badge .ppl-value { color: #f8fafc; }
    .ppl-psa10-badge[data-loading="true"] {
      border-color: rgba(100, 116, 139, .5);
      color: #94a3b8;
    }
    .ppl-psa10-badge[data-error="true"] {
      border-color: rgba(248, 113, 113, .55);
      color: #fca5a5;
    }
    .ppl-psa10-badge[data-error="true"]::before {
      background: #f87171;
      box-shadow: 0 0 0 2px rgba(248, 113, 113, .16);
    }
    .ppl-nav-popover, .ppl-nav-popover * { box-sizing: border-box; }
    .ppl-nav-popover {
      position: fixed;
      z-index: 2147483647;
      width: 286px;
      padding: 12px;
      border: 1px solid rgba(147, 197, 253, .42);
      border-radius: 13px;
      background: rgba(8, 15, 28, .92);
      color: #e5edf8;
      box-shadow: 0 18px 48px rgba(2, 6, 23, .42);
      -webkit-backdrop-filter: blur(18px) saturate(135%);
      backdrop-filter: blur(18px) saturate(135%);
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .ppl-popover-brand { color: #93c5fd; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .ppl-popover-card { overflow: hidden; margin: 2px 0 9px; color: #f8fafc; font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .ppl-popover-grid { display: grid; grid-template-columns: 1fr; gap: 6px; }
    .ppl-popover-link { display: flex; min-width: 0; min-height: 34px; align-items: center; justify-content: space-between; gap: 5px; padding: 7px 8px; border: 1px solid rgba(100, 116, 139, .4); border-radius: 8px; background: rgba(17, 27, 46, .62); color: #dbeafe !important; font: 650 10px/1.15 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-decoration: none !important; }
    .ppl-popover-link:hover { border-color: rgba(147, 197, 253, .75); background: rgba(30, 58, 95, .76); }
    .ppl-popover-state { flex: none; color: #64748b; font-size: 7px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    .ppl-popover-open-all { width: 100%; height: 31px; margin-top: 7px; border: 1px solid rgba(96, 165, 250, .55); border-radius: 8px; background: rgba(29, 78, 216, .34); color: #dbeafe; cursor: pointer; font: 700 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .ppl-popover-open-all:hover { background: rgba(29, 78, 216, .52); color: white; }
  `;
  (document.head || document.documentElement).appendChild(style);

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response || !response.ok) return reject(new Error(response && response.error || "Extension request failed"));
        resolve(response.data);
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

  function productFromRow(row) {
    const link = row.querySelector('td.title a[href*="/game/pokemon"], a[href*="/game/pokemon"]');
    if (!link) return null;
    const setLink = row.querySelector('a[href*="/console/pokemon"]');
    const image = row.querySelector("img.photo");
    const title = link.textContent.trim();
    const number = (title.match(/#\s*(\d+[a-z]?)/i) || [])[1] || "";
    return {
      id: row.dataset.product || row.id.replace(/^product-/, ""),
      title,
      name: title.replace(/\s*#\s*\d+[a-z]?\s*$/i, "").trim(),
      number,
      set: setLink ? setLink.textContent.trim() : "",
      url: new URL(link.href, location.href).href,
      image: image ? image.src : "",
      prices: {}
    };
  }

  function queueRow(row) {
    const product = productFromRow(row);
    const badge = row.querySelector(".ppl-psa10-badge");
    if (!product || !badge || queued.has(product.url)) return;
    queued.set(product.url, { product, badge });
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 120);
  }

  async function flush() {
    flushTimer = null;
    const batch = Array.from(queued.values()).slice(0, 8);
    for (const item of batch) queued.delete(item.product.url);
    if (!batch.length) return;

    try {
      const results = await sendMessage({
        type: "PC_DETAILS_BATCH",
        products: batch.map((item) => item.product)
      });
      const byUrl = new Map(results.map((result) => [result.url, result]));
      for (const item of batch) {
        const result = byUrl.get(item.product.url);
        if (result && result.ok && result.product.prices.psa10) {
          setBadgeContent(item.badge, result.product.prices.psa10);
          item.badge.dataset.loading = "false";
          item.badge.title = "Injected by Poké Price Lens · Current PriceCharting PSA 10 market value";
        } else {
          setBadgeContent(item.badge, "—");
          item.badge.dataset.loading = "false";
          item.badge.dataset.error = "true";
          item.badge.title = result && result.error || "No PSA 10 price is available";
        }
      }
    } catch (error) {
      for (const item of batch) {
        setBadgeContent(item.badge, "—");
        item.badge.dataset.loading = "false";
        item.badge.dataset.error = "true";
        item.badge.title = error.message;
      }
    }

    if (queued.size) scheduleFlush();
  }

  const intersectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      intersectionObserver.unobserve(entry.target);
      queueRow(entry.target);
    }
  }, { rootMargin: "250px 0px" });

  function setBadgeContent(badge, value) {
    badge.replaceChildren();
    const brand = document.createElement("span");
    brand.className = "ppl-brand";
    brand.textContent = "Price Lens";
    const divider = document.createElement("span");
    divider.className = "ppl-divider";
    divider.textContent = "·";
    const price = document.createElement("span");
    price.className = "ppl-value";
    price.textContent = `PSA 10  ${value}`;
    badge.append(brand, divider, price);
  }

  function closePopover() {
    if (openPopover) openPopover.remove();
    openPopover = null;
  }

  async function showNavigationPopover(product, badge) {
    if (openPopover && openPopover.dataset.productUrl === product.url) {
      closePopover();
      return;
    }
    closePopover();

    const knownLinks = await getKnownLinks(product);
    if (!badge.isConnected) return;
    const lookup = navigation.lookupForPriceChartingProduct(product);
    const links = navigation.resolveLinks(product, lookup, knownLinks, location.href);
    const popover = document.createElement("div");
    popover.className = "ppl-nav-popover";
    popover.dataset.productUrl = product.url;

    const brand = document.createElement("div");
    brand.className = "ppl-popover-brand";
    brand.textContent = "Poké Price Lens · Card navigator";
    const cardName = document.createElement("div");
    cardName.className = "ppl-popover-card";
    cardName.textContent = `${product.title}${product.set ? ` · ${product.set}` : ""}`;
    const grid = document.createElement("div");
    grid.className = "ppl-popover-grid";

    for (const link of links) {
      const anchor = document.createElement("a");
      anchor.className = "ppl-popover-link";
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      const label = document.createElement("span");
      label.textContent = link.label;
      const state = document.createElement("span");
      state.className = "ppl-popover-state";
      state.textContent = link.exact ? "Exact" : "Search";
      anchor.append(label, state);
      grid.append(anchor);
    }

    const openAll = document.createElement("button");
    openAll.type = "button";
    openAll.className = "ppl-popover-open-all";
    openAll.textContent = "Open all";
    openAll.addEventListener("click", async () => {
      openAll.disabled = true;
      openAll.textContent = "Opening…";
      try {
        await sendMessage({ type: "PC_OPEN_TABS", urls: links.map((link) => link.url) });
        openAll.textContent = "Opened";
      } catch (error) {
        openAll.textContent = "Couldn’t open tabs";
        openAll.title = error.message;
      }
    });

    popover.append(brand, cardName, grid, openAll);
    document.body.appendChild(popover);
    const badgeRect = badge.getBoundingClientRect();
    const left = Math.max(8, Math.min(badgeRect.left, window.innerWidth - 294));
    const roomBelow = window.innerHeight - badgeRect.bottom;
    popover.style.left = `${left}px`;
    popover.style.top = roomBelow > 220
      ? `${badgeRect.bottom + 7}px`
      : `${Math.max(8, badgeRect.top - popover.offsetHeight - 7)}px`;
    openPopover = popover;
  }

  function scan() {
    const rows = document.querySelectorAll('tr[id^="product-"]');
    for (const row of rows) {
      if (observedRows.has(row)) continue;
      const product = productFromRow(row);
      const titleCell = row.querySelector("td.title");
      if (!product || !titleCell) continue;

      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "ppl-psa10-badge";
      badge.dataset.loading = "true";
      setBadgeContent(badge, "…");
      badge.title = "Injected by Poké Price Lens · Loading PSA 10 market value";
      badge.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showNavigationPopover(product, badge);
      });
      titleCell.append(document.createElement("br"), badge);
      observedRows.add(row);
      intersectionObserver.observe(row);
    }
  }

  function detectDetailCard() {
    if (!/\/game\/pokemon/i.test(location.pathname)) return null;
    const setLink = document.querySelector('.breadcrumbs a[href*="/console/pokemon"], #product_name a[href*="/console/pokemon"]');
    const title = document.title.split(/\s+Prices?\s*\|/i)[0].trim();
    const numberMatch = title.match(/#\s*(\d+[a-z]?)/i);
    const name = title.replace(/\s*#\s*\d+[a-z]?\s*$/i, "").trim();
    if (!name || !numberMatch) return null;
    return {
      source: "pricecharting",
      name,
      number: numberMatch[1],
      set: setLink ? setLink.textContent.trim() : ""
    };
  }

  function currentProductFromCard(card) {
    return {
      title: `${card.name} #${card.number}`,
      name: card.name,
      number: card.number,
      set: card.set,
      url: location.href,
      prices: {}
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDelta(value) {
    if (typeof value !== "number" || Number.isNaN(value)) return "—";
    const sign = value > 0 ? "+" : "";
    return `${sign}$${value.toFixed(2)}`;
  }

  function formatPercent(value) {
    if (typeof value !== "number" || Number.isNaN(value)) return "—";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  }

  function numericPrice(value) {
    const number = Number(String(value || "").replace(/[$,]/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function candidateLabel(candidate) {
    return `${candidate.title}${candidate.set ? ` · ${candidate.set.replace(/^Pokémon\s+/i, "")}` : ""}`;
  }

  function pillClassForLiquidity(label) {
    if (label === "high") return "good";
    if (label === "low") return "warn";
    return "";
  }

  function csvEscape(value) {
    const text = String(value == null ? "" : value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportRowsToCsv(rows) {
    const columns = [
      "saved_title",
      "saved_url",
      "saved_language",
      "saved_set",
      "saved_number",
      "english_title",
      "english_url",
      "english_psa10",
      "english_psa10_pop",
      "english_total_graded",
      "english_psa10_percentage",
      "english_volume_text",
      "english_liquidity_label",
      "japanese_title",
      "japanese_url",
      "japanese_psa10",
      "japanese_psa10_pop",
      "japanese_total_graded",
      "japanese_psa10_percentage",
      "japanese_volume_text",
      "japanese_liquidity_label",
      "psa10_delta_usd",
      "psa10_delta_percent",
      "warning",
      "exported_at"
    ];
    const exportedAt = new Date().toISOString();
    const lines = [
      columns.join(","),
      ...rows.map((row) => {
        const english = row.english || {};
        const japanese = row.japanese || {};
        const values = {
          saved_title: row.saved && row.saved.title,
          saved_url: row.saved && row.saved.url,
          saved_language: row.saved && row.saved.language,
          saved_set: row.saved && row.saved.set,
          saved_number: row.saved && row.saved.number,
          english_title: english.title,
          english_url: english.url,
          english_psa10: english.prices && english.prices.psa10,
          english_psa10_pop: english.stats && english.stats.psa10Pop,
          english_total_graded: english.stats && english.stats.totalGraded,
          english_psa10_percentage: english.stats && english.stats.psa10Percentage,
          english_volume_text: english.stats && english.stats.volumeText,
          english_liquidity_label: english.stats && english.stats.liquidityLabel,
          japanese_title: japanese.title,
          japanese_url: japanese.url,
          japanese_psa10: japanese.prices && japanese.prices.psa10,
          japanese_psa10_pop: japanese.stats && japanese.stats.psa10Pop,
          japanese_total_graded: japanese.stats && japanese.stats.totalGraded,
          japanese_psa10_percentage: japanese.stats && japanese.stats.psa10Percentage,
          japanese_volume_text: japanese.stats && japanese.stats.volumeText,
          japanese_liquidity_label: japanese.stats && japanese.stats.liquidityLabel,
          psa10_delta_usd: typeof row.deltaUsd === "number" ? row.deltaUsd.toFixed(2) : "",
          psa10_delta_percent: typeof row.deltaPercent === "number" ? row.deltaPercent.toFixed(2) : "",
          warning: row.warning || "",
          exported_at: exportedAt
        };
        return columns.map((column) => csvEscape(values[column])).join(",");
      })
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `poke-price-lens-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function savedPreviewMarkup(rows) {
    if (!rows.length) {
      return `<div class="saved-empty">No saved links yet.</div>`;
    }
    return rows.map((row) => {
      const english = row.english || {};
      const japanese = row.japanese || {};
      return `
        <article class="saved-item">
          <div class="saved-head">
            <div class="saved-title">${escapeHtml(row.saved && row.saved.title || "Saved card")}</div>
            ${row.warning ? `<span class="saved-warning" title="${escapeHtml(row.warning)}">i</span>` : ""}
          </div>
          <div class="saved-delta ${typeof row.deltaUsd === "number" && row.deltaUsd > 0 ? "up" : typeof row.deltaUsd === "number" && row.deltaUsd < 0 ? "down" : ""}">
            <span>${escapeHtml(formatDelta(row.deltaUsd))}</span>
            <span>${escapeHtml(formatPercent(row.deltaPercent))}</span>
          </div>
          <div class="saved-grid">
            <div class="saved-col">
              <div class="saved-label">EN</div>
              <div class="saved-price">${escapeHtml(english.prices && english.prices.psa10 || "—")}</div>
              <div class="saved-meta">
                <span class="saved-pill">Pop ${escapeHtml(english.stats && english.stats.psa10Pop != null ? english.stats.psa10Pop : "—")}</span>
                <span class="saved-pill">Graded ${escapeHtml(english.stats && english.stats.totalGraded != null ? english.stats.totalGraded : "—")}</span>
                <span class="saved-pill">${escapeHtml(english.stats && english.stats.psa10Percentage || "—")}</span>
                <span class="saved-pill ${pillClassForLiquidity(english.stats && english.stats.liquidityLabel)}">${escapeHtml(english.stats && english.stats.volumeText || english.stats && english.stats.liquidityLabel || "—")}</span>
              </div>
            </div>
            <div class="saved-col">
              <div class="saved-label">JP</div>
              <div class="saved-price">${escapeHtml(japanese.prices && japanese.prices.psa10 || "—")}</div>
              <div class="saved-meta">
                <span class="saved-pill">Pop ${escapeHtml(japanese.stats && japanese.stats.psa10Pop != null ? japanese.stats.psa10Pop : "—")}</span>
                <span class="saved-pill">Graded ${escapeHtml(japanese.stats && japanese.stats.totalGraded != null ? japanese.stats.totalGraded : "—")}</span>
                <span class="saved-pill">${escapeHtml(japanese.stats && japanese.stats.psa10Percentage || "—")}</span>
                <span class="saved-pill ${pillClassForLiquidity(japanese.stats && japanese.stats.liquidityLabel)}">${escapeHtml(japanese.stats && japanese.stats.volumeText || japanese.stats && japanese.stats.liquidityLabel || "—")}</span>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join("");
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

  function priceBox(label, value, url) {
    return `
      <a class="price" href="${escapeHtml(url || "#")}" target="_blank" rel="noreferrer">
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

  function deltaBlock(label, lookupResult) {
    if (String(label).toLowerCase() !== "japanese" || !lookupResult || !lookupResult.english || !lookupResult.japanese) return "";
    const english = lookupResult.english.selected;
    const japanese = lookupResult.japanese.selected;
    const englishPrice = numericPrice(english && english.prices && english.prices.psa10);
    const japanesePrice = numericPrice(japanese && japanese.prices && japanese.prices.psa10);
    if (englishPrice == null || japanesePrice == null || !japanesePrice) return "";
    if (englishPrice === japanesePrice) {
      return `<div class="stats"><span class="stat-pill">EN = JP</span></div>`;
    }
    const ratio = englishPrice > japanesePrice ? englishPrice / japanesePrice : japanesePrice / englishPrice;
    const tone = englishPrice > japanesePrice ? "good" : "warn";
    const labelText = englishPrice > japanesePrice ? `EN is ${ratio.toFixed(1)}× JP` : `JP is ${ratio.toFixed(1)}× EN`;
    return `<div class="stats"><span class="stat-pill ${tone}">${escapeHtml(labelText)}</span></div>`;
  }

  async function fetchDetailContext(card) {
    const currentProduct = currentProductFromCard(card);
    const [knownLinks, lookupResult, savedCards, exportRows] = await Promise.all([
      getKnownLinks(card),
      sendMessage({ type: "PC_LOOKUP", card, preferred: {} }).catch(() => navigation.lookupForPriceChartingProduct(currentProduct)),
      sendMessage({ type: "PC_GET_SAVED_LINKS" }).catch(() => []),
      sendMessage({ type: "PC_EXPORT_SAVED_LINKS" }).catch(() => [])
    ]);
    return { currentProduct, knownLinks, lookupResult, savedCards, exportRows };
  }

  function buildDetailLinks(card, lookupResult, knownLinks) {
    return navigation.resolveLinks(card, lookupResult, knownLinks, location.href, { soldComps: soldCompsMode });
  }

  async function rerenderDetailDock(card) {
    const { knownLinks, lookupResult, savedCards, exportRows } = await fetchDetailContext(card);
    savedPreviewRows = exportRows;
    renderDetailDock(card, buildDetailLinks(card, lookupResult, knownLinks), lookupResult, savedCards);
  }

  function languageBlock(label, group, lookupResult) {
    const product = group && group.selected;
    if (!product) {
      return `<section class="language"><div class="language-name">${label}</div><div class="empty">No confident ${label.toLowerCase()} match was found.</div></section>`;
    }
    const candidates = group.candidates || [];
    const options = candidates.map((candidate) => `
      <option value="${escapeHtml(candidate.url)}" ${candidate.url === product.url ? "selected" : ""}>${escapeHtml(candidateLabel(candidate))}</option>
    `).join("");
    return `
      <section class="language" data-language="${escapeHtml(label.toLowerCase())}">
        <div class="language-top">
          ${product.image ? `<img class="thumb" src="${escapeHtml(product.image.replace(/\/60\.jpg(?:\?.*)?$/, "/240.jpg"))}" alt="">` : ""}
          <div class="language-head">
            <div class="language-name">${label}</div>
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
        ${deltaBlock(label, lookupResult)}
        ${candidates.length > 1 ? `<label class="picker-label">Match<select data-match-picker="${escapeHtml(label.toLowerCase())}">${options}</select></label>` : ""}
      </section>
    `;
  }

  function renderDetailDock(card, links, lookupResult, savedCards) {
    if (document.getElementById("poke-price-lens-detail-dock")) return;
    const host = document.createElement("div");
    host.id = "poke-price-lens-detail-dock";
    const shadow = host.attachShadow({ mode: "open" });
    const linkMarkup = links.map((link) => {
      const state = link.current ? "Here" : link.exact ? "Exact" : "Search";
      const inner = `<span aria-hidden="true">${escapeHtml(siteIcon(link.id))}</span><span class="state">${state}</span>`;
      return link.current
        ? `<span class="link current" title="${escapeHtml(`${link.label} · ${state}`)}" aria-label="${escapeHtml(`${link.label} · ${state}`)}">${inner}</span>`
        : `<a class="link" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer" title="${escapeHtml(`${link.label} · ${state}`)}" aria-label="${escapeHtml(`${link.label} · ${state}`)}">${inner}</a>`;
    }).join("");
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .dock { position: fixed; left: 12px; top: 12px; z-index: 2147483647; width: min(1080px, calc(100vw - 24px)); overflow: hidden; border: 1px solid rgba(148, 163, 184, .28); border-radius: 15px; background: rgba(8, 15, 28, .82); color: #e5edf8; box-shadow: 0 18px 55px rgba(2, 6, 23, .38); -webkit-backdrop-filter: blur(18px) saturate(135%); backdrop-filter: blur(18px) saturate(135%); font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .header { display: flex; align-items: center; gap: 9px; padding: 10px 11px 10px 13px; border-bottom: 1px solid #1e293b; cursor: move; user-select: none; }
        .mark { display: grid; place-items: center; width: 27px; height: 27px; flex: none; border: 2px solid #020617; border-radius: 50%; background: linear-gradient(#ef4444 0 45%, #f8fafc 45% 100%); }
        .mark::after { content: ""; width: 7px; height: 7px; border: 2px solid #020617; border-radius: 50%; background: #f8fafc; }
        .heading { min-width: 0; flex: 1; }
        .brand { color: #f8fafc; font-size: 13px; font-weight: 750; }
        .card { overflow: hidden; color: #94a3b8; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .close { width: 27px; height: 27px; border: 0; border-radius: 7px; background: transparent; color: #94a3b8; cursor: pointer; font: 17px/1 sans-serif; }
        .close:hover { background: #1e293b; color: white; }
        .layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 12px; align-content: start; }
        .full-span { grid-column: 1 / -1; }
        .body { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px 13px; border: 1px solid rgba(30, 41, 59, .9); border-radius: 12px; background: rgba(15, 23, 42, .48); }
        .label { display: flex; align-items: center; gap: 8px; color: #7f8ea3; font-size: 9px; letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; }
        .toggle { display: inline-flex; align-items: center; gap: 5px; letter-spacing: normal; text-transform: none; }
        .body-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
        .grid { display: flex; flex-wrap: wrap; gap: 8px; }
        .link { display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center; border: 1px solid rgba(100, 116, 139, .4); border-radius: 10px; background: rgba(17, 27, 46, .62); color: #dbeafe; font-size: 10px; font-weight: 800; text-decoration: none; letter-spacing: .04em; }
        a.link:hover { border-color: rgba(147, 197, 253, .72); background: rgba(30, 58, 95, .75); }
        .link.current { border-color: #60a5fa; background: rgba(30, 64, 175, .26); color: white; }
        .state { display: none; }
        .open-all { height: 31px; padding: 0 10px; border: 1px solid rgba(96, 165, 250, .55); border-radius: 8px; background: rgba(29, 78, 216, .34); color: #dbeafe; cursor: pointer; font: 700 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; }
        .secondary { background: rgba(29, 78, 216, .16); }
        .saved-panel { padding: 11px 13px 13px; border: 1px solid rgba(30, 41, 59, .9); border-radius: 12px; background: rgba(15, 23, 42, .48); }
        .saved-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
        .saved-count { color: #93c5fd; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .saved-actions { display: flex; gap: 6px; }
        .saved-action { height: 28px; padding: 0 8px; border: 1px solid rgba(96, 165, 250, .45); border-radius: 8px; background: rgba(29, 78, 216, .16); color: #dbeafe; cursor: pointer; font: 600 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .saved-list { display: grid; gap: 8px; max-height: 220px; overflow: auto; }
        .saved-item { padding: 9px; border: 1px solid rgba(100, 116, 139, .35); border-radius: 10px; background: rgba(17, 27, 46, .46); }
        .saved-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .saved-title { overflow: hidden; color: #f8fafc; font-size: 11px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
        .saved-warning { display: inline-grid; place-items: center; width: 14px; height: 14px; border: 1px solid rgba(96, 165, 250, .55); border-radius: 999px; color: #93c5fd; font-size: 10px; cursor: help; }
        .saved-delta { display: inline-flex; gap: 8px; margin-top: 6px; padding: 4px 7px; border-radius: 999px; background: rgba(51, 65, 85, .45); color: #cbd5e1; font-size: 10px; font-weight: 700; }
        .saved-delta.up { background: rgba(22, 101, 52, .24); color: #86efac; }
        .saved-delta.down { background: rgba(127, 29, 29, .24); color: #fca5a5; }
        .saved-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
        .saved-label { color: #93c5fd; font-size: 9px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
        .saved-price { margin-top: 2px; color: #f8fafc; font-size: 13px; font-weight: 760; }
        .saved-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
        .saved-pill { display: inline-flex; align-items: center; min-height: 20px; padding: 0 6px; border-radius: 999px; background: rgba(30, 41, 59, .7); color: #cbd5e1; font-size: 9px; }
        .saved-pill.good { background: rgba(22, 101, 52, .26); color: #86efac; }
        .saved-pill.warn { background: rgba(127, 29, 29, .26); color: #fca5a5; }
        .saved-empty { padding: 11px; border: 1px dashed #334155; border-radius: 9px; color: #94a3b8; font-size: 11px; }
        .language { padding: 11px 13px 13px; border: 1px solid rgba(30, 41, 59, .9); border-radius: 12px; background: rgba(15, 23, 42, .48); }
        .language-top { display: flex; align-items: center; gap: 10px; }
        .thumb { width: 48px; height: 66px; flex: none; border-radius: 5px; background: #172033; object-fit: cover; box-shadow: 0 2px 10px rgba(0,0,0,.28); }
        .language-head { min-width: 0; flex: 1; }
        .language-name { color: #93c5fd; font-size: 10px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
        .product-link { display: block; overflow: hidden; margin-top: 2px; color: #f8fafc; font-size: 13px; font-weight: 680; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
        .set { overflow: hidden; color: #94a3b8; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .prices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 10px; }
        .price { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 7px 8px; border: 1px solid rgba(100, 116, 139, .38); border-radius: 9px; background: rgba(17, 27, 46, .62); color: inherit; text-decoration: none; }
        a.price:hover { border-color: rgba(147, 197, 253, .72); background: rgba(30, 58, 95, .75); }
        .price-label { color: #7f8ea3; font-size: 9px; text-transform: uppercase; white-space: nowrap; }
        .price-value { color: #f8fafc; font-size: 13px; font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .stats { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .stat-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; background: rgba(30, 41, 59, .7); color: #cbd5e1; font-size: 9px; white-space: nowrap; }
        .stat-pill.good { background: rgba(22, 101, 52, .26); color: #86efac; }
        .stat-pill.warn { background: rgba(127, 29, 29, .26); color: #fca5a5; }
        .picker-label { display: block; margin-top: 10px; color: #7f8ea3; font-size: 10px; text-transform: uppercase; }
        select { width: 100%; height: 30px; margin-top: 4px; padding: 0 27px 0 8px; border: 1px solid rgba(100, 116, 139, .55); border-radius: 7px; background: rgba(17, 24, 39, .78); color: #cbd5e1; font: 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .empty { margin-top: 8px; padding: 11px; border: 1px dashed #334155; border-radius: 9px; color: #94a3b8; font-size: 11px; }
        .resize-handle { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; opacity: .75; }
        .resize-handle::before { content: ""; position: absolute; right: 4px; bottom: 4px; width: 10px; height: 10px; border-right: 2px solid rgba(147, 197, 253, .65); border-bottom: 2px solid rgba(147, 197, 253, .65); }
        @media (max-width: 900px) {
          .layout { grid-template-columns: 1fr; }
          .body { flex-wrap: wrap; }
          .body-actions { width: 100%; justify-content: space-between; }
          .saved-grid { grid-template-columns: 1fr; }
          .prices { grid-template-columns: 1fr; }
        }
      </style>
      <section class="dock">
        <header class="header"><span class="mark"></span><div class="heading"><div class="brand">Poké Price Lens</div><div class="card">${escapeHtml(card.name)} #${escapeHtml(card.number)}${card.set ? ` · ${escapeHtml(card.set)}` : ""}</div></div><button class="close" type="button" aria-label="Close">×</button></header>
        <div class="layout">
        <div class="body full-span"><div class="label"><span>Card navigator</span></div><div class="grid">${linkMarkup}</div><div class="body-actions"><label class="toggle"><input type="checkbox" data-sold-toggle ${soldCompsMode ? "checked" : ""}> Sold comps</label><button class="open-all" type="button">Open all</button>${lookupResult && lookupResult.english && lookupResult.english.selected && lookupResult.japanese && lookupResult.japanese.selected ? `<button class="open-all secondary" type="button" data-pin-pair>Pin pair</button>` : ""}</div></div>
        ${languageBlock("English", lookupResult && lookupResult.english, lookupResult)}
        ${languageBlock("Japanese", lookupResult && lookupResult.japanese, lookupResult)}
        <section class="saved-panel full-span">
          <div class="saved-bar">
            <div class="saved-count">Saved links · ${escapeHtml(String((savedCards || []).length))}</div>
            <div class="saved-actions">
              <button class="saved-action" type="button" data-save-link>Save link</button>
              <button class="saved-action" type="button" data-export-saved>Export CSV</button>
              <button class="saved-action" type="button" data-clear-saved>Clear</button>
            </div>
          </div>
          <div class="saved-list">${savedPreviewMarkup(savedPreviewRows)}</div>
        </section>
        </div>
        <div class="resize-handle" aria-hidden="true"></div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const dock = shadow.querySelector(".dock");
    const header = shadow.querySelector(".header");
    const resizeHandle = shadow.querySelector(".resize-handle");
    const margin = 12;
    const minWidth = 760;
    const minHeight = 170;

    function defaultLayout() {
      const width = Math.min(1080, Math.max(minWidth, window.innerWidth - margin * 2));
      const height = Math.min(Math.max(minHeight, 420), window.innerHeight - margin * 2);
      return {
        width,
        height,
        left: Math.max(margin, Math.round((window.innerWidth - width) / 2)),
        top: margin
      };
    }

    function clampLayout(layout) {
      const maxWidth = Math.max(minWidth, window.innerWidth - margin * 2);
      const maxHeight = Math.max(minHeight, window.innerHeight - margin * 2);
      const width = Math.min(Math.max(minWidth, Math.round(layout.width || 0)), maxWidth);
      const height = Math.min(Math.max(minHeight, Math.round(layout.height || 0)), maxHeight);
      const left = Math.min(Math.max(margin, Math.round(layout.left || 0)), Math.max(margin, window.innerWidth - width - margin));
      const top = Math.min(Math.max(margin, Math.round(layout.top || 0)), Math.max(margin, window.innerHeight - height - margin));
      return { width, height, left, top };
    }

    let dockLayout = defaultLayout();

    function applyLayout(nextLayout) {
      dockLayout = clampLayout(nextLayout || dockLayout);
      dock.style.left = `${dockLayout.left}px`;
      dock.style.top = `${dockLayout.top}px`;
      dock.style.right = "auto";
      dock.style.bottom = "auto";
      dock.style.width = `${dockLayout.width}px`;
      dock.style.height = `${dockLayout.height}px`;
    }

    function persistLayout() {
      chrome.storage.local.set({ [DETAIL_DOCK_LAYOUT_KEY]: dockLayout });
    }

    function isInteractiveTarget(target) {
      return Boolean(target && target.closest("button, a"));
    }

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) return;
      applyLayout(dockLayout);
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { ...dockLayout };
      header.setPointerCapture(event.pointerId);

      const onMove = (moveEvent) => {
        applyLayout({
          ...origin,
          left: origin.left + (moveEvent.clientX - startX),
          top: origin.top + (moveEvent.clientY - startY)
        });
      };

      const finish = () => {
        header.removeEventListener("pointermove", onMove);
        header.removeEventListener("pointerup", finish);
        header.removeEventListener("pointercancel", finish);
        persistLayout();
      };

      header.addEventListener("pointermove", onMove);
      header.addEventListener("pointerup", finish);
      header.addEventListener("pointercancel", finish);
    });

    resizeHandle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      applyLayout(dockLayout);
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { ...dockLayout };
      resizeHandle.setPointerCapture(event.pointerId);

      const onMove = (moveEvent) => {
        applyLayout({
          ...origin,
          width: origin.width + (moveEvent.clientX - startX),
          height: origin.height + (moveEvent.clientY - startY)
        });
      };

      const finish = () => {
        resizeHandle.removeEventListener("pointermove", onMove);
        resizeHandle.removeEventListener("pointerup", finish);
        resizeHandle.removeEventListener("pointercancel", finish);
        persistLayout();
      };

      resizeHandle.addEventListener("pointermove", onMove);
      resizeHandle.addEventListener("pointerup", finish);
      resizeHandle.addEventListener("pointercancel", finish);
    });

    chrome.storage.local.get(DETAIL_DOCK_LAYOUT_KEY, (stored) => {
      if (!chrome.runtime.lastError && stored[DETAIL_DOCK_LAYOUT_KEY]) {
        applyLayout(stored[DETAIL_DOCK_LAYOUT_KEY]);
      } else {
        applyLayout(defaultLayout());
      }
    });
    window.addEventListener("resize", () => applyLayout(dockLayout));
    shadow.querySelector(".close").addEventListener("click", () => host.remove());
    const soldToggle = shadow.querySelector("[data-sold-toggle]");
    if (soldToggle) {
      soldToggle.addEventListener("change", async (event) => {
        saveSoldCompsMode(event.currentTarget.checked);
        host.remove();
        await rerenderDetailDock(card);
      });
    }
    const pinButton = shadow.querySelector("[data-pin-pair]");
    if (pinButton) {
      pinButton.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const english = lookupResult && lookupResult.english && lookupResult.english.selected;
        const japanese = lookupResult && lookupResult.japanese && lookupResult.japanese.selected;
        if (!english || !japanese) return;
        button.disabled = true;
        button.textContent = "Pinning…";
        try {
          await sendMessage({ type: "PC_PIN_COUNTERPART", englishUrl: english.url, japaneseUrl: japanese.url });
          button.textContent = "Pinned";
        } catch (error) {
          button.textContent = "Couldn’t pin";
          button.title = error.message;
        }
      });
    }
    const saveButton = shadow.querySelector("[data-save-link]");
    if (saveButton) {
      saveButton.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Saving…";
        try {
          await sendMessage({
            type: "PC_SAVE_CARD_LINK",
            card: {
              url: location.href,
              title: `${card.name} #${card.number}`,
              name: card.name,
              number: card.number,
              set: card.set,
              language: navigation.isJapaneseProduct({ set: card.set, url: location.href }) ? "japanese" : "english"
            }
          });
          host.remove();
          await rerenderDetailDock(card);
        } catch (error) {
          button.disabled = false;
          button.textContent = "Couldn’t save";
          button.title = error.message;
        }
      });
    }
    const exportButton = shadow.querySelector("[data-export-saved]");
    if (exportButton) {
      exportButton.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Exporting…";
        try {
          const rows = await sendMessage({ type: "PC_EXPORT_SAVED_LINKS" });
          savedPreviewRows = rows;
          exportRowsToCsv(rows);
          button.textContent = "Exported";
        } catch (error) {
          button.textContent = "Couldn’t export";
          button.title = error.message;
        } finally {
          setTimeout(() => {
            button.disabled = false;
            button.textContent = "Export CSV";
          }, 1200);
        }
      });
    }
    const clearButton = shadow.querySelector("[data-clear-saved]");
    if (clearButton) {
      clearButton.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Clearing…";
        try {
          await sendMessage({ type: "PC_CLEAR_SAVED_LINKS" });
          savedPreviewRows = [];
          host.remove();
          await rerenderDetailDock(card);
        } catch (error) {
          button.disabled = false;
          button.textContent = "Couldn’t clear";
          button.title = error.message;
        }
      });
    }
    for (const picker of shadow.querySelectorAll("[data-match-picker]")) {
      picker.addEventListener("change", async () => {
        const language = picker.dataset.matchPicker;
        const group = lookupResult && lookupResult[language];
        if (!group) return;
        const candidate = (group.candidates || []).find((item) => item.url === picker.value);
        if (!candidate) return;
        picker.disabled = true;
        try {
          group.selected = await sendMessage({ type: "PC_DETAIL", product: candidate });
          const latestKnownLinks = await getKnownLinks(card);
          const latestLinks = buildDetailLinks(card, lookupResult, latestKnownLinks);
          host.remove();
          renderDetailDock(card, latestLinks, lookupResult, savedCards);
        } catch (error) {
          picker.disabled = false;
          picker.title = error.message;
        }
      });
    }
    shadow.querySelector(".open-all").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Opening…";
      try {
        await sendMessage({ type: "PC_OPEN_TABS", urls: links.filter((link) => !link.current).map((link) => link.url) });
        button.textContent = "Opened";
      } catch (error) {
        button.textContent = "Couldn’t open tabs";
        button.title = error.message;
      }
    });
  }

  async function initDetailDock() {
    const card = detectDetailCard();
    if (!card) return;
    soldCompsMode = await loadSoldCompsMode();
    const { knownLinks, lookupResult, savedCards, exportRows } = await fetchDetailContext(card);
    savedPreviewRows = exportRows;
    const links = buildDetailLinks(card, lookupResult, knownLinks);
    renderDetailDock(card, links, lookupResult, savedCards);
  }

  scan();
  initDetailDock();
  const mutationObserver = new MutationObserver(scan);
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", (event) => {
    if (openPopover && !openPopover.contains(event.target)) closePopover();
  });
  window.addEventListener("scroll", closePopover, { passive: true });
})();
