// src/services/votingDataService.js

import { ethers } from 'ethers';
import blockchainDataCache from '../utils/blockchainDataCache';

/**
 * Service to handle fetching, caching, and reporting on-chain voting data
 * for governance proposals
 */
class VotingDataService {
  constructor(governanceContractAddress, governanceContractABI, provider) {
    this.contractAddress = governanceContractAddress;
    this.provider = provider || new ethers.providers.Web3Provider(window.ethereum);
    this.contract = new ethers.Contract(
      governanceContractAddress,
      governanceContractABI,
      this.provider
    );
    
    // Cache keys
    this.VOTE_TOTALS_KEY_PREFIX = 'voteTotals-';
    this.VOTING_POWER_KEY_PREFIX = 'votingPower-';
    this.USER_VOTE_KEY_PREFIX = 'userVote-';
    this.GLOBAL_STATS_KEY = 'globalVotingStats';
    
    // Cache TTLs in seconds
    this.ACTIVE_PROPOSAL_TTL = 60; // 1 minute for active proposals
    this.GLOBAL_STATS_TTL = 120; // 2 minutes for global stats
    
    // Set up an event listener for vote events
    this._setupEventListeners();
  }

  /**
   * Set up contract event listeners to automatically update the cache
   * when new votes are cast
   */
  _setupEventListeners() {
    // Listen for vote cast events
    this.contract.on('VoteCast', (voter, proposalId, support, votes, event) => {
      console.log(`Vote cast by ${voter} on proposal ${proposalId}`);
      
      // Invalidate cache for this proposal to force refresh
      this._invalidateProposalCache(proposalId);
      
      // Invalidate global stats
      blockchainDataCache.delete(this.GLOBAL_STATS_KEY);
    });
  }

  /**
   * Invalidate all cache entries related to a specific proposal
   * @param {string} proposalId - The proposal ID
   */
  _invalidateProposalCache(proposalId) {
    const voteTotalsKey = `${this.VOTE_TOTALS_KEY_PREFIX}${proposalId}`;
    const votingPowerKey = `${this.VOTING_POWER_KEY_PREFIX}${proposalId}`;
    
    blockchainDataCache.delete(voteTotalsKey);
    blockchainDataCache.delete(votingPowerKey);
    
    // Also delete any keys that match the dashboard pattern
    const dashboardKey = `dashboard-votes-${proposalId}`;
    blockchainDataCache.delete(dashboardKey);
  }

  /**
   * Get vote totals for a specific proposal
   * @param {string} proposalId - The proposal ID
   * @param {boolean} forceRefresh - Force a refresh from the blockchain
   * @returns {Promise<Object>} - Vote totals data
   */
  async getProposalVoteTotals(proposalId, forceRefresh = false) {
    const cacheKey = `${this.VOTE_TOTALS_KEY_PREFIX}${proposalId}`;
    
    // If force refresh, invalidate the cache first
    if (forceRefresh) {
      blockchainDataCache.delete(cacheKey);
    }
    
    // Use the cache's getOrCompute method to fetch the data
    return blockchainDataCache.getOrCompute(
      cacheKey,
      async () => {
        // Call the governance contract's getProposalVoteTotals function
        const voteTotals = await this.contract.getProposalVoteTotals(proposalId);
        
        // Format the response
        return this._formatVoteTotals(voteTotals, proposalId);
      }
    );
  }

