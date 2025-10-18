// Example: Integrating BackupManager with Meridian MCP Server
//
// This example shows how to initialize and use the backup system
// in the Meridian MCP server.

use meridian::storage::{BackupConfig, BackupManager};
use meridian::mcp::ToolHandlers;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Initialize BackupManager with default config
    let db_path = PathBuf::from("~/.meridian/data");
    let backup_config = BackupConfig::default();

    let backup_manager = BackupManager::new(db_path.clone(), backup_config)?;
    let backup_manager = Arc::new(RwLock::new(backup_manager));

    println!("✅ Backup manager initialized");

    // 2. Set backup manager in ToolHandlers
    // Note: This assumes you have already initialized ToolHandlers
    // In actual integration, you would do this during MCP server startup

    /*
    let mut handlers = ToolHandlers::new(
        memory_system,
        context_manager,
        indexer,
        session_manager,
        doc_indexer,
        spec_manager,
        progress_manager,
        links_storage,
        pattern_engine,
    );

    // Add backup manager to handlers
    handlers.set_backup_manager(backup_manager.clone());
    */

    // 3. Create a manual backup
    {
        let metadata = backup_manager.write().await.create_backup(
            meridian::storage::BackupType::Manual,
            Some("Example manual backup".to_string()),
            vec!["example".to_string()],
        ).await?;

        println!("📦 Created backup: {}", metadata.id);
        println!("   Size: {} bytes", metadata.size_bytes);
        println!("   Files: {}", metadata.file_count);
        println!("   Verified: {}", metadata.verified);
    }

    // 4. List all backups
    {
        let backups = backup_manager.read().await.list_backups().await?;
        println!("\n📋 Available backups:");
        for backup in &backups {
            println!("   {} - {} - {:?}",
                backup.id,
                backup.created_at,
                backup.backup_type
            );
        }
    }

    // 5. Get backup statistics
    {
        let stats = backup_manager.read().await.get_stats().await?;
        println!("\n📊 Backup statistics:");
        println!("   Total backups: {}", stats.total_backups);
        println!("   Total size: {} bytes", stats.total_size_bytes);
        println!("   Verified: {}", stats.verified_count);
        println!("   Unverified: {}", stats.unverified_count);
    }

    // 6. Create a scheduled backup (simulating cron job)
    {
        let metadata = backup_manager.write().await.create_scheduled_backup().await?;
        println!("\n⏰ Created scheduled backup: {}", metadata.id);
    }

    // 7. Verify a backup
    {
        let backups = backup_manager.read().await.list_backups().await?;
        if let Some(first_backup) = backups.first() {
            backup_manager.write().await.verify_backup(&first_backup.id).await?;
            println!("\n✅ Verified backup: {}", first_backup.id);
        }
    }

    Ok(())
}

// Example: Custom backup configuration
#[allow(dead_code)]
fn custom_backup_config() -> BackupConfig {
    use std::env;

    let home_dir = env::var("HOME").unwrap_or_else(|_| ".".to_string());

    BackupConfig {
        // Store backups in custom location
        backup_dir: PathBuf::from(format!("{}/backups", home_dir)),

        // Keep only last 3 scheduled backups (more aggressive cleanup)
        max_scheduled_backups: 3,

        // Keep more incremental backups for fine-grained recovery
        max_incremental_backups: 20,

        // Auto-verify all backups
        auto_verify: true,

        // Enable compression (future feature)
        compress: false,
    }
}

// Example: Integration with MCP server startup
#[allow(dead_code)]
async fn integrate_with_mcp_server(
    db_path: PathBuf,
    mut handlers: ToolHandlers,
) -> anyhow::Result<()> {
    // 1. Create backup manager
    let backup_config = BackupConfig::default();
    let backup_manager = BackupManager::new(db_path, backup_config)?;
    let backup_manager = Arc::new(RwLock::new(backup_manager));

    // 2. Create initial backup on startup
    let startup_backup = backup_manager.write().await.create_backup(
        meridian::storage::BackupType::Manual,
        Some("Server startup backup".to_string()),
        vec!["startup".to_string()],
    ).await?;

    println!("Created startup backup: {}", startup_backup.id);

    // 3. Set backup manager in handlers
    handlers.set_backup_manager(backup_manager.clone());

    // 4. Start scheduled backup task
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(86400)); // 24 hours

        loop {
            interval.tick().await;

            match backup_manager.write().await.create_scheduled_backup().await {
                Ok(metadata) => {
                    println!("✅ Scheduled backup created: {}", metadata.id);
                }
                Err(e) => {
                    eprintln!("❌ Failed to create scheduled backup: {}", e);
                }
            }
        }
    });

    Ok(())
}

// Example: Pre-migration backup
#[allow(dead_code)]
async fn create_pre_migration_backup(
    backup_manager: &Arc<RwLock<BackupManager>>,
    current_schema_version: u32,
    target_schema_version: u32,
) -> anyhow::Result<()> {
    println!("Creating pre-migration backup...");

    let metadata = backup_manager.write().await.create_pre_migration_backup(
        current_schema_version,
        Some(format!(
            "Pre-migration backup: v{} -> v{}",
            current_schema_version,
            target_schema_version
        )),
    ).await?;

    println!("✅ Pre-migration backup created: {}", metadata.id);
    println!("   Schema version: {}", current_schema_version);
    println!("   Size: {} bytes", metadata.size_bytes);

    Ok(())
}

// Example: Disaster recovery
#[allow(dead_code)]
async fn disaster_recovery(
    backup_manager: &Arc<RwLock<BackupManager>>,
) -> anyhow::Result<()> {
    println!("🚨 Disaster recovery mode");

    // List all verified backups
    let backups = backup_manager.read().await.list_backups().await?;
    let verified_backups: Vec<_> = backups
        .into_iter()
        .filter(|b| b.verified)
        .collect();

    if verified_backups.is_empty() {
        eprintln!("❌ No verified backups available!");
        return Ok(());
    }

    // Show available backups
    println!("\n📋 Available verified backups:");
    for (i, backup) in verified_backups.iter().enumerate() {
        println!("{}. {} - {} ({} bytes)",
            i + 1,
            backup.id,
            backup.created_at,
            backup.size_bytes
        );
        if let Some(ref desc) = backup.description {
            println!("   Description: {}", desc);
        }
    }

    // In a real scenario, you would prompt user for selection
    // For this example, we'll restore the most recent
    let most_recent = &verified_backups[0];

    println!("\n🔄 Restoring from: {}", most_recent.id);

    backup_manager.write().await.restore_backup(&most_recent.id, None).await?;

    println!("✅ Database restored successfully!");

    Ok(())
}
