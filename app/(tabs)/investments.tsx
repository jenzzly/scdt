// app/(tabs)/investments.tsx
import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, StatusBar, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useStore, useCurrentUserRole, useCurrentMember, useIsGroupView } from "../../stores/useStore";
import { useGroupInvestments, useCurrentMemberPermissions } from "../../stores/selectors";
import {
  TabRow, SearchBar, Card, Empty, useToast, Toast, Button, BottomModal, Input,
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
  // const { show, Toast } = useToast();
  const { show, visible, msg, type } = useToast();

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

  const visibleInvestments = useMemo(() => {
    if (isGroupView) return investments;
    return investments.filter((i: Investment) => i.createdBy === currentMember?.id);
  }, [investments, isGroupView, currentMember]);

  const byTab = useMemo(() => {
    if (tab === "Active")  return visibleInvestments.filter((i: Investment) => i.status === "open");
    if (tab === "Closed")  return visibleInvestments.filter((i: Investment) => i.status === "closed");
    if (tab === "Matured") return visibleInvestments.filter((i: Investment) => (i.status as string) === "matured");
    if (tab === "Pending") return visibleInvestments.filter((i: Investment) => INVESTMENT_PENDING_STATUSES.includes(i.status));
    return visibleInvestments;
  }, [visibleInvestments, tab]);

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

  const totalInvested = useMemo(() => visibleInvestments.reduce((s: number, i: Investment) => s + i.investmentAmount, 0), [visibleInvestments]);
  const totalReturns  = useMemo(() => visibleInvestments.reduce((s: number, i: Investment) => s + (i.actualReturn || 0), 0), [visibleInvestments]);

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
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      {/* Top action bar */}
      <View style={[ivt.topBar, isWide && { maxWidth: 960, alignSelf: "center" as any, width: "100%" as any }]}>
        <View>
          <Text style={ivt.pageSummaryLabel}>{isGroupView ? "Group" : "Personal"}</Text>
          <Text style={ivt.pageSummaryTitle}>{isGroupView ? " " : " "}</Text>
        </View>
        {permissions.addLoan && (
          <TouchableOpacity style={ivt.addInlineBtn} onPress={() => router.push("/modals/add-investment")} activeOpacity={0.8}>
            <Text style={ivt.addInlineBtnText}>+ New Investment</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView 
        contentContainerStyle={[
          { paddingBottom: 100, paddingTop: 16 },
          isWide && { paddingHorizontal: 24 }
        ]} 
        showsVerticalScrollIndicator={false}
      >
        {/* ── KPI Cards ── */}
        <View style={[ivt.block, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          <View style={ivt.kpiGrid}>
            <KpiCard
              label="Total Invested"
              value={fmtCurrency(totalInvested)}
              icon="📊"
              subtext={`${visibleInvestments.length} investments`}
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
              value={String(visibleInvestments.filter(i => i.status === "open").length)}
              icon="🟢"
              subtext="Active investments"
              accentColor={C.success}
              onPress={() => { setTab("Active"); setPage(1); }}
            />
            <KpiCard
              label="Pending"
              value={String(visibleInvestments.filter(i => i.status === "pending" || i.status === "pending_committee").length)}
              icon="⏳"
              subtext="Awaiting approval"
              accentColor={C.gold}
              onPress={() => { setTab("Pending"); setPage(1); }}
            />
          </View>
        </View>

        {/* ── Controls: search + tabs + sort ── */}
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

        {/* ── List ── */}
        <View style={[{ marginTop: 8 }, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          {paginated.length === 0 ? (
            <Empty message="No investments found" icon="📊" />
          ) : (
            <View style={ivt.list}>
              {paginated.map((investment, i) => (
                <React.Fragment key={investment.id}>
                  <InvestmentRow
                    investment={investment}
                    actionLabel={
                      isAdmin &&
                      (investment.status === "pending_committee" ||
                        investment.status === "pending")
                        ? "Awaiting your review"
                        : null
                    }
                    onPress={() => openDetail(investment)}
                  />
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

      {/* ── Detail modal ── */}
      <BottomModal
        visible={showDetail && !!selected}
        onClose={() => {
          setShowDetail(false);
          setSelected(null);
        }}
        title="Investment Details"
      >
        {selected && (() => {
          const statusLabel =
            INVESTMENT_STATUS_LABEL[selected.status] || selected.status;
          const statusColor =
            INVESTMENT_STATUS_COLOR[selected.status] || C.text3;
          const statusBg = INVESTMENT_STATUS_BG[selected.status] || C.mutedBg;
          const typeKey = selected.investmentType ?? "other";
          const icon = TYPE_ICON[typeKey] ?? "💼";
          const typeName = TYPE_LABEL[typeKey] ?? "Investment";

          const expectedROI =
            selected.expectedReturn && selected.investmentAmount
              ? round2(
                  ((selected.expectedReturn - selected.investmentAmount) /
                    selected.investmentAmount) *
                    100,
                )
              : null;

          const profitLoss =
            selected.returnAmount !== undefined
              ? round2(selected.returnAmount - selected.investmentAmount)
              : null;

          const canActOnThis =
            isAdmin &&
            (selected.status === "pending_committee" ||
              selected.status === "pending");

          const showPrimaryActions =
            canActOnThis ||
            (isAdmin && selected.status === "open");

          return (
            <ScrollView
              contentContainerStyle={ivt.modalBody}
              showsVerticalScrollIndicator={false}
            >
              {/* ── Header ─────────────────────────────────── */}
              <View style={ivt.modalHeader}>
                <View style={ivt.modalHeaderIcon}>
                  <Text style={{ fontSize: 22 }}>{icon}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={ivt.modalHeaderName} numberOfLines={2}>
                    {selected.investmentName}
                  </Text>
                  <Text style={ivt.modalHeaderMeta} numberOfLines={1}>
                    {typeName} · {fmtDate(selected.startDate)}
                  </Text>
                </View>
                <View
                  style={[
                    ivt.modalStatusChip,
                    { backgroundColor: statusBg },
                  ]}
                >
                  <Text
                    style={[
                      ivt.modalStatusChipText,
                      { color: statusColor },
                    ]}
                    numberOfLines={1}
                  >
                    {statusLabel}
                  </Text>
                </View>
              </View>

              {/* ── Hero (invested amount) ────────────────── */}
              <View style={ivt.investmentHero}>
                <Text style={ivt.heroLabel}>INVESTED</Text>
                <Text
                  style={ivt.heroValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(selected.investmentAmount)}
                </Text>
              </View>

              {/* ── Metric strip ──────────────────────────── */}
              <View style={ivt.metricRow}>
                <View style={ivt.metricCol}>
                  <Text style={ivt.metricLbl}>Expected</Text>
                  <Text
                    style={[ivt.metricVal, { color: C.success }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {fmtCurrency(selected.expectedReturn || 0)}
                  </Text>
                  <Text style={ivt.metricSub} numberOfLines={1}>
                    return
                  </Text>
                </View>

                <View style={ivt.metricDiv} />

                <View style={ivt.metricCol}>
                  <Text style={ivt.metricLbl}>Exp. ROI</Text>
                  <Text
                    style={[
                      ivt.metricVal,
                      {
                        color:
                          (expectedROI ?? 0) >= 0
                            ? C.success
                            : C.error,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {expectedROI !== null
                      ? `${expectedROI > 0 ? "+" : ""}${expectedROI}%`
                      : "—"}
                  </Text>
                  <Text style={ivt.metricSub} numberOfLines={1}>
                    estimate
                  </Text>
                </View>

                {selected.status === "closed" &&
                selected.returnAmount !== undefined ? (
                  <>
                    <View style={ivt.metricDiv} />
                    <View style={ivt.metricCol}>
                      <Text style={ivt.metricLbl}>Actual</Text>
                      <Text
                        style={[
                          ivt.metricVal,
                          {
                            color:
                              (profitLoss ?? 0) >= 0
                                ? C.success
                                : C.error,
                          },
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {fmtCurrency(selected.returnAmount)}
                      </Text>
                      <Text style={ivt.metricSub} numberOfLines={1}>
                        returned
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={ivt.metricDiv} />
                    <View style={ivt.metricCol}>
                      <Text style={ivt.metricLbl}>Maturity</Text>
                      <Text
                        style={[ivt.metricVal, { color: C.text }]}
                        numberOfLines={1}
                      >
                        {selected.maturityDate
                          ? fmtDate(selected.maturityDate)
                          : "—"}
                      </Text>
                      <Text style={ivt.metricSub} numberOfLines={1}>
                        date
                      </Text>
                    </View>
                  </>
                )}
              </View>

              {/* ── Type-specific info ────────────────────── */}
              {(selected.upiNumber ||
                selected.locationAddress ||
                selected.contactPhone) && (
                <View style={ivt.infoCard}>
                  <Text style={ivt.infoCardLbl}>INVESTMENT DETAILS</Text>

                  {selected.upiNumber ? (
                    <View style={ivt.infoRow}>
                      <Text style={ivt.infoKey}>
                        {typeKey === "real_estate"
                          ? "UPI Number"
                          : typeKey === "stocks"
                          ? "Ticker"
                          : typeKey === "fixed_deposit"
                          ? "Account No."
                          : typeKey === "business"
                          ? "Registration"
                          : "Reference"}
                      </Text>
                      <Text
                        style={ivt.infoVal}
                        numberOfLines={1}
                      >
                        {selected.upiNumber}
                      </Text>
                    </View>
                  ) : null}

                  {selected.locationAddress ? (
                    <View style={ivt.infoRow}>
                      <Text style={ivt.infoKey}>
                        {typeKey === "stocks" ? "Exchange" : "Location"}
                      </Text>
                      <Text
                        style={[ivt.infoVal, { flex: 1, textAlign: "right" }]}
                        numberOfLines={2}
                      >
                        {selected.locationAddress}
                      </Text>
                    </View>
                  ) : null}

                  {selected.contactPhone ? (
                    <View style={ivt.infoRow}>
                      <Text style={ivt.infoKey}>Contact</Text>
                      <Text style={ivt.infoVal} numberOfLines={1}>
                        {selected.contactPhone}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}

              {/* ── Representative ────────────────────────── */}
              {(selected.representativeName ||
                selected.representativeRole ||
                selected.representativeId) && (
                <View style={ivt.infoCard}>
                  <Text style={ivt.infoCardLbl}>REPRESENTATIVE</Text>

                  {selected.representativeName ? (
                    <View style={ivt.infoRow}>
                      <Text style={ivt.infoKey}>Name</Text>
                      <Text style={ivt.infoVal}>
                        {selected.representativeName}
                      </Text>
                    </View>
                  ) : null}

                  {selected.representativeRole ? (
                    <View style={ivt.infoRow}>
                      <Text style={ivt.infoKey}>Role</Text>
                      <Text style={ivt.infoVal}>
                        {selected.representativeRole}
                      </Text>
                    </View>
                  ) : null}

                  {selected.representativeId ? (
                    <View style={ivt.infoRow}>
                      <Text style={ivt.infoKey}>ID</Text>
                      <Text style={ivt.infoVal}>
                        {selected.representativeId}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}

              {/* ── Description ───────────────────────────── */}
              {selected.description ? (
                <View style={ivt.infoCard}>
                  <Text style={ivt.infoCardLbl}>DESCRIPTION</Text>
                  <Text style={ivt.infoBody}>{selected.description}</Text>
                </View>
              ) : null}

              {/* ── Closed investment: P/L summary ────────── */}
              {selected.status === "closed" &&
                selected.returnAmount !== undefined && (
                  <View
                    style={[
                      ivt.plCard,
                      {
                        backgroundColor:
                          (profitLoss ?? 0) >= 0
                            ? C.greenBg
                            : C.redBg,
                        borderColor:
                          (profitLoss ?? 0) >= 0
                            ? "rgba(16,185,129,0.3)"
                            : "rgba(239,68,68,0.3)",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        ivt.plLabel,
                        {
                          color:
                            (profitLoss ?? 0) >= 0
                              ? C.success
                              : C.error,
                        },
                      ]}
                    >
                      {(profitLoss ?? 0) >= 0 ? "📈 PROFIT" : "📉 LOSS"}
                    </Text>
                    <Text
                      style={[
                        ivt.plValue,
                        {
                          color:
                            (profitLoss ?? 0) >= 0
                              ? C.success
                              : C.error,
                        },
                      ]}
                    >
                      {fmtCurrency(Math.abs(profitLoss ?? 0))}
                    </Text>
                    {selected.actualReturn !== undefined ? (
                      <Text style={ivt.plSub}>
                        Actual ROI: {selected.actualReturn >= 0 ? "+" : ""}
                        {selected.actualReturn}%
                      </Text>
                    ) : null}
                    {selected.closedAt ? (
                      <Text style={ivt.plSub}>
                        Closed {fmtDate(selected.closedAt)}
                      </Text>
                    ) : null}
                  </View>
                )}

              {/* ── Primary actions ───────────────────────── */}
              {showPrimaryActions && (
                <View style={ivt.primaryActions}>
                  {isAdmin && selected.status === "pending_committee" && (
                    <>
                      <TouchableOpacity
                        style={ivt.rejectBtn}
                        onPress={() => {
                          setPendingAction({
                            investmentId: selected.id,
                            step: "committee",
                            approve: false,
                          });
                          setShowApprovalModal(true);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={ivt.rejectBtnText}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={ivt.approveBtn}
                        onPress={() => {
                          setPendingAction({
                            investmentId: selected.id,
                            step: "committee",
                            approve: true,
                          });
                          setShowApprovalModal(true);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={ivt.approveBtnText}>
                          Forward
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {isAdmin && selected.status === "pending" && (
                    <>
                      <TouchableOpacity
                        style={ivt.rejectBtn}
                        onPress={() => {
                          setPendingAction({
                            investmentId: selected.id,
                            step: "accountant",
                            approve: false,
                          });
                          setShowApprovalModal(true);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={ivt.rejectBtnText}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={ivt.approveBtn}
                        onPress={() => {
                          setPendingAction({
                            investmentId: selected.id,
                            step: "accountant",
                            approve: true,
                          });
                          setShowApprovalModal(true);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={ivt.approveBtnText}>
                          Approve & Activate
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {isAdmin && selected.status === "open" && (
                    <TouchableOpacity
                      style={ivt.closeBtn}
                      onPress={() => {
                        setCloseReturnAmount(
                          String(selected.investmentAmount),
                        );
                        setShowCloseModal(true);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={ivt.closeBtnText}>
                        💰 Close &amp; Record Return
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* ── Admin zone ────────────────────────────── */}
              {isAdmin &&
                ["open", "pending", "pending_committee", "closed"].includes(
                  selected.status,
                ) && (
                  <View style={ivt.adminZone}>
                    <Text style={ivt.adminZoneLabel}>ADMIN ACTIONS</Text>
                    <TouchableOpacity
                      style={ivt.adminBtnNeutral}
                      onPress={() => {
                        // Close the detail sheet first. `router.push`
                        // mounts the edit screen on top without
                        // unmounting this modal, so leaving it open
                        // leaves the detail sheet visible behind (and
                        // back through) the edit form. Same pattern
                        // handleDelete uses.
                        const id = selected.id;
                        setShowDetail(false);
                        setSelected(null);
                        router.push({
                          pathname: "/modals/edit-investment",
                          params: { id },
                        });
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={ivt.adminBtnNeutralText}>
                        Edit Investment
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={ivt.adminBtnDanger}
                      onPress={() => handleDelete(selected)}
                      activeOpacity={0.8}
                    >
                      <Text style={ivt.adminBtnDangerText}>
                        Delete Investment
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

              {/* ── Close ─────────────────────────────────── */}
              <TouchableOpacity
                style={ivt.closeModalBtn}
                onPress={() => {
                  setShowDetail(false);
                  setSelected(null);
                }}
                activeOpacity={0.8}
              >
                <Text style={ivt.closeModalBtnText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          );
        })()}
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
      <Toast visible={visible} msg={msg} type={type}/>
    </View>
  );
}

// ── Type metadata ────────────────────────────────────────────
const TYPE_ICON: Record<string, string> = {
  real_estate: "🏘️",
  agriculture: "🌾",
  business: "🏢",
  stocks: "📈",
  fixed_deposit: "🏦",
  other: "💼",
};

const TYPE_LABEL: Record<string, string> = {
  real_estate: "Real Estate",
  agriculture: "Agriculture",
  business: "Business",
  stocks: "Stocks",
  fixed_deposit: "Fixed Deposit",
  other: "Other",
};

// Returns the type-specific reference value to show as row subtext.
// Land → UPI; stocks → ticker; fixed deposit → account number;
// business → reg no.; agriculture → location.
function typeReference(inv: Investment): string | null {
  const t = inv.investmentType ?? "other";
  if (t === "real_estate") return inv.upiNumber ?? inv.locationAddress ?? null;
  if (t === "stocks") return inv.upiNumber ?? null;
  if (t === "fixed_deposit") return inv.upiNumber ?? null;
  if (t === "business") return inv.upiNumber ?? null;
  if (t === "agriculture") return inv.locationAddress ?? null;
  return inv.upiNumber ?? inv.locationAddress ?? null;
}

// ── List row ──────────────────────────────────────────────────
function InvestmentRow({
  investment,
  onPress,
  actionLabel,
}: {
  investment: Investment;
  onPress: () => void;
  actionLabel?: string | null;
}) {
  const statusLabel =
    INVESTMENT_STATUS_LABEL[investment.status] || investment.status;
  const statusColor =
    INVESTMENT_STATUS_COLOR[investment.status] || C.text3;
  const statusBg = INVESTMENT_STATUS_BG[investment.status] || C.mutedBg;

  const typeKey = investment.investmentType ?? "other";
  const icon = TYPE_ICON[typeKey] ?? "💼";
  const typeName = TYPE_LABEL[typeKey] ?? "Investment";

  const ref = typeReference(investment);
  const isPending = INVESTMENT_PENDING_STATUSES.includes(investment.status);
  const showActionPill = !!actionLabel && isPending;

  const stripeColor = showActionPill ? C.gold : statusColor;

  return (
    <TouchableOpacity
      style={[
        ivt.row,
        { borderLeftColor: stripeColor },
        showActionPill && ivt.rowActionable,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={ivt.rowIcon}>
        <Text style={{ fontSize: 18 }}>{icon}</Text>
      </View>

      <View style={ivt.rowMid}>
        <Text style={ivt.rowTitle} numberOfLines={1}>
          {investment.investmentName}
        </Text>
        <Text style={ivt.rowMeta} numberOfLines={1}>
          {typeName}
          {ref ? ` · ${ref}` : ""} · {fmtDate(investment.startDate)}
        </Text>

        {showActionPill && (
          <View style={ivt.actionNeededPill}>
            <Text style={ivt.actionNeededText}>
              ⚡ {actionLabel}
            </Text>
          </View>
        )}
      </View>

      <View style={{ alignItems: "flex-end" }}>
        <Text style={ivt.rowAmount}>
          {fmtCurrency(investment.investmentAmount)}
        </Text>
        <View style={{ marginTop: 4 }}>
          <Chip label={statusLabel} bg={statusBg} color={statusColor} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const ivt = StyleSheet.create({
    topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  pageSummaryLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.primary,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  pageSummaryTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.2,
    marginTop: 1,
  },
  addBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  addInlineBtn: {
    backgroundColor: C.primary, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  addInlineBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  // kpi card 
  block: { 
    marginHorizontal: 16, 
    marginBottom: 14,
    ...Platform.select({
      web: {},
      default: { marginHorizontal: 12 }
    })
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    ...Platform.select({
      web: {},
      default: { gap: 8 }
    })
  },

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

  // ── Row enhancements ──
  rowActionable: {
    backgroundColor: "rgba(245,158,11,0.07)",
  },
  actionNeededPill: {
    marginTop: 6,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: C.goldBg,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.4)",
  },
  actionNeededText: {
    fontSize: 10,
    fontWeight: "800",
    color: C.gold,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },

  // ── Detail modal ──
  modalBody: { padding: 16, paddingBottom: 40 },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  modalHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: C.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  modalHeaderName: {
    fontSize: 16,
    fontWeight: "800",
    color: C.text,
  },
  modalHeaderMeta: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },
  modalStatusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    flexShrink: 0,
    maxWidth: 130,
  },
  modalStatusChipText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  investmentHero: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
    padding: 18,
    marginBottom: 12,
  },
  heroLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: C.text3,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  heroValue: {
    fontSize: 28,
    fontWeight: "800",
    color: C.primary,
    letterSpacing: -0.8,
  },

  metricRow: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
    paddingVertical: 14,
    marginBottom: 12,
  },
  metricCol: { flex: 1, alignItems: "center", minWidth: 0, paddingHorizontal: 4 },
  metricDiv: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: C.borderLight,
  },
  metricLbl: {
    fontSize: 9,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metricVal: {
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 2,
  },
  metricSub: {
    fontSize: 9,
    color: C.text3,
    fontWeight: "600",
    textAlign: "center",
  },

  infoCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  infoCardLbl: {
    fontSize: 9,
    fontWeight: "800",
    color: C.text3,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
    gap: 12,
  },
  infoKey: {
    fontSize: 12,
    color: C.text3,
    fontWeight: "600",
    flexShrink: 0,
  },
  infoVal: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
    flexShrink: 0,
  },
  infoBody: {
    fontSize: 13,
    color: C.text2,
    lineHeight: 19,
  },

  plCard: {
    borderRadius: R.lg,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    alignItems: "center",
  },
  plLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  plValue: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginBottom: 6,
  },
  plSub: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },

  primaryActions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  approveBtn: {
    flex: 1,
    backgroundColor: C.success,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  approveBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  rejectBtnText: {
    color: C.error,
    fontSize: 14,
    fontWeight: "800",
  },
  closeBtn: {
    flex: 1,
    backgroundColor: C.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  closeBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },

  adminZone: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  adminZoneLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: C.text3,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  adminBtnNeutral: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  adminBtnNeutralText: {
    color: C.text2,
    fontSize: 13,
    fontWeight: "700",
  },
  adminBtnDanger: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  adminBtnDangerText: {
    color: C.error,
    fontSize: 13,
    fontWeight: "700",
  },

  closeModalBtn: {
    backgroundColor: C.mutedBg,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  closeModalBtnText: {
    color: C.text2,
    fontSize: 14,
    fontWeight: "700",
  },
});