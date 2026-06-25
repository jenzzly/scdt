#!/usr/bin/env node
// scripts/sync-client-assets.js
//
// Metro (the RN/Expo JS bundler) only allows require("./literal/path.png") —
// it cannot resolve a path built from a runtime variable like CLIENT_ID.
// That's fine for the app icon/splash/adaptive-icon (Expo's prebuild step
// reads those straight off app.config.js's filesystem paths, not through
// Metro), but it's a problem for any logo image referenced via require()
// inside a component, e.g. app/(auth)/welcome.tsx's <LogoImage>.
//
// This script runs before `expo start` / `eas build` and copies the active
// client's logo to a fixed path (assets/images/brand-logo.png) that
// component code can safely require() with a literal string. Re-run it
// whenever you switch CLIENT_ID.
const fs = require("fs");
const path = require("path");

const CLIENT_ID = process.env.CLIENT_ID || "scdt";
const ROOT = path.join(__dirname, "..");
const CLIENT_DIR = path.join(ROOT, "clients", CLIENT_ID);
const TARGET_DIR = path.join(ROOT, "assets", "images");
const TARGET_PATH = path.join(TARGET_DIR, "brand-logo.png");

function findClientLogo() {
  const assetsDir = path.join(CLIENT_DIR, "assets");
  if (!fs.existsSync(assetsDir)) return null;
  for (const candidate of ["logo.png", "logo.jpg", "logo.jpeg"]) {
    const p = path.join(assetsDir, candidate);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const logoPath = findClientLogo();
if (logoPath) {
  fs.copyFileSync(logoPath, TARGET_PATH);
  console.log(`[sync-client-assets] Copied ${CLIENT_ID}'s logo -> assets/images/brand-logo.png`);
} else {
  console.warn(
    `[sync-client-assets] No clients/${CLIENT_ID}/assets/logo.(png|jpg) found — ` +
    `leaving assets/images/brand-logo.png as-is (falls back to whatever was last synced, or the shared default).`
  );
}
