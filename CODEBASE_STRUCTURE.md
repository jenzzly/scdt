# SCDT Savings & Tontine Application - Codebase Structure & Architecture

## 1. PROJECT OVERVIEW

**Type:** React Native + Web Application (Expo + Expo Router)  
**Tech Stack:**
- Frontend: React Native (Expo) + TypeScript
- Backend: Firebase (Auth + Firestore)
- State Management: Zustand (with local persistence)
- Routing: Expo Router (file-based)
- UI: Native components + custom components
- Styling: React Native StyleSheet
- Payment/Finance: Wallet-based transaction model

**Purpose:** A savings group management application (tontine/SCDT) where members contribute regular savings, take loans, make investments, and track financial metrics. The app supports role-based access control (Admin, Accountant, Loan Officer, Committee, Member) with separate interfaces for web (desktop sidebar) and mobile (bottom tabs).

---

## 2. DIRECTORY STRUCTURE & WHAT EACH FOLDER DOES

```
scdt-fixed/
├── app/                           # Main application screens & routing
│   ├── _layout.tsx                # Root layout (fonts, splash screen)
│   ├── index.tsx                  # Root navigation redirector
│   ├── group-settings.tsx          # Group-wide settings screen
│   ├── notifications.tsx           # Notifications screen
│   ├── (auth)/                    # Authentication screens (login, register, etc.)
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   ├── welcome.tsx
│   │   ├── onboarding.tsx
│   │   └── ...
│   ├── (tabs)/                    # Main app screens (behind login)
│   │   ├── _layout.tsx            # Navigation shell (sidebar/tabs)
│   │   ├── dashboard.tsx          # Main dashboard with KPIs
│   │   ├── contributions.tsx       # Contribution tracking + goals
│   │   ├── loans.tsx              # Loan management
│   │   ├── investments.tsx        # Investment management
│   │   ├── meetings.tsx           # Meeting management + attendance
│   │   ├── members.tsx            # Member administration (NEW)
│   │   ├── wallet.tsx             # Wallet transactions
│   │   ├── reports.tsx            # Financial reports
│   │   └── more.tsx               # Additional features/settings
│   └── modals/                    # Modal dialogs for forms
│       ├── add-contribution.tsx
│       ├── add-loan.tsx           # Loan form (with rate override)
│       ├── add-investment.tsx
│       ├── add-expense.tsx
│       ├── add-meeting.tsx
│       ├── meeting-attendance.tsx
│       └── record-repayment.tsx
│
├── lib/                           # Business logic & Firebase integration
│   ├── firebase.ts                # Firebase initialization & config
│   ├── brand.ts                   # Branding (colors, logos, theme)
│   ├── auth/
│   │   ├── permissions.ts         # Role-based navigation & capabilities
│   │   ├── adminUsers.ts          # Admin user creation (secondary auth)
│   │   └── secondaryAuth.ts       # Secondary Firebase auth instance
│   └── firestore/                 # Domain-specific Firestore operations
│       ├── index.ts               # Barrel exports (main API)
│       ├── core.ts                # Shared utilities (refs, helpers)
│       ├── groups.ts              # Group CRUD
│       ├── members.ts             # Member CRUD + deterministic IDs
│       ├── contributions.ts        # Contribution CRUD + approvals
│       ├── loans.ts               # Loan CRUD + disbursement/repayment
│       ├── investments.ts         # Investment CRUD + approvals
│       ├── wallet.ts              # Wallet transaction CRUD
│       ├── expenses.ts            # Expense CRUD
│       ├── meetings.ts            # Meeting CRUD + attendance
│       ├── notifications.ts       # User notifications
│       ├── audit.ts               # Audit log recording
│       ├── groupInit.ts           # New group bootstrap
│       ├── deletions.ts           # Deletion history
│       └── contributionGoals.ts   # Contribution goal tracking
│
├── stores/                        # Zustand state management
│   ├── useStore.ts                # Main store (combines slices)
│   ├── storeTypes.ts              # TypeScript type definitions
│   ├── recalcGroupTotals.ts       # Financial calculations
│   ├── selectors.ts               # Memoized selectors
│   └── slices/                    # Per-domain state slices
│       ├── authSlice.ts           # Auth state
│       ├── groupSlice.ts          # Group state
│       ├── memberSlice.ts         # Member state
│       ├── contributionSlice.ts   # Contribution state
│       ├── loanSlice.ts           # Loan state
│       ├── investmentSlice.ts     # Investment state
│       ├── walletSlice.ts         # Wallet state
│       ├── expenseSlice.ts        # Expense state
│       ├── meetingSlice.ts        # Meeting state
│       ├── notificationSlice.ts   # Notification state
│       ├── auditSlice.ts          # Audit log state
│       └── syncSlice.ts           # Sync status state
│
├── hooks/                         # Custom React hooks
│   ├── useAuth.ts                 # Authentication hook
│   ├── useFirebaseSync.ts         # Firebase sync logic
│   ├── useNetworkStatus.ts        # Network status detection
│   ├── useRecalcTotals.ts         # Recalculate totals trigger
│   ├── useReports.ts              # Report generation
│   └── useUnpaidPenalties.ts      # Late fee calculations
│
├── components/                    # Reusable UI components
│   ├── ModalShell.tsx             # Modal wrapper
│   ├── charts/
│   │   └── CashflowChart.tsx      # Financial charts
│   ├── screens/
│   │   ├── DashboardScreen.tsx
│   │   └── MeetingsScreen.tsx
│   └── ui/
│       ├── index.tsx              # Main UI exports
│       ├── Input.tsx              # Text input component
│       ├── DatePicker.tsx         # Date picker component
│       ├── SyncStatusBar.tsx      # Sync status indicator
│       └── Select.tsx             # Dropdown select (items OR options)
│
├── types/                         # TypeScript type definitions
│   └── index.ts                   # Core types (User, Member, Loan, etc.)
│
├── utils/                         # Utility functions
│   ├── theme.ts                   # Colors & styling constants
│   ├── export.ts                  # Export/PDF generation
│   ├── importExport.ts            # Data import/export
│   └── lateFees.ts                # Late fee calculation logic
│
├── clients/                       # Multi-client branding
│   └── scdt/                      # SCDT client assets
│       ├── brand.json             # Brand config
│       ├── assets/                # Logo, fonts, images
│       └── ...
│
├── hooks/                         # Custom React hooks
│   └── ...
│
├── app.config.js                  # Expo configuration
├── babel.config.js                # Babel transpiler config
├── tsconfig.json                  # TypeScript config
├── package.json                   # Dependencies & scripts
├── metro.config.js                # Metro bundler config
└── README.md                      # Project documentation
```

