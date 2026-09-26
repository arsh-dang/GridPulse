import { CAPACITY_KWH, type DispatchAction } from "@gridpulse/shared";
import { mulberry32 } from "./rng.js";

/**
 * Physical model of a home battery fleet, used by both the cloud load
 * generator and the offline experiments.
 *
 * State of charge moves with the command the battery is executing:
 *   DISCHARGE: exports targetKw to the grid
 *   CHARGE:    imports targetKw from the grid
 *   HOLD:      covers the household's net load (load minus solar)
 * DISCHARGE has no firmware floor, on purpose: if the cloud kept a battery
 * discharging past its reserve because its view was stale, the experiment
 * would see it as a reserve violation.
 */
export interface Command {
  action: DispatchAction;
  targetKw: number;
}

export interface Battery {
  id: string;
  soc: number;
  /** Mean household load in kW, fixed per home. */
  baseLoadKw: number;
  /** Solar system size in kW peak, fixed per home. */
  solarKwp: number;
  command: Command;
}

export interface FleetOptions {
  size: number;
  region: string;
  seed?: number;
  socMin?: number;
  socMax?: number;
}

export class Fleet {
  readonly batteries: Battery[];
  private readonly rand: () => number;

  constructor(opts: FleetOptions) {
    this.rand = mulberry32(opts.seed ?? 42);
    const lo = opts.socMin ?? 0.22;
    const hi = opts.socMax ?? 0.9;
    this.batteries = Array.from({ length: opts.size }, (_, i) => ({
      id: `battery-${opts.region.toLowerCase()}-${i + 1}`,
      soc: lo + this.rand() * (hi - lo),
      baseLoadKw: 0.6 + this.rand() * 1.8,
      solarKwp: this.rand() < 0.7 ? 3 + this.rand() * 4 : 0,
      command: { action: "HOLD", targetKw: 0 },
    }));
  }

  /** Household net load right now: load with a little noise, minus solar output for the hour. */
  netHouseKw(b: Battery, hourOfDay: number): number {
    const daylight = Math.max(0, Math.sin(((hourOfDay - 6) / 12) * Math.PI));
    const solar = b.solarKwp * daylight * 0.8;
    const load = b.baseLoadKw * (0.8 + this.rand() * 0.4);
    return load - solar;
  }

  /**
   * Advances one battery by dtS seconds under its current command.
   * DISCHARGE and CHARGE follow the dispatch target exactly (the house runs
   * from the grid meanwhile). HOLD is normal self-consumption: the battery
   * covers the house load but, like real home batteries, stops at the backup
   * reserve, and it soaks up any solar surplus.
   */
  step(b: Battery, dtS: number, hourOfDay: number, reserveSoc: number): void {
    const dSoc = (kw: number): number => (kw * dtS) / 3600 / CAPACITY_KWH;
    switch (b.command.action) {
      case "DISCHARGE":
        b.soc = Math.max(0, b.soc - dSoc(b.command.targetKw));
        break;
      case "CHARGE":
        b.soc = Math.min(1, b.soc + dSoc(b.command.targetKw));
        break;
      default: {
        const net = this.netHouseKw(b, hourOfDay);
        if (net > 0) b.soc = b.soc > reserveSoc ? Math.max(reserveSoc, b.soc - dSoc(net)) : b.soc;
        else b.soc = Math.min(1, b.soc - dSoc(net));
      }
    }
  }
}
