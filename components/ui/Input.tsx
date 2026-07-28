// components/ui/Input.tsx
import React, { forwardRef } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Colors, S, R } from "../../utils/theme";

// Allows arbitrary extra props to pass through to TextInput without TS errors
// while still providing typed intellisense for all known props.
type InputProps = {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "phone-pad" | "decimal-pad" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: string;
  autoCorrect?: boolean;
  returnKeyType?: "done" | "go" | "next" | "search" | "send";
  onSubmitEditing?: () => void;
  onKeyPress?: (e: any) => void;
  leftIcon?: string;
  right?: React.ReactNode;
  editable?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  hint?: string;
  error?: string;
  prefix?: string;
  clearButtonMode?: "never" | "while-editing" | "unless-editing" | "always";
  containerStyle?: any;
  style?: any;
  inputStyle?: any;
  testID?: string;
  [key: string]: any; // passthrough for extra TextInput props
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Input = forwardRef<TextInput, any>(({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = "default",
  autoCapitalize = "none",
  autoComplete,
  returnKeyType = "done",
  onSubmitEditing,
  onKeyPress,
  leftIcon,
  right,
  editable = true,
  multiline = false,
  numberOfLines = 1,
  hint,
  error,
  prefix,
  containerStyle,
  autoCorrect,
  clearButtonMode,
  style,
  inputStyle,
  testID,
}, ref) => {
  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputWrapper, error && styles.inputWrapperError, !editable && styles.inputWrapperDisabled]}>
        {leftIcon && <Text style={styles.leftIcon}>{leftIcon}</Text>}
        {prefix && <Text style={styles.prefix}>{prefix}</Text>}
        <TextInput
          ref={ref}
          testID={testID}
          style={[
            styles.input,
            leftIcon && styles.inputWithLeftIcon,
            prefix && styles.inputWithPrefix,
            multiline && styles.inputMultiline,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.text3}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          clearButtonMode={clearButtonMode}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onKeyPress={onKeyPress}
          editable={editable}
          multiline={multiline}
          numberOfLines={multiline ? numberOfLines : 1}
          textAlignVertical={multiline ? "top" : "center"}
        />
        {right && <View style={styles.rightIcon}>{right}</View>}
      </View>
      {hint && !error && <Text style={styles.hint}>{hint}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
});

Input.displayName = "Input";

const styles = StyleSheet.create({
  container: {
    marginBottom: S.md,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.text2,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: R.md,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  inputWrapperError: {
    borderColor: Colors.error,
  },
  inputWrapperDisabled: {
    backgroundColor: Colors.elevated,
    opacity: 0.7,
  },
  leftIcon: {
    fontSize: 16,
    paddingLeft: 12,
    color: Colors.text3,
  },
  prefix: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.text,
    paddingLeft: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    paddingHorizontal: 12,
  },
  inputWithLeftIcon: {
    paddingLeft: 8,
  },
  inputWithPrefix: {
    paddingLeft: 4,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  rightIcon: {
    paddingRight: 12,
  },
  hint: {
    fontSize: 10,
    color: Colors.text3,
    marginTop: 4,
    marginLeft: 4,
  },
  error: {
    fontSize: 10,
    color: Colors.error,
    marginTop: 4,
    marginLeft: 4,
  },
});