import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import zh from './locales/zh.json';
import en from './locales/en.json';

// 读取持久化的语言偏好，默认中文
const savedLang = typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null;
const initialLang = savedLang === 'en' ? 'en' : 'zh';

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: initialLang,
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
  returnObjects: false,
});

i18n.on("languageChanged", (language) => {
  const normalized = language.startsWith("en") ? "en" : "zh";
  if (typeof document !== "undefined") {
    document.documentElement.lang = normalized === "en" ? "en" : "zh-CN";
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem("lang", normalized);
  } catch {
    // WebView 禁止持久化时仍保留当前会话语言。
  }
});

export default i18n;
