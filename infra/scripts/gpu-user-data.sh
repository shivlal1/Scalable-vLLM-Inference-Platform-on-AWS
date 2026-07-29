#!/bin/bash
set -euxo pipefail

exec > >(tee /var/log/user-data.log | logger -t user-data)
exec 2>&1

#
# Update OS
#
dnf update -y

#
# Install Docker
#
dnf install -y docker

systemctl enable docker
systemctl start docker

#
# Wait until Docker is ready
#
until docker info >/dev/null 2>&1
do
    sleep 2
done

#
# Pull vLLM image
#
docker pull vllm/vllm-openai:latest

#
# Remove existing container
#
docker rm -f vllm || true

#
# Start vLLM
#
docker run -d \
    --name vllm \
    --restart unless-stopped \
    --gpus all \
    --ipc=host \
    -p 8000:8000 \
    -v /root/.cache/huggingface:/root/.cache/huggingface \
    vllm/vllm-openai:latest \
    --model NousResearch/Meta-Llama-3-8B-Instruct \
    --host 0.0.0.0 \
    --port 8000