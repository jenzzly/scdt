# SCDT User Journeys & Role Permissions

This document outlines the user journey for each role in the SCDT application, including their available screens, permissions, and typical workflows.

---

## 1. ADMIN - Full System Access

### Role Overview
The Admin has complete control over the application and all groups they manage.

### Login & Onboarding Journey
```
1. Visit app → not logged in
2. Click "Login" → login.tsx
3. Enter email & password
4. Firebase Auth validates
5. App checks role from member.permissions in Firestore
6. If role = "admin" → Dashboard loads
7. All features available
```

### Navigation & Available Screens
**Desktop (Sidebar Navigation):**
- Dashboard
- Contributions
- Loans
- Investments
- Meetings
- Members ← (Admin only)
- Wallet ← (Admin only)
- Reports
- More

**Mobile (Bottom Tabs):**
- Dashboard
- Contributions
- Loans
- Meetings
- Reports
- More (includes Members, Wallet, Settings)

### Permission Matrix

| Action | Allowed | Screen | Notes |
|--------|---------|--------|-------|
| View Dashboard | ✅ Yes | dashboard.tsx | Full KPI access |
| Add Contribution | ✅ Yes | modals/add-contribution.tsx | Own contributions |
| Approve Contributions | ✅ Yes | contributions.tsx | All pending contributions |
| View All Contributions | ✅ Yes | contributions.tsx | Group-wide visibility |
| Apply for Loan | ✅ Yes | modals/add-loan.tsx | Own loans |
| Approve Loans | ✅ Yes | loans.tsx | All pending loan stages |
| Override Loan Rate | ✅ Yes | modals/add-loan.tsx | Custom interest rates |
| Disburse Loans | ✅ Yes | loans.tsx | Release funds |
| Record Loan Repayment | ✅ Yes | modals/record-repayment.tsx | Process repayments |
| Approve Investments | ✅ Yes | investments.tsx | All pending investments |
| Create Investments | ✅ Yes | modals/add-investment.tsx | For group |
| View Wallet Ledger | ✅ Yes | wallet.tsx | Complete transaction history |
| Create Manual Transactions | ✅ Yes | wallet.tsx | Manual adjustments |
| Manage Members | ✅ Yes | members.tsx | Full member administration |
| Create User Accounts | ✅ Yes | modals/create-user.tsx | Via secondary auth |
| Reset Member Passwords | ✅ Yes | members.tsx | Send password reset emails |
| Delete Members | ✅ Yes | members.tsx | Permanent removal |
| Approve New Members | ✅ Yes | members.tsx | Mark pending → active |
| Change Member Roles | ✅ Yes | members.tsx | Reassign admin/accountant/etc |
| Schedule Meetings | ✅ Yes | modals/add-meeting.tsx | Create & manage |
| Mark Attendance | ✅ Yes | meetings.tsx | Check off attendees |
| View All Reports | ✅ Yes | reports.tsx | Financial + compliance |
| Manage Group Settings | ✅ Yes | group-settings.tsx | All settings |
| Change Contribution Goals | ✅ Yes | group-settings.tsx | Target amounts, periods |
| Set Loan Interest Rates | ✅ Yes | group-settings.tsx | Default rates |
| View Audit Logs | ✅ Yes | more.tsx | All actions logged |
| Switch Data View | ✅ Yes | header | Toggle "My View" ↔ "Admin View" |

### Typical Admin Workflow

#### Day 1: Group Setup
```
1. Login as Admin
2. Navigate to Members screen
3. Create accounts for key roles:
   - Accountant (1 person)
   - Loan Officer (1-2 people)
   - Committee Members (3-5 people)
   - Regular Members (rest of group)
4. Configure group settings:
   - Set default loan interest rate (e.g., 10%)
   - Enable contribution goals (e.g., ₹10,000/month)
   - Set meeting schedule
5. Schedule first group meeting
6. Send invitations → modals/add-meeting.tsx
```

#### Day-to-Day: Approvals & Oversight
```
1. Open Dashboard → view KPIs
2. Check "Pending Approvals":
   - Contributions awaiting approval
   - Loans in approval workflow
3. Go to Contributions screen
4. Review pending contributions
5. Click "Approve" button
   - Status: pending → approved
   - Wallet transaction created
   - Member notified
6. Go to Loans screen
7. For loans in "pending_loan_officer" stage:
   - Click "Approve" → moves to "pending_committee"
8. For loans in "pending_committee" stage:
   - Click "Approve" → moves to "approved"
9. For "approved" loans:
   - Click "Disburse"
   - Wallet transaction created (loan_disbursement)
   - Member receives funds
10. Check Wallet ledger
    - Verify transactions recorded correctly
    - Audit trail complete
```

