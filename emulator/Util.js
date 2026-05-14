/***********************************************************************
* retro-lgp21/emulator Util.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General constants and utilities for the LGP-21 emulator.
************************************************************************
* 2026-03-21  P.Kimpel
*   Original version.
***********************************************************************/

export const wordBits = 32;                     // bits per LGP-21 word
export const wordMagBits = 30;                  // magnitude bits in a LGP-21 word
export const wordBytes = 4;                     // bytes per LGP-21 word (32 bits holding 32 bits)
export const minTimeout = 4;                    // browsers will do setTimeout for at least 4ms

export const fullWordMask = 0xFFFFFFFF;         // 32 bits including spacer bit
export const wordMask = 0xFFFFFFFE;             // 31 bits with zero spacer bit
export const absWordMask = 0xEFFFFFFE;          // all 31 bits but the sign bit
export const wordSignMask = 0x80000000;         // sign bit mask
export const orderMask = 0x000F0000;            // instruction order bits (4)
export const orderShift = 16;                   // bits to shift order field right
export const trackMask = 0x00003E00;            // address track bits (5)
export const trackShift = 9;                    // bits to shift track field right
export const sectorMask = 0x000001FC;           // address sector bits (7)
export const sectorShift = 2;                   // bits to shift address field right
export const addressMask = 0x00003FFC;          // instruction address bits (12)

export const lgp21OpMnem = "ZBYRIDNMPEUTHCAS";  // LGP-21 opcode mnemonics

const hexRex = /[abcdefABCDEF]/g;               // standard hex characters
const lgp21HexXlate = {                         // the weird undigit glyphs come from the paper-tape code
        "a": "f", "A": "f",
        "b": "g", "B": "g",
        "c": "j", "C": "j",
        "d": "k", "D": "k",
        "e": "q", "E": "q",
        "f": "w", "F": "w"};


/**************************************/
export function lgp21Hex(v) {
    /* Converts the value "v" to an unsigned 32-bit hexidecimal string using
    the LGP-21 hex convention. This is not a particularly efficient way to
    do this */

    return (v >>> 0).toString(16).replace(hexRex, (c) => {
        return lgp21HexXlate[c] ?? "?";
    }).padStart(8, "0");
}

/**************************************/
export function lgp21SignedHex(v) {
    /* Formats the value "v" as a signed 32-bit LGP-21 hex */

    return ((v|0) < 0 ? "-" : " ") + Math.abs(v|0).toString(16).replace(hexRex, (c) => {
        return lgp21HexXlate[c] ?? "?";
    }).padStart(8, "0");
}

/**************************************/
export function lgp21Signed(v) {
    /* Formats the value "v" as a signed 2s-complement decimal integer */

    return (v|0).toString();
}

/**************************************/
export function lgp21DecAddress(v) {
    /* Formats the value "v" as decimal track/sector using the format TTSS, but
    using the LGP-30 address format where TT and SS are both six bit decimal
    numbers */
    const addr = Math.abs(v);

    return ((addr >> 6) & 0x3F).toString().padStart(2, "0") +
           (addr & 0x3F).toString().padStart(2, "0");
}

/**************************************/
export function lgp21FormatOp(word) {
    /* Formats "word" as a mnemonic LGP-21 instruction "Z TTSS" */
    const bits = word >>> 0;            // retain 2s-complement form

    return ((bits & wordSignMask) ? "-" : " ") +
           lgp21OpMnem[(bits & orderMask) >>> orderShift] + " " +
           lgp21DecAddress((bits & addressMask) >>> sectorShift);
}


/***********************************************************************
*  Timer Class                                                         *
***********************************************************************/

export class Timer {

    constructor() {
        /* Constructor for a Timer object that wraps setTimeout() */

        this.rejector = null;
        this.timerHandle = 0;
        this.value = null;
    }

    set(delay, value) {
        /* Initiates the timer for "delay" milliseconds and returns a Promise that
        will resolve when the timer expires. The "value" parameter is optional and
        will become the value returned by the Promise */

        if (delay <= minTimeout) {
            return Promise.resolve(value);
        } else {
            return new Promise((resolve, reject) => {
                this.value = value;
                this.rejector = reject;
                this.timerHandle = setTimeout(() => {
                    resolve(this.value);
                    this.rejector = null;
                    this.value = null;
                    this.timerHandle = 0;
                }, delay);
            });
        }
    }

    delayUntil(then, value) {
        /* Initiates the timer for a delay until performance.now() reaches "then".
        "value" is the same as for set(). Returns a Promise that resolves when
        the time is reached */

        return this.set(then - performance.now(), value);
    }

    clear() {
        /* Clears the timer if it is set */

        if (this.timerHandle !== 0) {
            clearTimeout(this.timerHandle);
            this.rejector = null;
            this.value = null;
            this.timerHandle = 0;
        }
    }

    reject() {
        /* Clears the timer if it is set and rejects the Promise */

        if (this.timerHandle !== 0) {
            this.rejector();
            this.clear();
        }
    }
}
