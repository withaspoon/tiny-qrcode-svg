import { Ecc, QrCode } from "./qrcodegen";

function group<T>(arr: T[]) {
  const groups: T[][] = [];
  let last = arr[0];
  let group: T[] = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    if (current === last) {
      group.push(current);
    } else {
      groups.push(group);
      group = [current];
      last = current;
    }
  }
  groups.push(group);
  return groups;
}

const DOT_SIZE = 2;
function buildPath(qr: QrCode) {
  const OFFSET = DOT_SIZE / 2;
  let path = "";
  for (let y = 0; y < qr._size; y++) {
    const line = group(qr._modules[y]);
    const len = line.length;

    for (let i = 0; i < len; i++) {
      const group = line[i];

      if (group[0] === false && i === 0) {
        // if the first element is false, then it's a gap and we can move directly to the next group
        path += `M${group.length * DOT_SIZE} ${y * DOT_SIZE + OFFSET}`;
        continue;
      } else if (group[0] === true && i === 0) {
        // Otherwise we have to move to the start of the line
        path += `M0 ${y * DOT_SIZE + OFFSET}`;
      }

      // if the last element is false, then it's a gap and we can move directly to the next line
      if (i === len - 1 && group[0] === false) {
        break;
      }

      if (group[0]) {
        path += `h${group.length * DOT_SIZE}`;
      } else {
        path += `m${group.length * DOT_SIZE} 0`;
      }
    }
  }
  return path;
}

export default function makeSvg(
  text: string,
  opts: { color?: string; size?: number } = {
    color: "#000",
    size: 256,
  }
): string {
  const { color, size } = opts;
  const qr = QrCode._encodeText(text, Ecc._MEDIUM);
  const path = buildPath(qr);
  const widthHeight = qr._size * DOT_SIZE;
  return `<svg  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthHeight} ${widthHeight}" width="${size}" height="${size}"><path stroke="${color}" stroke-width="${DOT_SIZE}" d="${path}" /></svg>`;
}
