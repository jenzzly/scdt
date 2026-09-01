// app/(tabs)/_layout.tsx — REDESIGNED
import React, { useEffect } from "react";
import { Tabs, useRouter, usePathname } from "expo-router";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  useWindowDimensions, ScrollView, Alert,
} from "react-native";
// Dynamic import to avoid web hydration error with lucide-react-native
let Icons: any;
try {
  Icons = require("lucide-react-native");
} catch (e) {
  // Fallback for web - use simple text emojis
  Icons = {
    Home: null,
    CreditCard: null,
    Wallet: null,
    BarChart3: null,
    Settings: null,
    Calendar: null,
    LogOut: null,
    DollarSign: null,
    TrendingUp: null,
    ChevronLeft: null,
    ChevronRight: null,
    Users: null,
    Bell: null,
  };
}

const { Home, CreditCard, Wallet, BarChart3, Settings, Calendar, LogOut, DollarSign, TrendingUp, ChevronLeft, ChevronRight, Users, Bell } = Icons || {};
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useStore, useCurrentUserRole, useCurrentMember, useDataViewMode, useHasViewToggle, useUnreadNotifs } from "../../stores/useStore";
import { useAuth } from "../../hooks/useAuth";
import { useFirebaseSync, useNotificationSync } from "../../hooks/useFirebaseSync";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { Colors, S, R, showConfirm, fmtDateLong } from "../../utils/theme";
import { BRAND } from "../../lib/brand";

// Route segment → page title, for the shared desktop top header.
const PAGE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  members: "Members",
  contributions: "Contributions",
  loans: "Loans",
  investments: "Investments",
  wallet: "Wallet",
  meetings: "Meetings",
  reports: "Reports",
  more: "Settings",
};

// ─────────────────────────────────────────────
// Nav config
// ─────────────────────────────────────────────
const NAV_ICONS: Record<string, React.ComponentType<{ color?: string; size?: number }> | null> = {
  Dashboard:     Home || null,
  Members:       Users || null,
  Loans:         CreditCard || null,
  Investments:   TrendingUp || null,
  Wallet:        Wallet || null,
  Contributions: DollarSign || null,
  Reports:       BarChart3 || null,
  Meetings:      Calendar || null,
  Settings:      Settings || null
};

// Desktop sidebar. Members is web/desktop-only by design — see
// MOBILE_NAV_ITEMS below, which deliberately omits it — and is placed
// second, matching the reference layout.
const DESKTOP_NAV_ITEMS = [
  { label: "Dashboard",     route: "/(tabs)/dashboard"     },
  { label: "Members",       route: "/(tabs)/members"       },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Loans",         route: "/(tabs)/loans"         },
  { label: "Investments",   route: "/(tabs)/investments"   },
  { label: "Wallet",        route: "/(tabs)/wallet"        },
  { label: "Meetings",      route: "/(tabs)/meetings"      },
  { label: "Reports",       route: "/(tabs)/reports"       },
  { label: "Settings",      route: "/(tabs)/more"          },
];

// Mobile tab bar: hide Wallet and Investments (web only), show Contributions
const MOBILE_NAV_ITEMS = [
  { label: "Dashboard",     route: "/(tabs)/dashboard"     },
  { label: "Loans",         route: "/(tabs)/loans"         },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Reports",       route: "/(tabs)/reports"       },
  { label: "Meetings",      route: "/(tabs)/meetings"      },
  { label: "Settings",      route: "/(tabs)/more"          },
];

