// Server-side mirror of src/config/preferencesRegistry.js (PLAN.MD §13 P1).
//
// The server deliberately does NOT import from src/ (CLAUDE.md layering: src
// talks HTTP only, server never reaches into the frontend). Instead this file
// mirrors the registry in zod, and scripts/testPreferencesRegistry.js asserts
// key/type/default parity between the two — a key added to the registry
// without its mirror fails that test, doctor-check style.
//
// updatePreferencesSchema in authValidator.js re-exports the derived schema so
// the existing PUT /api/auth/preferences route keeps validating through the
// same zod pipeline it always had.

import { z } from 'zod';

export const UI_PREFS_KEYS = ['theme', 'accent', 'glass', 'decor', 'toastBannersEnabled', 'density', 'fontScale', 'motion', 'performanceMode', 'pageSize', 'dateFormat', 'timeFormat', 'hideColumnTotals', 'reducedTransparency', 'alwaysFocusRings', 'largerTouchTargets'];
export const UI_PREFS_ENUMS = {
  theme: ['dark', 'midnight', 'ember', 'noir', 'aurora', 'slate', 'light', 'paper', 'matcha'],
  accent: ['default', 'indigo', 'violet', 'emerald', 'amber', 'rose'],
  glass: ['crystal', 'balanced', 'frosted'],
  decor: ['none', 'grain', 'aurora', 'glow'],
  density: ['compact', 'comfortable', 'spacious'],
  motion: ['full', 'reduced', 'off'],
  dateFormat: ['mdy', 'dmy', 'ymd'],
  timeFormat: ['12h', '24h'],
};
export const UI_PREFS_INTS = {
  fontScale: { min: 85, max: 125 },
  pageSize: { min: 10, max: 100 },
};
export const UI_PREFS_DEFAULTS = {
  theme: 'dark',
  accent: 'default',
  glass: 'balanced',
  decor: 'none',
  toastBannersEnabled: true,
  density: 'comfortable',
  fontScale: 100,
  motion: 'full',
  performanceMode: false,
  pageSize: 50,
  dateFormat: 'mdy',
  timeFormat: '12h',
  hideColumnTotals: false,
  reducedTransparency: false,
  alwaysFocusRings: false,
  largerTouchTargets: false,
};

// Partial by design: PUT /api/auth/preferences merges the payload into the
// stored blob, so every key is optional; unknown keys are stripped (zod
// default) so the stored object can never hold unregistered preferences.
// (The literals above stay plain-data by construction so
// scripts/testPreferencesRegistry.js can extract them without a zod
// import — keep them that way.)
export const uiPrefsUpdateSchema = z
  .object({
    theme: z.enum(UI_PREFS_ENUMS.theme).optional(),
    accent: z.enum(UI_PREFS_ENUMS.accent).optional(),
    glass: z.enum(UI_PREFS_ENUMS.glass).optional(),
    decor: z.enum(UI_PREFS_ENUMS.decor).optional(),
    toastBannersEnabled: z.boolean().optional(),
    density: z.enum(UI_PREFS_ENUMS.density).optional(),
    fontScale: z.number().int().min(UI_PREFS_INTS.fontScale.min).max(UI_PREFS_INTS.fontScale.max).optional(),
    motion: z.enum(UI_PREFS_ENUMS.motion).optional(),
    performanceMode: z.boolean().optional(),
    pageSize: z.number().int().min(UI_PREFS_INTS.pageSize.min).max(UI_PREFS_INTS.pageSize.max).optional(),
    dateFormat: z.enum(UI_PREFS_ENUMS.dateFormat).optional(),
    timeFormat: z.enum(UI_PREFS_ENUMS.timeFormat).optional(),
    hideColumnTotals: z.boolean().optional(),
    reducedTransparency: z.boolean().optional(),
    alwaysFocusRings: z.boolean().optional(),
    largerTouchTargets: z.boolean().optional(),
  })
  .strict();

export default uiPrefsUpdateSchema;
