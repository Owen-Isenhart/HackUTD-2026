#!/usr/bin/env bash
# Serve Nemotron with vLLM on a Brev GPU machine. Run this ON the Brev machine.
#
# Picks the model from the GPU that is present:
#   Blackwell (B200 / B300 / GB200 / GB300)  -> Nemotron 3 Super 120B-A12B NVFP4 (card minimum: 1x B200)
#   anything else, e.g. 1x H100/H200/A100 80GB -> Nemotron 3.5 Lightning 30B-A3B NVFP4 (card: 1x H100)
# Override with MODEL=... if you know better.
#
# Flags are copied from the Hugging Face model cards (read 2026-11-07):
#   nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 (card names vllm/vllm-openai:v0.27.1)
#   nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4      (vllm==0.20.0, needs super_v3_reasoning_parser.py)
#
# Then expose port 8000 (Brev console -> your instance -> Access -> share a port)
# and on the laptop set NEMOTRON_BASE_URL=<that url>/v1 and NEMOTRON_MODEL=<served name below>.
set -euo pipefail

PORT="${PORT:-8000}"
GPU_NAMES="$(nvidia-smi --query-gpu=name --format=csv,noheader | sort -u | tr '\n' ' ')"
TOTAL_MIB="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | awk '{s+=$1} END {print s}')"
echo "GPUs: ${GPU_NAMES} total ${TOTAL_MIB} MiB"

if [[ -z "${MODEL:-}" ]]; then
  if [[ "$GPU_NAMES" =~ B200|B300|GB200|GB300 ]]; then
    MODEL=nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4
  else
    MODEL=nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4
  fi
fi
echo "Serving ${MODEL} on port ${PORT}"

# Each model card names its own vLLM version.
case "$MODEL" in
  *Super*) pip install -q "vllm==0.20.0" ;;
  *)       pip install -q "vllm==0.27.1" ;;
esac

case "$MODEL" in
  *Super*)
    curl -sSLO "https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4/raw/main/super_v3_reasoning_parser.py"
    exec vllm serve "$MODEL" --port "$PORT" \
      --served-model-name "$MODEL" \
      --async-scheduling --dtype auto --max-model-len 262144 --swap-space 0 \
      --trust-remote-code --kv-cache-dtype fp8 --gpu-memory-utilization 0.9 \
      --max-cudagraph-capture-size 128 --enable-chunked-prefill \
      --mamba-ssm-cache-dtype float16 \
      --reasoning-parser-plugin ./super_v3_reasoning_parser.py --reasoning-parser super_v3 \
      --enable-auto-tool-choice --tool-call-parser qwen3_coder
    ;;
  *Lightning*NVFP4*)
    EXTRA=()
    if [[ "$GPU_NAMES" == *A100* ]]; then EXTRA+=(--quantization modelopt_fp4); fi
    exec vllm serve --model "$MODEL" --port "$PORT" \
      --max-num-seqs 128 --enable-prefix-caching --async-scheduling \
      --mamba-backend flashinfer --mamba-ssm-cache-dtype float16 \
      --enable-mamba-cache-stochastic-rounding --mamba-cache-philox-rounds 5 \
      --reasoning-parser nemotron_v3 --tool-call-parser qwen3_coder --enable-auto-tool-choice \
      "${EXTRA[@]}"
    ;;
  *)
    exec vllm serve --model "$MODEL" --port "$PORT" \
      --reasoning-parser nemotron_v3 --tool-call-parser qwen3_coder --enable-auto-tool-choice
    ;;
esac
