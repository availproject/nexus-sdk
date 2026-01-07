import { type BridgeStepType, CHAIN_METADATA } from '@avail-project/nexus-core';
import { NexusData, bridgeParams } from './nexus';

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

export async function mainScreen(data: NexusData, onButtonClick: () => {}) {
  const app = document.getElementById('app')!;
  purgeApp();

  // Simulation Result
  {
    const sr = data.simulationResult;
    const pre = document.createElement('pre');
    pre.textContent = 'Simulation Result:';
    pre.textContent += '\n\tToken:';
    pre.textContent += '\n\t\tContract Address: ' + sr.token.contractAddress;
    pre.textContent += '\n\t\tName: ' + sr.token.name;
    pre.textContent += '\n\t\tSymbol: ' + sr.token.symbol;
    pre.textContent += '\n\t\tDecimals: ' + sr.token.decimals;
    pre.textContent += '\n\tIntent:';
    pre.textContent += '\n\t\tSource Count: ' + sr.intent.sources.length;
    pre.textContent += '\n\t\tDestination Amount: ' + sr.intent.destination.amount;
    pre.textContent += '\n\t\tFees Total: ' + sr.intent.fees.total;
    pre.textContent += '\n\t\tTotal: ' + sr.intent.sourcesTotal;
    app.appendChild(pre);
  }

  // Balances
  {
    const pre = document.createElement('pre');
    pre.textContent = 'Balance List:';
    for (const balance of data.balances) {
      pre.textContent += '\n\t' + balance.symbol + ' Balance: ' + balance.balance;
      for (const breakdown of balance.breakdown) {
        pre.textContent += '\n\t\t' + breakdown.chain.name + ': ' + breakdown.balance;
      }
    }
    app.appendChild(pre);
  }

  // Transfer Information
  {
    const pre = document.createElement('pre');
    pre.textContent = 'Bridge Information:';
    pre.textContent +=
      '\n\tAmount: ' + +bridgeParams.amount.toString() / 1_000_000 + ' ' + bridgeParams.token;
    pre.textContent += '\n\tRecipient: ' + bridgeParams.recipient;
    pre.textContent += '\n\tTo Chain: ' + CHAIN_METADATA[bridgeParams.toChainId].name;
    pre.textContent +=
      '\n\tMax Bridge Amount: ' + data.bridgeMaxResult.amount + ' ' + bridgeParams.token;
    app.appendChild(pre);
  }

  const button = document.createElement('button');
  button.textContent = 'Execute Bridge call';
  button.onclick = onButtonClick;
  app.appendChild(button);
}

export function bridgeScreen(step: BridgeStepType) {
  const app = document.getElementById('app')!;
  purgeApp();

  const label = document.createElement('p');
  label.textContent = 'Bridge Completed Step: ' + step.type;
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
