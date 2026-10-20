//! 内置清理类别规则表（设计文档 3.1 节 8 类，独立模块）。
//!
//! 路径模板经环境变量展开（`%TEMP%` 等）；`<DRIVE>` 占位符替换为各盘符；
//! 非 Windows 平台回退空类别而非报错（红线 7）。
//! 类别路径固定且数量有限，无需 MFT；`old_downloads` 是唯一"按条件过滤"类别
//! （`min_age_days` 天未修改且大于 `min_size_bytes`）。
//!
//! 刻意不内置 node_modules / target / dist 等构建产物：误删在研项目代价极高，
//! 这类内容由 AI 用 disk_du + disk_search_name 主动发现，按高风险流程逐项确认。

/// 单条类别的静态规则
pub(crate) struct CategoryRule {
    pub id: &'static str,
    pub label: &'static str,
    pub risk_level: &'static str,
    /// 聚合 location 的路径模板（可含 `%ENV%` 与 `<DRIVE>` 占位；old_downloads 特例为空）
    pub locations: &'static [&'static str],
    /// 聚合方式
    pub matcher: Matcher,
}

pub(crate) enum Matcher {
    /// 整目录聚合（temp_user / browser_cache 等）
    WholeDir,
    /// 目录树内按文件名 glob 聚合（crash_dumps：`*.dmp`）
    FileNameGlob(&'static str),
    /// old_downloads 特例：下载目录中 `min_age_days` 天未修改且大于 `min_size_bytes` 的文件
    Conditional {
        min_age_days: u64,
        min_size_bytes: u64,
        /// 下载目录定位模板
        location: &'static str,
    },
}

impl CategoryRule {
    /// 展开模板：`%ENV%` 环境变量 → `<DRIVE>` → 各盘符。返回 (模板, 展开后路径) 列表；
    /// 环境变量未设置的模板跳过。`<DRIVE>` 模板对每个存在的盘符生成一份。
    pub(crate) fn expanded_locations(&self) -> Vec<(String, String)> {
        let mut out = Vec::new();
        for tpl in self.locations {
            if tpl.contains("<DRIVE>") {
                for c in b'A'..=b'Z' {
                    let root = format!("{}:\\", c as char);
                    if std::path::Path::new(&root).is_dir() {
                        out.push(((*tpl).to_string(), tpl.replace("<DRIVE>", &root)));
                    }
                }
            } else if let Some(expanded) = expand_env(tpl) {
                out.push(((*tpl).to_string(), expanded));
            }
        }
        out
    }
}

/// 展开 `%ENV%`（大小写不敏感）；模板含未设置变量时返回 None。
/// `scan_cleanable` 的条件类别定位复用本函数（单一实现）。
pub(crate) fn expand_env(tpl: &str) -> Option<String> {
    let mut result = String::with_capacity(tpl.len());
    let mut rest = tpl;
    while let Some(start) = rest.find('%') {
        result.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            return None; // 未闭合 %，视为无效模板
        };
        let var = &after[..end];
        if var.is_empty() {
            return None;
        }
        let val = std::env::var(var).ok()?;
        result.push_str(&val);
        rest = &after[end + 1..];
    }
    result.push_str(rest);
    Some(result)
}

/// 8 类清理规则表（设计文档 3.1 节）
pub(crate) fn category_rules() -> Vec<CategoryRule> {
    vec![
        CategoryRule {
            id: "temp_user",
            label: "用户临时文件",
            risk_level: "low",
            locations: &["%TEMP%", "%LOCALAPPDATA%\\Temp"],
            matcher: Matcher::WholeDir,
        },
        CategoryRule {
            id: "recycle_bin",
            label: "回收站",
            risk_level: "low",
            locations: &["<DRIVE>\\$Recycle.Bin"],
            matcher: Matcher::WholeDir,
        },
        CategoryRule {
            id: "browser_cache",
            label: "浏览器缓存",
            risk_level: "low",
            locations: &[
                "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Cache",
                "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Code Cache",
                "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Cache",
                "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Code Cache",
                "%LOCALAPPDATA%\\Mozilla\\Firefox\\Profiles\\*.default-release\\cache2",
            ],
            matcher: Matcher::WholeDir,
        },
        CategoryRule {
            id: "package_cache",
            label: "包管理器缓存",
            risk_level: "low",
            locations: &[
                "%LOCALAPPDATA%\\npm-cache",
                "%APPDATA%\\npm-cache",
                "%USERPROFILE%\\.cargo\\registry\\cache",
                "%USERPROFILE%\\.gradle\\caches",
                "%LOCALAPPDATA%\\pip\\cache",
                "%USERPROFILE%\\.nuget\\packages",
            ],
            matcher: Matcher::WholeDir,
        },
        CategoryRule {
            id: "thumbnails",
            label: "缩略图与图标缓存",
            risk_level: "low",
            locations: &[
                "%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer",
                "%LOCALAPPDATA%\\Microsoft\\Windows\\INetCache",
            ],
            matcher: Matcher::FileNameGlob("thumbcache_*.db"),
        },
        CategoryRule {
            id: "crash_dumps",
            label: "崩溃转储",
            risk_level: "low",
            locations: &["%LOCALAPPDATA%\\CrashDumps"],
            matcher: Matcher::FileNameGlob("*.dmp"),
        },
        CategoryRule {
            id: "windows_update",
            label: "Windows 更新残留下载",
            risk_level: "medium",
            locations: &["C:\\Windows\\SoftwareDistribution\\Download"],
            matcher: Matcher::WholeDir,
        },
        CategoryRule {
            id: "old_downloads",
            label: "旧下载文件（90 天未动且 >100MB）",
            risk_level: "medium",
            locations: &[],
            matcher: Matcher::Conditional {
                min_age_days: 90,
                min_size_bytes: 100 * 1024 * 1024,
                location: "%USERPROFILE%\\Downloads",
            },
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_category_table_is_8() {
        let rules = category_rules();
        assert_eq!(rules.len(), 8);
        let ids: Vec<&str> = rules.iter().map(|r| r.id).collect();
        for expected in [
            "temp_user",
            "recycle_bin",
            "browser_cache",
            "package_cache",
            "thumbnails",
            "crash_dumps",
            "windows_update",
            "old_downloads",
        ] {
            assert!(ids.contains(&expected), "missing category {expected}");
        }
        // windows_update 必须是 medium（安全模型第 2 条）
        assert_eq!(
            rules
                .iter()
                .find(|r| r.id == "windows_update")
                .unwrap()
                .risk_level,
            "medium"
        );
    }

    #[test]
    fn test_expand_env() {
        // 已设置的环境变量
        let expanded = expand_env("%PATH%");
        assert!(expanded.is_some());
        // 未设置变量 → None
        assert!(expand_env("%DISKROOKIE_NO_SUCH_VAR_XYZ%").is_none());
        // 无变量的模板原样
        assert_eq!(
            expand_env("C:\\plain\\path").as_deref(),
            Some("C:\\plain\\path")
        );
        // 未闭合 %
        assert!(expand_env("C:\\%BROKEN").is_none());
    }

    #[cfg(windows)]
    #[test]
    fn test_drive_placeholder_expansion() {
        let rule = category_rules()
            .into_iter()
            .find(|r| r.id == "recycle_bin")
            .unwrap();
        let expanded = rule.expanded_locations();
        assert!(!expanded.is_empty());
        assert!(expanded
            .iter()
            .any(|(_, p)| p.starts_with("C:\\") && p.contains("$Recycle.Bin")));
    }
}
