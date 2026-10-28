import { useCallback, useEffect, useState } from "react";
import { isNeutralColorGrade, type ColorGrade } from "@/lib/color-grade";
import {
  createColorPresetId,
  loadCustomColorPresets,
  persistCustomColorPresets,
  upsertCustomColorPreset,
  validateColorPresetName,
  type CustomColorPreset,
} from "@/lib/color-grade-presets";

/** User-saved color looks, persisted to localStorage when available. */
export function useCustomColorPresets() {
  const [presets, setPresets] = useState<CustomColorPreset[]>(() =>
    loadCustomColorPresets(),
  );
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    persistCustomColorPresets(presets);
  }, [presets]);

  const save = useCallback((name: string, grade: ColorGrade): boolean => {
    const error = validateColorPresetName(name);
    if (error) {
      setNameError(error);
      return false;
    }
    if (isNeutralColorGrade(grade)) {
      setNameError("Adjust at least one control before saving a look.");
      return false;
    }
    const entry: CustomColorPreset = {
      id: createColorPresetId(),
      name: name.trim(),
      grade,
      createdAt: Date.now(),
    };
    setPresets((previous) => upsertCustomColorPreset(previous, entry));
    setNameError(null);
    return true;
  }, []);

  const remove = useCallback((id: string) => {
    setPresets((previous) => previous.filter((preset) => preset.id !== id));
    setNameError(null);
  }, []);

  const clearNameError = useCallback(() => setNameError(null), []);

  return { presets, save, remove, nameError, clearNameError };
}
