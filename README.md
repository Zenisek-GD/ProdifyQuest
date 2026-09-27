# ProdifyQuest API deployment

This directory contains the Express backend. Its `backend` Git branch is separate from the Expo frontend on the `master` branch of the same GitHub repository.

## Publish the prepared backend branch

From this directory, after the local backend commit has been prepared:

```powershell
git push -u origin backend
```

This adds the backend branch. It does not replace the frontend master branch. The prepared commit contains the API runtime, character assets, tests and deployment documentation. Local `.env`, private Firebase service-account files, and `node_modules` are excluded. Legacy UI and administrative source files remain in the local workspace but are not part of this API deployment branch; use `npm start` and `npm test` for this branch.

## Connect the existing Render service

In Render, select the existing ProdifyQuest Web Service, open Settings, and use these values:

| Setting | Value |
| --- | --- |
| Repository | `https://github.com/Zenisek-GD/ProdifyQuest.git` |
| Branch | `backend` |
| Root Directory | Leave blank |
| Runtime | Node |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/health` |

Selecting the backend branch is essential. The master branch's package starts Expo. The backend branch's package starts `index.js`, which runs the API. This reuses the existing service URL. The API-only deployment does not serve a browser frontend.

Set these environment variables on the Render service:

```text
NODE_ENV=production
NODE_VERSION=22
FIREBASE_API_KEY=<Firebase Web API key>
FIREBASE_PROJECT_ID=<Firebase project ID>
GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-service-account.json
```

Under Environment, add a Secret File named `firebase-service-account.json` containing the service-account JSON from your local backend. Keep its contents out of Git and the Expo app. Render supplies the `PORT` automatically. Firebase Authentication needs Email/Password enabled and Firestore must be available in that Firebase project.

Deploy the backend branch. The startup log should contain `ProdifyQuest API:` rather than `Starting Metro Bundler`. Open `https://prodifyquest.onrender.com/health` and confirm the response is:

```json
{"status":"ok","service":"ProdifyQuest API"}
```

This checks HTTP startup, not Firebase sign-in. Verify sign-in separately after the health check succeeds.

## Rebuild the Android app

Return to the separate `quest-frontend` directory:

```powershell
npm.cmd run check:api -- https://prodifyquest.onrender.com
```

After it passes:

```powershell
npx.cmd eas-cli@latest build --platform android --profile preview
```

The EAS preview environment already points at this URL. Install the new APK after a successful build.