---

## 3. DATA FLOW & ARCHITECTURE

### 3.1 Authentication Flow
```
User opens app
    ↓
_layout.tsx loads fonts & initializes app
    ↓
index.tsx checks authUid from store
    ├─ No authUid? → (auth)/ screens (login/register)
    └─ Has authUid? → (tabs)/ screens (main app)
    ↓
useAuth hook listens to Firebase Auth changes
    ↓
On login success:
  1. Firebase Auth creates user session
  2. Auth state updates store.authUid
  3. useFirebaseSync hook triggers
  4. Firestore collections load → store
  5. Router redirects to (tabs)/dashboard
```

### 3.2 State Management (Zustand Store)
```
useStore (Root Store)
├── Auth State
│   ├── authUid, authName, authEmail
│   ├── authSlice (login/logout/sync auth)
│   └── currentMember (quick access to logged-in member's data)
│
├── Group State
│   ├── groups[] - all groups user is member of
│   ├── activeGroupId - currently selected group
│   ├── groupSlice (add/update group, manage members)
│   └── recalcTotals() - recalculate group financial totals
│
├── Member State
│   ├── members[] - members in active group
│   ├── memberSlice (add/update/approve member)
│   └── setCurrentMember() - set logged-in member's data
│
├── Financial State
│   ├── contributions[] - group contributions
│   ├── loans[] - group loans
│   ├── investments[] - group investments
│   ├── walletTransactions[] - wallet ledger
│   ├── expenses[] - group expenses
│   └── Each has a slice (CRUD + approvals)
│
├── Meeting State
│   ├── meetings[] - group meetings
│   ├── meetingSlice (add/update/attendance)
│   └── Used by meetings.tsx & dashboard
│
├── Sync State
│   ├── syncStatus ("synced" | "syncing" | "pending" | "failed" | "offline")
│   ├── syncError - last sync error message
│   ├── lastSyncTimestamp
│   └── syncSlice (manages Firebase sync)
│
├── View Mode State
│   ├── dataViewMode ("mine" | "admin")
│   └── setDataViewMode() - toggle between my data & admin view
│
└── Audit & Notifications
    ├── auditLogs[] - action history
    ├── notifications[] - user notifications
    └── notificationSlice/auditSlice
```

**Key Principle:** Store is the single source of truth. All screens read from store, never directly from Firestore. Firebase sync happens via useFirebaseSync hook.

