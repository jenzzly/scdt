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
  };
}

const { Home, CreditCard, Wallet, BarChart3, Settings, Calendar, LogOut, DollarSign } = Icons || {};
import { useStore, useCurrentUserRole, useCurrentMember, useDataViewMode } from "../../stores/useStore";
import { useAuth } from "../../hooks/useAuth";
import { useFirebaseSync, useNotificationSync } from "../../hooks/useFirebaseSync";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { Colors, S, R, showConfirm } from "../../utils/theme";
import { BRAND } from "../../lib/brand";

// ─────────────────────────────────────────────
// Nav config
// ─────────────────────────────────────────────
const NAV_ICONS: Record<string, React.ComponentType<{ color?: string; size?: number }> | null> = {
  Dashboard:     Home || null,
  Loans:         CreditCard || null,
  Wallet:        Wallet || null,
  Contributions: DollarSign || null,
  Reports:       BarChart3 || null,
  Meetings:      Calendar || null,
  Settings:      Settings || null,
};

// Desktop sidebar shows everything including Wallet
const DESKTOP_NAV_ITEMS = [
  { label: "Dashboard",     route: "/(tabs)/dashboard"     },
  { label: "Loans",         route: "/(tabs)/loans"         },
  { label: "Wallet",        route: "/(tabs)/wallet"        },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Reports",       route: "/(tabs)/reports"       },
  { label: "Meetings",      route: "/(tabs)/meetings"      },
  { label: "Settings",      route: "/(tabs)/more"          },
];

// Mobile tab bar: hide Wallet, show Contributions
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
function SidebarItem({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) {
  const Icon = NAV_ICONS[label];
  const iconEmoji: Record<string, string> = {
    Dashboard: "🏠",
    Loans: "💳",
    Wallet: "💰",
    Contributions: "💵",
    Reports: "📊",
    Meetings: "📅",
    Settings: "⚙️",
  };
  
  return (
    <TouchableOpacity style={[sb.item, isActive && sb.itemActive]} onPress={onPress} activeOpacity={0.7}>
      <View style={[sb.iconWrap, isActive && sb.iconWrapActive]}>
        {Icon ? <Icon size={16} color={isActive ? Colors.primary : Colors.text3} /> : <Text style={{ fontSize: 16 }}>{iconEmoji[label] || "•"}</Text>}
      </View>
      <Text style={[sb.label, isActive && sb.labelActive]}>{label}</Text>
      {isActive && <View style={sb.activePip} />}
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
  const isOnline = useNetworkStatus();
  const pathname = usePathname();
  const { signOut } = useAuth();

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

  const viewModeSwitch = currentUserRole === "admin" ? (
    <TouchableOpacity
      style={[shared.viewModeSwitch, dataViewMode === "admin" && shared.viewModeSwitchActive]}
      onPress={() => setDataViewMode(dataViewMode === "admin" ? "mine" : "admin")}
      activeOpacity={0.8}
    >
      <Text style={[shared.viewModeText, dataViewMode === "admin" && shared.viewModeTextActive]}>
        {dataViewMode === "admin" ? "Admin view" : "Mine view"}
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
        <View style={sb.sidebar}>
          {/* Brand */}
          <View style={sb.brand}>
            <View style={sb.brandMark}>
              <Text style={sb.brandLetter}>S</Text>
            </View>
            <View>
              <Text style={sb.brandName}>{BRAND.appName}</Text>
              <Text style={sb.brandSub}>Savings Group</Text>
            </View>
          </View>

          {/* Nav */}
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={sb.navList}>
            <Text style={sb.navSection}>Navigation</Text>
            {viewModeSwitch}
            {DESKTOP_NAV_ITEMS.map((item) => (
              <React.Fragment key={item.route}>
                <SidebarItem
                  label={item.label}
                  isActive={!!(pathname?.includes(item.route.replace("/(tabs)/", "")))}
                  onPress={() => { router.push(item.route as any); }}
                />
              </React.Fragment>
            ))}
          </ScrollView>

          {/* Footer */}
          <View style={sb.footer}>
            <View style={sb.userPill}>
              <View style={sb.avatar}>
                <Text style={sb.avatarText}>{initials}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={sb.userName} numberOfLines={1}>{authName ?? "User"}</Text>
                <Text style={sb.userRole}>{currentUserRole}</Text>
              </View>
            </View>
            <TouchableOpacity style={sb.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
              <LogOut size={13} color={Colors.error} />
              <Text style={sb.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Main content */}
        <View style={shared.desktopContent}>
          {offlineBanner}
          <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: "none" } }}>
            <Tabs.Screen name="dashboard"     options={{ title: "Dashboard"     }} />
            <Tabs.Screen name="loans"         options={{ title: "Loans"         }} />
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
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {offlineBanner}
      {viewModeSwitch}
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
        {/* Wallet is accessible by route but hidden from mobile tab bar */}
        <Tabs.Screen
          name="wallet"
          options={{ tabBarButton: () => null }}
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
  brand: {
    flexDirection: "row", alignItems: "center", gap: 11,
    paddingHorizontal: 18, paddingTop: 26, paddingBottom: 20,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
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
  itemStyle: { flex: 1, minWidth: 0, maxWidth: "16.666%" as any, paddingHorizontal: 0 },
  item: {
    flex: 1,
    width: "100%" as any,
    minWidth: 0,
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