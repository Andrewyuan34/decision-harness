export class HarnessError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const MAX_BYTES = 5 * 1024 * 1024;
export function parseJson(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new HarnessError('INPUT_TOO_LARGE', 'Input exceeds 5 MiB.');
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''), (key, value) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`Forbidden key: ${key}`);
      return value;
    });
  } catch (error) {
    throw new HarnessError('INVALID_JSON', `Invalid JSON: ${error.message}`);
  }
}

export function validId(id) {
  return typeof id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(id);
}
