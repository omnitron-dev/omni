//! Daemon process management for global server
//!
//! Handles starting, stopping, and managing the global server as a background daemon.

use super::server::{GlobalServer, GlobalServerConfig};
use anyhow::{Context, Result, bail};
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid;
use std::fs;
use std::path::PathBuf;
use tracing::{info, warn, error};

use crate::config::get_meridian_home;

/// Get the PID file path for global server
pub fn get_global_pid_file() -> PathBuf {
    get_meridian_home().join("global").join("server.pid")
}

/// Get the log file path for global server
pub fn get_global_log_file() -> PathBuf {
    get_meridian_home().join("logs").join("global-server.log")
}

/// Save PID to file
pub fn save_global_pid(pid: u32) -> Result<()> {
    let pid_file = get_global_pid_file();
    fs::create_dir_all(pid_file.parent().unwrap())?;
    fs::write(&pid_file, pid.to_string())?;
    Ok(())
}

/// Read PID from file
pub fn read_global_pid() -> Option<u32> {
    let pid_file = get_global_pid_file();
    fs::read_to_string(&pid_file)
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Check if a process is running
pub fn is_process_running(pid: u32) -> bool {
    matches!(signal::kill(Pid::from_raw(pid as i32), None), Ok(_))
}

/// Start the global server as a daemon
pub async fn start_global_daemon(config: GlobalServerConfig, foreground: bool) -> Result<()> {
    // Check if already running
    if let Some(pid) = read_global_pid() {
        if is_process_running(pid) {
            println!("✗ Global server is already running (PID: {})", pid);
            println!("Run 'meridian server stop' to stop it first.");
            return Ok(());
        } else {
            // Stale PID file, remove it
            warn!("Removing stale PID file");
            let _ = fs::remove_file(get_global_pid_file());
        }
    }

    if foreground {
        // Run in foreground
        info!("Starting global server in foreground mode");
        println!("✓ Starting global server in foreground mode");
        println!("Press Ctrl+C to stop");

        let server = GlobalServer::new(config).await?;
        server.start().await?;

        // Wait for server to stop
        server.wait().await?;
    } else {
        // Run as daemon
        info!("Starting global server as daemon");

        #[cfg(unix)]
        {
            use daemonize::Daemonize;
            use std::fs::File;

            let log_file = get_global_log_file();
            fs::create_dir_all(log_file.parent().unwrap())?;

            let stdout = File::create(&log_file)
                .with_context(|| format!("Failed to create log file: {:?}", log_file))?;
            let stderr = stdout.try_clone()?;

            let daemonize = Daemonize::new()
                .pid_file(get_global_pid_file())
                .working_directory(get_meridian_home())
                .stdout(stdout)
                .stderr(stderr);

            match daemonize.start() {
                Ok(_) => {
                    // We're now in the daemon process
                    info!("Global server daemon started");

                    // Save our PID
                    save_global_pid(std::process::id())?;

                    // Run the server
                    let server = GlobalServer::new(config).await?;
                    server.start().await?;

                    // Wait forever
                    server.wait().await?;
                }
                Err(e) => {
                    error!("Failed to daemonize: {}", e);
                    bail!("Failed to start daemon: {}", e);
                }
            }
        }

        #[cfg(not(unix))]
        {
            // Windows: spawn a detached process
            warn!("Daemon mode not fully supported on Windows, starting as background process");

            let exe = std::env::current_exe()?;

            Command::new(exe)
                .args(&["server", "start", "--foreground"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;

            println!("✓ Global server started as background process");
        }
    }

    Ok(())
}

/// Stop the global server daemon
pub fn stop_global_daemon(force: bool) -> Result<()> {
    let pid = read_global_pid().ok_or_else(|| {
        anyhow::anyhow!("Global server is not running (no PID file found)")
    })?;

    if !is_process_running(pid) {
        warn!("Process {} is not running, removing stale PID file", pid);
        let _ = fs::remove_file(get_global_pid_file());
        println!("✗ Global server was not running");
        return Ok(());
    }

    println!("Stopping global server (PID: {})...", pid);

    let signal = if force { Signal::SIGKILL } else { Signal::SIGTERM };

    signal::kill(Pid::from_raw(pid as i32), signal)
        .with_context(|| format!("Failed to send signal to process {}", pid))?;

    // Wait for process to stop (with timeout)
    let max_wait = if force { 10 } else { 30 };
    for i in 0..max_wait {
        if !is_process_running(pid) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        if i > 0 && i % 10 == 0 {
            println!("  Waiting for server to stop... ({}/{})", i / 10, max_wait / 10);
        }
    }

    if is_process_running(pid) {
        if force {
            error!("Failed to kill process {} even with SIGKILL", pid);
            bail!("Failed to stop global server");
        } else {
            warn!("Process {} did not stop gracefully, use --force to kill", pid);
            println!("⚠ Server did not stop gracefully");
            println!("Run 'meridian server stop --force' to force kill");
            return Ok(());
        }
    }

    // Remove PID file
    let _ = fs::remove_file(get_global_pid_file());

    println!("✓ Global server stopped");
    Ok(())
}

/// Restart the global server daemon
pub async fn restart_global_daemon(config: Option<GlobalServerConfig>) -> Result<()> {
    println!("Restarting global server...");

    // Stop if running
    if let Some(pid) = read_global_pid() {
        if is_process_running(pid) {
            stop_global_daemon(false)?;

            // Wait a bit for cleanup
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }

    // Start with provided config or default
    let config = config.unwrap_or_default();
    start_global_daemon(config, false).await?;

    Ok(())
}

/// Get global server status
pub fn get_global_status() -> GlobalDaemonStatus {
    let pid = read_global_pid();

    let running = if let Some(pid) = pid {
        is_process_running(pid)
    } else {
        false
    };

    GlobalDaemonStatus {
        running,
        pid,
    }
}

/// Global server daemon status
#[derive(Debug, Clone)]
pub struct GlobalDaemonStatus {
    pub running: bool,
    pub pid: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_pid_file_operations() {
        let temp_dir = TempDir::new().unwrap();

        // Override PID file path for testing
        std::env::set_var("MERIDIAN_HOME", temp_dir.path());

        // Test save and read
        save_global_pid(12345).unwrap();
        assert_eq!(read_global_pid(), Some(12345));

        // Clean up
        let _ = fs::remove_file(get_global_pid_file());
    }

    #[test]
    fn test_is_process_running() {
        // Test with current process (should be running)
        let current_pid = std::process::id();
        assert!(is_process_running(current_pid));

        // Test with non-existent PID (very unlikely to exist)
        assert!(!is_process_running(999999));
    }
}
