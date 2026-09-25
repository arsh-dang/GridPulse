import { describe, expect, it } from "vitest";
import { parseMessageBody } from "../src/messages.js";

describe("parseMessageBody", () => {
  it("accepts battery telemetry", () => {
    const r = parseMessageBody(
      JSON.stringify({
        type: "BatteryTelemetry", batteryId: "b1", region: "VIC", soc: 0.5,
        solarKw: 1, loadKw: 2, ts: "2026-09-25T06:00:00Z",
      }),
    );
    expect(r.ok && r.event.type).toBe("BatteryTelemetry");
  });

  it("accepts a price spike", () => {
    const r = parseMessageBody(
      JSON.stringify({
        type: "PriceSpikeDetected", region: "VIC", priceAudMwh: 450, thresholdAudMwh: 300,
        intervalStart: "2026-09-25T06:00:00+10:00", source: "simulator",
      }),
    );
    expect(r.ok && r.event.type).toBe("PriceSpikeDetected");
  });

  it("rejects non-JSON", () => {
    expect(parseMessageBody("not json").ok).toBe(false);
  });

  it("rejects an unknown event type", () => {
    expect(parseMessageBody(JSON.stringify({ type: "ping" })).ok).toBe(false);
  });

  it("rejects telemetry with SoC as a percentage", () => {
    const r = parseMessageBody(
      JSON.stringify({
        type: "BatteryTelemetry", batteryId: "b1", region: "VIC", soc: 55,
        solarKw: 1, loadKw: 2, ts: "2026-09-25T06:00:00Z",
      }),
    );
    expect(r.ok).toBe(false);
  });
});
