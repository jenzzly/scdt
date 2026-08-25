// app/(tabs)/more.tsx - Complete fixed file
import React, { useState, useMemo, useCallback } from "react";
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, useWindowDimensions} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore, useGroupMembers, useGroupContributions, useGroupLoans,
  useCurrentUserRole, useCurrentMember, useGroupWallet,
  useIsAdminView,
} from "../../stores/useStore";
import {
  SearchBar, TabRow, Card, CardRow, Avatar, Badge, Empty,
  Button, BottomModal, Input, Select, useToast, InfoRow,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { Colors, S, R, fmtCurrency, fmtDate, showConfirm, round2 } from "../../utils/theme";
import type { Member, Contribution, Loan, Meeting, WalletTransaction } from "../../types";

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

function getDocId(member: Member): string {
  return (member as any)._docId ?? member.id;
}

export default function MoreScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { signOut } = useAuth();
  const { show, Toast } = useToast();
  
  const group = useStore((s) => s.groups.find(g => g.id === s.activeGroupId));
  const activeGroupId = useStore((s) => s.activeGroupId);
  const authUid = useStore((s) => s.authUid);
  const authName = useStore((s) => s.authName);
  const authEmail = useStore((s) => s.authEmail);
  const meetings = useStore((s) => s.meetings);
  const syncStatus = useStore((s) => s.syncStatus);
  const syncError = useStore((s) => s.syncError);
  const lastSyncTimestamp = useStore((s) => s.lastSyncTimestamp);
  const triggerForceSync = useStore((s) => s.triggerForceSync);
  const reset = useStore((s) => s.reset);
  
  const {
    createMember, approveMember, updateOwnProfile, updateMember,
    deleteMember,
  } = useStore();
  
  const groupMembers = useGroupMembers();
  const contributions = useGroupContributions();
  const loans = useGroupLoans();
  const wallet = useGroupWallet();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();

  const isAdmin = role === "admin";
  const canViewAll = useIsAdminView();

  const [activeTab, setActiveTab] = useState<"profile" | "members">("profile");
  const [search, setSearch] = useState("");
  const [memberTab, setMemberTab] = useState("All");
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [addForm, setAddForm] = useState({
    fullName: "", phone: "", email: "",
    nationalId: "", physicalAddress: "", role: "member",
  });
  const [editForm, setEditForm] = useState({
    fullName: "", email: "", phone: "", languagePreference: "en",
    nationalId: "", physicalAddress: "", role: "member",
  });

  // ── Profile edit handlers ─────────────────────────────────────────────────
  const openProfileEdit = useCallback(() => {
    if (!currentMember) {
      show("Profile not loaded yet. Please wait a moment.", "error");
      return;
    }
    setEditForm({
      fullName: currentMember.fullName ?? authName ?? "",
      email: currentMember.email ?? "",
      phone: currentMember.phone ?? "",
      languagePreference: currentMember.languagePreference ?? "en",
      nationalId: currentMember.nationalId ?? "",
      physicalAddress: currentMember.physicalAddress ?? "",
      role: currentMember.role,
    });
    setSelected(currentMember);
    setEditOpen(true);
  }, [currentMember, authName, show]);

  const handleSaveProfile = async () => {
    if (!currentMember) {
      show("Profile not loaded. Please try again.", "error");
      return;
    }
    if (!editForm.fullName.trim()) {
      show("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      await updateOwnProfile(currentMember.id, {
        fullName: editForm.fullName.trim(),
        phone: editForm.phone.trim() || undefined,
        languagePreference: editForm.languagePreference,
        nationalId: editForm.nationalId.trim() || undefined,
        physicalAddress: editForm.physicalAddress.trim() || undefined,
      });
      show("Profile updated");
      setEditOpen(false);
      setSelected(null);
    } catch (e: any) {
      show(e.message || "Failed to update profile", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Member management ─────────────────────────────────────────────────────
  const filteredMembers = useMemo(() => {
    let list = canViewAll ? groupMembers : groupMembers.filter((m) => m.userId === authUid);

    if (memberTab === "Active")   list = list.filter((m) => m.status === "active");
    if (memberTab === "Pending")  list = list.filter((m) => m.status === "pending");
    if (memberTab === "Inactive") list = list.filter((m) => !["active", "pending"].includes(m.status));
    if (search) {
      const term = search.toLowerCase();
      list = list.filter((m) =>
        [m.fullName, m.email, m.phone, m.nationalId, m.physicalAddress]
          .filter(Boolean)
          .some((v) => v?.toLowerCase().includes(term)),
      );
    }
    return list;
  }, [groupMembers, memberTab, search, canViewAll, authUid]);

  const handleAddMember = async () => {
    if (!addForm.fullName.trim() || !addForm.phone.trim()) {
      show("Name and phone required", "error"); 
      return;
    }
    if (!activeGroupId) return;
    setSaving(true);
    try {
      await createMember({
        groupId: activeGroupId,
        fullName: addForm.fullName.trim(),
        phone: addForm.phone.trim(),
        email: addForm.email.trim() || undefined,
        nationalId: addForm.nationalId.trim() || undefined,
        physicalAddress: addForm.physicalAddress.trim() || undefined,
        role: addForm.role as any,
        status: "pending",
        dateJoined: new Date().toISOString(),
      });
      show("Member added — pending approval");
      setAddOpen(false);
      setAddForm({ fullName: "", phone: "", email: "", nationalId: "", physicalAddress: "", role: "member" });
    } catch { 
      show("Failed to add member", "error"); 
    } finally { 
      setSaving(false); 
    }
  };

  const openEditMember = (m: Member) => {
    setEditForm({
      fullName: m.fullName,
      email: m.email ?? "",
      phone: m.phone ?? "",
      languagePreference: m.languagePreference ?? "en",
      nationalId: m.nationalId ?? "",
      physicalAddress: m.physicalAddress ?? "",
      role: m.role,
    });
    setSelected(m);
    setEditOpen(true);
  };

  const handleSaveEditMember = async () => {
    if (!selected) return;
    if (!editForm.fullName.trim()) { show("Name required", "error"); return; }
    setSaving(true);
    try {
      const isEditingOther = isAdmin && selected.userId !== authUid;

      if (isEditingOther) {
        await updateMember(selected.id, {
          fullName: editForm.fullName.trim(),
          phone: editForm.phone.trim() || undefined,
          email: editForm.email.trim() || undefined,
          nationalId: editForm.nationalId.trim() || undefined,
          physicalAddress: editForm.physicalAddress.trim() || undefined,
          languagePreference: editForm.languagePreference,
          role: editForm.role as any,
        });
      } else {
        await updateOwnProfile(selected.id, {
          fullName: editForm.fullName.trim(),
          phone: editForm.phone.trim() || undefined,
          nationalId: editForm.nationalId.trim() || undefined,
          physicalAddress: editForm.physicalAddress.trim() || undefined,
          languagePreference: editForm.languagePreference,
        });
      }

      show("Profile updated");
      setEditOpen(false);
      setSelected(null);
    } catch (e: any) {
      show(e.message || "Failed to update", "error");
    } finally {
      setSaving(false);
    }
  };

  // FIX: Improved delete member function with better error handling
  const handleDeleteMember = async (member: Member) => {
    // Check if member has financial history
    const hasHistory =
      contributions.some((c) => c.memberId === member.id) ||
      loans.some((l) => l.memberId === member.id);
    
    if (hasHistory) {
      show("Cannot delete member with financial history. Deactivate instead.", "error");
      return;
    }
    
    showConfirm(
      "Delete Member",
      `Are you sure you want to delete ${member.fullName}? This action cannot be undone.`,
      async () => {
        try {
          await deleteMember(member.id);
          show("Member deleted successfully");
          setSelected(null);
        } catch (e: any) {
          console.error("Delete member error:", e);
          show(e.message || "Failed to delete member", "error");
        }
      },
      undefined,
      true
    );
  };

  const handleDeactivateMember = async (member: Member) => {
    showConfirm(
      "Deactivate Member",
      `Deactivate ${member.fullName}? They won't be able to participate in group activities.`,
      async () => {
        try {
          await updateMember(member.id, { status: "inactive" });
          show("Member deactivated");
          setSelected(null);
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
          await updateMember(member.id, { status: "active" });
          show("Member reactivated");
          setSelected(null);
        } catch (e: any) {
          show(e.message || "Failed to reactivate", "error");
        }
      }
    );
  };

  const groupMeetings = useMemo(
    () => meetings.filter((m) => m.groupId === activeGroupId),
    [meetings, activeGroupId],
  );

  const getMemberStats = (m: Member) => ({
    payments: contributions.filter((c) => c.memberId === m.id && c.status === "approved").length,
    activeLoans: loans.filter((l) => l.memberId === m.id && l.status === "disbursed").length,
    meetings: groupMeetings.filter((meeting) => meeting.attendees.some((a) => a.memberId === m.id)).length,
  });

  const activeCount = groupMembers.filter((m) => m.status === "active").length;
  const pendingCount = groupMembers.filter((m) => m.status === "pending").length;

  const handleSignOut = () => {
    showConfirm(
      "Sign Out",
      "Are you sure?",
      async () => {
        await signOut().catch(() => {});
        reset();
        router.replace("/(auth)/welcome");
      },
      undefined,
      true,
    );
  };

  const TABS = isAdmin ? ["Profile", "Members"] : ["Profile"];

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerSub}>{isAdmin ? "Admin" : "Account"}</Text>
          <Text style={styles.title}>Settings</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => router.push("/group-settings")}
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={{ paddingHorizontal: S.lg, paddingTop: S.md }}>
        <TabRow 
          tabs={TABS} 
          active={activeTab} 
          onChange={(tab) => setActiveTab(tab.toLowerCase() as "profile" | "members")} 
        />
      </View>

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <ScrollView
          contentContainerStyle={{ padding: S.lg, paddingBottom: 120, maxWidth: isWide ? 800 : undefined, alignSelf: isWide ? "center" as any : undefined, width: "100%" as any }}
          showsVerticalScrollIndicator={false}
        >
          {/* User card */}
          <View style={styles.userCard}>
            <View style={styles.userAvatar}>
              <Text style={styles.userAvatarText}>
                {(authName ?? "U")
                  .split(" ")
                  .map((w: string) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{authName ?? "—"}</Text>
              <Text style={styles.userEmail}>{authEmail ?? "—"}</Text>
              <Text style={styles.userRole}>{role}</Text>
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={openProfileEdit}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          {/* Access Level */}
          <Text style={styles.sectionLabel}>Access Level</Text>
          <Card style={{ marginBottom: S.lg }}>
            <View style={{ padding: S.lg }}>
              <InfoRow label="Role" value={role} accent />
              <InfoRow
                label="Permissions"
                value={
                  isAdmin
                    ? "Full access"
                    : ["loan_officer", "committee", "accountant"].includes(role)
                    ? "Financial access"
                    : "Personal only"
                }
              />
            </View>
          </Card>

          {/* Group info */}
          <Text style={styles.sectionLabel}>Group</Text>
          <Card style={{ marginBottom: S.lg }}>
            <View style={{ padding: S.lg }}>
              <Text style={styles.groupName}>
                {group?.name ?? "SCDT Savings Group"}
              </Text>
              {group?.description && (
                <Text style={styles.groupDesc}>{group.description}</Text>
              )}
            </View>
            <View style={{ paddingHorizontal: S.lg, paddingBottom: S.md }}>
              <InfoRow label="Currency" value={group?.currency ?? "RWF"} />
              <InfoRow label="Contribution" value={fmtCurrency(group?.contributionAmount ?? 0)} accent />
              <InfoRow label="Loan Rate" value={`${group?.loanInterestRate ?? 2}% / ${group?.loanInterestRatePeriod === "annual" ? "year" : "month"}`} />
              <InfoRow
                label="Late Penalty"
                value={`${group?.latePenaltyRatePct ?? 5}% ≈ ${fmtCurrency(round2((group?.contributionAmount ?? 0) * (group?.latePenaltyRatePct ?? 5) / 100))} per 15min`}
              />
            </View>
          </Card>

          {/* Admin-only section */}
          {isAdmin && (
            <>
              <Text style={styles.sectionLabel}>Administration</Text>

              {/* Group Settings */}
              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => router.push("/group-settings")}
                activeOpacity={0.7}
              >
                <View style={styles.settingsRowIcon}>
                  <Text style={{ fontSize: 16 }}>⚙</Text>
                </View>
                <Text style={styles.settingsRowText}>Group Settings</Text>
                <Text style={{ color: Colors.text3, fontSize: 18 }}>›</Text>
              </TouchableOpacity>

              <Text style={[styles.sectionLabel, { marginTop: S.lg }]}>System Status</Text>
              <TouchableOpacity
                style={styles.settingsRow}
                onPress={triggerForceSync}
                activeOpacity={0.7}
              >
                <View style={[styles.settingsRowIcon, { backgroundColor: "rgba(59,130,246,0.1)" }]}>
                  <Text style={{ fontSize: 16 }}>⟳</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingsRowText}>
                    {`Sync Status: `}
                    <Text style={{ textTransform: "capitalize" }}>{syncStatus}</Text>
                  </Text>
                  <Text style={{ fontSize: 11, color: Colors.text3 }}>
                    Last synced: {lastSyncTimestamp
                      ? new Date(lastSyncTimestamp).toLocaleString()
                      : "Never"}
                  </Text>
                  {syncError && (
                    <Text
                      style={{ fontSize: 11, color: Colors.error }}
                      numberOfLines={1}
                    >
                      {syncError}
                    </Text>
                  )}
                </View>
                <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: "600" }}>
                  Force Sync
                </Text>
              </TouchableOpacity>
            </>
          )}

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={handleSignOut}
            activeOpacity={0.8}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Members Tab */}
      {activeTab === "members" && isAdmin && (
        <View style={{ flex: 1 }}>
          {/* Summary strip */}
          <View style={styles.summaryRow}>
            {[
              { val: groupMembers.length, lbl: "Total", color: Colors.text },
              { val: activeCount, lbl: "Active", color: Colors.success },
              { val: pendingCount, lbl: "Pending", color: Colors.gold },
            ].map((item, idx, arr) => (
              <React.Fragment key={item.lbl}>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryVal, { color: item.color }]}>{item.val}</Text>
                  <Text style={styles.summaryLbl}>{item.lbl}</Text>
                </View>
                {idx < arr.length - 1 && <View style={styles.summaryDivider} />}
              </React.Fragment>
            ))}
          </View>

          {/* Add Button */}
          <View style={{ paddingHorizontal: S.lg, paddingTop: S.md }}>
            <TouchableOpacity style={styles.addMemberBtn} onPress={() => setAddOpen(true)} activeOpacity={0.8}>
              <Text style={styles.addMemberBtnText}>+ Add New Member</Text>
            </TouchableOpacity>
          </View>

          {/* Search and tabs */}
          <View style={{ paddingHorizontal: S.lg, paddingTop: S.md }}>
            <SearchBar value={search} onChange={setSearch} placeholder="Search by name, phone, email, ID or address…" />
            <TabRow tabs={["All", "Active", "Pending", "Inactive"]} active={memberTab} onChange={setMemberTab} />
          </View>

          {/* Members List */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
          >
            {filteredMembers.length === 0 ? (
              <Empty
                message="No members in this category"
                icon="👥"
                action={() => setAddOpen(true)}
                actionLabel="Add First Member"
              />
            ) : (
              <Card>
                {filteredMembers.map((m, i) => {
                  const stats = getMemberStats(m);
                  const isMe = m.userId === authUid;
                  return (
                    <React.Fragment key={m.id}>
                      <CardRow
                        onPress={() => setSelected(m)}
                        left={<Avatar name={m.fullName} size={44} color={ROLE_BADGE[m.role] ?? "teal"} />}
                        title={`${m.fullName}${isMe ? " (You)" : ""}`}
                        subtitle={`${stats.payments} payments · ${stats.activeLoans} active loan${stats.activeLoans !== 1 ? "s" : ""} · ${stats.meetings} meetings`}
                        right={
                          <View style={{ alignItems: "flex-end", gap: 4 }}>
                            <Text style={styles.memberSavings}>{fmtCurrency(m.totalContributions)}</Text>
                            <View style={{ flexDirection: "row", gap: 4 }}>
                              <Badge label={m.role.replace("_", " ")} color={ROLE_BADGE[m.role] ?? "teal"} />
                              <Badge label={m.status} color={STATUS_BADGE[m.status] ?? "muted"} />
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

      {/* Member Detail Modal */}
      <BottomModal
        visible={!!selected && !editOpen}
        onClose={() => setSelected(null)}
        title="Member Details"
      >
        {selected && (
          <MemberDetail
            member={selected}
            isAdmin={isAdmin}
            isMe={selected.userId === authUid}
            contributions={contributions}
            loans={loans}
            meetings={groupMeetings}
            wallet={wallet}
            onApprove={async () => {
              try {
                await approveMember(selected.id);
                show("Member approved");
                setSelected(null);
              } catch (e: any) {
                show(e.message || "Failed to approve", "error");
              }
            }}
            onEditProfile={() => openEditMember(selected)}
            onDelete={() => handleDeleteMember(selected)}
            onDeactivate={() => handleDeactivateMember(selected)}
            onReactivate={() => handleReactivateMember(selected)}
          />
        )}
      </BottomModal>

      {/* Edit Profile/Modal */}
      <BottomModal
        visible={editOpen}
        onClose={() => { setEditOpen(false); setSelected(null); }}
        title={isAdmin && selected?.userId !== authUid ? "Edit Member" : "Edit My Profile"}
      >
        <ScrollView
          contentContainerStyle={{ padding: S.lg }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Input
            label="Full Name *"
            value={editForm.fullName}
            onChangeText={(v) => setEditForm((f) => ({ ...f, fullName: v }))}
            placeholder="Full name"
          />
          <Input
            label="Phone"
            value={editForm.phone}
            onChangeText={(v) => setEditForm((f) => ({ ...f, phone: v }))}
            placeholder="+250 7XX XXX XXX"
            keyboardType="phone-pad"
          />
          <Input
            label="Email"
            value={editForm.email}
            onChangeText={(v) => setEditForm((f) => ({ ...f, email: v }))}
            placeholder="Email address"
            keyboardType="email-address"
            editable={isAdmin && selected?.userId !== authUid}
            hint={
              !(isAdmin && selected?.userId !== authUid)
                ? "Email can only be changed by an admin"
                : undefined
            }
          />
          <Input
            label="National ID"
            value={editForm.nationalId}
            onChangeText={(v) => setEditForm((f) => ({ ...f, nationalId: v }))}
            placeholder="National ID"
          />
          <Input
            label="Physical Address"
            value={editForm.physicalAddress}
            onChangeText={(v) => setEditForm((f) => ({ ...f, physicalAddress: v }))}
            placeholder="Address"
          />
          <Select
            label="Language"
            value={editForm.languagePreference}
            options={[
              { label: "English", value: "en" },
              { label: "Français", value: "fr" },
              { label: "Kinyarwanda", value: "rw" },
            ]}
            onChange={(v) => setEditForm((f) => ({ ...f, languagePreference: v }))}
          />

          {/* Role selector — admin editing someone else only */}
          {isAdmin && selected?.userId !== authUid && (
            <>
              <View style={styles.roleSection}>
                <Text style={styles.roleSectionLabel}>Role</Text>
                <Text style={styles.roleSectionHint}>Changes role in the group immediately.</Text>
              </View>
              <View style={styles.roleGrid}>
                {ROLES.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    style={[
                      styles.roleChip,
                      editForm.role === r.value && styles.roleChipActive,
                    ]}
                    onPress={() => setEditForm((f) => ({ ...f, role: r.value }))}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.roleChipText,
                        editForm.role === r.value && styles.roleChipTextActive,
                      ]}
                    >
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <View style={{ height: 12 }} />
          <Button
            label="Save Changes"
            onPress={isAdmin && selected?.userId !== authUid ? handleSaveEditMember : handleSaveProfile}
            fullWidth
            loading={saving}
            size="lg"
          />
          <View style={{ height: 20 }} />
        </ScrollView>
      </BottomModal>

      {/* Add Member Modal */}
      <BottomModal visible={addOpen} onClose={() => setAddOpen(false)} title="Add New Member">
        <ScrollView
          contentContainerStyle={{ padding: S.lg }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Input
            label="Full Name *"
            value={addForm.fullName}
            onChangeText={(v) => setAddForm((f) => ({ ...f, fullName: v }))}
            placeholder="e.g. Jean Pierre Habimana"
          />
          <Input
            label="Phone *"
            value={addForm.phone}
            onChangeText={(v) => setAddForm((f) => ({ ...f, phone: v }))}
            placeholder="+250 7XX XXX XXX"
            keyboardType="phone-pad"
          />
          <Input
            label="Email"
            value={addForm.email}
            onChangeText={(v) => setAddForm((f) => ({ ...f, email: v }))}
            placeholder="optional"
            keyboardType="email-address"
          />
          <Input
            label="National ID"
            value={addForm.nationalId}
            onChangeText={(v) => setAddForm((f) => ({ ...f, nationalId: v }))}
            placeholder="optional"
          />
          <Input
            label="Physical Address"
            value={addForm.physicalAddress}
            onChangeText={(v) => setAddForm((f) => ({ ...f, physicalAddress: v }))}
            placeholder="optional"
          />
          <Select
            label="Role"
            value={addForm.role}
            options={ROLES}
            onChange={(v) => setAddForm((f) => ({ ...f, role: v }))}
          />
          <Button label="Add Member" onPress={handleAddMember} fullWidth loading={saving} size="lg" />
          <View style={{ height: 20 }} />
        </ScrollView>
      </BottomModal>

      <Toast />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MemberDetail Component
// ─────────────────────────────────────────────────────────────────────────────
function MemberDetail({
  member, isAdmin, isMe, contributions, loans, meetings, wallet,
  onApprove, onEditProfile, onDelete, onDeactivate, onReactivate,
}: {
  member: Member; isAdmin: boolean; isMe: boolean;
  contributions: Contribution[]; loans: Loan[]; meetings: Meeting[];
  wallet: WalletTransaction[];
  onApprove: () => void; onEditProfile: () => void;
  onDelete: () => void; onDeactivate: () => void; onReactivate: () => void;
}) {
  const mc = contributions.filter((c) => c.memberId === member.id && c.status === "approved");
  const ml = loans.filter((l) => l.memberId === member.id);
  const mm = meetings.filter((meeting) => meeting.attendees.some((a) => a.memberId === member.id));
  
  // Calculate real totals from wallet
  const memberWallet = wallet.filter((tx) => tx.memberId === member.id);
  
  const realTotalContributions = useMemo(() => {
    return round2(
      memberWallet
        .filter((tx) => tx.type === "contribution" && tx.amount > 0)
        .reduce((sum, tx) => sum + tx.amount, 0)
    );
  }, [memberWallet]);

  // Check if member has financial history
  const hasFinancialHistory = mc.length > 0 || ml.length > 0;

  return (
    <View style={{ padding: S.lg }}>
      <View style={styles.detailHeader}>
        <Avatar name={member.fullName} size={56} color={ROLE_BADGE[member.role] ?? "teal"} />
        <View style={{ flex: 1 }}>
          <Text style={styles.detailName}>{member.fullName}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
            <Badge label={member.role.replace("_", " ")} color={ROLE_BADGE[member.role] ?? "teal"} />
            <Badge label={member.status} color={STATUS_BADGE[member.status] ?? "muted"} />
          </View>
        </View>
      </View>

      {isAdmin && (
        <Text style={styles.docIdHint}>
          Doc: {(member as any)._docId ?? "—"} · ID: {member.id}
        </Text>
      )}

      <View style={styles.detailStats}>
        {[
          { val: fmtCurrency(realTotalContributions), lbl: "Contributions", color: Colors.accent },
          { val: mc.length, lbl: "Payments", color: Colors.text },
          { val: ml.filter((l) => l.status === "disbursed").length, lbl: "Active Loans", color: Colors.text },
          { val: mm.length, lbl: "Meetings", color: Colors.text },
        ].map((s, i) => (
          <View
            key={s.lbl}
            style={[styles.detailStat, i > 0 && { borderLeftWidth: 1, borderLeftColor: Colors.border }]}
          >
            <Text style={[styles.detailStatVal, { color: s.color }]}>{s.val}</Text>
            <Text style={styles.detailStatLbl}>{s.lbl}</Text>
          </View>
        ))}
      </View>

      {member.phone && <InfoRow label="Phone" value={member.phone} />}
      {(isAdmin || isMe) && member.email && <InfoRow label="Email" value={member.email} />}
      {isAdmin && member.nationalId && <InfoRow label="National ID" value={member.nationalId} />}
      {member.physicalAddress && <InfoRow label="Address" value={member.physicalAddress} />}
      <InfoRow label="Joined" value={fmtDate(member.dateJoined)} />

      {(mm.length > 0) && (
        <View style={{ marginTop: S.lg }}>
          <Text style={styles.sectionLabel}>Recent meetings</Text>
          {mm.slice(0, 3).map((meeting) => (
            <React.Fragment key={meeting.id}>
              <CardRow
                left={<Text style={styles.meetingBullet}>•</Text>}
                title={meeting.title}
                subtitle={`${fmtDate(meeting.date)} · ${meeting.status}`}
                showBorder={false}
              />
            </React.Fragment>
          ))}
        </View>
      )}

      <View style={{ height: 16 }} />

      {member.status === "pending" && isAdmin && (
        <>
          <Button label="Approve Member" onPress={onApprove} fullWidth size="lg" variant="success" />
          <View style={{ height: 10 }} />
        </>
      )}

      {isAdmin && !isMe && (
        <>
          <Button label="Edit Member" onPress={onEditProfile} fullWidth size="lg" variant="secondary" />
          <View style={{ height: 10 }} />
          {member.status === "active" && (
            <>
              <Button label="Deactivate Member" onPress={onDeactivate} fullWidth size="lg" variant="secondary" />
              <View style={{ height: 10 }} />
            </>
          )}
          {member.status === "inactive" && (
            <>
              <Button label="Reactivate Member" onPress={onReactivate} fullWidth size="lg" variant="success" />
              <View style={{ height: 10 }} />
            </>
          )}
          {!hasFinancialHistory ? (
            <Button label="Delete Member" onPress={onDelete} fullWidth size="lg" variant="danger" />
          ) : (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                Cannot delete member with financial history. Deactivate instead.
              </Text>
            </View>
          )}
        </>
      )}

      {isMe && (
        <Button label="Edit My Profile" onPress={onEditProfile} fullWidth size="lg" variant="secondary" />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: S.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerSub: { fontSize: 10, color: Colors.text3, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  title: { fontSize: 20, fontWeight: "800", color: Colors.text, letterSpacing: -0.4 },
  settingsBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  settingsIcon: { fontSize: 16, color: Colors.text2 },
  sectionLabel: {
    fontSize: 11, fontWeight: "700", color: Colors.text2,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10, marginTop: 4,
  },
  userCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.lg, padding: S.lg, marginBottom: S.lg,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  userAvatar: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center",
  },
  userAvatarText: { fontSize: 18, fontWeight: "800", color: "#fff" },
  userName: { fontSize: 16, fontWeight: "800", color: Colors.text },
  userEmail: { fontSize: 12, color: Colors.text3, marginTop: 2 },
  userRole: { fontSize: 11, color: Colors.accent, fontWeight: "700", marginTop: 2, textTransform: "capitalize" },
  editBtn: {
    backgroundColor: Colors.primaryFaint, borderRadius: R.sm,
    paddingVertical: 6, paddingHorizontal: 14,
  },
  editBtnText: { color: Colors.primary, fontSize: 12, fontWeight: "700" },
  groupName: { fontSize: 16, fontWeight: "800", color: Colors.text, marginBottom: 4 },
  groupDesc: { fontSize: 12, color: Colors.text3, lineHeight: 18 },
  settingsRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.lg, padding: S.lg,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  settingsRowIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.elevated, alignItems: "center", justifyContent: "center",
  },
  settingsRowText: { flex: 1, fontSize: 14, fontWeight: "600", color: Colors.text },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 24 },
  signOutBtn: {
    backgroundColor: "rgba(220,38,38,0.06)", borderWidth: 1.5,
    borderColor: "rgba(220,38,38,0.25)", borderRadius: R.lg,
    paddingVertical: 14, alignItems: "center",
  },
  signOutText: { fontSize: 14, fontWeight: "700", color: Colors.error },
  
  // Member styles
  summaryRow: {
    flexDirection: "row", backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border, paddingVertical: 12,
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryVal: { fontSize: 20, fontWeight: "800" },
  summaryLbl: { fontSize: 10, color: Colors.text3, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: Colors.border },
  addMemberBtn: {
    backgroundColor: Colors.primary,
    borderRadius: R.lg,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: S.lg,
  },
  addMemberBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  memberSavings: { fontSize: 13, fontWeight: "700", color: Colors.primary },
  
  // Detail styles
  detailHeader: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: S.md },
  detailName: { fontSize: 18, fontWeight: "800", color: Colors.text },
  docIdHint: { fontSize: 9, color: Colors.text3, marginBottom: S.md, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  detailStats: {
    flexDirection: "row", backgroundColor: Colors.elevated,
    borderRadius: R.lg, overflow: "hidden", marginBottom: S.lg,
  },
  detailStat: { flex: 1, alignItems: "center", paddingVertical: S.md },
  detailStatVal: { fontSize: 14, fontWeight: "800", color: Colors.text },
  detailStatLbl: { fontSize: 9, color: Colors.text3, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 3 },
  meetingBullet: { fontSize: 18, lineHeight: 20, color: Colors.primary, marginRight: 8 },
  warningBox: {
    backgroundColor: "rgba(220,38,38,0.1)",
    borderRadius: R.md,
    padding: S.md,
    marginTop: S.md,
    borderWidth: 1,
    borderColor: "rgba(220,38,38,0.2)",
  },
  warningText: {
    fontSize: 12,
    color: Colors.error,
    textAlign: "center",
  },
  
  // Role selector
  roleSection: { marginTop: S.md, marginBottom: 6 },
  roleSectionLabel: { fontSize: 13, fontWeight: "700", color: Colors.text },
  roleSectionHint: { fontSize: 11, color: Colors.text3, marginTop: 2 },
  roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: S.md },
  roleChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: Colors.elevated,
  },
  roleChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFaint ?? "rgba(13,148,136,0.08)" },
  roleChipText: { fontSize: 12, fontWeight: "600", color: Colors.text2 },
  roleChipTextActive: { color: Colors.primary, fontWeight: "700" },
});