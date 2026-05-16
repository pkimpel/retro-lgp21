/***********************************************************************
* retro-lgp21/emulator Processor.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for the General Precision LGP-21 processor.
*
* Register, flip-flop, and signal names are taken mostly from the LGP-21
* "Maintenance and Training Manual" (MTM):
*   https://bitsavers.org/pdf/generalPrecision/LGP-21/
*           ESD1060_LGP-21_Maintenance_and_Training_Manual.pdf.
* Also see the "LGP-21 Programming Manual":
*   https://bitsavers.org/pdf/generalPrecision/LGP-21/
*           LGP-21_Programming_Manual_1963.pdf.
************************************************************************
* 2026-03-28  P.Kimpel
*   Original version.
***********************************************************************/

export {Processor}

import * as Util from "./Util.js";
import * as IOCodes from "./IOCodes.js";

import {Disk} from "./Disk.js";
import {FlipFlop} from "./FlipFlop.js";
import {Register} from "./Register.js";
import {WaitSignal} from "./WaitSignal.js";


class RegisterQ extends Register {
    get Q1() {return this.getBit(3)}
    set Q1(v) {return this.setBit(3, v)}
    get Q2() {return this.getBit(2)}
    set Q2(v) {return this.setBit(2, v)}
    get Q3() {return this.getBit(1)}
    set Q3(v) {return this.setBit(1, v)}
    get Q4() {return this.getBit(0)}
    set Q4(v) {return this.setBit(0, v)}
} // class RegisterQ

class RegisterP extends Register {
    get P1() {return this.getBit(5)}
    set P1(v) {return this.setBit(5, v)}
    get P2() {return this.getBit(4)}
    set P2(v) {return this.setBit(4, v)}
    get P3() {return this.getBit(3)}
    set P3(v) {return this.setBit(3, v)}
    get P4() {return this.getBit(2)}
    set P4(v) {return this.setBit(2, v)}
    get P5() {return this.getBit(1)}
    set P5(v) {return this.setBit(1, v)}
    get P6() {return this.getBit(0)}
    set P6(v) {return this.setBit(0, v)}
} // class RegisterP


class Processor {

    static debugging = false;
    static statsAlpha = 0.001;            // statistics averaging decay factor
    static statsAlpha1 = 1-Processor.statsAlpha;

    // MODE switch values.
    static modeOneOperation = 0;
    static modeManInput = 1;
    static modeNormal = 2;

    // I/O Device codes.
    static devFlexowriter = 2;
    static devTallyReader = 0;
    static devTallyPunch = 6;

    // Instruction order codes.
    static opSenseHalt = 0;
    static opBring = 1;
    static opStoreAddress = 2;
    static opStoreReturn = 3;
    static opInput = 4;                 // also Shift
    static opDivide = 5;
    static opMultiplyLow = 6;           // yields low-order product bits
    static opMultiply = 7;              // yields high-order product bits
    static opPrint = 8;
    static opExtract = 9;
    static opTransfer = 10;
    static opTest = 11;
    static opStoreHold = 12;
    static opStoreClear = 13;
    static opAdd = 14;
    static opSubtract = 15;


    constructor(context) {
        /* Constructor for the LGP-21 processor object. The "context" object
        supplies UI and I/O objects from the emulator global environment */

        this.disk = new Disk();                         // the memory disk
        this.context = context;

        // Flip-flops
        this.F  = new FlipFlop(this.disk, false);       // instruction phase flip-flops
        this.G  = new FlipFlop(this.disk, false);       //     "
        this.H  = new FlipFlop(this.disk, false);       //     "
        this.K  = new FlipFlop(this.disk, false);       // miscellaneous control
        this.X  = new FlipFlop(this.disk, false);       // 1 => I/O completed

        // Registers (some registers are implemented in the Disk object)
        this.A  = this.disk.regA;                       // accumulator register
        this.C  = this.disk.regC;                       // instruction counter register
        this.R  = this.disk.regR;                       // current instruction word
        this.AStarLow = this.disk.regAStarLow;          // double-precision register lower half
        this.AStarHigh = this.disk.regAStarHigh;        // double-precision register upper half

        this.P = new RegisterP(6, this.disk, false);    // track Nr, I/O codes
        this.Q = new RegisterQ(4, this.disk, false);    // op code, misc flags

        // General emulator state
        this.blocked = true;                            // true if emulation halted
        this.dataWord = 0;                              // last-fetched instruction operand word
        this.instructionCount = 0                       // number of instructions executed
        this.lastOpDiskTime = 0;                        // emulated time prior op ended, WT (tracing)
        this.lastOpEnded = true;                        // used to detect end-of-op (tracing)
        this.lastPhase = 0;                             // last phase executed before being blocked
        this.opAddr = 0;                                // address of last-fetched instruction (tracing)
        this.opWord = 0;                                // last-fetched instruction
        this.order = 0;                                 // current instruction op code
        this.overflowed = 0;                            // 1 if last addition overflowed
        this.poweredOn = false;                         // powered up and ready to run
        this.stopRequested = false;                     // blocked state pending
        this.tracing = false;                           // trace command debugging

        // Timing and throttline statistics
        this.avgBusy = 0;                               // fraction of time emulation uses the host CPU
        this.avgThrottleDelay = Disk.minThrottleDelay;  // average throttling delay, ms
        this.avgThrottleDelta = 0;                      // average throttling delay deviation, ms
        this.stepTimer = new Util.Timer();              // timer used for throttling performance
        this.throttleStart = 0;                         // start timestamp for a throttling pause

        // UI state from Control Panel
        this.bs4Switch = 0;                             // BS-4 switch
        this.bs8Switch = 0;                             // BS-8 switch
        this.bs16Switch = 0;                            // BS-16 switch
        this.bs32Switch = 0;                            // BS-32 switch
        this.modeSwitch = -1; // force change           // 0=one-oper, 1=man-input, 2=normal
        this.tcSwitch = 0;                              // used by order 11, T: Conditional Transfer

        // I/O Subsystem
        this.activeIODevice = null;                     // current I/O device object (not null => Faf)
        this.waitingIODevice = false;                   // current I/O is waiting for the device
        this.readyForInput = new WaitSignal();          // signals Processor is ready for an input code
    }


