'use client';
import React, { useEffect } from 'react';
import { InternalNexusProvider } from './InternalNexusProvider';
import { type NexusNetwork, logger } from '@nexus/commons';
import { initAnalytics } from '../utils/analytics';

const NexusProvider = ({
  config,
  children,
}: {
  config?: {
    network?: NexusNetwork;
    debug?: boolean;
  };
  children: React.ReactNode;
}) => {
  logger.debug('NexusProvider', { config });

  useEffect(() => {
    // Auto-initialize analytics with your credentials
    initAnalytics();
  }, [config?.network, config?.debug]);

  return (
    <InternalNexusProvider config={config} disableCollapse={false}>
      {children}
    </InternalNexusProvider>
  );
};

export default NexusProvider;
