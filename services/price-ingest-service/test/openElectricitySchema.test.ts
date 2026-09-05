import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OpenElectricityResponseSchema } from "../src/openElectricitySchema.js";

const fixturePath = fileURLToPath(new URL("./fixtures/sample-response.json", import.meta.url));
const sample = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("OpenElectricityResponseSchema", () => {
  it("accepts a well-formed response", () => {
    const result = OpenElectricityResponseSchema.safeParse(sample);
    expect(result.success).toBe(true);
  });

  it("accepts a null value in a data point (missing interval)", () => {
    const result = OpenElectricityResponseSchema.safeParse(sample);
    expect(result.success).toBe(true);
    expect(result.data?.data[0]?.results[0]?.data[2]).toEqual([
      "2026-01-15T12:10:00+10:00",
      null,
    ]);
  });

  it("rejects a response missing the top-level success field", () => {
    const { success: _drop, ...malformed } = sample;
    const result = OpenElectricityResponseSchema.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  it("rejects a data point that isn't a [string, number|null] tuple", () => {
    const malformed = structuredClone(sample);
    malformed.data[0].results[0].data[0] = { timestamp: "2026-01-15T12:00:00+10:00", value: 87.42 };
    const result = OpenElectricityResponseSchema.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  it("rejects a result missing the columns field", () => {
    const malformed = structuredClone(sample);
    delete malformed.data[0].results[0].columns;
    const result = OpenElectricityResponseSchema.safeParse(malformed);
    expect(result.success).toBe(false);
  });
});
