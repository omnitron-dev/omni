use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// MCP Tool definition (MCP spec 2025-06-18 compliant)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
    #[serde(rename = "outputSchema", skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub _meta: Option<Value>,
}

/// Get all available tools for Meridian MCP server
pub fn get_all_tools() -> Vec<Tool> {
    vec![
        // === Memory Management Tools ===
        Tool {
            name: "memory.record_episode".to_string(),
            description: Some("Record a task episode for future learning and pattern extraction".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Description of the task that was performed"
                    },
                    "queries_made": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Queries executed during the task"
                    },
                    "files_accessed": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Files accessed during the task"
                    },
                    "solution": {
                        "type": "string",
                        "description": "Solution or approach taken"
                    },
                    "outcome": {
                        "type": "string",
                        "enum": ["success", "failure", "partial"],
                        "description": "Outcome of the task"
                    }
                },
                "required": ["task", "outcome"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "memory.find_similar_episodes".to_string(),
            description: Some("Find similar task episodes from history to guide current work".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_description": {
                        "type": "string",
                        "description": "Description of the current task"
                    },
                    "limit": {
                        "type": "integer",
                        "default": 5,
                        "description": "Maximum number of similar episodes to return"
                    }
                },
                "required": ["task_description"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "memory.update_working_set".to_string(),
            description: Some("Update working memory with attention weights from LLM focus".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "focused_symbols": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "symbol": {"type": "string"},
                                "weight": {"type": "number"}
                            }
                        },
                        "description": "Symbols that received attention with their weights"
                    },
                    "accessed_files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Files that were accessed"
                    },
                    "session_id": {
                        "type": "string",
                        "description": "Current session ID"
                    }
                },
                "required": ["focused_symbols", "accessed_files", "session_id"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === Context Management Tools ===
        Tool {
            name: "context.prepare_adaptive".to_string(),
            description: Some("Prepare optimized context adapted to specific LLM model and token budget".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "request": {
                        "type": "object",
                        "description": "Context request with files and symbols"
                    },
                    "model": {
                        "type": "string",
                        "enum": ["claude-3", "gpt-4", "gemini", "custom"],
                        "description": "Target LLM model"
                    },
                    "available_tokens": {
                        "type": "integer",
                        "description": "Available tokens in context window"
                    }
                },
                "required": ["request", "model", "available_tokens"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "context.defragment".to_string(),
            description: Some("Defragment scattered context fragments into unified narrative".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "fragments": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Context fragments to unify"
                    },
                    "target_tokens": {
                        "type": "integer",
                        "description": "Target token count for unified context"
                    }
                },
                "required": ["fragments", "target_tokens"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === Code Navigation Tools ===
        Tool {
            name: "code.search_symbols".to_string(),
            description: Some("Search for code symbols (functions, classes, etc.) with token budget control".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query text"
                    },
                    "type": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Symbol types to filter (function, class, interface, etc.)"
                    },
                    "scope": {
                        "type": "string",
                        "description": "Path to limit search scope"
                    },
                    "detail_level": {
                        "type": "string",
                        "enum": ["skeleton", "interface", "implementation", "full"],
                        "description": "Level of detail to return"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results"
                    },
                    "max_tokens": {
                        "type": "integer",
                        "description": "Hard limit on tokens in response"
                    }
                },
                "required": ["query"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "code.get_definition".to_string(),
            description: Some("Get full definition of a specific code symbol".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "symbol_id": {
                        "type": "string",
                        "description": "Unique symbol identifier"
                    },
                    "include_body": {
                        "type": "boolean",
                        "default": true,
                        "description": "Include function/method body"
                    },
                    "include_references": {
                        "type": "boolean",
                        "default": false,
                        "description": "Include reference information"
                    },
                    "include_dependencies": {
                        "type": "boolean",
                        "default": false,
                        "description": "Include dependency information"
                    }
                },
                "required": ["symbol_id"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "code.find_references".to_string(),
            description: Some("Find all references to a code symbol".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "symbol_id": {
                        "type": "string",
                        "description": "Symbol ID to find references for"
                    },
                    "include_context": {
                        "type": "boolean",
                        "default": false,
                        "description": "Include surrounding context for each reference"
                    },
                    "group_by_file": {
                        "type": "boolean",
                        "default": true,
                        "description": "Group references by file"
                    }
                },
                "required": ["symbol_id"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "code.get_dependencies".to_string(),
            description: Some("Get dependency graph for a symbol or file".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "entry_point": {
                        "type": "string",
                        "description": "Symbol or file path as entry point"
                    },
                    "depth": {
                        "type": "integer",
                        "default": 3,
                        "description": "Maximum depth to traverse"
                    },
                    "direction": {
                        "type": "string",
                        "enum": ["imports", "exports", "both"],
                        "default": "both",
                        "description": "Direction to traverse dependencies"
                    }
                },
                "required": ["entry_point"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === Session Management Tools ===
        Tool {
            name: "session.begin".to_string(),
            description: Some("Start a new isolated work session with copy-on-write semantics".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_description": {
                        "type": "string",
                        "description": "Description of the task for this session"
                    },
                    "scope": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Files or directories in session scope"
                    },
                    "base_commit": {
                        "type": "string",
                        "description": "Git commit to use as base"
                    }
                },
                "required": ["task_description"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "session.update".to_string(),
            description: Some("Update session with file changes and optionally reindex".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Session ID"
                    },
                    "path": {
                        "type": "string",
                        "description": "File path to update"
                    },
                    "content": {
                        "type": "string",
                        "description": "New file content"
                    },
                    "reindex": {
                        "type": "boolean",
                        "default": true,
                        "description": "Reindex file immediately"
                    }
                },
                "required": ["session_id", "path", "content"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "session.query".to_string(),
            description: Some("Query within session context, preferring session changes".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Session ID"
                    },
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    },
                    "prefer_session": {
                        "type": "boolean",
                        "default": true,
                        "description": "Prefer session changes over base index"
                    }
                },
                "required": ["session_id", "query"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "session.complete".to_string(),
            description: Some("Complete session with commit, discard, or stash action".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Session ID"
                    },
                    "action": {
                        "type": "string",
                        "enum": ["commit", "discard", "stash"],
                        "description": "Action to take with session changes"
                    },
                    "commit_message": {
                        "type": "string",
                        "description": "Commit message if action is commit"
                    }
                },
                "required": ["session_id", "action"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === Feedback and Learning Tools ===
        Tool {
            name: "feedback.mark_useful".to_string(),
            description: Some("Mark symbols and context as useful or unnecessary for learning".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Session ID"
                    },
                    "useful_symbols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Symbols that were useful"
                    },
                    "unnecessary_symbols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Symbols that were not useful"
                    },
                    "missing_context": {
                        "type": "string",
                        "description": "Context that was missing"
                    }
                },
                "required": ["session_id"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "learning.train_on_success".to_string(),
            description: Some("Train system on successful task completion".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task": {
                        "type": "object",
                        "description": "Task information"
                    },
                    "solution": {
                        "type": "object",
                        "description": "Solution details"
                    },
                    "key_insights": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Key insights from solving the task"
                    }
                },
                "required": ["task", "solution"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "predict.next_action".to_string(),
            description: Some("Predict next likely action based on current context and patterns".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "current_context": {
                        "type": "object",
                        "description": "Current context information"
                    },
                    "task_type": {
                        "type": "string",
                        "description": "Type of task being performed"
                    }
                },
                "required": ["current_context"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === Attention-based Retrieval ===
        Tool {
            name: "attention.retrieve".to_string(),
            description: Some("Retrieve symbols based on attention patterns with priority levels".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "attention_pattern": {
                        "type": "object",
                        "description": "Attention pattern data"
                    },
                    "token_budget": {
                        "type": "integer",
                        "description": "Token budget for retrieval"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": ["attention_pattern", "token_budget"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "attention.analyze_patterns".to_string(),
            description: Some("Analyze attention patterns to understand focus and drift".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Session ID to analyze"
                    },
                    "window": {
                        "type": "integer",
                        "description": "Number of recent queries to analyze"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": ["session_id"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === Documentation Tools ===
        Tool {
            name: "docs.search".to_string(),
            description: Some("Search through documentation and markdown files".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for documentation"
                    },
                    "scope": {
                        "type": "string",
                        "description": "Path to limit documentation search scope"
                    },
                    "max_results": {
                        "type": "integer",
                        "default": 10,
                        "description": "Maximum number of results to return"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": ["query"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "docs.get_for_symbol".to_string(),
            description: Some("Get documentation for a specific code symbol".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "symbol_id": {
                        "type": "string",
                        "description": "Symbol ID to get documentation for"
                    },
                    "include_examples": {
                        "type": "boolean",
                        "default": false,
                        "description": "Include usage examples if available"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": ["symbol_id"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === History Tools ===
        Tool {
            name: "history.get_evolution".to_string(),
            description: Some("Get evolution history of a file or symbol from git".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path or symbol ID to track"
                    },
                    "max_commits": {
                        "type": "integer",
                        "default": 10,
                        "description": "Maximum number of commits to retrieve"
                    },
                    "include_diffs": {
                        "type": "boolean",
                        "default": false,
                        "description": "Include diffs for each commit"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": ["path"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "history.blame".to_string(),
            description: Some("Get git blame information for a file".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path to get blame for"
                    },
                    "line_start": {
                        "type": "integer",
                        "description": "Starting line number (optional)"
                    },
                    "line_end": {
                        "type": "integer",
                        "description": "Ending line number (optional)"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": ["path"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === Analysis Tools ===
        Tool {
            name: "analyze.complexity".to_string(),
            description: Some("Analyze code complexity metrics for files or symbols".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "File path or symbol ID to analyze"
                    },
                    "include_metrics": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["cyclomatic", "cognitive", "lines", "dependencies"]
                        },
                        "description": "Metrics to include in analysis"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": ["target"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "analyze.token_cost".to_string(),
            description: Some("Estimate token cost for context items".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string", "enum": ["file", "symbol", "text"]},
                                "identifier": {"type": "string"}
                            }
                        },
                        "description": "Items to estimate token cost for"
                    },
                    "model": {
                        "type": "string",
                        "enum": ["claude-3", "gpt-4", "gemini"],
                        "default": "claude-3",
                        "description": "Model to use for token estimation"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": ["items"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === Monorepo Tools ===
        Tool {
            name: "monorepo.list_projects".to_string(),
            description: Some("List all projects detected in a monorepo workspace".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "root_path": {
                        "type": "string",
                        "description": "Root path of the monorepo (optional, uses indexed path if not provided)"
                    },
                    "include_dependencies": {
                        "type": "boolean",
                        "default": false,
                        "description": "Include dependency graph between projects"
                    }
                },
                "required": []
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "monorepo.set_context".to_string(),
            description: Some("Set current working context to a specific project in monorepo".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "project_name": {
                        "type": "string",
                        "description": "Name of the project to set as context"
                    },
                    "session_id": {
                        "type": "string",
                        "description": "Session ID to update context for"
                    }
                },
                "required": ["project_name", "session_id"]
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "monorepo.find_cross_references".to_string(),
            description: Some("Find cross-references between projects in a monorepo".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "source_project": {
                        "type": "string",
                        "description": "Source project name"
                    },
                    "target_project": {
                        "type": "string",
                        "description": "Target project name (optional, finds all if not provided)"
                    },
                    "reference_type": {
                        "type": "string",
                        "enum": ["imports", "exports", "both"],
                        "default": "both",
                        "description": "Type of references to find"
                    }
                },
                "required": ["source_project"]
            }),
            output_schema: None,
            _meta: None,
        },

        // === Memory Tools (new) ===
        Tool {
            name: "memory.get_statistics".to_string(),
            description: Some("Get memory system statistics and usage information".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "include_details": {
                        "type": "boolean",
                        "default": false,
                        "description": "Include detailed breakdown by component"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": []
            }),
            output_schema: None,
            _meta: None,
        },
        Tool {
            name: "context.compress".to_string(),
            description: Some("Compress context using specified strategy".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "Content to compress"
                    },
                    "strategy": {
                        "type": "string",
                        "enum": ["remove_comments", "remove_whitespace", "skeleton", "summary", "extract_key_points", "tree_shaking", "hybrid", "ultra_compact"],
                        "description": "Compression strategy to use"
                    },
                    "target_ratio": {
                        "type": "number",
                        "description": "Target compression ratio (0.0-1.0)"
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Optional project path for multi-project support"
                    }
                },
                "required": ["content", "strategy"]
            }),
            output_schema: None,
            _meta: None,
        },
    ]
    .into_iter()
    .chain(get_catalog_tools())
    .chain(get_docs_generation_tools())
    .chain(get_global_tools())
    .chain(get_specification_tools())
    .chain(get_progress_tools())
    .chain(get_links_tools())
    .collect()
}

/// MCP Resource definition (MCP spec 2025-06-18 compliant)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "mimeType")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub _meta: Option<Value>,
}

/// Get all available resources
pub fn get_all_resources() -> Vec<Resource> {
    vec![
        Resource {
            uri: "meridian://index/current".to_string(),
            name: Some("Current Index State".to_string()),
            description: Some("Current state of the code index".to_string()),
            mime_type: Some("application/json".to_string()),
            _meta: None,
        },
        Resource {
            uri: "meridian://memory/episodes".to_string(),
            name: Some("Task Episodes".to_string()),
            description: Some("History of task episodes for learning".to_string()),
            mime_type: Some("application/json".to_string()),
            _meta: None,
        },
        Resource {
            uri: "meridian://memory/working".to_string(),
            name: Some("Working Memory".to_string()),
            description: Some("Current working memory state".to_string()),
            mime_type: Some("application/json".to_string()),
            _meta: None,
        },
        Resource {
            uri: "meridian://sessions/active".to_string(),
            name: Some("Active Sessions".to_string()),
            description: Some("List of active work sessions".to_string()),
            mime_type: Some("application/json".to_string()),
            _meta: None,
        },
    ]
}

/// Server capabilities (MCP spec 2025-06-18 compliant)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<serde_json::Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<serde_json::Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompts: Option<serde_json::Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logging: Option<serde_json::Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completions: Option<serde_json::Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<serde_json::Value>,
}

impl Default for ServerCapabilities {
    fn default() -> Self {
        Self {
            tools: Some(serde_json::Map::new()),       // Empty object
            resources: Some(serde_json::Map::new()),   // Empty object
            prompts: Some(serde_json::Map::new()),     // Empty object
            logging: Some(serde_json::Map::new()),     // Empty object
            completions: None,
            experimental: None,
        }
    }
}

// ============================================================================
// Catalog Tools (Phase 3) - Documentation Generation & Catalog
// ============================================================================

/// Get catalog tools for Phase 3
fn get_catalog_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "catalog.list_projects".to_string(),
            description: Some("Lists all projects in the global documentation catalog with metadata and statistics".to_string()),
            input_schema: json!({"type": "object", "properties": {}, "additionalProperties": false}),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "projects": {"type": "array"},
                    "totalProjects": {"type": "number"},
                    "totalDocumented": {"type": "number"},
                    "averageCoverage": {"type": "number"}
                }
            })),
            _meta: Some(json!({"category": "catalog"})),
        },
        Tool {
            name: "catalog.get_project".to_string(),
            description: Some("Gets detailed information about a specific project".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "projectId": {"type": "string", "description": "Project identifier or path"}
                },
                "required": ["projectId"]
            }),
            output_schema: Some(json!({"type": "object", "properties": {"project": {"type": "object"}}})),
            _meta: Some(json!({"category": "catalog"})),
        },
        Tool {
            name: "catalog.search_documentation".to_string(),
            description: Some("Searches documentation across all projects with filtering".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "scope": {"type": "string", "enum": ["local", "dependencies", "global"], "default": "global"},
                    "limit": {"type": "number", "default": 20}
                },
                "required": ["query"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "results": {"type": "array"},
                    "totalResults": {"type": "number"}
                }
            })),
            _meta: Some(json!({"category": "catalog"})),
        },
    ]
}

