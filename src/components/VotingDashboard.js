// src/components/VotingDashboard.js

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import VotingDataService from '../services/votingDataService';
import { createGovernanceContract } from '../contracts/governanceContractInterface';

// Config values (should come from your app's config)
const GOVERNANCE_CONTRACT_ADDRESS = 'GOVERNANCE_ADDRESS';

const VotingDashboard = () => {
  const [provider, setProvider] = useState(null);
  const [votingService, setVotingService] = useState(null);
  const [activeProposals, setActiveProposals] = useState([]);
  const [proposalVotes, setProposalVotes] = useState({});
  const [globalStats, setGlobalStats] = useState({});
  const [userAddress, setUserAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVote, setSelectedVote] = useState(1); // 0 = No, 1 = Yes, 2 = Abstain

  // Initialize the provider and voting service
  useEffect(() => {
    const init = async () => {
      try {
        // Check if Web3 is available
        if (window.ethereum) {
          // Create a new provider
          const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
          setProvider(web3Provider);
          
          // Get the connected accounts
          const accounts = await web3Provider.listAccounts();
          if (accounts.length > 0) {
            setUserAddress(accounts[0]);
          }
          
          // Create the voting service
          const service = new VotingDataService(
            GOVERNANCE_CONTRACT_ADDRESS,
            createGovernanceContract,
            web3Provider
          );
          setVotingService(service);
          
          // Listen for account changes
          window.ethereum.on('accountsChanged', (accounts) => {
            setUserAddress(accounts[0] || '');
          });
        } else {
          setError('MetaMask or compatible Web3 wallet not detected');
        }
      } catch (err) {
        console.error('Error initializing:', err);
        setError('Failed to initialize: ' + err.message);
      }
    };
    
    init();
    
    // Cleanup event listeners
    return () => {
      if (window.ethereum) {
        window.ethereum.removeAllListeners('accountsChanged');
      }
    };
  }, []);

  // Load active proposals and global stats
  useEffect(() => {
    if (!votingService) return;
    
    const loadData = async () => {
      setLoading(true);
      try {
        // Get active proposals
        const proposals = await votingService.getActiveProposals();
        setActiveProposals(proposals);
        
        // Get global stats
        const stats = await votingService.getGlobalVotingStats();
        setGlobalStats(stats);
        
        // Get vote totals for each proposal
        const votesData = {};
        await Promise.all(
          proposals.map(async (id) => {
            const voteTotals = await votingService.getProposalVoteTotals(id);
            votesData[id] = voteTotals;
          })
        );
        setProposalVotes(votesData);
        
        setLoading(false);
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load voting data: ' + err.message);
        setLoading(false);
      }
    };
    
    loadData();
    
    // Set up a refresh interval (every 60 seconds)
    const refreshInterval = setInterval(() => {
      loadData();
    }, 60000);
    
    return () => {
      clearInterval(refreshInterval);
    };
  }, [votingService]);

  // Connect wallet handler
  const connectWallet = async () => {
    try {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ 
          method: 'eth_requestAccounts' 
        });
        setUserAddress(accounts[0]);
      }
    } catch (err) {
      console.error('Error connecting wallet:', err);
      setError('Failed to connect wallet: ' + err.message);
    }
  };

  // Vote handler
  const castVote = async (proposalId) => {
    if (!votingService || !userAddress) return;
    
    try {
      // Get the signer
      const signer = provider.getSigner();
      
      // Create a contract instance with the signer
      const contract = createGovernanceContract(
        GOVERNANCE_CONTRACT_ADDRESS,
        signer
      );
      
      // Cast the vote
      const tx = await contract.castVote(proposalId, selectedVote);
      
      // Wait for transaction confirmation
      const receipt = await tx.wait();
      
      console.log('Vote cast successfully:', receipt);
      
      // Force refresh the proposal data
      const updatedVoteTotals = await votingService.getProposalVoteTotals(proposalId, true);
      setProposalVotes(prev => ({
        ...prev,
        [proposalId]: updatedVoteTotals
      }));
      
      // Refresh global stats
      const stats = await votingService.getGlobalVotingStats(true);
      setGlobalStats(stats);
    } catch (err) {
      console.error('Error casting vote:', err);
      setError('Failed to cast vote: ' + err.message);
    }
  };

  // Manual refresh handler
  const refreshData = async () => {
    if (!votingService) return;
    
    setLoading(true);
    try {
      await votingService.refreshAllVotingData();
      
      // Update active proposals
      const proposals = await votingService.getActiveProposals(true);
      setActiveProposals(proposals);
      
      // Update global stats
      const stats = await votingService.getGlobalVotingStats(true);
      setGlobalStats(stats);
      
      // Update vote totals for each proposal
      const votesData = {};
      await Promise.all(
        proposals.map(async (id) => {
          const voteTotals = await votingService.getProposalVoteTotals(id, true);
          votesData[id] = voteTotals;
        })
      );
      setProposalVotes(votesData);
      
      setLoading(false);
      setError(null);
    } catch (err) {
      console.error('Error refreshing data:', err);
      setError('Failed to refresh voting data: ' + err.message);
      setLoading(false);
    }
  };

  // Render the vote percentages bar
  const renderVoteBar = (proposal) => {
    if (!proposal) return null;
    
    return (
      <div className="w-full h-8 bg-gray-200 rounded-lg overflow-hidden flex">
        <div 
          className="bg-green-500 h-full flex items-center justify-center text-white text-xs font-bold"
          style={{ width: `${proposal.yesPercentage}%` }}
        >
          {proposal.yesPercentage > 5 ? `${proposal.yesPercentage}%` : ''}
        </div>
        <div 
          className="bg-red-500 h-full flex items-center justify-center text-white text-xs font-bold"
          style={{ width: `${proposal.noPercentage}%` }}
        >
          {proposal.noPercentage > 5 ? `${proposal.noPercentage}%` : ''}
        </div>
        <div 
          className="bg-gray-500 h-full flex items-center justify-center text-white text-xs font-bold"
          style={{ width: `${proposal.abstainPercentage}%` }}
        >
          {proposal.abstainPercentage > 5 ? `${proposal.abstainPercentage}%` : ''}
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Governance Voting Dashboard</h1>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      {/* Wallet Connection */}
      <div className="mb-8 flex justify-between items-center">
        <div>
          {userAddress ? (
            <p>Connected: {userAddress.slice(0, 6)}...{userAddress.slice(-4)}</p>
          ) : (
            <button 
              onClick={connectWallet}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            >
              Connect Wallet
            </button>
          )}
        </div>
        
        <button 
          onClick={refreshData}
          className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded flex items-center"
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>
      
      {/* Global Stats */}
      {globalStats && !globalStats.error && (
        <div className="bg-gray-100 p-6 rounded-lg mb-8">
          <h2 className="text-xl font-bold mb-4">Global Voting Statistics</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-white p-4 rounded shadow">
              <h3 className="text-lg font-semibold">Participation</h3>
              <p className="text-3xl font-bold">{globalStats.participationRate}%</p>
              <p className="text-sm text-gray-500">
                {globalStats.totalVotesCast} / {globalStats.totalVotingPower} votes
              </p>
            </div>
            
            <div className="bg-white p-4 rounded shadow">
              <h3 className="text-lg font-semibold">Vote Distribution</h3>
              <div className="flex items-center mt-2">
                <span className="w-3 h-3 bg-green-500 rounded-full mr-2"></span>
                <span>Yes: {globalStats.yesPercentage}%</span>
              </div>
              <div className="flex items-center mt-1">
                <span className="w-3 h-3 bg-red-500 rounded-full mr-2"></span>
                <span>No: {globalStats.noPercentage}%</span>
              </div>
              <div className="flex items-center mt-1">
                <span className="w-3 h-3 bg-gray-500 rounded-full mr-2"></span>
                <span>Abstain: {globalStats.abstainPercentage}%</span>
              </div>
            </div>
            
            <div className="bg-white p-4 rounded shadow">
              <h3 className="text-lg font-semibold">Active Proposals</h3>
              <p className="text-3xl font-bold">{globalStats.activeProposalCount}</p>
              <p className="text-sm text-gray-500">
                Last updated: {new Date(globalStats.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Active Proposals */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">Active Proposals</h2>
        
        {loading && activeProposals.length === 0 ? (
          <p>Loading proposals...</p>
        ) : activeProposals.length === 0 ? (
          <p>No active proposals found</p>
        ) : (
          <div className="space-y-6">
            {activeProposals.map((proposalId) => {
              const proposal = proposalVotes[proposalId];
              
              return (
                <div key={proposalId} className="bg-white p-6 rounded-lg shadow">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-lg font-bold">Proposal #{proposalId}</h3>
                    <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                      Active
                    </span>
                  </div>
                  
                  {proposal ? (
                    <>
                      <div className="mb-4">
                        {renderVoteBar(proposal)}
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="text-center">
                          <p className="text-sm text-gray-500">Yes</p>
                          <p className="text-xl font-bold text-green-500">{proposal.yesVotes}</p>
                          <p className="text-sm">{proposal.yesPercentage}%</p>
                        </div>
                        
                        <div className="text-center">
                          <p className="text-sm text-gray-500">No</p>
                          <p className="text-xl font-bold text-red-500">{proposal.noVotes}</p>
                          <p className="text-sm">{proposal.noPercentage}%</p>
                        </div>
                        
                        <div className="text-center">
                          <p className="text-sm text-gray-500">Abstain</p>
                          <p className="text-xl font-bold text-gray-500">{proposal.abstainVotes}</p>
                          <p className="text-sm">{proposal.abstainPercentage}%</p>
                        </div>
                      </div>
                      
                      <div className="mb-4">
                        <p className="text-sm text-gray-500">
                          Participation: {proposal.participationRate}% (
                          {proposal.totalVotesCast} out of {proposal.totalVotingPower} votes)
                        </p>
                      </div>
                    </>
                  ) : (
                    <p>Loading proposal data...</p>
                  )}
                  
                  {userAddress && (
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="font-semibold mb-2">Cast Your Vote</h4>
                      <div className="flex items-center space-x-4 mb-4">
                        <div className="flex items-center">
                          <input
                            type="radio"
                            id={`yes-${proposalId}`}
                            name={`vote-${proposalId}`}
                            value="1"
                            checked={selectedVote === 1}
                            onChange={() => setSelectedVote(1)}
                            className="mr-2"
                          />
                          <label htmlFor={`yes-${proposalId}`}>Yes</label>
                        </div>
                        
                        <div className="flex items-center">
                          <input
                            type="radio"
                            id={`no-${proposalId}`}
                            name={`vote-${proposalId}`}
                            value="0"
                            checked={selectedVote === 0}
                            onChange={() => setSelectedVote(0)}
                            className="mr-2"
                          />
                          <label htmlFor={`no-${proposalId}`}>No</label>
                        </div>
                        
                        <div className="flex items-center">
                          <input
                            type="radio"
                            id={`abstain-${proposalId}`}
                            name={`vote-${proposalId}`}
                            value="2"
                            checked={selectedVote === 2}
                            onChange={() => setSelectedVote(2)}
                            className="mr-2"
                          />
                          <label htmlFor={`abstain-${proposalId}`}>Abstain</label>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => castVote(proposalId)}
                        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                      >
                        Submit Vote
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default VotingDashboard;