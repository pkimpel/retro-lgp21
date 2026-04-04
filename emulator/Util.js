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
export const physicalTracks = 32;               // physical number of tracks on the disk
export const physicalTrackSize = 128;           // words in a physical track
export const logicalTracks = 64;                // logical (LGP-30) number of tracks on the disk
export const logicalTrackSize = 64;             // words in a logical (LGP-30) track
export const minTimeout = 4;                    // browsers will do setTimeout for at least 4ms

export const wordMask = 0xFFFFFFFE;             // 31 bits + spacer bit
export const absWordMask = 0xEFFFFFFE;          // all but the sign bit
export const wordSignMask = 0x80000000;         // sign bit mask
export const orderMask = 0x000F0000;            // instruction order bits (4)
export const orderShift = 16;                   // bits to shift order field right
export const trackMask = 0x00003E00;            // address track bits (5)
export const trackShift = 9;                    // bits to shift track field right
export const sectorMask = 0x000001FC;           // address sector bits (7)
export const sectorShift = 2;                   // bits to shift address field right
export const addressMask = 0x00003FFC;          // instructin address bits (12)
export const addressIncrement = 1 << sectorShift; // value to increment address fields

export const defaultRPM = 1125;                 // default disk revolution speed, rev/min
export const maxRPM = defaultRPM*100;           // maximum disk revolution speed, rev/min
export let nonStandardRPM = false;              // true if RPM has been changed from default
export let diskRPM = defaultRPM;                // disk revolution speed, rev/minute

// The following are constants once the disk RPM is determined.
export let wordTime = 0;                        // one word time on the disk [128 words/rev], ms
export let bitTime = 0;                         // one bit time on the disk, ms
export let diskCycleTime = 0;                   // one disk cycle (128 words), ms
export let timingFactor = 1;                    // global emulator speed factor

const hexRex = /[fgjkqwFGJKQW]/g;               // standard hex characters
const lgp21HexXlate = {                         // the weird undigit glyphs come from the paper-tape code
        "a": "f", "A": "f",
        "b": "g", "B": "g",
        "c": "j", "C": "j",
        "d": "k", "D": "k",
        "e": "q", "E": "q",
        "f": "w", "F": "w"};


/**************************************/
export function lgp21Hex(v) {
    /* Converts the value "v" to a hexidecimal string using the LGP-21
    convention. This is not a particularly efficient way to do this */

    return v.toString(16).replace(hexRex, (c) => {
        return lgp21HexXlate[c] ?? "?";
    }).padStart(7, "0");
}

/**************************************/
export function lgp21SignedHex(v) {
    /* Formats the value of "v" as signed LGP-21 hex */

    return lgp21Hex(v >> 1) + (v & wordSignMask ? "-" : " ");
}

/**************************************/
export function setTiming(newRPM=defaultRPM) {
    /* Computes the disk timing factors from the specified diskRPM (default=1800) */

    if (newRPM >= 0 && newRPM <= maxRPM) {
        diskRPM = newRPM;                       // disk revolution speed, rev/minute
        timingFactor = diskRPM/defaultRPM;      // emulator speed factor
        wordTime = 60000/diskRPM/physicalTrackSize; // one word time on the disk, ms
        bitTime = wordTime/wordBits;            // one bit time on the disk, ms
        diskCycleTime = wordTime*physicalTrackSize; // one disk cycle (108 words), ms
    }
}

/**************************************/
export function enableNonStandardTiming(newRPM) {
    /* Enables non-standrd emulator timing (called by G15.js initialization */

    nonStandardRPM = true;
    setTiming(newRPM);
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

/***********************************************************************
*  Global Initialization Code                                          *
***********************************************************************/

setTiming(defaultRPM);
