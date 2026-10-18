# EcoAngler

Live Malaysian fishing conditions with an experimental Random Forest + XGBoost ensemble.



## Local use

Node.js 22 or later: `npm run build`, then `npm run dev`. Open http://127.0.0.1:8787 and keep the terminal open. On Windows you can double-click Start EcoAngler.cmd. No npm installation is required for local preview.

## Checks

Run `npm test` and `npm run validate` after building. For manual Cloudflare CLI deployment, run `npm install`, authenticate your Cloudflare account and run `npm run deploy`. The dashboard/GitHub path in the guide performs these steps remotely.

Weather/marine data: Open-Meteo and DWD; applicable free-use/noncommercial terms apply. The website requires network access to the provider APIs.
