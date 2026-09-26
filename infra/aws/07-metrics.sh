#!/usr/bin/env bash
# Pull per-minute CloudWatch metrics for one experiment window into a CSV,
# and print a summary. Times are UTC, e.g.:
#   bash infra/aws/07-metrics.sh 2026-09-27T01:00:00Z 2026-09-27T01:35:00Z E1-periodic-5k
source "$(dirname "$0")/common.sh"
START="${1:?start time (UTC ISO)}"; END="${2:?end time (UTC ISO)}"; LABEL="${3:?label}"
mkdir -p "$HERE/results"
RAW="$HERE/results/$LABEL.json"; CSV="$HERE/results/$LABEL.csv"

cat > /tmp/gridpulse-mdq.json << JSON
[
  { "Id": "iot", "MetricStat": { "Period": 60, "Stat": "Sum",
    "Metric": { "Namespace": "AWS/IoT", "MetricName": "PublishIn.Success", "Dimensions": [ { "Name": "Protocol", "Value": "MQTT" } ] } } },
  { "Id": "sent", "MetricStat": { "Period": 60, "Stat": "Sum",
    "Metric": { "Namespace": "AWS/SQS", "MetricName": "NumberOfMessagesSent", "Dimensions": [ { "Name": "QueueName", "Value": "$QUEUE_NAME" } ] } } },
  { "Id": "deleted", "MetricStat": { "Period": 60, "Stat": "Sum",
    "Metric": { "Namespace": "AWS/SQS", "MetricName": "NumberOfMessagesDeleted", "Dimensions": [ { "Name": "QueueName", "Value": "$QUEUE_NAME" } ] } } },
  { "Id": "backlog", "MetricStat": { "Period": 60, "Stat": "Maximum",
    "Metric": { "Namespace": "AWS/SQS", "MetricName": "ApproximateNumberOfMessagesVisible", "Dimensions": [ { "Name": "QueueName", "Value": "$QUEUE_NAME" } ] } } },
  { "Id": "running", "MetricStat": { "Period": 60, "Stat": "Average",
    "Metric": { "Namespace": "ECS/ContainerInsights", "MetricName": "RunningTaskCount", "Dimensions": [ { "Name": "ClusterName", "Value": "$CLUSTER" }, { "Name": "ServiceName", "Value": "$SERVICE" } ] } } },
  { "Id": "desired", "MetricStat": { "Period": 60, "Stat": "Average",
    "Metric": { "Namespace": "ECS/ContainerInsights", "MetricName": "DesiredTaskCount", "Dimensions": [ { "Name": "ClusterName", "Value": "$CLUSTER" }, { "Name": "ServiceName", "Value": "$SERVICE" } ] } } },
  { "Id": "cpu", "MetricStat": { "Period": 60, "Stat": "Average",
    "Metric": { "Namespace": "AWS/ECS", "MetricName": "CPUUtilization", "Dimensions": [ { "Name": "ClusterName", "Value": "$CLUSTER" }, { "Name": "ServiceName", "Value": "$SERVICE" } ] } } }
]
JSON
aws cloudwatch get-metric-data --metric-data-queries file:///tmp/gridpulse-mdq.json \
  --start-time "$START" --end-time "$END" --scan-by TimestampAscending --output json > "$RAW"

python3 - "$RAW" "$CSV" "$LABEL" << 'PY'
import json, sys
raw, csv_path, label = sys.argv[1:4]
series = {r["Id"]: dict(zip(r["Timestamps"], r["Values"])) for r in json.load(open(raw))["MetricDataResults"]}
cols = ["iot", "sent", "deleted", "backlog", "running", "desired", "cpu"]
stamps = sorted(set().union(*[s.keys() for s in series.values()]))
with open(csv_path, "w") as f:
    f.write("time," + ",".join(cols) + "\n")
    for t in stamps:
        f.write(t + "," + ",".join(f"{series[c].get(t, 0):.1f}" for c in cols) + "\n")
tot = lambda c: sum(series[c].values())
mx = lambda c: max(series[c].values(), default=0)
cpu = list(series["cpu"].values())
print(f"\n{label}  ({len(stamps)} minutes)")
print(f"  IoT Core publishes      {tot('iot'):>12,.0f}")
print(f"  SQS messages sent       {tot('sent'):>12,.0f}")
print(f"  SQS messages processed  {tot('deleted'):>12,.0f}")
print(f"  Peak backlog            {mx('backlog'):>12,.0f}")
print(f"  Peak running tasks      {mx('running'):>12.1f}")
print(f"  Task-minutes            {tot('running'):>12.1f}")
print(f"  Mean CPU %              {sum(cpu)/max(1,len(cpu)):>12.1f}")
print(f"\n  CSV: {csv_path}")
PY
