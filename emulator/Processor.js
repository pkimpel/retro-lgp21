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
* "Maintenance and Training" manual:
*   https://bitsavers.org/pdf/generalPrecision/LGP-21/
            ESD1060_LGP-21_Maintenance_and_Training_Manual.pdf.
*
************************************************************************
* 2026-03-28  P.Kimpel
*   Original version.
***********************************************************************/

export {Processor}

import * as Util from "./Util.js";

import {Disk} from "./Disk.js";
import {FlipFlop} from "./FlipFlop.js";
import {Register} from "./Register.js";


class Processor {

    // Processor execution phases
    static blocked = 0;                                 // Q2 + O1 + bQ
    static searchInstruction = 1;                       // /F . /G . /H
    static loadInstruction = 2;                         // /F .  G . /H
    static searchOperand = 3;                           //  F . /G . /H
    static executeInstruction = 4;                      //  F .  G . /H

    // MODE switch values
    static mode1Operation = 0;
    static modeManInput = 1;
    static modeNormal = 2;


    constructor(context) {
        /* Constructor for the LGP-21 processor object. The "context" object
        supplies UI and I/O objects from the emulator global environment */

        this.disk = new Disk();                         // the memory disk
        this.context = context;

        // Flip-flops
        this.F  = new FlipFlop(this.disk, false);       // instruction phase flip-flops
        this.G  = new FlipFlop(this.disk, false);       //     "
        this.H  = new FlipFlop(this.disk, false);       //     "

        this.P1 = new FlipFlop(this.disk, false);       // high-order bit of P register
        this.P2 = new FlipFlop(this.disk, false);       //
        this.P3 = new FlipFlop(this.disk, false);       //
        this.P4 = new FlipFlop(this.disk, false);       //
        this.P5 = new FlipFlop(this.disk, false);       //
        this.P6 = new FlipFlop(this.disk, false);       // low-order bit of P register

        this.Q1 = new FlipFlop(this.disk, false);       // high-order bit of Q register
        this.Q2 = new FlipFlop(this.disk, false);       //
        this.Q3 = new FlipFlop(this.disk, false);       //
        this.Q4 = new FlipFlop(this.disk, false);       // low-order bit of Q register

        // Registers (additional registers are part of the Disk object)
        this.A  = this.disk.regA;                       // accumulator register
        this.C  = this.disk.regC;                       // instruction counter register
        this.I  = this.disk.regI;                       // current instruction word
        this.AStarLow = this.disk.regAStarLow;          // double-precision register lower half
        this.AStarHigh = this.disk.regAStarHigh;        // double-precision register upper half

        // General emulator state
        this.blocked = true;                            // true if Processor cannot run
        this.order = 0;                                 // current instruction op code
        this.overflowed = 0;                            // 1 if last addition overflowed
        this.poweredOn = false;                         // powered up and ready to run
        this.skipInstruction = false;                   // skip next instruction during Phase 2
        this.tracing = false;                           // trace command debugging

        // UI state from Control Panel
        this.bs4Switch = 0;                             // BS-4 switch
        this.bs8Switch = 0;                             // BS-8 switch
        this.bs16Switch = 0;                            // BS-16 switch
        this.bs32Switch = 0;                            // BS-32 switch
        this.modeSwitch = 0;                            // 0=one-oper, 1=man-input, 2=normal
        this.tcSwitch = 0;                              // used by order 11, T: Conditional Transfer

        // I/O Subsystem
        this.activeIODevice = null;                     // current I/O device object
        this.canceledIO = false;                        // current I/O has been canceled
        this.duplicateIO = false;                       // second I/O of same type initiated while first in progress
        this.hungIO = false;                            // current I/O is intentionally hung, awaiting cancel
    }


    /*******************************************************************
    *  Utility Methods                                                 *
    *******************************************************************/

    /**************************************/
    traceRegisters(prefix) {
        /* Formats the registers to console.log */
        let loc = this.disk.L.value;

        console.log("%s: L=%s: ID=%s %s  MQ=%s %s  PN=%s %s  PN%s  IP=%d  AR=%s : FO=%d%s",
                (prefix ?? "REG").padStart(16, " "),
                Util.formatLineLoc(24, loc, false),
                Util.lgp21Hex(this.disk.ID[1].value).padStart(8, "0"),
                Util.lgp21SignedHex(this.disk.ID[0].value),
                Util.lgp21Hex(this.disk.MQ[1].value).padStart(8, "0"),
                Util.lgp21SignedHex(this.disk.MQ[0].value),
                Util.lgp21Hex(this.disk.PN[1].value).padStart(8, "0"),
                Util.lgp21SignedHex(this.disk.PN[0].value),
                (this.pnSign ? "-" : "+"), this.IP.value,
                Util.lgp21SignedHex(this.disk.AR.value),
                this.FO.value, (this.overflowed ? "*" : " "));
    }

