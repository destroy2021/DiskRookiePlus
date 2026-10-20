//! `disk_search_name`：高性能名称搜索（fuzzy / glob / regex 三模式）。
//!
//! 实现路径（设计文档 3.1）：
//! 1. `root` 为 Windows 卷根 → MFT 全量记录流式匹配（`scan_volume_mft_records`）；
//! 2. 非卷根或 MFT 不可用（无管理员）→ 回退目录 walk；
//! 3. `engine` 字段如实告知；`total_matched` 为 null（提前终止后无法精确计数全卷命中数）。
//!
//! 红线 4：两个引擎共用 [`HitSink`] 做 offset/limit 流式裁剪，收满即停，无界缓存禁止。

use std::path::Path;

use regex::Regex;
use serde_json::{json, Value};

use super::{checked_path, ToolResult};
use crate::path_util::{opt_bool, opt_str, opt_u64};

const DEFAULT_LIMIT: u64 = 100;
const MAX_LIMIT: u64 = 1000;

/// 匹配模式：预编译为统一谓词
enum NameMatcher<'a> {
    /// 子串（大小写不敏感可配）
    Fuzzy {
        needle: &'a str,
        case_sensitive: bool,
    },
    /// glob：`*`/`?`/`**` 转正则（不引入 globset）
    Glob(Regex),
    /// 原生正则
    Regex(Regex),
}

impl NameMatcher<'_> {
    fn matches(&self, name: &str) -> bool {
        match self {
            NameMatcher::Fuzzy {
                needle,
                case_sensitive,
            } => {
                if *case_sensitive {
                    name.contains(needle)
                } else {
                    name.to_lowercase().contains(&needle.to_lowercase())
                }
            }
            NameMatcher::Glob(re) | NameMatcher::Regex(re) => re.is_match(name),
        }
    }
}

/// glob → regex 转换：`**` → 任意（含分隔符）、`*` → 段内任意、`?` → 单字符，
/// 其余字符全部转义并锚定全名。
fn glob_to_regex(glob: &str, case_sensitive: bool) -> Result<Regex, String> {
    let mut pattern = String::with_capacity(glob.len() * 2);
    let chars: Vec<char> = glob.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' => {
                if i + 1 < chars.len() && chars[i + 1] == '*' {
                    pattern.push_str(".*");
                    i += 2;
                    continue;
                }
                pattern.push_str(r"[^\\/]*");
            }
            '?' => pattern.push('.'),
            c => {
                if "\\.+()|[]{}^$#&~-".contains(c) {
                    pattern.push('\\');
                }
                pattern.push(c);
            }
        }
        i += 1;
    }
    let pattern = format!("^{pattern}$");
    if case_sensitive {
        Regex::new(&pattern).map_err(|e| format!("glob 模式编译失败: {e}"))
    } else {
        Regex::new(&format!("(?i){pattern}")).map_err(|e| format!("glob 模式编译失败: {e}"))
    }
}

/// 文件类型过滤：None=全部 / Some(true)=仅目录 / Some(false)=仅文件
type DirFilter = Option<bool>;

struct SearchHit {
    path: String,
    name: String,
    size: u64,
    is_dir: bool,
    modified: Option<u64>,
}

/// 流式分页收集器：前 `offset` 条命中只计数不保存，之后最多保存 `limit` 条。
/// 两个引擎共用，避免"引擎内跳过 + 结果再 skip 一次"的双重跳过错误。
struct HitSink {
    offset: u64,
    limit: u64,
    skipped: u64,
    hits: Vec<SearchHit>,
}

impl HitSink {
    fn new(offset: u64, limit: u64) -> Self {
        Self {
            offset,
            limit,
            skipped: 0,
            hits: Vec::new(),
        }
    }

    /// 记录一条命中；收集满 `limit` 后返回 false 表示可提前终止遍历
    fn push(&mut self, hit: SearchHit) -> bool {
        if self.skipped < self.offset {
            self.skipped += 1;
            return true;
        }
        if (self.hits.len() as u64) < self.limit {
            self.hits.push(hit);
        }
        !self.full()
    }

    fn full(&self) -> bool {
        self.hits.len() as u64 >= self.limit
    }

