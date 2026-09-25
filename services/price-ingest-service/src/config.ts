import { z } from "zod";
import { NemRegionSchema } from "@gridpulse/shared";

/**
 * All config validated once at startup, with defaults applied here rather
 * than scattered through the codebase. A bad env var fails fast at boot
 * instead of surfacing as a confusing runtime error mid-poll.
 */
const ConfigSchema = z.object({
  openElectricityApiKey: z.string().min(1, "OPENELECTRICITY_API_KEY is required"),
  openElectricityBaseUrl: z.string().url().default("https://api.openelectricity.org.au/v4"),
  region: NemRegionSchema.default("VIC"),
  spikeThresholdAudMwh: z.coerce.number().default(300),
  pollIntervalMs: z.coerce.number().int().positive().default(300_000),
  csvFallbackPath: z.string().default("./data/historical-prices.csv"),
  mqttUrl: z.string().default("mqtt://localhost:1883"),
  // AWS IoT Core authenticates devices with X.509 certificates over TLS.
  // All three paths set = mutual TLS; none set = plain local broker.
  mqttClientId: z.string().optional(),
  mqttCaPath: z.string().optional(),
  mqttCertPath: z.string().optional(),
  mqttKeyPath: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse({
    openElectricityApiKey: env.OPENELECTRICITY_API_KEY,
    openElectricityBaseUrl: env.OPENELECTRICITY_BASE_URL,
    region: env.REGION,
    spikeThresholdAudMwh: env.SPIKE_THRESHOLD,
    pollIntervalMs: env.POLL_INTERVAL_MS,
    csvFallbackPath: env.CSV_FALLBACK_PATH,
    mqttUrl: env.MQTT_URL,
    mqttClientId: env.MQTT_CLIENT_ID,
    mqttCaPath: env.MQTT_CA_PATH,
    mqttCertPath: env.MQTT_CERT_PATH,
    mqttKeyPath: env.MQTT_KEY_PATH,
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }

  return result.data;
}
