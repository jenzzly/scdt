// app/(tabs)/more.tsx
//
// Profile + settings screen. Previously written twice — one JSX tree
// gated on `width >= 768`, one below — which meant every tweak to the
// profile card or admin section had to be made in two places and could
// drift. This version is a single responsive layout: `isWide` only
// controls the outer content width, and the shared pieces (profile
// header, section cards, admin rows, edit modal) are defined once.
import React, { useCallback, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore,
  useCurrentUserRole,
  useCurrentMember,
} from "../../stores/useStore";
import {
  Card,
  Button,
  BottomModal,
  Input,
  Select,
  useToast,
  Toast,
  InfoRow,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import {
  Colors,
  S,
  R,
  fmtCurrency,
  showConfirm,
  round2,
} from "../../utils/theme";

// ─────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────

const SYNC_COLOR: Record<string, string> = {
  synced:  Colors.success,
  syncing: Colors.warning,
  pending: Colors.warning,
  failed:  Colors.error,
  offline: Colors.text3,
};

const ADMIN_ACTIONS: { label: string; icon: string; section: string }[] = [
  // Re-add "Permissions" / "Audit Log" here when those sections ship.
  { label: "Group Settings", icon: "🏦", section: "settings" },
];

const LANGUAGE_OPTIONS = [
  { label: "English",     value: "en" },
  { label: "Français",    value: "fr" },
  { label: "Kinyarwanda", value: "rw" },
];

// ─────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const { signOut, resetPassword } = useAuth();
  const { show, visible, msg, type } = useToast();

  const group = useStore((s) => s.groups.find((g) => g.id === s.activeGroupId));
  const syncStatus = useStore((s) => s.syncStatus);
  const syncError = useStore((s) => s.syncError);
  const lastSyncTimestamp = useStore((s) => s.lastSyncTimestamp);
  const triggerForceSync = useStore((s) => s.triggerForceSync);
  const reset = useStore((s) => s.reset);
  const updateOwnProfile = useStore((s) => s.updateOwnProfile);
  const authName = useStore((s) => s.authName);
  const authEmail = useStore((s) => s.authEmail);

  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const isAdmin = role === "admin";

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    languagePreference: "en",
    nationalId: "",
    physicalAddress: "",
    role: "member",
  });

  // ── Profile edit ────────────────────────────────────────────────────
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

  // ── Sign out / password reset ───────────────────────────────────────
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

  const handlePasswordReset = async () => {
    if (!authEmail) {
      show("No email address found for password reset", "error");
      return;
    }
    setResetLoading(true);
    try {
      await resetPassword(authEmail);
      show("Password reset email sent to " + authEmail, "success");
    } catch (e: any) {
      show(e.message || "Failed to send password reset email", "error");
    } finally {
      setResetLoading(false);
    }
  };

  // ── Derived display values ──────────────────────────────────────────
  const initials = (authName ?? "U")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const permissionsLabel = isAdmin
    ? "Full access"
    : ["loan_officer", "committee", "accountant"].includes(role)
    ? "Financial access"
    : "Personal only";

  const latePenaltyAmount = round2(
    ((group?.contributionAmount ?? 0) * (group?.latePenaltyRatePct ?? 5)) / 100,
  );
  const latePenaltyLabel = `${group?.latePenaltyRatePct ?? 5}% ≈ ${fmtCurrency(
    latePenaltyAmount,
  )} per 15min`;

  const syncColor = SYNC_COLOR[syncStatus] ?? Colors.text3;
  const lastSyncLabel = lastSyncTimestamp
    ? new Date(lastSyncTimestamp).toLocaleString()
    : "Never";

  return (
    <View style={st.root}>
      <Toast visible={visible} msg={msg} type={type} />

      <ScrollView
        contentContainerStyle={[
          st.scrollContent,
          isWide && st.scrollContentWide,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile card ── */}
        <View style={st.userCard}>
          <View style={st.userAvatar}>
            <Text style={st.userAvatarText}>{initials}</Text>
          </View>
          <View style={st.userInfo}>
            <Text style={st.userName} numberOfLines={1}>
              {authName ?? "—"}
            </Text>
            <Text style={st.userEmail} numberOfLines={1}>
              {authEmail ?? "—"}
            </Text>
            <Text style={st.userRole}>{role}</Text>
          </View>
          <TouchableOpacity
            style={st.editBtn}
            onPress={openProfileEdit}
            activeOpacity={0.7}
          >
            <Text style={st.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* ── Access level ── */}
        <Text style={st.sectionLabel}>Access Level</Text>
        <Card style={st.mbLg}>
          <View style={st.cardBody}>
            <InfoRow label="Role" value={role} accent />
            <InfoRow label="Permissions" value={permissionsLabel} />
          </View>
        </Card>

        {/* ── Group ── */}
        <Text style={st.sectionLabel}>Group</Text>
        <Card style={st.mbLg}>
          <View style={st.cardBody}>
            <Text style={st.groupName}>
              {group?.name ?? "SCDT Savings Group"}
            </Text>
            {group?.description ? (
              <Text style={st.groupDesc}>{group.description}</Text>
            ) : null}
          </View>
          <View style={st.cardFooter}>
            <InfoRow label="Currency" value={group?.currency ?? "RWF"} />
            <InfoRow
              label="Contribution"
              value={fmtCurrency(group?.contributionAmount ?? 0)}
              accent
            />
            <InfoRow
              label="Loan Rate"
              value={`${group?.loanInterestRate ?? 2}% / ${
                group?.loanInterestRatePeriod === "annual" ? "year" : "month"
              }`}
            />
            <InfoRow label="Late Penalty" value={latePenaltyLabel} />
          </View>
        </Card>

        {/* ── Admin section ── */}
        {isAdmin ? (
          <>
            <Text style={[st.sectionLabel, st.mtLg]}>Administration</Text>
            {ADMIN_ACTIONS.map((item) => (
              <TouchableOpacity
                key={item.section}
                style={st.actionRow}
                onPress={() =>
                  router.push({
                    pathname: "/group-settings",
                    params: { activeSection: item.section },
                  })
                }
                activeOpacity={0.7}
              >
                <View style={st.actionIcon}>
                  <Text style={st.actionIconText}>{item.icon}</Text>
                </View>
                <Text style={st.actionLabel}>{item.label}</Text>
                <Text style={st.actionChevron}>›</Text>
              </TouchableOpacity>
            ))}

            <Text style={[st.sectionLabel, st.mtLg]}>System Status</Text>
            <TouchableOpacity
              style={st.actionRow}
              onPress={triggerForceSync}
              activeOpacity={0.7}
            >
              <View style={[st.actionIcon, st.actionIconSync]}>
                <Text style={st.actionIconText}>⟳</Text>
              </View>
              <View style={st.actionText}>
                <View style={st.syncHeader}>
                  <View style={[st.syncDot, { backgroundColor: syncColor }]} />
                  <Text style={st.actionLabelText}>
                    Sync Status:{" "}
                    <Text style={st.capitalize}>{syncStatus}</Text>
                  </Text>
                </View>
                <Text style={st.actionSub}>Last synced: {lastSyncLabel}</Text>
                {syncError ? (
                  <Text style={st.actionError} numberOfLines={2}>
                    {syncError}
                  </Text>
                ) : null}
              </View>
              <Text style={st.actionTrailing}>Force Sync</Text>
            </TouchableOpacity>
          </>
        ) : null}

        <View style={st.divider} />

        <TouchableOpacity
          style={st.secondaryBtn}
          onPress={handlePasswordReset}
          disabled={resetLoading}
          activeOpacity={0.8}
        >
          <Text style={st.secondaryBtnText}>
            {resetLoading ? "Sending..." : "Reset Password"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={st.dangerBtn}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Text style={st.dangerBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Edit Profile Modal ── */}
      <BottomModal
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit My Profile"
      >
        <ScrollView
          contentContainerStyle={st.modalContent}
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
            onChangeText={(v) =>
              setEditForm((f) => ({ ...f, physicalAddress: v }))
            }
            placeholder="Address"
          />
          <Select
            label="Language"
            value={editForm.languagePreference}
            options={LANGUAGE_OPTIONS}
            onChange={(v) =>
              setEditForm((f) => ({ ...f, languagePreference: v }))
            }
          />

          <View style={st.modalSpacer} />
          <Button
            label="Save Changes"
            onPress={handleSaveProfile}
            fullWidth
            loading={saving}
            size="lg"
          />
          <View style={st.modalBottomSpacer} />
        </ScrollView>
      </BottomModal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  scrollContentWide: {
    paddingHorizontal: 24,
    paddingTop: 16,
    maxWidth: 800,
    width: "100%" as any,
    alignSelf: "center" as any,
  },

  // ── Profile card ──
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
  userAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarText: { fontSize: 18, fontWeight: "800", color: "#fff" },
  userInfo: { flex: 1, minWidth: 0 },
  userName: { fontSize: 16, fontWeight: "800", color: Colors.text },
  userEmail: { fontSize: 12, color: Colors.text3, marginTop: 2 },
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
  editBtnText: { color: Colors.primary, fontSize: 12, fontWeight: "700" },

  // ── Section labels & card padding ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.text2,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 4,
  },
  mtLg: { marginTop: S.lg },
  mbLg: { marginBottom: S.lg },
  cardBody: { padding: S.lg },
  cardFooter: { paddingHorizontal: S.lg, paddingBottom: S.md },

  // ── Group card ──
  groupName: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.text,
    marginBottom: 4,
  },
  groupDesc: { fontSize: 12, color: Colors.text3, lineHeight: 18 },

  // ── Action rows ──
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconSync: { backgroundColor: "rgba(59,130,246,0.1)" },
  actionIconText: { fontSize: 16 },

  actionLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },
  actionLabelText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },

  actionText: { flex: 1, minWidth: 0 },
  actionSub: { fontSize: 11, color: Colors.text3, marginTop: 2 },
  actionError: { fontSize: 11, color: Colors.error, marginTop: 2 },
  actionTrailing: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  actionChevron: { color: Colors.text3, fontSize: 18 },

  syncHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  capitalize: { textTransform: "capitalize" },

  // ── Bottom buttons ──
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 24,
  },
  secondaryBtn: {
    backgroundColor: "rgba(59,130,246,0.06)",
    borderWidth: 1.5,
    borderColor: "rgba(59,130,246,0.25)",
    borderRadius: R.lg,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "700", color: Colors.primary },
  dangerBtn: {
    backgroundColor: "rgba(220,38,38,0.06)",
    borderWidth: 1.5,
    borderColor: "rgba(220,38,38,0.25)",
    borderRadius: R.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  dangerBtnText: { fontSize: 14, fontWeight: "700", color: Colors.error },

  // ── Modal ──
  modalContent: { padding: S.lg },
  modalSpacer: { height: 12 },
  modalBottomSpacer: { height: 20 },
});