    /*******************************************************************
    *  Utility Methods                                                 *
    *******************************************************************/

    /**************************************/
    traceHeading() {
        /* Prints a column heading for trace output */

        console.log("Phase  Desc   WordTime  \u0394 WT  Sector Addr  TTSS  R reg    Mnemonic  Accumulator/Operand  Indicators");
    }

    /**************************************/
    tracePrefix(phase, caption) {
        /* Generates and returns a standard prefix for trace output */
        const d = this.disk;

        return `<P${phase}> ${caption.substring(0, 8).padEnd(8)} ` +
                (d.diskTime%100000000).toString().padStart(8) +
                `${Math.min(d.diskTime-this.lastOpDiskTime, 9999).toString().padStart(5)}\u0394 ` +     // 0394=Delta
                `${d.track.value.toString().padStart(3)}:${d.L.value.toString().padStart(3)}`;
    }

    /**************************************/
    traceInstruction(phase, caption) {
        /* Log current processor state to the console using a PIR-like format */

        console.log(`${this.tracePrefix(phase, caption)}(${this.opAddr.toString().padStart(4)}) ` +
                `${Util.lgp21DecAddress(this.opAddr)}: ` +
                `${Util.lgp21Hex(this.opWord)} ${Util.lgp21FormatOp(this.opWord)}` +
                `  ${(this.A.value >> 1).toString().padStart(11)} ${Util.lgp21Hex(this.A.value)}  ` +
                `OF${this.C.getOverflow() ? "+":"-"} ` +
                `Q1${this.Q.Q1 ? "+":"-"} Q2${this.Q.Q2 ? "+":"-"}`);
    }

    /**************************************/
    traceOperand(phase, caption, addr, word) {
        /* Traces the fetching of operand values */

        console.log(`${this.tracePrefix(phase, caption)}(${addr.toString().padStart(4)}) ` +
                `${Util.lgp21DecAddress(addr)}: ` +
                `${(word >> 1).toString().padStart(29)} ${Util.lgp21Hex(word)}`);
    }

    /**************************************/
    warning(msg) {
        /* Posts a warning for non-standard command usage */

        console.info("<WARNING> @%s    L=%s %s : %s",
                Util.formatDiskLoc(this.cmdLine, this.cmdLoc.value, false),
                Util.lineHex[this.disk.L.value],
                Util.disassembleCommand(this.cmdWord), msg);
    }

    /**************************************/
    updateLampGlow(beta) {
        /* Updates the lamp glow for all registers and flip-flops in the
        system. Beta is a bias in the range (0,1). For normal update use 0;
        to freeze the current state in the lamps use 1 */
        let gamma = (this.blocked ? 1 : beta || 0);

        // Processor Flip-flops
        this.F.updateLampGlow(gamma);
        this.G.updateLampGlow(gamma);
        this.H.updateLampGlow(gamma);
        this.K.updateLampGlow(gamma);
        this.X.updateLampGlow(gamma);

        // Processor Registers
        this.C.updateLampGlow(gamma);
        this.R.updateLampGlow(gamma);
        this.A.updateLampGlow(gamma);
        this.AStarLow.updateLampGlow(gamma);
        this.AStarHigh.updateLampGlow(gamma);
        this.P.updateLampGlow(gamma);
        this.Q.updateLampGlow(gamma);

        // Disk Registers
        this.disk.L.updateLampGlow(gamma);
        this.disk.track.updateLampGlow(gamma);
    }


    /*******************************************************************
    *  Execute Phase                                                   *
    *******************************************************************/

    /**************************************/
    addWord(augend, addend) {
        /* Adds two LGP-21 2s-complement words ignoring the spacer bit,
        returning the sum in LGP-21 format with the spacer bit zero.
        Overflow is determined by checking if the augend and addend
        signs are the same, and if so, whether the sum sign differs from
        augend sign. If so, this.overflowed will be 1, zero otherwise. */

        // First, shift the two operands right one bit with zero fill to
        // eliminate the spacer bit and avoid JavaScript bitwise conversion
        // between twos-complement and Number (IEEE 754) representations.
        const a = augend;
        const b = addend;
        let sum = a + b;
        if (((augend ^ addend) & Util.wordSignMask)) {
            // Signs are different -- no overflow is possible.
            this.overflowed = 0;
        } else {
            // Signs are the same -- sum sign != augend sign => overflow.
            this.overflowed = (a ^ sum) >>> (Util.wordBits-1);
        }

        return sum;
    }

    /**************************************/
    subtractWord(minuend, subtrahend) {
        /* Subtracts two words in LGP-21 format, returning the difference.
        Reverses the sign of subtrahend and then calls addWord() to generate
        the difference and overflow check. More bit fiddling to avoid twos-
        complement vs Number issues */
        const negated = Util.wordSignMask - (subtrahend >>> 1);

        return this.addWord(minuend, negated << 1);
    }

