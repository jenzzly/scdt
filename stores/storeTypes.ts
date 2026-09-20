// stores/storeTypes.ts
//
// The combined store's shape, plus small helper types used by every slice
// in stores/slices/. Moved out of the old useStore.ts monolith so slice
// files can import the type without importing useStore.ts itself (which
// would be circular, since useStore.ts imports every slice).
import type { StoreApi } from "zustand";
import type {
  Group, Member, Contribution, Loan, Investment,
  WalletTransaction, Expense, Meeting, AppNotification,
  SyncStatus, ID, DeletionRecord, AuditLog,
} from "../types";
import type { OverdueContribution, OverdueInstallment } from "../utils/lateFees";

export type DataViewMode = "personal" | "group" | "admin" | "mine";

// Shared shape for the three new "edit parent record + sync its linked
// wallet transaction" actions (contributions, loans, investments). Only
// amount / date / description are editable this way — see
// updateContributionAndSync / updateLoanAndSync / updateInvestmentAndSync
// in their respective slices, and utils/linkedWalletSync.ts for the shared
// sync logic they all call.
export interface LinkedRecordEditPatch {
  amount?: number;
  date?: string;
  description?: string;
}

export interface StoreState {
  dataViewMode: DataViewMode;
  authUid: string | null;
  authName: string | null;
  authEmail: string | null;
  groups: Group[];
  activeGroupId: string | null;
  members: Member[];
  currentMember: Member | null; 
  contributions: Contribution[];
  loans: Loan[];
  investments: Investment[];
  walletTransactions: WalletTransaction[];
  expenses: Expense[];
  meetings: Meeting[];
  notifications: AppNotification[];
  deletionRecords: DeletionRecord[];
  auditLogs: AuditLog[];
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncTimestamp: number | null;
  forceSyncTrigger: number;
  isLoading: boolean;
  setDataViewMode: (mode: DataViewMode) => void;

  setAuth: (uid: string, name: string, email: string) => void;
  clearAuth: () => void;
  setGroups: (groups: Group[]) => void;
  setActiveGroup: (id: string) => void;
  upsertGroup: (group: Group) => void;
  updateGroup: (groupId: ID, data: Partial<Group>) => Promise<void>;
  setMembers: (members: Member[]) => void;
  addMemberLocal: (member: Member) => void;
  updateMemberLocal: (id: ID, data: Partial<Member>) => void;
  deleteMemberLocal: (id: ID) => void;
  setContributions: (cs: Contribution[]) => void;
  addContributionLocal: (c: Contribution) => void;
  updateContributionLocal: (id: ID, data: Partial<Contribution>) => void;
  deleteContributionLocal: (id: ID) => void;
  setLoans: (loans: Loan[]) => void;
  addLoanLocal: (loan: Loan) => void;
  updateLoanLocal: (id: ID, data: Partial<Loan>) => void;
  deleteLoanLocal: (id: ID) => void;
  setInvestments: (invs: Investment[]) => void;
  addInvestmentLocal: (inv: Investment) => void;
  updateInvestmentLocal: (id: ID, data: Partial<Investment>) => void;
  deleteInvestment: (investmentId: ID, reason: string) => Promise<void>;
  deleteInvestmentLocal: (id: ID) => void;
  createInvestment: (data: Omit<Investment, "id" | "createdAt" | "updatedAt">) => Promise<ID>;
  updateInvestment: (investmentId: ID, data: Partial<Investment>) => Promise<void>;
  // Edits an investment's amount/date/description AND, if it has already
  // reached "open" (i.e. has a linked investment_disbursement wallet tx),
  // patches that tx to match in the same call. See investmentSlice.ts.
  updateInvestmentAndSync: (investmentId: ID, data: LinkedRecordEditPatch) => Promise<void>;
  approveInvestmentStep: (investmentId: ID, step: "committee" | "accountant", approved: boolean, comment?: string) => Promise<void>;
  setWalletTxs: (txs: WalletTransaction[]) => void;
  addWalletTxLocal: (tx: WalletTransaction) => void;
  updateWalletTxLocal: (id: ID, data: Partial<WalletTransaction>) => void;
  deleteWalletTxLocal: (id: ID) => void;
  clearWalletTxs: () => void;
  setExpenses: (es: Expense[]) => void;
  addExpenseLocal: (e: Expense) => void;
  updateExpenseLocal: (id: ID, data: Partial<Expense>) => void;
  deleteExpenseLocal: (id: ID) => void;
  deleteExpense: (expenseId: ID, reason: string) => Promise<void>;
  setMeetings: (ms: Meeting[]) => void;
  addMeetingLocal: (m: Meeting) => void;
  updateMeetingLocal: (id: ID, data: Partial<Meeting>) => void;
  deleteMeetingLocal: (id: ID) => void;
  setNotifications: (ns: AppNotification[]) => void;
  setDeletionRecords: (records: DeletionRecord[]) => void;
  setAuditLogs: (logs: AuditLog[]) => void;
  markNotifReadLocal: (id: ID) => void;
  clearNotification: (id: ID) => Promise<void>;
  clearAllNotifications: () => Promise<void>;
  setSyncStatus: (s: SyncStatus, error?: string | null) => void;
  triggerForceSync: () => void;
  setLoading: (b: boolean) => void;
  recalcTotals: () => void;
  forceRefresh: () => void;