    /// 收满 `limit` 视为可能还有更多；未收满说明已到流末尾
    fn truncated(&self) -> bool {
        self.full()
    }

    fn next_offset(&self) -> Option<u64> {
        self.truncated()
            .then(|| self.offset + self.hits.len() as u64)
    }
}

pub fn run(args: &Value) -> ToolResult {
    let raw_root = args
        .get("root")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少必填参数 root".to_string())?;
    let root = checked_path(raw_root)?;
    let pattern = args
        .get("pattern")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少必填参数 pattern".to_string())?;
    let mode = opt_str(args, "mode").unwrap_or_else(|| "fuzzy".to_string());
    let case_sensitive = opt_bool(args, "case_sensitive", false);
    let dir_filter: DirFilter = args.get("is_dir").and_then(|v| v.as_bool());
    let offset = opt_u64(args, "offset")?.unwrap_or(0);
    let limit = opt_u64(args, "limit")?
        .unwrap_or(DEFAULT_LIMIT)
        .clamp(1, MAX_LIMIT);

    let matcher = match mode.as_str() {
        "fuzzy" => NameMatcher::Fuzzy {
            needle: pattern,
            case_sensitive,
        },
        "glob" => NameMatcher::Glob(glob_to_regex(pattern, case_sensitive)?),
        "regex" => {
            let re = if case_sensitive {
                Regex::new(pattern)
            } else {
                Regex::new(&format!("(?i){pattern}"))
            }
            .map_err(|e| format!("regex 模式编译失败: {e}"))?;
            NameMatcher::Regex(re)
        }
        other => return Err(format!("无效 mode: {other}（可选 fuzzy/glob/regex）")),
    };

    if !root.exists() {
        return Err(format!("路径不存在: {}", root.display()));
    }

    // 尝试 MFT（仅 Windows 卷根）；失败静默回退 walk，由 engine 字段如实告知
    #[cfg(windows)]
    if ai_disk_scanner::scan_will_use_mft(&root.display().to_string(), true) {
        if let Ok(v) = search_mft(&root, &matcher, dir_filter, offset, limit) {
            return Ok(v);
        }
    }

    search_walk(&root, &matcher, dir_filter, offset, limit)
}

/// MFT 引擎：全卷记录流式匹配。
#[cfg(windows)]
fn search_mft(
    root: &Path,
    matcher: &NameMatcher,
    dir_filter: DirFilter,
    offset: u64,
    limit: u64,
) -> ToolResult {
    let mut sink = HitSink::new(offset, limit);
    ai_disk_scanner::scan_volume_mft_records(&root.display().to_string(), |entry| {
        if dir_filter.is_some_and(|want| entry.is_dir != want)
            || !matcher.matches(name_of(&entry.path))
        {
            return true;
        }
        sink.push(SearchHit {
            name: name_of(&entry.path).to_string(),
            path: entry.path.clone(),
            size: entry.size,
            is_dir: entry.is_dir,
            modified: entry.modified,
        })
    })
    .map_err(|e| super::map_err(&e))?;

    Ok(result_json(sink, "mft"))
}

/// walk 引擎：目录栈遍历。目录无论是否命中都继续下钻（否则命中目录会丢失其子项）。
fn search_walk(
    root: &Path,
    matcher: &NameMatcher,
    dir_filter: DirFilter,
    offset: u64,
    limit: u64,
) -> ToolResult {
    let mut sink = HitSink::new(offset, limit);
    let mut stack = vec![root.to_path_buf()];
    'walk: while let Some(dir) = stack.pop() {
        if sink.full() {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(|e| e.ok()) {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let is_dir = meta.is_dir();
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if dir_filter.is_none_or(|want| want == is_dir) && matcher.matches(&name) {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());
                let keep_going = sink.push(SearchHit {
                    path: path.display().to_string(),
                    name,
                    size: meta.len(),
                    is_dir,
                    modified,
                });
                if !keep_going {
                    break 'walk;
                }
            }
            if is_dir {
                stack.push(path);
            }
        }
    }
    Ok(result_json(sink, "walk"))
}

