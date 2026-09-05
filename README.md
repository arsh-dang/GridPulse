# GridPulse

Virtual Power Plant dispatch optimiser — SIT314 distinction project, Deakin.

GridPulse ingests real 5-minute Australian NEM wholesale electricity prices,
manages a simulated fleet of 1,000+ home batteries, and dispatches them to
discharge during price spikes. Built as event-driven microservices, targeting
AWS (IoT Core, EventBridge, SQS, ECS Fargate, DynamoDB) for the final
deployment; runs locally over MQTT for development.

See [`docs/architecture.md`](docs/architecture.md) for the full event flow
and the local-vs-AWS architecture diagrams.

## Layout

```
packages/shared/                     Shared event types + zod schemas (the integration surface)
services/price-ingest-service/       Polls OpenElectricity for NEM prices, detects spikes, publishes events
services/dispatch-optimizer-service/ Not built yet — stub + README describing planned design
simulator/                           Simulated battery fleet, fleet monitor, price feed, dispatch listener
node-red/                            Exported flow: threshold dispatch rule (stands in for the optimizer)
infra/                               Terraform (AWS), not started
docs/                                Architecture notes
```

## Why TypeScript + zod

The events (`PriceUpdated`, `PriceSpikeDetected`, `BatteryTelemetry`,
`DispatchDecision`) are the integration surface between every service.
They're defined once in `packages/shared` so every service imports the same
type — and validated with zod at runtime everywhere they cross a service
boundary, since types disappear at compile time and nothing arriving over
MQTT (or, later, EventBridge) can be trusted blindly.

## Getting started

Requires Node.js 20+ and an MQTT broker (e.g. `mosquitto`) running locally.

```bash
npm install                                          # installs all workspaces
npm run build --workspace @gridpulse/shared           # shared types must build first
```

Then, in separate terminals as needed:

```bash
# Real NEM prices (needs an OpenElectricity API key — see services/price-ingest-service/.env.example)
npm run dev --workspace @gridpulse/price-ingest-service

# OR a synthetic price curve, no API key needed
npm run price-feed --workspace @gridpulse/simulator

npm run battery --workspace @gridpulse/simulator
npm run fleet-monitor --workspace @gridpulse/simulator
npm run dispatch-listener --workspace @gridpulse/simulator
```

Import `node-red/flows.json` into Node-RED to run the threshold dispatch
rule that reacts to price spikes (see `node-red/README.md`).

## Testing

```bash
npm run test --workspaces --if-present
```

`price-ingest-service` mocks all HTTP calls — no test ever hits the real
OpenElectricity API.

## Services

| Service | Status | Purpose |
|---|---|---|
| `price-ingest-service` | Built | Polls OpenElectricity, normalises + detects spikes, publishes events |
| `dispatch-optimizer-service` | Stub | Will consume spikes + telemetry, decide which batteries discharge |
| `simulator` | Built | Simulated battery fleet, fleet monitor, synthetic price feed, dispatch listener |

## Secrets

Never commit a `.env` file. Copy `.env.example` (root and per-service) to
`.env` and fill in real values locally.