### 3.3 Firebase Firestore Structure
```
/groups/{groupId}
  ├── Basic info: name, description, founded
  ├── Financial: wallet balance, loan interest rate
  ├── Settings: contribution goal amount/period, theme colors
  └── Collections:
      ├── members/{memberId}
      │   ├── userId, email, fullName, phone
      │   ├── role (admin|accountant|loan_officer|committee|member)
      │   ├── status (active|pending|inactive|suspended|exited)
      │   └── permissions object
      │
      ├── contributions/{contributionId}
      │   ├── memberId, amount, type
      │   ├── status (pending|approved|rejected)
      │   └── timestamps
      │
      ├── loans/{loanId}
      │   ├── memberId, amount, interestRate
      │   ├── status (pending_loan_officer|pending_committee|approved|disbursed|repaid)
      │   └── disbursementDate, repaymentSchedule
      │
      ├── investments/{investmentId}
      │   ├── description, targetAmount, status
      │   └── approval workflow
      │
      ├── meetings/{meetingId}
      │   ├── date, attendees[]
      │   └── resolutions
      │
      └── walletTransactions/{txId}
          ├── memberId, type, amount
          ├── source (loan|contribution|investment|manual)
          └── timestamp, description

/groupMemberships/{groupId}_{userId}
  ├── Deterministic ID (CRITICAL FOR PERMISSIONS)
  ├── userId, groupId, email, fullName
  ├── role, status, permissions
  └── Allows direct getDoc() without collection query
     (bypasses Firestore rule permission checks)

/auditLog/{entryId}
  ├── userId, groupId, action, timestamp
  ├── changes object
  └── Used for audit trail

/notifications/{userId}/userNotifications/{notificationId}
  ├── recipient userId (implicit)
  ├── title, message, actionUrl
  └── read flag
```

**Key Design Pattern - Deterministic Membership ID:**
```
Instead of: getDocs(query(collection, where("userId", "==", uid), ...))
           ← Firestore rules block this (checks entire collection)

We use: getDoc(doc(db, "groupMemberships", `${groupId}_${userId}`))
        ← Firestore rules allow this (direct doc access is simpler)

Format: "{groupId}_{userId}" — always deterministic, no query needed
Result: Prevents "Permission denied" errors during registration
```

### 3.4 Financial Model - Wallet Transactions
```
PRINCIPLE: Single Source of Truth - Wallet Transactions

Every financial movement creates a WALLET TRANSACTION:
├── Contribution approved → Create wallet TX (income)
├── Loan disbursed → Create wallet TX (debit)
├── Loan repaid → Create wallet TX (credit)
├── Investment return → Create wallet TX (income)
├── Late fee charged → Create wallet TX (debit/recovery)
└── Manual adjustment → Create wallet TX (manual)

Dashboard/Reports/Wallet totals are NEVER manually calculated:
├── Total member contributions = SUM(wallet TXs where type=contribution & memberId=X)
├── Total member loans = SUM(wallet TXs where type=loan & memberId=X)
├── Group wallet balance = SUM(all wallet TXs)
└── All other totals derived from wallet TXs

Benefits:
├── Immutable ledger (transactions never updated, only created)
├── Audit trail built-in
├── Reconciliation simple (one source)
└── No double-counting or consistency issues
```

---

## 4. KEY SCREENS & HOW THEY WORK

### 4.1 Navigation Structure - app/(tabs)/_layout.tsx
```
ROOT NAVIGATION SHELL

DESKTOP VIEW (isWide = true):
├── Sidebar (224px fixed)
│   ├── Brand section (logo, group name, toggle: "My View" / "Admin View")
│   ├── Navigation items (filtered by role):
│   │   ├── Dashboard
│   │   ├── Contributions
│   │   ├── Loans
│   │   ├── Investments
│   │   ├── Meetings
│   │   ├── Reports
│   │   ├── Members (admin/accountant/loan_officer only)
│   │   ├── Wallet (admin/accountant only)
│   │   └── More
│   └── Sync status indicator
│
├── Content pane (flex: 1)
│   └── Tabs.Navigator with Stack.Screen for each route
│       (Members & Wallet NOT displayed to avoid tab bar clutter)
│
└── Role-based filtering: getWebNavForRole(role, permissions)

MOBILE VIEW (isWide = false):
├── Top: Brand + search bar
├── Bottom: Tab bar with filtered screens
│   ├── Dashboard
│   ├── Contributions
│   ├── Loans
│   ├── Investments
│   ├── Meetings
│   ├── Reports
│   └── More
│   (Excludes: Members, Wallet, Investments from mobile)
└── href: null for web-only screens
```

### 4.2 Dashboard - app/(tabs)/dashboard.tsx
```
MAIN APP SCREEN

Purpose: Show financial overview + quick actions

Displays:
├── Group summary card (name, members count)
├── Financial KPIs (as Cards)
│   ├── Total contributions (from wallet TXs)
│   ├── Total loans outstanding (sum of active loans)
│   ├── Wallet balance (running total)
│   └── Overdue loans / Late fees
├── Recent activity (contributions, loans, approvals)
├── Quick action buttons
│   ├── Add contribution
│   ├── Apply for loan
│   └── Schedule meeting
└── Charts (cashflow, contributions trend)

Data Flow:
1. useStore() gets currentMember, activeGroupId, groups, members
2. useReports() calculates KPIs from wallet transactions
3. Render KPI cards with amounts
4. On mount: useFirebaseSync() syncs all data
5. On action: Modal opens → submit → store updates → screen re-renders
```