    /**************************************/
    selectIODevice(deviceCode) {
        /* Sets the I/O device from the track bits in R. If the device code is
        not valid, sets the device to null, which is needed by INPUT=4 to perform
        just a 4/6-bit left shift. This routine is normally called from Phase 3,
        using the track number from the instruction in the upper 5 bits of P */

        // *** NOTE: The Tally reader and punch are temporarily redirected to the Flexowriter.

        switch (deviceCode & 0b111110) {
        case Processor.devTallyReader:  // Tally 141 tape reader
            // no-break;                        // not implemented yet...
        case Processor.devTallyPunch:   // Tally 151 tape punch
            // no-break;                        // not implemented yet...
        case Processor.devFlexowriter:  // Flexowriter 121 typewriter/reader/punch
            this.activeIODevice = this.context.devices.flexowriter;
            break;
        default:        // invalid device
            this.activeIODevice = null;
            break;
        }
    }

    /**************************************/
    terminateIO() {
        /* Terminates any currently-active I/O operation */

        if (this.activeIODevice) {
            this.activeIODevice = null;         // allow Phase 1 to proceed to next instruction
            this.X.value = 1;                   // signal end-of-IO
            this.waitingIODevice = false;
            if (this.readyForInput.waiting) {
                this.readyForInput.proceed(-3); // indicate I/O has terminated
            }
        }
    }

    /**************************************/
    async receiveInputCode(code) {
        /* Receives the next I/O code from an input device and loads it into
        the P register. There is special handling for mode ManInput:
          - For normal input, if the code is a COND STOP or negative code
            (indicating device has stopped), terminates the I/O by setting the
            activeIODevice to null; if the code is one that does not enter the
            A register, ignores it; otherwise resets waitingIODevice to allow
            Phase 1 to finish and Phase 4 to shift the (rotated) code into the
            A register.
          - For Manual Input, the same filtering of input codes takes place,
            but there is no I/O operation to terminate, and the first 4 bits
            of P are unconditionally shifted left into the A register.
        If no I/O is in progress, returns -1; if an error occurs while waiting
        to be for input, returns that error code; otherwise returns 0 */
        let result = 0;

        // If we're not currently doing I/O, or the I/O has finished, reject the code.
        if (this.activeIODevice === null || this.X.value) {
            result = -1;
        } else {
            if (!this.waitingIODevice) {        // let's not get ahead of our skis...
                result = await this.readyForInput.wait();
            }

            if (result) {
                // Just pass the error back to caller.
            } else if (code == IOCodes.ioCondStop || code < 0) { // read stopped
                if (this.modeSwitch == Processor.modeManInput) {
                    this.activeIODevice.enableSend(false); // reassert Flexowriter send mode
                } else {
                    this.terminateIO();
                }
            } else if (code == IOCodes.ioTapeFeed || code == IOCodes.ioDelete) {
                // Ignore Tape Feed and Delete (rubout) codes
            } else if ((code & 0b100001) == 0 && this.K.value) {
                // Ignore 0xxxx0 codes in 4-bit mode.
            } else {
               // Load P by rotating the tape code to internal format, then signal I/O ready.
               this.P.value = ((code & 0b011111) << 1) | ((code & 0b100000 >>> 5));
               if (this.modeSwitch == Processor.modeManInput) {
                   this.A.value = ((this.A.value << 4) & Util.fullWordMask) | (this.P.value >> 2);
               } else {
                   this.waitingIODevice = false;        // input is ready for shifting in P4
               }
            }
        }

        return result;
    }

    /**************************************/
    senseHalt() {
        /* Executes the Z instruction, conditionally halting the processor, or
        clearing overflow and skipping the next instruction, or sensing the
        breakpoint switches and skipping the next instruction, or a combination
        of those actions. If both halt and skip conditions are met, halt occurs
        first. Note that this test takes place at the end of Phase 4 (T3)
        Assumes that Q1 is reset upon entry. Sets Q1 to command a skip */
        const track = this.P.value & 0b111110;

        if (this.R.value & Util.wordSignMask) { // negative instruction
            if (this.C.getOverflow()) {
                this.C.setOverflow(0);          // reset overflow, don't skip
            } else {
                this.Q.Q1 = 1;                  // set skip indicator
            }
        }

        switch (track) {
        case 0:
        case 1:
            this.stop();                        // redundant: also handled in P4
            break;
        case 2:
        case 3:
            // Treated as a no-op.
            break;
        default:
            const offSwitchMask = (this.bs4Switch  ? 0 : 0x04) +
                                  (this.bs8Switch  ? 0 : 0x08) +
                                  (this.bs16Switch ? 0 : 0x10) +
                                  (this.bs32Switch ? 0 : 0x20);
            if (track & offSwitchMask) {        // if any masked switches are off
                this.Q.Q1 = 1;                  // set skip indicator
            }
        }
    }

