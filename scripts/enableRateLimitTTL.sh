#!/usr/bin/env bash
# Enable Firestore TTL on the rate_limits collection.
# Requires gcloud CLI authenticated with a project owner account.
#
# Firestore will automatically delete documents from the 'rate_limits' collection
# when their 'expiresAt' timestamp field is in the past.
#
# Usage:
#   export GOOGLE_CLOUD_PROJECT=your-project-id
#   bash scripts/enableRateLimitTTL.sh

set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT env var}"

echo "Enabling TTL on rate_limits.expiresAt for project: $PROJECT"

gcloud firestore fields ttls update expiresAt \
  --collection-group=rate_limits \
  --enable-ttl \
  --project="$PROJECT"

echo "✅ TTL policy enabled. Firestore will auto-delete expired rate_limit docs."
