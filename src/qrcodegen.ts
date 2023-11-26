/*
 * QR Code generator library (TypeScript)
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

"use strict";

type bit = number;
type byte = number;
type int = number;

const _RangeError = RangeError;
const floor = Math.floor;
const abs = Math.abs;

/*---- QR Code symbol class ----*/

/*
 * A QR Code symbol, which is a type of two-dimension barcode.
 * Invented by Denso Wave and described in the ISO/IEC 18004 standard.
 * Instances of this class represent an immutable square grid of dark and light cells.
 * The class provides static factory functions to create a QR Code from text or binary data.
 * The class covers the QR Code Model 2 specification, supporting all versions (sizes)
 * from 1 to 40, all 4 error correction levels, and 4 character encoding modes.
 *
 * Ways to create a QR Code object:
 * - High level: Take the payload data and call QrCode.encodeText() or QrCode.encodeBinary().
 * - Mid level: Custom-make the list of segments and call QrCode.encodeSegments().
 * - Low level: Custom-make the array of data codeword bytes (including
 *   segment headers and final padding, excluding error correction codewords),
 *   supply the appropriate version number, and call the QrCode() constructor.
 * (Note that all ways require supplying the desired error correction level.)
 */
export class QrCode {
  /*-- Static factory functions (high level) --*/

  // Returns a QR Code representing the given Unicode text string at the given error correction level.
  // As a conservative upper bound, this function is guaranteed to succeed for strings that have 738 or fewer
  // Unicode code points (not UTF-16 code units) if the low error correction level is used. The smallest possible
  // QR Code version is automatically chosen for the output. The ECC level of the result may be higher than the
  // ecl argument if it can be done without increasing the version.
  public static _encodeText(text: string, ecl: Ecc): QrCode {
    const segs: Array<QrSegment> = QrSegment._makeSegments(text);
    return QrCode._encodeSegments(segs, ecl);
  }

  // Returns a QR Code representing the given binary data at the given error correction level.
  // This function always encodes using the binary segment mode, not any text mode. The maximum number of
  // bytes allowed is 2953. The smallest possible QR Code version is automatically chosen for the output.
  // The ECC level of the result may be higher than the ecl argument if it can be done without increasing the version.
  // public static encodeBinary(data: Readonly<Array<byte>>, ecl: Ecc): QrCode {
  //   const seg: QrSegment = QrSegment.makeBytes(data);
  //   return QrCode.encodeSegments([seg], ecl);
  // }

  /*-- Static factory functions (mid level) --*/

  // Returns a QR Code representing the given segments with the given encoding parameters.
  // The smallest possible QR Code version within the given range is automatically
  // chosen for the output. Iff boostEcl is true, then the ECC level of the result
  // may be higher than the ecl argument if it can be done without increasing the
  // version. The mask number is either between 0 to 7 (inclusive) to force that
  // mask, or -1 to automatically choose an appropriate mask (which may be slow).
  // This function allows the user to create a custom sequence of segments that switches
  // between modes (such as alphanumeric and byte) to encode text in less space.
  // This is a mid-level API; the high-level API is encodeText() and encodeBinary().
  public static _encodeSegments(
    segs: Readonly<Array<QrSegment>>,
    ecl: Ecc,
    minVersion: int = 1,
    maxVersion: int = 40,
    mask: int = -1,
    boostEcl: boolean = true
  ): QrCode {
    if (
      !(
        QrCode._MIN_VERSION <= minVersion &&
        minVersion <= maxVersion &&
        maxVersion <= QrCode._MAX_VERSION
      ) ||
      mask < -1 ||
      mask > 7
    )
      throw new _RangeError("Invalid value");

    // Find the minimal version number to use
    let version: int;
    let dataUsedBits: int;
    for (version = minVersion; ; version++) {
      const dataCapacityBits: int =
        QrCode._getNumDataCodewords(version, ecl) * 8; // Number of data bits available
      const usedBits: number = QrSegment._getTotalBits(segs, version);
      if (usedBits <= dataCapacityBits) {
        dataUsedBits = usedBits;
        break; // This version number is found to be suitable
      }
      if (version >= maxVersion)
        // All versions in the range could not fit the given data
        throw new _RangeError("Data too long");
    }

    // Increase the error correction level while the data still fits in the current version number
    for (const newEcl of [Ecc._MEDIUM, Ecc._QUARTILE, Ecc._HIGH]) {
      // From low to high
      if (
        boostEcl &&
        dataUsedBits <= QrCode._getNumDataCodewords(version, newEcl) * 8
      )
        ecl = newEcl;
    }

    // Concatenate all segments to create the data bit string
    let bb: Array<bit> = [];
    for (const seg of segs) {
      _appendBits(seg._mode._modeBits, 4, bb);
      _appendBits(seg._numChars, seg._mode._numCharCountBits(version), bb);
      for (const b of seg._getData()) bb.push(b);
    }
    _assert(bb.length == dataUsedBits);

    // Add terminator and pad up to a byte if applicable
    const dataCapacityBits: int = QrCode._getNumDataCodewords(version, ecl) * 8;
    _assert(bb.length <= dataCapacityBits);
    _appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
    _appendBits(0, (8 - (bb.length % 8)) % 8, bb);
    _assert(bb.length % 8 == 0);

    // Pad with alternating bytes until data capacity is reached
    for (
      let padByte = 0xec;
      bb.length < dataCapacityBits;
      padByte ^= 0xec ^ 0x11
    )
      _appendBits(padByte, 8, bb);

    // Pack bits into bytes in big endian
    let dataCodewords: Array<byte> = [];
    while (dataCodewords.length * 8 < bb.length) dataCodewords.push(0);
    bb.forEach(
      (b: bit, i: int) => (dataCodewords[i >>> 3] |= b << (7 - (i & 7)))
    );

    // Create the QR Code object
    return new QrCode(version, ecl, dataCodewords, mask);
  }

  /*-- Fields --*/

  // The width and height of this QR Code, measured in modules, between
  // 21 and 177 (inclusive). This is equal to version * 4 + 17.
  public readonly _size: int;

  // The index of the mask pattern used in this QR Code, which is between 0 and 7 (inclusive).
  // Even if a QR Code is created with automatic masking requested (mask = -1),
  // the resulting object still has a mask value between 0 and 7.
  public readonly _mask: int;

  // The modules of this QR Code (false = light, true = dark).
  // Immutable after constructor finishes. Accessed through getModule().
  public readonly _modules: Array<Array<boolean>> = [];

  // Indicates function modules that are not subjected to masking. Discarded when constructor finishes.
  private readonly _isFunction: Array<Array<boolean>> = [];

  /*-- Constructor (low level) and fields --*/

  // Creates a new QR Code with the given version number,
  // error correction level, data codeword bytes, and mask number.
  // This is a low-level API that most users should not use directly.
  // A mid-level API is the encodeSegments() function.
  public constructor(
    // The version number of this QR Code, which is between 1 and 40 (inclusive).
    // This determines the size of this barcode.
    public readonly _version: int,

    // The error correction level used in this QR Code.
    public readonly _errorCorrectionLevel: Ecc,

    dataCodewords: Readonly<Array<byte>>,

    msk: int
  ) {
    // Check scalar arguments
    if (_version < QrCode._MIN_VERSION || _version > QrCode._MAX_VERSION)
      throw new _RangeError("Version value out of range");
    if (msk < -1 || msk > 7) throw new _RangeError("Mask value out of range");
    this._size = _version * 4 + 17;

    // Initialize both grids to be size*size arrays of Boolean false
    let row: Array<boolean> = [];
    for (let i = 0; i < this._size; i++) row.push(false);
    for (let i = 0; i < this._size; i++) {
      this._modules.push(row.slice()); // Initially all light
      this._isFunction.push(row.slice());
    }

    // Compute ECC, draw modules
    this._drawFunctionPatterns();
    const allCodewords: Array<byte> = this._addEccAndInterleave(dataCodewords);
    this._drawCodewords(allCodewords);

    // Do masking
    if (msk == -1) {
      // Automatically choose best mask
      let minPenalty: int = 1000000000;
      for (let i = 0; i < 8; i++) {
        this._applyMask(i);
        this._drawFormatBits(i);
        const penalty: int = this._getPenaltyScore();
        if (penalty < minPenalty) {
          msk = i;
          minPenalty = penalty;
        }
        this._applyMask(i); // Undoes the mask due to XOR
      }
    }
    _assert(0 <= msk && msk <= 7);
    this._mask = msk;
    this._applyMask(msk); // Apply the final choice of mask
    this._drawFormatBits(msk); // Overwrite old format bits

    this._isFunction = [];
  }

  /*-- Accessor methods --*/

  // Returns the color of the module (pixel) at the given coordinates, which is false
  // for light or true for dark. The top left corner has the coordinates (x=0, y=0).
  // If the given coordinates are out of bounds, then false (light) is returned.
  // public getModule(x: int, y: int): boolean {
  //   return (
  //     0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x]
  //   );
  // }

  /*-- Private helper methods for constructor: Drawing function modules --*/

