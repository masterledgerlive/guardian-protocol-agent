import { CdpClient } from "@coinbase/cdp-sdk";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  console.log("GUARDIAN V6 STARTING...");

  let apiKeySecret = process.env.CDP_API_KEY_SECRET || "";
  
  console.log("KEY START:", JSON.stringify(apiKeySecret.substring(0, 80)));
  console.log("KEY END:", JSON.stringify(apiKeySecret.substring(apiKeySecret.length - 40)));
  console.log("KEY LENGTH:", apiKeySecret.length);
  console.log("HAS REAL NEWLINES:", apiKeySecret.includes("\n"));
  console.log("HAS LITERAL \\n:", apiKeySecret.includes("\\n"));

  console.log("DONE - debug only, no CDP call yet.");
}

main().catch(console.error);
