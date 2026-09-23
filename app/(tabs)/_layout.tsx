// app/(tabs)/_layout.tsx
import React, { useEffect } from "react";
import { Tabs, useRouter, usePathname } from "expo-router";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  useWindowDimensions, ScrollView, Animated,
} from "react-native";

// Dynamic import to avoid web hydration error with lucide-react-native
let Icons: any;
try {
  Icons = require("lucide-react-native");
} catch (e) {
  Icons = {
    Home: null, CreditCard: null, Wallet: null, BarChart3: null,
    Settings: null, Calendar: null, LogOut: null, DollarSign: null,
    TrendingUp: null, ChevronLeft: null, ChevronRight: null,
    Users: null, Bell: null, RefreshCw: null,
  };
}

const {
  Home, CreditCard, Wallet, BarChart3, Settings, Calendar, LogOut,
  DollarSign, TrendingUp, ChevronLeft, ChevronRight, Users, Bell,
} = Icons || {};

import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useStore,
  useCurrentUserRole,
  useCurrentMember,
  useUnreadNotifs,
  useActiveGroup,
} from "../../stores/useStore";
import { useAuth } from "../../hooks/useAuth";
import { useFirebaseSync, useNotificationSync } from "../../hooks/useFirebaseSync";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { Colors, R, showConfirm, fmtDateLong } from "../../utils/theme";
import { BRAND } from "../../lib/brand";
import { getWebNavForRole } from "../../lib/auth/permissions";
import { ViewSwitch } from "../../components/ui/ViewSwitch";

// ─────────────────────────────────────────────────────────────────────────
// Route registry
//
// Expo Router discovers every .tsx file in app/(tabs)/ as a potential tab.
// A <Tabs.Screen> declaration only customizes an already-discovered route;
// omitting one entirely means the route renders with DEFAULT options — no
// icon, no label, invisible tap target. The fix is to declare EVERY route
// here and use `href: null` on the ones not in the current role's nav.
//
// Add new tab files here (and to getWebNavForRole if a role should see
// them) — otherwise they leak as blank tabs on mobile.
// ─────────────────────────────────────────────────────────────────────────
const ALL_TAB_ROUTES = [
  "dashboard",
  "contributions",
  "loans",
  "investments",
  "meetings",
  "members",
  "wallet",
  "reports",
  "more",
] as const;

type TabRoute = typeof ALL_TAB_ROUTES[number];

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

const MOBILE_HIDDEN_ROUTES = new Set<string>([
  "/(tabs)/investments",
  "/(tabs)/wallet",
  // Members is deliberately NOT hidden — it's the "my stats" page for
  // a regular member and shows their own card + risk breakdown.
]);

const NAV_ICONS: Record<string, React.ComponentType<{ color?: string; size?: number }> | null> = {
  Dashboard: Home || null,
  Members: Users || null,
  Loans: CreditCard || null,
  Investments: TrendingUp || null,
  Wallet: Wallet || null,
  Contributions: DollarSign || null,
  Reports: BarChart3 || null,
  Meetings: Calendar || null,
  Settings: Settings || null,
};

function SidebarItem({
  label,
  isActive,
  onPress,
  collapsed,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  collapsed?: boolean;
}) {
  const Icon = NAV_ICONS[label];

  const iconEmoji: Record<string, string> = {
    Dashboard: "🏠", Loans: "💳", Investments: "📈", Wallet: "💰",
    Contributions: "💵", Reports: "📊", Meetings: "📅",
    Settings: "⚙️", Members: "👥",
  };

  return (
    <TouchableOpacity
      style={[sb.item, isActive && sb.itemActive, collapsed && sb.itemCollapsed]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={label}
    >
      <View style={[sb.iconWrap, isActive && sb.iconWrapActive]}>
        {Icon ? (
          <Icon size={16} color={isActive ? Colors.primary : Colors.text3} />
        ) : (
          <Text style={{ fontSize: 16 }}>{iconEmoji[label] || "•"}</Text>
        )}
      </View>

      {!collapsed && (
        <Text style={[sb.label, isActive && sb.labelActive]}>{label}</Text>
      )}

      {isActive && !collapsed && <View style={sb.activePip} />}
    </TouchableOpacity>
  );
}

function SpinningRefreshIcon({
  spinning, size, color,
}: {
  spinning: boolean; size: number; color: string;
}) {
  const spin = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    if (spinning) {
      spin.setValue(0);
      loop = Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 800, useNativeDriver: true })
      );
      loop.start();
    } else {
      spin.stopAnimation();
      spin.setValue(0);
    }
    return () => loop?.stop();
  }, [spinning]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      {Icons?.RefreshCw ? (
        <Icons.RefreshCw size={size} color={color} />
      ) : (
        <Text style={{ fontSize: size }}>↻</Text>
      )}
    </Animated.View>
  );
}

