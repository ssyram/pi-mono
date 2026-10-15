# Mock LLM setup for e2e

Uses [llm-mock](https://github.com/ssyram/llm-mock) (`~/workspace/ai-tools/mock-with-pi/`) to run pi without real credentials.

```sh
# 1. Build & start mock server with a round-counter script
cd ~/workspace/ai-tools/mock-with-pi
cargo build
./target/debug/mock-llm-server add scripts/mock-scripts/round-counter.mjs --name demo --port 18099 &

# 2. Create a temp agent dir with the mock provider
TESTDIR=$(mktemp -d)
mkdir -p "$TESTDIR/agent" "$TESTDIR/project/.pi"
cat > "$TESTDIR/agent/models.json" <<'JSON'
{
  "providers": {
    "mock": {
      "name": "Mock LLM",
      "api": "openai-completions",
      "baseUrl": "http://127.0.0.1:18099/v1",
      "apiKey": "mock-key",
      "models": [{"id": "round-counter", "name": "Round Counter"}]
    }
  }
}
JSON

# 3. Run pi with both extensions
env PI_CODING_AGENT_DIR="$TESTDIR/agent" \
  pi \
    --extension ./my-plugins/my-settings/index.ts \
    --extension ./my-plugins/my-settings/e2e/index.ts \
    --model mock/round-counter
```

Expected output on startup:
```
[Extensions]
  demo-settings-consumer, my-settings
[demo-consumer] loaded 9 keys (incl. nested objects, arrays, matrix)
```

Then try `/demo-settings`, `/my-setting get demo.server`, `/demo-settings set/reset`.
