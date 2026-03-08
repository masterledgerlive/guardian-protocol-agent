const { CdpAgentkit } = require("@coinbase/cdp-agentkit-core");
const { CdpToolkit } = require("@coinbase/cdp-langchain");
const { HumanMessage } = require("@langchain/core/messages");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { ChatAnthropic } = require("@langchain/anthropic");
require("dotenv").config();

async function runGuardianAgent() {
  console.log("Guardian Protocol Agent Starting...");

  const llm = new ChatAnthropic({
    model: "claude-opus-4-5",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const agentkit = await CdpAgentkit.configureWithWallet({
    cdpApiKeyName: process.env.CDP_API_KEY_NAME,
    cdpApiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
    networkId: "base-sepolia",
  });

  const toolkit = new CdpToolkit(agentkit);
  const tools = toolkit.getTools();

  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: "You are the Guardian Protocol Agent on Base Sepolia testnet. Report wallet address, network, transaction hash, and balance clearly.",
  });

  console.log("STEP 1: Getting Wallet Address...");
  const step1 = await agent.invoke({
    messages: [new HumanMessage("Get my wallet address and which network we are on.")],
  });
  console.log(step1.messages[step1.messages.length - 1].content);

  console.log("STEP 2: Checking Balance...");
  const step2 = await agent.invoke({
    messages: [new HumanMessage("Check my ETH balance. If zero, request funds from the Base Sepolia faucet.")],
  });
  console.log(step2.messages[step2.messages.length - 1].content);

  console.log("Guardian Protocol Agent - Sequence Complete.");
}

runGuardianAgent().catch(console.error);
