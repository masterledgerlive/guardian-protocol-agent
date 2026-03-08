require("dotenv").config();
const { CdpAgentkit } = require("@coinbase/cdp-agentkit-core");
const { CdpToolkit } = require("@coinbase/cdp-langchain");
const { HumanMessage } = require("@langchain/core/messages");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { ChatAnthropic } = require("@langchain/anthropic");

async function main() {
  console.log("Guardian Protocol Agent Starting...");
  const llm = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  const agentkit = await CdpAgentkit.configureWithWallet({
  walletData: process.env.WALLET_DATA || undefined,

    cdpApiKeyName: process.env.CDP_API_KEY_NAME,
    cdpApiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
    networkId: "base-sepolia",
  });
  const tools = new CdpToolkit(agentkit).getTools();
  const agent = createReactAgent({ llm, tools });
  const r1 = await agent.invoke({ messages: [new HumanMessage("What is my wallet address?")] });
  console.log("WALLET:", r1.messages[r1.messages.length - 1].content);
  const r2 = await agent.invoke({ messages: [new HumanMessage("What is my ETH balance on base-sepolia?")] });
  console.log("BALANCE:", r2.messages[r2.messages.length - 1].content);
  console.log("DONE.");
}
main().catch(console.error);
