import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalisePriceResponse } from "../src/priceNormaliser.js";
import { OpenElectricityResponseSchema } from "../src/openElectricitySchema.js";

const fixturePath = new URL("./fixtures/sample-response.json", import.meta.url);
const sample = OpenElectricityResponseSchema.parse(JSON.parse(readFileSync(fixturePath, "utf-8")));

describe("normalisePriceResponse", () => {
  it("maps each non-null data point to a PriceUpdated event", () => {
    const events = normalisePriceResponse(sample, "openelectricity-api");
    expect(events).toHaveLength(2); // third data point is null, skipped
    expect(events[0]).toEqual({
      type: "PriceUpdated",
      region: "VIC",
      priceAudMwh: 87.42,
      intervalStart: "2026-01-15T12:00:00+10:00",
      source: "openelectricity-api",
    });
    expect(events[1]?.priceAudMwh).toBe(412.55);
  });

  it("skips results with an unrecognised region", () => {
    const malformed = structuredClone(sample);
    malformed.data[0]!.results[0]!.columns["region"] = "XX9";
    const events = normalisePriceResponse(malformed, "openelectricity-api");
    expect(events).toHaveLength(0);
  });

  it("skips results with no region column", () => {
    const malformed = structuredClone(sample);
    delete malformed.data[0]!.results[0]!.columns["region"];
    const events = normalisePriceResponse(malformed, "openelectricity-api");
    expect(events).toHaveLength(0);
  });

  it("tags events with the given source", () => {
    const events = normalisePriceResponse(sample, "csv-fallback");
    expect(events.every((e) => e.source === "csv-fallback")).toBe(true);
  });
});
