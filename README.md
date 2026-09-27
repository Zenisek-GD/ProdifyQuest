# ProdifyQuest app

This is the Expo SDK 57 / React Native 0.86 client for ProdifyQuest. Use Expo Go for SDK 57 when testing on a phone. See [the project README](../README.md) for Firebase setup, local development, mobile devices, testing and browser deployment.

```powershell
npm install
npm run web
```

The active screens are in `app/(tabs)`, authentication is in `context/auth.tsx`, and the API client is in `scripts/api.ts`. Set `EXPO_PUBLIC_API_URL` only when the backend uses a different host (see `.env.example`).
