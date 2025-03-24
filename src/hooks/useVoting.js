// src/hooks/useVoting.js - Enhanced version that uses BlockchainDataContext
import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../contexts/Web3Context';
import { useBlockchainData } from '../contexts/BlockchainDataContext';
import { VOTE_TYPES } from '../utils/constants';

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
      // Try to find the creation event for this proposal
      const filter = contracts.governance.filters.ProposalEvent(proposalId, 0); // Type 0 is creation event
      const events = await contracts.governance.queryFilter(filter);
      
      if (events.length > 0) {
        const creationEvent = events[0];
        
        // Try to decode the data which contains type and snapshotId
        try {
          const data = creationEvent.args.data;
          const decoded = ethers.utils.defaultAbiCoder.decode(['uint8', 'uint256'], data);
          return decoded[1].toNumber(); // The snapshotId is the second parameter
        } catch (decodeErr) {
          console.warn("Couldn't decode event data for snapshot ID:", decodeErr);
        }
      }
      
      // If we can't get it from events, try to get the current snapshot as fallback
      return await contracts.justToken.getCurrentSnapshotId();
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
    return await contextHasVoted(proposalId);
  }, [contextHasVoted]);
  
  // Get the voting power of the user for a specific snapshot
  const getVotingPower = useCallback(async (snapshotId) => {
    if (!isConnected || !contractsReady || !account) return "0";
    if (!contracts.justToken) return "0";
    
    try {
      console.log(`Getting voting power for snapshot ${snapshotId}`);
      
      // If no snapshot ID is provided, get the current one
      let actualSnapshotId = snapshotId;
      
      if (!actualSnapshotId) {
        actualSnapshotId = await contracts.justToken.getCurrentSnapshotId();
      }
      
      const votingPower = await contracts.justToken.getEffectiveVotingPower(account, actualSnapshotId);
      const formattedPower = ethers.utils.formatEther(votingPower);
      
      console.log(`Voting power at snapshot ${actualSnapshotId}: ${formattedPower}`);
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
      // First check if the user has voted
      const voterInfo = await contracts.governance.proposalVoterInfo(proposalId, account);
      
      if (voterInfo.isZero()) {
        return { hasVoted: false, votingPower: "0", voteType: null };
      }
      
      // Try to determine how they voted by checking events
      const votingPower = ethers.utils.formatEther(voterInfo);
      let voteType = null;
      
      try {
        // Check for VoteCast events for this proposal and user
        const filter = contracts.governance.filters.VoteCast(proposalId, account);
        const events = await contracts.governance.queryFilter(filter);
        
        if (events.length > 0) {
          // Use the most recent vote (in case of any issues)
          const latestEvent = events[events.length - 1];
          voteType = latestEvent.args.support;
        }
      } catch (err) {
        console.warn("Couldn't determine vote type from events:", err);
      }
      
      return {
        hasVoted: true,
        votingPower: votingPower,
        voteType: voteType
      };
    } catch (err) {
      console.error("Error getting vote details:", err);
      return { hasVoted: false, votingPower: "0", voteType: null };
    }
  }, [contracts, account, isConnected, contractsReady]);

  // Delegate to the context to get proposal vote totals
  const getProposalVoteTotals = useCallback(async (proposalId) => {
    return await contextGetVoteTotals(proposalId);
  }, [contextGetVoteTotals]);
  
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
      // Get all VoteCast events for this proposal
      const filter = contracts.governance.filters.VoteCast(proposalId);
      const events = await contracts.governance.queryFilter(filter);
      
      // Use maps to track the latest vote for each voter
      const voterVotes = new Map(); // address -> {type, power}
      
      // Process all events to build an accurate picture
      for (const event of events) {
        const { voter, support, votingPower } = event.args;
        const voterAddress = voter.toLowerCase();
        const powerValue = parseFloat(ethers.utils.formatEther(votingPower));
        
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
        votingPowerByType[type] += power;
      }
      
      // Calculate totals
      const totalVotes = votesByType[0] + votesByType[1] + votesByType[2];
      const totalVotingPower = votingPowerByType[0] + votingPowerByType[1] + votingPowerByType[2];
      
      return {
        // Vote counts (1 per person)
        yesVotes: votesByType[1],
        noVotes: votesByType[0],
        abstainVotes: votesByType[2],
        totalVotes,
        
        // Voting power
        yesVotingPower: votingPowerByType[1],
        noVotingPower: votingPowerByType[0],
        abstainVotingPower: votingPowerByType[2],
        totalVotingPower,
        
        // Total unique voters
        totalVoters: voterVotes.size,
        
        // Percentages based on voting power (not vote counts)
        yesPercentage: totalVotingPower > 0 ? (votingPowerByType[1] / totalVotingPower) * 100 : 0,
        noPercentage: totalVotingPower > 0 ? (votingPowerByType[0] / totalVotingPower) * 100 : 0,
        abstainPercentage: totalVotingPower > 0 ? (votingPowerByType[2] / totalVotingPower) * 100 : 0,
        
        // Flag for source of data
        fromEvents: true
      };
    } catch (error) {
      console.error("Error indexing vote data:", error);
      return null;
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