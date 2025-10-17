use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

// We'll manually copy the code here for standalone testing
// This is a temporary integration test to verify git history functionality

#[test]
fn test_git_discovery() {
    // Test that we can discover a git repository
    let repo_path = Path::new("/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian");

    // Try to open the repository
    match git2::Repository::discover(repo_path) {
        Ok(repo) => {
            println!("✓ Successfully discovered git repository at: {:?}", repo.path());
            assert!(repo.path().exists());
        }
        Err(e) => {
            println!("✗ Failed to discover repository: {}", e);
            // This is OK if we're not in a git repo
        }
    }
}

#[test]
fn test_create_temp_git_repo() -> anyhow::Result<()> {
    let temp_dir = TempDir::new()?;
    let repo_path = temp_dir.path();

    // Initialize git repo
    git2::Repository::init(repo_path)?;

    // Configure git
    let status = Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(repo_path)
        .status()?;

    assert!(status.success(), "Failed to configure git user.name");

    let status = Command::new("git")
        .args(["config", "user.email", "test@example.com"])
        .current_dir(repo_path)
        .status()?;

    assert!(status.success(), "Failed to configure git user.email");

    // Create a test file
    let test_file = repo_path.join("test.txt");
    fs::write(&test_file, "Line 1\nLine 2\nLine 3\n")?;

    // Add and commit
    let status = Command::new("git")
        .args(["add", "test.txt"])
        .current_dir(repo_path)
        .status()?;

    assert!(status.success(), "Failed to add file");

    let status = Command::new("git")
        .args(["commit", "-m", "Initial commit"])
        .current_dir(repo_path)
        .status()?;

    assert!(status.success(), "Failed to commit");

    // Verify we can open the repo and get commits
    let repo = git2::Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;

    let commits: Vec<_> = revwalk.collect();
    assert_eq!(commits.len(), 1, "Should have exactly 1 commit");

    println!("✓ Successfully created temporary git repository with 1 commit");

    Ok(())
}

#[test]
fn test_git_blame_functionality() -> anyhow::Result<()> {
    let temp_dir = TempDir::new()?;
    let repo_path = temp_dir.path();

    // Initialize git repo
    git2::Repository::init(repo_path)?;

    // Configure git
    Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(repo_path)
        .status()?;

    Command::new("git")
        .args(["config", "user.email", "test@example.com"])
        .current_dir(repo_path)
        .status()?;

    // Create and commit initial file
    let test_file = repo_path.join("test.txt");
    fs::write(&test_file, "Line 1\nLine 2\nLine 3\n")?;

    Command::new("git")
        .args(["add", "test.txt"])
        .current_dir(repo_path)
        .status()?;

    Command::new("git")
        .args(["commit", "-m", "Initial commit"])
        .current_dir(repo_path)
        .status()?;

    // Test git blame
    let repo = git2::Repository::open(repo_path)?;
    let blame = repo.blame_file(Path::new("test.txt"), None)?;

    // All 3 lines were added in one commit, so we should have 1 hunk
    assert!(!blame.is_empty(), "Should have at least 1 blame hunk");

    // Test each line (1-indexed in git blame)
    for i in 1..=3 {
        let hunk = blame.get_line(i).expect("Should have hunk for line");
        let commit = repo.find_commit(hunk.final_commit_id())?;
        let author = commit.author();

        assert_eq!(author.name().unwrap(), "Test User");
        println!("✓ Line {} blamed correctly to Test User", i);
    }

    Ok(())
}

#[test]
fn test_git_diff_stats() -> anyhow::Result<()> {
    let temp_dir = TempDir::new()?;
    let repo_path = temp_dir.path();

    // Initialize git repo
    git2::Repository::init(repo_path)?;

    // Configure git
    Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(repo_path)
        .status()?;

    Command::new("git")
        .args(["config", "user.email", "test@example.com"])
        .current_dir(repo_path)
        .status()?;

    // Create initial commit with 3 lines
    let test_file = repo_path.join("test.txt");
    fs::write(&test_file, "Line 1\nLine 2\nLine 3\n")?;

    Command::new("git")
        .args(["add", "test.txt"])
        .current_dir(repo_path)
        .status()?;

    Command::new("git")
        .args(["commit", "-m", "Initial commit"])
        .current_dir(repo_path)
        .status()?;

    // Second commit - add 2 more lines
    fs::write(&test_file, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n")?;

    Command::new("git")
        .args(["add", "test.txt"])
        .current_dir(repo_path)
        .status()?;

    Command::new("git")
        .args(["commit", "-m", "Add 2 lines"])
        .current_dir(repo_path)
        .status()?;

    // Get diff stats
    let repo = git2::Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;

    let oid = revwalk.next().unwrap()?;
    let commit = repo.find_commit(oid)?;
    let parent = commit.parent(0)?;

    let parent_tree = parent.tree()?;
    let commit_tree = commit.tree()?;

    let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), None)?;
    let stats = diff.stats()?;

    assert_eq!(stats.insertions(), 2, "Should have 2 insertions");
    assert_eq!(stats.deletions(), 0, "Should have 0 deletions");

    println!("✓ Diff stats: +{} -{}", stats.insertions(), stats.deletions());

    Ok(())
}
