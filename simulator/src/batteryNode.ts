import type { NemRegion, BatteryTelemetry } from "@gridpulse/shared";
import { BatteryTelemetrySchema } from "@gridpulse/shared";
import { connectMqtt } from "./mqttClient.js";

const REGION = (process.env.REGION as NemRegion | undefined) ?? "VIC";
const NUM_BATTERIES = Number(process.env.NUM_BATTERIES ?? 20);
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS ?? 5000);

/** Typical home battery capacity (Tesla Powerwall-class), in kWh. */
const CAPACITY_KWH = 13.5;

/**
 * One simulated home battery. soc drifts based on simulated solar
 * generation vs. household load; a real device would report this
 * directly, this stands in for that.
 */
class SimulatedBattery {
  private soc: number;

  constructor(
    public readonly batteryId: string,
    public readonly region: NemRegion,
  ) {
    this.soc = 0.4 + Math.random() * 0.4; // start somewhere between 40-80%
  }

  /** Advances the simulated battery by intervalMs and returns its new telemetry. */
  tick(intervalMs: number): BatteryTelemetry {
    const solarKw = simulateSolarKw();
    const loadKw = simulateLoadKw();

    const netKw = solarKw - loadKw;
    const deltaSoc = (netKw * (intervalMs / 3_600_000)) / CAPACITY_KWH;
    this.soc = clamp(this.soc + deltaSoc, 0, 1);

    return BatteryTelemetrySchema.parse({
      type: "BatteryTelemetry",
      batteryId: this.batteryId,
      region: this.region,
      soc: this.soc,
      solarKw,
      loadKw,
      ts: new Date().toISOString(),
    });
  }
}

function simulateSolarKw(): number {
  const hour = new Date().getHours();
  const daylight = hour >= 6 && hour <= 18;
  return daylight ? Number((Math.random() * 5).toFixed(2)) : 0;
}

function simulateLoadKw(): number {
  return Number((0.5 + Math.random() * 2.5).toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function main(): Promise<void> {
  const client = await connectMqtt();

  const batteries = Array.from(
    { length: NUM_BATTERIES },
    (_, i) => new SimulatedBattery(`battery-${REGION.toLowerCase()}-${i + 1}`, REGION),
  );

  console.log(`Simulating ${batteries.length} batteries in ${REGION}`);

  for (const battery of batteries) {
    // Jitter each battery's schedule so they don't all publish in lockstep.
    const jitterMs = Math.random() * PUBLISH_INTERVAL_MS;
    setTimeout(() => {
      setInterval(() => {
        const telemetry = battery.tick(PUBLISH_INTERVAL_MS);
        const topic = `gridpulse/${telemetry.region}/${telemetry.batteryId}/telemetry`;
        client.publish(topic, JSON.stringify(telemetry));
      }, PUBLISH_INTERVAL_MS);
    }, jitterMs);
  }
}

main().catch((err) => {
  console.error("batteryNode failed to start:", err);
  process.exit(1);
});
