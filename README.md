# Poké Price Lens

A dependency-free Chrome extension that adds two Pokémon card pricing shortcuts:

- On Collectr and TCGplayer product pages, a floating panel finds the best English and Japanese PriceCharting matches and shows Ungraded, Grade 9, and PSA 10 values.
- On PriceCharting result lists, a `PSA 10` badge is added to each visible Pokémon card row.
- A card navigator switches between Collectr, TCGplayer, English PriceCharting, and Japanese PriceCharting, with an **Open all** action.

The extension queries PriceCharting directly from the browser. It has no backend and does not require an API key.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `pokemon-price-lens` folder.
5. Open a Collectr or TCGplayer card product page. The comparison panel appears automatically.

After changing extension files, click the extension's reload button on `chrome://extensions`, then refresh the card page.

## How matching works

The extension extracts the card name, number, and set from the current product page. It searches PriceCharting by card name, then separately ranks English and Japanese results.

- English matches prioritize exact name, card number, and set.
- Japanese matches prioritize exact name and known English/Japanese set pairs.
- The **Match** menu lets you correct ambiguous reprints. That choice is remembered for that card in Chrome local storage.

The initial known set mapping includes Phantasmal Flames ↔ Japanese Inferno X. Unmapped cards still use PriceCharting search relevance and remain manually selectable.

## Card navigator

The navigator appears in the Collectr/TCGplayer comparison overlay and as a compact dock on PriceCharting product pages. Clicking a Price Lens PSA 10 badge on PriceCharting search results opens the same navigator in a popover.

- PriceCharting product URLs are resolved from the extension's card matching results.
- Visiting a Collectr or TCGplayer product teaches the extension that exact URL for that card.
- Until an exact marketplace URL has been learned, TCGplayer opens a pre-filled product search and Collectr opens a targeted site search. These buttons are labeled **Search**, while known product links are labeled **Exact**.
- **Open all** creates the other available pages as background tabs.

## PriceCharting PSA 10 badges

Badges show PriceCharting's current PSA 10 market value, not the last individual completed sale. Rows are fetched only as they approach the viewport, in batches of up to eight. Product detail results are cached for 15 minutes in the extension service worker.

## Development

No build step or dependencies are required.

```sh
npm test
npm run check
```

PriceCharting, Collectr, and TCGplayer can change their HTML structure. The parser regression tests cover the current structure, but the extension may need selector updates when those sites change.
