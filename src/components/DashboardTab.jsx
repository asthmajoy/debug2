import React, { useState, useEffect } from 'react';
import { Clock, ArrowRight, RefreshCw } from 'lucide-react';
import { formatPercentage, formatCountdown } from '../utils/formatters';
import Loader from './Loader';
import blockchainDataCache from '../utils/blockchainDataCache';

const DashboardTab = ({ user, stats, loading, proposals, getProposalVoteTotals, onRefresh }) => {
  // Format numbers for display with better null/undefined handling
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
  
  // Format token values to 5 decimal places
  const formatToFiveDecimals = (value) => {
    if (value === undefined || value === null) return "0.00000";
    
    // Handle string inputs
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    // If it's NaN or not a number, return "0.00000"
    if (isNaN(numValue)) return "0.00000";
    
    // Return with exactly 5 decimal places
    return numValue.toFixed(5);
  };

  // Store proposal vote data
  const [proposalVoteData, setProposalVoteData] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Fetch vote data for active proposals
  useEffect(() => {
    const fetchVoteData = async () => {
      if (!getProposalVoteTotals || !proposals || proposals.length === 0) return;
      
      console.log("Dashboard fetching vote data for all active proposals");
      const voteData = {};
      
      // Process proposals in parallel for better performance
      const results = await Promise.allSettled(
        proposals.map(async (proposal) => {
          try {
            // Check if cached data is available first
            const cacheKey = `dashboard-votes-${proposal.id}`;
            const cachedData = blockchainDataCache.get(cacheKey);
            if (cachedData !== null) {
              return {
                id: proposal.id,
                data: cachedData
              };
            }
            
            console.log(`Fetching vote data for proposal #${proposal.id}`);
            // Use the getProposalVoteTotals function from the context
            const data = await getProposalVoteTotals(proposal.id);
            
            // Process the data to ensure consistent format
            const processedData = {
              // Note: In the contract, yesVotes/noVotes/abstainVotes are actually voting power values
              yesVotes: parseFloat(data.yesVotes) || 0,
              noVotes: parseFloat(data.noVotes) || 0,
              abstainVotes: parseFloat(data.abstainVotes) || 0,
              yesVotingPower: parseFloat(data.yesVotes || data.yesVotingPower) || 0,
              noVotingPower: parseFloat(data.noVotes || data.noVotingPower) || 0,
              abstainVotingPower: parseFloat(data.abstainVotes || data.abstainVotingPower) || 0,
              totalVoters: data.totalVoters || 0,
              
              // Store percentages based on voting power
              yesPercentage: data.yesPercentage || 0,
              noPercentage: data.noPercentage || 0,
              abstainPercentage: data.abstainPercentage || 0,
              
              // Add a timestamp to know when the data was fetched
              fetchedAt: Date.now()
            };
            
            // Calculate total voting power
            processedData.totalVotingPower = processedData.yesVotingPower + 
                                            processedData.noVotingPower + 
                                            processedData.abstainVotingPower;
            
            // If percentages aren't provided, calculate them based on voting power
            if (!data.yesPercentage && !data.noPercentage && !data.abstainPercentage) {
              if (processedData.totalVotingPower > 0) {
                processedData.yesPercentage = (processedData.yesVotingPower / processedData.totalVotingPower) * 100;
                processedData.noPercentage = (processedData.noVotingPower / processedData.totalVotingPower) * 100;
                processedData.abstainPercentage = (processedData.abstainVotingPower / processedData.totalVotingPower) * 100;
              }
            }
            
            console.log(`Processed vote data for proposal #${proposal.id}:`, processedData);
            
            // Cache the result with a reasonable TTL
            blockchainDataCache.set(cacheKey, processedData);
            
            return {
              id: proposal.id,
              data: processedData
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
    };
    
    fetchVoteData();
    
    // Set up a polling interval to refresh vote data
    const pollInterval = setInterval(fetchVoteData, 15000); // Every 15 seconds
    
    return () => {
      clearInterval(pollInterval);
    };
  }, [proposals, getProposalVoteTotals]);

  // Handle manual refresh
  const handleRefresh = async () => {
    if (isRefreshing || !onRefresh) return;
    
    setIsRefreshing(true);
    try {
      await onRefresh();
    } catch (error) {
      console.error("Error refreshing dashboard data:", error);
    } finally {
      setIsRefreshing(false);
    }
  };
  
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Dashboard</h2>
        
        {/* Add refresh button */}
        <button 
          onClick={handleRefresh}
          disabled={isRefreshing || loading}
          className="flex items-center text-sm text-gray-600 hover:text-indigo-600 disabled:text-gray-400"
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>
      
      {/* Governance Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-900 mb-2">DAO Overview</h3>
          {loading ? (
            <Loader size="small" text="Loading stats..." />
          ) : (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Token Holders</p>
                <p className="text-2xl font-bold">{formatNumberDisplay(stats.totalHolders)}</p>
                {stats.totalHolders === 0 && <p className="text-xs text-orange-500">No holders detected</p>}
              </div>
              <div>
                <p className="text-gray-500">Circulating</p>
                <p className="text-2xl font-bold">{formatNumberDisplay(stats.circulatingSupply)}</p>
                {stats.circulatingSupply === "0" && <p className="text-xs text-orange-500">No tokens in circulation</p>}
              </div>
              <div>
                <p className="text-gray-500">Active Proposals</p>
                <p className="text-2xl font-bold">{stats.activeProposals}</p>
              </div>
              <div>
                <p className="text-gray-500">Total Proposals</p>
                <p className="text-2xl font-bold">{stats.totalProposals}</p>
              </div>
            </div>
          )}
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Your Account</h3>
          <div className="space-y-3">
            <div>
              <p className="text-gray-500">Balance</p>
              <p className="text-2xl font-bold">{formatToFiveDecimals(user.balance)} JST</p>
            </div>
            <div>
              <p className="text-gray-500">Voting Power</p>
              <p className="text-2xl font-bold">{formatToFiveDecimals(user.votingPower)} JST</p>
            </div>
            <div className="mt-4">
              <button 
                className="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center"
                onClick={() => document.querySelector('[data-tab="delegation"]')?.click()}
              >
                View Delegation Details
                <ArrowRight className="h-4 w-4 ml-1" />
              </button>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Governance Health</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <p className="text-gray-500 text-sm">Participation Rate</p>
                <p className="text-sm font-medium">{stats.formattedParticipationRate || formatPercentage(stats.participationRate)}</p>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.min(stats.participationRate * 100, 100)}%` }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <p className="text-gray-500 text-sm">Delegation Rate</p>
                <p className="text-sm font-medium">{stats.formattedDelegationRate || formatPercentage(stats.delegationRate)}</p>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(stats.delegationRate * 100, 100)}%` }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <p className="text-gray-500 text-sm">Proposal Success Rate</p>
                <p className="text-sm font-medium">{stats.formattedSuccessRate || formatPercentage(stats.proposalSuccessRate)}</p>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${Math.min(stats.proposalSuccessRate * 100, 100)}%` }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Error Message (if any) */}
      {stats.errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
          <p className="font-medium">Error loading dashboard data:</p>
          <p className="text-sm">{stats.errorMessage}</p>
          <p className="text-sm mt-2">Try refreshing the page or check your network connection.</p>
        </div>
      )}
      
      {/* Active Proposals */}
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Active Proposals</h3>
          <button 
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
            onClick={() => document.querySelector('[data-tab="proposals"]')?.click()}
          >
            View All
          </button>
        </div>
        {loading ? (
          <Loader size="small" text="Loading proposals..." />
        ) : (
          <div className="space-y-4">
            {proposals && proposals.length > 0 ? (
              proposals.map((proposal, idx) => {
                // Get vote data from our state
                const voteData = proposalVoteData[proposal.id] || {
                  yesVotes: parseFloat(proposal.yesVotes) || 0,
                  noVotes: parseFloat(proposal.noVotes) || 0,
                  abstainVotes: parseFloat(proposal.abstainVotes) || 0,
                  yesVotingPower: parseFloat(proposal.yesVotes) || 0,
                  noVotingPower: parseFloat(proposal.noVotes) || 0,
                  abstainVotingPower: parseFloat(proposal.abstainVotes) || 0,
                  totalVoters: 0,
                  yesPercentage: 0,
                  noPercentage: 0,
                  abstainPercentage: 0
                };

                // Ensure we have all required properties with correct types
                const processedVoteData = {
                  // Original values from blockchain
                  yesVotingPower: parseFloat(voteData.yesVotingPower || voteData.yesVotes || 0),
                  noVotingPower: parseFloat(voteData.noVotingPower || voteData.noVotes || 0),
                  abstainVotingPower: parseFloat(voteData.abstainVotingPower || voteData.abstainVotes || 0),
                  totalVoters: voteData.totalVoters || 0,
                  
                  // Use existing percentages if available, otherwise calculate
                  yesPercentage: voteData.yesPercentage || 0,
                  noPercentage: voteData.noPercentage || 0,
                  abstainPercentage: voteData.abstainPercentage || 0
                };

                // Calculate total voting power
                const totalVotingPower = processedVoteData.yesVotingPower + 
                                        processedVoteData.noVotingPower + 
                                        processedVoteData.abstainVotingPower;

                // If percentages aren't provided, calculate them based on voting power
                if (!voteData.yesPercentage && !voteData.noPercentage && !voteData.abstainPercentage) {
                  if (totalVotingPower > 0) {
                    processedVoteData.yesPercentage = (processedVoteData.yesVotingPower / totalVotingPower) * 100;
                    processedVoteData.noPercentage = (processedVoteData.noVotingPower / totalVotingPower) * 100;
                    processedVoteData.abstainPercentage = (processedVoteData.abstainVotingPower / totalVotingPower) * 100;
                  }
                }
                
                return (
                  <div key={idx} className="p-4 border border-gray-200 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium">{proposal.title || `Proposal #${proposal.id}`}</p>
                        <p className="text-xs text-gray-500">Proposal #{proposal.id}</p>
                      </div>
                      <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full flex items-center">
                        <Clock className="w-3 h-3 mr-1" />
                        {formatCountdown(proposal.deadline)}
                      </span>
                    </div>
                    
                    {/* Vote percentages */}
                    <div className="flex justify-between text-sm mb-2">
                      <span>Yes: {processedVoteData.yesPercentage.toFixed(1)}%</span>
                      <span>No: {processedVoteData.noPercentage.toFixed(1)}%</span>
                      <span>Abstain: {processedVoteData.abstainPercentage.toFixed(1)}%</span>
                    </div>
                    
                    {/* Vote bar */}
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="flex h-full">
                        <div 
                          className="bg-green-500 h-full" 
                          style={{ width: `${processedVoteData.yesPercentage}%` }}
                        ></div>
                        <div 
                          className="bg-red-500 h-full" 
                          style={{ width: `${processedVoteData.noPercentage}%` }}
                        ></div>
                        <div 
                          className="bg-gray-400 h-full" 
                          style={{ width: `${processedVoteData.abstainPercentage}%` }}
                        ></div>
                      </div>
                    </div>
                    
                    {/* Voting power display */}
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-500 mt-2">
                      <div>{formatToFiveDecimals(processedVoteData.yesVotingPower)} JST</div>
                      <div className="text-center">{formatToFiveDecimals(processedVoteData.noVotingPower)} JST</div>
                      <div className="text-right">{formatToFiveDecimals(processedVoteData.abstainVotingPower)} JST</div>
                    </div>
                    
                    {/* Total voters count */}
                    <div className="text-xs text-gray-500 mt-1 text-right">
                      Total voters: {processedVoteData.totalVoters || 0}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-6 text-gray-500">
                No active proposals at the moment
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardTab;