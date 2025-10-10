# @avail-project/nexus-widgets

Ready-to-use React components for cross-chain transactions. Drop-in widgets that provide complete bridge, transfer, and execute flows with customizable styling.

## Installation

```bash
npm install @avail-project/nexus-widgets
```

**Required peer dependencies:**

```bash
npm install react react-dom viem
```

## Quick Start

### Wrap your app with `NexusProvider`

```tsx
import { NexusProvider } from '@avail-project/nexus-widgets';

export default function App() {
  return (
    <NexusProvider
      config={{
        debug: false, // true to view debug logs
        network: 'testnet', // "mainnet" (default) or "testnet"
      }}
    >
      <YourApp />
    </NexusProvider>
  );
}
```

### Forward the user's wallet provider

```tsx
import { useEffect } from 'react';
import { useAccount } from '@wagmi/react'; // any wallet lib works
import { useNexus } from '@avail-project/nexus-widgets';

export function WalletBridge() {
  const { connector, isConnected } = useAccount();
  const { setProvider } = useNexus();

  useEffect(() => {
    if (isConnected && connector?.getProvider) {
      connector.getProvider().then(setProvider);
    }
  }, [isConnected, connector, setProvider]);

  return null;
}
```

### Alternative: Manual SDK Initialization

For developers who need to use SDK methods directly (like `getUnifiedBalances`) before using UI components:

```tsx
import { useNexus } from '@avail-project/nexus-widgets';

function MyComponent() {
  const { initializeSdk, sdk, isSdkInitialized } = useNexus();

  const handleInitialize = async () => {
    const provider = await window.ethereum; // or get from your wallet library
    await initializeSdk(provider); // Initializes both SDK and UI state

    // Now you can use SDK methods directly
    const balances = await sdk.getUnifiedBalances();
    console.log('Balances:', balances);

    // UI components will already be initialized when used
  };

  return (
    <button onClick={handleInitialize} disabled={isSdkInitialized}>
      {isSdkInitialized ? 'SDK Ready' : 'Initialize SDK'}
    </button>
  );
}
```

**Benefits of manual initialization:**

- Use SDK methods immediately after initialization
- No duplicate initialization when UI components are used
- Full control over initialization timing
- Access to unified balances and other SDK features before transactions

### Use Widgets

```tsx
import {
  BridgeButton,
  TransferButton,
  BridgeAndExecuteButton,
  TOKEN_CONTRACT_ADDRESSES,
  TOKEN_METADATA,
  SUPPORTED_CHAINS,
  type SUPPORTED_TOKENS,
  type SUPPORTED_CHAIN_IDS
} from '@avail-project/nexus-widgets';
import { parseUnits } from 'viem';

/*  Bridge ----------------------------------------------------------- */
<BridgeButton prefill={{ chainId: 137, token: 'USDC', amount: '100' }}>
  {({ onClick, isLoading }) => (
    <button onClick={onClick} disabled={isLoading}>
      {isLoading ? 'Bridging…' : 'Bridge 100 USDC → Polygon'}
    </button>
  )}
</BridgeButton>

/*  Transfer --------------------------------------------------------- */
<TransferButton>
  {({ onClick }) => <YourStyledBtn onClick={onClick}>Send Funds</YourStyledBtn>}
</TransferButton>

/*  Bridge + Execute ------------------------------------------------- */
<BridgeAndExecuteButton
  contractAddress={'0x794a61358D6845594F94dc1DB02A252b5b4814aD'}
  contractAbi={
      [
        {
          name: 'supply',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
              { name: 'asset', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'onBehalfOf', type: 'address' },
              { name: 'referralCode', type: 'uint16' },
              ],
          outputs: [],
        },
      ] as const
    }
  functionName="supply"
  buildFunctionParams={(token, amount, _chainId, user) => {
          const decimals = TOKEN_METADATA[token].decimals
          const amountWei = parseUnits(amount, decimals)
          const tokenAddr = TOKEN_CONTRACT_ADDRESSES[token][_chainId]
          return { functionParams: [tokenAddr, amountWei, user, 0] }
        }}
  prefill={{
        toChainId: 42161,
        token: 'USDT',
  }}
  >
    {({ onClick, isLoading }) => (
      <Button
        onClick={onClick}
        disabled={isLoading}
        className="w-full"
      >
        {isLoading ? 'Processing…' : 'Bridge & Stake'}
      </Button>
      )}
</BridgeAndExecuteButton>
```

