import { Share, Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { fmtCurrency } from "./theme";

export function csvEscape(value: any): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function exportCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
) {
  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map((v) => csvEscape(v ?? "")).join(",")),
  ].join("\n");

  if (Platform.OS === "web") {
    // Browser download
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } else {
    // Native share
    try {
      await Share.share({
        title: filename,
        message: csv,
        url: `data:text/csv;base64,${btoa(csv)}`, // For iOS
      });
    } catch (e) {
      console.warn("Export failed:", e);
    }
  }
}

export async function exportPdf(
  filename: string,
  title: string,
  content: string
) {
  const html = `
    <html>
      <head>
        <title>${filename}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #111827; }
          h1 { color: #1A3C5E; margin-bottom: 16px; }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
          th { background-color: #0F766E; color: white; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        ${content}
      </body>
    </html>
  `;

  if (Platform.OS === "web") {
    // Open print dialog for PDF export
    const win = window.open("");
    if (win) {
      win.document.write(html.replace("</body>", "<script>window.print(); window.close();</script></body>"));
      win.document.close();
    }
  } else {
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: filename,
          UTI: "com.adobe.pdf",
        });
      } else {
        await Share.share({ title: filename, url: uri });
      }
    } catch (e) {
      console.warn("Export failed:", e);
    }
  }
}

export function generatePaymentScheduleHtml(
  memberName: string,
  amount: number,
  interestRate: number,
  monthlyPayment: number,
  totalRepayable: number,
  schedule: Array<{
    index: number;
    dueDate: string;
    principal: number;
    interest: number;
    total: number;
  }>
): string {
  const rows = schedule
    .map(
      (item) =>
        `<tr>
          <td>${item.index + 1}</td>
          <td>${new Date(item.dueDate).toLocaleDateString()}</td>
          <td>${fmtCurrency(item.principal)}</td>
          <td>${fmtCurrency(item.interest)}</td>
          <td>${fmtCurrency(item.total)}</td>
        </tr>`
    )
    .join("");

  return `
    <table>
      <tr><th>Member</th><td>${memberName}</td></tr>
      <tr><th>Principal</th><td>${fmtCurrency(amount)}</td></tr>
      <tr><th>Interest Rate</th><td>${interestRate}%</td></tr>
      <tr><th>Monthly Payment</th><td>${fmtCurrency(monthlyPayment)}</td></tr>
      <tr><th>Total Repayable</th><td>${fmtCurrency(totalRepayable)}</td></tr>
    </table>
    <h3>Repayment Schedule</h3>
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th>Due Date</th>
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
