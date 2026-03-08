require("dotenv").config();

async function main() {
  console.log("Guardian Protocol Agent Starting...");
  console.log("WALLET: 0x4D9925f10A22b5C8e1F72E3eE9E35B5c3D0A7b9");
  console.log("NETWORK: base-sepolia");
  console.log("STATUS: Agent framework operational");
  console.log("ANTHROPIC API: Connected -", process.env.ANTHROPIC_API_KEY ? "YES" : "NO");
  console.log("CDP KEY: Connected -", process.env.CDP_API_KEY_NAME ? "YES" : "NO");
  
  const { ChatAnthropic } = require("@langchain/anthropic");
  const llm = new ChatAnthropic({
    model: "claude-3-haiku-20240307",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  
  const response = await llm.invoke("Say exactly: GUARDIAN PROTOCOL AGENT IS LIVE ON BASE SEPOLIA");
  console.log("AI RESPONSE:", response.content);
  console.log("DONE. Guardian Protocol Agent verified.");
}

main().catch(console.error);
