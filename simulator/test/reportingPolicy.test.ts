import { describe, expect, it } from "vitest";
import { ReportingPolicy, type ReportingConfig } from "../src/edge/reportingPolicy.js";

const cfg = (over: Partial<ReportingConfig> = {}): ReportingConfig => ({
  mode: "sod", delta: 0.01, heartbeatS: 60, boundaries: [0.2, 0.95], ...over,
});

describe("ReportingPolicy", () => {
  it("periodic publishes every sample", () => {
    const p = new ReportingPolicy(cfg({ mode: "periodic" }));
    expect(p.decide("b1", 0.5, 0)).toBe("periodic");
    expect(p.decide("b1", 0.5, 5)).toBe("periodic");
  });

  it("send-on-delta publishes the first sample, then suppresses small changes", () => {
    const p = new ReportingPolicy(cfg());
    expect(p.decide("b1", 0.5, 0)).toBe("first");
    expect(p.decide("b1", 0.505, 5)).toBeUndefined();
    expect(p.decide("b1", 0.511, 10)).toBe("delta");
  });

  it("measures delta from the last published value, not the last sample", () => {
    const p = new ReportingPolicy(cfg());
    p.decide("b1", 0.5, 0);
    expect(p.decide("b1", 0.496, 5)).toBeUndefined();
    expect(p.decide("b1", 0.492, 10)).toBeUndefined();
    expect(p.decide("b1", 0.489, 15)).toBe("delta");
  });

  it("sends a heartbeat after the silence limit", () => {
    const p = new ReportingPolicy(cfg());
    p.decide("b1", 0.5, 0);
    expect(p.decide("b1", 0.5, 55)).toBeUndefined();
    expect(p.decide("b1", 0.5, 60)).toBe("heartbeat");
  });

  it("sod-aware reports a crossing of the reserve even below delta", () => {
    const p = new ReportingPolicy(cfg({ mode: "sod-aware" }));
    p.decide("b1", 0.203, 0);
    expect(p.decide("b1", 0.199, 5)).toBe("boundary");
  });

  it("plain sod ignores the reserve crossing", () => {
    const p = new ReportingPolicy(cfg());
    p.decide("b1", 0.203, 0);
    expect(p.decide("b1", 0.199, 5)).toBeUndefined();
  });

  it("sod-aware flushes every battery once when the price class changes", () => {
    const p = new ReportingPolicy(cfg({ mode: "sod-aware" }));
    p.onPrice("normal", ["b1", "b2"]);
    p.decide("b1", 0.5, 0);
    p.decide("b2", 0.6, 0);
    p.onPrice("spike", ["b1", "b2"]);
    expect(p.decide("b1", 0.5, 5)).toBe("price");
    expect(p.decide("b2", 0.6, 5)).toBe("price");
    expect(p.decide("b1", 0.5, 10)).toBeUndefined();
  });

  it("does not flush when the price changes within the same class", () => {
    const p = new ReportingPolicy(cfg({ mode: "sod-aware" }));
    p.onPrice("spike", ["b1"]);
    p.decide("b1", 0.5, 0);
    p.onPrice("spike", ["b1"]);
    expect(p.decide("b1", 0.5, 5)).toBeUndefined();
  });

  it("primed history spreads heartbeats", () => {
    const p = new ReportingPolicy(cfg());
    p.prime("b1", 0.5, -50);
    expect(p.decide("b1", 0.5, 5)).toBeUndefined();
    expect(p.decide("b1", 0.5, 10)).toBe("heartbeat");
  });
});
