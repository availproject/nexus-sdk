import { describe, expect, it } from 'vitest';
import { createChainList } from '../../src/services/chain-list';
import { testChains } from '../fixtures/chains';

describe('createChainList execution flags', () => {
  it.each([true, false, undefined])('preserves flags set to %s', (value) => {
    const list = createChainList([{ ...testChains[0], eip7702Enabled: value, swapSupported: value }]);
    expect(list.getChainByID(1).supports7702).toBe(value);
    expect(list.getChainByID(1).swapSupported).toBe(value);
  });

  it('copies the configured Calibur capability onto the runtime Chain', () => {
    const deployment = hyperEvmDeployment(true);
    Object.assign(deployment.chains[0], {
      supports7702: true,
      caliburAddress: '0x00000000000000000000000000000000000000cc',
    });

    const chain = createChainList(deployment).getChainByID(999);

    expect(chain).toMatchObject({
      swapSupported: true,
      supports7702: true,
      caliburAddress: '0x00000000000000000000000000000000000000cc',
    });
  });
});
