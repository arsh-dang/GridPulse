import { BatteryTelemetrySchema } from "@gridpulse/shared";
import { connectMqtt } from "./mqttClient.js";

/**
 * Subscribes with an MQTT wildcard across every region and battery, so
 * this one process can watch the whole simulated fleet regardless of
 * how many batteries batteryNode.ts is running.
 */
async function main(): Promise<void> {
  const client = await connectMqtt();
  const topic = "gridpulse/+/+/telemetry";

  await client.subscribeAsync(topic);
  console.log(`fleetMonitor subscribed to ${topic}`);

  client.on("message", (_topic, payload) => {
    let json: unknown;
    try {
      json = JSON.parse(payload.toString());
    } catch {
      console.warn("Dropping non-JSON telemetry message on", _topic);
      return;
    }

    const result = BatteryTelemetrySchema.safeParse(json);
    if (!result.success) {
      console.warn("Dropping telemetry message that failed validation:", result.error.message);
      return;
    }

    const { batteryId, region, soc, solarKw, loadKw } = result.data;
    console.log(
      `[${region}] ${batteryId} soc=${(soc * 100).toFixed(0)}% solar=${solarKw}kW load=${loadKw}kW`,
    );
  });
}

main().catch((err) => {
  console.error("fleetMonitor failed to start:", err);
  process.exit(1);
});
