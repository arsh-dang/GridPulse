import { describe, expect, it } from "vitest";
import type { BatteryTelemetry } from "@gridpulse/shared";
import { decide, type PolicyConfig } from "../src/policy.js";

const config: PolicyConfig = {
  spikeThresholdAudMwh: 300,
  cheapThresholdAudMwh: 50,
  reserveSoc: 0.2,
  fullSoc: 0.95,
  maxKw: 5,
  priceMaxAgeMs: 15 * 60_000,
};
const now = new Date("2026-09-25T06:00:00Z");
const fresh = "2026-09-25T05:55:00Z";

function battery(soc: number): BatteryTelemetry {
  return {
    type: "BatteryTelemetry",
    batteryId: "battery-vic-1",
    region: "VIC",
    soc,
    solarKw: 0,
    loadKw: 1,
    ts: now.toISOString(),
  };
}

describe("decide", () => {
  it("holds when no price has been received", () => {
    expect(decide(battery(0.6), undefined, config, now).action).toBe("HOLD");
  });

  it("holds when the price is stale", () => {
    const d = decide(battery(0.6), { priceAudMwh: 900, intervalStart: "2026-09-25T05:30:00Z" }, config, now);
    expect(d.action).toBe("HOLD");
    expect(d.reason).toMatch(/stale/);
  });

  it("discharges into a spike at the inverter limit when there is plenty of charge", () => {
    const d = decide(battery(0.8), { priceAudMwh: 450, intervalStart: fresh }, config, now);
    expect(d.action).toBe("DISCHARGE");
    expect(d.targetKw).toBe(5);
  });

  it("limits discharge so one interval never drains below reserve", () => {
    // 0.22 - 0.20 = 0.02 of 13.5 kWh = 0.27 kWh; over 5 minutes that is 3.24 kW.
    const d = decide(battery(0.22), { priceAudMwh: 450, intervalStart: fresh }, config, now);
    expect(d.action).toBe("DISCHARGE");
    expect(d.targetKw).toBe(3.24);
  });

  it("holds during a spike when the battery is at reserve", () => {
    expect(decide(battery(0.2), { priceAudMwh: 450, intervalStart: fresh }, config, now).action).toBe("HOLD");
  });

  it("charges when power is cheap and the battery has room", () => {
    const d = decide(battery(0.5), { priceAudMwh: -20, intervalStart: fresh }, config, now);
    expect(d.action).toBe("CHARGE");
    expect(d.targetKw).toBe(5);
  });

  it("holds at a cheap price when the battery is full", () => {
    expect(decide(battery(0.96), { priceAudMwh: 10, intervalStart: fresh }, config, now).action).toBe("HOLD");
  });

  it("holds at a normal price", () => {
    expect(decide(battery(0.6), { priceAudMwh: 120, intervalStart: fresh }, config, now).action).toBe("HOLD");
  });

  it("treats the threshold itself as a spike", () => {
    expect(decide(battery(0.6), { priceAudMwh: 300, intervalStart: fresh }, config, now).action).toBe("DISCHARGE");
  });
});
