import axios from "axios";

const simulateTransaction = async (
  chainID: number,
  simulations: SimulationRequest[],
  baseURL: string,
) => {
  const url = new URL("/simulate", baseURL).toString();
  return await axios.post<SimulationResponse>(
    url,
    {
      chainID,
      simulations,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
};

type SimulationRequest = {
  from: `0x${string}`;
  input?: `0x${string}`;
  to: `0x${string}`;
  value?: `0x${string}`;
};

type SimulationResponse = {
  amount: string;
  gas: string;
  gas_used: string;
  token?: {
    contract_address: `0x${string}`;
    decimals: number;
    name: string;
    symbol: string;
    type: string;
  };
};

export { simulateTransaction, type SimulationRequest, type SimulationResponse };
