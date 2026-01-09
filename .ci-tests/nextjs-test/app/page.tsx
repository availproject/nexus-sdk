'use client';

// Simple test to verify the SDK can be imported and bundled with Next.js/Turbopack
import { NexusSDK } from '@avail-project/nexus-core';

export default function Home() {
  // Verify the SDK exports are accessible
  const sdkAvailable = typeof NexusSDK !== 'undefined';

  return (
    <main>
      <h1>Next.js/Turbopack Build Test</h1>
      <p>SDK Import Status: {sdkAvailable ? '✅ Success' : '❌ Failed'}</p>
    </main>
  );
}
