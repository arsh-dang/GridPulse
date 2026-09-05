import { loadConfig } from "./config.js";
import { OpenElectricityClient } from "./openElectricityClient.js";
import { CsvPriceReplay } from "./csvFallback.js";
import { MqttEventPublisher } from "./publishers/MqttEventPublisher.js";
import { startPolling } from "./poller.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const client = new OpenElectricityClient({
    baseUrl: config.openElectricityBaseUrl,
    apiKey: config.openElectricityApiKey,
  });

  const csvFallback = CsvPriceReplay.fromFile(config.csvFallbackPath);

  const publisher = new MqttEventPublisher(config.mqttUrl);
  await publisher.connect();

  const stopPolling = startPolling({
    region: config.region,
    spikeThresholdAudMwh: config.spikeThresholdAudMwh,
    pollIntervalMs: config.pollIntervalMs,
    client,
    publisher,
    csvFallback,
  });

  logger.info("price-ingest-service started", {
    region: config.region,
    pollIntervalMs: config.pollIntervalMs,
    spikeThresholdAudMwh: config.spikeThresholdAudMwh,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Shutting down", { signal });
    stopPolling();
    await publisher.disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("price-ingest-service failed to start", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
