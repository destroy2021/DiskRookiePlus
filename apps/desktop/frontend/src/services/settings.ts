import { readJSON, writeJSON } from './storage'
import { invoke } from '@tauri-apps/api/core'

export interface AppSettings {
  promptFileCount: number
  useMftScan?: boolean
  /** Snapshot save directory relative to runtime data root (~/.disk-rookie) */
  snapshotSaveDir?: string
  /** Auto save snapshot after AI analysis */
  autoSaveAfterAi?: boolean
}

export interface OAuthTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope?: string
}

export interface GoogleUserInfo {
  id: string
  email: string
  name: string
  picture?: string
}

export interface BaiduUserInfo {
  openid: string
  unionid?: string
  username?: string
  portrait?: string
  userdetail?: string
  birthday?: string
  sex?: string
}

export interface AliyunUserInfo {
  user_id?: string
  user_name?: string
  nick_name?: string
  avatar?: string
  phone?: string
  email?: string
}

export interface DropboxUserInfo {
  account_id: string
  name: {
    given_name: string
    surname: string
    display_name: string
  }
  email: string
  profile_photo_url?: string
}

export type CloudStorageProvider = 
  | 'google_drive'
  | 'onedrive'
  | 'dropbox'
  | 'aliyun_drive'
  | 'baidu_netdisk'
  | 'webdav'

export interface CloudStorageConfig {
  provider: CloudStorageProvider
  name: string
  enabled: boolean
  
  clientId?: string
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  tokenExpiry?: number
  
  webdavUrl?: string
  webdavUsername?: string
  webdavPassword?: string
  
  targetFolder?: string
}

export interface CloudStorageSettings {
  configs: CloudStorageConfig[]
  defaultProvider?: CloudStorageProvider
}

export interface CloudStorageProviderInfo {
  id: CloudStorageProvider
  name: string
  icon: string
  description: string
  authType: 'oauth' | 'webdav' | 'api_key'
  available: boolean
  oauthUrl?: string
  docUrl?: string
}

export const CLOUD_STORAGE_PROVIDERS: CloudStorageProviderInfo[] = [
  {
    id: 'google_drive',
    name: 'Google Drive',
    icon: 'google-drive',
    description: '使用 Google 账号 OAuth 2.0 授权',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    docUrl: 'https://developers.google.com/drive/api/guides/about-sdk',
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    icon: 'onedrive',
    description: '使用 Microsoft 账号 OAuth 2.0 授权',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    docUrl: 'https://learn.microsoft.com/en-us/onedrive/developer/',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    icon: 'dropbox',
    description: '使用 Dropbox 账号 OAuth 2.0 授权',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://www.dropbox.com/oauth2/authorize',
    docUrl: 'https://www.dropbox.com/developers/documentation',
  },
  {
    id: 'aliyun_drive',
    name: '阿里云盘',
    icon: 'aliyun',
    description: '使用阿里云盘开放平台 OAuth 授权',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://openapi.alipan.com/oauth/authorize',
    docUrl: 'https://www.yuque.com/aliyundrive/zpfszx',
  },
  {
    id: 'baidu_netdisk',
    name: '百度网盘',
    icon: 'baidu',
    description: '使用百度网盘开放平台 OAuth 授权',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://openapi.baidu.com/oauth/2.0/authorize',
    docUrl: 'https://pan.baidu.com/union/doc/',
  },
  {
    id: 'webdav',
    name: 'WebDAV',
    icon: 'webdav',
    description: '通过 WebDAV 连接坚果云、群晖等 NAS 服务',
    authType: 'webdav',
    available: true,
    docUrl: 'https://help.jianguoyun.com/?p=2064',
  },
]

const SETTINGS_FILE = 'app-settings.json'
const CLOUD_STORAGE_SETTINGS_FILE = 'cloud-storage-settings.json'
export const DEFAULT_SNAPSHOT_SAVE_DIR = 'snapshots'

export function normalizeSnapshotSaveDir(dir?: string): string {
  const normalized = (dir ?? '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
  return normalized || DEFAULT_SNAPSHOT_SAVE_DIR
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  promptFileCount: 100,
  useMftScan: true,
  snapshotSaveDir: DEFAULT_SNAPSHOT_SAVE_DIR,
  autoSaveAfterAi: false,
}

export const DEFAULT_CLOUD_STORAGE_SETTINGS: CloudStorageSettings = {
  configs: [],
  defaultProvider: undefined,
}

export async function loadAppSettings(): Promise<AppSettings> {
  const loaded = await readJSON<Partial<AppSettings>>(SETTINGS_FILE, {})
  const merged = { ...DEFAULT_APP_SETTINGS, ...loaded }
  return {
    ...merged,
    snapshotSaveDir: normalizeSnapshotSaveDir(merged.snapshotSaveDir),
    autoSaveAfterAi: merged.autoSaveAfterAi === true,
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  await writeJSON(SETTINGS_FILE, {
    ...settings,
    snapshotSaveDir: normalizeSnapshotSaveDir(settings.snapshotSaveDir),
    autoSaveAfterAi: settings.autoSaveAfterAi === true,
  })
}

export async function loadCloudStorageSettings(): Promise<CloudStorageSettings> {
  return await readJSON<CloudStorageSettings>(CLOUD_STORAGE_SETTINGS_FILE, DEFAULT_CLOUD_STORAGE_SETTINGS)
}

export async function saveCloudStorageSettings(settings: CloudStorageSettings): Promise<void> {
  await writeJSON(CLOUD_STORAGE_SETTINGS_FILE, settings)
}

export async function hasCloudStorageConfig(): Promise<boolean> {
  const settings = await loadCloudStorageSettings()
  return settings.configs.some(c => c.enabled)
}

export async function getDefaultCloudStorageConfig(): Promise<CloudStorageConfig | null> {
  const settings = await loadCloudStorageSettings()
  if (settings.defaultProvider) {
    return settings.configs.find(c => c.provider === settings.defaultProvider && c.enabled) || null
  }
  return settings.configs.find(c => c.enabled) || null
}

export async function getEnabledCloudStorageConfigs(): Promise<CloudStorageConfig[]> {
  const settings = await loadCloudStorageSettings()
  return settings.configs.filter(c => c.enabled)
}


export async function startGoogleOAuth(): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('complete_google_oauth')
}

export async function refreshGoogleToken(refreshToken: string): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('refresh_google_token', { refreshToken })
}

