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

Locally, the Node-RED flow's threshold rule still works as a simple stand-in
for the optimiser, which is useful for development without AWS.

## Deployed (AWS)

```
price-ingest-service --+
                       +-- MQTT/TLS --> IoT Core --rule--> SQS --> ECS Fargate optimiser --> DynamoDB
simulator (fleet) -----+                                   |            (1 to 8 tasks)
                                                           +--> DLQ     ^
                                           CloudWatch alarm on backlog -+
```

- **IoT Core**: replaces the local broker. Publishers authenticate with an
  X.509 certificate; the device policy only allows `gridpulse-*` client IDs
  and `gridpulse/*` topics. A topic rule forwards the three inbound event
  types to SQS.
- **SQS**: buffers events so a burst of telemetry queues up instead of
  overwhelming the optimiser. The backlog is also the scaling signal.
  Messages that fail 5 times go to a dead-letter queue.
- **ECS Fargate**: runs `dispatch-optimizer-service`, 1 to 8 tasks. Step
  scaling adds tasks when more than 100 events are waiting and removes them
  once the queue is empty with no new arrivals.
- **DynamoDB**: `gridpulse-prices` holds the latest price per region, shared
  by every task; `gridpulse-dispatch` holds the latest decision per battery,
  tagged with the task that made it.

EventBridge was in the original plan. It was dropped because the IoT rule can
write to SQS directly, and SQS provides the backlog metric that drives
scaling. `price-ingest-service` runs as a process rather than on Fargate: it
polls once every 5 minutes and has no scaling need.

Scripts and the demo runbook are in [`infra/README.md`](../infra/README.md).

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

## Edge filtering at the fleet gateway (HD extension)

In the 6.3D design every battery sample became an IoT message, an SQS
message and an optimiser decision, so cloud cost grew linearly with fleet
size and sampling rate. The fleet gateway now runs a reporting policy
(`simulator/src/edge/reportingPolicy.ts`) before publishing:

- **send-on-delta**: publish a battery's reading only when its state of
  charge has moved by at least `delta` since the last published value, or
  after `heartbeatS` of silence (Miskowicz, 2006)
- **price-class flush**: when the regional price moves between cheap,
  normal and spike, every battery reports on its next sample, so the cloud
  re-decides the whole fleet against the new price straight away
- **boundary triggers**: a battery that crosses the reserve or full level
  reports immediately

The cloud side is unchanged: the optimiser still decides per reading, and the
dispatch policy was moved into `packages/shared` so the gateway, the
experiments and the optimiser all use the same code. Experiments are in
[`infra/EXPERIMENTS.md`](../infra/EXPERIMENTS.md).
