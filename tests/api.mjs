import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiPath = path.resolve(here, '../worker/api.js');
const routerPath = path.resolve(here, '../worker/router.js');
const {dailyWeather, makeForecast, coordinates} = await import(pathToFileURL(apiPath));
const fixtures = {};
for (const name of ['honmoku_weather', 'honmoku_marine', 'terengganu_weather', 'terengganu_marine']) {
  fixtures[name] = JSON.parse(await fs.readFile(path.join(here, 'fixtures', `${name}.json`), 'utf8'));
}
const clone = value => structuredClone(value);
const results = [];
async function test(name, callback) {
  try {await callback(); results.push({name, passed: true}); console.log(`PASS ${name}`);}
  catch (error) {results.push({name, passed: false, error: error.message}); console.log(`FAIL ${name}: ${error.message}`);}
}
const expectedMean = (fixture, variable, date) => {
  const rows = fixture.hourly.time.flatMap((t, i) => t.startsWith(date) ? [fixture.hourly[variable][i]] : []);
  return rows.reduce((a, b) => a + b, 0) / rows.length;
};

await test('Seven complete local Japan days match exact hourly means', () => {
  const rows = dailyWeather(clone(fixtures.honmoku_weather));
  assert.equal(rows.length, 7);
  assert.equal(rows[0].date, fixtures.honmoku_weather.hourly.time[0].slice(0, 10));
  for (const row of rows) {
    assert.equal(row.air_temperature, expectedMean(fixtures.honmoku_weather, 'temperature_2m', row.date));
    assert.equal(row.wind_speed, expectedMean(fixtures.honmoku_weather, 'wind_speed_10m', row.date));
    assert.equal(row.pressure, expectedMean(fixtures.honmoku_weather, 'pressure_msl', row.date));
  }
});

await test('Seven complete Malaysia local days retain location date boundaries', () => {
  const rows = dailyWeather(clone(fixtures.terengganu_weather));
  assert.equal(rows.length, 7);
  assert.equal(rows[0].date, fixtures.terengganu_weather.hourly.time[0].slice(0, 10));
  assert.equal(rows[6].date, fixtures.terengganu_weather.hourly.time.at(-1).slice(0, 10));
});

await test('Missing required weather hour excludes day rather than changing training aggregation', () => {
  const fixture = clone(fixtures.honmoku_weather);
  fixture.hourly.temperature_2m[1] = null;
  assert.equal(dailyWeather(fixture).some(day => day.date === fixture.hourly.time[0].slice(0, 10)), false);
});

await test('Duplicate hour cannot masquerade as complete 24-hour day', () => {
  const fixture = clone(fixtures.honmoku_weather);
  fixture.hourly.time[1] = fixture.hourly.time[0];
  assert.equal(dailyWeather(fixture).some(day => day.date === fixture.hourly.time[0].slice(0, 10)), false);
});

await test('Wrong wind unit is rejected before ML inference', () => {
  const fixture = clone(fixtures.honmoku_weather);
  fixture.hourly_units.wind_speed_10m = 'm/s';
  assert.throws(() => dailyWeather(fixture));
});

await test('Non-finite pressure cannot silently change model daily mean', () => {
  const fixture = clone(fixtures.honmoku_weather);
  fixture.hourly.pressure_msl[1] = Infinity;
  assert.equal(dailyWeather(fixture).some(day => day.date === fixture.hourly.time[0].slice(0, 10)), false);
});

await test('Coordinate input rejects absent, blank, out-of-range and non-finite values', () => {
  for (const query of ['', 'lat=&lon=0', 'lat=Infinity&lon=5', 'lat=91&lon=5', 'lat=5&lon=181', 'lat=x&lon=5']) {
    assert.throws(() => coordinates(new URLSearchParams(query)), query);
  }
  assert.deepEqual(coordinates(new URLSearchParams('lat=5.329&lon=103.137')), {lat: 5.329, lon: 103.137});
});