#### Monthly: Reporting & Analysis
```
1. Go to Reports screen
2. View month-to-date summary:
   - Total contributions received
   - Loans disbursed & repaid
   - Investment returns
   - Wallet balance
3. Download report (CSV/PDF)
4. Identify trends:
   - Members behind on contributions
   - Late loan repayments
5. Navigate to Members screen
6. View member contribution totals
7. Investigate discrepancies
8. View Audit Logs in "More" screen
9. Confirm all transactions have audit trail
```

#### Quarterly: Settings Review
```
1. Go to Group Settings
2. Review contribution goals:
   - Adjust target amounts if needed
   - Change period if needed
3. Review loan terms:
   - Adjust default interest rate
   - Review any custom rates used
4. Review member roles:
   - Promote/demote committee members
   - Add new loan officers if needed
5. Schedule next quarterly meeting
```

---

## 2. ACCOUNTANT - Financial & Member Management

### Role Overview
Accountants handle all approvals for contributions, manage the wallet ledger, and assist with member administration.

### Login & Onboarding Journey
```
1. Visit app → not logged in
2. Admin creates account for accountant via Members screen
3. Accountant receives password reset email
4. Sets password, logs in
5. App checks role = "accountant"
6. Dashboard loads with limited features
7. Accountant-specific screens appear in navigation
```

### Navigation & Available Screens
**Desktop (Sidebar Navigation):**
- Dashboard
- Contributions (own + all for approval)
- Loans (view all, no approval)
- Meetings
- Members (limited - view & assist, cannot delete)
- Wallet ← (Accountant specific)
- Reports
- More

**Mobile (Bottom Tabs):**
- Dashboard
- Contributions
- Loans
- Meetings
- Reports
- More

### Permission Matrix

| Action | Allowed | Screen | Notes |
|--------|---------|--------|-------|
| View Dashboard | ✅ Yes | dashboard.tsx | Limited KPIs (no loan approvals) |
| Add Contribution | ✅ Yes | modals/add-contribution.tsx | Own contributions only |
| Approve Contributions | ✅ Yes | contributions.tsx | **Primary responsibility** |
| View All Contributions | ✅ Yes | contributions.tsx | Group-wide visibility |
| Apply for Loan | ✅ Yes | modals/add-loan.tsx | Own loans only |
| Approve Loans | ❌ No | loans.tsx | Loan Officer/Committee handle |
| Override Loan Rate | ❌ No | modals/add-loan.tsx | Admins only |
| Disburse Loans | ✅ Yes | loans.tsx | After committee approves |
| Record Loan Repayment | ✅ Yes | modals/record-repayment.tsx | Process member repayments |
| Approve Investments | ❌ No | investments.tsx | Committee only |
| Create Investments | ✅ Yes | modals/add-investment.tsx | Submit for approval |
| View Wallet Ledger | ✅ Yes | wallet.tsx | **Primary responsibility** |
| Create Manual Transactions | ✅ Yes | wallet.tsx | Record adjustments |
| Manage Members | ✅ Limited | members.tsx | View, create, reset password |
| Create User Accounts | ✅ Yes | modals/create-user.tsx | Via secondary auth |
| Reset Member Passwords | ✅ Yes | members.tsx | Send password reset emails |
| Delete Members | ❌ No | members.tsx | Admin only |
| Approve New Members | ✅ Yes | members.tsx | Mark pending → active |
| Change Member Roles | ❌ No | members.tsx | Admin only |
| Schedule Meetings | ✅ Yes | modals/add-meeting.tsx | Create & manage |
| Mark Attendance | ✅ Yes | meetings.tsx | Check off attendees |
| View All Reports | ✅ Yes | reports.tsx | Financial summary + reconciliation |
| Manage Group Settings | ❌ No | group-settings.tsx | Admin only |
| Switch Data View | ❌ No | header | Cannot toggle views |

### Typical Accountant Workflow

#### Morning: Approval Queue
```
1. Login as Accountant
2. Open Dashboard
3. Check pending contributions widget
4. Go to Contributions screen
5. Filter: status = "pending"
6. For each pending contribution:
   - Review amount & member
   - Click "Approve"
   - Status changes to "approved"
   - Wallet transaction created
   - Member notified
7. Repeat until queue is clear
```

#### Mid-Day: Loan Disbursement
```
1. Go to Loans screen
2. Filter: status = "approved" (awaiting disbursement)
3. For each approved loan:
   - Click "Disburse"
   - Enter disbursement date
   - Confirm member details
   - Submit
   - Loan status → "disbursed"
   - Wallet transaction created (loan_disbursement)
   - Member notified
```

#### Afternoon: Wallet Reconciliation
```
1. Go to Wallet screen
2. Review today's transactions:
   - All contributions approved
   - All loans disbursed
   - All repayments recorded
3. Check running balance:
   - Should match sum of all transactions
4. If discrepancy found:
   - Investigate audit logs
   - Create manual adjustment transaction if needed
   - Document reason
5. Export wallet ledger:
   - Date range: last 30 days
   - Format: CSV for spreadsheet
   - Save to files for backup
```

#### End of Month: Member Account Setup
```
1. Go to Members screen
2. Filter: status = "pending"
3. For each pending new member:
   - Review application
   - Click "Approve"
   - Status → "active"
   - Member can now participate
   - Send welcome notification
```

#### Weekly: Repayment Recording
```
1. Check for loan repayments received
2. Go to Loans screen
3. For each active loan with new repayment:
   - Click "Record Repayment"
   - Enter amount received
   - Select repayment date
   - Apply to principal & interest split
   - Submit
   - Wallet transaction created (loan_repayment)
   - Track remaining balance
```

---

## 3. LOAN OFFICER - Loan & Investment Approvals

### Role Overview
Loan Officers are responsible for approving loan applications and reviewing investments. They provide the first layer of loan approval in the multi-stage workflow.

### Login & Onboarding Journey
```
1. Admin creates account via Members screen
2. Sets role = "loan_officer"
3. Loan Officer receives password reset email
4. Sets password, logs in
5. App detects role and loads limited dashboard
6. Loan-specific screens highlighted in navigation
```

### Navigation & Available Screens
**Desktop (Sidebar Navigation):**
- Dashboard
- Contributions (view all, cannot approve)
- Loans ← (Loan Officer specific)
- Investments (limited - review not approve)
- Meetings
- Members (view only)
- Reports
- More

**Mobile (Bottom Tabs):**
- Dashboard
- Loans
- Meetings
- Reports
- More

### Permission Matrix

| Action | Allowed | Screen | Notes |
|--------|---------|--------|-------|
| View Dashboard | ✅ Yes | dashboard.tsx | Loan-focused KPIs |
| Add Contribution | ✅ Yes | modals/add-contribution.tsx | Own contributions only |
| Approve Contributions | ❌ No | contributions.tsx | Accountant handles |
| View All Contributions | ✅ Yes | contributions.tsx | Read-only visibility |
| Apply for Loan | ✅ Yes | modals/add-loan.tsx | Own loans only |
| Approve Loans | ✅ Yes | loans.tsx | **Primary responsibility** (first stage) |
| Override Loan Rate | ❌ No | modals/add-loan.tsx | Admin only |
| Disburse Loans | ❌ No | loans.tsx | Accountant/Admin handle |
| Record Loan Repayment | ❌ No | modals/record-repayment.tsx | Accountant/Admin handle |
| Approve Investments | ❌ No | investments.tsx | Committee only |
| Create Investments | ✅ Yes | modals/add-investment.tsx | Submit for approval |
| View Wallet Ledger | ❌ No | wallet.tsx | Finance staff only |
| Create Manual Transactions | ❌ No | wallet.tsx | Admin/Accountant only |
| Manage Members | ❌ No | members.tsx | View only |
| Create User Accounts | ❌ No | modals/create-user.tsx | Admin/Accountant only |
| Reset Member Passwords | ❌ No | members.tsx | Admin/Accountant only |
| Delete Members | ❌ No | members.tsx | Admin only |
| Approve New Members | ❌ No | members.tsx | Admin/Accountant only |
| Change Member Roles | ❌ No | members.tsx | Admin only |
| Schedule Meetings | ✅ Yes | modals/add-meeting.tsx | Create & manage |
| Mark Attendance | ✅ Yes | meetings.tsx | Check off attendees |
| View All Reports | ✅ Yes | reports.tsx | Loan-focused reports |
| Manage Group Settings | ❌ No | group-settings.tsx | Admin only |
| Switch Data View | ❌ No | header | Cannot toggle views |

### Typical Loan Officer Workflow

#### Morning: Loan Approval Queue
```
1. Login as Loan Officer
2. Open Dashboard
3. Check "Pending Loan Approvals" widget
4. Go to Loans screen
5. Filter: status = "pending_loan_officer"
6. For each pending loan:
   - Review:
     - Member name & history
     - Loan amount requested
     - Purpose
     - Proposed repayment schedule
   - Click loan → view details
   - Check: Does member have capacity to repay?
   - Check: Loan purpose is reasonable?
   - Click "Approve" or "Reject"
   - If approve:
     - Status → "pending_committee"
     - Forwarded to committee members
     - Member notified "Awaiting committee approval"
   - If reject:
     - Status → "rejected"
     - Member notified with reason
7. Repeat until queue is clear
```

#### Mid-Day: Investigation & Documentation
```
1. Member calls to inquire about loan status
2. Go to Loans screen
3. Search for member's loan
4. View current status:
   - pending_loan_officer: Still being reviewed
   - pending_committee: Passed first stage, awaiting committee
   - approved: Both stages done, waiting for accountant to disburse
   - disbursed: Funds released, repayment in progress
5. Provide status update to member
6. If stuck at pending stage:
   - Check notes on loan for rejection reason
   - If error, click "Reopen Loan" to reconsider
```

