import { convertTo32BytesHex } from "../utils";

export const EADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const SWEEPER_ADDRESS = "0x000000002601b9e7c7c505799b32dd5c466dd056";
export const ZERO_BYTES_32 = new Uint8Array(32);
export const ZERO_BYTES_20 = new Uint8Array(20);
export const CALIBUR_ADDRESS = "0x00000000557A0daF2659cbb6A45f2beB6081e6AE";
export const CALIBUR_EIP712 = {
  name: "Calibur",
  salt: convertTo32BytesHex(CALIBUR_ADDRESS),
  version: "1.0.0",
} as const;
