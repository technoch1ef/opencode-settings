# Solana MCP Server Guide

## Overview
This OpenCode configuration includes the Solana MCP server, which provides AI agents with tools to interact with the Solana blockchain.

## What is Solana MCP?
The Solana MCP server wraps the [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) and provides 60+ tools for blockchain interactions through the Model Context Protocol.

## Current Configuration
- **Mode**: Read-only (no private key)
- **Network**: Solana Mainnet
- **RPC Provider**: Helius

## Available Capabilities

### Read-Only Tools (Currently Active)
- Token price lookups
- Asset information queries
- Wallet balance checks
- Transaction per second (TPS) metrics
- Domain name resolution (SNS, AllDomains)

### Transaction Tools (Require Setup)
To enable transaction capabilities, add `SOLANA_PRIVATE_KEY` to the environment:
- Token deployment and transfers
- NFT minting and management
- DEX trading (Jupiter, Raydium, Orca)
- Staking operations
- Cross-chain bridging

## Usage Examples

### In Skills
When loading the `stack-solana` skill, agents automatically gain access to MCP tools.

### For Workers
Workers implementing Solana-related tasks can use MCP tools alongside bash commands.

### For Overseers
Overseers can verify Solana operations using read-only MCP tools.

## Security Considerations
- The current configuration is read-only and safe
- Never commit private keys to this repository
- Private keys should only be set in secure environment variables
- Consider using a dedicated wallet for agent operations

## Enabling Transaction Capabilities
1. Generate or use an existing Solana wallet
2. Export the base58 private key
3. Set environment variable: `export SOLANA_PRIVATE_KEY=<your-key>`
4. Restart OpenCode/Claude Desktop
5. Test with small amounts first

## Resources
- [Solana Agent Kit Docs](https://docs.sendai.fun)
- [MCP Specification](https://modelcontextprotocol.io)
- [Solana Docs](https://docs.solana.com)
