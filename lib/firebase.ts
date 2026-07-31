// lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
  setPersistence,
  browserLocalPersistence,
  type Auth,
} from "firebase/auth";
import { getFirestore, enableNetwork, disableNetwork } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { Platform } from "react-native";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const firebaseConfig = {
  apiKey: Constants.expoConfig?.extra?.firebaseApiKey ?? process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: Constants.expoConfig?.extra?.firebaseAuthDomain ?? process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: Constants.expoConfig?.extra?.firebaseProjectId ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: Constants.expoConfig?.extra?.firebaseStorageBucket ?? process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: Constants.expoConfig?.extra?.firebaseMessagingSenderId ?? process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: Constants.expoConfig?.extra?.firebaseAppId ?? process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  databaseURL: Constants.expoConfig?.extra?.firebaseDatabaseURL ?? process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
};

// Fail fast and loudly if any required config value is missing — this is
// almost always an EAS env / app.config.js wiring issue, not a code bug,
// and it's much easier to debug here than as a downstream auth/db error.
const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingKeys.length > 0) {
  throw new Error(
    `[lib/firebase.ts] Missing Firebase config values: ${missingKeys.join(", ")}. ` +
    `Check EXPO_PUBLIC_FIREBASE_* env vars are set for this build environment.`
  );
}

if (__DEV__) {
  console.log("==== FIREBASE CONFIG ====");
  console.log(JSON.stringify({
    ...firebaseConfig,
    apiKey: firebaseConfig.apiKey?.substring(0, 8) + "...",
  }, null, 2));
}

// Initialize Firebase app (singleton) — guards against re-initialization
// on web during Fast Refresh / HMR, and on native during remounts.
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Auth with proper persistence for each platform.
let auth: Auth;
if (Platform.OS === "web") {
  // Web: browser local persistence. Guard against calling initializeAuth
  // twice (e.g. Fast Refresh) by using getAuth if it's already set up.
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error("[lib/firebase.ts] Failed to set auth persistence:", error);
  });
} else {
  // Native (iOS/Android): AsyncStorage persistence.
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
}

// Firestore with offline persistence enabled by default.
const db = getFirestore(app);

// Realtime Database — explicit URL is required here because this project's
// RTDB instance lives in europe-west1 (non-default region). Without passing
// the URL, the SDK cannot infer it from projectId alone and throws:
// "FIREBASE FATAL ERROR: Can't determine Firebase Database URL."
const database = getDatabase(app, firebaseConfig.databaseURL);

// Storage
const storage = getStorage(app);

// Cloud Functions (loan disbursement/repayment — see functions/src/loans.ts)
const functions = getFunctions(app);

export { app, auth, db, database, storage, functions, enableNetwork, disableNetwork };