/// Get global cross-monorepo tools
fn get_global_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "global.list_monorepos".to_string(),
            description: Some("List all registered monorepos in the global registry".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "includeInactive": {
                        "type": "boolean",
                        "default": false,
                        "description": "Include inactive/deleted monorepos"
                    }
                }
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "monorepos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "name": {"type": "string"},
                                "path": {"type": "string"},
                                "status": {"type": "string"},
                                "projectCount": {"type": "number"}
                            }
                        }
                    }
                }
            })),
            _meta: Some(json!({"category": "global"})),
        },
        Tool {
            name: "global.search_all_projects".to_string(),
            description: Some("Search for projects across all monorepos in the global registry".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query (project name, symbol, etc.)"
                    },
                    "monorepoId": {
                        "type": "string",
                        "description": "Limit search to specific monorepo"
                    },
                    "maxResults": {
                        "type": "integer",
                        "default": 50,
                        "description": "Maximum number of results to return"
                    }
                },
                "required": ["query"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "projects": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "projectId": {"type": "string"},
                                "projectName": {"type": "string"},
                                "monorepoId": {"type": "string"},
                                "matchType": {"type": "string"},
                                "relevance": {"type": "number"}
                            }
                        }
                    },
                    "totalResults": {"type": "number"}
                }
            })),
            _meta: Some(json!({"category": "global"})),
        },
        Tool {
            name: "global.get_dependency_graph".to_string(),
            description: Some("Get dependency graph for a project with configurable depth and direction".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "projectId": {
                        "type": "string",
                        "description": "Project ID to get dependencies for"
                    },
                    "depth": {
                        "type": "integer",
                        "default": 3,
                        "description": "Maximum depth for transitive dependencies"
                    },
                    "direction": {
                        "type": "string",
                        "enum": ["incoming", "outgoing", "both"],
                        "default": "outgoing",
                        "description": "Direction: incoming (dependents), outgoing (dependencies), or both"
                    },
                    "includeTypes": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["runtime", "dev", "peer"]},
                        "description": "Filter by dependency types"
                    }
                },
                "required": ["projectId"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "graph": {
                        "type": "object",
                        "properties": {
                            "nodes": {"type": "array"},
                            "edges": {"type": "array"}
                        }
                    },
                    "visualization": {"type": "string", "description": "Graph in DOT format"},
                    "cycles": {"type": "array", "description": "Detected circular dependencies"}
                }
            })),
            _meta: Some(json!({"category": "global"})),
        },
        Tool {
            name: "external.get_documentation".to_string(),
            description: Some("Get documentation from an external project (read-only access)".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "projectId": {
                        "type": "string",
                        "description": "External project ID to fetch documentation from"
                    },
                    "symbolName": {
                        "type": "string",
                        "description": "Specific symbol to get documentation for (optional)"
                    },
                    "includeExamples": {
                        "type": "boolean",
                        "default": true,
                        "description": "Include code examples in documentation"
                    }
                },
                "required": ["projectId"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "documentation": {
                        "type": "object",
                        "properties": {
                            "projectId": {"type": "string"},
                            "symbols": {"type": "array"},
                            "fromCache": {"type": "boolean"},
                            "fetchedAt": {"type": "string"}
                        }
                    },
                    "accessGranted": {"type": "boolean"}
                }
            })),
            _meta: Some(json!({"category": "external", "security": "read-only"})),
        },
        Tool {
            name: "external.find_usages".to_string(),
            description: Some("Find usages of a symbol across all accessible monorepos".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "symbolId": {
                        "type": "string",
                        "description": "Symbol ID to find usages for"
                    },
                    "includeTests": {
                        "type": "boolean",
                        "default": false,
                        "description": "Include test files in search"
                    },
                    "maxResults": {
                        "type": "integer",
                        "default": 100,
                        "description": "Maximum number of usages to return"
                    },
                    "monorepoId": {
                        "type": "string",
                        "description": "Limit search to specific monorepo"
                    }
                },
                "required": ["symbolId"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "usages": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "projectId": {"type": "string"},
                                "filePath": {"type": "string"},
                                "line": {"type": "number"},
                                "context": {"type": "string"},
                                "usageType": {"type": "string"}
                            }
                        }
                    },
                    "totalUsages": {"type": "number"},
                    "projectsSearched": {"type": "number"}
                }
            })),
            _meta: Some(json!({"category": "external", "security": "read-only"})),
        },
    ]
}

