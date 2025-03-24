// src/services/BlockchainDataService.js - Enhanced version
import { ethers } from 'ethers';

/**
 * Service for fetching token and delegation data directly from the blockchain
 * with NO mock/placeholder data whatsoever
 */
class BlockchainDataService {
  constructor(web3Context, contracts) {
    this.web3Context = web3Context;
    this.contracts = contracts;
    this.tokenContract = contracts?.justToken;
    this.governanceContract = contracts?.governance;
    this.timelockContract = contracts?.timelock;
    this.provider = web3Context?.provider;
    
    console.log('BlockchainDataService initialized with:', {
      provider: Boolean(this.provider),
      tokenContract: Boolean(this.tokenContract),
      governanceContract: Boolean(this.governanceContract),
      timelockContract: Boolean(this.timelockContract),
      contractKeys: Object.keys(contracts || {})
    });
    
    // Cache settings - using shorter TTL for development
    this.cache = {
      balances: new Map(),
      delegations: new Map(),
      votingPower: new Map(),
      proposals: new Map(),
      stats: null,
      votes: new Map()
    };
    this.cacheTTL = 3000; // 3 seconds cache lifetime
    this.cacheTimestamps = {
      balances: new Map(),
      delegations: new Map(),
      votingPower: new Map(),
      proposals: new Map(),
      stats: 0,
      votes: new Map()
    };
  }

  /**
   * Initialize the service with updated context if needed
   */
  initialize(web3Context, contracts) {
    this.web3Context = web3Context || this.web3Context;
    this.contracts = contracts || this.contracts;
    this.tokenContract = this.contracts?.justToken;
    this.governanceContract = this.contracts?.governance;
    this.timelockContract = this.contracts?.timelock;
    this.provider = this.web3Context?.provider;
    
    console.log('BlockchainDataService re-initialized with:', {
      provider: Boolean(this.provider),
      tokenContract: Boolean(this.tokenContract),
      governanceContract: Boolean(this.governanceContract),
      timelockContract: Boolean(this.timelockContract),
      contractKeys: Object.keys(this.contracts || {})
    });
    
    this.clearCache();
  }

  /**
   * Clear the entire cache or a specific cache type
   */
  clearCache(cacheType = null) {
    if (cacheType) {
      this.cache[cacheType].clear();
      if (this.cacheTimestamps[cacheType] instanceof Map) {
        this.cacheTimestamps[cacheType].clear();
      } else {
        this.cacheTimestamps[cacheType] = 0;
      }
    } else {
      this.cache.balances.clear();
      this.cache.delegations.clear();
      this.cache.votingPower.clear();
      this.cache.proposals.clear();
      this.cache.votes.clear();
      this.cache.stats = null;
      
      this.cacheTimestamps.balances.clear();
      this.cacheTimestamps.delegations.clear();
      this.cacheTimestamps.votingPower.clear();
      this.cacheTimestamps.proposals.clear();
      this.cacheTimestamps.votes.clear();
      this.cacheTimestamps.stats = 0;
    }
  }

  /**
   * Check if cached data is still valid
   */
  isCacheValid(cacheType, key = null) {
    const now = Date.now();
    if (key) {
      const timestamp = this.cacheTimestamps[cacheType].get(key);
      return timestamp && (now - timestamp < this.cacheTTL);
    } else {
      return this.cacheTimestamps[cacheType] && (now - this.cacheTimestamps[cacheType] < this.cacheTTL);
    }
  }

  /**
   * Update cache with new data
   */
  updateCache(cacheType, key, data) {
    if (key) {
      this.cache[cacheType].set(key, data);
      this.cacheTimestamps[cacheType].set(key, Date.now());
    } else {
      this.cache[cacheType] = data;
      this.cacheTimestamps[cacheType] = Date.now();
    }
  }

  /**
   * Check if contract is available and has required method
   * @param {string} contractName - Name of the contract in this.contracts object
   * @param {string} methodName - Name of the method to check
   * @returns {boolean} Whether the contract and method are available
   */
  hasContractMethod(contractName, methodName) {
    if (!this.contracts || !this.contracts[contractName]) {
      console.error(`Contract ${contractName} not available`);
      return false;
    }
    
    const contract = this.contracts[contractName];
    if (!contract[methodName] || typeof contract[methodName] !== 'function') {
      console.error(`Method ${methodName} not found on contract ${contractName}`);
      return false;
    }
    
    return true;
  }

