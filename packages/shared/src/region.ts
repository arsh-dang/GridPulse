import { z } from "zod";

/**
 * NEM regions GridPulse operates in. Kept short (VIC, not VIC1) at the
 * event-contract level; NEM's "VIC1"-style region-ID suffixes are an
 * AEMO/API-specific concern and get mapped at the service boundary that
 * talks to that API, not baked into the shared contract.
 */
export const NemRegionSchema = z.enum(["NSW", "QLD", "SA", "TAS", "VIC"]);
export type NemRegion = z.infer<typeof NemRegionSchema>;
