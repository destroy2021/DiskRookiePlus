//! 共享安全黑名单：所有破坏性写操作的统一路径防线（红线 1：破坏性动作唯一入口 executor）。
//!
//! `FORBIDDEN_PATHS` 与 `CLEAN_SAFE_EXCEPTIONS` 在此单一定义，
//! `apps/desktop/src-tauri` 与 `crates/mcp-server` 均引用本模块，消除双份定义。

use std::path::Path;

use ai_disk_common::DiskAnalyzerError;

/// 系统关键目录黑名单（前缀匹配，边界落在分隔符上）。
#[cfg(windows)]
pub const FORBIDDEN_PATHS: &[&str] = &[
    r"C:\Windows",
    r"C:\Program Files",
    r"C:\Program Files (x86)",
    r"C:\System Volume Information",
];

/// 非 Windows 平台的对应黑名单
#[cfg(not(windows))]
pub const FORBIDDEN_PATHS: &[&str] = &[
    "/System", "/Library", "/bin", "/sbin", "/usr", "/etc", "/var",
];

/// 清理安全例外：黑名单前缀下可安全清理的精确子路径（含其子项）。
/// 使 `windows_update` 类别可清理；该类别风险等级仍由调用方标为 medium。
#[cfg(windows)]
pub const CLEAN_SAFE_EXCEPTIONS: &[&str] = &[
    r"C:\Windows\Temp",
    r"C:\Windows\SoftwareDistribution\Download",
];

/// 非 Windows 平台无清理例外
#[cfg(not(windows))]
pub const CLEAN_SAFE_EXCEPTIONS: &[&str] = &[];

/// canonicalize 路径并校验是否允许写操作。
/// - 成功 → 返回 canonicalize 后的 PathBuf
/// - 命中黑名单且不在例外 → `DiskAnalyzerError::InvalidPath`
///
/// 例外判断先于黑名单：例外路径自身在黑名单前缀下，必须先放行。
pub fn canonicalize_for_write(raw: &str) -> Result<std::path::PathBuf, DiskAnalyzerError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(DiskAnalyzerError::InvalidPath("路径为空".to_string()));
    }
    if trimmed.len() > 32_767 {
        return Err(DiskAnalyzerError::InvalidPath(
            "路径长度超过 32767 上限".to_string(),
        ));
    }
    let canonical = std::fs::canonicalize(trimmed)
        .map_err(|e| DiskAnalyzerError::InvalidPath(format!("路径不存在或无法解析: {}", e)))?;

    check_write_allowed(&canonical)?;
    Ok(canonical)
}

/// 对**已 canonicalize** 的路径做黑名单判定，不触盘。
///
/// 预演（[`crate::dry_run`]）需要同时回答"路径存在吗"和"允许写吗"，
/// 因此黑名单判定与 canonicalize 拆开；写操作仍只走 [`canonicalize_for_write`]。
pub fn check_write_allowed(canonical: &Path) -> Result<(), DiskAnalyzerError> {
    match forbidden_prefix(canonical) {
        Some(_) => Err(DiskAnalyzerError::InvalidPath(format!(
            "禁止操作受保护的系统目录: {}",
            canonical.display()
        ))),
        None => Ok(()),
    }
}

/// 返回命中的黑名单条目（已扣除 [`CLEAN_SAFE_EXCEPTIONS`]），未命中为 None。
///
/// 单独暴露给需要沿用自己错误文案的调用方，
/// 使边界判定（含例外）仍然只有这一份实现。
pub fn forbidden_prefix(canonical: &Path) -> Option<&'static str> {
    let key = path_key(canonical);
    if CLEAN_SAFE_EXCEPTIONS
        .iter()
        .any(|exc| is_at_or_under(&key, &path_key(Path::new(exc))))
    {
        return None;
    }
    FORBIDDEN_PATHS
        .iter()
        .copied()
        .find(|f| is_at_or_under(&key, &path_key(Path::new(f))))
}

/// 统一成反斜杠分隔、小写不敏感的键：脱掉 `\\?\` 前缀、去尾部分隔符。
fn path_key(p: &Path) -> String {
    let mut s = p.to_string_lossy().replace('/', "\\");
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        s = stripped.to_string();
    }
    while s.len() > 1 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// `key` 等于 `base` 或位于其下（前缀边界必须是分隔符，防 `C:\Windows_old` 被误拦、
/// `/usrlocal` 被 `/usr` 误拦）。
fn is_at_or_under(key: &str, base: &str) -> bool {
    if key.eq_ignore_ascii_case(base) {
        return true;
    }
    if key.len() <= base.len() {
        return false;
    }
    if !key.is_char_boundary(base.len()) || key.as_bytes()[base.len()] != b'\\' {
        return false;
    }
    key[..base.len()].eq_ignore_ascii_case(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normal_path_allowed() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_string_lossy().to_string();
        assert!(canonicalize_for_write(&p).is_ok());
    }

    #[test]
    fn test_empty_and_long_rejected() {
        assert!(canonicalize_for_write("").is_err());
        assert!(canonicalize_for_write("   ").is_err());
        let long = "a".repeat(40_000);
        assert!(canonicalize_for_write(&long).is_err());
    }

    #[test]
    fn test_prefix_boundary() {
        // 大小写不敏感前缀，边界落在分隔符
        assert!(is_at_or_under(r"C:\Windows", r"C:\Windows"));
        assert!(is_at_or_under(r"C:\Windows\System32", r"C:\Windows"));
        assert!(is_at_or_under(r"c:\windows\system32", r"C:\Windows"));
        assert!(!is_at_or_under(r"C:\Windows_old", r"C:\Windows"));
        assert!(!is_at_or_under(r"C:\Windowsxx", r"C:\Windows"));
        assert!(!is_at_or_under("/usrlocal", "/usr"));
        // 输入约定：两侧均为 path_key 转换后的反斜杠键（见 test_path_key）
        assert!(is_at_or_under(r"\usr\bin", r"\usr"));
    }

    #[test]
    fn test_path_key_strips_verbatim_prefix() {
        assert_eq!(path_key(Path::new(r"\\?\C:\Windows\")), r"C:\Windows");
        assert_eq!(path_key(Path::new("/usr/bin/")), r"\usr\bin");
    }

    #[test]
    fn test_exception_covers_children() {
        if let Some(exc) = CLEAN_SAFE_EXCEPTIONS.first() {
            let child = format!("{}\\some\\nested\\file.tmp", exc);
            assert!(is_at_or_under(
                &path_key(Path::new(&child)),
                &path_key(Path::new(exc))
            ));
        }
    }

    #[cfg(windows)]
    #[test]
    fn test_forbidden_prefix_rejected() {
        if Path::new(r"C:\Windows").exists() {
            let err = canonicalize_for_write(r"C:\Windows\System32").unwrap_err();
            assert!(matches!(err, DiskAnalyzerError::InvalidPath(_)));
            // 大小写变体同样被拒
            assert!(canonicalize_for_write(r"c:\windows").is_err());
        }
        // 例外放行（若目录存在）
        if Path::new(r"C:\Windows\Temp").exists() {
            assert!(canonicalize_for_write(r"C:\Windows\Temp").is_ok());
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn test_forbidden_prefix_rejected() {
        if Path::new("/usr/bin").exists() {
            let err = canonicalize_for_write("/usr/bin").unwrap_err();
            assert!(matches!(err, DiskAnalyzerError::InvalidPath(_)));
        }
    }
}
