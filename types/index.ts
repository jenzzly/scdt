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
  | "contribution" | "loan_disbursement" | "loan_repayment" | "interest"
  | "late_fee" | "investment_disbursement" | "investment_return"
  | "bank_fee" | "other_credit" | "other_debit" | "withdrawal";
export type SyncStatus = "synced" | "pending" | "syncing" | "failed" | "offline";
export type ExitReason = "resignation" | "death" | "dismissal" | "transfer";

export interface AuthUser {
  uid: ID;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface MemberPermissions {
  addContribution: boolean;
  addLoan: boolean;
  addInvestment: boolean;
  downloadReports: boolean;
  updateMeetings: boolean;
  approveContributions: boolean;
  approveLoans: boolean;
  approveInvestments: boolean;
}

export const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
  addContribution: true,
  addLoan: true,
  addInvestment: false,
  downloadReports: false,
  updateMeetings: false,
  approveContributions: false,
  approveLoans: false,
  approveInvestments: false,
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
  latePenaltyAmount: number;
  maxLoanMultiplier: number;
  absencePenaltyMember?: number;
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
  repaymentPlan: "monthly" | "weekly" | "lump_sum";
  repaymentMonths: number;
  firstPaymentDate: string;
  monthlyPayment: number;
  totalInterest: number;
  totalRepayable: number;
  amountRepaid: number;
  balance: number;
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
  action: string;
  entityType: string;
  entityId: ID;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
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