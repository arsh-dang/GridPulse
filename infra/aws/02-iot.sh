#!/usr/bin/env bash
# Step 2: IoT Core. A device certificate and policy for the publishers, and a
# rule that forwards every valid GridPulse event to the SQS queue.
source "$(dirname "$0")/common.sh"
: "${QUEUE_URL:?run 01-data.sh first}"

step "IoT Core data endpoint"
ENDPOINT="$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)"
echo "$ENDPOINT"

step "Device certificate"
mkdir -p "$CERTS"
if [ -f "$CERTS/device.pem.crt" ] && [ -n "${CERT_ARN:-}" ]; then
  echo "Reusing $CERT_ARN"
else
  CERT_ARN="$(aws iot create-keys-and-certificate --set-as-active \
    --certificate-pem-outfile "$CERTS/device.pem.crt" \
    --public-key-outfile "$CERTS/public.pem.key" \
    --private-key-outfile "$CERTS/private.pem.key" \
    --query certificateArn --output text)"
  chmod 600 "$CERTS/private.pem.key"
  echo "Created $CERT_ARN"
fi
curl -sS -o "$CERTS/AmazonRootCA1.pem" https://www.amazontrust.com/repository/AmazonRootCA1.pem
save CERT_ARN "$CERT_ARN"

step "Device policy (least privilege: gridpulse client IDs and topics only)"
cat > /tmp/gridpulse-iot-policy.json << JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "iot:Connect",
      "Resource": "arn:aws:iot:${AWS_REGION}:${ACCOUNT_ID}:client/gridpulse-*" },
    { "Effect": "Allow", "Action": ["iot:Publish", "iot:Receive"],
      "Resource": "arn:aws:iot:${AWS_REGION}:${ACCOUNT_ID}:topic/gridpulse/*" },
    { "Effect": "Allow", "Action": "iot:Subscribe",
      "Resource": "arn:aws:iot:${AWS_REGION}:${ACCOUNT_ID}:topicfilter/gridpulse/*" }
  ]
}
JSON
aws iot create-policy --policy-name "$IOT_POLICY" --policy-document file:///tmp/gridpulse-iot-policy.json >/dev/null 2>&1 \
  && echo "Policy created" || echo "Policy already exists"
aws iot attach-policy --policy-name "$IOT_POLICY" --target "$CERT_ARN"

step "Thing (represents the fleet gateway in the IoT Core console)"
aws iot create-thing --thing-name "$IOT_THING" >/dev/null 2>&1 || true
aws iot attach-thing-principal --thing-name "$IOT_THING" --principal "$CERT_ARN"

step "Topic rule: GridPulse events -> SQS"
cat > /tmp/gridpulse-rule.json << JSON
{
  "sql": "SELECT * FROM 'gridpulse/#' WHERE type = 'BatteryTelemetry' OR type = 'PriceUpdated' OR type = 'PriceSpikeDetected'",
  "awsIotSqlVersion": "2016-03-23",
  "ruleDisabled": false,
  "actions": [ { "sqs": { "queueUrl": "$QUEUE_URL", "roleArn": "$LAB_ROLE_ARN", "useBase64": false } } ]
}
JSON
if aws iot get-topic-rule --rule-name "$IOT_RULE" >/dev/null 2>&1; then
  aws iot replace-topic-rule --rule-name "$IOT_RULE" --topic-rule-payload file:///tmp/gridpulse-rule.json
  echo "Rule updated"
else
  aws iot create-topic-rule --rule-name "$IOT_RULE" --topic-rule-payload file:///tmp/gridpulse-rule.json
  echo "Rule created"
fi

save MQTT_URL "mqtts://${ENDPOINT}:8883"
save MQTT_CA_PATH "$CERTS/AmazonRootCA1.pem"
save MQTT_CERT_PATH "$CERTS/device.pem.crt"
save MQTT_KEY_PATH "$CERTS/private.pem.key"
save IOT_ENDPOINT "$ENDPOINT"

step "Checking the rule end to end: publish to IoT Core, look for it in SQS"
CHECK_ID="rule-check-$(date +%s)"
PAYLOAD="{\"type\":\"BatteryTelemetry\",\"batteryId\":\"$CHECK_ID\",\"region\":\"VIC\",\"soc\":0.5,\"solarKw\":0,\"loadKw\":1,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
aws iot-data publish --endpoint-url "https://$ENDPOINT" --topic "gridpulse/VIC/$CHECK_ID/telemetry" \
  --cli-binary-format raw-in-base64-out --payload "$PAYLOAD"

for _ in 1 2 3 4; do
  MSG="$(aws sqs receive-message --queue-url "$QUEUE_URL" --wait-time-seconds 5 --max-number-of-messages 10 --output json)"
  if echo "$MSG" | grep -q "$CHECK_ID"; then
    echo "$MSG" | python3 -c 'import json,sys
for m in json.load(sys.stdin).get("Messages",[]): print(m["ReceiptHandle"])' | while read -r h; do
      aws sqs delete-message --queue-url "$QUEUE_URL" --receipt-handle "$h"
    done
    printf '\n\033[32mPASS\033[0m IoT Core -> rule -> SQS is working.\n'
    step "Done. Next: bash infra/aws/03-deploy.sh"
    exit 0
  fi
done

printf '\n\033[31mFAIL\033[0m The test message did not reach SQS within 20s.\n'
echo "Most likely LabRole cannot be assumed by IoT Core in this lab."
echo "Carry on with 03-deploy.sh anyway, and run the load generator with TRANSPORT=sqs."
exit 1
