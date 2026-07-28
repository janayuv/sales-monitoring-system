use std::env;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::process::Command;

fn main() {
    tauri_build::build();

    let out_dir = env::var_os("OUT_DIR").unwrap();
    let dest_path = Path::new(&out_dir).join("build_constants.rs");
    let mut f = File::create(&dest_path).unwrap();

    let app_version = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.1.0".to_string());
    let target = env::var("TARGET").unwrap_or_else(|_| "unknown".to_string());
    let profile = env::var("PROFILE").unwrap_or_else(|_| "unknown".to_string());
    let build_number = env::var("GITHUB_RUN_NUMBER").unwrap_or_else(|_| "0".to_string());

    // Run powershell to get current date/time on Windows, or date on Unix
    let build_datetime = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args(&["-Command", "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    } else {
        Command::new("date")
            .args(&["+%Y-%m-%d %H:%M:%S"])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    };

    let parts: Vec<&str> = build_datetime.split(' ').collect();
    let build_date = parts.get(0).copied().unwrap_or("unknown");
    let build_time = parts.get(1).copied().unwrap_or("unknown");

    // Git hash
    let git_hash = Command::new("git")
        .args(&["rev-parse", "HEAD"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Git branch
    let git_branch = Command::new("git")
        .args(&["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Rust version
    let rustc_version = Command::new("rustc")
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    writeln!(f, "pub const APP_VERSION: &str = {:?};", app_version).unwrap();
    writeln!(f, "pub const BUILD_DATE: &str = {:?};", build_date).unwrap();
    writeln!(f, "pub const BUILD_TIME: &str = {:?};", build_time).unwrap();
    writeln!(f, "pub const GIT_HASH: &str = {:?};", git_hash).unwrap();
    writeln!(f, "pub const GIT_BRANCH: &str = {:?};", git_branch).unwrap();
    writeln!(f, "pub const RUST_VERSION: &str = {:?};", rustc_version).unwrap();
    writeln!(f, "pub const TARGET: &str = {:?};", target).unwrap();
    writeln!(f, "pub const PROFILE: &str = {:?};", profile).unwrap();
    writeln!(f, "pub const BUILD_NUMBER: &str = {:?};", build_number).unwrap();
}