  /**
   * Format the raw vote totals data from the contract
   * @param {Object} rawData - Raw data from the contract
   * @param {string} proposalId - The proposal ID
   * @returns {Object} - Formatted vote data
   */
  _formatVoteTotals(rawData, proposalId) {
    // Assuming the contract returns something like:
    // { yes: BigNumber, no: BigNumber, abstain: BigNumber, totalVotes: BigNumber }
    const yesVotes = ethers.utils.formatUnits(rawData.yes || rawData[0] || 0, 0);
    const noVotes = ethers.utils.formatUnits(rawData.no || rawData[1] || 0, 0);
    const abstainVotes = ethers.utils.formatUnits(rawData.abstain || rawData[2] || 0, 0);
    const totalVotingPower = ethers.utils.formatUnits(rawData.totalVotes || rawData[3] || 0, 0);
    
    // Calculate percentages
    const totalVotesCast = parseInt(yesVotes) + parseInt(noVotes) + parseInt(abstainVotes);
    const yesPercentage = totalVotesCast > 0 ? (parseInt(yesVotes) / totalVotesCast * 100) : 0;
    const noPercentage = totalVotesCast > 0 ? (parseInt(noVotes) / totalVotesCast * 100) : 0;
    const abstainPercentage = totalVotesCast > 0 ? (parseInt(abstainVotes) / totalVotesCast * 100) : 0;
    
    // Calculate participation rate
    const participationRate = totalVotingPower > 0 
      ? (totalVotesCast / parseInt(totalVotingPower) * 100) 
      : 0;

    return {
      proposalId,
      yesVotes: parseInt(yesVotes),
      noVotes: parseInt(noVotes),
      abstainVotes: parseInt(abstainVotes),
      totalVotesCast,
      totalVotingPower: parseInt(totalVotingPower),
      yesPercentage: parseFloat(yesPercentage.toFixed(2)),
      noPercentage: parseFloat(noPercentage.toFixed(2)),
      abstainPercentage: parseFloat(abstainPercentage.toFixed(2)),
      participationRate: parseFloat(participationRate.toFixed(2)),
      timestamp: Date.now()
    };
  }

  /**
   * Get a user's vote on a specific proposal
   * @param {string} proposalId - The proposal ID
   * @param {string} userAddress - The user's address
   * @returns {Promise<Object>} - User's vote data
   */
  async getUserVote(proposalId, userAddress) {
    const cacheKey = `${this.USER_VOTE_KEY_PREFIX}${proposalId}-${userAddress}`;
    
    return blockchainDataCache.getOrCompute(
      cacheKey,
      async () => {
        try {
          // Call the contract method to get the user's vote
          const userVote = await this.contract.getUserVote(proposalId, userAddress);
          
          // Format the response
          return {
            hasVoted: userVote.hasVoted,
            support: userVote.support, // 0 = Against, 1 = For, 2 = Abstain
            votes: ethers.utils.formatUnits(userVote.votes || 0, 0),
            timestamp: Date.now()
          };
        } catch (error) {
          console.error(`Error fetching user vote for proposal ${proposalId}:`, error);
          return {
            hasVoted: false,
            support: 0,
            votes: '0',
            error: error.message
          };
        }
      }
    );
  }

  /**
   * Get global voting statistics across all active proposals
   * @param {boolean} forceRefresh - Force a refresh from the blockchain
   * @returns {Promise<Object>} - Global voting statistics
   */
  async getGlobalVotingStats(forceRefresh = false) {
    // If force refresh, invalidate the cache
    if (forceRefresh) {
      blockchainDataCache.delete(this.GLOBAL_STATS_KEY);
    }
    
    return blockchainDataCache.getOrCompute(
      this.GLOBAL_STATS_KEY,
      async () => {
        try {
          // Get active proposals
          const activeProposals = await this.getActiveProposals();
          
          // Get vote totals for each active proposal
          const proposalStats = await Promise.all(
            activeProposals.map(id => this.getProposalVoteTotals(id))
          );
          
          // Aggregate the stats
          const globalStats = this._aggregateVotingStats(proposalStats);
          
          return {
            ...globalStats,
            timestamp: Date.now(),
            activeProposalCount: activeProposals.length
          };
        } catch (error) {
          console.error('Error fetching global voting stats:', error);
          return {
            error: error.message,
            timestamp: Date.now()
          };
        }
      },
      this.GLOBAL_STATS_TTL
    );
  }

