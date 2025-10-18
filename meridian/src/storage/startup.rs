// Startup migration checks for Meridian MCP server

use anyhow::{Context, Result};
use std::sync::Arc;
use tracing::{error, info, warn};

use super::migration::{MigrationManager, SchemaVersion};
use super::migrations::register_all_migrations;
use super::Storage;

/// Check schema version and run migrations if needed on startup
pub async fn check_and_migrate(storage: Arc<dyn Storage>) -> Result<()> {
    info!("Checking schema version...");

    let mut manager = MigrationManager::new(storage.clone());

    // Register all available migrations
    register_all_migrations(&mut manager.registry);

    // Get current version
    let current_version = manager.get_current_version().await?;
    let target_version = SchemaVersion::current();

    info!(
        "Current schema version: {}, Target version: {}",
        current_version, target_version
    );

    // Check if migration is needed
    if current_version == target_version {
        info!("✓ Schema is up to date");
        return Ok(());
    }

    if current_version > target_version {
        error!(
            "Schema version {} is newer than supported version {}",
            current_version, target_version
        );
        return Err(anyhow::anyhow!(
            "Database schema is newer than this version of Meridian supports. \
             Please upgrade Meridian to the latest version."
        ));
    }

    // Migration is needed
    warn!(
        "Schema migration required: {} -> {}",
        current_version, target_version
    );

    // Show migration history
    let history = manager.get_migration_history().await?;
    if !history.migrations.is_empty() {
        info!("Previous migrations:");
        for migration in &history.migrations {
            info!(
                "  - {} -> {} at {} ({})",
                migration.from_version,
                migration.to_version,
                migration.started_at.format("%Y-%m-%d %H:%M:%S"),
                if migration.success {
                    "success"
                } else {
                    "failed"
                }
            );
        }
    }

    info!("Starting automatic migration...");

    // Run migrations
    match manager.migrate_to_current().await {
        Ok(results) => {
            info!("✓ Migration completed successfully");
            for result in &results {
                info!(
                    "  - {} -> {}: {} items migrated in {:.2}s",
                    result.from_version,
                    result.to_version,
                    result.items_migrated,
                    (result.completed_at - result.started_at).num_milliseconds() as f64 / 1000.0
                );
                if let Some(ref backup_key) = result.backup_key {
                    info!("    Backup created: {}", backup_key);
                }
            }
            Ok(())
        }
        Err(e) => {
            error!("✗ Migration failed: {}", e);
            error!("Database has been rolled back to previous state");
            error!("Please check the logs and report this issue");
            Err(e).context("Schema migration failed")
        }
    }
}

/// Print migration status (for CLI commands)
pub async fn print_migration_status(storage: Arc<dyn Storage>) -> Result<()> {
    let manager = MigrationManager::new(storage);

    let current_version = manager.get_current_version().await?;
    let target_version = SchemaVersion::current();

    println!("Schema Version Status");
    println!("====================");
    println!("Current version: {}", current_version);
    println!("Target version:  {}", target_version);
    println!();

    if current_version == target_version {
        println!("✓ Schema is up to date");
    } else if current_version < target_version {
        println!("⚠ Migration needed: {} -> {}", current_version, target_version);
    } else {
        println!(
            "✗ Schema version is newer than supported (database: {}, supported: {})",
            current_version, target_version
        );
    }
    println!();

    // Show migration history
    let history = manager.get_migration_history().await?;
    if history.migrations.is_empty() {
        println!("No migrations have been run yet");
    } else {
        println!("Migration History:");
        println!("------------------");
        for (i, migration) in history.migrations.iter().enumerate() {
            println!(
                "{}. {} -> {} at {}",
                i + 1,
                migration.from_version,
                migration.to_version,
                migration.started_at.format("%Y-%m-%d %H:%M:%S")
            );
            println!(
                "   Status: {}",
                if migration.success {
                    "✓ Success"
                } else {
                    "✗ Failed"
                }
            );
            println!("   Items migrated: {}", migration.items_migrated);
            println!(
                "   Duration: {:.2}s",
                (migration.completed_at - migration.started_at).num_milliseconds() as f64 / 1000.0
            );
            if let Some(ref backup_key) = migration.backup_key {
                println!("   Backup: {}", backup_key);
            }
            if let Some(ref error) = migration.error {
                println!("   Error: {}", error);
            }
            println!();
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::rocksdb_storage::RocksDBStorage;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_check_and_migrate_no_migration_needed() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;

        // Set version to current
        let manager = MigrationManager::new(storage.clone());
        manager
            .set_current_version(SchemaVersion::current())
            .await
            .unwrap();

        // Should succeed without running any migrations
        let result = check_and_migrate(storage).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_print_migration_status() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap()) as Arc<dyn Storage>;

        // Should not panic
        let result = print_migration_status(storage).await;
        assert!(result.is_ok());
    }
}
