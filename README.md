# LinkSanitizer — Chrome Extension

A lightweight, high-performance Manifest V3 Chrome extension that automatically strips tracking parameters from URLs **before** the page loads — protecting your privacy silently in the background. 

Designed with a sleek, minimalist dark UI, LinkSanitizer blocks analytics, social media, and advertising trackers in real-time, keeping your browsing fast and clean.

---

## ✨ Key Features

* **Real-Time Sanitization:** Instantly intercepts and purges URLs before the browser requests the page.
* **Global Counter & Icon Badge:** Live activation counter showing exactly how many tracking parameters have been stripped.
* **User-Customizable Allowlist:** Easily whitelist specific domains (e.g., `amazon.it`, `ebay.it`) directly from the popup if you need tracking active for specific sites.
* **Master On/Off Toggle:** Pause and resume the extension globally with a single click, featuring a responsive color-coded visual indicator (Green for Active, Red for Paused).
* **100% Local & Private:** No data is ever sent to external servers. All settings and counts are kept strictly on your machine via `chrome.storage.local`.

---

## 🛡️ Supported Tracking Parameters

LinkSanitizer automatically detects and removes a comprehensive list of tracking tokens, including:

| Parameter | Source / Platform |
|-----------|-------------------|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | Google Analytics / UTM |
| `fbclid` | Facebook / Meta |
| `gclid`, `gclsrc`, `dclid`, `gbraid`, `wbraid` | Google Ads & iOS Privacy Bypass |
| `msclkid` | Microsoft Ads / Bing |
| `twclid` | Twitter / X |
| `igshid` | Instagram |
| `mc_eid`, `mc_cid` | Mailchimp Campaigns |
| `_ga`, `_gl` | Google Analytics Linkers |
| `zanpid`, `yclid` | Zanox Affiliates, Yandex |

---

## 📂 Project Architecture

```text
link-sanitizer/
├── manifest.json   — Extension configuration (MV3 permissions & icons configuration)
├── background.js   — Service worker: background link interception & synchronization logic
├── content.js      — Content script: handles instant client-side URL updates
├── popup.html      — Responsive popup interface
├── popup.css       — Custom minimalist dark-theme stylesheet
├── popup.js        — Live counter rendering, toggle management & allowlist sync
└── icons/          — Cyberpunk official identity artwork
    ├── icon16.png  (Toolbar icon)
    ├── icon48.png  (Extensions management page icon)
    └── icon128.png (Chrome Web Store display icon)
    
```
## ⚙️ How to Install (Developer Mode)



If you are installing the extension locally from the source folder, follow these steps:



1. Download or clone this repository to your local machine.

2. Open Google Chrome and navigate to `chrome://extensions/`.

3. Enable **Developer mode** by flipping the switch in the top-right corner.

4. Click the **Load unpacked** button in the top-left corner.

5. Select the root `link-sanitizer/` folder containing the `manifest.json` file.

6. Click the Extensions puzzle piece icon in your Chrome toolbar and pin **LinkSanitizer** for quick access!



---



## 🧠 How It Works Behind the Scenes



LinkSanitizer combines a background Service Worker and a Content Script to ensure no tracker slips through:



1. **`chrome.webNavigation.onBeforeNavigate`** — Intercepts the navigation phase at the earliest possible stage, redirecting the browser to a clean URL if tracking tokens are found.

2. **Content Script Injection (`content.js`)** — Catches edge cases, including client-side dynamic URL modifications (like `history.pushState` or `history.replaceState`) where URLs change instantly without triggering a full page reload.

3. **Reactive Whitelisting** — Before running any sanitization script, the extension queries the local storage array. If the current hostname matches a user-defined allowlist domain, the cleaning process is skipped instantly.



---



## 🐛 Bug Reporting & Feedback



Since websites change their URL structures frequently, you might occasionally encounter a page that behaves unexpectedly or a tracking parameter that got missed.



If you find a bug, please help improve LinkSanitizer by reporting it:



* **Via GitHub Issues (Recommended):** Go to the **Issues** tab at the top of this repository, click **New Issue**, and describe the problem. Please include the original "dirty" URL (make sure to obscure any personal data inside it!) and what happened.

* **Via Email:** You can contact the developer directly at `linksanitizer.dev@gmail.com`.



*When reporting a bug, specifying the browser version and providing a brief step-by-step description of how to reproduce the error will help resolve it much faster!*



---



## ☕ Support the Project



If LinkSanitizer successfully keeps your browsing clutter-free and enhances your daily privacy, consider supporting its ongoing development!



* [**Buy Me a Coffee**](https://www.buymeacoffee.com/linksanitizer) — Drop a small donation to keep the developer caffeinated while writing code!