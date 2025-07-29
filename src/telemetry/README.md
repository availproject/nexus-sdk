# Nexus SDK Telemetry System

A comprehensive telemetry and analytics system for the Nexus SDK, designed to track user interactions, performance metrics, and system events with privacy-first principles.

## Features

### 🎯 **Comprehensive Event Tracking**
- **SDK Lifecycle Events**: Initialization, errors, user connections
- **Transaction Events**: Bridge, transfer, execute operations
- **User Interaction Events**: UI interactions, button clicks, form submissions
- **Performance Events**: Response times, gas estimates, balance checks
- **Error Events**: Detailed error tracking with context
- **Network Events**: API calls, response times, status codes
- **Wallet Events**: Connection, disconnection, switching

### 🔒 **Privacy-First Design**
- **Configurable Privacy Settings**: Granular control over what data is collected
- **Data Anonymization**: Optional masking of addresses and balances
- **Consent Management**: User consent tracking and management
- **Local Storage**: Events cached locally before transmission
- **Secure Transmission**: HTTPS and API key authentication

### ⚡ **High Performance**
- **Event Batching**: Efficient batching of events for optimal performance
- **Priority-Based Sending**: Critical events sent immediately, others batched
- **Retry Logic**: Exponential backoff for failed transmissions
- **Page Unload Handling**: Beacon API for reliable event transmission
- **Storage Fallbacks**: Multiple storage options (localStorage, sessionStorage, IndexedDB)

### 🛠 **Developer Experience**
- **Fluent API**: Chainable event builder for easy event creation
- **Type Safety**: Full TypeScript support with comprehensive types
- **Debug Mode**: Console logging for development and debugging
- **Custom Events**: Support for custom event types and data
- **Hooks System**: Lifecycle hooks for event processing

## Quick Start

### Basic Usage

```typescript
import { NexusSDK } from '@avail-project/nexus';

// Initialize SDK with telemetry enabled
const sdk = new NexusSDK({
  network: 'mainnet',
  telemetry: {
    enabled: true,
    endpoint: 'https://telemetry.availproject.co',
    apiKey: 'your-api-key',
    environment: 'production',
  },
});

// Telemetry is automatically tracked for all SDK operations
await sdk.initialize(provider);
await sdk.bridge({ token: 'ETH', amount: '0.1', chainId: 1 });
```

### Advanced Configuration

```typescript
const sdk = new NexusSDK({
  telemetry: {
    enabled: true,
    endpoint: 'https://telemetry.availproject.co',
    apiKey: 'your-api-key',
    environment: 'production',
    version: '1.0.0',
    sampleRate: 0.1, // Only track 10% of events
    batchSize: 20,
    batchTimeout: 3000,
    privacySettings: {
      trackUserInteractions: true,
      trackTransactions: true,
      trackErrors: true,
      trackPerformance: true,
      anonymizeData: false,
      maskAddresses: true,
      maskBalances: false,
    },
    filters: {
      includeEvents: ['bridge_initiated', 'bridge_completed', 'error_occurred'],
      minSeverity: 'warn',
    },
    hooks: {
      onEventCreated: (event) => console.log('Event created:', event),
      onEventSent: (event, response) => console.log('Event sent:', response),
      onEventFailed: (event, error) => console.error('Event failed:', error),
    },
  },
});
```

### Custom Event Tracking

```typescript
// Track custom events
sdk.trackEvent('custom_feature_used', {
  feature: 'advanced_bridge',
  userType: 'power_user',
  customData: 'value',
});

// Use the fluent API
const telemetry = sdk.getTelemetryClient();
telemetry.track('ui_interaction', {
  component: 'bridge_form',
  action: 'submit',
  data: { amount: '0.1', token: 'ETH' },
});
```

## Event Types

### SDK Lifecycle Events
- `sdk_initialized` - SDK initialization
- `sdk_error` - SDK errors
- `user_connected` - User wallet connection
- `user_disconnected` - User wallet disconnection

### Transaction Events
- `transaction_started` - Transaction initiation
- `transaction_completed` - Transaction completion
- `transaction_failed` - Transaction failure
- `transaction_simulated` - Transaction simulation

