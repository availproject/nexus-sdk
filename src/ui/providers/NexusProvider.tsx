import React from 'react';
import { InternalNexusProvider } from './InternalNexusProvider';
import { NexusNetwork } from '../../types';
import { logger } from '../../utils';

const NexusProvider = ({
  config,
  children,
}: {
  config?: { network: NexusNetwork; debug?: boolean };
  children: React.ReactNode;
}) => {
  logger.debug('NexusProvider', { config });
  return (
    <InternalNexusProvider config={config ?? { network: 'mainnet' }}>
      {children}
    </InternalNexusProvider>
  );
};

export default NexusProvider;
