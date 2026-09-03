// app/(tabs)/investments.tsx
//
// Extracted from loans.tsx, which previously combined loans and
// investments into one screen with a sub-tab toggle. Investments now
// have their own dedicated page, reachable only from the web sidebar
// (see app/(tabs)/_layout.tsx — this route is omitted from the mobile
// tab bar via href: null on mobile, same pattern as Wallet).
//
// Search/filter/pagination here deliberately match wallet.tsx's
// pattern (SearchBar + TabRow + Prev/Next pagination) rather than
// loans.tsx's old simple tab-only filtering, per an explicit request
// to make these consistent across the app.

import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useStore, useCurrentUserRole, useCurrentMember, useIsGroupView } from "../../stores/useStore";
import { useGroupInvestments, useCurrentMemberPermissions } from "../../stores/selectors";
import {
  TabRow, SearchBar, Card, Empty, useToast, Button, BottomModal, Input,
} from "../../components/ui";
import { S, R, Colors, C, T, fmtCurrency, fmtDate, round2, showConfirm } from "../../utils/theme";
import type { Investment } from "../../types";
import { KpiCard } from "../../components/ui/KpiCard";

const Chip = ({ label, bg, color }: { label: string; bg: string; color: string }) => (
  <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
    <Text style={{ fontSize: 10, fontWeight: "700", color, letterSpacing: 0.3 }}>{label}</Text>
  </View>
);

const Divider = () => <View style={{ height: 1, backgroundColor: C.border, marginHorizontal: 16 }} />;

const INVESTMENT_STATUS_LABEL: Record<string, string> = {
  pending_committee: "Awaiting Committee",
  pending: "Awaiting Accountant",
  open: "Active",
  closed: "Closed",
  matured: "Matured",
};
const INVESTMENT_STATUS_COLOR: Record<string, string> = {
  pending_committee: C.gold,
  pending: C.info,
  open: C.success,
  closed: C.text3,
  matured: C.gold,
};
const INVESTMENT_STATUS_BG: Record<string, string> = {
  pending_committee: C.goldBg,
  pending: C.infoBg,
  open: C.greenBg,
  closed: C.mutedBg,
  matured: C.goldBg,
};
const INVESTMENT_PENDING_STATUSES = ["pending_committee", "pending"];
const TABS = ["All", "Pending", "Active", "Matured", "Closed"];
const SORT_OPTIONS = [
  { value: "date_desc", label: "Newest" },
  { value: "date_asc", label: "Oldest" },
  { value: "amount_desc", label: "Largest" },
];
const PAGE_SIZE = 20;

