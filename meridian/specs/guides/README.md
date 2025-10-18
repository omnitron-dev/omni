# Meridian User Guides

**Version**: 2.0.0
**Last Updated**: October 18, 2025
**Status**: Complete

---

## Overview

Comprehensive user documentation for Meridian v2.0.0 - a cognitive code memory system for Large Language Models.

**Total Guides**: 4
**Total Lines**: 3,656
**Audience**: Beginners to Advanced users

---

## Guides

### 1. [Getting Started](./getting-started.md) (646 lines)

**Audience**: New users, Beginners

**Topics Covered**:
- What is Meridian and why use it
- Installation (from binary and source)
- First indexing walkthrough
- Claude Code integration setup
- Basic MCP tool usage
- Common workflows
- Troubleshooting common issues

**Start Here**: If you're new to Meridian

**Time to Complete**: 30-45 minutes

---

### 2. [Multi-Monorepo Setup](./multi-monorepo-setup.md) (832 lines)

**Audience**: Intermediate users, DevOps, Team Leads

**Topics Covered**:
- Global server architecture
- Setting up the global Meridian server
- Registering multiple monorepos
- Cross-repository documentation access
- Managing multiple projects
- Synchronization strategies (push/pull)
- Best practices for teams and organizations
- Relocating monorepos without data loss

**Prerequisites**: Complete [Getting Started](./getting-started.md) first

**Time to Complete**: 1-2 hours

**Key Features**:
- Identity-based project IDs (survive moves)
- Global registry of all projects
- Cross-monorepo documentation access
- Offline mode support

---

### 3. [MCP Integration](./mcp-integration.md) (1,148 lines)

**Audience**: Developers, Integration Engineers

**Topics Covered**:
- MCP Protocol 2025-03-26 overview
- Server configuration (STDIO, HTTP, WebSocket)
- Transport modes and selection
- Complete tool usage examples (all 49 tools)
- Integration with Claude Code
- Integration with other MCP clients
- Custom tool development
- Troubleshooting MCP connections

**Prerequisites**: Basic understanding of Meridian

**Time to Complete**: 2-3 hours

**Key Features**:
- 49 production-ready MCP tools
- Multiple transport modes
- Custom tool development guide
- Python, TypeScript client examples

---

### 4. [Testing Guide](./testing-guide.md) (1,030 lines)

**Audience**: Developers, QA Engineers, Contributors

**Topics Covered**:
- Test suite overview (431 tests)
- Running the test suite
- Test structure and organization
- Test categories (unit, integration, e2e, MCP)
- Adding new tests
- Coverage requirements (95%+ line, 92%+ branch)
- CI/CD integration (GitHub Actions)
- Troubleshooting failing tests

**Prerequisites**: Development environment setup

**Time to Complete**: 1-2 hours

**Key Features**:
- 100% pass rate
- Zero flaky tests
- Production-grade testing
- Full CI/CD integration

---

## Quick Navigation

### By User Level

**Beginner**:
1. [Getting Started](./getting-started.md)
2. [MCP Integration](./mcp-integration.md) (sections 1-6)

**Intermediate**:
1. [Multi-Monorepo Setup](./multi-monorepo-setup.md)
2. [MCP Integration](./mcp-integration.md) (all sections)

**Advanced**:
1. [Testing Guide](./testing-guide.md)
2. [MCP Integration](./mcp-integration.md) (Custom Tool Development)

### By Use Case

