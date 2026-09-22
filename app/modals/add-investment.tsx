// app/modals/add-investment.tsx
//
// Type-driven investment registration form. Each investment type
// surfaces its own set of fields — land gets a UPI (Unique Parcel
// Identifier), stocks get a ticker + broker, fixed deposits get an
// account number + branch, and so on. The underlying schema is
// shared (see Investment in types/index.ts): every type-specific
// value lands in one of upiNumber / locationAddress / contactPhone /
// representativeId / representativeName / representativeRole, just
// with a type-appropriate label.
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { useStore, useActiveGroup } from "../../stores/useStore";
import {
  Input,
  Select,
  Button,
  useToast,
  Toast,
  DatePicker,
} from "../../components/ui";
import { ModalShell } from "../../components/ui/ModalShell";
import {
  Colors,
  S,
  R,
  fmtCurrency,
  round2,
} from "../../utils/theme";

// ─────────────────────────────────────────────────────────────────────────
// Type registry
// ─────────────────────────────────────────────────────────────────────────

type InvType =
  | "real_estate"
  | "agriculture"
  | "business"
  | "stocks"
  | "fixed_deposit"
  | "other";

interface TypeSpec {
  value: InvType;
  label: string;
  icon: string;
  sectionTitle: string;
  sectionHint: string;
}

const INV_TYPES: TypeSpec[] = [
  {
    value: "real_estate",
    label: "Real Estate / Land",
    icon: "🏘️",
    sectionTitle: "Property Details",
    sectionHint:
      "Land plots, buildings, and other physical property. UPI is the Unique Parcel Identifier — the plot reference on the land title.",
  },
  {
    value: "agriculture",
    label: "Agriculture",
    icon: "🌾",
    sectionTitle: "Farm Details",
    sectionHint: "Crops, livestock, or agro-processing ventures.",
  },
  {
    value: "business",
    label: "Business / Trade",
    icon: "🏢",
    sectionTitle: "Business Details",
    sectionHint: "Trading, retail, or services where the group holds a stake.",
  },
  {
    value: "stocks",
    label: "Stocks / Securities",
    icon: "📈",
    sectionTitle: "Securities Details",
    sectionHint: "Shares, bonds, or other exchange-traded instruments.",
  },
  {
    value: "fixed_deposit",
    label: "Fixed Deposit",
    icon: "🏦",
    sectionTitle: "Deposit Details",
    sectionHint: "Term deposits or savings certificates held at a bank.",
  },
  {
    value: "other",
    label: "Other",
    icon: "💼",
    sectionTitle: "Additional Details",
    sectionHint: "Anything not covered above.",
  },
];

const TYPE_SPECS: Record<InvType, TypeSpec> = INV_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.value]: t }),
  {} as Record<InvType, TypeSpec>,
);

// Which optional fields are relevant for each type. A field is shown
// only if the current type lists it here. `other` deliberately shows
// all of them so nothing is ever impossible to record.
const TYPE_FIELDS: Record<
  InvType,
  {
    upi?: string;
    location?: string;
    phone?: string;
    repId?: string;
  }
> = {
  real_estate: {
    upi: "UPI Number",
    location: "Property Address",
    phone: "Contact Phone",
    repId: "Owner / Representative ID",
  },
  agriculture: {
    location: "Farm Location",
    phone: "Contact Phone",
  },
  business: {
    upi: "Business Registration No.",
    location: "Business Address",
    phone: "Contact Phone",
  },
  stocks: {
    upi: "Ticker / Symbol",
    location: "Exchange",
    phone: "Broker Contact",
    repId: "Broker License No.",
  },
  fixed_deposit: {
    upi: "Account / Certificate No.",
    location: "Bank Branch",
    phone: "Bank Contact",
  },
  other: {
    upi: "Reference Number",
    location: "Location",
    phone: "Contact Phone",
    repId: "Representative ID",
  },
};

// Type-appropriate labels for the representative block.
const REP_LABELS: Record<
  InvType,
  { name: string; role: string }
> = {
  real_estate: { name: "Owner Name", role: "Owner Role / Title" },
  agriculture: { name: "Manager Name", role: "Manager Role" },
  business: { name: "Partner / Director", role: "Position" },
  stocks: { name: "Broker Name", role: "Brokerage Firm" },
  fixed_deposit: { name: "Bank Name", role: "Relationship Manager" },
  other: { name: "Representative Name", role: "Role / Title" },
};

