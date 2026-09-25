import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NemRegion, PriceSpikeDetected, PriceUpdated } from "@gridpulse/shared";
import type { RegionPrice } from "../policy.js";

/**
 * Latest price per region, shared by every optimiser task through DynamoDB.
 *
 * A price event lands on only one task (SQS delivers each message once), so
 * the other tasks learn about it from this table. Each task caches the value
 * for a few seconds, which keeps reads to a handful per second no matter how
 * much telemetry is flowing.
 */
export class PriceStore {
  private cache = new Map<NemRegion, { value: RegionPrice | undefined; fetchedAt: number }>();

  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly table: string,
    private readonly cacheMs: number,
  ) {}

  async get(region: NemRegion): Promise<RegionPrice | undefined> {
    const hit = this.cache.get(region);
    if (hit && Date.now() - hit.fetchedAt < this.cacheMs) return hit.value;

    const out = await this.db.send(new GetCommand({ TableName: this.table, Key: { region } }));
    const value =
      out.Item && typeof out.Item.priceAudMwh === "number" && typeof out.Item.intervalStart === "string"
        ? { priceAudMwh: out.Item.priceAudMwh, intervalStart: out.Item.intervalStart }
        : undefined;
    this.cache.set(region, { value, fetchedAt: Date.now() });
    return value;
  }

  /**
   * Stores a price only if it is newer than the one already held. Events can
   * arrive out of order across tasks, and an older interval must never
   * overwrite a newer one. Compared as epoch milliseconds, since interval
   * strings can carry different UTC offsets.
   */
  async put(event: PriceUpdated | PriceSpikeDetected): Promise<boolean> {
    const intervalEpochMs = new Date(event.intervalStart).getTime();
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { region: event.region },
          UpdateExpression:
            "SET priceAudMwh = :p, intervalStart = :s, intervalEpochMs = :e, #src = :src, updatedAt = :u",
          ConditionExpression: "attribute_not_exists(intervalEpochMs) OR intervalEpochMs < :e",
          ExpressionAttributeNames: { "#src": "source" },
          ExpressionAttributeValues: {
            ":p": event.priceAudMwh,
            ":s": event.intervalStart,
            ":e": intervalEpochMs,
            ":src": event.source,
            ":u": new Date().toISOString(),
          },
        }),
      );
      this.cache.set(event.region, {
        value: { priceAudMwh: event.priceAudMwh, intervalStart: event.intervalStart },
        fetchedAt: Date.now(),
      });
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false; // older or same interval
      throw err;
    }
  }
}
