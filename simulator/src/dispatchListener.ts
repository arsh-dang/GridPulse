import type { NemRegion } from "@gridpulse/shared";
import { DispatchDecisionSchema } from "@gridpulse/shared";
import { connectMqtt } from "./mqttClient.js";

const REGION = (process.env.REGION as NemRegion | undefined) ?? "VIC";

/**
 * Stands in for the fleet acting on a dispatch decision. Today the
 * decision comes from the Node-RED threshold flow; once
 * dispatch-optimizer-service exists, this listens to it instead without
 * any change here — it's just an MQTT subscriber.
 */
async function main(): Promise<void> {
  const client = await connectMqtt();
  const topic = `gridpulse/dispatch/${REGION}`;

  await client.subscribeAsync(topic);
  console.log(`dispatchListener subscribed to ${topic}`);

  client.on("message", (_topic, payload) => {
    let json: unknown;
    try {
      json = JSON.parse(payload.toString());
    } catch {
      console.warn("Dropping non-JSON dispatch message");
      return;
    }

    const result = DispatchDecisionSchema.safeParse(json);
    if (!result.success) {
      console.warn("Dropping dispatch message that failed validation:", result.error.message);
      return;
    }

    const decision = result.data;
    console.log(
      `Dispatch decision for ${decision.region}${decision.batteryId ? ` (${decision.batteryId})` : " (fleet-wide)"}: ` +
        `${decision.action}${decision.targetKw ? ` @ ${decision.targetKw}kW` : ""} — ${decision.reason}`,
    );
  });
}

main().catch((err) => {
  console.error("dispatchListener failed to start:", err);
  process.exit(1);
});
