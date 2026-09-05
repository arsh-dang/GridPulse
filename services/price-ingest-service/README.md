# price-ingest-service

Polls [OpenElectricity](https://docs.openelectricity.org.au) for 5-minute NEM
dispatch prices, normalises them into the shared `PriceUpdated` event, detects
spikes, and publishes both over MQTT for the rest of GridPulse.

## Run

```bash
cp .env.example .env   # then fill in OPENELECTRICITY_API_KEY
npm install             # from repo root, installs all workspaces
npm run build --workspace @gridpulse/shared
npm run dev --workspace @gridpulse/price-ingest-service
```

Requires an MQTT broker reachable at `MQTT_URL` (defaults to
`mqtt://localhost:1883`, e.g. `mosquitto` running locally).

## Behaviour

- Polls every `POLL_INTERVAL_MS` (default 300000 = 5 min).
- Publishes `PriceUpdated` to `gridpulse/price/<REGION>` on every interval.
- Publishes `PriceSpikeDetected` to `gridpulse/spike/<REGION>` when price
  exceeds `SPIKE_THRESHOLD` (default 300 AUD/MWh).
- If the OpenElectricity API is unreachable after retries, falls back to
  replaying `CSV_FALLBACK_PATH` (a historical AEMO-format price CSV) so a
  demo never stalls on the live API.
- Publishing goes through an `EventPublisher` interface (see
  `src/publishers/`); `MqttEventPublisher` is the only implementation today,
  an `EventBridgePublisher` can be added later without touching poller logic.

## Test

```bash
npm run test --workspace @gridpulse/price-ingest-service
```

Tests mock HTTP and never call the real API.
