/** Input hardening. Every string that enters room state passes through here. */

const SCRIPTISH_BLOCK = /<(script|style|iframe|object|embed)[\s\S]*?(<\/\1>|$)/gi;
const TAG = /<\/?[a-z][^>]*>/gi;
const DANGEROUS_SCHEME = /\b(javascript|vbscript|data)\s*:/gi;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Removes markup, dangerous URL schemes and control characters, collapses
 * whitespace and truncates. The client additionally renders through
 * textContent, so this is defence in depth rather than the only defence.
 */
export function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  let value = input.normalize('NFC');
  value = value.replace(CONTROL_CHARS, ' ');
  value = value.replace(SCRIPTISH_BLOCK, ' ');
  value = value.replace(TAG, ' ');
  value = value.replace(DANGEROUS_SCHEME, ' ');
  value = value.replace(/[<>]/g, '');
  value = value.replace(/\r\n?/g, '\n');
  value = value.replace(/\n{3,}/g, '\n\n');
  value = value.replace(/[ \t\u00A0]{2,}/g, ' ');
  value = value.trim();
  if (value.length > maxLength) value = value.slice(0, maxLength).trim();
  return value;
}

/** Same as sanitizeText but also flattens newlines - for single-line fields. */
export function sanitizeLine(input: unknown, maxLength: number): string {
  return sanitizeText(input, maxLength).replace(/\s*\n+\s*/g, ' ').trim();
}

export function clampInt(input: unknown, min: number, max: number, fallback: number): number {
  const n = typeof input === 'number' ? input : Number.parseInt(String(input ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown, maxItems: number): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems);
}

/** Normalises a player name for duplicate detection (case/space insensitive). */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