## Component APIs

### `BridgeButton`

Bridge tokens between chains with a customizable button interface.

```tsx
interface BridgeButtonProps {
  title?: string; // Will appear once intialization is completed
  prefill?: Partial<BridgeParams>; // chainId, token, amount
  className?: string;
  children(props: { onClick(): void; isLoading: boolean }): React.ReactNode;
}
```

**Example:**

```tsx
<BridgeButton prefill={{ chainId: 137, token: 'USDC', amount: '100' }}>
  {({ onClick, isLoading }) => (
    <button onClick={onClick} disabled={isLoading}>
      {isLoading ? 'Bridging…' : 'Bridge USDC to Polygon'}
    </button>
  )}
</BridgeButton>
```

### `TransferButton`

Send tokens to any address with automatic optimization (direct transfer when possible).

```tsx
interface TransferButtonProps {
  title?: string; // Will appear once intialization is completed
  prefill?: Partial<TransferParams>; // chainId, token, amount, recipient
  className?: string;
  children(props: { onClick(): void; isLoading: boolean }): React.ReactNode;
}
```

**Example:**

```tsx
<TransferButton
  prefill={{
    chainId: 42161,
    token: 'USDC',
    amount: '50',
    recipient: '0x742d35Cc6634C0532925a3b8D4C9db96c4b4Db45',
  }}
>
  {({ onClick, isLoading }) => (
    <button onClick={onClick} disabled={isLoading}>
      {isLoading ? 'Sending…' : 'Send 50 USDC'}
    </button>
  )}
</TransferButton>
```

### `BridgeAndExecuteButton`

Bridge tokens and execute a smart contract function in a single flow.

```tsx
type DynamicParamBuilder = (
  token: SUPPORTED_TOKENS,
  amount: string,
  chainId: SUPPORTED_CHAINS_IDS,
  userAddress: `0x${string}`,
) => {
  functionParams: readonly unknown[];
  value?: string; // wei; defaults to "0"
};

interface BridgeAndExecuteButtonProps {
  title?: string; // Will appear once intialization is completed
  contractAddress: `0x${string}`; // REQUIRED
  contractAbi: Abi; // REQUIRED
  functionName: string; // REQUIRED
  buildFunctionParams: DynamicParamBuilder; // REQUIRED
  prefill?: { toChainId?: number; token?: SUPPORTED_TOKENS; amount?: string };
  className?: string;
  children(props: { onClick(): void; isLoading: boolean; disabled: boolean }): React.ReactNode;
}
```

**Example - Aave Supply:**

```tsx
<BridgeAndExecuteButton
  contractAddress="0x794a61358D6845594F94dc1DB02A252b5b4814aD" // Aave Pool
  contractAbi={
    [
      {
        name: 'supply',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'asset', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'onBehalfOf', type: 'address' },
          { name: 'referralCode', type: 'uint16' },
        ],
        outputs: [],
      },
    ] as const
  }
  functionName="supply"
  buildFunctionParams={(token, amount, chainId, userAddress) => {
    const decimals = TOKEN_METADATA[token].decimals;
    const amountWei = parseUnits(amount, decimals);
    const tokenAddress = TOKEN_CONTRACT_ADDRESSES[token][chainId];
    return {
      functionParams: [tokenAddress, amountWei, userAddress, 0],
    };
  }}
  prefill={{ toChainId: 1, token: 'USDC' }}
>
  {({ onClick, isLoading, disabled }) => (
    <button onClick={onClick} disabled={isLoading || disabled}>
      {isLoading ? 'Processing…' : 'Bridge & Supply to Aave'}
    </button>
  )}
</BridgeAndExecuteButton>
```

