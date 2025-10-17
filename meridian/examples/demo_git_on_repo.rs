/// Demo the Git history functionality on the actual Meridian repository
/// Run with: cargo run --example demo_git_on_repo

use anyhow::Result;
use meridian::git::GitHistory;
use std::path::Path;

fn main() -> Result<()> {
    println!("=== Git History Demo on Meridian Repository ===\n");

    // Get the current repository path
    let repo_path = Path::new(env!("CARGO_MANIFEST_DIR"));
    println!("Repository path: {}\n", repo_path.display());

    // Initialize GitHistory
    let git_history = GitHistory::new(repo_path)?;
    println!("✓ Successfully opened git repository\n");

    // Test 1: Get evolution of Cargo.toml
    println!("=== File Evolution: Cargo.toml (last 5 commits) ===");
    let cargo_toml = repo_path.join("Cargo.toml");
    match git_history.get_file_evolution(&cargo_toml, 5) {
        Ok(commits) => {
            println!("Found {} commits affecting Cargo.toml:", commits.len());
            for (i, commit) in commits.iter().enumerate() {
                println!(
                    "  {}. [{}] {} - {}",
                    i + 1,
                    &commit.sha[..8],
                    commit.author,
                    commit.message.lines().next().unwrap_or("")
                );
                println!("     Date: {}", commit.date.format("%Y-%m-%d %H:%M:%S"));
                println!("     Changes: {}\n", commit.changes);
            }
        }
        Err(e) => println!("Error: {}", e),
    }

    // Test 2: Get blame for src/lib.rs (first 20 lines)
    println!("\n=== Git Blame: src/lib.rs (lines 1-15) ===");
    let lib_rs = repo_path.join("src/lib.rs");
    match git_history.get_blame(&lib_rs, Some(1), Some(15)) {
        Ok(blame_info) => {
            println!("Blame information:");
            for info in blame_info.iter().take(15) {
                println!(
                    "  Line {:3}: [{}] {} - {}",
                    info.line,
                    &info.sha[..8],
                    info.author,
                    info.content.chars().take(60).collect::<String>()
                );
            }
        }
        Err(e) => println!("Error: {}", e),
    }

    // Test 3: Get evolution of the git history module itself
    println!("\n=== File Evolution: src/git/history.rs (first commit only) ===");
    let history_rs = repo_path.join("src/git/history.rs");
    match git_history.get_file_evolution(&history_rs, 1) {
        Ok(commits) => {
            if let Some(commit) = commits.first() {
                println!("First commit for src/git/history.rs:");
                println!("  SHA: {}", commit.sha);
                println!("  Author: {} <{}>", commit.author, commit.author_email);
                println!("  Date: {}", commit.date.format("%Y-%m-%d %H:%M:%S"));
                println!("  Message: {}", commit.message);
                println!("  Changes: {} insertions, {} deletions",
                    commit.insertions, commit.deletions);
            } else {
                println!("  No commits found (file may not be committed yet)");
            }
        }
        Err(e) => println!("Error: {}", e),
    }

    println!("\n=== Demo Complete ===");
    Ok(())
}
