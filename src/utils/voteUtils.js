// src/utils/voteUtils.js
import { ethers } from 'ethers';

/**
 * Normalize vote data from different sources to a consistent format
 * @param {Object} voteData - Raw vote data from blockchain
 * @returns {Object} Normalized vote data with consistent types and formats
 */
export function normalizeVoteData(voteData) {
  if (!voteData) {
    return {
      yesVotes: 0,
      noVotes: 0,
      abstainVotes: 0,
      totalVotes: 0,
      yesVotingPower: 0,
      noVotingPower: 0,
      abstainVotingPower: 0,
      totalVotingPower: 0,
      totalVoters: 0,
      yesPercentage: 0,
      noPercentage: 0,
      abstainPercentage: 0,
      source: 'default'
    };
  }
  
  // Copy the data to avoid mutation
  const normalized = { ...voteData };
  
  // Convert all vote counts to numbers
  normalized.yesVotes = parseFloat(normalized.yesVotes) || 0;
  normalized.noVotes = parseFloat(normalized.noVotes) || 0;
  normalized.abstainVotes = parseFloat(normalized.abstainVotes) || 0;
  normalized.totalVotes = normalized.totalVotes || 0;
  
  // Handle voting power (may be in various formats)
  normalized.yesVotingPower = parseFloat(normalized.yesVotingPower || normalized.yesVotes) || 0;
  normalized.noVotingPower = parseFloat(normalized.noVotingPower || normalized.noVotes) || 0;
  normalized.abstainVotingPower = parseFloat(normalized.abstainVotingPower || normalized.abstainVotes) || 0;
  normalized.totalVotingPower = parseFloat(normalized.totalVotingPower) || 0;
  
  // If totalVotingPower is not set, calculate it
  if (normalized.totalVotingPower === 0) {
    normalized.totalVotingPower = 
      normalized.yesVotingPower + 
      normalized.noVotingPower + 
      normalized.abstainVotingPower;
  }
  
  // Ensure we have totalVoters
  normalized.totalVoters = normalized.totalVoters || 0;
  
  // Recalculate percentages for consistency
  if (normalized.totalVotingPower > 0) {
    normalized.yesPercentage = (normalized.yesVotingPower / normalized.totalVotingPower) * 100;
    normalized.noPercentage = (normalized.noVotingPower / normalized.totalVotingPower) * 100;
    normalized.abstainPercentage = (normalized.abstainVotingPower / normalized.totalVotingPower) * 100;
  } else {
    normalized.yesPercentage = 0;
    normalized.noPercentage = 0;
    normalized.abstainPercentage = 0;
  }
  
  return normalized;
}

/**
 * Format vote totals for display with appropriate precision
 * @param {number} value - Vote total to format
 * @param {boolean} isPercentage - Whether this is a percentage value
 * @returns {string} Formatted vote total
 */
export function formatVoteTotal(value, isPercentage = false) {
  if (value === undefined || value === null) {
    return isPercentage ? '0.0%' : '0';
  }
  
  // Handle string inputs
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  
  // If it's NaN or not a number, return default
  if (isNaN(numValue)) {
    return isPercentage ? '0.0%' : '0';
  }
  
  if (isPercentage) {
    return `${numValue.toFixed(1)}%`;
  }
  
  // For vote counts, use integer format
  if (numValue < 1000) {
    return Math.round(numValue).toString();
  }
  
  // For larger numbers, use locale string with commas
  return Math.round(numValue).toLocaleString();
}

/**
 * Calculate if a proposal has reached quorum
 * @param {Object} voteData - Normalized vote data
 * @param {number} quorum - Required quorum amount
 * @returns {boolean} Whether quorum has been reached
 */
export function hasReachedQuorum(voteData, quorum) {
  if (!voteData || !quorum) return false;
  
  const totalVotingPower = parseFloat(voteData.totalVotingPower) || 0;
  return totalVotingPower >= quorum;
}

/**
 * Determine which option is winning a vote
 * @param {Object} voteData - Normalized vote data
 * @returns {string} 'yes', 'no', 'abstain', or 'tie'
 */
export function getWinningVote(voteData) {
  if (!voteData) return 'tie';
  
  const yes = parseFloat(voteData.yesVotingPower) || 0;
  const no = parseFloat(voteData.noVotingPower) || 0;
  const abstain = parseFloat(voteData.abstainVotingPower) || 0;
  
  if (yes > no && yes > abstain) return 'yes';
  if (no > yes && no > abstain) return 'no';
  if (abstain > yes && abstain > no) return 'abstain';
  return 'tie';
}

/**
 * Get the user's current vote on a proposal
 * @param {Object} proposal - Proposal data
 * @param {Object} votedProposals - Map of user's voted proposals
 * @param {Object} VOTE_TYPES - Constants for vote types
 * @returns {number|null} Vote type ID or null if not voted
 */
export function getUserVote(proposal, votedProposals, VOTE_TYPES) {
  // Check if we have a record in votedProposals
  if (votedProposals && votedProposals[proposal.id] !== undefined) {
    return votedProposals[proposal.id];
  }
  
  // Fall back to proposal data
  if (proposal.votedYes) return VOTE_TYPES.FOR;
  if (proposal.votedNo) return VOTE_TYPES.AGAINST;
  if (proposal.hasVoted) return VOTE_TYPES.ABSTAIN;
  
  return null;
}

/**
 * Convert vote type to human-readable text
 * @param {number} voteType - Vote type ID
 * @param {Object} VOTE_TYPES - Constants for vote types
 * @returns {string} Human-readable vote type
 */
export function voteTypeToText(voteType, VOTE_TYPES) {
  if (voteType === VOTE_TYPES.FOR) return 'Yes';
  if (voteType === VOTE_TYPES.AGAINST) return 'No';
  if (voteType === VOTE_TYPES.ABSTAIN) return 'Abstain';
  return '';
}

/**
 * Gets the color class for a vote type
 * @param {number} voteType - Vote type ID 
 * @param {Object} VOTE_TYPES - Constants for vote types
 * @returns {string} Tailwind CSS color class
 */
export function getVoteTypeColor(voteType, VOTE_TYPES) {
  if (voteType === VOTE_TYPES.FOR) return 'text-green-600';
  if (voteType === VOTE_TYPES.AGAINST) return 'text-red-600';
  if (voteType === VOTE_TYPES.ABSTAIN) return 'text-gray-600';
  return 'text-gray-600';
}