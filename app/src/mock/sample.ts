// PLACEHOLDER LAYOUT DATA copied from the Stitch design mockups.
// NOT real deals, balances or transactions. Replace with Nessie / TigerData / recommender
// responses before any demo (CLAUDE.md: never fabricate deals or financial inputs in demos).
import { IconName } from '../components/ui';

export const SAMPLE_BANNER = 'Sample layout data — not real';

export const deals = [
  { id: 1, merchant: 'Drift Roasters', icon: 'coffee-outline' as IconName, reward: '15% Back', dist: '0.4 mi', area: 'Waterfront Pier', title: 'Instant Cashback on Espresso & Beans', sub: 'Pay with Stillwater Debit • Valid thru Sun', note: 'Auto-applied at register', cta: 'Activate', pin: { x: 140, y: 130 }, cat: 'Coffee' },
  { id: 2, merchant: 'Alpine Market', icon: 'storefront-outline' as IconName, reward: '$12 Off', dist: '0.8 mi', area: 'Alpine Valley', title: '$12 off purchases over $60', sub: 'Stillwater Visa & Debit • 5 days left', note: 'Eligible for in-store & pickup', cta: 'Claim Offer', pin: { x: 295, y: 210 }, cat: 'Groceries' },
  { id: 3, merchant: 'Cascade Outfitter', icon: 'tent' as IconName, reward: '20% Back', dist: '1.2 mi', area: 'North Ridge', title: '20% Cashback on kayak & camp gear', sub: 'Max reward $40 • Ongoing summer perk', note: 'Direct credit within 24h', cta: 'Activate', pin: { x: 265, y: 75 }, cat: 'Retail' },
  { id: 4, merchant: 'Lakefront Bistro', icon: 'silverware-fork-knife' as IconName, reward: '20% Back', dist: '1.6 mi', area: 'Marina Cove', title: 'Tasting menu & weekend wine pairings', sub: 'Stillwater Platinum exclusive', note: 'Auto-credit upon dining', cta: 'Reserve & Save', pin: { x: 245, y: 315 }, cat: 'Dining' },
];
export const dealCategories = ['All', 'Dining', 'Coffee', 'Groceries', 'Retail'];

export const spendCategories = [
  { name: 'Housing & Utilities', sub: 'Rent, electricity, water', amt: 1650.0, pct: 43, color: '#041920', icon: 'home-outline' as IconName, short: 'Housing' },
  { name: 'Food & Dining', sub: 'Cafes, bistros, delivery', amt: 742.8, pct: 19, color: '#206774', icon: 'silverware-fork-knife' as IconName, short: 'Dining' },
  { name: 'Groceries & Essentials', sub: 'Markets, pantry items', amt: 520.1, pct: 14, color: '#629e82', icon: 'basket-outline' as IconName, short: 'Groceries' },
  { name: 'Transportation', sub: 'Ferry, rail, EV charge', amt: 380.0, pct: 10, color: '#90d1df', icon: 'train' as IconName, short: 'Transit' },
  { name: 'Entertainment & Leisure', sub: 'National parks, concerts', amt: 290.4, pct: 8, color: '#b4cad3', icon: 'kayaking' as IconName, short: 'Leisure' },
  { name: 'Shopping & Gear', sub: 'Outdoor apparel & books', amt: 259.2, pct: 6, color: '#dddad2', icon: 'hiking' as IconName, short: 'Shopping' },
];

export const transactions = [
  { name: "Trader Joe's", when: 'Yesterday, 4:15 PM', cat: 'Groceries', amt: -84.2, icon: 'storefront-outline' as IconName },
  { name: 'Blue Bottle Coffee', when: 'Yesterday, 9:30 AM', cat: 'Dining', amt: -6.75, icon: 'coffee-outline' as IconName },
  { name: 'Pacific Gas & Electric', when: 'Oct 18, 2:00 PM', cat: 'Utilities', amt: -142.1, icon: 'flash-outline' as IconName },
  { name: 'REI Co-op', when: 'Oct 16, 11:20 AM', cat: 'Outdoor', amt: -118.5, icon: 'terrain' as IconName },
];

export const days = [
  { dow: 'THU', d: '24', kind: 'today' },
  { dow: 'FRI', d: '25', kind: 'out' },
  { dow: 'SAT', d: '26', kind: 'none' },
  { dow: 'SUN', d: '27', kind: 'none' },
  { dow: 'MON', d: '28', kind: 'out' },
  { dow: 'TUE', d: '29', kind: 'none' },
  { dow: 'WED', d: '30', kind: 'none' },
  { dow: 'THU', d: '31', kind: 'in' },
  { dow: 'NOV 1', d: '01', kind: 'out' },
  { dow: 'SUN', d: '03', kind: 'out' },
  { dow: 'TUE', d: '05', kind: 'in' },
] as const;

export const bills = [
  { name: 'Mortgage / Apartment Rent', icon: 'home-outline' as IconName, line: 'Due Oct 25', tag: 'In 5 days', tagErr: true, amt: 1650, acct: 'Checking •• 4892', autopay: true },
  { name: 'Student Loan Debt', icon: 'school-outline' as IconName, line: 'Sallie Mae', tag: 'Due Oct 28', tagErr: true, amt: 340, acct: 'Min. Due', pay: true },
  { name: 'Car Loan Payment', icon: 'car-outline' as IconName, line: 'Due Nov 01', tag: 'Scheduled', tagErr: false, amt: 320, acct: 'Auto' },
  { name: 'Electric & Water Utility', icon: 'flash-outline' as IconName, line: 'Due Nov 03', tag: 'Stillwater City Power', tagErr: false, amt: 150, acct: 'E-bill' },
];

export const incomes = [
  { name: 'Payroll Direct Deposit', icon: 'bank-outline' as IconName, line: 'TechCorp Inc.', date: 'Oct 31', amt: 3850, status: 'Verified' },
  { name: 'Freelance Retainer', icon: 'palette-outline' as IconName, line: 'Studio Wave', date: 'Nov 05', amt: 450, status: 'Pending' },
];

export const profile = {
  name: 'Elena Rostova',
  tier: 'Stillwater Sovereign • Since 2021',
  checking: 'Primary Checking •• 4892',
  balance: '$14,892.40',
  cardholder: 'ELENA ROSTOVA',
  expiry: '09/29',
  linked: [
    { name: 'Vanguard Brokerage', sub: 'Roth IRA •• 1029', amt: '$184,320.12', badge: 'Synced', icon: 'bank-outline' as IconName },
    { name: 'Stillwater High-Yield Vault', sub: 'Savings •• 7731', amt: '$45,000.00', badge: '4.85% APY', icon: 'piggy-bank-outline' as IconName },
  ],
};

export const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
