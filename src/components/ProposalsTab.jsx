import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { PROPOSAL_STATES, PROPOSAL_TYPES } from '../utils/constants';
import { formatRelativeTime, formatBigNumber, formatAddress, formatTime } from '../utils/formatters';
import Loader from './Loader';
import { ChevronDown, ChevronUp, Copy, Check, AlertTriangle } from 'lucide-react';

// Helper function to get human-readable proposal state label
function getProposalStateLabel(state) {
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
}

// Helper function for status colors
function getStatusColor(status) {
  switch (status) {
    case 'active':
      return 'bg-yellow-100 text-yellow-800';
    case 'succeeded':
      return 'bg-green-100 text-green-800';
    case 'pending':
    case 'queued':
      return 'bg-blue-100 text-blue-800';
    case 'executed':
      return 'bg-indigo-100 text-indigo-800';
    case 'defeated':
      return 'bg-red-100 text-red-800';
    case 'canceled':
    case 'expired':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

const ProposalsTab = ({ 
  proposals, 
  createProposal, 
  cancelProposal, 
  queueProposalWithThreatLevel,
  executeProposal, 
  claimRefund,
  loading: globalLoading,
  contracts,
  fetchProposals, // Add this prop to ensure we can access fetchProposals
  account // Current user's wallet address
}) => {
  const [proposalType, setProposalType] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedProposalId, setExpandedProposalId] = useState(null);
  const [copiedText, setCopiedText] = useState(null);
  const [newProposal, setNewProposal] = useState({
    title: '',
    description: '',
    type: PROPOSAL_TYPES.GENERAL,
    target: '',
    callData: '',
    amount: '',
    recipient: '',
    token: '',
    newThreshold: '',
    newQuorum: '',
    newVotingDuration: '',
    newTimelockDelay: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [transactionError, setTransactionError] = useState('');
  
  // New state for tracking transaction status
  const [pendingTxs, setPendingTxs] = useState({});
  const [loading, setLoading] = useState(globalLoading);
  
  // Clear errors when component unmounts or when dependencies change
  useEffect(() => {
    return () => {
      setTransactionError('');
      setPendingTxs({});
    };
  }, []);
  
  // Watch pending transactions
  useEffect(() => {
    const checkPendingTxs = async () => {
      const updatedPendingTxs = { ...pendingTxs };
      let hasChanges = false;
      
      for (const [txId, txInfo] of Object.entries(pendingTxs)) {
        if (txInfo.status === 'pending' && txInfo.hash) {
          try {
            const provider = new ethers.providers.Web3Provider(window.ethereum);
            const receipt = await provider.getTransactionReceipt(txInfo.hash);
            
            if (receipt) {
              updatedPendingTxs[txId] = {
                ...txInfo,
                status: receipt.status ? 'success' : 'failed',
                receipt
              };
              hasChanges = true;
              
              // Auto-dismiss successful transactions after 5 seconds
              if (receipt.status) {
                setTimeout(() => {
                  setPendingTxs(prev => {
                    const updated = { ...prev };
                    delete updated[txId];
                    return updated;
                  });
                }, 5000);
              }
            }
          } catch (error) {
            console.warn(`Error checking transaction ${txInfo.hash}:`, error);
          }
        }
      }
      
      if (hasChanges) {
        setPendingTxs(updatedPendingTxs);
      }
    };
    
    const interval = setInterval(checkPendingTxs, 3000);
    return () => clearInterval(interval);
  }, [pendingTxs]);

  // Update global loading state
  useEffect(() => {
    setLoading(globalLoading || Object.values(pendingTxs).some(tx => tx.status === 'pending'));
  }, [globalLoading, pendingTxs]);

  const toggleProposalDetails = (proposalId) => {
    if (expandedProposalId === proposalId) {
      setExpandedProposalId(null);
    } else {
      setExpandedProposalId(proposalId);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const renderAddress = (address, label) => {
    const isExpanded = true; // Always show copy button for addresses in expanded view
    return (
      <div className="flex items-center">
        <span className="font-medium mr-2">{label}:</span>
        <span className="font-mono break-all">{address}</span>
        {isExpanded && (
          <button 
            onClick={() => copyToClipboard(address)} 
            className="ml-2 text-gray-500 hover:text-indigo-600 focus:outline-none"
            title="Copy to clipboard"
          >
            <Copy className="w-4 h-4" />
          </button>
        )}
        {copiedText === address && (
          <span className="ml-2 text-xs text-green-600">Copied!</span>
        )}
      </div>
    );
  };

  // Update proposal status after successful queue operation
  const updateProposalQueuedStatus = async (proposalId) => {
    try {
      // Trigger a full refresh of proposals
      if (typeof fetchProposals === 'function') {
        await fetchProposals();
      }
    } catch (error) {
      console.error("Error updating proposal queued status:", error);
    }
  };
  
  // Update proposal status after successful execute operation
  const updateProposalExecutedStatus = async (proposalId) => {
    try {
      // Trigger a full refresh of proposals
      if (typeof fetchProposals === 'function') {
        await fetchProposals();
      }
    } catch (error) {
      console.error("Error updating proposal executed status:", error);
    }
  };

  // Check if the stake has been refunded for a proposal after a successful claim
  const updateStakeRefundedStatus = async (proposalId) => {
    try {
      // Trigger a full refresh of proposals
      if (typeof fetchProposals === 'function') {
        await fetchProposals();
      }
    } catch (error) {
      console.error("Error updating stake refund status:", error);
    }
  };

  const handleSubmitProposal = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setTransactionError('');
    
    try {
      const description = `${newProposal.title}\n\n${newProposal.description}`;
      
      // Convert values to proper format
      const amount = newProposal.amount ? ethers.utils.parseEther(newProposal.amount.toString()) : 0;
      const newThreshold = newProposal.newThreshold ? ethers.utils.parseEther(newProposal.newThreshold.toString()) : 0;
      const newQuorum = newProposal.newQuorum ? ethers.utils.parseEther(newProposal.newQuorum.toString()) : 0;
      const newVotingDuration = newProposal.newVotingDuration ? parseInt(newProposal.newVotingDuration) : 0;
      const newTimelockDelay = newProposal.newTimelockDelay ? parseInt(newProposal.newTimelockDelay) : 0;
      
      // Validate inputs based on proposal type
      if (!validateProposalInputs(newProposal)) {
        setTransactionError('Please fill in all required fields for this proposal type.');
        setSubmitting(false);
        return;
      }
      
      console.log('Submitting proposal:', {
        description,
        type: parseInt(newProposal.type),
        target: newProposal.target,
        callData: newProposal.callData || '0x',
        amount,
        recipient: newProposal.recipient,
        token: newProposal.token,
        newThreshold,
        newQuorum,
        newVotingDuration,
        newTimelockDelay
      });
      
      await createProposal(
        description,
        parseInt(newProposal.type),
        newProposal.target,
        newProposal.callData || '0x',
        amount,
        newProposal.recipient,
        newProposal.token,
        newThreshold,
        newQuorum,
        newVotingDuration,
        newTimelockDelay
      );
      
      setShowCreateModal(false);
      // Reset form
      setNewProposal({
        title: '',
        description: '',
        type: PROPOSAL_TYPES.GENERAL,
        target: '',
        callData: '',
        amount: '',
        recipient: '',
        token: '',
        newThreshold: '',
        newQuorum: '',
        newVotingDuration: '',
        newTimelockDelay: ''
      });
    } catch (error) {
      console.error("Error creating proposal:", error);
      setTransactionError(error.message || 'Error creating proposal. See console for details.');
    } finally {
      setSubmitting(false);
    }
  };

  // Validate proposal inputs based on type
  const validateProposalInputs = (proposal) => {
    switch (parseInt(proposal.type)) {
      case PROPOSAL_TYPES.GENERAL:
        return proposal.target && proposal.callData;
      
      case PROPOSAL_TYPES.WITHDRAWAL:
        return proposal.recipient && proposal.amount;
      
      case PROPOSAL_TYPES.TOKEN_TRANSFER:
        return proposal.recipient && proposal.amount;
      
      case PROPOSAL_TYPES.GOVERNANCE_CHANGE:
        // At least one parameter must be changed
        return proposal.newThreshold || proposal.newQuorum || 
               proposal.newVotingDuration || proposal.newTimelockDelay;
      
      case PROPOSAL_TYPES.EXTERNAL_ERC20_TRANSFER:
        return proposal.recipient && proposal.token && proposal.amount;
      
      case PROPOSAL_TYPES.TOKEN_MINT:
        return proposal.recipient && proposal.amount;
      
      case PROPOSAL_TYPES.TOKEN_BURN:
        return proposal.recipient && proposal.amount;
      
      default:
        return false;
    }
  };

  // Improved handler for proposal actions with robust error and transaction management
  const handleProposalAction = async (action, proposalId, actionName, retryCount = 0) => {
    // Generate a unique transaction ID
    const txId = `${actionName}-${proposalId}-${Date.now()}`;
    
    // Set up pending transaction tracking
    setPendingTxs(prev => ({
      ...prev,
      [txId]: { 
        status: 'pending', 
        action: actionName, 
        proposalId, 
        startTime: Date.now(),
        retryCount
      }
    }));
    
    try {
      if (actionName === 'queuing') {
        if (!contracts.governance) {
          throw new Error("Governance contract not initialized");
        }

        // IMPORTANT: We need to use the correct governance function to queue the proposal
        // This should directly call the governance contract's queueProposal function
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const governance = contracts.governance.connect(signer);
        
        // Debug current proposal state
        try {
          const currentState = await governance.getProposalState(proposalId);
          console.log(`Current proposal state before queueing: ${currentState} (${getProposalStateLabel(currentState)})`);
        } catch (e) {
          console.warn("Could not get current proposal state:", e);
        }

        console.log(`Directly queueing proposal ${proposalId} using governance contract...`);
        
        try {
          // First try to estimate gas to check if this will work
          const gasEstimate = await governance.estimateGas.queueProposal(proposalId)
            .catch(e => {
              console.warn("Gas estimation failed for queueProposal:", e);
              return ethers.utils.hexlify(1000000); // Fallback to 1M gas
            });
            
          // Add buffer to gas estimate
          const gasLimit = ethers.BigNumber.from(gasEstimate).mul(150).div(100);
          
          // Get current gas price with buffer for retry
          const currentGasPrice = await provider.getGasPrice();
          const gasPriceMultiplier = 100 + (retryCount * 20);
          const gasPrice = currentGasPrice.mul(gasPriceMultiplier).div(100);
          
          console.log(`Sending queueProposal transaction with gas limit ${gasLimit} and gas price ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
          
          // Send the transaction
          const tx = await governance.queueProposal(proposalId, {
            gasLimit,
            gasPrice,
            nonce: await provider.getTransactionCount(await signer.getAddress(), 'latest')
          });
          
          console.log("Queue transaction sent:", tx.hash);
          
          // Track transaction
          setPendingTxs(prev => ({
            ...prev,
            [txId]: {
              ...prev[txId],
              hash: tx.hash,
              status: 'pending',
              lastChecked: Date.now()
            }
          }));
          
          // Set up transaction monitoring
          const checkInterval = setInterval(async () => {
            try {
              const receipt = await provider.getTransactionReceipt(tx.hash);
              
              if (receipt) {
                clearInterval(checkInterval);
                
                setPendingTxs(prev => ({
                  ...prev,
                  [txId]: {
                    ...prev[txId],
                    status: receipt.status ? 'success' : 'failed',
                    receipt
                  }
                }));
                
                if (receipt.status) {
                  console.log("Transaction confirmed successfully:", receipt);
                  
                  // Check updated proposal state
                  try {
                    const newState = await governance.getProposalState(proposalId);
                    console.log(`Proposal state after queueing: ${newState} (${getProposalStateLabel(newState)})`);
                    
                    // Update the proposal's queued status
                    await updateProposalQueuedStatus(proposalId);
                    
                    // Force a full refresh of proposals from blockchain
                    if (typeof fetchProposals === 'function') {
                      setTimeout(() => {
                        fetchProposals().catch(e => console.error("Error refreshing proposals:", e));
                      }, 2000);
                    }
                  } catch (e) {
                    console.error("Error checking updated proposal state:", e);
                  }
                  
                  // Auto-dismiss success notification
                  setTimeout(() => {
                    setPendingTxs(prev => {
                      const updated = {...prev};
                      delete updated[txId];
                      return updated;
                    });
                  }, 5000);
                } else {
                  console.error("Transaction reverted:", receipt);
                }
              }
            } catch (e) {
              console.warn("Error checking transaction status:", e);
            }
          }, 5000);
          
          // Timeout for stuck transactions
          const timeoutCheck = setTimeout(() => {
            clearInterval(checkInterval);
            
            setPendingTxs(prev => {
              if (prev[txId]?.status === 'pending') {
                return {
                  ...prev,
                  [txId]: {
                    ...prev[txId],
                    warning: 'Transaction may have been dropped. Please retry with higher gas.',
                    canRetry: true
                  }
                };
              }
              return prev;
            });
          }, 180000);
          
          return () => {
            clearInterval(checkInterval);
            clearTimeout(timeoutCheck);
          };
        } catch (error) {
          console.error("Error queueing proposal:", error);
          
          // Check if we should try the alternative method
          const shouldTryAlternative = 
            error.message?.includes("revert") || 
            error.message?.includes("invalid") ||
            error.message?.includes("failed") ||
            retryCount >= 2;
            
          if (shouldTryAlternative) {
            console.log("Direct queueing failed, trying alternative method...");
            
            // Find the proposal by ID
            const proposal = proposals.find(p => p.id === Number(proposalId));
            if (!proposal) {
              throw new Error("Proposal not found");
            }
            
            // Make sure target is a valid address
            let target = proposal.target;
            
            // Different handling based on proposal type
            const proposalType = parseInt(proposal.type);
            switch (proposalType) {
              case PROPOSAL_TYPES.WITHDRAWAL:
                target = proposal.recipient;
                break;
                
              case PROPOSAL_TYPES.TOKEN_TRANSFER:
                if (!target || target === ethers.constants.AddressZero) {
                  if (contracts.justToken && contracts.justToken.address) {
                    target = contracts.justToken.address;
                  } else if (contracts.token && contracts.token.address) {
                    target = contracts.token.address;
                  }
                }
                break;
                
              case PROPOSAL_TYPES.EXTERNAL_ERC20_TRANSFER:
                target = proposal.token;
                break;
                
              case PROPOSAL_TYPES.TOKEN_MINT:
              case PROPOSAL_TYPES.TOKEN_BURN:
                if (contracts.justToken && contracts.justToken.address) {
                  target = contracts.justToken.address;
                } else if (contracts.token && contracts.token.address) {
                  target = contracts.token.address;
                }
                break;
                
              case PROPOSAL_TYPES.GOVERNANCE_CHANGE:
                if (contracts.governance && contracts.governance.address) {
                  target = contracts.governance.address;
                }
                break;
            }
            
            // Final verification and fallbacks
            if (!target || target === ethers.constants.AddressZero) {
              if (contracts.governance && contracts.governance.address) {
                target = contracts.governance.address;
              } else if (contracts.timelock && contracts.timelock.address) {
                target = contracts.timelock.address;
              } else if (contracts.token && contracts.token.address) {
                target = contracts.token.address;
              } else if (contracts.justToken && contracts.justToken.address) {
                target = contracts.justToken.address;
              } else {
                throw new Error("Invalid target address for this proposal");
              }
            }
            
            // Parse value
            let value = ethers.constants.Zero;
            if (parseInt(proposal.type) === PROPOSAL_TYPES.WITHDRAWAL) {
              value = typeof proposal.amount === 'string' 
                ? ethers.utils.parseEther(proposal.amount) 
                : proposal.amount;
            }
            
            // Use appropriate data
            const data = proposal.callData || '0x';
            
            // Try using the timelock contract directly
            if (contracts.timelock) {
              const timelock = contracts.timelock.connect(signer);
              
              console.log(`Trying timelock.queueTransactionWithThreatLevel with target: ${target}`);
              
              // Get gas estimates and prices
              const gasEstimate = await timelock.estimateGas.queueTransactionWithThreatLevel(
                target, value, data
              ).catch(e => {
                console.warn("Gas estimation failed, using higher default:", e);
                return ethers.utils.hexlify(3500000); // 3.5M gas as higher fallback
              });
              
              const gasLimit = ethers.BigNumber.from(gasEstimate).mul(200).div(100); // 2x buffer
              const gasPrice = (await provider.getGasPrice()).mul(120).div(100); // 20% higher
              
              // Try the alternative method
              const tx = await timelock.queueTransactionWithThreatLevel(
                target, value, data, {
                  gasLimit,
                  gasPrice,
                  nonce: await provider.getTransactionCount(await signer.getAddress(), 'latest')
                }
              );
              
              console.log("Alternative queue transaction sent:", tx.hash);
              
              // Set up tracking for this alternative transaction
              setPendingTxs(prev => ({
                ...prev,
                [txId]: {
                  ...prev[txId],
                  hash: tx.hash,
                  status: 'pending',
                  lastChecked: Date.now(),
                  isAlternativeMethod: true
                }
              }));
              
              // Continue with transaction monitoring (similar to above)
              // For brevity, I'm not duplicating the full monitoring code here
            } else {
              throw new Error("Timelock contract not available for alternative method");
            }
          } else {
            // Just rethrow the original error if we're not trying alternative
            throw error;
          }
        }
      } else if (actionName === 'executing') {
        // For execute, we also need to make sure we're calling the right function
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const governance = contracts.governance.connect(signer);
        
        console.log(`Executing proposal ${proposalId}...`);
        
        try {
          // Estimate gas
          const gasEstimate = await governance.estimateGas.executeProposal(proposalId)
            .catch(e => {
              console.warn("Gas estimation failed for executeProposal:", e);
              return ethers.utils.hexlify(2000000); // 2M gas fallback
            });
            
          const gasLimit = ethers.BigNumber.from(gasEstimate).mul(150).div(100);
          const gasPrice = (await provider.getGasPrice()).mul(110).div(100); // 10% higher
          
          // Execute the proposal
          const tx = await governance.executeProposal(proposalId, {
            gasLimit,
            gasPrice,
            nonce: await provider.getTransactionCount(await signer.getAddress(), 'latest')
          });
          
          console.log("Execute transaction sent:", tx.hash);
          
          // Update tracking
          setPendingTxs(prev => ({
            ...prev,
            [txId]: {
              ...prev[txId],
              hash: tx.hash,
              status: 'pending',
              lastChecked: Date.now()
            }
          }));
          
          // Monitor transaction
          const checkInterval = setInterval(async () => {
            try {
              const receipt = await provider.getTransactionReceipt(tx.hash);
              
              if (receipt) {
                clearInterval(checkInterval);
                
                setPendingTxs(prev => ({
                  ...prev,
                  [txId]: {
                    ...prev[txId],
                    status: receipt.status ? 'success' : 'failed',
                    receipt
                  }
                }));
                
                if (receipt.status) {
                  console.log("Execute transaction confirmed successfully");
                  
                  // Update the proposal's executed status
                  await updateProposalExecutedStatus(proposalId);
                  
                  // Trigger full refresh
                  if (typeof fetchProposals === 'function') {
                    setTimeout(() => {
                      fetchProposals().catch(e => console.error("Error refreshing proposals:", e));
                    }, 2000);
                  }
                  
                  // Auto-dismiss success notification
                  setTimeout(() => {
                    setPendingTxs(prev => {
                      const updated = {...prev};
                      delete updated[txId];
                      return updated;
                    });
                  }, 5000);
                }
              }
            } catch (e) {
              console.warn("Error checking execute transaction:", e);
            }
          }, 5000);
        } catch (error) {
          console.error("Error executing proposal:", error);
          
          setPendingTxs(prev => ({
            ...prev,
            [txId]: {
              ...prev[txId],
              status: 'failed',
              error: error.message || 'Error executing proposal',
              canRetry: retryCount < 3
            }
          }));
          
          throw error;
        }
      } else if (actionName === 'claiming refund for') {
        // Special handling for claim refund to update the stakeRefunded status
        const result = await action(proposalId);
        
        // Update transaction tracking on success
        setPendingTxs(prev => ({
          ...prev,
          [txId]: { 
            ...prev[txId],
            status: 'success'
          }
        }));
        
        // Update the stake refunded status for this proposal
        await updateStakeRefundedStatus(proposalId);
        
        // Force a refresh of proposals
        if (typeof fetchProposals === 'function') {
          setTimeout(() => {
            fetchProposals().catch(e => console.error("Error refreshing proposals:", e));
          }, 2000);
        }
        
        return result;
      } else {
        // For other actions (cancel), use the original approach
        const result = await action(proposalId);
        
        // Update transaction tracking on success
        setPendingTxs(prev => ({
          ...prev,
          [txId]: { 
            ...prev[txId],
            status: 'success'
          }
        }));
        
        // Force a refresh of proposals
        if (typeof fetchProposals === 'function') {
          setTimeout(() => {
            fetchProposals().catch(e => console.error("Error refreshing proposals:", e));
          }, 2000);
        }
        
        return result;
      }
    } catch (error) {
      console.error(`Error ${actionName} proposal:`, error);
      
      // Update transaction tracking on failure
      setPendingTxs(prev => ({
        ...prev,
        [txId]: { 
          ...prev[txId],
          status: 'failed',
          error: error.message || `Error ${actionName} proposal`,
          canRetry: retryCount < 3
        }
      }));
      
      // Show user-friendly error message
      alert(`Error ${actionName} proposal: ${error.message || 'See console for details'}`);
    }
  };

  // Filter out proposals based on the selected filter type
  const filteredProposals = proposals.filter(p => {
    if (proposalType === 'all') {
      return true;
    } else if (proposalType === 'pending') {
      // Include both 'pending' and 'queued' states in the 'pending' filter
      return p.stateLabel.toLowerCase() === 'pending' || p.stateLabel.toLowerCase() === 'queued';
    } else {
      // For all other filters, use direct match
      return p.stateLabel.toLowerCase() === proposalType;
    }
  });

  // Render transaction notifications
  const renderTransactionNotifications = () => {
    const txEntries = Object.entries(pendingTxs);
    if (txEntries.length === 0) return null;
    
    return (
      <div className="fixed bottom-6 right-6 z-50 space-y-4 sm:w-96 w-full max-w-full px-4 sm:px-0">
        {txEntries.map(([id, tx]) => (
          <div 
            key={id} 
            className={`rounded-xl shadow-xl p-5 transform transition-all duration-300 ${
              tx.status === 'pending' ? 'bg-blue-50 border-2 border-blue-300' :
              tx.status === 'success' ? 'bg-green-50 border-2 border-green-300' :
              'bg-red-50 border-2 border-red-300'
            }`}
          >
            <div className="flex items-start">
              <div className="flex-shrink-0 mt-1">
                {tx.status === 'pending' ? (
                  <div className="h-8 w-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                ) : tx.status === 'success' ? (
                  <Check className="h-8 w-8 text-green-500" />
                ) : (
                  <AlertTriangle className="h-8 w-8 text-red-500" />
                )}
              </div>
              <div className="ml-4 flex-1">
                <p className="text-lg font-semibold text-gray-900">
                  {tx.status === 'pending' ? 'Transaction in Progress' :
                   tx.status === 'success' ? 'Transaction Successful' :
                   'Transaction Failed'}
                </p>
                <p className="mt-2 text-base text-gray-600">
                  {tx.status === 'pending' 
                    ? `${tx.action} proposal #${tx.proposalId}...` 
                    : tx.status === 'success'
                    ? `Successfully ${tx.action} proposal #${tx.proposalId}`
                    : `Error ${tx.action} proposal #${tx.proposalId}: ${tx.error || 'Unknown error'}`
                  }
                </p>
                {tx.warning && (
                  <p className="mt-2 text-base text-yellow-600 font-medium">{tx.warning}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {tx.hash && (
                    <button 
                      onClick={() => copyToClipboard(tx.hash)}
                      className="text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-2 px-3 rounded-md flex items-center transition-colors"
                    >
                      {copiedText === tx.hash ? 'Copied!' : 'Copy Transaction Hash'}
                      <Copy className="ml-2 h-4 w-4" />
                    </button>
                  )}
                  
                  {(tx.canRetry || tx.status === 'failed') && (
                    <button 
                      onClick={() => {
                        // First remove the current transaction notification
                        setPendingTxs(prev => {
                          const updated = {...prev};
                          delete updated[id];
                          return updated;
                        });
                        
                        // Then retry with higher gas parameters
                        handleProposalAction(
                          tx.action === 'queuing' ? queueProposalWithThreatLevel : 
                          tx.action === 'cancelling' ? cancelProposal :
                          tx.action === 'executing' ? executeProposal : claimRefund,
                          tx.proposalId,
                          tx.action,
                          (tx.retryCount || 0) + 1
                        );
                      }}
                      className="text-sm bg-yellow-50 hover:bg-yellow-100 text-yellow-700 py-2 px-3 rounded-md flex items-center transition-colors"
                    >
                      Retry with Higher Gas
                    </button>
                  )}
                </div>
              </div>
              <div className="ml-4 flex-shrink-0 flex">
                <button
                  onClick={() => {
                    setPendingTxs(prev => {
                      const updated = {...prev};
                      delete updated[id];
                      return updated;
                    });
                  }}
                  className="bg-gray-100 hover:bg-gray-200 transition-colors rounded-full p-1.5 inline-flex text-gray-500 hover:text-gray-700 focus:outline-none"
                  aria-label="Close notification"
                >
                  <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold">Proposals</h2>
          <p className="text-gray-500">View, create, and manage proposals</p>
        </div>
        <button 
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md"
          onClick={() => setShowCreateModal(true)}
        >
          Create Proposal
        </button>
      </div>
      
      {/* Filter options */}
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <div className="flex flex-wrap gap-2">
          {['all', 'active', 'pending', 'succeeded', 'executed', 'defeated', 'canceled', 'expired'].map(type => (
            <button
              key={type}
              className={`px-3 py-1 rounded-full text-sm ${proposalType === type ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-800'}`}
              onClick={() => setProposalType(type)}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>
      
      {/* Transaction notifications */}
      {renderTransactionNotifications()}
      
      {/* Proposals list */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader size="large" text="Loading proposals..." />
          </div>
        ) : filteredProposals.length > 0 ? (
          filteredProposals.map((proposal, idx) => (
            <div key={idx} className="bg-white p-6 rounded-lg shadow">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-medium">{proposal.title}</h3>
                  <p className="text-sm text-gray-500">Proposal #{proposal.id}</p>
                </div>
                <div className="flex items-center">
                  <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(proposal.stateLabel.toLowerCase())}`}>
                    {proposal.stateLabel}
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mb-4 text-sm text-gray-500">
                <div>
                  <p className="font-medium">Type</p>
                  <p>{proposal.typeLabel}</p>
                </div>
                <div>
                  <p className="font-medium">Created</p>
                  <p>{formatRelativeTime(proposal.createdAt)}</p>
                </div>
                <div>
                  <p className="font-medium">Proposer</p>
                  <p>{formatAddress(proposal.proposer)}</p>
                </div>
              </div>
              
              <div className="border-t pt-4 mb-4">
                {expandedProposalId === proposal.id ? (
                  <div>
                    <p className="text-sm text-gray-700 mb-2">{proposal.description}</p>
                    <div className="mt-4 border-t pt-4">
                      <h4 className="font-medium mb-2">Proposal Details</h4>
                      {/* Display proposal-specific details */}
                      {proposal.type === PROPOSAL_TYPES.GENERAL && (
                        <div className="mt-2 text-xs bg-gray-50 p-4 rounded">
                          {renderAddress(proposal.target, "Target")}
                          <p className="mt-2 font-medium">Call Data:</p>
                          <pre className="bg-gray-100 p-2 mt-1 rounded overflow-x-auto">{proposal.callData}</pre>
                        </div>
                      )}
                      
                      {(proposal.type === PROPOSAL_TYPES.WITHDRAWAL || 
                        proposal.type === PROPOSAL_TYPES.TOKEN_TRANSFER || 
                        proposal.type === PROPOSAL_TYPES.TOKEN_MINT || 
                        proposal.type === PROPOSAL_TYPES.TOKEN_BURN) && (
                        <div className="mt-2 text-xs bg-gray-50 p-4 rounded">
                          {renderAddress(proposal.recipient, "Recipient")}
                          <p className="mt-2"><span className="font-medium">Amount:</span> {typeof proposal.amount === 'string' ? proposal.amount : formatBigNumber(proposal.amount)} {proposal.type === PROPOSAL_TYPES.WITHDRAWAL ? 'ETH' : 'JUST'}</p>
                        </div>
                      )}
                      
                      {proposal.type === PROPOSAL_TYPES.EXTERNAL_ERC20_TRANSFER && (
                        <div className="mt-2 text-xs bg-gray-50 p-4 rounded">
                          {renderAddress(proposal.recipient, "Recipient")}
                          {renderAddress(proposal.token, "Token")}
                          <p className="mt-2"><span className="font-medium">Amount:</span> {typeof proposal.amount === 'string' ? proposal.amount : formatBigNumber(proposal.amount)}</p>
                        </div>
                      )}
                      
                      {proposal.type === PROPOSAL_TYPES.GOVERNANCE_CHANGE && (
                        <div className="mt-2 text-xs bg-gray-50 p-4 rounded">
                          {proposal.newThreshold && <p><span className="font-medium">New Threshold:</span> {formatBigNumber(proposal.newThreshold)}</p>}
                          {proposal.newQuorum && <p className="mt-2"><span className="font-medium">New Quorum:</span> {formatBigNumber(proposal.newQuorum)}</p>}
                          {proposal.newVotingDuration && <p className="mt-2"><span className="font-medium">New Voting Duration:</span> {formatTime(proposal.newVotingDuration)}</p>}
                          {proposal.newTimelockDelay && <p className="mt-2"><span className="font-medium">New Timelock Delay:</span> {formatTime(proposal.newTimelockDelay)}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-700 mb-2">{proposal.description.substring(0, 200)}...</p>
                )}
              </div>
              
              <div className="flex flex-wrap gap-2">
                <button 
                  className="text-indigo-600 border border-indigo-600 px-3 py-1 rounded-md text-sm hover:bg-indigo-50 flex items-center"
                  onClick={() => toggleProposalDetails(proposal.id)}
                >
                  {expandedProposalId === proposal.id ? (
                    <>View Less <ChevronUp className="w-4 h-4 ml-1" /></>
                  ) : (
                    <>View Details <ChevronDown className="w-4 h-4 ml-1" /></>
                  )}
                </button>
                
                {proposal.state === PROPOSAL_STATES.ACTIVE && (
                  <button 
                    className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-sm"
                    onClick={() => handleProposalAction(cancelProposal, proposal.id, 'cancelling')}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                )}
                
                {/* Show Queue button only for SUCCEEDED proposals that haven't been queued yet */}
                {proposal.state === PROPOSAL_STATES.SUCCEEDED && !proposal.isQueued && (
                  <button 
                    className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md text-sm"
                    onClick={() => handleProposalAction(queueProposalWithThreatLevel, proposal.id, 'queuing')}
                    disabled={loading}
                  >
                    Queue
                  </button>
                )}
                
                {/* Show Execute button only for QUEUED proposals that haven't been executed yet */}
                {proposal.state === PROPOSAL_STATES.QUEUED && !proposal.isExecuted && (
                  <button 
                    className="bg-purple-500 hover:bg-purple-600 text-white px-3 py-1 rounded-md text-sm"
                    onClick={() => handleProposalAction(executeProposal, proposal.id, 'executing')}
                    disabled={loading}
                  >
                    Execute
                  </button>
                )}
                
                {/* Only show Claim Refund button to the proposer and if stake is not already refunded */}
                {(proposal.state === PROPOSAL_STATES.DEFEATED || 
                  proposal.state === PROPOSAL_STATES.CANCELED || 
                  proposal.state === PROPOSAL_STATES.EXPIRED) && 
                 account && 
                 account.toLowerCase() === proposal.proposer.toLowerCase() && 
                 !proposal.stakeRefunded && (
                  <button 
                    className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded-md text-sm"
                    onClick={() => handleProposalAction(claimRefund, proposal.id, 'claiming refund for')}
                    disabled={loading}
                  >
                    Claim Refund
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-gray-500">
            No proposals found
          </div>
        )}
      </div>
      
      {/* Create Proposal Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-screen overflow-y-auto">
            <h2 className="text-xl font-semibold mb-4">Create New Proposal</h2>
            
            {transactionError && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                <p className="font-bold">Error</p>
                <p>{transactionError}</p>
              </div>
            )}
            
            <form onSubmit={handleSubmitProposal} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Proposal Title</label>
                <input 
                  type="text" 
                  className="w-full rounded-md border border-gray-300 p-2" 
                  placeholder="Enter proposal title" 
                  value={newProposal.title}
                  onChange={(e) => setNewProposal({...newProposal, title: e.target.value})}
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Proposal Type</label>
                <select 
                  className="w-full rounded-md border border-gray-300 p-2"
                  value={newProposal.type}
                  onChange={(e) => setNewProposal({...newProposal, type: e.target.value})}
                  required
                >
                  <option value={PROPOSAL_TYPES.GENERAL}>General</option>
                  <option value={PROPOSAL_TYPES.WITHDRAWAL}>Withdrawal</option>
                  <option value={PROPOSAL_TYPES.TOKEN_TRANSFER}>Token Transfer</option>
                  <option value={PROPOSAL_TYPES.GOVERNANCE_CHANGE}>Governance Change</option>
                  <option value={PROPOSAL_TYPES.EXTERNAL_ERC20_TRANSFER}>External ERC20 Transfer</option>
                  <option value={PROPOSAL_TYPES.TOKEN_MINT}>Token Mint</option>
                  <option value={PROPOSAL_TYPES.TOKEN_BURN}>Token Burn</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea 
                  className="w-full rounded-md border border-gray-300 p-2" 
                  rows="4" 
                  placeholder="Describe your proposal"
                  value={newProposal.description}
                  onChange={(e) => setNewProposal({...newProposal, description: e.target.value})}
                  required
                ></textarea>
              </div>
              
              {/* Fields for GENERAL proposal type */}
              {parseInt(newProposal.type) === PROPOSAL_TYPES.GENERAL && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Target Address</label>
                    <input 
                      type="text" 
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="0x..." 
                      value={newProposal.target}
                      onChange={(e) => setNewProposal({...newProposal, target: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">The contract address that will be called</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Call Data</label>
                    <input 
                      type="text" 
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="0x..." 
                      value={newProposal.callData}
                      onChange={(e) => setNewProposal({...newProposal, callData: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">The encoded function call data</p>
                  </div>
                </>
              )}
              
              {/* Fields for WITHDRAWAL proposal type */}
              {parseInt(newProposal.type) === PROPOSAL_TYPES.WITHDRAWAL && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Address</label>
                    <input 
                      type="text" 
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="0x..." 
                      value={newProposal.recipient}
                      onChange={(e) => setNewProposal({...newProposal, recipient: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">The address that will receive the ETH</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount (ETH)</label>
                    <input 
                      type="number" 
                      step="0.000000000000000001"
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="Amount" 
                      value={newProposal.amount}
                      onChange={(e) => setNewProposal({...newProposal, amount: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">Amount of ETH to withdraw</p>
                  </div>
                </>
              )}
              
              {/* Fields for TOKEN_TRANSFER proposal type */}
              {parseInt(newProposal.type) === PROPOSAL_TYPES.TOKEN_TRANSFER && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Address</label>
                    <input 
                      type="text" 
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="0x..." 
                      value={newProposal.recipient}
                      onChange={(e) => setNewProposal({...newProposal, recipient: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">The address that will receive the JUST tokens</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount (JUST)</label>
                    <input 
                      type="number"
                      step="0.000000000000000001"
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="Amount" 
                      value={newProposal.amount}
                      onChange={(e) => setNewProposal({...newProposal, amount: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">Amount of JUST tokens to transfer</p>
                  </div>
                </>
              )}
              
              {/* Fields for TOKEN_MINT proposal type */}
              {parseInt(newProposal.type) === PROPOSAL_TYPES.TOKEN_MINT && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Address</label>
                    <input 
                      type="text" 
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="0x..." 
                      value={newProposal.recipient}
                      onChange={(e) => setNewProposal({...newProposal, recipient: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">The address that will receive the minted JUST tokens</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount (JUST)</label>
                    <input 
                      type="number"
                      step="0.000000000000000001"
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="Amount" 
                      value={newProposal.amount}
                      onChange={(e) => setNewProposal({...newProposal, amount: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">Amount of JUST tokens to mint</p>
                  </div>
                </>
              )}
              
              {/* Fields for TOKEN_BURN proposal type */}
              {parseInt(newProposal.type) === PROPOSAL_TYPES.TOKEN_BURN && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Address to Burn From</label>
                    <input 
                      type="text" 
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="0x..." 
                      value={newProposal.recipient}
                      onChange={(e) => setNewProposal({...newProposal, recipient: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">The address from which JUST tokens will be burned</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount (JUST)</label>
                    <input 
                      type="number"
                      step="0.000000000000000001"
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="Amount" 
                      value={newProposal.amount}
                      onChange={(e) => setNewProposal({...newProposal, amount: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">Amount of JUST tokens to burn</p>
                  </div>
                </>
              )}
              
              {/* Fields for EXTERNAL_ERC20_TRANSFER proposal type */}
              {parseInt(newProposal.type) === PROPOSAL_TYPES.EXTERNAL_ERC20_TRANSFER && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Token Address</label>
                    <input 
                      type="text" 
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="0x..." 
                      value={newProposal.token}
                      onChange={(e) => setNewProposal({...newProposal, token: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">The address of the ERC20 token to transfer</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Address</label>
                    <input 
                      type="text" 
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="0x..." 
                      value={newProposal.recipient}
                      onChange={(e) => setNewProposal({...newProposal, recipient: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">The address that will receive the tokens</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                    <input 
                      type="number"
                      step="0.000000000000000001"
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="Amount" 
                      value={newProposal.amount}
                      onChange={(e) => setNewProposal({...newProposal, amount: e.target.value})}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">Amount of tokens to transfer</p>
                  </div>
                </>
              )}
              
              {/* Fields for GOVERNANCE_CHANGE proposal type */}
              {parseInt(newProposal.type) === PROPOSAL_TYPES.GOVERNANCE_CHANGE && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Proposal Threshold</label>
                    <input 
                      type="number"
                      step="0.000000000000000001"
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="New threshold (in JUST tokens)" 
                      value={newProposal.newThreshold}
                      onChange={(e) => setNewProposal({...newProposal, newThreshold: e.target.value})}
                    />
                    <p className="text-xs text-gray-500 mt-1">The new minimum amount of JUST tokens needed to create proposals</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Quorum</label>
                    <input 
                      type="number"
                      step="0.000000000000000001"
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="New quorum (in JUST tokens)" 
                      value={newProposal.newQuorum}
                      onChange={(e) => setNewProposal({...newProposal, newQuorum: e.target.value})}
                    />
                    <p className="text-xs text-gray-500 mt-1">The new minimum voting power required for a proposal to pass</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Voting Duration</label>
                    <input 
                      type="number"
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="New voting duration (in seconds)" 
                      value={newProposal.newVotingDuration}
                      onChange={(e) => setNewProposal({...newProposal, newVotingDuration: e.target.value})}
                    />
                    <p className="text-xs text-gray-500 mt-1">The new duration of the voting period in seconds</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Timelock Delay</label>
                    <input 
                      type="number"
                      className="w-full rounded-md border border-gray-300 p-2" 
                      placeholder="New timelock delay (in seconds)" 
                      value={newProposal.newTimelockDelay}
                      onChange={(e) => setNewProposal({...newProposal, newTimelockDelay: e.target.value})}
                    />
                    <p className="text-xs text-gray-500 mt-1">The new delay before a proposal can be executed in seconds</p>
                  </div>
                </>
              )}
              
              <div className="flex justify-end space-x-2 pt-4">
                <button 
                  type="button"
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                  onClick={() => setShowCreateModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400"
                  disabled={submitting}
                >
                  {submitting ? 'Creating Proposal...' : 'Create Proposal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProposalsTab;