// Everything the voice assistant does is logged to the console with a [voice] prefix, so you can follow
// it in the browser console (F12) or the Metro terminal. Never log the voice service key or tokens.
export const voiceLog = (...args: unknown[]) => console.log('[voice]', ...args);
export const voiceWarn = (...args: unknown[]) => console.warn('[voice]', ...args);
