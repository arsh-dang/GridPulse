import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHistoricalPricesCsv, CsvPriceReplay } from "../src/csvFallback.js";

const fixturePath = fileURLToPath(new URL("./fixtures/sample-historical-prices.csv", import.meta.url));
const csvText = readFileSync(fixturePath, "utf-8");

describe("parseHistoricalPricesCsv", () => {
  it("parses each row into a PriceUpdated event", () => {
    const events = parseHistoricalPricesCsv(csvText);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      type: "PriceUpdated",
      region: "VIC",
      priceAudMwh: 68.42,
      intervalStart: "2026-01-15T12:00:00+10:00",
      source: "csv-fallback",
    });
  });

  it("maps REGIONID codes to shared NemRegion values", () => {
    const events = parseHistoricalPricesCsv(csvText);
    expect(events[2]?.region).toBe("NSW");
  });

  it("throws on a CSV missing required headers", () => {
    expect(() => parseHistoricalPricesCsv("A,B,C\n1,2,3")).toThrow();
  });

  it("skips rows with an unparseable price instead of throwing", () => {
    const events = parseHistoricalPricesCsv(
      "SETTLEMENTDATE,REGIONID,RRP\n2026-01-15 12:00:00,VIC1,not-a-number",
    );
    expect(events).toHaveLength(0);
  });
});

describe("CsvPriceReplay", () => {
  it("returns events for a region in order, then loops back to the start", () => {
    const replay = new CsvPriceReplay(parseHistoricalPricesCsv(csvText));
    expect(replay.next("VIC")?.priceAudMwh).toBe(68.42);
    expect(replay.next("VIC")?.priceAudMwh).toBe(412.55);
    expect(replay.next("VIC")?.priceAudMwh).toBe(68.42); // looped
  });

  it("returns null for a region with no historical data", () => {
    const replay = new CsvPriceReplay(parseHistoricalPricesCsv(csvText));
    expect(replay.next("TAS")).toBeNull();
  });
});
