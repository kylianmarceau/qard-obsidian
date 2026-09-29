---
qard-deck: Computer Networks
tags: [networks, semester-1]
---

# Transport Layer

These are normal notes. Qard callouts fit between them.

<!-- qard-id: example-tcp -->
> [!qard]- What does TCP provide?
> TCP provides **reliable, ordered delivery** of data.
>
> - Retransmits lost segments
> - Orders arriving data
> - Provides flow and congestion control

<!-- qard-id: example-udp -->
> [!qard]- What is UDP?
> UDP is a connectionless transport protocol. It does not guarantee delivery or ordering.

# Network Layer

<!-- qard-id: example-ip -->
> [!qard]- What is the purpose of IP?
> IP provides addressing and routing between networks.

<!-- qard-id: example-image -->
> [!qard]- Identify the relationship in this diagram. ![[network.svg|260]]
> ![[network.svg]]
>
> The sender and receiver exchange data through a router. #diagrams

<!-- qard-id: example-throughput -->
> [!qard]- How do we calculate throughput?
> Throughput can be represented as:
>
> $$
> T = \frac{\text{data transferred}}{\text{time}}
> $$
