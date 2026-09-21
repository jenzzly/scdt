// types/index.ts
export type ID = string;

export type MemberRole = "admin" | "accountant" | "loan_officer" | "committee" | "member";
export type UserRole = "admin" | "accountant" | "loan_officer" | "committee" | "member" | "audit" | "groups";
export type MemberStatus = "active" | "inactive" | "pending" | "suspended" | "exited";
export type LoanStatus = 
  | "pending_loan_officer" 
  | "pending_committee" 
  | "pending_accountant"  // legacy — no longer produced; kept so old records still type-check
  | "approved" 
  | "rejected" 
  | "disbursed" 
  | "repaid" 
  | "defaulted";
export type ContributionStatus = "pending" | "approved" | "rejected";
export type ContributionType =
  | "regular" | "loan_repayment" | "loan_interest" | "late_fee"
  | "investment_funding" | "investment_return" | "penalty" | "other";
export type InvestmentStatus = "pending_committee" | "open" | "closed" | "pending";
export type WalletTxType =
  | "contribution"
  | "loan_disbursement"
  | "loan_repayment"          // legacy: combined repayment (kept for backward compat)
  | "loan_interest_income"    // interest portion of a repayment
  | "loan_principal_recovery" // principal portion of a repayment
  | "interest"
  | "late_fee"
  | "investment_disbursement" | "investment_return"
  | "bank_fee" | "other_credit" | "other_debit" | "withdrawal";

export type WalletTxSourceType = "loan" | "contribution" | "investment" | "manual";
export type SyncStatus = "synced" | "pending" | "syncing" | "failed" | "offline";
export type ExitReason = "resignation" | "death" | "dismissal" | "transfer";

export interface AuthUser {
  uid: ID;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface MemberPermissions {
  // Create / Submit
  addContribution: boolean;
  addLoan: boolean;
  addInvestment: boolean;
  
  // Approvals
  approveContributions: boolean;
  approveLoans: boolean;
  approveInvestments: boolean;

  // View & Access
  viewAllReports: boolean;
  downloadReports: boolean;

  // Management & Edits
  manageMeetings: boolean;
  editMembers: boolean;
  deleteRecords: boolean;
  manageSettings: boolean;
  /** @deprecated alias kept for backward compatibility */
  updateMeetings?: boolean;
}

export const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
  addContribution: false,
  addLoan: false,
  addInvestment: false,
  approveContributions: false,
  approveLoans: false,
  approveInvestments: false,
  viewAllReports: false,
  downloadReports: false,
  manageMeetings: false,
  editMembers: false,
  deleteRecords: false,
  manageSettings: false,
  updateMeetings: false,
};

export interface LoanApprovalStep {
  approved: boolean;
  date?: string;
  comment?: string;
  userId?: string;
}

export interface LoanApprovals {
  loanOfficer: LoanApprovalStep;
  committee: LoanApprovalStep;
  accountant: LoanApprovalStep;
}

export type LoanInterestMethod = "flat" | "reducing_balance";

export type GroupType = "savings" | "audit" | "investment" | "custom";


// Add this new type
export interface GroupRole {
  id: ID;
  name: string;
  permissions: MemberPermissions;
  isSystem?: boolean; // true for the 5 built-in roles, false/undefined for custom ones
  createdAt: string;
}

export interface Group {
  id: ID;
  name: string;
  description?: string;
  currency: string;
  logoUrl?: string;
  createdBy: ID;
  createdAt: string;
  inviteCode: string;
  groupType?: GroupType; // New field to specify group purpose
  contributionAmount: number;
  contributionFrequency: "monthly" | "weekly" | "biweekly" | "yearly";
  contributionDay: number;
  loanInterestRate: number;
  loanInterestMethod: LoanInterestMethod;
  loanInterestRatePeriod: "monthly" | "annual"; // whether rate is per-month or per-year
  latePenaltyRatePct?: number;           // % of contributionAmount, per meeting lateness
  absencePenaltyMemberRatePct?: number;  // % of contributionAmount, member absence
  absencePenaltyOfficerRatePct?: number; // % of contributionAmount, officer absence
  contributionLateFeeRatePct?: number;   // % of the missed contribution amount
  contributionLateFeeGraceDays?: number; // days after due date before a fee applies
  contributionLateFeeStartDate?: string;
  loanLateFeeRatePct?: number;           // % of the overdue installment amount
  loanLateFeeGraceDays?: number;         // days after due date before a fee applies
  contributionGoalPeriodMonths?: number;
  contributionGoalTargetAmount?: number;
  contributionGoalAnchorDate?: string;

