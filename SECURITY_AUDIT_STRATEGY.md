# Firestore Security Rules & Audit System Documentation

## Overview

This document describes the production-grade Firestore security rules and audit logging system implemented for the SCDT financial application.

## Security Architecture

### Membership System

**Document ID Format:** `groupId_uid`

The membership document ID follows the pattern `groupId_uid` where:
- `groupId` is the unique identifier of the group
- `uid` is the Firebase Auth user ID

This format enables efficient lookups without requiring complex queries.

**Membership Document Structure:**
```typescript
{
  userId: string,
  groupId: string,
  role: "admin" | "accountant" | "loan_officer" | "member",
  status: "pending" | "active" | "blocked"
}
```

### Role-Based Access Control (RBAC)

**Roles and Permissions:**

| Role | Permissions |
|------|-------------|
| **admin** | Full access to all group operations, can delete groups, manage members, approve/reject any action |
| **accountant** | Financial control: can create/update expenses, investments, contributions, wallet transactions |
| **loan_officer** | Loan management: can approve/reject loans, update loan status |
| **member** | Limited: can create contributions, apply for loans, read group data, update own profile |

### Active Member Status

Only members with `status === "active"` can perform financial actions:
- Create contributions
- Apply for loans
- Create wallet transactions (for their own account)

Members with `status === "pending"` or `status === "blocked"` are restricted from financial operations.

## Firestore Security Rules

### Helper Functions

**Authentication:**
- `isAuth()`: Checks if user is authenticated
- `uid()`: Returns the authenticated user's ID

**Membership Validation:**
- `membershipDocId(groupId)`: Generates the membership document ID (groupId_uid)
- `membershipDoc(groupId)`: Returns the membership document reference
- `membershipExists(groupId)`: Checks if membership document exists
- `membershipData(groupId)`: Returns membership document data
- `isMember(groupId)`: Checks if user is a member (any status)
- `isActiveMember(groupId)`: Checks if user is an active member
- `userRole(groupId)`: Returns user's role in the group

**Role Checks:**
- `isAdmin(groupId)`: Checks if user is admin
- `isAccountant(groupId)`: Checks if user is accountant
- `isLoanOfficer(groupId)`: Checks if user is loan officer
- `isAdminOrAccountant(groupId)`: Checks if user is admin or accountant
- `canManageLoans(groupId)`: Checks if user can manage loans (admin/accountant/loan_officer)

**Audit Log Validation:**
- `isValidAuditLog(groupId)`: Validates audit log entry structure and allowed actions

### Collection Rules

#### Groups (`groups/{groupId}`)
- **Read:** Members only
- **Create:** Any authenticated user
- **Update:** Admins and accountants only
- **Delete:** Admins only

#### Members (`groups/{groupId}/members/{memberId}`)
- **Read:** Members only
- **Create:** Admins/accountants can create any member; users can create their own record
- **Update:** Admins/accountants can update any field; members can update only their own safe fields (no role/status/userId/groupId changes)
- **Delete:** Admins only

#### Contributions (`groups/{groupId}/contributions/{id}`)
- **Read:** Members only
- **Create:** Active members only
- **Update:** Admins and accountants only (approve/reject)
- **Delete:** Admins only

#### Loans (`groups/{groupId}/loans/{id}`)
- **Read:** Members only
- **Create:** Active members only
- **Update:** Loan officers, accountants, and admins (approve/reject/disburse)
- **Delete:** Admins only

#### Investments (`groups/{groupId}/investments/{id}`)
- **Read:** Members only
- **Create:** Admins and accountants only
- **Update:** Admins and accountants only
- **Delete:** Admins only

#### Wallet Transactions (`groups/{groupId}/walletTransactions/{id}`)
- **Read:** Members only
- **Create:** Admins/accountants (system operations) OR active members (own transactions)
- **Update:** Admins only (for corrections)
- **Delete:** No public delete (immutable ledger)

#### Expenses (`groups/{groupId}/expenses/{id}`)
- **Read:** Members only
- **Create:** Admins and accountants only
- **Update:** Admins and accountants only
- **Delete:** Admins only

