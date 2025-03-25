// src/hooks/useVoting.js - Enhanced version to ensure we get voting data properly
import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../contexts/Web3Context';
import { useBlockchainData } from '../contexts/BlockchainDataContext';
import { VOTE_TYPES } from '../utils/constants';
import blockchainDataCache from '../utils/blockchainDataCache';

export function useVoting() {
  const { contracts, account, isConnected, contractsReady } = useWeb3();
  const { hasVoted: contextHasVoted, getProposalVoteTotals: contextGetVoteTotals, refreshData } = useBlockchainData();
  
  const [voting, setVoting] = useState({
    loading: false,
    processing: false,
    error: null,
    success: false,
    lastVotedProposalId: null
  });
  
  // Get the snapshot ID for a proposal using events
  const getProposalSnapshotId = useCallback(async (proposalId) => {
    if (!contracts.governance) return 0;
    
    try {
      // Try to get from cache first
      const cacheKey = `snapshot-${proposalId}`;
      const cachedId = blockchainDataCache.get(cacheKey);
      if (cachedId !== null) {
        return cachedId;
      }
      
      // Try to find the creation event for this proposal
      const filter = contracts.governance.filters.ProposalEvent(proposalId, 0); // Type 0 is creation event
      const events = await contracts.governance.queryFilter(filter);
      
      if (events.length > 0) {
        const creationEvent = events[0];
        
        // Try to decode the data which contains type and snapshotId
        try {
          const data = creationEvent.args.data;
          const decoded = ethers.utils.defaultAbiCoder.decode(['uint8', 'uint256'], data);
          const snapshotId = decoded[1].toNumber(); // The snapshotId is the second parameter
          
          // Cache the result
          blockchainDataCache.set(cacheKey, snapshotId);
          
          return snapshotId;
        } catch (decodeErr) {
          console.warn("Couldn't decode event data for snapshot ID:", decodeErr);
        }
      }
      
      // If we can't get it from events, try to get the current snapshot as fallback
      const currentSnapshot = await contracts.justToken.getCurrentSnapshotId();
      
      // Cache the result
      blockchainDataCache.set(cacheKey, currentSnapshot);
      
      return currentSnapshot;
    } catch (err) {
      console.warn("Error getting proposal snapshot ID:", err);
      // Return the current snapshot as fallback
      try {
        return await contracts.justToken.getCurrentSnapshotId();
      } catch (fallbackErr) {
        console.error("Error getting current snapshot ID:", fallbackErr);
        return 0;
      }
    }
  }, [contracts]);

  // Check if user has voted on a specific proposal - delegate to the context
  const hasVoted = useCallback(async (proposalId) => {
    // Try to get from cache first
    const cacheKey = `hasVoted-${account}-${proposalId}`;
    const cachedResult = blockchainDataCache.get(cacheKey);
    if (cachedResult !== null) {
      return cachedResult;
    }
    
    // Get from context/blockchain if not cached
    const result = await contextHasVoted(proposalId);
    
    // Cache the result
    blockchainDataCache.set(cacheKey, result);
    
    return result;
  }, [contextHasVoted, account]);
  
  // Get the voting power of the user for a specific snapshot
  const getVotingPower = useCallback(async (snapshotId) => {
    if (!isConnected || !contractsReady || !account) return "0";
    if (!contracts.justToken) return "0";
    
    try {
      // Try to get from cache first
      const cacheKey = `votingPower-${account}-${snapshotId}`;
      const cachedPower = blockchainDataCache.get(cacheKey);
      if (cachedPower !== null) {
        return cachedPower;
      }
      
      console.log(`Getting voting power for snapshot ${snapshotId}`);
      
      // If no snapshot ID is provided, get the current one
      let actualSnapshotId = snapshotId;
      
      if (!actualSnapshotId) {
        actualSnapshotId = await contracts.justToken.getCurrentSnapshotId();
      }
      
      const votingPower = await contracts.justToken.getEffectiveVotingPower(account, actualSnapshotId);
      const formattedPower = ethers.utils.formatEther(votingPower);
      
      console.log(`Voting power at snapshot ${actualSnapshotId}: ${formattedPower}`);
      
      // Cache the result
      blockchainDataCache.set(cacheKey, formattedPower);
      
      return formattedPower;
    } catch (err) {
      console.error("Error getting voting power:", err);
      return "0";
    }
  }, [contracts, account, isConnected, contractsReady]);
  
  // Get detailed information about how a user voted on a proposal
  const getVoteDetails = useCallback(async (proposalId) => {
    if (!isConnected || !contractsReady || !account) {
      return { hasVoted: false, votingPower: "0", voteType: null };
    }
    
    try {
      // Try to get from cache first
      const cacheKey = `voteDetails-${account}-${proposalId}`;
      const cachedDetails = blockchainDataCache.get(cacheKey);
      if (cachedDetails !== null) {
        return cachedDetails;
      }
      
      // First check if the user has voted
      const voterInfo = await contracts.governance.proposalVoterInfo(proposalId, account);
      
      if (voterInfo.isZero()) {
        const result = { hasVoted: false, votingPower: "0", voteType: null };
        blockchainDataCache.set(cacheKey, result);
        return result;
      }
      
      // Try to determine how they voted by checking events
      const votingPower = ethers.utils.formatEther(voterInfo);
      let voteType = null;
      
      try {
        // Check for VoteCast events for this proposal and user
        const filter = contracts.governance.filters.VoteCast(proposalId, account);
        const events = await contracts.governance.queryFilter(filter);
        
        if (events.length > 0) {
          // Use the most recent vote event
          const latestEvent = events[events.length - 1];
          voteType = latestEvent.args.support;
        }
      } catch (err) {
        console.warn("Couldn't determine vote type from events:", err);
      }
      
      const result = {
        hasVoted: true,
        votingPower: votingPower,
        voteType: voteType
      };
      
      // Cache the result
      blockchainDataCache.set(cacheKey, result);
      
      return result;
    } catch (err) {
      console.error("Error getting vote details:", err);
      return { hasVoted: false, votingPower: "0", voteType: null };
    }
  }, [contracts, account, isConnected, contractsReady]);

  // Enhanced getProposalVoteTotals function with better fallback options
  const getProposalVoteTotals = useCallback(async (proposalId) => {
    if (!contractsReady || !isConnected || !contracts.governance) {
      return {
        // Use consistent string format for all voting power values
        yesVotes: "0",
        noVotes: "0",
        abstainVotes: "0",
        totalVoters: 0,
        yesPercentage: 0,
        noPercentage: 0,
        abstainPercentage: 0,
        yesVotingPower: "0",
        noVotingPower: "0",
        abstainVotingPower: "0",
        totalVotingPower: "0",
        source: 'not-connected'
      };
    }
    
    try {
      console.log(`Fetching vote totals for proposal ${proposalId} using governance contract`);
      
      // Try to get from cache first to avoid excessive blockchain queries
      const cacheKey = `voteTotals-${proposalId}`;
      const cachedData = blockchainDataCache.get(cacheKey);
      if (cachedData !== null) {
        return cachedData;
      }
      
      // Call the contract method to get voting power values
      // Note: In this governance system, all vote counts are weighted by JST token voting power
      const [yesVotes, noVotes, abstainVotes, totalVotingPower, totalVoters] = 
        await contracts.governance.getProposalVoteTotals(proposalId);
      
      // Convert BigNumber values to formatted strings (representing JST tokens)
      const yesVotingPower = ethers.utils.formatEther(yesVotes);
      const noVotingPower = ethers.utils.formatEther(noVotes);
      const abstainVotingPower = ethers.utils.formatEther(abstainVotes);
      const totalVotingPowerStr = ethers.utils.formatEther(totalVotingPower);
      
      // Calculate percentages based on voting power
      let yesPercentage = 0;
      let noPercentage = 0;
      let abstainPercentage = 0;
      
      if (!totalVotingPower.isZero()) {
        yesPercentage = yesVotes.mul(100).div(totalVotingPower).toNumber();
        noPercentage = noVotes.mul(100).div(totalVotingPower).toNumber();
        abstainPercentage = abstainVotes.mul(100).div(totalVotingPower).toNumber();
      }
      
      console.log(`Vote data from contract for proposal ${proposalId}:`, {
        yesVotingPower,
        noVotingPower,
        abstainVotingPower,
        totalVoters: totalVoters.toNumber()
      });
      
      // Create the result object
      const result = {
        // For backward compatibility, include yesVotes/noVotes/abstainVotes fields
        // These are the same as the voting power values
        yesVotes: yesVotingPower,
        noVotes: noVotingPower,
        abstainVotes: abstainVotingPower,
        totalVotingPower: totalVotingPowerStr,
        totalVoters: totalVoters.toNumber(),
        yesPercentage,
        noPercentage,
        abstainPercentage,
        
        // Explicit voting power fields with the same values
        yesVotingPower,
        noVotingPower,
        abstainVotingPower,
        source: 'contract-getter'
      };
      
      // Cache the result
      blockchainDataCache.set(cacheKey, result, 3600); // Cache for 1 hour
      
      return result;
    } catch (error) {
      console.error(`Error using getProposalVoteTotals contract method:`, error);
      
      // Try to get vote data from proposal events as fallback
      try {
        return await getIndexedVoteData(proposalId);
      } catch (fallbackError) {
        console.error(`Fallback method also failed for proposal ${proposalId}:`, fallbackError);
        
        // If all methods fail, return consistent zero values
        return {
          yesVotes: "0",
          noVotes: "0",
          abstainVotes: "0",
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
    }
  }, [contractsReady, isConnected, contracts]);
  
  // Cast a vote using blockchain and handle state changes
  const castVote = async (proposalId, voteType) => {
    if (!isConnected || !contractsReady) throw new Error("Not connected to blockchain");
    if (!contracts.governance) throw new Error("Governance contract not initialized");
    
    try {
      setVoting({ 
        loading: true,
        processing: true,
        error: null, 
        success: false,
        lastVotedProposalId: null
      });
      
      console.log(`Attempting to cast vote on proposal #${proposalId} with vote type ${voteType}`);
      
      // Validate vote type
      if (![VOTE_TYPES.AGAINST, VOTE_TYPES.FOR, VOTE_TYPES.ABSTAIN].includes(Number(voteType))) {
        throw new Error("Invalid vote type. Must be 0 (Against), 1 (For), or 2 (Abstain)");
      }
      
      // Check if the user has already voted on the blockchain
      const hasAlreadyVoted = await hasVoted(proposalId);
      if (hasAlreadyVoted) {
        throw new Error("You have already voted on this proposal");
      }
      
      // Check if the proposal is active
      const proposalState = await contracts.governance.getProposalState(proposalId);
      if (proposalState !== 0) { // 0 = Active
        throw new Error("Proposal is not active. Cannot vote on inactive proposals.");
      }
      
      // Get the snapshot ID
      const snapshotId = await getProposalSnapshotId(proposalId);
      
      // Check if the user has any voting power
      const votingPower = await contracts.justToken.getEffectiveVotingPower(account, snapshotId);
      const votingPowerFormatted = ethers.utils.formatEther(votingPower);
      
      if (votingPower.isZero()) {
        throw new Error("You don't have any voting power for this proposal. You may need to delegate to yourself or acquire tokens before the snapshot.");
      }
      
      console.log(`Casting vote with ${votingPowerFormatted} voting power`);
      
      // Cast the vote with proper gas limit to prevent issues
      const tx = await contracts.governance.castVote(proposalId, voteType, {
        gasLimit: 300000 // Set a reasonable gas limit
      });
      
      // Wait for transaction to be confirmed
      const receipt = await tx.wait();
      console.log("Vote transaction confirmed:", receipt.transactionHash);
      
      // Clear cache entries related to this proposal and user's votes
      blockchainDataCache.delete(`hasVoted-${account}-${proposalId}`);
      blockchainDataCache.delete(`voteDetails-${account}-${proposalId}`);
      blockchainDataCache.delete(`voteTotals-${proposalId}`);
      blockchainDataCache.delete(`dashboard-votes-${proposalId}`);
      
      // Refresh blockchain data to update state
      refreshData();
      
      // Wait briefly to allow the blockchain to update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setVoting({ 
        loading: false,
        processing: false, 
        error: null, 
        success: true,
        lastVotedProposalId: proposalId
      });
      
      return {
        success: true,
        votingPower: votingPowerFormatted,
        voteType,
        transactionHash: receipt.transactionHash
      };
    } catch (err) {
      console.error("Error casting vote:", err);
      const errorMessage = err.reason || err.message || "Unknown error";
      
      setVoting({ 
        loading: false,
        processing: false,
        error: errorMessage, 
        success: false,
        lastVotedProposalId: null
      });
      
      throw err;
    }
  };

  // Get vote data using event indexing (backup method)
  const getIndexedVoteData = useCallback(async (proposalId) => {
    try {
      // Try to get from cache first
      const cacheKey = `indexedVotes-${proposalId}`;
      const cachedData = blockchainDataCache.get(cacheKey);
      if (cachedData !== null) {
        return cachedData;
      }
      
      // Get all VoteCast events for this proposal
      const filter = contracts.governance.filters.VoteCast(proposalId);
      const events = await contracts.governance.queryFilter(filter);
      
      // Use maps to track the latest vote for each voter
      const voterVotes = new Map(); // address -> {type, power}
      
      // Process all events to build an accurate picture
      for (const event of events) {
        const { voter, support, votingPower } = event.args;
        const voterAddress = voter.toLowerCase();
        const powerValue = ethers.utils.formatEther(votingPower);
        
        // Store or update this voter's vote (only most recent)
        voterVotes.set(voterAddress, {
          type: Number(support),
          power: powerValue
        });
      }
      
      // Count voters and voting power by type
      let votesByType = {0: 0, 1: 0, 2: 0}; // Counts
      let votingPowerByType = {0: 0, 1: 0, 2: 0}; // Power
      
      for (const [, voteData] of voterVotes.entries()) {
        const { type, power } = voteData;
        votesByType[type]++;
        votingPowerByType[type] += parseFloat(power);
      }
      
      // Calculate totals
      const totalVotes = votesByType[0] + votesByType[1] + votesByType[2];
      const totalVotingPower = votingPowerByType[0] + votingPowerByType[1] + votingPowerByType[2];
      
      const result = {
        // Vote counts (1 per person)
        yesVotes: votingPowerByType[1].toString(),
        noVotes: votingPowerByType[0].toString(),
        abstainVotes: votingPowerByType[2].toString(),
        totalVotes,
        
        // Voting power
        yesVotingPower: votingPowerByType[1].toString(),
        noVotingPower: votingPowerByType[0].toString(),
        abstainVotingPower: votingPowerByType[2].toString(),
        totalVotingPower: totalVotingPower.toString(),
        
        // Total unique voters
        totalVoters: voterVotes.size,
        
        // Percentages based on voting power (not vote counts)
        yesPercentage: totalVotingPower > 0 ? (votingPowerByType[1] / totalVotingPower) * 100 : 0,
        noPercentage: totalVotingPower > 0 ? (votingPowerByType[0] / totalVotingPower) * 100 : 0,
        abstainPercentage: totalVotingPower > 0 ? (votingPowerByType[2] / totalVotingPower) * 100 : 0,
        
        // Flag for source of data
        source: 'events'
      };
      
      // Cache the result
      blockchainDataCache.set(cacheKey, result, 3600); // Cache for 1 hour
      
      return result;
    } catch (error) {
      console.error("Error indexing vote data:", error);
      
      // Return empty data structure as fallback
      return {
        yesVotes: "0",
        noVotes: "0",
        abstainVotes: "0",
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
  }, [contracts]);

  return {
    castVote,
    hasVoted,
    getVotingPower,
    getVoteDetails,
    getProposalVoteTotals,
    getIndexedVoteData,
    voting
  };
}

// Also export as default for components using default import
export default useVoting;