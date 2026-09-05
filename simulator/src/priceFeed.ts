import type { NemRegion } from "@gridpulse/shared";
import { PriceUpdatedSchema } from "@gridpulse/shared";
import { connectMqtt } from "./mqttClient.js";

const REGION = (process.env.REGION as NemRegion | undefined) ?? "VIC";
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS ?? 5000);

/**
 * Standalone simulated price curve, independent of price-ingest-service —
 * useful for demoing/developing the Node-RED flow and dispatch logic
 * without needing a real OpenElectricity API key or CSV file on hand.
 * Walks a baseline price with random drift and occasional spikes above
 * $300/MWh so the "if price > $300" flow has something to trigger on.
 */
function nextPrice(previous: number): number {
  const isSpike = Math.random() < 0.1;
  if (isSpike) return Number((300 + Math.random() * 300).toFixed(2));

  const drift = (Math.random() - 0.5) * 20;
  return Number(Math.max(20, previous + drift).toFixed(2));
}

async function main(): Promise<void> {
  const client = await connectMqtt();
  const topic = `gridpulse/price/${REGION}`;

  let price = 80;
  console.log(`priceFeed publishing simulated prices to ${topic}`);

  setInterval(() => {
    price = nextPrice(price);

    const event = PriceUpdatedSchema.parse({
      type: "PriceUpdated",
      region: REGION,
      priceAudMwh: price,
      intervalStart: new Date().toISOString(),
      source: "simulator",
    });

    client.publish(topic, JSON.stringify(event));
  }, PUBLISH_INTERVAL_MS);
}

main().catch((err) => {
  console.error("priceFeed failed to start:", err);
  process.exit(1);
});
