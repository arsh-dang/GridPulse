import { BatchWriteCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DispatchDecision } from "@gridpulse/shared";

export interface StoredDecision extends DispatchDecision {
  soc: number;
  priceAudMwh: number | null;
  /** Which ECS task made the decision. This is how the scaling evidence shows several tasks at work. */
  decidedBy: string;
}

const MAX_BATCH = 25;
const MAX_ATTEMPTS = 4;

/** Latest decision per battery, keyed on batteryId. */
export class DispatchStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async putMany(decisions: StoredDecision[]): Promise<void> {
    for (let i = 0; i < decisions.length; i += MAX_BATCH) {
      await this.writeBatch(decisions.slice(i, i + MAX_BATCH));
    }
  }

  private async writeBatch(batch: StoredDecision[]): Promise<void> {
    let requests = batch.map((item) => ({ PutRequest: { Item: item } }));

    for (let attempt = 1; requests.length > 0; attempt++) {
      const out = await this.db.send(new BatchWriteCommand({ RequestItems: { [this.table]: requests } }));
      const unprocessed = out.UnprocessedItems?.[this.table] ?? [];
      if (unprocessed.length === 0) return;
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`${unprocessed.length} dispatch writes still unprocessed after ${attempt} attempts`);
      }
      // DynamoDB throttled part of the batch: back off, then retry only what failed.
      await sleep(50 * 2 ** attempt);
      requests = unprocessed as typeof requests;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
