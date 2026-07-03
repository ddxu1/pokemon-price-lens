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

test("extracts card numbers without confusing the set total", () => {
  assert.equal(detector.cardNumber("Mega Charizard X ex 125/094"), "125");
  assert.equal(detector.cardNumber("Mega Charizard X ex #125"), "125");
  assert.equal(detector.fullCardNumber("Mega Charizard X ex 125/094"), "125/094");
});
