use anyhow::{Context, Result, bail};
use daemonize::Daemonize;
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tracing::{info, warn, error};

use crate::config::get_meridian_home;

/// Options for starting the daemon
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DaemonOptions {
    pub transport: String,
    pub http_port: Option<u16>,
    pub log_level: Option<String>,
    pub project: Option<PathBuf>,
}

impl Default for DaemonOptions {
    fn default() -> Self {
        Self {
            transport: "stdio".to_string(),
            http_port: None,
            log_level: None,
            project: None,
        }
    }
}

/// Get the PID file path
pub fn get_pid_file() -> PathBuf {
    get_meridian_home().join("meridian.pid")
}

/// Get the log file path
pub fn get_log_file() -> PathBuf {
    get_meridian_home().join("logs").join("meridian.log")
}

/// Get the daemon options file path
pub fn get_daemon_opts_file() -> PathBuf {
    get_meridian_home().join("daemon.opts")
}

/// Save PID to file
pub fn save_pid(pid: u32) -> Result<()> {
    let pid_file = get_pid_file();
    fs::create_dir_all(pid_file.parent().unwrap())?;
    fs::write(&pid_file, pid.to_string())?;
    Ok(())
}

/// Read PID from file
pub fn read_pid() -> Option<u32> {
    let pid_file = get_pid_file();
    fs::read_to_string(&pid_file)
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Save daemon options to file
pub fn save_daemon_opts(opts: &DaemonOptions) -> Result<()> {
    let opts_file = get_daemon_opts_file();
    fs::create_dir_all(opts_file.parent().unwrap())?;
    let json = serde_json::to_string(opts)?;
    fs::write(&opts_file, json)?;
    Ok(())
}

/// Read daemon options from file
pub fn read_daemon_opts() -> Option<DaemonOptions> {
    let opts_file = get_daemon_opts_file();
    let json = fs::read_to_string(&opts_file).ok()?;
    serde_json::from_str(&json).ok()
}

/// Check if a process is running
pub fn is_process_running(pid: u32) -> bool {
    // Send signal 0 to check if process exists
    // If it succeeds, process exists; if it fails, it doesn't
    matches!(signal::kill(Pid::from_raw(pid as i32), None), Ok(_))
}

/// Start the daemon
pub fn start_daemon(opts: DaemonOptions) -> Result<()> {
    // Check if already running
    if let Some(pid) = read_pid() {
        if is_process_running(pid) {
            println!("✗ Meridian MCP server is already running (PID: {})", pid);
            println!("Run 'meridian server stop' to stop it first, or 'meridian server restart' to restart.");
            return Ok(());
        } else {
            // Stale PID file, remove it
            warn!("Removing stale PID file");
            let _ = fs::remove_file(get_pid_file());
        }
    }

    // Create log directory
    let log_dir = get_meridian_home().join("logs");
    fs::create_dir_all(&log_dir)?;

    // Get the current executable path
    let exe_path = std::env::current_exe()?;

    // Prepare command arguments
    // NOTE: The 'serve' command only accepts: --stdio, --socket <path>, --http
    // log_level and project options are saved for future use but not passed to serve
    let mut args = vec!["serve".to_string()];

    if opts.transport == "stdio" {
        args.push("--stdio".to_string());
    } else if opts.transport == "http" {
        args.push("--http".to_string());
    }

    // Save the options for restart/status commands
    save_daemon_opts(&opts)?;

    // Create log file
    let log_file = get_log_file();
    let stdout_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .context("Failed to create log file")?;

    let stderr_file = stdout_file.try_clone()?;

    info!("Starting Meridian MCP server daemon...");
    info!("Executable: {:?}", exe_path);
    info!("Arguments: {:?}", args);
    info!("Log file: {:?}", log_file);

    // Daemonize the process
    let daemonize = Daemonize::new()
        .pid_file(get_pid_file())
        .working_directory(std::env::current_dir()?)
        .stdout(stdout_file)
        .stderr(stderr_file);

    // Fork the process
    match daemonize.start() {
        Ok(_) => {
            // This runs in the daemon process
            info!("Daemon process started");

            // Execute the serve command
            let status = Command::new(&exe_path)
                .args(&args)
                .status()?;

            if !status.success() {
                error!("Server exited with non-zero status: {:?}", status);
            }

            std::process::exit(status.code().unwrap_or(1));
        }
        Err(e) => {
            bail!("Failed to daemonize: {}", e);
        }
    }
}

/// Start the daemon in foreground mode (for testing/debugging)
pub fn start_foreground(opts: DaemonOptions) -> Result<()> {
    // Check if already running
    if let Some(pid) = read_pid() {
        if is_process_running(pid) {
            println!("✗ Meridian MCP server is already running (PID: {})", pid);
            println!("Run 'meridian server stop' to stop it first.");
            return Ok(());
        }
    }

    info!("Starting Meridian MCP server in foreground mode...");

    // Save PID (our own process)
    save_pid(std::process::id())?;
    save_daemon_opts(&opts)?;

    // The serve command will be called directly by main.rs
    // This function just validates and saves the state
    Ok(())
}

/// Stop the daemon
pub fn stop_daemon(force: bool) -> Result<()> {
    let pid = read_pid().context("No PID file found - is the server running?")?;

    if !is_process_running(pid) {
        println!("✗ Server is not running (stale PID file)");
        let _ = fs::remove_file(get_pid_file());
        let _ = fs::remove_file(get_daemon_opts_file());
        return Ok(());
    }

    println!("Stopping Meridian MCP server (PID: {})...", pid);

    // Send SIGTERM for graceful shutdown
    if !force {
        match signal::kill(Pid::from_raw(pid as i32), Signal::SIGTERM) {
            Ok(_) => {
                info!("Sent SIGTERM to process {}", pid);

                // Wait up to 5 seconds for graceful shutdown
                for i in 0..50 {
                    if !is_process_running(pid) {
                        println!("✓ Meridian MCP server stopped gracefully");
                        let _ = fs::remove_file(get_pid_file());
                        let _ = fs::remove_file(get_daemon_opts_file());
                        return Ok(());
                    }
                    if i % 10 == 0 {
                        print!(".");
                        std::io::stdout().flush().ok();
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                println!();

                warn!("Process did not stop gracefully, sending SIGKILL");
            }
            Err(e) => {
                warn!("Failed to send SIGTERM: {}, trying SIGKILL", e);
            }
        }
    }

    // Force kill with SIGKILL
    match signal::kill(Pid::from_raw(pid as i32), Signal::SIGKILL) {
        Ok(_) => {
            info!("Sent SIGKILL to process {}", pid);
            thread::sleep(Duration::from_millis(500));

            if !is_process_running(pid) {
                println!("✓ Meridian MCP server stopped forcefully");
            } else {
                println!("⚠ Failed to kill process {}", pid);
            }

            let _ = fs::remove_file(get_pid_file());
            let _ = fs::remove_file(get_daemon_opts_file());
        }
        Err(e) => {
            bail!("Failed to kill process {}: {}", pid, e);
        }
    }

    Ok(())
}

/// Restart the daemon
pub fn restart_daemon(opts: Option<DaemonOptions>) -> Result<()> {
    println!("Restarting Meridian MCP server...");

    // Get current options if not provided
    let daemon_opts = opts.or_else(read_daemon_opts).unwrap_or_default();

    // Stop the daemon if it's running
    if read_pid().is_some() {
        stop_daemon(false)?;
        thread::sleep(Duration::from_millis(500));
    }

    // Start with the same or new options
    start_daemon(daemon_opts)
}

/// Get daemon status
pub fn get_daemon_status() -> DaemonStatus {
    if let Some(pid) = read_pid() {
        if is_process_running(pid) {
            let opts = read_daemon_opts();
            DaemonStatus::Running { pid, opts }
        } else {
            DaemonStatus::Stopped { stale_pid: Some(pid) }
        }
    } else {
        DaemonStatus::Stopped { stale_pid: None }
    }
}

/// Daemon status
#[derive(Debug)]
pub enum DaemonStatus {
    Running {
        pid: u32,
        opts: Option<DaemonOptions>,
    },
    Stopped {
        stale_pid: Option<u32>,
    },
}

/// Show daemon logs
pub fn show_logs(follow: bool, lines: usize, level_filter: Option<String>) -> Result<()> {
    let log_file = get_log_file();

    if !log_file.exists() {
        println!("✗ No log file found at {:?}", log_file);
        println!("The server may not have been started yet.");
        return Ok(());
    }

    if follow {
        // Follow mode - tail the log file
        println!("Following logs from {:?} (Ctrl+C to stop)...", log_file);
        println!("{}", "=".repeat(80));

        // Use tail command for following
        let mut child = Command::new("tail")
            .arg("-f")
            .arg("-n")
            .arg(lines.to_string())
            .arg(&log_file)
            .stdout(Stdio::piped())
            .spawn()?;

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if should_show_line(&line, &level_filter) {
                        println!("{}", line);
                    }
                }
            }
        }

        child.wait()?;
    } else {
        // Static mode - show last N lines
        let file = File::open(&log_file)?;
        let reader = BufReader::new(file);
        let all_lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

        let start_idx = if all_lines.len() > lines {
            all_lines.len() - lines
        } else {
            0
        };

        println!("Last {} lines from {:?}:", lines, log_file);
        println!("{}", "=".repeat(80));

        for line in &all_lines[start_idx..] {
            if should_show_line(line, &level_filter) {
                println!("{}", line);
            }
        }
    }

    Ok(())
}

