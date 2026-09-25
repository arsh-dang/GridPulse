import fs from "node:fs";
import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { PriceUpdated, PriceSpikeDetected } from "@gridpulse/shared";
import type { EventPublisher } from "./EventPublisher.js";
import { logger } from "../logger.js";

/**
 * Publishes to the same topic layout the existing Node-RED flow and
 * simulator already expect: gridpulse/price/<REGION> and
 * gridpulse/spike/<REGION>. Keeping this topic scheme means the
 * price-ingest-service is a drop-in replacement for price_feed.js.
 *
 * The same class publishes to AWS IoT Core: give it an mqtts:// endpoint
 * and certificate paths and it connects with mutual TLS. Nothing else in
 * the service changes.
 */
export interface MqttTlsOptions {
  clientId?: string;
  caPath?: string;
  certPath?: string;
  keyPath?: string;
}

export class MqttEventPublisher implements EventPublisher {
  private client: MqttClient | undefined;

  constructor(
    private readonly brokerUrl: string,
    private readonly tls: MqttTlsOptions = {},
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(this.brokerUrl, buildClientOptions(this.tls));
      client.once("connect", () => {
        logger.info("Connected to MQTT broker", { brokerUrl: this.brokerUrl, tls: Boolean(this.tls.certPath) });
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

export function buildClientOptions(tls: MqttTlsOptions): IClientOptions {
  const options: IClientOptions = {};
  if (tls.clientId) options.clientId = tls.clientId;
  const { caPath, certPath, keyPath } = tls;
  if (caPath && certPath && keyPath) {
    options.ca = fs.readFileSync(caPath);
    options.cert = fs.readFileSync(certPath);
    options.key = fs.readFileSync(keyPath);
    options.protocol = "mqtts";
  } else if (caPath || certPath || keyPath) {
    throw new Error("MQTT TLS needs all three of MQTT_CA_PATH, MQTT_CERT_PATH and MQTT_KEY_PATH");
  }
  return options;
}
