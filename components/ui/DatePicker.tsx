import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
  Pressable,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { C as LightPalette, D as DarkPalette, R, fmtDate, type Palette } from "../../utils/theme";
import { useTheme, useThemeMode } from "../../hooks/useTheme";

interface DatePickerProps {
  label?: string;
  value: string;
  onChange: (isoDate: string) => void;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  error?: string;
  hint?: string;
}

export function DatePicker({
  label,
  value,
  onChange,
  placeholder = "Select date",
  minimumDate,
  maximumDate,
  error,
  hint,
}: DatePickerProps) {
  const C = useTheme();
  const mode = useThemeMode();
  const isDark = mode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const [showPicker, setShowPicker] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  const dateValue = draftValue
    ? new Date(`${draftValue}T12:00:00`)
    : new Date();

  const handleChange = (
    _event: any,
    selectedDate?: Date
  ) => {
    if (!selectedDate) return;

    const nextValue = selectedDate
      .toISOString()
      .split("T")[0];

    if (Platform.OS === "ios") {
      setDraftValue(nextValue);
    } else {
      setShowPicker(false);
      onChange(nextValue);
    }
  };

  const openPicker = () => {
    setDraftValue(value);
    setShowPicker(true);
  };

  const commitPicker = () => {
    setShowPicker(false);

    if (draftValue) {
      onChange(draftValue);
    }
  };

  const displayText = value
    ? fmtDate(value)
    : "";

  /*
   * WEB
   *
   * React Native Web does not need the native
   * DateTimePicker. Use the browser's date input.
   *
   * createElement keeps the raw DOM element out
   * of the React Native JSX tree.
   */
  if (Platform.OS === "web") {
    const WebDateInput = React.createElement(
      "input",
      {
        type: "date",
        value: value || "",
        min: minimumDate
          ? minimumDate
              .toISOString()
              .split("T")[0]
          : undefined,
        max: maximumDate
          ? maximumDate
              .toISOString()
              .split("T")[0]
          : undefined,
        onChange: (event: any) => {
          onChange(event?.target?.value || "");
        },
        style: {
          flex: 1,
          minWidth: 0,
          width: "100%",
          height: 46,
          border: "none",
          outline: "none",
          background: "transparent",
          color: value
            ? C.text
            : C.text3,
          colorScheme: isDark ? "dark" : "light",
          fontSize: 14,
          fontFamily: "inherit",
          cursor: "pointer",
          padding: 0,
        },
      }
    );

    return (
      <View style={styles.formGroup}>
        {!!label && (
          <Text style={styles.formLabel}>
            {label}
          </Text>
        )}

        <View
          style={[
            styles.inputWrap,
            !!error && styles.inputError,
          ]}
        >
          <Text style={styles.calendarIcon}>
            📅
          </Text>

          {WebDateInput}
        </View>

        {!!hint && !error && (
          <Text style={styles.inputHint}>
            {hint}
          </Text>
        )}

        {!!error && (
          <Text style={styles.inputErrorText}>
            {error}
          </Text>
        )}
      </View>
    );
  }

  /*
   * IOS + ANDROID
   */
  return (
    <View style={styles.formGroup}>
      {!!label && (
        <Text style={styles.formLabel}>
          {label}
        </Text>
      )}

      <TouchableOpacity
        style={[
          styles.inputWrap,
          !!error && styles.inputError,
        ]}
        onPress={openPicker}
        activeOpacity={0.7}
      >
        <Text style={styles.calendarIcon}>
          📅
        </Text>

        <Text
          style={[
            styles.input,
            {
              flex: 1,
              color: value
                ? C.text
                : C.text3,
            },
          ]}
        >
          {displayText || placeholder}
        </Text>

        <Text style={styles.arrow}>
          ▾
        </Text>
      </TouchableOpacity>

      {!!hint && !error && (
        <Text style={styles.inputHint}>
          {hint}
        </Text>
      )}

      {!!error && (
        <Text style={styles.inputErrorText}>
          {error}
        </Text>
      )}

      {showPicker &&
        Platform.OS === "ios" && (
          <Modal
            transparent
            animationType="slide"
            onRequestClose={() =>
              setShowPicker(false)
            }
          >
            <Pressable
              style={styles.modalOverlay}
              onPress={() =>
                setShowPicker(false)
              }
            >
              <Pressable
                style={styles.pickerSheet}
                onPress={(e) =>
                  e.stopPropagation()
                }
              >
                <View
                  style={styles.pickerHeader}
                >
                  <TouchableOpacity
                    onPress={commitPicker}
                  >
                    <Text
                      style={styles.pickerDone}
                    >
                      Done
                    </Text>
                  </TouchableOpacity>
                </View>

                <View
                  style={styles.iosSpinnerWrap}
                >
                  <DateTimePicker
                    value={dateValue}
                    mode="date"
                    display="spinner"
                    onChange={handleChange}
                    minimumDate={minimumDate}
                    maximumDate={maximumDate}
                    textColor={C.text}
                    themeVariant="light"
                    style={styles.iosSpinner}
                  />
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        )}

      {showPicker &&
        Platform.OS === "android" && (
          <DateTimePicker
            value={dateValue}
            mode="date"
            display="default"
            onChange={handleChange}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
          />
        )}
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  formGroup: {
    marginBottom: 16,
  },

  formLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text2,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },

  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: 14,
    minHeight: 50,
    position: "relative",
  },

  inputError: {
    borderColor: C.error,
  },

  calendarIcon: {
    fontSize: 14,
    marginRight: 8,
  },

  input: {
    fontSize: 14,
    paddingVertical: 12,
    color: C.text,
  },

  arrow: {
    color: C.text3,
    fontSize: 11,
    marginLeft: 4,
  },

  inputHint: {
    fontSize: 11,
    color: C.text3,
    marginTop: 4,
  },

  inputErrorText: {
    fontSize: 11,
    color: C.error,
    marginTop: 4,
    fontWeight: "500",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor:
      "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },

  pickerSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    paddingBottom: 32,
  },

  pickerHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  pickerDone: {
    fontSize: 16,
    fontWeight: "700",
    color: C.accent,
  },

  iosSpinnerWrap: {
    height: 216,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  iosSpinner: {
    height: 216,
    width: "100%",
  },
});

const lightStyles = makeStyles(LightPalette);
const darkStyles = makeStyles(DarkPalette);