/// Check if a log line should be shown based on level filter
fn should_show_line(line: &str, level_filter: &Option<String>) -> bool {
    if let Some(ref level) = level_filter {
        let level_upper = level.to_uppercase();
        line.contains(&level_upper) || line.contains(&level.to_lowercase())
    } else {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_daemon_opts_default() {
        let opts = DaemonOptions::default();
        assert_eq!(opts.transport, "stdio");
        assert!(opts.http_port.is_none());
        assert!(opts.log_level.is_none());
        assert!(opts.project.is_none());
    }

    #[test]
    fn test_daemon_opts_serialization() {
        let opts = DaemonOptions {
            transport: "http".to_string(),
            http_port: Some(3000),
            log_level: Some("debug".to_string()),
            project: Some(PathBuf::from("/tmp/test")),
        };

        let json = serde_json::to_string(&opts).unwrap();
        let decoded: DaemonOptions = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded.transport, "http");
        assert_eq!(decoded.http_port, Some(3000));
        assert_eq!(decoded.log_level, Some("debug".to_string()));
    }

    #[test]
    fn test_should_show_line() {
        assert!(should_show_line("INFO: test", &None));
        assert!(should_show_line("ERROR: test", &Some("ERROR".to_string())));
        assert!(should_show_line("ERROR: test", &Some("error".to_string())));
        assert!(!should_show_line("INFO: test", &Some("ERROR".to_string())));
    }

    #[test]
    fn test_pid_file_paths() {
        let pid_file = get_pid_file();
        assert!(pid_file.to_string_lossy().contains(".meridian"));
        assert!(pid_file.to_string_lossy().contains("meridian.pid"));

        let log_file = get_log_file();
        assert!(log_file.to_string_lossy().contains(".meridian"));
        assert!(log_file.to_string_lossy().contains("logs"));
        assert!(log_file.to_string_lossy().contains("meridian.log"));
    }
}
