# MHP Market Research App

Private dashboard for screening mobile home park markets by address. The app is designed to be self-hosted and replicated without hardcoded private URLs, passwords, or API keys.

## Current Features

- Create a market report from a specific address
- Save previous markets locally
- Manual **Update Data** button only, so API calls/spend happen only when requested
- Configurable radius, default 30 miles
- Address autocomplete via Google Places API
- Census geocoder integration
- Census ACS comparison table for:
  - National
  - State
  - County
  - City/place, when available
  - ZIP/ZCTA, when available
- Local JSON persistence for MVP simplicity

## Planned Features

- HUD Fair Market Rent / SAFMR values for Section 8 rent estimates
- 10-year population growth by year
- Forecasted population growth
- Apify-powered rental listing pulls, using API calls only, no local headless browser
- Major employers within selected radius
- Crime statistics
- Map layer last: subject property, Walmart, grocery stores, major employers

## Data Source Notes

- Census does not provide true USPS ZIP-code geography. It provides **ZCTA** data, which approximates ZIP codes. The UI labels this as `ZIP/ZCTA`.
- Some postal ZIPs do not have ZCTA ACS data, especially non-residential/special-use ZIPs.
- Free sources are favored first. Paid APIs should be added only when free data is too weak.

## Requirements

- Node.js 20+
- Free Census API key: <https://api.census.gov/data/key_signup.html>
- Google Maps Platform key with:
  - Places API enabled
  - Geocoding API enabled

## Setup

```bash
cp .env.example .env
npm install
```

Edit `.env`:

```bash
PORT=5317
MARKET_APP_USERNAME=michael
MARKET_APP_PASSWORD=change-me
CENSUS_API_KEY=your-census-api-key
GOOGLE_PLACES_API_KEY=your-google-places-api-key
APP_BASE_URL=https://your-subdomain.example.com
```

Run locally:

```bash
set -a
source .env
set +a
npm start
```

Open:

```text
http://127.0.0.1:5317
```

If `MARKET_APP_PASSWORD` is set, use basic auth with `MARKET_APP_USERNAME` and `MARKET_APP_PASSWORD`.

## Healthcheck

```bash
npm run healthcheck
curl http://127.0.0.1:5317/health
```

With auth:

```bash
curl -u "$MARKET_APP_USERNAME:$MARKET_APP_PASSWORD" http://127.0.0.1:5317/health
```

## Deployment

This is a plain Node HTTP server. You can deploy it behind any reverse proxy or tunnel:

- Cloudflare Tunnel
- Nginx
- Caddy
- Vercel/Render/Railway/Fly.io with minor adaptation
- A systemd service on a VPS

### Example Cloudflare Tunnel ingress

```yaml
ingress:
  - hostname: markets.example.com
    service: http://127.0.0.1:5317
  - service: http_status:404
```

### Example systemd user service

```ini
[Unit]
Description=MHP Market Research App
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/MarketResearch
EnvironmentFile=/path/to/MarketResearch/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

## Privacy / Secrets

Do not commit `.env`, API keys, passwords, private URLs, or saved market data. This repo includes `.env.example` only.

## Storage

MVP storage is local JSON:

```text
data/markets.json
```

For multi-user/client-facing usage, migrate this to Postgres or another durable database.