    /**************************************/
    multiplyStep(forN) {
        /* Multiplies A by the operand word, generating a 62-bit result.
        If "forN" is true, returns in A the 32 low-order bits of the result,
        otherwise the 30 high-order bits. THIS IS A TEMPORARY SHIM UNTIL A
        CORRECT ALGORITHM IS IMPLEMENTED */
        let nextPhase = 4;              // continue in phase 4 until dummy timing completes

        if (this.H.value) {
            if (this.P.value < 63) {
                this.P.inc();           // increment the dummy cycle counter
            } else {
                const two32 =         0x100000000n;
                const two64 = 0x10000000000000000n;
                let multiplicand = this.A.value | 0;    // make sure these are in IEEE format
                let multiplier = this.dataWord | 0;
                let pSign = 0;

                if (multiplicand < 0) {
                    pSign ^= 1;
                    multiplicand = -multiplicand;
                }

                if (multiplier < 0) {
                    pSign ^= 1;
                    multiplier = -multiplier;
                }

                let p = BigInt(multiplicand) * BigInt(multiplier);
                if (pSign) {
                    p = two64 - p;
                }

                if (forN) {
                    this.A.value = Number(p % two32) >>> 0;
                } else {
                    this.A.value = (Number(p/two32) << 1) >>> 0;
                }

                nextPhase = 1;
                this.H.value = 0;
                if (this.modeSwitch != Processor.modeNormal) {
                    this.stop();
                }
            }
        } else {
            const dataAddr = (this.opWord & Util.addressMask) >>> Util.sectorShift; // for tracing
            this.dataWord = this.disk.read();
            if (this.tracing) {
                this.traceOperand(4, "Operand", dataAddr, this.dataWord);
            }

            this.R.value = this.dataWord;
            this.H.value = 1;           // set H to enable dummy timing cycles
            this.P.value = 0;           // use P to count the dummy cycles
        }

        return nextPhase;
    }

    /**************************************/
    divideStep() {
        /* Divides A by the operand word, generating a 62-bit result, returning
        the high-order bits of the result in A. THIS IS A TEMPORARY SHIM UNTIL
        A CORRECT ALGORITHM IS IMPLEMENTED */
        let nextPhase = 4;              // continue in phase 4 until dummy timing completes

        if (this.H.value) {
            if (this.P.value < 63) {
                this.P.inc();           // increment the dummy cycle counter
            } else {
                const two32 =         0x100000000n;
                const two64 = 0x10000000000000000n;
                const dividend = this.A.value | 0;      // make sure these are in IEEE format
                const divisor = this.dataWord | 0;
                let qSign = 0;

                if (dividend < 0) {
                    qSign ^= 1;
                    dividend = -dividend;
                }

                if (divisor < 0) {
                    qSign ^= 1;
                    divisor = -divisor;
                }

                if (divisor < dividend) {       // also detects divide by zero
                    this.C.setOverflow(1);      // just leave the dividend in A
                } else {
                    let q = BigInt(dividend)*two32 / BigInt(divisor) /2n;
                    if (qSign) {
                        q = two32 - q;
                    }

                    this.A.value = Number(q) >>> 0;
                }

                nextPhase = 1;
                this.H.value = 0;
                if (this.modeSwitch != Processor.modeNormal) {
                    this.stop();
                }
            }
        } else {
            const dataAddr = (this.opWord & Util.addressMask) >>> Util.sectorShift; // for tracing
            this.dataWord = this.disk.read();
            if (this.tracing) {
                this.traceOperand(4, "Operand", dataAddr, this.dataWord);
            }

            this.H.value = 1;           // set H to enable dummy timing cycles
            this.P.value = 0;           // use P to count the dummy cycles
        }

        return nextPhase;
    }


    /*******************************************************************
    *  Processor Phase & Execution Management                          *
    *******************************************************************/

    /**************************************/
    phase1() {
        /* Most commonly used to search for the next instruction word on the
        disk as specfied by the track and sector portion of the C register.
        Also used by I/O to delay until input is received or an output device
        is ready */
        let nextPhase = 1;              // stay in this phase by default

        if (this.activeIODevice) {
            if (!this.Q.Q3) {           // Input I/O is active.
                if (!this.waitingIODevice) {
                    nextPhase = 3;      // process the input code received into P
                }
            } else {                    // Output I/O is active.
                // If output is 4-bit mode, apply correct zone bits to the internal code.
                if (this.K.value) {
                    this.P.value = (this.P.value & 0b111100) | 0b000010;
                }

                // Rotate the internal code in P to tape-code format. Send P to
                // the output device. If device is busy, repeat Phase 1; if not,
                // the code was accepted, so terminate the I/O but stay in P1 to
                // start the next instruction.
                const tapeCode = (this.P.value >>> 1) | ((this.P.value & 1) << 5);
                if (this.activeIODevice.write(tapeCode) >= 0) { // < 0 => busy
                    this.terminateIO();
                }

                /********** DEBUG PRINT **********  /
                console.debug(`<P1> Print: P=${this.P.value.toString(2).padStart(6,'0')}` +
                              `, K=${this.K.value}, code=${tapeCode.toString(2).padStart(6,'0')}` +
                              ` '${IOCodes.ioTapeCodeToASCII[tapeCode]}'`);
                /*********************************/
            }
        } else {                        // Search for sector of next instruction.
            if (!this.lastOpEnded) {
                ++this.instructionCount;
                if (this.tracing) {             // log end of prior instruction
                    this.traceInstruction(1, "End Op");
                }

                this.lastOpEnded = true;        // prevent end-op tracing during rest of search
                this.lastOpDiskTime = this.disk.diskTime;       // for tracing
            }

            this.K.value = 1;           // initialize sector-found flag
            if (!this.Q.Q2) {
                this.blocked = true;    // enter blocked mode, stop emulation
                nextPhase = 0;                  // invalidate next phase
            } else {
                if (this.disk.findSector(this.C.value)) {
                    nextPhase = 2;      // instruction sector found
                } else {
                    this.K.value = 0;   // instruction sector not yet found
                }
            }
        }

        return nextPhase;
    }

