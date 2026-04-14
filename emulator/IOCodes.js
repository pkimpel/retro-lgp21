/***********************************************************************
* retro-lgp21/emulator IOCodes.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Input/Output subsystem constants for the LGP-21 emulator.
************************************************************************
* 2026-04-08  P.Kimpel
*   Original version.
***********************************************************************/

// Peripheral tape codes.         612345
export const ioTapeFeed =       0b000000;
export const ioLowerCase =      0b000010;
export const ioUpperCase =      0b000100;
export const ioColorShift =     0b000110;
export const ioCarriageReturn = 0b001000;
export const ioBackspace =      0b001010;
export const ioTab =            0b001100;
export const ioCondStop =       0b010000;
export const ioSpace =          0b100001;

// Internal control codes.        123456
export const icTapeFeed =       0b000000;
export const icLowerCase =      0b000100;
export const icUpperCase =      0b010000;
export const icColorShift =     0b001100;
export const icCarriageReturn = 0b010000;
export const icBackspace =      0b010100;
export const icTab =            0b011000;
export const icCondStop =       0b100000;
export const icSpace =          0b000011;

// Special glyphs.
export const greekDelta =       "\u0394";       // Greek Delta (Δ)  keyed as "&"
export const greekPi =          "\u03C0";       // Greek Pi    (π)  keyed as "#"
export const greekSigma =       "\u03A3";       // Greek Sigma (Σ)  keyed as "{"

// Translate ASCII tape-image characters to LGP-21 tape code values (0xFF => invalid).
export const ioASCIIToTapeCode = [
        // 0    1    2    3    4    5    6    7    8    9    A    B    C    D    E    F
        0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,  // 00-0F
        0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,  // 10-1F
        0x21,0x0A,0x0E,0xFF,0x12,0x14,0x16,0x10,0x18,0x1A,0x1C,0x25,0x2D,0x23,0x2B,0x29,  // 20-2F
        0x01,0x03,0x05,0x07,0x09,0x0B,0x0D,0x0F,0x11,0x13,0x1E,0x27,0x08,0x35,0x37,0x39,  // 30-3F
        0x3B,0x3C,0x22,0x3A,0x2A,0x32,0x15,0x17,0x38,0x28,0x19,0x1B,0xFF,0x2E,0x2C,0x31,  // 40-4F
        0x30,0x1D,0x26,0x3E,0x36,0x34,0x2F,0x1F,0x33,0x24,0x20,0xFF,0xFF,0xFF,0x06,0x00,  // 50-5F
        0x3D,0x3C,0x22,0x3A,0x2A,0x32,0x15,0x17,0x38,0x28,0x19,0x1B,0xFF,0x2E,0x2C,0x31,  // 60-6F
        0x30,0x1D,0x26,0x3E,0x36,0x34,0x2F,0x1F,0x33,0x24,0x20,0x04,0x0C,0x02,0x3F,0xFF]; // 70-7F

// Translate I/O tape code values to ASCII.
export const ioTapeCodeToASCII =
        "_0}1{2^3<4!5|6\"7'8$9%F&G(J)K*Q:WZ B-Y+R;I/D.N,MVPOEXU=T>H?C@A`S~";
