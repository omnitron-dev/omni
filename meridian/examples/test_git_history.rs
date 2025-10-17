/// Standalone test for GitHistory functionality
/// Run with: cargo run --example test_git_history
use anyhow::Result;
use chrono::{DateTime, Utc};
use git2::{BlameOptions, DiffOptions, Repository};
use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

/// Information about a single commit affecting a file
#[derive(Debug, Clone)]
pub struct CommitInfo {
    pub sha: String,
    pub author: String,
    pub author_email: String,
    pub date: DateTime<Utc>,
    pub message: String,
    pub changes: String,
    pub insertions: usize,
    pub deletions: usize,
}

/// Information about a line from git blame
#[derive(Debug, Clone)]
pub struct BlameInfo {
    pub line: usize,
    pub author: String,
    pub author_email: String,
    pub sha: String,
    pub date: DateTime<Utc>,
    pub content: String,
}

/// Git history wrapper using git2
pub struct GitHistory {
    repo: Repository,
}

impl GitHistory {
    pub fn new(repo_path: &Path) -> Result<Self> {
        let repo = Repository::discover(repo_path)?;
        Ok(Self { repo })
    }

    pub fn get_file_evolution(&self, file_path: &Path, max_commits: usize) -> Result<Vec<CommitInfo>> {
        let mut revwalk = self.repo.revwalk()?;
        revwalk.push_head()?;

        let mut commits = Vec::new();
        let mut count = 0;

        let workdir = self.repo.workdir().expect("Repository has no working directory");
        let relative_path = if file_path.is_absolute() {
            file_path.strip_prefix(workdir)?
        } else {
            file_path
        };

        for oid in revwalk {
            if count >= max_commits {
                break;
            }

            let oid = oid?;
            let commit = self.repo.find_commit(oid)?;

            if self.commit_touches_file(&commit, relative_path)? {
                let commit_info = self.extract_commit_info(&commit, relative_path)?;
                commits.push(commit_info);
                count += 1;
            }
        }

        Ok(commits)
    }

    pub fn get_blame(
        &self,
        file_path: &Path,
        start_line: Option<usize>,
        end_line: Option<usize>,
    ) -> Result<Vec<BlameInfo>> {
        let workdir = self.repo.workdir().expect("Repository has no working directory");
        let relative_path = if file_path.is_absolute() {
            file_path.strip_prefix(workdir)?
        } else {
            file_path
        };

        let mut blame_opts = BlameOptions::new();

        if let Some(start) = start_line {
            if let Some(end) = end_line {
                blame_opts.min_line(start);
                blame_opts.max_line(end);
            }
        }

        let blame = self.repo.blame_file(relative_path, Some(&mut blame_opts))?;

        let file_full_path = workdir.join(relative_path);
        let content = std::fs::read_to_string(&file_full_path)?;

        let lines: Vec<&str> = content.lines().collect();
        let mut blame_infos = Vec::new();

        for (idx, line_text) in lines.iter().enumerate() {
            let line_num = idx + 1;

            if let Some(start) = start_line {
                if line_num < start {
                    continue;
                }
            }
            if let Some(end) = end_line {
                if line_num > end {
                    break;
                }
            }

            if let Some(hunk) = blame.get_line(line_num) {
                let commit_id = hunk.final_commit_id();
                let commit = self.repo.find_commit(commit_id)?;

                let author = commit.author();
                let timestamp = commit.time().seconds();
                let date = DateTime::from_timestamp(timestamp, 0).unwrap_or_else(Utc::now);

                blame_infos.push(BlameInfo {
                    line: line_num,
                    author: author.name().unwrap_or("Unknown").to_string(),
                    author_email: author.email().unwrap_or("").to_string(),
                    sha: format!("{}", commit_id),
                    date,
                    content: line_text.to_string(),
                });
            }
        }

        Ok(blame_infos)
    }

    fn commit_touches_file(&self, commit: &git2::Commit, file_path: &Path) -> Result<bool> {
        let parent = if commit.parent_count() > 0 {
            Some(commit.parent(0)?)
        } else {
            None
        };

        let commit_tree = commit.tree()?;

        if let Some(parent) = parent {
            let parent_tree = parent.tree()?;

            let mut diff_opts = DiffOptions::new();
            diff_opts.pathspec(file_path);

            let diff = self.repo.diff_tree_to_tree(
                Some(&parent_tree),
                Some(&commit_tree),
                Some(&mut diff_opts),
            )?;

            Ok(diff.deltas().count() > 0)
        } else {
            Ok(commit_tree.get_path(file_path).is_ok())
        }
    }

    fn extract_commit_info(&self, commit: &git2::Commit, file_path: &Path) -> Result<CommitInfo> {
        let author = commit.author();
        let timestamp = commit.time().seconds();
        let date = DateTime::from_timestamp(timestamp, 0).unwrap_or_else(Utc::now);

        let sha = format!("{}", commit.id());
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let author_email = author.email().unwrap_or("").to_string();
        let message = commit.message().unwrap_or("").trim().to_string();

        let (insertions, deletions) = self.get_diff_stats(commit, file_path)?;

        let changes = if insertions > 0 || deletions > 0 {
            format!("+{} -{}", insertions, deletions)
        } else {
            "No changes".to_string()
        };

        Ok(CommitInfo {
            sha,
            author: author_name,
            author_email,
            date,
            message,
            changes,
            insertions,
            deletions,
        })
    }

