// lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence, browserLocalPersistence } from "firebase/auth";
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

// Initialize Firebase app (singleton)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Auth with proper persistence for each platform
import type { Auth } from 'firebase/auth';
let auth: Auth;
if (Platform.OS === "web") {
  // For web, use browser local persistence
  const { getAuth, setPersistence, browserLocalPersistence } = require("firebase/auth");
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch(console.error);
} else {
  // For native platforms, use AsyncStorage persistence
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage)
  });
}

// Firestore with offline persistence enabled by default
const db = getFirestore(app);

// Realtime Database
const database = getDatabase(app);

// Storage
const storage = getStorage(app);

// Cloud Functions (loan disbursement/repayment — see functions/src/loans.ts)
const functions = getFunctions(app);

export { app, auth, db, database, storage, functions, enableNetwork, disableNetwork };