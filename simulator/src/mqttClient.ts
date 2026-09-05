import mqtt, { type MqttClient } from "mqtt";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";

/** Shared connect helper so every simulator script points at the same broker/env var. */
export function connectMqtt(): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_URL);
    client.once("connect", () => resolve(client));
    client.once("error", (err) => reject(err));
  });
}
