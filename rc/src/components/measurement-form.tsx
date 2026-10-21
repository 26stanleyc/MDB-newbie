import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Segmented, Text, TextField } from '@/components/ui';
import { cmToFtIn, ftInToCm, type UnitSystem } from '@/lib/units';
import { Spacing } from '@/theme';

const CM_PER_INCH = 2.54;

// Plausible human ranges; measurements are always emitted in cm.
const HEIGHT_CM = { min: 90, max: 250 };
const SPAN_CM = { min: 90, max: 260 };

export type Measurements = { heightCm: number; wingspanCm: number };

type Fields = { feet: string; inches: string; heightCm: string; span: string };

type Props = {
  unit: UnitSystem;
  onUnitChange: (unit: UnitSystem) => void;
  initial?: Measurements | null;
  /** Fires with valid cm measurements, or null while input is incomplete/invalid. */
  onChange: (value: Measurements | null) => void;
};

function fieldsFromCm(m: Measurements | null | undefined, unit: UnitSystem): Fields {
  const empty: Fields = { feet: '', inches: '', heightCm: '', span: '' };
  if (!m) return empty;
  if (unit === 'imperial') {
    const { feet, inches } = cmToFtIn(m.heightCm);
    return { feet: String(feet), inches: String(inches), heightCm: '', span: String(Math.round(m.wingspanCm / CM_PER_INCH)) };
  }
  return { feet: '', inches: '', heightCm: String(Math.round(m.heightCm)), span: String(Math.round(m.wingspanCm)) };
}

/** Best-effort cm from raw fields, ignoring range validity (used for unit conversion). */
function rawCm(f: Fields, unit: UnitSystem): { heightCm: number | null; wingspanCm: number | null } {
  const heightCm =
    unit === 'imperial'
      ? f.feet || f.inches
        ? ftInToCm(Number(f.feet) || 0, Number(f.inches) || 0)
        : null
      : f.heightCm
        ? Number(f.heightCm)
        : null;
  const wingspanCm = f.span
    ? unit === 'imperial'
      ? Math.round(Number(f.span) * CM_PER_INCH)
      : Number(f.span)
    : null;
  return { heightCm, wingspanCm };
}

export function MeasurementForm({ unit, onUnitChange, initial, onChange }: Props) {
  const [fields, setFields] = useState<Fields>(() => fieldsFromCm(initial, unit));

  const emit = (f: Fields) => {
    const { heightCm, wingspanCm } = rawCm(f, unit);
    const ok =
      heightCm !== null &&
      wingspanCm !== null &&
      heightCm >= HEIGHT_CM.min &&
      heightCm <= HEIGHT_CM.max &&
      wingspanCm >= SPAN_CM.min &&
      wingspanCm <= SPAN_CM.max;
    onChange(ok ? { heightCm, wingspanCm } : null);
  };

  const update = (patch: Partial<Fields>) => {
    const next = { ...fields, ...patch };
    setFields(next);
    emit(next);
  };

  const changeUnit = (nextUnit: UnitSystem) => {
    if (nextUnit === unit) return;
    const { heightCm, wingspanCm } = rawCm(fields, unit);
    setFields(
      fieldsFromCm(
        heightCm !== null && wingspanCm !== null ? { heightCm, wingspanCm } : null,
        nextUnit,
      ),
    );
    onUnitChange(nextUnit);
    // onChange is unaffected by unit (always cm); no need to re-emit here.
  };

  return (
    <View style={styles.wrap}>
      <Segmented
        options={[
          { label: 'ft / in', value: 'imperial' },
          { label: 'cm', value: 'metric' },
        ]}
        value={unit}
        onChange={changeUnit}
      />

      <View>
        <Text variant="label" tone="secondary" style={styles.heading}>
          Height
        </Text>
        {unit === 'imperial' ? (
          <View style={styles.row}>
            <TextField
              value={fields.feet}
              onChangeText={(feet) => update({ feet })}
              keyboardType="number-pad"
              placeholder="ft"
              style={styles.cell}
            />
            <TextField
              value={fields.inches}
              onChangeText={(inches) => update({ inches })}
              keyboardType="number-pad"
              placeholder="in"
              style={styles.cell}
            />
          </View>
        ) : (
          <TextField
            value={fields.heightCm}
            onChangeText={(heightCm) => update({ heightCm })}
            keyboardType="number-pad"
            placeholder="cm"
          />
        )}
      </View>

      <View>
        <Text variant="label" tone="secondary" style={styles.heading}>
          Wingspan
        </Text>
        <TextField
          value={fields.span}
          onChangeText={(span) => update({ span })}
          keyboardType="number-pad"
          placeholder={unit === 'imperial' ? 'in' : 'cm'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.lg },
  heading: { marginBottom: Spacing.xs, marginLeft: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.md },
  cell: { flex: 1 },
});
