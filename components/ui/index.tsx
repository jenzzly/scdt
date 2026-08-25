/**
 * SCDT UI Component Library — Light Professional Theme
 */
import React, { useState, useRef, forwardRef } from "react";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Modal, Pressable, Platform, KeyboardAvoidingView,
  StyleSheet, Animated, type ViewStyle, type TextStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Fonts, R, S, initials, fmtCurrency } from "../../utils/theme";

// ── Screen wrapper ─────────────────────────────────────────────────────────────
export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ flex: 1, backgroundColor: Colors.bg }, style]}>
      {children}
    </View>
  );
}

// ── Page Header ───────────────────────────────────────────────────────────────
export function Header({
  title, subtitle, right, left, showBorder = true,
}: { title: string; subtitle?: string; right?: React.ReactNode; left?: React.ReactNode; showBorder?: boolean }) {
  return (
    <View style={[styles.header, showBorder && styles.headerBorder]}>
      {left || <View style={{ width: 38 }} />}
      <View style={{ flex: 1, alignItems: "center" }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle && <Text style={styles.headerSub}>{subtitle}</Text>}
      </View>
      {right || <View style={{ width: 38 }} />}
    </View>
  );
}

// ── Hero Balance Card ──────────────────────────────────────────────────────────
export function HeroCard({
  label, amount, subtitle, pills, currency = "RWF",
}: {
  label: string; amount: number; subtitle?: string;
  pills?: { label: string; color?: "gold" | "green" | "teal" }[];
  currency?: string;
}) {
  return (
    <LinearGradient
      colors={["#1A3C5E", "#0D2840", "#0A1E32"]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={styles.heroCard}
    >
      {/* Decorative elements */}
      <View style={styles.heroBubble1} />
      <View style={styles.heroBubble2} />
      <View style={styles.heroStripe} />
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={styles.heroAmount}>
        <Text style={styles.heroCurrency}>{currency} </Text>
        {fmtCurrency(amount, currency)}
      </Text>
      {subtitle && <Text style={styles.heroSub}>{subtitle}</Text>}
      {pills && (
        <View style={styles.heroPills}>
          {pills.map((p, i) => (
            <View key={i} style={[
              styles.heroPill,
              p.color === "gold" && styles.heroPillGold,
              p.color === "green" && styles.heroPillGreen,
            ]}>
              <Text style={[
                styles.heroPillText,
                p.color === "gold" && { color: "#FCD34D" },
                p.color === "green" && { color: "#34D399" },
              ]}>
                {p.label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </LinearGradient>
  );
}

// ── Stat Grid ─────────────────────────────────────────────────────────────────
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>;
}

export function StatCard({
  label, value, sub, color = "teal",
}: { label: string; value: string; sub?: string; color?: "teal" | "gold" | "green" | "red" }) {
  const accent = { teal: Colors.accent, gold: Colors.gold, green: Colors.success, red: Colors.error };
  const accentFaint = {
    teal: Colors.accentFaint, gold: "rgba(217,119,6,0.08)",
    green: "rgba(5,150,105,0.08)", red: "rgba(220,38,38,0.08)"
  };
  return (
    <View style={[styles.statCard, { borderTopColor: accent[color] }]}>
      <View style={[styles.statDot, { backgroundColor: accentFaint[color] }]}>
        <View style={[styles.statDotInner, { backgroundColor: accent[color] }]} />
      </View>
      <Text style={[styles.statValue, { color: accent[color] }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub && <Text style={styles.statSub}>{sub}</Text>}
    </View>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children?: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function CardRow({
  left, title, subtitle, right, onPress, showBorder = true,
}: {
  left?: React.ReactNode; title: string; subtitle?: string;
  right?: React.ReactNode; onPress?: () => void; showBorder?: boolean;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      onPress={onPress}
      style={[styles.cardRow, !showBorder && { borderBottomWidth: 0 }]}
      activeOpacity={0.6}
    >
      {left}
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={1}>{title}</Text>
        {subtitle && <Text style={styles.cardSub} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {right}
    </Wrapper>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────
export function Avatar({
  name, size = 40, color = "teal",
}: { name: string; size?: number; color?: "teal" | "gold" | "red" | "blue" | "green" }) {
  const bg = {
    teal: Colors.accentFaint, gold: "rgba(217,119,6,0.1)",
    red: "rgba(220,38,38,0.1)", blue: "rgba(37,99,235,0.1)", green: "rgba(5,150,105,0.08)"
  };
  const border = {
    teal: "rgba(13,148,136,0.25)", gold: "rgba(217,119,6,0.25)",
    red: "rgba(220,38,38,0.25)", blue: "rgba(37,99,235,0.25)", green: "rgba(5,150,105,0.25)"
  };
  const textColor = {
    teal: Colors.accent, gold: Colors.gold, red: Colors.error, blue: Colors.info, green: Colors.success
  };
  return (
    <View style={[
      styles.avatar,
      { width: size, height: size, borderRadius: size / 2, backgroundColor: bg[color], borderColor: border[color] }
    ]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.33, color: textColor[color] }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

// ── Icon Badge ────────────────────────────────────────────────────────────────
export function IconBadge({
  children, color = "teal", size = 40,
}: { children: React.ReactNode; color?: "teal" | "gold" | "red" | "green" | "blue"; size?: number }) {
  const map = {
    teal: { bg: Colors.accentFaint, border: "rgba(13,148,136,0.2)" },
    gold: { bg: "rgba(217,119,6,0.1)", border: "rgba(217,119,6,0.2)" },
    red: { bg: "rgba(220,38,38,0.1)", border: "rgba(220,38,38,0.2)" },
    green: { bg: "rgba(5,150,105,0.1)", border: "rgba(5,150,105,0.2)" },
    blue: { bg: "rgba(37,99,235,0.1)", border: "rgba(37,99,235,0.2)" },
  };
  return (
    <View style={[
      styles.iconBadge,
      { width: size, height: size, backgroundColor: map[color].bg, borderColor: map[color].border }
    ]}>
      {children}
    </View>
  );
}

// ── Badge / Pill ──────────────────────────────────────────────────────────────
export function Badge({
  label, color = "teal",
}: { label: string; color?: "teal" | "gold" | "green" | "red" | "blue" | "muted" }) {
  const map = {
    teal: { bg: Colors.accentFaint, text: Colors.accent },
    gold: { bg: "rgba(217,119,6,0.1)", text: Colors.gold },
    green: { bg: "rgba(5,150,105,0.1)", text: Colors.success },
    red: { bg: "rgba(220,38,38,0.1)", text: Colors.error },
    blue: { bg: "rgba(37,99,235,0.1)", text: Colors.info },
    muted: { bg: Colors.elevated, text: Colors.text3 },
  };
  return (
    <View style={[styles.badge, { backgroundColor: map[color].bg }]}>
      <Text style={[styles.badgeText, { color: map[color].text }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
export function Button({
  label, onPress, variant = "primary", size = "md", fullWidth, disabled, loading, icon, style,
}: {
  label: string; onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg"; fullWidth?: boolean; disabled?: boolean;
  loading?: boolean; icon?: React.ReactNode; style?: ViewStyle;
}) {
  const variantStyles = {
    primary: { bg: Colors.primary, text: "#fff", border: Colors.primary },
    secondary: { bg: Colors.surface, text: Colors.primary, border: Colors.border },
    ghost: { bg: "transparent", text: Colors.accent, border: "transparent" },
    danger: { bg: "rgba(220,38,38,0.08)", text: Colors.error, border: "rgba(220,38,38,0.25)" },
    success: { bg: "rgba(5,150,105,0.08)", text: Colors.success, border: "rgba(5,150,105,0.25)" },
  };
  const sizeStyles = {
    sm: { paddingVertical: 8, paddingHorizontal: 16, fontSize: 12, borderRadius: R.sm },
    md: { paddingVertical: 12, paddingHorizontal: 20, fontSize: 14, borderRadius: R.md },
    lg: { paddingVertical: 16, paddingHorizontal: 24, fontSize: 15, borderRadius: R.lg },
  };
  const v = variantStyles[variant];
  const s = sizeStyles[size];
  return (
    <TouchableOpacity
      onPress={onPress} disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border, borderWidth: 1, paddingVertical: s.paddingVertical, paddingHorizontal: s.paddingHorizontal, borderRadius: s.borderRadius },
        fullWidth && { width: "100%" },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={v.text} /> : (
        <>
          {icon}
          <Text style={[styles.buttonText, { color: v.text, fontSize: s.fontSize }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────
// forwardRef + broad prop surface so this single Input works for every
// screen in the app (auth forms with refs/submit-chaining, simple search
// boxes, multiline notes, numeric amounts, etc.) without per-screen casts.
interface InputProps {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "numeric" | "phone-pad" | "decimal-pad" | "number-pad";
  multiline?: boolean;
  numberOfLines?: number;
  secureTextEntry?: boolean;
  error?: string;
  prefix?: string;
  leftIcon?: string;
  right?: React.ReactNode;
  editable?: boolean;
  hint?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: string;
  autoCorrect?: boolean;
  returnKeyType?: "done" | "go" | "next" | "search" | "send";
  onSubmitEditing?: () => void;
  onKeyPress?: (e: any) => void;
  clearButtonMode?: "never" | "while-editing" | "unless-editing" | "always";
  containerStyle?: any;
  style?: any;
  testID?: string;
}

export const Input = forwardRef<TextInput, InputProps>(({
  label, value, onChangeText, placeholder, keyboardType, multiline, numberOfLines,
  secureTextEntry, error, prefix, leftIcon, right, editable = true, hint,
  autoCapitalize, autoComplete, autoCorrect, returnKeyType,
  onSubmitEditing, onKeyPress, clearButtonMode, containerStyle, style, testID,
}, ref) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.formGroup, containerStyle]}>
      {label && <Text style={styles.formLabel}>{label}</Text>}
      <View style={[
        styles.inputWrap,
        focused && styles.inputFocused,
        !!error && styles.inputError,
        !editable && styles.inputDisabled,
      ]}>
        {prefix && <Text style={styles.inputPrefix}>{prefix}</Text>}
        {leftIcon && <Text style={{ fontSize: 14, marginRight: 8, color: Colors.text3 }}>{leftIcon}</Text>}
        <TextInput
          ref={ref}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.text3}
          keyboardType={keyboardType}
          multiline={multiline}
          numberOfLines={numberOfLines}
          secureTextEntry={secureTextEntry}
          editable={editable}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete as any}
          autoCorrect={autoCorrect}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onKeyPress={onKeyPress}
          clearButtonMode={clearButtonMode}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, multiline && { height: 80, textAlignVertical: "top" }, style]}
        />
        {right}
      </View>
      {hint && !error && <Text style={styles.inputHint}>{hint}</Text>}
      {error && <Text style={styles.inputErrorText}>{error}</Text>}
    </View>
  );
});

// ── Select ────────────────────────────────────────────────────────────────────
export function Select({
  label, value, options, onChange, hint,
}: {
  label?: string;
  value: string | number;
  options: { label: string; value: string | number }[];
  onChange: (v: any) => void;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={styles.formGroup}>
      {label && <Text style={styles.formLabel}>{label}</Text>}
      <TouchableOpacity style={styles.inputWrap} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={[styles.input, { color: selected ? Colors.text : Colors.text3, flex: 1 }]}>
          {selected?.label ?? "Select…"}
        </Text>
        <Text style={{ color: Colors.text3, fontSize: 11, marginLeft: 4 }}>▾</Text>
      </TouchableOpacity>
      {hint && <Text style={styles.inputHint}>{hint}</Text>}
      <BottomModal visible={open} onClose={() => setOpen(false)} title={label ?? "Select"}>
        {options.map((o) => (
          <TouchableOpacity
            key={String(o.value)}
            onPress={() => { onChange(o.value); setOpen(false); }}
            style={[styles.selectOption, String(o.value) === String(value) && styles.selectOptionActive]}
          >
            <Text style={[styles.selectOptionText, o.value === value && { color: Colors.accent, fontWeight: "700" }]}>
              {o.label}
            </Text>
            {o.value === value && (
              <View style={styles.selectCheck}>
                <Text style={{ color: Colors.accent, fontSize: 12 }}>✓</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </BottomModal>
    </View>
  );
}

// ── Bottom Modal / Sheet ───────────────────────────────────────────────────────
export function BottomModal({
  visible, onClose, title, children,
}: { visible: boolean; onClose: () => void; title?: string; children?: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalKeyboard}
      >
        <Pressable style={styles.modalOverlay} onPress={onClose}>
          <Pressable style={styles.bottomSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            {title && (
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{title}</Text>
                <TouchableOpacity onPress={onClose} style={styles.sheetClose}>
                  <Text style={{ color: Colors.text2, fontSize: 16, fontWeight: "700" }}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={styles.sheetScrollContent}
            >
              {children}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
export function Section({
  title, action, actionLabel, children,
}: { title: string; action?: () => void; actionLabel?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action && (
          <TouchableOpacity onPress={action} style={styles.sectionLinkWrap}>
            <Text style={styles.sectionLink}>{actionLabel ?? "See all"}</Text>
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

// ── Loan Progress Bar ─────────────────────────────────────────────────────────
export function LoanProgress({ pct }: { pct: number }) {
  const color = pct >= 80 ? Colors.success : pct >= 50 ? Colors.accent : Colors.warning;
  return (
    <View style={styles.progressBg}>
      <View style={[styles.progressFill, { width: `${Math.min(100, pct)}%` as any, backgroundColor: color }]} />
    </View>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function Empty({ message, icon, action, actionLabel }: {
  message: string; icon?: string; action?: () => void; actionLabel?: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <Text style={styles.emptyIcon}>{icon ?? "—"}</Text>
      </View>
      <Text style={styles.emptyTitle}>Nothing here yet</Text>
      <Text style={styles.emptyText}>{message}</Text>
      {action && (
        <TouchableOpacity style={styles.emptyBtn} onPress={action}>
          <Text style={styles.emptyBtnText}>{actionLabel ?? "Get started"}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Tab Row ───────────────────────────────────────────────────────────────────
export function TabRow({
  tabs, active, onChange,
}: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRowWrap} contentContainerStyle={styles.tabRow}>
      {tabs.map((t) => (
        <TouchableOpacity
          key={t} onPress={() => onChange(t)}
          style={[styles.tabBtn, active === t && styles.tabBtnActive]}
        >
          <Text style={[styles.tabBtnText, active === t && styles.tabBtnTextActive]}>{t}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ── Search Bar ────────────────────────────────────────────────────────────────
export function SearchBar({ value, onChange, placeholder = "Search…" }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <View style={styles.searchBar}>
      <Text style={{ color: Colors.text3, marginRight: 8, fontSize: 14 }}>⌕</Text>
      <TextInput
        value={value} onChangeText={onChange}
        placeholder={placeholder} placeholderTextColor={Colors.text3}
        style={styles.searchInput}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChange("")}>
          <Text style={{ color: Colors.text3, fontSize: 14 }}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
export function Divider({ label }: { label?: string }) {
  if (!label) return <View style={styles.divider} />;
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerLabel}>{label}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

// ── Info Row ──────────────────────────────────────────────────────────────────
export function InfoRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, accent && { color: Colors.accent, fontWeight: "700" }]}>{value}</Text>
    </View>
  );
}

// ── Toast / Snackbar ──────────────────────────────────────────────────────────
export function useToast() {
  const [visible, setVisible] = useState(false);
  const [msg, setMsg] = useState("");
  const [type, setType] = useState<"success" | "error">("success");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (message: string, kind: "success" | "error" = "success") => {
    if (timer.current) clearTimeout(timer.current);
    setMsg(message);
    setType(kind);
    setVisible(true);
    timer.current = setTimeout(() => setVisible(false), 3000);
  };

  const Toast = () => visible ? (
    <View style={[styles.toast, type === "error" ? styles.toastError : styles.toastSuccess]}>
      <View style={[styles.toastDot, { backgroundColor: type === "error" ? Colors.error : Colors.success }]} />
      <Text style={[styles.toastText, { color: type === "error" ? Colors.error : Colors.success }]}>{msg}</Text>
    </View>
  ) : null;

  return { show, Toast };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 56 : 44,
    paddingBottom: S.md,
    backgroundColor: Colors.surface,
  },
  headerBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: "700", color: Colors.text, letterSpacing: -0.2 },
  headerSub: { fontSize: 11, color: Colors.text3, marginTop: 1 },

  // Hero card
  heroCard: {
    borderRadius: R.xl, padding: S.xl,
    margin: S.lg, overflow: "hidden", position: "relative",
  },
  heroBubble1: {
    position: "absolute", top: -50, right: -30,
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: "rgba(13,148,136,0.15)",
  },
  heroBubble2: {
    position: "absolute", bottom: -40, left: 30,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  heroStripe: {
    position: "absolute", bottom: 0, right: 0,
    width: 120, height: 4, backgroundColor: Colors.accent,
    borderTopLeftRadius: 2,
  },
  heroLabel: {
    fontSize: 10, color: "rgba(255,255,255,0.55)",
    fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8,
  },
  heroAmount: { fontSize: 32, fontWeight: "800", color: "#fff", letterSpacing: -1 },
  heroCurrency: { fontSize: 15, fontWeight: "600", color: "rgba(255,255,255,0.5)" },
  heroSub: { fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 6 },
  heroPills: { flexDirection: "row", gap: 8, marginTop: 16, flexWrap: "wrap" },
  heroPill: {
    backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)", borderRadius: R.full,
    paddingVertical: 4, paddingHorizontal: 12,
  },
  heroPillGold: { backgroundColor: "rgba(217,119,6,0.2)", borderColor: "rgba(252,211,77,0.3)" },
  heroPillGreen: { backgroundColor: "rgba(5,150,105,0.2)", borderColor: "rgba(52,211,153,0.3)" },
  heroPillText: { fontSize: 11, fontWeight: "600", color: "#fff" },

  // Stats
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: S.lg, marginBottom: S.xl },
  statCard: {
    flex: 1, minWidth: "45%",
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    borderTopWidth: 3,
    borderRadius: R.lg, padding: S.md,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  statDot: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  statDotInner: { width: 8, height: 8, borderRadius: 4 },
  statLabel: { fontSize: 10, color: Colors.text3, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  statValue: { fontSize: 19, fontWeight: "800", letterSpacing: -0.4 },
  statSub: { fontSize: 10, color: Colors.text3, marginTop: 2 },

  // Card
  card: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.lg, overflow: "hidden",
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14, paddingHorizontal: S.lg, gap: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  cardInfo: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 13, fontWeight: "600", color: Colors.text },
  cardSub: { fontSize: 11, color: Colors.text3, marginTop: 2 },

  // Avatar
  avatar: { borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "800" },

  // Icon badge
  iconBadge: { borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  // Badge
  badge: { borderRadius: R.full, paddingVertical: 2, paddingHorizontal: 8, alignSelf: "flex-start" },
  badgeText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },

  // Button
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  buttonText: { fontWeight: "700", letterSpacing: 0.1 },

  // Form
  formGroup: { marginBottom: 16 },
  formLabel: {
    fontSize: 11, fontWeight: "700", color: Colors.text2,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8,
  },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: R.md, paddingHorizontal: 14, minHeight: 50,
  },
  inputFocused: { borderColor: Colors.accent, backgroundColor: Colors.surface },
  inputError: { borderColor: Colors.error },
  inputDisabled: { backgroundColor: Colors.elevated, opacity: 0.7 },
  input: { flex: 1, color: Colors.text, fontSize: 14, paddingVertical: 12 },
  inputPrefix: { color: Colors.text2, fontSize: 13, marginRight: 8, fontWeight: "600" },
  inputHint: { fontSize: 11, color: Colors.text3, marginTop: 4 },
  inputErrorText: { fontSize: 11, color: Colors.error, marginTop: 4, fontWeight: "500" },

  // Select
  selectOption: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 16, paddingHorizontal: S.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  selectOptionActive: { backgroundColor: Colors.accentFaint },
  selectOptionText: { fontSize: 14, color: Colors.text },
  selectCheck: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.accentFaint, alignItems: "center", justifyContent: "center",
  },

  // Modal
  modalKeyboard: { flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(15,31,51,0.5)", justifyContent: "flex-end" },
  bottomSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    maxHeight: "90%", paddingBottom: 32,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1, shadowRadius: 16, elevation: 24,
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: Colors.muted,
    borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.lg, paddingVertical: S.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: Colors.text },
  sheetClose: {
    width: 28, height: 28, alignItems: "center", justifyContent: "center",
    backgroundColor: Colors.elevated, borderRadius: R.full,
  },
  sheetScrollContent: { paddingBottom: 28 },

  // Section
  section: { paddingHorizontal: S.lg, marginBottom: S.xl },
  sectionHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: "700", color: Colors.text, letterSpacing: -0.2,
  },
  sectionLinkWrap: { paddingVertical: 4, paddingHorizontal: 8 },
  sectionLink: { fontSize: 12, color: Colors.accent, fontWeight: "600" },

  // Progress
  progressBg: { height: 5, backgroundColor: Colors.elevated, borderRadius: R.full, overflow: "hidden", marginVertical: 6 },
  progressFill: { height: "100%", borderRadius: R.full },

  // Empty
  empty: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 24 },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: Colors.elevated, alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  emptyIcon: { fontSize: 28 },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: Colors.text, marginBottom: 6 },
  emptyText: { fontSize: 13, color: Colors.text3, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    marginTop: 16, paddingVertical: 10, paddingHorizontal: 24,
    backgroundColor: Colors.primary, borderRadius: R.md,
  },
  emptyBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },

  // Tabs
  tabRowWrap: { marginBottom: S.lg },
  tabRow: { flexDirection: "row", gap: 6, paddingBottom: 2 },
  tabBtn: {
    paddingVertical: 7, paddingHorizontal: 16,
    borderRadius: R.full, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tabBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabBtnText: { fontSize: 12, fontWeight: "600", color: Colors.text3 },
  tabBtnTextActive: { color: "#fff" },

  // Search
  searchBar: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.elevated,
    borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: S.md,
  },
  searchInput: { flex: 1, color: Colors.text, fontSize: 13 },

  // Divider
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: S.lg },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: S.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerLabel: { fontSize: 11, color: Colors.text3, fontWeight: "600" },

  // Info row
  infoRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  infoLabel: { fontSize: 13, color: Colors.text3 },
  infoValue: { fontSize: 13, fontWeight: "600", color: Colors.text },

  // Toast
  toast: {
    position: "absolute", bottom: 96, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.full, paddingVertical: 10, paddingHorizontal: 20,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 12, elevation: 8,
  },
  toastSuccess: { borderColor: "rgba(5,150,105,0.3)" },
  toastError: { borderColor: "rgba(220,38,38,0.3)" },
  toastDot: { width: 8, height: 8, borderRadius: 4 },
  toastText: { fontSize: 13, fontWeight: "600" },
});

export { ModalShell } from './ModalShell';
export { DatePicker } from './DatePicker';
