import { Share, Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";

export async function exportFullData(data: any, filename: string) {
  const jsonStr = JSON.stringify(data, null, 2);
  if (Platform.OS === "web") {
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } else {
    try {
      const fileUri = `${FileSystem.cacheDirectory}${filename}.json`;
      await FileSystem.writeAsStringAsync(fileUri, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });
      await Share.share({ title: filename, url: fileUri });
    } catch (e) {
      console.warn("Export failed:", e);
      throw e;
    }
  }
}

export async function importFullData(): Promise<any> {
  if (Platform.OS === "web") {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = (e: any) => {
        const file = e.target.files[0];
        if (!file) {
          reject(new Error("No file selected"));
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            resolve(JSON.parse(ev.target?.result as string));
          } catch (err) {
            reject(new Error("Invalid JSON file"));
          }
        };
        reader.onerror = () => reject(new Error("File read error"));
        reader.readAsText(file);
      };
      input.click();
    });
  } else {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/plain", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) throw new Error("Cancelled");
      const fileUri = result.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.UTF8 });
      return JSON.parse(content);
    } catch (e) {
      console.warn("Import failed:", e);
      throw e;
    }
  }
}
