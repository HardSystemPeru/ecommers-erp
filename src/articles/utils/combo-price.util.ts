/**
 * Precio efectivo único para combos.
 *
 * Regla (misma que ve el cliente en la ficha del artículo suelto):
 *   1. `precio_final` (override manual, ej. 183) si está seteado.
 *   2. Si no, `public_price` con oferta aplicada cuando `has_offer` / `offer_price_percent > 0`.
 *   3. Si no, `public_price`.
 *
 * Todo en moneda nativa del artículo; la conversión se hace una sola vez
 * y el redondeo a 2 decimales se aplica SOLO al total final (no por línea),
 * para que el total del combo siempre cuadre con la suma de sus items.
 */

export interface ComboArticleLike {
  public_price?: unknown;
  precio_final?: unknown;
  offer_price_percent?: unknown;
  has_offer?: unknown;
  currency_type_id?: unknown;
}

export interface ComboDetailLike {
  quantity?: unknown;
  articles: ComboArticleLike;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Precio unitario efectivo en moneda nativa del artículo. Null si no hay precio. */
export function getEffectiveNativePrice(art: ComboArticleLike): number | null {
  const manual = toNumberOrNull(art?.precio_final);
  if (manual !== null) return manual;

  const pub = toNumberOrNull(art?.public_price);
  if (pub === null) return null;

  const offerPct = Number(art?.offer_price_percent || 0);
  const hasOffer = art?.has_offer === true || art?.has_offer === 1 || offerPct > 0;
  if (hasOffer && offerPct > 0) return pub * (1 - offerPct / 100);

  return pub;
}

function convertNativeToSoles(native: number, currencyStr: string | undefined, dollarRate: number): number | null {
  if (currencyStr === '1') return native;
  if (dollarRate > 0) return native * dollarRate;
  return null; // sin tipo de cambio no se puede convertir: null honesto, no 0
}

function convertNativeToDolares(native: number, currencyStr: string | undefined, dollarRate: number): number | null {
  if (currencyStr === '2') return native;
  if (dollarRate > 0) return native / dollarRate;
  return null;
}

const round2 = (n: number): number => Number(n.toFixed(2));

export interface ComboLinePrice {
  /** Precio unitario efectivo en moneda nativa. */
  effective_price: number | null;
  effective_price_soles: number | null;
  effective_price_dolares: number | null;
}

export function priceComboLine(art: ComboArticleLike, dollarRate: number): ComboLinePrice {
  const effective = getEffectiveNativePrice(art);
  if (effective === null) {
    return { effective_price: null, effective_price_soles: null, effective_price_dolares: null };
  }
  const currencyStr = art?.currency_type_id?.toString();
  const soles = convertNativeToSoles(effective, currencyStr, dollarRate);
  const dolares = convertNativeToDolares(effective, currencyStr, dollarRate);
  return {
    effective_price: effective,
    effective_price_soles: soles !== null ? round2(soles) : null,
    effective_price_dolares: dolares !== null ? round2(dolares) : null,
  };
}

export interface ComboTotals {
  /** Total en dólares (redondeado una sola vez). Null si no se puede calcular. */
  total_price: number | null;
  /** Total en soles (redondeado una sola vez). Null si no se puede calcular. */
  total_price_soles: number | null;
}

/**
 * Suma SIN redondeo por línea; redondea solo el total final.
 * Si alguna línea no se puede convertir a una moneda, ese total es null
 * (antes devolvía una suma parcial silenciosa o el fósil `combo.total_price`).
 * Solo cuando el combo no tiene detalles se permite el fallback legacy.
 */
export function calcComboTotals(
  details: ComboDetailLike[],
  dollarRate: number,
  legacyTotalPrice?: unknown,
): ComboTotals {
  if (!details || details.length === 0) {
    return { total_price: toNumberOrNull(legacyTotalPrice), total_price_soles: toNumberOrNull(legacyTotalPrice) };
  }

  let accDolares = 0;
  let accSoles = 0;
  let countDolares = 0;
  let countSoles = 0;
  let failDolares = false;
  let failSoles = false;

  for (const detail of details) {
    const qty = Number(detail?.quantity || 0);
    if (!(qty > 0)) continue;
    const effective = getEffectiveNativePrice(detail.articles);
    if (effective === null) continue; // línea sin precio: se omite
    const currencyStr = detail.articles?.currency_type_id?.toString();
    const soles = convertNativeToSoles(effective, currencyStr, dollarRate);
    const dolares = convertNativeToDolares(effective, currencyStr, dollarRate);
    if (soles === null) failSoles = true;
    else {
      accSoles += soles * qty;
      countSoles++;
    }
    if (dolares === null) failDolares = true;
    else {
      accDolares += dolares * qty;
      countDolares++;
    }
  }

  return {
    total_price: !failDolares && countDolares > 0 ? round2(accDolares) : null,
    total_price_soles: !failSoles && countSoles > 0 ? round2(accSoles) : null,
  };
}
