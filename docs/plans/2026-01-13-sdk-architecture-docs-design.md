# Nexus SDK Architecture Documentation Design

**Date:** 2026-01-13
**Author:** Claude
**Status:** Approved

## Purpose

Create comprehensive documentation for the Nexus SDK targeting SDK contributors and LLMs. The documentation should enable any LLM to work fully autonomously on the codebase without needing to read source files directly.

## Target Audience

- SDK Contributors (developers extending/modifying the SDK)
- LLMs (AI assistants working on the codebase)

## Format Decision

**Single comprehensive file:** `docs/ARCHITECTURE.md`

Rationale: Easier for LLMs to ingest in one context window. All information in one place for quick lookup.

## Priority Areas (Deep Coverage)

1. **Core data flows** - Bridge/swap/execute operations end-to-end
2. **Backend/API interactions** - Where and how SDK calls external services
3. **Extending the SDK** - Adding new chains, tokens, aggregators
4. **Error handling & edge cases** - Error propagation, recovery patterns

## Document Structure

```
docs/
└── ARCHITECTURE.md (~15,000-20,000 lines)
```

### Table of Contents

```markdown
# Nexus SDK Architecture

## 1. Overview & Quick Reference
   - What this SDK does
   - Key classes and where to find them
   - Quick lookup table for common tasks

## 2. Project Structure
   - Directory layout with file purposes
   - Dependency map

## 3. Core Data Flows (DEEP)
   - Bridge operation (full code walkthrough)
   - Swap operation (full code walkthrough)
   - Execute operation (full code walkthrough)
   - BridgeAndExecute combined flow

## 4. Backend & API Interactions (DEEP)
   - Cosmos infrastructure (REST, RPC, gRPC, WebSocket)
   - VSC client operations
   - Swap aggregators (LiFi, Bebop)
   - Tenderly simulation
   - All API endpoints documented

## 5. Extending the SDK (DEEP)
   - Adding a new chain (step-by-step with code)
   - Adding a new token (step-by-step with code)
   - Adding a new swap aggregator
   - Adding new operation types

## 6. Error Handling (DEEP)
   - NexusError class internals
   - All error codes with triggers
   - Error propagation paths
   - Recovery patterns

## 7. Supporting Systems
   - Analytics system
   - Event system
   - Hook callbacks
   - Telemetry

## 8. Type Reference
   - Key interfaces (condensed)
   - Parameter types
   - Result types
```

## Section Design Details

### Core Data Flows Pattern

For each operation (bridge, swap, execute, bridgeAndExecute):

1. **Entry Point** - File, method signature, full parameters
2. **Flow Diagram** - ASCII diagram showing decision points
3. **Step-by-Step Code Walkthrough** - Actual code blocks with file:line references and explanations
4. **Backend Calls Made** - Table of endpoints, purposes, request/response shapes
5. **Events Emitted** - Table of events, when triggered, payloads
6. **Error Scenarios** - Table of conditions, error codes, handling

Estimated sizes:
- `bridge()` - ~800 lines
- `swapWithExactIn()` / `swapWithExactOut()` - ~1200 lines
- `execute()` - ~500 lines
- `bridgeAndExecute()` - ~600 lines

### Backend & API Interactions Pattern

For each API client/integration:

1. **Client Overview** - Responsibility and initialization code
2. **Every Method** - Full implementation with code blocks
3. **Request/Response Formats** - TypeScript types
4. **Error Handling** - Per-method error scenarios
5. **Retry Logic** - If present

Clients to document:
- CosmosQueryClient (all methods)
- VSC Client (6+ methods)
- LiFi Aggregator
- Bebop Aggregator
- Tenderly Simulation
- Network Configuration

### Extending the SDK Pattern

Each extension guide will be copy-paste ready:

**Adding a New Chain:**
1. Register Chain Metadata (constants file)
2. Configure RPC Endpoints (chains file)
3. Add Token Addresses (if applicable)
4. Update Type Definitions
5. Testing the New Chain

**Adding a New Token:**
1. Add Token Metadata
2. Add Contract Addresses Per Chain
3. Update SUPPORTED_TOKENS Type
4. Decimals Handling

**Adding a New Swap Aggregator:**
1. Current Aggregator Pattern (interface to implement)
2. Create Aggregator Module
3. Integrate into Swap Router
4. Handle Aggregator-Specific Errors

### Error Handling Pattern

1. **NexusError Class** - Full implementation
2. **Complete Error Code Reference** - Table with all 25 codes:
   - Code number
   - Constant name
   - Triggered by (condition)
   - In file(s) with line numbers
   - Recovery action
3. **Error Propagation Paths** - Flow diagrams per operation
4. **Try/Catch Boundaries** - Where errors are caught/rethrown
5. **Edge Cases & Recovery**:
   - Partial completion scenarios
   - Network failures
   - User rejection handling

## Code Snippet Policy

**Extensive code inclusion.** Every significant function will include:
- Full implementation code block
- File path and line number reference
- Line-by-line explanation where complex

Goal: LLMs can work autonomously without reading source files.

## Implementation Plan

1. Create `docs/ARCHITECTURE.md`
2. Write sections in order (1-8)
3. For deep sections (3, 4, 5, 6): Read actual source files and include real code
4. Cross-reference everything with file:line notation
5. Review for completeness

## Success Criteria

- Any LLM can answer "how does X work?" by reading only ARCHITECTURE.md
- Contributors can add new chains/tokens following the guide without external help
- All error codes documented with exact trigger conditions
- All API interactions documented with request/response formats
