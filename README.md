# MHP Market Research App

Private dashboard for screening mobile home park markets by address. The app is designed to be self-hosted and replicated without hardcoded private URLs, passwords, or API keys.

## Current Features

- Create a market report from a specific address
- Save previous markets locally
- Manual **Update Data** button only, so API calls/spend happen only when requested
- Configurable radius, default 30 miles
- Address autocomplete via Google Places API
- Census geocoder integration
- Census ACS comparison table for national, state, county, city/place, ZIP/ZCTA, and census tract when available
- 10-year population trend table using Census ACS 5-year estimates, with total change and CAGR
- HUD Fair Market Rents table with FY2026, FY2025, and FY2024 county/metro FMRs plus ZIP-level Small Area FMRs where available
- Local JSON persistence for MVP simplicity

## Planned Features

- Forecasted population growth
- Apify-powered rental listing pulls, using API calls only, no local headless browser
- Major employers within selected radius
- Crime statistics
- Map layer last: subject property, Walmart, grocery stores, major employers

## Data Source Notes

### Census

- Census does not provide true USPS ZIP-code geography. It provides **ZCTA** data, which approximates ZIP codes. The UI labels this as `ZIP/ZCTA`.
- Some postal ZIPs do not have ZCTA ACS data, especially non-residential/special-use ZIPs.
- Census tract is often more useful than city/town data for rural or unincorporated mobile home park locations.

### HUD Fair Market Rents

The repo includes the complete HUD source XLSX datasets used by the app under `data/hud-fmr/`:

- `FY26_FMRs_revised.xlsx`
- `fy2026_safmrs_revised.xlsx`
- `FY25_FMRs_revised.xlsx`
- `fy2025_safmrs_revised.xlsx`
- `FY24_FMRs.xlsx`
- `fy2024_safmrs.xlsx`

The generated `data/hud-fmr/fmr-index.json` is a lookup index derived from those files so the Node app can read HUD rents without Excel parsing dependencies at runtime.

## Requirements

- Node.js 20+
- Free Census API key: <https://api.census.gov/data/key_signup.html>
- Google Maps Platform key with Places API and Geocoding API enabled

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

This is a plain Node HTTP server. You can deploy it behind any reverse proxy or tunnel, including Cloudflare Tunnel, Nginx, Caddy, Render, Railway, Fly.io, or a systemd service on a VPS.

## Privacy / Secrets

Do not commit `.env`, API keys, passwords, private URLs, or saved market reports. This repo includes `.env.example` only.

## Storage

MVP storage is local JSON:

```text
data/markets.json
```

For multi-user/client-facing usage, migrate this to Postgres or another durable database.