### 4.3 Members - app/(tabs)/members.tsx (NEW)
```
MEMBER ADMINISTRATION INTERFACE

Purpose: Admin/accountant manages group members

Features:
├── Search & Filter
│   ├── Search by name/email
│   ├── Filter by status (active/pending/inactive)
│   └── Sort by name/join date/contributions
│
├── Member List (Card Grid)
│   └── Each card shows: name, role, status, contribution total
│
├── Create User Modal
│   ├── Collect: fullName, email, phone, role
│   ├── On submit:
│   │   ├── Call createUserAsAdmin() (secondary auth)
│   │   ├── Create user in Firebase Auth
│   │   ├── Send password reset email
│   │   ├── Create member doc in Firestore
│   │   └── Store updates members[]
│   └── Keep admin logged in (secondary auth prevents logout)
│
├── Member Actions Modal
│   ├── For PENDING members:
│   │   ├── Approve (mark active)
│   │   └── Reject (mark rejected)
│   ├── For ACTIVE admin/accountant:
│   │   ├── Reset password (send reset email)
│   │   └── Delete member
│   └── For SUSPENDED: Reactivate
│
├── Statistics Bar
│   ├── Total members count
│   ├── Active count
│   └── Pending count
│
└── Role-based Permission Check:
    ├── Show members.tsx only if: admin || accountant || loan_officer
    ├── Only admins can delete
    ├── Only admin/accountant can reset passwords
    └── href: null on mobile tabs (hidden from tab bar)

Data Flow:
1. Load members[] from store
2. Filter & sort based on search/status/sort selection
3. On action: Call Firestore function (updateMember, deleteMember, etc.)
4. Store updates automatically (via useFirebaseSync listener)
5. UI re-renders with updated data
```

### 4.4 Contributions - app/(tabs)/contributions.tsx
```
CONTRIBUTION TRACKING

Purpose: Track group contributions + goals progress

Displays:
├── Contribution Summary
│   ├── Total contributions (from store.contributions[])
│   ├── Approved vs. pending
│   └── Average per member
│
├── Contribution Goal Card (if enabled)
│   ├── Target amount for current period
│   ├── Progress bar (green when achieved)
│   ├── Days remaining
│   ├── Min required contribution
│   └── Calculated via getCurrentGoalPeriod() + goalProgress useMemo
│
├── List of Contributions
│   ├── For current user: only their contributions
│   ├── For admin: all group contributions
│   ├── Status badges (pending/approved/rejected)
│   ├── Approval buttons if user has permission
│   └── Add contribution button → add-contribution.tsx modal
│
└── Filtering & Sorting
    ├── By status
    ├── By date
    └── By member

Features:
├── Add contribution form
│   ├── Amount, type, description
│   ├── On submit: Create contribution doc (status=pending)
│   └── If auto-approved: Also create wallet TX
│
├── Approve contribution
│   ├── Required permission: approveContributions
│   ├── On approve: Mark status=approved
│   ├── Create wallet TX with type=contribution
│   └── Recalculate group totals
│
└── Goal tracking
    ├── getCurrentGoalPeriod() returns current period
    ├── Calculate: totalContributed in period
    ├── Compare to target amount
    ├── Show progress % & remaining amount
    └── Auto-calculated, no manual entry

Data Structure:
├── store.contributions[] = all contributions
├── store.group.contributionGoal = goal config
│   ├── enabled (boolean)
│   ├── targetAmount
│   ├── period (monthly|quarterly|yearly)
│   └── startDate
└── store.walletTransactions[] = source for all calculations
```

### 4.5 Loans - app/(tabs)/loans.tsx
```
LOAN MANAGEMENT

Purpose: Loan applications, approvals, disbursement, repayment

Displays:
├── Loan Summary
│   ├── Total outstanding loans
│   ├── Approved vs. pending
│   ├── Total repaid
│   └── Default rate
│
├── Loan Approval Workflow
│   Step 1: Member applies → status=pending_loan_officer
│   Step 2: Loan officer approves → status=pending_committee
│   Step 3: Committee approves → status=approved (ready to disburse)
│   Step 4: Accountant/admin disburses → status=disbursed
│   Step 5: Member repays → status=repaid
│
├── Loan List (by status)
│   ├── Pending my approval
│   ├── Pending committee
│   ├── Approved & ready
│   ├── Active disbursed
│   └── Repaid/defaulted
│
└── Per-loan Actions
    ├── Approve (if permitted & in pending stage)
    ├── Reject
    ├── Disburse (mark as disbursed, create wallet TX)
    ├── Record repayment (modal → add-repayment)
    └── Record interest/late fees

Features in add-loan.tsx Modal:
├── Loan amount & purpose
├── Proposed interest rate (defaults to group.loanInterestRate)
├── RATE OVERRIDE (NEW)
│   ├── For admin/loan_officer roles only
│   ├── Input field to override default rate
│   ├── Captured in loan document
│   └── Used for calculation when disbursing
│
├── Repayment schedule
│   ├── Number of installments
│   ├── Frequency (weekly/monthly)
│   └── Auto-calculated dates
│
└── On submit:
    ├── Create loan doc (status=pending_loan_officer)
    ├── Add audit log entry
    └── Send notification to loan officer

Wallet Transaction Creation:
├── When disbursed:
│   ├── Create TX with type=loan_disbursement
│   ├── Amount=loan amount
│   └── Source=loan
├── When repayment recorded:
│   ├── Create TX with type=loan_repayment
│   ├── Split: loan_principal_recovery + loan_interest_income
│   └── Calculates from repayment amount & interest rate
└── Late fee triggers new TX: type=late_fee
```