`buildFunctionParams` receives the validated UX input (token, amount, destination chainId) plus the **connected wallet address** and must return the encoded `functionParams` (and optional ETH `value`) used in the destination call.

Nexus then:

1. Bridges the asset to `toChainId`
2. Sets ERC-20 allowance if required
3. Executes `contractAddress.functionName(functionParams, { value })`

## Prefill Behavior

| Widget                   | Supported keys                                                     | Locked in UI |
| ------------------------ | ------------------------------------------------------------------ | ------------ |
| `BridgeButton`           | `chainId`, `token`, `amount`                                       | ✅           |
| `TransferButton`         | `chainId`, `token`, `amount`, `recipient`                          | ✅           |
| `BridgeAndExecuteButton` | `toChainId`, `token`, `amount`                                     | ✅           |

Values passed in `prefill` appear as **read-only** fields, enforcing your desired flow.

## 📱 Widget Examples

### DeFi Protocol Integration

```tsx
// Compound V3 Supply Widget
<BridgeAndExecuteButton
  contractAddress="0xc3d688B66703497DAA19211EEdff47f25384cdc3" // Compound V3 USDC
  contractAbi={
    [
      {
        inputs: [
          { internalType: 'address', name: 'asset', type: 'address' },
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
        ],
        name: 'supply',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ] as const
  }
  functionName="supply"
  buildFunctionParams={(token, amount, chainId, userAddress) => {
    const decimals = TOKEN_METADATA[token].decimals;
    const amountWei = parseUnits(amount, decimals);
    const tokenAddress = TOKEN_CONTRACT_ADDRESSES[token][chainId];
    return {
      functionParams: [tokenAddress, amountWei],
    };
  }}
  prefill={{ toChainId: 1, token: 'USDC' }}
>
  {({ onClick, isLoading }) => (
    <div className="bg-blue-500 hover:bg-blue-600 rounded-lg p-4">
      <h3 className="text-white font-bold">Earn with Compound</h3>
      <button
        onClick={onClick}
        disabled={isLoading}
        className="mt-2 bg-white text-blue-500 px-4 py-2 rounded"
      >
        {isLoading ? 'Processing...' : 'Supply & Earn'}
      </button>
    </div>
  )}
</BridgeAndExecuteButton>
```

### Simple Payment Flow

```tsx
// Payment button for e-commerce
<TransferButton
  prefill={{
    token: 'USDC',
    amount: '25.00',
    recipient: merchantAddress,
    chainId: 137, // Polygon for low fees
  }}
>
  {({ onClick, isLoading }) => (
    <button className="checkout-btn" onClick={onClick} disabled={isLoading}>
      {isLoading ? 'Processing Payment...' : 'Pay $25 USDC'}
    </button>
  )}
</TransferButton>
```

### Multi-Chain Liquidity

```tsx
// Bridge to specific chain for better rates
<BridgeButton prefill={{ chainId: 42161, token: 'ETH', amount: '0.1' }}>
  {({ onClick, isLoading }) => (
    <div className="liquidity-card">
      <h3>Better rates on Arbitrum</h3>
      <p>Save 60% on gas fees</p>
      <button onClick={onClick} disabled={isLoading}>
        {isLoading ? 'Bridging...' : 'Bridge to Arbitrum'}
      </button>
    </div>
  )}
</BridgeButton>
```

## Advanced Usage

### Custom Loading States

```tsx
<BridgeButton prefill={{ chainId: 137, token: 'USDC', amount: '100' }}>
  {({ onClick, isLoading }) => (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={`btn ${isLoading ? 'btn-loading' : 'btn-primary'}`}
    >
      {isLoading ? (
        <div className="flex items-center">
          <Spinner className="mr-2" />
          Bridging USDC...
        </div>
      ) : (
        'Bridge 100 USDC → Polygon'
      )}
    </button>
  )}
</BridgeButton>
```

### Error Handling

```tsx
function MyBridgeComponent() {
  const [error, setError] = useState(null);

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}

      <BridgeButton prefill={{ chainId: 137, token: 'USDC', amount: '100' }}>
        {({ onClick, isLoading }) => (
          <button
            onClick={async () => {
              try {
                setError(null);
                await onClick();
              } catch (err) {
                setError(err.message);
              }
            }}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : 'Bridge USDC'}
          </button>
        )}
      </BridgeButton>
    </div>
  );
}
```

