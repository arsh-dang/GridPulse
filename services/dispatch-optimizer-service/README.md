# dispatch-optimizer-service (stub)

Not built yet. Planned responsibility:

- Consume `PriceSpikeDetected` (and `BatteryTelemetry`) events.
- Decide which batteries in the affected region should discharge, given
  their state of charge, to flatten the spike without over-draining the
  fleet.
- Emit `DispatchDecision` events (see `@gridpulse/shared`) for the
  simulator's `dispatchListener` to act on.

## Planned inputs

- `PriceSpikeDetected` — from `price-ingest-service`, via MQTT today,
  EventBridge/SQS later.
- `BatteryTelemetry` — from the simulated fleet, to know current SoC per
  battery before deciding who discharges.

## Planned outputs

- `DispatchDecision` — one per targeted battery, or fleet-wide per region.

## Planned architecture

Will follow the same `EventPublisher`/consumer-interface pattern as
`price-ingest-service`, so the optimisation logic itself doesn't depend on
MQTT vs EventBridge.
