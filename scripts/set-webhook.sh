#!/bin/sh
set -eu
: "${TELEGRAM_BOT_TOKEN:?Задайте TELEGRAM_BOT_TOKEN}"
: "${WEBHOOK_SECRET:?Задайте WEBHOOK_SECRET}"
: "${WORKER_URL:?Задайте WORKER_URL, например https://alekseev-job-bot.<account>.workers.dev}"

curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WORKER_URL%/}/telegram" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]'
echo
