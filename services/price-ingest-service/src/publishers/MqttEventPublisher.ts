import mqtt, { type MqttClient } from "mqtt";
import type { PriceUpdated, PriceSpikeDetected } from "@gridpulse/shared";
import type { EventPublisher } from "./EventPublisher.js";
import { logger } from "../logger.js";

/**
 * Publishes to the same topic layout the existing Node-RED flow and
 * simulator already expect: gridpulse/price/<REGION> and
 * gridpulse/spike/<REGION>. Keeping this topic scheme means the
 * price-ingest-service is a drop-in replacement for price_feed.js.
 */
export class MqttEventPublisher implements EventPublisher {
  private client: MqttClient | undefined;

  constructor(private readonly brokerUrl: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(this.brokerUrl);
      client.once("connect", () => {
        logger.info("Connected to MQTT broker", { brokerUrl: this.brokerUrl });
        this.client = client;
        resolve();
      });
      client.once("error", (err) => reject(err));
    });
  }

  async disconnect(): Promise<void> {
    await this.client?.endAsync();
    this.client = undefined;
  }

  async publishPriceUpdated(event: PriceUpdated): Promise<void> {
    await this.publish(`gridpulse/price/${event.region}`, event);
  }

  async publishPriceSpikeDetected(event: PriceSpikeDetected): Promise<void> {
    await this.publish(`gridpulse/spike/${event.region}`, event);
  }

  private async publish(topic: string, payload: unknown): Promise<void> {
    if (!this.client) throw new Error("MqttEventPublisher.connect() must resolve before publishing");
    await this.client.publishAsync(topic, JSON.stringify(payload));
  }
}
