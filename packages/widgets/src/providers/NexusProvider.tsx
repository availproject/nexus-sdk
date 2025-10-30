'use client';
import React, { useEffect } from 'react';
import { InternalNexusProvider } from './InternalNexusProvider';
import { type NexusNetwork, logger } from '@nexus/commons';
import { initAnalytics, trackEvent } from '../utils/analytics';

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

    trackEvent('sdk_initialized', {
      version: '0.0.6',
      package: 'nexus-widgets',
      network: config?.network || 'mainnet',
      debug: config?.debug || false,
    });
  }, [config?.network, config?.debug]);

  return (
    <InternalNexusProvider config={config} disableCollapse={false}>
      {children}
    </InternalNexusProvider>
  );
};

export default NexusProvider;
