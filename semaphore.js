import { Identity, Group, generateProof } from "@semaphore-protocol/core";

const MERKLE_DEPTH = 12;
const WASM_PATH = "/zk/semaphore-12.wasm";
const ZKEY_PATH = "/zk/semaphore-12.zkey";
const IDENTITY_CACHE_KEY = "vela:semaphore:identity-signature";

/**
 * Derives a deterministic Semaphore Identity from a wallet signature.
 * The signature is cached in localStorage so the user signs once per
 * browser/device and the same identity is recovered across sessions.
 */
export async function getOrCreateIdentity(signer) {
  const address = await signer.getAddress();
  const cacheKey = `${IDENTITY_CACHE_KEY}:${address.toLowerCase()}`;

  let signature = localStorage.getItem(cacheKey);

  if (!signature) {
    const message = `Vela Identity Derivation\nAddress: ${address}\nThis signature never leaves your device and costs no gas.`;
    signature = await signer.signMessage(message);
    localStorage.setItem(cacheKey, signature);
  }

  return new Identity(signature);
}

export function clearCachedIdentity(address) {
  localStorage.removeItem(`${IDENTITY_CACHE_KEY}:${address.toLowerCase()}`);
}

// Many public/free RPC endpoints (Infura, Alchemy free tier, public Sepolia
// RPCs) reject eth_getLogs queries with an unbounded block range starting
// at 0 (JSON-RPC error -32602 "Invalid Params"). Query from the contract's
// deployment block instead of genesis, in chunks bounded by MAX_LOG_RANGE.
const MAX_LOG_RANGE = 9_000; // stay under the common ~10k-block provider cap
const DEPLOY_BLOCK = Number(import.meta.env.VITE_GOVERNANCE_DEPLOY_BLOCK || 0);

/**
 * Rebuilds the Semaphore group Merkle tree locally from on-chain
 * MemberJoined events, pinned to depth 12 to match the circuit artifacts.
 */
export async function buildGroup(governanceContract, groupId) {
  const provider = governanceContract.runner.provider;
  const latestBlock = await provider.getBlockNumber();
  const filter = governanceContract.filters.MemberJoined(groupId);

  const allEvents = [];
  for (let from = DEPLOY_BLOCK; from <= latestBlock; from += MAX_LOG_RANGE + 1) {
    const to = Math.min(from + MAX_LOG_RANGE, latestBlock);
    const chunk = await governanceContract.queryFilter(filter, from, to);
    allEvents.push(...chunk);
  }

  const commitments = allEvents
    .sort((a, b) => a.blockNumber - b.blockNumber)
    .map((e) => e.args.identityCommitment.toString());

  const group = new Group(commitments);

  if (group.depth > MERKLE_DEPTH) {
    throw new Error(
      `Group depth (${group.depth}) exceeds pinned circuit depth (${MERKLE_DEPTH}). Regenerate artifacts for a larger tree.`
    );
  }

  return group;
}

/**
 * Generates a Semaphore v4 proof scoped to a specific proposal/group,
 * encoding the vote option as the proof's public `message`.
 */
export async function voteProof(identity, group, { groupId, voteOption }) {
  const scope = BigInt(groupId);
  const message = BigInt(voteOption);

  return generateProof(identity, group, message, scope, MERKLE_DEPTH, {
    wasm: WASM_PATH,
    zkey: ZKEY_PATH,
  });
}

/** Serializes a proof's BigInt fields into a JSON-safe payload for the relayer API. */
export function serializeProof(proof) {
  return JSON.parse(
    JSON.stringify(proof, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  );
}

export const config = { MERKLE_DEPTH, WASM_PATH, ZKEY_PATH };
