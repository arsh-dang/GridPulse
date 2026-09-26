#!/usr/bin/env bash
# Step 4: scale the optimiser on the SQS backlog.
#   Scale out: messages waiting > 100 for a minute. The bigger the backlog,
#              the bigger the step (+1, +2, +3 tasks).
#   Scale in:  backlog plus new arrivals < 50 for 3 minutes, one task at a time.
# Scaling in on "backlog plus arrivals" rather than backlog alone stops the
# service shrinking while the load is still running but being kept up with.
# FILL(..., 0) matters: SQS stops reporting NumberOfMessagesSent when nothing
# is sent, and without it the sum is empty and the alarm never fires.
source "$(dirname "$0")/common.sh"

RESOURCE_ID="service/${CLUSTER}/${SERVICE}"

step "Register the service as a scalable target ($MIN_TASKS to $MAX_TASKS tasks)"
aws application-autoscaling register-scalable-target --service-namespace ecs \
  --resource-id "$RESOURCE_ID" --scalable-dimension ecs:service:DesiredCount \
  --min-capacity "$MIN_TASKS" --max-capacity "$MAX_TASKS"

step "Step scaling policies"
OUT_ARN="$(aws application-autoscaling put-scaling-policy --service-namespace ecs \
  --resource-id "$RESOURCE_ID" --scalable-dimension ecs:service:DesiredCount \
  --policy-name gridpulse-scale-out --policy-type StepScaling \
  --step-scaling-policy-configuration '{
    "AdjustmentType": "ChangeInCapacity",
    "Cooldown": 60,
    "MetricAggregationType": "Maximum",
    "StepAdjustments": [
      { "MetricIntervalLowerBound": 0,    "MetricIntervalUpperBound": 900,  "ScalingAdjustment": 1 },
      { "MetricIntervalLowerBound": 900,  "MetricIntervalUpperBound": 4900, "ScalingAdjustment": 2 },
      { "MetricIntervalLowerBound": 4900, "ScalingAdjustment": 3 }
    ]}' --query PolicyARN --output text)"
IN_ARN="$(aws application-autoscaling put-scaling-policy --service-namespace ecs \
  --resource-id "$RESOURCE_ID" --scalable-dimension ecs:service:DesiredCount \
  --policy-name gridpulse-scale-in --policy-type StepScaling \
  --step-scaling-policy-configuration '{
    "AdjustmentType": "ChangeInCapacity",
    "Cooldown": 60,
    "MetricAggregationType": "Maximum",
    "StepAdjustments": [ { "MetricIntervalUpperBound": 0, "ScalingAdjustment": -1 } ]}' \
  --query PolicyARN --output text)"
echo "scale-out: $OUT_ARN"
echo "scale-in:  $IN_ARN"

step "CloudWatch alarms that drive the policies"
aws cloudwatch put-metric-alarm --alarm-name gridpulse-backlog-high \
  --alarm-description "Scale out: more than 100 GridPulse events waiting" \
  --namespace AWS/SQS --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions "Name=QueueName,Value=$QUEUE_NAME" \
  --statistic Maximum --period 60 --evaluation-periods 1 \
  --threshold 100 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching --alarm-actions "$OUT_ARN"

cat > /tmp/gridpulse-idle-metrics.json << JSON
[
  { "Id": "visible", "ReturnData": false, "MetricStat": { "Period": 60, "Stat": "Maximum",
    "Metric": { "Namespace": "AWS/SQS", "MetricName": "ApproximateNumberOfMessagesVisible",
                "Dimensions": [ { "Name": "QueueName", "Value": "$QUEUE_NAME" } ] } } },
  { "Id": "sent", "ReturnData": false, "MetricStat": { "Period": 60, "Stat": "Sum",
    "Metric": { "Namespace": "AWS/SQS", "MetricName": "NumberOfMessagesSent",
                "Dimensions": [ { "Name": "QueueName", "Value": "$QUEUE_NAME" } ] } } },
  { "Id": "idle", "Expression": "FILL(visible, 0) + FILL(sent, 0)", "Label": "Backlog plus arrivals per minute", "ReturnData": true }
]
JSON
aws cloudwatch put-metric-alarm --alarm-name gridpulse-backlog-idle \
  --alarm-description "Scale in: queue empty and no new events for 3 minutes" \
  --metrics file:///tmp/gridpulse-idle-metrics.json --evaluation-periods 3 \
  --threshold 50 --comparison-operator LessThanThreshold \
  --treat-missing-data breaching --alarm-actions "$IN_ARN"
echo "gridpulse-backlog-high, gridpulse-backlog-idle"

step "CloudWatch dashboard 'gridpulse' (screenshot this during the demo)"
cat > /tmp/gridpulse-dashboard.json << JSON
{
  "widgets": [
    { "type": "metric", "x": 0, "y": 0, "width": 12, "height": 7, "properties": {
      "title": "SQS: events waiting, arriving and processed per minute", "region": "$AWS_REGION",
      "view": "timeSeries", "stat": "Sum", "period": 60,
      "metrics": [
        [ "AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "$QUEUE_NAME", { "stat": "Maximum", "label": "Waiting (backlog)" } ],
        [ "AWS/SQS", "NumberOfMessagesSent", "QueueName", "$QUEUE_NAME", { "label": "Arriving" } ],
        [ "AWS/SQS", "NumberOfMessagesDeleted", "QueueName", "$QUEUE_NAME", { "label": "Processed" } ]
      ] } },
    { "type": "metric", "x": 12, "y": 0, "width": 12, "height": 7, "properties": {
      "title": "ECS: optimiser tasks", "region": "$AWS_REGION", "view": "timeSeries",
      "stat": "Average", "period": 60,
      "metrics": [
        [ "ECS/ContainerInsights", "DesiredTaskCount", "ClusterName", "$CLUSTER", "ServiceName", "$SERVICE", { "label": "Desired" } ],
        [ "ECS/ContainerInsights", "RunningTaskCount", "ClusterName", "$CLUSTER", "ServiceName", "$SERVICE", { "label": "Running" } ]
      ] } },
    { "type": "metric", "x": 0, "y": 7, "width": 12, "height": 6, "properties": {
      "title": "ECS: optimiser CPU %", "region": "$AWS_REGION", "view": "timeSeries",
      "stat": "Average", "period": 60,
      "metrics": [ [ "AWS/ECS", "CPUUtilization", "ClusterName", "$CLUSTER", "ServiceName", "$SERVICE" ] ] } },
    { "type": "alarm", "x": 12, "y": 7, "width": 12, "height": 6, "properties": {
      "title": "Scaling alarms",
      "alarms": [
        "arn:aws:cloudwatch:${AWS_REGION}:${ACCOUNT_ID}:alarm:gridpulse-backlog-high",
        "arn:aws:cloudwatch:${AWS_REGION}:${ACCOUNT_ID}:alarm:gridpulse-backlog-idle"
      ] } }
  ]
}
JSON
aws cloudwatch put-dashboard --dashboard-name gridpulse --dashboard-body file:///tmp/gridpulse-dashboard.json >/dev/null
echo "https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards/dashboard/gridpulse"

step "Done. Next: start 05-watch.sh in one terminal and the load generator in another"
