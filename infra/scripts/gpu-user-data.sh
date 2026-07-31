#!/bin/bash
set -euxo pipefail

exec > >(tee /var/log/user-data.log | logger -t user-data) 2>&1

dnf install -y docker

systemctl enable --now docker

until docker info >/dev/null 2>&1; do
    sleep 2
done

docker pull vllm/vllm-openai:latest

docker run -d \
  --name vllm \
  --restart unless-stopped \
  --gpus all \
  --ipc=host \
  -p 8000:8000 \
  -v /root/.cache/huggingface:/root/.cache/huggingface \
  vllm/vllm-openai:latest \
  --model NousResearch/Hermes-3-Llama-3.1-8B \
  --served-model-name NousResearch/Hermes-3-Llama-3.1-8B \
  --host 0.0.0.0 \
  --port 8000 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
