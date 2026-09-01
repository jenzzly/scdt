// app/group-settings.tsx - REDESIGNED
import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator, RefreshControl, Modal, useWindowDimensions, Switch, TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { useStore, useActiveGroup, useGroupAuditLogs } from "../stores/useStore";
import { useGroupMembers } from "../stores/selectors";
import { useAuth } from "../hooks/useAuth";
import { Input, Select, Button, useToast, Card, DatePicker } from "../components/ui";
import { Colors, C, T, fmtCurrency, fmtDate, showConfirm, round2 } from "../utils/theme";
import { exportFullData, importFullData } from "../utils/importExport";
import * as FS from "../lib/firestore";
import type { AuditLog, MemberPermissions, Member } from "../types";
import { DEFAULT_MEMBER_PERMISSIONS } from "../types";

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

// ─────────────────────────────────────────────
// Filter Modal
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={fm.container}>
        <View style={fm.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={fm.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={fm.title}>Filter Logs</Text>
          <TouchableOpacity onPress={onApply} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={fm.apply}>Apply</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={fm.body} showsVerticalScrollIndicator={false}>
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
        </ScrollView>
      </View>
    </Modal>
  );
}

const fm = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  cancel: { fontSize: 15, fontWeight: "500", color: C.text3 },
  title:  { fontSize: 16, fontWeight: "700", color: C.text  },
  apply:  { fontSize: 15, fontWeight: "700", color: C.primary },
  body:   { padding: 20 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: C.text2, marginTop: 20, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", gap: 10 },
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
  container: { marginTop: 20, marginBottom: 10 },
  label: {
    fontSize: 13, fontWeight: "700", color: C.text2,
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  description: {
    fontSize: 12, color: C.text3, marginTop: 4, lineHeight: 18,
  },
});

