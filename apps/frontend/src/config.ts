export const PRICE_RUB = 1490;

export function formatPriceRub(): string {
  return `${PRICE_RUB.toLocaleString('ru-RU')} ₽/мес`;
}
