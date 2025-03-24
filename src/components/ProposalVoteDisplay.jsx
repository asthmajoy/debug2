// src/components/ProposalVoteDisplay.jsx
import React, { useState, useEffect } from 'react';
import { useBlockchainData } from '../contexts/BlockchainDataContext';
import { ethers } from 'ethers';
import Loader from './Loader';

const ProposalVoteDisplay = ({ proposalId, isExpanded = false, refreshTrigger = 0 }) => {
  const { getDetailedProposalVotes } = useBlockchainData();
  const [voteData, setVoteData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Format numbers with commas and 2 decimal places
  const formatNumber = (value, decimals = 2) => {
    if (!value) return "0";
    
    const num = typeof value === 'string' ? parseFloat(value) : value;
    
    if (isNaN(num)) return "0";
    
    // For whole numbers, don't show decimals
    if (Math.abs(num - Math.round(num)) < 0.00001) {
      return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    
    // For decimal numbers
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals
    });
  };
  
  // Fetch vote data
  useEffect(() => {
    const fetchVoteData = async () => {
      if (!proposalId) return;
      
      try {
        setLoading(true);
        const data = await getDetailedProposalVotes(proposalId);
        setVoteData(data);
        setError(null);
      } catch (err) {
        console.error("Error fetching vote data:", err);
        setError("Failed to load vote data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchVoteData();
  }, [proposalId, getDetailedProposalVotes, refreshTrigger]);
  
  if (loading) {
    return <Loader size="small" text="Loading vote data..." />;
  }
  
  if (error) {
    return <div className="text-red-500 text-sm">{error}</div>;
  }
  
  if (!voteData) {
    return <div className="text-gray-500 text-sm">No vote data available</div>;
  }
  
  // Simple view for when not expanded
  if (!isExpanded) {
    return (
      <div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-green-600">Yes: {voteData.yesPercentage.toFixed(1)}%</span>
          <span className="text-red-600">No: {voteData.noPercentage.toFixed(1)}%</span>
          <span className="text-gray-600">Abstain: {voteData.abstainPercentage.toFixed(1)}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="flex h-full">
            <div className="bg-green-500 h-full" style={{ width: `${voteData.yesPercentage}%` }}></div>
            <div className="bg-red-500 h-full" style={{ width: `${voteData.noPercentage}%` }}></div>
            <div className="bg-gray-400 h-full" style={{ width: `${voteData.abstainPercentage}%` }}></div>
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-1 text-right">
          Total voters: {voteData.totalVoters || 0}
        </div>
      </div>
    );
  }
  
  // Expanded detailed view
  return (
    <div className="bg-gray-50 p-4 rounded-lg mt-4">
      <h4 className="font-medium text-gray-700 mb-3">Vote Details</h4>
      
      {/* Vote bar visualization */}
      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-green-600 font-medium">Yes: {voteData.yesPercentage.toFixed(1)}%</span>
          <span className="text-red-600 font-medium">No: {voteData.noPercentage.toFixed(1)}%</span>
          <span className="text-gray-600 font-medium">Abstain: {voteData.abstainPercentage.toFixed(1)}%</span>
        </div>
        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
          <div className="flex h-full">
            <div className="bg-green-500 h-full" style={{ width: `${voteData.yesPercentage}%` }}></div>
            <div className="bg-red-500 h-full" style={{ width: `${voteData.noPercentage}%` }}></div>
            <div className="bg-gray-400 h-full" style={{ width: `${voteData.abstainPercentage}%` }}></div>
          </div>
        </div>
      </div>
      
      {/* Vote counts */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center p-2 bg-green-50 rounded">
          <h5 className="text-sm font-medium text-green-700">Yes Votes</h5>
          <p className="text-lg font-bold text-green-600">{formatNumber(voteData.yesVotes)}</p>
          <p className="text-xs text-green-700">{voteData.totalVoters > 0 ? Math.round(voteData.yesPercentage) : 0}% of total</p>
        </div>
        
        <div className="text-center p-2 bg-red-50 rounded">
          <h5 className="text-sm font-medium text-red-700">No Votes</h5>
          <p className="text-lg font-bold text-red-600">{formatNumber(voteData.noVotes)}</p>
          <p className="text-xs text-red-700">{voteData.totalVoters > 0 ? Math.round(voteData.noPercentage) : 0}% of total</p>
        </div>
        
        <div className="text-center p-2 bg-gray-100 rounded">
          <h5 className="text-sm font-medium text-gray-700">Abstain</h5>
          <p className="text-lg font-bold text-gray-600">{formatNumber(voteData.abstainVotes)}</p>
          <p className="text-xs text-gray-700">{voteData.totalVoters > 0 ? Math.round(voteData.abstainPercentage) : 0}% of total</p>
        </div>
      </div>
      
      {/* Totals and quorum */}
      <div className="flex flex-col space-y-2 text-sm">
        <div className="flex justify-between border-t pt-2">
          <span className="font-medium">Total Voting Power:</span>
          <span>{formatNumber(voteData.totalVotes)} JUST</span>
        </div>
        
        <div className="flex justify-between">
          <span className="font-medium">Total Voters:</span>
          <span>{voteData.totalVoters}</span>
        </div>
        
        {voteData.requiredQuorum && (
          <div className="flex justify-between">
            <span className="font-medium">Quorum Required:</span>
            <span>{formatNumber(voteData.requiredQuorum)} JUST</span>
          </div>
        )}
        
        <div className="flex justify-between border-t pt-2 mt-1">
          <span className="font-medium">Quorum Status:</span>
          <span className={voteData.quorumReached ? "text-green-600" : "text-yellow-600"}>
            {voteData.quorumReached ? "✓ Reached" : "⚠ Not reached"}
          </span>
        </div>
        
        <div className="flex justify-between">
          <span className="font-medium">Current Outcome:</span>
          <span className={
            parseFloat(voteData.yesVotes) > parseFloat(voteData.noVotes) 
              ? "text-green-600" 
              : parseFloat(voteData.yesVotes) < parseFloat(voteData.noVotes)
                ? "text-red-600"
                : "text-gray-600"
          }>
            {parseFloat(voteData.yesVotes) > parseFloat(voteData.noVotes)
              ? "✓ Passing"
              : parseFloat(voteData.yesVotes) < parseFloat(voteData.noVotes)
                ? "✘ Failing"
                : "Tied"}
          </span>
        </div>
      </div>
      
      {/* Data source indicator for debugging */}
      {voteData.dataSource && (
        <div className="mt-3 text-xs text-gray-400 text-right">
          Data source: {voteData.dataSource}
        </div>
      )}
    </div>
  );
};

export default ProposalVoteDisplay;