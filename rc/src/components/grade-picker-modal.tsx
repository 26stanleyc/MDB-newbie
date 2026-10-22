import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import type { VGrade } from '@/api';
import { V_GRADES } from '@/lib/grades';
import { Radius, Spacing, useThemeColors } from '@/theme';

type Props = {
  visible: boolean;
  current?: VGrade;
  onClose: () => void;
  onSubmit: (grade: VGrade) => Promise<void>;
};

export function GradePickerModal({ visible, current, onClose, onSubmit }: Props) {
  const c = useThemeColors();
  const [selected, setSelected] = useState<VGrade | undefined>(current);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await onSubmit(selected);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
      <View style={[styles.sheet, { backgroundColor: c.background }]}>
        <Text variant="heading" style={styles.title}>
          Grade this route
        </Text>
        <Text tone="secondary" style={styles.subtitle}>
          V-scale. Your vote joins the community grade.
        </Text>

        <ScrollView contentContainerStyle={styles.grid}>
          {V_GRADES.map((g) => {
            const active = g === selected;
            return (
              <Pressable
                key={g}
                onPress={() => setSelected(g)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  { borderColor: active ? c.accent : c.border, backgroundColor: active ? c.accent : c.surface },
                ]}
              >
                <Text variant="label" color={active ? c.onAccent : c.text}>
                  {g}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Button title="Submit grade" onPress={submit} disabled={!selected} loading={saving} />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    maxHeight: '70%',
  },
  title: {},
  subtitle: { marginBottom: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingVertical: Spacing.sm },
  chip: {
    minWidth: 56,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  footer: { gap: Spacing.sm, marginTop: Spacing.sm },
});
