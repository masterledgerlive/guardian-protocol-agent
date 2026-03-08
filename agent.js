require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

async function main() {
  console.log("Guardian Protocol Agent Starting...");
  console.log("WALLET: 0x4D9925f10A22b5C8e1F72E3eE9E35B5c3D0A7b9");
  console.log("NETWORK: base-sepolia");
  console.log("ANTHROPIC API: Connected -", process.env.ANTHROPIC_API_KEY ? "YES" : "NO");
  console.log("CDP KEY: Connected -", process.env.CDP_API_KEY_NAME ? "YES" : "NO");

  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  
  const message = await client.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 100,
    messages: [{ role: "user", content: "Say exactly this: GUARDIAN PROTOCOL AGENT IS LIVE" }]
  });

  console.log("AI RESPONSE:", message.content[0].text);
  console.log("DONE. Guardian Protocol is operational.");
}

main().catch(console.error);
