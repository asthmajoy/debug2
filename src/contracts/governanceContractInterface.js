// src/contracts/governanceContractInterface.js

/**
 * Interface definition for the governance contract
 * Use this to create instances of the contract
 */

// Minimal ABI for governance contract with voting functions
export const GOVERNANCE_CONTRACT_ABI = [
  // View functions
  {
    "inputs": [{"name": "proposalId", "type": "uint256"}],
    "name": "getProposalVoteTotals",
    "outputs": [
      {"name": "yes", "type": "uint256"},
      {"name": "no", "type": "uint256"},
      {"name": "abstain", "type": "uint256"},
      {"name": "totalVotes", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "proposalId", "type": "uint256"},
      {"name": "voter", "type": "address"}
    ],
    "name": "getUserVote",
    "outputs": [
      {"name": "hasVoted", "type": "bool"},
      {"name": "support", "type": "uint8"},
      {"name": "votes", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getActiveProposals",
    "outputs": [{"name": "", "type": "uint256[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "proposalId", "type": "uint256"}],
    "name": "getProposalState",
    "outputs": [{"name": "", "type": "uint8"}],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Transaction functions
  {
    "inputs": [
      {"name": "proposalId", "type": "uint256"},
      {"name": "support", "type": "uint8"}
    ],
    "name": "castVote",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "proposalId", "type": "uint256"},
      {"name": "support", "type": "uint8"},
      {"name": "reason", "type": "string"}
    ],
    "name": "castVoteWithReason",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  
  // Events
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "name": "voter", "type": "address"},
      {"indexed": true, "name": "proposalId", "type": "uint256"},
      {"indexed": false, "name": "support", "type": "uint8"},
      {"indexed": false, "name": "votes", "type": "uint256"},
      {"indexed": false, "name": "reason", "type": "string"}
    ],
    "name": "VoteCast",
    "type": "event"
  }
];

// Sample contract creation function
export function createGovernanceContract(contractAddress, provider) {
  // Check for the ethers library
  if (!window.ethers) {
    throw new Error('Ethers.js library is required but not found');
  }
  
  return new window.ethers.Contract(
    contractAddress,
    GOVERNANCE_CONTRACT_ABI,
    provider
  );
}