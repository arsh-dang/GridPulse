import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import type { BatteryTelemetry, NemRegion } from "@gridpulse/shared";
import type { Config } from "./config.js";
import { parseMessageBody } from "./messages.js";
import { decide, type RegionPrice } from "./policy.js";
import type { PriceStore } from "./aws/priceStore.js";
import type { DispatchStore, StoredDecision } from "./aws/dispatchStore.js";
import { logger } from "./logger.js";

export interface Stats {
  received: number;
  decisions: number;
  prices: number;
  invalid: number;
  failedBatches: number;
}

export interface WorkerDeps {
  sqs: SQSClient;
  prices: PriceStore;
  dispatch: DispatchStore;
  config: Config;
  taskId: string;
  stats: Stats;
}

/**
 * One SQS long-polling loop. A task runs several of these side by side
 * (config.pollers); ECS runs several tasks. Both add throughput, but only
 * tasks add CPU and network, so tasks are what the autoscaler adds.
 */
export async function runWorker(deps: WorkerDeps, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    let messages: Message[] = [];
    try {
      const out = await deps.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: deps.config.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
        }),
        { abortSignal: signal },
      );
      messages = out.Messages ?? [];
    } catch (err) {
      if (signal.aborted) return;
      logger.error("ReceiveMessage failed", { error: errText(err) });
      await sleep(1000);
      continue;
    }
    if (messages.length === 0) continue;

    deps.stats.received += messages.length;
    try {
      await processBatch(messages, deps);
      await deleteBatch(messages, deps);
    } catch (err) {
      // Leave the messages on the queue. They become visible again after the
      // visibility timeout and, after 5 failed receives, move to the DLQ.
      deps.stats.failedBatches++;
      logger.error("Batch failed, messages will be retried", { error: errText(err), count: messages.length });
    }
  }
}

export async function processBatch(messages: Message[], deps: WorkerDeps): Promise<void> {
  const telemetry: BatteryTelemetry[] = [];

  for (const m of messages) {
    const parsed = parseMessageBody(m.Body);
    if (!parsed.ok) {
      deps.stats.invalid++;
      logger.warn("Dropping invalid message", { reason: parsed.reason });
      continue;
    }
    const e = parsed.event;
    if (e.type === "BatteryTelemetry") telemetry.push(e);
    else {
      deps.stats.prices++;
      const stored = await deps.prices.put(e);
      logger.info("Price event", { type: e.type, region: e.region, price: e.priceAudMwh, stored });
    }
  }
  if (telemetry.length === 0) return;

  // One price lookup per region per batch, not per battery.
  const regionPrices = new Map<NemRegion, RegionPrice | undefined>();
  for (const t of telemetry) {
    if (!regionPrices.has(t.region)) regionPrices.set(t.region, await deps.prices.get(t.region));
  }

  // BatchWriteItem rejects duplicate keys, so keep only the newest reading per battery.
  const latest = new Map<string, BatteryTelemetry>();
  for (const t of telemetry) {
    const prev = latest.get(t.batteryId);
    if (!prev || t.ts > prev.ts) latest.set(t.batteryId, t);
  }

  const now = new Date();
  const decisions: StoredDecision[] = [...latest.values()].map((t) => {
    const price = regionPrices.get(t.region);
    return {
      ...decide(t, price, deps.config, now),
      soc: t.soc,
      priceAudMwh: price?.priceAudMwh ?? null,
      decidedBy: deps.taskId,
    };
  });

  await deps.dispatch.putMany(decisions);
  deps.stats.decisions += decisions.length;
}

async function deleteBatch(messages: Message[], deps: WorkerDeps): Promise<void> {
  const entries = messages
    .filter((m) => m.ReceiptHandle)
    .map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle as string }));
  if (entries.length === 0) return;
  const out = await deps.sqs.send(new DeleteMessageBatchCommand({ QueueUrl: deps.config.queueUrl, Entries: entries }));
  if (out.Failed && out.Failed.length > 0) {
    logger.warn("Some deletes failed; those messages may be processed twice", { failed: out.Failed.length });
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
