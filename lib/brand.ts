// lib/brand.ts
//
// Runtime access to the per-client brand config that app.config.js loads
// from clients/<CLIENT_ID>/brand.json at build time and injects into
// `expo.extra.brand`. Screens/components should pull app name, colors,
// support contact, and group-seeding defaults from here instead of
// hardcoding "SCDT" / RWF / specific hex values, so the same code produces
// a correctly-branded app for every client.
//
// NOTE: this only covers things that can change at *runtime* render time
// (in-app display name, logo, colors, default financial settings used when
// seeding a new group). Things baked into the native binary — app icon,
// package/bundle id, Play Store listing name — are set in app.config.js
// directly from brand.json and aren't available to read back here; see
// CLIENT_ONBOARDING.md.
import Constants from "expo-constants";

export interface BrandColors {
  primary: string;
  navy: string;
  splashBackground: string;
  surface: string;
}

export interface BrandDefaults {
  contributionAmount: number;
  contributionFrequency: "weekly" | "monthly";
  contributionDay: number;
  loanInterestRate: number;
  loanInterestMethod: "flat" | "reducing_balance";
  loanInterestRatePeriod: "monthly" | "annual";
  latePenaltyRatePct: number;
  absencePenaltyMemberRatePct: number;
  absencePenaltyOfficerRatePct: number;
}

export interface BrandConfig {
  clientId: string;
  appName: string;
  defaultGroupName: string;
  defaultCurrency: string;
  colors: BrandColors;
  supportEmail: string;
  supportPhone: string;
  defaults: BrandDefaults;
}

// Fallback used only if a build somehow has no clients/<id>/brand.json
// wired into extra.brand (e.g. running `expo start` without app.config.js
// picking up CLIENT_ID). Keeps local dev from hard-crashing, but every real
// build should always have this populated — see app.config.js.
const FALLBACK_BRAND: BrandConfig = {
  clientId: "default",
  appName: "Savings Group",
  defaultGroupName: "Savings Group",
  defaultCurrency: "RWF",
  colors: {
    primary: "#10B981",
    navy: "#0B1C3D",
    splashBackground: "#0A0F1E",
    surface: "#FFFFFF",
  },
  supportEmail: "",
  supportPhone: "",
  defaults: {
    contributionAmount: 10000,
    contributionFrequency: "monthly",
    contributionDay: 1,
    loanInterestRate: 2,
    loanInterestMethod: "flat",
    loanInterestRatePeriod: "monthly" as const,
    latePenaltyRatePct: 5,
    absencePenaltyMemberRatePct: 10,
    absencePenaltyOfficerRatePct: 25,
  },
};

const extraBrand = Constants.expoConfig?.extra?.brand as Partial<BrandConfig> | undefined;

export const BRAND: BrandConfig = {
  ...FALLBACK_BRAND,
  ...extraBrand,
  colors: { ...FALLBACK_BRAND.colors, ...extraBrand?.colors },
  defaults: { ...FALLBACK_BRAND.defaults, ...extraBrand?.defaults },
};
