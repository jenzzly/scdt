// app/(tabs)/_layout.tsx — REDESIGNED
import React from "react";
import { Tabs, useRouter, usePathname } from "expo-router";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  useWindowDimensions, ScrollView, Alert,
} from "react-native";
import { Home, CreditCard, Wallet, BarChart3, Settings, Calendar, LogOut } from "lucide-react-native";
import { useStore, useCurrentUserRole } from "../../stores/useStore";
import { useAuth } from "../../hooks/useAuth";
import { useFirebaseSync, useNotificationSync } from "../../hooks/useFirebaseSync";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { Colors, S, R, showConfirm } from "../../utils/theme";
import { BRAND } from "../../lib/brand";

// ─────────────────────────────────────────────
// Nav config
// ─────────────────────────────────────────────
const NAV_ICONS: Record<string, React.ComponentType<{ color?: string; size?: number }>> = {
  Dashboard: Home,
  Loans:     CreditCard,
  Wallet:    Wallet,
  Reports:   BarChart3,
  Meetings:  Calendar,
  Settings:  Settings,
};

const NAV_ITEMS = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Loans",     route: "/(tabs)/loans"     },
  { label: "Wallet",    route: "/(tabs)/wallet"    },
  { label: "Reports",   route: "/(tabs)/reports"   },
  { label: "Meetings",  route: "/(tabs)/meetings"  },
  { label: "Settings",  route: "/(tabs)/more"      },
];

// ─────────────────────────────────────────────
// Sidebar item (web)
// ─────────────────────────────────────────────
function SidebarItem({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) {
  const Icon = NAV_ICONS[label];
  return (
    <TouchableOpacity style={[sb.item, isActive && sb.itemActive]} onPress={onPress} activeOpacity={0.7}>
      <View style={[sb.iconWrap, isActive && sb.iconWrapActive]}>
        {Icon && <Icon size={16} color={isActive ? Colors.primary : Colors.text3} />}
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
  return (
    <View style={tb.item}>
      <View style={[tb.iconWrap, focused && tb.iconWrapActive]}>
        {Icon && <Icon size={19} color={focused ? "#fff" : Colors.text3} />}
      </View>
      <Text style={[tb.label, focused && tb.labelActive]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────
// Root layout
// ─────────────────────────────────────────────
export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === "web" && width >= 768;

  const { authUid, activeGroupId, authName, reset } = useStore();
  const currentUserRole = useCurrentUserRole();
  const isOnline = useNetworkStatus();
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();

  useFirebaseSync(activeGroupId, isOnline);
  useNotificationSync(authUid);

  const handleSignOut = () => {
    showConfirm("Sign Out", "Are you sure?", async () => {
      await signOut().catch(() => {});
      reset();
      router.replace("/(auth)/welcome");
    }, undefined, true);
  };

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
            {NAV_ITEMS.map((item) => (
              <SidebarItem
                key={item.route}
                label={item.label}
                isActive={!!(pathname?.includes(item.route.replace("/(tabs)/", "")))}
                onPress={() => router.push(item.route as any)}
              />
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
            <Tabs.Screen name="dashboard" options={{ title: "Dashboard" }} />
            <Tabs.Screen name="loans"     options={{ title: "Loans"     }} />
            <Tabs.Screen name="wallet"    options={{ title: "Wallet"    }} />
            <Tabs.Screen name="reports"   options={{ title: "Reports"   }} />
            <Tabs.Screen name="meetings"  options={{ title: "Meetings"  }} />
            <Tabs.Screen name="more"      options={{ title: "Settings"  }} />
          </Tabs>
        </View>
      </View>
    );
  }

  // ── Mobile layout ─────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {offlineBanner}
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: tb.bar,
        }}
      >
        {NAV_ITEMS.map((item) => (
          <Tabs.Screen
            key={item.route}
            name={item.route.replace("/(tabs)/", "")}
            options={{
              tabBarIcon: ({ focused }) => <TabItem label={item.label} focused={focused} />,
            }}
          />
        ))}
      </Tabs>
    </View>
  );
}

// ─────────────────────────────────────────────
// Shared styles
// ─────────────────────────────────────────────
const shared = StyleSheet.create({
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
    paddingTop: 6,
    paddingBottom: Platform.OS === "ios" ? 22 : 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 12,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  iconWrap: {
    width: 36,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: {
    backgroundColor: Colors.primary,
  },
  label: {
    fontSize: 9,
    fontWeight: "600",
    color: Colors.text3,
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  labelActive: {
    color: Colors.primary,
  },
});