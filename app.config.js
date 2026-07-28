const fs = require("fs");
const path = require("path");

// Which client are we building for? Set CLIENT_ID in the shell, in an EAS
// build profile's "env" block (see eas.json), or in a root .env file.
// Defaults to "scdt" so existing local workflows keep working unchanged.
const CLIENT_ID = process.env.CLIENT_ID || "scdt";
const CLIENT_DIR = path.join(__dirname, "clients", CLIENT_ID);

if (!fs.existsSync(CLIENT_DIR)) {
  throw new Error(
    `[app.config.js] No client config found at clients/${CLIENT_ID}/. ` +
    `Copy clients/_template to clients/${CLIENT_ID} and fill it in, or set CLIENT_ID to an existing client folder.`
  );
}

// Each client has its own .env (own Firebase project credentials) — load
// that instead of a single root .env.
require("dotenv").config({ path: path.join(CLIENT_DIR, ".env") });

const brand = require(path.join(CLIENT_DIR, "brand.json"));

// Prefer a client-specific asset; fall back to the shared default in
// /assets/images so a client can override just the pieces they care about
// (e.g. only the icon) without having to supply every asset.
function clientAsset(filename, fallbackFilename = filename) {
  const clientPath = path.join(CLIENT_DIR, "assets", filename);
  if (fs.existsSync(clientPath)) return `./clients/${CLIENT_ID}/assets/${filename}`;
  return `./assets/images/${fallbackFilename}`;
}

module.exports = {
  expo: {
    name: brand.appName,
    slug: brand.slug,
    version: brand.version || "1.0.0",
    orientation: "portrait",
    icon: clientAsset("icon.png"),
    scheme: brand.scheme,
    userInterfaceStyle: brand.userInterfaceStyle || "automatic",
    newArchEnabled: true,
    splash: {
      image: clientAsset("splash-icon.png"),
      resizeMode: "contain",
      backgroundColor: brand.colors.splashBackground,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: brand.bundleId,
      googleServicesFile: path.join(CLIENT_DIR, "GoogleService-Info.plist"),
    },
    android: {
      adaptiveIcon: {
        foregroundImage: clientAsset("adaptive-icon.png"),
        backgroundColor: brand.colors.splashBackground,
      },
      package: brand.bundleId,
      googleServicesFile: path.join(CLIENT_DIR, "google-services.json"),
    },
    web: {
      favicon: clientAsset("favicon.png"),
      bundler: "metro",
      // Static output = plain HTML/JS/CSS, deployable to any static host
      // (Firebase Hosting, Netlify, Vercel static, S3+CDN, etc.) with no
      // Node server required at runtime. All data access goes through the
      // Firebase client SDK, so nothing here needs server-side rendering.
      output: "static",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-font",
      "expo-web-browser",
    ],
    extra: {
      eas: {
        projectId: brand.easProjectId,
      },
      clientId: CLIENT_ID,
      // Full brand.json contents, available at runtime via lib/brand.ts.
      brand,
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      firebaseDatabaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
    },
    experiments: { typedRoutes: true },
  },
};
