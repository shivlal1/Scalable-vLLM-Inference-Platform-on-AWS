# Scalable vLLM Inference Platform on-AWS

This project demonstrates how to deploy an OpenAI-compatible LLM inference service on AWS using vLLM. The architecture is built incrementally, starting with a single API and GPU server, and then evolving into a scalable, highly available deployment using Application Load Balancers and Auto Scaling Groups.

                         Internet
                             |
                   Public Application Load Balancer
                             |
                  +-------------------------+
                  |                         |
             API EC2                  API EC2
          (Auto Scaling Group)    (Auto Scaling Group)
                  |                         |
                  +-----------+-------------+
                              |
               Internal Application Load Balancer
                              |
            +--------------------------------------+
            |                                      |
       GPU EC2 (vLLM)                        GPU EC2 (vLLM)
    (Auto Scaling Group)                 (Auto Scaling Group)
            |                                      |
            +----------------+----------------------+
                             |
                  OpenAI-Compatible LLM Inference
                  
The platform is built using a **two-tier architecture** that separates the API layer from the LLM inference layer. Client requests first reach a **public Application Load Balancer**, which distributes traffic across multiple API servers running in an **Auto Scaling Group**. The API servers are stateless and expose an OpenAI-compatible interface, allowing them to scale horizontally as request volume increases. Instead of communicating with a specific GPU instance, the API servers forward inference requests to an **internal Application Load Balancer**, which routes traffic to healthy GPU instances running vLLM. The GPU servers also run in an **Auto Scaling Group**, enabling inference capacity to be increased independently of the API layer.

This design is scalable because the API and GPU layers can scale independently based on their respective workloads. During periods of high client traffic, additional API instances can be launched without affecting the GPU infrastructure. Similarly, if inference demand increases, more GPU instances can be added without modifying the API layer. The use of Application Load Balancers provides automatic traffic distribution and health checks, ensuring requests are only sent to healthy instances. Auto Scaling Groups improve availability by automatically replacing failed instances and adjusting capacity as demand changes. By separating request handling from model inference, the architecture avoids bottlenecks, improves fault tolerance, and supports efficient horizontal scaling for production workloads.

## You can use this infrastructure for your AI agens. 
## Switching from Ollama to Hosted vLLM

With Ollama, the model runs locally:

```python
from langchain_ollama import ChatOllama

llm = ChatOllama(
    model="mistral",
    base_url="http://localhost:11434"
)
```

With the hosted vLLM infrastructure, replace the Ollama client with an OpenAI-compatible client and point it to the hosted endpoint:

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="NousResearch/Hermes-3-Llama-3.1-8B",
    base_url="http://YOUR-LOAD-BALANCER-URL/v1",
    api_key="not-required"
)
```

The main change is:

```text
Ollama local URL
http://localhost:11434
```

becomes:

```text
Hosted vLLM URL
http://YOUR-LOAD-BALANCER-URL/v1
```

The rest of the agent, tools, memory, and LangGraph workflow can remain mostly unchanged.

## Example Project 

Stock Market AI agent : https://github.com/shivlal1/Personalised-AI-agent-for-Stock-Analysis