  /** @deprecated fixed-amount penalties — retained for backward compatibility */
  latePenaltyAmount?: number;
  /** @deprecated fixed-amount penalties — retained for backward compatibility */
  absencePenaltyMember?: number;
  /** @deprecated fixed-amount penalties — retained for backward compatibility */
  absencePenaltyOfficer?: number;
  totalSavings: number;
  totalLoans: number;
  availableBalance: number;
  totalInvestments: number;
  totalInterestEarned: number;
  memberCount: number;
  rolePermissions?: Partial<Record<MemberRole, MemberPermissions>>; // per-system-role permission sets, editable
  customRoles?: GroupRole[]; // group-defined roles beyond the 5 built-in ones
  customRolePermissions?: Record<string, MemberPermissions>; // per-custom-role permission sets, keyed by roleId
}

export interface ContributionGoalConfig {
  periodMonths: number;
  targetAmount: number;
  anchorDate: string;
}

export type ContributionGoalPeriodStatus =
  | "active"
  | "completed"
  | "expired";

export interface ContributionGoalPeriod {
  id: ID;
  groupId: ID;
  periodStart: string;
  periodEnd: string;
  targetAmount: number;
  minimumContribution: number;
  status: ContributionGoalPeriodStatus;
  createdAt: string;
  completedAt?: string;
}

export interface Member {
  id: ID;
  groupId: ID;
  userId?: ID;
  fullName: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  photoUrl?: string;
  physicalAddress?: string;
  role: MemberRole;
  status: MemberStatus;
  dateJoined: string;
  languagePreference?: string;
  beneficiaries?: Beneficiary[];
  totalContributions: number;
  totalSavings: number;
  loanEarnings: number;
  exitReason?: ExitReason;
  exitDate?: string;
  exitNotes?: string;
  permissions?: MemberPermissions;
  lateFeeExemptions?: LateFeeExemption[];
  loginToken?: string;
  loginTokenExpiry?: string;
  customRoleId?: ID; 
}

export interface Beneficiary {
  id: ID;
  name: string;
  relationship: string;
  phone?: string;
  nationalId?: string;
}

export interface Contribution {
  id: ID;
  groupId: ID;
  memberId: ID;
  amount: number;
  date: string;
  status: ContributionStatus;
  contributionType: ContributionType;
  loanId?: ID;
  investmentId?: ID;
  description?: string;
  penaltyAmount?: number;
  approvedBy?: ID;
  approvedAt?: string;
  rejectedBy?: ID;
  rejectedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  createdBy?: ID;
  updatedAt?: string;
  updatedBy?: ID;
  deletedBy?: ID;
  deletedAt?: string;
  deletionReason?: string;
}

export interface Loan {
  id: ID;
  groupId: ID;
  memberId: ID;
  amount: number;
  interestRate: number;
  interestMethod?: LoanInterestMethod;
  interestRatePeriod?: "monthly" | "annual"; // snapshot of Group.loanInterestRatePeriod at submission
  lateFeeRatePct?: number;
  lateFeeGraceDays?: number;
  repaymentPlan: "monthly" | "weekly" | "lump_sum";
  repaymentMonths: number;
  firstPaymentDate: string;
  monthlyPayment: number;
  totalInterest: number;      // estimated at origination; actual may differ (daily accrual)
  totalRepayable: number;     // estimated; for daily-accrual loans this is a projection
  amountRepaid: number;       // cumulative cash received (interest + principal)
  balance: number;            // outstanding principal only
  accruedInterest: number;    // interest accrued since last payment, not yet paid
  lastAccrualDate: string;    // ISO date of last accrual calculation
  totalInterestPaid: number;  // cumulative interest actually paid
  lateFees: number;
  lateFeesDisabled?: boolean;
  status: LoanStatus;
  approvals: LoanApprovals;
  purpose?: string;
  guarantors?: ID[];
  schedule?: RepaymentScheduleItem[];
  applicationDate: string;
  approvalDate?: string;
  disbursementDate?: string;
  disbursedBy?: ID;
  expectedEndDate?: string;
  completionDate?: string;
  approvedBy?: ID;
  approvedAt?: string;
  rejectedBy?: ID;
  rejectedAt?: string;
  rejectionReason?: string;
  documentUrl?: string;
  createdAt: string;
  createdBy?: ID;
  updatedAt: string;
  updatedBy?: ID;
  deletedBy?: ID;
  deletedAt?: string;
  deletionReason?: string;
}

