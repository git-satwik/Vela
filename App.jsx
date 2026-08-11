import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { getOrCreateIdentity, buildGroup, voteProof, serializeProof } from "./semaphore";

const GOVERNANCE_ADDRESS = import.meta.env.VITE_GOVERNANCE_ADDRESS;
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:3001";

const GOVERNANCE_ABI = [
  "function join(uint256 proposalId, uint256 identityCommitment) external",
  "function getProposal(uint256 proposalId) external view returns (tuple(uint256 groupId, string metadataURI, address creator, uint256 createdAt, bool active))",
  "function isEligible(uint256 groupId, address voter) external view returns (bool)",
  "event MemberJoined(uint256 indexed groupId, address indexed member, uint256 identityCommitment)",
  // Custom errors — without these, ethers can't decode revert reasons
  // and just reports "unknown custom error".
  "error NotEligible()",
  "error ProposalNotActive()",
  "error ScopeMismatch()",
  "error NullifierAlreadyUsed()",
  "error MessageMismatch()",
  "error NotProposalCreator()",
];

export default function App() {
  const [account, setAccount] = useState(null);
  const [signer, setSigner] = useState(null);
  const [proposalId, setProposalId] = useState("0");
  const [voteOption, setVoteOption] = useState("1");
  const [status, setStatus] = useState("idle");
  const [log, setLog] = useState([]);
  const [txHash, setTxHash] = useState(null);

  const appendLog = useCallback((line) => {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()}  ${line}`]);
  }, []);

  // Yields to the browser event loop so React can flush a paint (spinner
  // text) before a heavy step (proof generation) blocks the main thread.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const connectWallet = async () => {
    if (!window.ethereum) {
      appendLog("No injected wallet found.");
      return;
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const s = await provider.getSigner();
    const addr = await s.getAddress();
    setSigner(s);
    setAccount(addr);
    appendLog(`Connected: ${addr}`);
  };

  const joinGroup = async () => {
    if (!signer) return;
    setStatus("joining");
    await tick();

    try {
      const governance = new ethers.Contract(GOVERNANCE_ADDRESS, GOVERNANCE_ABI, signer);
      const proposal = await governance.getProposal(proposalId);

      const eligible = await governance.isEligible(proposal.groupId, account);
      if (!eligible) {
        appendLog(
          `Join blocked: ${account} is not on the eligible voter list for proposal ${proposalId}. Ask the proposal creator to include this address in eligibleVoters[] at createProposal() time.`
        );
        setStatus("error");
        return;
      }

      const identity = await getOrCreateIdentity(signer);
      const tx = await governance.join(proposalId, identity.commitment);
      appendLog(`Join tx submitted: ${tx.hash}`);
      await tx.wait();
      appendLog("Joined group. Identity commitment is now indistinguishable from other members.");
      setStatus("joined");
    } catch (err) {
      console.error(err);
      // err.reason / err.shortMessage surfaces the decoded custom error name
      // once the ABI above knows the error signatures.
      appendLog(`Join failed: ${err.reason || err.shortMessage || err.message}`);
      setStatus("error");
    }
  };

  const generateAndSubmitVote = async () => {
    if (!signer) return;
    setStatus("proving");
    await tick();

    try {
      const provider = signer.provider;
      const governance = new ethers.Contract(GOVERNANCE_ADDRESS, GOVERNANCE_ABI, provider);

      const identity = await getOrCreateIdentity(signer);
      const proposal = await governance.getProposal(proposalId);
      const groupId = proposal.groupId;

      const group = await buildGroup(governance, groupId);
      appendLog(`Local Merkle tree rebuilt (depth ${group.depth}, ${group.size} members).`);

      const proof = await voteProof(identity, group, { groupId, voteOption: Number(voteOption) });
      appendLog("ZK proof generated locally. Your wallet address never touches the proof payload.");

      setStatus("submitting");
      await tick();

      const res = await fetch(`${RELAYER_URL}/relay/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          voteOption: Number(voteOption),
          proof: serializeProof(proof),
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Relayer rejected the vote");

      setTxHash(data.txHash);
      appendLog(`Vote relayed. On-chain tx: ${data.txHash} (gas paid by relayer, not your wallet).`);
      setStatus("done");
    } catch (err) {
      console.error(err);
      appendLog(`Vote failed: ${err.message}`);
      setStatus("error");
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Vela</h1>
      <p style={{ opacity: 0.7 }}>Confidential Coordination &amp; Funding Stack</p>

      <section style={{ marginBottom: 24 }}>
        {account ? <p>Connected: <code>{account}</code></p> : <button onClick={connectWallet}>Connect Wallet</button>}
      </section>

      <section style={{ marginBottom: 24 }}>
        <label>
          Proposal ID{" "}
          <input value={proposalId} onChange={(e) => setProposalId(e.target.value)} style={{ width: 60 }} />
        </label>
        <button onClick={joinGroup} disabled={!signer || status === "joining"} style={{ marginLeft: 12 }}>
          {status === "joining" ? "Joining…" : "Join Group"}
        </button>
      </section>

      <section style={{ marginBottom: 24 }}>
        <label>
          Vote Option{" "}
          <select value={voteOption} onChange={(e) => setVoteOption(e.target.value)}>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </label>
        <button
          onClick={generateAndSubmitVote}
          disabled={!signer || status === "proving" || status === "submitting"}
          style={{ marginLeft: 12 }}
        >
          {status === "proving" ? "Generating Proof…" : status === "submitting" ? "Submitting via Relayer…" : "Generate ZK Proof & Vote"}
        </button>
      </section>

      {txHash && <p>Last tx: <code>{txHash}</code></p>}

      <section>
        <h3>Activity Log</h3>
        <pre style={{ background: "#111", color: "#0f0", padding: 12, minHeight: 120, overflowX: "auto" }}>
          {log.join("\n")}
        </pre>
      </section>
    </div>
  );
}