/// Get documentation generation tools (Phase 3)
fn get_docs_generation_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "docs.generate".to_string(),
            description: Some("Generates high-quality documentation for symbols with examples".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "targetPath": {"type": "string"},
                    "format": {"type": "string", "enum": ["tsdoc", "jsdoc", "rustdoc"]},
                    "includeExamples": {"type": "boolean", "default": true}
                },
                "required": ["targetPath"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "documentation": {"type": "string"},
                    "quality": {"type": "object"}
                }
            })),
            _meta: Some(json!({"category": "documentation"})),
        },
        Tool {
            name: "docs.validate".to_string(),
            description: Some("Validates documentation quality with scoring and suggestions".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "targetPath": {"type": "string"},
                    "standards": {"type": "string", "enum": ["strict", "recommended", "minimal"], "default": "recommended"}
                },
                "required": ["targetPath"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "overallScore": {"type": "number"},
                    "symbolScores": {"type": "array"}
                }
            })),
            _meta: Some(json!({"category": "documentation"})),
        },
        Tool {
            name: "docs.transform".to_string(),
            description: Some("Transforms documentation into standardized format".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "targetPath": {"type": "string"},
                    "targetFormat": {"type": "string", "enum": ["tsdoc", "jsdoc", "rustdoc"]}
                },
                "required": ["targetPath", "targetFormat"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "transformedDocs": {"type": "array"},
                    "totalTransformed": {"type": "number"}
                }
            })),
            _meta: Some(json!({"category": "documentation"})),
        },

        // === Example & Test Generation Tools (Phase 4) ===
        Tool {
            name: "examples.generate".to_string(),
            description: Some("Generate code examples from symbols with configurable complexity".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "symbol_id": {
                        "type": "string",
                        "description": "Unique symbol identifier"
                    },
                    "complexity": {
                        "type": "string",
                        "enum": ["basic", "intermediate", "advanced"],
                        "default": "basic",
                        "description": "Example complexity level"
                    },
                    "language": {
                        "type": "string",
                        "enum": ["typescript", "javascript", "rust", "python"],
                        "description": "Target language for examples"
                    }
                },
                "required": ["symbol_id"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "examples": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "code": {"type": "string"},
                                "description": {"type": "string"},
                                "language": {"type": "string"},
                                "complexity": {"type": "string"}
                            }
                        }
                    }
                }
            })),
            _meta: Some(json!({"category": "examples"})),
        },
        Tool {
            name: "examples.validate".to_string(),
            description: Some("Validate code examples for syntax and compilation errors".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "example": {
                        "type": "object",
                        "properties": {
                            "code": {"type": "string"},
                            "description": {"type": "string"},
                            "language": {"type": "string"},
                            "complexity": {"type": "string"}
                        },
                        "required": ["code", "language"],
                        "description": "Example object to validate"
                    }
                },
                "required": ["example"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "valid": {"type": "boolean"},
                    "errors": {
                        "type": "array",
                        "items": {"type": "string"}
                    },
                    "warnings": {
                        "type": "array",
                        "items": {"type": "string"}
                    }
                }
            })),
            _meta: Some(json!({"category": "examples"})),
        },
        Tool {
            name: "tests.generate".to_string(),
            description: Some("Generate unit and integration tests for symbols".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "symbol_id": {
                        "type": "string",
                        "description": "Symbol ID to generate tests for"
                    },
                    "framework": {
                        "type": "string",
                        "enum": ["jest", "vitest", "bun", "rust"],
                        "default": "jest",
                        "description": "Test framework to use"
                    },
                    "test_type": {
                        "type": "string",
                        "enum": ["unit", "integration", "e2e"],
                        "default": "unit",
                        "description": "Type of tests to generate"
                    }
                },
                "required": ["symbol_id"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "tests": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "code": {"type": "string"},
                                "framework": {"type": "string"},
                                "test_type": {"type": "string"}
                            }
                        }
                    }
                }
            })),
            _meta: Some(json!({"category": "testing"})),
        },
        Tool {
            name: "tests.validate".to_string(),
            description: Some("Validate generated tests and estimate coverage".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "test": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "code": {"type": "string"},
                            "framework": {"type": "string"},
                            "test_type": {"type": "string"}
                        },
                        "required": ["code", "framework"],
                        "description": "Test object to validate"
                    }
                },
                "required": ["test"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "valid": {"type": "boolean"},
                    "coverage_estimate": {"type": "number"},
                    "errors": {
                        "type": "array",
                        "items": {"type": "string"}
                    }
                }
            })),
            _meta: Some(json!({"category": "testing"})),
        },
    ]
}