### 4.6 Meetings - app/(tabs)/meetings.tsx
```
MEETING MANAGEMENT

Purpose: Schedule & track group meetings + attendance

Displays:
├── Meeting Calendar/List
│   ├── Upcoming meetings
│   ├── Past meetings
│   └── Meeting details (date, time, venue)
│
├── Per Meeting
│   ├── Scheduled date/time
│   ├── Attendee list (member name, attended flag)
│   ├── Meeting notes/resolutions
│   ├── Mark attendance
│   └── Edit meeting (admin only)
│
└── Add Meeting Button → add-meeting.tsx modal

Modal Features:
├── Date & time picker
├── Venue/location
├── Description/agenda
├── Attendees list (auto-populated with active members)
├── On submit:
│   ├── Create meeting doc
│   ├── Set attendee flags to false (default)
│   └── Send notification to members
│
└── After meeting:
    ├── Mark attendance (admin checks off members)
    ├── Update meeting notes/resolutions
    └── Store in meeting doc

Data:
├── store.meetings[] = all meetings
└── Each meeting doc contains:
    ├── date, time, venue
    ├── attendees: [{memberId, attended: boolean}]
    └── notes, resolutions
```

### 4.7 Wallet - app/(tabs)/wallet.tsx (Admin/Accountant)
```
WALLET LEDGER VIEW

Purpose: Complete financial transaction ledger

Displays:
├── Wallet Balance (current)
│   └── Calculated as SUM(all wallet TXs)
│
├── All Transactions Ledger
│   ├── Date, type, amount, description
│   ├── Source (loan, contribution, investment, manual)
│   ├── Member (if applicable)
│   └── Status
│
├── Filter & Search
│   ├── By type (contribution, loan_disbursement, etc.)
│   ├── By date range
│   ├── By member
│   └── By source
│
└── Export / Print
    ├── Download as CSV/PDF
    └── Reconciliation report

NOT editable:
├── Transactions are immutable (created once, never updated)
├── Only accountant can manually create TX (type=manual)
└── All automatic TXs created by other domain operations

Data:
└── store.walletTransactions[] = all TXs
    ├── All calculations derived from this single source
    ├── Dashboard uses it for KPIs
    ├── Reports use it for reconciliation
    └── Each TX is immutable proof of financial action
```

---

## 5. ROLE-BASED PERMISSIONS & ACCESS CONTROL

### 5.1 User Roles
```
ADMIN
├── Can: do everything
├── Permissions: all true
└── Navigation: FULL_WEB_NAV

ACCOUNTANT
├── Can: approve contributions, manage wallet, view all reports
├── Cannot: approve loans/investments, manage groups
└── Navigation: ACCOUNTANT_WEB_NAV

LOAN_OFFICER
├── Can: approve loans, view reports, see members
├── Cannot: approve contributions/investments, manage wallet
└── Navigation: LOAN_OFFICER_WEB_NAV

COMMITTEE
├── Can: approve loans/investments, view reports
├── Cannot: approveContributions, editMembers
└── Navigation: COMMITTEE_WEB_NAV

MEMBER
├── Can: submit contributions/loans/investments, see own data
├── Cannot: approve, manage, view all data
└── Navigation: MEMBER_WEB_NAV

GROUPS
└── Limited to group settings, cannot manage members or approvals
```

### 5.2 Permission-based Navigation
```
File: lib/auth/permissions.ts

Function: getWebNavForRole(role, permissions)
├── Takes user role + custom permissions
├── Returns NavItem[] filtered for that role
├── Each role has predefined navigation items
│
├── Example: FULL_WEB_NAV (ADMIN)
│   ├── Dashboard, Contributions, Loans, Investments
│   ├── Meetings, Members, Wallet, Reports, More
│   └── All features visible
│
└── Example: MEMBER_WEB_NAV
    ├── Dashboard, Contributions (own only), Loans (own)
    └── Meetings, More
        (No: Members, Wallet, Investments - admin only)

Used by:
├── app/(tabs)/_layout.tsx - filters sidebar items
├── app/(tabs)/_layout.tsx - filters mobile tabs
└── Every screen checks currentMember.permissions for feature access
```

