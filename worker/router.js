const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self)',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {...HEADERS,
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({error: 'Method not allowed.'}, 405);
    if (request.method === 'HEAD') return new Response(null, {headers: HEADERS});
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') return new Response(HTML, {
        headers: {...HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'}});
      if (url.pathname === '/api/health') return json({status: 'ok', app: 'EcoAngler', model: WEBSITE_MODEL.metadata.id, model_ready: true});
      if (url.pathname === '/api/model') return json(modelSummary(WEBSITE_MODEL));
      if (url.pathname === '/api/search') return json(await searchPlaces(url.searchParams.get('q') || ''));
      if (url.pathname === '/api/forecast') {
        let lat, lon;
        try { ({lat, lon} = coordinates(url.searchParams)); }
        catch (e) { return json({error: e.message}, 400); }
        const date = url.searchParams.get('date') || '';
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({error: 'Choose a valid forecast date.'}, 400);
        if (date) {
          const calendarDate = new Date(date + 'T12:00:00Z');
          if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date) {
            return json({error: 'Choose a valid forecast date.'}, 400);
          }
        }
        return json(await makeForecast(lat, lon, date, WEBSITE_MODEL, predictProductivity, calendarFeatures, modelSummary));
      }
      if (url.pathname === '/favicon.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="12" fill="#113f38"/><path d="M7 24q7-8 13 0t13 0M10 17q5-5 10 0t10 0" fill="none" stroke="#b9ead8" stroke-width="3" stroke-linecap="round"/></svg>', {headers: {...HEADERS, 'Content-Type': 'image/svg+xml'}});
      return json({error: 'Page not found.'}, 404);
    } catch (e) {
      const isInput = /Choose a date|shorter place|insufficient hourly/.test(e.message);
      return json({error: isInput ? e.message : 'The live forecast service is unavailable. Please try again shortly.'}, isInput ? 400 : 503);
    }
  }
};
