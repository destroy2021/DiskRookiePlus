//! `disk_scan_cleanable`：全盘（或指定盘）可清理内容地图（核心工具）。
//!
//! 实现：对每个 location 做受控 walk + 流式累计 size/count；单类别限时 10 秒
//! （超时置 `status: "partial"`）。`sample_paths` 最多 10 条（红线 4：流式、无界缓存禁止）。
//!
//! 扫描驱动盘的过滤：location 展开后按前缀归属各盘（`drives` 参数过滤时使用）。

use serde_json::{json, Value};
#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use std::time::Instant;

#[cfg(windows)]
use super::categories::{category_rules, expand_env, Matcher};
use super::ToolResult;
#[cfg(windows)]
use crate::path_util::opt_str_array;

/// 单类别扫描时限（10 秒，超时置 status=partial）
#[cfg(windows)]
const CATEGORY_TIMEOUT_SECS: u64 = 10;
/// sample_paths 上限
#[cfg(windows)]
const MAX_SAMPLES: usize = 10;

/// 非 Windows：规则表是 Windows 语义（%TEMP%、$Recycle.Bin 等），回退空类别而非报错（红线 7）。
#[cfg(not(windows))]
pub fn run(_args: &Value) -> ToolResult {
    Ok(json!({"categories": [], "scan_duration_ms": 0}))
}

#[cfg(windows)]
pub fn run(args: &Value) -> ToolResult {
    let requested_drives = opt_str_array(args, "drives");
    let requested_categories = opt_str_array(args, "categories");

    let start = Instant::now();
    let mut categories_out = Vec::new();

    for rule in category_rules() {
        if let Some(filter) = &requested_categories {
            if !filter.iter().any(|c| c == rule.id) {
                continue;
            }
        }

        let mut total_bytes = 0u64;
        let mut file_count = 0u64;
        let mut locations: Vec<String> = Vec::new();
        let mut samples: Vec<String> = Vec::new();
        let mut status = "ok";
        let cat_deadline = Instant::now() + std::time::Duration::from_secs(CATEGORY_TIMEOUT_SECS);

        match &rule.matcher {
            Matcher::WholeDir => {
                for (tpl, expanded) in rule.expanded_locations() {
                    if !drive_allowed(&expanded, requested_drives.as_deref()) {
                        continue;
                    }
                    let p = Path::new(&expanded);
                    if !p.is_dir() {
                        continue;
                    }
                    let st = walk(p, &mut samples, cat_deadline, |_, _| true);
                    total_bytes += st.total;
                    file_count += st.count;
                    locations.push(expanded.clone());
                    let _ = tpl;
                    merge_status(&mut status, &st);
                }
            }
            Matcher::FileNameGlob(glob) => {
                for (tpl, expanded) in rule.expanded_locations() {
                    if !drive_allowed(&expanded, requested_drives.as_deref()) {
                        continue;
                    }
                    let p = Path::new(&expanded);
                    if !p.is_dir() {
                        continue;
                    }
                    let st = walk(p, &mut samples, cat_deadline, |p, _| {
                        glob_match(glob, &file_name(p))
                    });
                    total_bytes += st.total;
                    file_count += st.count;
                    locations.push(expanded.clone());
                    let _ = tpl;
                    merge_status(&mut status, &st);
                }
            }
            Matcher::Conditional {
                min_age_days,
                min_size_bytes,
                location,
            } => {
                if let Some(expanded) = expand_env(location) {
                    if drive_allowed(&expanded, requested_drives.as_deref()) {
                        let p = Path::new(&expanded);
                        if p.is_dir() {
                            let cutoff = age_cutoff(*min_age_days);
                            let st = walk(p, &mut samples, cat_deadline, move |_, meta| {
                                mtime_secs(meta) <= cutoff && meta.len() >= *min_size_bytes
                            });
                            total_bytes += st.total;
                            file_count += st.count;
                            locations.push(expanded.clone());
                            merge_status(&mut status, &st);
                        }
                    }
                }
            }
        }

        categories_out.push(json!({
            "id": rule.id,
            "label": rule.label,
            "total_bytes": total_bytes,
            "file_count": file_count,
            "locations": locations,
            "risk_level": rule.risk_level,
            "sample_paths": samples,
            "status": status,
        }));
    }

    Ok(json!({
        "categories": categories_out,
        "scan_duration_ms": start.elapsed().as_millis() as u64
    }))
}

/// location 是否在允许扫描的盘上（requested_drives 为 None 时全部允许）
#[cfg(windows)]
fn drive_allowed(expanded: &str, requested: Option<&[String]>) -> bool {
    match requested {
        None => true,
        Some(drives) => {
            let letter = expanded
                .chars()
                .next()
                .map(|c| c.to_ascii_uppercase())
                .unwrap_or('?');
            drives.iter().any(|d| {
                d.trim_end_matches(['\\', '/'])
                    .chars()
                    .next()
                    .map(|c| c.to_ascii_uppercase())
                    == Some(letter)
            })
        }
    }
}

