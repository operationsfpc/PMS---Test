#!/bin/bash
# =====================================================
# Manually trigger email-dispatch edge function
# Run this to send all queued shortlist emails NOW
# =====================================================

# Load environment variables
source .env.local

echo "Triggering email-dispatch edge function..."
echo ""

# Call the edge function
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
  "https://apzsuclpydjkmaffppmr.supabase.co/functions/v1/email-dispatch" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}')

# Extract HTTP status and body
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS:/d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response: $BODY"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✓ Edge function triggered successfully!"
  echo "✓ Check Resend dashboard for delivery: https://resend.com"
else
  echo "✗ Edge function failed. Check the response above."
fi
