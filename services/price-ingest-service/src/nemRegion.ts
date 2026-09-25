import type { NemRegion } from "@gridpulse/shared";

/**
 * NEM's own region identifiers carry a trailing "1" (VIC1, NSW1, ...) that
 * is an AEMO/API convention, not part of GridPulse's shared event contract.
 * This mapping is the only place that convention leaks in.
 */
const TO_NETWORK_REGION: Record<NemRegion, string> = {
  NSW: "NSW1",
  QLD: "QLD1",
  SA: "SA1",
  TAS: "TAS1",
  VIC: "VIC1",
};

export function toNetworkRegion(region: NemRegion): string {
  return TO_NETWORK_REGION[region];
}

const FROM_NETWORK_REGION: Record<string, NemRegion> = {
  NSW1: "NSW",
  QLD1: "QLD",
  SA1: "SA",
  TAS1: "TAS",
  VIC1: "VIC",
};

export function fromNetworkRegion(networkRegion: string): NemRegion | undefined {
  return FROM_NETWORK_REGION[networkRegion];
}
