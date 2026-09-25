import type { BatteryTelemetry, DispatchDecision } from "@gridpulse/shared";

/** Usable capacity of a Powerwall-class home battery, matching the simulator. */
export const CAPACITY_KWH = 13.5;

/** NEM dispatch interval. Power targets are sized so one interval stays within limits. */
const INTERVAL_HOURS = 5 / 60;

export interface PolicyConfig {
  spikeThresholdAudMwh: number;
  cheapThresholdAudMwh: number;
  reserveSoc: number;
  fullSoc: number;
  maxKw: number;
  priceMaxAgeMs: number;
}

export interface RegionPrice {
  priceAudMwh: number;
  intervalStart: string;
}

/**
 * Decides what one battery should do for the next 5-minute interval.
 *
 * Pure function: no I/O, no clock of its own. That keeps the decision logic
 * testable without AWS and identical on every ECS task, which matters once
 * several tasks are processing the same fleet in parallel.
 */
export function decide(
  telemetry: BatteryTelemetry,
  price: RegionPrice | undefined,
  config: PolicyConfig,
  now: Date,
): DispatchDecision {
  const base = {
    type: "DispatchDecision" as const,
    batteryId: telemetry.batteryId,
    region: telemetry.region,
    ts: now.toISOString(),
  };
  const socPct = Math.round(telemetry.soc * 100);

  if (!price) {
    return { ...base, action: "HOLD", reason: "no regional price received yet" };
  }

  const ageMs = now.getTime() - new Date(price.intervalStart).getTime();
  if (ageMs > config.priceMaxAgeMs) {
    return {
      ...base,
      action: "HOLD",
      reason: `price is ${Math.round(ageMs / 60_000)} min old, too stale to act on`,
    };
  }

  const p = price.priceAudMwh;

  if (p >= config.spikeThresholdAudMwh) {
    if (telemetry.soc <= config.reserveSoc) {
      return { ...base, action: "HOLD", reason: `spike at $${p}/MWh but SoC ${socPct}% is at reserve` };
    }
    const availableKwh = (telemetry.soc - config.reserveSoc) * CAPACITY_KWH;
    const targetKw = round2(Math.min(config.maxKw, availableKwh / INTERVAL_HOURS));
    return {
      ...base,
      action: "DISCHARGE",
      targetKw,
      reason: `spike at $${p}/MWh >= $${config.spikeThresholdAudMwh}; SoC ${socPct}%`,
    };
  }

  if (p <= config.cheapThresholdAudMwh) {
    if (telemetry.soc >= config.fullSoc) {
      return { ...base, action: "HOLD", reason: `cheap at $${p}/MWh but SoC ${socPct}% is full` };
    }
    const headroomKwh = (config.fullSoc - telemetry.soc) * CAPACITY_KWH;
    const targetKw = round2(Math.min(config.maxKw, headroomKwh / INTERVAL_HOURS));
    return {
      ...base,
      action: "CHARGE",
      targetKw,
      reason: `cheap at $${p}/MWh <= $${config.cheapThresholdAudMwh}; SoC ${socPct}%`,
    };
  }

  return { ...base, action: "HOLD", reason: `normal price $${p}/MWh; SoC ${socPct}%` };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