export async function revokeGoogleToken(token: string): Promise<void> {
  return await invoke('revoke_google_token', { token })
}

export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  return await invoke<GoogleUserInfo>('get_google_user_info', { accessToken })
}

export interface GoogleDriveQuota {
  storageQuota: {
    limit: string
    usage: string
    usageInDrive: string
    usageInDriveTrash: string
  }
  user?: {
    displayName: string
    emailAddress: string
    photoLink?: string
  }
}

export async function getGoogleDriveQuota(accessToken: string): Promise<GoogleDriveQuota> {
  return await invoke<GoogleDriveQuota>('get_google_drive_quota', { accessToken })
}


export async function startBaiduOAuth(): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('complete_baidu_oauth')
}

export async function refreshBaiduToken(refreshToken: string): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('refresh_baidu_token', { refreshToken })
}

export async function revokeBaiduToken(token: string): Promise<void> {
  return await invoke('revoke_baidu_token', { token })
}

export async function getBaiduUserInfo(accessToken: string): Promise<BaiduUserInfo> {
  const userInfo = await invoke<BaiduUserInfo>('get_baidu_user_info', { accessToken })
  return userInfo
}

export interface BaiduNetdiskQuota {
  total?: number
  used?: number
  free?: number
}

export async function getBaiduNetdiskQuota(accessToken: string): Promise<BaiduNetdiskQuota> {
  return await invoke<BaiduNetdiskQuota>('get_baidu_netdisk_quota', { accessToken })
}


export async function startAliyunOAuth(): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('complete_aliyun_oauth')
}

export async function refreshAliyunToken(refreshToken: string): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('refresh_aliyun_token', { refreshToken })
}

export async function revokeAliyunToken(token: string): Promise<void> {
  return await invoke('revoke_aliyun_token', { token })
}

export async function getAliyunUserInfo(accessToken: string): Promise<AliyunUserInfo> {
  const userInfo = await invoke<AliyunUserInfo>('get_aliyun_user_info', { accessToken })
  return userInfo
}

export interface AliyunDriveQuota {
  total_size?: number
  used_size?: number
  available_size?: number
}

export async function getAliyunDriveQuota(accessToken: string): Promise<AliyunDriveQuota> {
  return await invoke<AliyunDriveQuota>('get_aliyun_drive_quota', { accessToken })
}


export async function startDropboxOAuth(): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('complete_dropbox_oauth')
}

export async function refreshDropboxToken(refreshToken: string): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('refresh_dropbox_token', { refreshToken })
}

export async function revokeDropboxToken(token: string): Promise<void> {
  return await invoke('revoke_dropbox_token', { token })
}

export async function getDropboxUserInfo(accessToken: string): Promise<DropboxUserInfo> {
  const userInfo = await invoke<DropboxUserInfo>('get_dropbox_user_info', { accessToken })
  return userInfo
}

export interface DropboxQuota {
  used: number
  allocation: {
    '.tag': string
    allocated?: number
  }
}

export async function getDropboxQuota(accessToken: string): Promise<DropboxQuota> {
  return await invoke<DropboxQuota>('get_dropbox_quota', { accessToken })
}

export async function ensureValidToken(config: CloudStorageConfig): Promise<CloudStorageConfig> {
  if (!config.accessToken || !config.tokenExpiry) {
    throw new Error('缺少有效的 access token')
  }

  const now = Date.now()
  const expiryBuffer = 5 * 60 * 1000 // 5 minutes
  
  if (config.tokenExpiry - now < expiryBuffer) {
    if (!config.refreshToken) {
      throw new Error('Token 已过期且缺少 refresh token')
    }
    
    let tokens: OAuthTokens
    if (config.provider === 'baidu_netdisk') {
      tokens = await refreshBaiduToken(config.refreshToken)
    } else if (config.provider === 'aliyun_drive') {
      tokens = await refreshAliyunToken(config.refreshToken)
    } else if (config.provider === 'dropbox') {
      tokens = await refreshDropboxToken(config.refreshToken)
    } else {
      tokens = await refreshGoogleToken(config.refreshToken)
    }
    
    return {
      ...config,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || config.refreshToken,
      tokenExpiry: now + tokens.expires_in * 1000,
    }
  }

  return config
}

