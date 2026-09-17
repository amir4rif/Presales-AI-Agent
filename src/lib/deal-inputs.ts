export function normalizeDealValueInput(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.replace(/^0+(?=\d)/, '');
}

export function formatDealValueInput(value: string) {
  const digits = normalizeDealValueInput(value);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function dealValueNumber(value: string) {
  const digits = normalizeDealValueInput(value);
  if (!digits) return Number.NaN;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) ? amount : Number.NaN;
}
