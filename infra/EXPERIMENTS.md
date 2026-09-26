# HD experiments: edge filtering at the fleet gateway

Three runs on the same AWS stack as 6.3D. Each one is fully scripted by
`08-run-experiment.sh`: it records the time window, runs the surge, waits for
the service to scale back to one task, then pulls the CloudWatch metrics into
`infra/aws/results/`.

| Run | Fleet | Edge mode | What it tests |
|---|---|---|---|
| E1 | 5,000 | periodic | Baseline: every sample published |
| E2 | 5,000 | sod-aware | Same fleet with edge filtering: how much cloud work disappears |
| E3 | 50,000 | sod-aware | Ten times the fleet with edge filtering: does it fit in the capacity E1 needed |

All three use the same scenario: normal price for 2 minutes, then a $450/MWh
spike for the remaining 8 minutes. Each battery is sampled every 6.25 s.

## Before you start

The stack from 6.3D must be up (`01` to `04`). If you tore it down, run the
build box setup and `01` to `04` again from `infra/README.md`.

On the build box, pull the new code and build it:

```bash
cd ~/GridPulse && git pull && npm ci && npm run build
```

Check the service is idle: `bash infra/aws/05-watch.sh` should show
WAITING 0 and DESIRED 1. Stop it with Ctrl-C.

## Run the experiments

Each experiment is one short command. The settings live inside
`08-run-experiment.sh`, and the script checks the load generator's startup
line against them, stopping straight away if they disagree.

```bash
bash infra/aws/08-run-experiment.sh E1-periodic-5k
bash infra/aws/08-run-experiment.sh E2-edge-5k
bash infra/aws/08-run-experiment.sh E3-edge-50k
```

All three run for 10 minutes with the spike at 2 minutes, sampling each
battery every 6.25 s. E2 and E3 use send-on-delta with a 1% delta, a 120 s
heartbeat and the price-class flush. Each takes about 20 to 25 minutes
including scale-in. The script logs the queue and task counts every 15 s to
`results/<label>-watch.log`, so no screenshots of scrollback are needed.

## Evidence to capture

For each run:
- the last lines of the surge output (samples, published, suppressed %)
- the 05-watch pane around the spike (t = 2 min) and at peak task count
- the summary block printed at the end

After all three:
- the CloudWatch dashboard `gridpulse` on a 3-hour range, showing the three runs side by side
- `bash infra/aws/06-evidence.sh` (decisions by task, DLQ)
- the raw data: `cat infra/aws/results/*.csv infra/aws/results/*-window.txt`
  and paste the output into the chat, so the charts use the real numbers

## Offline experiment (no AWS needed)

`npm run edge-eval -w @gridpulse/simulator` runs the reporting policies
against a seeded 5,000-battery fleet and an oracle controller, and writes
`simulator/results/edge-eval.csv`. It takes about 4 minutes.
