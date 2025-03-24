// src/contexts/BlockchainDataContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useWeb3 } from './Web3Context';
import { ethers } from 'ethers';
import blockchainDataCache from '../utils/blockchainDataCache';

// Create the context
const BlockchainDataContext = createContext();

// Provider component
export const BlockchainDataProvider = ({ children }) => {
  // Get Web3 context
  const { 
    account, 
    isConnected, 
    provider, 
    contracts, 
    contractsReady, 
    refreshCounter,
    getContractByName
  } = useWeb3();
  
  // State for user data
  const [userData, setUserData] = useState({
    address: null,
    balance: "0",
    votingPower: "0",
    delegate: null,
    lockedTokens: "0",
    delegatedToYou: "0",
    delegators: [],
    hasVotedProposals: {}
  });
  
  // State for DAO statistics
  const [daoStats, setDaoStats] = useState({
    totalHolders: 0,
    circulatingSupply: "0",
    activeProposals: 0,
    totalProposals: 0,
    participationRate: 0,
    delegationRate: 0,
    proposalSuccessRate: 0
  });
  
  // Loading and error states
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Counter for manual refreshes
  const [manualRefreshCounter, setManualRefreshCounter] = useState(0);
  
  // Fetch token balance for an address directly from the blockchain
  const getTokenBalance = useCallback(async (address) => {
    if (!address || !contractsReady || !contracts.justToken) {
      return "0";
    }
    
    try {
      // Try to get from cache first
      const cacheKey = `balance-${address}`;
      const cachedBalance = blockchainDataCache.get(cacheKey);
      if (cachedBalance !== null) {
        return cachedBalance;
      }
      
      const balance = await contracts.justToken.balanceOf(address);
      const formattedBalance = ethers.utils.formatEther(balance);
      
      // Cache the result
      blockchainDataCache.set(cacheKey, formattedBalance);
      
      return formattedBalance;
    } catch (error) {
      console.error("Error fetching token balance:", error);
      return "0";
    }
  }, [contractsReady, contracts]);

  // Fetch delegation info for an address
  const getDelegationInfo = useCallback(async (address) => {
    if (!address || !contractsReady || !contracts.justToken) {
      return {
        currentDelegate: null,
        lockedTokens: "0",
        delegatedToYou: "0",
        delegators: []
      };
    }

    try {
      // Try to get from cache first
      const cacheKey = `delegation-${address}`;
      const cachedInfo = blockchainDataCache.get(cacheKey);
      if (cachedInfo !== null) {
        return cachedInfo;
      }
      
      // Get delegation data from contract
      const tokenContract = contracts.justToken;
      
      // Get current delegate
      const currentDelegate = await tokenContract.getDelegate(address);
      
      // Get locked tokens
      const lockedTokens = await tokenContract.getLockedTokens(address);
      
      // Get tokens delegated to this address
      const delegatedToYou = await tokenContract.getDelegatedToAddress(address);
      
      // Get delegators list
      const delegatorAddresses = await tokenContract.getDelegatorsOf(address);
      
      // Get balance for each delegator
      const delegators = await Promise.all(
        delegatorAddresses.map(async (delegatorAddr) => {
          const balance = await getTokenBalance(delegatorAddr);
          return {
            address: delegatorAddr,
            balance
          };
        })
      );

      const delegationInfo = {
        currentDelegate,
        lockedTokens: ethers.utils.formatEther(lockedTokens),
        delegatedToYou: ethers.utils.formatEther(delegatedToYou),
        delegators
      };
      
      // Cache the result
      blockchainDataCache.set(cacheKey, delegationInfo);
      
      return delegationInfo;
    } catch (error) {
      console.error("Error fetching delegation info:", error);
      return {
        currentDelegate: null,
        lockedTokens: "0",
        delegatedToYou: "0",
        delegators: []
      };
    }
  }, [contractsReady, contracts, getTokenBalance]);

  // Calculate voting power for an address
  const getVotingPower = useCallback(async (address) => {
    if (!address || !contractsReady || !contracts.justToken) {
      return "0";
    }

    try {
      // Try to get from cache first
      const cacheKey = `votingPower-${address}`;
      const cachedPower = blockchainDataCache.get(cacheKey);
      if (cachedPower !== null) {
        return cachedPower;
      }
      
      // Get delegation info
      const delegationInfo = await getDelegationInfo(address);
      
      // Get user balance
      const balance = await getTokenBalance(address);
      
      // If self-delegated, add delegated tokens to voting power
      // Otherwise, voting power is 0 (delegated away)
      let votingPower = "0";
      
      if (delegationInfo.currentDelegate === address || 
          delegationInfo.currentDelegate === ethers.constants.AddressZero ||
          delegationInfo.currentDelegate === null) {
        // Self-delegated - voting power is own balance + delegated to you
        const ownBalance = ethers.utils.parseEther(balance);
        const delegated = ethers.utils.parseEther(delegationInfo.delegatedToYou || "0");
        votingPower = ethers.utils.formatEther(ownBalance.add(delegated));
      } else {
        console.log(`User ${address} has delegated to ${delegationInfo.currentDelegate}, voting power is 0`);
      }
      
      // Cache the result
      blockchainDataCache.set(cacheKey, votingPower);
      
      return votingPower;
    } catch (error) {
      console.error("Error calculating voting power:", error);
      return "0";
    }
  }, [contractsReady, contracts, getDelegationInfo, getTokenBalance]);

  // Get user's voted proposals directly from blockchain events
  const getVotedProposals = useCallback(async () => {
    if (!contractsReady || !isConnected || !account || !contracts.governance) return {};
    
    try {
      // Try to get from cache first
      const cacheKey = `votedProposals-${account}`;
      const cachedVotes = blockchainDataCache.get(cacheKey);
      if (cachedVotes !== null) {
        return cachedVotes;
      }
      
      // Use events to get all proposals the user has voted on
      const governance = contracts.governance;
      const filter = governance.filters.VoteCast(null, account);
      const events = await governance.queryFilter(filter);
      
      const votedProposals = {};
      for (const event of events) {
        try {
          const proposalId = event.args.proposalId.toString();
          const voteType = event.args.support;
          
          votedProposals[proposalId] = {
            type: Number(voteType),
            timestamp: (await event.getBlock()).timestamp
          };
        } catch (err) {
          console.warn("Error processing vote event:", err);
        }
      }
      
      // Cache the result
      blockchainDataCache.set(cacheKey, votedProposals);
      
      return votedProposals;
    } catch (error) {
      console.error("Error fetching voted proposals:", error);
      return {};
    }
  }, [contractsReady, isConnected, account, contracts]);

  // Check if user has voted on a proposal
  const hasVoted = useCallback(async (proposalId) => {
    if (!isConnected || !account || !contractsReady || !contracts.governance) return false;
    
    try {
      // First check if we already know from userData
      if (userData.hasVotedProposals[proposalId]) {
        return true;
      }
      
      // Try to get from cache
      const cacheKey = `hasVoted-${account}-${proposalId}`;
      const cachedResult = blockchainDataCache.get(cacheKey);
      if (cachedResult !== null) {
        return cachedResult;
      }
      
      // Check directly from contract
      const voterInfo = await contracts.governance.proposalVoterInfo(proposalId, account);
      const result = !voterInfo.isZero();
      
      // Cache the result
      blockchainDataCache.set(cacheKey, result);
      
      return result;
    } catch (err) {
      console.error(`Error checking if user has voted on proposal ${proposalId}:`, err);
      return false;
    }
  }, [isConnected, account, contractsReady, contracts, userData.hasVotedProposals]);

  // Enhanced function to get proposal vote totals from blockchain
  /**
 * Get proposal vote totals directly from blockchain
 * @param {string|number} proposalId - The proposal ID
 * @returns {Object} Vote data including counts and voting power
 */
const getProposalVoteTotals = useCallback(async (proposalId) => {
    if (!contractsReady || !isConnected || !contracts.governance) {
      return {
        yesVotes: "0",
        noVotes: "0",
        abstainVotes: "0",
        totalVoters: 0,
        yesPercentage: 0,
        noPercentage: 0,
        abstainPercentage: 0
      };
    }
    
    try {
      console.log(`Fetching vote totals for proposal ${proposalId}`);
  
      // Try to get votes using getProposalVotes method - this is the new contract function
      const [yesVotes, noVotes, abstainVotes, totalVotingPower, totalVoters] = 
        await contracts.governance.getProposalVotes(proposalId);
        
      // Calculate percentages
      const totalVotes = yesVotes.add(noVotes).add(abstainVotes);
      const yesPercentage = totalVotes.gt(0) ? yesVotes.mul(100).div(totalVotes).toNumber() : 0;
      const noPercentage = totalVotes.gt(0) ? noVotes.mul(100).div(totalVotes).toNumber() : 0;
      const abstainPercentage = totalVotes.gt(0) ? abstainVotes.mul(100).div(totalVotes).toNumber() : 0;
      
      // Format the values
      const formattedYesVotes = ethers.utils.formatEther(yesVotes);
      const formattedNoVotes = ethers.utils.formatEther(noVotes);
      const formattedAbstainVotes = ethers.utils.formatEther(abstainVotes);
      const formattedTotalVotes = ethers.utils.formatEther(totalVotes);
      
      console.log(`Vote totals fetched:`, {
        yes: formattedYesVotes,
        no: formattedNoVotes,
        abstain: formattedAbstainVotes,
        totalPower: formattedTotalVotes,
        voters: totalVoters.toNumber(),
        yesPercent: yesPercentage,
        noPercent: noPercentage,
        abstainPercent: abstainPercentage
      });
      
      return {
        // These are voting power values from the contract
        yesVotes: formattedYesVotes,
        noVotes: formattedNoVotes,
        abstainVotes: formattedAbstainVotes,
        
        // Also explicitly store as voting power for clarity
        yesVotingPower: formattedYesVotes,
        noVotingPower: formattedNoVotes,
        abstainVotingPower: formattedAbstainVotes,
        totalVotingPower: formattedTotalVotes,
        
        // Count of unique voters
        totalVoters: totalVoters.toNumber(),
        
        // Percentages based on voting power
        yesPercentage,
        noPercentage,
        abstainPercentage,
        
        // Include source info for debugging
        source: 'contract'
      };
    } catch (error) {
      console.error(`Error getting proposal vote totals using getProposalVotes:`, error);
      
      // Fallback: Use events to calculate vote totals if the direct call fails
      // (kept the fallback mechanism, but with improved formatting)
      try {
        // Get all VoteCast events for this proposal
        const filter = contracts.governance.filters.VoteCast(proposalId);
        const events = await contracts.governance.queryFilter(filter);
        
        if (events.length === 0) {
          return {
            yesVotes: "0", noVotes: "0", abstainVotes: "0",
            yesVotingPower: "0", noVotingPower: "0", abstainVotingPower: "0",
            totalVotingPower: "0", totalVoters: 0,
            yesPercentage: 0, noPercentage: 0, abstainPercentage: 0,
            source: 'events-empty'
          };
        }
        
        // Process the events to calculate vote totals
        const voterVotes = new Map(); // address -> {voteType, votingPower}
        
        for (const event of events) {
          try {
            const voter = event.args.voter;
            const support = event.args.support.toNumber();
            const votingPower = event.args.votingPower;
            
            // Save the voter's vote (overwriting previous votes by the same voter)
            voterVotes.set(voter.toLowerCase(), {
              voteType: support,
              votingPower
            });
          } catch (err) {
            console.warn("Error processing vote event:", err);
          }
        }
        
        // Calculate totals based on the processed events
        let yesVotes = ethers.BigNumber.from(0);
        let noVotes = ethers.BigNumber.from(0);
        let abstainVotes = ethers.BigNumber.from(0);
        
        for (const [, vote] of voterVotes.entries()) {
          const { voteType, votingPower } = vote;
          if (voteType === 0) { // Against
            noVotes = noVotes.add(votingPower);
          } else if (voteType === 1) { // For
            yesVotes = yesVotes.add(votingPower);
          } else if (voteType === 2) { // Abstain
            abstainVotes = abstainVotes.add(votingPower);
          }
        }
        
        const totalVotes = yesVotes.add(noVotes).add(abstainVotes);
        const yesPercentage = totalVotes.gt(0) ? yesVotes.mul(100).div(totalVotes).toNumber() : 0;
        const noPercentage = totalVotes.gt(0) ? noVotes.mul(100).div(totalVotes).toNumber() : 0;
        const abstainPercentage = totalVotes.gt(0) ? abstainVotes.mul(100).div(totalVotes).toNumber() : 0;
        
        const formattedYesVotes = ethers.utils.formatEther(yesVotes);
        const formattedNoVotes = ethers.utils.formatEther(noVotes);
        const formattedAbstainVotes = ethers.utils.formatEther(abstainVotes);
        const formattedTotalVotes = ethers.utils.formatEther(totalVotes);
        
        return {
          // These are voting power values
          yesVotes: formattedYesVotes,
          noVotes: formattedNoVotes,
          abstainVotes: formattedAbstainVotes,
          
          // Also explicitly store as voting power for clarity
          yesVotingPower: formattedYesVotes,
          noVotingPower: formattedNoVotes,
          abstainVotingPower: formattedAbstainVotes,
          totalVotingPower: formattedTotalVotes,
          
          // Count of unique voters
          totalVoters: voterVotes.size,
          
          // Percentages based on voting power
          yesPercentage,
          noPercentage,
          abstainPercentage,
          
          // Include source info for debugging
          source: 'events'
        };
      } catch (fallbackError) {
        console.error(`Error using events to get vote totals:`, fallbackError);
        return {
          yesVotes: "0", noVotes: "0", abstainVotes: "0",
          yesVotingPower: "0", noVotingPower: "0", abstainVotingPower: "0",
          totalVotingPower: "0", totalVoters: 0,
          yesPercentage: 0, noPercentage: 0, abstainPercentage: 0,
          source: 'error'
        };
      }
    }
  }, [contractsReady, isConnected, contracts]);

  // Enhanced function to get detailed proposal vote information with fallbacks
  const getDetailedProposalVotes = useCallback(async (proposalId) => {
    if (!contractsReady || !isConnected || !contracts.governance) {
      return {
        yesVotes: "0",
        noVotes: "0",
        abstainVotes: "0",
        totalVotes: "0",
        totalVoters: 0,
        yesPercentage: 0,
        noPercentage: 0,
        abstainPercentage: 0,
        quorumReached: false,
        dataSource: 'none'
      };
    }
    
    try {
      // Try to get from cache first
      const cacheKey = `detailedVotes-${proposalId}`;
      const cachedData = blockchainDataCache.get(cacheKey);
      if (cachedData !== null) {
        return cachedData;
      }
      
      console.log(`Fetching detailed vote data for proposal ${proposalId}`);
      
      // First try to get data using the regular method for efficiency
      const basicVoteData = await getProposalVoteTotals(proposalId);
      
      // Get quorum value for comparison
      let quorum = ethers.BigNumber.from(0);
      try {
        const govParams = await contracts.governance.govParams();
        quorum = govParams.quorum;
      } catch (quorumError) {
        console.warn("Error getting quorum value:", quorumError);
      }
      
      // Determine if quorum is reached based on total voting power
      const totalVotingPower = ethers.utils.parseEther(basicVoteData.totalVotingPower);
      const quorumReached = quorum.gt(0) ? totalVotingPower.gte(quorum) : false;
      
      // Create detailed vote data
      const detailedData = {
        ...basicVoteData,
        quorumReached,
        requiredQuorum: quorum.gt(0) ? ethers.utils.formatEther(quorum) : "0",
        totalVotes: basicVoteData.totalVotingPower,
        dataSource: basicVoteData.source || 'combined'
      };
      
      // Cache the result
      blockchainDataCache.set(cacheKey, detailedData);
      
      return detailedData;
    } catch (error) {
      console.error(`Error in getDetailedProposalVotes for proposal ${proposalId}:`, error);
      return {
        yesVotes: "0",
        noVotes: "0",
        abstainVotes: "0",
        totalVotes: "0",
        totalVoters: 0,
        yesPercentage: 0,
        noPercentage: 0,
        abstainPercentage: 0,
        quorumReached: false,
        dataSource: 'error'
      };
    }
  }, [contractsReady, isConnected, contracts, getProposalVoteTotals]);

  // Get DAO statistics from blockchain
  const fetchDAOStats = useCallback(async () => {
    if (!contractsReady || !isConnected) {
      return {
        totalHolders: 0,
        circulatingSupply: "0",
        activeProposals: 0,
        totalProposals: 0,
        participationRate: 0,
        delegationRate: 0,
        proposalSuccessRate: 0
      };
    }

    try {
      // Try to get from cache first
      const cacheKey = 'daoStats';
      const cachedStats = blockchainDataCache.get(cacheKey);
      if (cachedStats !== null) {
        return cachedStats;
      }
      
      // 1. Get total supply
      const totalSupply = await contracts.justToken.totalSupply();
      const circulatingSupply = ethers.utils.formatEther(totalSupply);
      
      // 2. Estimate holder count using Transfer events
      let totalHolders = 0;
      try {
        // Get Transfer events to estimate unique holders
        const filter = contracts.justToken.filters.Transfer();
        const blockNumber = await provider.getBlockNumber();
        const fromBlock = Math.max(0, blockNumber - 10000);
        
        const events = await contracts.justToken.queryFilter(filter, fromBlock);
        
        // Get unique addresses from transfer events
        const uniqueAddresses = new Set();
        
        for (const event of events) {
          if (event.args) {
            if (event.args.from !== ethers.constants.AddressZero) {
              uniqueAddresses.add(event.args.from.toLowerCase());
            }
            if (event.args.to !== ethers.constants.AddressZero) {
              uniqueAddresses.add(event.args.to.toLowerCase());
            }
          }
        }
        
        totalHolders = uniqueAddresses.size || 10; // Default to 10 if we can't determine
      } catch (error) {
        console.error("Error estimating holder count:", error);
        totalHolders = 10; // Fallback value
      }
      
      // 3. Count active and total proposals
      let activeProposals = 0;
      let totalProposals = 0;
      let proposalSuccessRate = 0;
      
      try {
        // Try to get proposal count directly
        if (typeof contracts.governance.getProposalCount === 'function') {
          totalProposals = (await contracts.governance.getProposalCount()).toNumber();
        } else {
          // Find highest valid proposal ID
          let highestId = 0;
          let testId = 0;
          let foundInvalid = false;
          
          while (!foundInvalid && testId < 100) {
            try {
              await contracts.governance.getProposalState(testId);
              highestId = testId;
              testId++;
            } catch (err) {
              foundInvalid = true;
            }
          }
          
          totalProposals = highestId + 1;
        }
        
        // Count active and successful proposals
        let successfulProposals = 0;
        
        for (let i = 0; i < totalProposals; i++) {
          try {
            const state = await contracts.governance.getProposalState(i);
            
            if (state === 0) { // Active state is usually 0
              activeProposals++;
            }
            
            // States 4, 5, 7 typically represent success states
            if (state === 4 || state === 5 || state === 7) {
              successfulProposals++;
            }
          } catch (err) {
            // Skip if error
          }
        }
        
        // Calculate success rate
        proposalSuccessRate = totalProposals > 0 ? successfulProposals / totalProposals : 0;
      } catch (error) {
        console.error("Error counting proposals:", error);
      }
      
      // 4. Estimate participation and delegation rates
      let participationRate = 0;
      let delegationRate = 0;
      
      try {
        // Try to get snapshot metrics if available
        if (typeof contracts.justToken.getCurrentSnapshotId === 'function') {
          const snapshotId = await contracts.justToken.getCurrentSnapshotId();
          
          if (typeof contracts.justToken.getSnapshotMetrics === 'function') {
            try {
              const metrics = await contracts.justToken.getSnapshotMetrics(snapshotId);
              
              // Extract metrics based on return type
              if (Array.isArray(metrics)) {
                // Array format - typically index 4 is delegation percentage
                delegationRate = metrics[4] ? parseFloat(metrics[4].toString()) / 10000 : 0;
              } else if (metrics && metrics.percentageDelegated) {
                // Object format
                delegationRate = parseFloat(metrics.percentageDelegated.toString()) / 10000;
              }
            } catch (err) {
              console.warn("Error getting snapshot metrics:", err);
            }
          }
        }
        
        // Estimate participation rate from VoteCast events
        const voteFilter = contracts.governance.filters.VoteCast();
        const voteEvents = await contracts.governance.queryFilter(voteFilter);
        
        // Count unique voters
        const uniqueVoters = new Set();
        
        for (const event of voteEvents) {
          if (event.args && event.args.voter) {
            uniqueVoters.add(event.args.voter.toLowerCase());
          }
        }
        
        // Estimate participation as unique voters / total holders
        participationRate = totalHolders > 0 ? uniqueVoters.size / totalHolders : 0;
      } catch (error) {
        console.error("Error estimating participation/delegation rates:", error);
      }
      
      // Format percentages
      const formattedParticipationRate = `${(participationRate * 100).toFixed(1)}%`;
      const formattedDelegationRate = `${(delegationRate * 100).toFixed(1)}%`;
      const formattedSuccessRate = `${(proposalSuccessRate * 100).toFixed(1)}%`;
      
      const stats = {
        totalHolders,
        circulatingSupply,
        activeProposals,
        totalProposals,
        participationRate,
        delegationRate,
        proposalSuccessRate,
        formattedParticipationRate,
        formattedDelegationRate,
        formattedSuccessRate
      };
      
      // Cache the result
      blockchainDataCache.set(cacheKey, stats);
      
      return stats;
    } catch (error) {
      console.error("Error fetching DAO stats:", error);
      return {
        totalHolders: 0,
        circulatingSupply: "0",
        activeProposals: 0,
        totalProposals: 0,
        participationRate: 0,
        delegationRate: 0,
        proposalSuccessRate: 0,
        formattedParticipationRate: "0.0%",
        formattedDelegationRate: "0.0%",
        formattedSuccessRate: "0.0%"
      };
    }
  }, [contractsReady, isConnected, contracts, provider]);

  // Fetch user data function
  const fetchUserData = useCallback(async () => {
    if (!contractsReady || !isConnected || !account) return;
    
    try {
      setIsLoading(true);
      
      // Get balance
      const balance = await getTokenBalance(account);
      
      // Get delegation info
      const delegationInfo = await getDelegationInfo(account);
      
      // Get voting power
      const votingPower = await getVotingPower(account);
      
      // Get voted proposals
      const votedProposals = await getVotedProposals();
      
      // Update user data state
      setUserData({
        address: account,
        balance,
        votingPower,
        delegate: delegationInfo.currentDelegate,
        lockedTokens: delegationInfo.lockedTokens,
        delegatedToYou: delegationInfo.delegatedToYou,
        delegators: delegationInfo.delegators,
        hasVotedProposals: votedProposals
      });
      
    } catch (error) {
      console.error("Error fetching user data:", error);
      setError("Failed to load user data from blockchain");
    } finally {
      setIsLoading(false);
    }
  }, [
    contractsReady, 
    isConnected, 
    account, 
    getTokenBalance, 
    getDelegationInfo, 
    getVotingPower, 
    getVotedProposals
  ]);

  // Function to manually refresh data and clear cache
  const refreshData = useCallback(() => {
    // Clear the cache
    blockchainDataCache.clear();
    
    // Increment refresh counter to trigger re-fetching
    setManualRefreshCounter(prev => prev + 1);
  }, []);

  // Load all data when connected and contracts ready
  useEffect(() => {
    if (isConnected && contractsReady) {
      console.log("Loading blockchain data...");
      
      // Load all data with slight staggered timing to avoid overwhelming RPC
      const loadData = async () => {
        try {
          setIsLoading(true);
          
          // Fetch user data first
          await fetchUserData();
          
          // Small delay
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Fetch DAO stats
          const stats = await fetchDAOStats();
          setDaoStats(stats);
          
        } catch (error) {
          console.error("Error loading blockchain data:", error);
          setError("Failed to load data from blockchain");
        } finally {
          setIsLoading(false);
        }
      };
      
      loadData();
    }
  }, [
    isConnected, 
    contractsReady, 
    fetchUserData, 
    fetchDAOStats, 
    refreshCounter, 
    manualRefreshCounter,
    account
  ]);

  // Context value
  const value = {
    userData,
    daoStats,
    isLoading,
    error,
    refreshData,
    hasVoted,
    getProposalVoteTotals,
    getDetailedProposalVotes
  };

  return (
    <BlockchainDataContext.Provider value={value}>
      {children}
    </BlockchainDataContext.Provider>
  );
};

// Custom hook to use the context
export const useBlockchainData = () => {
  const context = useContext(BlockchainDataContext);
  if (!context) {
    throw new Error('useBlockchainData must be used within a BlockchainDataProvider');
  }
  return context;
};