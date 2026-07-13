if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {}, browser: true };
}
export {};
