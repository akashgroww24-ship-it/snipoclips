// lib/plans.js
// Single source of truth for the plan catalog + pricing.
// USD is the base. Other currencies are derived for DISPLAY using a static
// FX table — swap fetchFx() for a live rates API before you rely on exact prices.

const CATALOG = [
  {
    id: 'free', name: 'Free', usd_month: 0, usd_year: 0,
    tagline: 'Try it out — no card needed.',
    cta: 'current',
    clips: '2 clips total',
    features: ['2 clips to try', 'AI captions & 9:16 reframe', '720p export', 'Virality score']
  },
  {
    id: 'single', name: 'Single Slice', usd_month: 12.49, usd_year: 149.99,
    tagline: 'For individual creators starting their short-form workflow.',
    cta: 'upgrade',
    clips: '10 clips / month',
    features: ['10 AI clips per month', 'AI captions + 9:16 reframe', 'Virality score', 'Built-in caption editor', 'Basic analytics']
  },
  {
    id: 'half', name: 'Half Pie', usd_month: 24.99, usd_year: 299.99,
    tagline: 'For growing creators posting more often.',
    cta: 'upgrade', popular: true,
    clips: '30 clips / month',
    features: ['30 AI clips per month', 'No watermark · up to 1080p', 'AI B-roll + audio enhance', 'Caption styles & editor', 'Advanced analytics']
  },
  {
    id: 'full', name: 'Full Pie', usd_month: 49.99, usd_year: 599.99,
    tagline: 'For serious creators & small teams posting daily.',
    cta: 'upgrade',
    clips: '100 clips / month',
    features: ['100 AI clips per month', 'Up to 4K export', 'AI B-roll (cinematic) + audio enhance', 'Advanced analytics & insights', 'Priority processing & support']
  }
];

// Static FX (USD -> currency). Update or wire to a live source.
const FX = { USD: 1, INR: 86.5, EUR: 0.92, GBP: 0.79, BRL: 5.4, AED: 3.67 };
const CURRENCY_META = {
  USD: { symbol: '$',  locale: 'en-US' },
  INR: { symbol: '₹',  locale: 'en-IN' },
  EUR: { symbol: '€',  locale: 'de-DE' },
  GBP: { symbol: '£',  locale: 'en-GB' },
  BRL: { symbol: 'R$', locale: 'pt-BR' },
  AED: { symbol: 'AED ', locale: 'ar-AE' }
};

function priceIn(usd, currency) {
  const rate = FX[currency] || 1;
  const raw = usd * rate;
  // round to a clean-looking number per currency
  if (currency === 'INR') return Math.round(raw / 10) * 10 - 1;   // e.g. 1639 -> 1639
  if (currency === 'BRL') return Math.round(raw) - 0.1 + 0.1;
  return Math.round(raw * 100) / 100;
}

module.exports = { CATALOG, FX, CURRENCY_META, priceIn };
