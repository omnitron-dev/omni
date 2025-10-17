use crate::context::ContextManager;
use crate::indexer::CodeIndexer;
use crate::memory::MemorySystem;
use crate::session::{SessionAction, SessionManager};
use crate::types::*;
use anyhow::{Context as _, Result, anyhow};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use tracing::{debug, info};

/// Handler for all MCP tool calls
pub struct ToolHandlers {
    memory_system: std::sync::Arc<tokio::sync::RwLock<MemorySystem>>,
    context_manager: std::sync::Arc<tokio::sync::RwLock<ContextManager>>,
    indexer: std::sync::Arc<tokio::sync::RwLock<CodeIndexer>>,
    session_manager: std::sync::Arc<SessionManager>,
}

impl ToolHandlers {
    pub fn new(
        memory_system: MemorySystem,
        context_manager: ContextManager,
        indexer: CodeIndexer,
        session_manager: SessionManager,
    ) -> Self {
        Self {
            memory_system: std::sync::Arc::new(tokio::sync::RwLock::new(memory_system)),
            context_manager: std::sync::Arc::new(tokio::sync::RwLock::new(context_manager)),
            indexer: std::sync::Arc::new(tokio::sync::RwLock::new(indexer)),
            session_manager: std::sync::Arc::new(session_manager),
        }
    }

    /// Route tool call to appropriate handler
    pub async fn handle_tool_call(&self, name: &str, arguments: Value) -> Result<Value> {
        debug!("Handling tool call: {}", name);

        match name {
            // Memory Management Tools
            "memory.record_episode" => self.handle_record_episode(arguments).await,
            "memory.find_similar_episodes" => self.handle_find_similar_episodes(arguments).await,
            "memory.update_working_set" => self.handle_update_working_set(arguments).await,

            // Context Management Tools
            "context.prepare_adaptive" => self.handle_prepare_adaptive_context(arguments).await,
            "context.defragment" => self.handle_defragment_context(arguments).await,

            // Code Navigation Tools
            "code.search_symbols" => self.handle_search_symbols(arguments).await,
            "code.get_definition" => self.handle_get_definition(arguments).await,
            "code.find_references" => self.handle_find_references(arguments).await,
            "code.get_dependencies" => self.handle_get_dependencies(arguments).await,

            // Session Management Tools
            "session.begin" => self.handle_begin_session(arguments).await,
            "session.update" => self.handle_update_session(arguments).await,
            "session.query" => self.handle_session_query(arguments).await,
            "session.complete" => self.handle_complete_session(arguments).await,

            // Feedback and Learning Tools
            "feedback.mark_useful" => self.handle_mark_useful(arguments).await,
            "learning.train_on_success" => self.handle_train_on_success(arguments).await,
            "predict.next_action" => self.handle_predict_next_action(arguments).await,

            // Attention-based Retrieval
            "attention.retrieve" => self.handle_attention_retrieve(arguments).await,
            "attention.analyze_patterns" => self.handle_analyze_attention_patterns(arguments).await,

            _ => Err(anyhow!("Unknown tool: {}", name)),
        }
    }

    // === Memory Management Handlers ===

    async fn handle_record_episode(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct RecordEpisodeParams {
            task: String,
            queries_made: Option<Vec<String>>,
            files_accessed: Option<Vec<String>>,
            solution: Option<String>,
            outcome: String,
        }

        let params: RecordEpisodeParams = serde_json::from_value(args)
            .context("Invalid parameters for memory.record_episode")?;

        let outcome = match params.outcome.as_str() {
            "success" => Outcome::Success,
            "failure" => Outcome::Failure,
            "partial" => Outcome::Partial,
            _ => return Err(anyhow!("Invalid outcome value")),
        };

        let episode = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: chrono::Utc::now(),
            task_description: params.task,
            initial_context: ContextSnapshot::default(),
            queries_made: params.queries_made.unwrap_or_default(),
            files_touched: params.files_accessed.unwrap_or_default(),
            solution_path: params.solution.unwrap_or_default(),
            outcome,
            tokens_used: TokenCount::zero(),
            access_count: 0,
            pattern_value: 0.0,
        };

        let mut memory = self.memory_system.write().await;
        memory.episodic.record_episode(episode.clone()).await?;

        info!("Recorded episode: {}", episode.id.0);

