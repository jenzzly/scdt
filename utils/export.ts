// utils/export.ts
import { Platform } from "react-native";
import * as XLSX from "xlsx";

export async function exportXlsx(
  fileName: string,
  headers: string[],
  rows: (string | number)[][]
): Promise<void> {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  const safeName = fileName.replace(/[^a-zA-Z0-9_\-]/g, "_");

  if (Platform.OS === "web") {
    // Browser path: write binary array, wrap in a Blob, trigger a download.
    const wbout = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
    });

    const blob = new Blob([wbout], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  // Native path (iOS/Android)
  const { File, Paths } = await import("expo-file-system");
  const Sharing = await import("expo-sharing");

  const base64 = XLSX.write(workbook, {
    type: "base64",
    bookType: "xlsx",
  });

  const file = new File(Paths.cache, `${safeName}.xlsx`);
  file.write(base64ToBytes(base64));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dialogTitle: "Export contributions",
      UTI: "com.microsoft.excel.xlsx",
    });
  } else {
    throw new Error("Sharing is not available on this device");
  }
}

export async function importXlsx(): Promise<any[][]> {
  if (Platform.OS === "web") {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx,.xls";

      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) {
          reject(new Error("Cancelled"));
          return;
        }

        const arrayBuffer = await f.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
        });

        resolve(rows.slice(1).filter((r) => r.some((cell) => cell !== "")));
      };

      // If the user cancels the native file picker, no 'change' fires and
      // we never resolve/reject — acceptable for this flow, but note it.
      input.click();
    });
  }

  const DocumentPicker = await import("expo-document-picker");
  const { File } = await import("expo-file-system");

  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
    copyToCacheDirectory: true,
  });

  if (result.canceled) {
    throw new Error("Cancelled");
  }

  const asset = result.assets[0];
  const file = new File(asset.uri);
  const bytes = file.bytes();

  const workbook = XLSX.read(bytes, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  return rows.slice(1).filter((r) => r.some((cell) => cell !== ""));
}

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}