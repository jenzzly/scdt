import React from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Platform, useWindowDimensions} from "react-native";
import { useRouter } from "expo-router";
import { useStore } from "../stores/useStore";
import { Card, CardRow, Empty } from "../components/ui";
import { Colors, S, R, fmtDate } from "../utils/theme";

const TYPE_ICON: Record<string, string> = {
  contribution_due: "📅",
  loan_approved: "✅",
  loan_rejected: "❌",
  loan_repayment_due: "⏰",
  meeting: "📋",
  investment_maturity: "📈",
  new_member: "👤",
  general: "🔔",
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { notifications, markNotifReadLocal } = useStore();

  const sorted = [...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const unread = sorted.filter((n) => !n.read);
  const read = sorted.filter((n) => n.read);

  const openNotification = (notification: typeof sorted[number]) => {
    markNotifReadLocal(notification.id);
    const metadata = notification.metadata ?? {};
    if (notification.actionUrl) {
      router.push(notification.actionUrl as any);
    } else if (metadata.loanId) {
      router.push("/(tabs)/loans");
    } else if (metadata.investmentId) {
      router.push("/(tabs)/loans");
    } else if (metadata.meetingId) {
      router.push("/(tabs)/meetings");
    } else if (metadata.contributionId) {
      router.push("/(tabs)/contributions");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: 40, maxWidth: isWide ? 700 : undefined, alignSelf: isWide ? "center" as any : undefined, width: "100%" as any }}
        showsVerticalScrollIndicator={false}
      >
        {sorted.length === 0 && (
          <Empty message="No notifications yet" icon="🔔" />
        )}

        {(unread.length > 0) && (
          <>
            <Text style={styles.groupLabel}>New</Text>
            <Card>
              {unread.map((n, i) => (
                <TouchableOpacity
                  key={n.id}
                  onPress={() => openNotification(n)}
                  activeOpacity={0.7}
                >
                  <CardRow
                    left={
                      <View style={styles.iconWrap}>
                        <Text style={{ fontSize: 20 }}>{TYPE_ICON[n.type] ?? "🔔"}</Text>
                        <View style={styles.unreadDot} />
                      </View>
                    }
                    title={n.title}
                    subtitle={n.message}
                    right={
                      <Text style={styles.time}>{fmtDate(n.createdAt)}</Text>
                    }
                    showBorder={i < unread.length - 1}
                  />
                </TouchableOpacity>
              ))}
            </Card>
          </>
        )}

        {(read.length > 0) && (
          <>
            <Text style={[styles.groupLabel, { marginTop: 20 }]}>Earlier</Text>
            <Card>
              {read.map((n, i) => (
                <TouchableOpacity key={n.id} onPress={() => openNotification(n)} activeOpacity={0.7}>
                  <CardRow
                    left={
                      <View style={[styles.iconWrap, { opacity: 0.5 }]}>
                        <Text style={{ fontSize: 20 }}>{TYPE_ICON[n.type] ?? "🔔"}</Text>
                      </View>
                    }
                    title={n.title}
                    subtitle={n.message}
                    right={<Text style={styles.time}>{fmtDate(n.createdAt)}</Text>}
                    showBorder={i < read.length - 1}
                  />
                </TouchableOpacity>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: S.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  back: { fontSize: 18, color: Colors.text2, width: 32, textAlign: "center" },
  title: { fontSize: 17, fontWeight: "700", color: Colors.text },
  groupLabel: {
    fontSize: 11, fontWeight: "700", color: Colors.text3,
    textTransform: "uppercase", letterSpacing: 0.8,
    marginBottom: 8,
  },
  iconWrap: { width: 40, height: 40, alignItems: "center", justifyContent: "center", position: "relative" },
  unreadDot: {
    position: "absolute", top: 2, right: 2,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.teal,
    borderWidth: 1.5, borderColor: Colors.bg,
  },
  time: { fontSize: 11, color: Colors.text3 },
});