function TabItem({ label, focused }: { label: string; focused: boolean }) {
  const Icon = NAV_ICONS[label];

  const iconEmoji: Record<string, string> = {
    Dashboard: "🏠", Loans: "💳", Contributions: "💵",
    Reports: "📊", Meetings: "📅", Settings: "⚙️",
  };

  return (
    <View style={tb.item}>
      <View style={[tb.iconWrap, focused && tb.iconWrapActive]}>
        {Icon ? (
          <Icon size={19} color={focused ? "#fff" : Colors.text3} />
        ) : (
          <Text style={{ fontSize: 19 }}>{iconEmoji[label] || "•"}</Text>
        )}
      </View>
      <Text style={[tb.label, focused && tb.labelActive]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// Reasons a signed-in user can be blocked from the app. Kept as a
// string union rather than separate boolean flags so adding a new
// blocked state is a single-entry change to the config map below.
type BlockedVariant = "pending" | "suspended" | "inactive" | "exited";

function PendingApprovalScreen({
  onSignOut,
  memberName,
  variant = "pending",
}: {
  onSignOut: () => void;
  memberName: string;
  variant?: BlockedVariant;
}) {
  const config: Record<
    BlockedVariant,
    { icon: string; iconBg: string; title: string; body: string; hint: string }
  > = {
    pending: {
      icon: "⏳",
      iconBg: "#FEF3C7",
      title: "Awaiting Approval",
      body: `Hi ${memberName}, your account has been created but hasn't been approved by a group admin yet. You'll get full access as soon as they approve your membership.`,
      hint:
        "This usually only takes a short while. Feel free to check back later, or contact your group admin directly.",
    },
    suspended: {
      icon: "⛔",
      iconBg: "#FEE2E2",
      title: "Account Suspended",
      body: `Hi ${memberName}, your account has been suspended by a group admin. Contact them for more information.`,
      hint:
        "This isn't something you can resolve yourself — please reach out to your group's administrator.",
    },
    inactive: {
      icon: "🚫",
      iconBg: "#FEE2E2",
      title: "Account Deactivated",
      body: `Hi ${memberName}, your account has been deactivated by a group admin.`,
      hint:
        "You won't be able to access group data until your account is reactivated by an administrator. Contact your group admin if you believe this is a mistake.",
    },
    exited: {
      icon: "👋",
      iconBg: "#E0E7FF",
      title: "Membership Ended",
      body: `Hi ${memberName}, your membership in this group has ended.`,
      hint:
        "If you'd like to rejoin, please contact a group administrator.",
    },
  };

  const c = config[variant];

  return (
    <View style={pa.root}>
      <View style={pa.card}>
        <View style={[pa.iconCircle, { backgroundColor: c.iconBg }]}>
          <Text style={pa.icon}>{c.icon}</Text>
        </View>
        <Text style={pa.title}>{c.title}</Text>
        <Text style={pa.body}>{c.body}</Text>
        <View style={pa.divider} />
        <Text style={pa.hint}>{c.hint}</Text>
        <TouchableOpacity
          style={pa.signOutBtn}
          onPress={onSignOut}
          activeOpacity={0.8}
        >
          <Text style={pa.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DesktopTopHeader({
  title, authName, role, unreadCount, onBellPress, groupName,
  onRefresh, isSyncing, onEditProfile, onSignOut,
}: {
  title: string; authName: string; role: string; unreadCount: number;
  isSyncing: boolean; onBellPress: () => void; groupName?: string;
  onRefresh: () => void; onEditProfile: () => void; onSignOut: () => void;
}) {
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);

  const initials = (authName ?? "U")
    .split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  const today = React.useMemo(() => fmtDateLong(), []);

  return (
    <View style={dh.root}>
      <View style={dh.left}>
        <View style={dh.titleRow}>
          <Text style={dh.title}>{title}</Text>
          {groupName && <Text style={dh.groupTag}>· {groupName}</Text>}
        </View>
        <Text style={dh.date}>{today}</Text>
      </View>

      <View style={dh.right}>
        <ViewSwitch />

        <TouchableOpacity
          style={dh.refreshBtn}
          onPress={onRefresh}
          activeOpacity={0.7}
          disabled={isSyncing}
          accessibilityRole="button"
          accessibilityLabel="Refresh sync"
        >
          <SpinningRefreshIcon spinning={isSyncing} size={17} color={Colors.text2} />
        </TouchableOpacity>

        <TouchableOpacity
          style={dh.bellBtn}
          onPress={onBellPress}
          activeOpacity={0.7}
          accessibilityLabel="Notifications"
        >
          {Bell ? <Bell size={18} color={Colors.text2} /> : <Text style={{ fontSize: 16 }}>🔔</Text>}
          {unreadCount > 0 && (
            <View style={dh.badge}>
              <Text style={dh.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={dh.avatarWrap}>
          <TouchableOpacity
            style={dh.avatarBtn}
            onPress={() => setUserMenuOpen((v) => !v)}
            activeOpacity={0.7}
            accessibilityLabel="Account menu"
          >
            <View style={dh.avatar}>
              <Text style={dh.avatarText}>{initials}</Text>
            </View>
          </TouchableOpacity>

          {userMenuOpen && (
            <>
              <TouchableOpacity
                style={dh.menuBackdrop}
                activeOpacity={1}
                onPress={() => setUserMenuOpen(false)}
              />
              <View style={dh.dropdown}>
                <View style={dh.dropdownHeader}>
                  <Text style={dh.dropdownName} numberOfLines={1}>{authName ?? "User"}</Text>
                  <Text style={dh.dropdownRole}>{role?.replace("_", " ")}</Text>
                </View>
                <View style={dh.dropdownDivider} />
                <TouchableOpacity
                  style={dh.dropdownItem}
                  onPress={() => { setUserMenuOpen(false); onEditProfile(); }}
                  activeOpacity={0.7}
                >
                  <Text style={dh.dropdownItemText}>Edit Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={dh.dropdownItem}
                  onPress={() => { setUserMenuOpen(false); onSignOut(); }}
                  activeOpacity={0.7}
                >
                  <Text style={[dh.dropdownItemText, { color: Colors.error }]}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

function MobileTopHeader({
  title, unreadCount, onBellPress, groupName, onRefresh, isSyncing,
}: {
  title: string; unreadCount: number; isSyncing: boolean;
  onBellPress: () => void; groupName?: string; onRefresh: () => void;
}) {
  return (
    <View style={mh.root}>
      <View style={mh.left}>
        <View style={mh.brandMark}>
          <Text style={mh.brandLetter}>S</Text>
        </View>
        <View style={{ minWidth: 0, flexShrink: 1 }}>
          <Text style={mh.title} numberOfLines={1}>{title}</Text>
          {groupName && <Text style={mh.groupSub} numberOfLines={1}>{groupName}</Text>}
        </View>
      </View>

      <View style={mh.right}>
        <ViewSwitch compact />

        <TouchableOpacity
          style={mh.refreshBtn}
          onPress={onRefresh}
          activeOpacity={0.7}
          disabled={isSyncing}
          accessibilityRole="button"
          accessibilityLabel="Refresh sync"
        >
          <SpinningRefreshIcon spinning={isSyncing} size={15} color={Colors.text2} />
        </TouchableOpacity>

        <TouchableOpacity
          style={mh.bellBtn}
          onPress={onBellPress}
          activeOpacity={0.7}
          accessibilityLabel="Notifications"
        >
          {Bell ? <Bell size={16} color={Colors.text2} /> : <Text style={{ fontSize: 14 }}>🔔</Text>}
          {unreadCount > 0 && (
            <View style={mh.badge}>
              <Text style={mh.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const pa = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 400, backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 32, alignItems: "center" },
  iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  iconCircleSuspended: { backgroundColor: "#FEE2E2" },
  icon: { fontSize: 32 },
  title: { fontSize: 19, fontWeight: "800", color: Colors.text, marginBottom: 10, textAlign: "center" },
  body: { fontSize: 14, color: Colors.text2, textAlign: "center", lineHeight: 21, marginBottom: 20 },
  divider: { width: "100%" as any, height: 1, backgroundColor: Colors.border, marginBottom: 16 },
  hint: { fontSize: 12, color: Colors.text3, textAlign: "center", lineHeight: 18, marginBottom: 24 },
  signOutBtn: { width: "100%" as any, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: "center" },
  signOutText: { fontSize: 14, fontWeight: "700", color: Colors.text2 },
});

const dh = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 32, paddingVertical: 14, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border, zIndex: 100, elevation: 10 },
  left: { flexDirection: "column", gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 20, fontWeight: "800", color: Colors.text },
  groupTag: { fontSize: 13, fontWeight: "600", color: Colors.primary },
  date: { fontSize: 12, color: Colors.text3 },
  right: { flexDirection: "row", alignItems: "center", gap: 14, zIndex: 100 },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border },
  bellBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: Colors.error, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 9, fontWeight: "800", color: "#fff" },
  avatarWrap: { position: "relative", zIndex: 1000 },
  avatarBtn: { borderRadius: 10 },
  avatar: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 13, fontWeight: "800", color: "#fff" },
  menuBackdrop: { position: "absolute", top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 999, elevation: 999 },
  dropdown: { position: "absolute", top: 44, right: 0, width: 200, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 1000, zIndex: 1000, overflow: "hidden" },
  dropdownHeader: { padding: 12 },
  dropdownName: { fontSize: 13, fontWeight: "700", color: Colors.text },
  dropdownRole: { fontSize: 11, color: Colors.text3, textTransform: "capitalize", marginTop: 2 },
  dropdownDivider: { height: 1, backgroundColor: Colors.border },
  dropdownItem: { paddingVertical: 10, paddingHorizontal: 12 },
  dropdownItemText: { fontSize: 13, fontWeight: "600", color: Colors.text2 },
});

const mh = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  left: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0, marginRight: 8 },
  brandMark: { width: 28, height: 28, borderRadius: 7, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  brandLetter: { fontSize: 13, fontWeight: "800", color: "#fff" },
  title: { fontSize: 16, fontWeight: "800", color: Colors.text },
  groupSub: { fontSize: 9, color: Colors.text3, fontWeight: "600" },
  right: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  refreshBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border },
  bellBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border },
  badge: { position: "absolute", top: -3, right: -3, minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 2, backgroundColor: Colors.error, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 8, fontWeight: "800", color: "#fff" },
});

const shared = StyleSheet.create({
  offlineBanner: { backgroundColor: Colors.error, paddingVertical: 6, alignItems: "center" },
  offlineBannerText: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  desktopRoot: { flex: 1, flexDirection: "row", backgroundColor: Colors.bg },
  desktopContent: { flex: 1, overflow: "hidden" },
});

const sb = StyleSheet.create({
  sidebar: { width: 224, backgroundColor: Colors.surface, borderRightWidth: 1, borderRightColor: Colors.border, flexDirection: "column" },
  sidebarCollapsed: { width: 68 },
  brand: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 18, paddingTop: 26, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: Colors.border },
  brandCollapsed: { paddingHorizontal: 10, gap: 0, justifyContent: "center" },
  collapseBtn: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: Colors.elevated },
  collapseBtnText: { fontSize: 14, fontWeight: "700", color: Colors.text3, lineHeight: 16 },
  brandMark: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  brandLetter: { fontSize: 14, fontWeight: "800", color: "#fff" },
  brandName: { fontSize: 14, fontWeight: "700", color: Colors.text, lineHeight: 18 },
  brandSub: { fontSize: 10, color: Colors.text3, lineHeight: 14 },
  navList: { paddingHorizontal: 10, paddingTop: 14, paddingBottom: 10 },
  item: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 8, paddingVertical: 8, borderRadius: R.md, marginBottom: 1, position: "relative" },
  itemCollapsed: { justifyContent: "center" },
  itemActive: { backgroundColor: Colors.primaryFaint ?? "rgba(13,148,136,0.08)" },
  iconWrap: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  iconWrapActive: { backgroundColor: "rgba(13,148,136,0.12)" },
  label: { flex: 1, fontSize: 13, fontWeight: "600", color: Colors.text2 },
  labelActive: { color: Colors.primary, fontWeight: "700" },
  activePip: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary },
  footer: { borderTopWidth: 1, borderTopColor: Colors.border, padding: 14, gap: 10 },
  signOutBtn: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: R.md, backgroundColor: "rgba(220,38,38,0.05)", borderWidth: 1, borderColor: "rgba(220,38,38,0.12)" },
  signOutText: { fontSize: 12, fontWeight: "700", color: Colors.error },
});

