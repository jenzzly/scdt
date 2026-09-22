// app/modals/edit-transaction.tsx
//
// ASSUMPTIONS — please verify against your actual codebase and adjust:
// 1. Route registration: expo-router file-based routing means this file's
//    path (app/modals/edit-transaction.tsx) is enough to register the
//    route — no manual route table to update. If your app/_layout.tsx (or
//    app/modals/_layout.tsx) explicitly lists modal screens (e.g. a
//    <Stack.Screen name="modals/add-expense" .../>), you'll need to add a
//    matching entry for "modals/edit-transaction" there too, the same way
//    add-expense / add-contribution are registered.
// 2. Store action: I assumed `updateWalletTransaction(id, patch)` exists
//    or should be added alongside `deleteWalletTransaction` in useStore.
//    If your store uses a different name/shape, change the call below.
// 3. Editable fields: I limited editing to description, amount, and date —
//    the three plain fields safe to change on any transaction type without
//    breaking cascade links (loanId/contributionId/investmentId/sourceType
//    are left untouched). Changing `type` or amount sign is blocked for
//    transactions linked to a loan/contribution/investment, since those
//    are derived records — only free-standing/manual transactions can have
//    their type changed. Adjust if your business rules differ.
// 4. UI primitives: reused Input-like plain TextInput since I don't have
//    your exact `Input` component's props from components/ui — swap in
//    your real <Input label=... /> if it differs from this shape.

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  useGroupWallet,
  useCurrentUserRole,
  useStore,
  useGroupLoans,
} from "../../stores/useStore";

import { useToast, Toast, DatePicker } from "../../components/ui";
import { C, fmtCurrency, showConfirm, round2 } from "../../utils/theme";
import type { WalletTransaction } from "../../types";
import { projectAccruedInterest } from "../../lib/firestore/loans";

// Same allow-list as wallet.tsx — keep these two in sync, or better,
// move this into a shared constants file and import it in both places.
const EDIT_ROLES = ["admin", "loan_officer", "accountant"];

const TX_LABEL: Record<string, string> = {
  contribution: "Contribution",
  loan_disbursement: "Loan Disbursement",
  loan_repayment: "Loan Repayment",
  loan_interest_income: "Interest Income",
  loan_principal_recovery: "Principal Recovery",
  interest: "Interest Earned",
  late_fee: "Late Fee",
  investment_disbursement: "Investment",
  investment_return: "Investment Return",
  bank_fee: "Bank Fee",
  other_credit: "Credit",
  other_debit: "Debit",
  withdrawal: "Withdrawal",
};

// Transaction types considered "manual" / free-standing, i.e. not derived
// from a loan, contribution, or investment record. Only these are allowed
// to have their type reassigned here.
const MANUAL_TYPES = ["bank_fee", "other_credit", "other_debit", "withdrawal"];