**Setting Up Meridian**:
- [Getting Started → Installation](./getting-started.md#installation)
- [Getting Started → First Indexing](./getting-started.md#first-indexing)

**Working with Multiple Repositories**:
- [Multi-Monorepo Setup → Global Server Setup](./multi-monorepo-setup.md#global-server-setup)
- [Multi-Monorepo Setup → Registering Monorepos](./multi-monorepo-setup.md#registering-monorepos)

**Integrating with Claude Code**:
- [Getting Started → Claude Code Integration](./getting-started.md#claude-code-integration)
- [MCP Integration → Integration with Claude Code](./mcp-integration.md#integration-with-claude-code)

**Using MCP Tools**:
- [Getting Started → Basic MCP Tool Usage](./getting-started.md#basic-mcp-tool-usage)
- [MCP Integration → Tool Usage Examples](./mcp-integration.md#tool-usage-examples)

**Developing Custom Tools**:
- [MCP Integration → Custom Tool Development](./mcp-integration.md#custom-tool-development)

**Running Tests**:
- [Testing Guide → Running Tests](./testing-guide.md#running-tests)
- [Testing Guide → Adding New Tests](./testing-guide.md#adding-new-tests)

---

## Cross-References

### Related Specifications

All guides reference and complement these specifications:

1. **[Core Specification (spec.md)](../spec.md)**
   - Architecture deep dive
   - Memory system details
   - 29 core MCP tools
   - Referenced in: All guides

2. **[Strong Tools Specification (strong-tools-spec.md)](../strong-tools-spec.md)**
   - Documentation generation
   - Example and test generation
   - Global catalog
   - Referenced in: MCP Integration, Multi-Monorepo Setup

3. **[Global Architecture Specification (global-architecture-spec.md)](../global-architecture-spec.md)**
   - Multi-monorepo architecture
   - Global server design
   - Cross-repository features
   - Referenced in: Multi-Monorepo Setup, MCP Integration

4. **[Roadmap (roadmap.md)](../roadmap.md)**
   - Implementation status
   - Phase completion
   - Testing statistics
   - Referenced in: Testing Guide

5. **[MCP Tools Catalog (schemas/mcp-tools-catalog.md)](../schemas/mcp-tools-catalog.md)**
   - Complete tool reference
   - Tool schemas
   - Usage examples
   - Referenced in: MCP Integration, Getting Started

### Schema References

Guides reference these schema definitions:

- **[Type Definitions (schemas/type-definitions.md)](../schemas/type-definitions.md)**
  - TypeScript interfaces
  - Core data structures
  - Referenced in: Multi-Monorepo Setup

- **[RocksDB Schema (schemas/rocksdb-schema.md)](../schemas/rocksdb-schema.md)**
  - Database structure
  - Key formats
  - Referenced in: Multi-Monorepo Setup

---

## Guide Statistics

| Guide | Lines | Sections | Code Examples | Prerequisites |
|-------|-------|----------|---------------|---------------|
| Getting Started | 646 | 9 | 25+ | None |
| Multi-Monorepo Setup | 832 | 10 | 30+ | Getting Started |
| MCP Integration | 1,148 | 9 | 50+ | Basic understanding |
| Testing Guide | 1,030 | 9 | 40+ | Development setup |
| **TOTAL** | **3,656** | **37** | **145+** | - |

---

## Troubleshooting Index

Common issues and where to find solutions:

### Installation Issues
- [Getting Started → Troubleshooting](./getting-started.md#troubleshooting)

### Indexing Issues
- [Getting Started → Issue 1: Indexing Fails](./getting-started.md#issue-1-indexing-fails)
- [Getting Started → Issue 3: Slow Indexing](./getting-started.md#issue-3-slow-indexing)

### MCP Connection Issues
- [Getting Started → Issue 2: MCP Server Not Connecting](./getting-started.md#issue-2-mcp-server-not-connecting)
- [MCP Integration → Troubleshooting](./mcp-integration.md#troubleshooting)

### Multi-Monorepo Issues
- [Multi-Monorepo Setup → Troubleshooting](./multi-monorepo-setup.md#troubleshooting)
- [Multi-Monorepo Setup → Issue 3: Cross-Repo Access Fails](./multi-monorepo-setup.md#issue-3-cross-repo-access-fails)

### Testing Issues
- [Testing Guide → Troubleshooting Tests](./testing-guide.md#troubleshooting-tests)
- [Testing Guide → Issue 2: Flaky Test](./testing-guide.md#issue-2-flaky-test)

---

## Contributing to Guides

Found an error or want to improve documentation?

1. **Report Issues**: GitHub Issues with `documentation` label
2. **Submit PRs**: Follow [Contributing Guide](../CONTRIBUTING.md)
3. **Discuss**: GitHub Discussions

### Guide Writing Standards

- **Clear Language**: Write for beginners, even in advanced guides
- **Code Examples**: All examples must be tested and working
- **Cross-References**: Link to related sections and specs
- **Screenshots**: Include for UI-heavy sections (when applicable)
- **Keep Updated**: Update guides when features change

---

## Version History

### v1.0.0 (October 18, 2025)

**Initial Release**:
- ✅ Getting Started Guide (646 lines)
- ✅ Multi-Monorepo Setup Guide (832 lines)
- ✅ MCP Integration Guide (1,148 lines)
- ✅ Testing Guide (1,030 lines)

**Total**: 3,656 lines of comprehensive documentation

**Coverage**: Beginner to Advanced users

**Quality**: Production-ready, reviewed, tested

---

## Feedback

Help us improve these guides:

- **GitHub Issues**: Report errors or unclear sections
- **Discussions**: Suggest new topics or improvements
- **Email**: docs@meridian-dev.io (if available)

---

**Index Version**: 1.0.0
**Meridian Version**: 2.0.0
**Last Updated**: October 18, 2025
**Maintained by**: Meridian Documentation Team
