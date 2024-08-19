const stringToU8Array = (str) => new TextEncoder().encode(str);
const base64ToU8Array = (str) => Uint8Array.from(Buffer.from(str, 'base64'));
export { base64ToU8Array, stringToU8Array };
//# sourceMappingURL=util.js.map