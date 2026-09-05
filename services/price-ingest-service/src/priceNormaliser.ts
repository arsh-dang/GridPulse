import type { PriceUpdated, PriceSource, NemRegion } from "@gridpulse/shared";
import { fromNetworkRegion } from "./nemRegion.js";
import type { OpenElectricityResponse } from "./openElectricitySchema.js";
import { logger } from "./logger.js";

/**
 * Flattens an OpenElectricity response into PriceUpdated events. A single
 * request can contain multiple network-region results and multiple
 * interval data points per result, so this returns an array even though
 * the ingest service currently only ever polls one region at a time.
 *
 * null values (missing intervals) and unrecognised region codes are
 * skipped rather than thrown on: a gap in AEMO's own data shouldn't take
 * the whole poll down.
 */
export function normalisePriceResponse(
  response: OpenElectricityResponse,
  source: PriceSource,
): PriceUpdated[] {
  const events: PriceUpdated[] = [];

  for (const series of response.data) {
    for (const result of series.results) {
      // The API's own "region" column (e.g. "VIC1") — despite the
      // network_region query param name used to request it.
      const networkRegion = result.columns["region"];
      if (typeof networkRegion !== "string") {
        logger.warn("Skipping price result with no region column", {
          columns: result.columns,
        });
        continue;
      }

      const region: NemRegion | undefined = fromNetworkRegion(networkRegion);
      if (!region) {
        logger.warn("Skipping price result for unrecognised region", { networkRegion });
        continue;
      }

      for (const [intervalStart, value] of result.data) {
        if (value === null) continue;

        events.push({
          type: "PriceUpdated",
          region,
          priceAudMwh: value,
          intervalStart,
          source,
        });
      }
    }
  }

  return events;
}
