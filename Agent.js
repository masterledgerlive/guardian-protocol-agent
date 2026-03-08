require("dotenv").config();
const { CdpAgentkit } = require("@coinbase/cdp-agentkit-core");
const { CdpToolkit } = require("@coinbase/cdp-langchain");
const { HumanMessage } = require("@langchain/core/messages");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { ChatAnthropic } = require("@langchain/anthropic");
const fs = require("fs");

const WALLET_FILE = "/tmp/wallet.json";

async function main() {
  console.log("Guardian Protocol Agent Starting...");

  let walletData;
  if (fs.existsSync(WALLET_FILE)) {
    walletData = fs.readFileSync(WALLET_FILE, "utf8");
    console.log("Loaded existing wallet.");
  }

  const llm = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const agentkit = await CdpAgentkit.configureWithWallet({
    cdpApiKeyName: process.env.CDP_API_KEY_NAME,
    cdpApiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
    networkId: "base-sepolia",
    walletData: walletData,
  });

  const exported = await agentkit.exportWallet();
  fs.writeFileSync(WALLET_FILE, exported);
  console.log("Wallet saved.");

  const tools = new CdpToolkit(agentkit).getTools();
  const agent = createReactAgent({ llm, tools });

  const r1 = await agent.invoke({ messages: [new HumanMessage("What is my wallet address?")] });
  console.log("WALLET:", r1.messages[r1.messages.length - 1].content);

  const r2 = await agent.invoke({ messages: [new HumanMessage("What is my ETH balance on base-sepolia?")] });
  console.log("BALANCE:", r2.messages[r2.messages.length - 1].content);

  console.log("DONE.");
}
main().catch(console.error);