    /**************************************/
    traceState() {
        /* Log current processor state to the console using a PPR-like format */
        const diskLoc = this.isNCAR ?
                "NCAR   " : Util.formatDiskLoc(this.cmdLine, this.cmdLoc.value, true);

        console.log(`<TRACE${this.devices.paperTapeReader.blockNr.toString().padStart(3, " ")}>` +
                    `${this.lastRCWordTime.toFixed().padStart(9)}: ${diskLoc}  ${Util.disassembleCommand(this.cmdWord)}`);
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

        // Processor Registers
        this.C.updateLampGlow(gamma);
        this.I.updateLampGlow(gamma);
        this.A .updateLampGlow(gamma);

        // Disk Registers
        this.disk.L.updateLampGlow(gamma);
    }


    /*******************************************************************
    *  Input/Output Subsystem                                          *
    *******************************************************************/

    /**************************************/
    async receiveInputCode(code) {
        /* Receives the next I/O code from an input device and either stores
        it onto the drum or acts on its control function */
        const autoReload = this.AS.value && (this.OC.value & 0b1100) == 0b1100; // SLOW IN only
        let eob = 0;                    // end-of-block flag
        let marker = 0;                 // auto-reload marker code

        if ((this.OC.value & 0b01100) != 0b01100) {
            eob = 1;                            // canceled or not SLOW IN
        } else {
            if (code & IOCodes.ioDataMask) {    // it's a data frame
                await this.disk.ioStart("RIC data");
                marker = await this.disk.ioPrecessCodeTo23(code, 4);
                this.disk.ioStop("RIC data");
            } else {
                switch(code & 0b00111) {
                case IOCodes.ioCodeMinus:       // minus: set sign FF
                    this.OS.value = 1;
                    break;
                case IOCodes.ioCodeCR:          // carriage return: shift sign into word
                case IOCodes.ioCodeTab:         // tab: shift sign into word
                    await this.disk.ioStart("RIC CR/TAB");
                    marker = await this.disk.ioPrecessCodeTo23(this.OS.value, 1);
                    this.disk.ioStop("RIC CR/TAB");
                    this.OS.value = 0;
                    break;
                case IOCodes.ioCodeStop:        // end/stop
                    eob = 1;
                    // no break: Stop implies Reload -- if not TYPE IN -- see receiveKeyboardCode()
                case IOCodes.ioCodeReload:      // reload
                    if (!autoReload) {
                        await this.ioPrecession;
                        await this.disk.ioStart("RIC Stop/Reload");
                        await this.disk.ioCopy23ToMZ(false);
                        this.disk.ioStop("RIC Stop/Reload");
                        this.ioPrecession = this.disk.ioPrecessMZTo19();    // uses separate drum timing
                    }
                    break;
                case IOCodes.ioCodePeriod:      // period: ignored
                    break;
                case IOCodes.ioCodeWait:        // wait: insert a 0 digit on input
                    await this.disk.ioStart("RIC Period/Wait");
                    marker = await this.disk.ioPrecessCodeTo23(0, 4);
                    this.disk.ioStop("RIC Period/Wait");
                    break;
                default:                        // treat everything else as space & ignore
                    break;
                }
            }

            // Check if automatic reload is enabled and line 23 is full
            if (autoReload && marker == 1) {
                marker = 0;
                await this.ioPrecession;
                await this.disk.ioStart("RIC AUTO Reload");
                await this.disk.ioCopy23ToMZ(true);
                this.disk.ioStop("RIC AUTO Reload");
                this.ioPrecession = this.disk.ioPrecessMZTo19();            // uses separate drum timing
            }
        }

        if (eob) {
            await this.ioPrecession;            // wait for final line 19 precession to complete
        }

        return eob;
    }

    /**************************************/
    async executeKeyboardCommand(code) {
        /* Executes the typewriter keyboard command specified by:
            * If the code is negative, then the ASCII value of "code"
            * If the code is 0b10000-0b10111 (keyboard 1-7), then sets
              the command line to the value of that code
        Returns 0 if the command is accepted and 0 if rejected */
        let result = 0;                 // assume valid input for now

        return result;
    }

