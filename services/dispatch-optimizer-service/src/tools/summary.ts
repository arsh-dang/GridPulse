import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Evidence helper: scans the dispatch table and counts decisions by the ECS
 * task that made them and by action. Run after the scaling demo:
 *   AWS_REGION=us-east-1 npm run summary -w @gridpulse/dispatch-optimizer-service
 */
const region = process.env.AWS_REGION ?? "us-east-1";
const table = process.env.DISPATCH_TABLE ?? "gridpulse-dispatch";

async function main(): Promise<void> {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  const byTask = new Map<string, number>();
  const byAction = new Map<string, number>();
  let total = 0;
  let startKey: Record<string, unknown> | undefined;

  do {
    const out = await db.send(
      new ScanCommand({
        TableName: table,
        ProjectionExpression: "decidedBy, #a",
        ExpressionAttributeNames: { "#a": "action" },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of out.Items ?? []) {
      total++;
      const task = String(item.decidedBy ?? "unknown");
      const action = String(item.action ?? "unknown");
      byTask.set(task, (byTask.get(task) ?? 0) + 1);
      byAction.set(action, (byAction.get(action) ?? 0) + 1);
    }
    startKey = out.LastEvaluatedKey;
  } while (startKey);

  console.log(`\n${table}: ${total} batteries with a current decision\n`);
  console.log("Latest decision made by task");
  for (const [task, n] of [...byTask].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${task.padEnd(16)} ${String(n).padStart(6)}  ${pct(n, total)}`);
  }
  console.log("\nAction");
  for (const [action, n] of [...byAction].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${action.padEnd(16)} ${String(n).padStart(6)}  ${pct(n, total)}`);
  }
  console.log("");
}

function pct(n: number, total: number): string {
  return total ? `${((n / total) * 100).toFixed(1)}%` : "";
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
