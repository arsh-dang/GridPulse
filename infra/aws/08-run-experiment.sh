#!/usr/bin/env bash
# Runs one named scaling experiment end to end:
#   bash infra/aws/08-run-experiment.sh E2-edge-5k
#
# The settings for each experiment are defined below, not passed on the
# command line, so a mangled paste cannot silently run the wrong experiment.
# The script also checks the load generator's own startup line against the
# preset and stops within seconds if they disagree.
#
# Everything is logged to infra/aws/results/<label>-*:
#   -surge.log    load generator output
#   -watch.log    queue and task counts every 15 s for the whole window
#   -window.txt   start and end times (UTC)
#   .csv / .json  CloudWatch metrics per minute, and -summary.txt
source "$(dirname "$0")/common.sh"
LABEL="${1:?experiment name: E1-periodic-5k, E2-edge-5k or E3-edge-50k}"

case "$LABEL" in
  E1-periodic-5k) EDGE_MODE=periodic;  BATTERIES=5000;  SAMPLE_RATE=800;  CONNECTIONS=12 ;;
  E2-edge-5k)     EDGE_MODE=sod-aware; BATTERIES=5000;  SAMPLE_RATE=800;  CONNECTIONS=12 ;;
  E3-edge-50k)    EDGE_MODE=sod-aware; BATTERIES=50000; SAMPLE_RATE=8000; CONNECTIONS=60 ;;
  *) echo "Unknown experiment '$LABEL'. Use E1-periodic-5k, E2-edge-5k or E3-edge-50k."; exit 1 ;;
esac
DELTA=0.01; HEARTBEAT_S=120; DURATION_S=600; SPIKE_AT_S=120
export EDGE_MODE BATTERIES SAMPLE_RATE CONNECTIONS DELTA HEARTBEAT_S DURATION_S SPIKE_AT_S

R="$HERE/results"; mkdir -p "$R"
cd "$REPO_ROOT"
set -a; source "$OUT"; set +a

step "$LABEL: $EDGE_MODE, $BATTERIES batteries, $SAMPLE_RATE samples/s, ${DURATION_S}s, spike at ${SPIKE_AT_S}s"
START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$LABEL started $START" | tee "$R/$LABEL-window.txt"

# Background watch log for the whole window (no tmux scrollback needed).
(
  printf '%-8s %9s %9s %8s %8s %8s\n' TIME WAITING INFLIGHT DESIRED RUNNING PENDING
  while true; do
    read -r VIS INF <<< "$(aws sqs get-queue-attributes --queue-url "$QUEUE_URL" \
      --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
      --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible]' --output text)"
    read -r DES RUN PEN <<< "$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
      --query 'services[0].[desiredCount,runningCount,pendingCount]' --output text)"
    printf '%-8s %9s %9s %8s %8s %8s\n' "$(date -u +%H:%M:%S)" "$VIS" "$INF" "$DES" "$RUN" "$PEN"
    sleep 15
  done
) > "$R/$LABEL-watch.log" 2>&1 &
WATCH_PID=$!
trap 'kill $WATCH_PID 2>/dev/null' EXIT

# Start the surge, then confirm it is running the preset before going further.
npm run --silent surge -w @gridpulse/simulator > "$R/$LABEL-surge.log" 2>&1 &
SURGE_PID=$!
for _ in $(seq 1 30); do grep -q "Fleet surge:" "$R/$LABEL-surge.log" && break; sleep 1; done
CONFIG_LINE="$(grep "Fleet surge:" "$R/$LABEL-surge.log" || true)"
echo "$CONFIG_LINE"
if ! echo "$CONFIG_LINE" | grep -q "^Fleet surge: $BATTERIES batteries" \
   || ! echo "$CONFIG_LINE" | grep -q "edge mode $EDGE_MODE" \
   || ! echo "$CONFIG_LINE" | grep -q "${DURATION_S}s via"; then
  kill "$SURGE_PID" 2>/dev/null
  printf '\n\033[31mSTOPPED\033[0m the load generator is not running the %s preset. Nothing was wasted.\n' "$LABEL"
  cat "$R/$LABEL-surge.log"
  exit 1
fi
printf '\033[32mOK\033[0m settings confirmed. Progress every 5 s:\n'
tail -n +2 -f "$R/$LABEL-surge.log" --pid "$SURGE_PID"
wait "$SURGE_PID"

step "Surge finished. Waiting for the service to scale back to 1 task with an empty queue"
calm=0
for _ in $(seq 1 60); do
  read -r VIS INF <<< "$(aws sqs get-queue-attributes --queue-url "$QUEUE_URL" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
    --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible]' --output text)"
  read -r DES RUN <<< "$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query 'services[0].[desiredCount,runningCount]' --output text)"
  echo "$(date -u +%H:%M:%S)  waiting=$VIS inflight=$INF desired=$DES running=$RUN"
  if [ "$VIS" = 0 ] && [ "$INF" = 0 ] && [ "$DES" = 1 ] && [ "$RUN" = 1 ]; then calm=$((calm + 1)); else calm=0; fi
  [ "$calm" -ge 3 ] && break
  sleep 30
done

END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$LABEL ended $END" | tee -a "$R/$LABEL-window.txt"
step "Waiting 3 minutes for CloudWatch to publish the last datapoints"
sleep 180
bash "$HERE/07-metrics.sh" "$START" "$END" "$LABEL" | tee "$R/$LABEL-summary.txt"
