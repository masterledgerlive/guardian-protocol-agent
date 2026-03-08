require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

async function main() {
  console.log("GUARDIAN V2 STARTING...");
  console.log("ANTHROPIC:", process.env.ANTHROPIC_API_KEY ? "YES" : "NO");
  console.log("CDP:", process.env.CDP_API_KEY_NAME ? "YES" : "NO");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 100,
    messages: [{ role: "user", content: "Say: GUARDIAN PROTOCOL IS LIVE" }]
  });

  console.log("AI:", message.content[0].text);
  console.log("DONE.");
}
main().catch(console.error);
