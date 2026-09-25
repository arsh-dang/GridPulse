import { z } from "zod";

/**
 * Shape of https://api.openelectricity.org.au/v4/market/network/{network_code}
 * for metrics=price. The published docs (and the OpenElectricity TS client's
 * own type defs) disagree with the live API on several points — wrong
 * endpoint path (/data/network vs /market/network), a "network_region"
 * column that's actually called "region", and a top-level "error"/
 * "total_records" pair that a success response omits entirely rather than
 * nulling out. This schema matches a verified live response, not the docs.
 * Validating at runtime means a future API change fails loudly here
 * instead of silently corrupting downstream prices.
 *
 * Each data point is a [timestamp, value] tuple, and value can be null
 * for a missing interval — both are handled explicitly rather than
 * assumed away.
 */
const TimeSeriesDataPointSchema = z.tuple([z.string(), z.number().nullable()]);

const TimeSeriesResultSchema = z.object({
  name: z.string(),
  date_start: z.string(),
  date_end: z.string(),
  columns: z.record(z.union([z.string(), z.boolean()])),
  data: z.array(TimeSeriesDataPointSchema),
});

const NetworkTimeSeriesSchema = z.object({
  network_code: z.string(),
  metric: z.string(),
  unit: z.string(),
  interval: z.string(),
  date_start: z.string(),
  date_end: z.string(),
  groupings: z.array(z.string()),
  results: z.array(TimeSeriesResultSchema),
  network_timezone_offset: z.string(),
});

export const OpenElectricityResponseSchema = z.object({
  version: z.string(),
  created_at: z.string(),
  success: z.boolean(),
  // A live 200 response omits these entirely rather than sending
  // error: null / total_records: 0 — optional here, not just nullable.
  error: z.string().nullable().optional(),
  data: z.array(NetworkTimeSeriesSchema),
  total_records: z.number().optional(),
});

export type OpenElectricityResponse = z.infer<typeof OpenElectricityResponseSchema>;
export type NetworkTimeSeries = z.infer<typeof NetworkTimeSeriesSchema>;
export type TimeSeriesResult = z.infer<typeof TimeSeriesResultSchema>;
