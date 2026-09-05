import { z } from "zod";
import { NemRegionSchema } from "../region.js";

/**
 * A dispatch instruction for the fleet. batteryId is optional: absent
 * means the decision applies fleet-wide for the region (e.g. "discharge
 * everyone in VIC"), present means it targets one battery.
 */
export const DispatchActionSchema = z.enum(["DISCHARGE", "CHARGE", "HOLD"]);
export type DispatchAction = z.infer<typeof DispatchActionSchema>;

export const DispatchDecisionSchema = z.object({
  type: z.literal("DispatchDecision"),
  batteryId: z.string().optional(),
  region: NemRegionSchema,
  action: DispatchActionSchema,
  targetKw: z.number().optional(),
  reason: z.string(),
  ts: z.string().datetime({ offset: true }),
});
export type DispatchDecision = z.infer<typeof DispatchDecisionSchema>;
