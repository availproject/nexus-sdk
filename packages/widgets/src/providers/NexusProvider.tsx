'use client';
import React from 'react';
import { InternalNexusProvider } from './InternalNexusProvider';
import { type NexusNetwork, logger } from '@nexus/commons';

const NexusProvider = ({
  config,
  children,
}: {
  config?: { network?: NexusNetwork; debug?: boolean };
  children: React.ReactNode;
}) => {
  logger.debug('NexusProvider', { config });
  return (
    <InternalNexusProvider config={config} disableCollapse={false}>
      {children}
    </InternalNexusProvider>
  );
};

export default NexusProvider;
