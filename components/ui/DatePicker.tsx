import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  Modal, Pressable,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors, R, S, fmtDate } from '../../utils/theme';

interface DatePickerProps {
  label?: string;
  value: string; // ISO date string or ''
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
  placeholder = 'Select date',
  minimumDate,
  maximumDate,
  error,
  hint,
}: DatePickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const dateValue = draftValue ? new Date(`${draftValue}T12:00:00`) : new Date();

  const handleChange = (_event: any, selectedDate?: Date) => {
    if (!selectedDate) return;
    const nextValue = selectedDate.toISOString().split('T')[0];
    if (Platform.OS === 'ios') {
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
    if (draftValue) onChange(draftValue);
  };

  const displayText = value ? fmtDate(value) : '';

  if (Platform.OS === 'web') {
    return (
      <View style={styles.formGroup}>
        {label && <Text style={styles.formLabel}>{label}</Text>}
        <View style={[styles.inputWrap, !!error && styles.inputError]}>
          <Text style={{ fontSize: 14, marginRight: 8 }}>📅</Text>
          {/* Browser date input provides the native calendar on web. */}
          <input
            type="date"
            value={value || ''}
            onChange={(e: any) => {
              onChange(e.target.value || '');
            }}
            min={minimumDate ? minimumDate.toISOString().split('T')[0] : undefined}
            max={maximumDate ? maximumDate.toISOString().split('T')[0] : undefined}
            style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none',
              background: 'transparent', color: value ? Colors.text : Colors.text3,
              fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
            }}
          />
        </View>
        {hint && !error && <Text style={styles.inputHint}>{hint}</Text>}
        {error && <Text style={styles.inputErrorText}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.formGroup}>
      {label && <Text style={styles.formLabel}>{label}</Text>}
      <TouchableOpacity
        style={[styles.inputWrap, !!error && styles.inputError]}
        onPress={openPicker}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: 14, marginRight: 8 }}>📅</Text>
        <Text style={[styles.input, { flex: 1, color: value ? Colors.text : Colors.text3 }]}>
          {displayText || placeholder}
        </Text>
        <Text style={{ color: Colors.text3, fontSize: 11, marginLeft: 4 }}>▾</Text>
      </TouchableOpacity>
      {hint && !error && <Text style={styles.inputHint}>{hint}</Text>}
      {error && <Text style={styles.inputErrorText}>{error}</Text>}

      {/* iOS: show in modal; Android: inline */}
      {showPicker && Platform.OS === 'ios' && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowPicker(false)}>
            <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.pickerHeader}>
                  <TouchableOpacity onPress={commitPicker}>
                  <Text style={styles.pickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                onChange={handleChange}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                style={{ width: '100%' as any }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
      {showPicker && Platform.OS === 'android' && (
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

const styles = StyleSheet.create({
  formGroup: { marginBottom: 16 },
  formLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.text2,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8,
  },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: R.md, paddingHorizontal: 14, minHeight: 50,
    position: 'relative',
  },
  inputError: { borderColor: Colors.error },
  input: { fontSize: 14, paddingVertical: 12, color: Colors.text },
  inputHint: { fontSize: 11, color: Colors.text3, marginTop: 4 },
  inputErrorText: { fontSize: 11, color: Colors.error, marginTop: 4, fontWeight: '500' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(15,31,51,0.5)', justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    paddingBottom: 32,
  },
  pickerHeader: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  pickerDone: { fontSize: 16, fontWeight: '700', color: Colors.accent },
  webInputWrap: { paddingVertical: 0 },
});
