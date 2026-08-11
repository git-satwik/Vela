# Vela — The Confidential Coordination & Funding Stack

> Anonymous identity signaling and gasless private payouts for on-chain communities.

## Problem

Public governance and payout flows leak two things that get people hurt:

1. **Voter retaliation.** On-chain votes are tied to a wallet address forever.
   Anyone can see how you voted and act on it — socially, financially, or
   through targeted retaliation — long after the vote closes.
2. **Public gas-payer address leakage.** Even a "private" vote reveals the
   caller's address the moment they submit the transaction, since `msg.sender`
   pays gas and is logged on-chain regardless of what the proof itself hides.

## Solution

Vela separates **eligibility**, **identity**, and **transaction submission**
into three decoupled layers:

- **Semaphore v4** proves group membership and casts a signal without
  revealing which member did it.
- A **gasless relayer** submits the transaction on the voter's behalf, so the
  address that pays gas is never the voter's wallet.
- **Kohaku** routes privacy-sensitive RPC calls through a provider
  abstraction instead of the wallet's default endpoint.

## Privacy Technologies Used

### Semaphore v4 (Zero-Knowledge Signaling)
Each proposal gets its own Semaphore group (`groupId`). A member proves, via
a zk-SNARK, that:
- their identity commitment is in the group's Merkle tree (depth pinned to
  **12** to match the compiled circuit artifacts), and
- they haven't voted on this proposal before (via the proof's `nullifier`,
  derived from the identity + `scope`), and
- their message (the vote option) is authentic.

The contract checks `proof.scope == groupId` before calling
`semaphore.validateProof()`, which prevents a proof generated for one
proposal from being replayed on another. Nullifiers are tracked per-group
on-chain to block double-voting — all without ever learning *which* group
member cast the vote.

### Gasless Relayer (ERC-4337 / EIP-712 style execution)
The frontend never submits the vote transaction directly. Instead it:
1. Generates the ZK proof client-side.
2. POSTs the serialized proof to `server/relay.js`.
3. The relayer runs `verifyProof()` **off-chain first**, so an invalid or
   malformed proof is rejected before any gas is spent.
4. Only a valid proof gets forwarded on-chain, paid for by the relayer
   wallet — decoupling the voter's address from the gas-payer address
   entirely.

### Kohaku Integration
`src/kohakuProvider.js` wraps `@kohaku-eth/provider` behind a single
`getPrivacyProvider()` interface so privacy-sensitive reads/writes route
through Kohaku's RPC abstraction rather than the wallet's default endpoint,
reducing RPC-level fingerprinting. The wrapper falls back to a standard
`ethers.JsonRpcProvider` if the package is unavailable, keeping the rest of
the app decoupled from the exact upstream API.

## Setup & Local Execution

### 1. Install dependencies
```bash
npm install
cd server && npm install && cd ..
```

### 2. Fetch circuit artifacts (depth-12)
```bash
mkdir -p public/zk
curl -L -o public/zk/semaphore-12.wasm \
  https://snark-artifacts.pse.dev/semaphore/v4.0.0/12/semaphore.wasm
curl -L -o public/zk/semaphore-12.zkey \
  https://snark-artifacts.pse.dev/semaphore/v4.0.0/12/semaphore.zkey
```

### 3. Configure environment
```bash
cp .env.example .env
# fill in SEPOLIA_RPC_URL, PRIVATE_KEY, SEMAPHORE_CONTRACT_ADDRESS,
# RELAYER_PRIVATE_KEY, VITE_GOVERNANCE_ADDRESS, etc.
```

### 4. Compile & deploy contracts
```bash
npm run compile
npm run deploy:sepolia
# copy the deployed address into GOVERNANCE_CONTRACT_ADDRESS and
# VITE_GOVERNANCE_ADDRESS in .env
```

### 5. Start the relayer
```bash
npm run relayer
# → Vela relayer listening on port 3001
```

### 6. Start the frontend
```bash
npm run dev
# → http://localhost:5173
```

## Flow Summary

1. Connect wallet → derive a deterministic Semaphore identity from a cached
   signature.
2. `join()` on-chain (eligibility-gated) to add the identity commitment to
   the group.
3. Rebuild the group's Merkle tree locally from `MemberJoined` events.
4. Generate a depth-12 ZK proof scoped to the proposal's `groupId`.
5. Submit the proof to the relayer, which verifies off-chain and pays gas
   to execute `vote()` on-chain — anonymously.
