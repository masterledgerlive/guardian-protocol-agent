/**
 * Boot patch: #119 WAVE hitch introduced a second `const leftoverEth` in executeSell
 * (SyntaxError on tip 0468dc2). Rename the WAVE-gate binding before agent.js loads.
 * Idempotent. Remove once the rename is in main.
 */
import fs from "node:fs";

const path = new URL("./agent.js", import.meta.url);
let s = fs.readFileSync(path, "utf8");
if (s.includes("const gateLeftoverEth = Math.max(0, Number(sellGate.leftover)")) {
  console.log("BOOT_PATCH leftoverEth: already applied");
  process.exit(0);
}
const n =
  "    const leftoverEth = Math.max(0, Number(sellGate.leftover) || 0);\n" +
  "    const waveShard = peekNextWaveHitchShard();";
const r =
  "    const gateLeftoverEth = Math.max(0, Number(sellGate.leftover) || 0);\n" +
  "    const waveShard = peekNextWaveHitchShard();";
if (!s.includes(n)) {
  console.error("BOOT_PATCH leftoverEth: PATCH_MISS — needle not found");
  process.exit(1);
}
s = s.replace(n, r);
s = s.replaceAll("leftoverEth - voiceHitchCost", "gateLeftoverEth - voiceHitchCost");
s = s.replaceAll(
  "plusAfterHitchEth(leftoverEth, voiceHitchCost",
  "plusAfterHitchEth(gateLeftoverEth, voiceHitchCost",
);
fs.writeFileSync(path, s);
console.log("BOOT_PATCH leftoverEth: applied gateLeftoverEth rename");
