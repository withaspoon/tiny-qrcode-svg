# tiny-qrcode-svg

## Who is it for?

Anybody who wants to generate a QR code either server side or client side without too much bloat. The library comes in at around 7kb uncompressed. It is based off https://www.nayuki.io/page/qr-code-generator-library, and comes bundled with a minified version of that library.

## Installing

```
# Choose your poison...
bun i tiny-qrcode-svg
npm i tiny-qrcode-svg
yarn add tiny-qrcode-svg
```

## Usage

The following would produce the QR-code below:

```ts
import makeSvg from "tiny-qrcode-svg";

const svg = makeSvg("Hello, World", {
  color: "#000",
  size: 300,
});
```

<svg viewBox="0 0 42 42" width="150" height="150" style="background-color: white"><path stroke="#000" stroke-width="2" d="M0 1h14m2 0h4m2 0h4m2 0h14M0 3h2m10 0h2m2 0h2m4 0h2m4 0h2m10 0h2M0 5h2m2 0h6m2 0h2m4 0h2m2 0h2m4 0h2m2 0h6m2 0h2M0 7h2m2 0h6m2 0h2m2 0h8m4 0h2m2 0h6m2 0h2M0 9h2m2 0h6m2 0h2m6 0h2m6 0h2m2 0h6m2 0h2M0 11h2m10 0h2m4 0h4m6 0h2m10 0h2M0 13h14m2 0h2m2 0h2m2 0h2m2 0h14M16 15h4M0 17h2m2 0h4m2 0h6m2 0h4m6 0h2m4 0h2m2 0h4M0 19h2m2 0h6m4 0h2m4 0h2m2 0h4m6 0h4m2 0h2M0 21h10m2 0h4m2 0h4m2 0h4m2 0h2m6 0h4M0 23h4m2 0h6m2 0h4m6 0h2m6 0h4m2 0h2M8 25h6m2 0h4m2 0h2m4 0h4m8 0h2M16 27h2m4 0h2m2 0h2m4 0h2m2 0h2m2 0h2M0 29h14m2 0h2m2 0h2m6 0h2m2 0h2M0 31h2m10 0h2m2 0h4m4 0h4m2 0h2m2 0h4M0 33h2m2 0h6m2 0h2m4 0h2m6 0h2m2 0h10M0 35h2m2 0h6m2 0h2m2 0h6m2 0h4m6 0h6M0 37h2m2 0h6m2 0h2m2 0h4m2 0h4m2 0h4m4 0h2M0 39h2m10 0h2m4 0h2m2 0h2m2 0h8m6 0h2M0 41h14m2 0h2m2 0h12m4 0h2"></path></svg>
