import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Eye, EyeOff, Check, AlertCircle, ChevronDown, ChevronUp, Brain, Cloud, Settings, Wifi, Shield, Trash2, BookmarkPlus } from 'lucide-react'
import { showNotification } from '../services/notification'
import {
  TextField,
  Select,
  MenuItem,
  Button,
  IconButton,
  InputAdornment,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Box,
  Typography,
  Slider,
  Switch,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  useTheme,
} from '@mui/material'
import {
  loadSettings,
  saveSettings,
  saveCustomApiPresets,
  DEFAULT_SETTINGS,
  MODEL_PRESETS,
  API_URL_PRESETS,
  getPresetId,
  fetchAvailableModels,
  testConnection,
  resolveEffectiveApiKey,
  type AISettings as AISettingsType,
  type ModelInfo,
  type CustomApiPresetItem,
} from '../services/ai'
import {
  KIMI_CODE_PRESET_ID,
  KIMI_CODE_API_BASE,
  loadKimiOAuthToken,
  clearKimiOAuthToken,
  runKimiDeviceLogin,
  isKimiCodingApiUrl,
} from '../services/kimi-oauth'
import { loadAppSettings, saveAppSettings, type AppSettings } from '../services/settings'
import { CloudStorageSettings } from './CloudStorageSettings'
import { setLanguage, supportedLanguages } from '../i18n'
import { readStorageFile, writeStorageFile } from '../services/storage'
import { loadSafeListPaths, saveSafeListPaths } from '../services/safeList'

interface Props {
  onClose: () => void
  initialTab?: number
  onSaved?: () => void
  themePreference?: 'light' | 'dark' | 'system'
  onThemeChange?: (theme: 'light' | 'dark' | 'system') => void
  currentLanguage?: string
  onLanguageChange?: (lang: string) => void
}

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
      style={{ height: '100%', minHeight: 0, overflow: 'auto' }}
    >
      {value === index && (
        <Box sx={{ p: 2.5 }}>
          {children}
        </Box>
      )}
    </div>
  )
}

const THEME_STORAGE_FILE = 'theme.txt'