/// 单次遍历的统计结果。
#[cfg(windows)]
struct WalkStat {
    total: u64,
    count: u64,
    timed_out: bool,
    denied: bool,
}

/// 受控迭代 walk（三个类别 matcher 共用的唯一遍历器）。
/// - 流式累计，samples 最多 MAX_SAMPLES；`deadline` 到点置 timed_out 并终止；
/// - `accept(path, meta)` 决定文件是否计入（目录总是下钻）；
/// - 不可读目录记 `denied`（报告 access_denied，不报错），区别于“空目录”（安全模型第 7 条）。
#[cfg(windows)]
fn walk(
    dir: &Path,
    samples: &mut Vec<String>,
    deadline: Instant,
    accept: impl Fn(&Path, &std::fs::Metadata) -> bool,
) -> WalkStat {
    let mut st = WalkStat {
        total: 0,
        count: 0,
        timed_out: false,
        denied: false,
    };
    let mut stack = vec![dir.to_path_buf()];
    // ponytail: 单线程 depth-first；需要吞吐时换 scanner 的 par_iter，当前 10s 上限内够用
    while let Some(d) = stack.pop() {
        if Instant::now() > deadline {
            st.timed_out = true;
            break;
        }
        let entries = match std::fs::read_dir(&d) {
            Ok(e) => e,
            Err(err) => {
                if err.kind() == std::io::ErrorKind::PermissionDenied {
                    st.denied = true;
                }
                continue;
            }
        };
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            match entry.metadata() {
                Ok(meta) if meta.is_dir() => stack.push(p),
                Ok(meta) if accept(&p, &meta) => {
                    st.total = st.total.saturating_add(meta.len());
                    st.count += 1;
                    if samples.len() < MAX_SAMPLES {
                        samples.push(p.display().to_string());
                    }
                }
                _ => {}
            }
        }
    }
    st
}
/// 文件时名（lossy；glob 匹配用）
#[cfg(windows)]
fn file_name(p: &Path) -> std::borrow::Cow<'_, str> {
    p.file_name().unwrap_or_default().to_string_lossy()
}

/// mtime 换算成 unix 秒；不可读时返回 u64::MAX（永远不命中“足够旧”）
#[cfg(windows)]
fn mtime_secs(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX)
}

/// `min_age_days` 天前的 unix 秒；mtime ≤ 此值即视为旧文件
#[cfg(windows)]
fn age_cutoff(min_age_days: u64) -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|t| t.as_secs().saturating_sub(min_age_days * 86_400))
        .unwrap_or(0)
}

/// 类别级 status 合并：partial（超时）> access_denied（不可读）> ok
#[cfg(windows)]
fn merge_status(status: &mut &'static str, st: &WalkStat) {
    if st.timed_out {
        *status = "partial";
    } else if st.denied && *status == "ok" {
        *status = "access_denied";
    }
}

/// 极简 glob 匹配：`*` 任意串、`?` 单字符（迭代匹配，支持多 `*`）
#[cfg(windows)]
fn glob_match(pattern: &str, name: &str) -> bool {
    fn inner(p: &[u8], s: &[u8]) -> bool {
        match p.first() {
            None => s.is_empty(),
            Some(b'*') => {
                // 贪心回溯：尝试跳过任意长度
                let rest = &p[1..];
                (0..=s.len()).any(|skip| inner(rest, &s[skip..]))
            }
            Some(b'?') => !s.is_empty() && inner(&p[1..], &s[1..]),
            Some(&c) => !s.is_empty() && s[0] == c && inner(&p[1..], &s[1..]),
        }
    }
    inner(pattern.as_bytes(), name.as_bytes())
}

#[cfg(windows)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match() {
        assert!(glob_match("*.dmp", "app.dmp"));
        assert!(glob_match("*.dmp", ".dmp"));
        assert!(!glob_match("*.dmp", "app.txt"));
        assert!(glob_match("thumbcache_*.db", "thumbcache_32.db"));
        assert!(!glob_match("thumbcache_*.db", "iconcache.db"));
        assert!(glob_match("a?c", "abc"));
        assert!(!glob_match("a?c", "ac"));
    }

    #[test]
    fn test_drive_allowed() {
        assert!(drive_allowed("C:\\Users", None));
        assert!(drive_allowed("C:\\Users", Some(&["C:\\".to_string()])));
        assert!(!drive_allowed("D:\\x", Some(&["C:\\".to_string()])));
        assert!(drive_allowed("D:\\x", Some(&["d".to_string()])));
    }
}