// ─────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────
function Divider() {
  return <View style={{ height: 1, backgroundColor: C.border, marginVertical: 12 }} />;
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
    borderRadius: 16,
    padding: 16,
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
  const { updateGroup, activeGroupId, reset } = useStore();
  const { signOut } = useAuth();
  const { show, Toast } = useToast();

  // ─── Settings Form State ────────────────────────────────────────────────
  const [currency, setCurrency] = useState(group?.currency ?? "RWF");
  const [contribAmount, setContribAmount] = useState(String(group?.contributionAmount ?? 40000));
  const [freq, setFreq] = useState(group?.contributionFrequency ?? "monthly");
  const [loanRate, setLoanRate] = useState(String(group?.loanInterestRate ?? 2));
  const [loanMethod, setLoanMethod] = useState(group?.loanInterestMethod ?? "flat");
  const [ratePeriod, setRatePeriod] = useState<"monthly" | "annual">(group?.loanInterestRatePeriod ?? "monthly");
  
  // Penalty rates
  const [lateRatePct, setLateRatePct] = useState(String(group?.latePenaltyRatePct ?? 5));
  const [absenceMemberPct, setAbsenceMemberPct] = useState(String(group?.absencePenaltyMemberRatePct ?? 10));
  const [absenceOfficerPct, setAbsenceOfficerPct] = useState(String(group?.absencePenaltyOfficerRatePct ?? 25));
  
  // Late payment fees
  const [contribLateFeePct, setContribLateFeePct] = useState(String(group?.contributionLateFeeRatePct ?? 5));
  const [contribLateFeeGrace, setContribLateFeeGrace] = useState(String(group?.contributionLateFeeGraceDays ?? 3));
  const [contribLateFeeStart, setContribLateFeeStart] = useState(group?.contributionLateFeeStartDate ?? "");
  const [loanLateFeePct, setLoanLateFeePct] = useState(String(group?.loanLateFeeRatePct ?? 5));
  const [loanLateFeeGrace, setLoanLateFeeGrace] = useState(String(group?.loanLateFeeGraceDays ?? 3));
  
  // Contribution goal
  const [goalEnabled, setGoalEnabled] = useState(!!(group?.contributionGoalPeriodMonths && group?.contributionGoalTargetAmount && group?.contributionGoalAnchorDate));
  const [goalPeriodMonths, setGoalPeriodMonths] = useState(String(group?.contributionGoalPeriodMonths ?? 6));
  const [goalTarget, setGoalTarget] = useState(String(group?.contributionGoalTargetAmount ?? 600000));
  const [goalAnchorDate, setGoalAnchorDate] = useState(group?.contributionGoalAnchorDate ?? "");
  
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ─── Audit State ─────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<"settings" | "permissions" | "audit">("settings");
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
    // Date filtering
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
    // Search filtering
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

    // Validation
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

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, isWide && s.headerWide]}>
        <View style={s.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.backBtnText}>←</Text>
          </TouchableOpacity>
          <View>
            <Text style={s.headerTitle}>Group Settings</Text>
            {group?.name && <Text style={s.headerSub}>{group.name}</Text>}
          </View>
        </View>

        <View style={s.headerRight}>
          {activeSection === "settings" ? (
            <TouchableOpacity onPress={handleSave} disabled={saving} style={[s.headerBtn, s.headerBtnPrimary]}>
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.headerBtnPrimaryText}>Save Changes</Text>}
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>
      </View>

      {/* Section Toggle - Modern Pill Style */}
      <View style={[s.segmentBar, isWide && s.segmentBarWide]}>
        {(["settings", "permissions", "audit"] as const).map((sec) => (
          <TouchableOpacity
            key={sec}
            style={[s.segment, activeSection === sec && s.segmentActive]}
            onPress={() => setActiveSection(sec as any)}
          >
            <Text style={[s.segmentText, activeSection === sec && s.segmentTextActive]}>
              {sec === "settings" ? "⚙️ Settings" : sec === "permissions" ? "🔐 Permissions" : "📋 Audit Log"}
            </Text>
            {sec === "audit" && allAuditLogs.length > 0 && (
              <View style={s.segmentBadge}>
                <Text style={s.segmentBadgeText}>{allAuditLogs.length > 99 ? "99+" : allAuditLogs.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* ─── SETTINGS SECTION ────────────────────────────────────────────── */}
      {activeSection === "settings" && (
        <ScrollView
          contentContainerStyle={[s.body, isWide && s.bodyWide]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
        >
          {/* Group Card */}
          <View style={s.groupCard}>
            <View style={s.groupAvatar}>
              <Text style={s.groupAvatarLetter}>{(group?.name ?? "S").charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.groupName}>{group?.name ?? "SCDT Savings Group"}</Text>
              {group?.description && <Text style={s.groupDesc}>{group.description}</Text>}
              <Text style={s.groupMeta}>ID: {group?.id?.slice(0, 12)}… · {group?.memberCount || 0} members</Text>
            </View>
          </View>

          {/* Two-column layout */}
          <View style={isWide ? s.wideGrid : undefined}>

            {/* ── LEFT COLUMN ── */}
            <View style={isWide ? s.wideCol : undefined}>
              <SectionHeading 
                label="Currency & Contributions" 
                description="Set the group's currency and the standard contribution amount per member." 
              />
              <SettingCard>
                <Select label="Currency" value={currency} options={CURRENCIES} onChange={setCurrency} />
                <Divider />
                <View style={s.row}>
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
                <Text style={s.fieldHint}>
                  Each member contributes {fmtCurrency(contribAmountNum)} {freq === "monthly" ? "per month" : freq === "weekly" ? "per week" : freq === "biweekly" ? "every two weeks" : "per year"}
                </Text>
              </SettingCard>

              <SectionHeading 
                label="Contribution Goal" 
                description="A savings target each member should reach every N months. Optional." 
              />
              <SettingCard>
                <View style={s.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.toggleLabel}>Enable contribution goal</Text>
                    <Text style={s.toggleHint}>Track progress toward a periodic target per member</Text>
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
                    <View style={s.row}>
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
                      <Text style={s.goalPreview}>
                        {fmtCurrency(parseFloat(goalTarget) || 0)} every {goalPeriodMonths} month{goalPeriodMonths === "1" ? "" : "s"}
                        {parseFloat(goalPeriodMonths) > 0 && ` — ≈ ${Math.floor(12 / parseFloat(goalPeriodMonths))} period${Math.floor(12 / parseFloat(goalPeriodMonths)) === 1 ? "" : "s"} per year`}
                      </Text>
                    )}
                  </>
                )}
              </SettingCard>

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
                <View style={s.row}>
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
                <Text style={s.fieldHint}>
                  {ratePeriod === "annual"
                    ? `${loanRate || "0"}% per year ≈ ${round2((parseFloat(loanRate) || 0) / 12)}% per month`
                    : `${loanRate || "0"}% per month ≈ ${round2((parseFloat(loanRate) || 0) * 12)}% per year`}
                  {' — '}
                  {loanMethod === "reducing_balance" ? "Calculated on outstanding balance" : "Calculated on original amount"}
                </Text>
              </SettingCard>
            </View>

            {/* ── RIGHT COLUMN ── */}
            <View style={isWide ? s.wideCol : undefined}>
              <SectionHeading 
                label="Meeting Penalties" 
                description="Penalties applied for meeting lateness or absence." 
              />
              <SettingCard>
                <Text style={s.penaltyNote}>
                  Penalties are calculated as a percentage of the contribution amount ({fmtCurrency(contribAmountNum)})
                </Text>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Late arrival (% per 15min)"
                      value={lateRatePct}
                      onChangeText={setLateRatePct}
                      keyboardType="numeric"
                    />
                    <Text style={s.fieldHint}>≈ {fmtCurrency(round2(contribAmountNum * (parseFloat(lateRatePct) || 0) / 100))} per 15min late</Text>
                  </View>
                </View>
                <Divider />
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Absence — member (%)"
                      value={absenceMemberPct}
                      onChangeText={setAbsenceMemberPct}
                      keyboardType="numeric"
                    />
                    <Text style={s.fieldHint}>≈ {fmtCurrency(round2(contribAmountNum * (parseFloat(absenceMemberPct) || 0) / 100))}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Absence — officer (%)"
                      value={absenceOfficerPct}
                      onChangeText={setAbsenceOfficerPct}
                      keyboardType="numeric"
                    />
                    <Text style={s.fieldHint}>≈ {fmtCurrency(round2(contribAmountNum * (parseFloat(absenceOfficerPct) || 0) / 100))}</Text>
                  </View>
                </View>
              </SettingCard>

              <SectionHeading 
                label="Late Payment Fees" 
                description="Fees applied to overdue contributions or loan repayments." 
              />
              <SettingCard>
                <Text style={s.penaltyNote}>
                  Fees are calculated on the amount due, not a flat figure. Grace periods apply.
                </Text>

                <Text style={s.subLabel}>Contributions</Text>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Fee rate (%)"
                      value={contribLateFeePct}
                      onChangeText={setContribLateFeePct}
                      keyboardType="numeric"
                    />
                    <Text style={s.fieldHint}>≈ {fmtCurrency(round2(contribAmountNum * (parseFloat(contribLateFeePct) || 0) / 100))} per missed contribution</Text>
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

                <Text style={s.subLabel}>Loan Repayments</Text>
                <View style={s.row}>
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

              <SectionHeading 
                label="Data Management" 
                description="Export or import your group data as a backup." 
              />
              <SettingCard>
                <TouchableOpacity style={s.actionRow} onPress={handleExport} activeOpacity={0.7}>
                  <View style={s.actionIcon}>
                    <Text style={s.actionIconText}>📤</Text>
                  </View>
                  <View style={s.actionInfo}>
                    <Text style={s.actionTitle}>Export backup</Text>
                    <Text style={s.actionDesc}>Download full group data as JSON</Text>
                  </View>
                  <Text style={[s.actionCta, { color: C.primary }]}>Export</Text>
                </TouchableOpacity>
                <Divider />
                <TouchableOpacity style={s.actionRow} onPress={handleImport} activeOpacity={0.7}>
                  <View style={s.actionIcon}>
                    <Text style={s.actionIconText}>📥</Text>
                  </View>
                  <View style={s.actionInfo}>
                    <Text style={s.actionTitle}>Import backup</Text>
                    <Text style={s.actionDesc}>Restore from a JSON backup file</Text>
                  </View>
                  <Text style={[s.actionCta, { color: "#d97706" }]}>Import</Text>
                </TouchableOpacity>
              </SettingCard>

              <SectionHeading label="Account" />
              <SettingCard>
                <TouchableOpacity style={s.actionRow} onPress={handleSignOut} activeOpacity={0.7}>
                  <View style={[s.actionIcon, s.actionIconDanger]}>
                    <Text style={s.actionIconText}>🚪</Text>
                  </View>
                  <View style={s.actionInfo}>
                    <Text style={[s.actionTitle, { color: C.error }]}>Sign out</Text>
                    <Text style={s.actionDesc}>You will be returned to the welcome screen</Text>
                  </View>
                  <Text style={[s.actionCta, { color: C.error }]}>Sign out</Text>
                </TouchableOpacity>
              </SettingCard>
            </View>
          </View>

          {/* Save Button */}
          {!isWide && (
            <Button label="Save Settings" onPress={handleSave} fullWidth loading={saving} size="lg" style={{ marginTop: 24 }} />
          )}
          {isWide && (
            <View style={s.wideSaveRow}>
              <Button label="Save Settings" onPress={handleSave} loading={saving} size="lg" />
            </View>
          )}
        </ScrollView>
      )}

      {/* ─── PERMISSIONS SECTION ─────────────────────────────────────────── */}
      {activeSection === "permissions" && (
        <View style={{ flex: 1 }}>
          <View style={ps.searchContainer}>
            <View style={ps.searchBox}>
              <Text style={ps.searchIcon}>🔍</Text>
              <TextInput
                style={ps.searchInput}
                placeholder="Search members..."
                placeholderTextColor={C.text3}
                value={permSearch}
                onChangeText={setPermSearch}
                clearButtonMode="while-editing"
              />
            </View>
            <Text style={ps.searchHint}>Tap a member to manage their permissions. Admins always have full access.</Text>
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
                  <View key={member.id} style={ps.memberCard}>
                    <TouchableOpacity
                      style={ps.memberHeader}
                      onPress={() => setExpandedMemberId(isExpanded ? null : member.id)}
                      activeOpacity={0.7}
                    >
                      <View style={ps.memberAvatar}>
                        <Text style={ps.memberAvatarText}>
                          {member.fullName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={ps.memberName}>{member.fullName}</Text>
                        <Text style={ps.memberRole}>
                          {member.role.replace(/_/g, " ")} · {enabledCount}/{PERM_KEYS.length} permissions
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {isDirty && (
                          <TouchableOpacity
                            style={[ps.saveBtn, isSaving && ps.saveBtnDisabled]}
                            onPress={() => savePermissions(member)}
                            disabled={isSaving}
                          >
                            {isSaving
                              ? <ActivityIndicator size="small" color="#fff" />
                              : <Text style={ps.saveBtnText}>Save</Text>}
                          </TouchableOpacity>
                        )}
                        <Text style={{ fontSize: 18, color: C.text3 }}>{isExpanded ? "▲" : "▼"}</Text>
                      </View>
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={ps.permGrid}>
                        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                          <TouchableOpacity
                            style={ps.quickBtn}
                            onPress={() => {
                              const all: Record<string, boolean> = {};
                              PERM_KEYS.forEach(k => { all[k] = true; });
                              setPendingPerms(prev => ({ ...prev, [member.id]: all as any }));
                            }}
                          >
                            <Text style={ps.quickBtnText}>✔ Grant All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[ps.quickBtn, ps.quickBtnDanger]}
                            onPress={() => {
                              const none: Record<string, boolean> = {};
                              PERM_KEYS.forEach(k => { none[k] = false; });
                              setPendingPerms(prev => ({ ...prev, [member.id]: none as any }));
                            }}
                          >
                            <Text style={[ps.quickBtnText, { color: C.error }]}>✕ Revoke All</Text>
                          </TouchableOpacity>
                        </View>

                        {PERM_GROUPS.map((group) => (
                          <View key={group.label} style={{ marginBottom: 10 }}>
                            <Text style={ps.permGroupLabel}>{group.label}</Text>
                            <View style={{ gap: 4 }}>
                              {group.keys.map((key) => {
                                const isEnabled = !!perms[key];
                                return (
                                  <TouchableOpacity
                                    key={key}
                                    style={[ps.permRow, isEnabled && ps.permRowActive]}
                                    onPress={() => togglePerm(member.id, key, perms)}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={[ps.permLabel, isEnabled && { color: C.primary, fontWeight: "700" }]}>
                                      {PERM_LABELS[key]}
                                    </Text>
                                    <View style={[ps.togglePill, isEnabled && ps.togglePillActive]}>
                                      <Text style={[ps.toggleText, isEnabled && ps.toggleTextActive]}>
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
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          {/* Toolbar */}
          <View style={at.toolbar}>
            <Text style={at.count}>
              {filteredLogs.length.toLocaleString()} record{filteredLogs.length !== 1 ? "s" : ""}
              {hasFilters ? " (filtered)" : ""}
            </Text>
            <View style={at.toolbarRight}>
              <View style={at.searchBox}>
                <Text style={at.searchIcon}>🔍</Text>
                <TextInput
                  style={at.searchInput}
                  placeholder="Search logs…"
                  placeholderTextColor={C.text3}
                  value={searchTerm}
                  onChangeText={(v) => { setSearchTerm(v); setCurrentPage(1); }}
                />
                {!!searchTerm && (
                  <TouchableOpacity onPress={() => { setSearchTerm(""); setCurrentPage(1); }}>
                    <Text style={at.clearSearch}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Category tabs - compact pill style */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={at.tabScroll}>
                <View style={at.tabRow}>
                  {AUDIT_TABS.map((tab) => {
                    const isActive = activeTab === tab.key;
                    const count = tab.key === "all" ? allAuditLogs.length : 
                                  tab.key === "failed" ? allAuditLogs.filter(l => l.action === "failed" || l.status === "failed").length :
                                  tab.key === "deletions" ? allAuditLogs.filter(l => l.action === "deleted").length :
                                  allAuditLogs.filter(l => l.entityType === (AUDIT_TAB_ENTITY as any)[tab.key]).length;
                    return (
                      <TouchableOpacity
                        key={tab.key}
                        style={[at.tab, isActive && at.tabActive]}
                        onPress={() => { setActiveTab(tab.key); setCurrentPage(1); }}
                      >
                        <Text style={at.tabIcon}>{tab.icon}</Text>
                        <Text style={[at.tabLabel, isActive && at.tabLabelActive]}>{tab.label}</Text>
                        <View style={[at.tabCount, isActive && at.tabCountActive]}>
                          <Text style={[at.tabCountText, isActive && at.tabCountTextActive]}>{count}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <TouchableOpacity style={[at.filterBtn, hasFilters && at.filterBtnActive]} onPress={openFilter}>
                <Text style={[at.filterBtnText, hasFilters && at.filterBtnTextActive]}>
                  {hasFilters ? "📌 Filtered" : "📅 Filter"}
                </Text>
              </TouchableOpacity>
              {hasFilters && (
                <TouchableOpacity onPress={clearFilters}>
                  <Text style={at.clearFilters}>Clear</Text>
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
              <View style={at.empty}>
                <Text style={at.emptyIcon}>📋</Text>
                <Text style={at.emptyTitle}>No records found</Text>
                <Text style={at.emptyDesc}>
                  {hasFilters
                    ? "No logs match your current filters. Try adjusting or clearing them."
                    : "Activity in this group will appear here as an audit trail."}
                </Text>
              </View>
            ) : (
              <>
                {isWide ? (
                  // Desktop Table View
                  <View style={at.table}>
                    <View style={at.tableHead}>
                      <Text style={[at.th, { width: 170 }]}>Timestamp</Text>
                      <Text style={[at.th, { width: 120 }]}>Category</Text>
                      <Text style={[at.th, { width: 100 }]}>Action</Text>
                      <Text style={[at.th, { width: 130 }]}>User</Text>
                      <Text style={[at.th, { flex: 1 }]}>Details</Text>
                      <Text style={[at.th, { width: 80, textAlign: "right" }]}>Revert</Text>
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

      <FilterModal
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        year={tempYear} month={tempMonth} day={tempDay}
        onYearChange={setTempYear} onMonthChange={setTempMonth} onDayChange={setTempDay}
        searchTerm={tempSearch} onSearchChange={setTempSearch}
        onApply={applyFilters}
      />

      <Toast />
    </View>
  );
}

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
        <Text style={[atr.cell, { width: 170 }]} numberOfLines={1}>{tsStr}</Text>
        <Text style={[atr.cell, { width: 120 }]} numberOfLines={1}>{entityLabel(log.entityType)}</Text>
        <View style={{ width: 100 }}>
          <View style={[atr.badge, { backgroundColor: cfg.bg }]}>
            <Text style={[atr.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
          </View>
        </View>
        <Text style={[atr.cell, { width: 130 }]} numberOfLines={1}>{log.userName ?? "—"}</Text>
        <Text style={[atr.cell, { flex: 1 }]} numberOfLines={1}>{log.reason || `${entityLabel(log.entityType)} ${log.action}`}</Text>
        <View style={{ width: 80, alignItems: "flex-end" }}>
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

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: 14,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerWide: { paddingHorizontal: 32 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: C.elevated,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border,
  },
  backBtnText: { fontSize: 16, color: C.text2, fontWeight: "500", lineHeight: 20 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: C.text },
  headerSub: { fontSize: 13, color: C.text3, marginTop: 1 },
  headerBtn: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.elevated,
  },
  headerBtnPrimary: { backgroundColor: C.primary, borderColor: C.primary },
  headerBtnPrimaryText: { fontSize: 13, fontWeight: "700", color: "#fff" },

  // Segment Bar
  segmentBar: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 20, paddingVertical: 4,
    gap: 4,
  },
  segmentBarWide: { paddingHorizontal: 32 },
  segment: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  segmentActive: { backgroundColor: C.primary + "12" },
  segmentText: { fontSize: 13, fontWeight: "600", color: C.text3 },
  segmentTextActive: { color: C.primary },
  segmentBadge: {
    backgroundColor: C.primary + "25",
    borderRadius: 10,
    paddingHorizontal: 6, minWidth: 20, height: 18, alignItems: "center", justifyContent: "center",
  },
  segmentBadgeText: { fontSize: 10, fontWeight: "700", color: C.primary },

  // Body
  body: { padding: 20, paddingBottom: 60, maxWidth: 900, alignSelf: "center", width: "100%" as any },
  bodyWide: { paddingHorizontal: 32, paddingTop: 24 },

  // Group Card
  groupCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 16, padding: 20, marginBottom: 4,
  },
  groupAvatar: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: "center", justifyContent: "center",
  },
  groupAvatarLetter: { fontSize: 20, fontWeight: "800", color: "#fff" },
  groupName: { fontSize: 16, fontWeight: "700", color: C.text },
  groupDesc: { fontSize: 13, color: C.text3, marginTop: 2 },
  groupMeta: { fontSize: 11, color: C.text3, marginTop: 4 },

  // Grid
  wideGrid: { flexDirection: "row", gap: 24, alignItems: "flex-start" },
  wideCol: { flex: 1 },
  wideSaveRow: { marginTop: 16, alignItems: "flex-start" },

  // Form
  row: { flexDirection: "row", gap: 10 },
  fieldHint: { fontSize: 11, color: C.text3, marginTop: 4, paddingHorizontal: 4 },
  penaltyNote: { fontSize: 13, color: C.text3, marginBottom: 12, lineHeight: 18 },
  subLabel: { fontSize: 12, fontWeight: "700", color: C.text2, marginTop: 4, marginBottom: 8 },
  goalPreview: { fontSize: 12, color: C.primary, fontWeight: "600", marginTop: 8 },

  // Toggle
  toggleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 4,
  },
  toggleLabel: { fontSize: 14, fontWeight: "600", color: C.text },
  toggleHint: { fontSize: 12, color: C.text3, marginTop: 2 },

  // Action Row
  actionRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 8, gap: 12,
  },
  actionIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.elevated,
    alignItems: "center", justifyContent: "center",
  },
  actionIconDanger: { backgroundColor: "rgba(220,38,38,0.08)" },
  actionIconText: { fontSize: 16 },
  actionInfo: { flex: 1 },
  actionTitle: { fontSize: 14, fontWeight: "600", color: C.text },
  actionDesc: { fontSize: 12, color: C.text3, marginTop: 1 },
  actionCta: { fontSize: 13, fontWeight: "700" },
});

// ─────────────────────────────────────────────
// Permission Styles
// ─────────────────────────────────────────────
const ps = StyleSheet.create({
  searchContainer: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  searchBox: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.elevated, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, minHeight: 20 },
  searchHint: { fontSize: 12, color: C.text3, marginTop: 6 },
  memberCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  memberHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    backgroundColor: C.elevated,
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.primary + "22",
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  memberAvatarText: { fontSize: 14, fontWeight: "700", color: C.primary },
  memberName: { fontSize: 15, fontWeight: "700", color: C.text },
  memberRole: { fontSize: 11, color: C.text3, marginTop: 1, textTransform: "capitalize" },
  permGrid: { padding: 12 },
  permRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, paddingHorizontal: 8,
    borderRadius: 8,
  },
  permRowActive: { backgroundColor: C.primary + "0a" },
  permLabel: { fontSize: 13, fontWeight: "500", color: C.text, flex: 1, paddingRight: 8 },
  permGroupLabel: {
    fontSize: 9, fontWeight: "800", color: C.text3, letterSpacing: 1.2,
    textTransform: "uppercase", paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4,
  },
  quickBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1,
    borderColor: C.primary + "40",
    backgroundColor: C.primary + "0a",
  },
  quickBtnDanger: { borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.06)" },
  quickBtnText: { fontSize: 11, fontWeight: "700", color: C.primary },
  togglePill: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: C.elevated,
    borderWidth: 1, borderColor: C.border,
    minWidth: 46, alignItems: "center",
  },
  togglePillActive: { backgroundColor: C.primary + "15", borderColor: C.primary },
  toggleText: { fontSize: 9, fontWeight: "800", color: C.text3, letterSpacing: 0.5 },
  toggleTextActive: { color: C.primary },
  saveBtn: {
    backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },
});

// ─────────────────────────────────────────────
// Audit Styles
// ─────────────────────────────────────────────
const at = StyleSheet.create({
  toolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
    flexWrap: "wrap", gap: 8,
  },
  count: { fontSize: 13, fontWeight: "600", color: C.text2 },
  toolbarRight: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  searchBox: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  searchIcon: { fontSize: 14, color: C.text3, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13, color: C.text, minHeight: 18, width: 120 },
  clearSearch: { color: C.text3, fontSize: 14, paddingHorizontal: 4 },
  tabScroll: { maxWidth: "100%" as any },
  tabRow: { flexDirection: "row", gap: 4 },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "transparent",
    borderWidth: 1, borderColor: "transparent",
  },
  tabActive: { backgroundColor: C.primary + "12", borderColor: C.primary + "30" },
  tabIcon: { fontSize: 12 },
  tabLabel: { fontSize: 11, fontWeight: "600", color: C.text3 },
  tabLabelActive: { color: C.primary },
  tabCount: {
    backgroundColor: C.elevated, borderRadius: 8,
    paddingHorizontal: 4, minWidth: 16, alignItems: "center",
  },
  tabCountActive: { backgroundColor: C.primary + "25" },
  tabCountText: { fontSize: 9, fontWeight: "700", color: C.text3 },
  tabCountTextActive: { color: C.primary },
  filterBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.bg,
  },
  filterBtnActive: { borderColor: C.primary, backgroundColor: C.primary + "10" },
  filterBtnText: { fontSize: 12, fontWeight: "600", color: C.text3 },
  filterBtnTextActive: { color: C.primary },
  clearFilters: { fontSize: 12, color: C.error, fontWeight: "600" },
  table: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: C.elevated,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  th: { fontSize: 10, fontWeight: "700", color: C.text3, textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 4 },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyIcon: { fontSize: 36, opacity: 0.5 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.text, marginTop: 12 },
  emptyDesc: { fontSize: 13, color: C.text3, textAlign: "center", marginTop: 6, paddingHorizontal: 20 },
});

// ─────────────────────────────────────────────
// Audit Row Styles
// ─────────────────────────────────────────────
const atr = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 10, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: C.borderLight,
    backgroundColor: C.surface,
  },
  rowExpanded: { backgroundColor: C.elevated },
  cell: { fontSize: 12, color: C.text2, paddingHorizontal: 4 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
  revert: { fontSize: 16, color: C.primary, fontWeight: "700" },
  expand: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.elevated },
  errorBox: { backgroundColor: "#fef2f2", borderRadius: 6, padding: 10, borderWidth: 1, borderColor: "#fecaca", marginBottom: 10 },
  errorLabel: { fontSize: 9, fontWeight: "800", color: "#dc2626", letterSpacing: 1, marginBottom: 3 },
  errorText: { fontSize: 11, color: "#b91c1c", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  diffRow: { flexDirection: "row", gap: 12 },
  diffBlock: { flex: 1, backgroundColor: C.surface, borderRadius: 6, padding: 10, borderWidth: 1, borderColor: C.border },
  diffLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4, marginBottom: 4, textTransform: "uppercase" },
  diffCode: { fontSize: 10, color: C.text2, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", lineHeight: 15 },
});

// ─────────────────────────────────────────────
// Audit Card Styles
// ─────────────────────────────────────────────
const atc = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 8,
  },
  header: { flexDirection: "row", alignItems: "flex-start" },
  topRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  category: { fontSize: 12, fontWeight: "700", color: C.text },
  detail: { fontSize: 12, color: C.text2, lineHeight: 17 },
  chevron: { fontSize: 12, color: C.text3, marginLeft: 8, paddingTop: 4 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  user: { fontSize: 11, color: C.text3 },
  time: { fontSize: 11, color: C.text3 },
  revertBtn: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.borderLight },
  revertText: { fontSize: 12, fontWeight: "600", color: C.primary },
  expand: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.borderLight },
});

// ─────────────────────────────────────────────
// Pagination Styles
// ─────────────────────────────────────────────
const pg = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 16 },
  btn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.elevated, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 13, fontWeight: "600", color: C.text },
  info: { fontSize: 13, color: C.text3 },
});