// components/wallet/BalanceSheetTab.tsx
//
// Balance Sheet tab for the Wallet screen.
//
// Model: the group has ONE bank account. The wallet ledger tracks the
// group's total position; the bank account tracks what the bank
// actually shows. They should agree. When they don't, the admin
// records a reconciliation that captures the reason and writes an
// adjustment to the ledger.

import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import {
  useStore,
  useActiveGroup,
  useGroupWallet,
  useCurrentUserRole,
} from "../../stores/useStore";
import { useTheme } from "../../hooks/useTheme";
import {
  fmtCurrency,
  fmtDate,
  round2,
  showConfirm,
  type Palette,
} from "../../utils/theme";
import { Input, Button, BottomModal, useToast, Toast } from "../ui";

const REASONS: { value: string; label: string }[] = [
  { value: "Bank charges not recorded", label: "Bank charges" },
  { value: "Unrecorded deposit", label: "Unrecorded deposit" },
  { value: "Unrecorded withdrawal", label: "Unrecorded withdrawal" },
  { value: "Interest credited by bank", label: "Interest credited" },
  { value: "Ledger error correction", label: "Ledger error" },
  { value: "Other (see notes)", label: "Other" },
];

export function BalanceSheetTab() {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);

  const group = useActiveGroup();
  const role = useCurrentUserRole();
  const walletTxs = useGroupWallet();
  const isAdmin = role === "admin";

  const setBankAccount = useStore((s) => s.setBankAccount);
  const clearBankAccount = useStore((s) => s.clearBankAccount);
  const reconcileBankBalance = useStore((s) => s.reconcileBankBalance);

  const { show, visible, msg, type } = useToast();

  const [setupOpen, setSetupOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [balanceInput, setBalanceInput] = useState("");

  const [actualInput, setActualInput] = useState("");
  const [reason, setReason] = useState(REASONS[0].value);
  const [notes, setNotes] = useState("");

  const bank = group?.bankAccount;
  const walletBalance = round2(group?.availableBalance ?? 0);
  const bankBalance = bank ? round2(bank.currentBalance) : 0;
  const difference = round2(bankBalance - walletBalance);
  const inSync = !!bank && Math.abs(difference) < 0.01;

  const reconciliations = useMemo(
    () =>
      walletTxs
        .filter((t) => t.type === "bank_reconciliation")
        .sort(
          (a, b) =>
            new Date(b.createdAt || b.date).getTime() -
            new Date(a.createdAt || a.date).getTime(),
        ),
    [walletTxs],
  );

  const openSetup = () => {
    setBankName(bank?.bankName ?? "");
    setAccountNumber(bank?.accountNumber ?? "");
    setBalanceInput(bank ? String(bank.currentBalance) : String(walletBalance));
    setSetupOpen(true);
  };

  const openReconcile = () => {
    setActualInput("");
    setReason(REASONS[0].value);
    setNotes("");
    setReconcileOpen(true);
  };

  const handleSaveBank = async () => {
    if (!bankName.trim()) {
      show("Bank name is required", "error");
      return;
    }
    const parsed = parseFloat(balanceInput.replace(/,/g, ""));
    if (isNaN(parsed)) {
      show("Enter a valid balance", "error");
      return;
    }
    setSaving(true);
    try {
      await setBankAccount({
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim() || undefined,
        currentBalance: round2(parsed),
      });
      show(bank ? "Bank account updated" : "Bank account added", "success");
      setSetupOpen(false);
    } catch (e: any) {
      show(e?.message || "Failed to save bank account", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReconcile = async () => {
    const parsed = parseFloat(actualInput.replace(/,/g, ""));
    if (isNaN(parsed)) {
      show("Enter the actual bank balance", "error");
      return;
    }
    setReconciling(true);
    try {
      const result = await reconcileBankBalance(
        parsed,
        reason,
        notes.trim() || undefined,
      );
      const d = result.difference;
      show(
        Math.abs(d) < 0.01
          ? "Already in sync — no adjustment needed"
          : "Reconciliation recorded",
        "success",
      );
      setReconcileOpen(false);
    } catch (e: any) {
      show(e?.message || "Failed to reconcile", "error");
    } finally {
      setReconciling(false);
    }
  };

  const handleClearBank = () => {
    showConfirm(
      "Remove bank account?",
      "Reconciliations already recorded stay in the ledger. You can re-add the account any time.",
      async () => {
        try {
          await clearBankAccount();
          show("Bank account removed", "success");
        } catch (e: any) {
          show(e?.message || "Failed to remove", "error");
        }
      },
      undefined,
      true,
    );
  };

  if (!bank) {
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>🏦</Text>
          <Text style={styles.emptyTitle}>No bank account set up yet</Text>
          <Text style={styles.emptyBody}>
            Add your group's bank account to see how the wallet ledger
            compares to what's actually at the bank.
          </Text>

          {isAdmin ? (
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={openSetup}
              activeOpacity={0.85}
            >
              <Text style={styles.emptyBtnText}>+ Add Bank Account</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.emptyHint}>
              Only admins can set up the bank account.
            </Text>
          )}
        </View>

        <SetupModal
          visible={setupOpen}
          onClose={() => setSetupOpen(false)}
          bankName={bankName}
          accountNumber={accountNumber}
          balanceInput={balanceInput}
          currency={group?.currency ?? "RWF"}
          saving={saving}
          onBankNameChange={setBankName}
          onAccountNumberChange={setAccountNumber}
          onBalanceChange={setBalanceInput}
          onSave={handleSaveBank}
          isEdit={false}
        />

        <Toast visible={visible} msg={msg} type={type} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.positionCard,
          { borderLeftColor: inSync ? C.success : C.error },
        ]}
      >
        <Text style={styles.positionLabel}>WALLET vs BANK</Text>

        <View style={styles.positionRow}>
          <View style={styles.positionSide}>
            <Text style={styles.positionSideLabel}>Wallet (ledger)</Text>
            <Text
              style={styles.positionSideValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {fmtCurrency(walletBalance, group?.currency)}
            </Text>
          </View>

          <View style={styles.positionDivider} />

          <View style={styles.positionSide}>
            <Text style={styles.positionSideLabel}>Bank (actual)</Text>
            <Text
              style={styles.positionSideValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {fmtCurrency(bankBalance, group?.currency)}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.diffPill,
            {
              backgroundColor: inSync ? C.greenBg : C.redBg,
              borderColor: inSync ? C.success : C.error,
            },
          ]}
        >
          <Text
            style={[
              styles.diffPillText,
              { color: inSync ? C.greenText : C.error },
            ]}
          >
            {inSync
              ? "✓ In sync"
              : `⚠ Off by ${fmtCurrency(Math.abs(difference), group?.currency)} ${
                  difference > 0 ? "(bank has more)" : "(bank has less)"
                }`}
          </Text>
        </View>
      </View>

      <View style={styles.detailsCard}>
        <View style={styles.detailsHeader}>
          <Text style={styles.detailsTitle} numberOfLines={1}>
            {bank.bankName}
          </Text>
          {isAdmin && (
            <TouchableOpacity
              onPress={openSetup}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.detailsEdit}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>

        {bank.accountNumber ? (
          <Text style={styles.detailsLine}>Account: {bank.accountNumber}</Text>
        ) : null}

        {bank.lastReconciledAt ? (
          <Text style={styles.detailsLine}>
            Last reconciled {fmtDate(bank.lastReconciledAt)}
            {bank.lastReconciledByName ? ` by ${bank.lastReconciledByName}` : ""}
          </Text>
        ) : (
          <Text style={styles.detailsLineMuted}>Never reconciled</Text>
        )}
      </View>

      {isAdmin && (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, inSync && styles.actionBtnDisabled]}
            onPress={openReconcile}
            disabled={inSync}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.actionBtnText,
                inSync && styles.actionBtnTextDisabled,
              ]}
            >
              {inSync ? "Already in sync" : "Reconcile balance"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtnGhost}
            onPress={handleClearBank}
            activeOpacity={0.85}
          >
            <Text style={styles.actionBtnGhostText}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.sectionLabel}>Reconciliation History</Text>

      {reconciliations.length === 0 ? (
        <Text style={styles.emptyInline}>No reconciliations yet</Text>
      ) : (
        <View style={styles.historyList}>
          {reconciliations.map((r) => {
            const isCredit = r.amount > 0;
            return (
              <View key={r.id} style={styles.historyRow}>
                <View
                  style={[
                    styles.historyDot,
                    { backgroundColor: isCredit ? C.greenBg : C.redBg },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: isCredit ? C.success : C.error,
                    }}
                  >
                    {isCredit ? "↑" : "↓"}
                  </Text>
                </View>

                <View style={styles.historyMid}>
                  <Text style={styles.historyDesc} numberOfLines={2}>
                    {r.description}
                  </Text>
                  <Text style={styles.historyDate}>{fmtDate(r.date)}</Text>
                </View>

                <Text
                  style={[
                    styles.historyAmount,
                    { color: isCredit ? C.success : C.error },
                  ]}
                >
                  {isCredit ? "+" : "−"}
                  {fmtCurrency(Math.abs(r.amount), group?.currency)}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <SetupModal
        visible={setupOpen}
        onClose={() => setSetupOpen(false)}
        bankName={bankName}
        accountNumber={accountNumber}
        balanceInput={balanceInput}
        currency={group?.currency ?? "RWF"}
        saving={saving}
        onBankNameChange={setBankName}
        onAccountNumberChange={setAccountNumber}
        onBalanceChange={setBalanceInput}
        onSave={handleSaveBank}
        isEdit={true}
      />

      <ReconcileModal
        visible={reconcileOpen}
        onClose={() => setReconcileOpen(false)}
        walletBalance={walletBalance}
        bankBalance={bankBalance}
        currency={group?.currency ?? "RWF"}
        actualInput={actualInput}
        reason={reason}
        notes={notes}
        reconciling={reconciling}
        onActualChange={setActualInput}
        onReasonChange={setReason}
        onNotesChange={setNotes}
        onReconcile={handleReconcile}
      />

      <Toast visible={visible} msg={msg} type={type} />
    </View>
  );
}

function SetupModal({
  visible,
  onClose,
  bankName,
  accountNumber,
  balanceInput,
  currency,
  saving,
  onBankNameChange,
  onAccountNumberChange,
  onBalanceChange,
  onSave,
  isEdit,
}: {
  visible: boolean;
  onClose: () => void;
  bankName: string;
  accountNumber: string;
  balanceInput: string;
  currency: string;
  saving: boolean;
  onBankNameChange: (v: string) => void;
  onAccountNumberChange: (v: string) => void;
  onBalanceChange: (v: string) => void;
  onSave: () => void;
  isEdit: boolean;
}) {
  return (
    <BottomModal
      visible={visible}
      onClose={onClose}
      title={isEdit ? "Edit Bank Account" : "Add Bank Account"}
    >
      <View style={{ padding: 16, gap: 12, paddingBottom: 24 }}>
        <Input
          label="Bank name *"
          value={bankName}
          onChangeText={onBankNameChange}
          placeholder="e.g. Bank of Kigali, Equity, I&M"
        />
        <Input
          label="Account number"
          value={accountNumber}
          onChangeText={onAccountNumberChange}
          placeholder="Optional"
        />
        <Input
          label={`Current balance (${currency}) *`}
          value={balanceInput}
          onChangeText={onBalanceChange}
          keyboardType="numeric"
          prefix={currency}
          hint="What the bank statement shows right now."
        />
        <Button
          label={isEdit ? "Save Changes" : "Add Bank Account"}
          onPress={onSave}
          loading={saving}
          fullWidth
        />
      </View>
    </BottomModal>
  );
}

function ReconcileModal({
  visible,
  onClose,
  walletBalance,
  bankBalance,
  currency,
  actualInput,
  reason,
  notes,
  reconciling,
  onActualChange,
  onReasonChange,
  onNotesChange,
  onReconcile,
}: {
  visible: boolean;
  onClose: () => void;
  walletBalance: number;
  bankBalance: number;
  currency: string;
  actualInput: string;
  reason: string;
  notes: string;
  reconciling: boolean;
  onActualChange: (v: string) => void;
  onReasonChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onReconcile: () => void;
}) {
  const C = useTheme();

  const parsedActual = parseFloat(actualInput.replace(/,/g, ""));
  const previewDiff = !isNaN(parsedActual)
    ? round2(parsedActual - walletBalance)
    : null;

  return (
    <BottomModal
      visible={visible}
      onClose={onClose}
      title="Reconcile Bank Balance"
    >
      <View style={{ padding: 16, gap: 12, paddingBottom: 24 }}>
        <Text style={{ fontSize: 12, color: C.text3, lineHeight: 17 }}>
          Enter the balance from your bank statement. A single adjustment
          will be recorded on the ledger to close the gap.
        </Text>

        <View
          style={{
            padding: 12,
            borderRadius: 10,
            backgroundColor: C.elevated,
            borderWidth: 1,
            borderColor: C.border,
            gap: 4,
          }}
        >
          <Text style={{ fontSize: 11, color: C.text3 }}>
            Wallet ledger now:{" "}
            <Text style={{ color: C.text, fontWeight: "700" }}>
              {fmtCurrency(walletBalance, currency)}
            </Text>
          </Text>
          <Text style={{ fontSize: 11, color: C.text3 }}>
            Last recorded bank:{" "}
            <Text style={{ color: C.text, fontWeight: "700" }}>
              {fmtCurrency(bankBalance, currency)}
            </Text>
          </Text>
        </View>

        <Input
          label={`Actual bank balance (${currency}) *`}
          value={actualInput}
          onChangeText={onActualChange}
          keyboardType="numeric"
          prefix={currency}
          placeholder="From your statement"
        />

        {previewDiff !== null && Math.abs(previewDiff) >= 0.01 ? (
          <View
            style={{
              padding: 10,
              borderRadius: 8,
              backgroundColor: previewDiff > 0 ? C.greenBg : C.redBg,
              borderWidth: 1,
              borderColor: previewDiff > 0 ? C.success : C.error,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                color: previewDiff > 0 ? C.greenText : C.error,
              }}
            >
              {previewDiff > 0 ? "Will record a credit of " : "Will record a debit of "}
              {fmtCurrency(Math.abs(previewDiff), currency)}
            </Text>
          </View>
        ) : previewDiff !== null ? (
          <View
            style={{
              padding: 10,
              borderRadius: 8,
              backgroundColor: C.greenBg,
              borderWidth: 1,
              borderColor: C.success,
            }}
          >
            <Text
              style={{ fontSize: 12, fontWeight: "700", color: C.greenText }}
            >
              ✓ Already in sync — no adjustment needed
            </Text>
          </View>
        ) : null}

        <Text
          style={{
            fontSize: 11,
            fontWeight: "800",
            color: C.text2,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            marginTop: 4,
          }}
        >
          Reason
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {REASONS.map((r) => {
            const active = reason === r.value;
            return (
              <TouchableOpacity
                key={r.value}
                onPress={() => onReasonChange(r.value)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: active ? C.primary : C.border,
                  backgroundColor: active ? C.primary + "18" : C.surface,
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: active ? "700" : "500",
                    color: active ? C.primary : C.text2,
                  }}
                >
                  {r.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Input
          label="Notes (optional)"
          value={notes}
          onChangeText={onNotesChange}
          placeholder="Anything you want recorded alongside the reconciliation"
          multiline
        />

        <Button
          label={reconciling ? "Saving…" : "Record Reconciliation"}
          onPress={onReconcile}
          loading={reconciling}
          fullWidth
        />
      </View>
    </BottomModal>
  );
}

const makeStyles = (C: Palette) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 40,
      gap: 12,
    },

    emptyWrap: {
      paddingHorizontal: 16,
      paddingTop: 40,
      paddingBottom: 40,
      alignItems: "center",
    },
    emptyCard: {
      width: "100%",
      maxWidth: 460,
      padding: 28,
      borderRadius: 16,
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: "center",
      gap: 12,
    },
    emptyIcon: { fontSize: 40 },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: C.text,
      textAlign: "center",
    },
    emptyBody: {
      fontSize: 13,
      lineHeight: 19,
      color: C.text3,
      textAlign: "center",
    },
    emptyBtn: {
      marginTop: 8,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: C.primary,
    },
    emptyBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: "#fff",
    },
    emptyHint: {
      fontSize: 12,
      color: C.text3,
      textAlign: "center",
      fontStyle: "italic",
    },

    positionCard: {
      padding: 16,
      borderRadius: 14,
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.border,
      borderLeftWidth: 4,
      gap: 12,
    },
    positionLabel: {
      fontSize: 10,
      fontWeight: "800",
      color: C.text3,
      letterSpacing: 0.8,
      textTransform: "uppercase",
    },
    positionRow: {
      flexDirection: "row",
      alignItems: "stretch",
    },
    positionSide: { flex: 1, minWidth: 0, gap: 4 },
    positionSideLabel: {
      fontSize: 11,
      fontWeight: "600",
      color: C.text3,
    },
    positionSideValue: {
      fontSize: 18,
      fontWeight: "800",
      color: C.text,
      letterSpacing: -0.3,
    },
    positionDivider: {
      width: 1,
      marginHorizontal: 12,
      backgroundColor: C.borderLight,
    },
    diffPill: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: "center",
    },
    diffPillText: { fontSize: 12, fontWeight: "800" },

    detailsCard: {
      padding: 14,
      borderRadius: 12,
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.border,
      gap: 6,
    },
    detailsHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 4,
    },
    detailsTitle: {
      fontSize: 15,
      fontWeight: "800",
      color: C.text,
      flex: 1,
      minWidth: 0,
    },
    detailsEdit: { fontSize: 12, fontWeight: "700", color: C.primary },
    detailsLine: { fontSize: 12, color: C.text2 },
    detailsLineMuted: { fontSize: 12, color: C.text3, fontStyle: "italic" },

    actionsRow: { flexDirection: "row", gap: 8 },
    actionBtn: {
      flex: 2,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: C.primary,
      alignItems: "center",
    },
    actionBtnDisabled: { backgroundColor: C.mutedBg },
    actionBtnText: { fontSize: 13, fontWeight: "800", color: "#fff" },
    actionBtnTextDisabled: { color: C.text3 },
    actionBtnGhost: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: C.elevated,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: "center",
    },
    actionBtnGhostText: { fontSize: 13, fontWeight: "700", color: C.error },

    sectionLabel: {
      fontSize: 11,
      fontWeight: "800",
      color: C.text3,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginTop: 8,
    },
    emptyInline: {
      fontSize: 12,
      color: C.text3,
      paddingVertical: 12,
      textAlign: "center",
      fontStyle: "italic",
    },
    historyList: {
      backgroundColor: C.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      overflow: "hidden",
    },
    historyRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      paddingHorizontal: 14,
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: C.borderLight,
    },
    historyDot: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    historyMid: { flex: 1, minWidth: 0 },
    historyDesc: { fontSize: 12, fontWeight: "600", color: C.text },
    historyDate: { fontSize: 10, color: C.text3, marginTop: 2 },
    historyAmount: { fontSize: 13, fontWeight: "800", flexShrink: 0 },
  });

export default BalanceSheetTab;
