import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useExecutionProgress } from '../src/hooks/useExecutionProgress';

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as const;

it('preserves the execute transaction link once when completion uses a step event', () => {
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  let snapshot: ReturnType<typeof useExecutionProgress>['state'] = null;
  const step = {
    id: 'destination-execute', type: 'execute_transaction',
    chain: { id: 8453, name: 'Base', logo: '' }, to: ACCOUNT,
  };
  const completion = {
    type: 'step', step, state: 'completed',
    txHash: '0x1234', explorerUrl: 'https://explorer.test/tx/0x1234',
  };
  const Probe = () => {
    const progress = useExecutionProgress('swapAndExecute');
    if (!progress.state) {
      progress.openModal();
      progress.handleEvent({ type: 'step', step, state: 'started' });
      progress.handleEvent({ type: 'status', status: 'fulfilled' });
      progress.handleEvent(completion);
      progress.handleEvent(completion);
      progress.handleEvent({ type: 'status', status: 'completed' });
      frame?.(0);
    } else {
      snapshot = progress.state;
    }
    return null;
  };
  try {
    renderToStaticMarkup(createElement(Probe));
    expect(snapshot).toMatchObject({
      phase: 'completed',
      steps: [{ id: step.id, state: 'done', txHash: completion.txHash,
        explorerUrl: completion.explorerUrl, completedAt: expect.any(Number) }],
      resultLinks: [{ label: 'Execute on Base', href: completion.explorerUrl }],
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
