#[cfg(windows)]
pub use ntfs_reader_real::*;

#[cfg(not(windows))]
pub mod errors {
    use std::error::Error;
    use std::fmt::{Display, Formatter};

    #[derive(Debug)]
    pub enum NtfsReaderError {
        ElevationError,
        IOError(std::io::Error),
        Message(String),
    }

    impl Display for NtfsReaderError {
        fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
            match self {
                Self::ElevationError => f.write_str("elevation required"),
                Self::IOError(err) => err.fmt(f),
                Self::Message(msg) => f.write_str(msg),
            }
        }
    }

    impl Error for NtfsReaderError {}

    impl From<std::io::Error> for NtfsReaderError {
        fn from(value: std::io::Error) -> Self {
            Self::IOError(value)
        }
    }
}

#[cfg(not(windows))]
pub mod volume {
    use crate::errors::NtfsReaderError;

    #[derive(Clone, Debug)]
    pub struct Volume;

    impl Volume {
        pub fn new(_path: &str) -> Result<Self, NtfsReaderError> {
            Ok(Self)
        }
    }
}

#[cfg(not(windows))]
pub mod file_info {
    use std::collections::HashMap;
    use std::marker::PhantomData;
    use std::path::PathBuf;

    use crate::mft::{Mft, Record};

    pub type HashMapCache = HashMap<u64, PathBuf>;

    #[derive(Clone, Debug)]
    pub struct StubTime;

    impl StubTime {
        pub fn unix_timestamp(&self) -> i64 {
            0
        }
    }

    #[derive(Clone, Debug)]
    pub struct FileInfo {
        pub is_directory: bool,
        pub path: PathBuf,
        pub modified: Option<StubTime>,
        pub size: u64,
    }

    impl FileInfo {
        pub fn with_cache(_mft: &Mft, _file: Record, _cache: &mut HashMapCache) -> Self {
            Self {
                is_directory: false,
                path: PathBuf::new(),
                modified: None,
                size: 0,
            }
        }
    }

    #[allow(dead_code)]
    pub struct _Marker(PhantomData<()>);
}

#[cfg(not(windows))]
pub mod mft {
    use crate::errors::NtfsReaderError;
    use crate::volume::Volume;

    #[derive(Copy, Clone, Debug)]
    pub struct Record;

    #[derive(Clone, Debug)]
    pub struct Mft;

    impl Mft {
        pub fn new(_volume: Volume) -> Result<Self, NtfsReaderError> {
            Ok(Self)
        }

        pub fn iterate_files<F>(&self, mut callback: F)
        where
            F: FnMut(Record),
        {
            let _ = &self;
            let _ = &mut callback;
        }
    }
}
