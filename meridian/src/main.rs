use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tracing::info;

use meridian::{MeridianServer, Config};
use meridian::global::{GlobalServer, GlobalServerConfig};

// Helper functions for status command
fn calculate_dir_size(path: &std::path::Path) -> std::io::Result<u64> {
    let mut total = 0;
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                total += calculate_dir_size(&path)?;
            } else {
                total += entry.metadata()?.len();
            }
        }
    }
    Ok(total)
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} bytes", bytes)
    }
}

#[derive(Parser)]
#[command(name = "meridian")]
#[command(about = "Cognitive memory system for LLM codebase interaction", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Path to configuration file
    #[arg(short, long, default_value = "meridian.toml")]
    config: PathBuf,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Global server management
    Server {
        #[command(subcommand)]
        command: ServerCommands,
    },

    /// Project management
    Projects {
        #[command(subcommand)]
        command: ProjectsCommands,
    },

    /// Start the MCP server
    Serve {
        /// Use stdio transport (default)
        #[arg(long)]
        stdio: bool,

        /// Unix socket path
        #[arg(long)]
        socket: Option<PathBuf>,

        /// Use HTTP/SSE transport
        #[arg(long)]
        http: bool,
    },

    /// Index a project
    Index {
        /// Project root directory
        path: PathBuf,

        /// Force full reindex
        #[arg(short, long)]
        force: bool,
    },

    /// Query the index
    Query {
        /// Search query
        query: String,

        /// Maximum results
        #[arg(short, long, default_value = "10")]
        limit: usize,
    },

    /// Show index statistics
    Stats {
        /// Detailed statistics
        #[arg(short, long)]
        detailed: bool,
    },

    /// Initialize a new index
    Init {
        /// Project root directory
        path: PathBuf,
    },
}

#[derive(Subcommand)]
enum ServerCommands {
    /// Start the global server
    Start {
        /// Run in foreground (don't daemonize)
        #[arg(long)]
        foreground: bool,
    },

    /// Stop the global server
    Stop,

    /// Show server status
    Status,
}

#[derive(Subcommand)]
enum ProjectsCommands {
    /// Add a monorepo/project
    Add {
        /// Path to monorepo or project
        path: PathBuf,
    },

    /// List all registered projects
    List {
        /// Filter by monorepo ID
        #[arg(long)]
        monorepo: Option<String>,
    },

    /// Show project information
    Info {
        /// Project ID
        project_id: String,
    },

    /// Relocate a project
    Relocate {
        /// Project ID (full_id like "@scope/name@version")
        project_id: String,

        /// New path
        new_path: PathBuf,
    },