#### Weekly: Portfolio Review
```
1. Go to Reports screen
2. Filter: Loans by Loan Officer (self)
3. View stats:
   - How many loans approved by me?
   - How many are currently active?
   - Default rate on my approvals?
4. Identify patterns:
   - Which members consistently repay well?
   - Which members have high default risk?
5. Share insights with committee
6. Use data to refine approval criteria
```

#### Quarterly: Performance Review
```
1. Pull comprehensive loan report:
   - Filter: loans approved by me (last quarter)
   - Status breakdown (active, repaid, defaulted)
   - Performance metrics (on-time repayment %, default rate)
2. Compare against committee approvers:
   - Are my default rates better/worse?
   - Any patterns to address?
3. Discuss with Admin/Committee:
   - Opportunities to improve approval accuracy
   - New loan products to support
```

---

## 4. COMMITTEE - Investment & Loan Approvals

### Role Overview
Committee members represent the group's collective decision-making. They provide the second stage of loan approval and all investment approvals.

### Login & Onboarding Journey
```
1. Admin designates members as "committee" role
2. Committee members receive password reset email
3. Set password, log in
4. App identifies role and loads committee dashboard
5. Specific approval screens available
```

### Navigation & Available Screens
**Desktop (Sidebar Navigation):**
- Dashboard
- Contributions (view all, cannot approve)
- Loans (review approved, cannot first-stage approve)
- Investments ← (Committee specific)
- Meetings
- Members (view only)
- Reports
- More

**Mobile (Bottom Tabs):**
- Dashboard
- Loans
- Investments
- Meetings
- Reports
- More

### Permission Matrix

| Action | Allowed | Screen | Notes |
|--------|---------|--------|-------|
| View Dashboard | ✅ Yes | dashboard.tsx | Investment + loan-focused KPIs |
| Add Contribution | ✅ Yes | modals/add-contribution.tsx | Own contributions only |
| Approve Contributions | ❌ No | contributions.tsx | Accountant handles |
| View All Contributions | ✅ Yes | contributions.tsx | Read-only visibility |
| Apply for Loan | ✅ Yes | modals/add-loan.tsx | Own loans only |
| Approve Loans | ✅ Yes | loans.tsx | **Second-stage approval** (pending_committee stage) |
| Override Loan Rate | ❌ No | modals/add-loan.tsx | Admin only |
| Disburse Loans | ❌ No | loans.tsx | Accountant/Admin handle |
| Record Loan Repayment | ❌ No | modals/record-repayment.tsx | Accountant/Admin handle |
| Approve Investments | ✅ Yes | investments.tsx | **Primary responsibility** |
| Create Investments | ✅ Yes | modals/add-investment.tsx | Submit own |
| View Wallet Ledger | ❌ No | wallet.tsx | Finance staff only |
| Create Manual Transactions | ❌ No | wallet.tsx | Admin/Accountant only |
| Manage Members | ❌ No | members.tsx | View only |
| Create User Accounts | ❌ No | modals/create-user.tsx | Admin/Accountant only |
| Reset Member Passwords | ❌ No | members.tsx | Admin/Accountant only |
| Delete Members | ❌ No | members.tsx | Admin only |
| Approve New Members | ❌ No | members.tsx | Admin/Accountant only |
| Change Member Roles | ❌ No | members.tsx | Admin only |
| Schedule Meetings | ✅ Yes | modals/add-meeting.tsx | Create & manage |
| Mark Attendance | ✅ Yes | meetings.tsx | Check off attendees |
| View All Reports | ✅ Yes | reports.tsx | Investment + loan reports |
| Manage Group Settings | ❌ No | group-settings.tsx | Admin only |
| Switch Data View | ❌ No | header | Cannot toggle views |

### Typical Committee Workflow

#### Weekly: Loan Committee Review
```
1. Login as Committee Member
2. Open Dashboard
3. Check "Loans Awaiting Committee Approval" widget
4. Go to Loans screen
5. Filter: status = "pending_committee"
6. For each pending loan:
   - Review:
     - Loan officer's recommendation (approved by them)
     - Member details
     - Loan amount & purpose
     - Repayment schedule
     - Member's financial history
   - Discuss with other committee members:
     - Is amount reasonable?
     - Is purpose aligned with group values?
     - Can member repay?
   - Click loan → view full details
   - Click "Approve" or "Reject"
   - If approve:
     - Status → "approved" (ready for disbursement)
     - Accountant/Admin will disburse next
     - Member notified
   - If reject:
     - Status → "rejected"
     - Member notified with reason
```

