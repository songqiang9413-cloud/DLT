#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/dlt-bot
SERVICE=dlt-bot

if ! id -u dltbot >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /sbin/nologin dltbot
fi

mkdir -p "$APP_DIR"
chown -R dltbot:dltbot "$APP_DIR"
chmod 750 "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "ERROR: $APP_DIR/.env is missing" >&2
  exit 1
fi
chown dltbot:dltbot "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

if [ ! -d "$APP_DIR/node_modules" ]; then
  cd "$APP_DIR"
  npm ci --omit=dev --no-audit --no-fund
  chown -R dltbot:dltbot "$APP_DIR/node_modules"
fi

if command -v restorecon >/dev/null 2>&1; then
  restorecon -Rv "$APP_DIR" >/dev/null || true
fi

install -m 0644 "$APP_DIR/dlt-bot.service" "/etc/systemd/system/${SERVICE}.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE"
systemctl --no-pager --full status "$SERVICE" || true
