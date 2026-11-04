# DLT hourly lottery bot

One Node.js process. It bets one note (2 DLT) per UTC hour and, by default, also
acts as the draw keeper: `requestDraw` after the hour closes and `executeDraw`
after the 200-block wait. The draw calls are public and earn the fixed 10 + 20
DLT incentives, which is what keeps a one-bet-per-hour bot self-sustaining.

## What it does

- Reads the chain timestamp from the latest Base block (not the server clock).
- Bets once per period, at `BET_OFFSET_MINUTES` past the hour.
- Refuses to bet in the last `MIN_SECONDS_BEFORE_BOUNDARY` seconds of a period
  so a delayed transaction cannot silently land in the next period.
- Stores `lastBetPeriod` and pending draw periods in `state.json`.
- On startup, scans the last 48 periods to catch up on missed draws.
- Uses a lock file so two instances never run at once.
- Checks ETH balance and DLT balance before sending transactions.

## First run (dry run)

```bash
cd /opt/dlt-bot
cp .env.example .env
chmod 600 .env
# edit .env: set PRIVATE_KEY and confirm the contract addresses
npm ci --omit=dev --no-audit --no-fund
node bot.js --once --dry-run
```

A dry run prints what it would do but sends no transactions.

## Install as a systemd service

```bash
cd /opt/dlt-bot
sudo bash install.sh
```

`install.sh` creates the `dltbot` system user if missing, installs dependencies
locally, and enables `dlt-bot.service`. It does not touch Docker, existing
services, firewall rules, or global npm.

## Operations

```bash
systemctl status dlt-bot --no-pager
journalctl -u dlt-bot -n 100 --no-pager
journalctl -u dlt-bot -f
systemctl restart dlt-bot
systemctl stop dlt-bot
```

`RPC_URL` is used for balances, transactions and receipts. `LOG_RPC_URL` is
used only for `eth_getLogs` (the restart-safety bet scan); the public
`mainnet.base.org` endpoint currently rate-limits that method.

The state file is `/opt/dlt-bot/state.json`. The private key lives only in
`/opt/dlt-bot/.env` (mode 600). The bot never logs the key.

## Resource isolation

The unit runs as `dltbot`, with `CPUQuota=10%`, `MemoryMax=160M`, `Nice=10`,
`IOSchedulingPriority=7`, no listening ports, and `ProtectSystem=strict`.
It has no relationship to the existing Docker containers or their databases.

## Economics and gas

With one note per period and the draw keeper enabled, the expected per-period
inflow is 30 DLT of fixed incentives plus the winner/team share, against a 2 DLT
burn. The first 720 periods also have the promotion base pool. The bot only
needs ETH for gas; it does not sell DLT. At Base's current fee level, 0.000965
ETH lasts for many hundreds of transactions, but it is still finite. When ETH
falls below `MIN_ETH_BALANCE`, the bot logs and stops sending transactions.

## Security

The deployer key used for this bot is disposable and was exposed during setup.
Do not reuse this wallet for anything else. Do not put the private key in the
repository, chat, or logs.
