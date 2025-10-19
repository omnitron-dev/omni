//! CLI Integration Tests
//!
//! Comprehensive tests for CLI commands covering:
//! - Server management (start, stop, restart, status)
//! - Project management (add, list, info, relocate)
//! - Error handling and edge cases

use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::TempDir;

fn create_test_npm_project() -> TempDir {
    let temp_dir = TempDir::new().unwrap();
    fs::write(
        temp_dir.path().join("package.json"),
        r#"{"name": "test-cli-project", "version": "1.0.0"}"#,
    )
    .unwrap();
    temp_dir
}

fn create_test_cargo_project() -> TempDir {
    let temp_dir = TempDir::new().unwrap();
    fs::write(
        temp_dir.path().join("Cargo.toml"),
        r#"[package]
name = "test-cli-crate"
version = "2.0.0"
"#,
    )
    .unwrap();
    temp_dir
}

fn get_meridian_bin() -> Command {
    Command::cargo_bin("meridian").unwrap()
}

#[test]
fn test_cli_help() {
    let mut cmd = get_meridian_bin();
    cmd.arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("Cognitive memory system"));
}

#[test]
fn test_cli_version() {
    let mut cmd = get_meridian_bin();
    cmd.arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn test_server_help() {
    let mut cmd = get_meridian_bin();
    cmd.arg("server")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("Global server management"));
}

#[test]
fn test_server_status_not_running() {
    // Set custom MERIDIAN_HOME to avoid interfering with actual server
    let temp_home = TempDir::new().unwrap();

    let mut cmd = get_meridian_bin();
    cmd.env("MERIDIAN_HOME", temp_home.path())
        .arg("server")
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::contains("Not running"));
}

#[test]
fn test_projects_add_npm() {
    let temp_home = TempDir::new().unwrap();
    let project_dir = create_test_npm_project();

    let mut cmd = get_meridian_bin();
    cmd.env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("add")
        .arg(project_dir.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("Project registered"))
        .stdout(predicate::str::contains("test-cli-project"));
}

#[test]
fn test_projects_add_cargo() {
    let temp_home = TempDir::new().unwrap();
    let project_dir = create_test_cargo_project();

    let mut cmd = get_meridian_bin();
    cmd.env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("add")
        .arg(project_dir.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("Project registered"))
        .stdout(predicate::str::contains("test-cli-crate"));
}

#[test]
fn test_projects_add_invalid_path() {
    let temp_home = TempDir::new().unwrap();

    let mut cmd = get_meridian_bin();
    cmd.env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("add")
        .arg("/nonexistent/path/to/project")
        .assert()
        .failure();
}

#[test]
fn test_projects_list_empty() {
    let temp_home = TempDir::new().unwrap();

    let mut cmd = get_meridian_bin();
    cmd.env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("list")
        .assert()
        .success()
        .stdout(predicate::str::contains("No projects registered"));
}

#[test]
fn test_projects_add_and_list() {
    let temp_home = TempDir::new().unwrap();
    let project_dir = create_test_npm_project();

    // Add project
    let mut add_cmd = get_meridian_bin();
    add_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("add")
        .arg(project_dir.path())
        .assert()
        .success();

    // List projects
    let mut list_cmd = get_meridian_bin();
    list_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("list")
        .assert()
        .success()
        .stdout(predicate::str::contains("test-cli-project"))
        .stdout(predicate::str::contains("Registered projects (1)"));
}

#[test]
fn test_projects_info() {
    let temp_home = TempDir::new().unwrap();
    let project_dir = create_test_npm_project();

    // Add project
    let mut add_cmd = get_meridian_bin();
    add_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("add")
        .arg(project_dir.path())
        .assert()
        .success();

    // Get project info
    let mut info_cmd = get_meridian_bin();
    info_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("info")
        .arg("test-cli-project@1.0.0")
        .assert()
        .success()
        .stdout(predicate::str::contains("test-cli-project"))
        .stdout(predicate::str::contains("Version: 1.0.0"))
        .stdout(predicate::str::contains("Path History"));
}

