# Onboarding a new client

Each client gets their own folder under `clients/<client-id>/`, their own
Firebase project, and their own EAS build profiles. The app code never
changes between clients — only the contents of this folder do.

## 1. Create the client's Firebase project

In the Firebase console, create a new project for this client (separate
billing/data from every other client). Enable Auth, Firestore, Storage, and
Realtime Database the same way the existing SCDT project is set up. Add an
Android app and an iOS app using the `bundleId` you're about to put in
`brand.json` below, and download:

- `google-services.json` (Android)
- `GoogleService-Info.plist` (iOS)

## 2. Copy the template folder

```bash
cp -r clients/_template clients/<client-id>
```

Pick `<client-id>` as a short slug, e.g. `king-faisal`. This becomes the
value of `CLIENT_ID` everywhere else.

## 3. Fill in `clients/<client-id>/brand.json`

Every `REPLACE_ME` field needs a real value: app display name, Play
Store/App Store bundle id, scheme, brand colors, support contact, and the
default group-financial settings that get seeded the first time someone
creates a group on this client's app (contribution amount, loan interest
rate, penalties, etc — these mirror what's editable later in
group-settings, just used as sane day-one defaults).

`easProjectId` gets filled in after step 5.

## 4. Add credentials and assets

```bash
cp /path/to/downloaded/google-services.json clients/<client-id>/google-services.json
cp /path/to/downloaded/GoogleService-Info.plist clients/<client-id>/GoogleService-Info.plist
cp clients/_template/.env.example clients/<client-id>/.env
# then fill in clients/<client-id>/.env with the client's Firebase web config
```

Drop a 1024×1024 `icon.png`, `adaptive-icon.png`, `splash-icon.png`, and
`favicon.png` into `clients/<client-id>/assets/`. Any asset you skip falls
back to the shared default in `/assets/images/`, so you only need to
override what's actually different for this client.

**None of the files in step 4 should ever be committed to git** —
`.gitignore` already excludes `clients/*/.env`, `clients/*/google-services.json`,
and `clients/*/GoogleService-Info.plist`. `brand.json` and `assets/` *are*
meant to be committed (no secrets in them).

## 5. Register the app with EAS and get a project id

```bash
CLIENT_ID=<client-id> eas init
```

Copy the project id it gives you into `easProjectId` in this client's
`brand.json`.

## 6. Add build profiles to `eas.json`

```json
"<client-id>-preview": {
  "extends": "preview",
  "env": { "CLIENT_ID": "<client-id>" }
},
"<client-id>-production": {
  "extends": "production",
  "env": { "CLIENT_ID": "<client-id>" }
}
```

## 7. Build

```bash
CLIENT_ID=<client-id> npx expo start            # local dev for this client
eas build --profile <client-id>-preview --platform android
eas build --profile <client-id>-production --platform android
eas build --profile <client-id>-production --platform ios
```

`app.config.js` reads `CLIENT_ID` and pulls everything — app name, package
id, icon, splash, Firebase project, default group settings — from
`clients/<client-id>/`. Nothing in `/app`, `/lib`, `/stores`, or
`/components` needs to change for a new client.

## 8. Web

The web build also respects `CLIENT_ID`:

```bash
CLIENT_ID=<client-id> npx expo export -p web
```

Deploy the `dist/` output per-client (e.g. one Vercel/Firebase Hosting
project per client, or one project with `CLIENT_ID` set as a build-time env
var per deployment target).

## Cloud Functions

Each client's Firebase project also needs the Cloud Functions deployed
(loan disbursement/repayment — see `functions/README.md`):

```bash
cd functions
firebase use <client-id>          # firebase use --add the first time
firebase deploy --only functions
```