export default function EditTransactionModal() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const allTxs = useGroupWallet();
  const allLoans = useGroupLoans();
  const role = useCurrentUserRole();
  // ASSUMPTION: `updateWalletTransaction` does not yet exist on the store —
  // add it alongside `deleteWalletTransaction`, matching its call
  // signature/error behavior. Expected shape:
  //   updateWalletTransaction(id: string, patch: Partial<WalletTransaction>, reason?: string): Promise<void>
  const { updateWalletTransaction, recalcTotals } = useStore();

  const { show, visible, msg, type } = useToast();

  const canEdit = EDIT_ROLES.includes(role);

  const tx = useMemo(
    () => allTxs.find((t: WalletTransaction) => t.id === id),
    [allTxs, id]
  );

  const linkedLoan = useMemo(() => {
    if (!tx?.loanId || tx.type !== "loan_disbursement") return null;
    return allLoans.find((l) => l.id === tx.loanId);
  }, [tx, allLoans]);

  const isLinked =
    !!tx?.loanId ||
    !!tx?.contributionId ||
    !!tx?.investmentId ||
    (tx?.sourceType && tx.sourceType !== "manual");

  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [date, setDate] = useState("");
  const [txType, setTxType] = useState("");
  const [saving, setSaving] = useState(false);

  // Calculate accrued interest projection when date changes for loan disbursements
  const accruedInterestProjection = useMemo(() => {
    if (!linkedLoan || linkedLoan.interestMethod !== "reducing_balance") return null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    
    try {
      // Use the loan's current application date as the anchor if lastAccrualDate is not set
      const anchorDate = (linkedLoan as any).lastAccrualDate || linkedLoan.applicationDate || date;
      
      const projection = projectAccruedInterest(
        {
          balance: linkedLoan.balance,
          interestRate: linkedLoan.interestRate,
          interestMethod: linkedLoan.interestMethod,
          interestRatePeriod: (linkedLoan as any).interestRatePeriod,
          accruedInterest: (linkedLoan as any).accruedInterest || 0,
          lastAccrualDate: anchorDate,
        },
        date + "T00:00:00.000Z" // Ensure proper ISO format
      );
      // console.log("Accrued interest projection (wallet):", projection, "loan data:", {
      //   balance: linkedLoan.balance,
      //   interestRate: linkedLoan.interestRate,
      //   lastAccrualDate: anchorDate,
      //   newDate: date,
      // });
      return projection;
    } catch (e) {
      console.error("Failed to calculate accrued interest projection:", e);
      return null;
    }
  }, [linkedLoan, date]);

  useEffect(() => {
    if (!tx) return;
    setDescription(tx.description ?? "");
    setAmountStr(String(Math.abs(tx.amount ?? 0)));
    setDate((tx.date ?? "").slice(0, 10));
    setTxType(tx.type ?? "");
  }, [tx?.id]);

  // ── Guard: no permission ──────────────────────────────────────────────
  if (!canEdit) {
    return (
      <View style={s.center}>
        <Text style={s.title}>Not authorized</Text>
        <Text style={s.subtitle}>
          You don't have permission to edit transactions.
        </Text>
        <TouchableOpacity style={s.secondaryBtn} onPress={() => router.back()}>
          <Text style={s.secondaryBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Guard: transaction not found ──────────────────────────────────────
  if (!tx) {
    return (
      <View style={s.center}>
        <Text style={s.title}>Transaction not found</Text>
        <Text style={s.subtitle}>
          This transaction may have been deleted, or the link is invalid.
        </Text>
        <TouchableOpacity style={s.secondaryBtn} onPress={() => router.back()}>
          <Text style={s.secondaryBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const originalAmount = Math.abs(tx.amount ?? 0);
  const wasCredit = (tx.amount ?? 0) >= 0;

  const parsedAmount = parseFloat(amountStr);
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const canSave = amountValid && dateValid && description.trim().length > 0;

  const hasChanges =
    description.trim() !== (tx.description ?? "") ||
    parsedAmount !== originalAmount ||
    date !== (tx.date ?? "").slice(0, 10) ||
    (!isLinked && txType !== tx.type);

  const handleSave = () => {
    if (!canSave || saving) return;

    const patch: Partial<WalletTransaction> = {
      description: description.trim(),
      // Preserve the original sign (credit vs debit) — only the magnitude
      // is editable here, since flipping credit/debit on a transaction
      // linked to a loan/contribution/investment would desync the ledger.
      amount: wasCredit ? Math.abs(parsedAmount) : -Math.abs(parsedAmount),
      date,
    };

    if (!isLinked && MANUAL_TYPES.includes(txType)) {
      patch.type = txType as WalletTransaction["type"];
    }

    showConfirm(
      "Save changes?",
      "This will update the transaction record. Linked totals will be recalculated.",
      async () => {
        setSaving(true);
        try {
          await updateWalletTransaction(tx.id, patch, "Edited by admin");
          recalcTotals();
          show("Transaction updated");
          router.back();
        } catch (e) {
          show("Failed to update transaction", "error");
        } finally {
          setSaving(false);
        }
      },
      undefined,
      false
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Text style={s.headerCancel}>Cancel</Text>
        </TouchableOpacity>

        <Text style={s.headerTitle}>Edit Transaction</Text>

        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave || !hasChanges || saving}
          hitSlop={10}
        >
          <Text
            style={[
              s.headerSave,
              (!canSave || !hasChanges || saving) && s.headerSaveDisabled,
            ]}
          >
            {saving ? "Saving…" : "Save"}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Summary: what you're editing ──────────────────────────── */}
        <View style={s.summaryBox}>
          <Text style={s.summaryLabel}>Original Record</Text>
          <Text style={s.summaryValue}>
            {wasCredit ? "+" : "−"}
            {fmtCurrency(originalAmount)} · {TX_LABEL[tx.type] ?? tx.type}
          </Text>
          <Text style={s.summaryDate}>
            {(tx.date ?? "").slice(0, 10)}
          </Text>
        </View>

        {/* ── Compact linked-record notice ──────────────────────────── */}
        {isLinked && (
          <View style={s.noticeBanner}>
            <Text style={s.noticeBannerIcon}>🔗</Text>
            <Text style={s.noticeBannerText} numberOfLines={3}>
              Linked to a{" "}
              {tx.loanId
                ? "loan"
                : tx.contributionId
                ? "contribution"
                : tx.investmentId
                ? "investment"
                : "record"}
              . Editing date or amount also updates that record.
              {tx.loanId && tx.type === "loan_disbursement"
                ? " Reducing-balance loans will re-accrue interest from the new date."
                : ""}
            </Text>
          </View>
        )}

        {/* ── Fields ────────────────────────────────────────────────── */}
        <Text style={s.sectionLbl}>Description</Text>
        <TextInput
          style={s.input}
          value={description}
          onChangeText={setDescription}
          placeholder="Transaction description"
          placeholderTextColor={C.text3}
        />

        <Text style={s.sectionLbl}>
          Amount ({wasCredit ? "credit" : "debit"})
        </Text>
        <TextInput
          style={s.input}
          value={amountStr}
          onChangeText={setAmountStr}
          placeholder="0.00"
          placeholderTextColor={C.text3}
          keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
        />
        {!amountValid && amountStr.length > 0 && (
          <Text style={s.errorText}>Enter a valid positive amount</Text>
        )}

        <Text style={s.sectionLbl}>Date</Text>
        <DatePicker
          label=""
          value={date}
          onChange={setDate}
          placeholder="YYYY-MM-DD"
        />

        {linkedLoan &&
          linkedLoan.interestMethod === "reducing_balance" &&
          accruedInterestProjection && (
            <View style={s.accruedInterestBox}>
              <Text style={s.accruedInterestLabel}>
                Projected Accrued Interest
              </Text>
              <Text style={s.accruedInterestValue}>
                {fmtCurrency(accruedInterestProjection.total)}
              </Text>
              <Text style={s.accruedInterestSub}>
                {accruedInterestProjection.days} days · +
                {fmtCurrency(accruedInterestProjection.accrued)} new
              </Text>
            </View>
          )}

        {!isLinked && (
          <>
            <Text style={s.sectionLbl}>Type</Text>
            <View style={s.typeRow}>
              {MANUAL_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[s.typeChip, txType === t && s.typeChipActive]}
                  onPress={() => setTxType(t)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      s.typeChipText,
                      txType === t && s.typeChipTextActive,
                    ]}
                  >
                    {TX_LABEL[t] ?? t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* ── Bottom save (thumb reach) ─────────────────────────────── */}
        <TouchableOpacity
          style={[
            s.saveBtn,
            (!canSave || !hasChanges || saving) && s.saveBtnDisabled,
          ]}
          onPress={handleSave}
          disabled={!canSave || !hasChanges || saving}
          activeOpacity={0.85}
        >
          <Text style={s.saveBtnText}>
            {saving ? "Saving…" : "Save Changes"}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 20 }} />
      </ScrollView>

      <Toast visible={visible} msg={msg} type={type} />
    </View>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: C.bg,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: "800", color: C.text },
  subtitle: { fontSize: 13, color: C.text3, textAlign: "center" },
  secondaryBtn: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "600", color: C.text },

  // ── Header ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 54 : 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerCancel: { fontSize: 14, color: C.text3, fontWeight: "600" },
  headerTitle: { fontSize: 15, fontWeight: "800", color: C.text },
  headerSave: { fontSize: 14, color: C.primary, fontWeight: "700" },
  headerSaveDisabled: { color: C.text3 },

  body: { padding: 16, paddingBottom: 40 },

  // ── Summary ──
  summaryBox: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: C.text3,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  summaryValue: { fontSize: 16, fontWeight: "800", color: C.text },
  summaryDate: { fontSize: 11, color: C.text3, marginTop: 2 },

  // ── Linked notice ──
  noticeBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: C.infoBg,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.2)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  noticeBannerIcon: { fontSize: 14, marginTop: 1 },
  noticeBannerText: {
    flex: 1,
    fontSize: 12,
    color: C.text2,
    lineHeight: 17,
  },

  // ── Fields ──
  sectionLbl: {
    fontSize: 10,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: C.text,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 11,
    color: C.error,
    marginTop: -10,
    marginBottom: 12,
  },

  // ── Type chips ──
  typeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
  },
  typeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  typeChipText: { fontSize: 12, fontWeight: "600", color: C.text3 },
  typeChipTextActive: { color: "#fff" },

  // ── Accrued interest ──
  accruedInterestBox: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  accruedInterestLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  accruedInterestValue: {
    fontSize: 16,
    fontWeight: "800",
    color: C.gold,
    marginBottom: 2,
  },
  accruedInterestSub: { fontSize: 11, color: C.text3 },

  // ── Bottom save ──
  saveBtn: {
    marginTop: 12,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
