# Cognitive Memory System - MemGPT-Style Architecture

## Overview

The cognitive memory system implements a sophisticated, hierarchical memory architecture inspired by MemGPT to solve the LLM amnesia problem. It provides long-term context management, pattern learning, and intelligent memory compression.

## Architecture

### Memory Hierarchy

The system implements a 5-tier memory architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                      CORE MEMORY                             │
│  - Agent Persona (~500 tokens)                              │
│  - User Persona (~300 tokens)                               │
│  - System Context (~800 tokens)                             │
│  - Key Facts (~400 tokens)                                  │
│  TOTAL: ~2K tokens (always in context)                      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                    WORKING MEMORY                            │
│  - Current Task Context (~4K tokens)                        │
│  - Active Files & Symbols (~2K tokens)                      │
│  - Recent Actions (~2K tokens)                              │
│  TOTAL: ~8K tokens (current session)                        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   EPISODIC MEMORY                            │
│  - Task Episodes (unlimited)                                │
│  - HNSW Vector Index (O(log n) search)                     │
│  - Retention: 30 days default                               │
│  - Compression: Old → Semantic                              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   SEMANTIC MEMORY                            │
│  - Code Patterns (unlimited)                                │
│  - Architecture Knowledge                                   │
│  - Coding Conventions                                       │
│  - Learned from compressed episodes                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                  PROCEDURAL MEMORY                           │
│  - How-to Knowledge                                         │
│  - Workflow Sequences                                       │
│  - Solution Procedures                                      │
│  - Task Type Inference                                      │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. CognitiveMemoryManager (`cognitive_manager.rs`)

Main orchestrator for the entire memory system.

**Key Features:**
- Unified interface to all memory subsystems
- Automatic episode recording with learning extraction
- Memory compression and consolidation
- Statistics and monitoring

**API:**
```rust
// Create manager
let manager = CognitiveMemoryManager::new(
    db,
    storage,
    working_memory_size,
    episodic_retention_days,
    hnsw_index_path
).await?;

// Initialize (load from storage)
manager.init().await?;

// Record an episode
manager.record_episode(episode).await?;

// Retrieve relevant context
let memories = manager.retrieve_context("implement auth", 10).await?;

// Compress old memories
let stats = manager.compress_memories(Duration::days(30)).await?;

// Extract learnings
let learnings = manager.extract_learnings().await?;

// Prune low-value memories
let stats = manager.prune_memories(0.3).await?;

// Get statistics
let stats = manager.get_statistics();
```

### 2. EpisodeRecorder (`episode_recorder.rs`)

Records task execution as episodes with full action tracking.

**Key Features:**
- Episode lifecycle management (start → actions → complete)
- Action sequence recording
- Pattern extraction from episodes
- Automatic episode-to-TaskEpisode conversion

**API:**
```rust
let recorder = EpisodeRecorder::new(db);

// Start episode
let handle = recorder.start_episode("Fix auth bug", context).await?;

// Record actions
recorder.record_action(&handle, Action {
    action_type: ActionType::CodeSearch,
    description: "Searching for auth module",
    timestamp: Utc::now(),
    metadata: HashMap::new(),
}).await?;

// Complete episode
let episode = recorder.complete_episode(
    handle,
    outcome,
    vec!["Learned JWT validation pattern"]
).await?;

// Extract patterns
let patterns = recorder.extract_patterns(&episodes).await?;
```

### 3. MemoryRetrieval (`retrieval.rs`)

Advanced memory retrieval with multiple strategies.

**Strategies:**
- **Recency**: Most recent memories (exponential decay)
- **Relevance**: Semantic similarity (HNSW vector search)
- **Importance**: Pattern value + access count
- **Hybrid**: Weighted combination (default: 30% recency, 50% relevance, 20% importance)

