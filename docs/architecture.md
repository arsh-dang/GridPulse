# GridPulse architecture

## Current (local dev)

```
                          MQTT broker (mosquitto)
                       ┌──────────────────────────┐
OpenElectricity API    │                          │
        │              │  gridpulse/price/<REGION>│
        ▼              │  gridpulse/spike/<REGION>│
price-ingest-service ──┼─►                        │
  (falls back to        │  gridpulse/<REGION>/     │
   historical CSV)      │    <batteryId>/telemetry │◄── simulator/batteryNode
                        │                          │      (x1000+ instances)
                        │  gridpulse/dispatch/     │
Node-RED flow ─────────►│    <REGION>              │
 (mqtt in -> price>300  │                          │
  -> mqtt out)          └──────────────────────────┘
                                    ▲   │
                                    │   ▼
                          simulator/fleetMonitor
                          simulator/dispatchListener
```

`dispatch-optimizer-service` is not built yet — the Node-RED flow's simple
threshold rule stands in for it during early development. It will replace
that rule once it consumes `PriceSpikeDetected` + `BatteryTelemetry` and
emits `DispatchDecision` in its place.

## Target (AWS)

- **IoT Core** — MQTT broker replacement; battery simulators (and eventually
  real devices) publish telemetry here.
- **EventBridge** — carries `PriceUpdated`, `PriceSpikeDetected`,
  `DispatchDecision` between services as the event bus.
- **SQS** — buffers events into `dispatch-optimizer-service` so a burst of
  spikes/telemetry doesn't overwhelm it.
- **ECS Fargate** — runs `price-ingest-service` and
  `dispatch-optimizer-service` as long-lived containers.
- **DynamoDB** — battery fleet state (SoC, last-seen telemetry) that the
  optimizer reads before making a dispatch decision.

## Event contracts

Defined once in `packages/shared/src/events`, with a zod schema alongside
every TypeScript type, so every service validates events crossing a service
boundary rather than trusting the type system alone:

- `PriceUpdated` — every 5-minute NEM interval, spike or not.
- `PriceSpikeDetected` — emitted alongside `PriceUpdated` when price exceeds
  the configured threshold.
- `BatteryTelemetry` — one simulated battery's state at a point in time.
- `DispatchDecision` — an instruction to charge/discharge/hold, fleet-wide
  or targeted at one battery.