export function AISettings({ onClose, initialTab = 0, onSaved, themePreference: externalThemePreference, onThemeChange, currentLanguage: externalCurrentLanguage, onLanguageChange }: Props) {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const [settings, setSettings] = useState<AISettingsType>(DEFAULT_SETTINGS)
  const [appSettings, setAppSettings] = useState<AppSettings>({
    promptFileCount: 100,
    useMftScan: true,
    snapshotSaveDir: 'snapshots',
    autoSaveAfterAi: false,
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [customUrl, setCustomUrl] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [modelSelectOpen, setModelSelectOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(initialTab)
  const [showSafeListDialog, setShowSafeListDialog] = useState(false)
  const [customApiPresets, setCustomApiPresets] = useState<CustomApiPresetItem[]>([])
  const [showSavePresetDialog, setShowSavePresetDialog] = useState(false)
  const [savePresetName, setSavePresetName] = useState('')
  const [safeListPaths, setSafeListPaths] = useState<string[]>([])
  const [newSafeListPath, setNewSafeListPath] = useState('')
  const [kimiLogging, setKimiLogging] = useState(false)
  const [kimiUserCode, setKimiUserCode] = useState('')
  const [kimiHasOAuth, setKimiHasOAuth] = useState(false)
  const [kimiAuthTick, setKimiAuthTick] = useState(0)

  const [internalThemePreference, setInternalThemePreference] = useState<'light' | 'dark' | 'system'>('system')
  const [internalLanguage, setInternalLanguage] = useState<string>(i18n.language)
  
  const themePreference = externalThemePreference ?? internalThemePreference
  const currentLanguage = externalCurrentLanguage ?? internalLanguage
  
  useEffect(() => {
    if (!externalThemePreference) {
      readStorageFile(THEME_STORAGE_FILE).then(stored => {
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
          setInternalThemePreference(stored)
        }
      })
    }
  }, [externalThemePreference])
  
  useEffect(() => {
    if (!externalCurrentLanguage) {
      try {
        const savedLang = localStorage.getItem('app-language')
        if (savedLang) {
          setInternalLanguage(savedLang)
        }
      } catch {
        // ignore
      }
    }
  }, [externalCurrentLanguage])

  useEffect(() => {
    loadSettings().then(loaded => {
      setSettings(loaded)
      setCustomApiPresets(loaded.customApiPresets ?? [])
      const urlPreset = API_URL_PRESETS.find(p => p.value === loaded.apiUrl)
      const customPreset = (loaded.customApiPresets ?? []).find(p => p.value === loaded.apiUrl)
      if (!urlPreset && !customPreset) {
        setCustomUrl(loaded.apiUrl)
      }
      const modelPreset = MODEL_PRESETS.find(p => p.value === loaded.model)
      if (!modelPreset) {
        setCustomModel(loaded.model)
      }
    })
    
    loadAppSettings().then(loaded => {
      setAppSettings(loaded)
    })
  }, [])

  useEffect(() => {
    const pid = getPresetId(settings.apiUrl, customApiPresets)
    const isKimiEndpoint = pid === KIMI_CODE_PRESET_ID || isKimiCodingApiUrl(settings.apiUrl)
    if (!isKimiEndpoint) {
      setKimiHasOAuth(false)
      return
    }
    void loadKimiOAuthToken().then(t => setKimiHasOAuth(!!t?.access_token))
  }, [settings.apiUrl, customApiPresets, kimiAuthTick])

  useEffect(() => {
    let cancelled = false
    const loadModels = async () => {
      const effective = await resolveEffectiveApiKey(settings)
      if (cancelled) return
      if (effective && settings.apiUrl) {
        setLoadingModels(true)
        try {
          const models = await fetchAvailableModels(settings.apiUrl, effective)
          if (!cancelled) setAvailableModels(models)
        } catch (error) {
          console.error('Failed to load models:', error)
          if (!cancelled) setAvailableModels([])
        } finally {
          if (!cancelled) setLoadingModels(false)
        }
      } else {
        setAvailableModels([])
      }
    }

    const timer = setTimeout(loadModels, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [settings.apiUrl, settings.providerApiKeys, kimiAuthTick])

  useEffect(() => {
    if (availableModels.length === 0 || settings.model === 'custom' || settings.model === '') return
    const inList = availableModels.some((m) => m.id === settings.model)
    if (!inList) {
      const sorted = [...availableModels].sort((a, b) => a.id.localeCompare(b.id))
      setSettings((s) => ({ ...s, model: sorted[0].id }))
    }
  }, [availableModels, settings.model])

  const handleSave = async () => {
    try {
      await saveSettings({
        ...settings,
        apiKey: (settings.providerApiKeys ?? {})[getPresetId(settings.apiUrl, customApiPresets)] ?? '',
      })
      await saveAppSettings(appSettings)
      setSaved(true)
      onSaved?.()
      setTimeout(() => {
        setSaved(false)
        onClose()
      }, 400)
    } catch (error) {
      showNotification(t('settings.saveFailed'), String(error))
    }
  }

  const persistAppSettings = async (next: AppSettings) => {
    await saveAppSettings(next)
    setAppSettings(await loadAppSettings())
  }

  const handleUrlChange = (value: string) => {
    if (value === 'custom') {
      setSettings(s => ({ ...s, apiUrl: customUrl || '' }))
    } else {
      setSettings(s => {
        const next: AISettingsType = { ...s, apiUrl: value }
        if (value === KIMI_CODE_API_BASE && (!s.model?.trim() || s.model === DEFAULT_SETTINGS.model)) {
          next.model = 'kimi-for-coding'
        }
        return next
      })
      setCustomUrl('')
    }
  }

  const handleModelChange = (value: string) => {
    if (value === 'custom') {
      setSettings(s => ({ ...s, model: customModel || '' }))
    } else {
      setSettings(s => ({ ...s, model: value }))
      setCustomModel('')
    }
  }

  const allApiPresets = [...API_URL_PRESETS.filter(p => p.value !== 'custom'), ...customApiPresets, { id: 'custom', label: t('common.custom'), value: 'custom' }]
  const isCustomUrl = !allApiPresets.some(p => p.value !== 'custom' && p.value === settings.apiUrl)
  const isCustomModel =
    availableModels.length > 0
      ? !availableModels.some((m) => m.id === settings.model)
      : !MODEL_PRESETS.some((p) => p.value === settings.model && p.value !== 'custom')

  const currentPresetId = getPresetId(settings.apiUrl, customApiPresets)
  const currentApiKey = (settings.providerApiKeys ?? {})[currentPresetId] ?? ''
  const isKimiCodeEndpoint =
    currentPresetId === KIMI_CODE_PRESET_ID || isKimiCodingApiUrl(settings.apiUrl)
  const hasCredential =
    isKimiCodeEndpoint
      ? currentApiKey.trim() !== '' || kimiHasOAuth
      : currentApiKey.trim() !== ''

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center rounded-[12px] z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-transparent dark:border-gray-600">
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-gray-600">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-primary rounded"></div>
            <h2 className="text-lg font-semibold text-secondary dark:text-gray-100">{t('settings.title')}</h2>
          </div>
          <IconButton
            onClick={onClose}
            size="small"
            sx={{
              color: 'text.secondary',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        <Box sx={{ borderBottom: 1, borderColor: 'divider' }} className="dark:!border-gray-600">
          <Tabs
            value={activeTab}
            onChange={(_, newValue) => setActiveTab(newValue)}
            variant="fullWidth"
            sx={{
              minHeight: 44,
              '& .MuiTab-root': {
                minHeight: 44,
                textTransform: 'none',
                fontSize: '13px',
                fontWeight: 600,
              },
              '& .Mui-selected': {
                color: 'primary.main',
              },
              '& .MuiTabs-indicator': {
                bgcolor: 'primary.main',
              },
            }}
          >
            <Tab
              icon={<Brain size={16} />}
              iconPosition="start"
              label={t('settings.aiModel')}
              id="settings-tab-0"
              aria-controls="settings-tabpanel-0"
            />
            <Tab
              icon={<Cloud size={16} />}
              iconPosition="start"
              label={t('settings.cloudService')}
              id="settings-tab-1"
              aria-controls="settings-tabpanel-1"
            />
            <Tab
              icon={<Settings size={16} />}
              iconPosition="start"
              label={t('settings.general')}
              id="settings-tab-2"
              aria-controls="settings-tabpanel-2"
            />
          </Tabs>
        </Box>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
          <TabPanel value={activeTab} index={0}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {/* API URL */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  {t('settings.apiUrl')}
                </Typography>
                <FormControl fullWidth size="small">
                  <Select
                    value={isCustomUrl ? 'custom' : settings.apiUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    sx={{ fontSize: '14px' }}
                    MenuProps={{
                      disablePortal: false,
                      sx: { zIndex: 9999 },
                      PaperProps: {
                        sx: {
                          zIndex: 9999,
                          maxHeight: 320,
                          mt: 1,
                        },
                      },
                    }}
                  >
                    {allApiPresets.map((preset) => (
                      <MenuItem key={preset.value} value={preset.value}>
                        {preset.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {isCustomUrl && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <TextField
                      fullWidth
                      size="small"
                      value={settings.apiUrl}
                      onChange={(e) => setSettings(s => ({ ...s, apiUrl: e.target.value }))}
                      placeholder={t('settings.inputCustomApiUrl')}
                      sx={{ fontSize: '14px' }}
                    />
                    {settings.apiUrl.trim() !== '' && (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<BookmarkPlus size={16} />}
                        onClick={() => {
                          setSavePresetName('')
                          setShowSavePresetDialog(true)
                        }}
                        sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
                      >
                        {t('settings.saveAsPreset')}
                      </Button>
                    )}
                  </Box>
                )}
              </Box>

              {/* API Key / Kimi OAuth */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  {isKimiCodeEndpoint ? t('settings.kimiCodeAuth') : t('settings.apiKey')}
                </Typography>

                {isKimiCodeEndpoint && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
                    <Typography variant="body2" sx={{ fontSize: '12px', color: 'text.secondary' }}>
                      {kimiHasOAuth ? t('settings.kimiCodeLoggedIn') : t('settings.kimiCodeOAuthHint')}
                    </Typography>
                    {kimiUserCode && (
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {t('settings.kimiCodeUserCode', { code: kimiUserCode })}
                      </Typography>
                    )}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      <Button
                        variant="contained"
                        size="small"
                        disabled={kimiLogging}
                        onClick={async () => {
                          setKimiUserCode('')
                          setKimiLogging(true)
                          try {
                            await runKimiDeviceLogin({
                              openBrowser: true,
                              onStatus: msg => {
                                if (msg.startsWith('user_code:')) {
                                  setKimiUserCode(msg.slice('user_code:'.length).trim())
                                }
                              },
                            })
                            const loaded = await loadSettings()
                            const pid = getPresetId(loaded.apiUrl, loaded.customApiPresets ?? [])
                            const isKimi =
                              pid === KIMI_CODE_PRESET_ID || isKimiCodingApiUrl(loaded.apiUrl)
                            if (isKimi && loaded.providerApiKeys?.[pid]?.trim()) {
                              const keys = { ...(loaded.providerApiKeys ?? {}) }
                              delete keys[pid]
                              await saveSettings({
                                ...loaded,
                                providerApiKeys: keys,
                                apiKey: keys[pid] ?? '',
                              })
                              const fresh = await loadSettings()
                              setSettings(fresh)
                              setCustomApiPresets(fresh.customApiPresets ?? [])
                            }
                            setKimiAuthTick(x => x + 1)
                            showNotification(t('settings.kimiCodeLoginOk'), '')
                            onSaved?.()
                          } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e)
                            showNotification(t('settings.kimiCodeLoginFail'), msg)
                          } finally {
                            setKimiLogging(false)
                            setKimiUserCode('')
                          }
                        }}
                        sx={{ textTransform: 'none' }}
                      >
                        {kimiLogging ? t('settings.kimiCodeLoggingIn') : t('settings.kimiCodeLogin')}
                      </Button>
                      {kimiHasOAuth && (
                        <Button
                          variant="outlined"
                          size="small"
                          disabled={kimiLogging}
                          onClick={async () => {
                            await clearKimiOAuthToken()
                            setKimiAuthTick(x => x + 1)
                            showNotification(t('settings.kimiCodeLogoutOk'), '')
                            onSaved?.()
                          }}
                          sx={{ textTransform: 'none' }}
                        >
                          {t('settings.kimiCodeLogout')}
                        </Button>
                      )}
                    </Box>
                    {!kimiHasOAuth && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px' }}>
                        {t('settings.kimiCodeManualHint')}
                      </Typography>
                    )}
                  </Box>
                )}

                {(!isKimiCodeEndpoint || !kimiHasOAuth) && (
                  <>
                    <TextField
                      fullWidth
                      size="small"
                      type={showApiKey ? 'text' : 'password'}
                      value={currentApiKey}
                      onChange={(e) => setSettings(s => ({
                        ...s,
                        providerApiKeys: { ...(s.providerApiKeys ?? {}), [getPresetId(s.apiUrl, customApiPresets)]: e.target.value },
                      }))}
                      placeholder={isKimiCodeEndpoint ? t('settings.kimiCodeKeyPlaceholder') : t('settings.inputApiKey')}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => setShowApiKey(!showApiKey)}
                              edge="end"
                              size="small"
                              sx={{ color: 'text.secondary' }}
                            >
                              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      sx={{ fontSize: '14px' }}
                    />
                    <FormHelperText sx={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: 0.5, m: 0 }}>
                      <AlertCircle className="w-3 h-3" />
                      {isKimiCodeEndpoint ? t('settings.kimiCodeKeyHint') : t('settings.apiKeyHint')}
                    </FormHelperText>
                  </>
                )}
                {hasCredential && settings.apiUrl && settings.model && (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={testingConnection ? <CircularProgress size={16} /> : <Wifi className="w-4 h-4" />}
                      onClick={async () => {
                        setTestResult(null)
                        setTestingConnection(true)
                        try {
                          const result = await testConnection(settings)
                          setTestResult(result)
                          if (!result.ok) {
                            showNotification(t('settings.testConnectionFailed'), result.message)
                          }
                        } finally {
                          setTestingConnection(false)
                        }
                      }}
                      disabled={testingConnection}
                    >
                      {testingConnection ? t('settings.testConnectionTesting') : t('settings.testConnection')}
                    </Button>
                    {testResult != null && (
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{
                          flex: '1 1 200px',
                          minWidth: 0,
                          color: testResult.ok ? 'success.main' : 'error.main',
                          fontSize: '12px',
                          alignSelf: 'center',
                        }}
                      >
                        {testResult.message}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>

              {hasCredential && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                    {t('settings.model')}
                  </Typography>
                  {loadingModels ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '12px' }}>
                        {t('settings.loadingModels')}
                      </Typography>
                    </Box>
                  ) : (
                    <FormControl fullWidth size="small">
                      <Select
                        value={isCustomModel ? 'custom' : settings.model}
                        open={modelSelectOpen}
                        onOpen={() => setModelSelectOpen(true)}
                        onClose={() => setModelSelectOpen(false)}
                        onChange={(e) => handleModelChange(e.target.value)}
                        sx={{ fontSize: '14px' }}
                        renderValue={(selected) => {
                          if (selected == null || selected === '') return ''
                          if (selected === 'custom') return t('common.custom')
                          return String(selected)
                        }}
                        MenuProps={{
                          disablePortal: false,
                          disableScrollLock: true,
                          sx: { zIndex: 9999 },
                          PaperProps: {
                            sx: {
                              zIndex: 9999,
                              minHeight: 120,
                              maxHeight: 320,
                              mt: 1,
                              bgcolor: theme.palette.background.paper,
                              color: theme.palette.text.primary,
                              '& .MuiMenuItem-root': {
                                color: theme.palette.text.primary,
                              },
                              '& .MuiList-root': {
                                py: 0,
                              },
                            },
                          },
                          MenuListProps: {
                            sx: {
                              py: 0,
                              color: theme.palette.text.primary,
                            },
                          },
                        }}
                      >
                        {availableModels.length > 0 ? (
                          <>
                            {availableModels
                              .sort((a, b) => a.id.localeCompare(b.id))
                              .map((model) => (
                                <MenuItem
                                  key={model.id}
                                  value={model.id}
                                  sx={{ fontSize: '14px' }}
                                  onClick={() => {
                                    handleModelChange(model.id)
                                    setModelSelectOpen(false)
                                  }}
                                >
                                  {model.id}
                                </MenuItem>
                              ))}
                            <MenuItem
                              value="custom"
                              sx={{ fontSize: '14px' }}
                              onClick={() => {
                                handleModelChange('custom')
                                setModelSelectOpen(false)
                              }}
                            >
                              {t('common.custom')}
                            </MenuItem>
                          </>
                        ) : (
                          MODEL_PRESETS.map((preset) => (
                            <MenuItem
                              key={preset.value}
                              value={preset.value}
                              sx={{ fontSize: '14px' }}
                              onClick={() => {
                                handleModelChange(preset.value)
                                setModelSelectOpen(false)
                              }}
                            >
                              {preset.provider ? `${preset.label} (${preset.provider})` : preset.label}
                            </MenuItem>
                          ))
                        )}
                      </Select>
                    </FormControl>
                  )}
                  {isCustomModel && (
                    <TextField
                      fullWidth
                      size="small"
                      value={settings.model}
                      onChange={(e) => setSettings(s => ({ ...s, model: e.target.value }))}
                      placeholder={t('settings.inputCustomModel')}
                      sx={{ fontSize: '14px' }}
                    />
                  )}
                </Box>
              )}

              <Accordion
                expanded={advancedExpanded}
                onChange={(_, expanded) => setAdvancedExpanded(expanded)}
                sx={{
                  boxShadow: 'none',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:before': {
                    display: 'none',
                  },
                }}
              >
                <AccordionSummary
                  expandIcon={advancedExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  sx={{
                    minHeight: 40,
                    '& .MuiAccordionSummary-content': {
                      my: 1,
                    },
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                    {t('settings.advancedSettings')}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 2 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {/* Temperature */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.primary' }}>{t('settings.temperature')}</Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                          {settings.temperature.toFixed(1)}
                        </Typography>
                      </Box>
                      <Slider
                        min={0}
                        max={2}
                        step={0.1}
                        value={settings.temperature}
                        onChange={(_, value) => setSettings(s => ({ ...s, temperature: value as number }))}
                        sx={{ color: 'primary.main' }}
                      />
                      <FormHelperText sx={{ fontSize: '10px', m: 0 }}>
                        {t('settings.temperatureHint')}
                      </FormHelperText>
                    </Box>

                    {/* Max Tokens */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.primary' }}>{t('settings.maxTokens')}</Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                          {settings.maxTokens}
                        </Typography>
                      </Box>
                      <Slider
                        min={256}
                        max={8192}
                        step={256}
                        value={settings.maxTokens}
                        onChange={(_, value) => setSettings(s => ({ ...s, maxTokens: value as number }))}
                        sx={{ color: 'primary.main' }}
                      />
                      <FormHelperText sx={{ fontSize: '10px', m: 0 }}>
                        {t('settings.maxTokensHint')}
                      </FormHelperText>
                    </Box>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.primary' }}>{t('settings.promptFileCount')}</Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                          {appSettings.promptFileCount}
                        </Typography>
                      </Box>
                      <Slider
                        min={20}
                        max={2000}
                        step={10}
                        value={Math.min(2000, Math.max(20, appSettings.promptFileCount))}
                        onChange={(_, value) => setAppSettings(s => ({ ...s, promptFileCount: value as number }))}
                        sx={{ color: 'primary.main' }}
                        marks={[
                          { value: 20, label: '20' },
                          { value: 500, label: '500' },
                          { value: 1000, label: '1000' },
                          { value: 2000, label: '2000' },
                        ]}
                      />
                      <FormHelperText sx={{ fontSize: '10px', m: 0 }}>
                        {t('settings.promptFileCountHint')}
                      </FormHelperText>
                    </Box>
                  </Box>
                </AccordionDetails>
              </Accordion>
            </Box>
          </TabPanel>

          <TabPanel value={activeTab} index={1}>
            <CloudStorageSettings />
          </TabPanel>

          <TabPanel value={activeTab} index={2}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  {t('settings.theme')}
                </Typography>
                <FormControl fullWidth size="small">
                  <Select
                    value={themePreference}
                    onChange={(e) => {
                      const newTheme = e.target.value as 'light' | 'dark' | 'system'
                      if (onThemeChange) {
                        onThemeChange(newTheme)
                      } else {
                        setInternalThemePreference(newTheme)
                        void writeStorageFile(THEME_STORAGE_FILE, newTheme)
                      }
                    }}
                    sx={{ fontSize: '14px' }}
                  >
                    <MenuItem value="light">{t('theme.light')}</MenuItem>
                    <MenuItem value="dark">{t('theme.dark')}</MenuItem>
                    <MenuItem value="system">{t('theme.system')}</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  {t('language.title')}
                </Typography>
                <FormControl fullWidth size="small">
                  <Select
                    value={currentLanguage}
                    onChange={(e) => {
                      const newLang = e.target.value
                      setLanguage(newLang)
                      if (onLanguageChange) {
                        onLanguageChange(newLang)
                      } else {
                        setInternalLanguage(newLang)
                      }
                    }}
                    sx={{ fontSize: '14px' }}
                  >
                    {supportedLanguages.map((lang) => (
                      <MenuItem key={lang.code} value={lang.code}>
                        {lang.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={appSettings.useMftScan !== false}
                      onChange={async (_, checked) => {
                        const next = { ...appSettings, useMftScan: checked }
                        await persistAppSettings(next)
                      }}
                      size="small"
                    />
                  }
                  label={t('settings.useMftScan')}
                />
                <FormHelperText sx={{ mt: -0.5, ml: 0 }}>
                  {t('settings.useMftScanHint')}
                </FormHelperText>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  {t('settings.snapshotSaveDir')}
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  value={appSettings.snapshotSaveDir ?? 'snapshots'}
                  onChange={(e) => setAppSettings(s => ({ ...s, snapshotSaveDir: e.target.value }))}
                  onBlur={() => {
                    void persistAppSettings(appSettings)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void persistAppSettings(appSettings)
                    }
                  }}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
                />
                <FormHelperText sx={{ mt: -0.5, ml: 0 }}>
                  {t('settings.snapshotSaveDirHint')}
                </FormHelperText>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={appSettings.autoSaveAfterAi === true}
                      onChange={async (_, checked) => {
                        const next = { ...appSettings, autoSaveAfterAi: checked }
                        await persistAppSettings(next)
                      }}
                      size="small"
                    />
                  }
                  label={t('settings.autoSaveAfterAi')}
                />
                <FormHelperText sx={{ mt: -0.5, ml: 0 }}>
                  {t('settings.autoSaveAfterAiHint')}
                </FormHelperText>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  {t('safeList.safeListTitle')}
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Shield size={16} />}
                  onClick={async () => {
                    const paths = await loadSafeListPaths()
                    setSafeListPaths(paths)
                    setNewSafeListPath('')
                    setShowSafeListDialog(true)
                  }}
                  sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
                >
                  {t('safeList.manageSafeList')}
                </Button>
                <FormHelperText sx={{ mt: -0.5, ml: 0 }}>
                  {t('safeList.manageSafeListHint')}
                </FormHelperText>
              </Box>
            </Box>
          </TabPanel>
        </div>

        <Dialog
          open={showSavePresetDialog}
          onClose={() => setShowSavePresetDialog(false)}
          maxWidth="xs"
          fullWidth
          PaperProps={{ sx: { borderRadius: '16px' } }}
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BookmarkPlus size={20} />
            {t('settings.saveAsPreset')}
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t('settings.saveAsPresetHint')}
            </Typography>
            <TextField
              size="small"
              fullWidth
              placeholder={t('settings.presetNamePlaceholder')}
              value={savePresetName}
              onChange={(e) => setSavePresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const name = savePresetName.trim() || settings.apiUrl.replace(/^https?:\/\//, '').split('/')[0] || t('settings.customApiPreset')
                  if (name) {
                    const newId = `custom-${Date.now()}`
                    const newPreset: CustomApiPresetItem = { id: newId, label: name, value: settings.apiUrl.trim() }
                    const newList = [...customApiPresets, newPreset]
                    saveCustomApiPresets(newList).then(() => {
                      setCustomApiPresets(newList)
                      setSettings(s => ({
                        ...s,
                        apiUrl: newPreset.value,
                        providerApiKeys: { ...(s.providerApiKeys ?? {}), [newId]: currentApiKey },
                      }))
                      setCustomUrl('')
                      setShowSavePresetDialog(false)
                      showNotification(t('settings.saveAsPresetSuccess'), name)
                    }).catch(err => showNotification(t('settings.saveFailed'), String(err)))
                  }
                }
              }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setShowSavePresetDialog(false)} sx={{ borderRadius: '10px', textTransform: 'none' }}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              onClick={async () => {
                const name = savePresetName.trim() || settings.apiUrl.replace(/^https?:\/\//, '').split('/')[0] || t('settings.customApiPreset')
                if (!name) return
                const newId = `custom-${Date.now()}`
                const newPreset: CustomApiPresetItem = { id: newId, label: name, value: settings.apiUrl.trim() }
                const newList = [...customApiPresets, newPreset]
                try {
                  await saveCustomApiPresets(newList)
                  setCustomApiPresets(newList)
                  setSettings(s => ({
                    ...s,
                    apiUrl: newPreset.value,
                    providerApiKeys: { ...(s.providerApiKeys ?? {}), [newId]: currentApiKey },
                  }))
                  setCustomUrl('')
                  setShowSavePresetDialog(false)
                  showNotification(t('settings.saveAsPresetSuccess'), name)
                } catch (err) {
                  showNotification(t('settings.saveFailed'), String(err))
                }
              }}
              sx={{ borderRadius: '10px', textTransform: 'none' }}
            >
              {t('common.confirm')}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showSafeListDialog}
          onClose={() => setShowSafeListDialog(false)}
          maxWidth="sm"
          fullWidth
          PaperProps={{ sx: { borderRadius: '16px' } }}
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Shield size={20} />
            {t('safeList.safeListTitle')}
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('safeList.manageSafeListHint')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                size="small"
                fullWidth
                placeholder={t('safeList.addPathPlaceholder')}
                value={newSafeListPath}
                onChange={(e) => setNewSafeListPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const p = newSafeListPath.trim()
                    if (p) {
                      const next = [...safeListPaths, p]
                      setSafeListPaths(next)
                      void saveSafeListPaths(next)
                      setNewSafeListPath('')
                    }
                  }
                }}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
              />
              <Button
                variant="contained"
                size="small"
                onClick={() => {
                  const p = newSafeListPath.trim()
                  if (p) {
                    const next = [...safeListPaths, p]
                    setSafeListPaths(next)
                    void saveSafeListPaths(next)
                    setNewSafeListPath('')
                  }
                }}
                sx={{ borderRadius: '10px', textTransform: 'none', flexShrink: 0 }}
              >
                {t('safeList.addPath')}
              </Button>
            </Box>
            {safeListPaths.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('safeList.emptySafeList')}
              </Typography>
            ) : (
              <List dense sx={{ bgcolor: 'action.hover', borderRadius: 1, maxHeight: 280, overflow: 'auto' }}>
                {safeListPaths.map((pathItem) => (
                  <ListItem
                    key={pathItem}
                    secondaryAction={
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={() => {
                          const next = safeListPaths.filter((p) => p !== pathItem)
                          setSafeListPaths(next)
                          void saveSafeListPaths(next)
                        }}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    }
                  >
                    <ListItemText primary={pathItem} primaryTypographyProps={{ variant: 'body2', sx: { wordBreak: 'break-all' } }} />
                  </ListItem>
                ))}
              </List>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setShowSafeListDialog(false)} sx={{ borderRadius: '10px', textTransform: 'none' }}>
              {t('common.close')}
            </Button>
          </DialogActions>
        </Dialog>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'action.hover' }} className="dark:!bg-gray-700/50 dark:!border-gray-600">
          {activeTab === 0 ? (
            <Button
              onClick={() => {
                setSettings(DEFAULT_SETTINGS)
                setAppSettings({
                  promptFileCount: 100,
                  useMftScan: true,
                  snapshotSaveDir: 'snapshots',
                  autoSaveAfterAi: false,
                })
                setCustomUrl('')
                setCustomModel('')
              }}
              variant="text"
              size="small"
              sx={{
                textTransform: 'none',
                fontSize: '14px',
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'background.paper',
                },
              }}
            >
              {t('settings.resetDefault')}
            </Button>
          ) : (
            <Box />
          )}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              onClick={onClose}
              variant="outlined"
              size="small"
              sx={{
                textTransform: 'none',
                fontSize: '14px',
                color: 'text.secondary',
                borderColor: 'divider',
                '&:hover': {
                  bgcolor: 'background.paper',
                  borderColor: 'divider',
                },
              }}
              >
              {t('common.cancel')}
            </Button>
            {activeTab === 0 && (
              <Button
                onClick={handleSave}
                variant="contained"
                size="small"
                startIcon={saved ? <Check className="w-4 h-4" /> : null}
                sx={{
                  textTransform: 'none',
                  fontSize: '12px',
                  fontWeight: 700,
                  borderRadius: '10px',
                  px: 3,
                  py: 0.9,
                  bgcolor: 'primary.main',
                  color: '#1A1A1A',
                  boxShadow: 'none',
                  '&:hover': {
                    bgcolor: 'primary.dark',
                    color: '#1A1A1A',
                  },
                }}
              >
                {saved ? t('common.saved') : t('settings.saveSettings')}
              </Button>
            )}
          </Box>
        </Box>
      </div>
    </div>
  )
}


