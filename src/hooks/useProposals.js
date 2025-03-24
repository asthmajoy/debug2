// src/hooks/useProposals.js - Updated to work with new contract naming
import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../contexts/Web3Context';
import { PROPOSAL_STATES, PROPOSAL_TYPES } from '../utils/constants';

export function useProposals() {
  const { contracts, account, isConnected, contractsReady, refreshCounter } = useWeb3();
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tokenHolders, setTokenHolders] = useState([]);
  const [createProposalStatus, setCreateProposalStatus] = useState({
    isSubmitting: false,
    error: null,
    success: false,
    debug: null
  });

  // Helper function to check vote details
  const getVoteDetails = useCallback(async (proposalId, voter) => {
    try {
      // Check if the user has voting power allocated to this proposal
      const votingPower = await contracts.governance.proposalVoterInfo(proposalId, voter);
      
      if (votingPower.isZero()) {
        return { hasVoted: false, voteType: null, votingPower: "0" };
      }
      
      // Try to determine how they voted using events or direct query if available
      let voteType = null;
      
      try {
        // Try querying VoteCast events for this proposal and voter
        const filter = contracts.governance.filters.VoteCast(proposalId, voter);
        const events = await contracts.governance.queryFilter(filter);
        
        if (events.length > 0) {
          // Use the most recent vote event
          const latestEvent = events[events.length - 1];
          voteType = latestEvent.args.support;
        }
      } catch (err) {
        console.warn("Couldn't determine vote type from events:", err);
      }
      
      return {
        hasVoted: true,
        voteType: voteType !== null ? Number(voteType) : null,
        votingPower: ethers.utils.formatEther(votingPower)
      };
    } catch (err) {
      console.error("Error getting vote details:", err);
      return { hasVoted: false, voteType: null, votingPower: "0" };
    }
  }, [contracts]);

  // Helper function to extract title and description
  const extractTitleAndDescription = useCallback((rawDescription) => {
    if (!rawDescription) return { title: "Untitled Proposal", description: "No description available" };
    
    // Split by newline to get title and description
    const parts = rawDescription.split('\n');
    let title = parts[0].trim();
    
    // If title is too long, use the first part of it
    if (title.length > 80) {
      title = title.substring(0, 77) + "...";
    }
    
    // Get the full description
    const description = rawDescription.trim();
    
    return { title, description };
  }, []);

  // Helper function to get human-readable proposal state label
  const getProposalStateLabel = useCallback((state) => {
    const stateLabels = {
      [PROPOSAL_STATES.ACTIVE]: "Active",
      [PROPOSAL_STATES.CANCELED]: "Canceled",
      [PROPOSAL_STATES.DEFEATED]: "Defeated",
      [PROPOSAL_STATES.SUCCEEDED]: "Succeeded",
      [PROPOSAL_STATES.QUEUED]: "Queued",
      [PROPOSAL_STATES.EXECUTED]: "Executed",
      [PROPOSAL_STATES.EXPIRED]: "Expired"
    };
    
    return stateLabels[state] || "Unknown";
  }, []);

  // Helper function to get human-readable proposal type label
  const getProposalTypeLabel = useCallback((type) => {
    const typeLabels = {
      [PROPOSAL_TYPES.GENERAL]: "General",
      [PROPOSAL_TYPES.WITHDRAWAL]: "Withdrawal",
      [PROPOSAL_TYPES.TOKEN_TRANSFER]: "Token Transfer",
      [PROPOSAL_TYPES.GOVERNANCE_CHANGE]: "Governance Change",
      [PROPOSAL_TYPES.EXTERNAL_ERC20_TRANSFER]: "External ERC20 Transfer",
      [PROPOSAL_TYPES.TOKEN_MINT]: "Token Mint",
      [PROPOSAL_TYPES.TOKEN_BURN]: "Token Burn"
    };
    
    return typeLabels[type] || "Unknown";
  }, []);

  // Enhanced function to get proposal details including transaction data
  const getProposalDetailsFromEvents = useCallback(async (proposalId) => {
    try {
      // First check if the proposal exists by getting its state
      const proposalState = await contracts.governance.getProposalState(proposalId);
      
      // Look for the transaction that created this proposal
      // This will give us access to the input data which contains all proposal details
      const provider = contracts.governance.provider;
      
      // Create a filter for ProposalEvent events related to this proposal
      const filter = contracts.governance.filters.ProposalEvent(proposalId, 0); // Type 0 is creation event
      const events = await contracts.governance.queryFilter(filter);
      
      if (events.length === 0) {
        // If no events found, create a minimal proposal object
        return {
          id: proposalId,
          title: `Proposal #${proposalId}`,
          description: "No description available",
          state: proposalState,
          stateLabel: getProposalStateLabel(proposalState),
          type: PROPOSAL_TYPES.GENERAL,
          typeLabel: getProposalTypeLabel(PROPOSAL_TYPES.GENERAL),
          yesVotes: "0",
          noVotes: "0",
          abstainVotes: "0",
          hasVoted: false,
          snapshotId: 0,
          target: ethers.constants.AddressZero,
          callData: "0x",
          proposer: ethers.constants.AddressZero,
          createdAt: new Date(),
          deadline: new Date(Date.now() + 3*24*60*60*1000) // Default 3 day deadline
        };
      }
      
      // Get the creation event
      const creationEvent = events[0];
      
      // Get the transaction that created the proposal
      const txHash = creationEvent.transactionHash;
      const tx = await provider.getTransaction(txHash);
      const txReceipt = await provider.getTransactionReceipt(txHash);
      
      // Get timestamp for the block
      const block = await provider.getBlock(txReceipt.blockNumber);
      const createdAt = new Date(block.timestamp * 1000);
      
      // Parse the input data to get proposal details
      // The createProposal function signature looks like:
      // createProposal(string calldata description, ProposalType proposalType, address target, bytes calldata callData, 
      //                uint256 amount, address payable recipient, address externalToken, uint256 newThreshold, 
      //                uint256 newQuorum, uint256 newVotingDuration, uint256 newTimelockDelay)
      
      let proposalDescription = "No description available";
      let proposalType = PROPOSAL_TYPES.GENERAL;
      let target = ethers.constants.AddressZero;
      let callData = "0x";
      let amount = "0";
      let recipient = ethers.constants.AddressZero;
      let externalToken = ethers.constants.AddressZero;
      
      try {
        // Create the interface for decoding
        const iface = new ethers.utils.Interface([
          "function createProposal(string description, uint8 proposalType, address target, bytes callData, uint256 amount, address recipient, address externalToken, uint256 newThreshold, uint256 newQuorum, uint256 newVotingDuration, uint256 newTimelockDelay) returns (uint256)"
        ]);
        
        // Decode the input data
        const decodedData = iface.parseTransaction({ data: tx.data });
        
        if (decodedData && decodedData.args) {
          proposalDescription = decodedData.args[0] || proposalDescription;
          proposalType = decodedData.args[1] !== undefined ? Number(decodedData.args[1]) : proposalType;
          target = decodedData.args[2] || target;
          callData = decodedData.args[3] || callData;
          amount = decodedData.args[4] ? ethers.utils.formatEther(decodedData.args[4]) : amount;
          recipient = decodedData.args[5] || recipient;
          externalToken = decodedData.args[6] || externalToken;
        }
      } catch (decodeErr) {
        console.warn("Couldn't decode transaction data:", decodeErr);
      }
      
      // Get more data from the creation event
      const proposer = creationEvent.args.actor;
      let snapshotId = 0;
      
      // Try to decode the data field which contains type and snapshotId
      try {
        const data = creationEvent.args.data;
        const decoded = ethers.utils.defaultAbiCoder.decode(['uint8', 'uint256'], data);
        proposalType = Number(decoded[0]);
        snapshotId = decoded[1].toNumber();
      } catch (err) {
        console.warn("Couldn't decode event data:", err);
      }
      
      // Try to get vote counts (this is challenging without direct access)
      let yesVotes = "0";
      let noVotes = "0";
      let abstainVotes = "0";
      
      // Look for vote events (event type 6)
      const voteFilter = contracts.governance.filters.ProposalEvent(proposalId, 6); // Type 6 is vote event
      const voteEvents = await contracts.governance.queryFilter(voteFilter);
      
      // Aggregate votes from events
      for (const event of voteEvents) {
        try {
          const data = event.args.data;
          const decoded = ethers.utils.defaultAbiCoder.decode(['uint8', 'uint256'], data);
          const voteType = decoded[0].toNumber();
          const votePower = ethers.utils.formatEther(decoded[1]);
          
          if (voteType === 1) { // FOR
            yesVotes = (parseFloat(yesVotes) + parseFloat(votePower)).toString();
          } else if (voteType === 0) { // AGAINST
            noVotes = (parseFloat(noVotes) + parseFloat(votePower)).toString();
          } else if (voteType === 2) { // ABSTAIN
            abstainVotes = (parseFloat(abstainVotes) + parseFloat(votePower)).toString();
          }
        } catch (err) {
          console.warn("Couldn't decode vote event:", err);
        }
      }
      
      // Calculate deadline based on voting duration (from governance parameters)
      let deadline = new Date(createdAt);
      try {
        const govParams = await contracts.governance.govParams();
        deadline = new Date(createdAt.getTime() + (govParams.votingDuration.toNumber() * 1000));
      } catch (err) {
        console.warn("Couldn't get voting duration:", err);
        // Default to 3 days if we can't get the actual duration
        deadline = new Date(createdAt.getTime() + (3 * 24 * 60 * 60 * 1000));
      }
      
      // Check if the user has voted on this proposal
      let hasVoted = false;
      let votedYes = false;
      let votedNo = false;
      let votedAbstain = false;
      
      if (account) {
        try {
          const voteDetails = await getVoteDetails(proposalId, account);
          hasVoted = voteDetails.hasVoted;
          votedYes = voteDetails.voteType === 1;  // FOR
          votedNo = voteDetails.voteType === 0;   // AGAINST
          votedAbstain = voteDetails.voteType === 2; // ABSTAIN
        } catch (err) {
          console.warn(`Error checking vote status for proposal ${proposalId}:`, err);
        }
      }
      
      // Extract title and description
      const { title, description } = extractTitleAndDescription(proposalDescription);
      
      // Check for timelock transaction hash in queued event
      let timelockTxHash = ethers.constants.HashZero;
      const queuedFilter = contracts.governance.filters.ProposalEvent(proposalId, 2); // Type 2 is queued event
      const queuedEvents = await contracts.governance.queryFilter(queuedFilter);
      
      if (queuedEvents.length > 0) {
        try {
          const data = queuedEvents[0].args.data;
          const decoded = ethers.utils.defaultAbiCoder.decode(['bytes32'], data);
          timelockTxHash = decoded[0];
        } catch (err) {
          console.warn("Couldn't decode queued event:", err);
        }
      }
      
      return {
        id: proposalId,
        title: title || `Proposal #${proposalId}`,
        description: description || "No description available",
        proposer,
        deadline,
        createdAt,
        state: proposalState,
        stateLabel: getProposalStateLabel(proposalState),
        type: proposalType,
        typeLabel: getProposalTypeLabel(proposalType),
        yesVotes,
        noVotes,
        abstainVotes,
        timelockTxHash,
        hasVoted,
        votedYes,
        votedNo,
        votedAbstain,
        snapshotId,
        target,
        callData,
        recipient,
        amount,
        token: externalToken
      };
    } catch (err) {
      console.warn(`Error loading proposal ${proposalId}:`, err);
      return null;
    }
  }, [contracts, account, getProposalStateLabel, getProposalTypeLabel, getVoteDetails, extractTitleAndDescription]);

  // Helper function to extract meaningful error messages
  const extractErrorMessage = (error) => {
    console.log("Raw error:", error);
    
    // For JSON-RPC errors
    if (error.code && error.message) {
      if (error.code === 'ACTION_REJECTED') {
        return "Transaction was rejected by the user";
      }
      
      if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
        return "The transaction may fail. Your proposal could be invalid, or there might be an issue with the contract.";
      }
      
      if (error.code === -32603 || error.code === 'CALL_EXCEPTION') {
        // Try to extract the revert reason
        if (error.data && typeof error.data === 'object') {
          return `Contract error: ${error.data.message || JSON.stringify(error.data)}`;
        }
      }
    }
    
    // For error objects with a message property
    if (error.message) {
      if (error.message.includes("insufficient funds")) {
        return "You don't have enough ETH to pay for this transaction. Please add funds to your wallet.";
      }
      
      if (error.message.includes("user rejected")) {
        return "Transaction rejected by user.";
      }
      
      // Try to extract the revert reason from error message
      const revertMatch = error.message.match(/reverted with reason string ["'](.+)["']/);
      if (revertMatch && revertMatch[1]) {
        return `Smart contract reverted: ${revertMatch[1]}`;
      }
      
      // For custom errors (non-string errors)
      const customErrorMatch = error.message.match(/reverted with custom error ["'](.+)["']/);
      if (customErrorMatch && customErrorMatch[1]) {
        return `Smart contract error: ${customErrorMatch[1]}`;
      }
      
      // For decoded errors
      if (error.message.includes("InsufficientBalance")) {
        return "You don't have enough JUST tokens to create this proposal.";
      }
      
      if (error.message.includes("TransferFailed")) {
        return "Token transfer failed. Make sure you've approved the governance contract to use your tokens.";
      }
      
      if (error.message.includes("NotAuthorized")) {
        return "You're not authorized to perform this action.";
      }
      
      if (error.message.includes("ZeroAddress")) {
        return "Invalid address: cannot use zero address.";
      }
      
      if (error.message.includes("InvalidAmount")) {
        return "Invalid amount: must be greater than zero.";
      }
      
      if (error.message.includes("InvalidCalldata")) {
        return "Invalid calldata: function selector is missing or malformed.";
      }
    }
    
    // Default case
    return `Failed to create proposal: ${error.message || error}`;
  };

  // Fetch proposals using enhanced approach
  const fetchProposals = useCallback(async () => {
    if (!isConnected || !contractsReady || !contracts.governance) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      console.log("Fetching proposals from governance contract...");
      
      // Find the upper limit of proposal IDs more efficiently
      let maxId = -1;
      try {
        // Try a binary search approach to find the highest valid proposal ID
        let low = 0;
        let high = 100; // Start with a reasonable upper bound
        
        // First, find an upper bound that's definitely too high
        let foundTooHigh = false;
        while (!foundTooHigh) {
          try {
            await contracts.governance.getProposalState(high);
            // If this succeeds, our high is still valid, double it
            low = high;
            high = high * 2;
            if (high > 10000) {
              // Set a reasonable maximum to prevent infinite loops
              foundTooHigh = true;
            }
          } catch (err) {
            // Found a proposal ID that doesn't exist
            foundTooHigh = true;
          }
        }
        
        // Now do binary search between known low and high
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          
          try {
            await contracts.governance.getProposalState(mid);
            // If we can get the state, this ID exists
            low = mid + 1;
          } catch (err) {
            // If we can't get the state, this ID doesn't exist
            high = mid - 1;
          }
        }
        
        maxId = high; // The highest valid proposal ID
        console.log("Highest valid proposal ID:", maxId);
      } catch (err) {
        console.error("Error finding max proposal ID:", err);
        maxId = -1; // Reset if something went wrong
      }
      
      // If we didn't find any proposals, try a linear search for a small range
      if (maxId === -1) {
        for (let i = 0; i < 20; i++) {
          try {
            await contracts.governance.getProposalState(i);
            maxId = i;
          } catch (err) {
            // Skip if proposal doesn't exist
          }
        }
      }
      
      if (maxId === -1) {
        console.log("No proposals found");
        setProposals([]);
        setLoading(false);
        return;
      }
      
      // Fetch all proposals up to maxId with detailed information
      const proposalData = [];
      const uniqueProposers = new Set();
      
      // Load proposals in batches to avoid overloading the provider
      const batchSize = 5;
      for (let batch = 0; batch <= Math.ceil(maxId / batchSize); batch++) {
        const batchPromises = [];
        const startIdx = batch * batchSize;
        const endIdx = Math.min(startIdx + batchSize, maxId + 1);
        
        for (let i = startIdx; i < endIdx; i++) {
          batchPromises.push(getProposalDetailsFromEvents(i));
        }
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            proposalData.push(result.value);
            if (result.value.proposer !== ethers.constants.AddressZero) {
              uniqueProposers.add(result.value.proposer);
            }
          }
        });
        
        // Short delay between batches to avoid rate limiting
        if (batch < Math.ceil(maxId / batchSize)) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log("Found", proposalData.length, "proposals");
      setProposals(proposalData.sort((a, b) => b.id - a.id)); // Sort by most recent first
      
      // Update token holders count
      setTokenHolders(uniqueProposers.size);
      
    } catch (err) {
      console.error("Error fetching proposals:", err);
      setError("Failed to fetch proposals: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [contracts, isConnected, contractsReady, getProposalDetailsFromEvents]);

  // Updated createProposal function with enhanced error handling
  const createProposal = async (
    description, 
    type, 
    target, 
    callData, 
    amount, 
    recipient, 
    token, 
    newThreshold, 
    newQuorum, 
    newVotingDuration, 
    newTimelockDelay
  ) => {
    if (!isConnected || !contractsReady) throw new Error("Not connected");
    if (!contracts.governance) throw new Error("Governance contract not initialized");
    
    console.log("Creating proposal with params:", {
      description,
      type,
      target,
      callData,
      amount: amount ? amount.toString() : "0",
      recipient,
      token,
      newThreshold: newThreshold ? newThreshold.toString() : "0",
      newQuorum: newQuorum ? newQuorum.toString() : "0",
      newVotingDuration,
      newTimelockDelay
    });
    
    try {
      setLoading(true);
      setError(null);
      setCreateProposalStatus({
        isSubmitting: true,
        error: null,
        success: false
      });

      // First, check if the contract is paused
      try {
        const isPaused = await contracts.governance.paused();
        if (isPaused) {
          throw new Error("Governance contract is currently paused. Proposals cannot be created.");
        }
      } catch (pauseError) {
        // If we can't check paused state, continue anyway
        console.warn("Could not check if contract is paused:", pauseError);
      }
      
      // Validate required fields based on proposal type
      if (type === PROPOSAL_TYPES.GENERAL) {
        if (!target) throw new Error("Target address is required for General proposals");
        if (!callData) throw new Error("Call data is required for General proposals");
      } else if (type === PROPOSAL_TYPES.WITHDRAWAL || 
                type === PROPOSAL_TYPES.TOKEN_TRANSFER ||
                type === PROPOSAL_TYPES.TOKEN_MINT ||
                type === PROPOSAL_TYPES.TOKEN_BURN) {
        if (!recipient) throw new Error("Recipient address is required");
        if (!amount) throw new Error("Amount is required");
      } else if (type === PROPOSAL_TYPES.EXTERNAL_ERC20_TRANSFER) {
        if (!recipient) throw new Error("Recipient address is required");
        if (!amount) throw new Error("Amount is required");
        if (!token) throw new Error("Token address is required");
      }
      
      // Check user's balance vs proposal threshold
      // IMPORTANT: Use justToken instead of token
      const userBalance = await contracts.justToken.balanceOf(account);
      const govParams = await contracts.governance.govParams();
      const proposalThreshold = govParams.proposalCreationThreshold;
      const proposalStake = govParams.proposalStake;
      
      // Format all values for logging
      const formattedUserBalance = ethers.utils.formatEther(userBalance);
      let formattedThreshold = ethers.utils.formatEther(proposalThreshold);
      let formattedStake = ethers.utils.formatEther(proposalStake);
      
      // Debug logs to help diagnose the issue
      console.log("Debug - User balance:", userBalance.toString(), "formatted:", formattedUserBalance);
      console.log("Debug - Raw threshold value:", proposalThreshold.toString(), "formatted:", formattedThreshold);
      console.log("Debug - Raw stake value:", proposalStake.toString(), "formatted:", formattedStake);
      
      // Check if threshold needs adjustment (could be in wrong unit)
      let adjustedThreshold = proposalThreshold;
      if (parseFloat(formattedThreshold) > 10) {
        // Create an adjusted BigNumber for comparison
        adjustedThreshold = proposalThreshold.div(10000);
        formattedThreshold = ethers.utils.formatEther(adjustedThreshold);
        console.log("Debug - Adjusted threshold:", adjustedThreshold.toString(), "formatted:", formattedThreshold);
      }
      
      // Compare with the potentially adjusted threshold
      if (userBalance.lt(adjustedThreshold)) {
        throw new Error(`Insufficient balance to create proposal. You need at least ${formattedThreshold} JUST tokens.`);
      }
      
      // Check if user has enough allowance for the stake
      try {
        // IMPORTANT: Use justToken instead of token
        const allowance = await contracts.justToken.allowance(account, contracts.governance.address);
        console.log("Debug - Token allowance:", allowance.toString(), "formatted:", ethers.utils.formatEther(allowance));
        
        if (allowance.lt(proposalStake)) {
          console.log("Debug - Insufficient allowance, requesting approval...");
          // Approve token transfer first
          // IMPORTANT: Use justToken instead of token
          const approveTx = await contracts.justToken.approve(
            contracts.governance.address, 
            ethers.constants.MaxUint256 // Approve max amount
          );
          console.log("Debug - Approval transaction sent:", approveTx.hash);
          await approveTx.wait();
          console.log("Debug - Approval confirmed");
        }
      } catch (allowanceError) {
        console.error("Error checking/setting allowance:", allowanceError);
      }
      
      // Try to estimate gas with a safety margin
      let gasEstimate;
      try {
        console.log("Estimating gas for proposal creation...");
        gasEstimate = await contracts.governance.estimateGas.createProposal(
          description,
          type,
          target || ethers.constants.AddressZero,
          callData || "0x",
          amount || ethers.constants.Zero,
          recipient || ethers.constants.AddressZero,
          token || ethers.constants.AddressZero,
          newThreshold || ethers.constants.Zero,
          newQuorum || ethers.constants.Zero,
          newVotingDuration || 0,
          newTimelockDelay || 0
        );
        
        // Add a 50% safety margin to account for blockchain conditions
        gasEstimate = gasEstimate.mul(150).div(100);
        console.log("Estimated gas with safety margin:", gasEstimate.toString());
      } catch (gasError) {
        console.warn("Gas estimation failed:", gasError);
        // If gas estimation fails, use a high default value for Sepolia
        gasEstimate = ethers.BigNumber.from(4000000); // 4 million gas for complex proposals
        console.log("Using higher default gas limit:", gasEstimate.toString());
      }
      
      // Set a maximum gas limit to prevent excessive costs
      const maxGasLimit = ethers.BigNumber.from(6000000); // 6 million gas
      const finalGasLimit = gasEstimate.gt(maxGasLimit) ? maxGasLimit : gasEstimate;
      
      console.log("Final gas limit for transaction:", finalGasLimit.toString());
      
      // Create the proposal with explicit params to avoid undefined values
      const tx = await contracts.governance.createProposal(
        description,
        type,
        target || ethers.constants.AddressZero,
        callData || "0x",
        amount || ethers.constants.Zero,
        recipient || ethers.constants.AddressZero,
        token || ethers.constants.AddressZero,
        newThreshold || ethers.constants.Zero,
        newQuorum || ethers.constants.Zero,
        newVotingDuration || 0,
        newTimelockDelay || 0,
        {
          gasLimit: finalGasLimit
        }
      );
      
      console.log("Proposal creation transaction sent:", tx.hash);
      
      const receipt = await tx.wait();
      console.log("Proposal creation confirmed:", receipt);
      
      setCreateProposalStatus({
        isSubmitting: false,
        error: null,
        success: true
      });
      
      // Refresh proposals list
      await fetchProposals();
      
      return true;
    } catch (err) {
      console.error("Error creating proposal:", err);
      
      // Check for specific error messages in the error
      const errorMessage = extractErrorMessage(err);
      
      setError(errorMessage);
      setCreateProposalStatus({
        isSubmitting: false,
        error: errorMessage,
        success: false
      });
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const cancelProposal = async (proposalId) => {
    if (!isConnected || !contractsReady) throw new Error("Not connected");
    if (!contracts.governance) throw new Error("Governance contract not initialized");
    
    try {
      setLoading(true);
      setError(null);
      
      // Verify the proposal exists
      try {
        await contracts.governance.getProposalState(proposalId);
      } catch (err) {
        throw new Error(`Proposal ${proposalId} not found`);
      }
      
      const tx = await contracts.governance.cancelProposal(proposalId, {
        gasLimit: 500000 // Higher gas limit for safety
      });
      
      await tx.wait();
      console.log(`Proposal ${proposalId} cancelled successfully`);
      
      // Refresh proposals list
      await fetchProposals();
      
      return true;
    } catch (err) {
      console.error("Error canceling proposal:", err);
      const errorMessage = extractErrorMessage(err);
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const queueProposal = async (proposalId) => {
    if (!isConnected || !contractsReady) throw new Error("Not connected");
    if (!contracts.governance) throw new Error("Governance contract not initialized");
    
    try {
      setLoading(true);
      setError(null);
      
      // Verify proposal state before queueing
      const state = await contracts.governance.getProposalState(proposalId);
      if (state !== PROPOSAL_STATES.SUCCEEDED) {
        throw new Error("Only succeeded proposals can be queued");
      }
      
      const tx = await contracts.governance.queueProposal(proposalId, {
        gasLimit: 500000 // Higher gas limit for queueing due to complexity
      });
      
      await tx.wait();
      console.log(`Proposal ${proposalId} queued successfully`);
      
      // Refresh proposals list
      await fetchProposals();
      
      return true;
    } catch (err) {
      console.error("Error queuing proposal:", err);
      const errorMessage = extractErrorMessage(err);
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const executeProposal = async (proposalId) => {
    if (!isConnected || !contractsReady) throw new Error("Not connected");
    if (!contracts.governance) throw new Error("Governance contract not initialized");
    
    try {
      setLoading(true);
      setError(null);
      
      // Verify proposal state before executing
      const state = await contracts.governance.getProposalState(proposalId);
      if (state !== PROPOSAL_STATES.QUEUED) {
        throw new Error("Only queued proposals can be executed");
      }
      
      const tx = await contracts.governance.executeProposal(proposalId, {
        gasLimit: 1000000 // Higher gas limit for execution due to complexity
      });
      
      await tx.wait();
      console.log(`Proposal ${proposalId} executed successfully`);
      
      // Refresh proposals list
      await fetchProposals();
      
      return true;
    } catch (err) {
      console.error("Error executing proposal:", err);
      const errorMessage = extractErrorMessage(err);
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const claimRefund = async (proposalId) => {
    if (!isConnected || !contractsReady) throw new Error("Not connected");
    if (!contracts.governance) throw new Error("Governance contract not initialized");
    
    try {
      setLoading(true);
      setError(null);
      
      // Verify the proposal exists
      try {
        await contracts.governance.getProposalState(proposalId);
      } catch (err) {
        throw new Error(`Proposal ${proposalId} not found`);
      }
      
      const tx = await contracts.governance.claimPartialStakeRefund(proposalId, {
        gasLimit: 500000 // Higher gas limit for safety
      });
      
      await tx.wait();
      console.log(`Successfully claimed refund for proposal ${proposalId}`);
      
      // Refresh proposals list
      await fetchProposals();
      
      return true;
    } catch (err) {
      console.error("Error claiming refund:", err);
      const errorMessage = extractErrorMessage(err);
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Load proposals when the component mounts or dependencies change
  useEffect(() => {
    if (isConnected && contractsReady) {
      fetchProposals();
    } else {
      setProposals([]);
      setLoading(false);
    }
  }, [fetchProposals, isConnected, contractsReady, refreshCounter, account]);

  return {
    proposals,
    loading,
    error,
    tokenHolders,
    createProposalStatus,
    fetchProposals,
    createProposal,
    cancelProposal,
    queueProposal,
    executeProposal,
    claimRefund
  };
}