// types/index.ts
export type ID = string;

export type MemberRole = "admin" | "accountant" | "loan_officer" | "committee" | "member";
export type MemberStatus = "active" | "inactive" | "pending" | "suspended" | "exited";
export type LoanStatus = 
  | "pending_loan_officer" 
  | "pending_committee" 
  | "pending_accountant" 
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

export interface Group {
  id: ID;
  name: string;
  description?: string;
  currency: string;
  logoUrl?: string;
  createdBy: ID;
  createdAt: string;
  inviteCode: string;
  contributionAmount: number;
  contributionFrequency: "monthly" | "weekly" | "biweekly" | "yearly";
  contributionDay: number;
  loanInterestRate: number;
  /**
   * How interest is calculated on loans in this group.
   * - "flat": principal * rate * months, charged up front (simple interest).
   * - "reducing_balance": interest recalculated each period on the
   *   outstanding balance (standard amortizing/bank-style loan).
   * Existing loans keep whichever method was active when they were
   * submitted (see Loan.interestMethod) — changing this setting only
   * affects loans submitted afterward.
   */
  loanInterestMethod: LoanInterestMethod;
  loanInterestRatePeriod: "monthly" | "annual"; // whether rate is per-month or per-year

  /**
   * Meeting penalties are interest-based: a percentage of the group's
   * standard contribution amount, not a fixed currency figure. This keeps
   * penalties proportional as the group's contribution amount changes over
   * time, instead of needing manual re-entry of fixed amounts.
   *   penalty = contributionAmount × (ratePct / 100)
   * Legacy fixed-amount fields are kept (optional) for backward
   * compatibility with groups that haven't been migrated yet — when both
   * are present, the percentage fields take priority.
   */
  latePenaltyRatePct?: number;           // % of contributionAmount, per meeting lateness
  absencePenaltyMemberRatePct?: number;  // % of contributionAmount, member absence
  absencePenaltyOfficerRatePct?: number; // % of contributionAmount, officer absence

  /**
   * Late-payment fees — separate from meeting-attendance penalties above.
   * Both are calculated on the AMOUNT DUE (not a flat figure):
   *   - Contributions: contributionAmount for the missed period
   *   - Loans: the specific overdue installment's total (schedule[i].total)
   * A contribution/installment becomes eligible once its due date has
   * passed and it is still unpaid. Grace-period days delay eligibility.
   */
  contributionLateFeeRatePct?: number;   // % of the missed contribution amount
  contributionLateFeeGraceDays?: number; // days after due date before a fee applies
  /**
   * Contribution late fees are only calculated for missed periods on or
   * after this date (ISO date string, e.g. "2026-01-01") — NOT retroactively
   * from a member's dateJoined. Without this, enabling late fees on an
   * existing group would immediately generate fees for every missed period
   * across each member's entire history, which is rarely what's wanted.
   * Leave unset to disable contribution late fees regardless of the rate
   * above (findOverdueContributions treats a missing start date as "not
   * configured yet").
   */
  contributionLateFeeStartDate?: string;
  loanLateFeeRatePct?: number;           // % of the overdue installment amount
  loanLateFeeGraceDays?: number;         // days after due date before a fee applies

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
  /**
   * Snapshot of the group's loanInterestMethod at the time this loan was
   * submitted. Stored on the loan (not just read live off the group) so
   * that changing the group's setting later never retroactively changes
   * the math on a loan that's already disbursed or part-repaid.
   * Falls back to "flat" for loans created before this field existed.
   */
  interestMethod?: LoanInterestMethod;
  interestRatePeriod?: "monthly" | "annual"; // snapshot of Group.loanInterestRatePeriod at submission
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
  status: LoanStatus;
  approvals: LoanApprovals;
  purpose?: string;
  guarantors?: ID[];
  schedule?: RepaymentScheduleItem[];
  applicationDate: string;
  approvalDate?: string;
  disbursementDate?: string;
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
  /**
   * Only meaningful on type === "late_fee" transactions NOT generated by
   * meeting attendance (those track "cleared" via the meeting attendee's
   * own penaltyPaid flag instead — see clearAllMemberPenalties). A
   * standalone contribution/loan late fee has no such flag to piggyback
   * on, so it gets its own here. Set by clearStandaloneLateFee(), which is
   * officer-gated the same way meeting-penalty clearing is.
   */
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