// ============================================================================
// Specification Management Tools
// ============================================================================

/// Get specification management tools
fn get_specification_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "specs.list".to_string(),
            description: Some("List all specifications in the specs directory".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "specs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "path": {"type": "string"},
                                "version": {"type": "string"},
                                "status": {"type": "string"},
                                "sections": {"type": "array", "items": {"type": "string"}},
                                "size_bytes": {"type": "number"},
                                "last_modified": {"type": "string"}
                            }
                        }
                    },
                    "total_specs": {"type": "number"}
                }
            })),
            _meta: Some(json!({"category": "specifications"})),
        },
        Tool {
            name: "specs.get_structure".to_string(),
            description: Some("Get structure of a specification (TOC, sections, metadata)".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "spec_name": {
                        "type": "string",
                        "description": "Name of the specification (without .md extension)"
                    }
                },
                "required": ["spec_name"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "structure": {"type": "string"},
                    "title": {"type": "string"},
                    "sections": {"type": "array"},
                    "metadata": {"type": "object"}
                }
            })),
            _meta: Some(json!({"category": "specifications"})),
        },
        Tool {
            name: "specs.get_section".to_string(),
            description: Some("Get content of a specific section from a specification".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "spec_name": {
                        "type": "string",
                        "description": "Name of the specification (without .md extension)"
                    },
                    "section_name": {
                        "type": "string",
                        "description": "Name or partial name of the section to retrieve"
                    }
                },
                "required": ["spec_name", "section_name"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "section_title": {"type": "string"}
                }
            })),
            _meta: Some(json!({"category": "specifications"})),
        },
        Tool {
            name: "specs.search".to_string(),
            description: Some("Search for text across all specifications".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query text"
                    },
                    "max_results": {
                        "type": "integer",
                        "default": 20,
                        "description": "Maximum number of results to return"
                    }
                },
                "required": ["query"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "results": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "spec_name": {"type": "string"},
                                "spec_path": {"type": "string"},
                                "section_title": {"type": "string"},
                                "snippet": {"type": "string"},
                                "line_start": {"type": "number"},
                                "line_end": {"type": "number"}
                            }
                        }
                    },
                    "total_results": {"type": "number"}
                }
            })),
            _meta: Some(json!({"category": "specifications"})),
        },
        Tool {
            name: "specs.validate".to_string(),
            description: Some("Validate specification completeness and quality".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "spec_name": {
                        "type": "string",
                        "description": "Name of the specification to validate (without .md extension)"
                    }
                },
                "required": ["spec_name"]
            }),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "valid": {"type": "boolean"},
                    "completeness_score": {"type": "number"},
                    "issues": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "severity": {"type": "string", "enum": ["Error", "Warning", "Info"]},
                                "message": {"type": "string"},
                                "section": {"type": "string"}
                            }
                        }
                    }
                }
            })),
            _meta: Some(json!({"category": "specifications"})),
        },
    ]
}