**API:**
```rust
let retrieval = MemoryRetrieval::new(db, episodic_memory)?;

// Hybrid retrieval (recommended)
let memories = retrieval.retrieve(
    "implement OAuth",
    RetrievalStrategy::Hybrid {
        recency_weight: 0.3,
        relevance_weight: 0.5,
        importance_weight: 0.2,
    },
    limit
).await?;

// Find similar episodes
let episodes = retrieval.find_similar_episodes(&context).await?;

// Time-based retrieval
let memories = retrieval.get_temporal_memories(start, end).await?;

// File-based retrieval
let memories = retrieval.get_file_related_memories("auth.rs").await?;
```

### 4. LearningExtractor (`learning_extractor.rs`)

Extracts patterns and learnings from successful episodes.

**Learning Types:**
- Solution Patterns
- Workflows
- Architecture Patterns
- Best Practices
- Anti-Patterns (from failures)
- Performance Optimizations

**API:**
```rust
let extractor = LearningExtractor::new(db, storage);

// Extract from episodes
let learnings = extractor.extract_from_episodes(episodes).await?;

// Apply learning to new context
let suggestion = extractor.apply_learning(&learning, &context).await?;

// Update confidence based on outcome
extractor.update_confidence(&learning_id, success).await?;

// Find relevant learnings
let relevant = extractor.find_relevant_learnings(&context, 5).await?;

// Get statistics
let stats = extractor.get_statistics().await?;
```

### 5. MemoryCompressor (`compression.rs`)

MemGPT-style memory compression to manage context window limits.

**Compression Strategies:**
- Group similar episodes
- Summarize into semantic memories
- Create checkpoints for rollback
- Calculate compression ratios

**API:**
```rust
let compressor = MemoryCompressor::new(
    db,
    storage,
    episodic_memory,
    semantic_memory
);

// Compress old episodes
let stats = compressor.compress_episodes(Duration::days(30)).await?;
println!("Compressed {} episodes into {} semantic memories",
    stats.episodes_compressed,
    stats.semantic_memories_created);

// Summarize conversation
let summary = compressor.summarize_conversation(messages).await?;

// Create checkpoint
let checkpoint_id = compressor.create_checkpoint().await?;

// Restore from checkpoint
compressor.restore_checkpoint(checkpoint_id).await?;

// List checkpoints
let checkpoints = compressor.list_checkpoints().await?;
```

## Data Flow

### Episode Recording Flow

```
User Task
    ↓
[Start Episode]
    ↓
[Record Actions]
    - CodeSearch
    - FileRead
    - FileEdit
    - ToolCall
    - Query
    - Analysis
    - Test
    - Build
    - Commit
    ↓
[Complete Episode]
    ↓
[Extract Learnings] (if successful)
    ↓
[Store in Episodic Memory]
    ↓
[Generate HNSW Embedding]
    ↓
[Update Procedural Memory]
```

### Memory Retrieval Flow

```
Query: "implement OAuth"
    ↓
[Generate Query Embedding] (384-dim Sentence-BERT)
    ↓
[HNSW Vector Search] (O(log n) vs O(n) linear)
    ↓
[Retrieve Top K Similar Episodes]
    ↓
[Calculate Scores]
    - Recency: exp(-age/half_life)
    - Relevance: Cosine similarity
    - Importance: pattern_value * 0.6 + access_count * 0.4
    ↓
[Combine with Weights]
    score = R*0.3 + V*0.5 + I*0.2
    ↓
[Return Ranked Memories]
```

### Memory Compression Flow

```
Old Episodes (>30 days)
    ↓
[Group Similar Episodes]
    - Jaccard similarity > 0.4
    - Common files
    - Common queries
    ↓
[Summarize Each Group]
    - Extract common patterns
    - Calculate success rate
    - Identify key files
    - Extract solutions
    ↓
[Create Semantic Memory]
    - Title: Pattern description
    - Content: Compressed summary
    - Metadata: Episode IDs
    ↓
[Delete Old Episodes]
    ↓
[Calculate Compression Ratio]
```

## Performance Optimizations

### 1. HNSW Vector Index

- **Search Complexity**: O(log n) vs O(n) linear
- **Speed Improvement**: 100-500x faster for large datasets
- **Index Persistence**: Save/load from disk for fast startup
- **Dimension**: 384 (Sentence-BERT embeddings)
- **Capacity**: 100K episodes

