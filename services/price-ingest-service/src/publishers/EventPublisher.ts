import type { PriceUpdated, PriceSpikeDetected } from "@gridpulse/shared";

/**
 * Transport-agnostic publish surface. The service logic (poller, index.ts)
 * depends only on this interface, so swapping MQTT for an
 * EventBridgePublisher later is a one-line wiring change, not a rewrite.
 */
export interface EventPublisher {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publishPriceUpdated(event: PriceUpdated): Promise<void>;
  publishPriceSpikeDetected(event: PriceSpikeDetected): Promise<void>;
}
