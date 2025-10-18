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
