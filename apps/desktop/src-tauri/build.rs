fn main() {
    #[cfg(target_os = "windows")]
    {
        let profile = std::env::var("PROFILE").unwrap_or_default();
        let level = if profile == "release" {
            "requireAdministrator"
        } else {
            "asInvoker"
        };
        let mut windows = tauri_build::WindowsAttributes::new();
        windows = windows.app_manifest(format!(
            r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="{level}" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0"
        processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
</assembly>
"#
        ));
        let attrs = tauri_build::Attributes::new().windows_attributes(windows);
        tauri_build::try_build(attrs).expect("failed to run build script");
    }

    #[cfg(not(target_os = "windows"))]
    {
        tauri_build::build();
    }
}
