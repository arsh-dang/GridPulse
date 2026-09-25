import { describe, expect, it } from "vitest";
import type { Message } from "@aws-sdk/client-sqs";
import { processBatch, type Stats, type WorkerDeps } from "../src/worker.js";
import type { StoredDecision } from "../src/aws/dispatchStore.js";
import type { RegionPrice } from "../src/policy.js";

function fakeDeps(price: RegionPrice | undefined) {
  const written: StoredDecision[] = [];
  const pricesPut: unknown[] = [];
  const stats: Stats = { received: 0, decisions: 0, prices: 0, invalid: 0, failedBatches: 0 };
  const deps = {
    sqs: {} as WorkerDeps["sqs"],
    prices: {
      get: async () => price,
      put: async (e: unknown) => { pricesPut.push(e); return true; },
    } as unknown as WorkerDeps["prices"],
    dispatch: { putMany: async (d: StoredDecision[]) => { written.push(...d); } } as unknown as WorkerDeps["dispatch"],
    config: {
      awsRegion: "us-east-1", queueUrl: "https://example.com/q", pricesTable: "p", dispatchTable: "d",
      spikeThresholdAudMwh: 300, cheapThresholdAudMwh: 50, reserveSoc: 0.2, fullSoc: 0.95, maxKw: 5,
      priceMaxAgeMs: 15 * 60_000, priceCacheMs: 5000, pollers: 1,
    },
    taskId: "task-a",
    stats,
  } satisfies WorkerDeps;
  return { deps, written, pricesPut, stats };
}

const msg = (body: unknown): Message => ({ Body: typeof body === "string" ? body : JSON.stringify(body) });
const telem = (batteryId: string, soc: number, ts: string) => ({
  type: "BatteryTelemetry", batteryId, region: "VIC", soc, solarKw: 0, loadKw: 1, ts,
});

describe("processBatch", () => {
  it("keeps only the newest reading per battery, since BatchWriteItem rejects duplicate keys", async () => {
    const { deps, written } = fakeDeps({ priceAudMwh: 500, intervalStart: new Date().toISOString() });
    await processBatch(
      [
        msg(telem("b1", 0.5, "2026-09-25T06:00:00.000Z")),
        msg(telem("b1", 0.6, "2026-09-25T06:00:05.000Z")),
        msg(telem("b2", 0.7, "2026-09-25T06:00:00.000Z")),
      ],
      deps,
    );
    expect(written).toHaveLength(2);
    expect(written.find((d) => d.batteryId === "b1")?.soc).toBe(0.6);
    expect(written.every((d) => d.decidedBy === "task-a")).toBe(true);
  });

  it("stores price events and drops invalid messages without failing the batch", async () => {
    const { deps, written, pricesPut, stats } = fakeDeps(undefined);
    await processBatch(
      [
        msg("garbage"),
        msg({ type: "PriceUpdated", region: "VIC", priceAudMwh: 90, intervalStart: "2026-09-25T06:00:00Z", source: "openelectricity-api" }),
      ],
      deps,
    );
    expect(stats.invalid).toBe(1);
    expect(pricesPut).toHaveLength(1);
    expect(written).toHaveLength(0);
  });
});
