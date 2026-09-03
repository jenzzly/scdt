// app/group-settings.tsx - Complete file with scrollable tabs
import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator, RefreshControl, Modal, useWindowDimensions, Switch, TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { useStore, useActiveGroup, useGroupAuditLogs } from "../stores/useStore";
import { useGroupMembers } from "../stores/selectors";
import { useAuth } from "../hooks/useAuth";
import { Input, Select, Button, useToast, Card, DatePicker, SearchBar, TabRow, BottomModal, Badge, Avatar, InfoRow, CardRow, Empty } from "../components/ui";
import { Colors, C, T, fmtCurrency, fmtDate, showConfirm, round2 } from "../utils/theme";
import { exportFullData, importFullData } from "../utils/importExport";
import * as FS from "../lib/firestore";
import type { AuditLog, MemberPermissions, Member } from "../types";
import { DEFAULT_MEMBER_PERMISSIONS } from "../types";
import { USER_ROLES, ROLE_LABELS } from "../types/roles";
import { createUserAsAdmin, resetUserPasswordAsAdmin } from "../lib/auth/adminUsers";

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
  { label: "Bi-weekly", value: "biweekly" },
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
// Filter Modal
// ─────────────────────────────────────────────
// In the FilterModal component, replace the Modal with the BottomModal component
// since that's what you're using elsewhere in the app:

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

// Update the fm styles:
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
function SectionHeading({ label, description }: { label: string; description?: string }) {
  return (
    <View style={sh.container}>
      <Text style={sh.label}>{label}</Text>
      {description && <Text style={sh.description}>{description}</Text>}
    </View>
  );
}

