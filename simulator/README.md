# simulator

TypeScript ports of the original coursework prototypes: a simulated fleet of
home batteries, a fleet-wide MQTT monitor, a standalone simulated price feed,
and a dispatch listener. All validate events against the shared zod schemas
at the MQTT boundary.

## Run

Requires an MQTT broker at `MQTT_URL` (default `mqtt://localhost:1883`).

```bash
npm run battery --workspace @gridpulse/simulator            # NUM_BATTERIES batteries (default 20)
npm run fleet-monitor --workspace @gridpulse/simulator       # watch all battery telemetry
npm run price-feed --workspace @gridpulse/simulator          # simulated price curve (no API needed)
npm run dispatch-listener --workspace @gridpulse/simulator   # watch dispatch decisions
```

Env vars: `REGION` (default VIC), `NUM_BATTERIES` (default 20, bump for a
1000+ fleet demo), `PUBLISH_INTERVAL_MS` (default 5000).

`priceFeed.ts` is independent of `price-ingest-service` — it's a synthetic
curve for developing/demoing the Node-RED flow without a live API key. For
real NEM prices, run `price-ingest-service` instead; it publishes to the
same `gridpulse/price/<REGION>` topic.
