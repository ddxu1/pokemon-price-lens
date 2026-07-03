const test = require("node:test");
const assert = require("node:assert/strict");
const navigation = require("../navigation");

const card = {
  name: "Mega Charizard X ex",
  number: "125",
  set: "Phantasmal Flames"
};

test("uses one card identity across marketplace set prefixes", () => {
  assert.equal(
    navigation.cardKey(card),
    navigation.cardKey({ ...card, set: "ME02: Phantasmal Flames" })
  );
  assert.equal(
    navigation.cardKey(card),
    navigation.cardKey({ ...card, set: "Pokemon Phantasmal Flames" })
  );
});

test("builds precise marketplace search fallbacks", () => {
  const tcg = new URL(navigation.tcgplayerSearchUrl(card));
  assert.equal(tcg.hostname, "www.tcgplayer.com");
  assert.match(tcg.searchParams.get("q"), /Mega Charizard X ex #125 Phantasmal Flames/);

  const preciseTcg = new URL(navigation.tcgplayerSearchUrl({ ...card, fullNumber: "125/094" }));
  assert.match(preciseTcg.searchParams.get("q"), /Mega Charizard X ex 125\/094 Phantasmal Flames/);

  const collectr = new URL(navigation.collectrSearchUrl(card));
  assert.equal(collectr.hostname, "www.google.com");
  assert.match(collectr.searchParams.get("q"), /site:app\.getcollectr\.com\/explore\/product/);

  const ebay = new URL(navigation.ebaySearchUrl({ ...card, fullNumber: "125/094" }));
  assert.equal(ebay.hostname, "www.ebay.com");
  assert.match(ebay.searchParams.get("_nkw"), /125\/094/);
});

test("prefers remembered marketplace links and exact PriceCharting matches", () => {
  const english = {
    title: "Mega Charizard X ex #125",
    url: "https://www.pricecharting.com/game/pokemon-phantasmal-flames/mega-charizard-x-ex-125"
  };
  const japanese = {
    title: "Mega Charizard X Ex #110",
    url: "https://www.pricecharting.com/game/pokemon-japanese-inferno-x/mega-charizard-x-ex-110"
  };
  const links = navigation.resolveLinks(
    card,
    { english: { selected: english }, japanese: { selected: japanese } },
    {
      collectr: "https://app.getcollectr.com/explore/product/662184",
      tcgplayer: "https://www.tcgplayer.com/product/123/example"
    },
    english.url
  );

  assert.deepEqual(links.map(({ id, exact, current }) => ({ id, exact, current })), [
    { id: "collectr", exact: true, current: false },
    { id: "tcgplayer", exact: true, current: false },
    { id: "pricecharting-english", exact: true, current: true },
    { id: "pricecharting-japanese", exact: true, current: false },
    { id: "ebay", exact: false, current: false }
  ]);
});

test("classifies a Japanese PriceCharting row for its navigation menu", () => {
  const product = {
    set: "Pokemon Japanese Inferno X",
    url: "https://www.pricecharting.com/game/pokemon-japanese-inferno-x/mega-charizard-x-ex-110"
  };
  const lookup = navigation.lookupForPriceChartingProduct(product);
  assert.equal(lookup.japanese.selected, product);
  assert.equal(lookup.english, undefined);
});
