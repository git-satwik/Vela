// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/// @title PrivateGovernance
/// @notice Anonymous signaling/voting per proposal scope using Semaphore v4.
contract PrivateGovernance {
    ISemaphore public immutable semaphore;

    struct Proposal {
        uint256 groupId;
        string metadataURI;
        address creator;
        uint256 createdAt;
        bool active;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;                    // proposalId => Proposal
    mapping(uint256 => mapping(uint256 => bool)) public nullifierUsed; // groupId => nullifier => used
    mapping(uint256 => mapping(address => bool)) public isEligible;    // groupId => address => eligible

    event ProposalCreated(uint256 indexed proposalId, uint256 indexed groupId, address indexed creator, string metadataURI);
    event MemberJoined(uint256 indexed groupId, address indexed member, uint256 identityCommitment);
    event VoteCast(uint256 indexed proposalId, uint256 indexed groupId, uint256 nullifier, uint256 vote);

    error NotEligible();
    error ProposalNotActive();
    error ScopeMismatch();
    error NullifierAlreadyUsed();
    error MessageMismatch();
    error NotProposalCreator();

    constructor(address semaphoreAddress) {
        semaphore = ISemaphore(semaphoreAddress);
    }

    /// @notice Creates a proposal and its backing Semaphore group.
    /// @dev Merkle depth is pinned to 12 off-chain (see src/semaphore.js);
    ///      Semaphore v4 groups are depth-agnostic on-chain, but the
    ///      circuit artifacts loaded by the frontend must match depth 12.
    function createProposal(string calldata metadataURI, address[] calldata eligibleVoters)
        external
        returns (uint256 proposalId, uint256 groupId)
    {
        groupId = semaphore.createGroup(address(this));

        proposalId = proposalCount++;
        proposals[proposalId] = Proposal({
            groupId: groupId,
            metadataURI: metadataURI,
            creator: msg.sender,
            createdAt: block.timestamp,
            active: true
        });

        for (uint256 i = 0; i < eligibleVoters.length; i++) {
            isEligible[groupId][eligibleVoters[i]] = true;
        }

        emit ProposalCreated(proposalId, groupId, msg.sender, metadataURI);
    }

    /// @notice Custom eligibility-gated join. `msg.sender` is checked
    ///         against an allowlist set at proposal creation; once the
    ///         identityCommitment is added to the group, it is indistinguishable
    ///         from any other member's commitment (anonymity set).
    function join(uint256 proposalId, uint256 identityCommitment) external {
        Proposal storage p = proposals[proposalId];
        if (!p.active) revert ProposalNotActive();
        if (!isEligible[p.groupId][msg.sender]) revert NotEligible();

        isEligible[p.groupId][msg.sender] = false; // one join per eligible address

        semaphore.addMember(p.groupId, identityCommitment);

        emit MemberJoined(p.groupId, msg.sender, identityCommitment);
    }

    /// @notice Validates and records an anonymous vote/signal.
    /// @dev `proof.scope` MUST equal the proposal's groupId so a proof
    ///      cannot be replayed against a different proposal. The nullifier
    ///      is tracked per-group to prevent double-voting while the caller
    ///      (typically the relayer) remains decoupled from voter identity.
    function vote(uint256 proposalId, uint256 voteOption, ISemaphore.SemaphoreProof calldata proof) external {
        Proposal storage p = proposals[proposalId];
        if (!p.active) revert ProposalNotActive();
        if (proof.scope != p.groupId) revert ScopeMismatch();
        if (nullifierUsed[p.groupId][proof.nullifier]) revert NullifierAlreadyUsed();
        if (proof.message != voteOption) revert MessageMismatch();

        semaphore.validateProof(p.groupId, proof);

        nullifierUsed[p.groupId][proof.nullifier] = true;

        emit VoteCast(proposalId, p.groupId, proof.nullifier, voteOption);
    }

    function closeProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (msg.sender != p.creator) revert NotProposalCreator();
        p.active = false;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }
}
