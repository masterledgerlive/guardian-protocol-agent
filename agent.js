import { CdpClient } from "@coinbase/cdp-sdk";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  console.log("GUARDIAN V5 STARTING...");

  // Fix PEM key - Railway collapses newlines, so we rebuild them
  let apiKeySecret = process.env.CDP_API_KEY_SECRET || "";
  
  // If it looks like a PEM key but has no real newlines, reconstruct it
  if (apiKeySecret.includes("BEGIN") && !apiKeySecret.includes("\n")) {
    apiKeySecret = apiKeySecret
      .replace("-----BEGIN EC PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----\n")
      .replace("-----END EC PRIVATE KEY-----", "\n-----END EC PRIVATE KEY-----\n");
    // Now break the body into 64-char lines
    const match = apiKeySecret.match(/-----BEGIN EC PRIVATE KEY-----\n([\s\S]+?)\n-----END EC PRIVATE KEY-----/);
    if (match) {
      const body = match[1].replace(/\s/g, "");
      const lines = body.match(/.{1,64}/g).join("\n");
      apiKeySecret = `-----BEGIN EC PRIVATE KEY-----\n${lines}\n-----END EC PRIVATE KEY-----\n`;
    }
  }

  console.log("KEY FORMAT:", apiKeySecret.startsWith("-----") ? "PEM detected" : "non-PEM");

  const cdp = new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: apiKeySecret,
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
