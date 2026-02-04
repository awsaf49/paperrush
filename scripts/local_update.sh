#!/bin/bash
# Local update - mirrors GitHub workflow
# Usage: ./scripts/local_update.sh [conferences] [year]
# Examples:
#   ./scripts/local_update.sh                 # all conferences
#   ./scripts/local_update.sh cvpr,icml       # specific ones
#   ./scripts/local_update.sh cvpr,icml 2026  # with year

CONFS="${1:-cvpr,iccv,eccv,icml,neurips,iclr,aaai,acl,emnlp,naacl,interspeech,icassp,wacv,icip,iros}"
YEAR="${2:-2026}"

# Load .env
[ -f .env ] && export $(grep -v '^#' .env | xargs)

mkdir -p /tmp/scraped

# 1. Scrape each conference
IFS=',' read -ra LIST <<< "$CONFS"
for conf in "${LIST[@]}"; do
  echo "=== Scraping $conf ==="
  python scripts/scraper.py "$conf" --year "$YEAR" --output "/tmp/scraped/${conf}.json" --gemini -q || echo "⚠️ $conf failed"
  sleep 2
done

# 2. Merge into data.js (fallback logic is automatic)
echo "=== Updating data.js ==="
python scripts/update_from_scraper.py --input /tmp/scraped/*.json --output js/data.js

# 3. Preview
open index.html 2>/dev/null
echo "✅ Done!"
