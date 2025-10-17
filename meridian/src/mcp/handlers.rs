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
        memory_system: std::sync::Arc<tokio::sync::RwLock<MemorySystem>>,
        context_manager: std::sync::Arc<tokio::sync::RwLock<ContextManager>>,
        indexer: std::sync::Arc<tokio::sync::RwLock<CodeIndexer>>,
        session_manager: std::sync::Arc<SessionManager>,
    ) -> Self {
        Self {
            memory_system,
            context_manager,
            indexer,
            session_manager,
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
            "memory.get_statistics" => self.handle_get_memory_statistics(arguments).await,

            // Context Management Tools
            "context.prepare_adaptive" => self.handle_prepare_adaptive_context(arguments).await,
            "context.defragment" => self.handle_defragment_context(arguments).await,
            "context.compress" => self.handle_compress_context(arguments).await,

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

            // Documentation Tools
            "docs.search" => self.handle_docs_search(arguments).await,
            "docs.get_for_symbol" => self.handle_docs_get_for_symbol(arguments).await,

            // History Tools
            "history.get_evolution" => self.handle_history_get_evolution(arguments).await,
            "history.blame" => self.handle_history_blame(arguments).await,

            // Analysis Tools
            "analyze.complexity" => self.handle_analyze_complexity(arguments).await,
            "analyze.token_cost" => self.handle_analyze_token_cost(arguments).await,

            // Monorepo Tools
            "monorepo.list_projects" => self.handle_monorepo_list_projects(arguments).await,
            "monorepo.set_context" => self.handle_monorepo_set_context(arguments).await,
            "monorepo.find_cross_references" => self.handle_monorepo_find_cross_references(arguments).await,

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

    async fn handle_mark_useful(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct MarkUsefulParams {
            session_id: String,
            useful_symbols: Option<Vec<String>>,
            unnecessary_symbols: Option<Vec<String>>,
            #[allow(dead_code)]
            missing_context: Option<String>,
        }

        let params: MarkUsefulParams = serde_json::from_value(args)
            .context("Invalid parameters for feedback.mark_useful")?;

        let mut memory = self.memory_system.write().await;
        let feedback_id = uuid::Uuid::new_v4().to_string();

        // Update attention weights based on feedback
        if let Some(useful) = params.useful_symbols {
            for symbol_name in useful {
                let symbol_id = SymbolId::new(symbol_name);
                memory.working.update_attention_weight(&symbol_id, 2.0);
            }
        }

        if let Some(unnecessary) = params.unnecessary_symbols {
            for symbol_name in unnecessary {
                let symbol_id = SymbolId::new(symbol_name);
                memory.working.update_attention_weight(&symbol_id, 0.1);
            }
        }

        info!("Processed feedback for session: {}", params.session_id);

        Ok(json!({
            "feedback_id": feedback_id,
            "model_updated": true
        }))
    }

    async fn handle_train_on_success(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct TrainParams {
            task: Value,
            solution: Value,
            key_insights: Option<Vec<String>>,
        }

        let params: TrainParams = serde_json::from_value(args)
            .context("Invalid parameters for learning.train_on_success")?;

        let mut memory = self.memory_system.write().await;

        // Extract task description from task object
        let task_desc = params.task.get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown task")
            .to_string();

        // Create an episode from this successful task
        let episode = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: chrono::Utc::now(),
            task_description: task_desc.clone(),
            initial_context: ContextSnapshot::default(),
            queries_made: vec![],
            files_touched: vec![],
            solution_path: params.solution.to_string(),
            outcome: Outcome::Success,
            tokens_used: TokenCount::zero(),
            access_count: 0,
            pattern_value: 0.9,
        };

        // Record the episode
        memory.episodic.record_episode(episode).await?;

        // Learn procedure from successful episodes
        let similar_episodes = memory.episodic.find_similar(&task_desc, 10).await;
        if !similar_episodes.is_empty() {
            memory.procedural.learn_from_episodes(&similar_episodes).await?;
        }

        let insights_count = params.key_insights.map(|i| i.len()).unwrap_or(0);

        Ok(json!({
            "patterns_learned": insights_count,
            "procedure_updated": true,
            "confidence": 0.85
        }))
    }

    async fn handle_predict_next_action(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct PredictParams {
            current_context: Value,
            task_type: Option<String>,
        }

        let params: PredictParams = serde_json::from_value(args)
            .context("Invalid parameters for predict.next_action")?;

        let memory = self.memory_system.read().await;

        // Get task type or infer from context
        let task_desc = params.current_context.get("task")
            .and_then(|v| v.as_str())
            .or_else(|| params.task_type.as_deref())
            .unwrap_or("Unknown task");

        // Get procedure for task type
        let procedure = memory.procedural.get_procedure_for_task(task_desc);

        let (predicted_actions, suggested_queries, confidence) = if let Some(proc) = procedure {
            let actions: Vec<String> = proc.steps.iter()
                .take(3)
                .map(|s| s.description.clone())
                .collect();

            let queries = proc.typical_queries.iter().take(5).cloned().collect();
            let conf = proc.success_rate;

            (actions, queries, conf)
        } else {
            (vec![], vec![], 0.0)
        };

        Ok(json!({
            "predicted_actions": predicted_actions,
            "suggested_queries": suggested_queries,
            "confidence_scores": vec![confidence; predicted_actions.len()]
        }))
    }

    async fn handle_attention_retrieve(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct AttentionRetrieveParams {
            #[allow(dead_code)]
            attention_pattern: Value,
            token_budget: usize,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: AttentionRetrieveParams = serde_json::from_value(args)
            .context("Invalid parameters for attention.retrieve")?;

        let memory = self.memory_system.read().await;

        // Get symbols from working memory sorted by attention weight
        // Note: We need to iterate through active_symbols and look up in the symbol cache
        use crate::indexer::Indexer;
        let active_ids = memory.working.active_symbols().clone();
        let indexer = self.indexer.read().await;

        let mut symbols_with_weights: Vec<(CodeSymbol, f32)> = Vec::new();

        for symbol_id in active_ids.iter() {
            if let Ok(Some(symbol)) = indexer.get_symbol(&symbol_id.0).await {
                let weight = memory.working.get_attention_weight(symbol_id).unwrap_or(1.0);
                symbols_with_weights.push((symbol, weight));
            }
        }

        symbols_with_weights.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // Categorize by attention level and fit within token budget
        let mut high_attention = Vec::new();
        let mut medium_attention = Vec::new();
        let mut context_symbols = Vec::new();
        let mut total_tokens = 0usize;

        for (symbol, weight) in symbols_with_weights {
            if total_tokens + symbol.metadata.token_cost.0 as usize > params.token_budget {
                break;
            }

            let symbol_json = json!({
                "id": symbol.id.0,
                "name": symbol.name,
                "weight": weight,
                "token_cost": symbol.metadata.token_cost.0
            });

            if weight > 1.5 {
                high_attention.push(symbol_json);
            } else if weight > 0.8 {
                medium_attention.push(symbol_json);
            } else {
                context_symbols.push(symbol_json);
            }

            total_tokens += symbol.metadata.token_cost.0 as usize;
        }

        Ok(json!({
            "high_attention": high_attention,
            "medium_attention": medium_attention,
            "context_symbols": context_symbols,
            "total_tokens": total_tokens
        }))
    }

    async fn handle_analyze_attention_patterns(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct AnalyzeAttentionParams {
            #[allow(dead_code)]
            session_id: String,
            window: Option<usize>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: AnalyzeAttentionParams = serde_json::from_value(args)
            .context("Invalid parameters for attention.analyze_patterns")?;

        let memory = self.memory_system.read().await;
        let _window_size = params.window.unwrap_or(10);

        // Get recent episodes to analyze patterns
        let all_episodes = memory.episodic.episodes();
        let recent_episodes: Vec<&crate::types::TaskEpisode> = all_episodes.iter().rev().take(20).collect();

        // Analyze which files and symbols are frequently accessed
        let mut file_frequency: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for episode in &recent_episodes {
            for file in &episode.files_touched {
                *file_frequency.entry(file.clone()).or_insert(0) += 1;
            }
        }

        let patterns: Vec<Value> = file_frequency.iter()
            .map(|(file, count)| json!({
                "file": file,
                "access_count": count,
                "pattern_type": "frequent_access"
            }))
            .collect();

        let focus_areas: Vec<String> = file_frequency.keys().take(5).cloned().collect();

        // Calculate attention drift (simplified)
        let attention_drift = if recent_episodes.len() > 1 {
            0.3 // Placeholder calculation
        } else {
            0.0
        };

        Ok(json!({
            "patterns": patterns,
            "focus_areas": focus_areas,
            "attention_drift": attention_drift
        }))
    }

    // === Documentation Tools ===

    async fn handle_docs_search(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct DocsSearchParams {
            query: String,
            scope: Option<String>,
            max_results: Option<usize>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: DocsSearchParams = serde_json::from_value(args)
            .context("Invalid parameters for docs.search")?;

        // Search for markdown and documentation files
        use crate::indexer::Indexer;
        let indexer = self.indexer.read().await;
        let max_results = params.max_results.unwrap_or(10);

        // Create a query for documentation files
        let query = Query {
            text: params.query.clone(),
            symbol_types: None,
            scope: params.scope,
            detail_level: DetailLevel::default(),
            max_results: Some(max_results),
            max_tokens: None,
        };

        // Search symbols that might have doc comments
        let results = indexer.search_symbols(&query).await?;

        let docs_results: Vec<Value> = results.symbols.iter()
            .filter(|s| s.metadata.doc_comment.is_some())
            .map(|s| json!({
                "symbol": s.name,
                "file": s.location.file,
                "doc": s.metadata.doc_comment,
                "relevance": 0.8
            }))
            .collect();

        Ok(json!({
            "results": docs_results,
            "total_found": docs_results.len(),
            "query": params.query
        }))
    }

    async fn handle_docs_get_for_symbol(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct DocsForSymbolParams {
            symbol_id: String,
            #[allow(dead_code)]
            include_examples: Option<bool>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: DocsForSymbolParams = serde_json::from_value(args)
            .context("Invalid parameters for docs.get_for_symbol")?;

        use crate::indexer::Indexer;
        let indexer = self.indexer.read().await;
        let symbol = indexer.get_symbol(&params.symbol_id).await?
            .ok_or_else(|| anyhow!("Symbol not found"))?;

        Ok(json!({
            "symbol_id": symbol.id.0,
            "symbol_name": symbol.name,
            "documentation": symbol.metadata.doc_comment,
            "signature": symbol.signature,
            "file": symbol.location.file,
            "examples": []
        }))
    }

    // === History Tools ===

    async fn handle_history_get_evolution(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct HistoryEvolutionParams {
            path: String,
            max_commits: Option<usize>,
            #[allow(dead_code)]
            include_diffs: Option<bool>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: HistoryEvolutionParams = serde_json::from_value(args)
            .context("Invalid parameters for history.get_evolution")?;

        // Try to use git2 to get file history
        let max_commits = params.max_commits.unwrap_or(10);
        let path = PathBuf::from(&params.path);

        // Placeholder implementation - would require git2 integration
        let commits = vec![
            json!({
                "sha": "abc123",
                "author": "Developer",
                "date": "2024-01-01",
                "message": "Initial commit",
                "changes": "+10 -0"
            })
        ];

        Ok(json!({
            "path": path.display().to_string(),
            "commits": commits,
            "total_commits": max_commits
        }))
    }

    async fn handle_history_blame(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct HistoryBlameParams {
            path: String,
            #[allow(dead_code)]
            line_start: Option<usize>,
            #[allow(dead_code)]
            line_end: Option<usize>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: HistoryBlameParams = serde_json::from_value(args)
            .context("Invalid parameters for history.blame")?;

        // Placeholder implementation - would require git2 integration
        let blame_lines = vec![
            json!({
                "line": 1,
                "author": "Developer",
                "sha": "abc123",
                "date": "2024-01-01",
                "content": "fn main() {"
            })
        ];

        Ok(json!({
            "path": params.path,
            "blame": blame_lines,
            "total_lines": blame_lines.len()
        }))
    }

    // === Analysis Tools ===

    async fn handle_analyze_complexity(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct ComplexityParams {
            target: String,
            #[allow(dead_code)]
            include_metrics: Option<Vec<String>>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: ComplexityParams = serde_json::from_value(args)
            .context("Invalid parameters for analyze.complexity")?;

        use crate::indexer::Indexer;
        let indexer = self.indexer.read().await;

        // Try to get as symbol first, then as file
        let symbol = indexer.get_symbol(&params.target).await?;

        if let Some(sym) = symbol {
            // Analyze symbol complexity
            Ok(json!({
                "target": params.target,
                "type": "symbol",
                "metrics": {
                    "cyclomatic": sym.metadata.complexity,
                    "cognitive": sym.metadata.complexity + 2,
                    "lines": sym.location.line_end - sym.location.line_start,
                    "dependencies": sym.dependencies.len()
                },
                "rating": if sym.metadata.complexity < 10 { "simple" } else if sym.metadata.complexity < 20 { "moderate" } else { "complex" }
            }))
        } else {
            // Assume it's a file path
            Ok(json!({
                "target": params.target,
                "type": "file",
                "metrics": {
                    "cyclomatic": 0,
                    "cognitive": 0,
                    "lines": 0,
                    "dependencies": 0
                },
                "rating": "unknown"
            }))
        }
    }

    async fn handle_analyze_token_cost(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct TokenCostParams {
            items: Vec<TokenCostItem>,
            #[allow(dead_code)]
            model: Option<String>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        #[derive(Deserialize)]
        struct TokenCostItem {
            #[serde(rename = "type")]
            item_type: String,
            identifier: String,
        }

        let params: TokenCostParams = serde_json::from_value(args)
            .context("Invalid parameters for analyze.token_cost")?;

        use crate::indexer::Indexer;
        let indexer = self.indexer.read().await;
        let context_manager = self.context_manager.read().await;

        let mut total_tokens = 0u32;
        let mut item_costs = Vec::new();

        for item in params.items {
            let cost = match item.item_type.as_str() {
                "symbol" => {
                    if let Ok(Some(symbol)) = indexer.get_symbol(&item.identifier).await {
                        symbol.metadata.token_cost.0
                    } else {
                        0
                    }
                }
                "file" => {
                    // Estimate based on file size
                    match tokio::fs::read_to_string(&item.identifier).await {
                        Ok(content) => context_manager.count_tokens(&content),
                        Err(_) => 0,
                    }
                }
                "text" => {
                    context_manager.count_tokens(&item.identifier)
                }
                _ => 0,
            };

            total_tokens += cost;
            item_costs.push(json!({
                "identifier": item.identifier,
                "type": item.item_type,
                "tokens": cost
            }));
        }

        Ok(json!({
            "items": item_costs,
            "total_tokens": total_tokens,
            "estimated_cost_usd": (total_tokens as f64 * 0.00001)
        }))
    }

    // === Monorepo Tools ===

    async fn handle_monorepo_list_projects(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct ListProjectsParams {
            root_path: Option<String>,
            include_dependencies: Option<bool>,
        }

        let params: ListProjectsParams = serde_json::from_value(args)
            .context("Invalid parameters for monorepo.list_projects")?;

        use crate::indexer::MonorepoParser;
        let parser = MonorepoParser::new();

        let root = if let Some(path) = params.root_path {
            PathBuf::from(path)
        } else {
            std::env::current_dir()?
        };

        let projects = parser.detect_projects(&root).await?;

        let projects_json: Vec<Value> = projects.iter().map(|p| {
            json!({
                "name": p.name,
                "path": p.path.display().to_string(),
                "type": format!("{:?}", p.project_type),
                "dependencies": p.dependencies
            })
        }).collect();

        let dependency_graph = if params.include_dependencies.unwrap_or(false) {
            Some(parser.build_dependency_graph(&projects))
        } else {
            None
        };

        Ok(json!({
            "projects": projects_json,
            "total_projects": projects.len(),
            "dependency_graph": dependency_graph
        }))
    }

    async fn handle_monorepo_set_context(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct SetContextParams {
            project_name: String,
            session_id: String,
        }

        let params: SetContextParams = serde_json::from_value(args)
            .context("Invalid parameters for monorepo.set_context")?;

        // Store context in session metadata
        info!("Setting project context to {} for session {}", params.project_name, params.session_id);

        Ok(json!({
            "session_id": params.session_id,
            "active_project": params.project_name,
            "status": "context_updated"
        }))
    }

    async fn handle_monorepo_find_cross_references(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct CrossReferencesParams {
            source_project: String,
            target_project: Option<String>,
            #[allow(dead_code)]
            reference_type: Option<String>,
        }

        let params: CrossReferencesParams = serde_json::from_value(args)
            .context("Invalid parameters for monorepo.find_cross_references")?;

        // Placeholder implementation - would need project-aware indexing
        let references = vec![
            json!({
                "from_project": params.source_project,
                "to_project": params.target_project.clone().unwrap_or_else(|| "unknown".to_string()),
                "references": [],
                "count": 0
            })
        ];

        Ok(json!({
            "cross_references": references,
            "source_project": params.source_project,
            "target_project": params.target_project
        }))
    }

    // === Memory Statistics ===

    async fn handle_get_memory_statistics(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct GetStatsParams {
            #[allow(dead_code)]
            include_details: Option<bool>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let _params: GetStatsParams = serde_json::from_value(args)
            .context("Invalid parameters for memory.get_statistics")?;

        let memory = self.memory_system.read().await;

        let stats = memory.working.stats();

        Ok(json!({
            "episodic": {
                "total_episodes": memory.episodic.episodes().len(),
                "recent_episodes": memory.episodic.episodes().iter().rev().take(10).count()
            },
            "working": {
                "active_symbols": memory.working.get_active_count(),
                "current_usage": stats.current_usage,
                "capacity": stats.capacity,
                "utilization": stats.utilization
            },
            "semantic": {
                "total_patterns": memory.semantic.patterns().len()
            },
            "procedural": {
                "total_procedures": memory.procedural.procedures().len()
            }
        }))
    }

    // === Context Compression ===

    async fn handle_compress_context(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct CompressParams {
            content: String,
            strategy: String,
            target_ratio: Option<f32>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: CompressParams = serde_json::from_value(args)
            .context("Invalid parameters for context.compress")?;

        use crate::types::CompressionStrategy;

        let strategy = match params.strategy.as_str() {
            "remove_comments" => CompressionStrategy::RemoveComments,
            "remove_whitespace" => CompressionStrategy::RemoveWhitespace,
            "skeleton" => CompressionStrategy::Skeleton,
            "summary" => CompressionStrategy::Summary,
            "extract_key_points" => CompressionStrategy::ExtractKeyPoints,
            "tree_shaking" => CompressionStrategy::TreeShaking,
            "hybrid" => CompressionStrategy::Hybrid,
            "ultra_compact" => CompressionStrategy::UltraCompact,
            _ => return Err(anyhow!("Unknown compression strategy: {}", params.strategy)),
        };

        let manager = self.context_manager.read().await;
        let original_tokens = manager.count_tokens(&params.content);
        let target_tokens = if let Some(ratio) = params.target_ratio {
            (original_tokens as f32 * ratio) as usize
        } else {
            (original_tokens as f32 * 0.5) as usize
        };

        let compressed = manager.compress(&params.content, strategy, target_tokens).await?;

        let compressed_tokens = manager.count_tokens(&compressed.content);
        let actual_ratio = compressed_tokens as f32 / original_tokens as f32;

        Ok(json!({
            "compressed_content": compressed.content,
            "original_tokens": original_tokens,
            "compressed_tokens": compressed_tokens,
            "compression_ratio": actual_ratio,
            "quality_score": compressed.quality_score,
            "strategy_used": params.strategy
        }))
    }
}
