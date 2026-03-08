import { CdpClient } from "@coinbase/cdp-sdk";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  console.log("GUARDIAN V8 STARTING...");

  let apiKeySecret = process.env.CDP_API_KEY_SECRET || "";
  apiKeySecret = apiKeySecret.replace(/\\n/g, "\n");

  const lines = apiKeySecret.split("\n");
  console.log("LINE COUNT:", lines.length);
  console.log("LINE 1:", lines[0]);
  console.log("LINE 2 LENGTH:", lines[1]?.length);
  console.log("LAST LINE:", lines[lines.length - 1]);
  console.log("SECOND TO LAST:", lines[lines.length - 2]);

  console.log("KEY ID:", process.env.CDP_API_KEY_ID?.substring(0, 30) + "...");

  console.log("DONE - debug only");
}

main().catch(console.error);