### 5.3 Firestore Security Rules
```
Key Principle: Use DETERMINISTIC MEMBERSHIP IDs

Rule Examples:
├── /groups/{groupId}
│   └── allow read: if user is member (via groupMemberships/{groupId}_{uid})
│
├── /groups/{groupId}/members/{memberId}
│   └── allow read: if user is member
│
├── /groupMemberships/{groupId}_{uid}
│   └── allow read: if request.auth.uid == uid
│       (direct doc access always allowed if ID matches)
│
└── /auditLog/{entryId}
    └── allow read: if user is admin
```

**Critical Pattern:**
```
WRONG (causes permission denied):
getDocs(query(collection(db, "groups", groupId, "members"), 
       where("userId", "==", currentUserId)))
       ↑ Firestore evaluates permission on ENTIRE potential result set

CORRECT (allows access):
getDoc(doc(db, "groupMemberships", `${groupId}_${currentUserId}`))
      ↑ Direct access evaluated only on this specific doc
```

---

## 6. DATA SYNC FLOW - useFirebaseSync Hook

```
AUTOMATIC REAL-TIME SYNC

On app start:
1. Root _layout loads, calls useStore() initialization
2. useFirebaseSync hook starts (if authUid exists)
3. Sets syncStatus = "syncing"

During sync:
├── For each domain collection (groups, members, contributions, etc.):
│   ├── onSnapshot() listener on Firestore query
│   ├── When data changes: update store slice
│   ├── Store persists to localStorage (web) / AsyncStorage (native)
│   └── Component subscribes to store → re-renders
│
└── Listeners stay active (real-time updates)

Sync Status States:
├── "synced" - all data loaded, up-to-date
├── "syncing" - loading data from Firestore
├── "pending" - local changes waiting to sync
├── "failed" - sync error occurred
└── "offline" - network unavailable

Error Handling:
├── On sync error: store.syncError = error message
├── Show SyncStatusBar with error
├── Retry on network reconnect
└── useNetworkStatus() detects connectivity

Offline Support:
├── Store persists to local storage automatically
├── Actions create optimistic local updates
├── When online: upsert to Firestore
├── Conflict resolution: server timestamp wins
└── Notification shows sync status

Force Sync:
├── User can tap "Sync" button (SyncStatusBar)
├── Triggers forceSyncTrigger increment
├── useEffect re-runs, fetches fresh data
└── Useful after network outage
```

---

## 7. KEY BUSINESS LOGIC & CALCULATIONS

### 7.1 Group Financial Totals - recalcGroupTotals()
```
Function: stores/recalcGroupTotals.ts

Purpose: Calculate all financial KPIs from wallet transactions

Called: 
├── On store initialization (app startup)
├── After any transaction created/updated
└── Manual trigger via useRecalcTotals() hook

Calculations:
├── CONTRIBUTIONS
│   ├── Total = SUM(wallet TXs where type="contribution")
│   ├── Per member = SUM(... where memberId=X)
│   ├── Approved = mark status="approved"
│   └── Pending approval = status="pending"
│
├── LOANS
│   ├── Total outstanding = SUM(disbursed loans not fully repaid)
│   ├── Total approved = SUM(status="approved" or "disbursed")
│   ├── Total repaid = SUM(repaid)
│   └── Default rate = COUNT(defaulted) / COUNT(total)
│
├── WALLET BALANCE
│   ├── Running total = SUM(all wallet TXs with running balance)
│   ├── Member balance = SUM(TXs for that member)
│   └── Used for interest/dividend calculations
│
├── LATE FEES
│   ├── Overdue loans = loans past due date
│   ├── Penalty per loan = principal × 2% × days overdue
│   └── Total penalties = SUM(all overdue fees)
│
└── INVESTMENTS
    ├── Total funded = SUM(approved investment amounts)
    ├── Total returns = SUM(investment income TXs)
    └── ROI = (returns / funded) × 100
```

### 7.2 Contribution Goals - contributionGoals.ts
```
Purpose: Track contribution targets per time period

Config (in group doc):
├── group.contributionGoal.enabled (boolean)
├── group.contributionGoal.targetAmount (number)
├── group.contributionGoal.period ("monthly" | "quarterly" | "yearly")
└── group.contributionGoal.startDate

Calculation (in contributions.tsx):
├── getCurrentGoalPeriod()
│   ├── Determines current period based on startDate + period
│   ├── Returns {startDate, endDate, periodName}
│   └── Used to filter which contributions count toward goal
│
├── goalProgress useMemo:
│   ├── totalContributed = SUM(approved contributions in period)
│   ├── target = group.contributionGoal.targetAmount
│   ├── percentage = (totalContributed / target) × 100
│   ├── remaining = target - totalContributed
│   ├── daysLeft = days until end of period
│   ├── isCompleted = totalContributed >= target
│   └── minRequired = target / daysLeft (catch-up calculation)
│
└── Display:
    ├── Progress bar (green if achieved, yellow/red if behind)
    ├── Show: "₹5,000 of ₹10,000 (50%)"
    ├── Show: "₹200 minimum per day to catch up"
    └── Show: "23 days left in current period"
```

