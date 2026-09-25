#!/usr/bin/env bash
# Step 1: the queue between IoT Core and the optimiser, plus the two tables.
source "$(dirname "$0")/common.sh"

step "SQS dead-letter queue"
DLQ_URL="$(aws sqs create-queue --queue-name "$DLQ_NAME" --query QueueUrl --output text)"
DLQ_ARN="$(aws sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)"
echo "$DLQ_URL"

step "SQS event queue (messages that fail 5 times go to the DLQ)"
cat > /tmp/gridpulse-queue-attrs.json << JSON
{
  "VisibilityTimeout": "60",
  "ReceiveMessageWaitTimeSeconds": "20",
  "MessageRetentionPeriod": "86400",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"}"
}
JSON
QUEUE_URL="$(aws sqs create-queue --queue-name "$QUEUE_NAME" --attributes file:///tmp/gridpulse-queue-attrs.json --query QueueUrl --output text)"
QUEUE_ARN="$(aws sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)"
echo "$QUEUE_URL"
save QUEUE_URL "$QUEUE_URL"
save QUEUE_ARN "$QUEUE_ARN"

make_table() {
  local name="$1" key="$2"
  if aws dynamodb describe-table --table-name "$name" >/dev/null 2>&1; then
    echo "$name already exists"
  else
    aws dynamodb create-table --table-name "$name" \
      --attribute-definitions "AttributeName=$key,AttributeType=S" \
      --key-schema "AttributeName=$key,KeyType=HASH" \
      --billing-mode PAY_PER_REQUEST >/dev/null
    aws dynamodb wait table-exists --table-name "$name"
    echo "$name created"
  fi
}

step "DynamoDB tables (on-demand capacity, so writes scale with the fleet)"
make_table "$PRICES_TABLE" region
make_table "$DISPATCH_TABLE" batteryId
save PRICES_TABLE "$PRICES_TABLE"
save DISPATCH_TABLE "$DISPATCH_TABLE"

step "Done. Next: bash infra/aws/02-iot.sh"