const sh = StyleSheet.create({
  container: { marginTop: 16, marginBottom: 8 },
  label: {
    fontSize: 12, fontWeight: "700", color: C.text2,
    textTransform: "uppercase", letterSpacing: 0.6,
  },
  description: {
    fontSize: 11, color: C.text3, marginTop: 3, lineHeight: 16,
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
  const { updateGroup, activeGroupId, reset, deleteMember } = useStore();
  const { signOut } = useAuth();
  const { show, Toast } = useToast();

  // Define SETTINGS_TABS here
  const SETTINGS_TABS = [
    { key: "settings", label: "⚙️ Settings" },
    { key: "members", label: "👥 Members" },
    { key: "permissions", label: "🔐 Permissions" },
    { key: "audit", label: "📋 Audit" },
  ] as const;

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
  const [showMemberDetail, setShowMemberDetail] = useState(false);
  const [showCreateMember, setShowCreateMember] = useState(false);
  const [showEditMember, setShowEditMember] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [creatingMember, setCreatingMember] = useState(false);
  const [savingMember, setSavingMember] = useState(false);

  const [createForm, setCreateForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    role: "member",
  });

  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    role: "member",
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
  const [activeSection, setActiveSection] = useState<"settings" | "members" | "permissions" | "audit">("settings");
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

  // ─── Permissions State ──────────────────────────────────────────────────
  const allMembers = useGroupMembers();
  const activeMembers = useMemo(() => allMembers.filter(m => m.status === "active" && m.role !== "admin"), [allMembers]);
  const [permSaving, setPermSaving] = useState<string | null>(null);
  const [pendingPerms, setPendingPerms] = useState<Record<string, MemberPermissions>>({});
  const [permSearch, setPermSearch] = useState("");
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

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

    setCreatingMember(true);
    try {
      const result = await createUserAsAdmin(
        {
          fullName: createForm.fullName.trim(),
          email: createForm.email.trim(),
          phone: createForm.phone.trim(),
          role: createForm.role as any,
          groupId: activeGroupId,
        },
        currentMember.userId,
        currentMember.fullName || "Admin"
      );

      if (!result.success) {
        show(result.error || "Failed to create user", "error");
        return;
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

  const handleApproveMember = async (member: Member) => {
    try {
      await FS.updateMember(activeGroupId!, member.id, { status: "active" });
      show(`${member.fullName} approved`);
      setShowMemberDetail(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to approve member", "error");
    }
  };

  const handleDeactivateMember = async (member: Member) => {
    showConfirm(
      "Deactivate Member",
      `Deactivate ${member.fullName}? They won't be able to participate in group activities.`,
      async () => {
        try {
          await FS.updateMember(activeGroupId!, member.id, { status: "inactive" });
          show("Member deactivated");
          setShowMemberDetail(false);
          setSelectedMember(null);
        } catch (e: any) {
          show(e.message || "Failed to deactivate", "error");
        }
      }
    );
  };

  const handleReactivateMember = async (member: Member) => {
    showConfirm(
      "Reactivate Member",
      `Reactivate ${member.fullName}? They'll be able to participate in group activities again.`,
      async () => {
        try {
          await FS.updateMember(activeGroupId!, member.id, { status: "active" });
          show("Member reactivated");
          setShowMemberDetail(false);
          setSelectedMember(null);
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
      show("Cannot delete member with financial history. Deactivate instead.", "error");
      return;
    }

    try {
      await deleteMember(member.id);
      show(`Member ${member.fullName} removed`);
      setShowDeleteConfirm(false);
      setShowMemberDetail(false);
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
    setEditForm({
      fullName: member.fullName,
      email: member.email || "",
      phone: member.phone || "",
      role: member.role,
    });
    setSelectedMember(member);
    setShowEditMember(true);
  };

  const handleSaveEditMember = async () => {
    if (!selectedMember) return;
    if (!editForm.fullName.trim()) {
      show("Name required", "error");
      return;
    }

    setSavingMember(true);
    try {
      await FS.updateMember(activeGroupId!, selectedMember.id, {
        fullName: editForm.fullName.trim(),
        email: editForm.email.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        role: editForm.role as any,
      });
      show("Member updated");
      setShowEditMember(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to update member", "error");
    } finally {
      setSavingMember(false);
    }
  };

  const getMemberPerms = useCallback((m: Member): MemberPermissions => {
    return pendingPerms[m.id] ?? m.permissions ?? { ...DEFAULT_MEMBER_PERMISSIONS };
  }, [pendingPerms]);

  const togglePerm = useCallback((memberId: string, key: keyof MemberPermissions, base: MemberPermissions) => {
    setPendingPerms(prev => ({
      ...prev,
      [memberId]: { ...base, [key]: !base[key] },
    }));
  }, []);

  const savePermissions = useCallback(async (member: Member) => {
    const perms = getMemberPerms(member);
    setPermSaving(member.id);
    try {
      await useStore.getState().updateMember(member.id, { permissions: perms });
      setPendingPerms(prev => { const n = { ...prev }; delete n[member.id]; return n; });
      show("Permissions saved for " + member.fullName);
    } catch (e: any) {
      show(e.message || "Failed to save permissions", "error");
    } finally {
      setPermSaving(null);
    }
  }, [getMemberPerms, show]);

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
    console.log("[GroupSettings] Opening filter modal"); // Debug log
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
    await new Promise((r) => setTimeout(r, 1000));
    setRefreshing(false);
  };

  const contribAmountNum = parseFloat(contribAmount) || 0;

  // ─── Member Detail Modal ────────────────────────────────────────────────
  const MemberDetailModal = ({ member, onClose }: { member: Member; onClose: () => void }) => {
    const stats = getMemberStats(member, wallet, contributions);
    const isMe = member.userId === currentMember?.userId;

    return (
      <BottomModal visible={!!member} onClose={onClose} title={member.fullName}>
        <View style={{ padding: 16, gap: 12 }}>
          <View style={detailStyles.header}>
            <View style={detailStyles.avatar}>
              <Text style={detailStyles.avatarText}>
                {member.fullName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={detailStyles.name}>{member.fullName}</Text>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                <Badge label={ROLE_LABELS[member.role] || member.role} color={ROLE_BADGE[member.role] || "teal"} />
                <Badge label={member.status} color={STATUS_BADGE[member.status] || "muted"} />
              </View>
            </View>
          </View>

          <InfoRow label="Email" value={member.email || "-"} />
          <InfoRow label="Phone" value={member.phone || "-"} />
          <InfoRow label="Joined" value={fmtDate(member.dateJoined || "")} />
          <InfoRow label="Contributions" value={fmtCurrency(stats.totalContributions)} />

          {isAdmin && !isMe && (
            <View style={{ marginTop: 8, gap: 8 }}>
              {member.status === "pending" && (
                <Button label="✓ Approve Member" onPress={() => handleApproveMember(member)} fullWidth variant="success" />
              )}
              {member.status === "active" && (
                <Button 
                  label="⛔ Deactivate" 
                  onPress={() => handleDeactivateMember(member)} 
                  fullWidth 
                  variant="secondary"
                  style={{ backgroundColor: C.gold, borderColor: C.gold }}
                  textStyle={{ color: "#fff" }}
                />
              )}
              {member.status === "inactive" && (
                <Button 
                  label="🔄 Reactivate" 
                  onPress={() => handleReactivateMember(member)} 
                  fullWidth 
                  variant="success" 
                />
              )}
              <Button label="✏️ Edit Member" onPress={() => { onClose(); openEditMember(member); }} fullWidth variant="secondary" />
              {!stats.totalContributions && !contributions.some(c => c.memberId === member.id) && (
                <Button label="🗑 Delete Member" onPress={() => handleDeleteMember(member)} fullWidth variant="danger" />
              )}
            </View>
          )}
        </View>
      </BottomModal>
    );
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, isWide && styles.headerWide]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Group Settings</Text>
            {group?.name && <Text style={styles.headerSub}>{group.name}</Text>}
          </View>
        </View>

        <View style={styles.headerRight}>
          {activeSection === "settings" && (
            <TouchableOpacity onPress={handleSave} disabled={saving} style={[styles.headerBtn, styles.headerBtnPrimary]}>
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.headerBtnPrimaryText}>Save</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ─── Tab Bar - Scrollable ─── */}
      <View style={styles.tabWrapper}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.tabBar, isWide && styles.tabBarWide]}
        >
          {SETTINGS_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeSection === tab.key && styles.tabActive]}
              onPress={() => setActiveSection(tab.key as any)}
            >
              <View style={styles.tabContent}>
                <Text style={[styles.tabText, activeSection === tab.key && styles.tabTextActive]}>
                  {tab.label}
                </Text>
                {tab.key === "audit" && allAuditLogs.length > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {allAuditLogs.length > 99 ? "99+" : allAuditLogs.length}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ─── SETTINGS SECTION ────────────────────────────────────────────── */}
      {activeSection === "settings" && (
        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={[styles.body, isWide && styles.bodyWide]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
        >
          {/* Group Card */}
          <View style={styles.groupCard}>
            <View style={styles.groupAvatar}>
              <Text style={styles.groupAvatarLetter}>{(group?.name ?? "S").charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.groupName}>{group?.name ?? "SCDT Savings Group"}</Text>
              {group?.description && <Text style={styles.groupDesc}>{group.description}</Text>}
              <Text style={styles.groupMeta}>ID: {group?.id?.slice(0, 12)}… · {group?.memberCount || 0} members</Text>
            </View>
          </View>

          {/* Two-column layout - stacks on mobile */}
          <View style={isWide ? styles.wideGrid : undefined}>

            {/* ── LEFT COLUMN ── */}
            <View style={isWide ? styles.wideCol : undefined}>
              {/* Currency & Contributions */}
              <SectionHeading 
                label="Currency & Contributions" 
                description="Set the group's currency and the standard contribution amount per member." 
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
                  Each member contributes {fmtCurrency(contribAmountNum)} {freq === "monthly" ? "per month" : freq === "weekly" ? "per week" : freq === "biweekly" ? "every two weeks" : "per year"}
                </Text>
              </SettingCard>

              {/* Contribution Goal */}
              <SectionHeading 
                label="Contribution Goal" 
                description="A savings target each member should reach every N months. Optional." 
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

            {/* ── RIGHT COLUMN ── */}
            <View style={isWide ? styles.wideCol : undefined}>
              {/* Meeting Penalties */}
              <SectionHeading 
                label="Meeting Penalties" 
                description="Penalties applied for meeting lateness or absence." 
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
              <SectionHeading label="Account" />
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
          {/* Simple Summary Row - No KPI Cards */}
          <View style={memberStyles.summaryRow}>
            <View style={memberStyles.summaryItem}>
              <Text style={memberStyles.summaryVal}>{memberStats.total}</Text>
              <Text style={memberStyles.summaryLbl}>Total</Text>
            </View>
            <View style={memberStyles.summaryDivider} />
            <View style={memberStyles.summaryItem}>
              <Text style={[memberStyles.summaryVal, { color: C.success }]}>{memberStats.active}</Text>
              <Text style={memberStyles.summaryLbl}>Active</Text>
            </View>
            <View style={memberStyles.summaryDivider} />
            <View style={memberStyles.summaryItem}>
              <Text style={[memberStyles.summaryVal, { color: C.gold }]}>{memberStats.pending}</Text>
              <Text style={memberStyles.summaryLbl}>Pending</Text>
            </View>
            <View style={memberStyles.summaryDivider} />
            <View style={memberStyles.summaryItem}>
              <Text style={[memberStyles.summaryVal, { color: C.error }]}>{memberStats.inactive}</Text>
              <Text style={memberStyles.summaryLbl}>Inactive</Text>
            </View>
          </View>

          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <TouchableOpacity style={styles.addMemberBtn} onPress={() => setShowCreateMember(true)} activeOpacity={0.8}>
              <Text style={styles.addMemberBtnText}>+ Add New Member</Text>
            </TouchableOpacity>
          </View>

          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <SearchBar value={memberSearch} onChange={setMemberSearch} placeholder="Search members..." />
            <TabRow tabs={["All", "Active", "Pending", "Inactive"]} active={memberTab} onChange={setMemberTab} />
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
              <Card>
                {filteredMembers.map((m, i) => {
                  const stats = getMemberStats(m, wallet, contributions);
                  const isMe = m.userId === currentMember?.userId;
                  return (
                    <React.Fragment key={m.id}>
                      <CardRow
                        onPress={() => openMemberDetail(m)}
                        left={<Avatar name={m.fullName} size={44} color={ROLE_BADGE[m.role] ?? "teal"} />}
                        title={`${m.fullName}${isMe ? " (You)" : ""}`}
                        subtitle={`${stats.totalContributions > 0 ? fmtCurrency(stats.totalContributions) : "No contributions"}`}
                        right={
                          <View style={{ alignItems: "flex-end", gap: 4 }}>
                            <View style={{ flexDirection: "row", gap: 4 }}>
                              <Badge label={ROLE_LABELS[m.role] || m.role} color={ROLE_BADGE[m.role] || "teal"} />
                              <Badge label={m.status} color={STATUS_BADGE[m.status] || "muted"} />
                            </View>
                          </View>
                        }
                        showBorder={i < filteredMembers.length - 1}
                      />
                    </React.Fragment>
                  );
                })}
              </Card>
            )}
          </ScrollView>
        </View>
      )}

      {/* ─── PERMISSIONS SECTION ─────────────────────────────────────────── */}
      {activeSection === "permissions" && (
        <View style={styles.contentScroll}>
          <View style={permStyles.searchContainer}>
            <View style={permStyles.searchBox}>
              <Text style={permStyles.searchIcon}>🔍</Text>
              <TextInput
                style={permStyles.searchInput}
                placeholder="Search members..."
                placeholderTextColor={C.text3}
                value={permSearch}
                onChangeText={setPermSearch}
                clearButtonMode="while-editing"
              />
            </View>
            <Text style={permStyles.searchHint}>Tap a member to manage their permissions. Admins always have full access.</Text>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
          >
            {(() => {
              const filtered = activeMembers.filter(m =>
                m.fullName.toLowerCase().includes(permSearch.toLowerCase()) ||
                m.role.toLowerCase().includes(permSearch.toLowerCase())
              );
              if (filtered.length === 0) return (
                <View style={{ alignItems: "center", paddingVertical: 40 }}>
                  <Text style={{ fontSize: 32 }}>👥</Text>
                  <Text style={{ fontSize: 14, color: C.text3, marginTop: 8 }}>
                    {permSearch ? "No members match your search" : "No active non-admin members"}
                  </Text>
                </View>
              );

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

              return filtered.map((member) => {
                const perms = getMemberPerms(member);
                const isDirty = !!pendingPerms[member.id];
                const isSaving = permSaving === member.id;
                const isExpanded = expandedMemberId === member.id;
                const enabledCount = PERM_KEYS.filter(k => perms[k]).length;

                return (
                  <View key={member.id} style={permStyles.memberCard}>
                    <TouchableOpacity
                      style={permStyles.memberHeader}
                      onPress={() => setExpandedMemberId(isExpanded ? null : member.id)}
                      activeOpacity={0.7}
                    >
                      <View style={permStyles.memberAvatar}>
                        <Text style={permStyles.memberAvatarText}>
                          {member.fullName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={permStyles.memberName}>{member.fullName}</Text>
                        <Text style={permStyles.memberRole}>
                          {member.role.replace(/_/g, " ")} · {enabledCount}/{PERM_KEYS.length} permissions
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {isDirty && (
                          <TouchableOpacity
                            style={[permStyles.saveBtn, isSaving && permStyles.saveBtnDisabled]}
                            onPress={() => savePermissions(member)}
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

                    {isExpanded && (
                      <View style={permStyles.permGrid}>
                        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                          <TouchableOpacity
                            style={permStyles.quickBtn}
                            onPress={() => {
                              const all: Record<string, boolean> = {};
                              PERM_KEYS.forEach(k => { all[k] = true; });
                              setPendingPerms(prev => ({ ...prev, [member.id]: all as any }));
                            }}
                          >
                            <Text style={permStyles.quickBtnText}>✔ Grant All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[permStyles.quickBtn, permStyles.quickBtnDanger]}
                            onPress={() => {
                              const none: Record<string, boolean> = {};
                              PERM_KEYS.forEach(k => { none[k] = false; });
                              setPendingPerms(prev => ({ ...prev, [member.id]: none as any }));
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
                                    onPress={() => togglePerm(member.id, key, perms)}
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
                      </View>
                    )}
                  </View>
                );
              });
            })()}
          </ScrollView>
        </View>
      )}

      {/* ─── AUDIT SECTION ────────────────────────────────────────────────── */}
      {activeSection === "audit" && (
        <View style={styles.contentScroll}>
          {/* Toolbar */}
          <View style={auditStyles.toolbar}>
            <Text style={auditStyles.count}>
              {filteredLogs.length.toLocaleString()} record{filteredLogs.length !== 1 ? "s" : ""}
              {hasFilters ? " (filtered)" : ""}
            </Text>
            <View style={auditStyles.toolbarRight}>
              <View style={auditStyles.searchBox}>
                <Text style={auditStyles.searchIcon}>🔍</Text>
                <TextInput
                  style={auditStyles.searchInput}
                  placeholder="Search logs…"
                  placeholderTextColor={C.text3}
                  value={searchTerm}
                  onChangeText={(v) => { setSearchTerm(v); setCurrentPage(1); }}
                />
                {!!searchTerm && (
                  <TouchableOpacity onPress={() => { setSearchTerm(""); setCurrentPage(1); }}>
                    <Text style={auditStyles.clearSearch}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Category tabs - compact pill style */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={auditStyles.tabScroll}>
                <View style={auditStyles.tabRow}>
                  {AUDIT_TABS.map((tab) => {
                    const isActive = activeTab === tab.key;
                    const count = tab.key === "all" ? allAuditLogs.length : 
                                  tab.key === "failed" ? allAuditLogs.filter(l => l.action === "failed" || l.status === "failed").length :
                                  tab.key === "deletions" ? allAuditLogs.filter(l => l.action === "deleted").length :
                                  allAuditLogs.filter(l => l.entityType === (AUDIT_TAB_ENTITY as any)[tab.key]).length;
                    return (
                      <TouchableOpacity
                        key={tab.key}
                        style={[auditStyles.tab, isActive && auditStyles.tabActive]}
                        onPress={() => { setActiveTab(tab.key); setCurrentPage(1); }}
                      >
                        <Text style={auditStyles.tabIcon}>{tab.icon}</Text>
                        <Text style={[auditStyles.tabLabel, isActive && auditStyles.tabLabelActive]}>{tab.label}</Text>
                        <View style={[auditStyles.tabCount, isActive && auditStyles.tabCountActive]}>
                          <Text style={[auditStyles.tabCountText, isActive && auditStyles.tabCountTextActive]}>{count}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <TouchableOpacity style={[auditStyles.filterBtn, hasFilters && auditStyles.filterBtnActive]} onPress={openFilter}>
                <Text style={[auditStyles.filterBtnText, hasFilters && auditStyles.filterBtnTextActive]}>
                  {hasFilters ? "📌 Filtered" : "📅 Filter"}
                </Text>
              </TouchableOpacity>
              {hasFilters && (
                <TouchableOpacity onPress={clearFilters}>
                  <Text style={auditStyles.clearFilters}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
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
                  // Desktop Table View
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
                  // Mobile Card View
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
          <Select
            items={ROLES}
            value={createForm.role}
            onChange={(r) => setCreateForm(p => ({ ...p, role: r }))}
            label="Role"
          />
          <Button
            label="Create User"
            onPress={handleCreateMember}
            loading={creatingMember}
            fullWidth
          />
        </View>
      </BottomModal>

      {/* Edit Member Modal */}
      <BottomModal visible={showEditMember} onClose={() => { setShowEditMember(false); setSelectedMember(null); }} title="Edit Member">
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
          <Select
            items={ROLES}
            value={editForm.role}
            onChange={(r) => setEditForm(p => ({ ...p, role: r }))}
            label="Role"
          />
          <Button
            label="Save Changes"
            onPress={handleSaveEditMember}
            loading={savingMember}
            fullWidth
          />
        </View>
      </BottomModal>

      {/* Member Detail Modal */}
      {selectedMember && (
        <MemberDetailModal
          member={selectedMember}
          onClose={() => { setShowMemberDetail(false); setSelectedMember(null); }}
        />
      )}

      <Toast />
    </View>
  );
}

// ─────────────────────────────────────────────
// Detail Styles
// ─────────────────────────────────────────────
const detailStyles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 20, fontWeight: "800", color: "#fff" },
  name: { fontSize: 18, fontWeight: "800", color: C.text },
});

// ─────────────────────────────────────────────
// Main Styles
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 48 : 20,
    paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerWide: { paddingHorizontal: 32, paddingTop: Platform.OS === "ios" ? 56 : 36 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: C.elevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  backBtnText: { fontSize: 16, color: C.text2, fontWeight: "500", lineHeight: 20 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: C.text },
  headerSub: { fontSize: 12, color: C.text3, marginTop: 1 },
  headerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
  },
  headerBtnPrimary: { backgroundColor: C.primary, borderColor: C.primary },
  headerBtnPrimaryText: { fontSize: 12, fontWeight: "700", color: "#fff" },

  // ─── Tab Bar - Scrollable ───
  tabWrapper: {
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 4,
  },
  tabBarWide: {
    paddingHorizontal: 32,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "transparent",
    flexShrink: 0,
  },
  tabActive: {
    backgroundColor: C.primary + "12",
    borderColor: C.primary + "30",
  },
  tabContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text3,
    whiteSpace: "nowrap",
  },
  tabTextActive: {
    color: C.primary,
  },
  tabBadge: {
    backgroundColor: C.primary + "25",
    borderRadius: 10,
    paddingHorizontal: 6,
    minWidth: 20,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: C.primary,
  },

  // ─── Content Scroll ───
  contentScroll: { flex: 1 },
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

  // Group Card
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

  // Grid
  wideGrid: { flexDirection: "row", gap: 20, alignItems: "flex-start" },
  wideCol: { flex: 1 },
  wideSaveRow: { marginTop: 16, alignItems: "flex-start" },

  // Form
  row: { flexDirection: "row", gap: 8 },
  fieldHint: { fontSize: 10, color: C.text3, marginTop: 3, paddingHorizontal: 4 },
  penaltyNote: { fontSize: 12, color: C.text3, marginBottom: 10, lineHeight: 17 },
  subLabel: { fontSize: 11, fontWeight: "700", color: C.text2, marginTop: 4, marginBottom: 6 },
  goalPreview: { fontSize: 11, color: C.primary, fontWeight: "600", marginTop: 6 },

  // Toggle
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  toggleLabel: { fontSize: 13, fontWeight: "600", color: C.text },
  toggleHint: { fontSize: 11, color: C.text3, marginTop: 2 },

  // Action Row
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

  // Add Member
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
});

// ─────────────────────────────────────────────
// Permission Styles
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
  searchHint: { fontSize: 11, color: C.text3, marginTop: 4 },
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
});

// ─────────────────────────────────────────────
// Audit Styles
// ─────────────────────────────────────────────
const auditStyles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexWrap: "wrap",
    gap: 6,
  },
  count: { fontSize: 12, fontWeight: "600", color: C.text2 },
  toolbarRight: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  searchIcon: { fontSize: 12, color: C.text3, marginRight: 4 },
  searchInput: { flex: 1, fontSize: 12, color: C.text, minHeight: 16, width: 80 },
  clearSearch: { color: C.text3, fontSize: 12, paddingHorizontal: 4 },
  tabScroll: { maxWidth: "100%" as any },
  tabRow: { flexDirection: "row", gap: 3 },
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