// Loaded before anything else in main.tsx.
//
// This has to live in its own module: ES imports are evaluated before any
// statement in the importing file, so a polyfill written at the top of
// main.tsx still ran *after* the whole App -> utils/pdf -> pdfjs-dist chain
// had been evaluated. It happened to work only because pdfjs calls
// Promise.try at request time rather than at import time.

interface PromiseWithTry extends PromiseConstructor {
  try?<T>(fn: () => T | PromiseLike<T>): Promise<T>;
}

// Only when missing — Promise.try is standard and already present in current
// Chromium, and the shim below is not a faithful replacement (it does not
// forward arguments).
const PromiseCtor = globalThis.Promise as PromiseWithTry;
if (typeof PromiseCtor.try !== 'function') {
  PromiseCtor.try = function polyfilledTry<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(err);
    }
  };
}

export {};
