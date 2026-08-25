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

export interface StoreState {
  dataViewMode: "admin" | "mine";
  authUid: string | null;
  authName: string | null;
  authEmail: string | null;
  groups: Group[];
  activeGroupId: string | null;
  members: Member[];
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
  setDataViewMode: (mode: "admin" | "mine") => void;

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
  approveInvestmentStep: (investmentId: ID, step: "committee" | "accountant", approved: boolean, comment?: string) => Promise<void>;
  setWalletTxs: (txs: WalletTransaction[]) => void;
  addWalletTxLocal: (tx: WalletTransaction) => void;
  updateWalletTxLocal: (id: ID, data: Partial<WalletTransaction>) => void;
  deleteWalletTxLocal: (id: ID) => void;
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

  // Contribution actions
  deleteContribution: (contributionId: ID, reason: string) => Promise<void>;

  // Wallet actions
  deleteWalletTransaction: (transactionId: ID, reason: string) => Promise<void>;
  applyContributionLateFee: (overdue: OverdueContribution) => Promise<void>;
  applyLoanLateFee: (overdue: OverdueInstallment) => Promise<void>;
  clearStandaloneLateFee: (transactionId: ID) => Promise<void>;

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
  submitLoan: (data: Omit<Loan, "id" | "createdAt" | "updatedAt" | "monthlyPayment" | "totalInterest" | "totalRepayable" | "amountRepaid" | "balance" | "lateFees" | "schedule" | "approvals" | "status">) => Promise<ID>;
  approveLoanStep: (loanId: ID, step: "loan_officer" | "committee" | "accountant", approved: boolean, comment?: string) => Promise<void>;
  rejectLoan: (loanId: ID, reason: string) => Promise<void>;
  updateLoan: (loanId: ID, data: Partial<Loan>) => Promise<void>;
  disburseLoan: (loanId: ID) => Promise<void>;
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
