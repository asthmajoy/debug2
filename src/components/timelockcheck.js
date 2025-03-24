import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const SepoliaProposalTroubleshooter = () => {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [accountInfo, setAccountInfo] = useState({
    address: '',
    balance: null,
    nonce: null
  });
  const [networkInfo, setNetworkInfo] = useState({
    chainId: null,
    networkName: ''
  });
  const [proposalDetails, setProposalDetails] = useState({
    proposalId: '',
    status: null,
    details: null
  });

  // Sepolia Testnet Contract Addresses (replace with your actual addresses)
  const GOVERNANCE_ADDRESS = "0xA5a986861368058183b093D76E2d2036f02531E0";
  const TIMELOCK_ADDRESS = "0xCcd1C3F96F666433ea636bcd4F5C35C730E90672";

  // Comprehensive Governance ABI
  const governanceAbi = [
    "function state(uint256 proposalId) external view returns (uint8)",
    "function proposals(uint256 proposalId) external view returns (tuple(address proposer, uint256 eta, uint256 startBlock, uint256 endBlock, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes, bool canceled, bool executed))",
    "function timelock() external view returns (address)",
    "function COUNTING_MODE() external pure returns (string memory)"
  ];

  const appendLog = (message) => {
    setLog(prev => [...prev, message]);
  };

  const connectAndCheckNetwork = async () => {
    setLoading(true);
    setError(null);
    setLog([]);

    try {
      // Ensure MetaMask is connected
      if (!window.ethereum) {
        throw new Error("MetaMask not detected. Please install MetaMask.");
      }

      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const account = accounts[0];

      // Create provider
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const network = await provider.getNetwork();
      
      // Check if on Sepolia
      if (network.chainId !== 11155111) {
        throw new Error(`Wrong network. Please switch to Sepolia Testnet (Chain ID: 11155111). Current network: ${network.chainId}`);
      }

      // Get account balance
      const balance = await provider.getBalance(account);
      const nonce = await provider.getTransactionCount(account);

      // Update state
      setAccountInfo({
        address: account,
        balance: ethers.utils.formatEther(balance),
        nonce: nonce
      });

      setNetworkInfo({
        chainId: network.chainId,
        networkName: 'Sepolia Testnet'
      });

      appendLog(`Connected to Sepolia Testnet`);
      appendLog(`Account: ${account}`);
      appendLog(`Balance: ${ethers.utils.formatEther(balance)} ETH`);
      appendLog(`Current Nonce: ${nonce}`);

    } catch (err) {
      console.error("Connection error:", err);
      setError(err.message || "Error connecting to network");
      appendLog(`❌ ERROR: ${err.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const checkProposalStatus = async () => {
    if (!proposalDetails.proposalId) {
      setError("Please enter a Proposal ID");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Ensure connected to Sepolia
      if (networkInfo.chainId !== 11155111) {
        await connectAndCheckNetwork();
      }

      // Create provider
      const provider = new ethers.providers.Web3Provider(window.ethereum);

      // Connect to governance contract
      const governanceContract = new ethers.Contract(
        GOVERNANCE_ADDRESS, 
        governanceAbi, 
        provider
      );

      // Fetch proposal state
      const proposalState = await governanceContract.state(proposalDetails.proposalId);
      const stateNames = [
        "Pending", 
        "Active", 
        "Canceled", 
        "Defeated", 
        "Succeeded", 
        "Queued", 
        "Expired", 
        "Executed"
      ];
      appendLog(`Proposal State: ${stateNames[proposalState]} (${proposalState})`);

      // Fetch full proposal details
      const proposal = await governanceContract.proposals(proposalDetails.proposalId);
      appendLog(`Proposal Details:`);
      appendLog(`Proposer: ${proposal.proposer}`);
      appendLog(`Start Block: ${proposal.startBlock.toString()}`);
      appendLog(`End Block: ${proposal.endBlock.toString()}`);
      appendLog(`For Votes: ${proposal.forVotes.toString()}`);
      appendLog(`Against Votes: ${proposal.againstVotes.toString()}`);
      appendLog(`Abstain Votes: ${proposal.abstainVotes.toString()}`);
      appendLog(`Canceled: ${proposal.canceled}`);
      appendLog(`Executed: ${proposal.executed}`);

      // Set proposal details for rendering
      setProposalDetails(prev => ({
        ...prev,
        status: stateNames[proposalState],
        details: proposal
      }));

    } catch (err) {
      console.error("Error checking proposal:", err);
      setError(err.message || "Error checking proposal status");
      appendLog(`❌ ERROR: ${err.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const switchToSepoliaNetwork = async () => {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }], // Sepolia's chain ID in hex
      });
    } catch (switchError) {
      // This error code indicates that the chain has not been added to MetaMask
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0xaa36a7',
              chainName: 'Sepolia Test Network',
              nativeCurrency: {
                name: 'SepoliaETH',
                symbol: 'ETH',
                decimals: 18
              },
              rpcUrls: ['https://sepolia.infura.io/v3/'],
              blockExplorerUrls: ['https://sepolia.etherscan.io/']
            }]
          });
        } catch (addError) {
          setError(`Failed to add Sepolia network: ${addError.message}`);
        }
      } else {
        setError(`Failed to switch to Sepolia network: ${switchError.message}`);
      }
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto bg-white rounded-lg shadow-md">
      <h2 className="text-xl font-semibold mb-4">Sepolia Proposal Troubleshooter</h2>
      
      <div className="mb-4 space-y-2">
        <div className="flex space-x-2">
          <button
            onClick={connectAndCheckNetwork}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            {loading ? 'Connecting...' : 'Connect to Sepolia'}
          </button>
          <button
            onClick={switchToSepoliaNetwork}
            className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700"
          >
            Switch to Sepolia Network
          </button>
        </div>

        {accountInfo.address && (
          <div className="bg-gray-100 p-3 rounded-md">
            <p>Account: {accountInfo.address}</p>
            <p>Balance: {accountInfo.balance} ETH</p>
            <p>Nonce: {accountInfo.nonce}</p>
          </div>
        )}

        <div className="flex mt-4">
          <input 
            type="text" 
            value={proposalDetails.proposalId}
            onChange={(e) => setProposalDetails(prev => ({...prev, proposalId: e.target.value}))}
            placeholder="Enter Proposal ID"
            className="flex-grow mr-2 p-2 border rounded-md"
          />
          <button
            onClick={checkProposalStatus}
            disabled={loading || !accountInfo.address}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            {loading ? 'Checking...' : 'Check Proposal'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 mb-4 text-red-700 bg-red-100 rounded-md">
          {error}
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-lg font-medium pb-2 mb-3 border-b">Proposal Log</h3>
        <div className="bg-gray-800 text-green-400 p-3 rounded-md font-mono text-sm h-96 overflow-y-auto">
          {log.length > 0 ? (
            log.map((entry, idx) => (
              <div key={idx} className="pb-1">
                {'>'} {entry}
              </div>
            ))
          ) : (
            <div className="text-gray-500">Enter a Proposal ID and click "Check Proposal"</div>
          )}
        </div>
      </div>

      <div className="mt-4 text-sm text-gray-600 bg-yellow-50 p-4 rounded-md">
        <p className="font-medium mb-2">Troubleshooting Stuck Proposals on Sepolia:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Ensure you're on the Sepolia Testnet</li>
          <li>Verify proposal ID is correct</li>
          <li>Check proposal state and vote counts</li>
          <li>Confirm account has necessary permissions</li>
          <li>Check for network congestion or contract issues</li>
        </ul>
      </div>
    </div>
  );
};

export default SepoliaProposalTroubleshooter;