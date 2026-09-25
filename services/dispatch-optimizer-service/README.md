# dispatch-optimizer-service

Consumes GridPulse events from SQS, decides what each battery should do for
the next 5-minute interval, and stores the decision in DynamoDB. Runs on ECS
Fargate and scales on the SQS backlog (see `infra/aws`).

## Flow

```
IoT Core rule -> SQS gridpulse-events -> optimiser tasks (1..8) -> DynamoDB
                                                  |
                                                  +-> gridpulse-prices   (latest price per region)
                                                  +-> gridpulse-dispatch (latest decision per battery)
```

- `PriceUpdated` / `PriceSpikeDetected`: stored as the region's latest price,
  only if newer than the one held (conditional write, so out-of-order events
  across tasks never overwrite a newer price).
- `BatteryTelemetry`: decided with `policy.ts` and written to the dispatch
  table, tagged with the ECS task ID that made the decision.
- Anything else, or anything that fails the shared zod contracts, is logged
  and dropped. A batch that fails for another reason is left on the queue and
  goes to the dead-letter queue after 5 attempts.

## Policy (`src/policy.ts`)

| Price | Battery | Decision |
|---|---|---|
| >= spike threshold ($300/MWh) | above 20% reserve | DISCHARGE, up to 5 kW, never below reserve within the interval |
| <= cheap threshold ($50/MWh) | below 95% | CHARGE, up to 5 kW |
| older than 15 minutes, or none yet | any | HOLD |
| otherwise | any | HOLD |

The policy is a pure function, so it is unit tested without AWS and behaves
identically on every task.

## Run

```bash
npm run build -w @gridpulse/shared -w @gridpulse/dispatch-optimizer-service
QUEUE_URL=... AWS_REGION=us-east-1 npm start -w @gridpulse/dispatch-optimizer-service
npm test -w @gridpulse/dispatch-optimizer-service      # 16 tests
npm run summary -w @gridpulse/dispatch-optimizer-service  # decisions by task, after a demo
```

Configuration is in `src/config.ts` (all via environment variables).
