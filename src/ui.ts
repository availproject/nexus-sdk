// UI SDK entry point - React components and providers
// Import styles first to ensure they're bundled
import './ui/styles/globals.css';

// Add debug info to console to verify CSS is loading
if (typeof window !== 'undefined') {
  console.log('🎨 Nexus UI styles loading...');
}

export { default as NexusProvider } from './ui/providers/NexusProvider';
export { default as useNexus } from './ui/hooks/useNexus';

// Button components (named exports)
export { BridgeButton } from './ui/components/bridge/bridge-button';
export { TransferButton } from './ui/components/transfer/transfer-button';
export { BridgeAndExecuteButton } from './ui/components/bridge-execute/bridge-execute-button';
