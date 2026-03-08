{
  "name": "guardian-protocol-agent",
  "version": "1.0.0",
  "description": "Guardian Protocol AI Agent on Base Sepolia",
  "main": "agent.js",
  "scripts": {
    "start": "node agent.js"
  },
  "dependencies": {
    "@coinbase/agentkit": "^0.1.0",
    "@coinbase/agentkit-langchain": "^0.1.0",
    "@langchain/anthropic": "^0.3.0",
    "@langchain/core": "^0.3.0",
    "@langchain/langgraph": "^0.2.0",
    "dotenv": "^16.0.0"
  }
}
```

6. Scroll down click **Commit changes**

---

**Then go back to Railway and click Redeploy**

---

**Record in Pages:**
```
SKILLMD NOTE:
package.json must be pure JSON format.
No backticks, no comments, no extra characters.
If Railway says invalid character in package.json
always go back to GitHub and repaste it clean.
