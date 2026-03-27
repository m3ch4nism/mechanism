<div align="center">
  <h1>mechanism</h1>
  <p>A fast, cross-platform desktop application for IMAP mail management and automated Amazon receipt analysis, built with Tauri, React, and Node.js.</p>
</div>

---

## English Description

**mechanism** is a specialized desktop client designed to connect to your email accounts via IMAP and perform deep analysis on Amazon-related emails.

### Features
- **IMAP Client Integration:** Fast and reliable connection to any IMAP provider. Supports custom usernames for providers like Comcast/TWC.
- **Amazon Check Module:** Automatically scans all folders (not just INBOX) for Amazon emails and receipts.
- **Deep Scanning:** Extracts account names, linked credit cards, digital subscriptions, and Subscribe & Save details directly from mailbox contents.
- **Node.js Sidecar:** Offloads heavy processing, email parsing (via `mailparser` & `cheerio`), and IMAP connections to a dedicated Node.js background process. The app automatically detects and installs Node.js if it's missing on the host system.
- **Deduplication & Caching:** Prevents duplicate processing using `Message-ID` tracking. Results are cached and persist between tab switches.
- **Presets & Automation:** Configure templates for automated inbox checking and data extraction.
- **Cross-Platform & Auto-Updates:** Built with Tauri for a lightweight native UI. Includes a built-in OTA update process directly from GitHub Releases.

### Getting Started

#### Prerequisites
- Node.js (v22 LTS recommended)
- Rust (for Tauri backend)

#### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/m3ch4nism/mechanism.git
   cd mechanism
   ```
2. Install dependencies for UI and Sidecar:
   ```bash
   npm install
   cd sidecar && npm install && cd ..
   ```
3. Run in development mode:
   ```bash
   npm run tauri dev
   ```
4. Build for production:
   ```bash
   npm run tauri build
   ```

---

## Описание на русском

**mechanism** — это специализированное десктопное приложение для работы с почтовыми ящиками по протоколу IMAP и автоматизированного анализа писем (чеков, заказов) от Amazon. 

### Основной функционал
- **Полноценный IMAP Клиент:** Быстрое и стабильное подключение к любой почте. Поддержка кастомных логинов (для провайдеров вроде Comcast/TWC), удаление писем, авто-переподключение при обрывах связи.
- **Модуль Amazon Check:** Умный сканер, который ищет целевые письма от Amazon во всех папках аккаунта.
- **Глубокий анализ (Парсинг):** Автоматическое извлечение имени владельца аккаунта, привязанных банковских карт (Linked Cards), цифровых подписок (Digital Subscriptions) и активных подписок Subscribe & Save.
- **Архитектура через Sidecar:** Вся сетевая логика IMAP и сложный HTML-парсинг писем вынесены в отдельный фоновый процесс (Node.js Sidecar). Если у пользователя не установлен Node.js, приложение автоматически скачает и установит его при первом запуске.
- **Умный кэш и дедупликация:** Защита от повторного сканирования одних и тех же писем (уникализация по `Message-ID`). Мгновенная загрузка результатов из кэша при переключении разделов.
- **Пресеты:** Удобная система пресетов для автоматизации работы с большим количеством аккаунтов.
- **Автообновления:** Встроенная система OTA обновлений (скачивает апдейты напрямую из релизов GitHub).

### Как запустить для разработки

#### Требования
- Node.js (рекомендуется v22 LTS)
- Rust (для сборки Tauri Core)

#### Установка и запуск
1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/m3ch4nism/mechanism.git
   cd mechanism
   ```
2. Установите зависимости:
   ```bash
   npm install
   cd sidecar && npm install && cd ..
   ```
3. Запуск в режиме разработки:
   ```bash
   npm run tauri dev
   ```
4. Сборка готового (`.exe` / `.app` / `.deb`) приложения:
   ```bash
   npm run tauri build
   ```
