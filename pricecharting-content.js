(function () {
  "use strict";

  const navigation = globalThis.PokeNavigation;
  const observedRows = new WeakSet();
  const queued = new Map();
  let flushTimer = null;
  let openPopover = null;
  const DETAIL_DOCK_LAYOUT_KEY = "poke-price-lens:detail-dock-layout:v1";

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
    .ppl-popover-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
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

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderDetailDock(card, links) {
    if (document.getElementById("poke-price-lens-detail-dock")) return;
    const host = document.createElement("div");
    host.id = "poke-price-lens-detail-dock";
    const shadow = host.attachShadow({ mode: "open" });
    const linkMarkup = links.map((link) => {
      const state = link.current ? "Here" : link.exact ? "Exact" : "Search";
      const inner = `<span>${escapeHtml(link.label)}</span><span class="state">${state}</span>`;
      return link.current
        ? `<span class="link current">${inner}</span>`
        : `<a class="link" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${inner}</a>`;
    }).join("");
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .dock { position: fixed; left: 18px; top: 18px; z-index: 2147483647; width: 360px; overflow: hidden; border: 1px solid rgba(148, 163, 184, .28); border-radius: 15px; background: rgba(8, 15, 28, .82); color: #e5edf8; box-shadow: 0 18px 55px rgba(2, 6, 23, .38); -webkit-backdrop-filter: blur(18px) saturate(135%); backdrop-filter: blur(18px) saturate(135%); font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .header { display: flex; align-items: center; gap: 9px; padding: 10px 11px 10px 13px; border-bottom: 1px solid #1e293b; cursor: move; user-select: none; }
        .mark { display: grid; place-items: center; width: 27px; height: 27px; flex: none; border: 2px solid #020617; border-radius: 50%; background: linear-gradient(#ef4444 0 45%, #f8fafc 45% 100%); }
        .mark::after { content: ""; width: 7px; height: 7px; border: 2px solid #020617; border-radius: 50%; background: #f8fafc; }
        .heading { min-width: 0; flex: 1; }
        .brand { color: #f8fafc; font-size: 13px; font-weight: 750; }
        .card { overflow: hidden; color: #94a3b8; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .close { width: 27px; height: 27px; border: 0; border-radius: 7px; background: transparent; color: #94a3b8; cursor: pointer; font: 17px/1 sans-serif; }
        .close:hover { background: #1e293b; color: white; }
        .body { padding: 11px 13px 13px; }
        .label { display: flex; justify-content: space-between; margin-bottom: 7px; color: #7f8ea3; font-size: 9px; letter-spacing: .07em; text-transform: uppercase; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .link { display: flex; min-width: 0; min-height: 35px; align-items: center; justify-content: space-between; gap: 5px; padding: 7px 8px; border: 1px solid rgba(100, 116, 139, .4); border-radius: 8px; background: rgba(17, 27, 46, .62); color: #dbeafe; font-size: 10px; font-weight: 650; text-decoration: none; }
        a.link:hover { border-color: rgba(147, 197, 253, .72); background: rgba(30, 58, 95, .75); }
        .link.current { border-color: #60a5fa; background: rgba(30, 64, 175, .26); color: white; }
        .state { flex: none; color: #64748b; font-size: 7px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
        .current .state { color: #93c5fd; }
        .open-all { width: 100%; height: 31px; margin-top: 7px; border: 1px solid rgba(96, 165, 250, .55); border-radius: 8px; background: rgba(29, 78, 216, .34); color: #dbeafe; cursor: pointer; font: 700 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .resize-handle { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; opacity: .75; }
        .resize-handle::before { content: ""; position: absolute; right: 4px; bottom: 4px; width: 10px; height: 10px; border-right: 2px solid rgba(147, 197, 253, .65); border-bottom: 2px solid rgba(147, 197, 253, .65); }
      </style>
      <section class="dock">
        <header class="header"><span class="mark"></span><div class="heading"><div class="brand">Poké Price Lens</div><div class="card">${escapeHtml(card.name)} #${escapeHtml(card.number)}${card.set ? ` · ${escapeHtml(card.set)}` : ""}</div></div><button class="close" type="button" aria-label="Close">×</button></header>
        <div class="body"><div class="label"><span>Card navigator</span><span>Switch sites</span></div><div class="grid">${linkMarkup}</div><button class="open-all" type="button">Open all</button></div>
        <div class="resize-handle" aria-hidden="true"></div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const dock = shadow.querySelector(".dock");
    const header = shadow.querySelector(".header");
    const resizeHandle = shadow.querySelector(".resize-handle");
    const margin = 12;
    const minWidth = 300;
    const minHeight = 170;

    function defaultLayout() {
      const width = Math.min(360, Math.max(minWidth, window.innerWidth - margin * 2));
      const bodyHeight = shadow.querySelector(".body").scrollHeight;
      const height = Math.min(Math.max(minHeight, 58 + bodyHeight), window.innerHeight - margin * 2);
      return {
        width,
        height,
        left: Math.max(margin, window.innerWidth - width - 18),
        top: Math.max(margin, window.innerHeight - height - 18)
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
    const currentProduct = {
      title: `${card.name} #${card.number}`,
      name: card.name,
      number: card.number,
      set: card.set,
      url: location.href,
      prices: {}
    };
    const [knownLinks, lookupResult] = await Promise.all([
      getKnownLinks(card),
      sendMessage({ type: "PC_LOOKUP", card, preferred: {} }).catch(() => navigation.lookupForPriceChartingProduct(currentProduct))
    ]);
    const links = navigation.resolveLinks(card, lookupResult, knownLinks, location.href);
    renderDetailDock(card, links);
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