#### Ongoing: Investment Approvals
```
1. Go to Investments screen
2. Filter: status = "pending"
3. For each pending investment:
   - Review:
     - Investment description & goals
     - Target amount & timeline
     - Expected return/revenue
     - Risk assessment
   - Committee members discuss:
     - Does this align with group strategy?
     - Is capital deployment reasonable?
     - Can group afford to lose this investment?
   - Click "Approve" or "Request Revision"
   - If approve:
     - Status → "approved"
     - Funds allocated from wallet
     - Investment begins
     - Member notified
   - If request revision:
     - Investment goes back to proposer
     - Feedback message sent
```

#### Monthly: Investment Tracking
```
1. Go to Investments screen
2. Filter: status = "active"
3. For each active investment:
   - Review progress:
     - How much has been spent?
     - Any returns received?
     - Are we on schedule?
   - Update notes if needed:
     - Progress updates
     - Expected completion date
4. Review completed investments:
   - Total amount invested
   - Total returns received
   - ROI %
   - Compare to expectations
```

#### Quarterly: Committee Meeting
```
1. Open Meetings screen
2. Committee scheduled a meeting
3. Review agenda:
   - Major loans for approval
   - Investment proposals
   - Group financial health
4. Meeting date arrives
5. Mark attendance as "Attended"
6. Take notes on resolutions:
   - Loans approved/rejected
   - Investments approved/rejected
   - Recommendations for group
7. Update meeting document with decisions
```

---

## 5. MEMBER - Personal Finance & Participation

### Role Overview
Regular members are the primary users of the application. They contribute to the savings group, apply for loans, and track their personal finances.

### Login & Onboarding Journey
```
1. Invited by group admin
2. Receives welcome email with login link
3. First-time login:
   - onboarding.tsx flow
   - Read about group
   - Accept terms & conditions
   - Complete profile (name, phone, email)
4. Redirect to welcome.tsx
   - Choose "Join Existing Group" or "Create New Group"
5. Select group
6. Join → status = "pending"
7. Admin approves membership
8. Dashboard loads with full member access
9. Can now submit contributions & loans
```

### Navigation & Available Screens
**Desktop (Sidebar Navigation - Hidden on Web, Members typically use mobile):**
- Dashboard
- Contributions
- Loans
- Meetings
- More (limited options)

**Mobile (Bottom Tabs):**
- Dashboard
- Contributions
- Loans
- Meetings
- More

### Permission Matrix

| Action | Allowed | Screen | Notes |
|--------|---------|--------|-------|
| View Dashboard | ✅ Yes | dashboard.tsx | **Own KPIs only** |
| Add Contribution | ✅ Yes | modals/add-contribution.tsx | **Own contributions only** |
| Approve Contributions | ❌ No | contributions.tsx | Cannot approve (wait for accountant) |
| View Own Contributions | ✅ Yes | contributions.tsx | Filter: "My contributions" |
| View All Contributions | ❌ No | contributions.tsx | Cannot see other members' |
| Apply for Loan | ✅ Yes | modals/add-loan.tsx | Submit own loan request |
| Approve Loans | ❌ No | loans.tsx | Cannot approve |
| Override Loan Rate | ❌ No | modals/add-loan.tsx | Cannot override |
| Disburse Loans | ❌ No | loans.tsx | Cannot disburse (accountant does) |
| Record Loan Repayment | ✅ Yes | modals/record-repayment.tsx | Record own repayments |
| View Own Loans | ✅ Yes | loans.tsx | See only personal loans |
| View All Loans | ❌ No | loans.tsx | Cannot see other members' |
| Approve Investments | ❌ No | investments.tsx | Committee only |
| Create Investments | ❌ No | modals/add-investment.tsx | Cannot create |
| View Wallet Ledger | ❌ No | wallet.tsx | Finance staff only |
| View Own Transactions | ✅ Yes | dashboard.tsx | Personal contribution/loan history |
| Manage Members | ❌ No | members.tsx | Cannot access |
| Create User Accounts | ❌ No | modals/create-user.tsx | Cannot create |
| Reset Password | ✅ Yes | More screen | Self-service password reset |
| Schedule Meetings | ❌ No | modals/add-meeting.tsx | Admin/Accountant only |
| View Meetings | ✅ Yes | meetings.tsx | See upcoming meetings |
| Mark Attendance | ✅ Yes | meetings.tsx | Check "I will attend" |
| View All Reports | ❌ No | reports.tsx | Cannot access (admin only) |
| Manage Group Settings | ❌ No | group-settings.tsx | Admin only |
| Switch Data View | ❌ No | header | Only see own data (no toggle) |

### Typical Member Workflow

#### Week 1: Joining the Group
```
1. Receive email: "You've been invited to join SCDT"
2. Click link → login.tsx
3. Enter email & password (set by admin)
4. First login → onboarding.tsx
   - Welcome message
   - Read group info
   - Accept terms
   - Complete profile
5. Click "I'm ready"
6. Redirect to Dashboard
7. Status shows "Membership pending admin approval"
8. Wait for admin to approve
9. (Admin approves → status = "active")
10. Now can participate
```