### 2. Pattern Index

- **Keyword Index**: O(1) lookup by keyword
- **Episode Patterns**: Pre-computed and cached
- **Context Markers**: Extracted keywords for fast matching

### 3. Token Management

- **Progressive Loading**: Load summaries first, details on demand
- **Detail Levels**: Skeleton | Interface | Implementation | Full
- **Compression**: Old episodes → semantic summaries (10-20x reduction)
- **Selective Pruning**: Remove low-value, unaccessed memories

## Integration Points

### With SurrealDB

The system leverages SurrealDB's graph capabilities:

```sql
-- Episode nodes
DEFINE TABLE episode SCHEMAFULL;
-- (id, task_description, solution_summary, files_touched, success_score, ...)

-- Episode relationships
DEFINE TABLE similar_to SCHEMAFULL;
-- (in: episode, out: episode, similarity_score)

-- Code symbol relationships
DEFINE TABLE references_symbol SCHEMAFULL;
-- (in: episode, out: code_symbol, reference_type)
```

### With Existing Memory Systems

```rust
// Episodic Memory (existing)
episodic_memory.record_episode(episode).await?;
let similar = episodic_memory.find_similar(query, limit).await;

// Semantic Memory (existing)
semantic_memory.add_knowledge(title, content).await?;
let relevant = semantic_memory.find_relevant(query, limit).await;

// Procedural Memory (existing)
procedural_memory.record_solution(task, solution).await?;
let procedure = procedural_memory.get_procedure(&task_type);

// Working Memory (existing)
working_memory.add_item(memory_item)?;
let items = working_memory.items();
```

## Usage Examples

### Example 1: Complete Task Workflow

```rust
use meridian::memory::*;

// Initialize cognitive memory
let mut cognitive = CognitiveMemoryManager::new(
    db,
    storage,
    100,  // working memory size
    30,   // retention days
    Some(PathBuf::from("./hnsw_index"))
).await?;

cognitive.init().await?;

// Search for similar past tasks
let context = Context {
    task_description: "Implement OAuth authentication".to_string(),
    active_files: vec!["auth.rs".to_string()],
    active_symbols: vec![],
    tags: vec!["auth".to_string(), "security".to_string()],
};

let similar_episodes = memory_retrieval
    .find_similar_episodes(&context)
    .await?;

println!("Found {} similar past tasks:", similar_episodes.len());
for ep in similar_episodes {
    println!("  - {}: {}", ep.task_description, ep.solution_path);
}

// Record new episode
let recorder = EpisodeRecorder::new(db.clone());
let handle = recorder.start_episode(
    "Implement OAuth authentication",
    context
).await?;

// ... do work, record actions ...

recorder.record_action(&handle, Action {
    action_type: ActionType::CodeSearch,
    description: "Search for existing auth implementations",
    timestamp: Utc::now(),
    metadata: HashMap::new(),
}).await?;

// Complete episode
let episode = recorder.complete_episode(
    handle,
    EpisodeOutcome {
        status: Outcome::Success,
        description: "OAuth flow implemented successfully".to_string(),
        files_modified: vec!["auth.rs".to_string(), "oauth.rs".to_string()],
        tests_passed: Some(true),
        build_succeeded: Some(true),
        commit_hash: Some("abc123".to_string()),
    },
    vec!["Use authorization code flow for web apps".to_string()]
).await?;

// Record in cognitive memory
let task_episode = recorder.to_task_episode(episode);
cognitive.record_episode(task_episode).await?;

// Extract and view learnings
let learnings = cognitive.extract_learnings().await?;
println!("Extracted {} learnings", learnings.len());
```

### Example 2: Memory Compression

```rust
use chrono::Duration;

// Compress memories older than 30 days
let stats = cognitive.compress_memories(Duration::days(30)).await?;

println!("Compression Results:");
println!("  Episodes processed: {}", stats.episodes_processed);
println!("  Episodes compressed: {}", stats.episodes_compressed);
println!("  Semantic memories created: {}", stats.semantic_memories_created);
println!("  Space saved: {} bytes", stats.space_saved_bytes);
println!("  Compression ratio: {:.2}x", 1.0 / stats.compression_ratio);

// Create checkpoint before major changes
let checkpoint_id = compressor.create_checkpoint().await?;
println!("Created checkpoint: {}", checkpoint_id.0);

// ... make changes ...

// Restore if needed
compressor.restore_checkpoint(checkpoint_id).await?;
```

