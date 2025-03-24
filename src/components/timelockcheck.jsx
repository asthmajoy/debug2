import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const ProposalCreationDiagnostics = () => {
  const [diagnosticInfo, setDiagnosticInfo] = useState({
    account: '',
    votingPower: '',
    proposalThreshold: '',
    networkDetails: '',
    contractAddresses: {
      governance: '',
      timelock: ''
    }
  });
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // REPLACE WITH YOUR ACTUAL CONTRACT ADDRESSES
  const GOVERNANCE_ADDRESS = "0xA5a986861368058183b093D76E2d2036f02531E0";
  const TIMELOCK_ADDRESS = "0xCcd1C3F96F666433ea636bcd4F5C35C730E90672";

  // Comprehensive Governance ABI
  const governanceAbi = [
    "function state(uint256 proposalId) external view returns (uint8)",
    "function propose(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) external returns (uint256)",
    "function proposalThreshold() external view returns (uint256)",
    "function getVotes(address account, uint256 blockNumber) external view returns (uint256)",
    "function proposalSnapshot(uint256 proposalId) external view returns (uint256)",
    "function proposalDeadline(uint256 proposalId) external view returns (uint256)"
  ];

  const appendLog = (message) => {
    setLog(prev => [...prev, message]);
  };

  const runComprehensiveDiagnostics = async () => {
    setLoading(true);
    setError(null);
    setLog([]);

    try {
      // Ensure MetaMask is connected
      if (!window.ethereum) {
        throw new Error('MetaMask not detected. Please install and connect MetaMask.');
      }

      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const account = accounts[0];

      // Create provider
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const network = await provider.getNetwork();
      const signer = provider.getSigner();

      // Validate network
      if (network.chainId !== 11155111) { // Sepolia chain ID
        throw new Error(`Wrong network. Please switch to Sepolia Testnet. Current network ID: ${network.chainId}`);
      }

      // Create governance contract instance
      const governanceContract = new ethers.Contract(
        GOVERNANCE_ADDRESS, 
        governanceAbi, 
        provider
      );

      // Get current block
      const currentBlock = await provider.getBlockNumber();

      // Check proposal threshold
      const proposalThreshold = await governanceContract.proposalThreshold();
      
      // Get voting power
      const votingPower = await governanceContract.getVotes(account, currentBlock - 1);

      // Detailed diagnostic information
      setDiagnosticInfo({
        account,
        votingPower: votingPower.toString(),
        proposalThreshold: proposalThreshold.toString(),
        networkDetails: `${network.name} (Chain ID: ${network.chainId})`,
        contractAddresses: {
          governance: GOVERNANCE_ADDRESS,
          timelock: TIMELOCK_ADDRESS
        }
      });

      // Logging detailed checks
      appendLog(`🔍 Comprehensive Proposal Creation Diagnostics`);
      appendLog(`Account: ${account}`);
      appendLog(`Network: ${network.name} (Chain ID: ${network.chainId})`);
      appendLog(`Current Block: ${currentBlock}`);
      appendLog(`Proposal Threshold: ${proposalThreshold.toString()} votes`);
      appendLog(`Your Voting Power: ${votingPower.toString()} votes`);

      // Voting Power Check
      if (votingPower.lt(proposalThreshold)) {
        appendLog(`❌ INSUFFICIENT VOTING POWER`);
        appendLog(`You do not meet the proposal threshold`);
        setError("Insufficient voting power to create a proposal");
        return;
      }

      // Demonstrate proposal creation parameters
      appendLog(`\n🧪 Sample Proposal Creation Test`);
      appendLog(`Note: This is a diagnostic example. Replace with actual proposal details.`);

      // Sample proposal parameters
      const targets = [GOVERNANCE_ADDRESS];
      const values = [0];
      const calldatas = [
        governanceContract.interface.encodeFunctionData("proposalThreshold")
      ];
      const description = "Diagnostic Proposal Creation Test";

      appendLog(`Proposal Parameters:`);
      appendLog(`- Targets: ${targets}`);
      appendLog(`- Values: ${values}`);
      appendLog(`- Description: ${description}`);

    } catch (err) {
      console.error('Diagnostic error:', err);
      setError(err.message);
      appendLog(`❌ ERROR: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto bg-white rounded-lg shadow-md">
      <h2 className="text-xl font-semibold mb-4">Proposal Creation Diagnostics</h2>
      
      <button
        onClick={runComprehensiveDiagnostics}
        disabled={loading}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 mb-4"
      >
        {loading ? 'Running Diagnostics...' : 'Run Comprehensive Diagnostics'}
      </button>

      {error && (
        <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-md">
          {error}
        </div>
      )}

      {diagnosticInfo.account && (
        <div className="mt-4 bg-gray-100 p-4 rounded-md">
          <h3 className="text-lg font-semibold mb-2">Diagnostic Details</h3>
          <div className="space-y-2">
            <p><strong>Account:</strong> {diagnosticInfo.account}</p>
            <p><strong>Network:</strong> {diagnosticInfo.networkDetails}</p>
            <p><strong>Voting Power:</strong> {diagnosticInfo.votingPower}</p>
            <p><strong>Proposal Threshold:</strong> {diagnosticInfo.proposalThreshold}</p>
            <p><strong>Governance Contract:</strong> {diagnosticInfo.contractAddresses.governance}</p>
            <p><strong>Timelock Contract:</strong> {diagnosticInfo.contractAddresses.timelock}</p>
          </div>
        </div>
      )}

      <div className="mt-4 bg-yellow-50 p-4 rounded-md text-sm">
        <h4 className="font-semibold mb-2">Common Proposal Creation Issues:</h4>
        <ul className="list-disc pl-5 space-y-2">
          <li>Insufficient voting power</li>
          <li>Incorrect network</li>
          <li>Contract configuration problems</li>
          <li>Proposal parameter mismatches</li>
          <li>Unexpected contract constraints</li>
        </ul>
      </div>

      {log.length > 0 && (
        <div className="mt-4 bg-gray-800 text-green-400 p-3 rounded-md font-mono text-sm max-h-64 overflow-y-auto">
          <h4 className="font-semibold mb-2">Diagnostic Log:</h4>
          {log.map((entry, idx) => (
            <div key={idx} className="pb-1">
              {'>'} {entry}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProposalCreationDiagnostics;