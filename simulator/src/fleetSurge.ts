import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { MqttClient } from "mqtt";
import {
  BatteryTelemetrySchema,
  NemRegionSchema,
  decide,
  type BatteryTelemetry,
  type PolicyConfig,
  type PriceSpikeDetected,
  type PriceUpdated,
} from "@gridpulse/shared";
import { connectMqtt } from "./mqttClient.js";
import { Fleet } from "./fleet/fleetModel.js";
import { mulberry32 } from "./fleet/rng.js";
import { ReportingPolicy, type PriceClass, type ReportingMode, type Trigger } from "./edge/reportingPolicy.js";

/**
 * Fleet surge: load generator for the scaling experiments.
 *
 * Simulates a battery fleet behind an edge gateway. Every battery is sampled
 * in turn at SAMPLE_RATE samples per second (so each battery is sampled every
 * BATTERIES / SAMPLE_RATE seconds). The gateway's reporting policy decides
 * which samples are published to AWS IoT Core:
 *
 *   EDGE_MODE=periodic   publish every sample (the 6.3D baseline)
 *   EDGE_MODE=sod        send-on-delta with a heartbeat
 *   EDGE_MODE=sod-aware  send-on-delta + price-class flush + SoC boundary triggers
 *
 * Published messages go through a per-connection token bucket, because AWS
 * IoT Core allows 100 publishes per second per connection. A price-class
 * flush therefore drains at the gateway's publish capacity, as it would on
 * real hardware.
 *
 * Scenario: normal price ($120/MWh) until SPIKE_AT_S, then a $450/MWh spike,
 * re-announced every minute, until the run ends.
 */
const TRANSPORT = (process.env.TRANSPORT ?? "iot") as "iot" | "sqs";
const REGION = NemRegionSchema.parse(process.env.REGION ?? "VIC");
const BATTERIES = Number(process.env.BATTERIES ?? 5000);
const SAMPLE_RATE = Number(process.env.SAMPLE_RATE ?? process.env.RATE ?? 800);
const DURATION_S = Number(process.env.DURATION_S ?? 600);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 12);
const PER_CONNECTION_LIMIT = Number(process.env.PER_CONNECTION_LIMIT ?? 90);
const EDGE_MODE = (process.env.EDGE_MODE ?? "periodic") as ReportingMode;
const DELTA = Number(process.env.DELTA ?? 0.01);
const HEARTBEAT_S = Number(process.env.HEARTBEAT_S ?? 120);
const SPIKE_AT_S = Number(process.env.SPIKE_AT_S ?? 0);
const NORMAL_PRICE = 120;
const SPIKE_PRICE = Number(process.env.SPIKE_PRICE ?? 450);
const TICK_MS = 100;

const POLICY: PolicyConfig = {
  spikeThresholdAudMwh: Number(process.env.SPIKE_THRESHOLD ?? 300),
  cheapThresholdAudMwh: 50,
  reserveSoc: 0.2,
  fullSoc: 0.95,
  maxKw: 5,
  priceMaxAgeMs: 15 * 60_000,
};

interface Outgoing {
  topic: string;
  payload: object;
}

interface Sink {
  /** Messages this sink can accept in one tick. */
  capacityPerTick(): number;
  send(batch: Outgoing[]): Promise<void>;
  close(): Promise<void>;
}

async function iotSink(): Promise<Sink> {
  const run = Math.random().toString(36).slice(2, 6);
  const clients: MqttClient[] = await Promise.all(
    Array.from({ length: CONNECTIONS }, (_, i) => connectMqtt(`gridpulse-surge-${run}-${i}`)),
  );
  console.log(`Connected ${clients.length} MQTT connections to ${process.env.MQTT_URL}`);
  let next = 0;
  return {
    capacityPerTick: () => Math.floor((CONNECTIONS * PER_CONNECTION_LIMIT * TICK_MS) / 1000),
    async send(batch) {
      for (const m of batch) clients[next++ % clients.length]?.publish(m.topic, JSON.stringify(m.payload), { qos: 0 });
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
    capacityPerTick: () => 400,
    async send(batch) {
      const chunks: Outgoing[][] = [];
      for (let i = 0; i < batch.length; i += 10) chunks.push(batch.slice(i, i + 10));
      await Promise.all(chunks.map((c) => sqs.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: c.map((m, i) => ({ Id: String(i), MessageBody: JSON.stringify(m.payload) })),
      }))));
    },
    async close() {
      sqs.destroy();
    },
  };
}

function priceEvents(price: number): Outgoing[] {
  const intervalStart = new Date().toISOString();
  const updated: PriceUpdated = { type: "PriceUpdated", region: REGION, priceAudMwh: price, intervalStart, source: "simulator" };
  const out: Outgoing[] = [{ topic: `gridpulse/price/${REGION}`, payload: updated }];
  if (price >= POLICY.spikeThresholdAudMwh) {
    const spike: PriceSpikeDetected = {
      type: "PriceSpikeDetected", region: REGION, priceAudMwh: price,
      thresholdAudMwh: POLICY.spikeThresholdAudMwh, intervalStart, source: "simulator",
    };
    out.push({ topic: `gridpulse/spike/${REGION}`, payload: spike });
  }
  return out;
}

function classOf(p: number): PriceClass {
  return p >= POLICY.spikeThresholdAudMwh ? "spike" : p <= POLICY.cheapThresholdAudMwh ? "cheap" : "normal";
}

