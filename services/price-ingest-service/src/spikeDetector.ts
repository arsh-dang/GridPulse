import type { PriceUpdated, PriceSpikeDetected } from "@gridpulse/shared";

/**
 * Strictly greater-than: a price exactly at the threshold is not a spike.
 * Matches the spec ("price > SPIKE_THRESHOLD") and keeps the boundary
 * unambiguous for tests.
 */
export function detectSpike(
  priceUpdated: PriceUpdated,
  thresholdAudMwh: number,
): PriceSpikeDetected | null {
  if (priceUpdated.priceAudMwh <= thresholdAudMwh) return null;

  return {
    type: "PriceSpikeDetected",
    region: priceUpdated.region,
    priceAudMwh: priceUpdated.priceAudMwh,
    thresholdAudMwh,
    intervalStart: priceUpdated.intervalStart,
    source: priceUpdated.source,
  };
}
