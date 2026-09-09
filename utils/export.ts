// utils/export.ts
//
// Export helpers used across contributions.tsx, reports.tsx, and
// group-settings.tsx. Excel (.xlsx) is the supported spreadsheet format —
// CSV export has been removed in favor of it.
//
// Uses:
//   - xlsx        → build the workbook in memory
//   - expo-file-system → write the workbook / html to a temp file
//   - expo-sharing → hand the file off to the OS share sheet
//   - expo-print   → render HTML to PDF (native + web)
//   - expo-document-picker → let the user pick a file to import

import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";

// ─────────────────────────────────────────────────────────────────────────
// Shared: turn a workbook into bytes, then hand off to the platform
// ─────────────────────────────────────────────────────────────────────────

async function writeAndShareXlsx(fileName: string, workbook: XLSX.WorkBook) {
  const safeName = fileName.replace(/[^a-zA-Z0-9_\-]/g, "_");

  if (Platform.OS === "web") {
    // On web, xlsx can trigger a browser download directly.
    XLSX.writeFile(workbook, `${safeName}.xlsx`);
    return;
  }

  // Native: write to a temp file, then open the share sheet.
  const base64 = XLSX.write(workbook, {
    type: "base64",
    bookType: "xlsx",
  });

  const uri = `${FileSystem.cacheDirectory}${safeName}.xlsx`;

  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const canShare = await Sharing.isAvailableAsync();

  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dialogTitle: fileName,
      UTI: "com.microsoft.excel.xlsx",
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// exportXlsx — headers + rows → a single-sheet .xlsx file
// ─────────────────────────────────────────────────────────────────────────

export async function exportXlsx(
  fileName: string,
  headers: string[],
  rows: (string | number)[][]
): Promise<void> {
  const worksheetData = [headers, ...rows];

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Reasonable default column widths so exported sheets aren't unreadably
  // cramped — based on the longest value (header or cell) per column.
  const colWidths = headers.map((h, colIndex) => {
    let maxLen = String(h).length;

    rows.forEach((row) => {
      const cell = row[colIndex];
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      if (len > maxLen) maxLen = len;
    });

    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });

  worksheet["!cols"] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  await writeAndShareXlsx(fileName, workbook);
}

// ─────────────────────────────────────────────────────────────────────────
// importXlsx — prompts the user to pick a .xlsx/.xls/.csv file, returns
// rows as an array of arrays (first row = headers, included). Caller is
// responsible for interpreting columns/skipping the header row.
// ─────────────────────────────────────────────────────────────────────────

export async function importXlsx(): Promise<any[][] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    throw new Error("Cancelled");
  }

  const asset = result.assets[0];

  let workbook: XLSX.WorkBook;

  if (Platform.OS === "web") {
    // On web, `asset.file` is a browser File object when available.
    const file = (asset as any).file as File | undefined;

    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      workbook = XLSX.read(arrayBuffer, { type: "array" });
    } else {
      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();
      workbook = XLSX.read(arrayBuffer, { type: "array" });
    }
  } else {
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    workbook = XLSX.read(base64, { type: "base64" });
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return null;

  const worksheet = workbook.Sheets[firstSheetName];

  const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  // Drop fully-empty trailing rows some spreadsheet apps leave behind.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "" || c === null || c === undefined)) {
    rows.pop();
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────
// exportPdf — wraps arbitrary HTML in a minimal document and prints/shares
// ─────────────────────────────────────────────────────────────────────────

export async function exportPdf(
  fileName: string,
  title: string,
  bodyHtml: string
): Promise<void> {
  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 24px; color: #0F172A; }
          h1 { font-size: 18px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #E2E8F0; padding: 6px 8px; text-align: left; }
          th { background: #F1F5F9; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; font-size: 9px; }
          tr:nth-child(even) td { background: #F8FAFC; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        ${bodyHtml}
      </body>
    </html>
  `;

  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return;
  }

  const { uri } = await Print.printToFileAsync({ html });

  const safeName = fileName.replace(/[^a-zA-Z0-9_\-]/g, "_");
  const destUri = `${FileSystem.cacheDirectory}${safeName}.pdf`;

  await FileSystem.moveAsync({ from: uri, to: destUri }).catch(() => {
    // If move fails (e.g. cross-volume on some devices), fall back to
    // sharing the original temp file directly.
  });

  const finalUri = await FileSystem.getInfoAsync(destUri).then((info) =>
    info.exists ? destUri : uri
  );

  const canShare = await Sharing.isAvailableAsync();

  if (canShare) {
    await Sharing.shareAsync(finalUri, {
      mimeType: "application/pdf",
      dialogTitle: fileName,
      UTI: "com.adobe.pdf",
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// generatePaymentScheduleHtml — used by loans.tsx to build the schedule
// table passed into exportPdf
// ─────────────────────────────────────────────────────────────────────────

export function generatePaymentScheduleHtml(
  memberName: string,
  principal: number,
  interestRate: number,
  monthlyPayment: number,
  totalRepayable: number,
  schedule: { index: number; dueDate: string; principal: number; interest: number; total: number }[]
): string {
  const fmtMoney = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rows = schedule
    .map(
      (item) => `
        <tr>
          <td>${item.index + 1}</td>
          <td>${new Date(item.dueDate).toLocaleDateString()}</td>
          <td>${fmtMoney(item.principal)}</td>
          <td>${fmtMoney(item.interest)}</td>
          <td>${fmtMoney(item.total)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <p><strong>Borrower:</strong> ${memberName}</p>
    <p><strong>Principal:</strong> ${fmtMoney(principal)} &nbsp; <strong>Rate:</strong> ${interestRate}% &nbsp; <strong>Monthly payment:</strong> ${fmtMoney(monthlyPayment)}</p>
    <p><strong>Total repayable:</strong> ${fmtMoney(totalRepayable)}</p>
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th>Due date</th>
          <th>Principal</th>
          <th>Interest</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}