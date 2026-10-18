// Free Open-Meteo services. Forecasts are aggregated in each location's local day.
const memoryCache = new Map();
const TTL = 15 * 60 * 1000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const mean = values => {
  const valid = values.filter(finite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
};
const round = (value, digits = 1) => finite(value) ? Number(value.toFixed(digits)) : null;
const weatherLabel = code => {
  if (code === 0) return 'Clear sky';
  if ([1, 2].includes(code)) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if ([45, 48].includes(code)) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorms';
  return 'Weather forecast';
};

async function upstream(url) {
  const key = url.toString();
  const old = memoryCache.get(key);
  if (old && Date.now() - old.time < TTL) return old.data;
  const response = await fetch(key, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(18000),
    cf: {cacheTtl: 900, cacheEverything: true}
  });
  if (!response.ok) throw new Error(`Forecast service returned ${response.status}. Please try again shortly.`);
  const data = await response.json();
  if (data.error) throw new Error('The forecast service could not supply this location.');
  if (memoryCache.size > 100) memoryCache.delete(memoryCache.keys().next().value);
  memoryCache.set(key, {time: Date.now(), data});
  return data;
}

export function coordinates(search) {
  const rawLat = search.get('lat');
  const rawLon = search.get('lon');
  const lat = Number(rawLat), lon = Number(rawLon);
  if (rawLat === null || rawLon === null || rawLat.trim() === '' || rawLon.trim() === '' ||
      !finite(lat) || !finite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('Choose a valid fishing location first.');
  }
  return {lat, lon};
}

export async function searchPlaces(query) {
  const q = query.trim();
  if (q.length < 3) return {results: []};
  if (q.length > 100) throw new Error('Please use a shorter place name.');
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({name: q, count: '6', language: 'en', format: 'json', countryCode: 'MY'});
  const data = await upstream(url);
  return {results: (data.results || []).filter(p => p.country_code === 'MY').map(p => ({
    id: p.id, name: p.name, admin1: p.admin1 || '', country: p.country,
    latitude: p.latitude, longitude: p.longitude, timezone: p.timezone
  }))};
}

export function dailyWeather(data) {
  if (!data.hourly?.time?.length) throw new Error('Weather data is currently unavailable for this location.');
  const units = data.hourly_units || {};
  if (units.temperature_2m !== '°C' || units.wind_speed_10m !== 'km/h' || units.pressure_msl !== 'hPa') {
    throw new Error('Weather units do not match the trained model.');
  }
  const days = new Map();
  data.hourly.time.forEach((time, i) => {
    const date = time.slice(0, 10);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(i);
  });
  return [...days.entries()].map(([date, ids]) => {
    const temperatures = ids.map(i => data.hourly.temperature_2m?.[i]);
    const wind = ids.map(i => data.hourly.wind_speed_10m?.[i]);
    const pressure = ids.map(i => data.hourly.pressure_msl?.[i]);
    const index = data.daily?.time?.indexOf(date) ?? -1;
    const code = index >= 0 ? data.daily.weather_code?.[index] : null;
    return {date, air_temperature: mean(temperatures), wind_speed: mean(wind), pressure: mean(pressure),
      weather_code: code, label: weatherLabel(code),
      precipitation_probability: index >= 0 ? data.daily.precipitation_probability_max?.[index] ?? null : null,
      sunrise: index >= 0 ? data.daily.sunrise?.[index] ?? null : null,
      sunset: index >= 0 ? data.daily.sunset?.[index] ?? null : null,
      valid: ids.length === 24 && new Set(ids.map(i => data.hourly.time[i])).size === 24 &&
        ids.every((i, hour) => data.hourly.time[i] === date + 'T' + String(hour).padStart(2, '0') + ':00') &&
        [temperatures, wind, pressure].every(v => v.length === 24 && v.every(finite))};
  }).filter(day => day.valid);
}

function marineDay(data, date) {
  if (!data?.hourly?.time?.length) return {available: false, sea_temperature: null, wave_height: null,
    tide_height: null, tide_source: null, hourly: [], message: 'Marine forecast unavailable at this location.'};
  const ids = data.hourly.time.map((t, i) => t.startsWith(date) ? i : -1).filter(i => i >= 0);
  const temperatures = ids.map(i => data.hourly.sea_surface_temperature?.[i]);
  const waves = ids.map(i => data.hourly.wave_height?.[i]);
  const heights = ids.map(i => data.hourly.sea_level_height_msl?.[i]);
  const hourly = ids.filter(i => finite(data.hourly.sea_level_height_msl?.[i])).map(i => ({
    time: data.hourly.time[i], height: data.hourly.sea_level_height_msl[i]
  }));
  const available = [temperatures, waves, heights].some(a => a.some(finite));
  return {available, sea_temperature: round(mean(temperatures)), wave_height: round(mean(waves), 2),
    tide_height: round(mean(heights), 2), tide_source: hourly.length ? 'Open-Meteo / DWD · global mean sea level' : null,
    hourly, message: available ? 'Sea level includes tides and other ocean effects; values are relative to global mean sea level.' :
      'Marine forecast unavailable here. Try a nearby coastal location.'};
}

