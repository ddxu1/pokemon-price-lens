const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pricecharting = require("../pricecharting");

const searchHtml = `
  <table><tbody>
    <tr id="product-11069001" data-product="11069001">
      <td class="image"><a href="https://www.pricecharting.com/game/pokemon-phantasmal-flames/mega-charizard-x-ex-125"><img class="photo" src="https://images.test/en/60.jpg"></a></td>
      <td class="title"><a href="https://www.pricecharting.com/game/pokemon-phantasmal-flames/mega-charizard-x-ex-125">Mega Charizard X ex #125</a><div class="console-in-title"><a href="/console/pokemon-phantasmal-flames">Pokemon Phantasmal Flames</a></div></td>
      <td class="console"><a href="/console/pokemon-phantasmal-flames">Pokemon Phantasmal Flames</a></td>
      <td class="price numeric used_price"><span class="js-price">$834.82</span></td>
      <td class="price numeric cib_price"><span class="js-price">$755.74</span></td>
      <td class="price numeric new_price"><span class="js-price">$797.71</span></td>
    </tr>
    <tr id="product-10645617" data-product="10645617">
      <td class="image"><a href="https://www.pricecharting.com/game/pokemon-japanese-inferno-x/mega-charizard-x-ex-110"><img class="photo" src="https://images.test/jp/60.jpg"></a></td>
      <td class="title"><a href="https://www.pricecharting.com/game/pokemon-japanese-inferno-x/mega-charizard-x-ex-110">Mega Charizard X Ex #110</a><div class="console-in-title"><a href="/console/pokemon-japanese-inferno-x">Pokemon Japanese Inferno X</a></div></td>
      <td class="console"><a href="/console/pokemon-japanese-inferno-x">Pokemon Japanese Inferno X</a></td>
      <td class="price numeric used_price"><span class="js-price">$700.00</span></td>
      <td class="price numeric cib_price"><span class="js-price">$519.11</span></td>
      <td class="price numeric new_price"><span class="js-price">$620.00</span></td>
    </tr>
  </tbody></table>
`;

const ambiguousCrossLanguageHtml = `
  <table><tbody>
    <tr id="product-2001" data-product="2001">
      <td class="title"><a href="https://www.pricecharting.com/game/pokemon-perfect-order/meowth-ex-107">Meowth ex #107</a><div class="console-in-title"><a href="/console/pokemon-perfect-order">Pokemon Perfect Order</a></div></td>
      <td class="console"><a href="/console/pokemon-perfect-order">Pokemon Perfect Order</a></td>
      <td class="price numeric used_price"><span class="js-price">$18.99</span></td>
    </tr>
    <tr id="product-2002" data-product="2002">
      <td class="title"><a href="https://www.pricecharting.com/game/pokemon-japanese-nihil-zero/meowth-ex-114">Meowth ex #114</a><div class="console-in-title"><a href="/console/pokemon-japanese-nihil-zero">Pokemon Japanese Nihil Zero</a></div></td>
      <td class="console"><a href="/console/pokemon-japanese-nihil-zero">Pokemon Japanese Nihil Zero</a></td>
      <td class="price numeric used_price"><span class="js-price">$9.99</span></td>
    </tr>
  </tbody></table>
`;

test("parses English and Japanese PriceCharting rows", () => {
  const results = pricecharting.parseSearchResults(searchHtml);
  assert.equal(results.length, 2);
  assert.equal(results[0].prices.ungraded, "$834.82");
  assert.equal(results[1].language, "japanese");
  assert.equal(results[1].number, "110");
});

test("loads known set pairs from the JSON dataset shape", () => {
  const dataset = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "set-pairs.json"), "utf8")
  );
  const configured = pricecharting.configureSetPairs(dataset);
  assert.deepEqual(configured.englishToJapanese["phantasmal flames"], ["inferno x"]);
  assert.deepEqual(configured.japaneseToEnglish["nihil zero"], ["perfect order"]);
});

test("ranks the exact English card and paired Japanese set", () => {
  const card = { name: "Mega Charizard X ex", number: "125", set: "Phantasmal Flames" };
  const results = pricecharting.parseSearchResults(searchHtml);
  assert.equal(pricecharting.rankResults(results, card, "english")[0].number, "125");
  assert.equal(pricecharting.rankResults(results, card, "japanese")[0].number, "110");
});

test("ranks the English counterpart when starting from the Japanese card", () => {
  const card = { name: "Mega Charizard X ex", number: "110", set: "Pokemon Japanese Inferno X" };
  const results = pricecharting.parseSearchResults(searchHtml);
  assert.equal(pricecharting.rankResults(results, card, "english")[0].number, "125");
  assert.equal(pricecharting.rankResults(results, card, "japanese")[0].number, "110");
});

test("does not force a weak opposite-language match with only a shared name", () => {
  const card = { name: "Meowth ex", number: "107", set: "Pokemon Perfect Order" };
  const results = pricecharting.parseSearchResults(ambiguousCrossLanguageHtml);
  assert.equal(pricecharting.rankResults(results, card, "english")[0].number, "107");
  const japanese = pricecharting.rankResults(results, card, "japanese");
  assert.equal(japanese[0].set, "Pokemon Japanese Nihil Zero");
  assert.equal(japanese[0].pairMatched, true);
});

test("parses the full PriceCharting grade ladder", () => {
  const html = `
    <td id="used_price"><span class="price js-price">$834.82</span><span class="change">+$1.00</span></td>
    <td id="complete_price"><span class="price js-price">$755.74</span></td>
    <td id="new_price"><span class="price js-price">$797.71</span></td>
    <td id="graded_price"><span class="price js-price">$862.50</span></td>
    <td id="box_only_price"><span class="price js-price">$1,497.78</span></td>
    <td id="manual_only_price"><span class="price js-price">$2,399.00</span></td>
    <div>volume: 1 sale per day volume: 1 sale per year volume: 2 sales per month volume: 1 sale per day volume: 1 sale per week volume: 8 sales per day</div>
    <div>PSA 10 Pop 123</div>
    <div>Total Graded 456</div>
  `;
  assert.deepEqual(pricecharting.parseProductDetail(html), {
    prices: {
      ungraded: "$834.82",
      grade7: "$755.74",
      grade8: "$797.71",
      grade9: "$862.50",
      grade95: "$1,497.78",
      psa10: "$2,399.00"
    },
    stats: {
      volumeText: "8 sales per day",
      liquidityLabel: "high",
      volumes: {
        ungraded: "1 sale per day",
        grade7: "1 sale per year",
        grade8: "2 sales per month",
        grade9: "1 sale per day",
        grade95: "1 sale per week",
        psa10: "8 sales per day"
      },
      psa10Pop: 123,
      totalGraded: 456,
      psa10Percentage: "27.0%"
    }
  });
});

test("parses rare as low liquidity from PriceCharting volume text", () => {
  assert.equal(pricecharting.parseLiquidityLabel("rare"), "low");
});

test("normalizes flattened volume text to just the liquidity phrase", () => {
  const html = `<div>volume: 9 sales per day Grade 9 Grade 9.5 PSA 10 $263.05 - $0.88</div>`;
  assert.equal(pricecharting.parseProductDetail(html).stats.volumeText, "9 sales per day");
});