#### Meetings (`groups/{groupId}/meetings/{id}`)
- **Read:** Members only
- **Create:** Admins and accountants only
- **Update:** Admins and accountants only
- **Delete:** Admins only

#### Audit Logs (`groups/{groupId}/auditLogs/{id}`)
- **Read:** Admins and accountants only
- **Create:** Any authenticated member (must validate userId, groupId, and action)
- **Update:** No (immutable)
- **Delete:** No (immutable)

#### Deletion Records (`groups/{groupId}/deletions/{id}`)
- **Read:** All members (transparency)
- **Create:** Admins and accountants only
- **Update:** No (immutable)
- **Delete:** Admins only

#### Group Memberships (`groupMemberships/{id}`)
- **Read:** Users can only read their own membership
- **Create:** Users can create their own; admins/accountants can create for others
- **Update:** Users can update own non-sensitive fields; admins/accountants can update any
- **Delete:** Users can delete their own membership

#### Notifications (`users/{userId}/notifications/{id}`)
- **Read:** Users can only read their own notifications
- **Create:** Any authenticated user (for sending to others)
- **Update:** Users can only update their own (mark as read)
- **Delete:** Users can only delete their own

## Audit Logging System

### Audit Log Structure

```typescript
{
  id: string,
  userId: string,
  userName: string,
  groupId: string,
  action: string,
  entity: string,
  entityId: string,
  timestamp: string,
  metadata?: Record<string, unknown>
}
```

### Valid Audit Actions

The following actions are validated by Firestore rules:

- `CREATE_MEMBER`
- `APPROVE_MEMBER`
- `REJECT_MEMBER`
- `DELETE_MEMBER`
- `UPDATE_MEMBER`
- `CREATE_LOAN`
- `APPROVE_LOAN`
- `REJECT_LOAN`
- `DISBURSE_LOAN`
- `REPAY_LOAN`
- `DELETE_LOAN`
- `CREATE_CONTRIBUTION`
- `APPROVE_CONTRIBUTION`
- `REJECT_CONTRIBUTION`
- `DELETE_CONTRIBUTION`
- `CREATE_INVESTMENT`
- `UPDATE_INVESTMENT`
- `CLOSE_INVESTMENT`
- `DELETE_INVESTMENT`
- `CREATE_EXPENSE`
- `UPDATE_EXPENSE`
- `DELETE_EXPENSE`
- `CREATE_MEETING`
- `UPDATE_MEETING`
- `DELETE_MEETING`
- `RECORD_ATTENDANCE`
- `CREATE_WALLET_TX`
- `UPDATE_WALLET_TX`
- `DELETE_WALLET_TX`

### Audit Log Validation

Firestore rules enforce:
1. `userId` must match `request.auth.uid`
2. `groupId` must match the path parameter
3. `action` must be one of the valid actions listed above

This prevents tampering and ensures audit trail integrity.

### Audit Log Immutability

Audit logs are immutable:
- No update operations allowed
- No delete operations allowed
- Only admins and accountants can read
- Any authenticated member can write (for their own actions)

## Security Decisions

### 1. Membership via Separate Collection

**Decision:** Use a separate `groupMemberships` collection instead of checking member documents directly.

**Rationale:**
- Enables efficient lookups using document ID pattern (`groupId_uid`)
- Avoids complex queries on the members collection
- Provides a clear separation between membership data and member profiles
- Allows for faster permission checks

### 2. Active Member Status for Financial Actions

**Decision:** Require `status === "active"` for financial operations.

**Rationale:**
- Prevents pending members from making financial commitments
- Allows admins to review and approve members before they can participate
- Provides a safety mechanism for onboarding new members
- Reduces risk of fraudulent or unauthorized transactions

### 3. Role-Based Granular Permissions

**Decision:** Implement specific roles with distinct responsibilities.

**Rationale:**
- Follows principle of least privilege
- Enables separation of duties (e.g., loan officer vs accountant)
- Provides clear accountability for different types of actions
- Scales well as the organization grows

### 4. Immutable Audit Logs

