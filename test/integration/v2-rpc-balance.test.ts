import { execSync } from 'child_process';
import { unpack } from 'msgpackr';

const CONFIG = {
  rpcs: {
    eth: 'http://localhost:8545',
    arb: 'http://localhost:8546',
    base: 'http://localhost:8547',
    poly: 'http://localhost:8548',
  },
  vsc: 'https://vsc-mainnet.availproject.org',
  testAccount: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  usdcWhale: '0x47c031236e19d024b42f8AE6780E44A573170703',
  arbUsdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
};

function cast(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

async function checkRpc(name: string, url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
    });
    const data = await res.json();
    console.log(`${name}: chainId=${parseInt(data.result, 16)}`);
    return true;
  } catch {
    console.log(`${name}: FAILED`);
    return false;
  }
}

async function fetchVscBalance(address: string) {
  const res = await fetch(`${CONFIG.vsc}/api/v1/get-balance/ETHEREUM/${address}`, {
    headers: { Accept: 'application/msgpack' },
  });
  const buffer = await res.arrayBuffer();
  return unpack(new Uint8Array(buffer));
}

function bytesToNumber(bytes: Uint8Array): number {
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return Number(BigInt(hex));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '0x';
  for (const b of bytes.slice(-20)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

async function run() {
  console.log('=== RPC Health Check ===\n');

  for (const [name, url] of Object.entries(CONFIG.rpcs)) {
    await checkRpc(name, url);
  }

  console.log('\n=== Fund Test Account via Cast ===\n');

  try {
    const balanceBefore = cast(`cast balance ${CONFIG.testAccount} --rpc-url ${CONFIG.rpcs.arb}`);
    console.log(`ETH balance before: ${balanceBefore}`);

    cast(`cast send ${CONFIG.testAccount} --value 10ether --rpc-url ${CONFIG.rpcs.arb} --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`);

    const balanceAfter = cast(`cast balance ${CONFIG.testAccount} --rpc-url ${CONFIG.rpcs.arb}`);
    console.log(`ETH balance after: ${balanceAfter}`);
  } catch (e) {
    console.log('Cast funding failed:', e);
  }

  console.log('\n=== VSC Balance API Response ===\n');

  try {
    const data = await fetchVscBalance(CONFIG.testAccount);
    console.log(`Total chains: ${data.balances.length}\n`);

    for (const bal of data.balances.slice(0, 3)) {
      const chainId = bytesToNumber(bal.chain_id);
      console.log(`Chain ${chainId}:`);
      console.log(`  universe: ${bal.universe}`);
      console.log(`  total_usd: ${bal.total_usd}`);
      console.log(`  errored: ${bal.errored}`);
      console.log(`  currencies: ${bal.currencies.length}`);

      for (const c of bal.currencies.slice(0, 2)) {
        console.log(`    - ${bytesToHex(c.token_address)}: ${c.balance} ($${c.value})`);
      }
      console.log('');
    }
  } catch (e) {
    console.log('VSC fetch failed:', e);
  }

  console.log('=== Done ===');
}

run();