  // Reads this object's version field, and draws and marks all function modules.
  private _drawFunctionPatterns(): void {
    // Draw horizontal and vertical timing patterns
    for (let i = 0; i < this._size; i++) {
      this._setFunctionModule(6, i, i % 2 == 0);
      this._setFunctionModule(i, 6, i % 2 == 0);
    }

    // Draw 3 finder patterns (all corners except bottom right; overwrites some timing modules)
    this._drawFinderPattern(3, 3);
    this._drawFinderPattern(this._size - 4, 3);
    this._drawFinderPattern(3, this._size - 4);

    // Draw numerous alignment patterns
    const alignPatPos: Array<int> = this._getAlignmentPatternPositions();
    const numAlign: int = alignPatPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        // Don't draw on the three finder corners
        if (
          !(
            (i == 0 && j == 0) ||
            (i == 0 && j == numAlign - 1) ||
            (i == numAlign - 1 && j == 0)
          )
        )
          this._drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
      }
    }

    // Draw configuration data
    this._drawFormatBits(0); // Dummy mask value; overwritten later in the constructor
    this._drawVersion();
  }

  // Draws two copies of the format bits (with its own error correction code)
  // based on the given mask and this object's error correction level field.
  private _drawFormatBits(mask: int): void {
    // Calculate error correction code and pack bits
    const data: int = (this._errorCorrectionLevel._formatBits << 3) | mask; // errCorrLvl is uint2, mask is uint3
    let rem: int = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412; // uint15
    _assert(bits >>> 15 == 0);

    // Draw first copy
    for (let i = 0; i <= 5; i++)
      this._setFunctionModule(8, i, _getBit(bits, i));
    this._setFunctionModule(8, 7, _getBit(bits, 6));
    this._setFunctionModule(8, 8, _getBit(bits, 7));
    this._setFunctionModule(7, 8, _getBit(bits, 8));
    for (let i = 9; i < 15; i++)
      this._setFunctionModule(14 - i, 8, _getBit(bits, i));

    // Draw second copy
    for (let i = 0; i < 8; i++)
      this._setFunctionModule(this._size - 1 - i, 8, _getBit(bits, i));
    for (let i = 8; i < 15; i++)
      this._setFunctionModule(8, this._size - 15 + i, _getBit(bits, i));
    this._setFunctionModule(8, this._size - 8, true); // Always dark
  }

  // Draws two copies of the version bits (with its own error correction code),
  // based on this object's version field, iff 7 <= version <= 40.
  private _drawVersion(): void {
    if (this._version < 7) return;

    // Calculate error correction code and pack bits
    let rem: int = this._version; // version is uint6, in the range [7, 40]
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits: int = (this._version << 12) | rem; // uint18
    _assert(bits >>> 18 == 0);

    // Draw two copies
    for (let i = 0; i < 18; i++) {
      const color: boolean = _getBit(bits, i);
      const a: int = this._size - 11 + (i % 3);
      const b: int = floor(i / 3);
      this._setFunctionModule(a, b, color);
      this._setFunctionModule(b, a, color);
    }
  }

  // Draws a 9*9 finder pattern including the border separator,
  // with the center module at (x, y). Modules can be out of bounds.
  private _drawFinderPattern(x: int, y: int): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist: int = Math.max(abs(dx), abs(dy)); // Chebyshev/infinity norm
        const xx: int = x + dx;
        const yy: int = y + dy;
        if (0 <= xx && xx < this._size && 0 <= yy && yy < this._size)
          this._setFunctionModule(xx, yy, dist != 2 && dist != 4);
      }
    }
  }

  // Draws a 5*5 alignment pattern, with the center module
  // at (x, y). All modules must be in bounds.
  private _drawAlignmentPattern(x: int, y: int): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++)
        this._setFunctionModule(
          x + dx,
          y + dy,
          Math.max(abs(dx), abs(dy)) != 1
        );
    }
  }

  // Sets the color of a module and marks it as a function module.
  // Only used by the constructor. Coordinates must be in bounds.
  private _setFunctionModule(x: int, y: int, isDark: boolean): void {
    this._modules[y][x] = isDark;
    this._isFunction[y][x] = true;
  }

  /*-- Private helper methods for constructor: Codewords and masking --*/

  // Returns a new byte string representing the given data with the appropriate error correction
  // codewords appended to it, based on this object's version and error correction level.
  private _addEccAndInterleave(data: Readonly<Array<byte>>): Array<byte> {
    const ver: int = this._version;
    const ecl: Ecc = this._errorCorrectionLevel;
    if (data.length != QrCode._getNumDataCodewords(ver, ecl))
      throw new _RangeError("Invalid argument");

    // Calculate parameter numbers
    const numBlocks: int =
      QrCode._NUM_ERROR_CORRECTION_BLOCKS[ecl._ordinal][ver];
    const blockEccLen: int = QrCode._ECC_CODEWORDS_PER_BLOCK[ecl._ordinal][ver];
    const rawCodewords: int = floor(QrCode._getNumRawDataModules(ver) / 8);
    const numShortBlocks: int = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen: int = floor(rawCodewords / numBlocks);

    // Split data into blocks and append ECC to each block
    let blocks: Array<Array<byte>> = [];
    const rsDiv: Array<byte> = QrCode._reedSolomonComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      let dat: Array<byte> = data.slice(
        k,
        k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
      );
      k += dat.length;
      const ecc: Array<byte> = QrCode._reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    // Interleave (not concatenate) the bytes from every block into a single sequence
    let result: Array<byte> = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        // Skip the padding byte in short blocks
        if (i != shortBlockLen - blockEccLen || j >= numShortBlocks)
          result.push(block[i]);
      });
    }
    _assert(result.length == rawCodewords);
    return result;
  }

  // Draws the given sequence of 8-bit codewords (data and error correction) onto the entire
  // data area of this QR Code. Function modules need to be marked off before this is called.
  private _drawCodewords(data: Readonly<Array<byte>>): void {
    if (data.length != floor(QrCode._getNumRawDataModules(this._version) / 8))
      throw new _RangeError("Invalid argument");
    let i: int = 0; // Bit index into the data
    // Do the funny zigzag scan
    for (let right = this._size - 1; right >= 1; right -= 2) {
      // Index of right column in each column pair
      if (right == 6) right = 5;
      for (let vert = 0; vert < this._size; vert++) {
        // Vertical counter
        for (let j = 0; j < 2; j++) {
          const x: int = right - j; // Actual x coordinate
          const upward: boolean = ((right + 1) & 2) == 0;
          const y: int = upward ? this._size - 1 - vert : vert; // Actual y coordinate
          if (!this._isFunction[y][x] && i < data.length * 8) {
            this._modules[y][x] = _getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
          // If this QR Code has any remainder bits (0 to 7), they were assigned as
          // 0/false/light by the constructor and are left unchanged by this method
        }
      }
    }
    _assert(i == data.length * 8);
  }

  // XORs the codeword modules in this QR Code with the given mask pattern.
  // The function modules must be marked and the codeword bits must be drawn
  // before masking. Due to the arithmetic of XOR, calling applyMask() with
  // the same mask value a second time will undo the mask. A final well-formed
  // QR Code needs exactly one (not zero, two, etc.) mask applied.
  private _applyMask(mask: int): void {
    if (mask < 0 || mask > 7) throw new _RangeError("Mask value out of range");
    for (let y = 0; y < this._size; y++) {
      for (let x = 0; x < this._size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 == 0;
            break;
          case 1:
            invert = y % 2 == 0;
            break;
          case 2:
            invert = x % 3 == 0;
            break;
          case 3:
            invert = (x + y) % 3 == 0;
            break;
          case 4:
            invert = (floor(x / 3) + floor(y / 2)) % 2 == 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) == 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 == 0;
            break;
          case 7:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 == 0;
            break;
          default:
            throw new Error("Unreachable");
        }
        if (!this._isFunction[y][x] && invert)
          this._modules[y][x] = !this._modules[y][x];
      }
    }
  }

  // Calculates and returns the penalty score based on state of this QR Code's current modules.
  // This is used by the automatic mask choice algorithm to find the mask pattern that yields the lowest score.
  private _getPenaltyScore(): int {
    let result: int = 0;

    // Adjacent modules in row having same color, and finder-like patterns
    for (let y = 0; y < this._size; y++) {
      let runColor = false;
      let runX = 0;
      let runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < this._size; x++) {
        if (this._modules[y][x] == runColor) {
          runX++;
          if (runX == 5) result += QrCode._PENALTY_N1;
          else if (runX > 5) result++;
        } else {
          this._finderPenaltyAddHistory(runX, runHistory);
          if (!runColor)
            result +=
              this._finderPenaltyCountPatterns(runHistory) * QrCode._PENALTY_N3;
          runColor = this._modules[y][x];
          runX = 1;
        }
      }
      result +=
        this._finderPenaltyTerminateAndCount(runColor, runX, runHistory) *
        QrCode._PENALTY_N3;
    }
    // Adjacent modules in column having same color, and finder-like patterns
    for (let x = 0; x < this._size; x++) {
      let runColor = false;
      let runY = 0;
      let runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < this._size; y++) {
        if (this._modules[y][x] == runColor) {
          runY++;
          if (runY == 5) result += QrCode._PENALTY_N1;
          else if (runY > 5) result++;
        } else {
          this._finderPenaltyAddHistory(runY, runHistory);
          if (!runColor)
            result +=
              this._finderPenaltyCountPatterns(runHistory) * QrCode._PENALTY_N3;
          runColor = this._modules[y][x];
          runY = 1;
        }
      }
      result +=
        this._finderPenaltyTerminateAndCount(runColor, runY, runHistory) *
        QrCode._PENALTY_N3;
    }

    // 2*2 blocks of modules having same color
    for (let y = 0; y < this._size - 1; y++) {
      for (let x = 0; x < this._size - 1; x++) {
        const color: boolean = this._modules[y][x];
        if (
          color == this._modules[y][x + 1] &&
          color == this._modules[y + 1][x] &&
          color == this._modules[y + 1][x + 1]
        )
          result += QrCode._PENALTY_N2;
      }
    }

    // Balance of dark and light modules
    let dark: int = 0;
    for (const row of this._modules)
      dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
    const total: int = this._size * this._size; // Note that size is odd, so dark/total != 1/2
    // Compute the smallest integer k >= 0 such that (45-5k)% <= dark/total <= (55+5k)%
    const k: int = Math.ceil(abs(dark * 20 - total * 10) / total) - 1;
    _assert(0 <= k && k <= 9);
    result += k * QrCode._PENALTY_N4;
    _assert(0 <= result && result <= 2568888); // Non-tight upper bound based on default values of PENALTY_N1, ..., N4
    return result;
  }

  /*-- Private helper functions --*/

  // Returns an ascending list of positions of alignment patterns for this version number.
  // Each position is in the range [0,177), and are used on both the x and y axes.
  // This could be implemented as lookup table of 40 variable-length lists of integers.
  private _getAlignmentPatternPositions(): Array<int> {
    if (this._version == 1) return [];
    else {
      const numAlign: int = floor(this._version / 7) + 2;
      const step: int =
        this._version == 32
          ? 26
          : Math.ceil((this._version * 4 + 4) / (numAlign * 2 - 2)) * 2;
      let result: Array<int> = [6];
      for (let pos = this._size - 7; result.length < numAlign; pos -= step)
        result.splice(1, 0, pos);
      return result;
    }
  }

  // Returns the number of data bits that can be stored in a QR Code of the given version number, after
  // all function modules are excluded. This includes remainder bits, so it might not be a multiple of 8.
  // The result is in the range [208, 29648]. This could be implemented as a 40-entry lookup table.
  private static _getNumRawDataModules(ver: int): int {
    if (ver < QrCode._MIN_VERSION || ver > QrCode._MAX_VERSION)
      throw new _RangeError("Version number out of range");
    let result: int = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign: int = floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    _assert(208 <= result && result <= 29648);
    return result;
  }

  // Returns the number of 8-bit data (i.e. not error correction) codewords contained in any
  // QR Code of the given version number and error correction level, with remainder bits discarded.
  // This stateless pure function could be implemented as a (40*4)-cell lookup table.
  private static _getNumDataCodewords(ver: int, ecl: Ecc): int {
    return (
      floor(QrCode._getNumRawDataModules(ver) / 8) -
      QrCode._ECC_CODEWORDS_PER_BLOCK[ecl._ordinal][ver] *
        QrCode._NUM_ERROR_CORRECTION_BLOCKS[ecl._ordinal][ver]
    );
  }

  // Returns a Reed-Solomon ECC generator polynomial for the given degree. This could be
  // implemented as a lookup table over all possible parameter values, instead of as an algorithm.
  private static _reedSolomonComputeDivisor(degree: int): Array<byte> {
    if (degree < 1 || degree > 255)
      throw new _RangeError("Degree out of range");
    // Polynomial coefficients are stored from highest to lowest power, excluding the leading term which is always 1.
    // For example the polynomial x^3 + 255x^2 + 8x + 93 is stored as the uint8 array [255, 8, 93].
    let result: Array<byte> = [];
    for (let i = 0; i < degree - 1; i++) result.push(0);
    result.push(1); // Start off with the monomial x^0

    // Compute the product polynomial (x - r^0) * (x - r^1) * (x - r^2) * ... * (x - r^{degree-1}),
    // and drop the highest monomial term which is always 1x^degree.
    // Note that r = 0x02, which is a generator element of this field GF(2^8/0x11D).
    let root = 1;
    for (let i = 0; i < degree; i++) {
      // Multiply the current product by (x - r^i)
      for (let j = 0; j < result.length; j++) {
        result[j] = QrCode._reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = QrCode._reedSolomonMultiply(root, 0x02);
    }
    return result;
  }

  // Returns the Reed-Solomon error correction codeword for the given data and divisor polynomials.
  private static _reedSolomonComputeRemainder(
    data: Readonly<Array<byte>>,
    divisor: Readonly<Array<byte>>
  ): Array<byte> {
    let result: Array<byte> = divisor.map((_) => 0);
    for (const b of data) {
      // Polynomial division
      const factor: byte = b ^ (result.shift() as byte);
      result.push(0);
      divisor.forEach(
        (coef, i) => (result[i] ^= QrCode._reedSolomonMultiply(coef, factor))
      );
    }
    return result;
  }

  // Returns the product of the two given field elements modulo GF(2^8/0x11D). The arguments and result
  // are unsigned 8-bit integers. This could be implemented as a lookup table of 256*256 entries of uint8.
  private static _reedSolomonMultiply(x: byte, y: byte): byte {
    if (x >>> 8 != 0 || y >>> 8 != 0)
      throw new _RangeError("Byte out of range");
    // Russian peasant multiplication
    let z: int = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    _assert(z >>> 8 == 0);
    return z as byte;
  }

  // Can only be called immediately after a light run is added, and
  // returns either 0, 1, or 2. A helper function for getPenaltyScore().
  private _finderPenaltyCountPatterns(runHistory: Readonly<Array<int>>): int {
    const n: int = runHistory[1];
    _assert(n <= this._size * 3);
    const core: boolean =
      n > 0 &&
      runHistory[2] == n &&
      runHistory[3] == n * 3 &&
      runHistory[4] == n &&
      runHistory[5] == n;
    return (
      (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
      (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
    );
  }

  // Must be called at the end of a line (row or column) of modules. A helper function for getPenaltyScore().
  private _finderPenaltyTerminateAndCount(
    currentRunColor: boolean,
    currentRunLength: int,
    runHistory: Array<int>
  ): int {
    if (currentRunColor) {
      // Terminate dark run
      this._finderPenaltyAddHistory(currentRunLength, runHistory);
      currentRunLength = 0;
    }
    currentRunLength += this._size; // Add light border to final run
    this._finderPenaltyAddHistory(currentRunLength, runHistory);
    return this._finderPenaltyCountPatterns(runHistory);
  }

  // Pushes the given value to the front and drops the last value. A helper function for getPenaltyScore().
  private _finderPenaltyAddHistory(
    currentRunLength: int,
    runHistory: Array<int>
  ): void {
    if (runHistory[0] == 0) currentRunLength += this._size; // Add light border to initial run
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  }

  /*-- Constants and tables --*/

  // The minimum version number supported in the QR Code Model 2 standard.
  private static readonly _MIN_VERSION: int = 1;
  // The maximum version number supported in the QR Code Model 2 standard.
  private static readonly _MAX_VERSION: int = 40;

  // For use in getPenaltyScore(), when evaluating which mask is best.
  private static readonly _PENALTY_N1: int = 3;
  private static readonly _PENALTY_N2: int = 3;
  private static readonly _PENALTY_N3: int = 40;
  private static readonly _PENALTY_N4: int = 10;

  private static readonly _ECC_CODEWORDS_PER_BLOCK: Array<Array<int>> = [
    // Version: (note that index 0 is for padding, and is set to an illegal value)
    //0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
    [
      -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30,
      28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
      30, 30, 30, 30,
    ], // Low
    [
      -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28,
      26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
      28, 28, 28, 28, 28,
    ], // Medium
    [
      -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28,
      28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30,
      30, 30, 30, 30, 30,
    ], // Quartile
    [
      -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28,
      28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
      30, 30, 30, 30, 30,
    ], // High
  ];

  private static readonly _NUM_ERROR_CORRECTION_BLOCKS: Array<Array<int>> = [
    // Version: (note that index 0 is for padding, and is set to an illegal value)
    //0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
    [
      -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9,
      10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
    ], // Low
    [
      -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17,
      17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47,
      49,
    ], // Medium
    [
      -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
      23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62,
      65, 68,
    ], // Quartile
    [
      -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
      25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74,
      77, 81,
    ], // High
  ];
}

// Appends the given number of low-order bits of the given value
// to the given buffer. Requires 0 <= len <= 31 and 0 <= val < 2^len.
function _appendBits(val: int, len: int, bb: Array<bit>): void {
  if (len < 0 || len > 31 || val >>> len != 0)
    throw new _RangeError("Value out of range");
  for (
    let i = len - 1;
    i >= 0;
    i-- // Append bit by bit
  )
    bb.push((val >>> i) & 1);
}

// Returns true iff the i'th bit of x is set to 1.
function _getBit(x: int, i: int): boolean {
  return ((x >>> i) & 1) != 0;
}

// Throws an exception if the given condition is false.
function _assert(cond: boolean): void {
  if (!cond) throw new Error("Assertion error");
}

/*---- Data segment class ----*/

/*
 * A segment of character/binary/control data in a QR Code symbol.
 * Instances of this class are immutable.
 * The mid-level way to create a segment is to take the payload data
 * and call a static factory function such as QrSegment.makeNumeric().
 * The low-level way to create a segment is to custom-make the bit buffer
 * and call the QrSegment() constructor with appropriate values.
 * This segment class imposes no length restrictions, but QR Codes have restrictions.
 * Even in the most favorable conditions, a QR Code can only hold 7089 characters of data.
 * Any segment longer than this is meaningless for the purpose of generating QR Codes.
 */
export class QrSegment {
  /*-- Static factory functions (mid level) --*/

  // Returns a segment representing the given binary data encoded in
  // byte mode. All input byte arrays are acceptable. Any text string
  // can be converted to UTF-8 bytes and encoded as a byte mode segment.
  private static _makeBytes(data: Readonly<Array<byte>>): QrSegment {
    let bb: Array<bit> = [];
    for (const b of data) _appendBits(b, 8, bb);
    return new QrSegment(Mode._BYTE, data.length, bb);
  }

  // Returns a segment representing the given string of decimal digits encoded in numeric mode.
  // public static makeNumeric(digits: string): QrSegment {
  //   if (!QrSegment.isNumeric(digits))
  //     throw new _RangeError("String contains non-numeric characters");
  //   let bb: Array<bit> = [];
  //   for (let i = 0; i < digits.length; ) {
  //     // Consume up to 3 digits per iteration
  //     const n: int = Math.min(digits.length - i, 3);
  //     appendBits(parseInt(digits.substring(i, i + n), 10), n * 3 + 1, bb);
  //     i += n;
  //   }
  //   return new QrSegment(Mode.NUMERIC, digits.length, bb);
  // }

  // Returns a segment representing the given text string encoded in alphanumeric mode.
  // The characters allowed are: 0 to 9, A to Z (uppercase only), space,
  // dollar, percent, asterisk, plus, hyphen, period, slash, colon.
  // public static makeAlphanumeric(text: string): QrSegment {
  //   if (!QrSegment.isAlphanumeric(text))
  //     throw new _RangeError(
  //       "String contains unencodable characters in alphanumeric mode"
  //     );
  //   let bb: Array<bit> = [];
  //   let i: int;
  //   for (i = 0; i + 2 <= text.length; i += 2) {
  //     // Process groups of 2
  //     let temp: int =
  //       QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45;
  //     temp += QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1));
  //     appendBits(temp, 11, bb);
  //   }
  //   if (i < text.length)
  //     // 1 character remaining
  //     appendBits(QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6, bb);
  //   return new QrSegment(Mode.ALPHANUMERIC, text.length, bb);
  // }

  // Returns a new mutable list of zero or more segments to represent the given Unicode text string.
  // The result may use various segment modes and switch modes to optimize the length of the bit stream.
  public static _makeSegments(text: string): Array<QrSegment> {
    // Select the most efficient segment encoding automatically
    if (text == "") return [];
    /*else if (QrSegment.isNumeric(text)) return [QrSegment.makeNumeric(text)];
    else if (QrSegment.isAlphanumeric(text))
      return [QrSegment.makeAlphanumeric(text)];
    else*/ return [QrSegment._makeBytes(QrSegment._toUtf8ByteArray(text))];
  }

  // Returns a segment representing an Extended Channel Interpretation
  // (ECI) designator with the given assignment value.
  // public static makeEci(assignVal: int): QrSegment {
  //   let bb: Array<bit> = [];
  //   if (assignVal < 0)
  //     throw new _RangeError("ECI assignment value out of range");
  //   else if (assignVal < 1 << 7) appendBits(assignVal, 8, bb);
  //   else if (assignVal < 1 << 14) {
  //     appendBits(0b10, 2, bb);
  //     appendBits(assignVal, 14, bb);
  //   } else if (assignVal < 1000000) {
  //     appendBits(0b110, 3, bb);
  //     appendBits(assignVal, 21, bb);
  //   } else throw new _RangeError("ECI assignment value out of range");
  //   return new QrSegment(Mode.ECI, 0, bb);
  // }

  // Tests whether the given string can be encoded as a segment in numeric mode.
  // A string is encodable iff each character is in the range 0 to 9.
  // private static isNumeric(text: string): boolean {
  //   return QrSegment.NUMERIC_REGEX.test(text);
  // }

  // Tests whether the given string can be encoded as a segment in alphanumeric mode.
  // A string is encodable iff each character is in the following set: 0 to 9, A to Z
  // (uppercase only), space, dollar, percent, asterisk, plus, hyphen, period, slash, colon.
  // private static isAlphanumeric(text: string): boolean {
  //   return QrSegment.ALPHANUMERIC_REGEX.test(text);
  // }

  /*-- Constructor (low level) and fields --*/

  // Creates a new QR Code segment with the given attributes and data.
  // The character count (numChars) must agree with the mode and the bit buffer length,
  // but the constraint isn't checked. The given bit buffer is cloned and stored.
  private constructor(
    // The mode indicator of this segment.
    public readonly _mode: Mode,

    // The length of this segment's unencoded data. Measured in characters for
    // numeric/alphanumeric/kanji mode, bytes for byte mode, and 0 for ECI mode.
    // Always zero or positive. Not the same as the data's bit length.
    public readonly _numChars: int,

    // The data bits of this segment. Accessed through getData().
    private readonly _bitData: Array<bit>
  ) {
    if (_numChars < 0) throw new _RangeError("Invalid argument");
    this._bitData = _bitData.slice(); // Make defensive copy
  }

  /*-- Methods --*/

  // Returns a new copy of the data bits of this segment.
  public _getData(): Array<bit> {
    return this._bitData.slice(); // Make defensive copy
  }

  // (Package-private) Calculates and returns the number of bits needed to encode the given segments at
  // the given version. The result is infinity if a segment has too many characters to fit its length field.
  public static _getTotalBits(
    segs: Readonly<Array<QrSegment>>,
    version: int
  ): number {
    let result: number = 0;
    for (const seg of segs) {
      const ccbits: int = seg._mode._numCharCountBits(version);
      if (seg._numChars >= 1 << ccbits) return Infinity; // The segment's length doesn't fit the field's bit width
      result += 4 + ccbits + seg._bitData.length;
    }
    return result;
  }

  // Returns a new array of bytes representing the given string encoded in UTF-8.
  private static _toUtf8ByteArray(str: string): Array<byte> {
    str = encodeURI(str);
    let result: Array<byte> = [];
    for (let i = 0; i < str.length; i++) {
      if (str.charAt(i) != "%") result.push(str.charCodeAt(i));
      else {
        result.push(parseInt(str.substring(i + 1, i + 3), 16));
        i += 2;
      }
    }
    return result;
  }

  /*-- Constants --*/

  // Describes precisely all strings that are encodable in numeric mode.
  // private static readonly NUMERIC_REGEX: RegExp = /^[0-9]*$/;

  // Describes precisely all strings that are encodable in alphanumeric mode.
  // private static readonly ALPHANUMERIC_REGEX: RegExp = /^[A-Z0-9 $%*+.\/:-]*$/;

  // The set of all legal characters in alphanumeric mode,
  // where each character value maps to the index in the string.
  // private static readonly ALPHANUMERIC_CHARSET: string =
  //   "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
}

/*---- Public helper enumeration ----*/

/*
 * The error correction level in a QR Code symbol. Immutable.
 */
export class Ecc {
  /*-- Constants --*/

  public static readonly _LOW = new Ecc(0, 1); // The QR Code can tolerate about  7% erroneous codewords
  public static readonly _MEDIUM = new Ecc(1, 0); // The QR Code can tolerate about 15% erroneous codewords
  public static readonly _QUARTILE = new Ecc(2, 3); // The QR Code can tolerate about 25% erroneous codewords
  public static readonly _HIGH = new Ecc(3, 2); // The QR Code can tolerate about 30% erroneous codewords

  /*-- Constructor and fields --*/

  private constructor(
    // In the range 0 to 3 (unsigned 2-bit integer).
    public readonly _ordinal: int,
    // (Package-private) In the range 0 to 3 (unsigned 2-bit integer).
    public readonly _formatBits: int
  ) {}
}

/*---- Public helper enumeration ----*/

/*
 * Describes how a segment's data bits are interpreted. Immutable.
 */
export class Mode {
  /*-- Constants --*/

  // public static readonly NUMERIC = new Mode(0x1, [10, 12, 14]);
  // public static readonly ALPHANUMERIC = new Mode(0x2, [9, 11, 13]);
  public static readonly _BYTE = new Mode(0x4, [8, 16, 16]);
  // public static readonly KANJI = new Mode(0x8, [8, 10, 12]);
  // public static readonly ECI = new Mode(0x7, [0, 0, 0]);

  /*-- Constructor and fields --*/

  private constructor(
    // The mode indicator bits, which is a uint4 value (range 0 to 15).
    public readonly _modeBits: int,
    // Number of character count bits for three different version ranges.
    private readonly _numBitsCharCount: [int, int, int]
  ) {}

  /*-- Method --*/

  // (Package-private) Returns the bit width of the character count field for a segment in
  // this mode in a QR Code at the given version number. The result is in the range [0, 16].
  public _numCharCountBits(ver: int): int {
    return this._numBitsCharCount[floor((ver + 7) / 17)];
  }
}
