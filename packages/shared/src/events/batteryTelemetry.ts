import { z } from "zod";
import { NemRegionSchema } from "../region.js";

/**
 * Telemetry published by each simulated home battery. soc is a 0-1
 * fraction (not a percentage) to match standard energy-modelling
 * convention and avoid off-by-100 bugs downstream.
 */
export const BatteryTelemetrySchema = z.object({
  type: z.literal("BatteryTelemetry"),
  batteryId: z.string(),
  region: NemRegionSchema,
  soc: z.number().min(0).max(1),
  solarKw: z.number(),
  loadKw: z.number(),
  ts: z.string().datetime({ offset: true }),
});
export type BatteryTelemetry = z.infer<typeof BatteryTelemetrySchema>;
