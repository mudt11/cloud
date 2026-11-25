const vndFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  currencyDisplay: 'code',
  maximumFractionDigits: 0,
});

export function formatVnd(amount: string) {
  return vndFormatter.format(BigInt(amount));
}
