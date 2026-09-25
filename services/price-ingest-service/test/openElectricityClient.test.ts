import { describe, expect, it, vi } from "vitest";
import { OpenElectricityClient, OpenElectricityError } from "../src/openElectricityClient.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("./fixtures/sample-response.json", import.meta.url));
const sampleBody = readFileSync(fixturePath, "utf-8");

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe("OpenElectricityClient", () => {
  it("returns validated data on a successful first attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, sampleBody));
    const client = new OpenElectricityClient({
      baseUrl: "https://api.example.test/v4",
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await client.fetchLatestPrice("VIC");
    expect(result.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain("/market/network/NEM");
    expect(url.searchParams.get("network_region")).toBe("VIC1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("retries on a 500 and succeeds on a later attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, "server error"))
      .mockResolvedValueOnce(jsonResponse(200, sampleBody));

    const client = new OpenElectricityClient({
      baseUrl: "https://api.example.test/v4",
      apiKey: "test-key",
      fetchImpl,
      maxAttempts: 3,
      baseDelayMs: 1,
    });

    const result = await client.fetchLatestPrice("VIC");
    expect(result.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 401 and fails immediately", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, "unauthorized"));
    const client = new OpenElectricityClient({
      baseUrl: "https://api.example.test/v4",
      apiKey: "bad-key",
      fetchImpl,
      maxAttempts: 3,
      baseDelayMs: 1,
    });

    await expect(client.fetchLatestPrice("VIC")).rejects.toThrow(OpenElectricityError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting retries on repeated 429s", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, "rate limited"));
    const client = new OpenElectricityClient({
      baseUrl: "https://api.example.test/v4",
      apiKey: "test-key",
      fetchImpl,
      maxAttempts: 2,
      baseDelayMs: 1,
    });

    await expect(client.fetchLatestPrice("VIC")).rejects.toThrow(OpenElectricityError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails without retrying when the response body doesn't match the schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, JSON.stringify({ nope: true })));
    const client = new OpenElectricityClient({
      baseUrl: "https://api.example.test/v4",
      apiKey: "test-key",
      fetchImpl,
      maxAttempts: 3,
      baseDelayMs: 1,
    });

    await expect(client.fetchLatestPrice("VIC")).rejects.toThrow(/failed validation/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
