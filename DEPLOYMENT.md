# Installable ProdifyQuest for Android

Start with a standalone Android APK that you can install yourself and share with testers. It runs without Expo Go or a Metro development server. Your Express API must remain online for accounts, tasks, focus sessions, inventory, guilds, and reports. Firebase continues to store the data.

The included `eas.json` has two profiles:

| Profile | Result | Use |
| --- | --- | --- |
| `preview` | Signed `.apk` | Direct download and installation on Android |
| `production` | Signed `.aab` | Upload to Google Play; not directly installable |

No cloud project has been created, server deployed, or APK built by adding these files. The online API address and your Expo account still need to be configured. The following commands are for PowerShell on Windows.

## 1. Host the backend

One suitable option is a Render Node Web Service. Connect a repository containing **prodify-backend**, including its `api`, `models`, and `characters` folders and `package-lock.json`. The character folder serves portraits and other artwork to the application.

At preparation time, only `quest-frontend` is a Git repository. Pushing that repository alone does not deploy the backend. Put the backend in its own repository, or deliberately set up a repository containing both projects. Preserve the existing `.gitignore`: `.env` and the Firebase service-account JSON belong in the hosting provider's secret settings, not Git.

Use these Render settings:

| Setting | Value |
| --- | --- |
| Service type | Web Service |
| Runtime | Node |
| Root directory | Leave blank for a backend-only repo; `prodify-backend` for a combined repo |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/health` |

Add these environment variables in Render:

```text
NODE_ENV=production
NODE_VERSION=22
FIREBASE_API_KEY=<your Firebase Web API key>
FIREBASE_PROJECT_ID=<your Firebase project ID>
GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-service-account.json
```

Add a Render **Secret File** named `firebase-service-account.json` containing your backend service-account JSON. Render exposes it at the path above. Do not use the `C:/...` path from your local `.env` on the server. Keep private Firebase credentials exclusively on the backend. Render provides `PORT`, which the server already reads.

Firebase Authentication must have Email/Password enabled, and Cloud Firestore must be created. This application's API uses the Admin SDK: the supplied project-root `firestore.rules` denies direct client access while the API checks authentication and ownership.

Native clients do not send a browser Origin header, so a native APK does not need a new CORS entry. If you also deploy a website, set `CORS_ORIGINS` to its exact HTTPS origin. Leave the existing proxy setting unchanged unless you have verified the host's proxy topology; this backend supports trusting exactly one proxy with `TRUST_PROXY=1`.

After deployment, Render gives you an HTTPS address. Open its `/health` URL. A healthy response proves the HTTP server is running; also test registration/sign-in to confirm Firebase access. Check a character image loads, for example `/characters/ProdifyQuest_10_Companions_Pack/assets/apprentice-mage/portrait.png`.

Render's free service sleeps after 15 minutes without traffic and can take about a minute to wake. This app has a 20-second API timeout, so the first sign-in may fail during a cold start. Free hosting is useful for initial trials; choose a service that stays running when you want reliable shared use.

Official references: [Render Express deployment](https://render.com/docs/deploy-node-express-app), [secret files](https://render.com/docs/configure-environment-variables#secret-files), [free-service limits](https://render.com/docs/free).

## 2. Link the frontend to your Expo account

From the project root:

```powershell
cd quest-frontend
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest init
npx.cmd eas-cli@latest build:configure --platform android
```

Choose your own Expo account/project. Initialization writes the real EAS project ID; no placeholder project ID is included in this repository.

When asked for the Android application ID, choose a unique identifier you intend to keep, for example `com.gerald.prodifyquest`. EAS saves it under `expo.android.package` in `app.json`. Keep that identifier and the signing key for subsequent updates. Allow EAS to generate/manage the Android keystore for the first build, or provide your existing key if the app has already been distributed.

## 3. Set the online API address for the build

In the following command, replace the example address with the actual URL from your backend deployment:

```powershell
npx.cmd eas-cli@latest env:set --name EXPO_PUBLIC_API_URL --value "https://YOUR-SERVICE.onrender.com" --environment preview --visibility plaintext
```

Use the HTTPS **origin only**, without `/api`. The client appends `/api` itself. Do not use `localhost`, `10.0.2.2`, or your computer's `192.168...` address in a distributed app.

Your local `.env` can continue to point to your computer for development. `.easignore` excludes it from the cloud upload, and the build profile explicitly selects the EAS `preview` environment. The API URL is public configuration embedded in the app; never put service-account keys in an `EXPO_PUBLIC_` variable. Changing this URL requires a new build with the current setup.

Reference: [EAS environment variables](https://docs.expo.dev/eas/environment-variables/manage/).

## 4. Build and install the APK

First verify the **backend** URL (replace the example):

```powershell
npm.cmd run check:api -- https://YOUR-BACKEND.onrender.com
```

The check requires JSON identifying `ProdifyQuest API` from `/health`. A website returning HTML with HTTP 200 is not a passing result. This check also runs automatically before EAS installs build dependencies, using the selected EAS environment's `EXPO_PUBLIC_API_URL`.

From `quest-frontend`:

```powershell
npx.cmd eas-cli@latest build --platform android --profile preview
```

Expo builds and signs the app in the cloud. Use the download link from the completed build to download the APK on your Android phone. Open it and follow Android's installation prompts; you may need to allow installations from that browser. This profile is a release-style standalone app, not an Expo development client.

Stop Expo and the local backend on your computer, then test the installed app using mobile data or another Wi-Fi network. Check sign-in, task creation/completion, study status, character images, chest opening, chat, and reports. Confirm saved data remains after reopening the app. The current app keeps authentication tokens in memory, so a fresh launch can require signing in again; server-saved progress remains.

After that check, share the APK/build link or add a **Download Android APK** link to your portfolio. Rebuild after app changes; the profiles increment Android version codes using EAS so later builds can update existing installations signed with the same key.

Reference: [Expo APK builds and installation](https://docs.expo.dev/build-reference/apk/).

## 5. Publish on Google Play later

Set the production API environment and build the store artifact:

```powershell
npx.cmd eas-cli@latest env:set --name EXPO_PUBLIC_API_URL --value "https://YOUR-SERVICE.onrender.com" --environment production --visibility plaintext
npx.cmd eas-cli@latest build --platform android --profile production
```

Use a Google Play Developer account and follow the current Play Console testing and listing requirements. Start with internal testing. Building an AAB does not publish the app; uploading and releasing are separate steps. Expo's guide covers the first manual upload and later automated submissions.

[Google Play submission guide](https://docs.expo.dev/submit/android/)

For iPhone distribution, prepare a separate iOS build and use Apple's TestFlight/App Store process; Android APKs cannot be installed on iPhones. Android is the initial path documented here.

## Fixing the current Render connection error

The deployment at `https://prodifyquest.onrender.com` was checked on September 27, 2026. `/health`, `/api/me`, and even an empty `POST /api/auth/login` all returned the frontend HTML rather than API JSON. EAS's `preview` environment also pointed to that address. This URL cannot currently provide the backend for the Android app.

Keep the frontend website and create a separate Render **Web Service** for `prodify-backend` using step 1. A Static Site or a frontend-only repository cannot execute the Express API. There is currently only a frontend Git repository in this workspace; the backend must also be uploaded to a repository your Render service can access, with its credential files excluded by the supplied `.gitignore`.

Once the new Web Service is live, its `/health` response must be:

```json
{"status":"ok","service":"ProdifyQuest API"}
```

Run `check:api` with the actual new service URL, then update EAS and rebuild:

```powershell
npx.cmd eas-cli@latest env:set --name EXPO_PUBLIC_API_URL --value "https://YOUR-BACKEND.onrender.com" --environment preview --visibility plaintext
npx.cmd eas-cli@latest build --platform android --profile preview
```

Install the newly generated APK. An already-installed APK retains the API URL embedded when it was built; changing an EAS setting does not alter that installed file. Set the production environment too if you use the `production` profile.

For the website, set `EXPO_PUBLIC_API_URL` on the frontend hosting service to the same backend origin and rebuild its web export. Set `CORS_ORIGINS=https://prodifyquest.onrender.com` on the backend to allow the website to call it. The APK does not require a browser CORS exception.
