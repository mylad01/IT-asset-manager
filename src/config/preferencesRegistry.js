/**
 * Re-export shim: the preferences registry was PROMOTED to the shared/
 * tree (PLAN.MD §13 P4 layering fix — the server used to import UP into
 * src/, which doctor check #12 forbids). src/ keeps importing from the
 * same relative path it always had; the shared module is the single
 * source of truth (server/ + scripts/ now import it from ../../shared/).
 */
export * from '../../shared/preferencesRegistry.js';
export { default } from '../../shared/preferencesRegistry.js';
