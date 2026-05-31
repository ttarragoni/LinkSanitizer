# LinkSanitizer — Chrome Extension

A Manifest V3 Chrome extension that automatically strips tracking parameters
from URLs **before** the page loads — protecting your privacy silently in the background.

## Tracking parameters removed

| Parameter | Source |
|-----------|--------|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | Google Analytics / UTM |
| `fbclid` | Facebook |
| `gclid`, `gclsrc`, `dclid` | Google Ads |
| `msclkid` | Microsoft Ads |
| `twclid` | Twitter/X |
| `igshid` | Instagram |
| `mc_eid`, `mc_cid` | Mailchimp |
| `_ga`, `_gl` | Google Analytics cookies |
| `gbraid`, `wbraid` | Google (iOS privacy) |
| `zanpid`, `yclid` | Zanox, Yandex |

## Files

```
link-sanitizer/
├── manifest.json   — Extension config (MV3, permissions)
├── background.js   — Service worker: intercepts & cleans URLs
├── popup.html      — Extension popup layout
├── popup.css       — Dark cybersecurity theme
├── popup.js        — Counter display + reset logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## How to install in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this `link-sanitizer/` folder
5. The extension icon will appear in your toolbar — click it to see the popup

## How it works

The background service worker (`background.js`) listens to two Chrome events:

- **`chrome.webNavigation.onBeforeNavigate`** — intercepts navigation before
  the page loads and redirects to the clean URL if tracking params are found.
- **`chrome.tabs.onUpdated`** — catches edge cases like `history.pushState`
  where the URL changes without a full navigation.

Every removed parameter increments a counter stored in `chrome.storage.local`,
which the popup reads and displays with an animated count-up.

## Customising tracked params

Edit the `TRACKING_PARAMS` array at the top of `background.js` to add or
remove any parameter you want to filter.

## Replacing icons

The icons in `icons/` are placeholder solid-color PNGs. Replace them with
your own 16×16, 48×48, and 128×128 PNG artwork to customise the toolbar icon.
