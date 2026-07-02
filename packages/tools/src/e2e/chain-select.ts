export type ChainInfo = {
  id: number;
  name: string;
  symbols: string[];
};

export type TestSpec = {
  token: string;
  amount: string;
};

export const pickRandomChain = (chains: ChainInfo[]): ChainInfo => {
  if (chains.length === 0) {
    throw new Error('No chains available for selection');
  }
  const idx = Math.floor(Math.random() * chains.length);
  return chains[idx]!;
};

// USDC.e (bridged USDC on Citrea mainnet) is treated as equivalent to USDC —
// source chains never use both, so a prefer-USDC ladder picks the right one.
export const selectTestsForChain = (
  chain: ChainInfo,
  usdcAmount: string,
  ethAmount: string
): TestSpec[] => {
  const tests: TestSpec[] = [];
  if (chain.symbols.includes('USDC')) {
    tests.push({ token: 'USDC', amount: usdcAmount });
  } else if (chain.symbols.includes('USDC.e')) {
    tests.push({ token: 'USDC.e', amount: usdcAmount });
  }
  if (chain.symbols.includes('ETH')) {
    tests.push({ token: 'ETH', amount: ethAmount });
  }
  return tests;
};
