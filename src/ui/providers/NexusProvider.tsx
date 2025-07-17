import React from 'react';
import { InternalNexusProvider } from './InternalNexusProvider';
import { NexusNetwork } from '../../types';
import { logger } from '../../core/utils';

const NexusProvider = ({
  config,
  children,
}: {
  config?: { network?: NexusNetwork; debug?: boolean };
  children: React.ReactNode;
}) => {
  logger.debug('NexusProvider', { config });
  return <InternalNexusProvider config={config}>{children}</InternalNexusProvider>;
};

export default NexusProvider;
