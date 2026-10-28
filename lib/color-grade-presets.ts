/**
 * Named color-grade looks saved by the user.
 *
 * Grades are small (nine numbers), so localStorage is enough. Storage is
 * best-effort: private browsing or a full quota degrades to an in-memory list
 * for the session and must never break the editor.
 */

import {
  isNeutralColorGrade,
  sanitizeColorGrade,
  type ColorGrade,
} from "@/lib/color-grade";

export const COLOR_PRESETS_STORAGE_KEY =
  "fatahtech-subtitles:color-grade-presets:v1";
export const MAX_CUSTOM_COLOR_PRESETS = 20;
export const MAX_COLOR_PRESET_NAME_LENGTH = 32;

export interface CustomColorPreset {
  id: string;
  name: string;
  grade: ColorGrade;
  createdAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_COLOR_PRESET_NAME_LENGTH);
}

export function validateColorPresetName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give this look a name.";
  if (trimmed.length > MAX_COLOR_PRESET_NAME_LENGTH) {
    return `Use ${MAX_COLOR_PRESET_NAME_LENGTH} characters or fewer.`;
  }
  return null;
}

function parseEntry(value: unknown): CustomColorPreset | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const rawName = typeof value.name === "string" ? value.name : "";
  const name = normalizeName(rawName);
  const createdAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? value.createdAt
      : 0;
  if (!id || !name) return null;
  const grade = sanitizeColorGrade(value.grade);
  if (isNeutralColorGrade(grade)) return null;
  return { id, name, grade, createdAt };
}

/**
 * Parse a stored list. Invalid entries are dropped rather than failing the
 * whole read, and one look per name is kept (first wins).
 */
export function parseCustomColorPresets(
  raw: string | null,
): CustomColorPreset[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const presets: CustomColorPreset[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const value of parsed) {
    const entry = parseEntry(value);
    if (!entry) continue;
    const nameKey = entry.name.toLowerCase();
    if (seenIds.has(entry.id) || seenNames.has(nameKey)) continue;
    seenIds.add(entry.id);
    seenNames.add(nameKey);
    presets.push(entry);
    if (presets.length >= MAX_CUSTOM_COLOR_PRESETS) break;
  }
  return presets;
}

export function serializeCustomColorPresets(
  presets: readonly CustomColorPreset[],
): string {
  return JSON.stringify(
    presets.slice(0, MAX_CUSTOM_COLOR_PRESETS).map((preset) => ({
      id: preset.id,
      name: normalizeName(preset.name),
      grade: sanitizeColorGrade(preset.grade),
      createdAt: preset.createdAt,
    })),
  );
}

/**
 * Insert or replace a look. A case-insensitive name match replaces the old
 * entry so the list cannot fill with duplicates.
 */
export function upsertCustomColorPreset(
  presets: readonly CustomColorPreset[],
  entry: CustomColorPreset,
): CustomColorPreset[] {
  const name = normalizeName(entry.name);
  if (!name) return [...presets];
  const next: CustomColorPreset = {
    ...entry,
    name,
    grade: sanitizeColorGrade(entry.grade),
  };
  const nameKey = name.toLowerCase();
  const filtered = presets.filter(
    (preset) => preset.id !== next.id && preset.name.toLowerCase() !== nameKey,
  );
  return [next, ...filtered].slice(0, MAX_CUSTOM_COLOR_PRESETS);
}

export function createColorPresetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `look-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadCustomColorPresets(): CustomColorPreset[] {
  if (typeof window === "undefined") return [];
  try {
    return parseCustomColorPresets(
      window.localStorage.getItem(COLOR_PRESETS_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

export function persistCustomColorPresets(
  presets: readonly CustomColorPreset[],
): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      COLOR_PRESETS_STORAGE_KEY,
      serializeCustomColorPresets(presets),
    );
    return true;
  } catch {
    return false;
  }
}
