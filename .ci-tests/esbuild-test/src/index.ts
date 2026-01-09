// Simple test to verify the SDK can be imported and bundled with esbuild
import { NexusSDK } from '@avail-project/nexus-core';

console.log('Testing Nexus SDK import with esbuild');

// Verify the SDK exports are accessible
if (typeof NexusSDK !== 'undefined') {
  console.log('✅ NexusSDK successfully imported');
} else {
  throw new Error('❌ Failed to import NexusSDK');
}

export { NexusSDK };
