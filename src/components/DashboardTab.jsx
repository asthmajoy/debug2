import React, { useState, useEffect } from 'react';
import { Clock, ArrowRight } from 'lucide-react';
import { formatPercentage, formatCountdown } from '../utils/formatters';
import Loader from './Loader';
import blockchainDataCache from '../utils/blockchainDataCache';

const DashboardTab = ({ user, stats, loading, proposals, getProposalVoteTotals }) => {
  // Format numbers for display
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
            const data = await getProposalVoteTotals(proposal.id);
            
            // Cache the result
            blockchainDataCache.set(cacheKey, data);
            
            return {
              id: proposal.id,
              data
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
    const pollInterval = setInterval(fetchVoteData, 30000); // Every 30 seconds
    
    return () => {
      clearInterval(pollInterval);
    };
  }, [proposals, getProposalVoteTotals]);
  
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Dashboard</h2>
      
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
              </div>
              <div>
                <p className="text-gray-500">Circulating</p>
                <p className="text-2xl font-bold">{formatNumberDisplay(stats.circulatingSupply)}</p>
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
              <p className="text-2xl font-bold">{formatToFiveDecimals(user.balance)} JUST</p>
            </div>
            <div>
              <p className="text-gray-500">Voting Power</p>
              <p className="text-2xl font-bold">{formatToFiveDecimals(user.votingPower)} JUST</p>
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
        <div className="space-y-4">
          {proposals && proposals.length > 0 ? (
            proposals.map((proposal, idx) => {
              // Get vote data from our state
              const voteData = proposalVoteData[proposal.id] || {
                yesVotes: parseFloat(proposal.yesVotes) || 0,
                noVotes: parseFloat(proposal.noVotes) || 0,
                abstainVotes: parseFloat(proposal.abstainVotes) || 0,
                totalVoters: 0,
                yesPercentage: 0,
                noPercentage: 0,
                abstainPercentage: 0
              };
              
              // If no percentages are available in vote data, calculate them
              if (!voteData.yesPercentage && !voteData.noPercentage && !voteData.abstainPercentage) {
                const totalVotes = parseFloat(voteData.yesVotes) + parseFloat(voteData.noVotes) + parseFloat(voteData.abstainVotes);
                
                if (totalVotes > 0) {
                  voteData.yesPercentage = (parseFloat(voteData.yesVotes) / totalVotes) * 100;
                  voteData.noPercentage = (parseFloat(voteData.noVotes) / totalVotes) * 100;
                  voteData.abstainPercentage = (parseFloat(voteData.abstainVotes) / totalVotes) * 100;
                }
              }
              
              // Ensure we have voting power values for the display
              voteData.yesVotingPower = parseFloat(voteData.yesVotingPower || voteData.yesVotes) || 0;
              voteData.noVotingPower = parseFloat(voteData.noVotingPower || voteData.noVotes) || 0;
              voteData.abstainVotingPower = parseFloat(voteData.abstainVotingPower || voteData.abstainVotes) || 0;
              
              return (
                <div key={idx} className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium">{proposal.title}</p>
                      <p className="text-xs text-gray-500">Proposal #{proposal.id}</p>
                    </div>
                    <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      {formatCountdown(proposal.deadline)}
                    </span>
                  </div>
                  
                  {/* Vote percentages */}
                  <div className="flex justify-between text-sm mb-2">
                    <span>Yes: {voteData.yesPercentage.toFixed(1)}%</span>
                    <span>No: {voteData.noPercentage.toFixed(1)}%</span>
                    <span>Abstain: {voteData.abstainPercentage.toFixed(1)}%</span>
                  </div>
                  
                  {/* Vote bar */}
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="flex h-full">
                      <div className="bg-green-500 h-full" style={{ width: `${voteData.yesPercentage}%` }}></div>
                      <div className="bg-red-500 h-full" style={{ width: `${voteData.noPercentage}%` }}></div>
                      <div className="bg-gray-400 h-full" style={{ width: `${voteData.abstainPercentage}%` }}></div>
                    </div>
                  </div>
                  
                  {/* Vote totals and voting power - Enhanced display */}
                  <div className="grid grid-cols-3 gap-2 text-xs text-gray-500 mt-2">
                    <div>{Math.round(voteData.yesVotingPower)} JUST</div>
                    <div className="text-center">{Math.round(voteData.noVotingPower)} JUST</div>
                    <div className="text-right">{Math.round(voteData.abstainVotingPower)} JUST</div>
                  </div>
                  
                  {/* Total voters count */}
                  <div className="text-xs text-gray-500 mt-1 text-right">
                    Total voters: {voteData.totalVoters || 0}
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
      </div>
    </div>
  );
};

export default DashboardTab;