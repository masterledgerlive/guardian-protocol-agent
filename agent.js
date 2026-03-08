import { CdpClient } from "@coinbase/cdp-sdk";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  console.log("GUARDIAN V4 STARTING...");
  console.log("KEY ID:", process.env.CDP_API_KEY_ID ? "YES" : "NO");
  console.log("KEY SECRET:", process.env.CDP_API_KEY_SECRET ? "YES" : "NO");
  console.log("WALLET SECRET:", process.env.CDP_WALLET_SECRET ? "YES" : "NO");
  console.log("ANTHROPIC:", process.env.ANTHROPIC_API_KEY ? "YES" : "NO");

  const cdp = new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET?.replace(/\\n/g, '\n'),
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  const account = await cdp.evm.getOrCreateAccount({ name: "GuardianWallet" });
  console.log("WALLET ADDRESS:", account.address);

  await cdp.evm.requestFaucet({
    address: account.address,
    token: "eth",
    network: "base-sepolia"
  });
  console.log("FAUCET: Testnet ETH requested!");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 100,
    messages: [{ role: "user", content: "Say: GUARDIAN WALLET IS LIVE ONCHAIN" }]
  });
  console.log("AI:", message.content[0].text);
  console.log("DONE.");
}

main().catch(console.error);
