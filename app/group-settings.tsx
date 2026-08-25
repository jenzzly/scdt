// app/group-settings.tsx
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
import { Colors, C, T, fmtDate, fmtCurrency, showConfirm, round2 } from "../utils/theme";
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

// Action badge config
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

// ─────────────────────────────────────────────────────────────────────────────
// CategoryDropdown — replaces the horizontal scrolling chip-tab row.
// A single tap opens a simple list; each option shows its live count.
// ─────────────────────────────────────────────────────────────────────────────
function CategoryDropdown({
  options, value, onChange, counts,
}: {
  options: { key: string; label: string; icon: string }[];
  value: string;
  onChange: (v: string) => void;
  counts: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.key === value) ?? options[0];

  return (
    <View style={{ position: "relative" }}>
      <TouchableOpacity
        style={aw.dropdownBtn}
        onPress={() => setOpen(!open)}
        activeOpacity={0.8}
      >
        <Text style={aw.dropdownBtnIcon}>{current.icon}</Text>
        <Text style={aw.dropdownBtnText}>{current.label}</Text>
        <View style={aw.dropdownBadge}>
          <Text style={aw.dropdownBadgeText}>{counts[current.key] ?? 0}</Text>
        </View>
        <Text style={aw.dropdownChevron}>{open ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {open && (
        <>
          <TouchableOpacity
            style={aw.dropdownBackdrop}
            activeOpacity={1}
            onPress={() => setOpen(false)}
          />
          <View style={aw.dropdownMenu}>
            {options.map(opt => {
              const isActive = opt.key === value;
              const isAlert = opt.key === "failed" && (counts[opt.key] ?? 0) > 0;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[aw.dropdownItem, isActive && aw.dropdownItemActive]}
                  onPress={() => { onChange(opt.key); setOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={aw.dropdownItemIcon}>{opt.icon}</Text>
                  <Text style={[aw.dropdownItemText, isActive && aw.dropdownItemTextActive]}>{opt.label}</Text>
                  <View style={[aw.dropdownItemBadge, isAlert && aw.dropdownItemBadgeAlert]}>
                    <Text style={[aw.dropdownItemBadgeText, isAlert && aw.dropdownItemBadgeTextAlert]}>
                      {counts[opt.key] ?? 0}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// White-theme table row (desktop) — includes a Revert action
// ─────────────────────────────────────────────────────────────────────────────
function AuditTableRowWhite({ log, idx, onRevert }: { log: AuditLog; idx: number; onRevert: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getActionConfig(log.action);
  const ts  = new Date(log.timestamp);
  const tsStr = isNaN(ts.getTime())
    ? log.timestamp
    : `${ts.toLocaleDateString("en-US",{ year:"numeric", month:"2-digit", day:"2-digit" })} ${ts.toLocaleTimeString("en-US",{ hour:"2-digit", minute:"2-digit", second:"2-digit" })}`;
  const canRevert = log.action !== "reverted" && (log.action === "deleted" || log.action === "created" || !!log.before);

  return (
    <>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
        style={[awr.row, idx % 2 === 1 && awr.rowAlt, expanded && awr.rowExp]}
      >
        <Text style={[awr.cell, { width: 170 }]} numberOfLines={1}>{tsStr}</Text>
        <Text style={[awr.catText, { width: 120 }]} numberOfLines={1}>{entityLabel(log.entityType)}</Text>
        <View style={{ width: 110, paddingHorizontal: 4, justifyContent: "center" }}>
          <View style={[awr.actBadge, { backgroundColor: cfg.bg, borderColor: cfg.text + "33" }]}>
            <Text style={[awr.actBadgeText, { color: cfg.text }]}>{cfg.label}</Text>
          </View>
        </View>
        <Text style={[awr.cell, { width: 130 }]} numberOfLines={1}>{log.userName ?? log.userId ?? "—"}</Text>
        <Text style={[awr.changeLog, { flex: 1 }]} numberOfLines={expanded ? undefined : 1}>
          {log.reason || `${entityLabel(log.entityType)} ${log.action}`}
        </Text>
        <View style={{ width: 90, alignItems: "flex-end" }}>
          {canRevert && (
            <TouchableOpacity onPress={onRevert} hitSlop={{ top:6,bottom:6,left:6,right:6 }}>
              <Text style={awr.revertText}>↺ Revert</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
      {expanded && (
        <View style={awr.expandWrap}>
          {!!log.errorMessage && (
            <View style={awr.errorBox}>
              <Text style={awr.errorLabel}>ERROR</Text>
              <Text style={awr.errorText}>{log.errorMessage}</Text>
            </View>
          )}
          {!!log.reason && <Text style={awr.expandNote}>{log.reason}</Text>}
          {(log.before || log.after) && (
            <View style={awr.diffRow}>
              {log.before && (
                <View style={awr.diffBlock}>
                  <Text style={[awr.diffLabel, { color: "#dc2626" }]}>← Before</Text>
                  <Text style={awr.diffCode}>{JSON.stringify(log.before, null, 2)}</Text>
                </View>
              )}
              {log.after && (
                <View style={awr.diffBlock}>
                  <Text style={[awr.diffLabel, { color: "#16a34a" }]}>→ After</Text>
                  <Text style={awr.diffCode}>{JSON.stringify(log.after, null, 2)}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// White-theme mobile card — includes a Revert action
// ─────────────────────────────────────────────────────────────────────────────
function AuditRowWhite({ log, onRevert }: { log: AuditLog; onRevert: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getActionConfig(log.action);
  const ts  = new Date(log.timestamp);
  const tsStr = isNaN(ts.getTime()) ? log.timestamp
    : ts.toLocaleDateString("en-US",{ month:"short", day:"2-digit" }) + " " + ts.toLocaleTimeString("en-US",{ hour:"2-digit", minute:"2-digit" });
  const canRevert = log.action !== "reverted" && (log.action === "deleted" || log.action === "created" || !!log.before);

  return (
    <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.75} style={awr.mCard}>
      <View style={awr.mCardTop}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <Text style={awr.mCat}>{entityLabel(log.entityType)}</Text>
            <View style={[awr.actBadge, { backgroundColor: cfg.bg, borderColor: cfg.text + "33" }]}>
              <Text style={[awr.actBadgeText, { color: cfg.text }]}>{cfg.label}</Text>
            </View>
          </View>
          <Text style={awr.mChangeLog} numberOfLines={expanded ? undefined : 2}>
            {log.reason || `${entityLabel(log.entityType)} ${log.action}`}
          </Text>
        </View>
        <Text style={awr.chevron}>{expanded ? "▲" : "▼"}</Text>
      </View>
      <View style={awr.mCardBottom}>
        <Text style={awr.mUser}>{log.userName ?? log.userId ?? "—"}</Text>
        <Text style={awr.mTs}>{tsStr}</Text>
      </View>
      {canRevert && (
        <TouchableOpacity onPress={onRevert} style={awr.mRevertBtn} hitSlop={{ top:6,bottom:6,left:6,right:6 }}>
          <Text style={awr.revertText}>↺ Revert this action</Text>
        </TouchableOpacity>
      )}
      {expanded && (log.before || log.after || log.errorMessage) && (
        <View style={awr.mExpand}>
          {!!log.errorMessage && (
            <View style={awr.errorBox}>
              <Text style={awr.errorLabel}>ERROR</Text>
              <Text style={awr.errorText}>{log.errorMessage}</Text>
            </View>
          )}
          {log.before && (
            <View style={[awr.diffBlock, { marginBottom: 8 }]}>
              <Text style={[awr.diffLabel, { color: "#dc2626" }]}>← Before</Text>
              <Text style={awr.diffCode}>{JSON.stringify(log.before, null, 2)}</Text>
            </View>
          )}
          {log.after && (
            <View style={awr.diffBlock}>
              <Text style={[awr.diffLabel, { color: "#16a34a" }]}>→ After</Text>
              <Text style={awr.diffCode}>{JSON.stringify(log.after, null, 2)}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// White audit theme styles
// ─────────────────────────────────────────────────────────────────────────────
const aw = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  toolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: "#ffffff", borderBottomWidth: 1, borderBottomColor: C.border,
    flexWrap: "wrap", gap: 8,
  },
  toolbarCount: { fontSize: 13, fontWeight: "600", color: C.text2 },
  toolbarRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, flexWrap: "wrap" },
  searchBox: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#f8fafc", borderWidth: 1, borderColor: C.border,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 160, maxWidth: 240,
  },
  searchIcon: { fontSize: 14, color: C.text3, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13, color: C.text, minHeight: 18 },
  filterBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: "#f8fafc",
  },
  filterBtnActive: { borderColor: C.primary, backgroundColor: C.primary + "10" },
  filterBtnText: { fontSize: 12, fontWeight: "600", color: C.text2 },
  filterBtnTextActive: { color: C.primary },
  clearText: { fontSize: 12, color: "#dc2626", fontWeight: "600" },

  dropdownBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: "#f8fafc",
  },
  dropdownBtnIcon: { fontSize: 13 },
  dropdownBtnText: { fontSize: 12, fontWeight: "600", color: C.text },
  dropdownBadge: {
    backgroundColor: C.elevated, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, minWidth: 20, alignItems: "center",
  },
  dropdownBadgeText: { fontSize: 10, fontWeight: "700", color: C.text3 },
  dropdownChevron: { fontSize: 9, color: C.text3 },
  dropdownBackdrop: {
    position: "absolute", top: -1000, left: -1000, right: -1000, bottom: -1000,
    zIndex: 10,
  },
  dropdownMenu: {
    position: "absolute", top: 40, right: 0, zIndex: 20,
    backgroundColor: "#ffffff", borderRadius: 12, borderWidth: 1, borderColor: C.border,
    minWidth: 220, paddingVertical: 6,
    ...(Platform.OS === "web" ? { boxShadow: "0 8px 24px rgba(0,0,0,0.12)" } as any : {
      shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
    }),
  },
  dropdownItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  dropdownItemActive: { backgroundColor: C.primary + "0d" },
  dropdownItemIcon: { fontSize: 14, width: 20 },
  dropdownItemText: { flex: 1, fontSize: 13, color: C.text2, fontWeight: "500" },
  dropdownItemTextActive: { color: C.primary, fontWeight: "700" },
  dropdownItemBadge: { backgroundColor: C.elevated, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, minWidth: 22, alignItems: "center" },
  dropdownItemBadgeAlert: { backgroundColor: "#fee2e2" },
  dropdownItemBadgeText: { fontSize: 10, fontWeight: "700", color: C.text3 },
  dropdownItemBadgeTextAlert: { color: "#dc2626" },

  tableHead: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc",
    paddingVertical: 10, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: C.border,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  thCell: {
    fontSize: 10, fontWeight: "700", color: C.text3,
    letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 4,
  },
  mobileCount: { fontSize: 11, color: C.text3, marginBottom: 10, textAlign: "right" },
});

const awr = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 11, paddingHorizontal: 20,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  rowAlt: { backgroundColor: "#fafbfc" },
  rowExp: { backgroundColor: "#f8fafc" },
  cell: { fontSize: 12, color: C.text2, paddingHorizontal: 4 },
  catText: { fontSize: 12, color: C.text, fontWeight: "600", paddingHorizontal: 4 },
  actBadge: { borderWidth: 1, borderRadius: 6, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2 },
  actBadgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
  changeLog: { fontSize: 12, color: C.text, paddingHorizontal: 4, lineHeight: 16 },
  revertText: { fontSize: 11, fontWeight: "700", color: C.primary },

  expandWrap: {
    backgroundColor: "#f8fafc", borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  expandNote: { fontSize: 12, color: C.text2, lineHeight: 18, marginBottom: 10 },
  errorBox: { backgroundColor: "#fef2f2", borderRadius: 6, padding: 10, borderWidth: 1, borderColor: "#fecaca", marginBottom: 10 },
  errorLabel: { fontSize: 9, fontWeight: "800", color: "#dc2626", letterSpacing: 1, marginBottom: 3 },
  errorText: { fontSize: 11, color: "#b91c1c", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  diffRow: { flexDirection: "row", gap: 12 },
  diffBlock: { flex: 1, backgroundColor: "#ffffff", borderRadius: 6, padding: 10, borderWidth: 1, borderColor: C.border },
  diffLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4, marginBottom: 4, textTransform: "uppercase" },
  diffCode: { fontSize: 10, color: C.text2, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", lineHeight: 15 },

  mCard: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: C.border, borderRadius: 10, marginBottom: 8, overflow: "hidden", padding: 12 },
  mCardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  mCat: { fontSize: 12, fontWeight: "700", color: C.text },
  mChangeLog: { fontSize: 12, color: C.text2, lineHeight: 17, marginTop: 2 },
  mCardBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mUser: { fontSize: 11, color: C.text3 },
  mTs: { fontSize: 11, color: C.text3 },
  mRevertBtn: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  mExpand: { marginTop: 12, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  chevron: { fontSize: 9, color: C.text3 },
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
  const [ratePeriod,     setRatePeriod]     = useState<"monthly" | "annual">(group?.loanInterestRatePeriod ?? "monthly");
  // Interest-based penalty rates (% of the group's standard contribution amount)
  const [lateRatePct,      setLateRatePct]      = useState(String(group?.latePenaltyRatePct ?? 5));
  const [absenceMemberPct, setAbsenceMemberPct] = useState(String(group?.absencePenaltyMemberRatePct ?? 10));
  const [absenceOfficerPct,setAbsenceOfficerPct]= useState(String(group?.absencePenaltyOfficerRatePct ?? 25));
  // Late-PAYMENT fees — separate from meeting-attendance penalties above.
  // Calculated on the amount actually due (missed contribution / overdue
  // installment), not a flat figure.
  const [contribLateFeePct,   setContribLateFeePct]   = useState(String(group?.contributionLateFeeRatePct ?? 5));
  const [contribLateFeeGrace, setContribLateFeeGrace] = useState(String(group?.contributionLateFeeGraceDays ?? 3));
  // Contribution late fees only apply to periods on/after this date — never
  // retroactively across a member's whole history. Empty = feature is off.
  const [contribLateFeeStart, setContribLateFeeStart] = useState(group?.contributionLateFeeStartDate ?? "");
  const [loanLateFeePct,      setLoanLateFeePct]       = useState(String(group?.loanLateFeeRatePct ?? 5));
  const [loanLateFeeGrace,    setLoanLateFeeGrace]     = useState(String(group?.loanLateFeeGraceDays ?? 3));
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

  // Revert a logged action — restores the entity to its pre-action state.
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

  const handleSave = async () => {
    if (!activeGroupId) { show("No active group", "error"); return; }
    const contributionAmount     = parseNum(contribAmount);
    const loanInterestRate       = parseNum(loanRate);
    const latePenaltyRatePct           = parseNum(lateRatePct);
    const absencePenaltyMemberRatePct  = parseNum(absenceMemberPct);
    const absencePenaltyOfficerRatePct = parseNum(absenceOfficerPct);
    const contributionLateFeeRatePct   = parseNum(contribLateFeePct);
    const contributionLateFeeGraceDays = parseNum(contribLateFeeGrace);
    const loanLateFeeRatePct           = parseNum(loanLateFeePct);
    const loanLateFeeGraceDays         = parseNum(loanLateFeeGrace);

    if (contributionAmount !== undefined && contributionAmount < 0)  { show("Contribution amount cannot be negative", "error"); return; }
    if (loanInterestRate   !== undefined && (loanInterestRate < 0 || loanInterestRate > 100)) { show("Loan interest rate must be 0–100", "error"); return; }
    if (latePenaltyRatePct !== undefined && (latePenaltyRatePct < 0 || latePenaltyRatePct > 100)) { show("Late penalty rate must be 0–100%", "error"); return; }
    if (absencePenaltyMemberRatePct !== undefined && (absencePenaltyMemberRatePct < 0 || absencePenaltyMemberRatePct > 100)) { show("Absence penalty rate must be 0–100%", "error"); return; }
    if (absencePenaltyOfficerRatePct !== undefined && (absencePenaltyOfficerRatePct < 0 || absencePenaltyOfficerRatePct > 100)) { show("Absence penalty rate must be 0–100%", "error"); return; }
    if (contributionLateFeeRatePct !== undefined && (contributionLateFeeRatePct < 0 || contributionLateFeeRatePct > 100)) { show("Contribution late fee rate must be 0–100%", "error"); return; }
    if (loanLateFeeRatePct !== undefined && (loanLateFeeRatePct < 0 || loanLateFeeRatePct > 100)) { show("Loan late fee rate must be 0–100%", "error"); return; }
    if (contributionLateFeeGraceDays !== undefined && contributionLateFeeGraceDays < 0) { show("Grace days cannot be negative", "error"); return; }
    if (loanLateFeeGraceDays !== undefined && loanLateFeeGraceDays < 0) { show("Grace days cannot be negative", "error"); return; }

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
      ...(contributionAmount              !== undefined && { contributionAmount }),
      ...(loanInterestRate                !== undefined && { loanInterestRate }),
      ...(latePenaltyRatePct              !== undefined && { latePenaltyRatePct }),
      ...(absencePenaltyMemberRatePct     !== undefined && { absencePenaltyMemberRatePct }),
      ...(absencePenaltyOfficerRatePct    !== undefined && { absencePenaltyOfficerRatePct }),
      ...(contributionLateFeeRatePct      !== undefined && { contributionLateFeeRatePct }),
      ...(contributionLateFeeGraceDays    !== undefined && { contributionLateFeeGraceDays }),
      contributionLateFeeStartDate: trimmedStartDate || undefined,
      ...(loanLateFeeRatePct              !== undefined && { loanLateFeeRatePct }),
      ...(loanLateFeeGraceDays            !== undefined && { loanLateFeeGraceDays }),
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
          ) : (
            // Audit section has its own single Filter control inside the
            // toolbar below — no duplicate button needed here.
            <View style={{ width: 60 }} />
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
                      ? "Interest accrues daily on the outstanding balance — no fixed monthly/30-day assumptions (bank-style amortization)"
                      : "Interest charged up front on the full principal for the whole term (SACCO-style flat rate)"
                  }
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
                <Text style={{ fontSize: 11, color: C.text3, paddingHorizontal: 4, marginTop: -8, marginBottom: 4 }}>
                  {ratePeriod === "annual"
                    ? `${loanRate || "0"}% per year ≈ ${round2((parseFloat(loanRate) || 0) / 12)}% per month — applied to the ${loanMethod === "reducing_balance" ? "outstanding balance" : "original loan amount"}`
                    : `${loanRate || "0"}% per month ≈ ${round2((parseFloat(loanRate) || 0) * 12)}% per year — applied to the ${loanMethod === "reducing_balance" ? "outstanding balance" : "original loan amount"}`}
                </Text>
              </View>
            </View>

            {/* Right Column */}
            <View style={isWide ? s.wideCol : undefined}>
              <SectionHeading label="Meeting Penalties" />
              <View style={s.formCard}>
                <Text style={{ fontSize: 12, color: C.text3, paddingHorizontal: 4, marginBottom: 12, lineHeight: 17 }}>
                  Penalties are interest-based — a percentage of the group's standard
                  contribution ({fmtCurrency(parseFloat(contribAmount) || 0)}), not a fixed amount.
                  As the contribution changes, penalties scale automatically.
                </Text>

                <Input
                  label="Late arrival — per 15 min (%)"
                  value={lateRatePct}
                  onChangeText={setLateRatePct}
                  keyboardType="numeric"
                  hint={`≈ ${fmtCurrency(round2((parseFloat(contribAmount) || 0) * (parseFloat(lateRatePct) || 0) / 100))} per 15 minutes late`}
                />
                <Divider />
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Absence — member (%)"
                      value={absenceMemberPct}
                      onChangeText={setAbsenceMemberPct}
                      keyboardType="numeric"
                      hint={`≈ ${fmtCurrency(round2((parseFloat(contribAmount) || 0) * (parseFloat(absenceMemberPct) || 0) / 100))}`}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Absence — officer (%)"
                      value={absenceOfficerPct}
                      onChangeText={setAbsenceOfficerPct}
                      keyboardType="numeric"
                      hint={`≈ ${fmtCurrency(round2((parseFloat(contribAmount) || 0) * (parseFloat(absenceOfficerPct) || 0) / 100))}`}
                    />
                  </View>
                </View>
              </View>

              <SectionHeading label="Late Payment Fees" />
              <View style={s.formCard}>
                <Text style={{ fontSize: 12, color: C.text3, paddingHorizontal: 4, marginBottom: 12, lineHeight: 17 }}>
                  Separate from meeting-attendance penalties above. These fees are
                  calculated on the AMOUNT DUE — the missed contribution, or the
                  specific overdue loan installment — not a flat figure. A grace
                  period delays eligibility after the due date passes. Contribution
                  fees also require a start date below, so enabling them never
                  reaches back into a member's full history. Fees are surfaced under
                  Reports → Earnings for an officer to apply with one tap; nothing
                  charges automatically in the background.
                </Text>

                <Text style={{ fontSize: 11, fontWeight: "700", color: C.text2, paddingHorizontal: 4, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Contributions
                </Text>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Fee rate (%)"
                      value={contribLateFeePct}
                      onChangeText={setContribLateFeePct}
                      keyboardType="numeric"
                      hint={`≈ ${fmtCurrency(round2((parseFloat(contribAmount) || 0) * (parseFloat(contribLateFeePct) || 0) / 100))} per missed contribution`}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Grace period (days)"
                      value={contribLateFeeGrace}
                      onChangeText={setContribLateFeeGrace}
                      keyboardType="numeric"
                      hint="Days after due date before a fee applies"
                    />
                  </View>
                </View>
                <DatePicker
                  label="Start calculating from"
                  value={contribLateFeeStart}
                  onChange={setContribLateFeeStart}
                  placeholder="Select start date"
                  hint={
                    contribLateFeeStart.trim()
                      ? "Missed contributions before this date are ignored — fees only apply from here forward"
                      : "Required to activate contribution late fees. Leave blank to keep them off, even with a rate set above."
                  }
                />

                <Divider />

                <Text style={{ fontSize: 11, fontWeight: "700", color: C.text2, paddingHorizontal: 4, marginTop: 4, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Loan Repayments
                </Text>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Fee rate (%)"
                      value={loanLateFeePct}
                      onChangeText={setLoanLateFeePct}
                      keyboardType="numeric"
                      hint="Applied to the overdue installment amount"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Grace period (days)"
                      value={loanLateFeeGrace}
                      onChangeText={setLoanLateFeeGrace}
                      keyboardType="numeric"
                      hint="Days after due date before a fee applies"
                    />
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


      {/* Permissions Section — search + click-to-expand */}
      {activeSection === "permissions" && (
        <View style={{ flex: 1 }}>
          {/* Search bar */}
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
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
            <Text style={{ fontSize: 12, color: C.text3, marginTop: 6 }}>
              Tap a member to manage their permissions. Admins always have full access.
            </Text>
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
                addContribution:      "Record / Add Contributions",
                addLoan:              "Apply for / Add Loans",
                addInvestment:        "Add Investments",
                approveContributions: "Approve Contributions",
                approveLoans:         "Approve Loans",
                approveInvestments:   "Approve Investments",
                viewAllReports:       "View All Reports & Member Data",
                downloadReports:      "Export & Download Reports",
                manageMeetings:       "Record & Manage Meetings",
                editMembers:          "Edit Member Profiles & Details",
                deleteRecords:        "Delete Financial Records",
                manageSettings:       "Edit Group Rules & Settings",
                updateMeetings:       "Update Meetings",
              };
              const PERM_GROUPS = [
                { label: "CREATE & APPLY", keys: ["addContribution", "addLoan", "addInvestment"] as (keyof MemberPermissions)[] },
                { label: "APPROVALS", keys: ["approveContributions", "approveLoans", "approveInvestments"] as (keyof MemberPermissions)[] },
                { label: "REPORTS & VISIBILITY", keys: ["viewAllReports", "downloadReports"] as (keyof MemberPermissions)[] },
                { label: "MANAGEMENT & OPERATIONS", keys: ["manageMeetings", "editMembers", "deleteRecords", "manageSettings"] as (keyof MemberPermissions)[] },
              ];

              return filtered.map((member) => {
                const perms = getMemberPerms(member);
                const isDirty = !!pendingPerms[member.id];
                const isSaving = permSaving === member.id;
                const isExpanded = expandedMemberId === member.id;
                const enabledCount = PERM_KEYS.filter(k => perms[k]).length;

                return (
                  <View key={member.id} style={ps.memberCard}>
                    {/* Collapsed header — always visible, tap to expand */}
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
                              : <Text style={ps.saveBtnText}>Save</Text>
                            }
                          </TouchableOpacity>
                        )}
                        <Text style={{ fontSize: 18, color: C.text3, paddingHorizontal: 4 }}>
                          {isExpanded ? "▲" : "▼"}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Expanded permissions — grouped with visual toggles */}
                    {isExpanded && (
                      <View style={ps.permGrid}>
                        {/* Quick Action Buttons */}
                        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                          <TouchableOpacity
                            style={ps.quickBtn}
                            onPress={() => {
                              const all: Record<string, boolean> = {};
                              PERM_KEYS.forEach(k => { all[k] = true; });
                              setPendingPerms(prev => ({ ...prev, [member.id]: all as any }));
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={ps.quickBtnText}>✔ Grant All</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[ps.quickBtn, { borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.06)" }]}
                            onPress={() => {
                              const none: Record<string, boolean> = {};
                              PERM_KEYS.forEach(k => { none[k] = false; });
                              setPendingPerms(prev => ({ ...prev, [member.id]: none as any }));
                            }}
                            activeOpacity={0.7}
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

      {/* Audit Log Section — dark professional UI */}
      {activeSection === "audit" && (
        <View style={aw.root}>

          {/* ── Toolbar: count + search + category dropdown + single filter ── */}
          <View style={aw.toolbar}>
            <Text style={aw.toolbarCount}>
              {filteredLogs.length.toLocaleString()} record{filteredLogs.length !== 1 ? "s" : ""}
              {hasFilters ? " (filtered)" : ""}
            </Text>
            <View style={aw.toolbarRight}>
              <View style={aw.searchBox}>
                <Text style={aw.searchIcon}>⌕</Text>
                <TextInput
                  style={aw.searchInput}
                  placeholder="Search logs…"
                  placeholderTextColor={C.text3}
                  value={searchTerm}
                  onChangeText={(v) => { setSearchTerm(v); setCurrentPage(1); }}
                />
                {!!searchTerm && (
                  <TouchableOpacity onPress={() => { setSearchTerm(""); setCurrentPage(1); }} hitSlop={{ top:6,bottom:6,left:6,right:6 }}>
                    <Text style={{ color: C.text3, fontSize: 14, paddingHorizontal: 4 }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Category dropdown — replaces the old horizontal chip-tab row */}
              <CategoryDropdown
                options={AUDIT_TABS}
                value={activeTab}
                onChange={(v) => { setActiveTab(v as AuditTab); setCurrentPage(1); }}
                counts={{
                  all: allAuditLogs.length,
                  failed: allAuditLogs.filter(l => l.action === "failed" || l.status === "failed").length,
                  deletions: allAuditLogs.filter(l => l.action === "deleted").length,
                  contributions: allAuditLogs.filter(l => l.entityType === "contribution").length,
                  loans: allAuditLogs.filter(l => l.entityType === "loan").length,
                  members: allAuditLogs.filter(l => l.entityType === "member").length,
                  investments: allAuditLogs.filter(l => l.entityType === "investment").length,
                }}
              />

              {/* Single date filter — opens the existing FilterModal (year/month/day/search) */}
              <TouchableOpacity style={[aw.filterBtn, hasFilters && aw.filterBtnActive]} onPress={openFilter} activeOpacity={0.8}>
                <Text style={[aw.filterBtnText, hasFilters && aw.filterBtnTextActive]}>
                  {hasFilters ? "Filtered ✕" : "Date Filter"}
                </Text>
              </TouchableOpacity>
              {hasFilters && (
                <TouchableOpacity onPress={clearFilters} activeOpacity={0.7}>
                  <Text style={aw.clearText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── Table (desktop) / Cards (mobile) — white theme, revert action ── */}
          {isWide ? (
            <View style={{ flex: 1 }}>
              <View style={aw.tableHead}>
                <Text style={[aw.thCell, { width: 170 }]}>TIMESTAMP</Text>
                <Text style={[aw.thCell, { width: 120 }]}>CATEGORY</Text>
                <Text style={[aw.thCell, { width: 110 }]}>ACTIVITY</Text>
                <Text style={[aw.thCell, { width: 130 }]}>USER</Text>
                <Text style={[aw.thCell, { flex: 1 }]}>CHANGE LOG</Text>
                <Text style={[aw.thCell, { width: 90, textAlign: "right" }]}>ACTIONS</Text>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
              >
                {filteredLogs.length === 0
                  ? <EmptyState hasFilters={hasFilters} />
                  : paginatedLogs.map((log, idx) => (
                      <React.Fragment key={log.id}>
                        <AuditTableRowWhite log={log} idx={idx} onRevert={() => handleRevertLog(log)} />
                      </React.Fragment>
                    ))
                }
                <Pagination currentPage={currentPage} totalPages={totalPages} onChange={setCurrentPage} wide />
              </ScrollView>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 80 }}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}
            >
              {filteredLogs.length === 0
                ? <EmptyState hasFilters={hasFilters} />
                : <>
                    <Text style={aw.mobileCount}>{startIndex}–{endIndex} of {filteredLogs.length}</Text>
                    {paginatedLogs.map((log) => (
                      <React.Fragment key={log.id}>
                        <AuditRowWhite log={log} onRevert={() => handleRevertLog(log)} />
                      </React.Fragment>
                    ))}
                    <Pagination currentPage={currentPage} totalPages={totalPages} onChange={setCurrentPage} />
                  </>
              }
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
  body:     { padding: 20, paddingBottom: 60, maxWidth: 860, alignSelf: "center", width: "100%" as any },
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

// ─── Audit tab card styles ────────────────────────────────────────────────────
const at = StyleSheet.create({
  card: {
    alignItems: "center", paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.elevated, minWidth: 80,
  },
  cardActive: { backgroundColor: C.primary, borderColor: C.primary },
  cardAlert:  { borderColor: "#f87171", backgroundColor: "#fef2f2" },
  cardIcon:   { fontSize: 16, marginBottom: 4 },
  cardLabel:  { fontSize: 11, fontWeight: "600", color: C.text2, marginBottom: 4 },
  cardLabelActive: { color: "#fff" },
  cardBadge:  {
    backgroundColor: C.bg, borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 1, minWidth: 22, alignItems: "center",
  },
  cardBadgeActive: { backgroundColor: "rgba(255,255,255,0.25)" },
  cardBadgeAlert: { backgroundColor: "#fee2e2" },
  cardBadgeText:  { fontSize: 10, fontWeight: "700", color: C.text3 },
  cardBadgeTextActive: { color: "#fff" },
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
  permRowActive: {
    backgroundColor: C.primary + "0a",
  },
  permLabel: { fontSize: 13, fontWeight: "500", color: C.text, flex: 1, paddingRight: 8 },
  quickBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1,
    borderColor: C.primary + "40",
    backgroundColor: C.primary + "0a",
  },
  quickBtnText: { fontSize: 11, fontWeight: "700", color: C.primary },
  togglePill: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: C.elevated,
    borderWidth: 1, borderColor: C.border,
    minWidth: 46, alignItems: "center",
  },
  togglePillActive: {
    backgroundColor: C.primary + "15",
    borderColor: C.primary,
  },
  toggleText: { fontSize: 9, fontWeight: "800", color: C.text3, letterSpacing: 0.5 },
  toggleTextActive: { color: C.primary },
  saveBtn: {
    backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: C.text2, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  searchBox: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.elevated, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, minHeight: 20 },
  permGroupLabel: {
    fontSize: 9, fontWeight: "800", color: C.text3, letterSpacing: 1.2,
    textTransform: "uppercase", paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4,
    backgroundColor: "transparent",
  },
});