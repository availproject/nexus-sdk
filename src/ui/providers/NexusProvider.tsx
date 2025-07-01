import React from 'react';
import { InternalNexusProvider } from './InternalNexusProvider';
import { SDKConfig } from '../../types';

const NexusProvider = ({ config, children }: { config?: SDKConfig; children: React.ReactNode }) => {
  return (
    <InternalNexusProvider config={config ?? { network: 'mainnet' }}>
      {children}
    </InternalNexusProvider>
  );
};

export default NexusProvider;