    /**************************************/
    phase2() {
        /* Used to load the word at the current disk location to the R register
        in preparation for execution. Also handles conditional skipping by
        switching back to Phase 1 instead of 3 */
        let nextPhase = 3;
        const word = this.disk.read();

        this.opAddr = (this.C.value & Util.addressMask) >>> Util.sectorShift;   // for tracing
        this.opWord = word;                                                     //   "
        this.lastOpEnded = false;   // reset for this instruction cycle         //   "

        this.R.value = word;
        this.C.incAddress();            // increment instruction counter

        // Load P with the track field plus the high-order bit of the sector
        // field (a holdover from the LGP-30 6-bit track and 6-bit sector fields).
        this.P.value = (word & Util.addressMask) >>> (Util.trackShift-1);
        this.G.value = 0;               // for display only
        this.K.value = 1;               //  "
        if (this.Q.Q1) {                // check if we're skipping this instruction
            this.Q.Q1 = 0;              // yes, reset skip indicator
            nextPhase = 1;
            this.lastOpEnded = true;    // don't trace skipped instructions
        }

        return nextPhase;
    }

    /**************************************/
    phase3() {
        /* Most commonly used to search for the current instruction's operand
        location as specified by the track and sector portion of the R register
        and load the order code into the Q register.
        Also used by I/O for various purposes */
        let nextPhase = 3;              // stay in this phase by default

        this.order = (this.R.value & Util.orderMask) >>> Util.orderShift;
        this.Q.value = this.order;

        switch (this.order) {
        case Processor.opSenseHalt:     // Z=SENSE/HALT
        case Processor.opTransfer:      // U=UNCONDITIONAL TRANSFER
            nextPhase = 4;              // P3 is 1 word-time only
            break;

        case Processor.opTest:          // T=TEST
            if ((this.A.value & Util.wordSignMask) ||
                    (this.tcSwitch && (this.R.value & Util.wordSignMask))) {
                this.Q.Q4 = 0;          // convert op to Unconditional Transfer
                this.order &= 0b1110;
            }
            nextPhase = 4;
            break;

        case Processor.opInput:         // I=INPUT and SHIFT
            if (this.activeIODevice) {  // => Faf, not first P3
                // Just proceed to Phase 4 and shift the received code into A.
            } else {                    // initial P3 - initiate input
                this.selectIODevice(this.P.value);
                this.K.value = this.R.value & Util.wordSignMask;        // 4/6-bit mode
                this.X.value = 0;       // reset end-input flag (was really set in the next P1)
                this.P.value = 0;       // reset P in preparation for P4 shift into A
                if (this.activeIODevice) { // don't call enableSend if this is just a Shift
                    this.activeIODevice.enableSend(true);               // start input
                }
            }

            nextPhase = 4;              // P3 is 1 word-time only
            break;

        case Processor.opPrint:         // P=PRINT
            this.selectIODevice(this.P.value);
            this.K.value = this.R.value & Util.wordSignMask;            // 4/6-bit mode
            this.X.value = 0;           // reset end-output flag
            nextPhase = 4;              // P3 is 1 word-time only
            break;

        default:                        // Search for operand sector
            this.K.value = 1;           // initialize operand sector-found flag
            if (this.disk.findSector(this.R.value)) {
                nextPhase = 4;
            } else {
                this.K.value = 0;       // operand sector not found (yet)
            }
            break;
        }

        return nextPhase;
    }

