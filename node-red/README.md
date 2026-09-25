# node-red

Exported flow: `mqtt in (gridpulse/price/VIC)` → `function (if price > $300/MWh)`
→ `mqtt out (gridpulse/dispatch/VIC)`.

This is the original threshold-rule prototype. It stands in for
`dispatch-optimizer-service` until that service exists — same input topic,
same output topic, so swapping one for the other is transparent to the
simulator's `dispatchListener`.

## Import

1. Run Node-RED (`npx node-red` or your existing install).
2. Menu → Import → paste `flows.json` (or Import → select file).
3. Deploy. Requires an MQTT broker at `localhost:1883` matching the
   `gridpulse-mqtt-broker` config node (edit it if yours differs).
