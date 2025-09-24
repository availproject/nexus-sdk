export default [
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                components: [
                  {
                    internalType: 'address',
                    name: 'to',
                    type: 'address',
                  },
                  {
                    internalType: 'uint256',
                    name: 'value',
                    type: 'uint256',
                  },
                  {
                    internalType: 'bytes',
                    name: 'data',
                    type: 'bytes',
                  },
                ],
                internalType: 'struct Call[]',
                name: 'calls',
                type: 'tuple[]',
              },
              {
                internalType: 'bool',
                name: 'revertOnFailure',
                type: 'bool',
              },
            ],
            internalType: 'struct BatchedCall',
            name: 'batchedCall',
            type: 'tuple',
          },
          {
            internalType: 'uint256',
            name: 'nonce',
            type: 'uint256',
          },
          {
            internalType: 'bytes32',
            name: 'keyHash',
            type: 'bytes32',
          },
          {
            internalType: 'address',
            name: 'executor',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: 'deadline',
            type: 'uint256',
          },
        ],
        internalType: 'struct SignedBatchedCall',
        name: 'signedBatchedCall',
        type: 'tuple',
      },
      {
        internalType: 'bytes',
        name: 'wrappedSignature',
        type: 'bytes',
      },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    type: 'function',
    name: 'approveNative',
    inputs: [
      {
        name: 'spender',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'nativeAllowance',
    inputs: [
      {
        name: 'spender',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'allowance',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
] as const;
