// app/(tabs)/members.tsx
import React, { useMemo, useState, useCallback } from "react";
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform,
  useWindowDimensions, TextInput, Alert, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore, useGroupMembers, useGroupWallet, useGroupContributions,
  useCurrentUserRole, useCurrentMember, useIsAdminView,
} from "../../stores/useStore";
import {
  SearchBar, Card, Badge, Empty, Button, Avatar, BottomModal,
  TabRow, Input, Select, useToast, InfoRow,
} from "../../components/ui";
import { Colors, C, T, S, R, fmtCurrency, fmtDate, showConfirm, round2 } from "../../utils/theme";
import { createUserAsAdmin, resetUserPasswordAsAdmin } from "../../lib/auth/adminUsers";
import { USER_ROLES, ROLE_LABELS } from "../../types/roles";
import type { Member } from "../../types";
import * as FS from "../../lib/firestore";

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
  
  // Note: arrears calculation would need loan data; simplified here
  const arrears = pendingAmount;
  const activeLoanCount = 0; // Would calculate from loans
  
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
  const { deleteMember } = useStore();

  const members = useGroupMembers();
  const wallet = useGroupWallet();
  const contributions = useGroupContributions();

  const isAdmin = role === "admin";
  const canManageMembers = ["admin", "accountant", "loan_officer"].includes(role);

  // State
  const [search, setSearch] = useState("");
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

  // Filtered & sorted members
  const filtered = useMemo(() => {
    let list = [...members];

    if (statusFilter !== "all") {
      list = list.filter(m => m.status === statusFilter);
    }

    if (search) {
      const term = search.toLowerCase();
      list = list.filter(m =>
        m.fullName?.toLowerCase().includes(term) ||
        m.email?.toLowerCase().includes(term) ||
        m.phone?.toLowerCase().includes(term)
      );
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
  }, [members, statusFilter, search, sortBy, wallet, contributions]);

  // Summary stats
  const stats = useMemo(() => {
    const active = members.filter(m => m.status === "active").length;
    const pending = members.filter(m => m.status === "pending").length;
    const inactive = members.filter(m => !["active", "pending"].includes(m.status)).length;
    const total = members.length;
    return { total, active, pending, inactive };
  }, [members]);

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

  const openMemberActions = (member: Member) => {
    setSelectedMember(member);
    setShowActionModal(true);
  };

  const openDeleteConfirm = (member: Member) => {
    setSelectedMember(member);
    setShowDeleteModal(true);
  };

  // ── UI: Member Card ──────────────────────────────────────────────────
  const MemberCard = ({ member }: { member: Member }) => {
    const stats = getMemberStats(member, wallet, contributions);
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
              <Text style={T.bold}>{member.fullName || "Unknown"}</Text>
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

        {/* Header */}
        <View style={st.header}>
          <View>
            <Text style={T.h1}>Members</Text>
            <Text style={[T.small, { color: C.text3 }]}>
              {stats.total} total • {stats.active} active • {stats.pending} pending
            </Text>
          </View>
          {canManageMembers && (
            <Button
              label="➕ Create User"
              onPress={() => setShowCreateModal(true)}
              size="sm"
            />
          )}
        </View>

        <ScrollView
          contentContainerStyle={st.container}
          showsVerticalScrollIndicator={false}
        >
          {/* Search & Filters */}
          <View style={st.filterBar}>
            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder="Search members..."
              style={{ flex: 1, marginRight: 12 }}
            />
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
            />
          </View>

          {/* Members List */}
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

        {/* Create User Modal */}
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

        {/* Member Actions Modal */}
        <BottomModal visible={showActionModal} onClose={() => setShowActionModal(false)} title={selectedMember?.fullName}>
          {selectedMember && (
            <View style={{ gap: 8, paddingBottom: 20 }}>
              <InfoRow label="Email" value={selectedMember.email} />
              <InfoRow label="Phone" value={selectedMember.phone || "-"} />
              <InfoRow label="Role" value={ROLE_LABELS[selectedMember.role] || selectedMember.role} />
              <InfoRow label="Status" value={selectedMember.status} />
              <InfoRow label="Joined" value={fmtDate(selectedMember.dateJoined || "")} />

              {selectedMember.status === "pending" && isAdmin && (
                <Button label="✓ Approve Member" onPress={handleApproveMember} size="sm" fullWidth />
              )}

              {["admin", "accountant"].includes(role) && selectedMember.userId && (
                <Button
                  label="🔑 Reset Password"
                  onPress={handleResetPassword}
                  loading={resettingPassword}
                  size="sm"
                  fullWidth
                />
              )}

              {isAdmin && (
                <Button
                  label="🗑 Delete Member"
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
        </BottomModal>

        {/* Delete Confirmation Modal */}
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

      {/* Stats Bar */}
      <View style={st.statsBar}>
        <View style={st.statBox}>
          <Text style={T.bold}>{stats.total}</Text>
          <Text style={[T.tiny, { color: C.text3 }]}>Total</Text>
        </View>
        <View style={st.statBox}>
          <Text style={[T.bold, { color: C.success }]}>{stats.active}</Text>
          <Text style={[T.tiny, { color: C.text3 }]}>Active</Text>
        </View>
        <View style={st.statBox}>
          <Text style={[T.bold, { color: C.gold }]}>{stats.pending}</Text>
          <Text style={[T.tiny, { color: C.text3 }]}>Pending</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        {/* Search */}
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search members..."
          style={{ marginBottom: 12 }}
        />

        {/* Filters */}
        <View style={st.filterRow}>
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
          />
          <Select
            items={[
              { label: "By Name", value: "name" },
              { label: "By Join Date", value: "date_joined" },
            ]}
            value={sortBy}
            onChange={setSortBy}
            label="Sort"
          />
        </View>

        {/* Members */}
        {filtered.length === 0 ? (
          <Empty label="No members found" />
        ) : (
          filtered.map(member => (
            <MemberCard key={member.id} member={member} />
          ))
        )}
      </ScrollView>

      {/* Create button (mobile) */}
      {canManageMembers && (
        <TouchableOpacity
          style={st.fab}
          onPress={() => setShowCreateModal(true)}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 24, color: "#fff" }}>➕</Text>
        </TouchableOpacity>
      )}

      {/* Modals */}
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
          <View style={{ gap: 8, paddingBottom: 20 }}>
            <InfoRow label="Email" value={selectedMember.email} />
            <InfoRow label="Role" value={ROLE_LABELS[selectedMember.role] || selectedMember.role} />
            <InfoRow label="Status" value={selectedMember.status} />

            {selectedMember.status === "pending" && isAdmin && (
              <Button label="✓ Approve" onPress={handleApproveMember} size="sm" fullWidth />
            )}

            {["admin", "accountant"].includes(role) && selectedMember.userId && (
              <Button
                label="🔑 Reset Password"
                onPress={handleResetPassword}
                loading={resettingPassword}
                size="sm"
                fullWidth
              />
            )}

            {isAdmin && (
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
      </BottomModal>
    </View>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const st = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  container: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  filterBar: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
    alignItems: "center",
  },
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
  statsBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  statBox: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: R.md,
    backgroundColor: C.surface,
    alignItems: "center",
  },
  filterRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  fab: {
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
});