export default function InvestmentsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { closeInvestment, deleteInvestment, approveInvestmentStep } = useStore();
  const investments = useGroupInvestments();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const permissions = useCurrentMemberPermissions();
  const isGroupView = useIsGroupView();
  const isAdmin = role === "admin";
  const { show, Toast } = useToast();

  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Investment | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeReturnAmount, setCloseReturnAmount] = useState("");
  const [closeActualReturn, setCloseActualReturn] = useState("");
  const [closing, setClosing] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalComment, setApprovalComment] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    investmentId: string; step: "committee" | "accountant"; approve: boolean;
  } | null>(null);

  const visible = useMemo(() => {
    if (isGroupView) return investments;
    return investments.filter((i: Investment) => i.createdBy === currentMember?.id);
  }, [investments, isGroupView, currentMember]);

  const byTab = useMemo(() => {
    if (tab === "Active")  return visible.filter((i: Investment) => i.status === "open");
    if (tab === "Closed")  return visible.filter((i: Investment) => i.status === "closed");
    if (tab === "Matured") return visible.filter((i: Investment) => (i.status as string) === "matured");
    if (tab === "Pending") return visible.filter((i: Investment) => INVESTMENT_PENDING_STATUSES.includes(i.status));
    return visible;
  }, [visible, tab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = byTab;
    if (q) {
      list = list.filter((i: Investment) =>
        i.investmentName.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q) ||
        (i.representativeName ?? "").toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    if (sort === "date_desc") sorted.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    else if (sort === "date_asc") sorted.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    else if (sort === "amount_desc") sorted.sort((a, b) => b.investmentAmount - a.investmentAmount);
    return sorted;
  }, [byTab, search, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const handleTabChange = (t: string) => { setTab(t); setPage(1); };
  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleSort = (v: string) => { setSort(v); setPage(1); };

  const totalInvested = useMemo(() => visible.reduce((s: number, i: Investment) => s + i.investmentAmount, 0), [visible]);
  const totalReturns  = useMemo(() => visible.reduce((s: number, i: Investment) => s + (i.actualReturn || 0), 0), [visible]);

  const openDetail = (inv: Investment) => { setSelected(inv); setShowDetail(true); };

  const handleApproval = async () => {
    if (!pendingAction) return;
    try {
      await approveInvestmentStep(
        pendingAction.investmentId,
        pendingAction.step,
        pendingAction.approve,
        approvalComment || undefined,
      );
      show(
        pendingAction.approve
          ? pendingAction.step === "committee" ? "Forwarded to accountant" : "Investment approved & activated"
          : "Investment rejected",
        pendingAction.approve ? "success" : "info"
      );
      setShowApprovalModal(false);
      setPendingAction(null);
      setApprovalComment("");
      setShowDetail(false);
    } catch (e: any) {
      show(e.message || "Approval failed", "error");
    }
  };

  const handleDelete = (inv: Investment) => {
    showConfirm(
      "Delete Investment",
      `Are you sure you want to delete "${inv.investmentName}"? This cannot be undone.`,
      async () => {
        try {
          await deleteInvestment(inv.id, "Deleted by user");
          show("Investment deleted");
          setShowDetail(false);
          setSelected(null);
        } catch (e: any) {
          show(e.message || "Failed to delete", "error");
        }
      },
      undefined,
      true
    );
  };

  const handleClose = async () => {
    if (!selected) return;
    const returnAmount = parseFloat(closeReturnAmount);
    if (!returnAmount || returnAmount <= 0) {
      show("Enter a valid return amount", "error");
      return;
    }
    let actualReturn: number | undefined;
    if (closeActualReturn.trim() !== "") {
      const parsed = parseFloat(closeActualReturn);
      if (!isNaN(parsed)) actualReturn = parsed;
    }
    setClosing(true);
    try {
      await closeInvestment(selected.id, returnAmount, actualReturn);
      show(`Investment closed! Return: ${fmtCurrency(returnAmount)}`, "success");
      setShowCloseModal(false);
      setSelected(null);
      setCloseReturnAmount("");
      setCloseActualReturn("");
      setShowDetail(false);
    } catch (error: any) {
      show(error.message || "Failed to close investment", "error");
    } finally {
      setClosing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Top action bar */}
      <View style={[ivt.topBar, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
        <View>
          <Text style={ivt.pageSummaryLabel}>{isGroupView ? "Group Portfolio" : "Personal Portfolio"}</Text>
          <Text style={ivt.pageSummaryTitle}>{isGroupView ? " " : " "}</Text>
        </View>
        {permissions.addInvestment && (
          <TouchableOpacity style={ivt.primaryBtn} onPress={() => router.push("/modals/add-investment")} activeOpacity={0.8}>
            <Text style={ivt.primaryBtnText}>+ New Investment</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={[{ paddingBottom: 100 }, isWide && { paddingHorizontal: 24 }]} showsVerticalScrollIndicator={false}>

        {/* ── Summary card ── */}
        <View style={[ivt.block, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          <View style={ivt.kpiGrid}>
            <KpiCard
              label="Total Invested"
              value={fmtCurrency(totalInvested)}
              icon="📊"
              subtext={`${visible.length} investments`}
              accentColor={C.primary}
              onPress={() => {}} 
            />
            <KpiCard
              label="Returns"
              value={fmtCurrency(totalReturns)}
              icon="📈"
              subtext="Total returns so far"
              accentColor={C.success}
              onPress={() => {}} 
            />
            <KpiCard
              label="Active"
              value={String(visible.filter(i => i.status === "open").length)}
              icon="🟢"
              subtext="Active investments"
              accentColor={C.success}
              onPress={() => { setTab("Active"); setPage(1); }}
            />
            <KpiCard
              label="Pending"
              value={String(visible.filter(i => i.status === "pending" || i.status === "pending_committee").length)}
              icon="⏳"
              subtext="Awaiting approval"
              accentColor={C.gold}
              onPress={() => { setTab("Pending"); setPage(1); }}
            />
          </View>
        </View>

        {/* ── Controls: search + tabs + sort — matches Wallet's pattern ── */}
        <View style={[ivt.controls, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          <View style={ivt.controlsTop}>
            <View style={{ flex: 1 }}>
              <SearchBar value={search} onChange={handleSearch} placeholder="Search investments…" />
            </View>
            <View style={ivt.sortRow}>
              {SORT_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[ivt.sortChip, sort === opt.value && ivt.sortChipActive]}
                  onPress={() => handleSort(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[ivt.sortChipText, sort === opt.value && ivt.sortChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TabRow tabs={TABS} active={tab} onChange={handleTabChange} />
        </View>

        {/* ── List — click a card to open full detail with all actions ── */}
        <View style={[{ marginTop: 8 }, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          {paginated.length === 0 ? (
            <Empty message="No investments found" icon="📊" />
          ) : (
            <View style={ivt.list}>
              {paginated.map((investment, i) => (
                <React.Fragment key={investment.id}>
                  <InvestmentRow investment={investment} onPress={() => openDetail(investment)} />
                  {i < paginated.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          )}

          {totalPages > 1 && (
            <View style={ivt.pagination}>
              <TouchableOpacity
                disabled={page <= 1}
                onPress={() => setPage(p => Math.max(1, p - 1))}
                style={[ivt.pageBtn, page <= 1 && ivt.pageBtnDisabled]}
              >
                <Text style={[ivt.pageBtnText, page <= 1 && ivt.pageBtnTextDisabled]}>Prev</Text>
              </TouchableOpacity>
              <Text style={ivt.pageLabel}>Page {page} of {totalPages}</Text>
              <TouchableOpacity
                disabled={page >= totalPages}
                onPress={() => setPage(p => Math.min(totalPages, p + 1))}
                style={[ivt.pageBtn, page >= totalPages && ivt.pageBtnDisabled]}
              >
                <Text style={[ivt.pageBtnText, page >= totalPages && ivt.pageBtnTextDisabled]}>Next</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Detail modal — every relevant action button lives here,
           opened only by tapping a row, per the same interaction
           pattern used on the redesigned Loans page. ── */}
      <BottomModal
        visible={showDetail && !!selected}
        onClose={() => { setShowDetail(false); setSelected(null); }}
        title="Investment Details"
      >
        <ScrollView style={{ maxHeight: 500 }}>
          {selected && (
            <View style={{ padding: 4 }}>
              <View style={{ alignItems: "center", marginBottom: 16 }}>
                <Text style={ivt.modalMember}>{selected.investmentName}</Text>
                <Text style={ivt.modalAmount}>{fmtCurrency(selected.investmentAmount)}</Text>
                <View style={{ marginTop: 8 }}>
                  <Chip
                    label={INVESTMENT_STATUS_LABEL[selected.status] || selected.status}
                    bg={INVESTMENT_STATUS_BG[selected.status] || C.mutedBg}
                    color={INVESTMENT_STATUS_COLOR[selected.status] || C.text3}
                  />
                </View>
              </View>

              <View style={ivt.detailGrid}>
                <View style={ivt.detailCell}>
                  <Text style={ivt.cellLbl}>Type</Text>
                  <Text style={ivt.cellVal}>{(selected.investmentType ?? "other").replace("_", " ")}</Text>
                </View>
                <View style={ivt.detailCell}>
                  <Text style={ivt.cellLbl}>Start Date</Text>
                  <Text style={ivt.cellVal}>{fmtDate(selected.startDate)}</Text>
                </View>
                <View style={ivt.detailCell}>
                  <Text style={ivt.cellLbl}>Expected Return</Text>
                  <Text style={ivt.cellVal}>{fmtCurrency(selected.expectedReturn || 0)}</Text>
                </View>
                {!!selected.expectedReturn && !!selected.investmentAmount && (
                  <View style={ivt.detailCell}>
                    <Text style={ivt.cellLbl}>Expected ROI</Text>
                    <Text style={ivt.cellVal}>
                      {round2(((selected.expectedReturn - selected.investmentAmount) / selected.investmentAmount) * 100)}%
                    </Text>
                  </View>
                )}
              </View>

              {selected.status === "closed" && selected.returnAmount !== undefined && (
                <View style={[ivt.detailGrid, { marginTop: 8 }]}>
                  <View style={ivt.detailCell}>
                    <Text style={ivt.cellLbl}>Actual Return</Text>
                    <Text style={ivt.cellVal}>{fmtCurrency(selected.returnAmount)}</Text>
                  </View>
                  <View style={ivt.detailCell}>
                    <Text style={ivt.cellLbl}>Profit/Loss</Text>
                    <Text style={[ivt.cellVal, { color: (selected.profit ?? 0) >= 0 ? C.success : C.error }]}>
                      {(selected.profit ?? 0) >= 0 ? "📈" : "📉"} {selected.profit !== undefined ? fmtCurrency(selected.profit) : "—"}
                    </Text>
                  </View>
                  {selected.actualReturn !== undefined && selected.investmentAmount > 0 && (
                    <View style={ivt.detailCell}>
                      <Text style={ivt.cellLbl}>Actual ROI</Text>
                      <Text style={[ivt.cellVal, { color: selected.actualReturn >= 0 ? C.success : C.error }]}>
                        {selected.actualReturn >= 0 ? "+" : ""}{selected.actualReturn}%
                      </Text>
                    </View>
                  )}
                  {selected.closedAt && (
                    <View style={ivt.detailCell}>
                      <Text style={ivt.cellLbl}>Closed</Text>
                      <Text style={ivt.cellVal}>{fmtDate(selected.closedAt)}</Text>
                    </View>
                  )}
                </View>
              )}

              {selected.description && (
                <View style={ivt.commentBox}>
                  <Text style={ivt.commentLabel}>Description</Text>
                  <Text style={ivt.commentText}>{selected.description}</Text>
                </View>
              )}

              {(selected.representativeName || selected.representativeRole) && (
                <View style={ivt.commentBox}>
                  <Text style={ivt.commentLabel}>Representative</Text>
                  <Text style={ivt.commentText}>
                    {selected.representativeName}
                    {selected.representativeRole ? ` (${selected.representativeRole})` : ""}
                  </Text>
                </View>
              )}

              {/* ── Actions — all here, gated by role + status, shown
                   only when tapped into this detail view ── */}
              <View style={{ marginTop: 16, gap: 8 }}>
                {isAdmin && selected.status === "pending_committee" && (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button
                      label="Approve"
                      onPress={() => { setPendingAction({ investmentId: selected.id, step: "committee", approve: true }); setShowApprovalModal(true); }}
                      style={{ flex: 1 }}
                    />
                    <Button
                      label="Reject"
                      variant="danger"
                      onPress={() => { setPendingAction({ investmentId: selected.id, step: "committee", approve: false }); setShowApprovalModal(true); }}
                      style={{ flex: 1 }}
                    />
                  </View>
                )}
                {isAdmin && selected.status === "pending" && (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button
                      label="Approve & Activate"
                      onPress={() => { setPendingAction({ investmentId: selected.id, step: "accountant", approve: true }); setShowApprovalModal(true); }}
                      style={{ flex: 1 }}
                    />
                    <Button
                      label="Reject"
                      variant="danger"
                      onPress={() => { setPendingAction({ investmentId: selected.id, step: "accountant", approve: false }); setShowApprovalModal(true); }}
                      style={{ flex: 1 }}
                    />
                  </View>
                )}
                {isAdmin && selected.status === "open" && (
                  <Button
                    label="Close Investment"
                    onPress={() => {
                      setCloseReturnAmount(String(selected.investmentAmount));
                      setShowCloseModal(true);
                    }}
                  />
                )}
                {isAdmin && ["open", "pending", "pending_committee", "closed"].includes(selected.status) && (
                  <Button label="🗑 Delete Investment" variant="danger" onPress={() => handleDelete(selected)} />
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </BottomModal>

      {/* ── Close investment modal ── */}
      <BottomModal
        visible={showCloseModal}
        onClose={() => { setShowCloseModal(false); setCloseReturnAmount(""); setCloseActualReturn(""); }}
        title="Close Investment"
      >
        {selected && (
          <View style={{ padding: 4 }}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <Text style={ivt.modalMember}>{selected.investmentName}</Text>
              <Text style={ivt.modalAmount}>Invested: {fmtCurrency(selected.investmentAmount)}</Text>
              <Text style={T.small}>Expected Return: {fmtCurrency(selected.expectedReturn || 0)}</Text>
            </View>
            <Input
              label="Actual Return Amount"
              value={closeReturnAmount}
              onChangeText={setCloseReturnAmount}
              keyboardType="numeric"
              placeholder="0"
            />
            <Input
              label="Actual ROI % (optional)"
              value={closeActualReturn}
              onChangeText={setCloseActualReturn}
              keyboardType="numeric"
              placeholder="Leave blank to auto-calculate"
            />
            {!!closeReturnAmount && !!selected.investmentAmount && (
              <View style={{ marginTop: 8, marginBottom: 12 }}>
                <Text style={T.small}>
                  {parseFloat(closeReturnAmount) >= selected.investmentAmount ? "📈 Profit" : "📉 Loss"}:{" "}
                  <Text style={{ color: parseFloat(closeReturnAmount) >= selected.investmentAmount ? C.success : C.error, fontWeight: "700" }}>
                    {fmtCurrency(Math.abs(parseFloat(closeReturnAmount) - selected.investmentAmount))}
                  </Text>
                </Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => { setShowCloseModal(false); setCloseReturnAmount(""); setCloseActualReturn(""); }}
                style={{ flex: 1 }}
              />
              <Button label="Close Investment" onPress={handleClose} loading={closing} style={{ flex: 1 }} />
            </View>
          </View>
        )}
      </BottomModal>

      {/* ── Approval confirm modal ── */}
      <BottomModal
        visible={showApprovalModal}
        onClose={() => { setShowApprovalModal(false); setApprovalComment(""); setPendingAction(null); }}
        title={pendingAction?.approve ? "Approve Investment" : "Reject Investment"}
      >
        {pendingAction && (() => {
          const inv = investments.find(i => i.id === pendingAction.investmentId);
          if (!inv) return null;
          return (
            <View style={{ padding: 4 }}>
              <View style={{ alignItems: "center", marginBottom: 16 }}>
                <Text style={ivt.modalMember}>{inv.investmentName}</Text>
                <Text style={ivt.modalAmount}>{fmtCurrency(inv.investmentAmount)}</Text>
              </View>
              <Text style={[T.small, { marginBottom: 12 }]}>
                {pendingAction.approve
                  ? pendingAction.step === "committee"
                    ? "This forwards the investment to the accountant for final approval."
                    : "Final accountant approval — investment will become active and debit the group wallet."
                  : "Rejecting will close this investment request."}
              </Text>
              <Input
                label="Comment (optional)"
                value={approvalComment}
                onChangeText={setApprovalComment}
                placeholder="Add a note…"
                multiline
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => { setShowApprovalModal(false); setApprovalComment(""); setPendingAction(null); }}
                  style={{ flex: 1 }}
                />
                <Button
                  label={pendingAction.approve ? "Confirm" : "Reject"}
                  variant={pendingAction.approve ? "primary" : "danger"}
                  onPress={handleApproval}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          );
        })()}
      </BottomModal>

      <Toast />
    </View>
  );
}

// ── List row — summary only; tap opens the detail modal where all
//     actions live ──────────────────────────────────────────────────
function InvestmentRow({ investment, onPress }: { investment: Investment; onPress: () => void }) {
  const statusLabel = INVESTMENT_STATUS_LABEL[investment.status] || investment.status;
  const statusColor = INVESTMENT_STATUS_COLOR[investment.status] || C.text3;
  const statusBg = INVESTMENT_STATUS_BG[investment.status] || C.mutedBg;
  const roi = investment.expectedReturn && investment.investmentAmount
    ? round2(((investment.expectedReturn - investment.investmentAmount) / investment.investmentAmount) * 100)
    : null;

  return (
    <TouchableOpacity style={ivt.row} onPress={onPress} activeOpacity={0.7}>
      <View style={ivt.rowIcon}>
        <Text style={{ fontSize: 16 }}>📊</Text>
      </View>
      <View style={ivt.rowMid}>
        <Text style={ivt.rowTitle} numberOfLines={1}>{investment.investmentName}</Text>
        <Text style={ivt.rowMeta}>
          {(investment.investmentType ?? "other").replace("_", " ")} · {fmtDate(investment.startDate)}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={ivt.rowAmount}>{fmtCurrency(investment.investmentAmount)}</Text>
        <View style={{ marginTop: 4 }}>
          <Chip label={statusLabel} bg={statusBg} color={statusColor} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const ivt = StyleSheet.create({
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  pageSummaryLabel: { fontSize: 10, fontWeight: "700", color: C.primary, textTransform: "uppercase", letterSpacing: 0.6 },
  pageSummaryTitle: { fontSize: 15, fontWeight: "800", color: C.text, letterSpacing: -0.2, marginTop: 1 },
  primaryBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  primaryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  //kpi card 
  block: { marginHorizontal: 16, marginBottom: 14 },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  summaryCard: {
    margin: 16, padding: 20, borderRadius: 18, backgroundColor: "#0B1C3D", overflow: "hidden",
  },
  cardAccentDot: {
    position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: 60,
    backgroundColor: "rgba(16,185,129,0.15)",
  },
  summaryLabel: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.6)", letterSpacing: 0.5 },
  summaryAmount: { fontSize: 30, fontWeight: "800", color: "#fff", marginTop: 4, letterSpacing: -0.5 },
  summaryPills: { flexDirection: "row", marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)" },
  summaryPill: { flex: 1 },
  summaryPillDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.12)", marginHorizontal: 12 },
  summaryPillLabel: { fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.5)", letterSpacing: 0.4 },
  summaryPillValue: { fontSize: 15, fontWeight: "800", marginTop: 2 },

  controls: { paddingHorizontal: 16, gap: 10 },
  controlsTop: { flexDirection: "row", gap: 8, alignItems: "center" },
  sortRow: { flexDirection: "row", gap: 6 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: C.mutedBg },
  sortChipActive: { backgroundColor: C.primary },
  sortChipText: { fontSize: 12, fontWeight: "600", color: C.text3 },
  sortChipTextActive: { color: "#fff" },

  list: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13 },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: C.mutedBg,
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  rowMid: { flex: 1, marginRight: 10 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: C.text },
  rowMeta: { fontSize: 12, color: C.text3, marginTop: 2, textTransform: "capitalize" },
  rowAmount: { fontSize: 14, fontWeight: "800", color: C.text },

  pagination: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16,
    paddingVertical: 20,
  },
  pageBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: C.mutedBg },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { fontSize: 13, fontWeight: "700", color: C.text },
  pageBtnTextDisabled: { color: C.text3 },
  pageLabel: { fontSize: 13, color: C.text3, fontWeight: "600" },

  modalMember: { fontSize: 17, fontWeight: "800", color: C.text, textAlign: "center" },
  modalAmount: { fontSize: 22, fontWeight: "800", color: C.primary, marginTop: 4 },

  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  detailCell: { minWidth: "45%", flex: 1 },
  cellLbl: { fontSize: 10, color: C.text3, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  cellVal: { fontSize: 14, fontWeight: "700", color: C.text },

  commentBox: {
    marginTop: 10, padding: 12, borderRadius: 10,
    backgroundColor: C.infoBg, borderWidth: 1, borderColor: "rgba(59,130,246,0.2)",
  },
  commentLabel: { fontSize: 11, fontWeight: "700", color: C.infoText, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 },
  commentText: { fontSize: 13, color: C.text, lineHeight: 18 },
});