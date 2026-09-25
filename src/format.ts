const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

function trim(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return digits > 0 ? s.replace(/\.?0+$/, '') : s;
}

export function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 10) return trim(n, 2);
  if (n < 1000) return trim(n, n < 100 ? 1 : 0);
  const tier = Math.floor(Math.log10(n) / 3);
  if (tier >= SUFFIXES.length) return n.toExponential(2).replace('+', '');
  const scaled = n / Math.pow(10, tier * 3);
  return trim(scaled, scaled < 10 ? 2 : scaled < 100 ? 1 : 0) + SUFFIXES[tier];
}

/** Bucket labels: "0.5×", "41×", but just "110" once the × no longer fits. */
export function fmtMult(n: number): string {
  const value = n < 1000 ? trim(n, 3) : fmt(n);
  return value + (n < 100 ? '×' : '');
}

/** Cents until a million, then suffixes. */
export function fmtMoney(n: number): string {
  if (n < 1e6) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + fmt(n);
}

/** The amount won or lost after subtracting the ball's wager. */
export function fmtChange(n: number, compact = false): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const amount = Math.abs(n);
  return sign + (compact ? '$' + (amount < 1000 ? trim(amount, 2) : fmt(amount)) : fmtMoney(amount));
}