const calendar = date => {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = parsed.getUTCDay() || 7;
  return {month: parsed.getUTCMonth() + 1, weekday, isWeekend: weekday >= 6 ? 1 : 0};
};
const fakeInfer = (model, values) => ({
  label: 'Good', probabilities: {Poor: 0.2, Good: 0.5, High: 0.3}, warnings: [],
  members: {randomForest: {label: 'Good'}, xgboost: {label: 'Good'}}
});
const model = {metadata: {id: 'test-model'}, metrics: [], limitations: []};
const summary = () => ({features: ['airTemp','windSpeed','pressure','month','weekday','isWeekend'], trained_through: '2026-09-29'});
let upstreamCalls = [];
let marineFails = false;
let weatherFails = false;
globalThis.fetch = async input => {
  const url = new URL(input);
  upstreamCalls.push(url);
  if (url.hostname === 'api.open-meteo.com') {
    if (weatherFails) return new Response('Unavailable', {status: 503});
    return Response.json(clone(fixtures.terengganu_weather));
  }
  if (url.hostname === 'marine-api.open-meteo.com') {
    if (marineFails) return new Response('Unavailable', {status: 503});
    return Response.json(clone(fixtures.terengganu_marine));
  }
  throw new Error('Unexpected upstream host: ' + url.hostname);
};

await test('Forecast uses explicit ML units and local timezone; marine context is correctly named', async () => {
  const forecast = await makeForecast(5.329, 103.137, '', model, fakeInfer, calendar, summary);
  assert.equal(forecast.location.timezone, 'Asia/Kuala_Lumpur');
  assert.equal(forecast.outlook.length, 7);
  assert.equal(forecast.prediction.category, 'Good');
  assert.match(forecast.marine.message, /global mean sea level/i);
  assert.ok(forecast.marine.hourly.length > 0);
  const weatherRequest = upstreamCalls.find(url => url.hostname === 'api.open-meteo.com');
  assert.equal(weatherRequest.searchParams.get('wind_speed_unit'), 'kmh');
  assert.equal(weatherRequest.searchParams.get('temperature_unit'), 'celsius');
  assert.equal(weatherRequest.searchParams.get('timezone'), 'auto');
  assert.ok(forecast.warnings.some(text => /Japan|Honmoku/i.test(text)));
});

await test('Marine upstream failure preserves real weather prediction with unavailable context', async () => {
  marineFails = true;
  const forecast = await makeForecast(5.3291, 103.1371, '', model, fakeInfer, calendar, summary);
  assert.equal(forecast.prediction.category, 'Good');
  assert.equal(forecast.marine.available, false);
  assert.equal(forecast.marine.sea_temperature, null);
  marineFails = false;
});

await test('Weather upstream failure prevents fabricated productivity prediction', async () => {
  weatherFails = true;
  await assert.rejects(makeForecast(5.3292, 103.1372, '', model, fakeInfer, calendar, summary));
  weatherFails = false;
});

let forecastInvocations = 0;
const routerSource = (await fs.readFile(routerPath, 'utf8')).replace('export default', 'globalThis.router =');
const context = {
  URL, URLSearchParams, Request, Response, console, HTML: '<html></html>', WEBSITE_MODEL: model,
  coordinates, searchPlaces: async () => ({results: []}),
  makeForecast: async () => {forecastInvocations++; return {ok: true};},
  modelSummary: summary, predictProductivity: fakeInfer, calendarFeatures: calendar,
};
vm.runInNewContext(routerSource, context);
const router = context.router;

await test('Impossible calendar date returns HTTP400 before contacting providers', async () => {
  forecastInvocations = 0;
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-01-00']) {
    const response = await router.fetch(new Request(`https://ecoangler.test/api/forecast?lat=5.3&lon=103.1&date=${date}`), {}, {});
    assert.equal(response.status, 400, date);
  }
  assert.equal(forecastInvocations, 0);
});

await test('Valid leap day is accepted as a calendar date', async () => {
  const response = await router.fetch(new Request('https://ecoangler.test/api/forecast?lat=5.3&lon=103.1&date=2028-02-29'), {}, {});
  assert.equal(response.status, 200);
});

await test('Router blocks unsupported methods and returns security headers', async () => {
  const response = await router.fetch(new Request('https://ecoangler.test/api/forecast', {method: 'POST'}), {}, {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.ok(response.headers.get('Content-Security-Policy').includes("connect-src 'self'"));
});

await fs.writeFile(path.join(here, 'api_test_results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({passed: results.filter(x => x.passed).length, total: results.length}));
if (results.some(x => !x.passed)) process.exitCode = 1;
