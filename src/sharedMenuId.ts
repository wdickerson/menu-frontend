export function isSharedMenuId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 14 && /^[A-Za-z0-9_-]{14}$/.test(value);
}