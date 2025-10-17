use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tracing::info;

use meridian::{MeridianServer, Config};

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

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Initialize logging
    if cli.verbose {
        tracing_subscriber::fmt()
            .with_env_filter("meridian=debug")
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter("meridian=info")
            .init();
    }

    info!("Meridian cognitive memory system starting...");

    // Load configuration
    let config = Config::from_file(&cli.config)?;

    match cli.command {
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
