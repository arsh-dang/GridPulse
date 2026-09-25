import { z } from "zod";
import {
  BatteryTelemetrySchema,
  PriceSpikeDetectedSchema,
  PriceUpdatedSchema,
} from "@gridpulse/shared";

/**
 * Everything the IoT rule forwards to the queue. The shared contracts all
 * carry a literal `type`, so one discriminated union validates and narrows
 * in a single step.
 */
export const InboundEventSchema = z.discriminatedUnion("type", [
  PriceUpdatedSchema,
  PriceSpikeDetectedSchema,
  BatteryTelemetrySchema,
]);
export type InboundEvent = z.infer<typeof InboundEventSchema>;

export type ParseResult =
  | { ok: true; event: InboundEvent }
  | { ok: false; reason: string };

/** Parses an SQS message body. Never throws: bad input is a result, not an exception. */
export function parseMessageBody(body: string | undefined): ParseResult {
  if (!body) return { ok: false, reason: "empty body" };

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: "body is not JSON" };
  }

  const result = InboundEventSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, reason: result.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, event: result.data };
}