        Ok(json!({
            "episode_id": episode.id.0,
            "patterns_extracted": [],
            "suggestions": ["Episode recorded for future learning"]
        }))
    }

    async fn handle_find_similar_episodes(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct FindSimilarParams {
            task_description: String,
            limit: Option<usize>,
        }

        let params: FindSimilarParams = serde_json::from_value(args)
            .context("Invalid parameters for memory.find_similar_episodes")?;

        let memory = self.memory_system.read().await;
        let episodes = memory.episodic
            .find_similar(&params.task_description, params.limit.unwrap_or(5))
            .await;

        let episodes_json: Vec<Value> = episodes
            .iter()
            .map(|e| {
                json!({
                    "episode_id": e.id.0,
                    "task": e.task_description,
                    "outcome": e.outcome.to_string(),
                    "tokens_used": e.tokens_used.0,
                    "timestamp": e.timestamp.to_rfc3339(),
                })
            })
            .collect();

        Ok(json!({
            "episodes": episodes_json,
            "recommended_approach": "Review similar successful episodes",
            "predicted_files": []
        }))
    }

    async fn handle_update_working_set(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct UpdateWorkingSetParams {
            focused_symbols: Vec<FocusedSymbol>,
            #[allow(dead_code)]
            accessed_files: Vec<String>,
            #[allow(dead_code)]
            session_id: String,
        }

        #[derive(Deserialize)]
        struct FocusedSymbol {
            symbol: String,
            weight: f32,
        }

        let params: UpdateWorkingSetParams = serde_json::from_value(args)
            .context("Invalid parameters for memory.update_working_set")?;

        let mut memory = self.memory_system.write().await;

        // Update attention weights in working memory
        for focused in params.focused_symbols {
            let symbol_id = SymbolId::new(focused.symbol);
            memory.working.update_attention_weight(&symbol_id, focused.weight);
        }

        // Evict if needed
        memory.working.evict_if_needed()?;

        Ok(json!({
            "updated_context": {
                "active_symbols": memory.working.get_active_count(),
                "total_tokens": memory.working.estimate_tokens()
            },
            "evicted_symbols": [],
            "prefetched_symbols": []
        }))
    }

    // === Context Management Handlers ===

    async fn handle_prepare_adaptive_context(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct PrepareContextParams {
            #[allow(dead_code)]
            request: Value,
            model: String,
            available_tokens: usize,
        }

        let params: PrepareContextParams = serde_json::from_value(args)
            .context("Invalid parameters for context.prepare_adaptive")?;

        let _adapter = match params.model.as_str() {
            "claude-3" => LLMAdapter::claude3(),
            "gpt-4" => LLMAdapter::gpt4(),
            "gemini" => LLMAdapter::gemini(),
            _ => LLMAdapter::custom(params.available_tokens),
        };

        let manager = self.context_manager.read().await;
        let context_request = ContextRequest {
            files: vec![],
            symbols: vec![],
            max_tokens: Some(TokenCount::new(params.available_tokens as u32)),
        };

        let optimized = manager.prepare_context(&context_request)?;

        Ok(json!({
            "context": optimized.content,
            "compression_ratio": optimized.compression_ratio,
            "strategy_used": optimized.strategy,
            "quality_score": optimized.quality_score(),
            "tokens_used": optimized.token_count.0
        }))
    }

    async fn handle_defragment_context(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct DefragmentParams {
            fragments: Vec<String>,
            target_tokens: usize,
        }

        let params: DefragmentParams = serde_json::from_value(args)
            .context("Invalid parameters for context.defragment")?;

        let manager = self.context_manager.read().await;
        let defragmented = manager.defragment_fragments(params.fragments, params.target_tokens)?;

        Ok(json!({
            "unified": defragmented.content,
            "bridges": defragmented.bridges,
            "narrative_flow": defragmented.narrative
        }))
    }

    // === Code Navigation Handlers ===

    async fn handle_search_symbols(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct SearchSymbolsParams {
            query: String,
            #[serde(rename = "type")]
            symbol_types: Option<Vec<String>>,
            scope: Option<String>,
            #[allow(dead_code)]
            detail_level: Option<String>,
            max_results: Option<usize>,
            max_tokens: Option<usize>,
        }

        let params: SearchSymbolsParams = serde_json::from_value(args)
            .context("Invalid parameters for code.search_symbols")?;

        let types = params.symbol_types.map(|types| {
            types
                .iter()
                .filter_map(|t| SymbolKind::from_str(t))
                .collect()
        });

        let query = Query {
            text: params.query,
            symbol_types: types,
            scope: params.scope,
            detail_level: DetailLevel::default(),
            max_results: params.max_results,
            max_tokens: params.max_tokens.map(|t| TokenCount::new(t as u32)),
        };

        use crate::indexer::Indexer;
        let indexer = self.indexer.read().await;
        let results = indexer.search_symbols(&query).await?;

        let symbols_json: Vec<Value> = results
            .symbols
            .iter()
            .map(|s| {
                json!({
                    "id": s.id.0,
                    "name": s.name,
                    "kind": s.kind.as_str(),
                    "signature": s.signature,
                    "location": {
                        "file": s.location.file,
                        "line_start": s.location.line_start,
                        "line_end": s.location.line_end
                    },
                    "token_cost": s.metadata.token_cost.0
                })
            })
            .collect();

        Ok(json!({
            "symbols": symbols_json,
            "total_tokens": results.total_tokens.0,
            "truncated": results.truncated
        }))
    }

    async fn handle_get_definition(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct GetDefinitionParams {
            symbol_id: String,
            #[allow(dead_code)]
            include_body: Option<bool>,
            #[allow(dead_code)]
            include_references: Option<bool>,
            #[allow(dead_code)]
            include_dependencies: Option<bool>,
        }

        let params: GetDefinitionParams = serde_json::from_value(args)
            .context("Invalid parameters for code.get_definition")?;

        use crate::indexer::Indexer;
        let symbol_id = params.symbol_id;
        let indexer = self.indexer.read().await;

        let symbol = indexer
            .get_symbol(&symbol_id)
            .await?
            .ok_or_else(|| anyhow!("Symbol not found"))?;

        let tokens_used = symbol.metadata.token_cost;

        let definition_json = json!({
            "id": symbol.id.0,
            "name": symbol.name,
            "kind": symbol.kind.as_str(),
            "signature": symbol.signature,
            "location": {
                "file": symbol.location.file,
                "line_start": symbol.location.line_start,
                "line_end": symbol.location.line_end
            },
            "doc_comment": symbol.metadata.doc_comment,
            "complexity": symbol.metadata.complexity,
            "token_cost": symbol.metadata.token_cost.0
        });

        Ok(json!({
            "definition": definition_json,
            "tokens_used": tokens_used.0
        }))
    }

    async fn handle_find_references(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct FindReferencesParams {
            symbol_id: String,
            #[allow(dead_code)]
            include_context: Option<bool>,
            #[allow(dead_code)]
            group_by_file: Option<bool>,
        }

        
        let params: FindReferencesParams = serde_json::from_value(args)
            .context("Invalid parameters for code.find_references")?;

        let symbol_id = SymbolId::new(params.symbol_id);
        let indexer = self.indexer.read().await;

        let references = indexer.find_references(&symbol_id).await?;

        let references_json: Vec<Value> = references
            .iter()
            .map(|r| {
                json!({
                    "symbol_id": r.symbol_id.0,
                    "location": {
                        "file": r.location.file,
                        "line_start": r.location.line_start,
                        "line_end": r.location.line_end
                    },
                    "kind": format!("{:?}", r.kind)
                })
            })
            .collect();

        Ok(json!({
            "references": references_json,
            "summary": {
                "total": references.len(),
                "by_file": {}
            }
        }))
    }

    async fn handle_get_dependencies(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct GetDependenciesParams {
            entry_point: String,
            depth: Option<usize>,
            direction: Option<String>,
        }

        use crate::indexer::DependencyDirection;
        let params: GetDependenciesParams = serde_json::from_value(args)
            .context("Invalid parameters for code.get_dependencies")?;

        let symbol_id = SymbolId::new(params.entry_point);
        let indexer = self.indexer.read().await;

        let direction = match params.direction.as_deref() {
            Some("imports") => DependencyDirection::Imports,
            Some("exports") => DependencyDirection::Exports,
            _ => DependencyDirection::Both,
        };

        let dependencies = indexer
            .get_dependencies(&symbol_id, params.depth, direction)
            .await?;

        let deps_json: Vec<Value> = dependencies
            .nodes
            .iter()
            .map(|dep_id| json!({ "symbol_id": dep_id.0 }))
            .collect();

        Ok(json!({
            "graph": {
                "nodes": deps_json,
                "edges": []
            },
            "cycles": []
        }))
    }

    // === Session Management Handlers ===

    async fn handle_begin_session(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct BeginSessionParams {
            task_description: String,
            scope: Option<Vec<String>>,
            base_commit: Option<String>,
        }

        let params: BeginSessionParams = serde_json::from_value(args)
            .context("Invalid parameters for session.begin")?;

        let scope = params
            .scope
            .unwrap_or_default()
            .into_iter()
            .map(PathBuf::from)
            .collect();

        let session_id = self
            .session_manager
            .begin(params.task_description, scope, params.base_commit)
            .await?;

        info!("Started session: {}", session_id.0);

        Ok(json!({
            "session_id": session_id.0,
            "workspace": {
                "active": true,
                "base_commit": null
            }
        }))
    }

    async fn handle_update_session(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct UpdateSessionParams {
            session_id: String,
            path: String,
            content: String,
            reindex: Option<bool>,
        }

        let params: UpdateSessionParams = serde_json::from_value(args)
            .context("Invalid parameters for session.update")?;

        let session_id = SessionId { 0: params.session_id };
        let path = PathBuf::from(params.path);

        let status = self
            .session_manager
            .update(&session_id, path, params.content, params.reindex.unwrap_or(true))
            .await?;

        Ok(json!({
            "status": "updated",
            "affected_symbols": status.affected_symbols.len()
        }))
    }

    async fn handle_session_query(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct SessionQueryParams {
            session_id: String,
            query: String,
            prefer_session: Option<bool>,
        }

        let params: SessionQueryParams = serde_json::from_value(args)
            .context("Invalid parameters for session.query")?;

        let session_id = SessionId { 0: params.session_id };
        let query = Query::new(params.query);

        let results = self
            .session_manager
            .query(&session_id, query, params.prefer_session.unwrap_or(true))
            .await?;

        Ok(json!({
            "results": [],
            "from_session": results.from_session,
            "from_base": results.from_base
        }))
    }

    async fn handle_complete_session(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct CompleteSessionParams {
            session_id: String,
            action: String,
            #[allow(dead_code)]
            commit_message: Option<String>,
        }

        let params: CompleteSessionParams = serde_json::from_value(args)
            .context("Invalid parameters for session.complete")?;

        let session_id = SessionId { 0: params.session_id };
        let action = match params.action.as_str() {
            "commit" => SessionAction::Commit,
            "discard" => SessionAction::Discard,
            "stash" => SessionAction::Stash,
            _ => return Err(anyhow!("Invalid action")),
        };

        let result = self.session_manager.complete(&session_id, action).await?;

        info!("Completed session: {} with action: {:?}", result.session_id.0, result.action);

        Ok(json!({
            "result": format!("{:?}", result.action),
            "changes_summary": {
                "total_deltas": result.changes_summary.total_deltas,
                "affected_symbols": result.changes_summary.affected_symbols,
                "files_modified": result.changes_summary.files_modified
            }
        }))
    }

    // === Feedback and Learning Handlers ===

    async fn handle_mark_useful(&self, _args: Value) -> Result<Value> {
        // Placeholder implementation
        Ok(json!({
            "feedback_id": uuid::Uuid::new_v4().to_string(),
            "model_updated": false
        }))
    }

    async fn handle_train_on_success(&self, _args: Value) -> Result<Value> {
        // Placeholder implementation
        Ok(json!({
            "patterns_learned": [],
            "procedure_updated": false,
            "confidence": 0.0
        }))
    }

    async fn handle_predict_next_action(&self, _args: Value) -> Result<Value> {
        // Placeholder implementation
        Ok(json!({
            "predicted_actions": [],
            "suggested_queries": [],
            "confidence_scores": []
        }))
    }

    async fn handle_attention_retrieve(&self, _args: Value) -> Result<Value> {
        // Placeholder implementation
        Ok(json!({
            "high_attention": [],
            "medium_attention": [],
            "context_symbols": [],
            "total_tokens": 0
        }))
    }

    async fn handle_analyze_attention_patterns(&self, _args: Value) -> Result<Value> {
        // Placeholder implementation
        Ok(json!({
            "patterns": [],
            "focus_areas": [],
            "attention_drift": 0.0
        }))
    }
}
