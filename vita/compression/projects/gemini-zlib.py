import zlib
import binascii
import json
import sys
import base64

# Gemini compression project — zlib bytes, then 0x hex calldata.
# Node twin: gemini-zlib-v1 in vita/compression/codecs.js (deflate level 6).

# 1. Load your entire KrysAI ecosystem text into a dictionary
krysai_data = {
    "company": "KrysAI Systems",
    "hardware": ["Light Travel", "Heavy Robotics", "Ultra Workstation"],
    "iot_tiers": ["Starter", "Advanced", "Industrial"],
    "shadow_pc_agents": ["Email", "Scraper", "Social", "Content", "Automation"],
    "mission": "Local AI. Real Automation. Clearwater Strong."
}


def load_raw_bytes(argv):
    args = [a for a in argv[1:] if a != "--json"]
    if args:
        with open(args[0], "rb") as handle:
            return handle.read()
    # Serialize to JSON and encode to raw bytes
    return json.dumps(krysai_data).encode("utf-8")


def main(argv):
    raw_bytes = load_raw_bytes(argv)
    # Compress the bytes to save blockchain gas/fees
    compressed_bytes = zlib.compress(raw_bytes)
    recovered = zlib.decompress(compressed_bytes)
    verified = recovered == raw_bytes
    # Convert to machine-readable Hexadecimal format (e.g., 0x...)
    blockchain_payload = "0x" + binascii.hexlify(compressed_bytes).decode("utf-8")
    if "--json" in argv[1:]:
        print(json.dumps({
            "codec": "gemini-zlib-py-v1",
            "project": "gemini-code-1790141126186",
            "original": len(raw_bytes),
            "compressed": len(compressed_bytes),
            "verified": verified,
            "recovered": verified,
            "answer": verified,
            "payloadBase64": base64.b64encode(compressed_bytes).decode("ascii"),
            "blockchainPayloadPrefix": blockchain_payload[:80],
        }))
        return 0 if verified else 1
    print(f"Original Size: {len(raw_bytes)} bytes")
    print(f"Compressed Size: {len(compressed_bytes)} bytes")
    print(f"VERIFIED {str(verified).lower()}")
    print(f"answer recovered={str(verified).lower()}")
    print(f"Blockchain Calldata Payload:\n{blockchain_payload}")
    return 0 if verified else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