### Example 3: Learning Application

```rust
let extractor = LearningExtractor::new(db, storage);

// Find relevant learnings for current task
let context = Context {
    task_description: "Fix authentication timeout issue".to_string(),
    active_files: vec!["auth.rs".to_string()],
    active_symbols: vec![],
    tags: vec!["auth".to_string(), "bug".to_string()],
};

let learnings = extractor.find_relevant_learnings(&context, 5).await?;

for learning in learnings {
    let suggestion = extractor.apply_learning(&learning, &context).await?;

    println!("\nLearning: {}", learning.pattern);
    println!("Confidence: {:.2}%", suggestion.confidence * 100.0);
    println!("Reasoning: {}", suggestion.reasoning);
    println!("Example episodes: {:?}", suggestion.example_episodes);
}

// After applying learning
let success = true;  // task succeeded
extractor.update_confidence(&learning.id, success).await?;
```

## Statistics and Monitoring

```rust
// Get memory statistics
let stats = cognitive.get_statistics();

println!("Memory System Statistics:");
println!("  Core Memory: {} tokens", stats.core_memory_tokens);
println!("  Working Memory: {} items", stats.working_memory_items);
println!("  Episodic Memory: {} episodes", stats.episodic_memory_count);
println!("  Semantic Memory: {} items", stats.semantic_memory_count);
println!("  Procedural Memory: {} procedures", stats.procedural_memory_count);
println!("  Total Estimate: {} tokens", stats.total_token_estimate);

// Get retrieval statistics
let retrieval_stats = retrieval.get_statistics().await?;
println!("\nRetrieval Statistics:");
println!("  Total memories: {}", retrieval_stats.total_memories);
println!("  Recent (7 days): {}", retrieval_stats.recent_memories);
println!("  High value (>0.7): {}", retrieval_stats.high_value_memories);
println!("  Avg access count: {:.2}", retrieval_stats.avg_access_count);

// Get learning statistics
let learning_stats = extractor.get_statistics().await?;
println!("\nLearning Statistics:");
println!("  Total learnings: {}", learning_stats.total_learnings);
println!("  High confidence (>0.8): {}", learning_stats.high_confidence_learnings);
println!("  Frequently applied (>5): {}", learning_stats.frequently_applied_learnings);
println!("  Avg confidence: {:.2}%", learning_stats.average_confidence * 100.0);
println!("  Avg applications: {:.2}", learning_stats.average_applications);
```

## Key Benefits

1. **Solves LLM Amnesia**: Maintains context across sessions indefinitely
2. **Efficient Search**: HNSW index provides 100-500x faster similarity search
3. **Automatic Learning**: Extracts patterns from successful episodes
4. **Adaptive Memory**: Compresses old memories while retaining important patterns
5. **Multiple Retrieval Strategies**: Optimized for different use cases
6. **Production Ready**: Full test coverage, error handling, and monitoring

## Future Enhancements

1. **Advanced Compression**:
   - GPT-based summarization for better compression ratios
   - Adaptive compression thresholds based on usage patterns

2. **Improved Learning**:
   - Reinforcement learning for pattern confidence
   - Transfer learning across different codebases

3. **Enhanced Retrieval**:
   - Multi-modal embeddings (code + text + metadata)
   - Query expansion and reformulation
   - Feedback-based ranking

4. **Memory Visualization**:
   - Graph visualization of memory relationships
   - Timeline view of episode evolution
   - Pattern cluster visualization

5. **Integration**:
   - MCP tools for memory management
   - REST API for external access
   - Streaming memory updates

## References

- **MemGPT Paper**: "MemGPT: Towards LLMs as Operating Systems" (2023)
- **HNSW**: "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs" (2018)
- **Sentence-BERT**: "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks" (2019)