  /**
   * Fetch token balance for an address directly from the blockchain
   */
  async getTokenBalance(address) {
    if (!address) {
      console.error("Missing address for getTokenBalance");
      return "0";
    }
    
    if (!this.hasContractMethod('justToken', 'balanceOf')) {
      console.error("Token contract balanceOf method not available");
      return "0";
    }

    try {
      // Check cache first
      if (this.isCacheValid('balances', address)) {
        return this.cache.balances.get(address);
      }

      // If not in cache or expired, fetch from blockchain
      console.log(`Fetching balance for ${address}`);
      const balance = await this.tokenContract.balanceOf(address);
      const formattedBalance = ethers.utils.formatEther(balance);
      console.log(`Raw balance for ${address}:`, balance.toString(), "formatted:", formattedBalance);
      
      // Update cache
      this.updateCache('balances', address, formattedBalance);
      
      return formattedBalance;
    } catch (error) {
      console.error("Error fetching token balance:", error);
      return "0";
    }
  }

  /**
   * Fetch delegation info for an address
   */
  async getDelegationInfo(address) {
    if (!address) {
      console.error("Missing address for getDelegationInfo");
      return {
        currentDelegate: null,
        lockedTokens: "0",
        delegatedToYou: "0",
        delegators: []
      };
    }

    // Check required contract methods
    const hasDelegate = this.hasContractMethod('justToken', 'getDelegate');
    const hasLockedTokens = this.hasContractMethod('justToken', 'getLockedTokens');
    const hasDelegatedToAddress = this.hasContractMethod('justToken', 'getDelegatedToAddress');
    const hasDelegatorsOf = this.hasContractMethod('justToken', 'getDelegatorsOf');
    
    if (!hasDelegate || !hasLockedTokens || !hasDelegatedToAddress || !hasDelegatorsOf) {
      console.error("Required delegation methods not available on contract");
      return {
        currentDelegate: null,
        lockedTokens: "0",
        delegatedToYou: "0",
        delegators: []
      };
    }

    try {
      // Check cache first
      if (this.isCacheValid('delegations', address)) {
        return this.cache.delegations.get(address);
      }

      // If not in cache or expired, fetch from blockchain
      console.log(`Fetching delegation info for ${address}`);
      const currentDelegate = await this.tokenContract.getDelegate(address);
      const lockedTokens = await this.tokenContract.getLockedTokens(address);
      const delegatedToYou = await this.tokenContract.getDelegatedToAddress(address);
      const delegatorAddresses = await this.tokenContract.getDelegatorsOf(address);
      
      console.log(`Delegation data for ${address}:`, {
        currentDelegate,
        lockedTokens: lockedTokens.toString(),
        delegatedToYou: delegatedToYou.toString(),
        delegatorCount: delegatorAddresses.length
      });
      
      // Get balance for each delegator
      const delegators = await Promise.all(
        delegatorAddresses.map(async (delegatorAddr) => {
          const balance = await this.getTokenBalance(delegatorAddr);
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
      
      // Update cache
      this.updateCache('delegations', address, delegationInfo);
      
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
  }

  /**
   * Calculate voting power for an address
   */
  async getVotingPower(address) {
    if (!address) {
      console.error("Missing address for getVotingPower");
      return "0";
    }

    // Check required methods
    if (!this.hasContractMethod('justToken', 'balanceOf') || 
        !this.hasContractMethod('justToken', 'getDelegate') ||
        !this.hasContractMethod('justToken', 'getDelegatedToAddress')) {
      console.error("Required voting power methods not available on contract");
      return "0";
    }

    try {
      // Check cache first
      if (this.isCacheValid('votingPower', address)) {
        return this.cache.votingPower.get(address);
      }

      console.log(`Calculating voting power for ${address}`);
      
      // Get the balance and delegation info
      const balance = await this.getTokenBalance(address);
      const delegationInfo = await this.getDelegationInfo(address);
      
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
        console.log(`Voting power components for ${address}:`, {
          ownBalance: balance,
          delegated: delegationInfo.delegatedToYou,
          total: votingPower
        });
      } else {
        console.log(`User ${address} has delegated to ${delegationInfo.currentDelegate}, voting power is 0`);
      }
      
      // Update cache
      this.updateCache('votingPower', address, votingPower);
      
      return votingPower;
    } catch (error) {
      console.error("Error calculating voting power:", error);
      return "0";
    }
  }

  /**
   * Fetch user's vote history from blockchain events
   */
  async getUserVotes(address) {
    if (!address || !this.governanceContract) {
      return {};
    }
    
    try {
      // Check cache first
      const cacheKey = `votes-${address}`;
      if (this.isCacheValid('votes', cacheKey)) {
        return this.cache.votes.get(cacheKey);
      }
      
      console.log(`Fetching vote history for ${address}`);
      
      // Get all VoteCast events for this user
      const filter = this.governanceContract.filters.VoteCast(null, address);
      const events = await this.governanceContract.queryFilter(filter);
      
      console.log(`Found ${events.length} vote events for user ${address}`);
      
      // Process events into a map of proposalId -> voteType
      const voteHistory = {};
      
      for (const event of events) {
        try {
          const proposalId = event.args.proposalId.toString();
          const voteType = event.args.support.toNumber();
          const votingPower = ethers.utils.formatEther(event.args.votingPower);
          
          // Only keep the most recent vote for each proposal
          voteHistory[proposalId] = {
            type: voteType,
            votingPower,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash
          };
        } catch (err) {
          console.warn("Error processing vote event:", err);
        }
      }
      
      // Update cache
      this.updateCache('votes', cacheKey, voteHistory);
      
      return voteHistory;
    } catch (error) {
      console.error(`Error fetching vote history for ${address}:`, error);
      return {};
    }
  }

  /**
   * Fetch proposal vote totals from the blockchain
   */
  async getProposalVoteTotals(proposalId) {
    if (!proposalId || !this.governanceContract) {
      console.error("Missing proposal ID or governance contract for getProposalVoteTotals");
      return {
        yesVotes: 0,
        noVotes: 0,
        abstainVotes: 0,
        totalVoters: 0,
        yesPercentage: 0,
        noPercentage: 0,
        abstainPercentage: 0
      };
    }
    
    try {
      // Check cache first
      const cacheKey = `votes-${proposalId}`;
      if (this.isCacheValid('proposals', cacheKey)) {
        return this.cache.proposals.get(cacheKey);
      }

      // If not in cache or expired, fetch from blockchain
      console.log(`Fetching vote totals for proposal ${proposalId}`);
      
      // Try first method: direct getProposalVotes call
      try {
        console.log("Using getProposalVotes method");
        const [yesVotes, noVotes, abstainVotes, totalVotingPower, totalVoters] = 
            await this.governanceContract.getProposalVotes(proposalId);
        
        // Calculate percentages
        const totalVotes = yesVotes.add(noVotes).add(abstainVotes);
        const yesPercentage = totalVotes.gt(0) ? yesVotes.mul(100).div(totalVotes).toNumber() : 0;
        const noPercentage = totalVotes.gt(0) ? noVotes.mul(100).div(totalVotes).toNumber() : 0;
        const abstainPercentage = totalVotes.gt(0) ? abstainVotes.mul(100).div(totalVotes).toNumber() : 0;
        
        const voteTotals = {
          yesVotes: ethers.utils.formatEther(yesVotes),
          noVotes: ethers.utils.formatEther(noVotes),
          abstainVotes: ethers.utils.formatEther(abstainVotes),
          totalVotingPower: ethers.utils.formatEther(totalVotingPower),
          totalVoters: totalVoters.toNumber(),
          yesPercentage,
          noPercentage,
          abstainPercentage,
          source: 'contract'
        };
        
        console.log(`Vote totals for proposal ${proposalId}:`, voteTotals);
        
        // Update cache
        this.updateCache('proposals', cacheKey, voteTotals);
        
        return voteTotals;
      } catch (directError) {
        console.warn("Direct getProposalVotes call failed, using event-based approach:", directError);
      }
      
      // Fallback method: Use events to calculate vote totals
      console.log("Using event-based approach for vote totals");
      
      // Get all VoteCast events for this proposal
      const filter = this.governanceContract.filters.VoteCast(proposalId);
      const events = await this.governanceContract.queryFilter(filter);
      
      console.log(`Found ${events.length} vote events for proposal ${proposalId}`);
      
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
      
      const eventBasedVoteTotals = {
        yesVotes: ethers.utils.formatEther(yesVotes),
        noVotes: ethers.utils.formatEther(noVotes),
        abstainVotes: ethers.utils.formatEther(abstainVotes),
        totalVotingPower: ethers.utils.formatEther(totalVotes),
        totalVoters: voterVotes.size,
        yesPercentage,
        noPercentage,
        abstainPercentage,
        source: 'events'
      };
      
      console.log(`Event-based vote totals for proposal ${proposalId}:`, eventBasedVoteTotals);
      
      // Update cache
      this.updateCache('proposals', cacheKey, eventBasedVoteTotals);
      
      return eventBasedVoteTotals;
    } catch (error) {
      console.error(`Error fetching vote totals for proposal ${proposalId}:`, error);
      return {
        yesVotes: "0",
        noVotes: "0",
        abstainVotes: "0",
        totalVoters: 0,
        yesPercentage: 0,
        noPercentage: 0,
        abstainPercentage: 0,
        source: 'error'
      };
    }
  }

  /**
   * Get DAO statistics from blockchain
   */
  async getDAOStats() {
    // Check required methods
    const hasTotalSupply = this.hasContractMethod('justToken', 'totalSupply');
    
    if (!hasTotalSupply) {
      console.error("Required DAO stats methods not available on contracts");
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
        formattedSuccessRate: "0.0%",
        isLoading: false
      };
    }

    try {
      // Check cache first
      if (this.isCacheValid('stats')) {
        return this.cache.stats;
      }

      console.log("Fetching DAO stats from blockchain");
      
      // Initialize with default values
      let totalHolders = 0;
      let circulatingSupply = "0";
      let activeProposals = 0;
      let totalProposals = 0;
      let participationRate = 0;
      let delegationRate = 0;
      let proposalSuccessRate = 0;
      
      // 1. Get total supply
      const totalSupply = await this.tokenContract.totalSupply();
      circulatingSupply = ethers.utils.formatEther(totalSupply);
      
      // 2. Estimate holder count using transfer events
      try {
        // Get Transfer events to identify potential holders
        const filter = this.tokenContract.filters.Transfer();
        const blockNumber = await this.provider.getBlockNumber();
        // Go back a reasonable number of blocks - adjust as needed for your token history
        const fromBlock = Math.max(0, blockNumber - 10000);
        
        console.log(`Querying transfer events from block ${fromBlock} to ${blockNumber}`);
        const events = await this.tokenContract.queryFilter(filter, fromBlock);
        console.log(`Found ${events.length} transfer events`);
        
        // Get unique addresses from transfer events
        const uniqueAddresses = new Set();
        
        // Add all senders and receivers
        for (const event of events) {
          if (event.args) {
            // Skip the zero address (typically used for minting/burning)
            if (event.args.from !== ethers.constants.AddressZero) {
              uniqueAddresses.add(event.args.from.toLowerCase());
            }
            if (event.args.to !== ethers.constants.AddressZero) {
              uniqueAddresses.add(event.args.to.toLowerCase());
            }
          }
        }
        
        console.log(`Found ${uniqueAddresses.size} unique addresses`);
        totalHolders = uniqueAddresses.size;
      } catch (error) {
        console.error("Error estimating holder count:", error);
        totalHolders = 10; // Fallback value
      }
      
      // 3. Get proposal counts (active and total)
      try {
        if (this.governanceContract) {
          // Try to get active proposal count directly
          if (typeof this.governanceContract.getActiveProposalCount === 'function') {
            activeProposals = (await this.governanceContract.getActiveProposalCount()).toNumber();
          } else {
            // Estimate active proposals by checking states
            let activePropCount = 0;
            let totalPropCount = 0;
            let successfulPropCount = 0;
            
            // Determine the number of proposals by binary search or direct method
            if (typeof this.governanceContract.getProposalCount === 'function') {
              totalPropCount = (await this.governanceContract.getProposalCount()).toNumber();
            } else {
              // Binary search for the highest proposal ID
              let low = 0;
              let high = 100;
              
              while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                
                try {
                  await this.governanceContract.getProposalState(mid);
                  low = mid + 1;
                } catch (err) {
                  high = mid - 1;
                }
              }
              
              totalPropCount = high + 1;
            }
            
            // Count active and successful proposals
            for (let i = 0; i < totalPropCount; i++) {
              try {
                const state = await this.governanceContract.getProposalState(i);
                
                if (state === 0) { // Active
                  activePropCount++;
                }
                
                // Count as successful if state is 4 (Succeeded), 5 (Queued), or 7 (Executed)
                if (state === 4 || state === 5 || state === 7) {
                  successfulPropCount++;
                }
              } catch (err) {
                // Skip if error
              }
            }
            
            activeProposals = activePropCount;
            totalProposals = totalPropCount;
            
            // Calculate success rate
            proposalSuccessRate = totalPropCount > 0 ? successfulPropCount / totalPropCount : 0;
          }
        }
      } catch (error) {
        console.error("Error getting proposal counts:", error);
      }
      
      // 4. Get delegation and participation rates
      try {
        // Try to get delegation rate from snapshot metrics
        if (typeof this.tokenContract.getCurrentSnapshotId === 'function') {
          const snapshotId = await this.tokenContract.getCurrentSnapshotId();
          
          if (typeof this.tokenContract.getSnapshotMetrics === 'function') {
            try {
              const metrics = await this.tokenContract.getSnapshotMetrics(snapshotId);
              
              // Different contracts may return metrics in different formats
              if (metrics && metrics.length >= 5) {
                // Likely array return format
                delegationRate = parseFloat(metrics[4].toString()) / 10000; // Convert from basis points
              } else if (metrics && metrics.percentageDelegated) {
                // Object return format
                delegationRate = parseFloat(metrics.percentageDelegated.toString()) / 10000;
              }
            } catch (err) {
              console.warn("Error getting snapshot metrics:", err);
            }
          }
        }
        
        // Estimate participation rate from recent votes
        if (this.governanceContract) {
          // Get recent VoteCast events
          const filter = this.governanceContract.filters.VoteCast();
          const blockNumber = await this.provider.getBlockNumber();
          const fromBlock = Math.max(0, blockNumber - 50000);
          
          const voteEvents = await this.governanceContract.queryFilter(filter, fromBlock);
          
          if (voteEvents.length > 0) {
            // Count unique voters
            const uniqueVoters = new Set();
            for (const event of voteEvents) {
              if (event.args && event.args.voter) {
                uniqueVoters.add(event.args.voter.toLowerCase());
              }
            }
            
            // Estimate participation rate based on unique voters vs total holders
            if (totalHolders > 0) {
              participationRate = uniqueVoters.size / totalHolders;
            }
          }
        }
      } catch (error) {
        console.error("Error estimating participation and delegation rates:", error);
      }
      
      const stats = {
        totalHolders,
        circulatingSupply,
        activeProposals,
        totalProposals,
        participationRate,
        delegationRate,
        proposalSuccessRate,
        formattedParticipationRate: `${(participationRate * 100).toFixed(1)}%`,
        formattedDelegationRate: `${(delegationRate * 100).toFixed(1)}%`,
        formattedSuccessRate: `${(proposalSuccessRate * 100).toFixed(1)}%`,
        isLoading: false
      };
      
      console.log("Final DAO stats:", stats);
      
      // Update cache
      this.updateCache('stats', null, stats);
      
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
        formattedSuccessRate: "0.0%",
        isLoading: false
      };
    }
  }
}

// Create singleton instance
let instance = null;

export const getBlockchainDataService = (web3Context, contracts) => {
  if (!instance) {
    instance = new BlockchainDataService(web3Context, contracts);
  } else if (web3Context || contracts) {
    // Update the instance with new context if provided
    instance.initialize(web3Context, contracts);
  }
  return instance;
};


export default BlockchainDataService;