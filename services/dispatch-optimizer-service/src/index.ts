import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { loadConfig } from "./config.js";
import { PriceStore } from "./aws/priceStore.js";
import { DispatchStore } from "./aws/dispatchStore.js";
import { resolveTaskId } from "./aws/taskId.js";
import { runWorker, type Stats } from "./worker.js";
import { logger } from "./logger.js";

const STATS_INTERVAL_MS = 15_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const taskId = await resolveTaskId();

  const sqs = new SQSClient({ region: config.awsRegion });
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.awsRegion }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const stats: Stats = { received: 0, decisions: 0, prices: 0, invalid: 0, failedBatches: 0 };
  const deps = {
    sqs,
    prices: new PriceStore(db, config.pricesTable, config.priceCacheMs),
    dispatch: new DispatchStore(db, config.dispatchTable),
    config,
    taskId,
    stats,
  };

  const controller = new AbortController();
  logger.info("dispatch-optimizer-service started", {
    taskId,
    pollers: config.pollers,
    queueUrl: config.queueUrl,
    spikeThresholdAudMwh: config.spikeThresholdAudMwh,
  });

  // Throughput line every 15s: the per-task view of the scaling demo.
  let lastReceived = 0;
  const statsTimer = setInterval(() => {
    const rate = (stats.received - lastReceived) / (STATS_INTERVAL_MS / 1000);
    lastReceived = stats.received;
    logger.info("stats", { taskId, ...stats, msgPerSec: Math.round(rate) });
  }, STATS_INTERVAL_MS);

  const workers = Array.from({ length: config.pollers }, () => runWorker(deps, controller.signal));

  // ECS sends SIGTERM when scaling in. Stop receiving, let in-flight batches finish.
  const shutdown = (signal: string): void => {
    logger.info("Shutting down", { signal, taskId, ...stats });
    controller.abort();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  await Promise.all(workers);
  clearInterval(statsTimer);
  logger.info("dispatch-optimizer-service stopped", { taskId, ...stats });
}

main().catch((err) => {
  logger.error("dispatch-optimizer-service failed to start", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
