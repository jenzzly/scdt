// components/ui/BottomModal.tsx (if it exists)
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator, RefreshControl, Modal, useWindowDimensions, Switch, TextInput,
} from "react-native";
import { C } from "../../utils/theme";
export function BottomModal({ visible, onClose, title, children }: any) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
        <View style={{ backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%" }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ fontSize: 18, fontWeight: "700", textAlign: "center" }}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={{ position: "absolute", right: 16, top: 16 }}>
              <Text style={{ fontSize: 20 }}>✕</Text>
            </TouchableOpacity>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}