use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// MCP Tool definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema: Value,
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
                    }
                },
                "required": ["attention_pattern", "token_budget"]
            }),
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
                    }
                },
                "required": ["session_id"]
            }),
        },
    ]
}

/// MCP Resource definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// Get all available resources
pub fn get_all_resources() -> Vec<Resource> {
    vec![
        Resource {
            uri: "meridian://index/current".to_string(),
            name: Some("Current Index State".to_string()),
            description: Some("Current state of the code index".to_string()),
            mime_type: Some("application/json".to_string()),
        },
        Resource {
            uri: "meridian://memory/episodes".to_string(),
            name: Some("Task Episodes".to_string()),
            description: Some("History of task episodes for learning".to_string()),
            mime_type: Some("application/json".to_string()),
        },
        Resource {
            uri: "meridian://memory/working".to_string(),
            name: Some("Working Memory".to_string()),
            description: Some("Current working memory state".to_string()),
            mime_type: Some("application/json".to_string()),
        },
        Resource {
            uri: "meridian://sessions/active".to_string(),
            name: Some("Active Sessions".to_string()),
            description: Some("List of active work sessions".to_string()),
            mime_type: Some("application/json".to_string()),
        },
    ]
}

/// Server capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCapabilities {
    pub tools: bool,
    pub resources: bool,
    pub prompts: bool,
    pub logging: bool,
}

impl Default for ServerCapabilities {
    fn default() -> Self {
        Self {
            tools: true,
            resources: true,
            prompts: true,
            logging: true,
        }
    }
}