const tb = StyleSheet.create({
  bar: { backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, height: Platform.OS === "ios" ? 82 : 66, paddingHorizontal: 2, paddingTop: 4, paddingBottom: Platform.OS === "ios" ? 20 : 4, shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 12 },
  itemStyle: { flex: 1, minWidth: 0, paddingHorizontal: 0 },
  item: { flex: 1, minWidth: 0, maxWidth: "100%" as any, alignItems: "center", justifyContent: "center", gap: 2 },
  iconWrap: { width: 32, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  iconWrapActive: { backgroundColor: Colors.primary },
  label: { fontSize: 8, fontWeight: "600", color: Colors.text3, letterSpacing: 0, textTransform: "uppercase" },
  labelActive: { color: Colors.primary },
});

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === "web" && width >= 768;

  const { authUid, activeGroupId, authName, reset } = useStore();

  const currentUserRole = useCurrentUserRole();
  const currentMember = useCurrentMember();

  const isOnline = useNetworkStatus();
  const unreadCount = useUnreadNotifs();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { signOut } = useAuth();
  const router = useRouter();

  const roleNavItems = React.useMemo(
    () => getWebNavForRole(currentUserRole, currentMember?.permissions),
    [currentUserRole, currentMember?.permissions],
  );

  const desktopNavItems = roleNavItems;

  const mobileNavItems = React.useMemo(
    () => roleNavItems.filter((item) => !MOBILE_HIDDEN_ROUTES.has(item.route)),
    [roleNavItems],
  );

  const mobileNavBySegment = React.useMemo(() => {
    const map = new Map<string, (typeof mobileNavItems)[number]>();
    for (const item of mobileNavItems) {
      map.set(item.route.replace("/(tabs)/", ""), item);
    }
    return map;
  }, [mobileNavItems]);

  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem("sidebarCollapsed")
      .then((v) => { if (v === "true") setSidebarCollapsed(true); })
      .catch(() => {});
  }, []);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      AsyncStorage.setItem("sidebarCollapsed", String(next)).catch(() => {});
      return next;
    });
  };

  const group = useActiveGroup();

  useEffect(() => {
    if (!activeGroupId || !currentMember) return;
    if (currentMember.role === "admin" || currentMember.role === "accountant") {
      import("../../lib/firestore/migrateRolePermissions").then(
        ({ migrateRolePermissionsIfNeeded }) => {
          migrateRolePermissionsIfNeeded(activeGroupId).catch((e) => {
            console.warn("[migrateRolePermissions] skipped:", e?.message);
          });
        },
      );
    }
  }, [activeGroupId, currentMember?.role]);

  const currentTitle =
    PAGE_TITLES[pathname?.split("/").filter(Boolean).pop() ?? ""] ?? "Dashboard";

  useEffect(() => {
    if (!authUid) router.replace("/(auth)/login");
  }, [authUid]);

  // ── Sync gating ─────────────────────────────────────────────────────
  // Firestore rules reject wallet / loans / contributions reads for any
  // member whose status isn't "active". A blocked member (pending,
  // suspended, inactive, exited) would therefore spam the console with
  // permission-denied errors on every render — and they don't have any
  // data to see anyway, because one of the gates below intercepts them.
  //
  // Passing `null` as the group id makes useFirebaseSync early-return
  // without touching Firestore.
  //
  // `undefined` status = we haven't resolved the member yet (fresh
  // session, no persisted cache) → sync runs once so we can learn the
  // status; if it turns out blocked, subsequent renders skip sync.
  const currentMemberStatus = currentMember?.status;
  const syncShouldRun =
    !!authUid &&
    (currentMemberStatus === undefined || currentMemberStatus === "active");

  useFirebaseSync(syncShouldRun ? activeGroupId : null, isOnline);
  useNotificationSync(authUid);

  const triggerForceSync = useStore((s) => s.triggerForceSync);
  const syncStatus = useStore((s) => s.syncStatus);
  const isSyncing = syncStatus === "pending" || syncStatus === "syncing";

  if (!authUid) return null;

  const handleSignOut = () => {
    showConfirm(
      "Sign Out",
      "Are you sure?",
      async () => {
        await signOut().catch(() => {});
        reset();
        router.replace("/(auth)/login");
      },
      undefined,
      true,
    );
  };

  const stillResolvingMember =
    !!authUid &&
    !currentMember &&
    (syncStatus === "syncing" || syncStatus === "pending");

  if (stillResolvingMember) return null;

  if (
    (currentMember && currentMember.status === "pending" && currentUserRole !== "admin") ||
    (authUid && !currentMember)
  ) {
    return (
      <PendingApprovalScreen
        onSignOut={handleSignOut}
        memberName={currentMember?.fullName || authName || "User"}
        variant="pending"
      />
    );
  }

  // Any other non-active, non-pending status is a blocked state:
  // "inactive" (deactivated by an admin), "suspended", or "exited".
  // Kept as a single gate so a future status value added to the
  // MemberStatus union doesn't silently fall through to the app.
  if (
    currentMember &&
    currentMember.status !== "active" &&
    currentMember.status !== "pending"
  ) {
    const variant: BlockedVariant =
      currentMember.status === "suspended"
        ? "suspended"
        : currentMember.status === "exited"
        ? "exited"
        : "inactive";

    return (
      <PendingApprovalScreen
        onSignOut={handleSignOut}
        memberName={currentMember.fullName}
        variant={variant}
      />
    );
  }

  const offlineBanner = !isOnline ? (
    <View style={shared.offlineBanner}>
      <Text style={shared.offlineBannerText}>● Offline — showing cached data</Text>
    </View>
  ) : null;

  if (isWide) {
    return (
      <View style={shared.desktopRoot}>
        <View style={[sb.sidebar, sidebarCollapsed && sb.sidebarCollapsed]}>
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
                ? (ChevronRight
                    ? <ChevronRight size={14} color={Colors.text3} />
                    : <Text style={sb.collapseBtnText}>›</Text>)
                : (ChevronLeft
                    ? <ChevronLeft size={14} color={Colors.text3} />
                    : <Text style={sb.collapseBtnText}>‹</Text>)}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={sb.navList}
          >
            {desktopNavItems.map((item) => (
              <SidebarItem
                key={item.route}
                label={item.label}
                isActive={!!pathname?.includes(item.route.replace("/(tabs)/", ""))}
                onPress={() => router.push(item.route as any)}
                collapsed={sidebarCollapsed}
              />
            ))}
          </ScrollView>

          <View style={sb.footer}>
            <TouchableOpacity style={sb.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
              {LogOut ? (
                <LogOut size={13} color={Colors.error} />
              ) : (
                <Text style={{ fontSize: 13, color: Colors.error }}>↪</Text>
              )}
              {!sidebarCollapsed && <Text style={sb.signOutText}>Sign out</Text>}
            </TouchableOpacity>
          </View>
        </View>

        <View style={shared.desktopContent}>
          <DesktopTopHeader
            title={currentTitle}
            isSyncing={isSyncing}
            authName={authName ?? "User"}
            role={currentUserRole}
            unreadCount={unreadCount}
            onBellPress={() => router.push("/notifications")}
            groupName={group?.name}
            onRefresh={triggerForceSync}
            onEditProfile={() => router.push("/more")}
            onSignOut={handleSignOut}
          />

          {offlineBanner}

          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarStyle: { display: "none" },
            }}
          >
            {ALL_TAB_ROUTES.map((route) => {
              const navItem = desktopNavItems.find(
                (i) => i.route === `/(tabs)/${route}`,
              );
              return (
                <Tabs.Screen
                  key={route}
                  name={route}
                  options={navItem ? { title: navItem.label } : { href: null }}
                />
              );
            })}
          </Tabs>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{ paddingTop: insets.top, backgroundColor: Colors.surface }}>
        {offlineBanner}
        <MobileTopHeader
          isSyncing={isSyncing}
          title={currentTitle}
          unreadCount={unreadCount}
          onBellPress={() => router.push("/notifications")}
          groupName={group?.name}
          onRefresh={triggerForceSync}
        />
      </View>

      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: tb.bar,
          tabBarItemStyle: tb.itemStyle,
        }}
      >
        {ALL_TAB_ROUTES.map((route) => {
          const navItem = mobileNavBySegment.get(route);
          return (
            <Tabs.Screen
              key={route}
              name={route}
              options={
                navItem
                  ? {
                      tabBarIcon: ({ focused }: { focused: boolean }) => (
                        <TabItem label={navItem.label} focused={focused} />
                      ),
                    }
                  : { href: null }
              }
            />
          );
        })}
      </Tabs>
    </View>
  );
}
