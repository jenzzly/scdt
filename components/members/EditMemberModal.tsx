// components/members/EditMemberModal.tsx
//
// Shared profile-edit form. Two modes:
//
//   mode="self"   — the signed-in user editing their own profile.
//                   Email is read-only (admin-only field); adds the
//                   self-service fields (national ID, address,
//                   language). Callers save via updateOwnProfile.
//
//   mode="admin"  — an admin editing another member. Email is
//                   editable, role is offered as a picker. Callers
//                   save via FS.updateMember.
//
// The modal owns its own form state, seeded from `initialValues` each
// time it opens. Callers pass the current member's values and receive
// the edited values via onSave(values).

import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { BottomModal, Input, Select, Button } from "../ui";
import { S } from "../../utils/theme";

export interface EditMemberFormValues {
  fullName: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  physicalAddress?: string;
  languagePreference?: string;
  role?: string;
}

const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Français", value: "fr" },
  { label: "Kinyarwanda", value: "rw" },
];

export function EditMemberModal({
  visible,
  onClose,
  mode,
  initialValues,
  roleOptions,
  saving,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  mode: "self" | "admin";
  initialValues: EditMemberFormValues;
  roleOptions?: { label: string; value: string }[];
  saving: boolean;
  onSave: (values: EditMemberFormValues) => void | Promise<void>;
}) {
  const isSelf = mode === "self";

  const [values, setValues] = useState<EditMemberFormValues>(initialValues);

  // Seed on each open. The ref keeps the LATEST initialValues without
  // re-triggering the effect on every parent render — the reset only
  // happens when `visible` flips.
  const initialRef = useRef(initialValues);
  initialRef.current = initialValues;
  useEffect(() => {
    if (visible) setValues(initialRef.current);
  }, [visible]);

  const update = <K extends keyof EditMemberFormValues>(
    key: K,
    value: EditMemberFormValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    if (!values.fullName.trim()) return;
    onSave(values);
  };

  return (
    <BottomModal
      visible={visible}
      onClose={onClose}
      title={isSelf ? "Edit My Profile" : "Edit Member"}
    >
      <View style={{ padding: S.lg, gap: 12, paddingBottom: 32 }}>
        <Input
          label="Full Name *"
          value={values.fullName}
          onChangeText={(v) => update("fullName", v)}
          placeholder="Full name"
        />

        <Input
          label="Email"
          value={values.email ?? ""}
          onChangeText={(v) => update("email", v)}
          placeholder="Email address"
          keyboardType="email-address"
          editable={!isSelf}
          hint={isSelf ? "Email can only be changed by an admin" : undefined}
        />

        <Input
          label="Phone"
          value={values.phone ?? ""}
          onChangeText={(v) => update("phone", v)}
          placeholder="Phone number"
          keyboardType="phone-pad"
        />

        {isSelf && (
          <>
            <Input
              label="National ID"
              value={values.nationalId ?? ""}
              onChangeText={(v) => update("nationalId", v)}
              placeholder="National ID"
            />
            <Input
              label="Physical Address"
              value={values.physicalAddress ?? ""}
              onChangeText={(v) => update("physicalAddress", v)}
              placeholder="Address"
            />
            <Select
              label="Language"
              value={values.languagePreference ?? "en"}
              options={LANGUAGE_OPTIONS}
              onChange={(v) => update("languagePreference", String(v))}
            />
          </>
        )}

        {!isSelf && roleOptions && (
          <Select
            label="Role"
            value={values.role ?? "member"}
            options={roleOptions}
            onChange={(v) => update("role", String(v))}
          />
        )}

        <Button
          label="Save Changes"
          onPress={handleSave}
          fullWidth
          loading={saving}
          size="lg"
          disabled={!values.fullName.trim()}
        />
      </View>
    </BottomModal>
  );
}
