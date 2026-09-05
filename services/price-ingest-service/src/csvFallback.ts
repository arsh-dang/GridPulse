import { readFileSync } from "node:fs";
import type { NemRegion, PriceUpdated } from "@gridpulse/shared";
import { fromNetworkRegion } from "./nemRegion.js";
import { logger } from "./logger.js";

/**
 * Historical AEMO price CSVs use SETTLEMENTDATE / REGIONID / RRP column
 * names (as published on AEMO's NEMWEB), so the fallback fixture matches
 * that format rather than inventing a GridPulse-specific one — makes it
 * trivial to drop in a real AEMO export for a more realistic demo.
 */
const HEADER = ["SETTLEMENTDATE", "REGIONID", "RRP"] as const;

export function parseHistoricalPricesCsv(csvText: string): PriceUpdated[] {
  const lines = csvText.trim().split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const [headerLine, ...rows] = lines;
  const header = headerLine?.split(",").map((h) => h.trim());
  if (!header || HEADER.some((col) => !header.includes(col))) {
    throw new Error(
      `Historical price CSV must have header columns ${HEADER.join(",")}, got: ${headerLine}`,
    );
  }

  const settlementDateIdx = header.indexOf("SETTLEMENTDATE");
  const regionIdIdx = header.indexOf("REGIONID");
  const rrpIdx = header.indexOf("RRP");

  const events: PriceUpdated[] = [];

  for (const row of rows) {
    const cols = row.split(",");
    const settlementDate = cols[settlementDateIdx]?.trim();
    const regionId = cols[regionIdIdx]?.trim();
    const rrpRaw = cols[rrpIdx]?.trim();

    if (!settlementDate || !regionId || !rrpRaw) {
      logger.warn("Skipping malformed historical price row", { row });
      continue;
    }

    const region: NemRegion | undefined = fromNetworkRegion(regionId);
    const rrp = Number(rrpRaw);

    if (!region || Number.isNaN(rrp)) {
      logger.warn("Skipping historical price row with unrecognised region or price", { row });
      continue;
    }

    events.push({
      type: "PriceUpdated",
      region,
      priceAudMwh: rrp,
      intervalStart: toIsoWithOffset(settlementDate),
      source: "csv-fallback",
    });
  }

  return events;
}

/**
 * AEMO timestamps in NEMWEB exports are naive local (AEST, +10:00) with no
 * offset. The shared event contract requires an offset-qualified ISO
 * string, so it's added here rather than relaxing the contract for one
 * data source.
 */
function toIsoWithOffset(settlementDate: string): string {
  const normalised = settlementDate.replace(" ", "T");
  return /[+-]\d{2}:?\d{2}$|Z$/.test(normalised) ? normalised : `${normalised}+10:00`;
}

/**
 * Replays a historical price CSV as a cyclic feed, so a demo can run
 * indefinitely without the live API — it just loops back to the start
 * once it reaches the end of the file.
 */
export class CsvPriceReplay {
  private readonly eventsByRegion = new Map<NemRegion, PriceUpdated[]>();
  private readonly cursor = new Map<NemRegion, number>();

  constructor(events: PriceUpdated[]) {
    for (const event of events) {
      const list = this.eventsByRegion.get(event.region) ?? [];
      list.push(event);
      this.eventsByRegion.set(event.region, list);
    }
  }

  static fromFile(path: string): CsvPriceReplay {
    return new CsvPriceReplay(parseHistoricalPricesCsv(readFileSync(path, "utf-8")));
  }

  /** Returns the next event for a region, looping back to the start when exhausted. */
  next(region: NemRegion): PriceUpdated | null {
    const events = this.eventsByRegion.get(region);
    if (!events || events.length === 0) return null;

    const index = this.cursor.get(region) ?? 0;
    const event = events[index % events.length];
    this.cursor.set(region, index + 1);
    return event ?? null;
  }
}
