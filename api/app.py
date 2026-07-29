import os

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)

VLLM_URL = os.environ["VLLM_URL"]


@app.route("/", methods=["GET"])
def home():
    return "API Server Running", 200


@app.route("/health", methods=["GET"])
def health():

    try:

        response = requests.get(
            VLLM_URL.replace(
                "/v1/chat/completions",
                "/v1/models"
            ),
            timeout=10
        )

        if response.status_code == 200:
            return jsonify({
                "status": "healthy"
            }), 200

        return jsonify({
            "status": "unhealthy"
        }), 500

    except Exception as e:

        return jsonify({
            "status": "unhealthy",
            "error": str(e)
        }), 500


@app.route("/v1/models", methods=["GET"])
def models():

    response = requests.get(
        VLLM_URL.replace(
            "/v1/chat/completions",
            "/v1/models"
        ),
        timeout=30
    )

    return (
        jsonify(response.json()),
        response.status_code
    )


@app.route("/v1/chat/completions", methods=["POST"])
def chat():

    response = requests.post(
        VLLM_URL,
        json=request.get_json(),
        timeout=600
    )

    return (
        jsonify(response.json()),
        response.status_code
    )


if __name__ == "__main__":

    app.run(
        host="0.0.0.0",
        port=8000
    )