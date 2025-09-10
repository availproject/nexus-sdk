const FillEvent = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: "bytes32",
      name: "requestHash",
      type: "bytes32",
    },
    {
      indexed: false,
      internalType: "address",
      name: "from",
      type: "address",
    },
    {
      indexed: false,
      internalType: "address",
      name: "solver",
      type: "address",
    },
  ],
  name: "Fill",
  type: "event",
} as const;

export { FillEvent };
