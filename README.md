# PENGU Terminal

A fast, read-only PENGU/USDT dashboard for Bitunix. It uses Bitunix's public REST endpoints for initial candle history and the public WebSocket for live ticker, trades, and 1m/5m/15m Kline updates.

## Run locally

```bash
python3 -m http.server 8000
```

Open http://localhost:8000

## Personalize

Edit `config.js` and set `entryPrice` and `positionQty` if you want the trade-plan card to show your levels and unrealized P/L.

## GitHub Pages

This is a static site, so it can be hosted directly from a GitHub repository with GitHub Pages. In the repo Settings → Pages, choose the main branch as the publishing source.

No Bitunix API key is used. Do not put a private API secret in this frontend.

## Decision engine

The displayed signal is a transparent rule-based indicator using:
- 5m EMA9/EMA21
- 15m EMA21
- 1m/5m RSI
- 10m/3m momentum
- live trade flow
- volume expansion

It is not a prediction or guarantee of profit and does not place orders.
