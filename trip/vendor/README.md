# Browser runtime assets

These pinned browser builds replace runtime CDN dependencies so the encrypted
trip dashboard's app shell can be cached for offline use.

| File | Upstream URL | SHA-256 |
| --- | --- | --- |
| `react-18.3.1.production.min.js` | `https://unpkg.com/react@18.3.1/umd/react.production.min.js` | `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd` |
| `react-dom-18.3.1.production.min.js` | `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js` | `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d` |
| `babel-7.23.9.min.js` | `https://unpkg.com/@babel/standalone@7.23.9/babel.min.js` | `b1e09e947968baa0fd38a6a011e8aadd6518c0c22f4e722e6a9b9b9b1032d3ff` |
| `tailwindcss-3.4.17.js` | `https://cdn.tailwindcss.com/3.4.17` | `176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15` |

The Tailwind browser build runs locally. It does not fetch styles at runtime.
When any app-shell file changes, update `SHELL_VERSION` in `../sw.js` so a newly
installed worker creates and verifies a fresh atomic shell cache.
