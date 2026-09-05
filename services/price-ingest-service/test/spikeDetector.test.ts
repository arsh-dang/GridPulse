import { describe, expect, it } from "vitest";
import { detectSpike } from "../src/spikeDetector.js";
import type { PriceUpdated } from "@gridpulse/shared";

const basePrice: PriceUpdated = {
  type: "PriceUpdated",
  region: "VIC",
  priceAudMwh: 0,
  intervalStart: "2026-01-15T12:00:00+10:00",
  source: "openelectricity-api",
};

describe("detectSpike", () => {
  it("returns null when price is below the threshold", () => {
    expect(detectSpike({ ...basePrice, priceAudMwh: 250 }, 300)).toBeNull();
  });

  it("returns null when price exactly equals the threshold", () => {
    expect(detectSpike({ ...basePrice, priceAudMwh: 300 }, 300)).toBeNull();
  });

  it("returns a PriceSpikeDetected when price exceeds the threshold", () => {
    const spike = detectSpike({ ...basePrice, priceAudMwh: 412.55 }, 300);
    expect(spike).toEqual({
      type: "PriceSpikeDetected",
      region: "VIC",
      priceAudMwh: 412.55,
      thresholdAudMwh: 300,
      intervalStart: "2026-01-15T12:00:00+10:00",
      source: "openelectricity-api",
    });
  });

  it("uses the threshold passed in, not a hardcoded default", () => {
    expect(detectSpike({ ...basePrice, priceAudMwh: 150 }, 100)).not.toBeNull();
  });
});