function distanceKm(lat, lon) {
  const radians = n => n * Math.PI / 180;
  const dlat = radians(lat - 35.4267), dlon = radians(lon - 139.6863);
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(radians(lat)) * Math.cos(radians(35.4267)) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function makeForecast(lat, lon, date, model, infer, calendar, summary) {
  const params = {latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: 'auto', forecast_days: '7'};
  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  weatherUrl.search = new URLSearchParams({...params, hourly: 'temperature_2m,wind_speed_10m,pressure_msl',
    daily: 'weather_code,precipitation_probability_max,sunrise,sunset',
    wind_speed_unit: 'kmh', temperature_unit: 'celsius'});
  const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine');
  marineUrl.search = new URLSearchParams({...params, cell_selection: 'sea', hourly: 'sea_surface_temperature,wave_height,sea_level_height_msl'});
  const [weatherResult, marineResult] = await Promise.allSettled([upstream(weatherUrl), upstream(marineUrl)]);
  if (weatherResult.status !== 'fulfilled') throw new Error('Live weather is unavailable. Please try again shortly.');
  const weather = weatherResult.value;
  const days = dailyWeather(weather);
  if (!days.length) throw new Error('The forecast has insufficient hourly inputs. Please try another coastal location.');
  const selectedDate = date || days[0].date;
  const chosen = days.find(day => day.date === selectedDate);
  if (!chosen) throw new Error('Choose a date within the available seven-day forecast.');
  const outside = distanceKm(lat, lon) > 50;
  const warnings = [];
  if (outside) warnings.push('Experimental estimate: the model learned from catches in Honmoku, Japan. Fishing productivity has not been validated for Malaysia.');
  warnings.push('Weather-based estimate, not a catch guarantee. Check local marine advisories before fishing.');
  const estimate = day => {
    const values = {airTemp: day.air_temperature, windSpeed: day.wind_speed, pressure: day.pressure, ...calendar(day.date)};
    const p = infer(model, values);
    return {category: p.label, probabilities: p.probabilities,
      rf_category: p.members.randomForest.label, xgboost_category: p.members.xgboost.label,
      model_name: 'RF + XGBoost ensemble', feature_values: values,
      probabilities_calibrated: false, warnings: p.warnings};
  };
  const modelInfo = summary(model);
  const currentPrediction = estimate(chosen);
  warnings.push(...currentPrediction.warnings);
  const cv = model.metrics?.find?.(m => m.model === 'Ensemble' && /10-fold/.test(m.protocol));
  const chronological = model.metrics?.find?.(m => m.model === 'Ensemble' && /chronological/.test(m.protocol));
  return {location: {latitude: lat, longitude: lon, timezone: weather.timezone}, date: selectedDate,
    updated_at: new Date().toISOString(), weather: {
      air_temperature: round(chosen.air_temperature), wind_speed: round(chosen.wind_speed), pressure: round(chosen.pressure),
      weather_code: chosen.weather_code, label: chosen.label, precipitation_probability: chosen.precipitation_probability,
      sunrise: chosen.sunrise, sunset: chosen.sunset},
    marine: marineDay(marineResult.status === 'fulfilled' ? marineResult.value : null, selectedDate),
    prediction: currentPrediction, outlook: days.map(day => ({date: day.date, ...estimate(day),
      air_temperature: round(day.air_temperature), wind_speed: round(day.wind_speed),
      weather_code: day.weather_code, label: day.label})),
    model: {...modelInfo, cv_accuracy: cv?.accuracy ?? modelInfo.cv_accuracy ?? null,
      chronological_accuracy: chronological?.accuracy ?? modelInfo.chronological_accuracy ?? null,
      training_location: 'Honmoku, Japan', features: modelInfo.features,
      trained_through: modelInfo.trained_through || modelInfo.trainingThrough,
      limitations: model.limitations || modelInfo.limitations || []}, warnings,
    attribution: {weather: 'Weather data by Open-Meteo (CC BY 4.0)',
      marine: 'Marine data by Open-Meteo and DWD',
      urls: ['https://open-meteo.com/', 'https://open-meteo.com/en/docs/marine-weather-api']}};
}
