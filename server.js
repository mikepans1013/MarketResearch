#!/usr/bin/env node
/**
 * ============================================================================
 * MHP MARKET RESEARCH DASHBOARD
 * ============================================================================
 *
 * PURPOSE: Private app for screening mobile home park acquisition markets by
 * address. It saves reports, lets Michael revisit prior markets, and refreshes
 * data only when he clicks Update to control spend.
 *
 * TRIGGER: Manual web use at ${APP_BASE_URL} once DNS/proxy is
 * configured. Locally runs as a Node HTTP server on PORT, default 5317.
 *
 * PROCESS FLOW:
 * STEP 1: User enters address and radius.
 *   - Actor: Browser UI
 *   - Action: POST /api/markets creates a saved market shell.
 *   - Output: Persistent JSON record in data/markets.json.
 *
 * STEP 2: User clicks Update Data.
 *   - Actor: Browser UI + this server
 *   - Action: Geocodes with Census, resolves geography, pulls free Census ACS
 *     comparison metrics where possible, and stores raw response metadata.
 *   - Output: Updated market report with source timestamps.
 *
 * STEP 3: User reviews prior markets.
 *   - Actor: Browser UI
 *   - Action: GET /api/markets and GET /api/markets/:id.
 *   - Output: List and table-style report.
 *
 * HUMAN ACTIONS: Michael chooses when to refresh. Future API upgrades require
 * explicit approval if paid sources are added.
 *
 * CONFIG: PORT, MARKET_APP_PASSWORD optional environment variables. Data lives
 * at apps/mhp-market-research/data/markets.json.
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (process.argv.includes('--healthcheck')) {
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    console.log(JSON.stringify({ script: 'mhp-market-research/server.js', status: 'ok', version: '0.1.0' }));
    process.exit(0);
  } catch (e) {
    console.log(JSON.stringify({ script: 'mhp-market-research/server.js', status: 'error', error: e.message }));
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT || 5317);
const AUTH_USERNAME = process.env.MARKET_APP_USERNAME || 'michael';
const PASSWORD = process.env.MARKET_APP_PASSWORD || '';
const DATA_FILE = path.join(__dirname, 'data', 'markets.json');
const FMR_INDEX_FILE = path.join(__dirname, 'data', 'hud-fmr', 'fmr-index.json');
let fmrIndexCache = null;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CENSUS_API_KEY = process.env.CENSUS_API_KEY || '';
function loadGooglePlacesKey() {
  return process.env.GOOGLE_PLACES_API_KEY || '';
}
const GOOGLE_PLACES_API_KEY = loadGooglePlacesKey();


function loadFmrIndex() {
  if (fmrIndexCache) return fmrIndexCache;
  if (!fs.existsSync(FMR_INDEX_FILE)) return null;
  fmrIndexCache = JSON.parse(fs.readFileSync(FMR_INDEX_FILE, 'utf8'));
  return fmrIndexCache;
}
function getHudFmrRows(geo) {
  const index = loadFmrIndex();
  if (!index?.years) return [];
  const countyFips = geo?.county?.fullCode || (geo?.state?.code && geo?.county?.code ? `${geo.state.code}${geo.county.code}` : null);
  const zcta = geo?.zcta?.code;
  const rows = [];
  for (const year of Object.keys(index.years).sort((a,b)=>Number(b)-Number(a))) {
    const data = index.years[year];
    const county = countyFips ? data.countyByFips?.[countyFips] : null;
    const safmr = zcta ? data.safmrByZip?.[zcta] : null;
    if (county) rows.push({ ...county, year: Number(year), geography: county.countyName || county.hudAreaName, sourceFile: data.countyFile, sourceUrl: data.countyUrl });
    if (safmr) rows.push({ ...safmr, year: Number(year), geography: `ZIP/ZCTA ${zcta}`, sourceFile: data.safmrFile, sourceUrl: data.safmrUrl });
  }
  return rows;
}

function ensureStore() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ markets: [] }, null, 2));
}
function readStore() { ensureStore(); return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function writeStore(store) { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  res.writeHead(status, { 'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(body);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 2_000_000) reject(new Error('Body too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
  });
}
function authed(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
  return decoded === `${AUTH_USERNAME}:${PASSWORD}`;
}
function slugId(address) {
  const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'market';
  return `${slug}-${crypto.randomBytes(3).toString('hex')}`;
}
async function fetchJson(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'MHPMarketResearch/0.1 (private app)' } });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`);
  return data;
}
async function getPostalCodeFromGoogle(address) {
  if (!GOOGLE_PLACES_API_KEY) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', GOOGLE_PLACES_API_KEY);
  const data = await fetchJson(url.toString());
  if (data.status !== 'OK') return null;
  const result = data.results?.[0];
  const postal = result?.address_components?.find(c => (c.types || []).includes('postal_code'));
  return postal?.long_name || postal?.short_name || null;
}
async function geocodeAddress(address) {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress');
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('vintage', 'Current_Current');
  url.searchParams.set('format', 'json');
  const data = await fetchJson(url);
  const match = data?.result?.addressMatches?.[0];
  if (!match) throw new Error('No Census geocode match found for this address.');
  const geos = match.geographies || {};
  const state = geos.States?.[0];
  const county = geos.Counties?.[0];
  const tract = geos['Census Tracts']?.[0];
  const place = geos['Incorporated Places']?.[0];
  const zcta = geos['2020 ZIP Code Tabulation Areas']?.[0] || geos['ZIP Code Tabulation Areas']?.[0];
  const googlePostalCode = zcta ? null : await getPostalCodeFromGoogle(match.matchedAddress || address);
  return {
    matchedAddress: match.matchedAddress,
    coordinates: match.coordinates,
    state: state && { name: state.NAME, code: state.STATE },
    county: county && { name: county.NAME, code: county.COUNTY, fullCode: `${county.STATE}${county.COUNTY}` },
    city: place && { name: place.NAME, code: place.PLACE },
    tract: tract && { name: tract.NAME, code: tract.TRACT, countyCode: tract.COUNTY, stateCode: tract.STATE },
    zcta: zcta
      ? { name: zcta.NAME, code: zcta.ZCTA5 || zcta.ZCTA5CE20, source: 'Census Geocoder' }
      : (googlePostalCode ? { name: googlePostalCode, code: googlePostalCode, source: 'Google Geocoding postal_code used as Census ZCTA' } : null)
  };
}
const ACS_VARS = {
  population: 'B01003_001E',
  medianHouseholdIncome: 'B19013_001E',
  medianHomeValue: 'B25077_001E',
  renterOccupied: 'B25003_003E',
  ownerOccupied: 'B25003_002E',
  occupiedUnits: 'B25003_001E',
  ageUnder18: 'B09001_001E',
  age65Plus: 'B01001_020E,B01001_021E,B01001_022E,B01001_023E,B01001_024E,B01001_025E,B01001_044E,B01001_045E,B01001_046E,B01001_047E,B01001_048E,B01001_049E'
};
const ACS_GET = ['NAME','B01003_001E','B19013_001E','B25077_001E','B25003_001E','B25003_002E','B25003_003E','B09001_001E','B01001_020E','B01001_021E','B01001_022E','B01001_023E','B01001_024E','B01001_025E','B01001_044E','B01001_045E','B01001_046E','B01001_047E','B01001_048E','B01001_049E'];
function acsUrl(forClause, inClause = '') {
  const url = new URL('https://api.census.gov/data/2022/acs/acs5');
  url.searchParams.set('get', ACS_GET.join(','));
  url.searchParams.set('for', forClause);
  if (inClause) url.searchParams.set('in', inClause);
  if (CENSUS_API_KEY) url.searchParams.set('key', CENSUS_API_KEY);
  return url.toString();
}
function parseAcsTable(rows) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('Census API returned no data for this geography.');
  const header = rows[0];
  const row = rows[1];
  const obj = Object.fromEntries(header.map((h, i) => [h, row[i]]));
  const num = k => { const n = Number(obj[k]); return Number.isFinite(n) && n >= 0 ? n : null; };
  const age65 = ['B01001_020E','B01001_021E','B01001_022E','B01001_023E','B01001_024E','B01001_025E','B01001_044E','B01001_045E','B01001_046E','B01001_047E','B01001_048E','B01001_049E'].reduce((s,k)=>s+(num(k)||0),0);
  const pop = num('B01003_001E');
  const occupied = num('B25003_001E');
  const renters = num('B25003_003E');
  return {
    name: obj.NAME,
    population: pop,
    medianHouseholdIncome: num('B19013_001E'),
    medianHomeValue: num('B25077_001E'),
    renterPercent: occupied ? renters / occupied : null,
    ageUnder18Percent: pop ? num('B09001_001E') / pop : null,
    age65PlusPercent: pop ? age65 / pop : null,
    raw: obj
  };
}
async function getAcsComparison(geo) {
  const levels = [];
  levels.push(['National', acsUrl('us:1')]);
  if (geo.state?.code) levels.push(['State', acsUrl(`state:${geo.state.code}`)]);
  if (geo.county?.code && geo.state?.code) levels.push(['County', acsUrl(`county:${geo.county.code}`, `state:${geo.state.code}`)]);
  if (geo.city?.code && geo.state?.code) levels.push(['City/Place', acsUrl(`place:${geo.city.code}`, `state:${geo.state.code}`)]);
  if (geo.zcta?.code) levels.push(['ZIP/ZCTA', acsUrl(`zip code tabulation area:${geo.zcta.code}`)]);
  if (geo.tract?.code && geo.county?.code && geo.state?.code) levels.push(['Census Tract', acsUrl(`tract:${geo.tract.code}`, `state:${geo.state.code} county:${geo.county.code}`)]);
  const out = [];
  for (const [level, url] of levels) {
    try { out.push({ level, ...(parseAcsTable(await fetchJson(url)) || {}), source: 'Census ACS 5-Year 2022' }); }
    catch (e) { out.push({ level, error: e.message, source: 'Census ACS 5-Year 2022' }); }
  }
  return out;
}
async function updateMarket(market) {
  const geo = await geocodeAddress(market.address);
  const comparison = await getAcsComparison(geo);
  const rents = getHudFmrRows(geo);
  market.geo = geo;
  market.comparison = comparison;
  market.rents = rents;
  market.sources = [
    { name: 'US Census Geocoder', url: 'https://geocoding.geo.census.gov/', updatedAt: new Date().toISOString() },
    ...(geo.zcta?.source?.startsWith('Google') ? [{ name: 'Google Geocoding API', url: 'https://developers.google.com/maps/documentation/geocoding', updatedAt: new Date().toISOString() }] : []),
    { name: 'US Census ACS 5-Year 2022', url: 'https://api.census.gov/data/2022/acs/acs5', updatedAt: new Date().toISOString() },
    ...(market.rents?.length ? [{ name: 'HUD Fair Market Rents / Small Area FMRs FY2024-FY2026', url: 'https://www.huduser.gov/portal/datasets/fmr.html', updatedAt: new Date().toISOString() }] : [])
  ];
  market.dataStatus = 'fresh';
  market.lastUpdatedAt = new Date().toISOString();
  return market;
}
function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(filePath)) filePath = path.join(PUBLIC_DIR, 'index.html');
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!authed(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="MHP Markets"' });
      return res.end('Authentication required');
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/health') return send(res, 200, { ok: true, app: 'mhp-market-research' });
    if (url.pathname === '/api/address-suggest' && req.method === 'GET') {
      const input = (url.searchParams.get('q') || '').trim();
      if (input.length < 3) return send(res, 200, { suggestions: [] });
      if (!GOOGLE_PLACES_API_KEY) return send(res, 500, { error: 'Google Places API key not configured' });
      const placesUrl = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
      placesUrl.searchParams.set('input', input);
      placesUrl.searchParams.set('types', 'address');
      placesUrl.searchParams.set('components', 'country:us');
      placesUrl.searchParams.set('key', GOOGLE_PLACES_API_KEY);
      const data = await fetchJson(placesUrl.toString());
      const suggestions = (data.predictions || []).slice(0, 7).map(p => ({
        placeId: p.place_id,
        description: p.description,
        mainText: p.structured_formatting?.main_text || p.description,
        secondaryText: p.structured_formatting?.secondary_text || ''
      }));
      return send(res, 200, { suggestions, status: data.status });
    }
    if (url.pathname === '/api/place-details' && req.method === 'GET') {
      const placeId = (url.searchParams.get('placeId') || '').trim();
      if (!placeId) return send(res, 400, { error: 'placeId is required' });
      if (!GOOGLE_PLACES_API_KEY) return send(res, 500, { error: 'Google Places API key not configured' });
      const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      detailsUrl.searchParams.set('place_id', placeId);
      detailsUrl.searchParams.set('fields', 'formatted_address,geometry,name');
      detailsUrl.searchParams.set('key', GOOGLE_PLACES_API_KEY);
      const data = await fetchJson(detailsUrl.toString());
      if (data.status !== 'OK') return send(res, 502, { error: `Google Places details failed: ${data.status}`, details: data.error_message });
      return send(res, 200, { address: data.result.formatted_address, location: data.result.geometry?.location, name: data.result.name });
    }
    if (url.pathname === '/api/markets' && req.method === 'GET') {
      const store = readStore();
      return send(res, 200, { markets: store.markets.map(({ raw, ...m }) => m).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')) });
    }
    if (url.pathname === '/api/markets' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.address) return send(res, 400, { error: 'address is required' });
      const store = readStore();
      const market = { id: slugId(body.address), name: body.name || body.address, address: body.address, radiusMiles: Number(body.radiusMiles || 30), createdAt: new Date().toISOString(), lastUpdatedAt: null, dataStatus: 'not_updated', comparison: [], sources: [] };
      store.markets.push(market); writeStore(store);
      return send(res, 201, market);
    }
    const match = url.pathname.match(/^\/api\/markets\/([^/]+)(?:\/(update))?$/);
    if (match) {
      const [, id, action] = match;
      const store = readStore();
      const idx = store.markets.findIndex(m => m.id === id);
      if (idx === -1) return send(res, 404, { error: 'Market not found' });
      if (action === 'update' && req.method === 'POST') {
        store.markets[idx].dataStatus = 'updating'; writeStore(store);
        try { store.markets[idx] = await updateMarket(store.markets[idx]); writeStore(store); return send(res, 200, store.markets[idx]); }
        catch (e) { store.markets[idx].dataStatus = 'error'; store.markets[idx].lastError = e.message; writeStore(store); return send(res, 500, { error: e.message, market: store.markets[idx] }); }
      }
      if (!action && req.method === 'GET') return send(res, 200, store.markets[idx]);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    serveStatic(req, res);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`MHP Market Research running at http://127.0.0.1:${PORT}`));
