import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { MqttClient } from "mqtt";
import {
  BatteryTelemetrySchema,
  NemRegionSchema,
  type BatteryTelemetry,
  type PriceSpikeDetected,
  type PriceUpdated,
} from "@gridpulse/shared";
import { connectMqtt } from "./mqttClient.js";

/**
 * Load generator for the autoscaling demonstration.
 *
 * Simulates a large battery fleet reporting through AWS IoT Core during a
 * price spike. Every battery publishes the same BatteryTelemetry contract as
 * batteryNode.ts, on the same topic layout, so the cloud side cannot tell it
 * apart from real devices. The only difference is volume.
 *
 * AWS IoT Core allows 100 publishes per second per connection, so the fleet
 * is spread across several connections, the way many gateways would be.
 *
 *   TRANSPORT=iot  publish over MQTT to IoT Core (default, the real path)
 *   TRANSPORT=sqs  send straight to the SQS queue (fallback if the IoT rule
 *                  cannot be created in the Learner Lab)
 */
const TRANSPORT = (process.env.TRANSPORT ?? "iot") as "iot" | "sqs";
const REGION = NemRegionSchema.parse(process.env.REGION ?? "VIC");
const BATTERIES = Number(process.env.BATTERIES ?? 5000);
const RATE = Number(process.env.RATE ?? 400); // telemetry messages per second, whole fleet
const DURATION_S = Number(process.env.DURATION_S ?? 600);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 8);
const SPIKE_PRICE = Number(process.env.SPIKE_PRICE ?? 450);
const SPIKE_THRESHOLD = Number(process.env.SPIKE_THRESHOLD ?? 300);
const IOT_PER_CONNECTION_LIMIT = 100;
const TICK_MS = 100;

interface Sink {
  send(topic: string, payloads: object[]): Promise<void>;
  close(): Promise<void>;
}

async function iotSink(): Promise<Sink> {
  const perConnection = RATE / CONNECTIONS;
  if (perConnection > IOT_PER_CONNECTION_LIMIT * 0.9) {
    throw new Error(
      `RATE ${RATE} over ${CONNECTIONS} connections is ${perConnection.toFixed(0)}/s each; ` +
        `IoT Core allows ${IOT_PER_CONNECTION_LIMIT}/s per connection. Raise CONNECTIONS.`,
    );
  }
  const run = Math.random().toString(36).slice(2, 6);
  const clients: MqttClient[] = await Promise.all(
    Array.from({ length: CONNECTIONS }, (_, i) => connectMqtt(`gridpulse-surge-${run}-${i}`)),
  );
  console.log(`Connected ${clients.length} MQTT connections to ${process.env.MQTT_URL}`);
  let next = 0;
  return {
    async send(topic, payloads) {
      for (const p of payloads) {
        const client = clients[next++ % clients.length];
        client?.publish(topic.replace("{id}", (p as BatteryTelemetry).batteryId ?? ""), JSON.stringify(p), { qos: 0 });
      }
    },
    async close() {
      await Promise.all(clients.map((c) => c.endAsync()));
    },
  };
}

function sqsSink(): Sink {
  const queueUrl = process.env.QUEUE_URL;
  if (!queueUrl) throw new Error("TRANSPORT=sqs needs QUEUE_URL");
  const sqs = new SQSClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  return {
    async send(_topic, payloads) {
      const batches: object[][] = [];
      for (let i = 0; i < payloads.length; i += 10) batches.push(payloads.slice(i, i + 10));
      await Promise.all(
        batches.map((b) =>
          sqs.send(
            new SendMessageBatchCommand({
              QueueUrl: queueUrl,
              Entries: b.map((p, i) => ({ Id: String(i), MessageBody: JSON.stringify(p) })),
            }),
          ),
        ),
      );
    },
    async close() {
      sqs.destroy();
    },
  };
}

function spikeEvents(): [PriceUpdated, PriceSpikeDetected] {
  const intervalStart = new Date().toISOString();
  return [
    { type: "PriceUpdated", region: REGION, priceAudMwh: SPIKE_PRICE, intervalStart, source: "simulator" },
    {
      type: "PriceSpikeDetected",
      region: REGION,
      priceAudMwh: SPIKE_PRICE,
      thresholdAudMwh: SPIKE_THRESHOLD,
      intervalStart,
      source: "simulator",
    },
  ];
}

async function main(): Promise<void> {
  const sink = TRANSPORT === "sqs" ? sqsSink() : await iotSink();
  const socs = Array.from({ length: BATTERIES }, () => 0.4 + Math.random() * 0.5);

  console.log(
    `Fleet surge: ${BATTERIES} batteries in ${REGION}, ${RATE} msg/s for ${DURATION_S}s via ${TRANSPORT}, ` +
      `simulated spike $${SPIKE_PRICE}/MWh`,
  );

  // Announce the spike, and repeat it every minute so the optimiser keeps a
  // fresh price for the whole run.
  const announce = async (): Promise<void> => {
    const [updated, spike] = spikeEvents();
    await sink.send(`gridpulse/price/${REGION}`, [updated]);
    await sink.send(`gridpulse/spike/${REGION}`, [spike]);
  };
  await announce();
  const spikeTimer = setInterval(() => void announce(), 60_000);

  let sent = 0;
  let errors = 0;
  let cursor = 0;
  let carry = 0;
  let lastSent = 0;
  const startedAt = Date.now();

  const tick = setInterval(() => {
    carry += (RATE * TICK_MS) / 1000;
    const n = Math.floor(carry);
    carry -= n;
    const batch: BatteryTelemetry[] = [];
    for (let i = 0; i < n; i++) {
      const idx = cursor++ % BATTERIES;
      const soc = Math.min(1, Math.max(0, (socs[idx] ?? 0.5) - Math.random() * 0.004));
      socs[idx] = soc;
      batch.push(
        BatteryTelemetrySchema.parse({
          type: "BatteryTelemetry",
          batteryId: `battery-${REGION.toLowerCase()}-${idx + 1}`,
          region: REGION,
          soc: Number(soc.toFixed(4)),
          solarKw: 0,
          loadKw: Number((0.5 + Math.random() * 2.5).toFixed(2)),
          ts: new Date().toISOString(),
        }),
      );
    }
    sink
      .send(`gridpulse/${REGION}/{id}/telemetry`, batch)
      .then(() => { sent += batch.length; })
      .catch((err) => {
        errors += batch.length;
        console.error("send failed:", err instanceof Error ? err.message : err);
      });
  }, TICK_MS);

  const report = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`t=${String(elapsed).padStart(4)}s  sent=${sent}  rate=${Math.round((sent - lastSent) / 5)}/s  errors=${errors}`);
    lastSent = sent;
  }, 5000);

  const stop = async (): Promise<void> => {
    clearInterval(tick);
    clearInterval(spikeTimer);
    clearInterval(report);
    await new Promise((r) => setTimeout(r, 1000));
    await sink.close();
    console.log(`Done: ${sent} telemetry messages sent, ${errors} errors, ${Math.round((Date.now() - startedAt) / 1000)}s`);
    process.exit(0);
  };
  setTimeout(() => void stop(), DURATION_S * 1000);
  process.once("SIGINT", () => void stop());
}

main().catch((err) => {
  console.error("fleetSurge failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
