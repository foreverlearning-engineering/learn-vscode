// Checks what the developer pastes into "Learn: Set API key". The key's format is not documented,
// so this checks only what any key must be: one unbroken run of visible characters.
export type KeyCheck = { ok: true; key: string } | { ok: false; message: string };

export function checkKey(input: string): KeyCheck {
  const key = input.trim();
  if (key === '') return { ok: false, message: 'Paste your server key from My APIs in the developer console.' };
  if (key.length > 512) return { ok: false, message: 'That is longer than a server key.' };
  if (/\s/.test(key)) return { ok: false, message: 'A server key has no spaces or line breaks.' };
  if (!/^[\x21-\x7e]+$/.test(key)) return { ok: false, message: 'A server key has only letters, digits and symbols.' };
  return { ok: true, key };
}

// Removes the key, and anything shaped like a Learn server key, from text bound for a log.
export function redact(text: string, key?: string | null): string {
  let out = text;
  if (key) out = out.split(key).join('<redacted-key>');
  return out.replace(/fl_(?:live|stag|test)_[0-9a-f]{16,}(?:_[0-9a-f]+)?/gi, '<redacted-key>');
}