// ─────────────────────────────────────────────
// Sidebar item (web)
// ─────────────────────────────────────────────
function SidebarItem({ label, isActive, onPress, collapsed }: { label: string; isActive: boolean; onPress: () => void; collapsed?: boolean }) {
  const Icon = NAV_ICONS[label];
  const iconEmoji: Record<string, string> = {
    Dashboard: "🏠",
    Loans: "💳",
    Investments: "📈",
    Wallet: "💰",
    Contributions: "💵",
    Reports: "📊",
    Meetings: "📅",
    Settings: "⚙️",
    Members: "👥",
  };

  return (
    <TouchableOpacity
      style={[sb.item, isActive && sb.itemActive, collapsed && sb.itemCollapsed]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={label}
    >
      <View style={[sb.iconWrap, isActive && sb.iconWrapActive]}>
        {Icon ? <Icon size={16} color={isActive ? Colors.primary : Colors.text3} /> : <Text style={{ fontSize: 16 }}>{iconEmoji[label] || "•"}</Text>}
      </View>
      {!collapsed && <Text style={[sb.label, isActive && sb.labelActive]}>{label}</Text>}
      {isActive && !collapsed && <View style={sb.activePip} />}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────
// Mobile tab item — icon + label
// ─────────────────────────────────────────────
function TabItem({ label, focused }: { label: string; focused: boolean }) {
  const Icon = NAV_ICONS[label];
  const iconEmoji: Record<string, string> = {
    Dashboard: "🏠",
    Loans: "💳",
    Contributions: "💵",
    Reports: "📊",
    Meetings: "📅",
    Settings: "⚙️",
  };
  
  return (
    <View style={tb.item}>
      <View style={[tb.iconWrap, focused && tb.iconWrapActive]}>
        {Icon ? <Icon size={19} color={focused ? "#fff" : Colors.text3} /> : <Text style={{ fontSize: 19 }}>{iconEmoji[label] || "•"}</Text>}
      </View>
      <Text style={[tb.label, focused && tb.labelActive]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────
// Pending-approval / suspended gate
//
// Rendered instead of the entire tab bar + screen content whenever the
// signed-in user's member record is not yet approved (status "pending")
// or has been suspended. No app data, no navigation — just this screen
// and a sign-out option, until an admin changes their status.
// ─────────────────────────────────────────────
function PendingApprovalScreen({
  onSignOut, memberName, suspended,
}: { onSignOut: () => void; memberName: string; suspended?: boolean }) {
  return (
    <View style={pa.root}>
      <View style={pa.card}>
        <View style={[pa.iconCircle, suspended && pa.iconCircleSuspended]}>
          <Text style={pa.icon}>{suspended ? "⛔" : "⏳"}</Text>
        </View>
        <Text style={pa.title}>
          {suspended ? "Account Suspended" : "Awaiting Approval"}
        </Text>
        <Text style={pa.body}>
          {suspended
            ? `Hi ${memberName}, your account has been suspended by a group admin. Contact them for more information.`
            : `Hi ${memberName}, your account has been created but hasn't been approved by a group admin yet. You'll get full access as soon as they approve your membership.`}
        </Text>
        <View style={pa.divider} />
        <Text style={pa.hint}>
          {suspended
            ? "This isn't something you can resolve yourself — please reach out to your group's administrator."
            : "This usually only takes a short while. Feel free to check back later, or contact your group admin directly."}
        </Text>
        <TouchableOpacity style={pa.signOutBtn} onPress={onSignOut} activeOpacity={0.8}>
          <Text style={pa.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const pa = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: Colors.bg,
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  card: {
    width: "100%", maxWidth: 400,
    backgroundColor: Colors.surface, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border,
    padding: 32, alignItems: "center",
  },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center",
    marginBottom: 20,
  },
  iconCircleSuspended: { backgroundColor: "#FEE2E2" },
  icon: { fontSize: 32 },
  title: { fontSize: 19, fontWeight: "800", color: Colors.text, marginBottom: 10, textAlign: "center" },
  body: { fontSize: 14, color: Colors.text2, textAlign: "center", lineHeight: 21, marginBottom: 20 },
  divider: { width: "100%" as any, height: 1, backgroundColor: Colors.border, marginBottom: 16 },
  hint: { fontSize: 12, color: Colors.text3, textAlign: "center", lineHeight: 18, marginBottom: 24 },
  signOutBtn: {
    width: "100%" as any, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, alignItems: "center",
  },
  signOutText: { fontSize: 14, fontWeight: "700", color: Colors.text2 },
});

// ─────────────────────────────────────────────
// Desktop top header — persistent across every web page: title, date,
// notification bell, current user + role. The sidebar already carries
// the user's name/avatar/sign-out for navigation purposes; this header
// is the page-level identity strip the reference screenshots show.
// ─────────────────────────────────────────────
function DesktopTopHeader({
  title, authName, role, unreadCount, onBellPress,
}: { title: string; authName: string; role: string; unreadCount: number; onBellPress: () => void }) {
  const initials = (authName ?? "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  const today = React.useMemo(() => fmtDateLong(), []);

  return (
    <View style={dh.root}>
      <View>
        <Text style={dh.title}>{title}</Text>
        <Text style={dh.date}>{today}</Text>
      </View>
      <View style={dh.right}>
        <TouchableOpacity style={dh.bellBtn} onPress={onBellPress} activeOpacity={0.7} accessibilityLabel="Notifications">
          {Bell ? <Bell size={18} color={Colors.text2} /> : <Text style={{ fontSize: 16 }}>🔔</Text>}
          {unreadCount > 0 && (
            <View style={dh.badge}>
              <Text style={dh.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <View style={dh.userBlock}>
          <View style={dh.avatar}>
            <Text style={dh.avatarText}>{initials}</Text>
          </View>
          <View>
            <Text style={dh.userName} numberOfLines={1}>{authName ?? "User"}</Text>
            <Text style={dh.userRole}>{role}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const dh = StyleSheet.create({
  root: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 32, paddingVertical: 18,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: 22, fontWeight: "800", color: Colors.text },
  date: { fontSize: 13, color: Colors.text3, marginTop: 2 },
  right: { flexDirection: "row", alignItems: "center", gap: 18 },
  bellBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: Colors.elevated,
  },
  badge: {
    position: "absolute", top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
    backgroundColor: Colors.error, alignItems: "center", justifyContent: "center",
  },
  badgeText: { fontSize: 9, fontWeight: "800", color: "#fff" },
  userBlock: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 13, fontWeight: "800", color: "#fff" },
  userName: { fontSize: 13, fontWeight: "700", color: Colors.text },
  userRole: { fontSize: 11, color: Colors.text3, textTransform: "capitalize", marginTop: 1 },
});

// ─────────────────────────────────────────────
// Root layout
// ─────────────────────────────────────────────
export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === "web" && width >= 768;

  const { authUid, activeGroupId, authName, reset } = useStore();
  const dataViewMode = useDataViewMode();
  const setDataViewMode = useStore((s) => s.setDataViewMode);
  const currentUserRole = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const hasViewToggle = useHasViewToggle();
  const isOnline = useNetworkStatus();
  const unreadCount = useUnreadNotifs();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { signOut } = useAuth();

  // Sidebar collapse — web/desktop only. Persisted across sessions via
  // AsyncStorage (a plain local device preference, not synced through
  // Firestore — there's no need for this to follow the user across
  // devices, and it avoids any write/rules surface for something this
  // cosmetic).
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  React.useEffect(() => {
    AsyncStorage.getItem("sidebarCollapsed").then((v) => {
      if (v === "true") setSidebarCollapsed(true);
    }).catch(() => {});
  }, []);
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      AsyncStorage.setItem("sidebarCollapsed", String(next)).catch(() => {});
      return next;
    });
  };

  // ── Auth guard — redirect to login if no session ──────────────────────────
  const router = useRouter();
  useEffect(() => {
    if (!authUid) {
      router.replace("/(auth)/login");
    }
  }, [authUid]);

  useFirebaseSync(activeGroupId, isOnline);
  useNotificationSync(authUid);

  // Don't render anything while redirecting
  if (!authUid) return null;

  const handleSignOut = () => {
    showConfirm("Sign Out", "Are you sure?", async () => {
      await signOut().catch(() => {});
      reset();
      router.replace("/(auth)/login");
    }, undefined, true);
  };

  // Admin gets the full "Admin view" toggle. loan_officer/committee/
  // accountant get the same switch, but it only reveals their own
  // approval queue (see useIsApproverView) — label it accordingly so
  // it's clear this isn't full admin access.
  const viewModeSwitchLabel = currentUserRole === "admin" ? "Admin view" : "Review view";
  const viewModeSwitch = hasViewToggle ? (
    <TouchableOpacity
      style={[shared.viewModeSwitch, dataViewMode === "admin" && shared.viewModeSwitchActive]}
      onPress={() => setDataViewMode(dataViewMode === "admin" ? "mine" : "admin")}
      activeOpacity={0.8}
    >
      <Text style={[shared.viewModeText, dataViewMode === "admin" && shared.viewModeTextActive]}>
        {dataViewMode === "admin" ? viewModeSwitchLabel : "Mine view"}
      </Text>
    </TouchableOpacity>
  ) : null;

  // ── Pending-approval gate ───────────────────────────────────────────────
  // A member record with status "pending" means an admin hasn't approved
  // this person yet. They must not see ANY app content — not the dashboard,
  // not the tab bar, nothing — until an admin approves them. Admins
  // themselves are never gated (an admin account, by definition, doesn't
  // wait on another admin's approval).
  if (currentMember && currentMember.status === "pending" && currentUserRole !== "admin") {
    return <PendingApprovalScreen onSignOut={handleSignOut} memberName={currentMember.fullName} />;
  }
  if (currentMember && currentMember.status === "suspended") {
    return <PendingApprovalScreen onSignOut={handleSignOut} memberName={currentMember.fullName} suspended />;
  }

  const offlineBanner = !isOnline ? (
    <View style={shared.offlineBanner}>
      <Text style={shared.offlineBannerText}>● Offline — showing cached data</Text>
    </View>
  ) : null;

  // ── Web / Desktop layout ──────────────────
  if (isWide) {
    const initials = (authName ?? "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

    return (
      <View style={shared.desktopRoot}>
        {/* Sidebar */}
        <View style={[sb.sidebar, sidebarCollapsed && sb.sidebarCollapsed]}>
          {/* Brand */}
          <View style={[sb.brand, sidebarCollapsed && sb.brandCollapsed]}>
            {!sidebarCollapsed && (
              <>
                <View style={sb.brandMark}>
                  <Text style={sb.brandLetter}>S</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={sb.brandName}>{BRAND.appName}</Text>
                  <Text style={sb.brandSub}>Savings Group</Text>
                </View>
              </>
            )}
            <TouchableOpacity
              style={sb.collapseBtn}
              onPress={toggleSidebarCollapsed}
              activeOpacity={0.7}
              accessibilityLabel={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed
                ? (ChevronRight ? <ChevronRight size={14} color={Colors.text3} /> : <Text style={sb.collapseBtnText}>›</Text>)
                : (ChevronLeft ? <ChevronLeft size={14} color={Colors.text3} /> : <Text style={sb.collapseBtnText}>‹</Text>)
              }
            </TouchableOpacity>
          </View>

          {/* Nav */}
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={sb.navList}>
            {DESKTOP_NAV_ITEMS.map((item) => (
              <React.Fragment key={item.route}>
                <SidebarItem
                  label={item.label}
                  isActive={!!(pathname?.includes(item.route.replace("/(tabs)/", "")))}
                  onPress={() => { router.push(item.route as any); }}
                  collapsed={sidebarCollapsed}
                />
              </React.Fragment>
            ))}
          </ScrollView>

          {/* Footer */}
          <View style={sb.footer}>
            {!sidebarCollapsed && viewModeSwitch}
            <TouchableOpacity style={sb.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
              <LogOut size={13} color={Colors.error} />
              {!sidebarCollapsed && <Text style={sb.signOutText}>Sign out</Text>}
            </TouchableOpacity>
          </View>
        </View>

        {/* Main content */}
        <View style={shared.desktopContent}>
          <DesktopTopHeader
            title={PAGE_TITLES[pathname?.split("/").filter(Boolean).pop() ?? ""] ?? "Dashboard"}
            authName={authName ?? "User"}
            role={currentUserRole}
            unreadCount={unreadCount}
            onBellPress={() => router.push("/notifications")}
          />
          {offlineBanner}
          <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: "none" } }}>
            <Tabs.Screen name="dashboard"     options={{ title: "Dashboard"     }} />
            <Tabs.Screen name="members"       options={{ title: "Members"       }} />
            <Tabs.Screen name="loans"         options={{ title: "Loans"         }} />
            <Tabs.Screen name="investments"   options={{ title: "Investments"   }} />
            <Tabs.Screen name="wallet"        options={{ title: "Wallet"        }} />
            <Tabs.Screen name="contributions" options={{ title: "Contributions" }} />
            <Tabs.Screen name="reports"       options={{ title: "Reports"       }} />
            <Tabs.Screen name="meetings"      options={{ title: "Meetings"      }} />
            <Tabs.Screen name="more"          options={{ title: "Settings"      }} />
          </Tabs>
        </View>
      </View>
    );
  }

  // ── Mobile layout ─────────────────────────
  // Only the offlineBanner/viewModeSwitch strip gets the safe-area inset
  // here — each screen underneath (dashboard.tsx, loans.tsx, etc.)
  // already has its own hardcoded top padding for the status bar/notch.
  // Adding insets.top to this whole wrapper would stack on top of that
  // per-screen padding and push every screen down twice.
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{ paddingTop: insets.top, backgroundColor: Colors.bg }}>
        {offlineBanner}
        {viewModeSwitch}
      </View>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: tb.bar,
          tabBarItemStyle: tb.itemStyle,
        }}
      >
        {MOBILE_NAV_ITEMS.map((item) => (
          <Tabs.Screen
            key={item.route}
            name={item.route.replace("/(tabs)/", "")}
            options={{
              tabBarIcon: ({ focused }: { focused: boolean }) => <TabItem label={item.label} focused={focused} />,
            }}
          />
        ))}
        {/* Wallet and Investments are accessible by route (web sidebar,
            direct push) but excluded from the mobile tab bar entirely.
            `href: null` is the correct way to do this — it removes the
            route from the tab bar's layout entirely. A previous
            `tabBarButton: () => null` only hid the button; current
            React Navigation still reserves an empty slot for it, which
            threw off the equal-width spacing of the other tabs. */}
        <Tabs.Screen
          name="wallet"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="investments"
          options={{ href: null }}
        />
      </Tabs>
    </View>
  );
}

