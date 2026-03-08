require("dotenv").config();
const { CdpAgentkit } = require("@coinbase/cdp-agentkit-core");
const { CdpToolkit } = require("@coinbase/cdp-langchain");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { HumanMessage } = require("@langchain/core/messages");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

const WALLET_FILE = "/tmp/wallet.json";

async function main() {
  console.log("GUARDIAN V3 STARTING...");

  // Load saved wallet if exists
  let walletData;
  if (fs.existsSync(WALLET_FILE)) {
    walletData = fs.readFileSync(WALLET_FILE, "utf8");
    console.log("WALLET: Loaded existing wallet");
  } else {
    console.log("WALLET: Creating new wallet...");
  }

  const agentkit = await CdpAgentkit.configureWithWallet({
    cdpApiKeyName: process.env.CDP_API_KEY_NAME,
    cdpApiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
    networkId: "base-sepolia",
    walletData: walletData,
  });

  // Save wallet for next restart
  const exported = await agentkit.exportWallet();
  fs.writeFileSync(WALLET_FILE, exported);
  console.log("WALLET: Saved");

  const tools = new CdpToolkit(agentkit).getTools();
  
  // Use Anthropic directly to avoid top_p issue
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const walletAddress = await agentkit.wallet.getDefaultAddress();
  
  console.log("WALLET ADDRESS:", walletAddress.getId());
  console.log("NETWORK: base-sepolia");
  console.log("STATUS: Guardian Protocol wallet operational");
  console.log("DONE.");
}
main().catch(console.error);
