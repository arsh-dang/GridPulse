// The dispatch policy lives in @gridpulse/shared so the edge gateway
// simulator and the offline experiments use exactly the same decision logic
// as the cloud optimiser.
export { decide, CAPACITY_KWH } from "@gridpulse/shared";
export type { PolicyConfig, RegionPrice } from "@gridpulse/shared";
