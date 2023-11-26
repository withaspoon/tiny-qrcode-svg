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

![Example SVG](https://raw.github.com/withaspoon/tiny-qrcode-svg/main/example.svg)
