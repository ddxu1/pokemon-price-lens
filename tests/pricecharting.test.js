const test = require("node:test");
const assert = require("node:assert/strict");
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

test("parses English and Japanese PriceCharting rows", () => {
  const results = pricecharting.parseSearchResults(searchHtml);
  assert.equal(results.length, 2);
  assert.equal(results[0].prices.ungraded, "$834.82");
  assert.equal(results[1].language, "japanese");
  assert.equal(results[1].number, "110");
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

test("parses the full PriceCharting grade ladder", () => {
  const html = `
    <td id="used_price"><span class="price js-price">$834.82</span><span class="change">+$1.00</span></td>
    <td id="complete_price"><span class="price js-price">$755.74</span></td>
    <td id="new_price"><span class="price js-price">$797.71</span></td>
    <td id="graded_price"><span class="price js-price">$862.50</span></td>
    <td id="box_only_price"><span class="price js-price">$1,497.78</span></td>
    <td id="manual_only_price"><span class="price js-price">$2,399.00</span></td>
  `;
  assert.deepEqual(pricecharting.parseProductDetail(html), {
    ungraded: "$834.82",
    grade7: "$755.74",
    grade8: "$797.71",
    grade9: "$862.50",
    grade95: "$1,497.78",
    psa10: "$2,399.00"
  });
});