  // Meeting actions
  cancelMeeting: (meetingId: ID) => Promise<void>;
  deleteMeeting: (meetingId: ID, reason: string) => Promise<void>;
  updateMeeting: (groupId: ID, meetingId: ID, data: Partial<Meeting>) => Promise<void>;
  clearMeetingPenalty: (meetingId: ID, memberId: ID) => Promise<void>;
  clearAllMemberPenalties: (memberId: ID) => Promise<void>;

  // Loan actions
  deleteLoan: (loanId: ID, reason: string) => Promise<void>;
  // Edits a loan's amount/applicationDate/purpose AND, if it has already
  // been disbursed (i.e. has a linked loan_disbursement wallet tx),
  // patches that tx to match in the same call. Does NOT recompute the
  // repayment schedule or interest. See loanSlice.ts.
  updateLoanAndSync: (loanId: ID, data: LinkedRecordEditPatch) => Promise<void>;
  // Moves a single unpaid installment's due date (loan.schedule[index].dueDate)
  // only — no wallet tx exists for an unpaid installment, so there's
  // nothing else to sync. Throws if the installment is already paid or
  // doesn't exist. See loanSlice.ts.
  rescheduleLoanInstallment: (loanId: ID, installmentIndex: number, newDueDate: string) => Promise<void>;

  // Toggles late-fee tracking for a single loan (loan.lateFeesDisabled).
  // Disabling ALSO voids every currently-outstanding late_fee tx for that
  // loan (marks feePaid = true) so nothing lingers on the ledger. Enabling
  // only flips the flag back — it does NOT restore previously-voided fees,
  // since those were deliberately cleared. See loanSlice.ts.
  setLoanLateFeesEnabled: (loanId: ID, enabled: boolean) => Promise<void>;

  // Contribution actions
  deleteContribution: (contributionId: ID, reason: string) => Promise<void>;
  // Edits a contribution's amount/date/description AND, if it's approved
  // (i.e. has a linked "contribution"-type wallet tx), patches that tx to
  // match in the same call. Rolls back both writes together on failure.
  // See contributionSlice.ts.
  updateContributionAndSync: (contributionId: ID, data: LinkedRecordEditPatch) => Promise<void>;

  // Wallet actions
  deleteWalletTransaction: (transactionId: ID, reason: string) => Promise<void>;
  applyContributionLateFee: (overdue: OverdueContribution, customAmount?: number) => Promise<void>;
  applyLoanLateFee: (overdue: OverdueInstallment, customAmount?: number) => Promise<void>;
  clearStandaloneLateFee: (transactionId: ID) => Promise<void>;
  updateWalletTransaction: (transactionId: ID, data: Partial<WalletTransaction>, reason?: string) => Promise<void>;

  // High-level actions
  createMember: (data: Omit<Member, "id" | "totalContributions" | "totalSavings" | "loanEarnings">) => Promise<ID>;
  updateMember: (memberId: ID, data: Partial<Member>) => Promise<void>;
  approveMember: (memberId: ID) => Promise<void>;
  deleteMember: (memberId: ID) => Promise<void>;
  updateOwnProfile: (memberId: ID, data: {
    fullName?: string; email?: string; phone?: string;
    languagePreference?: string; nationalId?: string; physicalAddress?: string;
  }) => Promise<void>;
  recordContribution: (data: Omit<Contribution, "id" | "createdAt">, autoApprove?: boolean) => Promise<ID>;
  approveContribution: (contributionId: ID) => Promise<void>;
  rejectContribution: (contributionId: ID, reason: string) => Promise<void>;
  updateContribution: (contributionId: ID, data: Partial<Contribution>) => Promise<void>;
  submitLoan: (data: Omit<Loan,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "monthlyPayment"
    | "totalInterest"
    | "totalRepayable"
    | "amountRepaid"
    | "balance"
    | "lateFees"
    | "schedule"
    | "approvals"
    | "status"
    | "accruedInterest"
    | "totalInterestPaid"
    | "lastAccrualDate"
  >) => Promise<ID>;
  approveLoanStep: (loanId: ID, step: "loan_officer" | "committee" | "accountant", approved: boolean, comment?: string) => Promise<void>;
  rejectLoan: (loanId: ID, reason: string) => Promise<void>;
  updateLoan: (loanId: ID, data: Partial<Loan>) => Promise<void>;
  // disbursementDate (optional, ISO string or YYYY-MM-DD) lets the caller
  // record when the money actually left, instead of always stamping the
  // moment this action runs — see loanSlice.ts / disburseLoanServer.
  disburseLoan: (loanId: ID, disbursementDate?: string) => Promise<void>;
  recordRepayment: (loanId: ID, amount: number, date?: string) => Promise<void>;
  closeInvestment: (investmentId: ID, returnAmount: number, actualReturn?: number) => Promise<void>;
  addExpense: (data: Omit<Expense, "id" | "createdAt">) => Promise<ID>;
  deleteWalletTx: (id: ID, reason: string) => Promise<void>;
  scheduleMeeting: (data: Omit<Meeting, "id" | "createdAt">) => Promise<ID>;
  recordAttendance: (meetingId: ID, memberId: ID, attended: boolean, lateMinutes?: number) => Promise<void>;
  reset: () => void;
}

// Every slice creator gets the same set/get pair, typed against the full
// combined store (not just its own slice) — this is what lets, e.g., the
// loan slice call get().recalcTotals() even though recalcTotals is defined
// in the group slice. This is the standard Zustand "slices" pattern.
export type SetFn = StoreApi<StoreState>["setState"];
export type GetFn = StoreApi<StoreState>["getState"];