  /**
   * Aggregate voting statistics from multiple proposals
   * @param {Array} proposalStats - Array of proposal statistics
   * @returns {Object} - Aggregated statistics
   */
  _aggregateVotingStats(proposalStats) {
    // Initialize counters
    let totalYesVotes = 0;
    let totalNoVotes = 0;
    let totalAbstainVotes = 0;
    let totalVotesCast = 0;
    let totalVotingPower = 0;
    
    // Aggregate stats
    proposalStats.forEach(stat => {
      totalYesVotes += stat.yesVotes;
      totalNoVotes += stat.noVotes;
      totalAbstainVotes += stat.abstainVotes;
      totalVotesCast += stat.totalVotesCast;
      totalVotingPower += stat.totalVotingPower;
    });
    
    // Calculate percentages
    const yesPercentage = totalVotesCast > 0 ? (totalYesVotes / totalVotesCast * 100) : 0;
    const noPercentage = totalVotesCast > 0 ? (totalNoVotes / totalVotesCast * 100) : 0;
    const abstainPercentage = totalVotesCast > 0 ? (totalAbstainVotes / totalVotesCast * 100) : 0;
    
    // Calculate participation rate
    const participationRate = totalVotingPower > 0 
      ? (totalVotesCast / totalVotingPower * 100) 
      : 0;
    
    return {
      totalYesVotes,
      totalNoVotes,
      totalAbstainVotes,
      totalVotesCast,
      totalVotingPower,
      yesPercentage: parseFloat(yesPercentage.toFixed(2)),
      noPercentage: parseFloat(noPercentage.toFixed(2)),
      abstainPercentage: parseFloat(abstainPercentage.toFixed(2)),
      participationRate: parseFloat(participationRate.toFixed(2))
    };
  }

  /**
   * Get list of active proposal IDs
   * @returns {Promise<Array>} - Array of active proposal IDs
   */
  async getActiveProposals() {
    const cacheKey = 'activeProposals';
    
    return blockchainDataCache.getOrCompute(
      cacheKey,
      async () => {
        try {
          // Call the contract method to get active proposals
          const activeProposals = await this.contract.getActiveProposals();
          
          // Return as array of strings for easier handling
          return activeProposals.map(id => id.toString());
        } catch (error) {
          console.error('Error fetching active proposals:', error);
          return [];
        }
      },
      this.ACTIVE_PROPOSAL_TTL
    );
  }

  /**
   * Force refresh all voting data
   * @returns {Promise<void>}
   */
  async refreshAllVotingData() {
    try {
      // Get active proposals
      const activeProposals = await this.getActiveProposals(true);
      
      // Refresh vote totals for each proposal
      await Promise.all(
        activeProposals.map(id => this.getProposalVoteTotals(id, true))
      );
      
      // Refresh global stats
      await this.getGlobalVotingStats(true);
      
      console.log('All voting data refreshed successfully');
    } catch (error) {
      console.error('Error refreshing all voting data:', error);
      throw error;
    }
  }

  /**
   * Update the UI with the latest voting data for a proposal
   * @param {string} proposalId - The proposal ID
   * @param {function} updateCallback - Callback function to update the UI
   */
  async updateProposalUI(proposalId, updateCallback) {
    try {
      // Get the latest vote totals
      const voteTotals = await this.getProposalVoteTotals(proposalId);
      
      // Call the update callback with the data
      updateCallback(voteTotals);
    } catch (error) {
      console.error(`Error updating UI for proposal ${proposalId}:`, error);
    }
  }

  /**
   * Update the UI with global voting statistics
   * @param {function} updateCallback - Callback function to update the UI
   */
  async updateGlobalStatsUI(updateCallback) {
    try {
      // Get the latest global stats
      const globalStats = await this.getGlobalVotingStats();
      
      // Call the update callback with the data
      updateCallback(globalStats);
    } catch (error) {
      console.error('Error updating global stats UI:', error);
    }
  }
}

export default VotingDataService;