#### Week 2: First Contribution
```
1. Login to app
2. Dashboard shows:
   - Contribution goal (e.g., ₹500 this week)
   - My contribution total so far: ₹0
   - Days left in period: 6 days
3. Click "Add Contribution" button
4. add-contribution.tsx opens:
   - Amount field: enter ₹500
   - Type: "Regular" (dropdown)
   - Description: "Weekly savings"
5. Click "Submit"
6. Contribution created (status = pending)
7. Notification sent to accountant
8. Dashboard updates → "Pending: ₹500"
9. Wait for accountant approval
10. Accountant approves
11. Status changes to "approved"
12. Wallet transaction created
13. Contribution now counts toward goal
```

#### Month 2: Loan Application
```
1. Need emergency funds
2. Dashboard shows: Eligible to borrow (based on contributions)
3. Click "Apply for Loan" → modals/add-loan.tsx
4. Form:
   - Loan amount: ₹5,000
   - Purpose: "Medical emergency"
   - Proposed interest rate: Group default (10%)
   - Repayment plan: 12 monthly installments
5. Click "Submit"
6. Loan created (status = "pending_loan_officer")
7. Notification: "Your loan is under review"
8. (Loan Officer approves → "pending_committee")
9. (Committee approves → "approved")
10. (Accountant disburses → "disbursed")
11. Funds appear in member's wallet
12. Can withdraw or use for payments
```

#### Month 2-3: Loan Repayment
```
1. Loan disbursed: ₹5,000
2. Repayment schedule shows: ₹417/month (principal + interest)
3. First payment due: March 1st
4. Click "Record Repayment"
5. modals/record-repayment.tsx:
   - Loan: [auto-filled]
   - Amount received: ₹417
   - Date: March 1st
   - Notes: "Monthly installment"
6. Click "Submit"
7. Wallet transaction created
8. Remaining balance: ₹4,583 (principal part)
9. Interest recorded separately
10. Dashboard shows: "Loan repayment on time"
11. Repeat monthly until loan paid off
```

#### Monthly: Check Dashboard
```
1. Login → Dashboard
2. View personal summary:
   - Total contributions: ₹2,000 (approved)
   - Pending contributions: ₹500 (waiting approval)
   - Active loans: ₹4,166 remaining
   - Monthly repayment: ₹417 (on time)
   - Contribution goal: 80% complete
   - Days left: 7 days
3. Quick actions available:
   - Add another contribution
   - View detailed contribution history
   - Check loan repayment schedule
   - See meeting attendance record
4. Navigate to Contributions → See own contribution history
5. Navigate to Loans → See own loan status & repayment progress
6. Navigate to Meetings → Mark attendance for next meeting
```

#### Quarterly: Annual Review
```
1. Pull up personal dashboard
2. Review annual summary:
   - Total contributed: ₹8,000
   - Loans taken: 2 loans
   - Loans repaid: 1 loan (fully)
   - Current loan balance: ₹4,166
   - Total interest paid: ₹500
3. Compare to group:
   - How do I rank in contributions?
   - (Cannot see others' details - privacy)
4. Plan next quarter:
   - Increase contributions?
   - Prepare to repay current loan?
   - Consider applying for investment return share?
```

---

## 6. RESTRICTED ACCESS - Screen Visibility Matrix

### Desktop Sidebar - What Each Role Sees

| Screen | Admin | Accountant | Loan Officer | Committee | Member |
|--------|-------|-----------|--------------|-----------|--------|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Contributions | ✅ | ✅ | ✅ | ✅ | ✅ |
| Loans | ✅ | ✅ | ✅ | ✅ | ✅ |
| Investments | ✅ | ✅ | ✅ | ✅ | ❌ |
| Meetings | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Members** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Wallet** | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reports | ✅ | ✅ | ✅ | ✅ | ❌ |
| More | ✅ | ✅ | ✅ | ✅ | ✅ |

### Data Filtering - What Members See

| Data | Visible To | Details |
|------|-----------|---------|
| Own Contributions | All members | Can view only their own submissions |
| All Contributions | Admin, Accountant, Loan Officer, Committee | View all group contributions |
| Own Loans | All members | Can view only their own loans |
| All Loans | Admin, Accountant, Loan Officer, Committee | View all group loans |
| Own Investments | Committee member (if they created it) | Can view own proposal |
| All Investments | Admin, Committee | Full visibility to all proposals |
| Wallet Transactions | Admin, Accountant | Complete ledger access |
| Member List | Admin, Accountant, Loan Officer | Name, role, status, contact |
| Audit Logs | Admin only | All system actions |
| Group Settings | Admin only | All configuration |

---

## 7. Data View Modes (Admin-Only Feature)

### Admin Toggle: "My View" ↔ "Admin View"

**My View (Default):**
- Admin sees own contributions only
- Admin sees own loans only
- Own personal data
- Like a regular member view

**Admin View (Toggle via header):**
- Admin sees ALL group data
- View all members' contributions
- View all loans
- Access to all administrative screens
- Full wallet ledger
- Audit logs

```
Feature Location: Header of app/(tabs)/_layout.tsx
├── Only visible to admin role
├── Toggle button: "My View" → "Admin View"
└── Affects data filtering throughout app
    ├── Contributions screen: Shows all vs. own
    ├── Loans screen: Shows all vs. own
    ├── Members screen: Shows all with actions vs. read-only
    └── Dashboard KPIs: Group-wide vs. personal
```

---

## 8. Multi-Group Support

### Member in Multiple Groups

A member can belong to multiple savings groups. When logging in:

```
1. Login as member
2. Dashboard shows: "Select your group"
3. Dropdown list of all groups member belongs to
4. Select one group
5. All data filtered to that group:
   - Contributions for this group only
   - Loans from this group only
   - Members of this group only
6. Can switch groups:
   - Header dropdown: "Switch Group"
   - All data reloads for new group
7. Role may differ per group:
   - Admin in Group A
   - Member in Group B
   - Committee in Group C
```

**Key Point:** Permissions are group-specific. Admin must be assigned per group.

---

## 9. Permission Escalation Scenarios

### Scenario 1: Member Promoted to Accountant
```
Before:
├── Role: member
├── Screens: Dashboard, Contributions (own), Loans (own), Meetings, More
└── Actions: Submit contributions & loans only

Event: Admin changes member role to "accountant"

After:
├── Role: accountant
├── Screens: Dashboard, Contributions (all), Loans, Members, Wallet, Reports, More
├── New permissions:
│   ├── Approve contributions
│   ├── Disburse loans
│   ├── Record repayments
│   ├── Manage wallet ledger
│   ├── Create user accounts
│   └── Reset member passwords
└── Immediate effect on next login
```

### Scenario 2: Accountant Demoted to Member
```
Before:
├── Role: accountant
└── Full approval & wallet access

Event: Admin changes role to "member"

After:
├── Role: member
├── Limited screens re-appear
└── All approval/management actions disabled
    ├── Contribution approvals: No button visible
    ├── Wallet: Screen removed from sidebar
    ├── Members: Screen removed from sidebar
```

### Scenario 3: Committee Member Resigns
```
Admin action: Mark member status = "exited"

Result:
├── Member cannot login (account disabled)
├── Cannot approve loans/investments anymore
├── Historical approvals remain in audit trail
├── No data deletion (audit trail preserved)
```

---

## 10. Permission Check Code Patterns

### How Screens Check Permissions

```typescript
// Example: contributions.tsx

export function ContributionsScreen() {
  const { currentMember } = useStore();
  
  // Check if can approve
  const canApprove = currentMember?.permissions?.approveContributions;
  
  // Check if can view all (admin/accountant/loan_officer)
  const canViewAll = 
    currentMember?.role === "admin" ||
    currentMember?.role === "accountant" ||
    currentMember?.role === "loan_officer";
  
  return (
    <>
      {canViewAll && (
        <FilterButton>All Contributions</FilterButton>
      )}
      
      {!canViewAll && (
        <FilterButton>My Contributions</FilterButton>
      )}
      
      {canApprove && (
        <ApproveButton>Approve selected</ApproveButton>
      )}
    </>
  );
}
```

### Navigation Filtering Pattern

```typescript
// lib/auth/permissions.ts

export function getWebNavForRole(role, permissions) {
  if (role === "admin") {
    return FULL_WEB_NAV; // All screens
  }
  
  if (role === "accountant") {
    return ACCOUNTANT_WEB_NAV; // Specific subset
  }
  
  if (role === "loan_officer") {
    return LOAN_OFFICER_WEB_NAV; // Loan-focused
  }
  
  if (role === "committee") {
    return COMMITTEE_WEB_NAV; // Investment + loan focused
  }
  
  return MEMBER_WEB_NAV; // Limited personal access
}
```

---

## 11. Common Permission Denial Scenarios

### Scenario: Member Tries to Approve Contribution
```
Location: contributions.tsx
Action: Member clicks contribution in list
Result: No "Approve" button visible (permissionDenied)
Reason: approveContributions = false
Message: "You don't have permission to approve contributions"
Recovery: Contact an accountant to approve
```

### Scenario: Loan Officer Tries to Access Wallet
```
Location: sidebar navigation
Action: Loan Officer searches for "Wallet"
Result: Wallet screen not in navigation
Reason: role = "loan_officer" → only sees LOAN_OFFICER_WEB_NAV
Message: (Screen simply doesn't appear)
Recovery: Contact admin if wallet access needed
```

