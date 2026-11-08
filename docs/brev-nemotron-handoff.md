# Team handoff for Nemotron on Brev

Use this guide to call the team's running Nemotron model from your own computer. It assumes your Brev account already has SSH access to the shared VM.

| Setting | Value |
| --- | --- |
| Brev instance | `following-copper-silkworm` |
| Served model name | `nemotron-bolt` |
| Model weights | `nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16` |
| Local API base URL after forwarding | `http://127.0.0.1:8000/v1` |

## 1. Install the Brev CLI and sign in

On Windows, open **Ubuntu in WSL** and run the Linux commands there. If you need to install WSL first, run `wsl --install -d Ubuntu-22.04` in an administrator PowerShell and restart Windows. On Linux, run the commands in your normal terminal. [NVIDIA's Windows and Linux setup](https://docs.nvidia.com/brev/latest/cli/getting-started)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/brevdev/brev-cli/main/bin/install-latest.sh)"
export PATH="$HOME/.local/bin:$PATH"
brev --version
```

On macOS with Homebrew, run the following in Terminal. [NVIDIA's macOS setup](https://docs.nvidia.com/brev/latest/cli/getting-started)

```bash
brew install brevdev/homebrew-brev/brev
brev --version
```

Sign in with your own Brev account and sync the instance list.

```bash
brev login
brev refresh
brev list
```

If the browser doesn't open, run `brev login --skip-browser` and open the URL it prints. If the VM is missing, select the shared organization with `brev org set <organization-name>`, then run `brev refresh` again. [Brev login and connectivity](https://docs.nvidia.com/brev/cli/connectivity)

## 2. Forward the model port

Open the SSH forward from your local machine. Leave the terminal available while testing.

```bash
brev port-forward following-copper-silkworm --port 8000:8000
```

The first port is on your computer and the second is on Brev. Each teammate can use the same local port on their own computer. If local port `8000` is already taken, use `--port 8001:8000` and replace `8000` with `8001` in your local requests. [Brev port forwarding](https://docs.nvidia.com/brev/cli/connectivity#brev-port-forward)

## 3. Verify inference

In a second terminal on your computer, run these commands. On Windows, use a second Ubuntu WSL terminal.

```bash
curl -fsS --max-time 10 http://127.0.0.1:8000/v1/models

curl -fsS --max-time 45 http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "nemotron-bolt",
    "messages": [{"role": "user", "content": "Reply with the single word READY."}],
    "temperature": 0,
    "max_tokens": 32,
    "chat_template_kwargs": {"enable_thinking": false}
  }'
```

The first response should list `nemotron-bolt` under `data`. The second should show `READY` in `choices[0].message.content`. Use the served model name returned by `/v1/models` in requests. [vLLM API reference](https://docs.vllm.ai/en/v0.31.0/serving/online_serving/openai_compatible_server/)

## Use it from the Node backend

When developing locally, keep the forward running and put these values in the backend environment.

```dotenv
NEMOTRON_BASE_URL=http://127.0.0.1:8000/v1
NEMOTRON_MODEL=nemotron-bolt
```

The Node backend deployed on Brev reaches Nemotron at the same loopback URL inside the VM. Expo Go talks to the finance API over HTTPS. For model smoke tests, use synthetic prompts or aggregate routine facts. Keep the model port on loopback and use your own Brev login.

## If a command fails

- **Instance missing or access denied.** Confirm the organization and SSH access in the Brev console, then retry `brev refresh`.
- **Connection refused locally.** Confirm the port forward is open and the request uses the local port from the left side of `--port`.
- **The forward opens but the model request fails.** Ask the VM owner to check whether `curl -fsS http://127.0.0.1:8000/health` succeeds on Brev.
- **Model not found.** Use the exact model ID from `GET /v1/models`.

[NVIDIA Brev troubleshooting](https://docs.nvidia.com/brev/troubleshooting/common-issues)