    /**************************************/
    async receiveKeyboardCode(code) {
        /* Processes a keyboard code sent from Typewriter. Codes are ignored
        if the system has not yet been reset. If the code is negative, it is
        the ASCII code for a control command used with the ENABLE switch.
        Otherwise it is an I/O data/control code to be processed as TYPE IN
        (D=31, S=12) input. Note that the "S" key can be used for both purposes
        depending on the state of this.enableSwitch. Returns 0 if the input is
        accepted and ` if rejected or it's a STOP. If the ENABLE switch is not
        on and TYPE IN is not active, the keystroke is ignored and 1 is returned */
        let result = 1;                 // assume it's going to be rejected

        if (!this.poweredOn) {                                  // ignore the keyboard if powered off
            result = 1;
        } else if (this.enableSwitch) {                         // Control command
            result = await this.executeKeyboardCommand(code);
        } else if (this.OC.value == IOCodes.ioCmdTypeIn) {      // Input during TYPE IN
            if (code == IOCodes.ioCodeStop) {                   // check for cancel
                this.finishIO();                                // no reload with STOP from Typewriter
                result = 1;                                     // accept the keystroke as a STOP
            } else if (code > 0) {
                result = await this.receiveInputCode(code);
            }
        }

        return result;
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
        const a = augend >>> 1;
        const b = addend >>> 1;
        let sum = a + b;
        if (!((augend ^ addend) & Util.wordSignMask)) {
            // Signs are the same, so check if sum sign is same as augend.
            this.overflowed = (a ^ b) >>> (Util.wordBits-2);
        }

        return sum << 1;                // reinstate the spacer bit.
    }

    /**************************************/
    subtractWord(minuend, subtrahend) {
        /* Subtracts two words in LGP-21 format, returning the difference.
        Reverses the sign of subtrahend and then calls addWord() to generate
        the difference and overflow check */
        const negated = Util.wordSignMask - (subtrahend >>> 1);

        return this.addWord(minuend, negated << 1);
    }


    /**************************************/
    senseHalt() {
        /* Executes the Z instruction, conditionally halting the processor,
        clearing overflow and skipping the next instruction, sensing the
        breakpoint switches and skipping the next instruction, or a combination
        of those actions */
        const track = (this.I.value & Util.trackMask) >>> Util.trackShift;

        if (this.C.getOverflow()) {
            this.C.setOverflow(0);
            this.skipInstruction = true;
        }

        if (track == 0) {
            this.stop();                // stop occurs before skip
        } else {
            const offSwitchMask = (this.bs4Switch  ? 0 : 0x04) +
                                  (this.bs8Switch  ? 0 : 0x08) +
                                  (this.bs16Switch ? 0 : 0x10) +
                                  (this.bs32Switch ? 0 : 0x20);
            if (track & offSwitchMask) {
                this.skipInstruction = true;
            }
        }
    }

    /**************************************/
    async execute() {
        /* Executes the command currently loaded into the C register as
        this.order */

        switch (this.order) {
        case 0:                         // Z: Sense/Halt
            this.senseHalt();
            break;

        case 1:                         // B: Bring (load A)
            this.A.value = await this.disk.read();
            break;

        case 2:                         // Y: Store Address
            await this.disk.modify((word) => {
                return (word & Util.addressMask) | (this.A.value & Util.addressMask);
            });
            break;

        case 3:                         // R: Set Return Address
            await this.disk.modify((word) => {
                return (word & Util.addressMask) |
                        (((this.C.value & Util.addressMask) + 1) & Util.addressMask);
            });
            break;

        case 4:                         // I: Input/Left Shift (4 or 6 bit)
            break;

        case 5:                         // D: Divide
            break;

        case 6:                         // N: Multiply for low-order bits
            break;

        case 7:                         // M: Multiple for high-order bits
            break;

        case 8:                         // P: Print/Output/No-Op (4 or 6 bit)
            break;

        case 9:                         // E: Extract (logical AND)
            this.A.value &= await this.disk.read();
            break;

        case 10:                        // U: Unconditional Transfer
            this.C.value = this.I.value;
            await this.disk.stepDisk();
            break;

        case 11:                        // T: Test or Conditional Transfer
            if ((this.A.value & Util.wordSignMask) ||
                    (this.tcSwitch && (this.I.value & Util.wordSignMask))) {
                this.C.value = this.I.value;
            }
            await this.disk.stepDisk();
            break;

        case 12:                        // H: Hold (store and retain A)
            await this.disk.write(this.A.value);
            break;

        case 13:                        // C: Clear (store and clear A)
            await this.disk.write(this.A.value);
            this.A.value = 0;
            break;

        case 14:                        // A: Add
            this.A.value = this.addWord(this.A.value, await this.disk.read());
            if (this.overflowed) {
                this.C.setOverflow(1);
            }
            break;

        case 15:                        // S: Subtract
            this.A.value = this.subtractWord(this.A.value, await this.disk.read());
            if (this.overflowed) {
                this.C.setOverflow(1);
            }
            break;
        }
    }