### Bridge Events
- `bridge_initiated` - Bridge operation start
- `bridge_completed` - Bridge operation success
- `bridge_failed` - Bridge operation failure

### Transfer Events
- `transfer_initiated` - Transfer operation start
- `transfer_completed` - Transfer operation success
- `transfer_failed` - Transfer operation failure

### Execute Events
- `execute_initiated` - Execute operation start
- `execute_completed` - Execute operation success
- `execute_failed` - Execute operation failure

### Approval Events
- `approval_requested` - Token approval request
- `approval_granted` - Token approval granted
- `approval_denied` - Token approval denied

### UI Events
- `ui_component_rendered` - Component rendering
- `ui_interaction` - User interactions
- `button_clicked` - Button clicks
- `form_submitted` - Form submissions
- `modal_opened` - Modal opening
- `modal_closed` - Modal closing

### Performance Events
- `performance_metric` - Performance measurements
- `balance_checked` - Balance check operations
- `gas_estimated` - Gas estimation operations
- `simulation_requested` - Simulation requests

### Network Events
- `network_request` - Network requests
- `network_response` - Network responses
- `cache_hit` - Cache hits
- `cache_miss` - Cache misses

### Error Events
- `error_occurred` - General errors
- `validation_error` - Validation errors
- `timeout_occurred` - Timeout errors
- `rate_limit_hit` - Rate limiting

### Wallet Events
- `wallet_connected` - Wallet connection
- `wallet_disconnected` - Wallet disconnection
- `wallet_switched` - Wallet switching

### Privacy Events
- `analytics_consent_changed` - Analytics consent changes
- `privacy_settings_changed` - Privacy settings changes
- `telemetry_enabled` - Telemetry enabled
- `telemetry_disabled` - Telemetry disabled

## Configuration Options

### Basic Configuration
```typescript
interface TelemetryConfig {
  enabled: boolean;                    // Enable/disable telemetry
  endpoint?: string;                   // Telemetry server endpoint
  apiKey?: string;                     // API key for authentication
  projectId?: string;                  // Project identifier
  environment: 'development' | 'staging' | 'production';
  version: string;                     // SDK version
  sessionId: string;                   // Session identifier
  userId?: string;                     // User identifier
  walletAddress?: string;              // Wallet address
  chainId?: number;                    // Chain identifier
  network?: 'mainnet' | 'testnet';     // Network type
}
```

### Performance Configuration
```typescript
{
  sampleRate?: number;                 // Event sampling rate (0-1)
  batchSize?: number;                  // Events per batch
  batchTimeout?: number;               // Batch timeout (ms)
  maxRetries?: number;                 // Maximum retry attempts
  retryDelay?: number;                 // Retry delay (ms)
  timeout?: number;                    // Request timeout (ms)
}
```

### Privacy Configuration
```typescript
{
  privacySettings?: {
    trackUserInteractions?: boolean;   // Track UI interactions
    trackTransactions?: boolean;       // Track transactions
    trackErrors?: boolean;             // Track errors
    trackPerformance?: boolean;        // Track performance
    trackNetwork?: boolean;            // Track network calls
    trackWallet?: boolean;             // Track wallet events
    trackUI?: boolean;                 // Track UI events
    anonymizeData?: boolean;           // Anonymize data
    maskAddresses?: boolean;           // Mask addresses
    maskBalances?: boolean;            // Mask balances
  };
}
```

### Filtering Configuration
```typescript
{
  filters?: {
    includeEvents?: TelemetryEventType[];    // Include specific events
    excludeEvents?: TelemetryEventType[];    // Exclude specific events
    includeCategories?: TelemetryCategory[]; // Include categories
    excludeCategories?: TelemetryCategory[]; // Exclude categories
    minSeverity?: TelemetrySeverity;         // Minimum severity level
  };
}
```

## Storage Options

The telemetry system supports multiple storage backends:

### LocalStorage
```typescript
// Default storage for web environments
const storage = new LocalStorageAdapter('nexus_telemetry_');
```

### SessionStorage
```typescript
// Session-based storage
const storage = new SessionStorageAdapter('nexus_telemetry_');
```

### IndexedDB
```typescript
// Persistent storage for large datasets
const storage = new IndexedDBAdapter('nexus_telemetry', 'events');
```

