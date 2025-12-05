declare global {
  // biome-ignore lint/style/noNamespace: Augmenting NodeJS global namespace
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: string;
      [key: string]: string | undefined;
    }

    interface Process {
      env: ProcessEnv;
    }
  }

  // Override the built-in globalThis declaration
  interface Window {
    Buffer?: typeof import('buffer').Buffer;
    process?: NodeJS.Process;
  }

  var Buffer: typeof import('buffer').Buffer;
  var process: NodeJS.Process;
}

export {};
