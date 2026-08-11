require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const { verifyProof } = require("@semaphore-protocol/core");

const PORT = process.env.RELAYER_PORT || 3001;
const RPC_URL = process.env.SEPOLIA_RPC_URL;
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const GOVERNANCE_ADDRESS = process.env.GOVERNANCE_CONTRACT_ADDRESS;

const GOVERNANCE_ABI = [
  "function vote(uint256 proposalId, uint256 voteOption, (uint256 merkleTreeDepth,uint256 merkleTreeRoot,uint256 nullifier,uint256 message,uint256 scope,uint256[8] points) proof) external",
  "function join(uint256 proposalId, uint256 identityCommitment) external",
];

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const provider = new ethers.JsonRpcProvider(RPC_URL);
const relayerWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
const governance = new ethers.Contract(GOVERNANCE_ADDRESS, GOVERNANCE_ABI, relayerWallet);

// BigInt-safe JSON serialization for HTTP responses.
function toJSONSafe(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  );
}

// Normalizes the incoming (string-encoded) proof payload into the shape
// @semaphore-protocol/core.verifyProof and the on-chain ABI both expect.
function normalizeProof(rawProof) {
  return {
    merkleTreeDepth: Number(rawProof.merkleTreeDepth),
    merkleTreeRoot: rawProof.merkleTreeRoot.toString(),
    nullifier: rawProof.nullifier.toString(),
    message: rawProof.message.toString(),
    scope: rawProof.scope.toString(),
    points: rawProof.points.map((p) => p.toString()),
  };
}

app.post("/relay/vote", async (req, res) => {
  try {
    const { proposalId, voteOption, proof } = req.body;
    if (proposalId === undefined || voteOption === undefined || !proof) {
      return res.status(400).json({ ok: false, error: "Missing proposalId, voteOption, or proof" });
    }

    const normalized = normalizeProof(proof);

    // Off-chain verification first — avoids paying gas for a reverting tx
    // when a malformed or invalid proof is submitted by a client.
    const isValid = await verifyProof(normalized);
    if (!isValid) {
      return res.status(400).json({ ok: false, error: "Proof failed off-chain verification" });
    }

    const tx = await governance.vote(proposalId, voteOption, normalized);
    const receipt = await tx.wait();

    return res.status(200).json(
      toJSONSafe({
        ok: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      })
    );
  } catch (err) {
    console.error("[relay/vote] error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Relay failed" });
  }
});

app.get("/relay/health", async (_req, res) => {
  const balance = await provider.getBalance(relayerWallet.address);
  res.json(toJSONSafe({ ok: true, relayer: relayerWallet.address, balanceWei: balance }));
});

app.listen(PORT, () => {
  console.log(`Vela relayer listening on port ${PORT}`);
  console.log(`Relayer address: ${relayerWallet.address}`);
});