async function main(): Promise<void> {
  const sink = TRANSPORT === "sqs" ? sqsSink() : await iotSink();
  const fleet = new Fleet({ size: BATTERIES, region: REGION, seed: 42 });
  const ids = fleet.batteries.map((b) => b.id);
  const gateway = new ReportingPolicy({ mode: EDGE_MODE, delta: DELTA, heartbeatS: HEARTBEAT_S, boundaries: [POLICY.reserveSoc, POLICY.fullSoc] });
  const samplePeriodS = BATTERIES / SAMPLE_RATE;

  // Spread heartbeats across the fleet, as on a gateway that has been running for a while.
  const phase = mulberry32(7);
  const lastSampleS = new Float64Array(BATTERIES);
  fleet.batteries.forEach((b, i) => {
    gateway.prime(b.id, b.soc, -Math.floor(phase() * HEARTBEAT_S));
    lastSampleS[i] = -samplePeriodS;
  });

  console.log(
    `Fleet surge: ${BATTERIES} batteries in ${REGION}, ${SAMPLE_RATE} samples/s (each battery every ${samplePeriodS.toFixed(2)}s), ` +
      `${DURATION_S}s via ${TRANSPORT}, edge mode ${EDGE_MODE}` +
      (EDGE_MODE === "periodic" ? "" : ` (delta ${DELTA * 100}%, heartbeat ${HEARTBEAT_S}s)`) +
      `, spike $${SPIKE_PRICE}/MWh at t=${SPIKE_AT_S}s, gateway capacity ${sink.capacityPerTick() * (1000 / TICK_MS)} msg/s`,
  );

  const startedAt = Date.now();
  const elapsedS = (): number => (Date.now() - startedAt) / 1000;
  let price = SPIKE_AT_S > 0 ? NORMAL_PRICE : SPIKE_PRICE;
  const outbox: Outgoing[] = [...priceEvents(price)];
  gateway.onPrice(classOf(price), ids);

  const announce = setInterval(() => outbox.unshift(...priceEvents(price)), 60_000);
  const spikeTimer = SPIKE_AT_S > 0 ? setTimeout(() => {
    price = SPIKE_PRICE;
    outbox.unshift(...priceEvents(price));   // price events go out first
    gateway.onPrice(classOf(price), ids);   // sod-aware: every battery reports on its next sample
    console.log(`t=${elapsedS().toFixed(0)}s  price spike to $${price}/MWh announced`);
  }, SPIKE_AT_S * 1000) : undefined;

  let sampled = 0, published = 0, errors = 0, cursor = 0, carry = 0;
  let lastSampled = 0, lastPublished = 0;
  let sending = false;

  const tick = setInterval(() => {
    const now = elapsedS();
    const hour = 17.5 + now / 3600;
    const priceState = { priceAudMwh: price, intervalStart: new Date().toISOString() };

    // 1. Sample the fleet and let the gateway filter.
    carry += (SAMPLE_RATE * TICK_MS) / 1000;
    const n = Math.floor(carry);
    carry -= n;
    for (let k = 0; k < n; k++) {
      const i = cursor++ % BATTERIES;
      const b = fleet.batteries[i]!;
      fleet.step(b, Math.max(0, now - lastSampleS[i]!), hour, POLICY.reserveSoc);
      lastSampleS[i] = now;
      sampled++;
      if (!gateway.decide(b.id, b.soc, now)) continue;

      const telemetry = BatteryTelemetrySchema.parse({
        type: "BatteryTelemetry", batteryId: b.id, region: REGION,
        soc: Number(b.soc.toFixed(4)), solarKw: 0, loadKw: Number(b.baseLoadKw.toFixed(2)),
        ts: new Date().toISOString(),
      });
      outbox.push({ topic: `gridpulse/${REGION}/${b.id}/telemetry`, payload: telemetry });

      // The battery acts on the same decision the cloud will make for this reading.
      const d = decide(telemetry, priceState, POLICY, new Date());
      b.command = { action: d.action, targetKw: d.targetKw ?? 0 };
    }

    // 2. Publish within the gateway's rate limit.
    if (sending || outbox.length === 0) return;
    const batch = outbox.splice(0, sink.capacityPerTick());
    sending = true;
    sink.send(batch)
      .then(() => { published += batch.length; })
      .catch((err) => { errors += batch.length; console.error("send failed:", err instanceof Error ? err.message : err); })
      .finally(() => { sending = false; });
  }, TICK_MS);

  const report = setInterval(() => {
    const s = sampled - lastSampled, p = published - lastPublished;
    lastSampled = sampled; lastPublished = published;
    console.log(
      `t=${String(Math.round(elapsedS())).padStart(4)}s  sampled=${sampled} published=${published} ` +
        `rate=${Math.round(p / 5)}/s of ${Math.round(s / 5)}/s sampled  suppressed=${((1 - published / Math.max(1, sampled)) * 100).toFixed(1)}%  ` +
        `outbox=${outbox.length}  errors=${errors}`,
    );
  }, 5000);

  const stop = async (): Promise<void> => {
    clearInterval(tick); clearInterval(announce); clearInterval(report);
    if (spikeTimer) clearTimeout(spikeTimer);
    await new Promise((r) => setTimeout(r, 1000));
    await sink.close();
    const counts = Object.entries(gateway.counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(
      `Done: ${sampled} samples, ${published} messages published (${((1 - published / Math.max(1, sampled)) * 100).toFixed(1)}% suppressed), ` +
        `${errors} errors, ${Math.round(elapsedS())}s. Triggers: ${counts || "n/a"}`,
    );
    process.exit(0);
  };
  setTimeout(() => void stop(), DURATION_S * 1000);
  process.once("SIGINT", () => void stop());
}

main().catch((err) => {
  console.error("fleetSurge failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

export type { Trigger };
