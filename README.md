# SCDT Savings Management System

A full-featured **group savings, loans, and investment management app** built with:

- **Expo Router** (file-based routing, iOS/Android/Web)
- **Firebase** (Auth, Firestore, Storage) — real-time sync
- **Zustand** — local-first state with AsyncStorage persistence
- **React Native Charts** — cashflow, savings, and loan reports
- **TypeScript** — fully typed throughout

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <your-repo>
cd scdt-savings
npm install
```

### 2. Set up Firebase

1. Go to [Firebase Console](https://console.firebase.google.com) → Create project
2. Enable **Authentication** → Email/Password
3. Enable **Firestore Database** (start in production mode)
4. Enable **Storage**
5. Go to Project Settings → Your Apps → Add Web App
6. Copy the config values

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your Firebase values:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSy...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
EXPO_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
```

### 4. Deploy Firestore Rules & Indexes

```bash
npm install -g firebase-tools
firebase login
firebase use your-project-id
firebase deploy --only firestore
```

### 5. Run the App

```bash
# Development
npm start

# Web only
npm run start:web

# Android
npm run android

# iOS
npm run ios
```

---

## 📱 Features

### 🏠 Dashboard
- Group balance hero card
- Key stats: members, active loans, investments, defaulters
- Quick actions: Contribute, New Loan, Members, Reports
- Pending approval actions (loans + contributions)
- Recent transaction feed
- 6-month cash flow bar chart

### 👥 Members
- Add/edit members with full profile (name, phone, email, national ID, address, role)
- Role-based access: Admin, Accountant, Loan Officer, Committee, Member
- Member detail with savings, loan status, contribution history
- Approve/reject pending members
- Search and filter by status

### 💳 Loans
- Full loan application flow
- Automatic eligibility check (savings × multiplier)
- Loan calculator (monthly payment, total interest, total repayable)
- Approval workflow: Pending → Approved → Disbursed → Repaid
- Repayment recording with progress tracker
- Repayment schedule generation

### 💰 Wallet
- Real-time group balance
- All transaction history (contributions, disbursements, repayments, investments)
- Income/Expense filtering
- 6-month balance trend chart

### 📊 Reports
- Overview: KPIs, cashflow chart, savings pie chart
- Member leaderboard with compliance stats
- Loan aging and summary
- Investment ROI tracking
- Close investments and record returns

### 📋 More
- Meeting scheduling and attendance tracking
- Expense recording by category
- Group profile and settings
- Invite code management

---

## 🏗 Architecture

```
scdt-savings/
├── app/
│   ├── (auth)/          # Login, Register, Onboarding
│   ├── (tabs)/          # Main tab screens
│   ├── modals/          # Add/edit forms (presented as modals)
│   ├── notifications.tsx
│   └── group-settings.tsx
├── components/
│   ├── ui/              # Design system (Button, Card, Input, Modal…)
│   ├── screens/         # Screen-level components
│   └── charts/          # Chart wrappers
├── stores/
│   └── useStore.ts      # Zustand store (local-first + Firebase sync)
├── lib/
│   ├── firebase.ts      # Firebase init
│   └── firestore.ts     # All Firestore CRUD + subscriptions
├── hooks/
│   ├── useAuth.ts       # Firebase Auth hook
│   ├── useFirebaseSync.ts  # Real-time subscription setup
│   ├── useNetworkStatus.ts # Online/offline detection
│   └── useReports.ts    # Computed report selectors
├── types/index.ts       # All TypeScript types
├── utils/theme.ts       # Colors, spacing, formatters, loan calculator
└── firestore-rules/     # Security rules + indexes
```

### Local-First Sync Flow

```
User Action
    │
    ▼
Zustand State (instant UI update)
    │
    ├── AsyncStorage (offline persistence)
    │
    └── Firestore (background write, fails silently offline)
            │
            ▼
    onSnapshot listeners (merge remote changes back into state)
```

---

## 🔐 Security Rules Summary

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| `groups` | Members | Any auth user | Admin/Accountant | Admin |
| `members` | Members | Admin/Accountant | Admin/Accountant (or self for non-role fields) | Admin |
| `contributions` | Members | Any member | Admin/Accountant | Admin |
| `loans` | Members | Any member | Admin/Accountant/Loan Officer | Admin |
| `investments` | Members | Admin/Accountant | Admin/Accountant | Admin |
| `walletTransactions` | Members | Admin/Accountant | ❌ Immutable | ❌ |
| `expenses` | Members | Admin/Accountant | Admin/Accountant | Admin |
| `meetings` | Members | Admin/Accountant | Admin/Accountant | Admin |
| `auditLogs` | Admin/Accountant | Any member | ❌ Immutable | ❌ |

---

## 🌱 Seed Demo Data

### Option A — In-app (no Firebase needed)
Tap **"Try with Demo Data"** on the welcome screen. Seeds 6 members, 20+ contributions, 3 loans, 2 investments, and wallet transactions locally.

### Option B — Firebase seed script
```bash
# Place your Firebase service account key at scripts/serviceAccountKey.json
npx ts-node scripts/seedFirebase.ts
```

---

## 📦 Key Dependencies

| Package | Purpose |
|---|---|
| `expo-router` | File-based navigation (iOS/Android/Web) |
| `firebase` | Auth, Firestore, Storage |
| `zustand` | State management with AsyncStorage persistence |
| `react-native-chart-kit` | Bar, Line, Pie charts |
| `expo-linear-gradient` | Hero card gradients |
| `@react-native-community/netinfo` | Online/offline detection |
| `expo-clipboard` | Copy invite codes |

---

## 🛠 Building for Production

### EAS Build (recommended)
```bash
npm install -g eas-cli
eas login
eas build --platform android
eas build --platform ios
```

### Web
```bash
npx expo export --platform web
# Deploy dist/ to Firebase Hosting, Vercel, or Netlify
firebase deploy --only hosting
```

---

## 💡 Adding More Features

- **Push Notifications**: Use `expo-notifications` with Firebase Cloud Messaging
- **SMS Reminders**: Integrate Twilio in a Cloud Function triggered by Firestore writes
- **PDF Statements**: Use `expo-print` + `expo-sharing` to export member statements
- **Image Uploads**: Use `expo-image-picker` + Firebase Storage (hooks are ready)
- **Multi-group**: The store already supports multiple groups — just add a group switcher UI
