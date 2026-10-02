import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useExecutionProgress } from '../src/hooks/useExecutionProgress';
import type { ExecutionProgressState, OperationResult } from '../src/lib/types';

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

it.each([
  { name: 'exact input', operationType: 'swap', requested: '$20.00', funding: undefined,
    received: '0.012345678901234567', intentUrl: 'https://intent.test/rff/exact-in' },
  { name: 'exact output', operationType: 'swap', requested: '10', funding: undefined,
    received: '10.000001', intentUrl: 'https://intent.test/rff/exact-out' },
  { name: 'funded deposit', operationType: 'swapAndExecute', requested: '10', funding: '2',
    received: '10', intentUrl: 'https://intent.test/rff/deposit' },
  { name: 'fully funded deposit', operationType: 'swapAndExecute', requested: '10', funding: undefined,
    received: '10', intentUrl: undefined },
] as const)('shows the returned destination amount and explorer links for $name', (testCase) => {
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  let snapshot: ExecutionProgressState | null = null;
  const deposit = testCase.operationType === 'swapAndExecute';
  const executeUrl = 'https://explorer.test/tx/0x1234';
  const destination = {
    type: 'destination' as const, chainId: 8453, chainName: 'Base',
    tokenSymbol: 'USDC', amount: testCase.received,
  };
  const result: OperationResult = {
    hashes: [
      ...(testCase.intentUrl ? [{ label: 'RFF Intent', value: '0xintent', href: testCase.intentUrl }] : []),
      ...(deposit ? [{ label: 'Deposit tx', value: '0x1234', href: executeUrl }] : []),
    ],
    richResult: {
      kind: 'swap', summary: '', intentExplorerUrl: testCase.intentUrl,
      route: [
        ...(testCase.funding ? [{ ...destination, amount: testCase.funding }] : []),
        destination,
      ],
    },
  };
  const Probe = () => {
    const progress = useExecutionProgress(testCase.operationType);
    if (!progress.state) {
      progress.openModal({
        sourceSymbols: 'USDC', amount: testCase.requested,
        destTokenSymbol: 'USDC', destChainName: 'Base',
      });
      progress.attachResult({ sourcesTotal: '20', feesTotal: '0.01' });
      progress.handleEvent({ type: 'status', status: 'fulfilled' });
      if (deposit) progress.handleEvent({
        type: 'step', state: 'completed', explorerUrl: executeUrl, txHash: '0x1234',
        step: { id: 'destination-execute', type: 'execute_transaction',
          chain: { id: 8453, name: 'Base', logo: '' }, to: ACCOUNT },
      });
      expect(progress).toHaveProperty('complete');
      progress.complete(result);
      progress.complete(result);
      frame?.(0);
    } else {
      snapshot = progress.state;
    }
    return null;
  };
  try {
    renderToStaticMarkup(createElement(Probe));
    expect(snapshot).toMatchObject({
      phase: 'completed', header: { amount: testCase.received, destTokenSymbol: 'USDC' },
      result: { sourcesTotal: '20', feesTotal: '0.01' },
      completedAt: expect.any(Number),
    });
    const links = (snapshot as ExecutionProgressState | null)?.resultLinks ?? [];
    expect(links.map((link) => link.href)).toEqual([
      ...(deposit ? [executeUrl] : []),
      ...(testCase.intentUrl ? [testCase.intentUrl] : []),
    ]);
    if (testCase.intentUrl) expect(links).toContainEqual({
      label: 'RFF Intent', href: testCase.intentUrl,
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