### 7.3 Late Fees / Penalties - lateFees.ts
```
Purpose: Calculate penalties for overdue loans

Trigger: 
├── Every day (or on demand) for all active loans
└── Check: dueDate < today

Calculation:
├── For each overdue loan:
│   ├── daysOverdue = today - dueDate
│   ├── penaltyRate = 2% per month (configurable)
│   ├── penalty = loanAmount × (penaltyRate × daysOverdue / 30)
│   └── Total owed = remaining principal + penalty
│
├── Storage:
│   ├── Record in wallet TX with type="late_fee"
│   ├── Link to loan doc (loanId)
│   └── Mark on loan doc: penalties.totalAmount, penalties.waived
│
└── Display:
    ├── Dashboard shows "Overdue loans: ₹5,000 with ₹250 penalties"
    ├── Loans.tsx shows penalties per loan
    └── Reports include penalty recovery tracking
```

### 7.4 Member Permissions Matrix
```
Role ADMIN: all true
Role ACCOUNTANT:
├── addContribution: false (members submit, accountant approves)
├── approveContributions: true
├── approveLoans: false
├── approveInvestments: false
├── viewAllReports: true
├── editMembers: true
├── deleteRecords: true
├── manageSettings: true
└── manageMeetings: true

Role LOAN_OFFICER:
├── approveLoans: true
├── approveInvestments: false
├── editMembers: false
├── deleteRecords: false
├── viewAllReports: true
└── manageMeetings: true

Role COMMITTEE:
├── approveLoans: true
├── approveInvestments: true
├── editMembers: false
├── viewAllReports: true
└── manageMeetings: false

Role MEMBER:
├── addContribution: true (submit own)
├── addLoan: true
├── addInvestment: true
├── Everything else: false
└── Can only view own data
```

---

## 8. IMPORTANT PATTERNS & CONVENTIONS

### 8.1 Store Slice Pattern
```typescript
// Each slice is a function: (set, get) => ({ fields & actions })

export function createMemberSlice(
  set: SetFn,
  get: GetFn,
): Pick<StoreState, "members" | "setMembers" | "..."> {
  return {
    members: [],
    
    setMembers: (members) => set({ members }),
    
    updateMember: async (groupId, memberId, updates) => {
      // 1. Call Firestore
      await updateDoc(doc(...), updates);
      
      // 2. Update local store
      set((state) => ({
        members: state.members.map(m => 
          m.id === memberId ? { ...m, ...updates } : m
        )
      }));
      
      // 3. Trigger recalc
      get().recalcTotals();
    },
  };
}

// Usage:
const { members, setMembers, updateMember } = useStore();
```

### 8.2 Component Data Fetching Pattern
```typescript
// Components DO NOT call Firestore directly
// They only read from store and dispatch actions

export function MyComponent() {
  // Get data from store
  const { members, currentMember, contributions } = useStore();
  
  // Trigger sync on mount
  useEffect(() => {
    // Sync hook already listening, data will flow in
    // No manual fetch needed
  }, []);
  
  // Filtered view (selector for performance)
  const myContributions = useMemo(
    () => contributions.filter(c => c.memberId === currentMember.id),
    [contributions, currentMember]
  );
  
  // Dispatch action on user interaction
  const handleApprove = async (id) => {
    await approveContribution(id);
    // Store updates automatically via sync listener
  };
}
```

### 8.3 Modal & Form Pattern
```typescript
// Modals in app/modals/ follow consistent structure:

export function AddContributionModal({ visible, onClose, groupId }) {
  const [amount, setAmount] = useState("");
  const { addContribution } = useStore();
  
  const handleSubmit = async () => {
    if (!amount) return;
    
    // Call store action (which calls Firestore)
    await addContribution(groupId, {
      memberId: currentMember.id,
      amount: parseFloat(amount),
      type: "regular",
      status: "pending",
      timestamp: Date.now(),
    });
    
    // Store updates via sync listener
    // Close modal
    onClose();
  };
  
  return (
    <ModalShell visible={visible} onClose={onClose} title="Add Contribution">
      <Input label="Amount" value={amount} onChangeText={setAmount} />
      <Button onPress={handleSubmit}>Submit</Button>
    </ModalShell>
  );
}
```

### 8.4 Memoization for Performance
```typescript
// Use useMemo for expensive calculations

const Summary = () => {
  const { contributions, walletTransactions } = useStore();
  
  // Recalculate only if dependencies change
  const stats = useMemo(() => ({
    total: walletTransactions
      .filter(tx => tx.type === "contribution")
      .reduce((sum, tx) => sum + tx.amount, 0),
    count: contributions.length,
    approved: contributions.filter(c => c.status === "approved").length,
  }), [contributions, walletTransactions]);
  
  return <Text>{stats.total}</Text>;
};
```

