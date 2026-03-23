#!/bin/bash
TOTAL=0
ZEROS=0
BATCH=0

while true; do
  BATCH=$((BATCH + 1))
  echo ""
  echo "=== Batch $BATCH | Total minted so far: $TOTAL ==="

  RESPONSE=$(curl -s -X POST http://localhost:3000/api/admin/drain-mint-queue \
    -H "Authorization: Bearer some-long-random-string" \
    -H "Content-Type: application/json" \
    -d '{"maxJobs": 100}')

  echo "$RESPONSE" | jq .

  ACQUIRED=$(echo "$RESPONSE" | jq -r '.acquired // "false"')
  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed // 0')

  # Lock held by another run — wait for it to expire
  if [ "$ACQUIRED" = "false" ]; then
    echo "⏳ Lock busy, waiting 40s for it to expire..."
    sleep 40
    continue
  fi

  TOTAL=$((TOTAL + PROCESSED))

  if [ "$PROCESSED" = "0" ]; then
    ZEROS=$((ZEROS + 1))
    echo "✓ No pending jobs ($ZEROS/3 consecutive empty batches)"
    [ $ZEROS -ge 3 ] && break
    sleep 5
  else
    ZEROS=0
    sleep 5
  fi
done

echo ""
echo "✅ Done! Total minted this run: $TOTAL"
