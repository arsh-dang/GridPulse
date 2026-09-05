import type { NemRegion } from "@gridpulse/shared";
import { OpenElectricityClient } from "./openElectricityClient.js";
import { normalisePriceResponse } from "./priceNormaliser.js";
import { detectSpike } from "./spikeDetector.js";
import { CsvPriceReplay } from "./csvFallback.js";
import type { EventPublisher } from "./publishers/EventPublisher.js";
import { logger } from "./logger.js";

export interface PollerOptions {
  region: NemRegion;
  spikeThresholdAudMwh: number;
  pollIntervalMs: number;
  client: OpenElectricityClient;
  publisher: EventPublisher;
  csvFallback: CsvPriceReplay;
}

/**
 * Drives one poll cycle: try the live API, fall back to replaying the
 * historical CSV if it's unreachable, then normalise + detect + publish.
 * Never throws — a bad cycle is logged and the service tries again next
 * interval, since a single failed poll shouldn't take the process down.
 */
export async function runPollCycle(options: PollerOptions): Promise<void> {
  const { region, spikeThresholdAudMwh, client, publisher, csvFallback } = options;

  try {
    const priceEvents = await fetchPriceEvents(client, csvFallback, region);

    for (const priceEvent of priceEvents) {
      await publisher.publishPriceUpdated(priceEvent);

      const spike = detectSpike(priceEvent, spikeThresholdAudMwh);
      if (spike) {
        logger.info("Price spike detected", { region: spike.region, price: spike.priceAudMwh });
        await publisher.publishPriceSpikeDetected(spike);
      }
    }
  } catch (err) {
    logger.error("Poll cycle failed unexpectedly", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function fetchPriceEvents(
  client: OpenElectricityClient,
  csvFallback: CsvPriceReplay,
  region: NemRegion,
) {
  try {
    const response = await client.fetchLatestPrice(region);
    return normalisePriceResponse(response, "openelectricity-api");
  } catch (err) {
    logger.warn("OpenElectricity API unreachable, falling back to historical CSV replay", {
      error: err instanceof Error ? err.message : String(err),
    });
    const fallbackEvent = csvFallback.next(region);
    return fallbackEvent ? [fallbackEvent] : [];
  }
}

/**
 * Runs runPollCycle immediately and then on a fixed interval. Returns a
 * stop function rather than the interval handle directly, so callers
 * don't need to know it's a setInterval under the hood.
 */
export function startPolling(options: PollerOptions): () => void {
  void runPollCycle(options);
  const handle = setInterval(() => void runPollCycle(options), options.pollIntervalMs);
  return () => clearInterval(handle);
}
