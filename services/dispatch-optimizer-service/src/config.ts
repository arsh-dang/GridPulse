import { z } from "zod";

/**
 * Validated once at startup, like price-ingest-service. On ECS these come
 * from the task definition's environment block, so a typo in the task
 * definition fails the task at boot with a clear message.
 */
const ConfigSchema = z.object({
  awsRegion: z.string().default("us-east-1"),
  queueUrl: z.string().url("QUEUE_URL is required"),
  pricesTable: z.string().default("gridpulse-prices"),
  dispatchTable: z.string().default("gridpulse-dispatch"),
  /** At or above this price the fleet discharges into the spike. */
  spikeThresholdAudMwh: z.coerce.number().default(300),
  /** At or below this price the fleet charges from the grid. */
  cheapThresholdAudMwh: z.coerce.number().default(50),
  /** Never discharge a battery below this state of charge. */
  reserveSoc: z.coerce.number().min(0).max(1).default(0.2),
  /** Stop charging at this state of charge. */
  fullSoc: z.coerce.number().min(0).max(1).default(0.95),
  /** Inverter limit of a home battery, in kW. */
  maxKw: z.coerce.number().positive().default(5),
  /** A price older than this is treated as unknown. */
  priceMaxAgeMs: z.coerce.number().int().positive().default(15 * 60_000),
  /** How long a task trusts its cached copy of the regional price. */
  priceCacheMs: z.coerce.number().int().nonnegative().default(5_000),
  /** Concurrent SQS receive loops inside one task. */
  pollers: z.coerce.number().int().min(1).max(20).default(2),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse({
    awsRegion: env.AWS_REGION,
    queueUrl: env.QUEUE_URL,
    pricesTable: env.PRICES_TABLE,
    dispatchTable: env.DISPATCH_TABLE,
    spikeThresholdAudMwh: env.SPIKE_THRESHOLD,
    cheapThresholdAudMwh: env.CHEAP_THRESHOLD,
    reserveSoc: env.RESERVE_SOC,
    fullSoc: env.FULL_SOC,
    maxKw: env.MAX_KW,
    priceMaxAgeMs: env.PRICE_MAX_AGE_MS,
    priceCacheMs: env.PRICE_CACHE_MS,
    pollers: env.POLLERS,
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return result.data;
}
