# vendor/

Browser builds of runtime libraries, copied from npm by `npm run vendor`
(see `scripts/vendor.js`). Do not edit by hand — change the version in
`package.json`, run `npm install && npm run vendor`, commit the result.

| File | Package | License |
|---|---|---|
| `pdf-lib.min.js` | pdf-lib 1.17.1 | MIT |
| `fontkit.min.js` | @pdf-lib/fontkit 1.1.1 | MIT |
| `pdf.min.js`, `pdf.worker.min.js` | pdfjs-dist 3.11.174 | Apache-2.0 |
| `standard_fonts/` | pdfjs-dist 3.11.174 | see `LICENSE_FOXIT`, `LICENSE_LIBERATION` |
| `jszip.min.js` | jszip 3.10.1 | MIT or GPLv3 |

SheetJS (`xlsx`) is **not** vendored: the npm registry only has the vulnerable
0.18.5, so `script.js` lazy-loads 0.20.3 from the official `cdn.sheetjs.com`
the first time a spreadsheet is opened.