// ============================================================================
// Progress Management Tools (Phase 2)
// ============================================================================

/// Get progress management tools
fn get_progress_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "progress.create_task".to_string(),
            description: Some("Create a new task for tracking progress".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Task title"},
                    "description": {"type": "string", "description": "Detailed description"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                    "spec_ref": {
                        "type": "object",
                        "properties": {
                            "spec_name": {"type": "string"},
                            "section": {"type": "string"}
                        }
                    },
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "estimated_hours": {"type": "number"}
                },
                "required": ["title"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
        Tool {
            name: "progress.update_task".to_string(),
            description: Some("Update an existing task".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                    "status": {"type": "string", "enum": ["pending", "in_progress", "blocked", "done", "cancelled"]},
                    "status_note": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "estimated_hours": {"type": "number"},
                    "actual_hours": {"type": "number"},
                    "commit_hash": {"type": "string"}
                },
                "required": ["task_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
        Tool {
            name: "progress.list_tasks".to_string(),
            description: Some("List tasks with optional filtering".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["pending", "in_progress", "blocked", "done", "cancelled"]},
                    "spec_name": {"type": "string"},
                    "limit": {"type": "integer"}
                }
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
        Tool {
            name: "progress.get_task".to_string(),
            description: Some("Get detailed information about a specific task".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"}
                },
                "required": ["task_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
        Tool {
            name: "progress.delete_task".to_string(),
            description: Some("Delete a task".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"}
                },
                "required": ["task_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
        Tool {
            name: "progress.get_progress".to_string(),
            description: Some("Get progress statistics for all tasks or a specific spec".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "spec_name": {"type": "string"}
                }
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
        Tool {
            name: "progress.search_tasks".to_string(),
            description: Some("Search tasks by title or ID".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer"}
                },
                "required": ["query"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
        Tool {
            name: "progress.link_to_spec".to_string(),
            description: Some("Link a task to a specification section".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "spec_name": {"type": "string"},
                    "section": {"type": "string"}
                },
                "required": ["task_id", "spec_name", "section"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
        Tool {
            name: "progress.get_history".to_string(),
            description: Some("Get the complete history of status changes for a task".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"}
                },
                "required": ["task_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
        Tool {
            name: "progress.mark_complete".to_string(),
            description: Some("Mark a task as complete".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "note": {"type": "string"},
                    "actual_hours": {"type": "number"},
                    "commit_hash": {"type": "string"}
                },
                "required": ["task_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "progress"})),
        },
    ]
}

// ============================================================================
// Semantic Links Tools (Phase 2)
// ============================================================================

/// Get semantic links tools
fn get_links_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "links.find_implementation".to_string(),
            description: Some("Find code that implements a specification".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "spec_id": {"type": "string", "description": "Specification identifier"}
                },
                "required": ["spec_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.find_documentation".to_string(),
            description: Some("Find documentation for code".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "code_id": {"type": "string", "description": "Code identifier"}
                },
                "required": ["code_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.find_examples".to_string(),
            description: Some("Find examples that demonstrate code usage".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "code_id": {"type": "string", "description": "Code identifier"}
                },
                "required": ["code_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.find_tests".to_string(),
            description: Some("Find tests that verify code".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "code_id": {"type": "string", "description": "Code identifier"}
                },
                "required": ["code_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.add_link".to_string(),
            description: Some("Add a new semantic link between entities".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "link_type": {"type": "string"},
                    "source_level": {"type": "string", "enum": ["spec", "code", "docs", "examples", "tests"]},
                    "source_id": {"type": "string"},
                    "target_level": {"type": "string", "enum": ["spec", "code", "docs", "examples", "tests"]},
                    "target_id": {"type": "string"},
                    "confidence": {"type": "number"},
                    "context": {"type": "string"}
                },
                "required": ["link_type", "source_level", "source_id", "target_level", "target_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.remove_link".to_string(),
            description: Some("Remove a semantic link".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "link_id": {"type": "string"}
                },
                "required": ["link_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.get_links".to_string(),
            description: Some("Get all links for an entity".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "entity_level": {"type": "string", "enum": ["spec", "code", "docs", "examples", "tests"]},
                    "entity_id": {"type": "string"},
                    "direction": {"type": "string", "enum": ["outgoing", "incoming", "both"]}
                },
                "required": ["entity_level", "entity_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.validate".to_string(),
            description: Some("Validate and update link status".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "link_id": {"type": "string"},
                    "status": {"type": "string", "enum": ["valid", "broken", "stale", "unchecked"]}
                },
                "required": ["link_id", "status"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.trace_path".to_string(),
            description: Some("Find the path between two entities through links".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "from_level": {"type": "string", "enum": ["spec", "code", "docs", "examples", "tests"]},
                    "from_id": {"type": "string"},
                    "to_level": {"type": "string", "enum": ["spec", "code", "docs", "examples", "tests"]},
                    "to_id": {"type": "string"},
                    "max_depth": {"type": "integer"}
                },
                "required": ["from_level", "from_id", "to_level", "to_id"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.get_health".to_string(),
            description: Some("Get health metrics for the links system".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.find_orphans".to_string(),
            description: Some("Find entities with no links".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "level": {"type": "string", "enum": ["spec", "code", "docs", "examples", "tests"]}
                }
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
        Tool {
            name: "links.extract_from_file".to_string(),
            description: Some("Extract semantic links from a file".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "file_path": {"type": "string"},
                    "method": {"type": "string"}
                },
                "required": ["file_path"]
            }),
            output_schema: None,
            _meta: Some(json!({"category": "links"})),
        },
    ]
}