    /// Remove a project
    Remove {
        /// Project ID
        project_id: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Check if we're in stdio mode - if so, disable console logging
    let is_stdio = matches!(cli.command, Commands::Serve { stdio: true, .. } | Commands::Serve { stdio: false, socket: None, http: false });

    // Initialize logging
    if is_stdio {
        // In STDIO mode, redirect logs to file to avoid interfering with JSON-RPC protocol
        use tracing_subscriber::fmt::writer::MakeWriterExt;
        use std::fs::{create_dir_all, OpenOptions};
        use meridian::config::get_meridian_home;

        // Create log directory
        let log_dir = get_meridian_home().join("logs");
        create_dir_all(&log_dir).ok();

        // Create log file
        if let Ok(log_file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_dir.join("meridian.log"))
        {
            tracing_subscriber::fmt()
                .with_writer(log_file.with_max_level(tracing::Level::INFO))
                .with_ansi(false)
                .with_env_filter(if cli.verbose { "meridian=debug" } else { "meridian=info" })
                .init();
        } else {
            // Fallback: disable logging if we can't create log file
            tracing_subscriber::fmt()
                .with_writer(std::io::sink)
                .init();
        }
    } else {
        // For non-STDIO modes, log to stderr as usual
        if cli.verbose {
            tracing_subscriber::fmt()
                .with_env_filter("meridian=debug")
                .init();
        } else {
            tracing_subscriber::fmt()
                .with_env_filter("meridian=info")
                .init();
        }
    }

    info!("Meridian cognitive memory system starting...");

    // Load configuration
    let config = Config::from_file(&cli.config)?;

    match cli.command {
        Commands::Server { command } => {
            handle_server_command(command).await?;
        }
        Commands::Projects { command } => {
            handle_projects_command(command).await?;
        }
        Commands::Serve { stdio, socket, http } => {
            info!("Starting MCP server...");
            serve_mcp(config, stdio, socket, http).await?;
        }
        Commands::Index { path, force } => {
            info!("Indexing project at {:?}", path);
            index_project(config, path, force).await?;
        }
        Commands::Query { query, limit } => {
            info!("Executing query: {}", query);
            execute_query(config, query, limit).await?;
        }
        Commands::Stats { detailed } => {
            show_stats(config, detailed).await?;
        }
        Commands::Init { path } => {
            info!("Initializing index at {:?}", path);
            initialize_index(config, path).await?;
        }
    }

    Ok(())
}

async fn handle_server_command(command: ServerCommands) -> Result<()> {
    match command {
        ServerCommands::Start { foreground } => {
            info!("Starting global server...");
            let config = GlobalServerConfig::default();
            let server = GlobalServer::new(config).await?;
            server.start().await?;

            if foreground {
                info!("Running in foreground. Press Ctrl+C to stop.");
                // Wait indefinitely
                tokio::signal::ctrl_c().await?;
                server.stop().await?;
            } else {
                info!("Global server started in background");
                // TODO: Implement proper daemonization
                println!("Global server started");
            }
        }
        ServerCommands::Stop => {
            info!("Stopping global server...");
            // TODO: Implement proper daemon stopping mechanism
            println!("Global server stop requested");
        }
        ServerCommands::Status => {
            use meridian::config::get_meridian_home;
            use std::fs;

            println!("Meridian Global Server Status");
            println!("============================");
            println!();

            // Check data directory
            let data_dir = get_meridian_home().join("data");
            let data_exists = data_dir.exists();

            println!("Data Directory: {}", data_dir.display());
            println!("  Status: {}", if data_exists { "✓ Exists" } else { "✗ Not initialized" });

            if data_exists {
                if let Ok(metadata) = fs::metadata(&data_dir) {
                    println!("  Created: {:?}", metadata.created().ok());
                    println!("  Modified: {:?}", metadata.modified().ok());
                }
            }
            println!();

            // Check cache directory
            let cache_dir = get_meridian_home().join("cache");
            println!("Cache Directory: {}", cache_dir.display());
            println!("  Status: {}", if cache_dir.exists() { "✓ Exists" } else { "✗ Not initialized" });
            if cache_dir.exists() {
                // Calculate cache size
                if let Ok(size) = calculate_dir_size(&cache_dir) {
                    println!("  Size: {}", format_size(size));
                }
            }
            println!();

            // Check database directory
            let db_dir = get_meridian_home().join("db");
            println!("Database Directory: {}", db_dir.display());
            println!("  Status: {}", if db_dir.exists() { "✓ Exists" } else { "✗ Not initialized" });
            if db_dir.exists() {
                // Count databases
                if let Ok(entries) = fs::read_dir(&db_dir) {
                    let count = entries.filter_map(|e| e.ok()).count();
                    println!("  Databases: {}", count);
                }
                // Calculate DB size
                if let Ok(size) = calculate_dir_size(&db_dir) {
                    println!("  Size: {}", format_size(size));
                }
            }
            println!();

            // Check for registered projects
            if data_exists {
                use meridian::global::{GlobalStorage, ProjectRegistryManager};
                use std::sync::Arc;

                if let Ok(storage) = GlobalStorage::new(&data_dir).await {
                    let storage = Arc::new(storage);
                    let manager = Arc::new(ProjectRegistryManager::new(storage));

                    if let Ok(projects) = manager.list_all().await {
                        println!("Registered Projects: {}", projects.len());
                        for project in projects.iter().take(5) {
                            println!("  • {} ({:?})", project.identity.id, project.identity.project_type);
                        }
                        if projects.len() > 5 {
                            println!("  ... and {} more", projects.len() - 5);
                        }
                    } else {
                        println!("Registered Projects: Unable to read registry");
                    }
                } else {
                    println!("Registered Projects: Unable to access storage");
                }
            }
            println!();

            // Summary
            if !data_exists {
                println!("⚠ Global server not initialized.");
                println!("Run 'meridian server start' to initialize and start the server.");
            } else {
                println!("✓ Global server infrastructure is present.");
                println!("Note: Daemon status checking not yet implemented.");
            }
        }
    }
    Ok(())
}

async fn handle_projects_command(command: ProjectsCommands) -> Result<()> {
    use meridian::global::{GlobalStorage, ProjectRegistryManager};
    use meridian::config::get_meridian_home;
    use std::sync::Arc;

    // Get global storage path
    let data_dir = get_meridian_home().join("data");

    std::fs::create_dir_all(&data_dir)?;

    let storage = Arc::new(GlobalStorage::new(&data_dir).await?);
    let manager = Arc::new(ProjectRegistryManager::new(storage));

    match command {
        ProjectsCommands::Add { path } => {
            info!("Adding project at {:?}", path);
            let registry = manager.register(path.clone()).await?;
            println!("Project registered:");
            println!("  ID: {}", registry.identity.full_id);
            println!("  Name: {}", registry.identity.id);
            println!("  Version: {}", registry.identity.version);
            println!("  Type: {:?}", registry.identity.project_type);
            println!("  Path: {:?}", path);
        }
        ProjectsCommands::List { monorepo } => {
            let projects = manager.list_all().await?;

            if projects.is_empty() {
                println!("No projects registered.");
                println!("Use 'meridian projects add <path>' to register a project.");
                return Ok(());
            }

            println!("Registered projects ({}):", projects.len());
            println!();

            for project in projects {
                if let Some(ref filter) = monorepo {
                    if let Some(ref mono) = project.monorepo {
                        if &mono.id != filter {
                            continue;
                        }
                    } else {
                        continue;
                    }
                }

                println!("  {} ({})", project.identity.id, project.identity.version);
                println!("    Full ID: {}", project.identity.full_id);
                println!("    Type: {:?}", project.identity.project_type);
                println!("    Path: {:?}", project.current_path);
                println!("    Status: {:?}", project.status);
                if let Some(ref mono) = project.monorepo {
                    println!("    Monorepo: {}", mono.id);
                }
                println!();
            }
        }
        ProjectsCommands::Info { project_id } => {
            match manager.get(&project_id).await? {
                Some(project) => {
                    println!("Project: {}", project.identity.id);
                    println!("  Full ID: {}", project.identity.full_id);
                    println!("  Version: {}", project.identity.version);
                    println!("  Type: {:?}", project.identity.project_type);
                    println!("  Current Path: {:?}", project.current_path);
                    println!("  Status: {:?}", project.status);
                    println!("  Created: {}", project.created_at);
                    println!("  Updated: {}", project.updated_at);
                    println!();
                    println!("Path History:");
                    for (i, entry) in project.path_history.iter().enumerate() {
                        println!(
                            "  {}. {} - {} ({})",
                            i + 1,
                            entry.timestamp.format("%Y-%m-%d %H:%M:%S"),
                            entry.path,
                            entry.reason
                        );
                    }
                }
                None => {
                    println!("Project not found: {}", project_id);
                }
            }
        }
        ProjectsCommands::Relocate {
            project_id,
            new_path,
        } => {
            manager
                .relocate_project(&project_id, new_path.clone(), "user-initiated".to_string())
                .await?;
            println!("Project relocated to {:?}", new_path);
        }
        ProjectsCommands::Remove { project_id } => {
            manager.delete(&project_id).await?;
            println!("Project marked as deleted: {}", project_id);
        }
    }

    Ok(())
}

async fn serve_mcp(config: Config, stdio: bool, socket: Option<PathBuf>, http: bool) -> Result<()> {
    if http {
        // Create Meridian server in multi-project mode for HTTP
        info!("Starting MCP server with HTTP/SSE transport");
        let mut server = MeridianServer::new_for_http(config)?;
        server.serve_http().await?;
    } else {
        // Create Meridian server in single-project mode for stdio/socket
        let mut server = MeridianServer::new(config).await?;

        if stdio || socket.is_none() {
            info!("Starting MCP server with stdio transport");
            server.serve_stdio().await?;
        } else if let Some(socket_path) = socket {
            info!("Starting MCP server with socket transport at {:?}", socket_path);
            server.serve_socket(socket_path).await?;
        }
    }

    Ok(())
}

async fn index_project(config: Config, path: PathBuf, force: bool) -> Result<()> {
    let mut server = MeridianServer::new(config).await?;

    if force {
        info!("Forcing full reindex");
    }

    server.index_project(path, force).await?;
    info!("Indexing completed successfully");

    Ok(())
}

async fn execute_query(config: Config, query: String, limit: usize) -> Result<()> {
    let server = MeridianServer::new(config).await?;

    let results = server.query(&query, limit).await?;

    println!("Query results ({} found):", results.len());
    for (i, result) in results.iter().enumerate() {
        println!("{}. {}", i + 1, result);
    }

    Ok(())
}

async fn show_stats(config: Config, detailed: bool) -> Result<()> {
    let server = MeridianServer::new(config).await?;

    let stats = server.get_stats().await?;

    println!("Meridian Index Statistics");
    println!("========================");
    println!("Total symbols: {}", stats.total_symbols);
    println!("Total files: {}", stats.total_files);
    println!("Total projects: {}", stats.total_projects);
    println!("Index size: {} MB", stats.index_size_mb);

    if detailed {
        println!("\nDetailed Statistics:");
        println!("-------------------");
        println!("Episodes: {}", stats.episodes_count);
        println!("Working memory size: {}", stats.working_memory_size);
        println!("Semantic patterns: {}", stats.semantic_patterns);
        println!("Procedural knowledge: {}", stats.procedures_count);
    }

    Ok(())
}

async fn initialize_index(config: Config, path: PathBuf) -> Result<()> {
    info!("Initializing new index at {:?}", path);

    let server = MeridianServer::new(config).await?;
    let path_display = path.display().to_string();
    server.initialize(path).await?;

    info!("Index initialized successfully");
    println!("Meridian index initialized at {:?}", path_display);
    println!("Run 'meridian index {}' to start indexing", path_display);

    Ok(())
}