export interface LateFeeExemption {
  id: ID;
  /** Which kind of fee this exemption covers. */
  scope: "contribution" | "loan" | "both";
  /** Inclusive YYYY-MM-DD. */
  periodStart: string;
  /** Inclusive YYYY-MM-DD. */
  periodEnd: string;
  /** Optional admin note — shown on the exemption list. */
  reason?: string;
  createdBy: ID;
  createdByName: string;
  createdAt: string;
}

export interface RepaymentScheduleItem {
  index: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
  paid: boolean;
  paidDate?: string;
  paidAmount?: number;
}

export interface InvestmentApprovals {
  committee: LoanApprovalStep;
  accountant: LoanApprovalStep;
}

export interface Investment {
  id: ID;
  groupId: ID;
  investmentName: string;
  investmentType?: string;
  description?: string;
  representativeName?: string;
  representativeRole?: string;
  representativeId?: string;
  upiNumber?: string;
  contactPhone?: string;
  locationAddress?: string;
  investmentAmount: number;
  expectedReturn: number;
  returnAmount?: number;
  actualReturn?: number;
  closedAt?: string;
  profit?: number;
  startDate: string;
  maturityDate?: string;
  status: InvestmentStatus;
  approvals?: InvestmentApprovals;
  documentUrls?: string[];
  createdAt: string;
  createdBy?: ID;
  updatedAt: string;
  updatedBy?: ID;
  approvedBy?: ID;
  approvedAt?: string;
  rejectedBy?: ID;
  rejectedAt?: string;
  rejectionReason?: string;
  deletedBy?: ID;
  deletedAt?: string;
  deletionReason?: string;
}

export interface WalletTransaction {
  id: ID;
  groupId: ID;
  type: WalletTxType;
  sourceType?: WalletTxSourceType; // mandatory on new txs
  sourceId?: ID;                   // loanId | contributionId | investmentId
  amount: number;
  description: string;
  date: string;
  memberId?: ID;
  loanId?: ID;
  investmentId?: ID;
  contributionId?: ID;
  createdAt: string;
  createdBy?: ID;
  updatedAt?: string;
  updatedBy?: ID;
  deletedBy?: ID;
  deletedAt?: string;
  deletionReason?: string;
  feePaid?: boolean;
}

export interface Expense {
  id: ID;
  groupId: ID;
  category: "bank_charges"|"communication"|"meeting"|"system_maintenance"|"administrative"|"transport"|"other";
  amount: number;
  date: string;
  description: string;
  receiptUrl?: string;
  createdAt: string;
  createdBy?: ID;
  updatedAt?: string;
  updatedBy?: ID;
  approvedBy?: ID;
  approvedAt?: string;
  rejectedBy?: ID;
  rejectedAt?: string;
  rejectionReason?: string;
  deletedBy?: ID;
  deletedAt?: string;
  deletionReason?: string;
}

export interface Meeting {
  id: ID;
  groupId: ID;
  title: string;
  date: string;
  location?: string;
  agenda?: string;
  minutes?: string;
  resolutions?: string[];
  attendees: MeetingAttendee[];
  status: "scheduled" | "completed" | "cancelled";
  createdAt: string;
  createdBy?: ID;
  deletedBy?: ID;
  deletedAt?: string;
  deletionReason?: string;
}

export interface MeetingAttendee {
  memberId: ID;
  attended: boolean;
  status?: "present" | "absent" | "late" | "excused";
  penaltyPaid?: boolean;
  lateMinutes?: number;
  penaltyAmount?: number;
}

export interface AppNotification {
  id: ID;
  userId: ID;
  groupId?: ID;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
}

export interface AuditLog {
  id: ID;
  groupId: ID;
  userId: ID;
  userName: string;
  action: string;          // created|approved|rejected|updated|deleted|disbursed|failed|repaid
  entityType: string;
  entityId: ID;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  errorMessage?: string;   // populated when action === "failed"
  status?: "success" | "failed"; // explicit status for filtering
  timestamp: string;
}

export interface DeletionRecord {
  id: ID;
  groupId: ID;
  entityType: "contribution" | "loan" | "investment" | "meeting" | "wallet_transaction" | "expense";
  entityId: ID;
  entityData: Record<string, unknown>;
  deletedBy: ID;
  deletedByName: string;
  deletedAt: string;
  reason: string;
}