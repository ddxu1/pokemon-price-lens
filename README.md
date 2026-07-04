# Poké Price Lens

A dependency-free Chrome extension that adds two Pokémon card pricing shortcuts:

- On Collectr, TCGplayer, and eBay product pages, a floating panel finds the best English and Japanese PriceCharting matches and shows Ungraded, Grade 9, and PSA 10 values.
- On PriceCharting result lists, a `PSA 10` badge is added to each visible Pokémon card row.
- A card navigator switches between Collectr, TCGplayer, eBay, English PriceCharting, and Japanese PriceCharting, with an **Open all** action.
- A **Sold comps** mode switches the eBay navigator target from live listings to sold/completed comps.
- A **Pin pair** action lets you confirm the current English/Japanese counterpart pair so that future lookups reuse it.
- On an eBay listing, the panel compares the asking price with the appropriate PriceCharting Ungraded, Grade 9, or PSA 10 value.

The extension queries PriceCharting directly from the browser. It has no backend and does not require an API key.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `pokemon-price-lens` folder.
5. Open a Collectr, TCGplayer, or eBay card product page. The comparison panel appears automatically.

After changing extension files, click the extension's reload button on `chrome://extensions`, then refresh the card page.

## How matching works

The extension extracts the card name, number, and set from the current product page. It searches PriceCharting by card name, then separately ranks English and Japanese results.

- English matches prioritize exact name, card number, and set.
- Japanese matches prioritize exact name and known English/Japanese set pairs from `set-pairs.json`.
- The **Match** menu lets you correct ambiguous reprints. That choice is remembered for that card in Chrome local storage.
- The **Pin pair** action stores a confirmed cross-language pair by PriceCharting URL so the same counterpart can be reused on future pages.

The initial set-pair dataset includes Phantasmal Flames ↔ Japanese Inferno X and Perfect Order ↔ Nihil Zero. Unmapped cards still use PriceCharting search relevance and remain manually selectable.

## Card navigator

The navigator appears in the Collectr, TCGplayer, and eBay comparison overlay and as a compact dock on PriceCharting product pages. Clicking a Price Lens PSA 10 badge on PriceCharting search results opens the same navigator in a popover.

- PriceCharting product URLs are resolved from the extension's card matching results.
- Visiting a Collectr or TCGplayer product teaches the extension that exact URL for that card.
- Until an exact marketplace URL has been learned, TCGplayer opens a pre-filled product search and Collectr opens a targeted site search. These buttons are labeled **Search**, while known product links are labeled **Exact**.
- eBay always opens a current listing search because individual listings expire; an eBay listing itself is labeled **Here**.
- Enabling **Sold comps** switches the eBay target to sold/completed listings while keeping the rest of the navigator unchanged.
- **Open all** creates the other available pages as background tabs.

## eBay listing comparison

On `ebay.com/itm/*` pages, the extension reads the public listing title, item specifics, grade, language, and asking price. PSA 10 listings are compared with PriceCharting PSA 10, grade 9 listings with Grade 9, and other listings with Ungraded. The comparison excludes shipping, tax, live bid changes, and negotiated offers.

## PriceCharting PSA 10 badges

Badges show PriceCharting's current PSA 10 market value, not the last individual completed sale. Rows are fetched only as they approach the viewport, in batches of up to eight. Product detail results are cached for 15 minutes in the extension service worker.

## Development

No build step or dependencies are required.

```sh
npm test
npm run check
```

PriceCharting, Collectr, and TCGplayer can change their HTML structure. The parser regression tests cover the current structure, but the extension may need selector updates when those sites change.
