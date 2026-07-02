import process from 'node:process';
import ansiEscapes from 'ansi-escapes';
import { render } from 'ink';
import App from './App';
import type { TuiController, TuiRunState } from './types';

export type TuiHandle = {
  rerender: (state: TuiRunState) => void;
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
};

export const startTui = (initialState: TuiRunState, controller: TuiController): TuiHandle => {
  if (process.stdout.isTTY) {
    process.stdout.write(ansiEscapes.enterAlternativeScreen);
    process.stdout.write(ansiEscapes.eraseScreen);
    process.stdout.write(ansiEscapes.cursorTo(0, 0));
    process.stdout.write(ansiEscapes.cursorHide);
  }
  const instance = render(<App state={initialState} controller={controller} />);
  const restoreTerminal = () => {
    if (!process.stdout.isTTY) return;
    process.stdout.write(ansiEscapes.cursorShow);
    process.stdout.write(ansiEscapes.exitAlternativeScreen);
  };
  return {
    rerender: (state) => instance.rerender(<App state={state} controller={controller} />),
    unmount: () => {
      instance.unmount();
      restoreTerminal();
    },
    waitUntilExit: async () => {
      try {
        await instance.waitUntilExit();
      } finally {
        restoreTerminal();
      }
    },
  };
};
