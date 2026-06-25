// app/group-settings.tsx
import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator, RefreshControl, Modal, useWindowDimensions, Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { useStore, useActiveGroup, useGroupAuditLogs } from "../stores/useStore";
import { useGroupMembers } from "../stores/selectors";
import { useAuth } from "../hooks/useAuth";
import { Input, Select, Button, useToast, Card } from "../components/ui";
import { Colors, C, T, fmtDate, showConfirm } from "../utils/theme";
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

type AuditTab = "all" | "contributions" | "loans" | "members" | "investments" | "deletions";

const AUDIT_TABS: { key: AuditTab; label: string }[] = [
  { key: "all",           label: "All"          },
  { key: "contributions", label: "Contributions" },
  { key: "loans",         label: "Loans"        },
  { key: "members",       label: "Members"      },
  { key: "investments",   label: "Investments"  },
  { key: "deletions",     label: "Deletions"    },
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

// Action badge config
const ACTION_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  created:  { bg: "#dbeafe", text: "#1d4ed8", label: "Created"  },
  approved: { bg: "#dcfce7", text: "#15803d", label: "Approved" },
  rejected: { bg: "#fee2e2", text: "#b91c1c", label: "Rejected" },
  deleted:  { bg: "#fee2e2", text: "#b91c1c", label: "Deleted"  },
  updated:  { bg: "#fef9c3", text: "#92400e", label: "Updated"  },
  disbursed:{ bg: "#f3e8ff", text: "#6b21a8", label: "Disbursed"},
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

function filterLogsByDate(
  logs: AuditLog[],
  year: number | null,
  month: number | null,
  day: number | null,
): AuditLog[] {
  if (!year && !month && !day) return logs;
  return logs.filter((log) => {
    const d = new Date(log.timestamp);
    if (isNaN(d.getTime())) return false;
    if (year && d.getFullYear() !== year) return false;
    if (month && d.getMonth() + 1 !== month) return false;
    if (day && d.getDate() !== day) return false;
    return true;
  });
}

function filterLogsBySearch(logs: AuditLog[], term: string): AuditLog[] {
  if (!term.trim()) return logs;
  const t = term.toLowerCase();
  return logs.filter(
    (l) =>
      l.userName?.toLowerCase().includes(t) ||
      l.action?.toLowerCase().includes(t) ||
      l.entityType?.toLowerCase().includes(t) ||
      l.reason?.toLowerCase().includes(t),
  );
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
// AuditRow — mobile card view
// ─────────────────────────────────────────────
function AuditRowMobile({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getActionConfig(log.action);
  return (
    <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.7} style={ar.card}>
      <View style={[ar.accent, { backgroundColor: cfg.text }]} />
      <View style={ar.content}>
        <View style={ar.topRow}>
          <Text style={ar.entity}>{entityLabel(log.entityType)}</Text>
          <View style={[ar.badge, { backgroundColor: cfg.bg }]}>
            <Text style={[ar.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
          </View>
        </View>
        <View style={ar.metaRow}>
          <Text style={ar.metaUser}>{log.userName ?? log.userId}</Text>
          <Text style={ar.metaDot}>·</Text>
          <Text style={ar.metaDate}>{fmtDate(log.timestamp)}</Text>
        </View>
        {!!log.reason && (
          <Text style={ar.reason} numberOfLines={expanded ? undefined : 2}>{log.reason}</Text>
        )}
        {expanded && (log.before || log.after) && (
          <View style={ar.diff}>
            {log.before && (
              <View style={ar.diffBlock}>
                <Text style={[ar.diffLabel, { color: "#b91c1c" }]}>Before</Text>
                <Text style={ar.diffCode} numberOfLines={6}>{JSON.stringify(log.before, null, 2)}</Text>
              </View>
            )}
            {log.after && (
              <View style={[ar.diffBlock, { marginTop: 8 }]}>
                <Text style={[ar.diffLabel, { color: "#15803d" }]}>After</Text>
                <Text style={ar.diffCode} numberOfLines={6}>{JSON.stringify(log.after, null, 2)}</Text>
              </View>
            )}
          </View>
        )}
        <Text style={ar.hint}>{expanded ? "Collapse" : "Expand details"}</Text>
      </View>
    </TouchableOpacity>
  );
}

const ar = StyleSheet.create({
  card: {
    flexDirection: "row", backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 14, marginBottom: 8, overflow: "hidden",
  },
  accent:  { width: 3 },
  content: { flex: 1, padding: 14, gap: 4 },
  topRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  entity:  { fontSize: 13, fontWeight: "700", color: C.text, flex: 1, marginRight: 8 },
  badge:   { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaUser:{ fontSize: 11, color: C.text2, fontWeight: "500" },
  metaDot: { fontSize: 11, color: C.text3 },
  metaDate:{ fontSize: 11, color: C.text3 },
  reason:  { fontSize: 12, color: C.text2, lineHeight: 17 },
  diff:    { backgroundColor: C.bg, borderRadius: 6, padding: 10, marginTop: 6 },
  diffBlock: {},
  diffLabel: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  diffCode:  { fontSize: 10, color: C.text2, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  hint: { fontSize: 10, color: C.text3, marginTop: 2 },
});

// ─────────────────────────────────────────────
// AuditTableRow — web table row
// ─────────────────────────────────────────────
function AuditTableRow({ log, colWidths }: { log: AuditLog; colWidths: number[] }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getActionConfig(log.action);

  return (
    <>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.6}
        style={[at.row, expanded && at.rowExpanded]}
      >
        <View style={[at.cell, { width: colWidths[0] }]}>
          <Text style={at.cellMain}>{entityLabel(log.entityType)}</Text>
        </View>
        <View style={[at.cell, { width: colWidths[1] }]}>
          <View style={[at.badge, { backgroundColor: cfg.bg }]}>
            <Text style={[at.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
          </View>
        </View>
        <View style={[at.cell, { width: colWidths[2] }]}>
          <Text style={at.cellText}>{log.userName ?? log.userId ?? "—"}</Text>
        </View>
        <View style={[at.cell, { width: colWidths[3] }]}>
          <Text style={at.cellText}>{fmtDate(log.timestamp)}</Text>
        </View>
        <View style={[at.cell, { flex: 1 }]}>
          <Text style={at.cellReason} numberOfLines={1}>{log.reason || "—"}</Text>
        </View>
        <View style={[at.cell, { width: 28, alignItems: "center" }]}>
          <Text style={at.chevron}>{expanded ? "▲" : "▼"}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (log.before || log.after || log.reason) && (
        <View style={at.expandedRow}>
          {!!log.reason && (
            <View style={at.expandSection}>
              <Text style={at.expandLabel}>Note</Text>
              <Text style={at.expandValue}>{log.reason}</Text>
            </View>
          )}
          {(log.before || log.after) && (
            <View style={at.diffGrid}>
              {log.before && (
                <View style={at.diffBlock}>
                  <Text style={[at.diffLabel, { color: "#b91c1c" }]}>Before</Text>
                  <Text style={at.diffCode}>{JSON.stringify(log.before, null, 2)}</Text>
                </View>
              )}
              {log.after && (
                <View style={at.diffBlock}>
                  <Text style={[at.diffLabel, { color: "#15803d" }]}>After</Text>
                  <Text style={at.diffCode}>{JSON.stringify(log.after, null, 2)}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </>
  );
}

const at = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: C.borderLight ?? C.border,
    paddingVertical: 11, paddingHorizontal: 20,
    backgroundColor: C.surface,
  },
  rowExpanded: { backgroundColor: C.elevated },
  cell: { paddingHorizontal: 4 },
  cellMain:  { fontSize: 13, fontWeight: "600", color: C.text },
  cellText:  { fontSize: 12, color: C.text2 },
  cellReason:{ fontSize: 12, color: C.text3 },
  badge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5, alignSelf: "flex-start" },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  chevron:   { fontSize: 9, color: C.text3 },

  expandedRow: {
    backgroundColor: C.bg,
    borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  expandSection: { marginBottom: 12 },
  expandLabel: { fontSize: 10, fontWeight: "700", color: C.text3, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  expandValue: { fontSize: 13, color: C.text2, lineHeight: 20 },
  diffGrid: { flexDirection: "row", gap: 16 },
  diffBlock: { flex: 1, backgroundColor: C.surface, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: C.border },
  diffLabel: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  diffCode:  { fontSize: 11, color: C.text2, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", lineHeight: 16 },
});

// ─────────────────────────────────────────────
// Section heading component
// ─────────────────────────────────────────────
function SectionHeading({ label }: { label: string }) {
  return <Text style={sh.label}>{label}</Text>;
}
const sh = StyleSheet.create({
  label: {
    fontSize: 11, fontWeight: "700", color: C.text3,
    textTransform: "uppercase", letterSpacing: 0.8,
    marginTop: 24, marginBottom: 10,
  },
});

// ─────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────
function Divider() {
  return <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />;
}

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

  // Settings form
  const [currency,       setCurrency]       = useState(group?.currency                  ?? "RWF");
  const [contribAmount,  setContribAmount]  = useState(String(group?.contributionAmount ?? 40000));
  const [freq,           setFreq]           = useState(group?.contributionFrequency      ?? "monthly");
  const [loanRate,       setLoanRate]       = useState(String(group?.loanInterestRate   ?? 2));
  const [loanMethod,     setLoanMethod]     = useState(group?.loanInterestMethod         ?? "flat");
  const [penalty,        setPenalty]        = useState(String(group?.latePenaltyAmount  ?? 5000));
  const [absenceMember,  setAbsenceMember]  = useState(String(group?.absencePenaltyMember  ?? 2000));
  const [absenceOfficer, setAbsenceOfficer] = useState(String(group?.absencePenaltyOfficer ?? 5000));
  const [multiplier,     setMultiplier]     = useState(String(group?.maxLoanMultiplier  ?? 3));
  const [saving,         setSaving]         = useState(false);
  const [refreshing,     setRefreshing]     = useState(false);

  // Audit state
  const [activeSection, setActiveSection]   = useState<"settings" | "permissions" | "audit">("settings");
  const [activeTab,     setActiveTab]       = useState<AuditTab>("all");
  const [searchTerm,    setSearchTerm]      = useState("");
  const [selectedYear,  setSelectedYear]    = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth]   = useState<number | null>(null);
  const [selectedDay,   setSelectedDay]     = useState<number | null>(null);
  const [currentPage,   setCurrentPage]     = useState(1);
  const [showFilter,    setShowFilter]      = useState(false);
  const [tempSearch,    setTempSearch]      = useState("");
  const [tempYear,      setTempYear]        = useState<number | null>(null);
  const [tempMonth,     setTempMonth]       = useState<number | null>(null);
  const [tempDay,       setTempDay]         = useState<number | null>(null);

  // Permissions state
  const allMembers = useGroupMembers();
  const activeMembers = useMemo(() => allMembers.filter(m => m.status === "active" && m.role !== "admin"), [allMembers]);
  const [permSaving, setPermSaving] = useState<string | null>(null);
  const [pendingPerms, setPendingPerms] = useState<Record<string, MemberPermissions>>({});

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

  useEffect(() => { setCurrentPage(1); }, [activeTab, searchTerm, selectedYear, selectedMonth, selectedDay]);

  const filteredLogs = useMemo(() => {
    let logs = allAuditLogs;
    if (activeTab !== "all") {
      if (activeTab === "deletions") {
        logs = logs.filter((l) => l.action === "deleted");
      } else {
        const et = AUDIT_TAB_ENTITY[activeTab];
        if (et) logs = logs.filter((l) => l.entityType === et);
      }
    }
    logs = filterLogsByDate(logs, selectedYear, selectedMonth, selectedDay);
    logs = filterLogsBySearch(logs, searchTerm);
    return logs;
  }, [allAuditLogs, activeTab, selectedYear, selectedMonth, selectedDay, searchTerm]);

  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLogs.slice(start, start + PAGE_SIZE);
  }, [filteredLogs, currentPage]);

  const totalPages  = Math.ceil(filteredLogs.length / PAGE_SIZE);
  const startIndex  = (currentPage - 1) * PAGE_SIZE + 1;
  const endIndex    = Math.min(currentPage * PAGE_SIZE, filteredLogs.length);
  const hasFilters  = !!(searchTerm || selectedYear || selectedMonth || selectedDay);

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

  const handleSave = async () => {
    if (!activeGroupId) { show("No active group", "error"); return; }
    const contributionAmount    = parseNum(contribAmount);
    const loanInterestRate      = parseNum(loanRate);
    const latePenaltyAmount     = parseNum(penalty);
    const absencePenaltyMember  = parseNum(absenceMember);
    const absencePenaltyOfficer = parseNum(absenceOfficer);
    const maxLoanMultiplier     = parseNum(multiplier);

    if (contributionAmount !== undefined && contributionAmount < 0)  { show("Contribution amount cannot be negative", "error"); return; }
    if (loanInterestRate   !== undefined && (loanInterestRate < 0 || loanInterestRate > 100)) { show("Loan interest rate must be 0–100", "error"); return; }

    const patch: Parameters<typeof updateGroup>[1] = {
      currency,
      contributionFrequency: freq as any,
      loanInterestMethod: loanMethod as any,
      ...(contributionAmount    !== undefined && { contributionAmount }),
      ...(loanInterestRate      !== undefined && { loanInterestRate }),
      ...(latePenaltyAmount     !== undefined && { latePenaltyAmount }),
      ...(absencePenaltyMember  !== undefined && { absencePenaltyMember }),
      ...(absencePenaltyOfficer !== undefined && { absencePenaltyOfficer }),
      ...(maxLoanMultiplier     !== undefined && { maxLoanMultiplier }),
    };

    setSaving(true);
    try {
      await updateGroup(activeGroupId, patch);
      show("Settings saved");
    } catch (e: any) {
      show(e.message || "Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const state = useStore.getState();
      await exportFullData(
        {
          group,
          members:           state.members.filter((m) => m.groupId === group?.id),
          loans:             state.loans.filter((l) => l.groupId === group?.id),
          contributions:     state.contributions.filter((c) => c.groupId === group?.id),
          investments:       state.investments.filter((i) => i.groupId === group?.id),
          walletTransactions:state.walletTransactions.filter((w) => w.groupId === group?.id),
          expenses:          state.expenses.filter((e) => e.groupId === group?.id),
          meetings:          state.meetings.filter((m) => m.groupId === group?.id),
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
          if (data.members)           state.setMembers(data.members);
          if (data.loans)             state.setLoans(data.loans);
          if (data.contributions)     state.setContributions(data.contributions);
          if (data.investments)       state.setInvestments(data.investments);
          if (data.walletTransactions)state.setWalletTxs(data.walletTransactions);
          if (data.expenses)          state.setExpenses(data.expenses);
          if (data.meetings)          state.setMeetings(data.meetings);
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

  const COL_WIDTHS = [180, 100, 160, 140];

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
                : <Text style={s.headerBtnPrimaryText}>Save</Text>}
            </TouchableOpacity>
          ) : activeSection === "permissions" ? (
            <View style={{ width: 60 }} />
          ) : (
            <TouchableOpacity onPress={openFilter} style={[s.headerBtn, hasFilters && s.headerBtnActive]}>
              <Text style={[s.headerBtnText, hasFilters && s.headerBtnActiveText]}>
                {hasFilters ? "Filtered" : "Filter"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Section Toggle */}
      <View style={[s.segmentBar, isWide && s.segmentBarWide]}>
        {(["settings", "permissions", "audit"] as const).map((sec) => (
          <TouchableOpacity
            key={sec}
            style={[s.segment, activeSection === sec && s.segmentActive]}
            onPress={() => setActiveSection(sec as any)}
          >
            <Text style={[s.segmentText, activeSection === sec && s.segmentTextActive]}>
              {sec === "settings" ? "Settings" : sec === "permissions" ? "Permissions" : "Audit Log"}
            </Text>
            {sec === "audit" && allAuditLogs.length > 0 && (
              <View style={s.segmentPill}>
                <Text style={s.segmentPillText}>{allAuditLogs.length > 99 ? "99+" : allAuditLogs.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Settings Section */}
      {activeSection === "settings" && (
        <ScrollView
          contentContainerStyle={[s.body, isWide && s.bodyWide]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
        >
          {/* Group Card */}
          <View style={[s.groupCard, isWide && s.groupCardWide]}>
            <View style={s.groupAvatar}>
              <Text style={s.groupAvatarLetter}>{(group?.name ?? "S").charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.groupName}>{group?.name ?? "SCDT Savings Group"}</Text>
              {group?.description && <Text style={s.groupDesc}>{group.description}</Text>}
            </View>
          </View>

          {/* Two-column layout on wide screens */}
          <View style={isWide ? s.wideGrid : undefined}>

            {/* Left Column */}
            <View style={isWide ? s.wideCol : undefined}>
              <SectionHeading label="Currency & Contributions" />
              <View style={s.formCard}>
                <Select label="Currency" value={currency} options={CURRENCIES} onChange={setCurrency} />
                <Divider />
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Input label="Contribution amount" value={contribAmount} onChangeText={setContribAmount} keyboardType="numeric" prefix={currency} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Select label="Frequency" value={freq} options={FREQ} onChange={(v) => setFreq(v as any)} />
                  </View>
                </View>
              </View>

              <SectionHeading label="Loan Rules" />
              <View style={s.formCard}>
                <Select
                  label="Interest calculation method"
                  value={loanMethod}
                  options={INTEREST_METHODS}
                  onChange={(v) => setLoanMethod(v as any)}
                  hint={
                    loanMethod === "reducing_balance"
                      ? "Interest recalculated each month on the remaining balance (bank-style amortization)"
                      : "Interest charged up front on the full principal for the whole term (SACCO-style flat rate)"
                  }
                />
                <Divider />
                <Input
                  label="Interest rate (% per month)"
                  value={loanRate}
                  onChangeText={setLoanRate}
                  keyboardType="numeric"
                  hint={
                    loanMethod === "reducing_balance"
                      ? "Applied monthly to the outstanding balance"
                      : "Applied monthly to the original loan amount"
                  }
                />
                <Divider />
                <Input
                  label="Max loan multiplier"
                  value={multiplier}
                  onChangeText={setMultiplier}
                  keyboardType="numeric"
                  hint={`Loan ceiling = savings × ${multiplier || "3"}`}
                />
              </View>
            </View>

            {/* Right Column */}
            <View style={isWide ? s.wideCol : undefined}>
              <SectionHeading label="Meeting Penalties" />
              <View style={s.formCard}>
                <Input label="Late penalty (per meeting)" value={penalty} onChangeText={setPenalty} keyboardType="numeric" prefix={currency} />
                <Divider />
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Input label="Absence — member"  value={absenceMember}  onChangeText={setAbsenceMember}  keyboardType="numeric" prefix={currency} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input label="Absence — officer" value={absenceOfficer} onChangeText={setAbsenceOfficer} keyboardType="numeric" prefix={currency} />
                  </View>
                </View>
              </View>

              <SectionHeading label="Data Management" />
              <View style={s.formCard}>
                <TouchableOpacity style={s.actionRow} onPress={handleExport} activeOpacity={0.7}>
                  <View style={s.actionInfo}>
                    <Text style={s.actionTitle}>Export backup</Text>
                    <Text style={s.actionDesc}>Download full group data as JSON</Text>
                  </View>
                  <Text style={[s.actionCta, { color: C.primary }]}>Export</Text>
                </TouchableOpacity>
                <Divider />
                <TouchableOpacity style={s.actionRow} onPress={handleImport} activeOpacity={0.7}>
                  <View style={s.actionInfo}>
                    <Text style={s.actionTitle}>Import backup</Text>
                    <Text style={s.actionDesc}>Restore from a JSON backup file</Text>
                  </View>
                  <Text style={[s.actionCta, { color: "#d97706" }]}>Import</Text>
                </TouchableOpacity>
              </View>

              <SectionHeading label="Account" />
              <View style={s.formCard}>
                <TouchableOpacity style={s.actionRow} onPress={handleSignOut} activeOpacity={0.7}>
                  <View style={s.actionInfo}>
                    <Text style={[s.actionTitle, { color: C.error }]}>Sign out</Text>
                    <Text style={s.actionDesc}>You will be returned to the welcome screen</Text>
                  </View>
                  <Text style={[s.actionCta, { color: C.error }]}>Sign out</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Save button */}
          {!isWide && (
            <Button label="Save settings" onPress={handleSave} fullWidth loading={saving} size="lg" style={{ marginTop: 24 }} />
          )}
          {isWide && (
            <View style={s.wideSaveRow}>
              <Button label="Save settings" onPress={handleSave} loading={saving} size="lg" />
            </View>
          )}
        </ScrollView>
      )}


      {/* Permissions Section */}
      {activeSection === "permissions" && (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
        >
          <Text style={[s.sectionLabel, { marginBottom: 4 }]}>Member Access Control</Text>
          <Text style={{ fontSize: 13, color: C.text3, marginBottom: 20 }}>
            Enable or disable actions for each member. Admin roles always have full access.
          </Text>

          {activeMembers.length === 0 && (
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <Text style={{ fontSize: 32 }}>👥</Text>
              <Text style={{ fontSize: 14, color: C.text3, marginTop: 8 }}>No active non-admin members</Text>
            </View>
          )}

          {activeMembers.map((member) => {
            const perms = getMemberPerms(member);
            const isDirty = !!pendingPerms[member.id];
            const isSaving = permSaving === member.id;
            const PERM_KEYS: (keyof MemberPermissions)[] = [
              "addContribution", "addLoan", "addInvestment",
              "downloadReports", "updateMeetings",
              "approveContributions", "approveLoans", "approveInvestments",
            ];
            const PERM_LABELS: Record<keyof MemberPermissions, string> = {
              addContribution: "Add Contribution",
              addLoan: "Apply for Loan",
              addInvestment: "Add Investment",
              downloadReports: "Download Reports",
              updateMeetings: "Update Meetings",
              approveContributions: "Approve Contributions",
              approveLoans: "Approve Loans",
              approveInvestments: "Approve Investments",
            };
            return (
              <View key={member.id} style={ps.memberCard}>
                <View style={ps.memberHeader}>
                  <View style={ps.memberAvatar}>
                    <Text style={ps.memberAvatarText}>
                      {member.fullName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ps.memberName}>{member.fullName}</Text>
                    <Text style={ps.memberRole}>{member.role.replace("_", " ")}</Text>
                  </View>
                  {isDirty && (
                    <TouchableOpacity
                      style={[ps.saveBtn, isSaving && ps.saveBtnDisabled]}
                      onPress={() => savePermissions(member)}
                      disabled={isSaving}
                    >
                      {isSaving
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={ps.saveBtnText}>Save</Text>
                      }
                    </TouchableOpacity>
                  )}
                </View>

                <View style={ps.permGrid}>
                  {PERM_KEYS.map((key) => (
                    <View key={key} style={ps.permRow}>
                      <Text style={ps.permLabel}>{PERM_LABELS[key]}</Text>
                      <Switch
                        value={perms[key]}
                        onValueChange={() => togglePerm(member.id, key, perms)}
                        trackColor={{ false: C.border, true: C.primary + "66" }}
                        thumbColor={perms[key] ? C.primary : C.text3}
                        ios_backgroundColor={C.border}
                      />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Audit Log Section */}
      {activeSection === "audit" && (
        <View style={{ flex: 1 }}>

          {/* Tab strip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[s.tabStrip, isWide && s.tabStripWide]}
          >
            {AUDIT_TABS.map((t) => {
              const isActive = activeTab === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[s.tabChip, isActive && s.tabChipActive]}
                  onPress={() => setActiveTab(t.key)}
                >
                  <Text style={[s.tabChipText, isActive && s.tabChipTextActive]}>{t.label}</Text>
                  {isActive && filteredLogs.length > 0 && (
                    <View style={s.tabChipCount}>
                      <Text style={s.tabChipCountText}>{filteredLogs.length}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Active filter bar */}
          {hasFilters && (
            <View style={s.filterBar}>
              <Text style={s.filterBarText} numberOfLines={1}>
                {[
                  searchTerm && `"${searchTerm}"`,
                  selectedYear && String(selectedYear),
                  selectedMonth && MONTHS.find((m) => m.value === selectedMonth)?.label,
                  selectedDay && `Day ${selectedDay}`,
                ].filter(Boolean).join("  ·  ")}
              </Text>
              <TouchableOpacity onPress={clearFilters} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={s.filterBarClear}>Clear filters</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Results count */}
          {filteredLogs.length > 0 && (
            <View style={[s.resultsRow, isWide && s.resultsRowWide]}>
              <Text style={s.resultsText}>
                {startIndex}–{endIndex} of {filteredLogs.length} records
              </Text>
            </View>
          )}

          {/* Desktop: Table layout */}
          {isWide ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
            >
              {filteredLogs.length === 0 ? (
                <EmptyState hasFilters={hasFilters} />
              ) : (
                <>
                  {/* Table header */}
                  <View style={at_th.header}>
                    {[
                      { label: "Entity",    w: COL_WIDTHS[0] },
                      { label: "Action",    w: COL_WIDTHS[1] },
                      { label: "User",      w: COL_WIDTHS[2] },
                      { label: "Date",      w: COL_WIDTHS[3] },
                      { label: "Note",      w: undefined     },
                    ].map(({ label, w }, i) => (
                      <View key={i} style={[at_th.cell, w ? { width: w } : { flex: 1 }]}>
                        <Text style={at_th.label}>{label}</Text>
                      </View>
                    ))}
                    <View style={{ width: 28 }} />
                  </View>

                  {paginatedLogs.map((log) => (
                    <AuditTableRow key={log.id} log={log} colWidths={COL_WIDTHS} />
                  ))}

                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onChange={setCurrentPage}
                    wide
                  />
                </>
              )}
            </ScrollView>
          ) : (
            /* Mobile: Card layout */
            <ScrollView
              contentContainerStyle={s.auditBody}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
            >
              {filteredLogs.length === 0 ? (
                <EmptyState hasFilters={hasFilters} />
              ) : (
                <>
                  {paginatedLogs.map((log) => <AuditRowMobile key={log.id} log={log} />)}
                  <Pagination currentPage={currentPage} totalPages={totalPages} onChange={setCurrentPage} />
                </>
              )}
            </ScrollView>
          )}
        </View>
      )}

      {/* Filter modal */}
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
// Table header styles
// ─────────────────────────────────────────────
const at_th = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 9, paddingHorizontal: 20,
    backgroundColor: C.elevated,
    borderBottomWidth: 1, borderBottomColor: C.border,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  cell:  { paddingHorizontal: 4 },
  label: { fontSize: 11, fontWeight: "700", color: C.text3, textTransform: "uppercase", letterSpacing: 0.5 },
});

// ─────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────
function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <View style={es.wrap}>
      <View style={es.iconBox}>
        <Text style={es.iconText}>○</Text>
      </View>
      <Text style={es.title}>No records found</Text>
      <Text style={es.desc}>
        {hasFilters
          ? "No logs match your current filters. Try adjusting or clearing them."
          : "Activity in this group will appear here as an audit trail."}
      </Text>
    </View>
  );
}
const es = StyleSheet.create({
  wrap:    { alignItems: "center", paddingTop: 80, paddingHorizontal: 40 },
  iconBox: { width: 56, height: 56, borderRadius: 14, backgroundColor: C.elevated, alignItems: "center", justifyContent: "center", marginBottom: 16, borderWidth: 1, borderColor: C.border },
  iconText:{ fontSize: 24, color: C.text3 },
  title:   { fontSize: 15, fontWeight: "700", color: C.text, marginBottom: 6 },
  desc:    { fontSize: 13, color: C.text3, textAlign: "center", lineHeight: 20 },
});

// ─────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────
function Pagination({ currentPage, totalPages, onChange, wide }: { currentPage: number; totalPages: number; onChange: (p: number) => void; wide?: boolean }) {
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push("…");
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <View style={[pg.bar, wide && pg.barWide]}>
      <TouchableOpacity
        style={[pg.btn, currentPage === 1 && pg.btnDisabled]}
        onPress={() => onChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        <Text style={pg.btnText}>← Prev</Text>
      </TouchableOpacity>

      {wide && (
        <View style={pg.pages}>
          {pages.map((p, i) =>
            p === "…" ? (
              <Text key={`e${i}`} style={pg.ellipsis}>…</Text>
            ) : (
              <TouchableOpacity
                key={p}
                style={[pg.pageBtn, currentPage === p && pg.pageBtnActive]}
                onPress={() => onChange(p as number)}
              >
                <Text style={[pg.pageBtnText, currentPage === p && pg.pageBtnTextActive]}>{p}</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      )}

      {!wide && (
        <Text style={pg.info}>Page {currentPage} of {totalPages}</Text>
      )}

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

const pg = StyleSheet.create({
  bar:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, marginTop: 4 },
  barWide: { justifyContent: "center", gap: 12 },
  btn:     { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.elevated, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  btnDisabled: { opacity: 0.35 },
  btnText: { fontSize: 13, fontWeight: "600", color: C.text },
  info:    { fontSize: 13, color: C.text3 },
  pages:   { flexDirection: "row", gap: 4, alignItems: "center" },
  pageBtn: { minWidth: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 6, borderWidth: 1, borderColor: C.border, paddingHorizontal: 6 },
  pageBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  pageBtnText:   { fontSize: 13, fontWeight: "600", color: C.text2 },
  pageBtnTextActive: { color: "#fff" },
  ellipsis: { fontSize: 13, color: C.text3, paddingHorizontal: 2 },
});

// ─────────────────────────────────────────────
// Root styles
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
  headerRight:{ flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: C.elevated,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border,
  },
  backBtnText: { fontSize: 16, color: C.text2, fontWeight: "500", lineHeight: 20 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: C.text },
  headerSub:   { fontSize: 12, color: C.text3, marginTop: 1 },
  headerBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.elevated,
  },
  headerBtnPrimary: { backgroundColor: C.primary, borderColor: C.primary },
  headerBtnActive:  { borderColor: C.primary },
  headerBtnText:        { fontSize: 13, fontWeight: "600", color: C.text2 },
  headerBtnPrimaryText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  headerBtnActiveText:  { color: C.primary },

  // Segment bar
  segmentBar: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 20,
  },
  segmentBarWide: { paddingHorizontal: 32 },
  segment: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 13, paddingHorizontal: 4, marginRight: 24,
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  segmentActive:    { borderBottomColor: C.primary },
  segmentText:      { fontSize: 14, fontWeight: "600", color: C.text3 },
  segmentTextActive:{ color: C.primary },
  segmentPill: {
    backgroundColor: C.primary, borderRadius: 10,
    paddingHorizontal: 6, minWidth: 20, height: 18, alignItems: "center", justifyContent: "center",
  },
  segmentPillText: { fontSize: 10, fontWeight: "700", color: "#fff" },

  // Settings body
  body:     { padding: 20, paddingBottom: 60, maxWidth: 860, alignSelf: "center", width: "100%" },
  bodyWide: { paddingHorizontal: 32, paddingTop: 24 },

  // Group card
  groupCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 16, padding: 20, marginBottom: 4,
  },
  groupCardWide: { marginBottom: 8 },
  groupAvatar: {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: C.primary,
    alignItems: "center", justifyContent: "center",
  },
  groupAvatarLetter: { fontSize: 20, fontWeight: "800", color: "#fff" },
  groupName: { fontSize: 15, fontWeight: "800", color: C.text },
  groupDesc: { fontSize: 12, color: C.text3, marginTop: 2 },

  // Two-col grid
  wideGrid: { flexDirection: "row", gap: 20, alignItems: "flex-start" },
  wideCol:  { flex: 1 },
  wideSaveRow: { marginTop: 16, alignItems: "flex-start" },

  // Form card
  formCard: {
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 14,
    padding: 16, marginBottom: 4,
    overflow: "hidden",
  },
  row: { flexDirection: "row", gap: 10 },

  // Action rows
  actionRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, gap: 12,
  },
  actionInfo: { flex: 1 },
  actionTitle:{ fontSize: 14, fontWeight: "600", color: C.text },
  actionDesc: { fontSize: 12, color: C.text3, marginTop: 2 },
  actionCta:  { fontSize: 13, fontWeight: "700" },

  // Tab strip
  tabStrip: {
    paddingHorizontal: 20, paddingVertical: 10, gap: 8,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tabStripWide: { paddingHorizontal: 32 },
  tabChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.elevated,
    borderWidth: 1, borderColor: C.border,
  },
  tabChipActive:     { backgroundColor: C.primary, borderColor: C.primary },
  tabChipText:       { fontSize: 13, fontWeight: "600", color: C.text2 },
  tabChipTextActive: { color: "#fff" },
  tabChipCount:      { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10, paddingHorizontal: 6, minWidth: 20, alignItems: "center" },
  tabChipCountText:  { fontSize: 10, fontWeight: "700", color: "#fff" },

  // Filter bar
  filterBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#f0fdf9",
    paddingHorizontal: 20, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  filterBarText:  { fontSize: 12, color: C.primary, fontWeight: "500", flex: 1, marginRight: 12 },
  filterBarClear: { fontSize: 12, color: C.error, fontWeight: "700" },

  // Results count
  resultsRow: {
    paddingHorizontal: 20, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  resultsRowWide: { paddingHorizontal: 32 },
  resultsText: { fontSize: 11, color: C.text3 },

  // Audit body (mobile)
  auditBody: { padding: 20, paddingBottom: 60 },
});

// ─── Permission section styles ────────────────────────────────────────────────
const ps = StyleSheet.create({
  memberCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  memberHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.elevated,
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: (C as any).primaryFaint ?? (C as any).accentFaint ?? C.primary + "22",
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  memberAvatarText: { fontSize: 14, fontWeight: "700", color: C.primary },
  memberName: { fontSize: 15, fontWeight: "700", color: C.text },
  memberRole: { fontSize: 11, color: C.text3, marginTop: 1, textTransform: "capitalize" },
  permGrid: { padding: 12 },
  permRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  permLabel: { fontSize: 14, color: C.text, flex: 1 },
  saveBtn: {
    backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: C.text2, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
});