    /**************************************/
    phase4() {
        /* Primary phase for executing the instruction in the the C register as
        loaded into this.order. It is primarily concerned with modifying the A
        register, and usually terminates in one word-time, but some instructions
        (I/O, multiply, divide) will execute across multiple phase cycles and
        visit this and other phases more than once. Returns the next phase to
        be executed */
        const dataAddr = (this.opWord & Util.addressMask) >>> Util.sectorShift; // for tracing
        let nextPhase = 1;

        switch (this.order) {
        case Processor.opSenseHalt:     // Z: Sense/Halt
            // Executed at the end of Phase 4, see below.
            break;

        case Processor.opBring:         // B: Bring (load A)
            this.dataWord = this.disk.read();
            this.A.value = this.dataWord;
            if (this.tracing) {
                this.traceOperand(4, "Operand", dataAddr, this.dataWord);
            }
            break;

        case Processor.opStoreAddress:  // Y: Store Address
            this.disk.modify((word) => {
                const result = (word & ~Util.addressMask) | (this.A.value & Util.addressMask);
                this.dataWord = word;
                if (this.tracing) {
                    this.traceOperand(4, "Y Result", dataAddr, result);
                }
                return result;
            });
            break;

        case Processor.opStoreReturn:   // R: Set Return Address
            this.disk.modify((word) => {
                const result = (word & ~Util.addressMask) |
                        (((this.C.value & Util.addressMask) + (1 << Util.sectorShift)) & Util.addressMask);
                this.dataWord = word;
                if (this.tracing) {
                    this.traceOperand(4, "R Result", dataAddr, result);
                }
                return result;
            });
            break;

        case Processor.opInput:         // I: Input & Left Shift (4 or 6 bit)
            this.A.value = this.K.value ? ((this.A.value << 4) & Util.fullWordMask) | (this.P.value >> 2)
                                        : ((this.A.value << 6) & Util.fullWordMask) | (this.P.value);
            this.waitingIODevice = true;
            if (this.readyForInput.waiting) {
                this.readyForInput.proceed(0);      // allow receiveInputCode() to proceed
            }
            break;

        case Processor.opDivide:        // D: Divide
            nextPhase = this.divideStep();
            break;

        case Processor.opMultiplyLow:   // N: Multiply for low-order bits
            nextPhase = this.multiplyStep(true);
            break;

        case Processor.opMultiply:      // M: Multiple for high-order bits
            nextPhase = this.multiplyStep(false);
            break;

        case Processor.opPrint:         // P: Print/Output/No-Op (4 or 6 bit)
            this.P.value = (this.A.value >>> 26) & 0b111111;
            this.Q.Q2 = 1;              // Do not block in next P1
            this.Q.Q3 = 1;              // Indicate output order (used by P1 since Q is altered)

            /********** DEBUG PRINT **********  /
            console.debug(`<P4> Print: A=${Util.lgp21Hex(this.A.value)}` +
                          `=${(this.A.value>>>0).toString(2).padStart(32,'0')}` +
                          `, P=${this.P.value.toString(2).padStart(6,'0')}`);
            /*********************************/
            break;

        case Processor.opExtract:       // E: Extract (logical AND)
            this.dataWord = this.disk.read();
            this.A.value &= this.dataWord;
            if (this.tracing) {
                this.traceOperand(4, "Operand", dataAddr, this.dataWord);
            }
            break;

        case Processor.opTransfer:      // U: Unconditional Transfer
            this.C.value = (this.C.value & ~Util.addressMask) |
                           (this.R.value & Util.addressMask);
            break;

        case Processor.opTest:          // T: Test or Conditional Transfer
            // Handled in P3 -- changes order to a Transfer if test succeeds.
            break;

        case Processor.opStoreHold:     // H: Hold (store and retain A)
            if (this.tracing) {
                this.traceOperand(4, "Store H", dataAddr, this.A.value);
            }

            this.disk.write(this.A.value);
            break;

        case Processor.opStoreClear:    // C: Clear (store and clear A)
            if (this.tracing) {
                this.traceOperand(4, "Store C", dataAddr, this.A.value);
            }
            this.disk.write(this.A.value);
            this.A.value = 0;
            break;

        case Processor.opAdd:           // A: Add
            this.dataWord = this.disk.read();
            if (this.tracing) {
                this.traceOperand(4, "Operand", dataAddr, this.dataWord);
            }

            this.A.value = this.addWord(this.A.value, this.dataWord);
            if (this.overflowed) {
                this.C.setOverflow(1);
            }
            break;

        case Processor.opSubtract:      // S: Subtract
            this.dataWord = this.disk.read();
            if (this.tracing) {
                this.traceOperand(4, "Operand", dataAddr, this.dataWord);
            }

            this.A.value = this.subtractWord(this.A.value, this.dataWord);
            if (this.overflowed) {
                this.C.setOverflow(1);
            }
            break;
        }

        // Check for blocked state at end of instruction (see MTM, p.3-25, 3-54).
        if (this.stopRequested) {
            // If (Q1 is set [op P,E,U,T,H,C,A,S] or op is Input, enter blocked state.
            if (this.Q.Q1 || this.Q.value == Processor.opInput) {
                this.Q.Q2 = 0;
            }
        } else {
            // If Q2 is reset [op Z 00,B,Y,R,P,E,U,T], set Q2 to prevent blocked state.
            if (!this.Q.Q2 && (this.Q.value != 0 || this.P.value != 0)) {
                this.Q.Q2 = 1;
            }
        }

        this.Q.Q1 = 0;                  // unconditionally reset skip indicator
        if (this.order == Processor.opSenseHalt) {
            this.senseHalt();           // Z: Sense/Halt (may turn Q1 back on to command a skip)
        }

        return nextPhase;
    }


    /*******************************************************************
    *  Processor Control                                               *
    *******************************************************************/

    /**************************************/
    setPhaseFF(phase) {
        /* Sets the instruction phase flip-flops (F, G, H) according to "phase" */

        switch (phase) {
        case 1:
            this.F.value = 0;
            this.G.value = 0;
            break;
        case 2:
            this.F.value = 0;
            this.G.value = 1;
            break;
        case 3:
            this.F.value = 1;
            this.G.value = 0;
            break;
        case 4:
            this.F.value = 1;
            this.G.value = 1;
            break;
        }
    }

