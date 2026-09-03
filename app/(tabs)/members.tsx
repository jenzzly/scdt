// app/(tabs)/members.tsx
import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform,
  useWindowDimensions, TextInput, Alert, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore, useGroupMembers, useGroupWallet, useGroupContributions,
  useCurrentUserRole, useCurrentMember, useIsAdminView,
  useCurrentMemberPermissions, useIsGroupView,
} from "../../stores/useStore";
import {
  SearchBar, Card, Badge, Empty, Button, Avatar, BottomModal,
  TabRow, Input, Select, useToast, InfoRow,
} from "../../components/ui";
import { KpiCard } from "../../components/ui/KpiCard";
import { Colors, C, T, S, R, fmtCurrency, fmtDate, showConfirm, round2 } from "../../utils/theme";
import { createUserAsAdmin, resetUserPasswordAsAdmin } from "../../lib/auth/adminUsers";
import { USER_ROLES, ROLE_LABELS } from "../../types/roles";
import type { Member } from "../../types";
import * as FS from "../../lib/firestore";
import { exportCsv, exportPdf } from "../../utils/export";

const STATUS_BADGE: Record<string, "teal" | "gold" | "green" | "red" | "muted"> = {
  active: "green",
  pending: "gold",
  inactive: "muted",
  suspended: "red",
  exited: "muted",
};

const ROLE_BADGE: Record<string, "teal" | "gold" | "blue" | "green" | "red"> = {
  admin: "red",
  accountant: "blue",
  loan_officer: "green",
  committee: "gold",
  member: "teal",
  audit: "muted",
  groups: "muted",
};

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

export default function MembersScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === "web" && width >= 768;
  const { show, Toast } = useToast();

  const activeGroupId = useStore(s => s.activeGroupId);
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const isAdminView = useIsAdminView();
  const isGroupView = useIsGroupView();
  const { deleteMember } = useStore();
  const permissions = useCurrentMemberPermissions();

  // Move these BEFORE the useEffect that uses them
  const members = useGroupMembers();
  const wallet = useGroupWallet();
  const contributions = useGroupContributions();

  // Debug logging - now members is defined before this
  useEffect(() => {
    console.log("[MembersScreen] ========== DEBUG ==========");
    console.log("[MembersScreen] isGroupView:", isGroupView);
    console.log("[MembersScreen] role:", role);
    console.log("[MembersScreen] isAdmin:", role === "admin");
    console.log("[MembersScreen] permissions:", permissions);
    console.log("[MembersScreen] currentMember:", currentMember?.fullName);
    console.log("[MembersScreen] members count:", members?.length || 0);
    console.log("[MembersScreen] ============================");
  }, [isGroupView, role, permissions, currentMember, members]);

  // Check if user is admin or has admin permissions
  const isAdmin = role === "admin";
  const canManageMembers = isAdmin || ["accountant", "loan_officer"].includes(role);
  const canExport = permissions?.downloadReports || isAdmin;
  const canCreateMember = permissions?.addMember || isAdmin;

  // State
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  const [createForm, setCreateForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    role: "member",
  });

  // Filter members based on view mode (Group vs Personal)
  const visibleMembers = useMemo(() => {
    // If in group view, show all members
    if (isGroupView) {
      return members;
    }
    // If in personal view, show only the current user
    return members.filter(m => m.id === currentMember?.id);
  }, [members, isGroupView, currentMember]);

  // Filtered & sorted members
  const filtered = useMemo(() => {
    let list = [...visibleMembers];

    if (statusFilter !== "all") {
      list = list.filter(m => m.status === statusFilter);
    }

    if (sortBy === "name") {
      list.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    } else if (sortBy === "date_joined") {
      list.sort((a, b) => new Date(b.dateJoined || "").getTime() - new Date(a.dateJoined || "").getTime());
    } else if (sortBy === "contributions") {
      list.sort((a, b) => {
        const aStats = getMemberStats(a, wallet, contributions);
        const bStats = getMemberStats(b, wallet, contributions);
        return bStats.totalContributions - aStats.totalContributions;
      });
    }

    return list;
  }, [visibleMembers, statusFilter, sortBy, wallet, contributions]);

  // Summary stats - use visibleMembers for accurate counts based on view
  const stats = useMemo(() => {
    const active = visibleMembers.filter(m => m.status === "active").length;
    const pending = visibleMembers.filter(m => m.status === "pending").length;
    const inactive = visibleMembers.filter(m => !["active", "pending"].includes(m.status)).length;
    const total = visibleMembers.length;
    return { total, active, pending, inactive };
  }, [visibleMembers]);

  // Handlers
  const handleCreateUser = async () => {
    if (!createForm.fullName.trim()) {
      show("Full name is required", "error");
      return;
    }
    if (!createForm.email.trim()) {
      show("Email is required", "error");
      return;
    }
    if (!activeGroupId || !currentMember?.userId) {
      show("Group or user not loaded", "error");
      return;
    }

    setCreatingUser(true);
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
      setShowCreateModal(false);
      setCreateForm({ fullName: "", email: "", phone: "", role: "member" });
    } catch (e: any) {
      show(e.message || "Failed to create user", "error");
    } finally {
      setCreatingUser(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedMember?.email || !activeGroupId || !currentMember?.userId) {
      show("Missing information", "error");
      return;
    }

    setResettingPassword(true);
    try {
      const result = await resetUserPasswordAsAdmin(
        selectedMember.email,
        currentMember.userId,
        currentMember.fullName || "Admin",
        activeGroupId
      );

      if (!result.success) {
        show(result.error || "Failed to send password reset email", "error");
        return;
      }

      show("Password reset email sent to " + selectedMember.email);
      setShowActionModal(false);
    } catch (e: any) {
      show(e.message || "Failed to send password reset email", "error");
    } finally {
      setResettingPassword(false);
    }
  };

  const handleDeleteMember = async () => {
    if (!selectedMember || !activeGroupId) return;

    // Check if member has financial history
    const hasHistory =
      contributions.some((c) => c.memberId === selectedMember.id) ||
      wallet.some((w) => w.memberId === selectedMember.id);

    if (hasHistory) {
      show("Cannot delete member with financial history. Deactivate instead.", "error");
      return;
    }

    try {
      await deleteMember(selectedMember.id);
      show(`Member ${selectedMember.fullName} removed`);
      setShowDeleteModal(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to delete member", "error");
    }
  };

  const handleApproveMember = async () => {
    if (!selectedMember || !activeGroupId) return;

    try {
      await FS.updateMember(activeGroupId, selectedMember.id, { status: "active" });
      show(`${selectedMember.fullName} approved`);
      setShowActionModal(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to approve member", "error");
    }
  };

  const handleDeactivateMember = async () => {
    if (!selectedMember || !activeGroupId) return;

    try {
      await FS.updateMember(activeGroupId, selectedMember.id, { status: "inactive" });
      show(`${selectedMember.fullName} deactivated`);
      setShowActionModal(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to deactivate member", "error");
    }
  };

  const handleReactivateMember = async () => {
    if (!selectedMember || !activeGroupId) return;

    try {
      await FS.updateMember(activeGroupId, selectedMember.id, { status: "active" });
      show(`${selectedMember.fullName} reactivated`);
      setShowActionModal(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to reactivate member", "error");
    }
  };

  const handleEditMember = async () => {
    // This would open an edit modal - for now just show a toast
    show("Edit functionality coming soon");
  };

  const openMemberActions = (member: Member) => {
    console.log("[MembersScreen] Opening actions for:", member.fullName);
    setSelectedMember(member);
    setShowActionModal(true);
  };

  const openDeleteConfirm = (member: Member) => {
    setSelectedMember(member);
    setShowDeleteModal(true);
  };

  const handleExport = async (format: "csv" | "pdf") => {
    const headers = ["Name", "Email", "Phone", "Role", "Status", "Joined", "Contributions"];
    const rows = filtered.map(m => {
      const stats = getMemberStats(m, wallet, contributions);
      return [
        m.fullName,
        m.email || "",
        m.phone || "",
        m.role,
        m.status,
        fmtDate(m.dateJoined || ""),
        fmtCurrency(stats.totalContributions),
      ];
    });
    
    if (format === "csv") {
      await exportCsv("Members_Report", headers, rows);
    } else {
      const html = `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      await exportPdf("Members_Report", "Members Report", html);
    }
    show(`Exported as ${format.toUpperCase()}`);
  };

  // ── UI: Member Card ──────────────────────────────────────────────────
  const MemberCard = ({ member }: { member: Member }) => {
    const stats = getMemberStats(member, wallet, contributions);
    const isMe = member.userId === currentMember?.userId;
    
    return (
      <Card
        key={member.id}
        onPress={() => openMemberActions(member)}
        style={st.memberCard}
        activeOpacity={0.8}
      >
        <View style={st.memberCardContent}>
          <View style={st.memberHeader}>
            <View style={st.memberInfo}>
              <Text style={T.bold}>{member.fullName || "Unknown"}{isMe ? " (You)" : ""}</Text>
              <Text style={[T.small, { color: C.text3 }]}>
                {member.email || ""}
              </Text>
            </View>
            <View style={st.memberBadges}>
              <Badge label={ROLE_LABELS[member.role] || member.role} color={ROLE_BADGE[member.role] || "muted"} />
              <Badge label={member.status} color={STATUS_BADGE[member.status] || "muted"} />
            </View>
          </View>

          <View style={st.memberStats}>
            <View style={st.statItem}>
              <Text style={T.small}>Contributions</Text>
              <Text style={[T.bold, { color: C.primary }]}>
                {fmtCurrency(stats.totalContributions)}
              </Text>
            </View>
            {stats.arrears > 0 && (
              <View style={st.statItem}>
                <Text style={T.small}>Arrears</Text>
                <Text style={[T.bold, { color: C.error }]}>
                  {fmtCurrency(stats.arrears)}
                </Text>
              </View>
            )}
            <View style={st.statItem}>
              <Text style={T.small}>Joined</Text>
              <Text style={[T.small, { color: C.text3 }]}>
                {fmtDate(member.dateJoined || "")}
              </Text>
            </View>
          </View>
        </View>
      </Card>
    );
  };

  // ── Desktop layout ──────────────────────────────────────────────────
  if (isWide) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {Toast}

        <ScrollView
          contentContainerStyle={st.container}
          showsVerticalScrollIndicator={false}
        >
          {/* ── KPI Cards ── */}
          <View style={st.kpiGrid}>
            <KpiCard
              label="Total Members"
              value={String(stats.total)}
              icon="👥"
              subtext="All members"
              accentColor={C.primary}
              onPress={() => { setStatusFilter("all"); }}
            />
            <KpiCard
              label="Active"
              value={String(stats.active)}
              icon="✅"
              subtext="Active members"
              accentColor={C.success}
              onPress={() => { setStatusFilter("active"); }}
            />
            <KpiCard
              label="Pending"
              value={String(stats.pending)}
              icon="⏳"
              subtext="Awaiting approval"
              accentColor={C.gold}
              onPress={() => { setStatusFilter("pending"); }}
            />
            <KpiCard
              label="Inactive"
              value={String(stats.inactive)}
              icon="⛔"
              subtext="Inactive members"
              accentColor={C.error}
              onPress={() => { setStatusFilter("inactive"); }}
            />
          </View>

          {/* ── Smart Controls ── */}
          <View style={st.controlsSection}>
            <View style={st.controlsLeft}>
              <Select
                items={[
                  { label: "All", value: "all" },
                  { label: "Active", value: "active" },
                  { label: "Pending", value: "pending" },
                  { label: "Inactive", value: "inactive" },
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
                label="Status"
                style={st.controlSelect}
              />
              <Select
                items={[
                  { label: "By Name", value: "name" },
                  { label: "By Join Date", value: "date_joined" },
                  { label: "By Contributions", value: "contributions" },
                ]}
                value={sortBy}
                onChange={setSortBy}
                label="Sort"
                style={st.controlSelect}
              />
            </View>
            
            <View style={st.controlsRight}>
              <View style={st.resultsBadge}>
                <Text style={st.resultsCount}>
                  {filtered.length} member{filtered.length !== 1 ? "s" : ""}
                </Text>
              </View>
              
              {/* Only show export if in group view and has permission */}
              {isGroupView && canExport && (
                <View style={st.exportGroup}>
                  <TouchableOpacity
                    style={[st.exportBtn, { backgroundColor: C.primary }]}
                    onPress={() => handleExport("csv")}
                    activeOpacity={0.8}
                  >
                    <Text style={st.exportBtnText}>CSV</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.exportBtn, { backgroundColor: C.redText }]}
                    onPress={() => handleExport("pdf")}
                    activeOpacity={0.8}
                  >
                    <Text style={st.exportBtnText}>PDF</Text>
                  </TouchableOpacity>
                </View>
              )}
              
              {/* Only show add button if in group view and has permission */}
              {isGroupView && canCreateMember && (
                <TouchableOpacity
                  style={st.addBtn}
                  onPress={() => setShowCreateModal(true)}
                  activeOpacity={0.8}
                >
                  <Text style={st.addBtnText}>+ Add</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── Members List ── */}
          {filtered.length === 0 ? (
            <Empty label="No members found" />
          ) : (
            <View style={st.membersList}>
              {filtered.map(member => (
                <MemberCard key={member.id} member={member} />
              ))}
            </View>
          )}
        </ScrollView>

        {/* ── Create Member Modal ── */}
        <BottomModal visible={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New User">
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <Input
              label="Full Name"
              value={createForm.fullName}
              onChangeText={(t) => setCreateForm(p => ({ ...p, fullName: t }))}
              placeholder="John Doe"
            />
            <Input
              label="Email"
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
              items={USER_ROLES.map(r => ({ label: ROLE_LABELS[r], value: r }))}
              value={createForm.role}
              onChange={(r) => setCreateForm(p => ({ ...p, role: r }))}
              label="Role"
            />
            <Button
              label="Create User"
              onPress={handleCreateUser}
              loading={creatingUser}
              fullWidth
            />
          </View>
        </BottomModal>

        {/* ── Member Action Modal ── */}
        <BottomModal visible={showActionModal} onClose={() => setShowActionModal(false)} title={selectedMember?.fullName}>
          {selectedMember && (
            <View style={{ gap: 12, paddingBottom: 20 }}>
              {/* Member Info */}
              <View style={st.modalInfoSection}>
                <View style={st.modalAvatar}>
                  <Text style={st.modalAvatarText}>
                    {selectedMember.fullName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={st.modalInfo}>
                  <Text style={st.modalName}>{selectedMember.fullName}</Text>
                  <View style={st.modalBadges}>
                    <Badge label={ROLE_LABELS[selectedMember.role] || selectedMember.role} color={ROLE_BADGE[selectedMember.role] || "muted"} />
                    <Badge label={selectedMember.status} color={STATUS_BADGE[selectedMember.status] || "muted"} />
                  </View>
                </View>
              </View>

              <View style={st.modalDetails}>
                <InfoRow label="Email" value={selectedMember.email || "-"} />
                <InfoRow label="Phone" value={selectedMember.phone || "-"} />
                <InfoRow label="Joined" value={fmtDate(selectedMember.dateJoined || "")} />
              </View>

              {/* Admin Actions - Always shown for admin users */}
              {isAdmin && (
                <View style={st.adminActionsSection}>
                  <Text style={st.adminActionsTitle}>Admin Actions</Text>
                  
                  {/* Edit Button */}
                  <TouchableOpacity
                    style={st.actionButton}
                    onPress={handleEditMember}
                    activeOpacity={0.8}
                  >
                    <Text style={st.actionButtonText}>✏️ Edit Profile</Text>
                  </TouchableOpacity>

                  {/* Approve Button - Only for pending members */}
                  {selectedMember.status === "pending" && (
                    <TouchableOpacity
                      style={[st.actionButton, st.approveButton]}
                      onPress={handleApproveMember}
                      activeOpacity={0.8}
                    >
                      <Text style={[st.actionButtonText, { color: "#fff" }]}>✓ Approve Member</Text>
                    </TouchableOpacity>
                  )}

                  {/* Deactivate Button - Only for active members (not yourself) */}
                  {selectedMember.status === "active" && selectedMember.userId !== currentMember?.userId && (
                    <TouchableOpacity
                      style={[st.actionButton, st.warningButton]}
                      onPress={handleDeactivateMember}
                      activeOpacity={0.8}
                    >
                      <Text style={[st.actionButtonText, { color: "#fff" }]}>⛔ Deactivate Member</Text>
                    </TouchableOpacity>
                  )}

                  {/* Reactivate Button - Only for inactive members */}
                  {selectedMember.status === "inactive" && (
                    <TouchableOpacity
                      style={[st.actionButton, st.successButton]}
                      onPress={handleReactivateMember}
                      activeOpacity={0.8}
                    >
                      <Text style={[st.actionButtonText, { color: "#fff" }]}>🔄 Reactivate Member</Text>
                    </TouchableOpacity>
                  )}

                  {/* Reset Password - For members with userId */}
                  {selectedMember.userId && (
                    <TouchableOpacity
                      style={[st.actionButton, st.passwordButton]}
                      onPress={handleResetPassword}
                      activeOpacity={0.8}
                    >
                      <Text style={[st.actionButtonText, { color: "#fff" }]}>🔑 Reset Password</Text>
                    </TouchableOpacity>
                  )}

                  {/* Delete Button - For all members except yourself */}
                  {selectedMember.userId !== currentMember?.userId && (
                    <TouchableOpacity
                      style={[st.actionButton, st.dangerButton]}
                      onPress={() => {
                        setShowActionModal(false);
                        openDeleteConfirm(selectedMember);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[st.actionButtonText, { color: "#fff" }]}>🗑 Delete Member</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Close Button */}
              <TouchableOpacity
                style={[st.actionButton, st.closeButton]}
                onPress={() => setShowActionModal(false)}
                activeOpacity={0.8}
              >
                <Text style={[st.actionButtonText, { color: C.text2 }]}>Close</Text>
              </TouchableOpacity>
            </View>
          )}
        </BottomModal>

        {/* ── Delete Confirmation Modal ── */}
        <BottomModal visible={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete Member?">
          {selectedMember && (
            <View style={{ gap: 12, paddingBottom: 20 }}>
              <Text style={[T.small, { color: C.text2 }]}>
                This will remove {selectedMember.fullName} from the group. This action cannot be undone.
              </Text>
              <Button
                label="Cancel"
                onPress={() => setShowDeleteModal(false)}
                variant="outline"
                fullWidth
              />
              <Button
                label="Delete Member"
                onPress={handleDeleteMember}
                variant="danger"
                fullWidth
              />
            </View>
          )}
        </BottomModal>
      </View>
    );
  }

  // ── Mobile layout ──────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {Toast}

      {/* ── KPI Cards (Mobile) ── */}
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.mobileKpiScroll}
      >
        <View style={st.mobileKpiRow}>
          <KpiCard
            label="Total"
            value={String(stats.total)}
            icon="👥"
            subtext="All"
            accentColor={C.primary}
            onPress={() => { setStatusFilter("all"); }}
          />
          <KpiCard
            label="Active"
            value={String(stats.active)}
            icon="✅"
            subtext="Active"
            accentColor={C.success}
            onPress={() => { setStatusFilter("active"); }}
          />
          <KpiCard
            label="Pending"
            value={String(stats.pending)}
            icon="⏳"
            subtext="Pending"
            accentColor={C.gold}
            onPress={() => { setStatusFilter("pending"); }}
          />
          <KpiCard
            label="Inactive"
            value={String(stats.inactive)}
            icon="⛔"
            subtext="Inactive"
            accentColor={C.error}
            onPress={() => { setStatusFilter("inactive"); }}
          />
        </View>
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        {/* ── Controls - Mobile ── */}
        <View style={st.mobileControls}>
          <View style={st.mobileFilterRow}>
            <Select
              items={[
                { label: "All", value: "all" },
                { label: "Active", value: "active" },
                { label: "Pending", value: "pending" },
                { label: "Inactive", value: "inactive" },
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
              label="Status"
              style={st.mobileFilterSelect}
            />
            <Select
              items={[
                { label: "Name", value: "name" },
                { label: "Join Date", value: "date_joined" },
              ]}
              value={sortBy}
              onChange={setSortBy}
              label="Sort"
              style={st.mobileFilterSelect}
            />
          </View>
          
          <View style={st.mobileResultsRow}>
            <Text style={st.mobileResultsCount}>
              {filtered.length} member{filtered.length !== 1 ? "s" : ""}
            </Text>
            {isGroupView && canExport && (
              <View style={st.mobileExportGroup}>
                <TouchableOpacity
                  style={[st.mobileExportBtn, { backgroundColor: C.primary }]}
                  onPress={() => handleExport("csv")}
                  activeOpacity={0.8}
                >
                  <Text style={st.mobileExportBtnText}>CSV</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.mobileExportBtn, { backgroundColor: C.redText }]}
                  onPress={() => handleExport("pdf")}
                  activeOpacity={0.8}
                >
                  <Text style={st.mobileExportBtnText}>PDF</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* ── Members ── */}
        {filtered.length === 0 ? (
          <Empty label="No members found" />
        ) : (
          filtered.map(member => (
            <MemberCard key={member.id} member={member} />
          ))
        )}

        {/* ── Add button - Mobile (only in group view) ── */}
        {isGroupView && canCreateMember && (
          <TouchableOpacity
            style={st.mobileFab}
            onPress={() => setShowCreateModal(true)}
            activeOpacity={0.8}
          >
            <Text style={st.mobileFabText}>+</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* ── Modals (Mobile) ── */}
      <BottomModal visible={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create User">
        <View style={{ gap: 12, paddingBottom: 20 }}>
          <Input
            label="Full Name"
            value={createForm.fullName}
            onChangeText={(t) => setCreateForm(p => ({ ...p, fullName: t }))}
            placeholder="John Doe"
          />
          <Input
            label="Email"
            value={createForm.email}
            onChangeText={(t) => setCreateForm(p => ({ ...p, email: t }))}
            placeholder="john@example.com"
            keyboardType="email-address"
          />
          <Input
            label="Phone"
            value={createForm.phone}
            onChangeText={(t) => setCreateForm(p => ({ ...p, phone: t }))}
            placeholder="+250-XXX-XXX-XXX"
          />
          <Select
            items={USER_ROLES.map(r => ({ label: ROLE_LABELS[r], value: r }))}
            value={createForm.role}
            onChange={(r) => setCreateForm(p => ({ ...p, role: r }))}
            label="Role"
          />
          <Button
            label="Create User"
            onPress={handleCreateUser}
            loading={creatingUser}
            fullWidth
          />
        </View>
      </BottomModal>

      <BottomModal visible={showActionModal} onClose={() => setShowActionModal(false)} title={selectedMember?.fullName}>
        {selectedMember && (
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <InfoRow label="Email" value={selectedMember.email || "-"} />
            <InfoRow label="Role" value={ROLE_LABELS[selectedMember.role] || selectedMember.role} />
            <InfoRow label="Status" value={selectedMember.status} />

            {/* Admin Actions - Always shown for admin users */}
            {isAdmin && (
              <View style={st.adminActionsSection}>
                <Text style={st.adminActionsTitle}>Admin Actions</Text>
                
                {selectedMember.status === "pending" && (
                  <Button label="✓ Approve" onPress={handleApproveMember} size="sm" fullWidth />
                )}

                {selectedMember.status === "active" && selectedMember.userId !== currentMember?.userId && (
                  <Button 
                    label="⛔ Deactivate" 
                    onPress={handleDeactivateMember} 
                    size="sm" 
                    fullWidth 
                    variant="warning"
                  />
                )}

                {selectedMember.status === "inactive" && (
                  <Button 
                    label="🔄 Reactivate" 
                    onPress={handleReactivateMember} 
                    size="sm" 
                    fullWidth 
                    variant="success"
                  />
                )}

                {selectedMember.userId && (
                  <Button
                    label="🔑 Reset Password"
                    onPress={handleResetPassword}
                    loading={resettingPassword}
                    size="sm"
                    fullWidth
                  />
                )}

                {selectedMember.userId !== currentMember?.userId && (
                  <Button
                    label="🗑 Delete"
                    onPress={() => {
                      setShowActionModal(false);
                      openDeleteConfirm(selectedMember);
                    }}
                    size="sm"
                    fullWidth
                    variant="danger"
                  />
                )}
              </View>
            )}
          </View>
        )}
      </BottomModal>
    </View>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const st = StyleSheet.create({
  // Desktop Container
  container: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  
  // KPI Grid - Desktop
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
  },
  
  // Controls Section - Desktop
  controlsSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 16,
  },
  controlsLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  controlsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  controlSelect: {
    minWidth: 140,
  },
  resultsBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: C.elevated,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  resultsCount: {
    fontSize: 13,
    color: C.text2,
    fontWeight: "600",
  },
  exportGroup: {
    flexDirection: "row",
    gap: 6,
  },
  exportBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  exportBtnText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  addBtn: {
    backgroundColor: C.primary,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  
  // Members List - Desktop
  membersList: {
    gap: 12,
  },
  memberCard: {
    padding: 0,
  },
  memberCardContent: {
    padding: 16,
    gap: 12,
  },
  memberHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  memberInfo: {
    flex: 1,
    gap: 4,
  },
  memberBadges: {
    flexDirection: "row",
    gap: 6,
  },
  memberStats: {
    flexDirection: "row",
    gap: 16,
  },
  statItem: {
    flex: 1,
    gap: 4,
  },

  // Modal Styles
  modalInfoSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
  },
  modalAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  modalAvatarText: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
  },
  modalInfo: {
    flex: 1,
  },
  modalName: {
    fontSize: 18,
    fontWeight: "800",
    color: C.text,
    marginBottom: 4,
  },
  modalBadges: {
    flexDirection: "row",
    gap: 6,
  },
  modalDetails: {
    gap: 4,
    marginBottom: 16,
  },
  adminActionsSection: {
    gap: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 16,
  },
  adminActionsTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: "center",
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.text2,
  },
  approveButton: {
    backgroundColor: C.success,
    borderColor: C.success,
  },
  warningButton: {
    backgroundColor: C.gold,
    borderColor: C.gold,
  },
  successButton: {
    backgroundColor: C.success,
    borderColor: C.success,
  },
  dangerButton: {
    backgroundColor: C.error,
    borderColor: C.error,
  },
  passwordButton: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  closeButton: {
    backgroundColor: C.elevated,
    borderColor: C.border,
    marginTop: 8,
  },

  // KPI Grid - Mobile
  mobileKpiScroll: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  mobileKpiRow: {
    flexDirection: "row",
    gap: 10,
  },

  // Mobile Controls
  mobileControls: {
    marginBottom: 12,
  },
  mobileFilterRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  mobileFilterSelect: {
    flex: 1,
  },
  mobileResultsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mobileResultsCount: {
    fontSize: 12,
    color: C.text3,
    fontWeight: "500",
  },
  mobileExportGroup: {
    flexDirection: "row",
    gap: 6,
  },
  mobileExportBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  mobileExportBtnText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },

  // Mobile FAB
  mobileFab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  mobileFabText: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
  },
});