#!/bin/bash
set -euxo pipefail

exec > >(tee /var/log/user-data.log | logger -t user-data)
exec 2>&1

#
# Update OS
#
dnf update -y

#
# Install packages
#
dnf install -y \
    python3 \
    python3-pip \
    unzip \
    awscli

#
# Create application directory
#
mkdir -p /opt/api

#
# Download API code
#
aws s3 cp s3://{{S3_BUCKET}}/{{S3_KEY}} /tmp/api.zip

#
# Extract
#
unzip -o /tmp/api.zip -d /opt/api

cd /opt/api

#
# Install dependencies
#
pip3 install -r requirements.txt

#
# Create systemd service
#
cat >/etc/systemd/system/api.service <<EOF
[Unit]
Description=Flask API Server
After=network.target

[Service]
WorkingDirectory=/opt/api

Environment=VLLM_URL=http://{{GPU_PRIVATE_DNS}}:8000/v1/chat/completions

ExecStart=/usr/bin/python3 /opt/api/app.py

Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

#
# Enable service
#
systemctl daemon-reload

systemctl enable api

systemctl start api