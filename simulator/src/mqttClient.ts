import fs from "node:fs";
import mqtt, { type IClientOptions, type MqttClient } from "mqtt";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";

/**
 * Connection options from the environment. Setting MQTT_CA_PATH,
 * MQTT_CERT_PATH and MQTT_KEY_PATH switches to mutual TLS, which is what
 * AWS IoT Core requires; leaving them unset keeps the local mosquitto setup.
 */
export function mqttOptions(clientId?: string): IClientOptions {
  const options: IClientOptions = {};
  const id = clientId ?? process.env.MQTT_CLIENT_ID;
  if (id) options.clientId = id;
  const { MQTT_CA_PATH: ca, MQTT_CERT_PATH: cert, MQTT_KEY_PATH: key } = process.env;
  if (ca && cert && key) {
    options.ca = fs.readFileSync(ca);
    options.cert = fs.readFileSync(cert);
    options.key = fs.readFileSync(key);
    options.protocol = "mqtts";
  }
  return options;
}

/** Shared connect helper so every simulator script points at the same broker/env var. */
export function connectMqtt(clientId?: string): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_URL, mqttOptions(clientId));
    client.once("connect", () => resolve(client));
    client.once("error", (err) => reject(err));
  });
}
