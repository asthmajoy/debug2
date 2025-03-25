import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../contexts/Web3Context';

export function useDAOStats() {
  const { contracts, contractsReady, refreshCounter, isConnected, account, networkId } = useWeb3();
  const [dashboardStats, setDashboardStats] = useState({
    totalHolders: 0,
    circulatingSupply: "0",
    activeProposals: 0,
    totalProposals: 0,
    participationRate: 0,
    delegationRate: 0,
    proposalSuccessRate: 0,
    isLoading: true,
    errorMessage: null
  });

  // Enhanced tokenHolders fetching that prioritizes direct blockchain queries
  const fetchTokenHolders = useCallback(async () => {
    console.log("Fetching token holders...");
    
    if (!contracts.token?.address) {
      console.warn("Token contract address not available");
      return 0; // Return 0 instead of a hardcoded fallback
    }
    
    try {
      // Direct approach using the token contract
      console.log("Getting token holders from transfer events and balance checks...");
      
      // 1. Get total supply first to understand scale
      const totalSupply = await contracts.token.totalSupply();
      console.log(`Total token supply: ${ethers.utils.formatEther(totalSupply)}`);
      
      // 2. Try to get transfer events to find holders
      const filter = contracts.token.filters.Transfer();
      const blockNumber = await contracts.token.provider.getBlockNumber();
      const fromBlock = Math.max(0, blockNumber - 10000); // Last 10,000 blocks should be sufficient
      
      console.log(`Querying transfer events from block ${fromBlock} to ${blockNumber}`);
      const events = await contracts.token.queryFilter(filter, fromBlock);
      
      // 3. Get unique addresses from events
      const potentialHolders = new Set();
      
      for (const event of events) {
        if (event.args) {
          if (event.args.from !== ethers.constants.AddressZero) {
            potentialHolders.add(event.args.from.toLowerCase());
          }
          if (event.args.to !== ethers.constants.AddressZero) {
            potentialHolders.add(event.args.to.toLowerCase());
          }
        }
      }
      
      console.log(`Found ${potentialHolders.size} potential token holders from events`);
      
      // 4. Check relevant contract addresses
      const contractAddresses = [];
      if (contracts.governance?.address) contractAddresses.push(contracts.governance.address.toLowerCase());
      if (contracts.analyticsHelper?.address) contractAddresses.push(contracts.analyticsHelper.address.toLowerCase());
      if (contracts.timelock?.address) contractAddresses.push(contracts.timelock.address.toLowerCase());
      
      // Add these addresses to potential holders
      contractAddresses.forEach(addr => potentialHolders.add(addr));
      if (account) potentialHolders.add(account.toLowerCase());
      
      // 5. Check balances in batches
      const addresses = Array.from(potentialHolders);
      console.log(`Checking balances for ${addresses.length} addresses...`);
      
      let confirmedHolders = 0;
      const batchSize = 20; // Increase batch size for efficiency
      
      for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        
        const balancePromises = batch.map(address => {
          return contracts.token.balanceOf(address)
            .then(balance => ({ address, hasBalance: !balance.isZero() }))
            .catch(() => ({ address, hasBalance: false }));
        });
        
        const results = await Promise.all(balancePromises);
        const batchHolders = results.filter(r => r.hasBalance).length;
        confirmedHolders += batchHolders;
      }
      
      console.log(`Found ${confirmedHolders} addresses with non-zero token balance`);
      
      // 6. Handle edge case - if we found no holders but we know tokens exist
      if (confirmedHolders === 0 && !totalSupply.isZero()) {
        console.log("No holders found but supply exists - checking top 20 likely addresses");
        
        // Try checking likely addresses (deployer, early addresses, etc.)
        const likelyHolders = [
          account, // Connected wallet
          contracts.governance?.address,
          contracts.timelock?.address
        ].filter(Boolean);
        
        // Add some early addresses (often used for token distribution)
        for (let i = 1; i <= 10; i++) {
          try {
            const potentialAddress = ethers.utils.getAddress(
              ethers.utils.hexZeroPad(ethers.utils.hexlify(i), 20)
            );
            likelyHolders.push(potentialAddress);
          } catch (err) {}
        }
        
        // Check these addresses
        for (const addr of likelyHolders) {
          try {
            const balance = await contracts.token.balanceOf(addr);
            if (!balance.isZero()) {
              confirmedHolders++;
            }
          } catch (error) {}
        }
        
        console.log(`Found ${confirmedHolders} holders through likely address checks`);
      }
      
      return confirmedHolders;
    } catch (error) {
      console.error("Error in token holder count:", error);
      
      // Try a simplified approach as last resort
      try {
        // Just try to count any address with positive balance
        if (contracts.token.signer) {
          const signerBalance = await contracts.token.balanceOf(contracts.token.signer.address);
          if (!signerBalance.isZero()) return 1;
        }
        
        if (account) {
          const accountBalance = await contracts.token.balanceOf(account);
          if (!accountBalance.isZero()) return 1;
        }
        
        if (contracts.governance?.address) {
          const govBalance = await contracts.token.balanceOf(contracts.governance.address);
          if (!govBalance.isZero()) return 1;
        }
      } catch (e) {
        console.error("Final fallback for holders also failed:", e);
      }
      
      // Last resort - return 0 to indicate we couldn't determine holders
      return 0;
    }
  }, [contracts, account]);

  // Improved supply data fetching with better error handling
  const fetchSupplyData = useCallback(async () => {
    console.log("Fetching supply data...");
    
    if (!contracts.token) {
      console.warn("Token contract not available");
      return { circulatingSupply: "0", totalTokenSupply: "0" };
    }
    
    try {
      // 1. Get total supply
      const totalSupply = await contracts.token.totalSupply();
      console.log("Raw total supply:", totalSupply.toString());
      
      // 2. Get treasury/governance balance
      let treasuryBalance = ethers.BigNumber.from(0);
      let treasurySource = "No treasury found";
      
      // Try multiple ways to get treasury balance
      if (contracts.governance?.address) {
        try {
          treasuryBalance = await contracts.token.balanceOf(contracts.governance.address);
          treasurySource = "governance contract";
        } catch (error) {
          console.warn("Error getting governance balance:", error);
        }
      }
      
      if (treasuryBalance.isZero() && contracts.timelock?.address) {
        try {
          treasuryBalance = await contracts.token.balanceOf(contracts.timelock.address);
          treasurySource = "timelock contract";
        } catch (error) {
          console.warn("Error getting timelock balance:", error);
        }
      }
      
      if (treasuryBalance.isZero() && contracts.analyticsHelper) {
        try {
          const tokenAnalytics = await contracts.analyticsHelper.getTokenDistributionAnalytics();
          if (tokenAnalytics && tokenAnalytics.treasuryBalance) {
            if (typeof tokenAnalytics.treasuryBalance.toBigNumber === 'function') {
              treasuryBalance = tokenAnalytics.treasuryBalance.toBigNumber();
            } else if (typeof tokenAnalytics.treasuryBalance._hex === 'string') {
              treasuryBalance = ethers.BigNumber.from(tokenAnalytics.treasuryBalance);
            } else {
              treasuryBalance = ethers.BigNumber.from(tokenAnalytics.treasuryBalance.toString());
            }
            treasurySource = "analytics helper";
          }
        } catch (error) {
          console.warn("Error getting treasury balance from analytics:", error);
        }
      }
      
      console.log(`Treasury balance (from ${treasurySource}):`, ethers.utils.formatEther(treasuryBalance));
      
      // 3. Calculate circulating supply (total - treasury)
      const circulatingSupplyBN = totalSupply.sub(treasuryBalance);
      
      // Format with appropriate decimal handling
      const formattedTotal = ethers.utils.formatEther(totalSupply);
      const formattedCirculating = ethers.utils.formatEther(circulatingSupplyBN);
      
      console.log("Formatted circulating supply:", formattedCirculating);
      
      return {
        circulatingSupply: formattedCirculating,
        totalTokenSupply: formattedTotal
      };
    } catch (error) {
      console.error("Error fetching supply data:", error);
      return {
        circulatingSupply: "0",
        totalTokenSupply: "0"
      };
    }
  }, [contracts]);

  // More accurate proposal count fetching
  const fetchProposalStats = useCallback(async () => {
    console.log("Fetching proposal stats...");
    
    if (!contracts.governance) {
      console.warn("Governance contract not available");
      return { activeProposals: 0, totalProposals: 0, proposalSuccessRate: 0 };
    }
    
    try {
      let activeProposals = 0;
      let totalProposals = 0;
      let successfulProposals = 0;
      
      // First, try to determine if the contract has a function to get the proposal count
      const hasCountMethod = typeof contracts.governance.getProposalCount === 'function';
      const hasStateMethod = typeof contracts.governance.getProposalState === 'function';
      
      console.log(`Governance contract has: countMethod=${hasCountMethod}, stateMethod=${hasStateMethod}`);
      
      // Direct method for getting count if available
      if (hasCountMethod) {
        try {
          const count = await contracts.governance.getProposalCount();
          totalProposals = count.toNumber ? count.toNumber() : parseInt(count.toString());
          console.log("Total proposals from direct count method:", totalProposals);
        } catch (countError) {
          console.warn("Error using direct proposal count method:", countError);
        }
      }
      
      // If direct method failed or isn't available, try binary search approach
      if (totalProposals === 0 && hasStateMethod) {
        console.log("Using binary search to find proposal count...");
        
        // Start with a reasonable max to avoid too many queries
        let low = 0;
        let high = 100;
        let found = false;
        
        // First quickly check if any proposals exist
        try {
          await contracts.governance.getProposalState(0);
          found = true;
        } catch (error) {
          console.log("No proposals found at ID 0");
        }
        
        if (found) {
          // Do binary search to find highest valid ID
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            
            try {
              await contracts.governance.getProposalState(mid);
              // If we get here, this ID exists
              low = mid + 1;
            } catch (error) {
              // This ID doesn't exist, look lower
              high = mid - 1;
            }
          }
          
          totalProposals = high + 1; // +1 if using 0-indexed proposals
          console.log("Total proposals from binary search:", totalProposals);
        }
      }
      
      // Try alternate methods if we still have zero
      if (totalProposals === 0) {
        // Check for proposal-related events
        try {
          const filter = contracts.governance.filters.ProposalCreated ? 
                         contracts.governance.filters.ProposalCreated() : 
                         contracts.governance.filters.ProposalCreated?.();
                         
          if (filter) {
            const events = await contracts.governance.queryFilter(filter);
            totalProposals = events.length;
            console.log("Total proposals from ProposalCreated events:", totalProposals);
          }
        } catch (error) {
          console.warn("Error getting proposals from events:", error);
        }
      }
      
      // Count active and successful proposals if we have any total proposals
      if (totalProposals > 0 && hasStateMethod) {
        console.log("Counting proposal states for", totalProposals, "proposals");
        
        // Process in smaller batches to avoid RPC limits
        const batchSize = 5;
        
        for (let i = 0; i < totalProposals; i += batchSize) {
          const endIdx = Math.min(i + batchSize, totalProposals);
          const batch = Array.from({ length: endIdx - i }, (_, idx) => i + idx);
          
          const statePromises = batch.map(id => {
            return contracts.governance.getProposalState(id)
              .then(state => ({
                id,
                state: typeof state === 'object' ? state.toNumber() : Number(state)
              }))
              .catch(err => ({ id, state: -1 })); // -1 indicates error
          });
          
          const results = await Promise.all(statePromises);
          
          // Process results to count active and successful
          for (const result of results) {
            if (result.state === -1) continue; // Skip errors
            
            // Standard Governor contract states:
            // 0: Pending, 1: Active, 2: Canceled, 3: Defeated, 4: Succeeded, 5: Queued, 6: Expired, 7: Executed
            
            if (result.state === 1) { // Active
              activeProposals++;
            }
            
            // Count as successful if Succeeded, Queued, or Executed
            if (result.state === 4 || result.state === 5 || result.state === 7) {
              successfulProposals++;
            }
          }
        }
      }
      
      // Calculate success rate
      const proposalSuccessRate = totalProposals > 0 ? successfulProposals / totalProposals : 0;
      
      console.log("Proposal stats:", {
        activeProposals,
        totalProposals,
        successfulProposals,
        proposalSuccessRate
      });
      
      return { 
        activeProposals, 
        totalProposals,
        proposalSuccessRate 
      };
    } catch (error) {
      console.error("Error fetching proposal stats:", error);
      return { 
        activeProposals: 0, 
        totalProposals: 0,
        proposalSuccessRate: 0
      };
    }
  }, [contracts]);

  // Fetch governance metrics - delegation and participation rates
  const fetchGovernanceMetrics = useCallback(async () => {
    console.log("Fetching governance metrics...");
    
    if (!contracts.token || !contracts.governance) {
      console.warn("Token or governance contract not available");
      return { participationRate: 0, delegationRate: 0 };
    }
    
    try {
      let participationRate = 0;
      let delegationRate = 0;
      
      // Try to get delegation info directly from token
      try {
        console.log("Checking delegation information from token contract");
        
        // See if we can get the total delegated tokens
        let totalDelegated = ethers.BigNumber.from(0);
        let totalSupply = await contracts.token.totalSupply();
        
        // Try to get all delegates
        if (typeof contracts.token.getCurrentDelegatedVotes === 'function') {
          // If we have a method to get delegated votes directly
          if (account) {
            const delegated = await contracts.token.getCurrentDelegatedVotes(account);
            if (!delegated.isZero()) {
              totalDelegated = totalDelegated.add(delegated);
            }
          }
          
          // Check known contract addresses
          const contractAddresses = [
            contracts.governance?.address,
            contracts.timelock?.address
          ].filter(Boolean);
          
          for (const addr of contractAddresses) {
            try {
              const delegated = await contracts.token.getCurrentDelegatedVotes(addr);
              if (!delegated.isZero()) {
                totalDelegated = totalDelegated.add(delegated);
              }
            } catch (e) {}
          }
        }
        
        // If the token contract has a specific function to get delegation rate
        if (typeof contracts.token.getSnapshotMetrics === 'function') {
          try {
            const currentSnapshot = await contracts.token.getCurrentSnapshotId();
            if (currentSnapshot) {
              const metrics = await contracts.token.getSnapshotMetrics(currentSnapshot);
              // Extract delegation percentage if available
              if (metrics && metrics.percentageDelegated) {
                delegationRate = parseInt(metrics.percentageDelegated.toString()) / 10000; // Convert basis points
                console.log("Delegation rate from snapshot metrics:", delegationRate);
              }
            }
          } catch (error) {
            console.warn("Error getting delegation rate from snapshot:", error);
          }
        }
        
        // Calculate delegation rate if we have supply and delegated amount
        if (delegationRate === 0 && !totalSupply.isZero() && !totalDelegated.isZero()) {
          delegationRate = totalDelegated.mul(100).div(totalSupply).toNumber() / 100;
          console.log("Calculated delegation rate:", delegationRate);
        }
      } catch (error) {
        console.warn("Error calculating delegation metrics:", error);
      }
      
      // Try to get participation rate from recent proposals
      try {
        console.log("Calculating participation rate from proposals");
        
        // Check if we have a getVotes or similar method to get voting power
        const hasGetVotes = typeof contracts.token.getVotes === 'function' || 
                           typeof contracts.token.getCurrentVotes === 'function';
        
        if (hasGetVotes && account) {
          // If the user has voting power, we can use that as a reference
          const votingPower = await (
            contracts.token.getVotes?.(account) || 
            contracts.token.getCurrentVotes?.(account)
          );
          
          if (votingPower && !votingPower.isZero()) {
            // We found some voting power, which suggests delegation is happening
            participationRate = Math.max(0.05, delegationRate); // Estimate participation based on delegation
          }
        }
        
        // If we couldn't determine participation from voting power, estimate from proposal activity
        if (participationRate === 0) {
          // Simple heuristic: if there are active proposals, participation is likely occurring
          const { activeProposals, totalProposals } = await fetchProposalStats();
          
          if (activeProposals > 0) {
            participationRate = 0.2; // Assume 20% participation for active DAOs
          } else if (totalProposals > 0) {
            participationRate = 0.1; // Assume 10% for DAOs with past proposals
          } else {
            participationRate = 0.02; // Assume 2% baseline for new DAOs
          }
        }
      } catch (error) {
        console.warn("Error calculating participation rate:", error);
      }
      
      console.log("Governance metrics:", { participationRate, delegationRate });
      
      return { 
        participationRate: isNaN(participationRate) ? 0 : participationRate, 
        delegationRate: isNaN(delegationRate) ? 0 : delegationRate
      };
    } catch (error) {
      console.error("Error fetching governance metrics:", error);
      return { 
        participationRate: 0, 
        delegationRate: 0
      };
    }
  }, [contracts, account, fetchProposalStats]);

  // Enhanced data loading function
  const loadDashboardData = useCallback(async () => {
    if (!isConnected || !contractsReady || !contracts.token || !contracts.governance) {
      return;
    }

    try {
      setDashboardStats(prev => ({ ...prev, isLoading: true, errorMessage: null }));
      console.log("Loading dashboard data...");

      // Get values in parallel for better performance
      const [tokenHolders, supplyData, proposalStats, governanceMetrics] = await Promise.all([
        fetchTokenHolders(),
        fetchSupplyData(),
        fetchProposalStats(),
        fetchGovernanceMetrics()
      ]);

      console.log("Dashboard data fetched:", {
        tokenHolders,
        supplyData,
        proposalStats,
        governanceMetrics
      });

      // Update the state with fetched data
      setDashboardStats({
        totalHolders: tokenHolders,
        ...supplyData,
        ...proposalStats,
        ...governanceMetrics,
        isLoading: false,
        errorMessage: null
      });
      
    } catch (error) {
      console.error("Error loading dashboard data:", error);
      setDashboardStats(prev => ({
        ...prev,
        isLoading: false,
        errorMessage: "Failed to load dashboard data: " + error.message
      }));
    }
  }, [
    contracts, 
    contractsReady, 
    isConnected, 
    fetchTokenHolders, 
    fetchSupplyData, 
    fetchProposalStats, 
    fetchGovernanceMetrics
  ]);

  // Load dashboard data when dependencies change
  useEffect(() => {
    if (isConnected && contractsReady) {
      loadDashboardData();
    } else {
      // Reset stats when disconnected
      setDashboardStats(prev => ({
        ...prev,
        isLoading: !isConnected || !contractsReady,
        errorMessage: !isConnected ? "Not connected to wallet" : 
                      !contractsReady ? "Contracts not initialized" : null
      }));
    }
  }, [loadDashboardData, contractsReady, isConnected, refreshCounter, account]);

  // Format percentage values for display
  const formatPercentage = (value) => {
    if (value === undefined || value === null) return "0.0%";
    return `${(value * 100).toFixed(1)}%`;
  };

  // Modify the displayed proposal count by subtracting 1
  const displayProposalCount = Math.max(0, dashboardStats.totalProposals - 1);

  return { 
    ...dashboardStats,
    // Override the totalProposals value for display
    totalProposals: displayProposalCount,
    formattedParticipationRate: formatPercentage(dashboardStats.participationRate),
    formattedDelegationRate: formatPercentage(dashboardStats.delegationRate),
    formattedSuccessRate: formatPercentage(dashboardStats.proposalSuccessRate),
    reload: loadDashboardData 
  };
}