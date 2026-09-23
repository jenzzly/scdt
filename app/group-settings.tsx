// app/group-settings.tsx - Complete file with role-based permissions
import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator, RefreshControl, Modal, useWindowDimensions, Switch, TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { useStore, useActiveGroup, useGroupAuditLogs } from "../stores/useStore";
import { useGroupMembers } from "../stores/selectors";
import { useAuth } from "../hooks/useAuth";
import { Input, Select, Button, useToast, Toast, Card, DatePicker, SearchBar, TabRow, BottomModal, Badge, Avatar, InfoRow, CardRow, Empty } from "../components/ui";
import { Colors, C, T, fmtCurrency, fmtDate, showConfirm, round2, uid } from "../utils/theme";
import { exportFullData, importFullData } from "../utils/importExport";
import * as FS from "../lib/firestore";
import type { AuditLog, MemberPermissions, Member, GroupRole, MemberRole } from "../types";
import { DEFAULT_MEMBER_PERMISSIONS } from "../types";
import { USER_ROLES, ROLE_LABELS } from "../types/roles";
import { createUserAsAdmin, resetUserPasswordAsAdmin } from "../lib/auth/adminUsers";
import { generateLoginToken } from "../utils/authTokens";
import { findMembershipDrift, fixMembershipDrift, type MembershipDrift } from "../lib/firestore/reconcileMemberships";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const CURRENCIES = [
  { label: "RWF — Rwandan Franc",   value: "RWF" },
  { label: "USD — US Dollar",       value: "USD" },
  { label: "EUR — Euro",            value: "EUR" },
  { label: "KES — Kenyan Shilling", value: "KES" },
];

const FREQ = [
  { label: "Monthly",   value: "monthly"  },
  { label: "Weekly",    value: "weekly"   },
  { label: "Yearly",    value: "yearly" },
];

const INTEREST_METHODS = [
  { label: "Flat (simple interest)",        value: "flat" },
  { label: "Reducing balance (amortized)",  value: "reducing_balance" },
];

const RATE_PERIODS = [
  { label: "Per Month",  value: "monthly" },
  { label: "Per Year",   value: "annual"  },
];

const ROLES = [
  { label: "Member",       value: "member"       },
  { label: "Committee",    value: "committee"    },
  { label: "Loan Officer", value: "loan_officer" },
  { label: "Accountant",   value: "accountant"   },
  { label: "Admin",        value: "admin"        },
];

const ROLE_BADGE: Record<string, "teal"|"gold"|"blue"|"green"|"red"> = {
  admin: "red", accountant: "blue", loan_officer: "green", committee: "gold", member: "teal",
};
const STATUS_BADGE: Record<string, "teal"|"gold"|"green"|"red"|"muted"> = {
  active: "green", pending: "gold", inactive: "muted", suspended: "red", exited: "muted",
};

// ─────────────────────────────────────────────
// Role permission model — system defaults + helpers
// ─────────────────────────────────────────────

const SYSTEM_ROLE_KEYS: MemberRole[] = ["admin", "accountant", "loan_officer", "committee", "member"];

// Starting-point permission templates for the 5 built-in roles.
// Admins are always full-access and can't be edited below. The other four
// are just sensible starting defaults — adjust freely in the Permissions tab.
const SYSTEM_ROLE_DEFAULT_PERMISSIONS: Record<MemberRole, MemberPermissions> = {
  admin: {
    addContribution: true, addLoan: true, addInvestment: true,
    approveContributions: true, approveLoans: true, approveInvestments: true,
    viewAllReports: true, downloadReports: true,
    manageMeetings: true, editMembers: true, deleteRecords: true, manageSettings: true,
  },
  accountant: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    approveContributions: true, viewAllReports: true, downloadReports: true,
  },
  loan_officer: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    addLoan: true, approveLoans: true, viewAllReports: true,
  },
  committee: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    approveContributions: true, approveLoans: true, approveInvestments: true, viewAllReports: true,
  },
  member: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    addContribution: true,
  },
};

const PERM_KEYS: (keyof MemberPermissions)[] = [
  "addContribution", "addLoan", "addInvestment",
  "approveContributions", "approveLoans", "approveInvestments",
  "viewAllReports", "downloadReports",
  "manageMeetings", "editMembers", "deleteRecords", "manageSettings",
];
const PERM_LABELS: Record<keyof MemberPermissions, string> = {
  addContribution: "Add Contributions",
  addLoan: "Apply for Loans",
  addInvestment: "Add Investments",
  approveContributions: "Approve Contributions",
  approveLoans: "Approve Loans",
  approveInvestments: "Approve Investments",
  viewAllReports: "View All Reports",
  downloadReports: "Export Reports",
  manageMeetings: "Manage Meetings",
  editMembers: "Edit Members",
  deleteRecords: "Delete Records",
  manageSettings: "Manage Settings",
  updateMeetings: "Update Meetings",
};
const PERM_GROUPS = [
  { label: "Create & Apply", keys: ["addContribution", "addLoan", "addInvestment"] as (keyof MemberPermissions)[] },
  { label: "Approvals", keys: ["approveContributions", "approveLoans", "approveInvestments"] as (keyof MemberPermissions)[] },
  { label: "Reports & Visibility", keys: ["viewAllReports", "downloadReports"] as (keyof MemberPermissions)[] },
  { label: "Management", keys: ["manageMeetings", "editMembers", "deleteRecords", "manageSettings"] as (keyof MemberPermissions)[] },
];

type AuditTab = "all" | "contributions" | "loans" | "members" | "investments" | "deletions" | "failed";

const AUDIT_TABS: { key: AuditTab; label: string; icon: string }[] = [
  { key: "all",           label: "All",           icon: "📋" },
  { key: "contributions", label: "Contributions", icon: "💰" },
  { key: "loans",         label: "Loans",         icon: "🏦" },
  { key: "members",       label: "Members",       icon: "👥" },
  { key: "investments",   label: "Investments",   icon: "📈" },
  { key: "deletions",     label: "Deletions",     icon: "🗑" },
  { key: "failed",        label: "Failed",        icon: "⚠️"  },
];

const AUDIT_TAB_ENTITY: Partial<Record<AuditTab, string>> = {
  contributions: "contribution",
  loans:         "loan",
  members:       "member",
  investments:   "investment",
};

const PAGE_SIZE = 20;

const MONTHS = [
  { label: "January", value: 1 }, { label: "February", value: 2 },
  { label: "March",   value: 3 }, { label: "April",    value: 4 },
  { label: "May",     value: 5 }, { label: "June",     value: 6 },
  { label: "July",    value: 7 }, { label: "August",   value: 8 },
  { label: "September", value: 9 }, { label: "October", value: 10 },
  { label: "November", value: 11 }, { label: "December", value: 12 },
];

const DAYS = Array.from({ length: 31 }, (_, i) => ({ label: String(i + 1), value: i + 1 }));

// ─────────────────────────────────────────────
// Action Badge Config
// ─────────────────────────────────────────────
const ACTION_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  created:  { bg: "#dbeafe", text: "#1d4ed8", label: "Created"  },
  approved: { bg: "#dcfce7", text: "#15803d", label: "Approved" },
  rejected: { bg: "#fee2e2", text: "#b91c1c", label: "Rejected" },
  deleted:  { bg: "#fee2e2", text: "#b91c1c", label: "Deleted"  },
  updated:  { bg: "#fef9c3", text: "#92400e", label: "Updated"  },
  disbursed:{ bg: "#f3e8ff", text: "#6b21a8", label: "Disbursed"},
  failed:   { bg: "#fee2e2", text: "#b91c1c", label: "Failed"   },
  repaid:   { bg: "#dcfce7", text: "#15803d", label: "Repaid"   },
  reverted: { bg: "#e0e7ff", text: "#4338ca", label: "Reverted"  },
};

function getActionConfig(action: string) {
  return ACTION_CONFIG[action] ?? { bg: C.elevated, text: C.text3, label: action };
}

function entityLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseNum(str: string): number | undefined {
  const v = parseFloat(str);
  return isNaN(v) ? undefined : v;
}

function getMemberStats(
  member: Member,
  wallet: any[],
  contributions: any[]
): { totalContributions: number; arrears: number; activeLoanCount: number } {
  const memberWallet = wallet.filter(t => t.memberId === member.id);
  const totalContributions = memberWallet
    .filter(t => t.type === "contribution" && t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);

  const memberContribs = contributions.filter(c => c.memberId === member.id);
  const pendingAmount = memberContribs
    .filter(c => c.status === "pending")
    .reduce((s, c) => s + c.amount, 0);

  const arrears = pendingAmount;
  const activeLoanCount = 0;

  return { totalContributions, arrears, activeLoanCount };
}

// ─────────────────────────────────────────────
// Filter Modal (Audit)
// ─────────────────────────────────────────────
function FilterModal({
  visible, onClose,
  year, month, day,
  onYearChange, onMonthChange, onDayChange,
  searchTerm, onSearchChange,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  year: number | null;
  month: number | null;
  day: number | null;
  onYearChange: (v: number | null) => void;
  onMonthChange: (v: number | null) => void;
  onDayChange: (v: number | null) => void;
  searchTerm: string;
  onSearchChange: (v: string) => void;
  onApply: () => void;
}) {
  const yearOpts  = [{ label: "All years",  value: 0 }, ...Array.from({ length: 6 }, (_, i) => { const y = new Date().getFullYear() - 2 + i; return { label: String(y), value: y }; })];
  const monthOpts = [{ label: "All months", value: 0 }, ...MONTHS];
  const dayOpts   = [{ label: "All days",   value: 0 }, ...DAYS];

  return (
    <BottomModal visible={visible} onClose={onClose} title="Filter Logs">
      <View style={{ padding: 16 }}>
        <Input
          label="Search"
          value={searchTerm}
          onChangeText={onSearchChange}
          placeholder="User, action, entity type…"
        />
        <Text style={fm.sectionLabel}>Date Range</Text>
        <View style={fm.row}>
          <View style={{ flex: 1 }}>
            <Select label="Year"  value={year  || 0} options={yearOpts}  onChange={(v) => onYearChange(v  === 0 ? null : v)} />
          </View>
          <View style={{ flex: 1 }}>
            <Select label="Month" value={month || 0} options={monthOpts} onChange={(v) => onMonthChange(v === 0 ? null : v)} />
          </View>
          <View style={{ flex: 1 }}>
            <Select label="Day"   value={day   || 0} options={dayOpts}   onChange={(v) => onDayChange(v   === 0 ? null : v)} />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
          <TouchableOpacity
            style={fm.modalClearBtn}
            onPress={() => {
              onYearChange(null);
              onMonthChange(null);
              onDayChange(null);
              onSearchChange("");
            }}
          >
            <Text style={fm.modalClearBtnText}>Clear All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={fm.modalApplyBtn} onPress={onApply}>
            <Text style={fm.modalApplyBtnText}>Apply Filters</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomModal>
  );
}

const fm = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text2,
    marginTop: 16,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  row: { flexDirection: "row", gap: 10 },
  modalClearBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalClearBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.text2,
  },
  modalApplyBtn: {
    flex: 2,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalApplyBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
});

// ─────────────────────────────────────────────
// Section Heading
// ─────────────────────────────────────────────
function SectionHeading({
  label,
  description,
  icon,
  accent = C.primary,
}: {
  label: string;
  description?: string;
  icon?: string;
  accent?: string;
}) {
  return (
    <View style={sh.container}>
      <View style={sh.titleRow}>
        <View style={[sh.accentBar, { backgroundColor: accent }]} />
        {icon ? <Text style={sh.icon}>{icon}</Text> : null}
        <Text style={[sh.label, { color: accent }]}>{label}</Text>
      </View>
      {description && <Text style={sh.description}>{description}</Text>}
    </View>
  );
}