    /**************************************/
    async run(startPhase) {
        /* Main execution control loop for the processor. The disk manages the
        system timing, updating its L and eTime properties as calls on its
        stepDisk() method is made. The disk also throttles performance to
        approximately that of a real LGP-21. We continue to run until a halt or
        blocked condition is detected, which is indicated by this.blocked was
        set true by Phase 1. Exiting this routine stops the emulation */
        let nextPhase = startPhase;             // current instruction nextPhase
        let busyStart = performance.now();      // for updating this.avgBusy

        this.disk.startTiming();
        this.setPhaseFF(nextPhase);
        this.blocked = false;
        if (this.tracing) {
            console.log(`<Start Emulation> Phase=${nextPhase}, Mode=${this.modeSwitch}`);
        }

        do {                            // run until blocked
            switch (nextPhase) {
            case 1:                     // Phase 1, primarily locate next instruction
                nextPhase = this.phase1();
                break;

            case 2:                     // Phase 2, fetch next instruction
                nextPhase = this.phase2();
                break;

            case 3:                     // Phase 3, primarily locate operand location
                nextPhase = this.phase3();
                break;

            case 4:                     // Phase 4, execute instruction
                nextPhase = this.phase4();
                break;

            default:                    // Error - should never happen
                console.log(`Invalid Processor Phase: ${nextPhase}`);
                throw new Error("Invalid Processor Phase");
                break;
            }

            // Rotate the disk by one word-time to advance its position and the
            // emulation clock. If stepDisk returns true, then it's time to
            // throttle the emulation clock (Disk.eTime) so real time can catch up.
            if (this.disk.stepDisk()) {
                this.throttleStart = performance.now();
                const delay = this.disk.eTime - this.throttleStart;

                // Update the average requested-delay statistic.
                this.avgThrottleDelay =
                        this.avgThrottleDelay*Processor.statsAlpha1 + delay*Processor.statsAlpha;

                // The Pause That Refreshes.
                await this.stepTimer.set(delay);

                // Update avgBusy and restart the busy timer.
                const throttleEnd = performance.now();
                const elapsed = throttleEnd - busyStart;
                if (elapsed > 0) {
                    this.avgBusy = this.avgBusy*Processor.statsAlpha1 +
                            (this.throttleStart-busyStart)/elapsed*Processor.statsAlpha;
                    busyStart = throttleEnd;
                }
                // Update the average deviation between requested and actual delay.
                this.avgThrottleDelta = this.avgThrottleDelta*Processor.statsAlpha1 +
                        (throttleEnd - this.throttleStart - delay)*Processor.statsAlpha;
            }

            this.setPhaseFF(nextPhase);
        } while (!this.blocked);

        this.lastPhase = nextPhase;
        this.stopRequested = false;
        this.disk.stopTiming();
        this.updateLampGlow(1);
        if (!this.lastOpEnded) {
            if (this.tracing) {         // log end of prior instruction
                this.traceInstruction(nextPhase, "End Op");
            }

            this.lastOpEnded = true;        // prevent end-op processing during rest of search
            this.lastOpDiskTime = this.disk.diskTime;           // for tracing
        }

        if (this.tracing) {
            console.log(`<Stop Emulation>  Mode=${this.modeSwitch}`);
        }
    }

    /**************************************/
    start() {
        /* Initiates the processor on the Javascript thread */

        if (this.poweredOn && this.blocked && !this.stopRequested) {
            this.lastOpEnded = true;
            switch (this.modeSwitch) {
            case Processor.modeOneOperation:    // ONE OPERATION
                this.stopRequested = true;              // force a single cycle
                this.Q.Q2 = 1;                          // inhibit blocked state
                this.run(1);                            // runs async
                break;
            case Processor.modeManInput:        // MANUAL INPUT
                // Cannot start in Man Input mode.
                break;
            case Processor.modeNormal:          // NORMAL
                this.stopRequested = false;             // allow continuous running
                this.Q.Q2 = 1;                          // inhibit blocked state
                this.run(1);                            // runs async
                break;
            }
        }
    }

    /**************************************/
    stop() {
        /* Signals the Processor or stop running at end of instruction */

        if (this.poweredOn && !this.blocked) {
            this.stopRequested = true;
        }
    }

    /**************************************/
    startPause(timestamp) {
        /* Pauses the emulation by effectively stopping the Processor clock */

        this.blocked = true;            // stop the clock
        for(let name in this.context.devices) {
            this.context.devices[name].startPause(timestamp);
        }
    }

    /**************************************/
    endPause(deltaTime) {
        /* Resumes the emulation after a pause */

        this.lastOpDiskTime += deltaTime;
        this.throttleStart += deltaTime;
        this.run(this.lastPhase > 0 ? this.lastPhase : 1);
        for (let name in this.context.devices) {
            this.context.devices[name].endPause(deltaTime);
        }
    }

    /**************************************/
    panelFillClear() {
        /* Handles the FILL CLEAR button on the ControlPanel to transfer the
        instruction in the A register to the R register and clear the C register */

        if (this.poweredOn && this.blocked && this.modeSwitch != Processor.modeNormal) {
            this.C.value = this.opAddr = 0;
            this.R.value = this.opWord = this.A.value;
            if (this.tracing) {
                console.log("<FILL CLEAR>");
            }
        }
    }

    /**************************************/
    panelExecute() {
        /* Handles the EXECUTE button on the ControlPanel to execute the
        instruction currently in the R register, bypassing Phases 1 & 2.
        this.run() is async, but since we are running out of an event handler,
        we don't care */

        if (this.poweredOn && this.blocked && this.modeSwitch == Processor.modeOneOperation) {
            if (this.tracing) {
                console.log("<EXECUTE>");
            }

            this.stopRequested = true;  // force a single cycle (redundant here?)
            this.lastOpEnded = false;
            this.run(3);                // runs async
        }
    }

    /**************************************/
    initiateManInputMode() {
        /* Initiates ManInput mode by setting appropriate flip-flops and telling
        the Flexowriter to enable sending codes to the Processor */

        this.selectIODevice(Processor.devFlexowriter);
        this.Q.Q1 = 0;                  // disallow anything except Input
        this.Q.Q3 = 0;
        this.Q.Q4 = 0;
        this.K.value = 1;               // 4-bit mode
        this.X.value = 0;               // reset end-input flag
        this.P.value = 0;               // clear P to receive the first code
        this.waitingIODevice = true;
        this.activeIODevice.enableSend(false);  // initiate sending, no reader start
    }

