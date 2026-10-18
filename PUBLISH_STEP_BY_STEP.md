# Publish EcoAngler using GitHub and Cloudflare Workers

This package includes all model code, the trained models and the Cloudflare configuration. You do not need to edit the model, upload your catch CSV, run Google Colab or enter a weather API key to publish it.

## 1. Extract the ZIP

Right-click EcoAngler_GitHub.zip and select Extract All. Open the extracted EcoAngler_GitHub folder. Inside it you should see package.json, wrangler.jsonc, worker/, scripts/, tests/ and training/.

## 2. Create a GitHub repository

1. Sign in at https://github.com.
2. Open https://github.com/new.
3. Repository name: ecoangler.
4. Choose Private if you want to keep your project code private. Cloudflare can deploy a private GitHub repository.
5. Leave the README, .gitignore and licence initialization options off; this package already has the project files.
6. Select Create repository.

## 3. Upload the project files

1. In the empty repository, select the "uploading an existing file" link. If a file list already exists, use Add file → Upload files.
2. Open the extracted folder on your computer. Select its CONTENTS and drag those files/folders into GitHub's upload area. Upload the extracted files, not the ZIP and not the outer folder itself.
3. Commit message: Add EcoAngler website.
4. Commit to main using Commit changes (the interface may label the final action Propose changes).
5. Check the repository root: package.json and wrangler.jsonc must be beside worker/ and scripts/, not inside an extra nested EcoAngler_GitHub folder.

## 4. Connect Cloudflare

1. Sign in or create your account at https://dash.cloudflare.com.
2. Open Workers & Pages.
3. Select Create application and choose the GitHub/import repository option for a WORKER.
4. Connect GitHub. When choosing repository access, select only the ecoangler repository.
5. Select ecoangler from the repository list.

## 5. Enter the deployment settings

| Setting | Value |
| --- | --- |
| Worker/project name | ecoangler |
| Production branch | main |
| Root directory | / (repository root; leave blank if blank means root) |
| Build command | npm run build |
| Deploy command | npx wrangler deploy |
| Environment variables | None required |

This is a Cloudflare Worker project, not a Pages/static-site project; there is no static build-output-directory setting to fill in. The name must match "ecoangler" in wrangler.jsonc. If you choose another Worker name, edit that file's name to match first. Cloudflare's Git integration installs the npm dependencies and handles deployment authentication.

## 6. Deploy and check

1. Select Save and Deploy or Deploy.
2. Wait for a successful deployment. If it fails, open the build log and read the first error.
3. Open the exact workers.dev URL that Cloudflare shows. A URL such as https://ecoangler.YOUR-SUBDOMAIN.workers.dev is an example, not an existing deployment.
4. Select Kuala Terengganu and an available date, then choose Check fishing conditions.
5. Verify the weather, marine conditions and Poor/Good/High estimate appear. Marine data can be unavailable for inland places; this is an expected state, not a reason to invent data.
6. Add /api/health to your actual URL to check the application/model. It should return status "ok" and model_ready true.

The workers.dev website is normally accessible to anyone with its link, even when the source repository is private. If you need a restricted website, configure Cloudflare access controls separately before sharing it.

## Later changes

Edit the files in GitHub and commit them to main. A connected Cloudflare Worker will build and deploy updates automatically. The UI is in worker/page.html; the API adapters are in worker/api.js. The model trees are in worker/website_model.json. Do not substitute the original history model without also supplying all its required inputs.

## Common problems

- Missing package.json: the project was uploaded inside an extra folder. Move the extracted contents to the repository root or set the corresponding root directory in Cloudflare.
- Worker name mismatch: use ecoangler in both the dashboard and wrangler.jsonc.
- Repository absent from Cloudflare: adjust the GitHub connection to grant that application access to the ecoangler repository.
- Wrong service: use Workers, not GitHub Pages or a static Pages project.
- Temporary forecast failure: wait and retry, inspect /api/health, then check /api/forecast?lat=5.329&lon=103.137 on your real website. No API keys are required by this prototype.

## Model limits

Malaysian productivity is an experimental estimate learned from 593 catch-report dates at Honmoku, Japan. The website model uses temperature/wind/pressure daily means and calendar inputs, with no daily catch history. Water temperature, waves and sea level are context only. Japanese diagnostic accuracy is 53.29% shuffled CV and 49.58% chronological; these are not verified Malaysian accuracy. See training/README_model.md and training/model_card.json for the complete method, provenance and limitations.

## Official instructions

- GitHub file uploads: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- Cloudflare dashboard deployment: https://developers.cloudflare.com/workers/get-started/dashboard/
- Cloudflare build/deploy settings: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