const sh = StyleSheet.create({
  container: {
    marginTop: 4,
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  accentBar: {
    width: 3,
    height: 14,
    borderRadius: 2,
  },
  icon: {
    fontSize: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    flex: 1,
  },
  description: {
    fontSize: 11,
    color: C.text3,
    marginTop: 4,
    lineHeight: 16,
    paddingLeft: 11,
  },
});

// ─────────────────────────────────────────────
// Group at a glance card
// ─────────────────────────────────────────────
//
// A dashboard-style summary of the group's CURRENT configuration.
// Renders before the settings form so an admin sees the four numbers
// that describe the group in day-to-day life — contribution, loan
// rate, meeting penalty, late fee — before scrolling into the form
// that edits them. Each chip is color-coded to match the section
// heading it belongs to further down the page.
function GroupAtAGlanceCard({
  currency,
  contributionAmount,
  contributionFrequency,
  loanRate,
  loanRatePeriod,
  meetingPenaltyPct,
  meetingPenaltyAmount,
  lateFeePct,
  lateFeeGraceDays,
}: {
  currency: string;
  contributionAmount: number;
  contributionFrequency: string;
  loanRate: number;
  loanRatePeriod: "monthly" | "annual";
  meetingPenaltyPct: number;
  meetingPenaltyAmount: number;
  lateFeePct: number;
  lateFeeGraceDays: number;
}) {
  const freqLabel =
    contributionFrequency === "monthly"
      ? "per month"
      : contributionFrequency === "weekly"
      ? "per week"
      : contributionFrequency === "yearly"
      ? "per year"
      : "per month";

  const chips: {
    label: string;
    value: string;
    sub: string;
    color: string;
  }[] = [
    {
      label: "CONTRIBUTION",
      value: fmtCurrency(contributionAmount, currency),
      sub: freqLabel,
      color: C.primary,
    },
    {
      label: "LOAN RATE",
      value: `${loanRate}%`,
      sub: loanRatePeriod === "annual" ? "per year" : "per month",
      color: C.brandBlue,
    },
    {
      label: "LATE ARRIVAL",
      value: `${meetingPenaltyPct}%`,
      sub: `≈ ${fmtCurrency(meetingPenaltyAmount, currency)} / 15min`,
      color: C.gold,
    },
    {
      label: "MISSED CONTRIB.",
      value: `${lateFeePct}%`,
      sub:
        lateFeeGraceDays > 0
          ? `${lateFeeGraceDays}d grace`
          : "no grace period",
      color: C.error,
    },
  ];

  return (
    <View style={glanceStyles.card}>
      {/* ── Key-value chip grid ──────────────────────────────────── */}
      <View style={glanceStyles.chipGrid}>
        {chips.map((chip) => (
          <View
            key={chip.label}
            style={[
              glanceStyles.chip,
              { borderLeftColor: chip.color },
            ]}
          >
            <Text
              style={[glanceStyles.chipLabel, { color: chip.color }]}
              numberOfLines={1}
            >
              {chip.label}
            </Text>
            <Text
              style={[glanceStyles.chipValue, { color: chip.color }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {chip.value}
            </Text>
            <Text style={glanceStyles.chipSub} numberOfLines={2}>
              {chip.sub}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const glanceStyles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 4,
  },

  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 130,
    backgroundColor: C.bg,
    borderRadius: 10,
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  chipLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  chipValue: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  chipSub: {
    fontSize: 10,
    color: C.text3,
    lineHeight: 14,
  },
});

// ─────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────
function Divider() {
  return <View style={{ height: 1, backgroundColor: C.border, marginVertical: 10 }} />;
}

// ─────────────────────────────────────────────
// Setting Card
// ─────────────────────────────────────────────
function SettingCard({ children, noPadding }: { children: React.ReactNode; noPadding?: boolean }) {
  return (
    <View style={[sc.card, noPadding && sc.cardNoPadding]}>
      {children}
    </View>
  );
}

const sc = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 4,
  },
  cardNoPadding: { padding: 0 },
});

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function GroupSettingsScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= 720;
  const router = useRouter();
  const group = useActiveGroup();
  const allAuditLogs = useGroupAuditLogs();
  const { updateGroup, activeGroupId, reset, deleteMember, updateMember } = useStore();
  const { signOut } = useAuth();
  const { show, visible, msg, type } = useToast();

  const SETTINGS_TABS = [
    { key: "settings", label: "Settings", icon: "⚙️" },
    { key: "members", label: "Members", icon: "👥" },
    { key: "permissions", label: "Permissions", icon: "🔐" },
    // { key: "tokenRequests", label: "Token Requests", icon: "🔑" },
    { key: "audit", label: "Audit", icon: "📋" },
  ] as const; // TAB_ICON_AND_LABEL

  // ─── Member Management State ────────────────────────────────────────────
  const members = useGroupMembers();
  const wallet = useStore((s) => s.walletTransactions);
  const contributions = useStore((s) => s.contributions);
  const currentUserRole = useStore((s) => s.currentMember?.role);
  const currentMember = useStore((s) => s.currentMember);
  const isAdmin = currentUserRole === "admin";

  const [memberSearch, setMemberSearch] = useState("");
  const [memberTab, setMemberTab] = useState("All");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [showMemberDetail, setShowMemberDetail] = useState(false);
  const [showCreateMember, setShowCreateMember] = useState(false);
  const [showEditMember, setShowEditMember] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [creatingMember, setCreatingMember] = useState(false);
  const [savingMember, setSavingMember] = useState(false);

  // ─── Membership Reconciliation State ────────────────────────────────────
  const [checkingDrift, setCheckingDrift] = useState(false);
  const [driftResults, setDriftResults] = useState<MembershipDrift[] | null>(null);
  const [showDriftModal, setShowDriftModal] = useState(false);
  const [fixingDriftId, setFixingDriftId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    role: "member", // may be a system role value OR "custom:<roleId>"
  });

  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    role: "member", // may be a system role value OR "custom:<roleId>"
  });

  // ─── Settings Form State ────────────────────────────────────────────────
  const [currency, setCurrency] = useState(group?.currency ?? "RWF");
  const [contribAmount, setContribAmount] = useState(String(group?.contributionAmount ?? 40000));
  const [freq, setFreq] = useState(group?.contributionFrequency ?? "monthly");
  const [loanRate, setLoanRate] = useState(String(group?.loanInterestRate ?? 2));
  const [loanMethod, setLoanMethod] = useState(group?.loanInterestMethod ?? "flat");
  const [ratePeriod, setRatePeriod] = useState<"monthly" | "annual">(group?.loanInterestRatePeriod ?? "monthly");

  const [lateRatePct, setLateRatePct] = useState(String(group?.latePenaltyRatePct ?? 5));
  const [absenceMemberPct, setAbsenceMemberPct] = useState(String(group?.absencePenaltyMemberRatePct ?? 10));
  const [absenceOfficerPct, setAbsenceOfficerPct] = useState(String(group?.absencePenaltyOfficerRatePct ?? 25));

  const [contribLateFeePct, setContribLateFeePct] = useState(String(group?.contributionLateFeeRatePct ?? 5));
  const [contribLateFeeGrace, setContribLateFeeGrace] = useState(String(group?.contributionLateFeeGraceDays ?? 3));
  const [contribLateFeeStart, setContribLateFeeStart] = useState(group?.contributionLateFeeStartDate ?? "");
  const [loanLateFeePct, setLoanLateFeePct] = useState(String(group?.loanLateFeeRatePct ?? 5));
  const [loanLateFeeGrace, setLoanLateFeeGrace] = useState(String(group?.loanLateFeeGraceDays ?? 3));

  const [goalEnabled, setGoalEnabled] = useState(!!(group?.contributionGoalPeriodMonths && group?.contributionGoalTargetAmount && group?.contributionGoalAnchorDate));
  const [goalPeriodMonths, setGoalPeriodMonths] = useState(String(group?.contributionGoalPeriodMonths ?? 6));
  const [goalTarget, setGoalTarget] = useState(String(group?.contributionGoalTargetAmount ?? 600000));
  const [goalAnchorDate, setGoalAnchorDate] = useState(group?.contributionGoalAnchorDate ?? "");

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ─── Audit State ─────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<"settings" | "members" | "permissions" | "audit" | "tokenRequests">("settings");
  const [activeTab, setActiveTab] = useState<AuditTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilter, setShowFilter] = useState(false);
  const [tempSearch, setTempSearch] = useState("");
  const [tempYear, setTempYear] = useState<number | null>(null);
  const [tempMonth, setTempMonth] = useState<number | null>(null);
  const [tempDay, setTempDay] = useState<number | null>(null);

  // ─── Permissions (role-based) State ─────────────────────────────────────
  const allMembers = useGroupMembers();
  const [roleSearch, setRoleSearch] = useState("");
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);
  const [pendingRolePerms, setPendingRolePerms] = useState<Record<string, MemberPermissions>>({});
  const [roleSaving, setRoleSaving] = useState<string | null>(null);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [tokenGenerating, setTokenGenerating] = useState<string | null>(null);

  // ─── Token Requests State ─────────────────────────────────────────────────
  const [pendingTokenRequests, setPendingTokenRequests] = useState<any[]>([]);
  const [processingTokenRequest, setProcessingTokenRequest] = useState<string | null>(null);

  // Combined list of roles: the 5 built-in system roles + any custom roles
  // stored on the group doc. This is the single source of truth the
  // Permissions tab now edits — permission grants live on roles, not members.
  const roles: GroupRole[] = useMemo(() => {
    const systemRoles: GroupRole[] = SYSTEM_ROLE_KEYS.map((key) => ({
      id: key,
      name: ROLE_LABELS[key] || key,
      permissions: group?.rolePermissions?.[key] ?? SYSTEM_ROLE_DEFAULT_PERMISSIONS[key],
      isSystem: true,
      createdAt: "",
    }));
    const customRoles: GroupRole[] = (group?.customRoles ?? []).map((r) => ({ ...r, isSystem: false }));
    return [...systemRoles, ...customRoles];
  }, [group?.rolePermissions, group?.customRoles]);

  const filteredRoles = useMemo(
    () => roles.filter((r) => r.name.toLowerCase().includes(roleSearch.toLowerCase())),
    [roles, roleSearch]
  );

  const memberCountForRole = useCallback((role: GroupRole) => {
    if (role.isSystem) {
      return allMembers.filter((m) => m.role === role.id && !m.customRoleId).length;
    }
    return allMembers.filter((m) => m.customRoleId === role.id).length;
  }, [allMembers]);

  const getRolePerms = useCallback((role: GroupRole): MemberPermissions => {
    return pendingRolePerms[role.id] ?? role.permissions;
  }, [pendingRolePerms]);

  const toggleRolePerm = useCallback((role: GroupRole, key: keyof MemberPermissions) => {
    if (role.id === "admin") return; // admin is always full-access, never editable
    const base = getRolePerms(role);
    setPendingRolePerms((prev) => ({ ...prev, [role.id]: { ...base, [key]: !base[key] } }));
  }, [getRolePerms]);

  const saveRolePermissions = useCallback(async (role: GroupRole) => {
    if (role.id === "admin" || !activeGroupId) return;
    const perms = getRolePerms(role);
    setRoleSaving(role.id);
    try {
      if (role.isSystem) {
        await updateGroup(activeGroupId, {
          rolePermissions: { ...(group?.rolePermissions ?? {}), [role.id]: perms },
        });
      } else {
        // Update both customRoles array AND customRolePermissions map for security rules
        const updatedCustomRoles = (group?.customRoles ?? []).map((r) =>
          r.id === role.id ? { ...r, permissions: perms } : r
        );
        await updateGroup(activeGroupId, { 
          customRoles: updatedCustomRoles,
          customRolePermissions: { ...(group?.customRolePermissions ?? {}), [role.id]: perms }
        });
      }

      // Cascade: keep every member currently holding this role in sync, since
      // the rest of the app reads permissions off Member.permissions directly.
      const affectedMembers = role.isSystem
        ? allMembers.filter((m) => m.role === role.id && !m.customRoleId)
        : allMembers.filter((m) => m.customRoleId === role.id);

      await Promise.all(affectedMembers.map((m) => updateMember(m.id, { permissions: perms })));

      setPendingRolePerms((prev) => { const n = { ...prev }; delete n[role.id]; return n; });
      show(`Permissions saved for ${role.name}`);
    } catch (e: any) {
      show(e.message || "Failed to save role permissions", "error");
    } finally {
      setRoleSaving(null);
    }
  }, [activeGroupId, group?.rolePermissions, group?.customRoles, group?.customRolePermissions, allMembers, getRolePerms, updateGroup, updateMember, show]);

  const handleCreateRole = useCallback(async () => {
    if (!newRoleName.trim()) { show("Role name is required", "error"); return; }
    if (!activeGroupId) { show("No active group", "error"); return; }

    const nameTaken = roles.some((r) => r.name.toLowerCase() === newRoleName.trim().toLowerCase());
    if (nameTaken) { show("A role with that name already exists", "error"); return; }

    setCreatingRole(true);
    try {
      const newRole: GroupRole = {
        id: uid(),
        name: newRoleName.trim(),
        permissions: { ...DEFAULT_MEMBER_PERMISSIONS },
        isSystem: false,
        createdAt: new Date().toISOString(),
      };
      await updateGroup(activeGroupId, { 
        customRoles: [...(group?.customRoles ?? []), newRole],
        customRolePermissions: { ...(group?.customRolePermissions ?? {}), [newRole.id]: newRole.permissions }
      });
      show(`Role "${newRole.name}" created — set its permissions below`);
      setShowCreateRole(false);
      setNewRoleName("");
      setExpandedRoleId(newRole.id);
    } catch (e: any) {
      show(e.message || "Failed to create role", "error");
    } finally {
      setCreatingRole(false);
    }
  }, [newRoleName, activeGroupId, roles, group?.customRoles, group?.customRolePermissions, updateGroup, show]);

  // ─── Token Request Handlers ───────────────────────────────────────────────
  useEffect(() => {
    if (activeSection === "tokenRequests" && activeGroupId) {
      const unsubscribe = FS.subscribePendingTokenRequests(
        activeGroupId,
        (requests) => setPendingTokenRequests(requests),
        (error) => console.error("Error loading token requests:", error)
      );
      return () => unsubscribe();
    }
  }, [activeSection, activeGroupId]);

  const handleProcessTokenRequest = useCallback(async (request: any) => {
    if (!activeGroupId) { show("No active group", "error"); return; }
    
    setProcessingTokenRequest(request.id);
    try {
      // Find member by email
      const member = members.find(m => m.email?.toLowerCase() === request.email.toLowerCase());
      
      if (!member) {
        show(`No member found with email ${request.email}`, "error");
        await FS.updateTokenRequest(request.id, { status: "cancelled", processedAt: new Date().toISOString() });
        return;
      }
      
      // Generate token
      const tokenData = generateLoginToken();
      await useStore.getState().updateMember(member.id, {
        loginToken: tokenData.token,
        loginTokenExpiry: tokenData.expiry,
      });
      
      // Send email notification
      if (member.email) {
        await FS.addNotification(
          member.userId || member.id,
          {
            title: "Your Login Token",
            message: `Your login token is: ${tokenData.token}\n\nThis token will expire in 24 hours. Use it on the login screen to access your account.`,
            type: "info",
            groupId: activeGroupId,
          },
          member.email
        );
      }
      
      // Mark request as processed
      await FS.updateTokenRequest(request.id, { 
        status: "processed", 
        processedAt: new Date().toISOString() 
      });
      
      show(`Login token sent to ${member.email}`, "success");
    } catch (e: any) {
      show(e.message || "Failed to process token request", "error");
    } finally {
      setProcessingTokenRequest(null);
    }
  }, [activeGroupId, members, show]);

  const handleCancelTokenRequest = useCallback(async (requestId: string) => {
    try {
      await FS.updateTokenRequest(requestId, { 
        status: "cancelled", 
        processedAt: new Date().toISOString() 
      });
      show("Token request cancelled");
    } catch (e: any) {
      show(e.message || "Failed to cancel token request", "error");
    }
  }, [show]);

  const handleDeleteRole = useCallback((role: GroupRole) => {
    if (role.isSystem || !activeGroupId) return;
    const count = memberCountForRole(role);
    if (count > 0) {
      show(`Reassign ${count} member${count === 1 ? "" : "s"} to another role before deleting this one`, "error");
      return;
    }
    showConfirm(
      "Delete Role",
      `Delete the "${role.name}" role? This cannot be undone.`,
      async () => {
        try {
          await updateGroup(activeGroupId, {
            customRoles: (group?.customRoles ?? []).filter((r) => r.id !== role.id),
          });
          show("Role deleted");
        } catch (e: any) {
          show(e.message || "Failed to delete role", "error");
        }
      },
      undefined,
      true
    );
  }, [activeGroupId, group?.customRoles, memberCountForRole, updateGroup, show]);

  // Role options offered when assigning a member — system roles plus any
  // custom roles, using a "custom:<id>" value to disambiguate on submit.
  const roleAssignmentOptions = useMemo(() => [
    ...ROLES,
    ...(group?.customRoles ?? []).map((r) => ({ label: r.name, value: `custom:${r.id}` })),
  ], [group?.customRoles]);

  const getRoleLabel = useCallback((member: Member): string => {
    if (member.customRoleId) {
      return (group?.customRoles ?? []).find((r) => r.id === member.customRoleId)?.name ?? "Custom Role";
    }
    return ROLE_LABELS[member.role] || member.role;
  }, [group?.customRoles]);

  const generateMemberToken = useCallback(async (member: Member) => {
    setTokenGenerating(member.id);
    try {
      const tokenData = generateLoginToken();
      await useStore.getState().updateMember(member.id, {
        loginToken: tokenData.token,
        loginTokenExpiry: tokenData.expiry,
      });
      show(`Login token generated for ${member.fullName}: ${tokenData.token}`, "success");
    } catch (e: any) {
      show(e.message || "Failed to generate login token", "error");
    } finally {
      setTokenGenerating(null);
    }
  }, [show]);

  // ─── Member Management Stats ────────────────────────────────────────────
  const memberStats = useMemo(() => {
    const active = members.filter(m => m.status === "active").length;
    const pending = members.filter(m => m.status === "pending").length;
    const inactive = members.filter(m => !["active", "pending"].includes(m.status)).length;
    const total = members.length;
    return { total, active, pending, inactive };
  }, [members]);

  const filteredMembers = useMemo(() => {
    let list = [...members];
    if (memberTab === "Active") list = list.filter(m => m.status === "active");
    else if (memberTab === "Pending") list = list.filter(m => m.status === "pending");
    else if (memberTab === "Inactive") list = list.filter(m => !["active", "pending"].includes(m.status));

    if (memberSearch) {
      const term = memberSearch.toLowerCase();
      list = list.filter(m =>
        m.fullName?.toLowerCase().includes(term) ||
        m.email?.toLowerCase().includes(term) ||
        m.phone?.toLowerCase().includes(term)
      );
    }

    // In "All" view, surface pending members at the top so an admin
    // opening the tab immediately sees who needs a decision. Other
    // filters leave the natural order alone.
    if (memberTab === "All") {
      const rank = (s: string) =>
        s === "pending" ? 0 : s === "active" ? 1 : 2;
      list.sort((a, b) => rank(a.status) - rank(b.status));
    }

    return list;
  }, [members, memberTab, memberSearch]);

  // ─── Member Management Handlers ────────────────────────────────────────
  const handleCreateMember = async () => {
    if (!createForm.fullName.trim() || !createForm.email.trim()) {
      show("Name and email are required", "error");
      return;
    }
    if (!activeGroupId || !currentMember?.userId) {
      show("Group or user not loaded", "error");
      return;
    }

    const isCustom = createForm.role.startsWith("custom:");
    const customId = isCustom ? createForm.role.slice(7) : undefined;
    const baseRole = isCustom ? "member" : (createForm.role as any);

    setCreatingMember(true);
    try {
      const result = await createUserAsAdmin(
        {
          fullName: createForm.fullName.trim(),
          email: createForm.email.trim(),
          phone: createForm.phone.trim(),
          role: baseRole,
          groupId: activeGroupId,
        },
        currentMember.userId,
        currentMember.fullName || "Admin"
      );

      if (!result.success) {
        show(result.error || "Failed to create user", "error");
        return;
      }

      // NOTE: createUserAsAdmin's return shape isn't something I can verify
      // here — if it exposes the new member's id (e.g. result.memberId),
      // this finishes wiring up the custom role immediately. If it doesn't,
      // the member is created with the base "member" role and you'll need
      // to open Edit Member afterward to assign the custom role — that path
      // is fully wired below.
      if (isCustom && (result as any).memberId) {
        const customRole = (group?.customRoles ?? []).find((r) => r.id === customId);
        await updateMember((result as any).memberId, {
          customRoleId: customId,
          permissions: customRole?.permissions ?? DEFAULT_MEMBER_PERMISSIONS,
        });
      }

      show(`User ${createForm.fullName} created! Password reset email sent.`);
      setShowCreateMember(false);
      setCreateForm({ fullName: "", email: "", phone: "", role: "member" });
    } catch (e: any) {
      show(e.message || "Failed to create user", "error");
    } finally {
      setCreatingMember(false);
    }
  };

  // ─── Status change handlers ──────────────────────────────────────────
  //
  // The detail modal already closes itself via `runDetailAction` before
  // invoking these, so we no longer need to touch showMemberDetail here.
  //
  // Each confirm dialog runs on its own once the detail modal has fully
  // unmounted, which is what removes the modal-overlap flash the previous
  // version had when a confirm was raised while the detail sheet was
  // still animating out.

  const handleApproveMember = async (member: Member) => {
    showConfirm(
      "Approve Member",
      `Approve ${member.fullName}? They will be able to access the group immediately.`,
      async () => {
        try {
          await FS.updateMember(activeGroupId!, member.id, {
            status: "active",
          });
          show(`${member.fullName} approved`, "success");
        } catch (e: any) {
          show(e.message || "Failed to approve member", "error");
        }
      }
    );
  };

  const handleDeactivateMember = async (member: Member) => {
    showConfirm(
      "Deactivate Member",
      `Deactivate ${member.fullName}?

They won't be able to sign in or participate in group activities, and any new late fees on their loans will pause until they're reactivated.`,
      async () => {
        try {
          await FS.updateMember(activeGroupId!, member.id, {
            status: "inactive",
          });
          show("Member deactivated");
        } catch (e: any) {
          show(e.message || "Failed to deactivate", "error");
        }
      },
      undefined,
      true
    );
  };

  const handleReactivateMember = async (member: Member) => {
    showConfirm(
      "Reactivate Member",
      `Reactivate ${member.fullName}? They'll regain access and normal participation will resume.`,
      async () => {
        try {
          await FS.updateMember(activeGroupId!, member.id, {
            status: "active",
          });
          show("Member reactivated", "success");
        } catch (e: any) {
          show(e.message || "Failed to reactivate", "error");
        }
      }
    );
  };

  const handleDeleteMember = async (member: Member) => {
    const hasHistory =
      contributions.some((c) => c.memberId === member.id) ||
      wallet.some((w) => w.memberId === member.id);

    if (hasHistory) {
      show(
        "Cannot delete member with financial history. Deactivate instead.",
        "error"
      );
      return;
    }

    try {
      await deleteMember(member.id);
      show(`Member ${member.fullName} removed`, "success");
      setShowDeleteConfirm(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to delete member", "error");
    }
  };

  const openMemberDetail = (member: Member) => {
    setSelectedMember(member);
    setShowMemberDetail(true);
  };

  const openEditMember = (member: Member) => {
    setShowMemberDetail(false);
    setSelectedMember(null);
    setEditingMember(member);
    setEditForm({
      fullName: member.fullName,
      email: member.email || "",
      phone: member.phone || "",
      role: member.customRoleId ? `custom:${member.customRoleId}` : member.role,
    });
    setShowEditMember(true);
  };

  const handleSaveEditMember = async () => {
    if (!editingMember) return;
    if (!editForm.fullName.trim()) {
      show("Name required", "error");
      return;
    }

    const isCustom = editForm.role.startsWith("custom:");
    const customId = isCustom ? editForm.role.slice(7) : undefined;
    const baseRole = isCustom ? "member" : (editForm.role as any);
    const customRole = isCustom ? (group?.customRoles ?? []).find((r) => r.id === customId) : undefined;

    setSavingMember(true);
    try {
      await updateMember(editingMember.id, {
        fullName: editForm.fullName.trim(),
        email: editForm.email.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        role: baseRole,
        customRoleId: customId,
        // Snapshot the role's current permissions onto the member immediately,
        // matching what saveRolePermissions cascades on future edits.
        permissions: isCustom
          ? (customRole?.permissions ?? DEFAULT_MEMBER_PERMISSIONS)
          : (group?.rolePermissions?.[baseRole] ?? SYSTEM_ROLE_DEFAULT_PERMISSIONS[baseRole as MemberRole] ?? DEFAULT_MEMBER_PERMISSIONS),
        userId: editingMember.userId,
      });
      show("Member updated successfully");
      setShowEditMember(false);
      setEditingMember(null);
    } catch (e: any) {
      show(e.message || "Failed to update member", "error");
    } finally {
      setSavingMember(false);
    }
  };

  // ─── Membership Reconciliation Handlers ─────────────────────────────────
  const handleCheckMembershipDrift = async () => {
    if (!activeGroupId) { show("No active group", "error"); return; }
    setCheckingDrift(true);
    try {
      const drift = await findMembershipDrift(activeGroupId, members);
      setDriftResults(drift);
      setShowDriftModal(true);
      if (drift.length === 0) {
        show("All member roles are in sync", "success");
      }
    } catch (e: any) {
      show(e.message || "Failed to check member roles", "error");
    } finally {
      setCheckingDrift(false);
    }
  };

  const handleFixDrift = async (drift: MembershipDrift) => {
    if (!activeGroupId) return;
    setFixingDriftId(drift.memberId);
    try {
      await fixMembershipDrift(activeGroupId, drift);
      setDriftResults((prev) => prev?.filter((d) => d.memberId !== drift.memberId) ?? null);
      show(`Fixed ${drift.memberFullName}'s access`);
    } catch (e: any) {
      show(e.message || "Failed to fix membership", "error");
    } finally {
      setFixingDriftId(null);
    }
  };

  const handleFixAllDrift = async () => {
    if (!activeGroupId || !driftResults) return;
    setFixingDriftId("__all__");
    try {
      for (const d of driftResults) {
        await fixMembershipDrift(activeGroupId, d);
      }
      show(`Fixed ${driftResults.length} member${driftResults.length === 1 ? "" : "s"}`);
      setDriftResults([]);
    } catch (e: any) {
      show(e.message || "Failed to fix all memberships", "error");
    } finally {
      setFixingDriftId(null);
    }
  };

  // ─── Audit Filters ──────────────────────────────────────────────────────
  useEffect(() => { setCurrentPage(1); }, [activeTab, searchTerm, selectedYear, selectedMonth, selectedDay]);

  const filteredLogs = useMemo(() => {
    let logs = allAuditLogs;
    if (activeTab === "failed") {
      logs = logs.filter((l) => l.action === "failed" || l.status === "failed");
    } else if (activeTab !== "all") {
      if (activeTab === "deletions") {
        logs = logs.filter((l) => l.action === "deleted");
      } else {
        const et = (AUDIT_TAB_ENTITY as any)[activeTab];
        if (et) logs = logs.filter((l) => l.entityType === et);
      }
    }
    if (selectedYear || selectedMonth || selectedDay) {
      logs = logs.filter((log) => {
        const d = new Date(log.timestamp);
        if (isNaN(d.getTime())) return false;
        if (selectedYear && d.getFullYear() !== selectedYear) return false;
        if (selectedMonth && d.getMonth() + 1 !== selectedMonth) return false;
        if (selectedDay && d.getDate() !== selectedDay) return false;
        return true;
      });
    }
    if (searchTerm.trim()) {
      const t = searchTerm.toLowerCase();
      logs = logs.filter(
        (l) =>
          l.userName?.toLowerCase().includes(t) ||
          l.action?.toLowerCase().includes(t) ||
          l.entityType?.toLowerCase().includes(t) ||
          l.reason?.toLowerCase().includes(t),
      );
    }
    return logs;
  }, [allAuditLogs, activeTab, selectedYear, selectedMonth, selectedDay, searchTerm]);

  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLogs.slice(start, start + PAGE_SIZE);
  }, [filteredLogs, currentPage]);

  const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE);
  const hasFilters = !!(searchTerm || selectedYear || selectedMonth || selectedDay);

  const openFilter = () => {
    setTempSearch(searchTerm);
    setTempYear(selectedYear);
    setTempMonth(selectedMonth);
    setTempDay(selectedDay);
    setShowFilter(true);
  };

  const applyFilters = () => {
    setSearchTerm(tempSearch);
    setSelectedYear(tempYear);
    setSelectedMonth(tempMonth);
    setSelectedDay(tempDay);
    setShowFilter(false);
  };

  const clearFilters = () => {
    setSearchTerm(""); setSelectedYear(null); setSelectedMonth(null); setSelectedDay(null);
    setActiveTab("all");
    setTempSearch(""); setTempYear(null); setTempMonth(null); setTempDay(null);
    setShowFilter(false);
  };

  // ─── Revert Action ──────────────────────────────────────────────────────
  const handleRevertLog = (log: AuditLog) => {
    if (log.action === "reverted") { show("This entry is already a revert — nothing to undo", "error"); return; }
    if (log.action !== "deleted" && log.action !== "created" && !log.before) {
      show("No prior state was recorded for this action, so it can't be reverted", "error");
      return;
    }
    const actionLabel = getActionConfig(log.action).label.toLowerCase();
    showConfirm(
      "Revert this action?",
      `This will undo the "${actionLabel}" action on this ${entityLabel(log.entityType).toLowerCase()} and restore its previous state. This itself will be recorded in the audit trail.`,
      async () => {
        if (!activeGroupId) return;
        try {
          await FS.revertAuditLog(activeGroupId, log);
          show("Action reverted successfully");
        } catch (e: any) {
          show(e?.message || "Failed to revert this action", "error");
        }
      },
    );
  };

  // ─── Save Settings ──────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!activeGroupId) { show("No active group", "error"); return; }
    const contributionAmount = parseNum(contribAmount);
    const loanInterestRate = parseNum(loanRate);
    const latePenaltyRatePct = parseNum(lateRatePct);
    const absencePenaltyMemberRatePct = parseNum(absenceMemberPct);
    const absencePenaltyOfficerRatePct = parseNum(absenceOfficerPct);
    const contributionLateFeeRatePct = parseNum(contribLateFeePct);
    const contributionLateFeeGraceDays = parseNum(contribLateFeeGrace);
    const loanLateFeeRatePct = parseNum(loanLateFeePct);
    const loanLateFeeGraceDays = parseNum(loanLateFeeGrace);
    const contributionGoalPeriodMonths = goalEnabled ? parseNum(goalPeriodMonths) : undefined;
    const contributionGoalTargetAmount = goalEnabled ? parseNum(goalTarget) : undefined;
    const trimmedGoalAnchor = goalEnabled ? goalAnchorDate.trim() : "";

    if (contributionAmount !== undefined && contributionAmount < 0) { show("Contribution amount cannot be negative", "error"); return; }
    if (loanInterestRate !== undefined && (loanInterestRate < 0 || loanInterestRate > 100)) { show("Loan interest rate must be 0–100", "error"); return; }
    if (latePenaltyRatePct !== undefined && (latePenaltyRatePct < 0 || latePenaltyRatePct > 100)) { show("Late penalty rate must be 0–100%", "error"); return; }
    if (absencePenaltyMemberRatePct !== undefined && (absencePenaltyMemberRatePct < 0 || absencePenaltyMemberRatePct > 100)) { show("Absence penalty rate must be 0–100%", "error"); return; }
    if (absencePenaltyOfficerRatePct !== undefined && (absencePenaltyOfficerRatePct < 0 || absencePenaltyOfficerRatePct > 100)) { show("Absence penalty rate must be 0–100%", "error"); return; }
    if (contributionLateFeeRatePct !== undefined && (contributionLateFeeRatePct < 0 || contributionLateFeeRatePct > 100)) { show("Contribution late fee rate must be 0–100%", "error"); return; }
    if (loanLateFeeRatePct !== undefined && (loanLateFeeRatePct < 0 || loanLateFeeRatePct > 100)) { show("Loan late fee rate must be 0–100%", "error"); return; }
    if (contributionLateFeeGraceDays !== undefined && contributionLateFeeGraceDays < 0) { show("Grace days cannot be negative", "error"); return; }
    if (loanLateFeeGraceDays !== undefined && loanLateFeeGraceDays < 0) { show("Grace days cannot be negative", "error"); return; }

    if (goalEnabled) {
      if (contributionGoalPeriodMonths === undefined || contributionGoalPeriodMonths < 1 || !Number.isInteger(contributionGoalPeriodMonths)) {
        show("Goal period must be a whole number of months (1 or more)", "error");
        return;
      }
      if (contributionGoalTargetAmount === undefined || contributionGoalTargetAmount <= 0) {
        show("Goal target amount must be greater than 0", "error");
        return;
      }
      if (!trimmedGoalAnchor || isNaN(new Date(trimmedGoalAnchor).getTime())) {
        show("Goal start date is required and must be a valid date", "error");
        return;
      }
    }

    const trimmedStartDate = contribLateFeeStart.trim();
    if (trimmedStartDate && isNaN(new Date(trimmedStartDate).getTime())) {
      show("Contribution late fee start date is invalid — use YYYY-MM-DD", "error");
      return;
    }

    const patch: Parameters<typeof updateGroup>[1] = {
      currency,
      contributionFrequency: freq as any,
      loanInterestMethod: loanMethod as any,
      loanInterestRatePeriod: ratePeriod,
      ...(contributionAmount !== undefined && { contributionAmount }),
      ...(loanInterestRate !== undefined && { loanInterestRate }),
      ...(latePenaltyRatePct !== undefined && { latePenaltyRatePct }),
      ...(absencePenaltyMemberRatePct !== undefined && { absencePenaltyMemberRatePct }),
      ...(absencePenaltyOfficerRatePct !== undefined && { absencePenaltyOfficerRatePct }),
      ...(contributionLateFeeRatePct !== undefined && { contributionLateFeeRatePct }),
      ...(contributionLateFeeGraceDays !== undefined && { contributionLateFeeGraceDays }),
      contributionLateFeeStartDate: trimmedStartDate || undefined,
      ...(loanLateFeeRatePct !== undefined && { loanLateFeeRatePct }),
      ...(loanLateFeeGraceDays !== undefined && { loanLateFeeGraceDays }),
      ...(goalEnabled && {
        contributionGoalPeriodMonths,
        contributionGoalTargetAmount,
        contributionGoalAnchorDate: trimmedGoalAnchor,
      }),
    };

    setSaving(true);
    try {
      if (!goalEnabled && activeGroupId) {
        await FS.clearContributionGoal(activeGroupId).catch(console.warn);
      }
      await updateGroup(activeGroupId, patch);
      show("Settings saved");
    } catch (e: any) {
      show(e.message || "Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  // ─── Export / Import ────────────────────────────────────────────────────
  const handleExport = async () => {
    try {
      const state = useStore.getState();
      await exportFullData(
        {
          group,
          members: state.members.filter((m) => m.groupId === group?.id),
          loans: state.loans.filter((l) => l.groupId === group?.id),
          contributions: state.contributions.filter((c) => c.groupId === group?.id),
          investments: state.investments.filter((i) => i.groupId === group?.id),
          walletTransactions: state.walletTransactions.filter((w) => w.groupId === group?.id),
          expenses: state.expenses.filter((e) => e.groupId === group?.id),
          meetings: state.meetings.filter((m) => m.groupId === group?.id),
        },
        `${group?.name?.replace(/\s+/g, "_")}_Backup_${new Date().toISOString().slice(0, 10)}`,
      );
      show("Data exported successfully");
    } catch { show("Failed to export data", "error"); }
  };

  const handleImport = async () => {
    try {
      const data = await importFullData();
      if (!data?.group || !data?.members) { show("Invalid backup file", "error"); return; }
      showConfirm("Restore Data", "This will import data for this group. Syncing to the server may take a moment. Continue?", async () => {
        show("Import started. Syncing to server…");
        try {
          const state = useStore.getState();
          if (group?.id) await FS.restoreGroupData(group.id, data);
          state.upsertGroup(data.group!);
          if (data.members) state.setMembers(data.members);
          if (data.loans) state.setLoans(data.loans);
          if (data.contributions) state.setContributions(data.contributions);
          if (data.investments) state.setInvestments(data.investments);
          if (data.walletTransactions) state.setWalletTxs(data.walletTransactions);
          if (data.expenses) state.setExpenses(data.expenses);
          if (data.meetings) state.setMeetings(data.meetings);
          show("Data imported successfully");
        } catch (err: any) { show("Failed to sync import to server", "error"); console.error(err); }
      }, undefined, true);
    } catch (e: any) { if (e.message !== "Cancelled") show("Failed to import data", "error"); }
  };

  const handleSignOut = () => {
    showConfirm("Sign Out", "Are you sure you want to sign out?", async () => {
      await signOut().catch(() => {});
      reset();
      router.replace("/(auth)/welcome");
    }, undefined, true);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      // Trigger a proper sync using the store's sync mechanism
      const { triggerForceSync, syncStatus, syncError } = useStore.getState();
      triggerForceSync();
      
      // Wait a bit for sync to complete
      await new Promise((r) => setTimeout(r, 2000));
      
      // Check sync status after refresh
      const state = useStore.getState();
      if (state.syncStatus === "failed") {
        show(state.syncError || "Sync failed. Please try again.", "error");
      } else {
        show("Data refreshed successfully", "success");
      }
    } catch (e: any) {
      show(e.message || "Refresh failed", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const contribAmountNum = parseFloat(contribAmount) || 0;

  // ─── Member Detail Modal (redesigned) ──────────────────────────────────
  //
  // Layout: hero → stat row → contact → role → actions.
  //
  // Every action delegates through `runDetailAction`, which closes this
  // modal and only invokes the callback on the next tick. That pause is
  // what stops two BottomModals from trying to be mounted at once during
  // the hand-off, which is the source of the "flash" the old flow had
  // when tapping Edit / Deactivate / etc.
  const MemberDetailModal = ({ member, onClose }: { member: Member; onClose: () => void }) => {
    const stats = getMemberStats(member, wallet, contributions);
    const isMe = member.userId === currentMember?.userId;
    const roleLabel = getRoleLabel(member);
    const customRole = member.customRoleId
      ? (group?.customRoles ?? []).find((r) => r.id === member.customRoleId)
      : undefined;

    const hasPermissions = !!member.permissions;
    const enabledPermsCount = hasPermissions
      ? PERM_KEYS.filter((k) => member.permissions![k]).length
      : 0;

    const canDeleteMember =
      isAdmin &&
      !isMe &&
      !stats.totalContributions &&
      !contributions.some((c) => c.memberId === member.id);

    // Close this modal, then invoke `next` on the next tick. The 260ms
    // delay matches the BottomModal close animation, so the hand-off is
    // invisible to the user.
    const runDetailAction = (next: () => void) => {
      onClose();
      setTimeout(next, 260);
    };

    return (
      <BottomModal visible={!!member} onClose={onClose} title="Member">
        <ScrollView
          contentContainerStyle={detailStyles.body}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero ─────────────────────────────────────────────── */}
          <View style={detailStyles.hero}>
            <View style={detailStyles.heroAvatar}>
              <Text style={detailStyles.heroAvatarText}>
                {member.fullName
                  .split(" ")
                  .map((w: string) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </Text>
            </View>
            <Text style={detailStyles.heroName} numberOfLines={2}>
              {member.fullName}
              {isMe ? " (You)" : ""}
            </Text>
            <View style={detailStyles.heroBadges}>
              <Badge
                label={roleLabel}
                color={
                  member.customRoleId
                    ? "blue"
                    : ROLE_BADGE[member.role] || "teal"
                }
              />
              <Badge
                label={member.status}
                color={STATUS_BADGE[member.status] || "muted"}
              />
            </View>
            <Text style={detailStyles.heroMeta}>
              Member since {fmtDate(member.dateJoined || "")}
            </Text>
          </View>

          {/* ── Stat row ────────────────────────────────────────── */}
          <View style={detailStyles.statRow}>
            <View style={detailStyles.statCell}>
              <Text
                style={[detailStyles.statValue, { color: C.primary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {fmtCurrency(stats.totalContributions)}
              </Text>
              <Text style={detailStyles.statLabel}>Contributions</Text>
            </View>
            <View style={detailStyles.statDivider} />
            <View style={detailStyles.statCell}>
              <Text
                style={[
                  detailStyles.statValue,
                  {
                    color:
                      stats.arrears > 0 ? C.error : C.text3,
                  },
                ]}
                numberOfLines={1}
              >
                {stats.arrears > 0 ? fmtCurrency(stats.arrears) : "—"}
              </Text>
              <Text style={detailStyles.statLabel}>Arrears</Text>
            </View>
            <View style={detailStyles.statDivider} />
            <View style={detailStyles.statCell}>
              <Text
                style={[detailStyles.statValue, { color: C.text }]}
                numberOfLines={1}
              >
                {member.status === "active" ? "Active" : "—"}
              </Text>
              <Text style={detailStyles.statLabel}>Login</Text>
            </View>
          </View>

          {/* ── Contact ──────────────────────────────────────────── */}
          <Text style={detailStyles.sectionLabel}>Contact</Text>
          <View style={detailStyles.sectionCard}>
            <DetailRow
              icon="✉️"
              label="Email"
              value={member.email || "Not set"}
              muted={!member.email}
            />
            <DetailRow
              icon="☎️"
              label="Phone"
              value={member.phone || "Not set"}
              muted={!member.phone}
            />
            <DetailRow
              icon="📅"
              label="Joined"
              value={fmtDate(member.dateJoined || "")}
            />
          </View>

          {/* ── Role & access ────────────────────────────────────── */}
          <Text style={detailStyles.sectionLabel}>Role & access</Text>
          <View style={detailStyles.sectionCard}>
            <DetailRow
              icon="🎭"
              label="Role"
              value={
                customRole
                  ? `${customRole.name} (custom)`
                  : roleLabel
              }
            />
            {member.role === "admin" ? (
              <DetailRow
                icon="🔓"
                label="Permissions"
                value="Full access — admin"
              />
            ) : hasPermissions ? (
              <DetailRow
                icon="🔓"
                label="Permissions"
                value={`${enabledPermsCount} of ${PERM_KEYS.length} granted`}
              />
            ) : (
              <DetailRow
                icon="🔓"
                label="Permissions"
                value="Using role defaults"
                muted
              />
            )}
            {member.userId ? (
              <DetailRow
                icon="🔑"
                label="Auth account"
                value="Linked"
              />
            ) : (
              <DetailRow
                icon="🔑"
                label="Auth account"
                value="No login yet"
                muted
              />
            )}
          </View>

          {/* ── Actions (admin only, never for self) ─────────────── */}
          {isAdmin && !isMe && (
            <>
              {/* Approve / status section */}
              {(member.status === "pending" ||
                member.status === "active" ||
                member.status === "inactive") && (
                <>
                  <Text style={detailStyles.sectionLabel}>Status</Text>
                  <View style={detailStyles.actionsCard}>
                    {member.status === "pending" && (
                      <DetailAction
                        icon="✓"
                        label="Approve member"
                        description="Grant this member access to the group"
                        tone="primary"
                        onPress={() =>
                          runDetailAction(() => handleApproveMember(member))
                        }
                      />
                    )}

                    {member.status === "active" && (
                      <DetailAction
                        icon="⛔"
                        label="Deactivate member"
                        description="Freeze participation and pause accruing late fees"
                        tone="warning"
                        onPress={() =>
                          runDetailAction(() => handleDeactivateMember(member))
                        }
                      />
                    )}

                    {member.status === "inactive" && (
                      <DetailAction
                        icon="🔄"
                        label="Reactivate member"
                        description="Restore access and resume normal participation"
                        tone="primary"
                        onPress={() =>
                          runDetailAction(() => handleReactivateMember(member))
                        }
                      />
                    )}
                  </View>
                </>
              )}

              {/* Profile section */}
              <Text style={detailStyles.sectionLabel}>Profile</Text>
              <View style={detailStyles.actionsCard}>
                <DetailAction
                  icon="✏️"
                  label="Edit member"
                  description="Change name, phone, or assigned role"
                  tone="neutral"
                  onPress={() =>
                    runDetailAction(() => openEditMember(member))
                  }
                />
                {!member.userId && (
                  <DetailAction
                    icon="🔑"
                    label="Generate login token"
                    description="Create a one-time token this member can use to sign in"
                    tone="neutral"
                    onPress={() =>
                      runDetailAction(() => generateMemberToken(member))
                    }
                  />
                )}
              </View>

              {/* Danger section (delete is conditional) */}
              {canDeleteMember && (
                <>
                  <Text
                    style={[
                      detailStyles.sectionLabel,
                      { color: C.error },
                    ]}
                  >
                    Danger zone
                  </Text>
                  <View style={detailStyles.actionsCard}>
                    <DetailAction
                      icon="🗑"
                      label="Delete member"
                      description="Permanently remove this member. Cannot be undone."
                      tone="danger"
                      onPress={() =>
                        runDetailAction(() => {
                          setSelectedMember(member);
                          setShowDeleteConfirm(true);
                        })
                      }
                    />
                  </View>
                </>
              )}
            </>
          )}

          {/* ── Close ─────────────────────────────────────────────── */}
          <TouchableOpacity
            style={detailStyles.closeBtn}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={detailStyles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </ScrollView>
      </BottomModal>
    );
  };

  // ─── Small reusable pieces for the detail modal ────────────────────────
  const DetailRow = ({
    icon,
    label,
    value,
    muted,
  }: {
    icon: string;
    label: string;
    value: string;
    muted?: boolean;
  }) => (
    <View style={detailStyles.row}>
      <Text style={detailStyles.rowIcon}>{icon}</Text>
      <Text style={detailStyles.rowLabel}>{label}</Text>
      <Text
        style={[
          detailStyles.rowValue,
          muted && { color: C.text3, fontStyle: "italic" },
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );

  const DetailAction = ({
    icon,
    label,
    description,
    tone = "neutral",
    onPress,
  }: {
    icon: string;
    label: string;
    description?: string;
    tone?: "primary" | "warning" | "danger" | "neutral";
    onPress: () => void;
  }) => {
    const labelColor =
      tone === "danger"
        ? C.error
        : tone === "warning"
        ? C.gold
        : tone === "primary"
        ? C.primary
        : C.text;

    const iconBg =
      tone === "danger"
        ? "rgba(220,38,38,0.10)"
        : tone === "warning"
        ? "rgba(217,119,6,0.10)"
        : tone === "primary"
        ? "rgba(13,148,136,0.10)"
        : C.elevated;

    return (
      <TouchableOpacity
        style={detailStyles.action}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <View
          style={[detailStyles.actionIcon, { backgroundColor: iconBg }]}
        >
          <Text style={detailStyles.actionIconText}>{icon}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={[detailStyles.actionLabel, { color: labelColor }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {description ? (
            <Text style={detailStyles.actionDesc} numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
        <Text style={[detailStyles.actionChevron, { color: labelColor }]}>
          ›
        </Text>
      </TouchableOpacity>
    );
  };

  const RolePicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <View>
      <Text style={{ fontSize: 12, fontWeight: "600", color: C.text2, marginBottom: 6 }}>Role</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {roleAssignmentOptions.map((r) => {
          const isSelected = value === r.value;
          return (
            <TouchableOpacity
              key={r.value}
              onPress={() => onChange(r.value)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1.5,
                borderColor: isSelected ? C.primary : C.border,
                backgroundColor: isSelected ? (C.primary + "18") : C.surface,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Text style={{
                fontSize: 13,
                fontWeight: isSelected ? "700" : "500",
                color: isSelected ? C.primary : C.text,
              }}>
                {r.label}
              </Text>
              {isSelected && (
                <Text style={{ fontSize: 12, color: C.primary, fontWeight: "700" }}>✓</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      {/* ─── Header ──────────────────────────────────────────────────────
          One row: back button · title block · contextual action.
          The action button changes by tab:
            • Settings     → Save
            • Permissions  → + New Role
            • Members/Audit → (their own inline actions live in the tab)
          Keeping the action contextual means there's never more than one
          primary button on screen at a time. */}
      <View style={[styles.header, isWide && styles.headerWide]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleBlock}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Group Settings
          </Text>
          {group?.name && (
            <Text style={styles.headerSub} numberOfLines={1}>
              {group.name}
            </Text>
          )}
        </View>

        <View style={styles.headerActionSlot}>
          {activeSection === "settings" ? (
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[
                styles.headerBtn,
                styles.headerBtnPrimary,
                saving && styles.headerBtnDisabled,
              ]}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.headerBtnPrimaryText}>Save</Text>
              )}
            </TouchableOpacity>
          ) : activeSection === "permissions" ? (
            <TouchableOpacity
              onPress={() => setShowCreateRole(true)}
              style={[styles.headerBtn, styles.headerBtnPrimary]}
              activeOpacity={0.85}
            >
              <Text style={styles.headerBtnPrimaryText}>+ New Role</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* ─── Tab Bar ─────────────────────────────────────────────────────
          Segmented pills. Icon and label are siblings (not one string)
          so alignment is consistent across tabs, and the badge sits in
          its own slot so appearing/disappearing never shifts the row.
          On wide screens the row centers at a fixed max-width; on
          mobile it scrolls edge-to-edge with comfortable padding. */}
      <View style={styles.tabWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.tabBar,
            isWide && styles.tabBarWide,
          ]}
        >
          {SETTINGS_TABS.map((tab) => {
            const active = activeSection === tab.key;

            const badgeCount =
              tab.key === "tokenRequests"
                ? pendingTokenRequests.length
                : tab.key === "audit"
                ? allAuditLogs.length
                : tab.key === "permissions"
                ? roles.length
                : 0;

            const alertCount =
              isAdmin && tab.key === "members"
                ? memberStats.pending
                : 0;

            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setActiveSection(tab.key as any)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.tabIcon,
                    active && styles.tabIconActive,
                  ]}
                >
                  {tab.icon}
                </Text>
                <Text
                  style={[
                    styles.tabText,
                    active && styles.tabTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>

                {badgeCount > 0 ? (
                  <View
                    style={[
                      styles.tabBadge,
                      active && styles.tabBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.tabBadgeText,
                        active && styles.tabBadgeTextActive,
                      ]}
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </Text>
                  </View>
                ) : alertCount > 0 ? (
                  <View
                    style={[
                      styles.tabBadgeAlert,
                      active && styles.tabBadgeAlertActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.tabBadgeAlertText,
                        active && styles.tabBadgeAlertTextActive,
                      ]}
                    >
                      {alertCount > 9 ? "9+" : alertCount}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ─── Pending-members banner ─────────────────────────────────────
          Shows whenever there's at least one member awaiting approval.
          Tapping it jumps to the Members tab filtered to Pending, so
          an admin doesn't have to hunt through menu options to find
          who's waiting for access.

          Admin-only (the Members tab itself is admin-only, and this
          is fundamentally an admin task). */}
      {isAdmin && memberStats.pending > 0 && (
        <TouchableOpacity
          style={styles.pendingBanner}
          onPress={() => {
            setActiveSection("members");
            setMemberTab("Pending");
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.pendingBannerIcon}>⏳</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.pendingBannerTitle} numberOfLines={1}>
              {memberStats.pending} member
              {memberStats.pending !== 1 ? "s" : ""} awaiting approval
            </Text>
            <Text style={styles.pendingBannerHint} numberOfLines={1}>
              Tap to review and activate
            </Text>
          </View>
          <Text style={styles.pendingBannerCta}>Review →</Text>
        </TouchableOpacity>
      )}

      {/* ─── SETTINGS SECTION ────────────────────────────────────────────── */}
      {activeSection === "settings" && (
        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={[styles.body, isWide && styles.bodyWide]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
        >
          {/* ── Group at a glance ────────────────────────────────────
              Surfaces the current configuration BEFORE the form below.
              Four colored chips summarize the settings that matter
              most on any given day; the admin sees what the group IS
              before they see what they can change. */}
          <GroupAtAGlanceCard
            currency={currency}
            contributionAmount={contribAmountNum}
            contributionFrequency={freq}
            loanRate={parseFloat(loanRate) || 0}
            loanRatePeriod={ratePeriod}
            meetingPenaltyPct={parseFloat(lateRatePct) || 0}
            meetingPenaltyAmount={round2(
              contribAmountNum * (parseFloat(lateRatePct) || 0) / 100,
            )}
            lateFeePct={parseFloat(contribLateFeePct) || 0}
            lateFeeGraceDays={parseInt(contribLateFeeGrace, 10) || 0}
          />

          {/* ── Settings grid ──────────────────────────────────────────
              flex-wrap grid: two cards side-by-side on desktop, one
              column on tablet and mobile. See settingsGrid in styles
              for the mechanics. */}
          <View style={styles.settingsGrid}>

            {/* ── Column 1 ── */}
            <View style={styles.settingsCol}>
              {/* Currency & Contributions */}
              <SectionHeading
                label="Currency & Contributions"
                description="Set the group's currency and the standard contribution amount per member."
                icon="💰"
                accent={C.primary}
              />
              <SettingCard>
                <Select label="Currency" value={currency} options={CURRENCIES} onChange={setCurrency} />
                <Divider />
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Contribution amount"
                      value={contribAmount}
                      onChangeText={setContribAmount}
                      keyboardType="numeric"
                      prefix={currency}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Select label="Frequency" value={freq} options={FREQ} onChange={(v) => setFreq(v as any)} />
                  </View>
                </View>
                <Text style={styles.fieldHint}>
                  Each member contributes {fmtCurrency(contribAmountNum)} {freq === "monthly" ? "per month" : freq === "weekly" ? "per week" : freq === "yearly" ? "per year" : "per year"}
                </Text>
              </SettingCard>

              {/* Contribution Goal */}
              <SectionHeading
                label="Contribution Goal"
                description="A savings target each member should reach every N months. Optional."
                icon="🎯"
                accent={C.accent}
              />
              <SettingCard>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Enable contribution goal</Text>
                    <Text style={styles.toggleHint}>Track progress toward a periodic target per member</Text>
                  </View>
                  <Switch
                    value={goalEnabled}
                    onValueChange={setGoalEnabled}
                    trackColor={{ false: C.border, true: C.primary }}
                    thumbColor="#fff"
                  />
                </View>
                {goalEnabled && (
                  <>
                    <Divider />
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Input
                          label="Target amount"
                          value={goalTarget}
                          onChangeText={setGoalTarget}
                          keyboardType="numeric"
                          prefix={currency}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Input
                          label="Every N months"
                          value={goalPeriodMonths}
                          onChangeText={setGoalPeriodMonths}
                          keyboardType="numeric"
                        />
                      </View>
                    </View>
                    <DatePicker
                      label="Start date"
                      value={goalAnchorDate}
                      onChange={setGoalAnchorDate}
                      placeholder="Select start date"
                    />
                    {!!goalTarget && !!goalPeriodMonths && (
                      <Text style={styles.goalPreview}>
                        {fmtCurrency(parseFloat(goalTarget) || 0)} every {goalPeriodMonths} month{goalPeriodMonths === "1" ? "" : "s"}
                        {parseFloat(goalPeriodMonths) > 0 && ` — ≈ ${Math.floor(12 / parseFloat(goalPeriodMonths))} period${Math.floor(12 / parseFloat(goalPeriodMonths)) === 1 ? "" : "s"} per year`}
                      </Text>
                    )}
                  </>
                )}
              </SettingCard>

              {/* Loan Rules */}
              <SectionHeading
                label="Loan Rules"
                description="Configure how loans are calculated and managed in this group."
                icon="🏦"
                accent={C.brandBlue}
              />
              <SettingCard>
                <Select
                  label="Interest calculation method"
                  value={loanMethod}
                  options={INTEREST_METHODS}
                  onChange={(v) => setLoanMethod(v as any)}
                />
                <Divider />
                <View style={styles.row}>
                  <View style={{ flex: 1.4 }}>
                    <Input
                      label="Interest rate (%)"
                      value={loanRate}
                      onChangeText={setLoanRate}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Select
                      label="Rate period"
                      value={ratePeriod}
                      options={RATE_PERIODS}
                      onChange={(v) => setRatePeriod(v as "monthly" | "annual")}
                    />
                  </View>
                </View>
                <Text style={styles.fieldHint}>
                  {ratePeriod === "annual"
                    ? `${loanRate || "0"}% per year ≈ ${round2((parseFloat(loanRate) || 0) / 12)}% per month`
                    : `${loanRate || "0"}% per month ≈ ${round2((parseFloat(loanRate) || 0) * 12)}% per year`}
                  {' — '}
                  {loanMethod === "reducing_balance" ? "Calculated on outstanding balance" : "Calculated on original amount"}
                </Text>
              </SettingCard>
            </View>

            {/* ── Column 2 ── */}
            <View style={styles.settingsCol}>
              {/* Meeting Penalties */}
              <SectionHeading
                label="Meeting Penalties"
                description="Penalties applied for meeting lateness or absence."
                icon="⚠️"
                accent={C.gold}
              />
              <SettingCard>
                <Text style={styles.penaltyNote}>
                  Penalties are calculated as a percentage of the contribution amount ({fmtCurrency(contribAmountNum)})
                </Text>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Late arrival (% per 15min)"
                      value={lateRatePct}
                      onChangeText={setLateRatePct}
                      keyboardType="numeric"
                    />
                    <Text style={styles.fieldHint}>≈ {fmtCurrency(round2(contribAmountNum * (parseFloat(lateRatePct) || 0) / 100))} per 15min late</Text>
                  </View>
                </View>
                <Divider />
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Absence — member (%)"
                      value={absenceMemberPct}
                      onChangeText={setAbsenceMemberPct}
                      keyboardType="numeric"
                    />
                    <Text style={styles.fieldHint}>≈ {fmtCurrency(round2(contribAmountNum * (parseFloat(absenceMemberPct) || 0) / 100))}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Absence — officer (%)"
                      value={absenceOfficerPct}
                      onChangeText={setAbsenceOfficerPct}
                      keyboardType="numeric"
                    />
                    <Text style={styles.fieldHint}>≈ {fmtCurrency(round2(contribAmountNum * (parseFloat(absenceOfficerPct) || 0) / 100))}</Text>
                  </View>
                </View>
              </SettingCard>

              {/* Late Payment Fees */}
              <SectionHeading
                label="Late Payment Fees"
                description="Fees applied to overdue contributions or loan repayments."
                icon="⏰"
                accent={C.error}
              />
              <SettingCard>
                <Text style={styles.penaltyNote}>
                  Fees are calculated on the amount due, not a flat figure. Grace periods apply.
                </Text>

                <Text style={styles.subLabel}>Contributions</Text>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Fee rate (%)"
                      value={contribLateFeePct}
                      onChangeText={setContribLateFeePct}
                      keyboardType="numeric"
                    />
                    <Text style={styles.fieldHint}>≈ {fmtCurrency(round2(contribAmountNum * (parseFloat(contribLateFeePct) || 0) / 100))} per missed contribution</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Grace period (days)"
                      value={contribLateFeeGrace}
                      onChangeText={setContribLateFeeGrace}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                <DatePicker
                  label="Start calculating from"
                  value={contribLateFeeStart}
                  onChange={setContribLateFeeStart}
                  placeholder="Select start date (leave blank to disable)"
                />

                <Divider />

                <Text style={styles.subLabel}>Loan Repayments</Text>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Fee rate (%)"
                      value={loanLateFeePct}
                      onChangeText={setLoanLateFeePct}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Grace period (days)"
                      value={loanLateFeeGrace}
                      onChangeText={setLoanLateFeeGrace}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </SettingCard>

              {/* Data Management */}
              <SectionHeading
                label="Data Management"
                description="Export or import your group data as a backup."
                icon="📦"
                accent={C.text2}
              />
              <SettingCard>
                <TouchableOpacity style={styles.actionRow} onPress={handleExport} activeOpacity={0.7}>
                  <View style={styles.actionIcon}>
                    <Text style={styles.actionIconText}>📤</Text>
                  </View>
                  <View style={styles.actionInfo}>
                    <Text style={styles.actionTitle}>Export backup</Text>
                    <Text style={styles.actionDesc}>Download full group data as JSON</Text>
                  </View>
                  <Text style={[styles.actionCta, { color: C.primary }]}>Export</Text>
                </TouchableOpacity>
                <Divider />
                <TouchableOpacity style={styles.actionRow} onPress={handleImport} activeOpacity={0.7}>
                  <View style={styles.actionIcon}>
                    <Text style={styles.actionIconText}>📥</Text>
                  </View>
                  <View style={styles.actionInfo}>
                    <Text style={styles.actionTitle}>Import backup</Text>
                    <Text style={styles.actionDesc}>Restore from a JSON backup file</Text>
                  </View>
                  <Text style={[styles.actionCta, { color: "#d97706" }]}>Import</Text>
                </TouchableOpacity>
              </SettingCard>

              {/* Account */}
              <SectionHeading label="Account" icon="👤" accent={C.text2} />
              <SettingCard>
                <TouchableOpacity style={styles.actionRow} onPress={handleSignOut} activeOpacity={0.7}>
                  <View style={[styles.actionIcon, styles.actionIconDanger]}>
                    <Text style={styles.actionIconText}>🚪</Text>
                  </View>
                  <View style={styles.actionInfo}>
                    <Text style={[styles.actionTitle, { color: C.error }]}>Sign out</Text>
                    <Text style={styles.actionDesc}>You will be returned to the welcome screen</Text>
                  </View>
                  <Text style={[styles.actionCta, { color: C.error }]}>Sign out</Text>
                </TouchableOpacity>
              </SettingCard>
            </View>
          </View>

          {/* Save Button - Mobile */}
          {!isWide && (
            <Button label="Save Settings" onPress={handleSave} fullWidth loading={saving} size="lg" style={{ marginTop: 24 }} />
          )}
          {isWide && (
            <View style={styles.wideSaveRow}>
              <Button label="Save Settings" onPress={handleSave} loading={saving} size="lg" />
            </View>
          )}
        </ScrollView>
      )}

      {/* ─── MEMBERS SECTION ────────────────────────────────────────────── */}
      {activeSection === "members" && isAdmin && (
        <View style={styles.contentScroll}>
          <ScrollView
            contentContainerStyle={[
              { paddingBottom: 40 },
              isWide && styles.contentWide,
            ]}
            showsVerticalScrollIndicator={false}
          >
          {/* ── Pending alert ──────────────────────────────────────
              Renders before anything else when there are members
              waiting on approval. This is the ONE thing on this tab
              that requires an admin decision right now. */}
          {memberStats.pending > 0 && (
            <TouchableOpacity
              style={memberStyles.pendingAlert}
              activeOpacity={0.85}
              onPress={() => setMemberTab("Pending")}
            >
              <View style={memberStyles.pendingAlertIcon}>
                <Text style={{ fontSize: 16 }}>⏳</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={memberStyles.pendingAlertTitle}>
                  {memberStats.pending} member
                  {memberStats.pending !== 1 ? "s" : ""} awaiting approval
                </Text>
                <Text style={memberStyles.pendingAlertHint}>
                  Tap to review and activate them
                </Text>
              </View>
              <Text style={memberStyles.pendingAlertCta}>Review →</Text>
            </TouchableOpacity>
          )}

          {/* ── Summary stats — colored tiles, informational ──────── */}
          <View style={memberStyles.statGrid}>
            <View
              style={[
                memberStyles.statTile,
                { borderLeftColor: C.text2 },
              ]}
            >
              <Text style={memberStyles.statTileLabel}>TOTAL</Text>
              <Text
                style={[memberStyles.statTileValue, { color: C.text }]}
              >
                {memberStats.total}
              </Text>
            </View>

            <View
              style={[
                memberStyles.statTile,
                { borderLeftColor: C.success },
              ]}
            >
              <Text
                style={[memberStyles.statTileLabel, { color: C.success }]}
              >
                ACTIVE
              </Text>
              <Text
                style={[
                  memberStyles.statTileValue,
                  { color: C.success },
                ]}
              >
                {memberStats.active}
              </Text>
            </View>

            <View
              style={[
                memberStyles.statTile,
                {
                  borderLeftColor:
                    memberStats.pending > 0 ? C.gold : C.text3,
                },
              ]}
            >
              <Text
                style={[
                  memberStyles.statTileLabel,
                  {
                    color:
                      memberStats.pending > 0 ? C.gold : C.text3,
                  },
                ]}
              >
                PENDING
              </Text>
              <Text
                style={[
                  memberStyles.statTileValue,
                  {
                    color:
                      memberStats.pending > 0 ? C.gold : C.text3,
                  },
                ]}
              >
                {memberStats.pending}
              </Text>
            </View>

            <View
              style={[
                memberStyles.statTile,
                {
                  borderLeftColor:
                    memberStats.inactive > 0 ? C.error : C.text3,
                },
              ]}
            >
              <Text
                style={[
                  memberStyles.statTileLabel,
                  {
                    color:
                      memberStats.inactive > 0 ? C.error : C.text3,
                  },
                ]}
              >
                INACTIVE
              </Text>
              <Text
                style={[
                  memberStyles.statTileValue,
                  {
                    color:
                      memberStats.inactive > 0 ? C.error : C.text3,
                  },
                ]}
              >
                {memberStats.inactive}
              </Text>
            </View>
          </View>

          {/* ── Compact action toolbar ─────────────────────────────
              The two former full-width buttons (Add / Verify) become
              a single row of small icon buttons. Add is primary and
              prominent; Verify is subtle because it's a rare
              maintenance task, not a daily action. */}
          <View style={memberStyles.toolbar}>
            <TouchableOpacity
              style={memberStyles.toolbarBtnPrimary}
              onPress={() => setShowCreateMember(true)}
              activeOpacity={0.85}
            >
              <Text style={memberStyles.toolbarBtnPrimaryText}>
                + Add member
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={memberStyles.toolbarBtnGhost}
              onPress={handleCheckMembershipDrift}
              activeOpacity={0.7}
              disabled={checkingDrift}
            >
              {checkingDrift ? (
                <ActivityIndicator size="small" color={C.text2} />
              ) : (
                <Text style={memberStyles.toolbarBtnGhostText}>
                  🔍 Verify access
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Search + filter tabs ──────────────────────────────── */}
          <View style={memberStyles.filterRow}>
            <SearchBar
              value={memberSearch}
              onChange={setMemberSearch}
              placeholder="Search members..."
            />
            <TabRow
              tabs={["All", "Active", "Pending", "Inactive"]}
              active={memberTab}
              onChange={setMemberTab}
            />
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
            showsVerticalScrollIndicator={false}
          >
            {filteredMembers.length === 0 ? (
              <Empty
                message="No members found"
                icon="👥"
                action={() => setShowCreateMember(true)}
                actionLabel="Add First Member"
              />
            ) : (
              <View style={memberStyles.list}>
                {filteredMembers.map((m) => {
                  const stats = getMemberStats(m, wallet, contributions);
                  const isMe = m.userId === currentMember?.userId;
                  const roleLabel = getRoleLabel(m);

                  const statusColor =
                    m.status === "active"
                      ? C.success
                      : m.status === "pending"
                      ? C.gold
                      : m.status === "suspended"
                      ? C.error
                      : C.text3;

                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        memberStyles.row,
                        { borderLeftColor: statusColor },
                      ]}
                      onPress={() => openMemberDetail(m)}
                      activeOpacity={0.75}
                    >
                      <Avatar
                        name={m.fullName}
                        size={44}
                        color={
                          m.customRoleId
                            ? "blue"
                            : ROLE_BADGE[m.role] ?? "teal"
                        }
                      />

                      <View style={memberStyles.rowInfo}>
                        <Text
                          style={memberStyles.rowName}
                          numberOfLines={1}
                        >
                          {m.fullName}
                          {isMe ? " (You)" : ""}
                        </Text>
                        <View style={memberStyles.rowMetaRow}>
                          <Text
                            style={memberStyles.rowMeta}
                            numberOfLines={1}
                          >
                            {stats.totalContributions > 0
                              ? fmtCurrency(stats.totalContributions)
                              : "No contributions"}
                          </Text>
                          <Text style={memberStyles.metaDot}>·</Text>
                          <Text
                            style={memberStyles.rowMeta}
                            numberOfLines={1}
                          >
                            {roleLabel}
                          </Text>
                        </View>
                      </View>

                      <View
                        style={[
                          memberStyles.statusPill,
                          { backgroundColor: statusColor + "18" },
                        ]}
                      >
                        <View
                          style={[
                            memberStyles.statusDot,
                            { backgroundColor: statusColor },
                          ]}
                        />
                        <Text
                          style={[
                            memberStyles.statusText,
                            { color: statusColor },
                          ]}
                        >
                          {m.status}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>
          </ScrollView>
        </View>
      )}

      {/* ─── PERMISSIONS SECTION (role-based) ───────────────────────────── */}
      {activeSection === "permissions" && (
        <View style={styles.contentScroll}>
          <View style={permStyles.searchContainer}>
            <View style={permStyles.searchBox}>
              <Text style={permStyles.searchIcon}>🔍</Text>
              <TextInput
                style={permStyles.searchInput}
                placeholder="Search roles..."
                placeholderTextColor={C.text3}
                value={roleSearch}
                onChangeText={setRoleSearch}
                clearButtonMode="while-editing"
              />
            </View>
            <Text style={permStyles.searchHint}>
              Permissions are granted per role. Tap a role to manage what it can do — every member holding that role updates automatically. Admins always have full access.
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
          >
            {filteredRoles.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 40 }}>
                <Text style={{ fontSize: 32 }}>🔐</Text>
                <Text style={{ fontSize: 14, color: C.text3, marginTop: 8 }}>No roles match your search</Text>
              </View>
            ) : (
              filteredRoles.map((role) => {
                const perms = getRolePerms(role);
                const isDirty = !!pendingRolePerms[role.id];
                const isSaving = roleSaving === role.id;
                const isExpanded = expandedRoleId === role.id;
                const isLocked = role.id === "admin";
                const enabledCount = PERM_KEYS.filter((k) => perms[k]).length;
                const memberCount = memberCountForRole(role);

                const pct = isLocked
                  ? 100
                  : Math.round((enabledCount / PERM_KEYS.length) * 100);
                const progressColor =
                  isLocked
                    ? C.error
                    : pct >= 70
                    ? C.success
                    : pct >= 40
                    ? C.gold
                    : C.text3;

                const roleColor = isLocked
                  ? C.error
                  : role.isSystem
                  ? C.primary
                  : C.accent;

                return (
                  <View key={role.id} style={permStyles.memberCard}>
                    <TouchableOpacity
                      style={permStyles.memberHeader}
                      onPress={() => setExpandedRoleId(isExpanded ? null : role.id)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          permStyles.memberAvatar,
                          {
                            backgroundColor: roleColor + "18",
                            borderWidth: 2,
                            borderColor: roleColor + "40",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            permStyles.memberAvatarText,
                            { color: roleColor },
                          ]}
                        >
                          {role.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={permStyles.memberTitleRow}>
                          <Text
                            style={permStyles.memberName}
                            numberOfLines={1}
                          >
                            {role.name}
                          </Text>
                          {!role.isSystem ? (
                            <View style={permStyles.customTag}>
                              <Text style={permStyles.customTagText}>
                                CUSTOM
                              </Text>
                            </View>
                          ) : (
                            <View style={[permStyles.systemTag, { backgroundColor: roleColor + "18" }]}>
                              <Text style={[permStyles.systemTagText, { color: roleColor }]}>
                                SYSTEM
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={permStyles.memberRole}>
                          {memberCount} member{memberCount === 1 ? "" : "s"}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {!role.isSystem && memberCount === 0 && (
                          <TouchableOpacity
                            style={permStyles.deleteRoleBtn}
                            onPress={() => handleDeleteRole(role)}
                          >
                            <Text style={permStyles.deleteRoleBtnText}>🗑</Text>
                          </TouchableOpacity>
                        )}
                        {isDirty && !isLocked && (
                          <TouchableOpacity
                            style={[permStyles.saveBtn, isSaving && permStyles.saveBtnDisabled]}
                            onPress={() => saveRolePermissions(role)}
                            disabled={isSaving}
                          >
                            {isSaving
                              ? <ActivityIndicator size="small" color="#fff" />
                              : <Text style={permStyles.saveBtnText}>Save</Text>}
                          </TouchableOpacity>
                        )}
                        <Text style={{ fontSize: 18, color: C.text3 }}>{isExpanded ? "▲" : "▼"}</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Progress bar — full-width under the header, so
                        the role's permission strength reads at a glance
                        even when the card is collapsed. */}
                    <View style={permStyles.progressTrack}>
                      <View
                        style={[
                          permStyles.progressFill,
                          { width: `${pct}%` as any, backgroundColor: progressColor },
                        ]}
                      />
                    </View>
                    <View style={permStyles.progressLabelRow}>
                      <Text style={[permStyles.progressLabel, { color: progressColor }]}>
                        {isLocked ? "Full access" : `${enabledCount} of ${PERM_KEYS.length} permissions`}
                      </Text>
                      {!isLocked && <Text style={permStyles.progressPct}>{pct}%</Text>}
                    </View>

                    {isExpanded && (
                      <View style={permStyles.permGrid}>
                        {isLocked ? (
                          <Text style={{ fontSize: 12, color: C.text3, paddingVertical: 8 }}>
                            Admins always have every permission. This can't be changed.
                          </Text>
                        ) : (
                          <>
                            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                              <TouchableOpacity
                                style={permStyles.quickBtn}
                                onPress={() => {
                                  const all: Record<string, boolean> = {};
                                  PERM_KEYS.forEach((k) => { all[k] = true; });
                                  setPendingRolePerms((prev) => ({ ...prev, [role.id]: all as any }));
                                }}
                              >
                                <Text style={permStyles.quickBtnText}>✔ Grant All</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[permStyles.quickBtn, permStyles.quickBtnDanger]}
                                onPress={() => {
                                  const none: Record<string, boolean> = {};
                                  PERM_KEYS.forEach((k) => { none[k] = false; });
                                  setPendingRolePerms((prev) => ({ ...prev, [role.id]: none as any }));
                                }}
                              >
                                <Text style={[permStyles.quickBtnText, { color: C.error }]}>✕ Revoke All</Text>
                              </TouchableOpacity>
                            </View>

                            {PERM_GROUPS.map((group) => (
                              <View key={group.label} style={{ marginBottom: 10 }}>
                                <Text style={permStyles.permGroupLabel}>{group.label}</Text>
                                <View style={{ gap: 4 }}>
                                  {group.keys.map((key) => {
                                    const isEnabled = !!perms[key];
                                    return (
                                      <TouchableOpacity
                                        key={key}
                                        style={[permStyles.permRow, isEnabled && permStyles.permRowActive]}
                                        onPress={() => toggleRolePerm(role, key)}
                                        activeOpacity={0.7}
                                      >
                                        <Text style={[permStyles.permLabel, isEnabled && { color: C.primary, fontWeight: "700" }]}>
                                          {PERM_LABELS[key]}
                                        </Text>
                                        <View style={[permStyles.togglePill, isEnabled && permStyles.togglePillActive]}>
                                          <Text style={[permStyles.toggleText, isEnabled && permStyles.toggleTextActive]}>
                                            {isEnabled ? "ON" : "OFF"}
                                          </Text>
                                        </View>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              </View>
                            ))}
                          </>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      )}

      {/* ─── TOKEN REQUESTS SECTION ──────────────────────────────────────────── */}
      {activeSection === "tokenRequests" && isAdmin && (
        <View style={styles.contentScroll}>
          <View style={{ padding: 16, gap: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: C.text }}>
              Pending Token Requests
            </Text>
            <Text style={{ fontSize: 13, color: C.text3 }}>
              Process login token requests from members who need access to their accounts.
            </Text>

            {pendingTokenRequests.length === 0 ? (
              <View style={{ padding: 32, alignItems: "center" }}>
                <Text style={{ fontSize: 14, color: C.text3 }}>
                  No pending token requests
                </Text>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {pendingTokenRequests.map((request) => (
                  <View key={request.id} style={{ 
                    backgroundColor: C.surface, 
                    borderRadius: 12, 
                    borderWidth: 1, 
                    borderColor: C.border,
                    padding: 16,
                    gap: 12 
                  }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: C.text }}>
                          {request.email}
                        </Text>
                        <Text style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>
                          Requested {request.requestedAt ? new Date(request.requestedAt.toDate()).toLocaleString() : "Recently"}
                        </Text>
                      </View>
                      <View style={{ 
                        paddingHorizontal: 8, 
                        paddingVertical: 4, 
                        borderRadius: 6, 
                        backgroundColor: C.warning + "20" 
                      }}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: C.warning }}>
                          Pending
                        </Text>
                      </View>
                    </View>

                    {/* <View style={{ flexDirection: "row", gap: 8 }}>
                      <Button
                        label="Send Token"
                        onPress={() => handleProcessTokenRequest(request)}
                        loading={processingTokenRequest === request.id}
                        size="sm"
                        style={{ flex: 1 }}
                      />
                      <TouchableOpacity
                        onPress={() => handleCancelTokenRequest(request.id)}
                        style={{ 
                          paddingHorizontal: 16, 
                          paddingVertical: 10, 
                          borderRadius: 8, 
                          borderWidth: 1, 
                          borderColor: C.border,
                          backgroundColor: C.elevated
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: "600", color: C.text3 }}>
                          Cancel
                        </Text>
                      </TouchableOpacity>
                    </View> */}
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      )}

      {/* ─── AUDIT SECTION ────────────────────────────────────────────────── */}
      {activeSection === "audit" && (
        <View style={styles.contentScroll}>
          {/* ─── Toolbar ────────────────────────────────────────────────
              Three explicit rows so each piece has its own space
              regardless of screen width:

                Row 1 — search + filter + clear
                Row 2 — category tabs (horizontal scroll)
                Row 3 — count line

              Before this, everything lived in one flex-wrap container.
              A horizontal ScrollView inside flex-wrap has no intrinsic
              width on React Native Web, so the tabs collapsed to 0 and
              appeared frozen; the container would then re-measure when
              siblings wrapped, which is what made the whole audit page
              jump around on mobile. Splitting into rows removes the
              ScrollView from any wrapping context and gives it a
              stable full-width parent. */}
          <View style={auditStyles.toolbar}>
            {/* Row 1 — search + filter + clear */}
            <View style={auditStyles.auditToolbarRow}>
              <View style={auditStyles.searchBox}>
                <Text style={auditStyles.searchIcon}>🔍</Text>
                <TextInput
                  style={auditStyles.searchInput}
                  placeholder="Search logs…"
                  placeholderTextColor={C.text3}
                  value={searchTerm}
                  onChangeText={(v) => {
                    setSearchTerm(v);
                    setCurrentPage(1);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {!!searchTerm && (
                  <TouchableOpacity
                    onPress={() => {
                      setSearchTerm("");
                      setCurrentPage(1);
                    }}
                    hitSlop={8}
                  >
                    <Text style={auditStyles.clearSearch}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={[
                  auditStyles.filterBtn,
                  hasFilters && auditStyles.filterBtnActive,
                ]}
                onPress={openFilter}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    auditStyles.filterBtnText,
                    hasFilters && auditStyles.filterBtnTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {hasFilters ? "📌 Filtered" : "📅 Filter"}
                </Text>
              </TouchableOpacity>

              {hasFilters ? (
                <TouchableOpacity
                  onPress={clearFilters}
                  hitSlop={8}
                  style={auditStyles.clearBtn}
                >
                  <Text style={auditStyles.clearFilters}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Row 2 — category tabs (horizontal scroll) */}
            <View style={auditStyles.tabScrollWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={auditStyles.tabRow}
              >
                {AUDIT_TABS.map((tab) => {
                  const isActive = activeTab === tab.key;
                  const count =
                    tab.key === "all"
                      ? allAuditLogs.length
                      : tab.key === "failed"
                      ? allAuditLogs.filter(
                          (l) =>
                            l.action === "failed" || l.status === "failed",
                        ).length
                      : tab.key === "deletions"
                      ? allAuditLogs.filter((l) => l.action === "deleted")
                          .length
                      : allAuditLogs.filter(
                          (l) =>
                            l.entityType ===
                            (AUDIT_TAB_ENTITY as any)[tab.key],
                        ).length;
                  return (
                    <TouchableOpacity
                      key={tab.key}
                      style={[
                        auditStyles.tab,
                        isActive && auditStyles.tabActive,
                      ]}
                      onPress={() => {
                        setActiveTab(tab.key);
                        setCurrentPage(1);
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={auditStyles.tabIcon}>{tab.icon}</Text>
                      <Text
                        style={[
                          auditStyles.tabLabel,
                          isActive && auditStyles.tabLabelActive,
                        ]}
                        numberOfLines={1}
                      >
                        {tab.label}
                      </Text>
                      <View
                        style={[
                          auditStyles.tabCount,
                          isActive && auditStyles.tabCountActive,
                        ]}
                      >
                        <Text
                          style={[
                            auditStyles.tabCountText,
                            isActive && auditStyles.tabCountTextActive,
                          ]}
                        >
                          {count}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Row 3 — count line */}
            <Text style={auditStyles.count}>
              {filteredLogs.length.toLocaleString()} record
              {filteredLogs.length !== 1 ? "s" : ""}
              {hasFilters ? " (filtered)" : ""}
            </Text>
          </View>

          {/* Audit Log List */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, paddingBottom: 80 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
          >
            {filteredLogs.length === 0 ? (
              <View style={auditStyles.empty}>
                <Text style={auditStyles.emptyIcon}>📋</Text>
                <Text style={auditStyles.emptyTitle}>No records found</Text>
                <Text style={auditStyles.emptyDesc}>
                  {hasFilters
                    ? "No logs match your current filters. Try adjusting or clearing them."
                    : "Activity in this group will appear here as an audit trail."}
                </Text>
              </View>
            ) : (
              <>
                {isWide ? (
                  <View style={auditStyles.table}>
                    <View style={auditStyles.tableHead}>
                      <Text style={[auditStyles.th, { width: 170 }]}>Timestamp</Text>
                      <Text style={[auditStyles.th, { width: 120 }]}>Category</Text>
                      <Text style={[auditStyles.th, { width: 100 }]}>Action</Text>
                      <Text style={[auditStyles.th, { width: 130 }]}>User</Text>
                      <Text style={[auditStyles.th, { flex: 1 }]}>Details</Text>
                      <Text style={[auditStyles.th, { width: 80, textAlign: "right" }]}>Revert</Text>
                    </View>
                    {paginatedLogs.map((log) => (
                      <AuditLogRow key={log.id} log={log} onRevert={() => handleRevertLog(log)} />
                    ))}
                  </View>
                ) : (
                  paginatedLogs.map((log) => (
                    <AuditLogCard key={log.id} log={log} onRevert={() => handleRevertLog(log)} />
                  ))
                )}
                <Pagination currentPage={currentPage} totalPages={totalPages} onChange={setCurrentPage} />
              </>
            )}
          </ScrollView>
        </View>
      )}

      {/* ─── Modals ───────────────────────────────────────────────────────── */}

      {/* Create Role Modal */}
      <BottomModal visible={showCreateRole} onClose={() => { setShowCreateRole(false); setNewRoleName(""); }} title="Create New Role">
        <View style={{ padding: 16, gap: 12 }}>
          <Input
            label="Role name *"
            value={newRoleName}
            onChangeText={setNewRoleName}
            placeholder="e.g. Treasurer, Secretary"
          />
          <Text style={{ fontSize: 12, color: C.text3, lineHeight: 17 }}>
            The role is created with no permissions granted. After creating it, tap it in the list to turn on the permissions it should have.
          </Text>
          <Button label="Create Role" onPress={handleCreateRole} loading={creatingRole} fullWidth />
        </View>
      </BottomModal>

      {/* Create Member Modal */}
      <BottomModal visible={showCreateMember} onClose={() => setShowCreateMember(false)} title="Add New Member">
        <View style={{ padding: 16, gap: 12 }}>
          <Input
            label="Full Name *"
            value={createForm.fullName}
            onChangeText={(t) => setCreateForm(p => ({ ...p, fullName: t }))}
            placeholder="John Doe"
          />
          <Input
            label="Email *"
            value={createForm.email}
            onChangeText={(t) => setCreateForm(p => ({ ...p, email: t }))}
            placeholder="john@example.com"
            keyboardType="email-address"
          />
          <Input
            label="Phone"
            value={createForm.phone}
            onChangeText={(t) => setCreateForm(p => ({ ...p, phone: t }))}
            placeholder="+250-7XX-XXX-XXX"
          />
          <RolePicker value={createForm.role} onChange={(v) => setCreateForm(p => ({ ...p, role: v }))} />
          <Button
            label="Create User"
            onPress={handleCreateMember}
            loading={creatingMember}
            fullWidth
          />
        </View>
      </BottomModal>

      {/* Edit Member Modal */}
      <BottomModal visible={showEditMember} onClose={() => { setShowEditMember(false); setEditingMember(null); }} title="Edit Member">
        <View style={{ padding: 16, gap: 12 }}>
          <Input
            label="Full Name *"
            value={editForm.fullName}
            onChangeText={(t) => setEditForm(p => ({ ...p, fullName: t }))}
            placeholder="Full name"
          />
          <Input
            label="Email"
            value={editForm.email}
            onChangeText={(t) => setEditForm(p => ({ ...p, email: t }))}
            placeholder="Email address"
            keyboardType="email-address"
          />
          <Input
            label="Phone"
            value={editForm.phone}
            onChangeText={(t) => setEditForm(p => ({ ...p, phone: t }))}
            placeholder="Phone number"
          />
          <RolePicker value={editForm.role} onChange={(v) => setEditForm(p => ({ ...p, role: v }))} />
          <Button
            label="Save Changes"
            onPress={handleSaveEditMember}
            loading={savingMember}
            fullWidth
          />
        </View>
      </BottomModal>

      {/* Member Access Check Modal */}
      <BottomModal visible={showDriftModal} onClose={() => setShowDriftModal(false)} title="Member Access Check">
        <View style={{ padding: 16, gap: 12 }}>
          {!driftResults || driftResults.length === 0 ? (
            <Text style={{ fontSize: 13, color: C.text3, textAlign: "center", paddingVertical: 20 }}>
              ✓ Every member's access is correctly in sync.
            </Text>
          ) : (
            <>
              <Text style={{ fontSize: 13, color: C.text2, lineHeight: 18 }}>
                {driftResults.length} member{driftResults.length === 1 ? " has" : "s have"} a mismatch between their
                shown role and their actual access. This can happen after a manual data edit. Fixing it re-syncs their
                access to match their shown role.
              </Text>
              {driftResults.map((d) => (
                <View key={d.memberId} style={{
                  borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, gap: 6,
                }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: C.text }}>{d.memberFullName}</Text>
                  <Text style={{ fontSize: 11, color: C.text3 }}>
                    Shows as: {d.memberRole} / {d.memberStatus}{"\n"}
                    Actual access: {d.membershipRole ?? "no access record"} / {d.membershipStatus ?? "—"}
                  </Text>
                  <Button
                    label="Fix This Member"
                    onPress={() => handleFixDrift(d)}
                    loading={fixingDriftId === d.memberId}
                    size="sm"
                  />
                </View>
              ))}
              <Button
                label={`Fix All (${driftResults.length})`}
                onPress={handleFixAllDrift}
                loading={fixingDriftId === "__all__"}
                fullWidth
                variant="success"
              />
            </>
          )}
        </View>
      </BottomModal>

      {/* Delete Confirmation Modal */}
      <BottomModal
        visible={showDeleteConfirm && !!selectedMember}
        onClose={() => {
          setShowDeleteConfirm(false);
          setSelectedMember(null);
        }}
        title="Delete member?"
      >
        {selectedMember && (
          <View style={{ padding: 16, gap: 12, paddingBottom: 24 }}>
            <View style={deleteStyles.iconCircle}>
              <Text style={deleteStyles.icon}>🗑</Text>
            </View>

            <Text style={deleteStyles.title}>
              Delete {selectedMember.fullName}?
            </Text>
            <Text style={deleteStyles.body}>
              This will permanently remove this member from the group. Their
              name, contact info, and role assignment will be erased.
            </Text>

            <View style={deleteStyles.warningBox}>
              <Text style={deleteStyles.warningTitle}>
                ⚠ This cannot be undone
              </Text>
              <Text style={deleteStyles.warningText}>
                If you want to keep this member's history but revoke their
                access, use Deactivate instead — it preserves everything.
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setShowDeleteConfirm(false);
                  setSelectedMember(null);
                }}
                style={{ flex: 1 }}
              />
              <Button
                label="Delete member"
                variant="danger"
                onPress={() => handleDeleteMember(selectedMember)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}
      </BottomModal>

      {/* Member Detail Modal */}
      {showMemberDetail && selectedMember && (
        <MemberDetailModal
          member={selectedMember}
          onClose={() => {
            setShowMemberDetail(false);
            // Delay clearing selectedMember so the modal can animate out
            // using the same reference. Clearing immediately causes the
            // close animation to render with `member = null`.
            setTimeout(() => setSelectedMember(null), 300);
          }}
        />
      )}

      <Toast visible={visible} msg={msg} type={type}/>
    </View>
  );
}

// ─────────────────────────────────────────────
// Detail Styles
// ─────────────────────────────────────────────
const detailStyles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32 },

  // ── Hero ──
  hero: { alignItems: "center", paddingVertical: 8, marginBottom: 12 },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  heroAvatarText: { fontSize: 26, fontWeight: "800", color: "#fff" },
  heroName: {
    fontSize: 20,
    fontWeight: "800",
    color: C.text,
    textAlign: "center",
    marginBottom: 6,
    paddingHorizontal: 12,
  },
  heroBadges: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 6,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  heroMeta: { fontSize: 11, color: C.text3 },

  // ── Stat row ──
  statRow: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  statCell: { flex: 1, alignItems: "center", minWidth: 0, paddingHorizontal: 4 },
  statDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: C.borderLight,
  },
  statValue: {
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 3,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  // ── Section labels ──
  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 6,
    paddingHorizontal: 2,
  },

  // ── Section cards (rows) ──
  sectionCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  rowIcon: { fontSize: 15, width: 22 },
  rowLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: C.text2,
    width: 90,
  },
  rowValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: C.text,
    textAlign: "right",
  },

  // ── Actions cards ──
  actionsCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 4,
    marginBottom: 8,
    overflow: "hidden",
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  actionIconText: { fontSize: 16 },
  actionLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  actionDesc: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
    lineHeight: 15,
  },
  actionChevron: {
    fontSize: 20,
    fontWeight: "700",
    opacity: 0.5,
    marginLeft: 4,
  },

  // ── Close ──
  closeBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text2,
  },
});

// ─────────────────────────────────────────────
// Delete Confirmation Styles
// ─────────────────────────────────────────────
const deleteStyles = StyleSheet.create({
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(220,38,38,0.08)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 6,
  },
  icon: { fontSize: 28 },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: C.text,
    textAlign: "center",
  },
  body: {
    fontSize: 13,
    color: C.text2,
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  warningBox: {
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.3)",
    padding: 12,
    marginTop: 4,
  },
  warningTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#92400E",
    marginBottom: 4,
  },
  warningText: {
    fontSize: 12,
    color: "#B45309",
    lineHeight: 17,
  },
});

// ─────────────────────────────────────────────
// Main Styles
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 48 : 20,
    paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerWide: {
    paddingHorizontal: 32,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.elevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  backBtnText: {
    fontSize: 16,
    color: C.text2,
    fontWeight: "600",
    lineHeight: 20,
  },
  headerTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: 12,
    color: C.text3,
    marginTop: 1,
  },
  // Fixed-width slot so the title doesn't recenter when the action
  // button appears or disappears between tabs.
  headerActionSlot: {
    minWidth: 90,
    alignItems: "flex-end",
  },
  headerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
    minHeight: 34,
    justifyContent: "center",
    alignItems: "center",
  },
  headerBtnPrimary: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  headerBtnDisabled: { opacity: 0.6 },
  headerBtnPrimaryText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.2,
  },

  // ── Tab bar ────────────────────────────────────────────────────────
  tabWrapper: {
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  tabBarWide: {
    paddingHorizontal: 32,
    // On wide screens the tab row is centered and capped so it reads
    // as a discrete control rather than stretching the full header.
    justifyContent: "center",
    maxWidth: 760,
    alignSelf: "center",
    width: "100%",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "transparent",
    flexShrink: 0,
    minHeight: 38,
  },
  tabActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  tabIcon: {
    fontSize: 14,
    lineHeight: 18,
    opacity: 0.75,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "700",
    color: C.text3,
    letterSpacing: 0.1,
  },
  tabTextActive: {
    color: "#fff",
  },

  // ── Tab badges ─────────────────────────────────────────────────────
  // Sized as compact pills so appearing/disappearing doesn't shift
  // the row when switching tabs. Active state inverts: white on the
  // primary fill, so the count stays legible.
  tabBadge: {
    backgroundColor: C.primary + "22",
    borderRadius: 8,
    paddingHorizontal: 6,
    minWidth: 20,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeActive: {
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: C.primary,
  },
  tabBadgeTextActive: {
    color: "#fff",
  },
  tabBadgeAlert: {
    backgroundColor: "rgba(220,38,38,0.15)",
    borderRadius: 8,
    paddingHorizontal: 6,
    minWidth: 20,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeAlertActive: {
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  tabBadgeAlertText: {
    fontSize: 10,
    fontWeight: "800",
    color: C.error,
  },
  tabBadgeAlertTextActive: {
    color: "#fff",
  },

  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FEF3C7",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(217,119,6,0.35)",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pendingBannerIcon: { fontSize: 18 },
  pendingBannerTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#92400E",
  },
  pendingBannerHint: {
    fontSize: 11,
    color: "#B45309",
    marginTop: 1,
  },
  pendingBannerCta: {
    fontSize: 12,
    fontWeight: "800",
    color: "#92400E",
    letterSpacing: 0.2,
  },

  contentScroll: { flex: 1 },
  contentWide: {
    paddingHorizontal: 32,
    maxWidth: 1100,
    alignSelf: "center",
    width: "100%",
  },
  body: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 40
  },
  bodyWide: {
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingBottom: 40
  },

  groupCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 4,
  },
  groupAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  groupAvatarLetter: { fontSize: 16, fontWeight: "800", color: "#fff" },
  groupName: { fontSize: 14, fontWeight: "700", color: C.text },
  groupDesc: { fontSize: 12, color: C.text3, marginTop: 1 },
  groupMeta: { fontSize: 10, color: C.text3, marginTop: 2 },

  // ── Settings grid ────────────────────────────────────────────────
  //
  // A flex-wrap layout that behaves like CSS grid auto-fit:
  //
  //   Container:      flexDirection row, flexWrap wrap, gap 20
  //   Each column:    flexBasis 400, flexGrow 1, maxWidth 620
  //
  // On desktop with 1100px of usable width, the two columns sit
  // side-by-side at ~540px each — comfortable reading width. On a
  // tablet (720-900px), each column gets ~400-440px, still side-by-
  // side but tighter. Below that, the columns wrap and stack full
  // width. On ultra-wide (2400px+), the maxWidth cap keeps them from
  // stretching thin, and the whole grid centers inside the 1100px
  // content wrapper.
  settingsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 20,
    alignItems: "flex-start",
    marginTop: 4,
  },
  settingsCol: {
    flexBasis: 400,
    flexGrow: 1,
    maxWidth: 620,
    minWidth: 0,
  },
  wideSaveRow: {
    marginTop: 24,
    alignItems: "flex-start",
  },

  row: { flexDirection: "row", gap: 8 },
  fieldHint: { fontSize: 10, color: C.text3, marginTop: 3, paddingHorizontal: 4 },

  // Highlighted preview chip — used under the rate inputs to surface
  // the actual currency amount a percentage translates to. Reads as
  // "this is what the setting costs in practice" rather than as an
  // aside. Only set on the preview variants below; the base
  // fieldHint remains for neutral hints.
  fieldPreview: {
    fontSize: 11,
    fontWeight: "700",
    color: C.primary,
    backgroundColor: C.primary + "10",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  fieldPreviewGold: {
    color: "#92400E",
    backgroundColor: "#FEF3C7",
  },
  fieldPreviewRed: {
    color: "#991B1B",
    backgroundColor: "#FEF2F2",
  },
  penaltyNote: { fontSize: 12, color: C.text3, marginBottom: 10, lineHeight: 17 },
  subLabel: { fontSize: 11, fontWeight: "700", color: C.text2, marginTop: 4, marginBottom: 6 },
  goalPreview: { fontSize: 11, color: C.primary, fontWeight: "600", marginTop: 6 },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  toggleLabel: { fontSize: 13, fontWeight: "600", color: C.text },
  toggleHint: { fontSize: 11, color: C.text3, marginTop: 2 },

  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 10,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconDanger: { backgroundColor: "rgba(220,38,38,0.08)" },
  actionIconText: { fontSize: 14 },
  actionInfo: { flex: 1 },
  actionTitle: { fontSize: 13, fontWeight: "600", color: C.text },
  actionDesc: { fontSize: 11, color: C.text3, marginTop: 1 },
  actionCta: { fontSize: 12, fontWeight: "700" },

  addMemberBtn: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  addMemberBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
});

// ─────────────────────────────────────────────
// Member Styles - Simple summary
// ─────────────────────────────────────────────
const memberStyles = StyleSheet.create({
  // ── Pending alert ────────────────────────────────────────────────────
  pendingAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.35)",
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pendingAlertIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(217,119,6,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  pendingAlertTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#92400E",
  },
  pendingAlertHint: {
    fontSize: 11,
    color: "#B45309",
    marginTop: 1,
  },
  pendingAlertCta: {
    fontSize: 12,
    fontWeight: "800",
    color: "#92400E",
    letterSpacing: 0.2,
  },

  // ── Stat tiles ───────────────────────────────────────────────────────
  statGrid: {
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 10,
  },
  statTile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
    borderLeftColor: C.text2,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  statTileLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: C.text3,
    marginBottom: 4,
  },
  statTileValue: {
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 24,
  },

  // ── Compact toolbar ──────────────────────────────────────────────────
  toolbar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  toolbarBtnPrimary: {
    flex: 1,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  toolbarBtnPrimaryText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  toolbarBtnGhost: {
    backgroundColor: C.elevated,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
    minWidth: 130,
  },
  toolbarBtnGhostText: {
    color: C.text2,
    fontSize: 12,
    fontWeight: "700",
  },

  // ── Filter row wrapper ───────────────────────────────────────────────
  filterRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },

  // ── Legacy (kept for compat; not used after this patch) ──────────────
  summaryRow: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingVertical: 10,
    overflow: "hidden",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
  },
  summaryVal: {
    fontSize: 18,
    fontWeight: "800",
    color: C.text,
  },
  summaryLbl: {
    fontSize: 9,
    color: C.text3,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: C.border,
  },

  // ── Member rows (status-striped) ────────────────────────────────────
  list: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    paddingLeft: 11,
    borderLeftWidth: 3,
    borderLeftColor: C.border,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
    backgroundColor: C.surface,
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowName: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
  },
  rowMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 3,
  },
  rowMeta: {
    fontSize: 11,
    color: C.text3,
    flexShrink: 1,
  },
  metaDot: {
    fontSize: 11,
    color: C.text3,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    flexShrink: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "capitalize",
    letterSpacing: 0.2,
  },
});

// ─────────────────────────────────────────────
// Permission Styles (now role cards, not member cards)
// ─────────────────────────────────────────────
const permStyles = StyleSheet.create({
  searchContainer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchIcon: { fontSize: 13, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13, color: C.text, minHeight: 18 },
  searchHint: { fontSize: 11, color: C.text3, marginTop: 4, lineHeight: 15 },
  memberCard: {
    backgroundColor: C.surface,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  memberHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: C.elevated,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.primary + "22",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  memberAvatarText: { fontSize: 12, fontWeight: "700", color: C.primary },
  memberName: { fontSize: 13, fontWeight: "700", color: C.text },
  memberRole: { fontSize: 10, color: C.text3, marginTop: 1, textTransform: "capitalize" },
  permGrid: { padding: 10 },
  permRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  permRowActive: { backgroundColor: C.primary + "0a" },
  permLabel: { fontSize: 12, fontWeight: "500", color: C.text, flex: 1, paddingRight: 6 },
  permGroupLabel: {
    fontSize: 8,
    fontWeight: "800",
    color: C.text3,
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 3,
  },
  quickBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.primary + "40",
    backgroundColor: C.primary + "0a",
  },
  quickBtnDanger: { borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.06)" },
  quickBtnText: { fontSize: 10, fontWeight: "700", color: C.primary },
  togglePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    minWidth: 40,
    alignItems: "center",
  },
  togglePillActive: { backgroundColor: C.primary + "15", borderColor: C.primary },
  toggleText: { fontSize: 8, fontWeight: "800", color: C.text3, letterSpacing: 0.4 },
  toggleTextActive: { color: C.primary },
  saveBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  tokenBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  tokenBtnDisabled: { opacity: 0.6 },
  tokenBtnText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  deleteRoleBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  deleteRoleBtnText: { fontSize: 12 },

  // ── Role card extras (tags, progress) ───────────────────────────────
  memberTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  customTag: {
    backgroundColor: C.accent + "20",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  customTagText: {
    fontSize: 8,
    fontWeight: "800",
    color: C.accent,
    letterSpacing: 0.4,
  },
  systemTag: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  systemTagText: {
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.4,
  },

  progressTrack: {
    height: 4,
    backgroundColor: C.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%" as any,
  },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
    backgroundColor: C.surface,
  },
  progressLabel: {
    fontSize: 10,
    fontWeight: "700",
  },
  progressPct: {
    fontSize: 10,
    fontWeight: "800",
    color: C.text3,
  },
});

// ─────────────────────────────────────────────
// Audit Styles
// ─────────────────────────────────────────────
const auditStyles = StyleSheet.create({
  // ── Audit toolbar (redesigned) ──────────────────────────────────────
  // Vertical stack, three rows. Every row has a stable width, so
  // nothing inside jumps when siblings wrap or conditional UI
  // (like the "Clear" button) appears/disappears.
  toolbar: {
    flexDirection: "column",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 8,
  },
  auditToolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  count: {
    fontSize: 11,
    fontWeight: "600",
    color: C.text3,
  },
  searchBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    minHeight: 36,
  },
  searchIcon: { fontSize: 12, color: C.text3, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13, color: C.text, minHeight: 18 },
  clearSearch: { color: C.text3, fontSize: 13, paddingHorizontal: 4 },
  clearBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },

  // The horizontal ScrollView lives in its own non-wrapping full-width
  // container. tabScrollWrap gives it a stable 100% width to measure
  // against; without this it collapses on RNW.
  tabScrollWrap: {
    width: "100%",
  },
  tabRow: {
    flexDirection: "row",
    gap: 4,
    paddingRight: 12,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabActive: { backgroundColor: C.primary + "12", borderColor: C.primary + "30" },
  tabIcon: { fontSize: 10 },
  tabLabel: { fontSize: 10, fontWeight: "600", color: C.text3 },
  tabLabelActive: { color: C.primary },
  tabCount: {
    backgroundColor: C.elevated,
    borderRadius: 6,
    paddingHorizontal: 3,
    minWidth: 14,
    alignItems: "center",
  },
  tabCountActive: { backgroundColor: C.primary + "25" },
  tabCountText: { fontSize: 8, fontWeight: "700", color: C.text3 },
  tabCountTextActive: { color: C.primary },
  filterBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
  },
  filterBtnActive: { borderColor: C.primary, backgroundColor: C.primary + "10" },
  filterBtnText: { fontSize: 11, fontWeight: "600", color: C.text3 },
  filterBtnTextActive: { color: C.primary },
  clearFilters: { fontSize: 11, color: C.error, fontWeight: "600" },
  table: {
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: C.elevated,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  th: { fontSize: 9, fontWeight: "700", color: C.text3, textTransform: "uppercase", letterSpacing: 0.4, paddingHorizontal: 3 },
  empty: { alignItems: "center", paddingVertical: 40 },
  emptyIcon: { fontSize: 32, opacity: 0.5 },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.text, marginTop: 8 },
  emptyDesc: { fontSize: 12, color: C.text3, textAlign: "center", marginTop: 4, paddingHorizontal: 16 },
});

// ─────────────────────────────────────────────
// Audit Row Styles
// ─────────────────────────────────────────────
const atr = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
    backgroundColor: C.surface,
  },
  rowExpanded: { backgroundColor: C.elevated },
  cell: { fontSize: 11, color: C.text2, paddingHorizontal: 3 },
  badge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, alignSelf: "flex-start" },
  badgeText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.2 },
  revert: { fontSize: 14, color: C.primary, fontWeight: "700" },
  expand: { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.elevated },
  errorBox: { backgroundColor: "#fef2f2", borderRadius: 6, padding: 8, borderWidth: 1, borderColor: "#fecaca", marginBottom: 8 },
  errorLabel: { fontSize: 8, fontWeight: "800", color: "#dc2626", letterSpacing: 1, marginBottom: 2 },
  errorText: { fontSize: 10, color: "#b91c1c", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  diffRow: { flexDirection: "row", gap: 10 },
  diffBlock: { flex: 1, backgroundColor: C.surface, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: C.border },
  diffLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.4, marginBottom: 3, textTransform: "uppercase" },
  diffCode: { fontSize: 9, color: C.text2, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", lineHeight: 13 },
});

// ─────────────────────────────────────────────
// Audit Card Styles
// ─────────────────────────────────────────────
const atc = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 8,
  },
  header: { flexDirection: "row", alignItems: "flex-start" },
  topRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  category: { fontSize: 11, fontWeight: "700", color: C.text },
  detail: { fontSize: 11, color: C.text2, lineHeight: 16 },
  chevron: { fontSize: 11, color: C.text3, marginLeft: 6, paddingTop: 2 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  user: { fontSize: 10, color: C.text3 },
  time: { fontSize: 10, color: C.text3 },
  revertBtn: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.borderLight },
  revertText: { fontSize: 11, fontWeight: "600", color: C.primary },
  expand: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.borderLight },
});

// ─────────────────────────────────────────────
// Pagination Styles
// ─────────────────────────────────────────────
const pg = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 12 },
  btn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.elevated, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 12, fontWeight: "600", color: C.text },
  info: { fontSize: 12, color: C.text3 },
});

// ─────────────────────────────────────────────
// Audit Log Row (Desktop)
// ─────────────────────────────────────────────
function AuditLogRow({ log, onRevert }: { log: AuditLog; onRevert: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getActionConfig(log.action);
  const ts = new Date(log.timestamp);
  const tsStr = isNaN(ts.getTime()) ? log.timestamp : ts.toLocaleString();
  const canRevert = log.action !== "reverted" && (log.action === "deleted" || log.action === "created" || !!log.before);

  return (
    <>
      <TouchableOpacity style={[atr.row, expanded && atr.rowExpanded]} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
        <Text style={[atr.cell, { width: 150 }]} numberOfLines={1}>{tsStr}</Text>
        <Text style={[atr.cell, { width: 100 }]} numberOfLines={1}>{entityLabel(log.entityType)}</Text>
        <View style={{ width: 90 }}>
          <View style={[atr.badge, { backgroundColor: cfg.bg }]}>
            <Text style={[atr.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
          </View>
        </View>
        <Text style={[atr.cell, { width: 110 }]} numberOfLines={1}>{log.userName ?? "—"}</Text>
        <Text style={[atr.cell, { flex: 1 }]} numberOfLines={1}>{log.reason || `${entityLabel(log.entityType)} ${log.action}`}</Text>
        <View style={{ width: 60, alignItems: "flex-end" }}>
          {canRevert && (
            <TouchableOpacity onPress={onRevert}>
              <Text style={atr.revert}>↺</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
      {expanded && (log.before || log.after || log.errorMessage) && (
        <View style={atr.expand}>
          {log.errorMessage && (
            <View style={atr.errorBox}>
              <Text style={atr.errorLabel}>Error</Text>
              <Text style={atr.errorText}>{log.errorMessage}</Text>
            </View>
          )}
          <View style={atr.diffRow}>
            {log.before && (
              <View style={atr.diffBlock}>
                <Text style={[atr.diffLabel, { color: "#dc2626" }]}>← Before</Text>
                <Text style={atr.diffCode}>{JSON.stringify(log.before, null, 2)}</Text>
              </View>
            )}
            {log.after && (
              <View style={atr.diffBlock}>
                <Text style={[atr.diffLabel, { color: "#16a34a" }]}>→ After</Text>
                <Text style={atr.diffCode}>{JSON.stringify(log.after, null, 2)}</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// Audit Log Card (Mobile)
// ─────────────────────────────────────────────
function AuditLogCard({ log, onRevert }: { log: AuditLog; onRevert: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getActionConfig(log.action);
  const ts = new Date(log.timestamp);
  const tsStr = isNaN(ts.getTime()) ? log.timestamp : ts.toLocaleDateString() + " " + ts.toLocaleTimeString();
  const canRevert = log.action !== "reverted" && (log.action === "deleted" || log.action === "created" || !!log.before);

  return (
    <TouchableOpacity style={atc.card} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
      <View style={atc.header}>
        <View style={{ flex: 1 }}>
          <View style={atc.topRow}>
            <Text style={atc.category}>{entityLabel(log.entityType)}</Text>
            <View style={[atr.badge, { backgroundColor: cfg.bg }]}>
              <Text style={[atr.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
            </View>
          </View>
          <Text style={atc.detail} numberOfLines={expanded ? undefined : 2}>
            {log.reason || `${entityLabel(log.entityType)} ${log.action}`}
          </Text>
        </View>
        <Text style={atc.chevron}>{expanded ? "▲" : "▼"}</Text>
      </View>
      <View style={atc.footer}>
        <Text style={atc.user}>{log.userName ?? "—"}</Text>
        <Text style={atc.time}>{tsStr}</Text>
      </View>
      {canRevert && (
        <TouchableOpacity style={atc.revertBtn} onPress={onRevert}>
          <Text style={atc.revertText}>↺ Revert</Text>
        </TouchableOpacity>
      )}
      {expanded && (log.before || log.after || log.errorMessage) && (
        <View style={atc.expand}>
          {log.errorMessage && (
            <View style={atr.errorBox}>
              <Text style={atr.errorLabel}>Error</Text>
              <Text style={atr.errorText}>{log.errorMessage}</Text>
            </View>
          )}
          {log.before && (
            <View style={atr.diffBlock}>
              <Text style={[atr.diffLabel, { color: "#dc2626" }]}>← Before</Text>
              <Text style={atr.diffCode}>{JSON.stringify(log.before, null, 2)}</Text>
            </View>
          )}
          {log.after && (
            <View style={atr.diffBlock}>
              <Text style={[atr.diffLabel, { color: "#16a34a" }]}>→ After</Text>
              <Text style={atr.diffCode}>{JSON.stringify(log.after, null, 2)}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────
function Pagination({ currentPage, totalPages, onChange }: { currentPage: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;

  return (
    <View style={pg.bar}>
      <TouchableOpacity
        style={[pg.btn, currentPage === 1 && pg.btnDisabled]}
        onPress={() => onChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        <Text style={pg.btnText}>← Prev</Text>
      </TouchableOpacity>
      <Text style={pg.info}>Page {currentPage} of {totalPages}</Text>
      <TouchableOpacity
        style={[pg.btn, currentPage === totalPages && pg.btnDisabled]}
        onPress={() => onChange(currentPage + 1)}
        disabled={currentPage === totalPages}
      >
        <Text style={pg.btnText}>Next →</Text>
      </TouchableOpacity>
    </View>
  );
}