// ─────────────────────────────────────────────
// Shared styles
// ─────────────────────────────────────────────
const shared = StyleSheet.create({
  viewModeSwitch: {
    marginHorizontal: 14, marginVertical: 8, paddingVertical: 9,
    borderRadius: 9, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.elevated, alignItems: "center",
  },
  viewModeSwitchActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  viewModeText: { fontSize: 12, fontWeight: "700", color: Colors.text2 },
  viewModeTextActive: { color: "#fff" },
  offlineBanner: {
    backgroundColor: Colors.error,
    paddingVertical: 6,
    alignItems: "center",
  },
  offlineBannerText: {
    color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.3,
  },
  desktopRoot: {
    flex: 1, flexDirection: "row", backgroundColor: Colors.bg,
  },
  desktopContent: {
    flex: 1, overflow: "hidden",
  },
});

// ─────────────────────────────────────────────
// Sidebar styles
// ─────────────────────────────────────────────
const sb = StyleSheet.create({
  sidebar: {
    width: 224,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    flexDirection: "column",
  },
  sidebarCollapsed: {
    width: 68,
  },
  brand: {
    flexDirection: "row", alignItems: "center", gap: 11,
    paddingHorizontal: 18, paddingTop: 26, paddingBottom: 20,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  brandCollapsed: {
    paddingHorizontal: 10, gap: 0, justifyContent: "center",
  },
  collapseBtn: {
    width: 22, height: 22, borderRadius: 6,
    alignItems: "center", justifyContent: "center",
    backgroundColor: Colors.elevated,
  },
  collapseBtnText: { fontSize: 14, fontWeight: "700", color: Colors.text3, lineHeight: 16 },
  brandMark: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: Colors.primary,
    alignItems: "center", justifyContent: "center",
  },
  brandLetter: { fontSize: 14, fontWeight: "800", color: "#fff" },
  brandName:   { fontSize: 14, fontWeight: "700", color: Colors.text, lineHeight: 18 },
  brandSub:    { fontSize: 10, color: Colors.text3, lineHeight: 14 },
  navList:     { paddingHorizontal: 10, paddingTop: 14, paddingBottom: 10 },
  navSection: {
    fontSize: 9, fontWeight: "700", color: Colors.text3,
    textTransform: "uppercase", letterSpacing: 1,
    paddingHorizontal: 8, marginBottom: 6,
  },
  item: {
    flexDirection: "row", alignItems: "center", gap: 9,
    paddingHorizontal: 8, paddingVertical: 8,
    borderRadius: R.md, marginBottom: 1,
    position: "relative",
  },
  itemActive:  { backgroundColor: Colors.primaryFaint ?? "rgba(13,148,136,0.08)" },
  iconWrap: {
    width: 28, height: 28, borderRadius: 7,
    alignItems: "center", justifyContent: "center",
  },
  iconWrapActive: { backgroundColor: "rgba(13,148,136,0.12)" },
  label:       { flex: 1, fontSize: 13, fontWeight: "600", color: Colors.text2 },
  labelActive: { color: Colors.primary, fontWeight: "700" },
  activePip: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  footer: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    padding: 14, gap: 10,
  },
  userPill: {
    flexDirection: "row", alignItems: "center", gap: 9,
    backgroundColor: Colors.elevated,
    borderRadius: R.md, padding: 8,
  },
  avatar: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: Colors.primary,
    alignItems: "center", justifyContent: "center",
  },
  avatarText:  { fontSize: 11, fontWeight: "800", color: "#fff" },
  userName:    { fontSize: 12, fontWeight: "600", color: Colors.text },
  userRole:    { fontSize: 10, color: Colors.text3, textTransform: "capitalize", marginTop: 1 },
  signOutBtn: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: R.md,
    backgroundColor: "rgba(220,38,38,0.05)",
    borderWidth: 1, borderColor: "rgba(220,38,38,0.12)",
  },
  signOutText: { fontSize: 12, fontWeight: "700", color: Colors.error },
});

// ─────────────────────────────────────────────
// Mobile tab bar styles — with labels
// ─────────────────────────────────────────────
const tb = StyleSheet.create({
  bar: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    height: Platform.OS === "ios" ? 82 : 66,
    paddingHorizontal: 2,
    paddingTop: 4,
    paddingBottom: Platform.OS === "ios" ? 20 : 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 12,
  },
  // Equal-width, compact tabs: `flex: 1` on every visible tab item is
  // sufficient on its own to divide the bar evenly — no need for a
  // hardcoded maxWidth tied to a specific tab count (that broke silently
  // any time a tab was added/removed, and the two constraints fighting
  // each other is what produced uneven/"weird" spacing on some widths).
  itemStyle: { flex: 1, minWidth: 0, paddingHorizontal: 0 },
  item: {
    flex: 1,
    minWidth: 0,
    maxWidth: "100%" as any,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  iconWrap: {
    width: 32,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: {
    backgroundColor: Colors.primary,
  },
  label: {
    fontSize: 8,
    fontWeight: "600",
    color: Colors.text3,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  labelActive: {
    color: Colors.primary,
  },
});