### Memory Storage
```typescript
// In-memory storage for testing
const storage = new MemoryStorageAdapter();
```

### Multi-Level Storage
```typescript
// Fallback storage with multiple backends
const storage = new MultiLevelStorageAdapter([
  'localStorage',
  'sessionStorage',
  'memory'
]);
```

## Transport Options

### HTTP Transport
```typescript
const transport = new HTTPTransport({
  endpoint: 'https://telemetry.availproject.co',
  apiKey: 'your-api-key',
  timeout: 10000,
  maxRetries: 3,
  retryDelay: 1000,
});
```

### Beacon Transport
```typescript
// For reliable page unload events
const transport = new BeaconTransport({
  endpoint: 'https://telemetry.availproject.co',
  apiKey: 'your-api-key',
});
```

### Console Transport
```typescript
// For debugging and development
const transport = new ConsoleTransport('[Nexus Telemetry]');
```

### Multi-Transport
```typescript
// Multiple transport fallbacks
const transport = new MultiTransport([
  httpTransport,
  beaconTransport,
  consoleTransport
]);
```

## Event Builder API

### Fluent API Usage
```typescript
const event = createEventBuilder({
  sessionId: 'sess_123',
  version: '1.0.0',
  environment: 'production',
  userId: 'user_123',
  walletAddress: '0x123...',
  chainId: 1,
  network: 'mainnet',
})
  .setType('custom_event')
  .setCategory('analytics')
  .setSeverity('info')
  .setData({ customField: 'value' })
  .addMetadata('source', 'user_action')
  .addTag('important')
  .setCorrelationId('corr_123')
  .build();
```

### Pre-built Event Builders
```typescript
const builders = createEventBuilders(config);

// User interaction
builders.userInteraction('bridge_form', 'submit', {
  amount: '0.1',
  token: 'ETH',
});

// Transaction
builders.transaction('transaction_completed', {
  hash: '0x123...',
  gasUsed: '21000',
  status: 'success',
});

// Performance
builders.performance('api_call', 150, 'ms');

// Error
builders.error(new Error('Something went wrong'), {
  context: 'bridge_operation',
  userAction: 'submitted_form',
});
```

## Privacy and Compliance

### GDPR Compliance
- **Data Minimization**: Only collect necessary data
- **User Consent**: Track and respect user consent
- **Right to Deletion**: Support for data deletion
- **Data Portability**: Export user data
- **Transparency**: Clear data collection policies

### Data Anonymization
```typescript
// Enable data anonymization
sdk.getTelemetryClient().setPrivacySettings({
  anonymizeData: true,
  maskAddresses: true,
  maskBalances: true,
});
```

### Consent Management
```typescript
// Set user consent
sdk.getTelemetryClient().setTelemetryConsent(true);
sdk.getTelemetryClient().setAnalyticsConsent(true);
```

## Performance Optimization

### Event Sampling
```typescript
// Sample only 10% of events in production
const config = {
  sampleRate: 0.1,
  environment: 'production',
};
```

### Event Filtering
```typescript
// Only track critical events
const config = {
  filters: {
    includeEvents: [
      'sdk_error',
      'transaction_failed',
      'bridge_failed',
      'error_occurred',
    ],
    minSeverity: 'warn',
  },
};
```

### Batch Optimization
```typescript
// Optimize for performance
const config = {
  batchSize: 50,        // Larger batches
  batchTimeout: 2000,   // Shorter timeout
  maxRetries: 2,        // Fewer retries
};
```

## Error Handling

### Automatic Error Tracking
```typescript
// Errors are automatically tracked
try {
  await sdk.bridge(params);
} catch (error) {
  // Error is automatically tracked with context
  throw error;
}
```

### Custom Error Tracking
```typescript
// Track custom errors
sdk.getTelemetryClient().trackError(new Error('Custom error'), {
  context: 'custom_operation',
  userAction: 'button_click',
  additionalData: 'value',
});
```

## Development and Debugging

### Debug Mode
```typescript
const sdk = new NexusSDK({
  debug: true,
  telemetry: {
    enableDebug: true,
    enableConsole: true,
  },
});
```

### Console Logging
```typescript
// Events are logged to console in debug mode
[DEBUG] Event: bridge_initiated
[INFO] Event: bridge_completed
[ERROR] Event: bridge_failed
```

