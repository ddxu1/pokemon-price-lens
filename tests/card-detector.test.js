const test = require("node:test");
const assert = require("node:assert/strict");
const detector = require("../card-detector");

test("parses the Collectr example", () => {
  assert.deepEqual(
    detector.parseCollectrTitle(
      "Mega Charizard X ex - 125/094 - Phantasmal Flames Pokemon - Collectr"
    ),
    {
      source: "collectr",
      name: "Mega Charizard X ex",
      number: "125",
      fullNumber: "125/094",
      set: "Phantasmal Flames"
    }
  );
});

test("parses a Collectr promo title without a set fraction", () => {
  assert.deepEqual(
    detector.parseCollectrTitle(
      "Mega Charizard X ex - 023 - Mega Evolution Promos Pokemon - Collectr"
    ),
    {
      source: "collectr",
      name: "Mega Charizard X ex",
      number: "023",
      fullNumber: "",
      set: "Mega Evolution Promos"
    }
  );
});

test("parses a TCGplayer-style product title", () => {
  assert.deepEqual(
    detector.parseTcgplayerTitle(
      "Mega Charizard X ex - 125/094 - Phantasmal Flames - Pokemon | TCGplayer"
    ),
    {
      source: "tcgplayer",
      name: "Mega Charizard X ex",
      number: "125",
      fullNumber: "125/094",
      set: "Phantasmal Flames"
    }
  );
});

test("parses a TCGplayer title without a card number", () => {
  assert.deepEqual(
    detector.parseTcgplayerTitle(
      "Blastoise - Base Set - Pokemon | TCGplayer"
    ),
    {
      source: "tcgplayer",
      name: "Blastoise",
      number: "",
      fullNumber: "",
      set: "Base Set"
    }
  );
});

test("parses a TCGplayer product slug before the page hydrates", () => {
  assert.deepEqual(
    detector.parseTcgplayerSlug("/product/42360/pokemon-base-set-blastoise?Language=English&page=1"),
    {
      source: "tcgplayer",
      name: "Blastoise",
      number: "",
      fullNumber: "",
      set: "Base Set"
    }
  );
});

test("extracts card numbers without confusing the set total", () => {
  assert.equal(detector.cardNumber("Mega Charizard X ex 125/094"), "125");
  assert.equal(detector.cardNumber("Mega Charizard X ex #125"), "125");
  assert.equal(detector.fullCardNumber("Mega Charizard X ex 125/094"), "125/094");
});

test("parses an ungraded eBay listing title", () => {
  assert.deepEqual(
    detector.parseEbayListingTitle(
      "Pokemon 2025 Mega Charizard X EX SIR 125/094 (English) Phantasmal Flames Pokemon TCG"
    ),
    {
      source: "ebay",
      name: "Mega Charizard X EX",
      number: "125",
      fullNumber: "125/094",
      set: "Phantasmal Flames",
      listingLanguage: "english",
      listingGrade: "ungraded"
    }
  );
});

test("uses eBay item specifics for a Japanese PSA 10 listing", () => {
  assert.deepEqual(
    detector.parseEbayListingTitle(
      "2025 Pokemon Mega Charizard X ex 110/080 PSA10",
      { cardName: "Mega Charizard X ex", cardNumber: "110/080", set: "Inferno X", language: "Japanese", grade: "PSA 10" }
    ),
    {
      source: "ebay",
      name: "Mega Charizard X ex",
      number: "110",
      fullNumber: "110/080",
      set: "Pokemon Japanese Inferno X",
      listingLanguage: "japanese",
      listingGrade: "psa10"
    }
  );
});

test("parses an eBay product-page title that redirects away from /itm/", () => {
  assert.deepEqual(
    detector.parseEbayListingTitle(
      "Pikachu ex 764/742 Start Deck 100 Battle Collection Holo (Japanese) for sale online | eBay",
      {
        cardName: "Pikachu Ex -",
        cardNumber: "764/742",
        set: "Start Deck 100 Battle Collection",
        language: "Japanese"
      }
    ),
    {
      source: "ebay",
      name: "Pikachu Ex -",
      number: "764",
      fullNumber: "764/742",
      set: "Pokemon Japanese Start Deck 100 Battle Collection",
      listingLanguage: "japanese",
      listingGrade: "ungraded"
    }
  );
});
