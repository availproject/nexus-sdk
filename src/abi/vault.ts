const DepositEvent = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'requestHash',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'address',
      name: 'from',
      type: 'address',
    },
  ],
  name: 'Deposit',
  type: 'event',
} as const;

const FillEvent = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'requestHash',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'address',
      name: 'from',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'address',
      name: 'solver',
      type: 'address',
    },
  ],
  name: 'Fulfilment',
  type: 'event',
} as const;

const EVMVaultABI = [
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: 'enum Vault.Universe',
                name: 'universe',
                type: 'uint8',
              },
              {
                internalType: 'uint256',
                name: 'chainID',
                type: 'uint256',
              },
              {
                internalType: 'bytes32',
                name: 'contractAddress',
                type: 'bytes32',
              },
              {
                internalType: 'uint256',
                name: 'value',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'fee',
                type: 'uint256',
              },
            ],
            internalType: 'struct Vault.SourcePair[]',
            name: 'sources',
            type: 'tuple[]',
          },
          {
            internalType: 'enum Vault.Universe',
            name: 'destinationUniverse',
            type: 'uint8',
          },
          {
            internalType: 'uint256',
            name: 'destinationChainID',
            type: 'uint256',
          },
          {
            internalType: 'bytes32',
            name: 'recipientAddress',
            type: 'bytes32',
          },
          {
            components: [
              {
                internalType: 'bytes32',
                name: 'contractAddress',
                type: 'bytes32',
              },
              {
                internalType: 'uint256',
                name: 'value',
                type: 'uint256',
              },
            ],
            internalType: 'struct Vault.DestinationPair[]',
            name: 'destinations',
            type: 'tuple[]',
          },
          {
            internalType: 'uint256',
            name: 'nonce',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'expiry',
            type: 'uint256',
          },
          {
            components: [
              {
                internalType: 'enum Vault.Universe',
                name: 'universe',
                type: 'uint8',
              },
              {
                internalType: 'bytes32',
                name: 'address_',
                type: 'bytes32',
              },
            ],
            internalType: 'struct Vault.Party[]',
            name: 'parties',
            type: 'tuple[]',
          },
        ],
        internalType: 'struct Vault.Request',
        name: 'request',
        type: 'tuple',
      },
      {
        internalType: 'bytes',
        name: 'signature',
        type: 'bytes',
      },
      {
        internalType: 'uint256',
        name: 'chainIndex',
        type: 'uint256',
      },
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

export { EVMVaultABI, DepositEvent, FillEvent };
export default EVMVaultABI;
