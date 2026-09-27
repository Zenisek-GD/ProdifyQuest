import admin from "firebase-admin";

// GOOGLE_APPLICATION_CREDENTIALS selects a service account outside source control.
// No live requests are made until an authenticated API operation needs Firebase.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    ...(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {}),
  });
}

export const auth = admin.auth();
export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
