// src/contexts/BlockchainDataContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useWeb3 } from './Web3Context';
import { ethers } from 'ethers';

// Helper function to create a manual vote data override for specific proposals
// Modify this object to include any proposals that need manual overrides
const manualVoteOverrides = {
  // Replace these IDs with your actual proposal IDs that need fixing
  // Format: 'proposalId': { voteData }
  // Example:
  // '1': {
  //   yesVotes: "1.0",
  //   noVotes: "0.0",
  //   abstainVotes: "0.0",
  //   totalVoters: 1,
  //   yesPercentage: 100,
  //   noPercentage: 0,
  //   abstainPercentage: 0,
  //   yesVotingPower: "1.0",
  //   noVotingPower: "0.0",
  //   abstainVotingPower: "0.0",
  //   totalVotingPower: "1.0",
  //   source: 'manual-override'
  // },
};

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
      const balance = await contracts.justToken.balanceOf(address);
      return ethers.utils.formatEther(balance);
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

      return {
        currentDelegate,
        lockedTokens: ethers.utils.formatEther(lockedTokens),
        delegatedToYou: ethers.utils.formatEther(delegatedToYou),
        delegators
      };
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
      // Check if we already know from userData
      if (userData.hasVotedProposals[proposalId]) {
        return true;
      }
      
      // If not, check directly from contract
      const voterInfo = await contracts.governance.proposalVoterInfo(proposalId, account);
      return !voterInfo.isZero();
    } catch (err) {
      console.error(`Error checking if user has voted on proposal ${proposalId}:`, err);
      return false;
    }
  }, [isConnected, account, contractsReady, contracts, userData.hasVotedProposals]);

  // Direct query method to get votes from events - most reliable for contracts with issues
  const directQueryVotes = useCallback(async (proposalId) => {
    if (!contractsReady || !isConnected || !contracts.governance) {
      return null;
    }
    
    try {
      console.log(`Direct query for votes on proposal ${proposalId}`);
      
      // First try to get the proposal details to make sure it exists
      try {
        await contracts.governance.getProposalState(proposalId);
      } catch (err) {
        console.error(`Proposal ${proposalId} doesn't exist or can't be accessed`);
        return null;
      }
      
      // Use VoteCast events - the most reliable method
      const filter = contracts.governance.filters.VoteCast(proposalId);
      const events = await contracts.governance.queryFilter(filter);
      console.log(`Found ${events.length} VoteCast events for proposal ${proposalId}`);
      
      // If no votes at all, return zeros
      if (events.length === 0) {
        return {
          yesVotes: "0",
          noVotes: "0",
          abstainVotes: "0",
          totalVotes: 0,
          totalVoters: 0,
          yesPercentage: 0,
          noPercentage: 0,
          abstainPercentage: 0,
          yesVotingPower: "0",
          noVotingPower: "0",
          abstainVotingPower: "0",
          totalVotingPower: "0",
          source: 'direct-query-no-votes'
        };
      }
      
      // Process each vote event
      const voters = new Map(); // Track unique voters and their latest vote
      let yesTotal = ethers.BigNumber.from(0);
      let noTotal = ethers.BigNumber.from(0);
      let abstainTotal = ethers.BigNumber.from(0);
      
      // Debug logging - show all events
      events.forEach((event, idx) => {
        try {
          console.log(`Vote event ${idx}: `, {
            voter: event.args.voter,
            support: event.args.support.toString(),
            power: ethers.utils.formatEther(event.args.votingPower)
          });
        } catch (err) {
          console.warn(`Error logging vote event ${idx}:`, err);
        }
      });
      
      // Process events to get vote totals
      for (const event of events) {
        try {
          const voter = event.args.voter.toLowerCase();
          const support = Number(event.args.support);
          const power = event.args.votingPower;
          
          // Update the voter map with the latest vote
          voters.set(voter, { support, power });
        } catch (err) {
          console.warn(`Error processing vote event:`, err);
        }
      }
      
      // Calculate totals from the unique voters' latest votes
      for (const [_, voteInfo] of voters.entries()) {
        const { support, power } = voteInfo;
        
        if (support === 1) { // Yes
          yesTotal = yesTotal.add(power);
        } else if (support === 0) { // No
          noTotal = noTotal.add(power);
        } else if (support === 2) { // Abstain
          abstainTotal = abstainTotal.add(power);
        }
      }
      
      // Calculate total voting power and percentages
      const totalVotingPower = yesTotal.add(noTotal).add(abstainTotal);
      let yesPercentage = 0;
      let noPercentage = 0;
      let abstainPercentage = 0;
      
      if (!totalVotingPower.isZero()) {
        yesPercentage = yesTotal.mul(100).div(totalVotingPower).toNumber();
        noPercentage = noTotal.mul(100).div(totalVotingPower).toNumber();
        abstainPercentage = abstainTotal.mul(100).div(totalVotingPower).toNumber();
      }
      
      console.log(`Vote totals from direct query:`, {
        yes: ethers.utils.formatEther(yesTotal),
        no: ethers.utils.formatEther(noTotal),
        abstain: ethers.utils.formatEther(abstainTotal),
        totalVoters: voters.size
      });
      
      return {
        yesVotes: ethers.utils.formatEther(yesTotal),
        noVotes: ethers.utils.formatEther(noTotal),
        abstainVotes: ethers.utils.formatEther(abstainTotal),
        totalVotes: voters.size,
        totalVoters: voters.size,
        yesPercentage,
        noPercentage,
        abstainPercentage,
        yesVotingPower: ethers.utils.formatEther(yesTotal),
        noVotingPower: ethers.utils.formatEther(noTotal),
        abstainVotingPower: ethers.utils.formatEther(abstainTotal),
        totalVotingPower: ethers.utils.formatEther(totalVotingPower),
        source: 'direct-query'
      };
    } catch (error) {
      console.error(`Error in directQueryVotes for proposal ${proposalId}:`, error);
      return null;
    }
  }, [contractsReady, isConnected, contracts]);

  // Get proposal vote totals directly from blockchain
  const getProposalVoteTotals = useCallback(async (proposalId) => {
    if (!contractsReady || !isConnected || !contracts.governance) {
      return {
        yesVotes: 0,
        noVotes: 0,
        abstainVotes: 0,
        totalVoters: 0,
        yesPercentage: 0,
        noPercentage: 0,
        abstainPercentage: 0,
        yesVotingPower: "0",
        noVotingPower: "0",
        abstainVotingPower: "0",
        totalVotingPower: "0"
      };
    }
    
    try {
      console.log(`Fetching vote totals for proposal ${proposalId} using new contract method`);
      
      // Call the new contract method that we just added
      const [yesVotes, noVotes, abstainVotes, totalVotingPower, totalVoters] = 
        await contracts.governance.getProposalVoteTotals(proposalId);
      
      // Convert BigNumber values to strings
      const yesVotesStr = ethers.utils.formatEther(yesVotes);
      const noVotesStr = ethers.utils.formatEther(noVotes);
      const abstainVotesStr = ethers.utils.formatEther(abstainVotes);
      const totalVotingPowerStr = ethers.utils.formatEther(totalVotingPower);
      
      // Calculate percentages
      let yesPercentage = 0;
      let noPercentage = 0;
      let abstainPercentage = 0;
      
      if (!totalVotingPower.isZero()) {
        yesPercentage = yesVotes.mul(100).div(totalVotingPower).toNumber();
        noPercentage = noVotes.mul(100).div(totalVotingPower).toNumber();
        abstainPercentage = abstainVotes.mul(100).div(totalVotingPower).toNumber();
      }
      
      console.log(`Vote data from contract for proposal ${proposalId}:`, {
        yes: yesVotesStr,
        no: noVotesStr,
        abstain: abstainVotesStr,
        totalVoters: totalVoters.toNumber()
      });
      
      return {
        yesVotes: yesVotesStr,
        noVotes: noVotesStr,
        abstainVotes: abstainVotesStr,
        totalVotingPower: totalVotingPowerStr,
        totalVoters: totalVoters.toNumber(),
        yesPercentage,
        noPercentage,
        abstainPercentage,
        yesVotingPower: yesVotesStr,
        noVotingPower: noVotesStr,
        abstainVotingPower: abstainVotesStr,
        source: 'contract-getter'
      };
    } catch (error) {
      console.error(`Error using new getProposalVoteTotals contract method:`, error);
      
      // If the new method fails, fall back to one of our previous methods
      // [You can keep your existing fallback methods here if needed]
      
      return {
        yesVotes: 0,
        noVotes: 0,
        abstainVotes: 0,
        totalVoters: 0,
        yesPercentage: 0,
        noPercentage: 0,
        abstainPercentage: 0,
        yesVotingPower: "0",
        noVotingPower: "0",
        abstainVotingPower: "0",
        totalVotingPower: "0",
        source: 'error'
      };
    }
  }, [contractsReady, isConnected, contracts]);

  // Enhanced function to get detailed proposal vote information
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
      console.log(`Fetching detailed vote data for proposal ${proposalId}`);
      
      // First check if we have a manual override
      if (manualVoteOverrides[proposalId]) {
        const override = manualVoteOverrides[proposalId];
        
        // Add quorum info to the override
        const govParams = await contracts.governance.govParams();
        const quorum = govParams.quorum;
        const totalVotingPower = ethers.utils.parseEther(override.totalVotingPower || "0");
        const quorumReached = quorum.gt(0) ? totalVotingPower.gte(quorum) : false;
        
        return {
          ...override,
          quorumReached,
          requiredQuorum: ethers.utils.formatEther(quorum),
          dataSource: 'manual-override'
        };
      }
      
      // Try direct query first (most reliable)
      try {
        const directQueryResults = await directQueryVotes(proposalId);
        if (directQueryResults) {
          // Get quorum value for comparison
          const govParams = await contracts.governance.govParams();
          const quorum = govParams.quorum;
          const totalVotingPower = ethers.utils.parseEther(directQueryResults.totalVotingPower);
          const quorumReached = quorum.gt(0) ? totalVotingPower.gte(quorum) : false;
          
          return {
            ...directQueryResults,
            quorumReached,
            requiredQuorum: ethers.utils.formatEther(quorum),
            dataSource: 'direct-query',
            totalVotes: directQueryResults.totalVotingPower
          };
        }
      } catch (directQueryError) {
        console.warn(`Direct query failed for detailed proposal ${proposalId}:`, directQueryError);
      }
      
      // Try different methods to get the most reliable data
      // Method 1: Direct contract call to getProposalVotes if available
      try {
        const [yesVotes, noVotes, abstainVotes, totalVotingPower, totalVotersCount] = 
          await contracts.governance.getProposalVotes(proposalId);
        
        // Get quorum value for comparison
        const govParams = await contracts.governance.govParams();
        const quorum = govParams.quorum;
        
        // Calculate total votes and percentages
        const totalVotes = yesVotes.add(noVotes).add(abstainVotes);
        const yesPercentage = totalVotes.gt(0) ? parseFloat(yesVotes.mul(100).div(totalVotes)) : 0;
        const noPercentage = totalVotes.gt(0) ? parseFloat(noVotes.mul(100).div(totalVotes)) : 0;
        const abstainPercentage = totalVotes.gt(0) ? parseFloat(abstainVotes.mul(100).div(totalVotes)) : 0;
        
        // Check if quorum is reached
        const quorumReached = totalVotes.gte(quorum);
        
        // Format values
        const formattedYesVotes = ethers.utils.formatEther(yesVotes);
        const formattedNoVotes = ethers.utils.formatEther(noVotes);
        const formattedAbstainVotes = ethers.utils.formatEther(abstainVotes);
        const formattedTotalVotes = ethers.utils.formatEther(totalVotes);
        
        return {
          yesVotes: formattedYesVotes,
          noVotes: formattedNoVotes,
          abstainVotes: formattedAbstainVotes,
          totalVotes: formattedTotalVotes,
          totalVoters: totalVotersCount.toNumber(),
          yesPercentage,
          noPercentage,
          abstainPercentage,
          quorumReached,
          dataSource: 'contract',
          rawYesVotes: yesVotes.toString(),
          rawNoVotes: noVotes.toString(),
          rawAbstainVotes: abstainVotes.toString(),
          rawTotalVotes: totalVotes.toString(),
          requiredQuorum: ethers.utils.formatEther(quorum),
          yesVotingPower: formattedYesVotes,
          noVotingPower: formattedNoVotes,
          abstainVotingPower: formattedAbstainVotes,
          totalVotingPower: formattedTotalVotes
        };
      } catch (directError) {
        console.warn(`Direct getProposalVotes call failed for proposal ${proposalId}:`, directError);
      }
      
      // Continue with fallbacks as in the original code...
      // Method 2: Try to use VoteCast events
      try {
        const filter = contracts.governance.filters.VoteCast(proposalId);
        const events = await contracts.governance.queryFilter(filter);
        console.log(`Found ${events.length} VoteCast events for proposal ${proposalId}`);
        
        // Process events to calculate vote totals
        const voters = new Map(); // To track unique voters
        let yesVotes = ethers.BigNumber.from(0);
        let noVotes = ethers.BigNumber.from(0);
        let abstainVotes = ethers.BigNumber.from(0);
        
        for (const event of events) {
          try {
            const voter = event.args.voter.toLowerCase();
            const support = event.args.support.toNumber();
            const votingPower = event.args.votingPower;
            
            // Update the voter's most recent vote
            voters.set(voter, { support, votingPower });
          } catch (eventError) {
            console.warn("Error processing vote event:", eventError);
          }
        }
        
        // Tally up the votes
        for (const [, vote] of voters.entries()) {
          if (vote.support === 0) { // Against
            noVotes = noVotes.add(vote.votingPower);
          } else if (vote.support === 1) { // For
            yesVotes = yesVotes.add(vote.votingPower);
          } else if (vote.support === 2) { // Abstain
            abstainVotes = abstainVotes.add(vote.votingPower);
          }
        }
        
        // Get quorum value
        const govParams = await contracts.governance.govParams();
        const quorum = govParams.quorum;
        
        // Calculate totals and percentages
        const totalVotes = yesVotes.add(noVotes).add(abstainVotes);
        const yesPercentage = totalVotes.gt(0) ? parseFloat(yesVotes.mul(100).div(totalVotes)) : 0;
        const noPercentage = totalVotes.gt(0) ? parseFloat(noVotes.mul(100).div(totalVotes)) : 0;
        const abstainPercentage = totalVotes.gt(0) ? parseFloat(abstainVotes.mul(100).div(totalVotes)) : 0;
        
        // Check if quorum is reached
        const quorumReached = totalVotes.gte(quorum);
        
        // Format values
        const formattedYesVotes = ethers.utils.formatEther(yesVotes);
        const formattedNoVotes = ethers.utils.formatEther(noVotes);
        const formattedAbstainVotes = ethers.utils.formatEther(abstainVotes);
        const formattedTotalVotes = ethers.utils.formatEther(totalVotes);
        
        return {
          yesVotes: formattedYesVotes,
          noVotes: formattedNoVotes,
          abstainVotes: formattedAbstainVotes,
          totalVotes: formattedTotalVotes,
          totalVoters: voters.size,
          yesPercentage,
          noPercentage,
          abstainPercentage,
          quorumReached,
          dataSource: 'events',
          rawYesVotes: yesVotes.toString(),
          rawNoVotes: noVotes.toString(),
          rawAbstainVotes: abstainVotes.toString(),
          rawTotalVotes: totalVotes.toString(),
          requiredQuorum: ethers.utils.formatEther(quorum),
          yesVotingPower: formattedYesVotes,
          noVotingPower: formattedNoVotes,
          abstainVotingPower: formattedAbstainVotes,
          totalVotingPower: formattedTotalVotes
        };
      } catch (eventsError) {
        console.error(`Error getting vote data from events for proposal ${proposalId}:`, eventsError);
      }
      
      // If user has voted, use their vote data as absolute minimum
      if (account) {
        try {
          console.log(`Checking current user vote for detailed data on proposal ${proposalId}`);
          const filter = contracts.governance.filters.VoteCast(proposalId, account);
          const events = await contracts.governance.queryFilter(filter);
          
          if (events.length > 0) {
            // Use the most recent vote
            const latestEvent = events[events.length - 1];
            const support = latestEvent.args.support.toNumber();
            const votingPower = latestEvent.args.votingPower;
            
            // Create a result based just on this user's vote
            const yesVotes = support === 1 ? votingPower : ethers.BigNumber.from(0);
            const noVotes = support === 0 ? votingPower : ethers.BigNumber.from(0);
            const abstainVotes = support === 2 ? votingPower : ethers.BigNumber.from(0);
            
            // Get quorum value
            const govParams = await contracts.governance.govParams();
            const quorum = govParams.quorum;
            
            // Check if quorum is reached
            const quorumReached = votingPower.gte(quorum);
            
            console.log(`Found user vote for detailed proposal ${proposalId}:`, {
              support,
              power: ethers.utils.formatEther(votingPower)
            });
            
            return {
              yesVotes: ethers.utils.formatEther(yesVotes),
              noVotes: ethers.utils.formatEther(noVotes),
              abstainVotes: ethers.utils.formatEther(abstainVotes),
              totalVotes: ethers.utils.formatEther(votingPower),
              totalVoters: 1,
              yesPercentage: support === 1 ? 100 : 0,
              noPercentage: support === 0 ? 100 : 0,
              abstainPercentage: support === 2 ? 100 : 0,
              quorumReached: quorumReached,
              dataSource: 'user-vote-only',
              rawYesVotes: yesVotes.toString(),
              rawNoVotes: noVotes.toString(),
              rawAbstainVotes: abstainVotes.toString(),
              rawTotalVotes: votingPower.toString(),
              requiredQuorum: ethers.utils.formatEther(quorum),
              yesVotingPower: ethers.utils.formatEther(yesVotes),
              noVotingPower: ethers.utils.formatEther(noVotes),
              abstainVotingPower: ethers.utils.formatEther(abstainVotes),
              totalVotingPower: ethers.utils.formatEther(votingPower)
            };
          }
        } catch (userVoteError) {
          console.warn(`Error checking user vote for detailed proposal ${proposalId}:`, userVoteError);
        }
      }
      
      // If all methods fail, return zeros
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
        dataSource: 'fallback'
      };
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
  }, [contractsReady, isConnected, contracts, directQueryVotes, account]);

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
      
      return {
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

  // Function to manually refresh data
  const refreshData = useCallback(() => {
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