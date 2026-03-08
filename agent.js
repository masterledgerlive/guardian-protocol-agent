import { CdpClient } from "@coinbase/cdp-sdk";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  console.log("GUARDIAN V9 STARTING...");

  const cdp = new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  const account = await cdp.evm.getOrCreateAccount({ name: "GuardianWallet" });
  console.log("WALLET ADDRESS:", account.address);

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
