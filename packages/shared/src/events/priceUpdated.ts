import { z } from "zod";
import { NemRegionSchema } from "../region.js";

/**
 * Where a price reading came from. Consumers (e.g. dispatch-optimizer) may
 * want to weight or log simulated data differently from live market data.
 */
export const PriceSourceSchema = z.enum([
  "openelectricity-api",
  "csv-fallback",
  "simulator",
]);
export type PriceSource = z.infer<typeof PriceSourceSchema>;

/**
 * Emitted for every 5-minute NEM dispatch interval, spike or not. This is
 * the normalised, service-agnostic shape — nothing about OpenElectricity's
 * specific response format leaks past the ingest service's own boundary.
 */
export const PriceUpdatedSchema = z.object({
  type: z.literal("PriceUpdated"),
  region: NemRegionSchema,
  priceAudMwh: z.number(),
  intervalStart: z.string().datetime({ offset: true }),
  source: PriceSourceSchema,
});
export type PriceUpdated = z.infer<typeof PriceUpdatedSchema>;
