const OP_STACK_GAS_ORACLE_ABI = [
  { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
  {
    inputs: [],
    name: 'DECIMALS',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'baseFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [],
    name: 'gasPrice',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes', name: '_data', type: 'bytes' }],
    name: 'getL1Fee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes', name: '_data', type: 'bytes' }],
    name: 'getL1GasUsed',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'l1BaseFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'overhead',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'scalar',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'version',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const ARBITRUM_GAS_ORACLE_ABI = [
  {
    name: 'gasEstimateL1Component',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'contractCreation', type: 'bool' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [
      { name: 'gasEstimateForL1', type: 'uint64' }, // L1 gas units
      { name: 'baseFee', type: 'uint256' }, // L2 basefee
      { name: 'l1BaseFeeEstimate', type: 'uint256' }, // L1 basefee
    ],
    stateMutability: 'view',
  },
] as const;

export { ARBITRUM_GAS_ORACLE_ABI, OP_STACK_GAS_ORACLE_ABI };
