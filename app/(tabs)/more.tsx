// app/(tabs)/more.tsx - Fixed Toast rendering
import React, { useState, useMemo, useCallback } from "react";
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import {
  useStore, useGroupMembers, useGroupContributions, useGroupLoans,
  useCurrentUserRole, useCurrentMember, useGroupWallet,
  useIsAdminView,
} from "../../stores/useStore";
import {
  Card, Button, BottomModal, Input, Select, useToast, InfoRow,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { Colors, S, R, fmtCurrency, fmtDate, showConfirm, round2 } from "../../utils/theme";
import type { Member } from "../../types";

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
    updateOwnProfile,
  } = useStore();
  
  const groupMembers = useGroupMembers();
  const contributions = useGroupContributions();
  const loans = useGroupLoans();
  const wallet = useGroupWallet();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();

  const isAdmin = role === "admin";
  const canViewAll = useIsAdminView();

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);

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
    } catch (e: any) {
      show(e.message || "Failed to update profile", "error");
    } finally {
      setSaving(false);
    }
  };

  const groupMeetings = useMemo(
    () => meetings.filter((m) => m.groupId === activeGroupId),
    [meetings, activeGroupId],
  );

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

  // ── Desktop layout ──────────────────────────────────────────────────
  if (isWide) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg }}>
        <Toast />
        
        <ScrollView
          contentContainerStyle={st.container}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Profile Section ── */}
          <View style={st.profileSection}>
            {/* User card */}
            <View style={st.userCard}>
              <View style={st.userAvatar}>
                <Text style={st.userAvatarText}>
                  {(authName ?? "U")
                    .split(" ")
                    .map((w: string) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.userName}>{authName ?? "—"}</Text>
                <Text style={st.userEmail}>{authEmail ?? "—"}</Text>
                <Text style={st.userRole}>{role}</Text>
              </View>
              <TouchableOpacity style={st.editBtn} onPress={openProfileEdit}>
                <Text style={st.editBtnText}>Edit</Text>
              </TouchableOpacity>
            </View>

            {/* Access Level */}
            <Text style={st.sectionLabel}>Access Level</Text>
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
            <Text style={st.sectionLabel}>Group</Text>
            <Card style={{ marginBottom: S.lg }}>
              <View style={{ padding: S.lg }}>
                <Text style={st.groupName}>
                  {group?.name ?? "SCDT Savings Group"}
                </Text>
                {group?.description && (
                  <Text style={st.groupDesc}>{group.description}</Text>
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
                <Text style={st.sectionLabel}>Administration</Text>

                {/* Group Settings */}
                <TouchableOpacity
                  style={st.settingsRow}
                  onPress={() => router.push("/group-settings")}
                  activeOpacity={0.7}
                >
                  <View style={st.settingsRowIcon}>
                    <Text style={{ fontSize: 16 }}>⚙</Text>
                  </View>
                  <Text style={st.settingsRowText}>Group Settings</Text>
                  <Text style={{ color: Colors.text3, fontSize: 18 }}>›</Text>
                </TouchableOpacity>

                <Text style={[st.sectionLabel, { marginTop: S.lg }]}>System Status</Text>
                <TouchableOpacity
                  style={st.settingsRow}
                  onPress={triggerForceSync}
                  activeOpacity={0.7}
                >
                  <View style={[st.settingsRowIcon, { backgroundColor: "rgba(59,130,246,0.1)" }]}>
                    <Text style={{ fontSize: 16 }}>⟳</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.settingsRowText}>
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

            <View style={st.divider} />

            <TouchableOpacity
              style={st.signOutBtn}
              onPress={handleSignOut}
              activeOpacity={0.8}
            >
              <Text style={st.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* ── Edit Profile Modal ── */}
        <BottomModal
          visible={editOpen}
          onClose={() => { setEditOpen(false); }}
          title="Edit My Profile"
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
              editable={false}
              hint="Email can only be changed by an admin"
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

            <View style={{ height: 12 }} />
            <Button
              label="Save Changes"
              onPress={handleSaveProfile}
              fullWidth
              loading={saving}
              size="lg"
            />
            <View style={{ height: 20 }} />
          </ScrollView>
        </BottomModal>

        <Toast />
      </View>
    );
  }

  // ── Mobile layout ──────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <Toast />
      
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── User Card ── */}
        <View style={st.mobileUserCard}>
          <View style={st.userAvatar}>
            <Text style={st.userAvatarText}>
              {(authName ?? "U")
                .split(" ")
                .map((w: string) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.userName}>{authName ?? "—"}</Text>
            <Text style={st.userEmail}>{authEmail ?? "—"}</Text>
            <Text style={st.userRole}>{role}</Text>
          </View>
          <TouchableOpacity style={st.editBtn} onPress={openProfileEdit}>
            <Text style={st.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* ── Access Level ── */}
        <Text style={st.sectionLabel}>Access Level</Text>
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

        {/* ── Group Info ── */}
        <Text style={st.sectionLabel}>Group</Text>
        <Card style={{ marginBottom: S.lg }}>
          <View style={{ padding: S.lg }}>
            <Text style={st.groupName}>
              {group?.name ?? "SCDT Savings Group"}
            </Text>
            {group?.description && (
              <Text style={st.groupDesc}>{group.description}</Text>
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

        {/* ── Admin Section ── */}
        {isAdmin && (
          <>
            <Text style={st.sectionLabel}>Administration</Text>

            <TouchableOpacity
              style={st.settingsRow}
              onPress={() => router.push("/group-settings")}
              activeOpacity={0.7}
            >
              <View style={st.settingsRowIcon}>
                <Text style={{ fontSize: 16 }}>⚙</Text>
              </View>
              <Text style={st.settingsRowText}>Group Settings</Text>
              <Text style={{ color: Colors.text3, fontSize: 18 }}>›</Text>
            </TouchableOpacity>

            <Text style={[st.sectionLabel, { marginTop: S.lg }]}>System Status</Text>
            <TouchableOpacity
              style={st.settingsRow}
              onPress={triggerForceSync}
              activeOpacity={0.7}
            >
              <View style={[st.settingsRowIcon, { backgroundColor: "rgba(59,130,246,0.1)" }]}>
                <Text style={{ fontSize: 16 }}>⟳</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.settingsRowText}>
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

        <View style={st.divider} />

        <TouchableOpacity
          style={st.signOutBtn}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Text style={st.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Edit Profile Modal ── */}
      <BottomModal
        visible={editOpen}
        onClose={() => { setEditOpen(false); }}
        title="Edit My Profile"
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
            editable={false}
            hint="Email can only be changed by an admin"
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

          <View style={{ height: 12 }} />
          <Button
            label="Save Changes"
            onPress={handleSaveProfile}
            fullWidth
            loading={saving}
            size="lg"
          />
          <View style={{ height: 20 }} />
        </ScrollView>
      </BottomModal>

      <Toast />
    </View>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const st = StyleSheet.create({
  // ── Container ──
  container: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },

  // ── Profile Section ──
  profileSection: {
    maxWidth: 800,
    alignSelf: "center" as any,
    width: "100%" as any,
  },

  // ── Section Label ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.text2,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 4,
  },

  // ── User Card ──
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.lg,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  mobileUserCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.lg,
  },
  userAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
  },
  userName: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.text,
  },
  userEmail: {
    fontSize: 12,
    color: Colors.text3,
    marginTop: 2,
  },
  userRole: {
    fontSize: 11,
    color: Colors.accent,
    fontWeight: "700",
    marginTop: 2,
    textTransform: "capitalize",
  },
  editBtn: {
    backgroundColor: Colors.primaryFaint,
    borderRadius: R.sm,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  editBtnText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },

  // ── Group Info ──
  groupName: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.text,
    marginBottom: 4,
  },
  groupDesc: {
    fontSize: 12,
    color: Colors.text3,
    lineHeight: 18,
  },

  // ── Settings Row ──
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: R.lg,
    padding: S.lg,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  settingsRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsRowText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },

  // ── Sign Out ──
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 24,
  },
  signOutBtn: {
    backgroundColor: "rgba(220,38,38,0.06)",
    borderWidth: 1.5,
    borderColor: "rgba(220,38,38,0.25)",
    borderRadius: R.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.error,
  },
});