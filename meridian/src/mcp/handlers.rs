use crate::context::ContextManager;
use crate::docs::DocIndexer;
use crate::git::GitHistory;
use crate::indexer::CodeIndexer;
use crate::memory::MemorySystem;
use crate::session::{SessionAction, SessionManager};
use crate::specs::SpecificationManager;
use crate::types::*;
use anyhow::{Context as _, Result, anyhow};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{debug, info};

/// Handler for all MCP tool calls
pub struct ToolHandlers {
    memory_system: Arc<tokio::sync::RwLock<MemorySystem>>,
    context_manager: Arc<tokio::sync::RwLock<ContextManager>>,
    indexer: Arc<tokio::sync::RwLock<CodeIndexer>>,
    session_manager: Arc<SessionManager>,
    doc_indexer: Arc<DocIndexer>,
    spec_manager: Arc<tokio::sync::RwLock<SpecificationManager>>,
}

impl ToolHandlers {
    pub fn new(
        memory_system: Arc<tokio::sync::RwLock<MemorySystem>>,
        context_manager: Arc<tokio::sync::RwLock<ContextManager>>,
        indexer: Arc<tokio::sync::RwLock<CodeIndexer>>,
        session_manager: Arc<SessionManager>,
        doc_indexer: Arc<DocIndexer>,
        spec_manager: Arc<tokio::sync::RwLock<SpecificationManager>>,
    ) -> Self {
        Self {
            memory_system,
            context_manager,
            indexer,
            session_manager,
            doc_indexer,
            spec_manager,
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

            // Specification Tools
            "specs.list" => self.handle_specs_list(arguments).await,
            "specs.get_structure" => self.handle_specs_get_structure(arguments).await,
            "specs.get_section" => self.handle_specs_get_section(arguments).await,
            "specs.search" => self.handle_specs_search(arguments).await,
            "specs.validate" => self.handle_specs_validate(arguments).await,

            // Strong Catalog Tools (Phase 3)
            "strong.catalog.list_projects" => self.handle_strong_catalog_list_projects(arguments).await,
            "strong.catalog.get_project" => self.handle_strong_catalog_get_project(arguments).await,
            "strong.catalog.search_documentation" => self.handle_strong_catalog_search_documentation(arguments).await,

            // Strong Documentation Tools (Phase 3)
            "strong.docs.generate" => self.handle_strong_docs_generate(arguments).await,
            "strong.docs.validate" => self.handle_strong_docs_validate(arguments).await,
            "strong.docs.transform" => self.handle_strong_docs_transform(arguments).await,

            // Strong Example Tools (Phase 4)
            "strong.examples.generate" => self.handle_strong_examples_generate(arguments).await,
            "strong.examples.validate" => self.handle_strong_examples_validate(arguments).await,

            // Strong Test Tools (Phase 4)
            "strong.tests.generate" => self.handle_strong_tests_generate(arguments).await,
            "strong.tests.validate" => self.handle_strong_tests_validate(arguments).await,

            // Strong Global Tools (Phase 5)
            "strong.global.list_monorepos" => self.handle_strong_global_list_monorepos(arguments).await,
            "strong.global.search_all_projects" => self.handle_strong_global_search_all_projects(arguments).await,
            "strong.global.get_dependency_graph" => self.handle_strong_global_get_dependency_graph(arguments).await,

            // Strong External Tools (Phase 5)
            "strong.external.get_documentation" => self.handle_strong_external_get_documentation(arguments).await,
            "strong.external.find_usages" => self.handle_strong_external_find_usages(arguments).await,

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
                .filter_map(|t| SymbolKind::from_string(t))
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

        let session_id = SessionId(params.session_id);
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

        let session_id = SessionId(params.session_id);
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

        let session_id = SessionId(params.session_id);
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

        // Extract task description and metadata from task object
        let task_desc = params.task.get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown task")
            .to_string();

        // Extract queries made if available
        let queries_made: Vec<String> = params.task.get("queries_made")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        // Extract files accessed if available
        let files_touched: Vec<String> = params.task.get("files_accessed")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        // Extract solution path
        let solution_path = if let Some(sol_str) = params.solution.as_str() {
            sol_str.to_string()
        } else {
            params.solution.to_string()
        };

        // Extract tokens used if available
        let tokens_used = params.task.get("tokens_used")
            .and_then(|v| v.as_u64())
            .map(|t| TokenCount::new(t as u32))
            .unwrap_or_else(TokenCount::zero);

        // Create a rich episode from this successful task
        let episode = TaskEpisode {
            id: EpisodeId::new(),
            timestamp: chrono::Utc::now(),
            task_description: task_desc.clone(),
            initial_context: ContextSnapshot {
                active_files: files_touched.clone(),
                active_symbols: vec![],
                working_directory: None,
            },
            queries_made: queries_made.clone(),
            files_touched: files_touched.clone(),
            solution_path: solution_path.clone(),
            outcome: Outcome::Success,
            tokens_used,
            access_count: 0,
            pattern_value: 0.9,
        };

        info!("Recording successful episode: {} - {}", episode.id.0, task_desc);

        // Record the episode in episodic memory
        memory.episodic.record_episode(episode.clone()).await?;

        // Find similar successful episodes for pattern extraction
        let similar_episodes = memory.episodic.find_similar(&task_desc, 10).await;
        debug!("Found {} similar episodes for learning", similar_episodes.len());

        let mut patterns_learned = 0;
        let mut procedure_updated = false;

        // Learn patterns from semantic memory
        if !similar_episodes.is_empty() {
            memory.semantic.learn_patterns(&similar_episodes).await?;
            patterns_learned = memory.semantic.patterns().len();
            debug!("Learned {} semantic patterns", patterns_learned);
        }

        // Learn or update procedural knowledge
        let all_similar = {
            let mut all = similar_episodes;
            all.push(episode.clone());
            all
        };

        if all_similar.len() >= 2 {
            memory.procedural.learn_from_episodes(&all_similar).await?;
            procedure_updated = true;
            info!("Updated procedural memory with {} episodes", all_similar.len());
        }

        // Extract patterns from key insights if provided
        if let Some(insights) = params.key_insights {
            for insight in &insights {
                debug!("Processing insight: {}", insight);
            }
        }

        // Calculate confidence based on number of similar episodes
        let confidence = (all_similar.len() as f32 / 10.0).min(1.0) * 0.9 + 0.1;

        info!(
            "Training complete: {} patterns learned, procedure_updated={}, confidence={:.2}",
            patterns_learned, procedure_updated, confidence
        );

        Ok(json!({
            "patterns_learned": patterns_learned,
            "procedure_updated": procedure_updated,
            "confidence": confidence,
            "similar_episodes_count": all_similar.len() - 1,
            "episode_id": episode.id.0
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

        // Get task description from context
        let task_desc = params.current_context.get("task")
            .and_then(|v| v.as_str())
            .or(params.task_type.as_deref())
            .unwrap_or("Unknown task");

        // Extract completed steps if available
        let completed_steps: Vec<String> = params.current_context.get("completed_steps")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        debug!("Predicting next actions for task: '{}', completed steps: {:?}", task_desc, completed_steps);

        // Get procedure for task type using ProceduralMemory
        let procedure = memory.procedural.get_procedure_for_task(task_desc);

        let (predicted_actions, suggested_queries, confidence_scores, predicted_files) = if let Some(proc) = procedure {
            info!(
                "Found procedure for task with {} steps, success_rate: {:.2}",
                proc.steps.len(),
                proc.success_rate
            );

            // Get next steps that haven't been completed yet
            let mut next_steps = Vec::new();
            let mut step_confidences = Vec::new();

            for step in &proc.steps {
                // Check if step was completed
                let is_completed = completed_steps.iter().any(|completed| {
                    step.description.to_lowercase().contains(&completed.to_lowercase())
                        || completed.to_lowercase().contains(&step.description.to_lowercase())
                });

                if !is_completed {
                    // Calculate confidence for this step
                    let step_confidence = if step.optional {
                        proc.success_rate * 0.7 // Lower confidence for optional steps
                    } else {
                        proc.success_rate
                    };

                    next_steps.push(json!({
                        "description": step.description,
                        "typical_actions": step.typical_actions,
                        "expected_files": step.expected_files,
                        "optional": step.optional,
                        "order": step.order
                    }));

                    step_confidences.push(step_confidence);

                    // Return top 3 most likely next actions
                    if next_steps.len() >= 3 {
                        break;
                    }
                }
            }

            // If all steps completed, check for optional steps
            if next_steps.is_empty() {
                for step in proc.steps.iter().filter(|s| s.optional) {
                    next_steps.push(json!({
                        "description": step.description,
                        "typical_actions": step.typical_actions,
                        "expected_files": step.expected_files,
                        "optional": true,
                        "order": step.order
                    }));
                    step_confidences.push(proc.success_rate * 0.5);

                    if next_steps.len() >= 3 {
                        break;
                    }
                }
            }

            // Get top 5 typical queries for this task type
            let queries: Vec<String> = proc.typical_queries.iter().take(5).cloned().collect();

            // Get predicted files from required context
            let files: Vec<String> = proc.required_context.iter().take(5).cloned().collect();

            (next_steps, queries, step_confidences, files)
        } else {
            // No procedure found - try to find similar episodes
            debug!("No procedure found, searching for similar episodes");

            let similar_episodes = memory.episodic.find_similar(task_desc, 5).await;

            if !similar_episodes.is_empty() {
                // Extract common actions from similar episodes
                let mut action_frequency = std::collections::HashMap::<String, usize>::new();
                let mut query_frequency = std::collections::HashMap::<String, usize>::new();
                let mut file_frequency = std::collections::HashMap::<String, usize>::new();

                for episode in &similar_episodes {
                    // Count solution path steps
                    for step in episode.solution_path.split(['.', ',', ';']) {
                        let trimmed = step.trim();
                        if !trimmed.is_empty() {
                            *action_frequency.entry(trimmed.to_string()).or_insert(0) += 1;
                        }
                    }

                    // Count queries
                    for query in &episode.queries_made {
                        *query_frequency.entry(query.clone()).or_insert(0) += 1;
                    }

                    // Count files
                    for file in &episode.files_touched {
                        *file_frequency.entry(file.clone()).or_insert(0) += 1;
                    }
                }

                // Get top 3 actions by frequency
                let mut actions: Vec<(String, usize)> = action_frequency.into_iter().collect();
                actions.sort_by(|a, b| b.1.cmp(&a.1));

                let predicted_actions: Vec<Value> = actions.iter().take(3)
                    .map(|(action, freq)| json!({
                        "description": action,
                        "frequency": freq,
                        "source": "similar_episodes"
                    }))
                    .collect();

                // Get top 5 queries
                let mut queries: Vec<(String, usize)> = query_frequency.into_iter().collect();
                queries.sort_by(|a, b| b.1.cmp(&a.1));
                let suggested_queries: Vec<String> = queries.iter().take(5)
                    .map(|(q, _)| q.clone())
                    .collect();

                // Get top 5 files
                let mut files: Vec<(String, usize)> = file_frequency.into_iter().collect();
                files.sort_by(|a, b| b.1.cmp(&a.1));
                let predicted_files: Vec<String> = files.iter().take(5)
                    .map(|(f, _)| f.clone())
                    .collect();

                // Calculate confidence based on episode count and consistency
                let avg_frequency = if !actions.is_empty() {
                    actions.iter().map(|(_, f)| *f as f32).sum::<f32>() / actions.len() as f32
                } else {
                    0.0
                };
                let confidence = (avg_frequency / similar_episodes.len() as f32).min(1.0);
                let confidences = vec![confidence; predicted_actions.len()];

                info!("Predicted {} actions from {} similar episodes (confidence: {:.2})",
                    predicted_actions.len(), similar_episodes.len(), confidence);

                (predicted_actions, suggested_queries, confidences, predicted_files)
            } else {
                // No similar episodes found
                info!("No similar episodes found for task: '{}'", task_desc);
                (vec![], vec![], vec![], vec![])
            }
        };

        Ok(json!({
            "predicted_actions": predicted_actions,
            "suggested_queries": suggested_queries,
            "confidence_scores": confidence_scores,
            "predicted_files": predicted_files,
            "has_procedure": procedure.is_some()
        }))
    }

    async fn handle_attention_retrieve(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct AttentionRetrieveParams {
            attention_pattern: Value,
            token_budget: usize,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: AttentionRetrieveParams = serde_json::from_value(args)
            .context("Invalid parameters for attention.retrieve")?;

        let memory = self.memory_system.read().await;

        // Extract focused symbols from attention pattern
        let focused_symbols: Vec<String> = params.attention_pattern.get("focused_symbols")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        debug!("Retrieving context for {} focused symbols with budget {} tokens", focused_symbols.len(), params.token_budget);

        // Get symbols from working memory sorted by attention weight
        use crate::indexer::Indexer;
        let active_ids = memory.working.active_symbols().clone();
        let indexer = self.indexer.read().await;

        let mut symbols_with_weights: Vec<(CodeSymbol, f32, bool)> = Vec::new();

        // First pass: load active symbols with their weights
        for symbol_id in active_ids.iter() {
            if let Ok(Some(symbol)) = indexer.get_symbol(&symbol_id.0).await {
                let weight = memory.working.get_attention_weight(symbol_id).unwrap_or(1.0);
                let is_focused = focused_symbols.contains(&symbol.name);
                symbols_with_weights.push((symbol, weight, is_focused));
            }
        }

        // Boost weights for currently focused symbols
        for (_, weight, is_focused) in &mut symbols_with_weights {
            if *is_focused {
                *weight *= 1.5; // Boost focused symbols
            }
        }

        // Sort by weight (descending)
        symbols_with_weights.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // Categorize by attention level and fit within token budget
        let mut high_attention = Vec::new();
        let mut medium_attention = Vec::new();
        let mut context_symbols = Vec::new();
        let mut prefetched_symbols = Vec::new();
        let mut total_tokens = 0usize;

        // Reserve 20% of budget for prefetching related symbols
        let main_budget = (params.token_budget as f32 * 0.8) as usize;
        let prefetch_budget = params.token_budget - main_budget;

        // First pass: categorize existing symbols within main budget
        for (symbol, weight, _is_focused) in &symbols_with_weights {
            if total_tokens + symbol.metadata.token_cost.0 as usize > main_budget {
                break;
            }

            let symbol_json = json!({
                "id": symbol.id.0,
                "name": symbol.name,
                "kind": symbol.kind.as_str(),
                "weight": weight,
                "token_cost": symbol.metadata.token_cost.0,
                "location": {
                    "file": symbol.location.file,
                    "line_start": symbol.location.line_start
                }
            });

            // Categorize based on attention weight
            if *weight > 1.5 {
                high_attention.push(symbol_json);
            } else if *weight > 0.8 {
                medium_attention.push(symbol_json);
            } else {
                context_symbols.push(symbol_json);
            }

            total_tokens += symbol.metadata.token_cost.0 as usize;
        }

        // Second pass: prefetch related symbols for high-attention symbols
        let mut prefetch_tokens = 0usize;
        let mut prefetched_ids = std::collections::HashSet::new();

        for (symbol, _weight, _) in symbols_with_weights.iter().filter(|(_, w, _)| *w > 1.5) {
            if prefetch_tokens >= prefetch_budget {
                break;
            }

            // Get related symbols using semantic memory
            let related = memory.semantic.find_related_symbols(&symbol.id);

            for rel in related.iter().take(3) {
                // Don't prefetch if already in working memory
                if active_ids.contains(&rel.to) || prefetched_ids.contains(&rel.to.0) {
                    continue;
                }

                if let Ok(Some(related_symbol)) = indexer.get_symbol(&rel.to.0).await {
                    if prefetch_tokens + related_symbol.metadata.token_cost.0 as usize <= prefetch_budget {
                        prefetched_symbols.push(json!({
                            "id": related_symbol.id.0,
                            "name": related_symbol.name,
                            "kind": related_symbol.kind.as_str(),
                            "relationship": format!("{:?}", rel.relationship_type),
                            "strength": rel.strength,
                            "token_cost": related_symbol.metadata.token_cost.0
                        }));

                        prefetched_ids.insert(rel.to.0.clone());
                        prefetch_tokens += related_symbol.metadata.token_cost.0 as usize;
                    }
                }
            }
        }

        total_tokens += prefetch_tokens;

        // Get eviction history for recommendations
        let eviction_history = memory.working.eviction_history();
        let recently_evicted: Vec<String> = eviction_history.iter()
            .rev()
            .take(5)
            .map(|s| s.0.clone())
            .collect();

        info!(
            "Retrieved {} high, {} medium, {} context symbols + {} prefetched (total: {} tokens)",
            high_attention.len(),
            medium_attention.len(),
            context_symbols.len(),
            prefetched_symbols.len(),
            total_tokens
        );

        Ok(json!({
            "high_attention": high_attention,
            "medium_attention": medium_attention,
            "context_symbols": context_symbols,
            "prefetched_symbols": prefetched_symbols,
            "total_tokens": total_tokens,
            "budget_utilization": (total_tokens as f32 / params.token_budget as f32),
            "recently_evicted": recently_evicted
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

        let max_results = params.max_results.unwrap_or(10);

        // Search using DocIndexer for markdown/doc comments
        let doc_results = self.doc_indexer.search_docs(&params.query, max_results).await?;

        // Also search symbols with doc comments
        use crate::indexer::Indexer;
        let indexer = self.indexer.read().await;
        let query = Query {
            text: params.query.clone(),
            symbol_types: None,
            scope: params.scope,
            detail_level: DetailLevel::default(),
            max_results: Some(max_results),
            max_tokens: None,
        };
        let symbol_results = indexer.search_symbols(&query).await?;

        // Combine results
        let mut all_results: Vec<Value> = Vec::new();

        // Add documentation results
        for doc in &doc_results {
            all_results.push(json!({
                "title": doc.title,
                "content": doc.content,
                "file": doc.file,
                "line_start": doc.line_start,
                "line_end": doc.line_end,
                "section_path": doc.section_path,
                "relevance": doc.relevance,
                "type": match doc.doc_type {
                    crate::docs::DocType::Markdown => "markdown",
                    crate::docs::DocType::DocComment => "doc_comment",
                    crate::docs::DocType::InlineComment => "inline_comment",
                    crate::docs::DocType::CodeBlock => "code_block",
                }
            }));
        }

        // Add symbol doc comments (if not already included)
        for symbol in symbol_results.symbols.iter().filter(|s| s.metadata.doc_comment.is_some()).take(max_results - doc_results.len()) {
            all_results.push(json!({
                "title": symbol.name.clone(),
                "content": symbol.metadata.doc_comment.clone().unwrap_or_default(),
                "file": symbol.location.file.clone(),
                "line_start": symbol.location.line_start,
                "line_end": symbol.location.line_end,
                "section_path": [],
                "relevance": 0.7,
                "type": "symbol_doc"
            }));
        }

        Ok(json!({
            "results": all_results,
            "total_found": all_results.len(),
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

        // First, get symbol information
        use crate::indexer::Indexer;
        let indexer = self.indexer.read().await;
        let symbol = indexer.get_symbol(&params.symbol_id).await?
            .ok_or_else(|| anyhow!("Symbol not found"))?;

        // Get documentation from DocIndexer
        let docs = self.doc_indexer.get_docs_for_symbol(&symbol.name).await?;

        let examples: Vec<Value> = Vec::new();
        let mut related_docs = Vec::new();

        // Extract code examples and related documentation
        for doc in docs {
            related_docs.push(json!({
                "title": doc.title,
                "content": doc.content,
                "file": doc.file,
                "line_start": doc.line_start,
                "type": match doc.doc_type {
                    crate::docs::DocType::Markdown => "markdown",
                    crate::docs::DocType::DocComment => "doc_comment",
                    crate::docs::DocType::InlineComment => "inline_comment",
                    crate::docs::DocType::CodeBlock => "code_block",
                }
            }));
        }

        Ok(json!({
            "symbol_id": symbol.id.0,
            "symbol_name": symbol.name,
            "documentation": symbol.metadata.doc_comment,
            "signature": symbol.signature,
            "file": symbol.location.file,
            "examples": examples,
            "related_docs": related_docs
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

        let max_commits = params.max_commits.unwrap_or(10);
        let path = PathBuf::from(&params.path);

        // Try to use GitHistory to get file evolution
        match GitHistory::new(&path) {
            Ok(git_history) => {
                let commits = git_history.get_file_evolution(&path, max_commits)?;

                let commits_json: Vec<Value> = commits
                    .iter()
                    .map(|c| {
                        json!({
                            "sha": c.sha,
                            "author": c.author,
                            "author_email": c.author_email,
                            "date": c.date.to_rfc3339(),
                            "message": c.message,
                            "changes": c.changes,
                            "insertions": c.insertions,
                            "deletions": c.deletions
                        })
                    })
                    .collect();

                Ok(json!({
                    "path": path.display().to_string(),
                    "commits": commits_json,
                    "total_commits": commits.len()
                }))
            }
            Err(e) => {
                // Not a git repository or git error
                debug!("Git error for path {:?}: {}", path, e);
                Ok(json!({
                    "path": path.display().to_string(),
                    "commits": [],
                    "total_commits": 0,
                    "error": format!("Not a git repository or git error: {}", e)
                }))
            }
        }
    }

    async fn handle_history_blame(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct HistoryBlameParams {
            path: String,
            line_start: Option<usize>,
            line_end: Option<usize>,
            #[allow(dead_code)]
            project_path: Option<String>,
        }

        let params: HistoryBlameParams = serde_json::from_value(args)
            .context("Invalid parameters for history.blame")?;

        let path = PathBuf::from(&params.path);

        // Try to use GitHistory to get blame information
        match GitHistory::new(&path) {
            Ok(git_history) => {
                let blame_info = git_history.get_blame(&path, params.line_start, params.line_end)?;

                let blame_json: Vec<Value> = blame_info
                    .iter()
                    .map(|b| {
                        json!({
                            "line": b.line,
                            "author": b.author,
                            "author_email": b.author_email,
                            "sha": b.sha,
                            "date": b.date.to_rfc3339(),
                            "content": b.content
                        })
                    })
                    .collect();

                Ok(json!({
                    "path": params.path,
                    "blame": blame_json,
                    "total_lines": blame_info.len()
                }))
            }
            Err(e) => {
                // Not a git repository or git error
                debug!("Git error for path {:?}: {}", path, e);
                Ok(json!({
                    "path": params.path,
                    "blame": [],
                    "total_lines": 0,
                    "error": format!("Not a git repository or git error: {}", e)
                }))
            }
        }
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

    // === Specification Management Handlers ===

    async fn handle_specs_list(&self, _args: Value) -> Result<Value> {
        info!("Listing all specifications");

        let spec_manager = self.spec_manager.read().await;
        let registry = spec_manager.discover_specs()?;

        Ok(json!({
            "specs": registry.specs,
            "total_specs": registry.specs.len()
        }))
    }

    async fn handle_specs_get_structure(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            spec_name: String,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Getting structure for specification: {}", params.spec_name);

        let mut spec_manager = self.spec_manager.write().await;
        let doc = spec_manager.get_spec(&params.spec_name)?;
        let structure = crate::specs::MarkdownAnalyzer::get_structure_summary(&doc);

        Ok(json!({
            "structure": structure,
            "title": doc.title,
            "sections": doc.sections.iter().map(|s| s.title.clone()).collect::<Vec<_>>(),
            "metadata": {
                "version": doc.metadata.version,
                "status": doc.metadata.status,
                "date": doc.metadata.date,
                "authors": doc.metadata.authors
            }
        }))
    }

    async fn handle_specs_get_section(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            spec_name: String,
            section_name: String,
        }

        let params: Params = serde_json::from_value(args)?;
        info!(
            "Getting section '{}' from specification '{}'",
            params.section_name, params.spec_name
        );

        let mut spec_manager = self.spec_manager.write().await;
        let content = spec_manager.get_section(&params.spec_name, &params.section_name)?;

        Ok(json!({
            "content": content,
            "section_name": params.section_name
        }))
    }

    async fn handle_specs_search(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            query: String,
            #[serde(default)]
            max_results: Option<usize>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Searching specifications for: {}", params.query);

        let mut spec_manager = self.spec_manager.write().await;
        let mut results = spec_manager.search_all(&params.query)?;

        // Limit results if specified
        if let Some(max) = params.max_results {
            results.truncate(max);
        }

        Ok(json!({
            "results": results.iter().map(|r| json!({
                "spec_name": r.spec_name,
                "spec_path": r.spec_path,
                "section_title": r.section_title,
                "snippet": r.snippet,
                "line_start": r.line_start,
                "line_end": r.line_end
            })).collect::<Vec<_>>(),
            "total_results": results.len()
        }))
    }

    async fn handle_specs_validate(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            spec_name: String,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Validating specification: {}", params.spec_name);

        let mut spec_manager = self.spec_manager.write().await;
        let validation = spec_manager.validate(&params.spec_name)?;

        Ok(json!({
            "valid": validation.valid,
            "completeness_score": validation.completeness_score,
            "issues": validation.issues.iter().map(|issue| json!({
                "severity": format!("{:?}", issue.severity),
                "message": issue.message,
                "section": issue.section
            })).collect::<Vec<_>>()
        }))
    }

    // === Strong Catalog Handlers (Phase 3) ===

    async fn handle_strong_catalog_list_projects(&self, _args: Value) -> Result<Value> {
        use crate::strong::GlobalCatalog;

        info!("Listing all projects in global catalog");

        let catalog = GlobalCatalog::new();
        let projects = catalog.list_projects();

        let projects_json: Vec<Value> = projects.iter().map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "path": p.path.display().to_string(),
                "symbolCount": p.symbol_count,
                "coverage": p.coverage,
                "dependencies": p.dependencies,
                "description": p.description
            })
        }).collect();

        let total_documented = projects.iter().filter(|p| p.coverage > 0.0).count();
        let avg_coverage = if !projects.is_empty() {
            projects.iter().map(|p| p.coverage).sum::<f32>() / projects.len() as f32
        } else {
            0.0
        };

        Ok(json!({
            "projects": projects_json,
            "totalProjects": projects.len(),
            "totalDocumented": total_documented,
            "averageCoverage": avg_coverage
        }))
    }

    async fn handle_strong_catalog_get_project(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            #[serde(rename = "projectId")]
            project_id: String,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Getting project: {}", params.project_id);

        use crate::strong::GlobalCatalog;
        let catalog = GlobalCatalog::new();

        let project = catalog.get_project(&params.project_id)
            .or_else(|| catalog.get_project_by_name(&params.project_id))
            .ok_or_else(|| anyhow!("Project not found: {}", params.project_id))?;

        Ok(json!({
            "project": {
                "id": project.id,
                "name": project.name,
                "path": project.path.display().to_string(),
                "symbolCount": project.symbol_count,
                "coverage": project.coverage,
                "dependencies": project.dependencies,
                "description": project.description
            }
        }))
    }

    async fn handle_strong_catalog_search_documentation(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            query: String,
            #[serde(default)]
            scope: Option<String>,
            #[serde(default)]
            limit: Option<usize>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Searching documentation: query='{}', scope={:?}", params.query, params.scope);

        use crate::strong::{GlobalCatalog, SearchScope};

        let scope = match params.scope.as_deref() {
            Some("local") => SearchScope::Local,
            Some("dependencies") => SearchScope::Dependencies,
            _ => SearchScope::Global,
        };

        let catalog = GlobalCatalog::new();
        let mut results = catalog.search(&params.query, scope, None)?;

        if let Some(limit) = params.limit {
            results.truncate(limit);
        }

        let results_json: Vec<Value> = results.iter().map(|r| {
            json!({
                "projectId": r.project_id,
                "symbolName": r.symbol_name,
                "content": r.content,
                "filePath": r.file_path,
                "relevance": r.relevance
            })
        }).collect();

        Ok(json!({
            "results": results_json,
            "totalResults": results.len()
        }))
    }

    // === Strong Documentation Handlers (Phase 3) ===

    async fn handle_strong_docs_generate(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            #[serde(rename = "targetPath")]
            target_path: String,
            format: Option<String>,
            #[serde(rename = "includeExamples", default)]
            include_examples: Option<bool>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Generating documentation for: {}", params.target_path);

        use crate::strong::{DocumentationGenerator, DocFormat};
        use crate::indexer::Indexer;

        let format = match params.format.as_deref() {
            Some("jsdoc") => DocFormat::JSDoc,
            Some("rustdoc") => DocFormat::RustDoc,
            Some("markdown") => DocFormat::Markdown,
            _ => DocFormat::TSDoc,
        };

        let generator = DocumentationGenerator::new(format);
        let indexer = self.indexer.read().await;

        // Get symbol from target path
        let symbol = indexer.get_symbol(&params.target_path).await?
            .ok_or_else(|| anyhow!("Symbol not found: {}", params.target_path))?;

        let doc = generator.generate(&symbol)?;

        Ok(json!({
            "documentation": doc.content,
            "quality": {
                "format": format!("{:?}", doc.format),
                "isEnhanced": doc.is_enhanced,
                "hasParameters": doc.metadata.has_parameters,
                "hasReturn": doc.metadata.has_return,
                "hasExamples": doc.metadata.has_examples
            }
        }))
    }

    async fn handle_strong_docs_validate(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            #[serde(rename = "targetPath")]
            target_path: String,
            #[serde(default)]
            standards: Option<String>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Validating documentation for: {}", params.target_path);

        use crate::strong::QualityValidator;
        use crate::indexer::Indexer;

        let indexer = self.indexer.read().await;
        let symbol = indexer.get_symbol(&params.target_path).await?
            .ok_or_else(|| anyhow!("Symbol not found: {}", params.target_path))?;

        let validator = QualityValidator::new();
        let doc_content = symbol.metadata.doc_comment.as_deref().unwrap_or("");
        let score = validator.assess(doc_content, &symbol);

        Ok(json!({
            "overallScore": score.overall,
            "symbolScores": [{
                "symbol": symbol.name,
                "score": score.overall,
                "completeness": score.completeness,
                "clarity": score.clarity,
                "accuracy": score.accuracy,
                "compliance": score.compliance,
                "issues": score.issues.iter().map(|i| json!({
                    "severity": format!("{:?}", i.severity),
                    "category": i.category,
                    "message": i.message,
                    "line": i.line
                })).collect::<Vec<_>>(),
                "suggestions": score.suggestions.iter().map(|s| json!({
                    "type": s.suggestion_type,
                    "description": s.description,
                    "example": s.example
                })).collect::<Vec<_>>()
            }]
        }))
    }

    async fn handle_strong_docs_transform(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            #[serde(rename = "targetPath")]
            target_path: String,
            #[serde(rename = "targetFormat")]
            target_format: String,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Transforming documentation for: {} to {}", params.target_path, params.target_format);

        use crate::strong::{DocumentationGenerator, DocFormat, DocTransformOptions};
        use crate::indexer::Indexer;

        let target_fmt = match params.target_format.as_str() {
            "jsdoc" => DocFormat::JSDoc,
            "rustdoc" => DocFormat::RustDoc,
            "markdown" => DocFormat::Markdown,
            _ => DocFormat::TSDoc,
        };

        let indexer = self.indexer.read().await;
        let symbol = indexer.get_symbol(&params.target_path).await?
            .ok_or_else(|| anyhow!("Symbol not found: {}", params.target_path))?;

        let generator = DocumentationGenerator::new(target_fmt);
        let existing_doc = symbol.metadata.doc_comment.as_deref().unwrap_or("");

        let options = DocTransformOptions {
            preserve_examples: true,
            preserve_links: true,
            preserve_formatting: true,
        };

        let transformed = generator.transform(existing_doc, target_fmt, &options)?;

        Ok(json!({
            "transformedDocs": [{
                "symbol": symbol.name,
                "original": existing_doc,
                "transformed": transformed,
                "format": params.target_format
            }],
            "totalTransformed": 1
        }))
    }

    // === Strong Example Handlers (Phase 4) ===

    async fn handle_strong_examples_generate(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            symbol_id: String,
            complexity: Option<String>,
            language: Option<String>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Generating examples for symbol: {}", params.symbol_id);

        use crate::strong::ExampleGenerator;
        use crate::indexer::Indexer;

        let indexer = self.indexer.read().await;
        let symbol = indexer.get_symbol(&params.symbol_id).await?
            .ok_or_else(|| anyhow!("Symbol not found: {}", params.symbol_id))?;

        let language = params.language.unwrap_or_else(|| "typescript".to_string());
        let generator = ExampleGenerator::new(language);

        let examples = match params.complexity.as_deref() {
            Some("advanced") => generator.generate_advanced(&symbol)?,
            Some("intermediate") => vec![generator.generate_basic(&symbol)?],
            _ => vec![generator.generate_basic(&symbol)?],
        };

        let examples_json: Vec<Value> = examples.iter().map(|ex| {
            json!({
                "code": ex.code,
                "description": ex.description,
                "language": ex.language,
                "complexity": format!("{:?}", ex.complexity)
            })
        }).collect();

        Ok(json!({
            "examples": examples_json
        }))
    }

    async fn handle_strong_examples_validate(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            example: ExampleInput,
        }

        #[derive(Deserialize)]
        struct ExampleInput {
            code: String,
            language: String,
            #[allow(dead_code)]
            description: Option<String>,
            #[allow(dead_code)]
            complexity: Option<String>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Validating example in language: {}", params.example.language);

        use crate::strong::ExampleValidator;

        let validator = ExampleValidator::new(params.example.language.clone());
        let result = validator.validate_syntax(&params.example.code)?;

        Ok(json!({
            "valid": result.valid,
            "errors": result.errors,
            "warnings": result.warnings
        }))
    }

    // === Strong Test Handlers (Phase 4) ===

    async fn handle_strong_tests_generate(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            symbol_id: String,
            framework: Option<String>,
            test_type: Option<String>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Generating tests for symbol: {}", params.symbol_id);

        use crate::strong::{TestGenerator, TestFramework, TestType};
        use crate::indexer::Indexer;

        let indexer = self.indexer.read().await;
        let symbol = indexer.get_symbol(&params.symbol_id).await?
            .ok_or_else(|| anyhow!("Symbol not found: {}", params.symbol_id))?;

        let framework = match params.framework.as_deref() {
            Some("vitest") => TestFramework::Vitest,
            Some("bun") | Some("bun:test") => TestFramework::BunTest,
            Some("rust") => TestFramework::RustNative,
            _ => TestFramework::Jest,
        };

        let test_type = match params.test_type.as_deref() {
            Some("integration") => TestType::Integration,
            Some("e2e") => TestType::E2E,
            _ => TestType::Unit,
        };

        let generator = TestGenerator::new(framework);
        let tests = generator.generate_unit_tests(&symbol)?;

        let tests_json: Vec<Value> = tests.iter().map(|t| {
            json!({
                "name": t.name,
                "code": t.code,
                "framework": format!("{:?}", t.framework),
                "test_type": format!("{:?}", test_type)
            })
        }).collect();

        Ok(json!({
            "tests": tests_json
        }))
    }

    async fn handle_strong_tests_validate(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            test: TestInput,
        }

        #[derive(Deserialize)]
        struct TestInput {
            code: String,
            framework: String,
            #[allow(dead_code)]
            name: Option<String>,
            #[allow(dead_code)]
            test_type: Option<String>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Validating test with framework: {}", params.test.framework);

        use crate::strong::{TestGenerator, TestFramework};

        let framework = match params.test.framework.as_str() {
            "vitest" => TestFramework::Vitest,
            "bun" | "bun:test" => TestFramework::BunTest,
            "rust" => TestFramework::RustNative,
            _ => TestFramework::Jest,
        };

        // estimate_coverage takes a slice of tests, not a string
        // For now, we'll just return a placeholder estimate
        let coverage = 0.8f32;

        // Basic syntax validation
        let valid = !params.test.code.is_empty() &&
                    (params.test.code.contains("test") ||
                     params.test.code.contains("it(") ||
                     params.test.code.contains("describe("));

        Ok(json!({
            "valid": valid,
            "coverage_estimate": coverage,
            "errors": if valid { Vec::<String>::new() } else { vec!["Invalid test structure".to_string()] }
        }))
    }

    // === Strong Global Handlers (Phase 5) ===

    async fn handle_strong_global_list_monorepos(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            #[serde(rename = "includeInactive", default)]
            include_inactive: Option<bool>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Listing monorepos, includeInactive={:?}", params.include_inactive);

        // Placeholder implementation - would need global registry
        Ok(json!({
            "monorepos": []
        }))
    }

    async fn handle_strong_global_search_all_projects(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            query: String,
            #[serde(rename = "monorepoId")]
            monorepo_id: Option<String>,
            #[serde(rename = "maxResults", default)]
            max_results: Option<usize>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Searching all projects: query='{}', monorepoId={:?}", params.query, params.monorepo_id);

        // Placeholder implementation
        Ok(json!({
            "projects": [],
            "totalResults": 0
        }))
    }

    async fn handle_strong_global_get_dependency_graph(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            #[serde(rename = "projectId")]
            project_id: String,
            depth: Option<usize>,
            direction: Option<String>,
            #[serde(rename = "includeTypes")]
            include_types: Option<Vec<String>>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Getting dependency graph for project: {}", params.project_id);

        use crate::strong::CrossReferenceManager;

        let manager = CrossReferenceManager::new();
        let graph = manager.build_dependency_graph();

        // Convert nodes HashMap to array
        let nodes_json: Vec<Value> = graph.nodes.values().map(|n| json!({
            "id": n.id,
            "name": n.name,
            "projectId": n.project_id
        })).collect();

        let edges_json: Vec<Value> = graph.edges.iter().map(|e| json!({
            "from": e.from,
            "to": e.to,
            "type": format!("{:?}", e.ref_type)
        })).collect();

        Ok(json!({
            "graph": {
                "nodes": nodes_json,
                "edges": edges_json
            },
            "visualization": "digraph G {}",
            "cycles": []
        }))
    }

    // === Strong External Handlers (Phase 5) ===

    async fn handle_strong_external_get_documentation(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            #[serde(rename = "projectId")]
            project_id: String,
            #[serde(rename = "symbolName")]
            symbol_name: Option<String>,
            #[serde(rename = "includeExamples", default)]
            include_examples: Option<bool>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Getting external documentation: projectId={}, symbolName={:?}", params.project_id, params.symbol_name);

        // Placeholder implementation - would need ProjectRegistryManager
        // In a real implementation, this would:
        // 1. Create CrossMonorepoAccess with registry
        // 2. Call get_external_docs
        // 3. Return the results

        Ok(json!({
            "documentation": {
                "projectId": params.project_id,
                "symbols": [],
                "fromCache": false,
                "fetchedAt": chrono::Utc::now().to_rfc3339()
            },
            "accessGranted": true
        }))
    }

    async fn handle_strong_external_find_usages(&self, args: Value) -> Result<Value> {
        #[derive(Deserialize)]
        struct Params {
            #[serde(rename = "symbolId")]
            symbol_id: String,
            #[serde(rename = "includeTests", default)]
            include_tests: Option<bool>,
            #[serde(rename = "maxResults", default)]
            max_results: Option<usize>,
            #[serde(rename = "monorepoId")]
            monorepo_id: Option<String>,
        }

        let params: Params = serde_json::from_value(args)?;
        info!("Finding usages: symbolId={}, monorepoId={:?}", params.symbol_id, params.monorepo_id);

        // Placeholder implementation - would need ProjectRegistryManager
        // In a real implementation, this would:
        // 1. Create CrossMonorepoAccess with registry
        // 2. Call find_usages (which is async)
        // 3. Return the results

        Ok(json!({
            "usages": [],
            "totalUsages": 0,
            "projectsSearched": 0
        }))
    }
}