#[test]
fn test_projects_info_not_found() {
    let temp_home = TempDir::new().unwrap();

    let mut cmd = get_meridian_bin();
    cmd.env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("info")
        .arg("nonexistent-project@1.0.0")
        .assert()
        .success()
        .stdout(predicate::str::contains("Project not found"));
}

#[test]
fn test_projects_relocate() {
    let temp_home = TempDir::new().unwrap();
    let project_dir1 = create_test_npm_project();
    let project_dir2 = TempDir::new().unwrap();

    // Add project at first location
    let mut add_cmd = get_meridian_bin();
    add_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("add")
        .arg(project_dir1.path())
        .assert()
        .success();

    // Relocate project
    let mut relocate_cmd = get_meridian_bin();
    relocate_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("relocate")
        .arg("test-cli-project@1.0.0")
        .arg(project_dir2.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("Project relocated"));

    // Verify relocation in info
    let mut info_cmd = get_meridian_bin();
    info_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("info")
        .arg("test-cli-project@1.0.0")
        .assert()
        .success()
        .stdout(predicate::str::contains(project_dir2.path().to_str().unwrap()));
}

#[test]
fn test_projects_relocate_not_found() {
    let temp_home = TempDir::new().unwrap();
    let project_dir = TempDir::new().unwrap();

    let mut cmd = get_meridian_bin();
    cmd.env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("relocate")
        .arg("nonexistent@1.0.0")
        .arg(project_dir.path())
        .assert()
        .failure();
}

#[test]
fn test_projects_remove() {
    let temp_home = TempDir::new().unwrap();
    let project_dir = create_test_npm_project();

    // Add project
    let mut add_cmd = get_meridian_bin();
    add_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("add")
        .arg(project_dir.path())
        .assert()
        .success();

    // Remove project
    let mut remove_cmd = get_meridian_bin();
    remove_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("remove")
        .arg("test-cli-project@1.0.0")
        .assert()
        .success()
        .stdout(predicate::str::contains("marked as deleted"));

    // Verify it's marked as deleted (still in registry but deleted status)
    let mut info_cmd = get_meridian_bin();
    info_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("info")
        .arg("test-cli-project@1.0.0")
        .assert()
        .success()
        .stdout(predicate::str::contains("Deleted"));
}

#[test]
fn test_projects_help() {
    let mut cmd = get_meridian_bin();
    cmd.arg("projects")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("Project management"))
        .stdout(predicate::str::contains("add"))
        .stdout(predicate::str::contains("list"))
        .stdout(predicate::str::contains("info"));
}

#[test]
fn test_multiple_projects_workflow() {
    let temp_home = TempDir::new().unwrap();

    // Create multiple projects
    let npm_project = create_test_npm_project();
    let cargo_project = create_test_cargo_project();

    // Add both projects
    let mut add_npm = get_meridian_bin();
    add_npm
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("add")
        .arg(npm_project.path())
        .assert()
        .success();

    let mut add_cargo = get_meridian_bin();
    add_cargo
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("add")
        .arg(cargo_project.path())
        .assert()
        .success();

    // List should show both
    let mut list_cmd = get_meridian_bin();
    list_cmd
        .env("MERIDIAN_HOME", temp_home.path())
        .arg("projects")
        .arg("list")
        .assert()
        .success()
        .stdout(predicate::str::contains("test-cli-project"))
        .stdout(predicate::str::contains("test-cli-crate"))
        .stdout(predicate::str::contains("Registered projects (2)"));
}

#[test]
fn test_init_config() {
    let temp_home = TempDir::new().unwrap();

    let mut cmd = get_meridian_bin();
    cmd.env("MERIDIAN_HOME", temp_home.path())
        .arg("init-config")
        .assert()
        .success()
        .stdout(predicate::str::contains("Global configuration initialized"));
}
