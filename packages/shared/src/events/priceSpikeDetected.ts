import { z } from "zod";
import { NemRegionSchema } from "../region.js";
import { PriceSourceSchema } from "./priceUpdated.js";

/**
 * Emitted alongside PriceUpdated only when priceAudMwh exceeds the
 * configured threshold. Carries the threshold that was in effect at
 * detection time, so downstream consumers don't need to know the
 * ingest service's config to make sense of the event.
 */
export const PriceSpikeDetectedSchema = z.object({
  type: z.literal("PriceSpikeDetected"),
  region: NemRegionSchema,
  priceAudMwh: z.number(),
  thresholdAudMwh: z.number(),
  intervalStart: z.string().datetime({ offset: true }),
  source: PriceSourceSchema,
});
export type PriceSpikeDetected = z.infer<typeof PriceSpikeDetectedSchema>;
