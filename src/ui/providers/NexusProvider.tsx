'use client';
import React from 'react';
import { InternalNexusProvider } from './InternalNexusProvider';
import { NexusNetwork } from '../../types';
import { logger } from '../../core/utils';

const NexusProvider = ({
  config,
  children,
  disableCollapse,
}: {
  config?: { network?: NexusNetwork; debug?: boolean };
  children: React.ReactNode;
  disableCollapse?: boolean;
}) => {
  logger.debug('NexusProvider', { config });
  return (
    <InternalNexusProvider config={config} disableCollapse={disableCollapse}>
      {children}
    </InternalNexusProvider>
  );
};

export default NexusProvider;