    /*******************************************************************
    *  Processor Control                                               *
    *******************************************************************/

    /**************************************/
    setPhaseFF(phase) {
        /* Sets the instruction phase flip-flops (F, G, H) according to "phase" */

        switch (phase) {
        case Processor.searchInstruction:
            this.F.set(0);
            this.G.set(0);
            this.H.set(0);
            break;
        case Processor.loadInstruction:
            this.F.set(0);
            this.G.set(1);
            break;
        case Processor.searchOperand:
            this.F.set(1);
            this.G.set(0);
            break;
        case Processor.executionInstruction:
            this.F.set(1);
            this.G.set(1);
            break;
        }
    }

    /**************************************/
    async run(startPhase=Processor.searchInstruction) {
        /* Main execution control loop for the processor. The disk manages the
        system timing, updating its L and eTime properties as calls on its
        seek() and stepDisk() methods are made. The disk also throttles
        performance to approximately that of a real LGP-21. We continue to run
        until a halt or blocked condition is detected */
        let nextPhase = startPhase;
        let phase = 0;                  // current instruction phase
        let word = 0;                   // current disk word

        this.disk.startTiming();
        setPhaseFF(nextPhase);

        do {                            // run until blocked
            phase = nextPhase;
            switch (phase) {
            case Processor.searchInstruction:           // Phase 1
                nextPhase = Processor.loadInstruction;
                this.Q2.set(0);
                await this.disk.seek(this.C.value);
                break;

            case Processor.loadInstruction:             // Phase 2
                nextPhase = Processor.searchOperand;
                this.Q2.set(0);
                this.I.value = word = await this.disk.read();
                this.C.incAddress();    // increment instruction counter
                this.G.set(0);
                this.P1.set(word & (1 < (Util.trackShift+4)));
                this.P2.set(word & (1 < (Util.trackShift+3)));
                this.P3.set(word & (1 < (Util.trackShift+2)));
                this.P4.set(word & (1 < (Util.trackShift+1)));
                this.P5.set(word & (1 < (Util.trackShift)));
                this.P6.set(0);

                if (this.skipInstruction) {
                    this.skipInstruction = false;
                    nextPhase = Processor.searchInstruction;
                }
                break;

            case Processor.searchOperand:               // Phase 3
                nextPhase = Processor.executeInstruction;
                this.order = (this.I.value & Util.orderMask) >>> Util.orderShift;
                this.Q1.set(this.order & 0b1000);
                this.Q2.set(this.order & 0b0100);
                this.Q3.set(this.order & 0b0010);
                this.Q4.set(this.order & 0b0001);
                await this.disk.seek(this.I.value);
                break;

            case Processor.executeInstruction:          // Phase 4
                nextPhase = Processor.searchInstruction;
                await this.execute();
                if (this.modeSwitch != Processor.modeNormal) {
                    nextPhase = Processor.blocked;
                }
                break;

            default:
                console.log(`Invalid Processor phase: ${this.phase}`);
                throw new Error("Invalid Processor phase");
                break;
            }

            this.setPhaseFF(nextPhase);
        } while (nextPhase != Processor.blocked);

        this.disk.stopTiming();
        this.updateLampGlow(1);
    }

    /**************************************/
    start() {
        /* Initiates the processor on the Javascript thread */

        if (this.poweredOn) {
            switch (this.modeSwitch) {
            case Processor.mode1Operation:      // ONE OPERATION
                this.blocked = true;
                this.run();                     // async -- returns immediately
                break;
            case Processor.modeManInput:        // MANUAL INPUT
                break;
            case Processor.modeNormal:          // NORMAL
                this.blocked = false;
                this.run();                             // async -- returns immediately
                break;
            }
        }
    }

    /**************************************/
    stop() {
        /* Stops running the processor on the Javascript thread */

        if (this.poweredOn && !this.blocked) {
            this.blocked = true;
        }
    }

    /**************************************/
    panelFillClear() {
        /* Handles the FILL CLEAR button on the ControlPanel to transfer the
        instruction in the A register to the I register and clear the C register */

        if (this.poweredOn && this.modeSwitch != Processor.modeNormal) {
            this.C.value = 0;
            this.I.value = this.A.value;
        }
    }

