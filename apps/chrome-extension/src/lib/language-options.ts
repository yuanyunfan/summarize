export const languageOptions = [
  { value: "auto", label: "自动检测" },
  { value: "zh-cn", label: "中文（简体）" },
  { value: "zh-tw", label: "中文（繁体）" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "nl", label: "Nederlands" },
  { value: "sv", label: "Svenska" },
  { value: "no", label: "Norsk" },
  { value: "da", label: "Dansk" },
  { value: "fi", label: "Suomi" },
  { value: "pl", label: "Polski" },
  { value: "cs", label: "Čeština" },
  { value: "tr", label: "Türkçe" },
  { value: "ru", label: "Русский" },
  { value: "uk", label: "Українська" },
  { value: "ar", label: "العربية" },
  { value: "hi", label: "हिन्दी" },
] as const;

export const languagePresetValues = languageOptions.map((option) => option.value);

export function getLanguageLabel(value: string): string {
  return languageOptions.find((option) => option.value === value)?.label ?? value;
}
