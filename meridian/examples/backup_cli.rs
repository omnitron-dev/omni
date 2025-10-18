// Backup CLI Tool for Meridian
//
// Standalone CLI tool for managing Meridian backups without MCP server
//
// Usage:
//   backup_cli create --description "My backup"
//   backup_cli list
//   backup_cli verify <backup-id>
//   backup_cli restore <backup-id>
//   backup_cli delete <backup-id>
//   backup_cli stats

use meridian::storage::{BackupConfig, BackupManager, BackupType};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        print_usage();
        return Ok(());
    }

    // Initialize backup manager
    let db_path = get_db_path();
    let backup_config = BackupConfig::default();
    let backup_manager = BackupManager::new(db_path, backup_config)?;

    match args[1].as_str() {
        "create" => {
            let description = args.get(2).map(|s| s.as_str());
            let tags: Vec<String> = args.get(3..)
                .map(|tags| tags.to_vec())
                .unwrap_or_default();

            println!("Creating manual backup...");
            let metadata = backup_manager.create_backup(
                BackupType::Manual,
                description.map(String::from),
                tags,
            ).await?;

            println!("✅ Backup created successfully!");
            println!("   ID: {}", metadata.id);
            println!("   Created: {}", metadata.created_at);
            println!("   Size: {} bytes ({:.2} MB)",
                metadata.size_bytes,
                metadata.size_bytes as f64 / 1024.0 / 1024.0
            );
            println!("   Files: {}", metadata.file_count);
            println!("   Verified: {}", metadata.verified);
        }

        "list" => {
            let backups = backup_manager.list_backups().await?;

            if backups.is_empty() {
                println!("No backups found.");
                return Ok(());
            }

            println!("📋 Available backups ({}):", backups.len());
            println!();
            println!("{:<30} {:<20} {:<15} {:<10} {:<10}",
                "ID", "Created", "Type", "Size (MB)", "Verified");
            println!("{:-<95}", "");

            for backup in backups {
                let size_mb = backup.size_bytes as f64 / 1024.0 / 1024.0;
                let verified = if backup.verified { "✓" } else { "✗" };

                println!("{:<30} {:<20} {:<15} {:<10.2} {:<10}",
                    backup.id,
                    backup.created_at.format("%Y-%m-%d %H:%M:%S"),
                    format!("{:?}", backup.backup_type),
                    size_mb,
                    verified
                );

                if let Some(ref desc) = backup.description {
                    println!("   └─ {}", desc);
                }
            }
        }

        "verify" => {
            if args.len() < 3 {
                eprintln!("❌ Error: Missing backup ID");
                eprintln!("Usage: backup_cli verify <backup-id>");
                return Ok(());
            }

            let backup_id = &args[2];
            println!("Verifying backup: {}", backup_id);

            backup_manager.verify_backup(backup_id).await?;

            println!("✅ Backup verified successfully!");
        }

        "restore" => {
            if args.len() < 3 {
                eprintln!("❌ Error: Missing backup ID");
                eprintln!("Usage: backup_cli restore <backup-id> [target-path]");
                return Ok(());
            }

            let backup_id = &args[2];
            let target_path = args.get(3).map(PathBuf::from);

            println!("⚠️  WARNING: This will restore the database from backup.");
            println!("   A safety backup will be created automatically.");
            println!();
            print!("   Continue? [y/N]: ");

            use std::io::{self, BufRead};
            let stdin = io::stdin();
            let mut line = String::new();
            stdin.lock().read_line(&mut line)?;

            if !line.trim().eq_ignore_ascii_case("y") {
                println!("Restore cancelled.");
                return Ok(());
            }

            println!("Restoring from backup: {}", backup_id);
            backup_manager.restore_backup(backup_id, target_path).await?;

            println!("✅ Database restored successfully!");
        }

        "delete" => {
            if args.len() < 3 {
                eprintln!("❌ Error: Missing backup ID");
                eprintln!("Usage: backup_cli delete <backup-id>");
                return Ok(());
            }

            let backup_id = &args[2];

            println!("⚠️  WARNING: This will permanently delete the backup.");
            println!("   Backup ID: {}", backup_id);
            println!();
            print!("   Continue? [y/N]: ");

            use std::io::{self, BufRead};
            let stdin = io::stdin();
            let mut line = String::new();
            stdin.lock().read_line(&mut line)?;

            if !line.trim().eq_ignore_ascii_case("y") {
                println!("Delete cancelled.");
                return Ok(());
            }

            backup_manager.delete_backup(backup_id).await?;

            println!("✅ Backup deleted successfully!");
        }

        "stats" => {
            let stats = backup_manager.get_stats().await?;

            println!("📊 Backup System Statistics");
            println!();
            println!("Total backups: {}", stats.total_backups);
            println!("Total size: {} bytes ({:.2} GB)",
                stats.total_size_bytes,
                stats.total_size_bytes as f64 / 1024.0 / 1024.0 / 1024.0
            );
            println!();

            println!("By type:");
            for (backup_type, count) in &stats.by_type {
                println!("  {}: {}", backup_type, count);
            }
            println!();

            println!("Verification status:");
            println!("  Verified: {}", stats.verified_count);
            println!("  Unverified: {}", stats.unverified_count);
            println!();

            if let Some(oldest) = stats.oldest_backup {
                println!("Oldest backup: {}", oldest);
            }
            if let Some(newest) = stats.newest_backup {
                println!("Newest backup: {}", newest);
            }
        }

        "scheduled" => {
            println!("Creating scheduled backup...");
            let metadata = backup_manager.create_scheduled_backup().await?;

            println!("✅ Scheduled backup created!");
            println!("   ID: {}", metadata.id);
            println!("   Created: {}", metadata.created_at);
        }

        _ => {
            eprintln!("❌ Unknown command: {}", args[1]);
            print_usage();
        }
    }

    Ok(())
}

fn print_usage() {
    println!("Meridian Backup CLI");
    println!();
    println!("USAGE:");
    println!("  backup_cli <command> [options]");
    println!();
    println!("COMMANDS:");
    println!("  create [description] [tags...]  Create a manual backup");
    println!("  list                            List all backups");
    println!("  verify <backup-id>              Verify backup integrity");
    println!("  restore <backup-id> [path]      Restore from backup");
    println!("  delete <backup-id>              Delete a backup");
    println!("  stats                           Show backup statistics");
    println!("  scheduled                       Create a scheduled backup");
    println!();
    println!("EXAMPLES:");
    println!("  backup_cli create \"Pre-deployment backup\" prod safety");
    println!("  backup_cli list");
    println!("  backup_cli verify 20251018_214530_manual");
    println!("  backup_cli restore 20251018_214530_manual");
    println!("  backup_cli delete 20251018_214530_manual");
    println!("  backup_cli stats");
}

fn get_db_path() -> PathBuf {
    std::env::var("MERIDIAN_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".meridian")
                .join("data")
        })
}
