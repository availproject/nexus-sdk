// Simple test to verify the SDK can be imported and bundled with Vite
import { NexusSDK } from '@avail-project/nexus-core';

console.log('Testing Nexus SDK import with Vite');

// Verify the SDK exports are accessible
if (typeof NexusSDK !== 'undefined') {
  console.log('✅ NexusSDK successfully imported');
} else {
  throw new Error('❌ Failed to import NexusSDK');
}

export { NexusSDK };