### 8.5 Error Handling Pattern
```typescript
const handleAction = async () => {
  try {
    set({ isLoading: true });
    await firebaseCall();
    // Success - store updates via listener
  } catch (error) {
    console.error("[MyComponent]", error);
    set({ error: error.message });
    // Show error toast/alert
  } finally {
    set({ isLoading: false });
  }
};
```

---

## 9. DEVELOPMENT WORKFLOW

### 9.1 Adding a New Feature
```
1. Define types in types/index.ts
   ├── Add type for new domain (e.g., FooStatus = "...")
   └── Add interface (e.g., Foo { id, name, ... })

2. Create Firestore functions in lib/firestore/foo.ts
   ├── Create CRUD functions: addFoo, updateFoo, deleteFoo, getFoos
   ├── Query functions: query by status, by member, etc.
   └── Export all in lib/firestore/index.ts

3. Create store slice in stores/slices/fooSlice.ts
   ├── Add to StoreState in stores/storeTypes.ts
   ├── Define initial state: foos: Foo[]
   ├── Actions: setFoos, addFoo, updateFoo, etc.
   └── Spread in useStore.ts: ...createFooSlice(set, get)

4. Add sync listener in hooks/useFirebaseSync.ts
   ├── onSnapshot(query(...), (docs) => setFoos(docs))
   └── Ensure listener active for new collection

5. Create screen in app/(tabs)/foo.tsx
   ├── useStore() to get foos, currentMember
   ├── Render list with filtering/sorting
   ├── Add button → opens modal
   └── Action buttons for edit/delete/approve

6. Create modal in app/modals/add-foo.tsx
   ├── Form with inputs
   ├── Call store.addFoo() on submit
   └── Close modal after success

7. Add navigation item in lib/auth/permissions.ts
   ├── Add to role-specific NAV arrays
   └── Control visibility by role

8. Update auth/permissions.ts if new permission needed
   ├── Add to MemberPermissions interface
   ├── Update DEFAULT_MEMBER_PERMISSIONS
   └── Check permission in screen
```

### 9.2 Testing Data
```
1. Create test group
   ├── Login as admin
   ├── Dashboard → Group Settings → New Group
   └── Add test members with different roles

2. Create test data
   ├── Add contributions (submit + approve)
   ├── Apply for loans (go through approval workflow)
   ├── Create investments
   └── Schedule meetings

3. Test role-based access
   ├── Login as different roles
   ├── Verify only authorized actions visible
   ├── Attempt unauthorized action (should be blocked)
   └── Check Firestore rules enforce it

4. Test sync
   ├── Make change in one tab
   ├── Open another tab
   ├── Verify change appears (real-time sync)
   └── Test offline mode (kill network)
```

### 9.3 Debugging
```
Browser DevTools (Web):
├── Redux DevTools for store (if installed)
├── Network tab to see Firestore queries
├── LocalStorage to see persisted state
└── Console for logs

React Native Debugger (Mobile):
├── AsyncStorage viewer
├── Redux DevTools
├── Network tab
└── Console logs

Firestore Console:
├── Verify data is written correctly
├── Check subcollections are created
├── Review security rule denials (Firestore Rules tab)
└── Monitor real-time listeners

Common Issues:
├── "Permission denied" → Check security rules + membership ID
├── "Cannot read property of undefined" → Check null/undefined in render
├── "Action not calling store update" → Verify store.setters called
├── "Real-time not updating" → Check onSnapshot listener in useFirebaseSync
└── "Data not persisting" → Check localStorage/AsyncStorage permissions
```

---

## 10. SUMMARY

**The application follows a classic architecture pattern:**

1. **UI Layer** (app/ screens & modals)
   - Components read from Zustand store
   - Dispatch actions on user interaction
   - No direct Firebase calls

2. **State Layer** (stores/ + Zustand slices)
   - Single source of truth for all app state
   - Persists to localStorage (web) / AsyncStorage (mobile)
   - Slices organized by domain (auth, groups, members, etc.)

3. **Sync Layer** (hooks/useFirebaseSync.ts)
   - Real-time onSnapshot() listeners for each collection
   - Automatically updates store when Firestore data changes
   - Offline support via local persistence

4. **Business Logic** (lib/firestore/ domain modules)
   - CRUD operations on Firestore collections
   - Complex workflows (loan approval, contribution goals, etc.)
   - Financial calculations (wallet totals, late fees, etc.)

5. **Security** (lib/auth/permissions.ts + Firestore rules)
   - Role-based navigation + permission checks
   - Firestore rules enforce access control
   - Deterministic membership IDs prevent permission errors

**Data always flows in one direction:**
```
User Action (click button)
    ↓
Component calls store.action()
    ↓
Store action calls Firestore operation
    ↓
useFirebaseSync listener detects change
    ↓
Store updates via onSnapshot()
    ↓
Component subscribed to store re-renders
    ↓
UI displays new data
```

This ensures consistency and makes debugging straightforward: follow the data, check the store, verify Firestore rules.
