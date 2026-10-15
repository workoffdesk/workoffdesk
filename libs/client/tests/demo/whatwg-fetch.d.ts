// React Native's fetch polyfill ships no types; its Response stands in for the global one.
declare module 'whatwg-fetch' {
  export const Response: typeof globalThis.Response;
}
