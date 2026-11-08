const merchants = [
  {
    minor: 1, name: 'Starbucks', category: 'Coffee', period: 'week',
    budget: 2500, purchases: [650, 850, 700], price: 625, cashbackPercent: 5,
    alternative: 'Campus Coffee', alternativePrice: 275,
  },
  {
    minor: 2, name: 'Walmart', category: 'Groceries', period: 'week',
    budget: 9000, purchases: [2200, 2950, 1750], price: 1900, cashbackPercent: 3,
    alternative: 'Campus Market', alternativePrice: 1550,
  },
  {
    minor: 3, name: 'Gas station', category: 'Fuel', period: 'month',
    budget: 12000, purchases: [3550, 4250], price: 3800, cashbackPercent: 4,
    alternative: 'Fuel Stop', alternativePrice: 3410,
  },
];

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

function recommend(merchant) {
  const spent = merchant.purchases.reduce((total, purchase) => total + purchase, 0);
  const remaining = merchant.budget - spent;
  const reward = Math.round(merchant.price * merchant.cashbackPercent / 100);
  const netPrice = merchant.price - reward;
  const overBudget = netPrice - remaining;
  const savings = netPrice - merchant.alternativePrice;
  const assessment = overBudget > 0
    ? `This purchase would put you ${money(overBudget)} over budget after cashback.`
    : `This purchase would leave ${money(-overBudget)} in your budget after cashback.`;
  const advice = `You have ${money(remaining)} left for ${merchant.category.toLowerCase()} this ${merchant.period}. ${assessment}`;
  const alternative = `${merchant.alternative} has a ${money(merchant.alternativePrice)} option. That saves ${money(savings)} even after the ${merchant.name} cashback.`;
  return { spent, remaining, reward, netPrice, savings, advice, alternative };
}

module.exports = { merchants, recommend };