### Access to SDK Methods

```tsx
function BalanceAwareWidget() {
  const { sdk, isSdkInitialized } = useNexus();
  const [balances, setBalances] = useState([]);

  useEffect(() => {
    if (isSdkInitialized) {
      sdk.getUnifiedBalances().then(setBalances);
    }
  }, [sdk, isSdkInitialized]);

  return (
    <div>
      <div className="balances">
        {balances.map((balance) => (
          <div key={balance.symbol}>
            {balance.symbol}: {balance.balance}
          </div>
        ))}
      </div>

      <BridgeButton>
        {({ onClick, isLoading }) => (
          <button onClick={onClick} disabled={isLoading}>
            Bridge Assets
          </button>
        )}
      </BridgeButton>
    </div>
  );
}
```

## Best Practices

### 1. Always simulate first

```tsx
// Good: Let the widget handle simulation internally
<BridgeButton>
  {({ onClick, isLoading }) => (
    <button onClick={onClick} disabled={isLoading}>
      Bridge
    </button>
  )}
</BridgeButton>
```

### 2. Handle loading states gracefully

```tsx
// Good: Provide clear feedback
<TransferButton>
  {({ onClick, isLoading }) => (
    <button onClick={onClick} disabled={isLoading}>
      {isLoading ? (
        <div className="flex items-center">
          <Spinner className="mr-2" />
          Transferring...
        </div>
      ) : (
        'Send Tokens'
      )}
    </button>
  )}
</TransferButton>
```

### 3. Use appropriate confirmation levels

```tsx
// Good: For high-value transactions, the widget will automatically
// request higher confirmation levels
<BridgeAndExecuteButton prefill={{ amount: '10000' }}>
  {/* Widget handles confirmation requirements */}
</BridgeAndExecuteButton>
```

### 4. Clean up resources

```tsx
function MyComponent() {
  const { deinitializeSdk } = useNexus();

  useEffect(() => {
    return () => {
      deinitializeSdk();
    };
  }, []);

  return <BridgeButton>{/* ... */}</BridgeButton>;
}
```

## Supported Networks & Tokens

### Mainnet Chains

| Network   | Chain ID | Native Currency | Status |
| --------- | -------- | --------------- | ------ |
| Ethereum  | 1        | ETH             | ✅     |
| Optimism  | 10       | ETH             | ✅     |
| Polygon   | 137      | MATIC           | ✅     |
| Arbitrum  | 42161    | ETH             | ✅     |
| Avalanche | 43114    | AVAX            | ✅     |
| Base      | 8453     | ETH             | ✅     |
| Scroll    | 534352   | ETH             | ✅     |
| Sophon    | 50104    | SOPH            | ✅     |
| Kaia      | 8217     | KAIA            | ✅     |
| BNB       | 56       | BNB             | ✅     |
| HyperEVM  | 999      | HYPE            | ✅     |

### Testnet Chains

| Network          | Chain ID | Native Currency | Status |
| ---------------- | -------- | --------------- | ------ |
| Optimism Sepolia | 11155420 | ETH             | ✅     |
| Polygon Amoy     | 80002    | MATIC           | ✅     |
| Arbitrum Sepolia | 421614   | ETH             | ✅     |
| Base Sepolia     | 84532    | ETH             | ✅     |
| Sepolia          | 11155111 | ETH             | ✅     |
| Monad Testnet    | 10143    | MON             | ✅     |

### Supported Tokens

| Token | Name       | Decimals | Networks       |
| ----- | ---------- | -------- | -------------- |
| ETH   | Ethereum   | 18       | All EVM chains |
| USDC  | USD Coin   | 6        | All supported  |
| USDT  | Tether USD | 6        | All supported  |

## 🔗 Links

- [GitHub Repository](https://github.com/availproject/nexus-sdk)
- [API Documentation](https://docs.availproject.org/api-reference/avail-nexus-sdk)
