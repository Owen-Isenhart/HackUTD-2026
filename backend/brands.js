const BRANDS = [
  ["chipotle", "Chipotle", "dining", "Chipotle Mexican Grill"],
  ["chick_fil_a", "Chick-fil-A", "dining"],
  ["panera", "Panera Bread", "dining"],
  ["taco_bell", "Taco Bell", "dining"],
  ["uber_eats", "Uber Eats", "dining"],
  ["starbucks", "Starbucks", "coffee", "Starbucks Coffee"],
  ["bluebird_coffee", "Bluebird Coffee", "coffee", "Bluebird Coffee Roasters"],
  ["walmart", "Walmart", "groceries", "Walmart Supercenter"],
  ["target", "Target", "groceries"],
  ["shell", "Shell", "fuel", "Shell Fuel"],
  ["chevron", "Chevron", "fuel", "Chevron Fuel"],
  ["booking_com", "Booking.com", "travel", "Booking.com Travel"],
  ["bestbuy", "Best Buy", "electronics"],
  ["nike", "Nike", "retail", "Nike Store"],
  ["homedepot", "The Home Depot", "retail"],
  ["sephora", "Sephora", "retail"],
  ["lululemon", "Lululemon", "retail"],
  ["macys", "Macy's", "retail"],
  ["jcpenney", "JCPenney", "retail"],
];
function normalizeMerchantName(name) {
  return String(name)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?:#|store\s*)\d+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /\s+(coffee roasters|mexican grill|supercenter|coffee|fuel|store|bread|travel)$/,
      "",
    )
    .trim();
}
const aliases = new Map(
  BRANDS.flatMap(([key, name, , alias]) =>
    [name, alias].filter(Boolean).map((n) => [normalizeMerchantName(n), key]),
  ),
);
function matchBrand(name) {
  const key = aliases.get(normalizeMerchantName(name));
  return key
    ? { key, category: BRANDS.find((x) => x[0] === key)[2], match: "alias" }
    : { key: null, match: "unresolved" };
}
const category = (value) =>
  ({
    restaurant: "dining",
    gas: "fuel",
    coffee: "coffee",
    groceries: "groceries",
    travel: "travel",
    electronics: "electronics",
    retail: "retail",
  })[value] || "other";
module.exports = { BRANDS, normalizeMerchantName, matchBrand, category };
