# Bundled fonts

The `.typeface.json` files in this folder are the font set shipped with
[three.js](https://github.com/mrdoob/three.js/tree/dev/examples/fonts) (generated with
[facetype.js](https://gero3.github.io/facetype.js/)). The Text shape (`src/text.js`) loads them
on demand, so only the font a document actually uses is ever fetched.

| file | family | weight | licence |
| --- | --- | --- | --- |
| `helvetiker_regular.typeface.json` | Helvetiker | Regular | free, distributed with three.js |
| `helvetiker_bold.typeface.json` | Helvetiker | Bold | free, distributed with three.js |
| `optimer_regular.typeface.json` | Optimer | Regular | free, distributed with three.js |
| `optimer_bold.typeface.json` | Optimer | Bold | free, distributed with three.js |
| `gentilis_regular.typeface.json` | Gentilis | Regular | free, distributed with three.js |
| `gentilis_bold.typeface.json` | Gentilis | Bold | free, distributed with three.js |
| `droid_sans_regular.typeface.json` | Droid Sans | Regular | Apache License 2.0 |
| `droid_sans_bold.typeface.json` | Droid Sans | Bold | Apache License 2.0 |
| `droid_serif_regular.typeface.json` | Droid Serif | Regular | Apache License 2.0 |
| `droid_serif_bold.typeface.json` | Droid Serif | Bold | Apache License 2.0 |

To add another open-source face, drop its `*.typeface.json` here and register it in the
`TEXT_FONTS` list in `src/text.js`.