### Scenario: Committee Member Tries to Reset Password
```
Location: members.tsx
Action: Committee member clicks member → "Reset Password"
Result: Button disabled or not visible
Reason: role = "committee" → cannot reset passwords
Message: "Only admin/accountant can reset passwords"
Recovery: Contact admin to reset password
```

### Scenario: Firestore Rule Blocks Admin Create User
```
Action: Admin (secondary auth) tries to createUserAsAdmin()
Error: "Permission denied"
Reason: Secondary auth instance used but Firestore rule doesn't allow
Solution: Check secondary auth is properly configured
Verification: Firestore rules should allow secondary auth user
```

---

## 12. Quick Reference - Role at a Glance

### ADMIN
- **Primary Role:** Full system control
- **Key Actions:** Manage members, all approvals, settings
- **Screens:** All screens visible
- **Data:** All group data + "My View" toggle
- **Special:** Can create accounts, reset passwords, delete members

### ACCOUNTANT
- **Primary Role:** Financial gatekeeper
- **Key Actions:** Approve contributions, disburse loans, manage wallet
- **Screens:** All except Members deletion
- **Data:** All group data (read-only on members)
- **Special:** Wallet ledger, manual transactions, member account creation

### LOAN_OFFICER
- **Primary Role:** Loan approval (first stage)
- **Key Actions:** Review & approve loan applications
- **Screens:** Dashboard, Loans, Members (view), Reports
- **Data:** All loans visible, member financial history
- **Special:** First-stage loan approval only

### COMMITTEE
- **Primary Role:** Strategic approvals
- **Key Actions:** Second-stage loan approval, all investment approvals
- **Screens:** Dashboard, Loans, Investments, Meetings, Reports
- **Data:** All loans & investments for oversight
- **Special:** Investment approval authority, collective decision-making

### MEMBER
- **Primary Role:** Personal participation
- **Key Actions:** Submit contributions, apply for loans, mark attendance
- **Screens:** Dashboard, Contributions, Loans, Meetings
- **Data:** Own data only (privacy-protected)
- **Special:** Limited to personal financial management

---

## 13. Summary Table - Permissions Quick Lookup

| Capability | Admin | Accountant | Loan Officer | Committee | Member |
|-----------|-------|-----------|--------------|-----------|--------|
| Submit Contribution | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve Contribution | ✅ | ✅ | ❌ | ❌ | ❌ |
| View Wallet Ledger | ✅ | ✅ | ❌ | ❌ | ❌ |
| Apply for Loan | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1st Stage Loan Approval | ✅ | ❌ | ✅ | ❌ | ❌ |
| 2nd Stage Loan Approval | ✅ | ❌ | ❌ | ✅ | ❌ |
| Disburse Loan | ✅ | ✅ | ❌ | ❌ | ❌ |
| Record Loan Repayment | ✅ | ✅ | ❌ | ❌ | ✅ |
| Create Investment | ✅ | ✅ | ✅ | ✅ | ❌ |
| Approve Investment | ✅ | ❌ | ❌ | ✅ | ❌ |
| View All Members | ✅ | ✅ | ✅ | ✅ | ❌ |
| Create User Account | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reset Member Password | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete Member | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage Group Settings | ✅ | ❌ | ❌ | ❌ | ❌ |
| View Audit Logs | ✅ | ❌ | ❌ | ❌ | ❌ |
| Schedule Meetings | ✅ | ✅ | ✅ | ✅ | ❌ |
| View Reports | ✅ | ✅ | ✅ | ✅ | ❌ |
| Switch Data View | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 14. Implementation Notes for Developers

### Adding a New Permission Check

1. **Define permission in types/index.ts:**
```typescript
export interface MemberPermissions {
  // ... existing permissions
  canApproveNewFeature?: boolean; // NEW
}
```

2. **Set default in stores/slices/authSlice.ts:**
```typescript
const DEFAULT_MEMBER_PERMISSIONS = {
  // ... existing
  canApproveNewFeature: role === "admin", // NEW
};
```

3. **Use in component:**
```typescript
const { currentMember } = useStore();
const canApproveNewFeature = currentMember?.permissions?.canApproveNewFeature;

if (canApproveNewFeature) {
  // Show button/feature
}
```

4. **Check Firestore rule:**
```
allow write: if request.auth.uid in resource.data.permittedUsers && 
             get(/databases/$(database)/documents/groupMemberships/${groupId}_{auth.uid}).data.permissions.canApproveNewFeature == true
```

### Testing Permission Denial

1. Create test accounts with each role
2. Login as each role
3. Verify screens appear/disappear as expected
4. Attempt unauthorized actions (should fail silently or show disabled UI)
5. Check Firestore logs for "permission denied" errors
6. Verify audit trail shows who attempted what

---

**End of User Journeys Document**