    fn get_diff_stats(&self, commit: &git2::Commit, file_path: &Path) -> Result<(usize, usize)> {
        let parent = if commit.parent_count() > 0 {
            Some(commit.parent(0)?)
        } else {
            None
        };

        let commit_tree = commit.tree()?;

        let mut diff_opts = DiffOptions::new();
        diff_opts.pathspec(file_path);

        let diff = if let Some(parent) = parent {
            let parent_tree = parent.tree()?;
            self.repo.diff_tree_to_tree(
                Some(&parent_tree),
                Some(&commit_tree),
                Some(&mut diff_opts),
            )?
        } else {
            self.repo.diff_tree_to_tree(None, Some(&commit_tree), Some(&mut diff_opts))?
        };

        let stats = diff.stats()?;
        Ok((stats.insertions(), stats.deletions()))
    }
}

fn create_test_repo() -> Result<(TempDir, std::path::PathBuf)> {
    let temp_dir = TempDir::new()?;
    let repo_path = temp_dir.path().to_path_buf();

    Repository::init(&repo_path)?;

    Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(&repo_path)
        .output()?;

    Command::new("git")
        .args(["config", "user.email", "test@example.com"])
        .current_dir(&repo_path)
        .output()?;

    Ok((temp_dir, repo_path))
}

fn commit_file(repo_path: &Path, filename: &str, content: &str, message: &str) -> Result<()> {
    let file_path = repo_path.join(filename);
    fs::write(&file_path, content)?;

    Command::new("git")
        .args(["add", filename])
        .current_dir(repo_path)
        .output()?;

    Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(repo_path)
        .output()?;

    Ok(())
}

fn main() -> Result<()> {
    println!("=== Testing Git History Implementation ===\n");

    // Test 1: Create repository and test file evolution
    println!("Test 1: File Evolution");
    let (_temp_dir, repo_path) = create_test_repo()?;

    commit_file(&repo_path, "test.txt", "Line 1\n", "Initial commit")?;
    commit_file(&repo_path, "test.txt", "Line 1\nLine 2\n", "Add line 2")?;
    commit_file(&repo_path, "test.txt", "Line 1\nLine 2\nLine 3\n", "Add line 3")?;

    let git_history = GitHistory::new(&repo_path)?;
    let evolution = git_history.get_file_evolution(Path::new("test.txt"), 10)?;

    println!("  Found {} commits for test.txt:", evolution.len());
    for (i, commit) in evolution.iter().enumerate() {
        println!("    {}. [{}] {} - {} ({})",
            i + 1,
            &commit.sha[..7],
            commit.author,
            commit.message,
            commit.changes
        );
    }
    assert_eq!(evolution.len(), 3, "Should have 3 commits");
    println!("  ✓ PASSED\n");

    // Test 2: Test blame functionality
    println!("Test 2: Git Blame");
    let blame_info = git_history.get_blame(Path::new("test.txt"), None, None)?;

    println!("  Blame information for test.txt:");
    for info in &blame_info {
        println!("    Line {}: {} - [{}] {}",
            info.line,
            info.content,
            &info.sha[..7],
            info.author
        );
    }
    assert_eq!(blame_info.len(), 3, "Should have blame for 3 lines");
    println!("  ✓ PASSED\n");

    // Test 3: Test blame with line range
    println!("Test 3: Git Blame with Line Range");
    let blame_range = git_history.get_blame(Path::new("test.txt"), Some(2), Some(3))?;

    println!("  Blame for lines 2-3:");
    for info in &blame_range {
        println!("    Line {}: {}", info.line, info.content);
    }
    assert_eq!(blame_range.len(), 2, "Should have blame for 2 lines");
    println!("  ✓ PASSED\n");

    // Test 4: Test diff stats
    println!("Test 4: Diff Stats");
    let (_temp_dir2, repo_path2) = create_test_repo()?;

    commit_file(&repo_path2, "stats.txt", "Line 1\nLine 2\nLine 3\n", "Initial")?;
    commit_file(&repo_path2, "stats.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n", "Add 2 lines")?;

    let git_history2 = GitHistory::new(&repo_path2)?;
    let evolution2 = git_history2.get_file_evolution(Path::new("stats.txt"), 1)?;

    println!("  Latest commit stats:");
    println!("    Message: {}", evolution2[0].message);
    println!("    Insertions: {}", evolution2[0].insertions);
    println!("    Deletions: {}", evolution2[0].deletions);
    println!("    Changes: {}", evolution2[0].changes);

    assert_eq!(evolution2[0].insertions, 2, "Should have 2 insertions");
    assert_eq!(evolution2[0].deletions, 0, "Should have 0 deletions");
    println!("  ✓ PASSED\n");

    // Test 5: Test with max_commits limit
    println!("Test 5: Max Commits Limit");
    let (_temp_dir3, repo_path3) = create_test_repo()?;

    commit_file(&repo_path3, "limit.txt", "v1\n", "Commit 1")?;
    commit_file(&repo_path3, "limit.txt", "v2\n", "Commit 2")?;
    commit_file(&repo_path3, "limit.txt", "v3\n", "Commit 3")?;
    commit_file(&repo_path3, "limit.txt", "v4\n", "Commit 4")?;

    let git_history3 = GitHistory::new(&repo_path3)?;
    let limited = git_history3.get_file_evolution(Path::new("limit.txt"), 2)?;

    println!("  Requested max 2 commits, got: {}", limited.len());
    for (i, commit) in limited.iter().enumerate() {
        println!("    {}. {}", i + 1, commit.message);
    }
    assert_eq!(limited.len(), 2, "Should have exactly 2 commits");
    println!("  ✓ PASSED\n");

    println!("=== All Tests Passed! ===");
    println!("\nGit History implementation is working correctly:");
    println!("  ✓ File evolution tracking");
    println!("  ✓ Git blame functionality");
    println!("  ✓ Line range filtering");
    println!("  ✓ Diff statistics");
    println!("  ✓ Commit limiting");

    Ok(())
}