    /**************************************/
    panelClearIO() {
        /* Handles the I/O button on the ControlPanel to clear the A register
        and terminate any in-process I/O. If we are in ManInput mode and the
        Flexowriter is selected, leave it selected, but if some other device is
        selected, terminate it and select the Flexowriter. See modeSwitchChange
        for the reason why */

        if (this.poweredOn) {
            this.A.value = 0;           // unconditionally clears accumulator
            if (this.activeIODevice) {
                if (this.modeSwitch != Processor.modeManInput) {
                    this.activeIODevice.cancel();
                    this.terminateIO();
                    this.Q.Q2 = 0;      // initiate blocking
                    if (this.tracing) {
                        console.log("<Cancel I/O>");
                    }
                } else if (this.activeIODevice === this.devices.flexowriter) {
                    // Do not reset Flexowriter I/O when in ManInput mode.
                } else {
                    // Flexowriter could not be selected when entering
                    // ManInput mode, but now it can.
                    this.initiateManInputMode();
                    if (this.tracing) {
                        console.log("<Flexowriter selected for ManInput after Cancel I/O>");
                    }
                }
            }
        }
    }

    /**************************************/
    modeSwitchChange(state) {
        /* Reacts to a change in state of the ControlPanel MODE switch. Note
        that when switching into ManInput mode, the Flexowriter is selected for
        input, but no other selected device is deselected. In this emulator,
        only one device can be selected at a time, so in ManInput mode the
        Flexowriter cannot be selected if any other device is already selected.
        That condition can be corrected by pressing the I/O switch, which will
        deselect any other devices and then select the Flex */

        if (this.poweredOn && this.modeSwitch != state) {
            if (this.modeSwitch == Processor.modeManInput) {
                // Switching out of ManInput deselects the Flexowriter.
                if (this.activeIODevice === this.devices.flexowriter) {
                    this.activeIODevice.cancel();
                    this.terminateIO();
                    if (this.tracing) {
                        console.log("<Flexowriter deselected exiting ManInput");
                    }
                }
            }

            this.modeSwitch = state;
            switch (state) {
            case Processor.modeManInput:        // MANUAL INPUT
                this.stop();
                this.K.value = 1;
                if (this.activeIODevice !== this.devices.flexowriter) {
                    if (this.activeIODevice === null) {
                        this.initiateManInputMode();
                        if (this.tracing) {
                            console.log("<Flexowriter selected for ManInput>");
                        }
                    } else if (this.tracing) {
                        console.log("<Flexowriter NOT SELECTED for ManInput: other device active>");
                    }
                }
                break;
            case Processor.modeOneOperation:    // ONE OPERATION
                this.stop();
                break;
            case Processor.modeNormal:          // NORMAL
                break;
            }
        }
    }


    /*******************************************************************
    *  System Initialization                                           *
    *******************************************************************/

    /**************************************/
    async powerUp() {
        /* Powers up and initializes the processor */

        if (!this.poweredOn) {
            this.blocked = true;                        // set HALT lamp
            this.stopRequested = false;
            this.devices = this.context.devices;        // I/O device objects
            await this.disk.restore();                  // restore former disk contents
            this.poweredOn = true;
            console.log("<System Power Up>");

            if (Processor.debugging && window.location.hostname == "localhost") {
                this.loadMemory();                      // >>> DEBUG ONLY <<<
            }
        }
    }

    /**************************************/
    async powerDown() {
        /* Powers down the processor */

        if (this.poweredOn) {
            console.log("<System Power Off>");
            this.stop();
            this.terminateIO();
            await this.disk.persist();                  // async -- save disk contents
            this.poweredOn = false;
        }
    }

    /**************************************/
    loadMemory() {
        /* Loads debugging code into the initial disk memory image. The routine
        should be enabled in this.powerUp() only temporarily for demo and
        debugging purposes */

        const store = (loc, word) => {
            const index = (loc & 0xF80) + (((loc & 0x3F)*18) & 0x7F) + ((loc >> 6) & 1);
            this.disk.diskMem[index] = (word & Util.fullWordMask) >>> 0;
        };

        const asm = (loc, op, addr, sign=0) => {
            let word = ((((((sign ? 1 : 0)  << 15) |
                            (op & 0x0F))    << 14) |
                            (addr & 0xFFF)) <<  2);
            store(loc, word);
        };

        const int = (loc, value) => {
            store(loc, value << 1);
        };

        // Preload code in memory...
        this.disk.diskMem.fill(0);     // clear memory

        asm( 0,  1,  116);      // BRING   116
        asm( 1, 14,  117);      // ADD     117
        asm( 2, 15,  118);      // SUB     118
        asm( 3, 13,  201);      // STORE/C 201
        asm( 4, 14,  119);      // ADD     119
        asm( 5, 12,  200);      // STORE/H 200
        asm( 6, 11,   16);      // TEST     16
        asm( 7,  9,  116);      // EXTRACT 116
        asm( 8,  0,    0);      // HALT      0

        asm(16,  0,    0, true);// -HALT     0
        asm(17,  0,    1);      // HALT
        asm(18,  0,    2);      // HALT

        int(116,        123);
        int(117,        456);
        int(118,        678);
        int(119,        -32);

        int(200,         -1);

        // Bootstrap in track 63:00-02. Man Input 000u3w00 (U 6300) to run.
        store(63*64,   0x80040000);             // Input 4-bit from Flexowriter
        store(63*64+1, 0x000D3F0C);             // store result at 63:03
        store(63*64+2, 0x80040000);             // Input again

    }

} // class Processor