**Decision:** Audit logs cannot be updated or deleted.

**Rationale:**
- Ensures audit trail integrity
- Prevents tampering or cover-ups
- Provides reliable historical record for compliance
- Meets financial industry audit requirements

### 5. Wallet Transaction Immutability

**Decision:** Wallet transactions cannot be deleted publicly; only admins can update for corrections.

**Rationale:**
- Maintains immutable ledger principle
- Prevents unauthorized removal of financial records
- Allows for legitimate corrections by admins
- Provides audit trail for all corrections

### 6. Safe Field Updates for Members

**Decision:** Members can only update their own non-sensitive fields (no role/status/userId/groupId changes).

**Rationale:**
- Prevents privilege escalation
- Allows members to update profile information
- Protects critical system fields from tampering
- Maintains data integrity

### 7. Admin-Only Deletions

**Decision:** Only admins can delete most entities (members, contributions, loans, investments, expenses, meetings).

**Rationale:**
- Provides strong control over data deletion
- Prevents accidental or malicious data loss
- Ensures accountability for destructive operations
- Aligns with financial data retention requirements

## Deployment Instructions

### Deploy Firestore Rules

```bash
firebase use --add
# Select your project (tontine-41adb)
firebase deploy --only firestore:rules
```

### Verify Rules

After deployment, verify rules using the Firebase Console:
1. Go to Firestore > Rules
2. Check for syntax errors
3. Use the Simulator to test common operations

## Migration Notes

### Existing Data

The new security rules require the `groupMemberships` collection to exist with the correct document ID format (`groupId_uid`).

**Migration Steps:**
1. Ensure all existing memberships are migrated to the `groupMemberships` collection
2. Verify document IDs follow the `groupId_uid` pattern
3. Update member documents to include the `_docId` field for Firestore document ID
4. Test permission checks for all user roles

### Breaking Changes

1. **Membership Validation:** The app must use the `groupMemberships` collection for permission checks
2. **Audit Log Format:** Audit logs must include `userId`, `groupId`, `action`, `entity`, and `entityId`
3. **_init Removal:** Remove any `_init` placeholder document patterns from the codebase
4. **Active Member Check:** Financial operations now require active member status

## Testing Checklist

### Permission Tests

- [ ] Admin can create/update/delete groups
- [ ] Admin can create/update/delete members
- [ ] Accountant can create/update expenses and investments
- [ ] Loan officer can approve/reject loans
- [ ] Active member can create contributions
- [ ] Active member can apply for loans
- [ ] Pending member cannot perform financial actions
- [ ] Member can update own profile (safe fields only)
- [ ] Member cannot update role/status

### Audit Log Tests

- [ ] Audit logs are created for all important actions
- [ ] Audit logs validate userId and groupId
- [ ] Audit logs validate action type
- [ ] Only admins/accountants can read audit logs
- [ ] Audit logs cannot be updated or deleted

### Membership Tests

- [ ] Membership document ID follows `groupId_uid` pattern
- [ ] Membership validation works for all operations
- [ ] Active member status is enforced for financial actions
- [ ] Role-based permissions work correctly

## Compliance Notes

This security design aligns with financial industry best practices:

1. **Audit Trail:** Immutable audit logs for all important actions
2. **Access Control:** Role-based permissions with least privilege
3. **Data Integrity:** Immutable ledger for financial transactions
4. **Accountability:** Clear audit trail with user identification
5. **Separation of Duties:** Distinct roles for different responsibilities

## Future Enhancements

1. **Cloud Functions:** Consider using Cloud Functions for server-side audit log generation to ensure consistency
2. **Field-Level Security:** Implement field-level security rules for sensitive data
3. **Time-Based Rules:** Add time-based access restrictions for certain operations
4. **IP Restrictions:** Consider IP-based access restrictions for admin operations
5. **Multi-Factor Authentication:** Integrate MFA for sensitive operations

## Support

For issues related to Firestore security rules:
1. Check the Firebase Console Rules Simulator
2. Review the Firestore logs for permission errors
3. Verify the `groupMemberships` collection structure
4. Ensure user authentication is working correctly
