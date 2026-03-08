import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  console.log("GUARDIAN V10 STARTING...");

  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
  });

  const balance = await publicClient.getBalance({
    address: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
  });

  console.log("WALLET BALANCE:", formatEther(balance), "ETH");
  console.log("DONE.");
}

main().catch(console.error);
