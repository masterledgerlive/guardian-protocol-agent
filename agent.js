const { CdpAgentkit } = require("@coinbase/agentkit");
const { CdpToolkit } = require("@coinbase/agentkit-langchain");
const { HumanMessage } = require("@langchain/core/messages");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { ChatAnthropic } = require("@langchain/anthropic");
const fs = require("fs");
require("dotenv").config();

const WALLET_FILE = "wallet_data.json";

async function runGuardianAgent() {
  console.log("Guardian Protocol Agent Starting");

  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  let walletData;
  if (fs.existsSync(WALLET_FILE)) {
    walletData = fs.readFileSync(WALLET_FILE, "utf8");
    console.log("Loaded existing Guardian wallet");
  }

  const agentkit = await CdpAgentkit.configureWithWallet({
    cdpApiKeyName: process.env.CDP_API_KEY_NAME,
    cdpApiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
    cdpWalletData: walletData,
    networkId: process.env.NETWORK_ID || "base-sepolia",
  });

  const exportedWallet = await agentkit.exportWallet();
  fs.writeFileSync(WALLET_FILE, exportedWallet);

  const toolkit = new CdpToolkit(agentkit);
  const tools = toolkit.getTools();

  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: "You are the Guardian Protocol Agent running on Base Sepolia testnet. After every action report exactly what happened including wallet address, transaction hash, and balance in plain simple language.",
  });

  console.log("STEP 1: Getting Wallet Address");
  const step1 = await agent.invoke({
    messages: [new HumanMessage("Get my wallet address and tell me which network we are on. Show the full address clearly.")],
  });
  console.log(step1.messages[step1.messages.length - 1].content);

  console.log("STEP 2: Checking Balance");
  const step2 = await agent.invoke({
    messages: [new HumanMessage("Check my ETH balance. If it is 0 request funds from the Base Sepolia faucet. Show the balance clearly.")],
  });
  console.log(step2.messages[step2.messages.length - 1].content);

  console.log("STEP 3: Sending Test Transaction");
  const step3 = await agent.invoke({
    messages: [new HumanMessage("Send 0.000001 ETH to 0x4D9925f10A22b5C8e1F72E3eE9E35B5c3D0A7b9 and show me the transaction hash and explorer link.")],
  });
  console.log(step3.messages[step3.messages.length - 1].content);

  console.log("Guardian Protocol Agent Sequence Complete");
}

runGuardianAgent().catch(console.error);