// ─────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────

export default function AddInvestmentModal() {
  const router = useRouter();
  const { createInvestment } = useStore();
  const group = useActiveGroup();
  const { show, visible, msg, type } = useToast();

  const [name, setName] = useState("");
  const [investmentType, setInvestmentType] = useState<InvType>("real_estate");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [expected, setExpected] = useState("");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [maturityDate, setMaturityDate] = useState("");

  // Type-specific fields — single set of state, reused across types
  // with type-appropriate labels.
  const [upiNumber, setUpiNumber] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [repName, setRepName] = useState("");
  const [repRole, setRepRole] = useState("");
  const [repId, setRepId] = useState("");

  const [loading, setLoading] = useState(false);

  const spec = TYPE_SPECS[investmentType];
  const fields = TYPE_FIELDS[investmentType];
  const repLabels = REP_LABELS[investmentType];

  const roi = useMemo(() => {
    const a = parseFloat(amount) || 0;
    const e = parseFloat(expected) || 0;
    if (!a || !e) return null;
    return round2(((e - a) / a) * 100);
  }, [amount, expected]);

  const resetTypeSpecificFields = (nextType: InvType) => {
    setInvestmentType(nextType);
    // Clear fields that aren't relevant for the new type so stale
    // values can't accidentally be submitted. Fields that remain
    // relevant survive the type switch.
    const nextFields = TYPE_FIELDS[nextType];
    if (!nextFields.upi) setUpiNumber("");
    if (!nextFields.location) setLocationAddress("");
    if (!nextFields.phone) setContactPhone("");
    if (!nextFields.repId) setRepId("");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      show("Investment name required", "error");
      return;
    }
    const amtNum = parseFloat(amount);
    if (!amtNum || amtNum <= 0) {
      show("Enter a valid amount", "error");
      return;
    }
    if (!group?.id) {
      show("No active group", "error");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      show("Enter a valid start date", "error");
      return;
    }

    setLoading(true);
    try {
      await createInvestment({
        groupId: group.id,
        investmentName: name.trim(),
        investmentType,

        description: desc.trim() || undefined,

        // Type-specific — only send the ones the type actually uses
        upiNumber: fields.upi ? upiNumber.trim() || undefined : undefined,
        locationAddress: fields.location
          ? locationAddress.trim() || undefined
          : undefined,
        contactPhone: fields.phone
          ? contactPhone.trim() || undefined
          : undefined,

        representativeName: repName.trim() || undefined,
        representativeRole: repRole.trim() || undefined,
        representativeId: fields.repId
          ? repId.trim() || undefined
          : undefined,

        investmentAmount: amtNum,
        expectedReturn: parseFloat(expected) || amtNum,

        startDate: new Date(startDate).toISOString(),
        maturityDate: maturityDate
          ? new Date(maturityDate).toISOString()
          : undefined,

        status: "pending_committee",
      });

      show("Investment submitted — awaiting committee approval ✅");
      setTimeout(() => router.back(), 800);
    } catch (e: any) {
      show(e?.message || "Failed to register investment", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title="Add Investment" onClose={() => router.back()}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Basic info ──────────────────────────────────────────── */}
        <Text style={styles.sectionLbl}>Basic Info</Text>

        <Input
          label="Investment Name *"
          value={name}
          onChangeText={setName}
          placeholder={
            investmentType === "real_estate"
              ? "e.g. Kigali Plot 42"
              : investmentType === "stocks"
              ? "e.g. BOK preference shares"
              : "Real Estate Plot, Agricultural Co-op…"
          }
        />

        <Select
          label="Type"
          value={investmentType}
          options={INV_TYPES.map((t) => ({
            label: `${t.icon}  ${t.label}`,
            value: t.value,
          }))}
          onChange={(v) => resetTypeSpecificFields(v as InvType)}
        />

        <Input
          label="Description"
          value={desc}
          onChangeText={setDesc}
          placeholder="Brief description"
          multiline
        />

        {/* ── Type-specific block ─────────────────────────────────── */}
        <View style={styles.typeBanner}>
          <Text style={styles.typeBannerIcon}>{spec.icon}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.typeBannerTitle}>{spec.sectionTitle}</Text>
            <Text style={styles.typeBannerHint}>{spec.sectionHint}</Text>
          </View>
        </View>

        {fields.upi ? (
          <Input
            label={fields.upi}
            value={upiNumber}
            onChangeText={setUpiNumber}
            placeholder={
              investmentType === "real_estate"
                ? "e.g. 1/02/03/04/567"
                : investmentType === "stocks"
                ? "e.g. BOK"
                : investmentType === "fixed_deposit"
                ? "e.g. FD-2026-0042"
                : "Enter reference"
            }
            autoCapitalize="characters"
            autoCorrect={false}
          />
        ) : null}

        {fields.location ? (
          <Input
            label={fields.location}
            value={locationAddress}
            onChangeText={setLocationAddress}
            placeholder={
              investmentType === "real_estate"
                ? "District, Sector, Cell, Village"
                : investmentType === "stocks"
                ? "RSE / NYSE / …"
                : "Enter location"
            }
          />
        ) : null}

        {fields.phone ? (
          <Input
            label={fields.phone}
            value={contactPhone}
            onChangeText={setContactPhone}
            placeholder="+250 7XX XXX XXX"
            keyboardType="phone-pad"
          />
        ) : null}

        {/* ── Representative ──────────────────────────────────────── */}
        <Text style={styles.sectionLbl}>Representative (Optional)</Text>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Input
              label={repLabels.name}
              value={repName}
              onChangeText={setRepName}
              placeholder="Full name"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label={repLabels.role}
              value={repRole}
              onChangeText={setRepRole}
              placeholder="Role / Title"
            />
          </View>
        </View>

        {fields.repId ? (
          <Input
            label={fields.repId}
            value={repId}
            onChangeText={setRepId}
            placeholder="Enter ID"
            autoCapitalize="characters"
            autoCorrect={false}
          />
        ) : null}

        {/* ── Financials ──────────────────────────────────────────── */}
        <Text style={styles.sectionLbl}>Financials</Text>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Input
              label={`Amount (${group?.currency ?? "RWF"}) *`}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="300000"
              prefix={group?.currency ?? "RWF"}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Expected Return"
              value={expected}
              onChangeText={setExpected}
              keyboardType="numeric"
              placeholder="360000"
              prefix={group?.currency ?? "RWF"}
            />
          </View>
        </View>

        {roi !== null ? (
          <View style={styles.roiBadge}>
            <Text
              style={{
                fontSize: 13,
                color: roi >= 0 ? Colors.success : Colors.error,
                fontWeight: "700",
              }}
            >
              {roi >= 0 ? "📈" : "📉"} Estimated ROI: {roi > 0 ? "+" : ""}
              {roi}%
            </Text>
          </View>
        ) : null}

        {/* ── Dates ───────────────────────────────────────────────── */}
        <Text style={styles.sectionLbl}>Dates</Text>
        <DatePicker
          label="Start Date *"
          value={startDate}
          onChange={setStartDate}
          placeholder="Select start date"
        />
        <DatePicker
          label="Maturity Date (Optional)"
          value={maturityDate}
          onChange={setMaturityDate}
          placeholder="Select maturity date"
        />

        <View style={styles.footerSpacer} />

        <Button
          label="Register Investment"
          onPress={handleSave}
          fullWidth
          loading={loading}
          size="lg"
        />

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Toast visible={visible} msg={msg} type={type} />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  body: { padding: S.lg, paddingBottom: 60 },

  sectionLbl: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.text2,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 10,
  },

  row: { flexDirection: "row", gap: 10 },

  typeBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: Colors.accentFaint,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.25)",
    borderRadius: R.md,
    padding: S.md,
    marginTop: S.md,
    marginBottom: S.sm,
  },
  typeBannerIcon: { fontSize: 22, marginTop: 1 },
  typeBannerTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.success,
    marginBottom: 3,
  },
  typeBannerHint: {
    fontSize: 11,
    color: Colors.text2,
    lineHeight: 16,
  },

  roiBadge: {
    backgroundColor: Colors.accentFaint,
    borderWidth: 1,
    borderColor: Colors.accentFaint,
    borderRadius: R.md,
    padding: S.md,
    marginTop: 4,
    marginBottom: S.md,
  },

  footerSpacer: { height: 24 },
  bottomSpacer: { height: 12 },
});
