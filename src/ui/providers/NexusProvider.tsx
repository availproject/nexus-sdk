import React from 'react';
import { InternalNexusProvider } from './InternalNexusProvider';
import { NexusNetwork } from '../../types';

const NexusProvider = ({
  config,
  children,
}: {
  config?: NexusNetwork;
  children: React.ReactNode;
}) => {
  return <InternalNexusProvider config={config ?? 'mainnet'}>{children}</InternalNexusProvider>;
};

export default NexusProvider;