#[cfg(windows)]
fn name_of(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

fn result_json(sink: HitSink, engine: &str) -> Value {
    let truncated = sink.truncated();
    let next_offset = sink.next_offset();
    let matches: Vec<Value> = sink
        .hits
        .into_iter()
        .map(|h| {
            json!({
                "path": h.path,
                "name": h.name,
                "size": h.size,
                "is_dir": h.is_dir,
                "modified": h.modified,
            })
        })
        .collect();
    json!({
        "matches": matches,
        "total_matched": Value::Null,
        "truncated": truncated,
        "next_offset": next_offset,
        "engine": engine,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_to_regex() {
        let re = glob_to_regex("*.log", false).unwrap();
        assert!(re.is_match("app.log"));
        assert!(re.is_match("APP.LOG"));
        assert!(!re.is_match("app.log.bak"));
        assert!(!re.is_match("dir/app.log"));

        let re2 = glob_to_regex("a?c.txt", true).unwrap();
        assert!(re2.is_match("abc.txt"));
        assert!(!re2.is_match("ABC.TXT"));
        assert!(!re2.is_match("ac.txt"));

        let re3 = glob_to_regex("data/**/*.csv", false).unwrap();
        assert!(re3.is_match("data/a/b/c.csv"));

        let re4 = glob_to_regex("file(1).txt", false).unwrap();
        assert!(re4.is_match("file(1).txt"));
    }

    #[test]
    fn test_hit_sink_paginates_without_double_skip() {
        let mut sink = HitSink::new(2, 2);
        for i in 0..5 {
            sink.push(SearchHit {
                path: format!("f{i}"),
                name: String::new(),
                size: 0,
                is_dir: false,
                modified: None,
            });
        }
        // 前 2 条被 offset 跳过，返回第 3、4 条
        let paths: Vec<&str> = sink.hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths, vec!["f2", "f3"]);
        assert!(sink.truncated());
        assert_eq!(sink.next_offset(), Some(4));
    }

    #[test]
    fn test_regex_mode_walk() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("report_2024.txt"), b"x").unwrap();
        std::fs::write(dir.path().join("report_2025.txt"), b"x").unwrap();
        std::fs::write(dir.path().join("notes.md"), b"x").unwrap();

        let res = run(&json!({
            "root": dir.path().to_string_lossy(),
            "pattern": "report_\\d{4}\\.txt",
            "mode": "regex",
        }))
        .unwrap();
        assert_eq!(res["matches"].as_array().unwrap().len(), 2);
        assert_eq!(res["engine"], "walk");
    }

    #[test]
    fn test_fuzzy_mode_and_is_dir_filter() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("mylog.txt"), b"x").unwrap();
        std::fs::create_dir_all(dir.path().join("logs_backup")).unwrap();

        let res = run(&json!({
            "root": dir.path().to_string_lossy(),
            "pattern": "log",
            "mode": "fuzzy",
            "is_dir": true,
        }))
        .unwrap();
        let matches = res["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["name"], "logs_backup");
    }

    /// 命中的目录必须继续下钻，否则其子项永远搜不到
    #[test]
    fn test_walk_descends_into_matched_directory() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("target").join("deep")).unwrap();
        std::fs::write(
            dir.path()
                .join("target")
                .join("deep")
                .join("target_inside.txt"),
            b"x",
        )
        .unwrap();

        let res = run(&json!({
            "root": dir.path().to_string_lossy(),
            "pattern": "target",
            "mode": "fuzzy",
        }))
        .unwrap();
        let names: Vec<&str> = res["matches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"target"));
        assert!(names.contains(&"target_inside.txt"));
    }

    #[test]
    fn test_offset_pagination_walk() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            std::fs::write(dir.path().join(format!("hit{i}.txt")), b"x").unwrap();
        }
        let res = run(&json!({
            "root": dir.path().to_string_lossy(),
            "pattern": "hit",
            "limit": 2,
            "offset": 3,
        }))
        .unwrap();
        // 收满 limit 即保守报告 truncated=true：walk 收满提前终止（红线 4），
        // 引擎无法得知流末尾还有没有命中；客户端按 next_offset 续页，空页自然终止。
        assert_eq!(res["matches"].as_array().unwrap().len(), 2);
        assert_eq!(res["truncated"], true);
        assert_eq!(res["next_offset"], 5);
    }
}
