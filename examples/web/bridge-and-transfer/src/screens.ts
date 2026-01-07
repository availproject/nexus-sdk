import { type BridgeStepType, CHAIN_METADATA } from '@avail-project/nexus-core';
import { NexusData, transferParams } from './nexus';

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
    const es = data.simulationResult.executeSimulation;
    const pre = document.createElement('pre');
    pre.textContent =
      'Execute Simulation:\n\tGas Fee: ' +
      es.gasFee +
      '\n\tGas Price: ' +
      es.gasPrice +
      '\n\tGas Used: ' +
      es.gasUsed;
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
    pre.textContent = 'Bridge and Transfer Information:';
    pre.textContent +=
      '\n\tAmount: ' + +transferParams.amount.toString() / 1_000_000 + ' ' + transferParams.token;
    pre.textContent += '\n\tRecipient: ' + transferParams.recipient;
    pre.textContent += '\n\tTo Chain: ' + CHAIN_METADATA[transferParams.toChainId].name;
    pre.textContent +=
      '\n\tMax Bridge Amount: ' + data.bridgeMaxResult.amount + ' ' + transferParams.token;
    app.appendChild(pre);
  }

  const button = document.createElement('button');
  button.textContent = 'Execute Bridge and Transfer call';
  button.onclick = onButtonClick;
  app.appendChild(button);
}

export function bridgeScreen(step: BridgeStepType) {
  const app = document.getElementById('app')!;
  purgeApp();

  const label = document.createElement('p');
  label.textContent = 'Bridge and Transfer Completed Step: ' + step.type;
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
