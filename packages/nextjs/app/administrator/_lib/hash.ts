import { type Hex, keccak256, toHex } from "viem";

/**
 * Solidity uses keccak256(toUtf8Bytes(label)) to derive bytes32 ids.
 * Indexer + Oracle hash strings the same way (see indexer.js SKILL_LABELS).
 */
export const hashLabel = (label: string): Hex => keccak256(toHex(label));

/**
 * metadataCID is stored on-chain as bytes32 (the SHA-256 digest). The /metadata/pin
 * endpoint returns either a "0x..." 32-byte hex string OR a multibase ipfs CID.
 * We accept both shapes and normalise to bytes32; users can also paste manually.
 */
export const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

export const toBytes32 = (input: string | undefined | null): Hex => {
  if (!input) return ZERO_BYTES32;
  const trimmed = input.trim();
  if (trimmed === "") return ZERO_BYTES32;
  // Already 0x-prefixed 32-byte hex
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed as Hex;
  // 0x... shorter — left-pad to 32 bytes
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    const body = trimmed.slice(2).padStart(64, "0").slice(-64);
    return `0x${body}` as Hex;
  }
  // Otherwise hash the string (safe fallback for the demo)
  return hashLabel(trimmed);
};