    /**************************************/
    panelExecute() {
        /* Handles the EXECUTE button on the ControlPanel to execute the
        instruction currently in the I register. this.run() is async, but since
        we are running out of an event handler, we don't care */

        if (this.poweredOn && this.modeSwitch == Processor.mode1Operation) {
            this.run(Processor.searchOperand);
        }
    }

    /**************************************/
    panelClearIO() {
        /* Handles the IO button on the ControlPanel to clear any in-process
        I/O and clear the A register */

        if (this.poweredOn) {
            this.A.value = 0;
            if (this.modeSwitch != Processor.modeManInput) {
                // ... reset Flexowriter I/O
            }

            // ... reset all other I/O
        }
    }

    /**************************************/
    modeSwitchChange(state) {
        /* Reacts to a change in state of the ControlPanel COMPUTE switch */

        if (this.modeSwitch != state) {
            this.modeSwitch = state;
            switch (state) {
            case Processor.mode1Operation:      // ONE OPERATION
                this.stop();
                break;
            case Processor.modeManInput:        // MANUAL INPUT
                this.stop();
                break;
            case Processor.modeNormal:          // NORMAL
                this.blocked = false;
                break;
            }
        }
    }

    /**************************************/
    async powerUp() {
        /* Powers up and initializes the processor */

        if (!this.poweredOn) {
            this.blocked = true;                        // set HALT
            this.devices = this.context.devices;        // I/O device objects
            await this.disk.restore();                  // restore former disk contents
            this.poweredOn = true;
        }
    }

    /**************************************/
    async powerDown() {
        /* Powers down the processor */

        if (this.tracing) {
            console.log("<System Power Off>");
        }

        this.stop();
        await this.disk.persist();                      // async -- save disk contents
        this.poweredOn = false;
    }

    /**************************************/
    loadMemory() {
        /* Loads debugging code into the initial drum memory image. The routine
        should be enabled in this.powerUp() only temporarily for demo and
        debugging purposes */

        let store = (lineNr, loc, word) => {
            if (lineNr < 20) {
                this.disk.line[lineNr][loc % Util.longLineSize] = word;
            } else if (lineNr < 24) {
                this.disk.line[lineNr][loc % Util.fastLineSize] = word;
            } else if (lineNr < 27) {
                this.disk.line[lineNr][loc % 2] = word;
            }
        };

        let asm = (lineNr, loc, di, t, n, ca, s, d, c1=0, bp=0) => {
            let word = ((((((((((((((di & 1)     << 7) |
                                    (t  & 0x7F)) << 1) |
                                    (bp & 1))    << 7) |
                                    (n  & 0x7F)) << 2) |
                                    (ca & 3))    << 5) |
                                    (s  & 0x1F)) << 5) |
                                    (d  & 0x1F)) << 1) |
                                    (c1  & 1);
            store(lineNr, loc, word);
        };

        let int = (lineNr, loc, word) => {
            let sign = 0;

            if (word < 0) {
                sign = 1;
                word = -word;
            }

            store(lineNr, loc, ((word & 0xFFFFFFF) << 1) | sign);
        };


        // First, fill the drum with non-zero values for testing
        this.disk.AR.value = 0x1234567;
        this.disk.ID[0].value = 0x2345678;
        this.disk.ID[1].value = 0x3456789;
        this.disk.MQ[0].value = 0x4567890;
        this.disk.MQ[1].value = 0x5678901;
        this.disk.PN[0].value = 0x6789012;
        this.disk.PN[1].value = 0x7890123;
        this.FO.value = 1;                              // set the overflow FF
        this.IP.value = 1;                              // set the DP sign FF
        for (let m=0; m<24; ++m) {
            for (let loc=Util.longLineSize-1; loc>=0; --loc) {
                int(m, loc, (m << 16) + loc);
            }
        }

        // And now for the main event... the infamous 4-word memory clear
        // routine described by Jim Hornung in his blog (original version).

        //  M     L  D/I   T    N  C   S   D  C1  BP
        asm(23,   0,  1,   2,   5, 0, 29, 28);          // ZERO: clear AR (accumulator)
        asm(23,   1,  0,  12,  15, 2, 23, 23);          // SWAP: precess line 23 via AR starting at L=106 thru L=3 (after first time will be L=3 thru L=3)
        asm(23,   2,  0,  16,  10, 0, 27, 29);          // CLEAR: smear zeroes to current line
        asm(23,   3,  0,   6,  10, 0, 26, 31);          // INCR: shift ID/MQ by 3 bits (6 word-times), incrementing AR by 3
    }

} // class Processor
