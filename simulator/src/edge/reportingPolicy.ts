/**
 * Edge gateway reporting policies for battery telemetry.
 *
 *   periodic   every sample is published (the 6.3D baseline)
 *   sod        send-on-delta (Miskowicz, 2006): publish only when SoC has
 *              moved at least `delta` since the last published value, or
 *              when the battery has been silent for `heartbeatS`
 *   sod-aware  send-on-delta plus decision-aware triggers: also publish the
 *              moment SoC crosses a threshold the dispatch policy acts on
 *              (reserve and full), and publish every battery when the
 *              regional price class changes (normal / spike / cheap)
 *
 * The gateway keeps one small record per battery, so memory grows linearly
 * with fleet size and each decision is O(1).
 */
export type ReportingMode = "periodic" | "sod" | "sod-aware";
export type PriceClass = "cheap" | "normal" | "spike";

export interface ReportingConfig {
  mode: ReportingMode;
  /** Minimum SoC change (0-1 fraction) that counts as significant. */
  delta: number;
  /** Longest a battery may stay silent, in seconds. Bounds staleness and doubles as a liveness signal. */
  heartbeatS: number;
  /** SoC levels the dispatch policy switches on. */
  boundaries: number[];
}

export type Trigger = "periodic" | "delta" | "heartbeat" | "boundary" | "price" | "first";

interface LastReport {
  soc: number;
  atS: number;
}

export class ReportingPolicy {
  private last = new Map<string, LastReport>();
  private pendingFlush = new Set<string>();
  readonly counts: Record<Trigger, number> = { periodic: 0, delta: 0, heartbeat: 0, boundary: 0, price: 0, first: 0 };
  private priceClass: PriceClass | undefined;

  constructor(private readonly cfg: ReportingConfig) {}

  /**
   * Called when the gateway learns the regional price. A change of class
   * marks every battery for an immediate report, so the cloud re-decides
   * the whole fleet against the new price within one sampling round.
   */
  onPrice(cls: PriceClass, batteryIds: Iterable<string>): void {
    if (this.cfg.mode !== "sod-aware") return;
    if (this.priceClass !== undefined && cls !== this.priceClass) {
      for (const id of batteryIds) this.pendingFlush.add(id);
    }
    this.priceClass = cls;
  }

  /**
   * Records a report that happened before the experiment window, so a fleet
   * can start with its heartbeats spread out instead of all in phase.
   */
  prime(id: string, soc: number, atS: number): void {
    this.last.set(id, { soc, atS });
  }

  /** Returns why this sample should be published, or undefined to suppress it. */
  decide(id: string, soc: number, nowS: number): Trigger | undefined {
    const trigger = this.evaluate(id, soc, nowS);
    if (trigger) {
      this.last.set(id, { soc, atS: nowS });
      this.pendingFlush.delete(id);
      this.counts[trigger]++;
    }
    return trigger;
  }

  private evaluate(id: string, soc: number, nowS: number): Trigger | undefined {
    if (this.cfg.mode === "periodic") return "periodic";
    const prev = this.last.get(id);
    if (!prev) return "first";

    if (this.cfg.mode === "sod-aware") {
      if (this.pendingFlush.has(id)) return "price";
      for (const b of this.cfg.boundaries) {
        if ((prev.soc > b) !== (soc > b)) return "boundary";
      }
    }
    if (Math.abs(soc - prev.soc) >= this.cfg.delta) return "delta";
    if (nowS - prev.atS >= this.cfg.heartbeatS) return "heartbeat";
    return undefined;
  }
}
