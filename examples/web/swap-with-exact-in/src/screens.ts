import {
  CHAIN_METADATA,
  TOKEN_CONTRACT_ADDRESSES,
  TOKEN_METADATA,
  type SwapStepType,
  type TokenMetadata,
  type UserAssetDatum,
} from '@avail-project/nexus-core';
import { swapParams } from './nexus';

export function loadingScreen() {
  const app = document.getElementById('app')!;
  purgeApp();

  const label = document.createElement('label');
  label.textContent = ':spinner:';
  app.appendChild(label);
}

export function errorScreen(error: string) {
  const app = document.getElementById('app')!;
  purgeApp();

  const label = document.createElement('label');
  label.textContent = error;
  app.appendChild(label);
}

export async function mainScreen(balances: UserAssetDatum[], onButtonClick: () => {}) {
  const app = document.getElementById('app')!;
  purgeApp();

  // Balances
  {
    const pre = document.createElement('pre');
    pre.textContent = 'Balance to swap List:';
    for (const balance of balances) {
      pre.textContent += '\n\t' + balance.symbol + ' Balance: ' + balance.balance;
      for (const breakdown of balance.breakdown) {
        pre.textContent += '\n\t\t' + breakdown.chain.name + ': ' + breakdown.balance;
      }
    }
    app.appendChild(pre);
  }

  // Swap Information
  {
    const pre = document.createElement('pre');
    pre.textContent = 'Swap Information:';
    pre.textContent += '\n\tFrom:';
    for (const from of swapParams.from) {
      pre.textContent +=
        '\n\t\tAmount: ' +
        +from.amount.toString() / 1_000_000 +
        ' ' +
        findTokenMetadata(from.tokenAddress)?.symbol;
      pre.textContent += '\n\t\tChain: ' + CHAIN_METADATA[from.chainId].name;
    }
    pre.textContent += '\n\tTo Chain: ' + CHAIN_METADATA[swapParams.toChainId].name;
    pre.textContent += '\n\tToken Symbol: ' + findTokenMetadata(swapParams.toTokenAddress)?.symbol;
    console.log({ a: TOKEN_METADATA });
    app.appendChild(pre);
  }

  const button = document.createElement('button');
  button.textContent = 'Swap';
  button.onclick = onButtonClick;
  app.appendChild(button);
}

export function swapScreen(step: SwapStepType) {
  const app = document.getElementById('app')!;
  purgeApp();

  const label = document.createElement('p');
  label.textContent = 'Swap with Exact In Completed Step: ' + step.type;
  app.appendChild(label);
}

function purgeApp() {
  const app = document.getElementById('app')!;

  while (true) {
    const lastChild = app.lastChild;
    if (lastChild == null) {
      return;
    }
    app.removeChild(lastChild);
  }
}

function findTokenMetadata(tokenAddress: string): TokenMetadata | undefined {
  for (const [_, value] of Object.entries(TOKEN_CONTRACT_ADDRESSES.USDC)) {
    if (value == tokenAddress) {
      return TOKEN_METADATA['USDC'];
    }
  }

  for (const [_, value] of Object.entries(TOKEN_CONTRACT_ADDRESSES.USDT)) {
    if (value == tokenAddress) {
      return TOKEN_METADATA['USDT'];
    }
  }

  return undefined;
}