### Custom Hooks
```typescript
const config = {
  hooks: {
    onEventCreated: (event) => {
      console.log('Event created:', event);
    },
    onEventSent: (event, response) => {
      console.log('Event sent:', response);
    },
    onEventFailed: (event, error) => {
      console.error('Event failed:', error);
    },
  },
};
```

## Best Practices

### 1. **Privacy First**
- Always respect user privacy preferences
- Implement proper consent management
- Use data anonymization when possible
- Follow GDPR and other privacy regulations

### 2. **Performance Optimization**
- Use appropriate sampling rates
- Implement event filtering
- Optimize batch sizes and timeouts
- Monitor telemetry system performance

### 3. **Error Handling**
- Track all errors with proper context
- Implement retry logic for failed events
- Use appropriate error severity levels
- Monitor error rates and patterns

### 4. **Data Quality**
- Validate event data before sending
- Use consistent event naming conventions
- Include relevant context in events
- Monitor data quality metrics

### 5. **Security**
- Use HTTPS for all transmissions
- Implement proper API key management
- Sanitize sensitive data
- Monitor for security issues

## Troubleshooting

### Common Issues

#### Events Not Being Sent
```typescript
// Check if telemetry is enabled
if (sdk.getTelemetryClient().isEnabled()) {
  console.log('Telemetry is enabled');
} else {
  console.log('Telemetry is disabled');
}

// Check network connectivity
const isHealthy = await sdk.getTelemetryClient().healthCheck();
console.log('Telemetry health:', isHealthy);
```

#### Performance Issues
```typescript
// Reduce event volume
const config = {
  sampleRate: 0.1,        // Sample 10% of events
  batchSize: 100,         // Increase batch size
  batchTimeout: 1000,     // Reduce timeout
};
```

#### Privacy Concerns
```typescript
// Enable privacy features
sdk.getTelemetryClient().setPrivacySettings({
  anonymizeData: true,
  maskAddresses: true,
  maskBalances: true,
  trackUserInteractions: false,
});
```

## API Reference

### TelemetryClient Interface
```typescript
interface TelemetryClient {
  // Configuration
  configure(config: TelemetryConfig): void;
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
  
  // Event tracking
  track(eventType: TelemetryEventType, data?: Record<string, unknown>): void;
  trackUserInteraction(component: string, action: string, data?: Partial<UserInteractionData>): void;
  trackTransaction(transactionData: Partial<TransactionData>): void;
  trackBridge(bridgeData: Partial<BridgeData>): void;
  trackError(error: Error, context?: Record<string, unknown>): void;
  trackPerformance(metric: string, value: number, unit?: string): void;
  trackNetwork(url: string, method: string, responseTime: number, statusCode?: number): void;
  trackWallet(walletData: Partial<WalletData>): void;
  trackUI(uiData: Partial<UIData>): void;
  
  // Session management
  setSessionId(sessionId: string): void;
  setUserId(userId: string): void;
  setWalletAddress(address: string): void;
  setChainId(chainId: number): void;
  setNetwork(network: 'mainnet' | 'testnet'): void;
  
  // Privacy and consent
  setPrivacySettings(settings: Partial<TelemetryConfig['privacySettings']>): void;
  setAnalyticsConsent(consent: boolean): void;
  setTelemetryConsent(consent: boolean): void;
  
  // Batching and flushing
  flush(): Promise<void>;
  flushImmediate(): Promise<void>;
  
  // Utility methods
  generateEventId(): string;
  generateSessionId(): string;
  getSessionId(): string;
  getUserId(): string | undefined;
  getWalletAddress(): string | undefined;
  getChainId(): number | undefined;
  getNetwork(): 'mainnet' | 'testnet' | undefined;
  
  // Cleanup
  destroy(): Promise<void>;
}
```

## Contributing

When contributing to the telemetry system:

1. **Follow Privacy Guidelines**: Always consider privacy implications
2. **Add Tests**: Include comprehensive tests for new features
3. **Update Documentation**: Keep documentation current
4. **Performance Testing**: Test performance impact of changes
5. **Security Review**: Ensure security best practices

## License

This telemetry system is part of the Nexus SDK and follows the same licensing terms. 