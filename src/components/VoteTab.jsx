import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';

import { Clock, Check, X, X as XIcon, Calendar, Users, BarChart2 } from 'lucide-react';
import { PROPOSAL_STATES, VOTE_TYPES } from '../utils/constants';
import { formatCountdown } from '../utils/formatters';
import Loader from './Loader';
import blockchainDataCache from '../utils/blockchainDataCache';

const VoteTab = ({ proposals, castVote, hasVoted, getVotingPower, voting, account, governanceContract, provider, contractAddress, getProposalVoteTotals }) => {
  const [voteFilter, setVoteFilter] = useState('active');
  const [votingPowers, setVotingPowers] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [quorum, setQuorum] = useState(null);
  const [proposalQuorums, setProposalQuorums] = useState({});
  const [proposalVoteData, setProposalVoteData] = useState({});
  
  // Track locally which proposals the user has voted on and how
  const [votedProposals, setVotedProposals] = useState({});
  // Track pending transactions to show optimistic UI updates
  const [pendingVotes, setPendingVotes] = useState({});
  
  /**
   * Check if a proposal is inactive
   * @param {Object} proposal - The proposal object
   * @returns {boolean} - True if the proposal is inactive
   */
  const isInactiveProposal = useCallback((proposal) => {
    // Check if proposal state is anything other than ACTIVE
    return proposal.state !== PROPOSAL_STATES.ACTIVE;
  }, [PROPOSAL_STATES]);

  /**
   * Get the cache key for a proposal's vote data
   * @param {string} proposalId - The proposal ID
   * @returns {string} - Cache key
   */
  const getVoteDataCacheKey = (proposalId) => {
    return `dashboard-votes-${proposalId}`;
  };

  /**
   * Get vote data for a proposal with special handling for inactive proposals
   * @param {string} proposalId - The proposal ID
   * @param {boolean} forceRefresh - Whether to force refresh from the blockchain
   * @returns {Promise<Object>} - Vote data
   */
  const getProposalVoteDataWithCaching = async (proposalId, forceRefresh = false) => {
    // Find the proposal
    const proposal = proposals.find(p => p.id === proposalId);
    if (!proposal) {
      console.error(`Proposal #${proposalId} not found`);
      return null;
    }
    
    const cacheKey = getVoteDataCacheKey(proposalId);
    
    // For inactive proposals, prioritize cached data
    if (isInactiveProposal(proposal) && !forceRefresh) {
      const cachedData = blockchainDataCache.get(cacheKey);
      if (cachedData) {
        console.log(`Using cached data for inactive proposal #${proposalId}`);
        return cachedData;
      }
    }
    
    // For active proposals or if we need to refresh, clear the cache
    if (forceRefresh || !isInactiveProposal(proposal)) {
      blockchainDataCache.delete(cacheKey);
    }
    
    try {
      // Get fresh data from the blockchain
      console.log(`Fetching vote data for proposal #${proposalId}${isInactiveProposal(proposal) ? ' (inactive)' : ''}`);
      const data = await getProposalVoteTotals(proposalId);
      
      if (!data) {
        throw new Error(`No data returned for proposal #${proposalId}`);
      }
      
      // Process the data consistently with Dashboard approach
      const processedData = {
        yesVotes: parseFloat(data.yesVotes) || 0,
        noVotes: parseFloat(data.noVotes) || 0,
        abstainVotes: parseFloat(data.abstainVotes) || 0,
        yesVotingPower: parseFloat(data.yesVotes || data.yesVotingPower) || 0,
        noVotingPower: parseFloat(data.noVotes || data.noVotingPower) || 0,
        abstainVotingPower: parseFloat(data.abstainVotes || data.abstainVotingPower) || 0,
        totalVoters: parseInt(data.totalVoters) || 0,
        fetchedAt: Date.now()
      };
      
      // Calculate total voting power
      processedData.totalVotingPower = 
        processedData.yesVotingPower + 
        processedData.noVotingPower + 
        processedData.abstainVotingPower;
      
      // Calculate percentages
      if (processedData.totalVotingPower > 0) {
        processedData.yesPercentage = (processedData.yesVotingPower / processedData.totalVotingPower) * 100;
        processedData.noPercentage = (processedData.noVotingPower / processedData.totalVotingPower) * 100;
        processedData.abstainPercentage = (processedData.abstainVotingPower / processedData.totalVotingPower) * 100;
      } else {
        processedData.yesPercentage = 0;
        processedData.noPercentage = 0;
        processedData.abstainPercentage = 0;
      }
      
      // Set a TTL based on proposal state - longer for inactive
      const ttlSeconds = isInactiveProposal(proposal) ? 86400 : 15; // 24 hours for inactive, 15 sec for active
      
      // Cache the result with appropriate TTL
      blockchainDataCache.set(cacheKey, processedData, ttlSeconds);
      
      return processedData;
    } catch (error) {
      console.error(`Error fetching vote data for proposal ${proposalId}:`, error);
      
      // For inactive proposals, if we can't fetch new data, try to construct data from the proposal itself
      if (isInactiveProposal(proposal)) {
        console.log(`Constructing fallback data for inactive proposal #${proposalId}`);
        const fallbackData = {
          yesVotes: proposal.votedYes ? 1 : 0,
          noVotes: proposal.votedNo ? 1 : 0,
          abstainVotes: (proposal.hasVoted && !proposal.votedYes && !proposal.votedNo) ? 1 : 0,
          yesVotingPower: parseFloat(proposal.yesVotes) || 0,
          noVotingPower: parseFloat(proposal.noVotes) || 0,
          abstainVotingPower: parseFloat(proposal.abstainVotes) || 0,
          totalVoters: proposal.hasVoted ? 1 : 0,
          fetchedAt: Date.now()
        };
        
        // Calculate total voting power
        fallbackData.totalVotingPower = 
          fallbackData.yesVotingPower + 
          fallbackData.noVotingPower + 
          fallbackData.abstainVotingPower;
        
        // Calculate percentages
        if (fallbackData.totalVotingPower > 0) {
          fallbackData.yesPercentage = (fallbackData.yesVotingPower / fallbackData.totalVotingPower) * 100;
          fallbackData.noPercentage = (fallbackData.noVotingPower / fallbackData.totalVotingPower) * 100;
          fallbackData.abstainPercentage = (fallbackData.abstainVotingPower / fallbackData.totalVotingPower) * 100;
        } else {
          fallbackData.yesPercentage = 0;
          fallbackData.noPercentage = 0;
          fallbackData.abstainPercentage = 0;
        }
        
        // Cache this fallback data with a long TTL
        blockchainDataCache.set(cacheKey, fallbackData, 86400); // 24 hours
        
        return fallbackData;
      }
      
      return null;
    }
  };

  // Create a helper function to archive vote data when a proposal becomes inactive
  const archiveProposalVoteData = async (proposalId) => {
    const cacheKey = getVoteDataCacheKey(proposalId);
    const cachedData = blockchainDataCache.get(cacheKey);
    
    if (cachedData) {
      // If we already have data in the cache, update it with a long TTL
      blockchainDataCache.set(cacheKey, cachedData, 86400); // 24 hours
      console.log(`Archived vote data for proposal #${proposalId}`);
    } else {
      // Try to get fresh data one last time and archive it
      try {
        const data = await getProposalVoteTotals(proposalId);
        if (data) {
          const processedData = {
            yesVotes: parseFloat(data.yesVotes) || 0,
            noVotes: parseFloat(data.noVotes) || 0,
            abstainVotes: parseFloat(data.abstainVotes) || 0,
            yesVotingPower: parseFloat(data.yesVotes || data.yesVotingPower) || 0,
            noVotingPower: parseFloat(data.noVotes || data.noVotingPower) || 0,
            abstainVotingPower: parseFloat(data.abstainVotes || data.abstainVotingPower) || 0,
            totalVoters: parseInt(data.totalVoters) || 0,
            fetchedAt: Date.now()
          };
          
          // Calculate total voting power
          processedData.totalVotingPower = 
            processedData.yesVotingPower + 
            processedData.noVotingPower + 
            processedData.abstainVotingPower;
          
          // Calculate percentages
          if (processedData.totalVotingPower > 0) {
            processedData.yesPercentage = (processedData.yesVotingPower / processedData.totalVotingPower) * 100;
            processedData.noPercentage = (processedData.noVotingPower / processedData.totalVotingPower) * 100;
            processedData.abstainPercentage = (processedData.abstainVotingPower / processedData.totalVotingPower) * 100;
          }
          
          blockchainDataCache.set(cacheKey, processedData, 86400); // 24 hours
          console.log(`Archived fresh vote data for proposal #${proposalId}`);
        }
      } catch (error) {
        console.error(`Error archiving vote data for proposal ${proposalId}:`, error);
      }
    }
  };
  
  // Format numbers for display - MATCHING DASHBOARD
  const formatNumberDisplay = (value) => {
    if (value === undefined || value === null) return "0";
    
    // Handle string inputs
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    // If it's NaN or not a number, return "0"
    if (isNaN(numValue)) return "0";
    
    // For whole numbers, don't show decimals
    if (Math.abs(numValue - Math.round(numValue)) < 0.00001) {
      return numValue.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    
    // For decimal numbers, limit to 2 decimal places
    return numValue.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  };
  
  // Format token values to 5 decimal places - MATCHING DASHBOARD
  const formatToFiveDecimals = (value) => {
    if (value === undefined || value === null) return "0.00000";
    
    // Handle string inputs
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    // If it's NaN or not a number, return "0.00000"
    if (isNaN(numValue)) return "0.00000";
    
    // Return with exactly 5 decimal places
    return numValue.toFixed(5);
  };
  
  // Fetch vote data for all proposals - USING IMPROVED CACHING FOR INACTIVE PROPOSALS
  useEffect(() => {
    const fetchVoteData = async () => {
      if (!getProposalVoteTotals || !proposals || proposals.length === 0) return;
      
      console.log("Fetching vote data for all proposals");
      setLoading(true);
      
      try {
        const voteData = {};
        
        // Process proposals in parallel for better performance
        const results = await Promise.allSettled(
          proposals.map(async (proposal) => {
            try {
              // Use our enhanced function that handles inactive proposals
              const data = await getProposalVoteDataWithCaching(proposal.id, false);
              if (!data) {
                return {
                  id: proposal.id,
                  data: null
                };
              }
              
              return {
                id: proposal.id,
                data: data
              };
            } catch (error) {
              console.error(`Error fetching vote data for proposal ${proposal.id}:`, error);
              return {
                id: proposal.id,
                data: null
              };
            }
          })
        );
        
        // Collect successful results
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value && result.value.data) {
            voteData[result.value.id] = result.value.data;
          }
        });
        
        console.log("Setting proposalVoteData state with:", voteData);
        setProposalVoteData(voteData);
      } catch (error) {
        console.error("Error fetching vote data:", error);
      } finally {
        setLoading(false);
      }
    };
    
    // Initial fetch
    fetchVoteData();
    
    // Set up a polling interval to refresh vote data
    // Only poll frequently for active proposals, less frequently for inactive ones 
    const pollInterval = setInterval(() => {
      // Count how many active proposals we have
      const activeProposalCount = proposals.filter(p => !isInactiveProposal(p)).length;
      
      // If we have active proposals, refresh more frequently
      if (activeProposalCount > 0) {
        console.log(`Polling for ${activeProposalCount} active proposals`);
        fetchVoteData();
      } else {
        // If all proposals are inactive, we still refresh occasionally but less frequently
        const currentTime = Date.now();
        const minutes = new Date(currentTime).getMinutes();
        
        // Only refresh once every 5 minutes for inactive proposals
        if (minutes % 5 === 0) {
          console.log("Occasional refresh for inactive proposals");
          fetchVoteData();
        }
      }
    }, 5000); // Poll every 5 seconds
    
    // Set up event listener for VoteCast events to update data in real-time
    const setupEventListener = () => {
      if (governanceContract) {
        // Listen for VoteCast events
        governanceContract.on('VoteCast', (voter, proposalId, support, votes, event) => {
          console.log(`Vote cast by ${voter} on proposal ${proposalId}`);
          
          // Force immediate refresh of vote data
          setTimeout(() => {
            refreshVoteDataForProposal(proposalId.toString());
          }, 1000);
        });
        
        // Try to listen for ProposalState events if the contract supports it
        try {
          governanceContract.on('ProposalState', (proposalId, oldState, newState, event) => {
            console.log(`Proposal ${proposalId} state changed from ${oldState} to ${newState}`);
            
            // If the proposal is no longer active, archive its vote data
            if (newState !== PROPOSAL_STATES.ACTIVE) {
              archiveProposalVoteData(proposalId.toString());
            } else {
              // If it became active, refresh its data
              refreshVoteDataForProposal(proposalId.toString());
            }
          });
        } catch (error) {
          console.log("ProposalState event not supported by contract");
        }
        
        console.log("Set up event listeners");
      }
    };
    
    setupEventListener();
    
    return () => {
      clearInterval(pollInterval);
      // Remove event listeners
      if (governanceContract) {
        governanceContract.removeAllListeners('VoteCast');
        // Try to remove ProposalState listener if it was added
        try {
          governanceContract.removeAllListeners('ProposalState');
        } catch (error) {
          // Ignore errors if the event wasn't supported
        }
      }
    };
  }, [proposals, getProposalVoteTotals, governanceContract, isInactiveProposal]);

  // Refresh vote data for a specific proposal - ensures sync with dashboard
  const refreshVoteDataForProposal = async (proposalId) => {
    if (!getProposalVoteTotals) return;
    
    try {
      console.log(`Refreshing vote data for proposal #${proposalId}`);
      
      // Get fresh data with our enhanced function
      const updatedData = await getProposalVoteDataWithCaching(proposalId, true);
      
      if (updatedData) {
        // Update the state
        setProposalVoteData(prev => ({
          ...prev,
          [proposalId]: updatedData
        }));
      }
    } catch (error) {
      console.error(`Error refreshing vote data for proposal ${proposalId}:`, error);
    }
  };

  // Fetch voting powers for each proposal
  useEffect(() => {
    const fetchVotingPowers = async () => {
      if (!getVotingPower || !proposals.length || !account) return;
      
      const powers = {};
      for (const proposal of proposals) {
        try {
          if (proposal.snapshotId) {
            // Try to get from cache first
            const cacheKey = `votingPower-${account}-${proposal.snapshotId}`;
            const cachedPower = blockchainDataCache.get(cacheKey);
            if (cachedPower !== null) {
              powers[proposal.id] = cachedPower;
              continue;
            }
            
            const power = await getVotingPower(proposal.snapshotId);
            powers[proposal.id] = power;
            
            // Cache the result
            blockchainDataCache.set(cacheKey, power);
          }
        } catch (err) {
          console.error(`Error getting voting power for proposal ${proposal.id}:`, err);
          powers[proposal.id] = "0";
        }
      }
      
      setVotingPowers(powers);
    };
    
    fetchVotingPowers();
  }, [getVotingPower, proposals, account]);

  // Initialize votedProposals from the proposals data
  useEffect(() => {
    const voted = {};
    proposals.forEach(proposal => {
      if (proposal.hasVoted) {
        // Set default vote type to abstain if not specified
        let voteType = VOTE_TYPES.ABSTAIN;
        if (proposal.votedYes) voteType = VOTE_TYPES.FOR;
        if (proposal.votedNo) voteType = VOTE_TYPES.AGAINST;
        
        voted[proposal.id] = voteType;
        
        console.log(`User has voted on proposal #${proposal.id} with vote type: ${voteType}`);
      }
    });
    setVotedProposals(voted);
    
    // Also ensure that inactive proposals have their vote data stored in the cache
    proposals.filter(isInactiveProposal).forEach(proposal => {
      archiveProposalVoteData(proposal.id);
    });
    
  }, [proposals, isInactiveProposal, VOTE_TYPES]);
  
  // Fetch quorum from governance contract - DIRECTLY ACCESS IT FROM THE CONTRACT
  useEffect(() => {
    const fetchQuorum = async () => {
      if (!governanceContract) return;
      
      try {
        console.log("Attempting to fetch global quorum...");
        // Try to get from cache first
        const cacheKey = 'quorum';
        const cachedQuorum = blockchainDataCache.get(cacheKey);
        if (cachedQuorum !== null) {
          console.log("Using cached quorum:", cachedQuorum);
          setQuorum(cachedQuorum);
          return;
        }
        
        // Your contract stores quorum in the govParams structure
        // This is the direct way to access it based on your contract
        const params = await governanceContract.govParams();
        if (params && params.quorum) {
          // Convert to appropriate format
          const quorumValue = parseInt(params.quorum.toString());
          console.log("Successfully fetched quorum from contract:", quorumValue);
          setQuorum(quorumValue);
          
          // Cache the result
          blockchainDataCache.set(cacheKey, quorumValue, 3600); // Cache for 1 hour
          
          // Also store in proposal-specific quorums for each proposal
          const updatedQuorums = {};
          proposals.forEach(proposal => {
            updatedQuorums[proposal.id] = quorumValue;
            
            // Also cache in proposal-specific keys
            blockchainDataCache.set(`quorum-${proposal.id}`, quorumValue, 3600);
          });
          
          setProposalQuorums(prev => ({
            ...prev,
            ...updatedQuorums
          }));
        } else {
          console.error("Failed to get quorum: params or params.quorum is undefined", params);
        }
      } catch (error) {
        console.error("Error fetching quorum:", error);
      }
    };
    
    fetchQuorum();
  }, [governanceContract, proposals]);

  // Debug function to help diagnose quorum issues
  const debugQuorum = async () => {
    console.log("=== QUORUM DEBUG INFORMATION ===");
    console.log("Current quorum state:", quorum);
    console.log("Current proposalQuorums state:", proposalQuorums);
    
    // Check what's in the cache
    const cachedGlobalQuorum = blockchainDataCache.get('quorum');
    console.log("Cached global quorum:", cachedGlobalQuorum);
    
    // Loop through proposals and check their cached quorums
    for (const proposal of proposals) {
      const cacheKey = `quorum-${proposal.id}`;
      const cachedValue = blockchainDataCache.get(cacheKey);
      console.log(`Cached quorum for proposal #${proposal.id}:`, cachedValue);
    }
    
    // Try to fetch directly from contract
    if (governanceContract) {
      try {
        console.log("Attempting direct contract call to govParams()...");
        const params = await governanceContract.govParams();
        console.log("Raw govParams result:", params);
        
        if (params && params.quorum) {
          console.log("Parsed quorum value:", parseInt(params.quorum.toString()));
        }
      } catch (error) {
        console.error("Error in direct contract call:", error);
      }
      
      // Try different ways to access the quorum
      try {
        // Check if quorum is available as a direct method
        if (typeof governanceContract.quorum === 'function') {
          const directQuorum = await governanceContract.quorum();
          console.log("Direct quorum() call result:", directQuorum.toString());
        } else {
          console.log("quorum() is not a function on this contract");
        }
      } catch (error) {
        console.log("Failed to call direct quorum() method:", error.message);
      }
    } else {
      console.log("governanceContract is not available");
    }
    
    console.log("=== END DEBUG INFORMATION ===");
  };

  // Log quorum info when modal opens
  useEffect(() => {
    if (showModal && selectedProposal) {
      console.log("Modal opened for proposal:", selectedProposal.id);
      console.log("Quorum for this proposal:", getQuorumForProposal(selectedProposal.id));
      console.log("Global quorum state:", quorum);
      console.log("Has proposal-specific quorum:", proposalQuorums[selectedProposal.id] !== undefined);
    }
  }, [showModal, selectedProposal]);

  // Filter proposals based on vote status
  const filteredProposals = proposals.filter(proposal => {
    // Check if we've locally voted on this proposal
    const locallyVoted = votedProposals[proposal.id] !== undefined;
    
    if (voteFilter === 'active') {
      // Only check if proposal is active, don't exclude based on vote status
      return proposal.state === PROPOSAL_STATES.ACTIVE;
    } else if (voteFilter === 'voted') {
      return proposal.hasVoted || locallyVoted;
    }
    return true; // 'all' filter
  });

  // Check if the user has voted on the proposal (either from data or local state)
  const hasUserVoted = useCallback((proposal) => {
    return proposal.hasVoted || votedProposals[proposal.id] !== undefined;
  }, [votedProposals]);
  
  // Get the vote type
  const getUserVoteType = useCallback((proposal) => {
    // First check our local state
    if (votedProposals[proposal.id] !== undefined) {
      return votedProposals[proposal.id];
    }
    
    // Then fall back to the proposal data
    if (proposal.votedYes) return VOTE_TYPES.FOR;
    if (proposal.votedNo) return VOTE_TYPES.AGAINST;
    if (proposal.hasVoted) return VOTE_TYPES.ABSTAIN;
    
    return null;
  }, [votedProposals]);

  // Determine if a proposal has a pending vote
  const hasPendingVote = useCallback((proposalId) => {
    return pendingVotes[proposalId] !== undefined && 
           (Date.now() - pendingVotes[proposalId].timestamp) < 60000; // Consider pending if less than 1 minute old
  }, [pendingVotes]);

  // Get the quorum for a specific proposal - IMPROVED FALLBACK
  const getQuorumForProposal = useCallback((proposalId) => {
    // First check if we have a proposal-specific quorum
    if (proposalQuorums[proposalId] !== undefined) {
      return proposalQuorums[proposalId];
    }
    
    // Otherwise use the global quorum
    if (quorum !== null) {
      return quorum;
    }
    
    // As a last resort, pull from cache directly
    const cachedQuorum = blockchainDataCache.get('quorum');
    if (cachedQuorum !== null) {
      return cachedQuorum;
    }
    
    // If still nothing, try proposal-specific cache
    const cachedProposalQuorum = blockchainDataCache.get(`quorum-${proposalId}`);
    if (cachedProposalQuorum !== null) {
      return cachedProposalQuorum;
    }
    
    // Default fallback value if nothing else works
    return 0;
  }, [proposalQuorums, quorum]);

  // Function to submit a vote
  const submitVote = async (proposalId, support) => {
    try {
      // Find the proposal in the list
      const proposal = proposals.find(p => p.id === proposalId);
      if (!proposal) {
        console.error("Proposal not found:", proposalId);
        return;
      }
      
      console.log(`Submitting vote for proposal #${proposalId} with type ${support}`);
      
      // Get the user's voting power for this proposal
      let userVotingPower = parseFloat(votingPowers[proposalId] || "0");
      if (userVotingPower <= 0) {
        // Try to get the voting power one more time
        try {
          if (proposal.snapshotId && getVotingPower) {
            const refreshedPower = await getVotingPower(proposal.snapshotId);
            userVotingPower = parseFloat(refreshedPower);
          }
        } catch (err) {
          console.warn("Error refreshing voting power:", err);
        }
        
        // If still 0, use a minimum value for UI
        if (userVotingPower <= 0) {
          userVotingPower = 1;
        }
      }
      
      // Create the pending vote for optimistic UI
      const pendingVote = {
        proposalId,
        voteType: support,
        votingPower: userVotingPower,
        timestamp: Date.now()
      };
      
      // Update pending votes state for optimistic UI
      setPendingVotes(prev => ({
        ...prev,
        [proposalId]: pendingVote
      }));
      
      // Create optimistic update for UI - USING DASHBOARD APPROACH
      // Get the current vote data or create a new empty object if none exists
      const currentVoteData = proposalVoteData[proposalId] || {
        yesVotes: 0,
        noVotes: 0,
        abstainVotes: 0,
        yesVotingPower: 0,
        noVotingPower: 0,
        abstainVotingPower: 0,
        totalVotingPower: 0,
        totalVoters: 0,
        yesPercentage: 0,
        noPercentage: 0,
        abstainPercentage: 0,
      };
      
      // Create a deep copy to avoid mutating the original
      const optimisticVoteData = JSON.parse(JSON.stringify(currentVoteData));
      
      // Only add if we haven't already voted
      if (!hasUserVoted(proposal)) {
        console.log(`Adding optimistic vote: type=${support}, power=${userVotingPower}`);
        
        // Update vote counts based on vote type
        if (support === VOTE_TYPES.FOR) {
          optimisticVoteData.yesVotes += 1;
          optimisticVoteData.yesVotingPower += userVotingPower;
        } else if (support === VOTE_TYPES.AGAINST) {
          optimisticVoteData.noVotes += 1;
          optimisticVoteData.noVotingPower += userVotingPower;
        } else {
          optimisticVoteData.abstainVotes += 1;
          optimisticVoteData.abstainVotingPower += userVotingPower;
        }
        
        // Update total voters
        optimisticVoteData.totalVoters = (optimisticVoteData.totalVoters || 0) + 1;
        
        // Recalculate total voting power
        optimisticVoteData.totalVotingPower = 
          optimisticVoteData.yesVotingPower + 
          optimisticVoteData.noVotingPower + 
          optimisticVoteData.abstainVotingPower;
        
        console.log("Updated total voting power:", optimisticVoteData.totalVotingPower);
        
        // Recalculate percentages using Dashboard approach
        if (optimisticVoteData.totalVotingPower > 0) {
          optimisticVoteData.yesPercentage = (optimisticVoteData.yesVotingPower / optimisticVoteData.totalVotingPower) * 100;
          optimisticVoteData.noPercentage = (optimisticVoteData.noVotingPower / optimisticVoteData.totalVotingPower) * 100;
          optimisticVoteData.abstainPercentage = (optimisticVoteData.abstainVotingPower / optimisticVoteData.totalVotingPower) * 100;
          
          console.log("Updated percentages:", {
            yes: optimisticVoteData.yesPercentage,
            no: optimisticVoteData.noPercentage,
            abstain: optimisticVoteData.abstainPercentage
          });
        }
        
        // Update vote data with optimistic update
        setProposalVoteData(prev => ({
          ...prev,
          [proposalId]: optimisticVoteData
        }));
        
        // Also clear the cache to ensure fresh data on next fetch
        blockchainDataCache.delete(getVoteDataCacheKey(proposalId));
      }
      
      // Actually send the vote transaction to the blockchain
      const result = await castVote(proposalId, support);
      console.log("Vote transaction confirmed:", result);
      
      // Update the voted proposals state
      setVotedProposals(prev => ({
        ...prev,
        [proposalId]: support
      }));
      
      // Force refresh after short delay to ensure blockchain has updated
      setTimeout(() => {
        refreshVoteDataForProposal(proposalId);
      }, 2000);
      
      // Then set another refresh after a longer delay to catch any indexer updates
      setTimeout(() => {
        refreshVoteDataForProposal(proposalId);
      }, 10000);
      
      return result;
    } catch (error) {
      console.error("Error submitting vote:", error);
      
      // Remove the pending vote since the transaction failed
      setPendingVotes(prev => {
        const updated = {...prev};
        delete updated[proposalId];
        return updated;
      });
      
      // Propagate the error
      throw error;
    }
  };

  // Helper to convert vote type to text
  const getVoteTypeText = (voteType) => {
    if (voteType === VOTE_TYPES.FOR) return 'Yes';
    if (voteType === VOTE_TYPES.AGAINST) return 'No';
    if (voteType === VOTE_TYPES.ABSTAIN) return 'Abstain';
    return '';
  };

  // Get vote data for a proposal - EXACTLY MATCHING DASHBOARD APPROACH
  const getVoteData = useCallback((proposal) => {
    // First check if we have data in the state
    const voteData = proposalVoteData[proposal.id];
    
    if (voteData) {
      return voteData;
    }
    
    // Check if we have data in the global cache with the exact dashboard key
    const cachedData = blockchainDataCache.get(getVoteDataCacheKey(proposal.id));
    if (cachedData) {
      return cachedData;
    }
    
    // If not in state or cache, create synthetic data using proposal data
    // This ensures we show something even before the blockchain data loads
    // EXACTLY MATCHING DASHBOARD APPROACH
    const syntheticData = {
      yesVotes: 0,
      noVotes: 0,
      abstainVotes: 0,
      yesVotingPower: parseFloat(proposal.yesVotes) || 0,
      noVotingPower: parseFloat(proposal.noVotes) || 0,
      abstainVotingPower: parseFloat(proposal.abstainVotes) || 0,
      totalVoters: 0,
      yesPercentage: 0,
      noPercentage: 0,
      abstainPercentage: 0
    };
    
    // Calculate total voting power
    const totalVotingPower = syntheticData.yesVotingPower + 
                             syntheticData.noVotingPower + 
                             syntheticData.abstainVotingPower;
    
    syntheticData.totalVotingPower = totalVotingPower;
    
    // Calculate percentages if there's any voting power
    if (totalVotingPower > 0) {
      syntheticData.yesPercentage = (syntheticData.yesVotingPower / totalVotingPower) * 100;
      syntheticData.noPercentage = (syntheticData.noVotingPower / totalVotingPower) * 100;
      syntheticData.abstainPercentage = (syntheticData.abstainVotingPower / totalVotingPower) * 100;
    }
    
    // If the user has voted but totals are still 0, enhance the synthetic data
    // This is important when votes haven't been indexed yet but we know the user voted
    if ((totalVotingPower === 0 || syntheticData.totalVoters === 0) && hasUserVoted(proposal)) {
      const voteType = getUserVoteType(proposal);
      const approxVotingPower = parseFloat(votingPowers[proposal.id] || "0.6");
      
      if (voteType === VOTE_TYPES.FOR) {
        syntheticData.yesVotes = 1;
        syntheticData.yesVotingPower = approxVotingPower;
        syntheticData.totalVoters = 1;
        syntheticData.yesPercentage = 100;
        syntheticData.totalVotingPower = approxVotingPower;
      } else if (voteType === VOTE_TYPES.AGAINST) {
        syntheticData.noVotes = 1;
        syntheticData.noVotingPower = approxVotingPower;
        syntheticData.totalVoters = 1;
        syntheticData.noPercentage = 100;
        syntheticData.totalVotingPower = approxVotingPower;
      } else if (voteType === VOTE_TYPES.ABSTAIN) {
        syntheticData.abstainVotes = 1;
        syntheticData.abstainVotingPower = approxVotingPower;
        syntheticData.totalVoters = 1;
        syntheticData.abstainPercentage = 100;
        syntheticData.totalVotingPower = approxVotingPower;
      }
    }
    
    return syntheticData;
  }, [proposalVoteData, hasUserVoted, getUserVoteType, votingPowers, VOTE_TYPES]);
  
  // Render vote percentage bar - CONSISTENT WITH DASHBOARD
  const renderVoteBar = useCallback((proposal) => {
    const voteData = getVoteData(proposal);
    const totalVotingPower = voteData.totalVotingPower || 0;
    
    if (totalVotingPower <= 0) {
      // Default empty bar if no votes
      return (
        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full w-full bg-gray-300"></div>
        </div>
      );
    }
    
    // Show vote percentages with color coding - SAME AS DASHBOARD
    return (
      <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
        <div className="flex h-full">
          <div 
            className="bg-green-500 h-full" 
            style={{ width: `${voteData.yesPercentage}%` }}
          ></div>
          <div 
            className="bg-red-500 h-full" 
            style={{ width: `${voteData.noPercentage}%` }}
          ></div>
          <div 
            className="bg-gray-400 h-full" 
            style={{ width: `${voteData.abstainPercentage}%` }}
          ></div>
        </div>
      </div>
    );
  }, [getVoteData]);

  // Trigger a manual refresh of vote data
  const refreshAllVoteData = async () => {
    if (!getProposalVoteTotals || !proposals || proposals.length === 0) return;
    
    console.log("Manually refreshing all vote data");
    setLoading(true);
    
    try {
      const updatedVoteData = {};
      
      for (const proposal of proposals) {
        try {
          // For inactive proposals, we don't need to force refresh since the data won't change
          const forceRefresh = !isInactiveProposal(proposal);
          const data = await getProposalVoteDataWithCaching(proposal.id, forceRefresh);
          if (data) {
            updatedVoteData[proposal.id] = data;
          }
        } catch (error) {
          console.error(`Error refreshing vote data for proposal ${proposal.id}:`, error);
        }
      }
      
      setProposalVoteData(prev => ({
        ...prev,
        ...updatedVoteData
      }));
    } catch (error) {
      console.error("Error in manual refresh:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold">Vote</h2>
        <p className="text-gray-500">Cast your votes on active proposals</p>
      </div>
      
      {/* Filter options */}
      <div className="bg-white p-6 rounded-lg shadow mb-8">
        <div className="flex flex-wrap gap-3">
          {['active', 'voted', 'all'].map(filter => (
            <button
              key={filter}
              className={`px-4 py-2 rounded-full text-sm ${voteFilter === filter ? 'bg-indigo-100 text-indigo-800 font-medium' : 'bg-gray-100 text-gray-800'}`}
              onClick={() => setVoteFilter(filter)}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
          
          {/* Refresh button */}
          <button
            className="ml-auto px-4 py-2 rounded-full text-sm bg-blue-100 text-blue-800"
            onClick={() => refreshAllVoteData()}
          >
            Refresh Data
          </button>
          
          {/* Debug button - only for development */}
          {process.env.NODE_ENV === 'development' && (
            <button
              onClick={debugQuorum}
              className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded"
            >
              Debug Quorum
            </button>
          )}
        </div>
      </div>
      
      {/* Voting cards */}
      <div className="space-y-8">
        {voting.loading || loading ? (
          <div className="flex justify-center py-8">
            <Loader size="large" text="Loading proposals..." />
          </div>
        ) : filteredProposals.length > 0 ? (
          filteredProposals.map((proposal, idx) => {
            // Get voting power for this proposal
            const votingPower = votingPowers[proposal.id] || "0";
            const hasVotingPower = parseFloat(votingPower) > 0;
            
            // Check if the user has voted
            const userVoted = hasUserVoted(proposal);
            const voteType = getUserVoteType(proposal);
            
            // Get vote data
            const voteData = getVoteData(proposal);
            const isPending = hasPendingVote(proposal.id);
            
            // Get quorum for this proposal
            const proposalQuorum = getQuorumForProposal(proposal.id);
            
            return (
              <div key={idx} className="bg-white p-8 rounded-lg shadow-md">
                <div className="flex justify-between items-start mb-5">
                  <div>
                    <h3 className="text-xl font-medium mb-1">{proposal.title}</h3>
                    <p className="text-sm text-gray-500">Proposal #{proposal.id}</p>
                  </div>
                  <span className="text-sm bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full flex items-center">
                    <Clock className="w-4 h-4 mr-1" />
                    {formatCountdown(proposal.deadline)}
                  </span>
                </div>
                
                <p className="text-gray-700 mb-6 text-base">{proposal.description.substring(0, 200)}...</p>
                
                {/* Vote data display */}
                <div className="mb-6">
                  {/* Vote percentages */}
                  <div className="grid grid-cols-3 gap-4 text-sm sm:text-base mb-3">
                    <div className="text-green-600 font-medium">Yes: {voteData.yesPercentage.toFixed(1)}%</div>
                    <div className="text-red-600 font-medium text-center">No: {voteData.noPercentage.toFixed(1)}%</div>
                    <div className="text-gray-600 font-medium text-right">Abstain: {voteData.abstainPercentage.toFixed(1)}%</div>
                  </div>
                  
                  {/* Vote bar */}
                  {renderVoteBar(proposal)}
                  
                  {/* Vote counts */}
                  <div className="grid grid-cols-3 gap-4 text-sm text-gray-500 mt-2">
                    <div>{Math.round(voteData.yesVotes)} voter{Math.round(voteData.yesVotes) !== 1 && 's'}</div>
                    <div className="text-center">{Math.round(voteData.noVotes)} voter{Math.round(voteData.noVotes) !== 1 && 's'}</div>
                    <div className="text-right">{Math.round(voteData.abstainVotes)} voter{Math.round(voteData.abstainVotes) !== 1 && 's'}</div>
                  </div>
                  
                  {/* Voting power section - FOLLOWING DASHBOARD APPROACH */}
                  <div className="mt-5 border-t pt-4 text-sm text-gray-600">
                    <div className="flex justify-between mb-0">
                    </div>
                    
                    {/* Display voting power values */}
                    <div className="grid grid-cols-3 gap-4 text-sm text-gray-600 mt-1">
                      <div>{formatToFiveDecimals(voteData.yesVotingPower || 0)} JST</div>
                      <div className="text-center">{formatToFiveDecimals(voteData.noVotingPower || 0)} JST</div>
                      <div className="text-right">{formatToFiveDecimals(voteData.abstainVotingPower || 0)} JST</div>
                    </div>
                  </div>
                  
                  {/* Show if the data includes pending votes */}
                  {isPending && (
                    <div className="text-sm text-yellow-600 mt-3 italic">
                      Vote in progress, waiting for blockchain confirmation...
                    </div>
                  )}
                  
                  {/* Total voters count */}
                  <div className="text-sm text-gray-500 mt-3 text-right">
                    Total voters: {voteData.totalVoters || 0}
                  </div>
                </div>
                
                {userVoted ? (
                  <div className="flex items-center text-base text-gray-700 p-3 bg-blue-50 rounded-lg">
                    <span className="mr-2">You voted:</span>
                    <span className="px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800 font-medium">
                      {getVoteTypeText(voteType)}
                    </span>
                  </div>
                ) : proposal.state === PROPOSAL_STATES.ACTIVE && (
                  <div>
                    {hasVotingPower ? (
                      <div>
                        <div className="mb-3 text-base text-gray-700 p-3 bg-indigo-50 rounded-lg">
                          Your voting power: <span className="font-medium">{formatToFiveDecimals(votingPower)} JST</span>
                        </div>
                        
                        {proposalQuorum > 0 && (
                          <div className="mt-5 mb-5">
                            <div className="flex justify-between text-sm text-gray-700 mb-2">
                              <span className="font-medium">Quorum Progress</span>
                              <span>
                                {formatNumberDisplay(voteData.totalVotingPower || 0)} / {formatNumberDisplay(proposalQuorum)} JST
                                ({Math.min(100, Math.round(((voteData.totalVotingPower || 0) / (proposalQuorum || 1)) * 100))}%)
                              </span>
                            </div>
                            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="bg-blue-500 h-full rounded-full" 
                                style={{ width: `${Math.min(100, ((voteData.totalVotingPower || 0) / (proposalQuorum || 1)) * 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-4 mt-6">
                          <button 
                            className="flex-1 min-w-0 bg-green-500 hover:bg-green-600 text-white py-3 px-2 rounded-lg flex items-center justify-center text-sm sm:text-base font-medium"
                            onClick={() => submitVote(proposal.id, VOTE_TYPES.FOR)}
                            disabled={voting.processing || isPending}
                          >
                            <Check className="w-5 h-5 mr-2 flex-shrink-0" />
                            <span className="truncate">Yes</span>
                          </button>
                          <button 
                            className="flex-1 min-w-0 bg-red-500 hover:bg-red-600 text-white py-3 px-2 rounded-lg flex items-center justify-center text-sm sm:text-base font-medium"
                            onClick={() => submitVote(proposal.id, VOTE_TYPES.AGAINST)}
                            disabled={voting.processing || isPending}
                          >
                            <X className="w-5 h-5 mr-2 flex-shrink-0" />
                            <span className="truncate">No</span>
                          </button>
                          <button 
                            className="flex-1 min-w-0 bg-gray-500 hover:bg-gray-600 text-white py-3 px-2 rounded-lg flex items-center justify-center text-sm sm:text-base font-medium"
                            onClick={() => submitVote(proposal.id, VOTE_TYPES.ABSTAIN)}
                            disabled={voting.processing || isPending}
                          >
                            <span className="truncate">Abstain</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-red-500 bg-red-50 rounded-lg my-3">
                        You don't have voting power for this proposal. You may need to delegate to yourself or acquire tokens before the snapshot.
                      </div>
                    )}
                  </div>
                )}
                
                <div className="mt-6 text-center">
                  <button 
                    className="text-indigo-600 hover:text-indigo-800 text-sm font-medium px-3 py-1.5 border border-indigo-300 rounded-md hover:bg-indigo-50"
                    onClick={() => {
                      setSelectedProposal(proposal);
                      setShowModal(true);
                    }}
                  >
                    View Full Details
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-12 text-gray-500 bg-white p-8 rounded-lg shadow-md">
            No proposals found for this filter
          </div>
        )}
      </div>
      
      {/* Proposal Details Modal */}
      {showModal && selectedProposal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start p-4 border-b">
              <div>
                <h3 className="text-xl font-semibold">{selectedProposal.title}</h3>
                <p className="text-sm text-gray-500">Proposal #{selectedProposal.id}</p>
              </div>
              <button 
                className="text-gray-500 hover:text-gray-700"
                onClick={() => setShowModal(false)}
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4">
              {/* Proposal type and status */}
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full">
                  {selectedProposal.proposalType || "General Proposal"}
                </span>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  selectedProposal.state === PROPOSAL_STATES.ACTIVE 
                    ? "bg-yellow-100 text-yellow-800"
                    : selectedProposal.state === PROPOSAL_STATES.SUCCEEDED
                    ? "bg-green-100 text-green-800"
                    : selectedProposal.state === PROPOSAL_STATES.DEFEATED
                    ? "bg-red-100 text-red-800"
                    : "bg-gray-100 text-gray-800"
                }`}>
                  {PROPOSAL_STATES[selectedProposal.state] || "Active"}
                </span>
              </div>
              
              {/* Proposal metadata */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="flex items-center text-sm">
                  <Calendar className="w-4 h-4 mr-2 text-gray-500" />
                  <div>
                    <span className="text-gray-600">Created:</span> {new Date(selectedProposal.createdAt*1000).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center text-sm">
                  <Clock className="w-4 h-4 mr-2 text-gray-500" />
                  <div>
                    <span className="text-gray-600">Deadline:</span> {formatCountdown(selectedProposal.deadline)}
                  </div>
                </div>
                <div className="flex items-center text-sm">
                  <Users className="w-4 h-4 mr-2 text-gray-500" />
                  <div>
                    <span className="text-gray-600">Proposer:</span> {selectedProposal.proposer?.substring(0, 6)}...{selectedProposal.proposer?.slice(-4)}
                  </div>
                </div>
                <div className="flex items-center text-sm">
                  <BarChart2 className="w-4 h-4 mr-2 text-gray-500" />
                  <div>
                    <span className="text-gray-600">Quorum:</span>{" "}
                    {(() => {
                      const proposalQuorum = getQuorumForProposal(selectedProposal.id);
                      if (proposalQuorum > 0) {
                        return `${formatNumberDisplay(proposalQuorum)} JST`;
                      } else if (quorum > 0) {
                        return `${formatNumberDisplay(quorum)} JST`;
                      } else {
                        return "Loading...";
                      }
                    })()}
                    {selectedProposal.snapshotId && (
                      <span className="ml-1 text-xs text-gray-500">
                        (Snapshot #{selectedProposal.snapshotId})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Full description */}
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Description</h4>
                <div className="bg-gray-50 p-3 rounded border text-sm whitespace-pre-wrap">
                  {selectedProposal.description}
                </div>
              </div>
              
              {/* Vote results */}
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Voting Results</h4>
                <div className="bg-gray-50 p-4 rounded border">
                  {(() => {
                    const voteData = getVoteData(selectedProposal);
                    const isPending = hasPendingVote(selectedProposal.id);
                    const proposalQuorum = getQuorumForProposal(selectedProposal.id);
                    
                    return (
                      <>
                        {/* Vote counts */}
                        <h5 className="text-sm font-medium mb-3">Vote Counts (1 vote per person)</h5>
                        
                        <div className="grid grid-cols-3 gap-4 text-center mb-3">
                          <div>
                            <div className="text-green-600 font-medium">{Math.round(voteData.yesVotes)}</div>
                            <div className="text-xs text-gray-500">Yes Votes</div>
                          </div>
                          <div>
                            <div className="text-red-600 font-medium">{Math.round(voteData.noVotes)}</div>
                            <div className="text-xs text-gray-500">No Votes</div>
                          </div>
                          <div>
                            <div className="text-gray-600 font-medium">{Math.round(voteData.abstainVotes)}</div>
                            <div className="text-xs text-gray-500">Abstain</div>
                          </div>
                        </div>
                        
                        {/* Percentage labels */}
                        <div className="grid grid-cols-3 gap-4 text-center mb-3 text-xs text-gray-500">
                          <div>Yes: {voteData.yesPercentage.toFixed(1)}%</div>
                          <div>No: {voteData.noPercentage.toFixed(1)}%</div>
                          <div>Abstain: {voteData.abstainPercentage.toFixed(1)}%</div>
                        </div>
                        
                        {/* Vote bar */}
                        {renderVoteBar(selectedProposal)}
                        
                        {/* Show pending vote notice if applicable */}
                        {isPending && (
                          <div className="text-xs text-yellow-600 mt-2 italic text-center">
                            Vote in progress, waiting for blockchain confirmation...
                          </div>
                        )}
                        
                        {/* Total voters count */}
                        <div className="text-center text-xs text-gray-500 mt-3 mb-5">
                          Total voters: {voteData.totalVoters || 0}
                        </div>
                        
                        {/* Quorum progress */}
                        {proposalQuorum > 0 && (
                          <div className="mt-4 mb-5">
                            <h5 className="text-sm font-medium mb-2">Quorum Progress</h5>
                            <div className="flex justify-between text-xs text-gray-700 mb-2">
                              <span className="font-medium">
                                Current participation: {Math.min(100, Math.round(((voteData.totalVotingPower || 0) / (proposalQuorum || 1)) * 100))}%
                              </span>
                              <span>
                                {formatNumberDisplay(voteData.totalVotingPower || 0)} / {formatNumberDisplay(proposalQuorum)} JST
                              </span>
                            </div>
                            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="bg-blue-500 h-full rounded-full" 
                                style={{ width: `${Math.min(100, ((voteData.totalVotingPower || 0) / (proposalQuorum || 1)) * 100)}%` }}
                              ></div>
                            </div>
                            {selectedProposal.snapshotId && (
                              <div className="text-xs text-gray-500 mt-1">
                                Quorum calculated at snapshot #{selectedProposal.snapshotId}
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Voting power heading */}
                        <h5 className="text-sm font-medium mt-5 mb-3">Voting Power Distribution</h5>
                        
                        {/* Voting power display */}
                        <div className="grid grid-cols-3 gap-4 text-center mb-3">
                          <div>
                            <div className="text-green-600 font-medium">{formatToFiveDecimals(voteData.yesVotingPower || 0)}</div>
                            <div className="text-xs text-gray-500">Yes JST</div>
                          </div>
                          <div>
                            <div className="text-red-600 font-medium">{formatToFiveDecimals(voteData.noVotingPower || 0)}</div>
                            <div className="text-xs text-gray-500">No JST</div>
                          </div>
                          <div>
                            <div className="text-gray-600 font-medium">{formatToFiveDecimals(voteData.abstainVotingPower || 0)}</div>
                            <div className="text-xs text-gray-500">Abstain JST</div>
                          </div>
                        </div>
                        
                        {/* Total voting power */}
                        <div className="text-center text-xs text-gray-500 mt-3">
                          Total voting power: {formatNumberDisplay(voteData.totalVotingPower || 0)} JST
                        </div>
                      </>
                    );
                  })()}
                  
                  {/* User's vote */}
                  {hasUserVoted(selectedProposal) && (
                    <div className="mt-5 text-center text-sm">
                      <span className="text-gray-600">Your vote:</span> 
                      <span className={`ml-1 font-medium ${
                        getUserVoteType(selectedProposal) === VOTE_TYPES.FOR 
                          ? "text-green-600" 
                          : getUserVoteType(selectedProposal) === VOTE_TYPES.AGAINST
                          ? "text-red-600" 
                          : "text-gray-600"
                      }`}>
                        {getVoteTypeText(getUserVoteType(selectedProposal))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Additional proposal details */}
              {selectedProposal.actions && selectedProposal.actions.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Actions</h4>
                  <div className="bg-gray-50 p-3 rounded border">
                    <ul className="list-disc pl-5 text-sm">
                      {selectedProposal.actions.map((action, i) => (
                        <li key={i} className="mb-1">{action}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              
              {/* Transaction details if available */}
              {selectedProposal.txHash && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Transaction Hash</h4>
                  <div className="bg-gray-50 p-3 rounded border text-sm break-all">
                    {selectedProposal.txHash}
                  </div>
                </div>
              )}
            </div>
            
            <div className="border-t p-4 flex justify-end">
              <button
                className="px-4 py-2 bg-gray-200 rounded-md text-gray-800 hover:bg-gray-300"
                onClick={() => setShowModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoteTab;