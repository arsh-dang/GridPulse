import { logger } from "./logger.js";
import { toNetworkRegion } from "./nemRegion.js";
import { OpenElectricityResponseSchema, type OpenElectricityResponse } from "./openElectricitySchema.js";
import type { NemRegion } from "@gridpulse/shared";

export class OpenElectricityError extends Error {
  constructor(
    message: string,
    /** false for a 4xx (other than 429): retrying it would just fail again. */
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface OpenElectricityClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Max attempts including the first — not just the number of retries. */
  maxAttempts?: number;
  /** Base delay for exponential backoff, doubled each retry. */
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Thin client for the OpenElectricity network-data endpoint. Retries
 * transient failures (network errors, 5xx, 429) with exponential backoff;
 * does not retry 4xx client errors other than 429, since retrying a bad
 * request or bad auth just wastes time and hides the real problem.
 */
export class OpenElectricityClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenElectricityClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchLatestPrice(region: NemRegion): Promise<OpenElectricityResponse> {
    const networkRegion = toNetworkRegion(region);
    const url = new URL(`${this.baseUrl}/market/network/NEM`);
    url.searchParams.set("metrics", "price");
    url.searchParams.set("interval", "5m");
    url.searchParams.set("network_region", networkRegion);
    url.searchParams.set("primary_grouping", "network_region");

    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });

        if (res.status === 429 || res.status >= 500) {
          throw new OpenElectricityError(`OpenElectricity API returned ${res.status}`, true);
        }
        if (!res.ok) {
          // 4xx other than 429: not worth retrying, fail immediately.
          throw new OpenElectricityError(
            `OpenElectricity API returned ${res.status}: ${await res.text()}`,
            false,
          );
        }

        const json: unknown = await res.json();
        const parsed = OpenElectricityResponseSchema.safeParse(json);
        if (!parsed.success) {
          // A malformed-but-200 response is a shape mismatch, not a
          // transient failure — retrying won't fix it either.
          throw new OpenElectricityError(
            `OpenElectricity API response failed validation: ${parsed.error.message}`,
            false,
          );
        }

        return parsed.data;
      } catch (err) {
        lastError = err;
        const retryable = err instanceof OpenElectricityError ? err.retryable : true;
        const isLastAttempt = attempt === this.maxAttempts;
        logger.warn("OpenElectricity API request failed", {
          attempt,
          maxAttempts: this.maxAttempts,
          retryable,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!retryable || isLastAttempt) break;
        await sleep(this.baseDelayMs * 2 ** (attempt - 1));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new OpenElectricityError("OpenElectricity API request failed for an unknown reason", true);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
