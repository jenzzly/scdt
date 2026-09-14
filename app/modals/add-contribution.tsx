// app/modals/edit-transaction.tsx

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  useStore,
  useGroupWallet,
  useCurrentUserRole,
} from "../../stores/useStore";

import {
  Input,
  Select,
  Button,
  useToast,
  Toast,
  DatePicker,
} from "../../components/ui";

import { ModalShell } from "../../components/ui/ModalShell";
import { Colors, S, fmtCurrency } from "../../utils/theme";

import type { WalletTransaction } from "../../types";

const EDIT_ROLES = [
  "admin",
  "loan_officer",
  "accountant",
];

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

const MANUAL_TYPES = [
  {
    label: "Bank Fee",
    value: "bank_fee",
  },
  {
    label: "Credit",
    value: "other_credit",
  },
  {
    label: "Debit",
    value: "other_debit",
  },
  {
    label: "Withdrawal",
    value: "withdrawal",
  },
];

export default function EditTransactionModal() {
  const router = useRouter();

  const params = useLocalSearchParams<{
    id?: string | string[];
  }>();

  const transactionId = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const allWallet = useGroupWallet();
  const role = useCurrentUserRole();

  const {
    updateWalletTransaction,
    recalcTotals,
  } = useStore();

  const {
    show,
    visible,
    msg,
    type,
  } = useToast();

  const canEdit = EDIT_ROLES.includes(role);

  const tx = useMemo(() => {
    if (!transactionId) return undefined;

    return allWallet.find(
      (item: WalletTransaction) =>
        item.id === transactionId
    );
  }, [allWallet, transactionId]);

  const isLinked = !!(
    tx?.loanId ||
    tx?.contributionId ||
    tx?.investmentId ||
    (tx?.sourceType &&
      tx.sourceType !== "manual")
  );

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [txType, setTxType] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tx) return;

    setDescription(tx.description ?? "");
    setAmount(
      String(Math.abs(Number(tx.amount ?? 0)))
    );
    setDate((tx.date ?? "").slice(0, 10));
    setTxType(tx.type ?? "");
  }, [tx?.id]);

  /*
   * Permission guard
   */
  if (!canEdit) {
    return (
      <ModalShell
        title="Edit Transaction"
        onClose={() => router.back()}
      >
        <View style={styles.center}>
          <Text style={styles.title}>
            Not authorized
          </Text>

          <Text style={styles.subtitle}>
            You don't have permission to edit
            transactions.
          </Text>

          <Button
            label="Go Back"
            onPress={() => router.back()}
            variant="secondary"
            fullWidth
          />
        </View>

        <Toast
          visible={visible}
          msg={msg}
          type={type}
        />
      </ModalShell>
    );
  }

  /*
   * Transaction not found
   */
  if (!tx) {
    return (
      <ModalShell
        title="Edit Transaction"
        onClose={() => router.back()}
      >
        <View style={styles.center}>
          <Text style={styles.title}>
            Transaction not found
          </Text>

          <Text style={styles.subtitle}>
            This transaction may have been deleted,
            or the link is invalid.
          </Text>

          <Button
            label="Go Back"
            onPress={() => router.back()}
            variant="secondary"
            fullWidth
          />
        </View>

        <Toast
          visible={visible}
          msg={msg}
          type={type}
        />
      </ModalShell>
    );
  }

  const originalAmount = Math.abs(
    Number(tx.amount ?? 0)
  );

  const wasCredit =
    Number(tx.amount ?? 0) >= 0;

  const parsedAmount = Number(
    amount.replace(/,/g, "").trim()
  );

  const amountValid =
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0;

  const dateValid =
    /^\d{4}-\d{2}-\d{2}$/.test(date);

  const descriptionValid =
    description.trim().length > 0;

  const canSave =
    amountValid &&
    dateValid &&
    descriptionValid;

  const originalDate =
    (tx.date ?? "").slice(0, 10);

  const hasChanges =
    description.trim() !==
      (tx.description ?? "") ||
    parsedAmount !== originalAmount ||
    date !== originalDate ||
    (!isLinked && txType !== tx.type);

  /*
   * Save transaction
   */
  const handleSave = async () => {
    if (loading) return;

    if (!descriptionValid) {
      show(
        "Enter a transaction description",
        "error"
      );
      return;
    }

    if (!amountValid) {
      show(
        "Enter a valid positive amount",
        "error"
      );
      return;
    }

    if (!dateValid) {
      show(
        "Enter a valid date",
        "error"
      );
      return;
    }

    if (!hasChanges) {
      show("No changes to save");
      return;
    }

    const finalAmount = wasCredit
      ? Math.abs(parsedAmount)
      : -Math.abs(parsedAmount);

    const patch: Partial<WalletTransaction> = {
      description: description.trim(),
      amount: finalAmount,
      date,
    };

    /*
     * Only standalone/manual transactions
     * can change transaction type.
     */
    if (
      !isLinked &&
      MANUAL_TYPES.some(
        (item) => item.value === txType
      )
    ) {
      patch.type =
        txType as WalletTransaction["type"];
    }

    setLoading(true);

    try {
      await updateWalletTransaction(
        tx.id,
        patch,
        "Edited by admin"
      );

      recalcTotals();

      show("Transaction updated");

      router.back();
    } catch (error) {
      console.error(
        "Failed to update transaction:",
        error
      );

      show(
        "Failed to update transaction",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title="Edit Transaction"
      onClose={() => router.back()}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {isLinked && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>
              Linked transaction
            </Text>

            <Text style={styles.noticeText}>
              This transaction is linked to a{" "}
              {tx.loanId
                ? "loan"
                : tx.contributionId
                ? "contribution"
                : "investment"}
              . You can edit the description,
              amount and date. The transaction type
              and linked record remain unchanged.
            </Text>
          </View>
        )}

        <Input
          label="Description *"
          value={description}
          onChangeText={setDescription}
          placeholder="Transaction description"
        />

        <Input
          label={`Amount (${
            wasCredit ? "credit" : "debit"
          }) *`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          prefix="RWF"
          hint={`Original: ${
            wasCredit ? "+" : "-"
          }${fmtCurrency(originalAmount)}`}
        />

        {!amountValid && amount.length > 0 && (
          <Text style={styles.errorText}>
            Enter a valid positive amount.
          </Text>
        )}

        <DatePicker
          label="Transaction Date *"
          value={date}
          onChange={setDate}
          placeholder="Select transaction date"
        />

        {!dateValid && date.length > 0 && (
          <Text style={styles.errorText}>
            Enter a valid date in YYYY-MM-DD
            format.
          </Text>
        )}

        {!isLinked && (
          <Select
            label="Type *"
            value={txType}
            options={MANUAL_TYPES}
            onChange={setTxType}
          />
        )}

        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>
            Original transaction
          </Text>

          <Text style={styles.summaryValue}>
            {wasCredit ? "+" : "-"}
            {fmtCurrency(originalAmount)}
            {" · "}
            {TX_LABEL[tx.type] ?? tx.type}
            {" · "}
            {originalDate}
          </Text>
        </View>

        <View style={styles.spacer} />

        <Button
          label="Save Changes"
          onPress={handleSave}
          fullWidth
          loading={loading}
          disabled={!canSave || !hasChanges}
          size="lg"
        />

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Toast
        visible={visible}
        msg={msg}
        type={type}
      />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: S.lg,
    paddingBottom: 60,
  },

  center: {
    padding: S.lg,
    gap: 12,
  },

  title: {
    fontSize: 17,
    fontWeight: "800",
    color: Colors.text,
    textAlign: "center",
  },

  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.text3,
    textAlign: "center",
    marginBottom: 8,
  },

  noticeBox: {
    backgroundColor: Colors.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: S.md,
    marginBottom: S.lg,
  },

  noticeTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.text,
    marginBottom: 4,
  },

  noticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.text2,
  },

  errorText: {
    fontSize: 11,
    color: Colors.error,
    marginTop: -10,
    marginBottom: S.md,
  },

  summaryBox: {
    marginTop: S.sm,
    padding: S.md,
    borderRadius: 10,
    backgroundColor: Colors.elevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  summaryLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: Colors.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 5,
  },

  summaryValue: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.text2,
  },

  spacer: {
    height: S.lg,
  },

  bottomSpacer: {
    height: 12,
  },
});