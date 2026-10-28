// Premium estimation model. Every figure here is an ESTIMATE built from
// published industry-typical rate shapes, not an insurer quote.

const AGE_POINTS = [
  [25, 0.5], [30, 0.55], [35, 0.7], [40, 0.98], [45, 1.45],
  [50, 2.3], [55, 3.95], [60, 7.2], [65, 14.5], [70, 28],
];

// Annual dollars per $1,000 for a male, non-smoker, Preferred Plus, 20-year term.
function baseRate(age) {
  if (age <= AGE_POINTS[0][0]) return AGE_POINTS[0][1];
  for (let i = 1; i < AGE_POINTS.length; i++) {
    const [a1, r1] = AGE_POINTS[i];
    const [a0, r0] = AGE_POINTS[i - 1];
    if (age <= a1) return r0 * Math.pow(r1 / r0, (age - a0) / (a1 - a0));
  }
  return AGE_POINTS[AGE_POINTS.length - 1][1];
}

export const TERM_FACTORS = { 10: 0.62, 15: 0.78, 20: 1, 25: 1.3, 30: 1.72, 40: 2.9 };
export const HEALTH_CLASSES = [
  { id: "pp", label: "Preferred Plus", factor: 1 },
  { id: "p", label: "Preferred", factor: 1.18 },
  { id: "sp", label: "Standard Plus", factor: 1.5 },
  { id: "s", label: "Standard", factor: 1.85 },
  { id: "r", label: "Rated / Substandard", factor: 2.6 },
];
const SMOKER_FACTOR = 2.9;
const FEMALE_FACTOR = 0.82;
const POLICY_FEE = 60;
const WHOLE_LIFE_MULT = 9.5;

function bandFactor(face) {
  if (face < 250000) return 1.12;
  if (face < 500000) return 1.05;
  if (face < 1000000) return 1;
  if (face < 2000000) return 0.92;
  return 0.88;
}

export const RATING_RANK = { "A++": 5, "A+": 4, "A": 3, "A-": 2 };

// Whole life premiums move inversely with long-term yields; term barely does.
function yieldFactor(y10) {
  if (y10 == null) return 1;
  return Math.min(1.08, Math.max(0.92, 1 - 0.025 * (y10 - 4)));
}

export function maxTermForAge(age) {
  return 80 - age;
}

// Returns annual premium in dollars, or null when the carrier can't offer it.
export function annualPremium(insurer, p, y10) {
  const { age, gender, smoker, health, face, term, type } = p;
  const healthFactor = HEALTH_CLASSES.find((h) => h.id === health).factor;
  const slope = 1 + insurer.ageSlope * ((age - 40) / 10);
  const smoke = smoker ? SMOKER_FACTOR * insurer.smokerFactor : 1;
  const gender_ = gender === "f" ? FEMALE_FACTOR : 1;

  if (type === "whole") {
    if (insurer.wholeLifeFactor == null || age > 75) return null;
    const rate = baseRate(age) * WHOLE_LIFE_MULT * insurer.wholeLifeFactor;
    return (
      (rate * (face / 1000) * healthFactor * smoke * gender_ * bandFactor(face) * yieldFactor(y10)) / 1.25 +
      POLICY_FEE
    );
  }

  if (!insurer.termLengths.includes(term)) return null;
  if (age + term > 80 && !(age + term <= 85 && term <= 20)) return null;
  const rate = baseRate(age) * TERM_FACTORS[term] * insurer.priceFactor * slope;
  return rate * (face / 1000) * healthFactor * smoke * gender_ * bandFactor(face) + POLICY_FEE;
}

export function quote(insurer, p, y10) {
  const annual = annualPremium(insurer, p, y10);
  if (annual == null) return null;
  const years = p.type === "whole" ? Math.max(0, 85 - p.age) : p.term;
  return {
    annual,
    monthly: annual / 12 * 1.04, // monthly billing carries a small modal fee
    total: annual * years,
    perThousand: annual / (p.face / 1000),
  };
}

// Blend of price and financial strength, 0-100. Price weighs 60%, rating 30%, flexibility 10%.
export function valueScore(insurer, q, cheapest, priciest) {
  const range = Math.max(1, priciest - cheapest);
  const price = 1 - (q.annual - cheapest) / range;
  const rating = (RATING_RANK[insurer.amBest] || 2) / 5;
  const flex = ((insurer.conversionAge ? 0.5 : 0) + (insurer.noExam ? 0.3 : 0) + insurer.riders.length * 0.067);
  return Math.round(100 * (0.6 * price + 0.3 * rating + 0.1 * Math.min(1, flex)));
}

export function money(n, digits = 0) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// DIME method: Debt + Income x years + Mortgage + Education.
export function dime({ debt, income, years, mortgage, education, assets }) {
  return Math.max(0, debt + income * years + mortgage + education - assets);
}
