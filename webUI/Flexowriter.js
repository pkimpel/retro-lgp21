/***********************************************************************
* retro-lgp21/webUI Flexowriter.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General Precision LGP-21 emulator type 121 typewriter (Flexowriter) device.
*
* Defines the typewriter keyboard and printer device. In addition, the
* device has an integrated paper-tape reader and punch. Whether input
* comes from the keyboard, reader, or processor, or output is to the printer,
* punch, and/or and processor is controlled locally on the device.
*
************************************************************************
* 2026-04-06  P.Kimpel
*   Original version, from retro-g15 Typewriter.js and paper-tape devices.
***********************************************************************/

export {Flexowriter};

import * as Util from "../emulator/Util.js";
import * as IOCodes from "../emulator/IOCodes.js";
import {FlexoLever} from "./FlexoLever.js";
import {FlexowriterTapePunch} from "./FlexowriterTapePunch.js";
import {FlexowriterTapeReader} from "./FlexowriterTapeReader.js";
import {openPopup} from "./PopupUtil.js";

class Flexowriter {

    static cursorChar = "_";            // end-of-line cursor indicator
    static invKeyChar = "\u2592";       // flashed to indicate invalid key press
    static pillowChar = "\u2588";       // EOL overprint character
    static invKeyFlashTime = 150;       // keyboard lock flash time, ms
    static maxScrollLines = 10000;      // max lines retained in "paper" area
    static maxCols = 255;               // maximum number of columns per line
    static defaultCycleRate = 10;       // default character rate, char/sec
    static defaultCyclePeriod = 1000/Flexowriter.defaultCycleRate;
                                        // default character period, ms/char
    static minCyclePeriod = 1000/2500;  // minimum character period, ms/char (2500 cps)
    static windowTop = 550;             // default window top position
    static windowHeight = 456;          // default window innerHeight, pixels
    static windowWidth = 760;           // default window innerWidth, pixels

    static commentRex = /#[^\x0D\x0A]*/g;
    static newLineRex = /[\x0D\x0A\x0C]+/g;

    static lowerGlyphs =
            "!0!1!2!3!4!5!6!7'8!9!f!g!j!k!q!wz b-y+r;i/d.n,mvpoexu!t!h!c!a!s!";
    static upperGlyphs =
            "!)!L!*!\"!\u0394!%!$!\u03C0'\u03A3!(!F!G!J!K!Q!WZ B_Y=R:I?D]N[MVPOEXU!T!H!C!A!S!";

    static validCodes = [       // 0 => not recognized by the Flexowriter
         // 0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1,     // 00-0F
            1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,     // 10-1F
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,     // 20-2F
            1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1];    // 30-3F

    static keyToTapeCode = {    // high-order bit in a code: 0=lower-case, 1=upper-case.
            "0": 0x01,  ")":      0x81,
            "1": 0x03,  "L":      0x83,  "l": 0x03,     // Accept "l" for "1"
            "2": 0x05,  "*":      0x85,
            "^": 0x06,                                  // Color Shift is case-insensitive
            "3": 0x07,  "\"":     0x87,
            "4": 0x09,  "\u0394": 0x89,  "&": 0x89,     // Greek Delta, Δ
            "5": 0x0B,  "%":      0x8B,
            "6": 0x0D,  "$":      0x8D,
            "7": 0x0F,  "\u03C0": 0x8F,  "#": 0x8F,     // Greek Pi, π
            "'": 0x10,                                  // Conditional Stop is case-insensitive
            "8": 0x11,  "\u03A3": 0x91,  "{": 0x91,     // Greek Sigma, Σ
            "9": 0x13,  "(":      0x93,
            "f": 0x15,  "F":      0x95,
            "g": 0x17,  "G":      0x97,
            "j": 0x19,  "J":      0x99,
            "k": 0x1B,  "K":      0x9B,
            "q": 0x1D,  "Q":      0x9D,
            "w": 0x1F,  "W":      0x9F,
            "z": 0x20,  "Z":      0xA0,
            " ": 0x21,                                  // Space is case-insensitive
            "b": 0x22,  "B":      0xA2,
            "-": 0x23,  "_":      0xA3,
            "y": 0x24,  "Y":      0xA4,
            "+": 0x25,  "=":      0xA5,
            "r": 0x26,  "R":      0xA6,
            ";": 0x27,  ":":      0xA7,
            "i": 0x28,  "I":      0xA8,
            "/": 0x29,  "?":      0xA9,
            "d": 0x2A,  "D":      0xAA,
            ".": 0x2B,  "]":      0xAB,
            "n": 0x2C,  "N":      0xAC,
            ",": 0x2D,  "[":      0xAD,
            "m": 0x2E,  "M":      0xAE,
            "v": 0x2F,  "V":      0xAF,
            "p": 0x30,  "P":      0xB0,
            "o": 0x31,  "O":      0xB1,
            "e": 0x32,  "E":      0xB2,
            "x": 0x33,  "X":      0xB3,
            "u": 0x34,  "U":      0xB4,
            "t": 0x36,  "T":      0xB6,
            "h": 0x38,  "H":      0xB8,
            "c": 0x3A,  "C":      0xBA,
            "a": 0x3C,  "A":      0xBC,
            "s": 0x3E,  "S":      0xBE,
    };


    constructor(context) {
        /* Initializes and wires up events for the console typewriter device.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            config is the system configuration object
            processor is the Processor object
        */

        this.context = context;
        this.config = context.config;
        this.processor = context.processor;
        this.marginLeft = 0;
        this.columns = 132;
        this.upperCase = 0;             // default to lower case
        this.isRed = false;             // printing red currently in effect
        this.tabStops = [5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,
                        90,95,100,105,110,115,120,125]; // default in case config is bad

        // Input queueing and timing management
        this.sendEnabled = false;       // true when a Processor INPUT is active
        this.nextCycleTime = 0;         // time at which next Flexowriter cycle starts
        this.cycleTimerToken = 0;       // clearTimeout token value
        this.inputQueue = [];           // queue of tape codes waiting for output

        // Keyboard Type-O-Matic buffer controls
        this.tomBuffer = "";            // Type-O-Matic keystroke buffer
        this.tomPaused = false;         // true if Type-O-Matic is currently suspended
        this.tomCanceled = false;       // true if Type-O-Matic has been canceled
        this.tomIndex = 0;              // current offset into the Type-O-Matic buffer
        this.tomLength = 0;             // current length of the Type-O-Matic text
        this.tomUpperCase = false;      // current case state for TOM input

        this.boundBeforeUnload = this.beforeUnload.bind(this);
        this.boundChangeCaseShift = this.changeCaseShift.bind(this);
        this.boundChangeColorShift = this.changeColorShift.bind(this);
        this.boundMenuClick = this.menuClick.bind(this);
        this.boundPanelKeydown = this.panelKeydown.bind(this);
        this.boundPanelPaste = this.panelPaste.bind(this);
        this.boundStopTapeRead = this.stopTapeRead.bind(this);
        this.boundStartTapeRead = this.startTapeRead.bind(this);
        this.boundTOMPanelClick = this.tomPanelClick.bind(this);

        // Create the Control Panel window
        let geometry = this.config.formatWindowGeometry("Flexowriter");
        if (geometry.length) {
            [this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop] =
                    this.config.getWindowGeometry("Flexowriter");
        } else {
            this.innerHeight = screen.availHeight - Flexowriter.windowTop - 64;
            this.innerWidth =  Flexowriter.windowWidth;
            this.windowLeft =  screen.availWidth - Flexowriter.windowWidth;
            this.windowTop =   Flexowriter.windowTop;
            geometry = `,left=${this.windowLeft},top=${this.windowTop}` +
                       `,innerWidth=${this.innerWidth},innerHeight=${this.innerHeight}`;
        }

        openPopup(window, "../webUI/Flexowriter.html", "retro-lgp-21.Flexowriter",
                "location=no,scrollbars,resizable" + geometry,
                this, this.panelOnLoad);
    }

    /**************************************/
    $$(id) {
        /* Returns a DOM element from its id property. Cannot be called until
        panelOnLoad is called */

        return this.doc.getElementById(id);
    }

    /**************************************/
    clear() {
        /* Initializes (and if necessary, creates) the typewriter unit state */

        this.inputQueue.length = 0;
        this.nextCycleTime = 0;
        this.cycleTimerToken = 0;
        this.printerLine = 0;
        this.printerCol = 0;
        if (this.sendEnabled) {
            this.processor.receiveInputCode(-1);
        }

        this.disableSend();
        this.setPaperEmpty();
    }

    /**************************************/
    async panelOnLoad(ev) {
        /* Initializes the Flexowriter window and user interface */
        const p = this.processor;
        let parent = null;              // parent sub-panel DOM object

        this.doc = ev.target;           // now we can use this.$$()
        this.window = this.doc.defaultView;

        this.platen = this.$$("TypewriterPaper");
        this.paperDoc = this.platen.contentDocument;
        this.paperDoc.title = this.doc.title + " Paper";
        this.paper = this.paperDoc.getElementById("Paper");
        this.tomMeter = this.$$("TypeOMaticMeterBar");
        this.clear();

        // Load the configuration preferences.
        const prefs = this.config.getNode("Typewriter");
        this.marginLeft = Math.min(Math.max(prefs.marginLeft-1, 0), Flexowriter.maxCols-32);
        this.columns = Math.min(Math.max(prefs.columns, 32) + this.marginLeft, Flexowriter.maxCols);

        const tabStops = this.parseTabStops(prefs.tabs || "", this.window);
        if (tabStops !== null) {
            this.tabStops = tabStops;
        }

        this.$$("CaseIndicator").addEventListener("click", this.boundChangeCaseShift, false);
        this.lcBtn = this.$$("LCBtn");
        this.ucBtn = this.$$("UCBtn");
        this.setUpperCase(false);

        this.$$("ColorIndicator").addEventListener("click", this.boundChangeColorShift, false);
        this.blackBtn = this.$$("BlackBtn");
        this.redBtn = this.$$("RedBtn");
        this.printBlack(true);

        this.manualInputLamp = this.$$("ManualInputLamp");

        // Configure the lever switches.
        parent = this.$$("LeverFrame");

        this.condStopLever = new FlexoLever(parent, null, null, "CondStopLever", "COND STOP", false);
        this.condStopLever.set(this.config.getNode("Flexowriter.condStopLever"));

        this.startReadLever = new FlexoLever(parent, null, null, "StartReadLever", "START READ", true);
        this.startReadLever.set(0);

        this.stopReadLever = new FlexoLever(parent, null, null, "StopReadLever", "STOP READ", true);
        this.stopReadLever.set(0);

        this.punchOnLever = new FlexoLever(parent, null, null, "PunchOnLever", "PUNCH ON", false);
        this.punchOnLever.set(this.config.getNode("Flexowriter.punchOnLever"));

        this.tapeFeedLever = new FlexoLever(parent, null, null, "TapeFeedLever", "TAPE FEED", true);
        this.tapeFeedLever.set(0);

        this.codeDeleteLever = new FlexoLever(parent, null, null, "CodeDeleteLever", "CODE DELETE", true);
        this.codeDeleteLever.set(0);
        this.manInputLever = new FlexoLever(parent, null, null, "ManInputLever", "MAN INPUT", false);
        this.manInputLever.set(this.config.getNode("Flexowriter.manInputLever"));

        this.startCompLever = new FlexoLever(parent, null, null, "StartCompLever", "START COMP", true);
        this.startCompLever.set(0);

        // Create the subordinate reader and punch devices.
        this.tapePunch = new FlexowriterTapePunch(this.context, this);
        this.tapeReader = new FlexowriterTapeReader(this.context, this);

        // Wire up Typewriter events.
        this.window.addEventListener("beforeunload", this.boundBeforeUnload);
        this.doc.body.addEventListener("keydown", this.boundPanelKeydown, false);
        this.doc.body.addEventListener("paste", this.boundPanelPaste, true);
        this.paperDoc.addEventListener("keydown", this.boundPanelKeydown, false);
        this.paperDoc.addEventListener("paste", this.boundPanelPaste, true);
        this.startReadLever.addEventListener("click", this.boundStartTapeRead);
        this.stopReadLever.addEventListener("click", this.boundStopTapeRead);
        this.startCompLever.addEventListener("click", this.boundStopTapeRead);
        this.$$("TypewriterMenuIcon").addEventListener("click", this.boundMenuClick, false);
        this.$$("TypeOMaticPanel").addEventListener("click", this.boundTOMPanelClick, false);

        // Recalculate scaling and offsets after initial window resize.
        this.config.restoreWindowGeometry(this.window,
                this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop);
    }

    /**************************************/
    enableSend() {
        /* Enables sending input codes to the Processor. If manual input is
        enabled, turns on the Manual Input lamp, otherwise starts the paper
        tape reader */

        if (!this.sendEnabled) {
            this.sendEnabled = true;
            if (!this.manInputLever.state) {
                this.tapeReader.read();         // runs async
            } else {
                this.manualInputLamp.set(1);
                this.enableTypeOMatic();
            }
        }
    }

    /**************************************/
    disableSend() {
        /* Disables sending codes to the Processor and tells the Processor
        to end its input and proceed */

        if (this.sendEnabled) {
            this.sendEnabled = false;
            this.manualInputLamp.set(0);        // regardless of whether the switch is set
            this.cancelTypeOMatic();
        }
    }

    /**************************************/
    cancel() {
        /* Cancels any input I/O currently in process */

        if (this.sendEnabled) {
            this.processor.receiveInputCode(-1);
        }

        this.disableSend();
        this.tapeReader.cancel();
    }

    /**************************************/
    parseTabStops(text, alertWin) {
        /* Parses a comma-delimited list of 1-relative tab stops. If the list is parsed
        successfully, returns an array of 0-relative tab stop positions; otherwise
        returns null. An alert is displayed on the window for the first parsing or
        out-of-sequence error */
        let copacetic = true;
        let tabStops = [];

        if (text.search(/\S/) >= 0) {
            let lastCol = 0;
            const cols = text.split(",");
            for (let item of cols) {
                const raw = item.trim();
                if (raw.length > 0) {       // ignore empty fields
                    const col = parseInt(raw, 10);
                    if (isNaN(col)) {
                        copacetic = false;
                        alertWin.alert(`Tab stop "${raw}" is not numeric`);
                        break; // out of for loop
                    } else if (col <= lastCol) {
                        copacetic = false;
                        alertWin.alert(`Tab stop "${raw}" is out of sequence`);
                        break; // out of for loop
                    } else {
                        lastCol = col;
                        tabStops.push(col-1);
                    }
                }
            } // for x
        }

        return (copacetic ? tabStops : null);
    }

    /**************************************/
    setUpperCase(upper) {
        /* Sets the shift case to upper-case (upper=true) or lower-case
        (upper=false) and updates the UC/LC indicators on the panel */

        if (upper) {
            this.upperCase = 1;
            this.ucBtn.checked = true;
        } else {
            this.upperCase = 0;
            this.lcBtn.checked = true;
        }
    }

    /**************************************/
    changeCaseShift(ev) {
        /* Event handler for clicks in the CaseIndicator <fieldset>. Allows
        changing the case of the typewriter manually */

        switch (ev.target.id) {
        case "LCBtn":
            this.setUpperCase(false);
            break;
        case "UCBtn":
            this.setUpperCase(true);
            break;
        }
    }

    /**************************************/
    changeColorShift(ev) {
        /* Event handler for clicks in the ColorIndicator <fieldset>. Allows
        changing the color of the typewriter ribbon manually */

        switch (ev.target.id) {
        case "BlackBtn":
            this.printBlack(true);
            break;
        case "RedBtn":
            this.printRed(true);
            break;
        }
    }

    /**************************************/
    startTapeRead() {
        /* Starts the paper-tape reader */

        this.tapeReader.read();         // runs async
    }

    /**************************************/
    stopTapeRead() {
        /* Stops the paper-tape reader. If sending to the Processor is enabled,
        sends a stop signal to the processor, which will terminate the INPUT
        instruction cause Processor to resume execution */

        this.tapeReader.cancel();
        if (this.sendEnabled) {
            this.processor.receiveInputCode(-1);
        }

        this.disableSend();
    }


    /*******************************************************************
    *  Typewriter Input                                                *
    *******************************************************************/

    /**************************************/
    flashInvalidKey() {
        /* Temporarily flashes the cursor character to indicate the keyboard
        is locked */
        const node = this.getLastPaperTextNode();

        node.nodeValue =
                node.nodeValue.slice(0, -1) + Flexowriter.invKeyChar;
        setTimeout(() => {
            node.nodeValue =
                    node.nodeValue.slice(0, -1) + Flexowriter.cursorChar;
        }, Flexowriter.invKeyFlashTime);
    }

    /**************************************/
    routeInput(code) {
        /* Routes an input character to the currently-enabled destinations.
        All input into the Flexowriter goes to the printer, and if enabled, to
        the paper-tape punch and/or the Processor as well */

        console.debug(`Route:       ${code.toString(16).padStart(2, "0")}  ${code.toString(2).padStart(6, "0")}`,
                ` @ ${this.nextCycleTime.toFixed(0)} ${(this.nextCycleTime - (this.lastCycleTime||0)).toFixed(1)}`);
        this.lastCycleTime = this.nextCycleTime;        // *** DEBUG ONLY ***

        this.printCode(code);

        // If input is pending to the processor, send the code.
        if (this.sendEnabled) {
            this.processor.receiveInputCode(code);
            if (code == IOCodes.ioCondStop) {
                this.disableSend();
            }
        }

        if (this.inputQueue.length > 0) {
            this.dequeueInput();
        }
    }

    /**************************************/
    dequeueInput() {
        /* Dequeues tape codes from the input queue for print, punch, or
        transmission to the processor. Throttles speed to the Flexowriter
        character cycle */

        if (this.inputQueue.length > 0) {
            const now = performance.now();
            const cyclePeriod = Math.max(Flexowriter.defaultCyclePeriod/Util.timingFactor,
                                         Flexowriter.minCyclePeriod);
            this.nextCycleTime += cyclePeriod;
            const delta = this.nextCycleTime - now;
            const code = this.inputQueue[0];    // *** DEBUG *** //
            console.debug(`Dequeue:     ${code.toString(16).padStart(2, "0")}  ${code.toString(2).padStart(6, "0")}  ` +
                                       `P=${cyclePeriod}, D=${delta}, T=${this.nextCycleTime}`);
            if (delta < 0) {                                // if it's in the past...
                this.nextCycleTime = now - now%cyclePeriod + cyclePeriod; // synchronize to the Flex cycle
                this.routeInput(this.inputQueue.shift());
            } else {
                this.cycleTimerToken = setTimeout(() => {
                    this.cycleTimerToken = 0;
                    if (this.inputQueue.length > 0) {
                        this.routeInput(this.inputQueue.shift());
                    } else {
                        console.debug("Dequeue >>> empty queue");
                    }
                }, delta);
            }
        }
    }

    /**************************************/
    enqueueInput(code) {
        /* Inserts a tape code into the input queue. If the queue was previously
        empty, starts the timed dequeue mechanism to work the queue */

        console.debug(`Enqueue:     ${code.toString(16).padStart(2, "0")}  ${code.toString(2).padStart(6, "0")}`);
        this.inputQueue.push(code);
        if (this.inputQueue.length == 1) {      // if was previously empty
            this.dequeueInput();                //     start the dequeue mechanism
        }
    }

    /**************************************/
    async panelKeydown(ev) {
        /* Handles the keydown event from the Flexowriter keyboard. If it's a
        valid LGP-21 keystroke, then enqueues it for further processing.
        Otherwise, simply pass along the keystroke to the next higher level
        in the browser for its default action */

        if (this.inputQueue.length > 1) {
            this.flashInvalidKey();     // allow one-key rollover
        } else if (ev.repeat) {
            // ignore repeating keys
        } else if (ev.ctrlKey || ev.altKey || ev.metaKey) {
            // ignore keystroke, allow default action
        } else {
            console.debug(`KeyDown: "${ev.key}"`);
            let code = -1;
            const key = ev.key;
            switch (key) {
            case "Shift":               // these keys are ignored and get passed up the chain
            case "CapsLock":
            case "NumLock":
            case "Meta":
                code = 0x1FF;           // dummy code to bypass calling flastInvKey()
                break;
            case " ":                   // Space is case-insensitive
                code = IOCodes.ioSpace;
                ev.preventDefault();
                ev.stopPropagation();
                this.enqueueInput(code);
                break;
            case "'":                   // Conditional Stop is case-insensitive
                code = IOCodes.ioCondStop;
                ev.preventDefault();
                ev.stopPropagation();
                this.enqueueInput(code);
                break;
            case "^":                   // Color Shift is case-insensitive
                code = IOCodes.ioColorShift;
                ev.preventDefault();
                ev.stopPropagation();
                this.enqueueInput(code);
                break;
            case "Backspace":
                code = IOCodes.ioBackspace;
                ev.preventDefault();
                ev.stopPropagation();
                this.enqueueInput(code);
                break;
            case "Enter":
                code = IOCodes.ioCarriageReturn;
                ev.preventDefault();
                ev.stopPropagation();
                this.enqueueInput(code);
                break;
            case "Tab":
                code = IOCodes.ioTab;
                ev.preventDefault();
                ev.stopPropagation();
                this.enqueueInput(code);
                break;
            default:
                code = Flexowriter.keyToTapeCode[key] ?? -1;
                if (code >= 0) {
                    ev.preventDefault();
                    ev.stopPropagation();

                    // Do any case shifting that's necessary.
                    const needsUpper = code & 0x80;
                    if (needsUpper != 0 && this.upperCase == 0) {
                        ////this.setUpperCase(true);
                        this.enqueueInput(IOCodes.ioUpperCase);
                    } else if (needsUpper == 0 && this.upperCase != 0) {
                        ////this.setUpperCase(false);
                        this.enqueueInput(IOCodes.ioLowerCase);
                    }

                    this.enqueueInput(code & 0x3F);
                }
                break;
            } // end switch (key)

            if (code < 0) {
                this.flashInvalidKey();
            }
        }
    }

    /**************************************/
    async forwardCode(code) {
        /* Handles codes read by the paper-tape reader or other external input
        device. Print, punches, and/or sends the code to the Processor as
        required. A negative code indicates the device has stopped reading */

        switch (code) {
        case -1:
            // We don't really care that the external device has stopped.
            break;
        default:
            this.enqueueInput(code);
            break;
        }
    }

    /**************************************/
    read() {
        /* Called by Processor when an INPUT command is initiated. If the
        Type-O-Matic buffer is active, initiates the sending of virtual
        keystrokes from the Type-O-Matic buffer */

        this.enableSend();
    }


    /*******************************************************************
    *  The Type-O-Matic                                                *
    *******************************************************************/

    /**************************************/
    openTypeOMaticPanel() {
        /* Opens the Type-O-Matic panel */

        this.$$("TypeOMaticPanel").style.display = "block";
    }

    /**************************************/
    closeTypeOMaticPanel() {
        /* Closes the Type-O-Matic panel */

        this.tomUpperCase = this.tomPaused = false;
        this.$$("TypeOMaticPanel").style.display = "none";
    }

    /**************************************/
    async enableTypeOMatic() {
        /* Handles submission of virtual keystrokes from the Type-O-Matic buffer.
        Continues submitting keystrokes until the buffer is empty or Type-O-Matic
        mode is paused or canceled */
        const tomPeriod = 1000/Math.min(Flexowriter.defaultCycleRate*Util.timingFactor, 2500); // ms
        let typing = this.tomIndex < this.tomLength && !this.tomPaused;

        let nextKeystrokeStamp = performance.now();
        this.openTypeOMaticPanel();
        this.tomUpperCase = this.upperCase != 0;

        this.tomCanceled = false;
        while (typing) {
            const key = this.tomBuffer[this.tomIndex];
            let code = IOCodes.ioTapeFeed;
            switch (key) {
            case " ":                   // Space is case-insensitive
                code = IOCodes.ioSpace;
                this.enqueueInput(code);
                break;
            case "'":                   // Conditional Stop is case-insensitive
                code = IOCodes.ioCondStop;
                this.enqueueInput(code);
                if (this.sendEnabled) {
                    typing = false;
                }
                break;
            case "^":                   // Color Shift is case-insensitive
                code = IOCodes.ioColorShift;
                this.enqueueInput(code);
                break;
            case "!":
                code = IOCodes.ioBackspace;
                this.enqueueInput(code);
                break;
            case "<":
                code = IOCodes.ioCarriageReturn;
                this.enqueueInput(code);
                break;
            case "|":
                code = IOCodes.ioTab;
                this.enqueueInput(code);
                break;
            default:
                code = Flexowriter.keyToTapeCode[key] ?? -1;
                if (code >= 0) {
                    // Do any case shifting that's necessary.
                    const needsUpper = code & 0x80;
                    if (needsUpper != 0 && !this.tomUpperCase) {
                        this.tomUpperCase = true;
                        this.enqueueInput(IOCodes.ioUpperCase);
                    } else if (needsUpper == 0 && this.tomUpperCase) {
                        this.tomUpperCase = false;
                        this.enqueueInput(IOCodes.ioLowerCase);
                    }

                    this.enqueueInput(code & 0x3F);
                }
                break;
            } // end switch (key)


            ++this.tomIndex;
            this.tomMeter.value = this.tomLength - this.tomIndex;
            if (this.tomIndex >= this.tomLength) {
                typing = false;
                this.closeTypeOMaticPanel();
            } else if (this.tomCanceled) {
                this.tomCanceled = false;
                typing = false;
            } else if (this.tomPaused) {
                typing = false;
            }
        }
    }

    /**************************************/
    cancelTypeOMatic() {
        /* Stops Type-O-Matic operation without clearing the buffer */

        this.tomCanceled = true;
    }

    /**************************************/
    pauseTypeOMatic(stopTyping) {
        /* Pauses Type-O-Matic operation without clearing the buffer */

        this.tomPaused = stopTyping;
        if (stopTyping) {
            this.$$("TypeOMaticPauseBtn").textContent = "Resume";
            this.$$("TypeOMaticPauseBtn").classList.add("paused");
        } else {
            this.$$("TypeOMaticPauseBtn").textContent = "Pause";
            this.$$("TypeOMaticPauseBtn").classList.remove("paused");
            this.enableTypeOMatic();
        }
    }

    /**************************************/
    stripComments(buf) {
        /* Strips "#" comments from a text buffer, returning a new buffer */

        return buf.replace(Flexowriter.commentRex, "")
                  .replace(Flexowriter.newLineRex, "");
    }

    /**************************************/
    panelPaste(ev) {
        /* Event handler for pasting into the FrontPanel. Appends the paste
        text to this.tomBuffer and opens the Type-O-Matic panel if needed */
        const text = (ev.clipboardData || window.clipboardData).getData("text");
        const tomActive = this.tomIndex < this.tomLength;

        ev.preventDefault();
        ev.stopPropagation();

        if (this.tomIndex >= this.tomLength) {
            this.tomBuffer = this.stripComments(text);
        } else {
            this.tomBuffer = this.tomBuffer.substring(this.tomIndex) + this.stripComments(text);
        }

        this.tomIndex = 0;
        this.tomLength = this.tomBuffer.length;
        this.tomMeter.value = this.tomLength;
        this.tomMeter.max = this.tomLength;
        this.openTypeOMaticPanel();
        if (!tomActive && !this.tomPaused) {
            this.enableTypeOMatic();
        }
    }

    /**************************************/
    tomPanelClick(ev) {
        /* Event handler for clicks in the Type-O-Matic panel */

        switch (ev.target.id) {
        case "TypeOMaticPauseBtn":
            this.pauseTypeOMatic(!this.tomPaused);
            break;
        case "TypeOMaticClearBtn":
            this.tomIndex = this.tomLength = 0;
            this.tomBuffer = "";
            this.tomPaused = false;
            this.$$("TypeOMaticPauseBtn").textContent = "Pause";
            this.$$("TypeOMaticPauseBtn").classList.remove("paused");
            this.closeTypeOMaticPanel();
            break;
        }
    }


    /*******************************************************************
    *  Typewriter Output                                               *
    *******************************************************************/

    /**************************************/
    getLastPaperTextNode() {
        /* Locates and returns the final text node in the "paper" element.
        This is necessary to descend through <span> elements used for printing
        in red */
        let node = this.paper.lastChild;

        while (node?.nodeType != Node.TEXT_NODE) {
            node = node.lastChild;
        }

        return node;
    }

    /**************************************/
    setPaperEmpty() {
        /* Empties the printer output "paper" and initializes it for new output */

        this.paper.textContent = "";
        this.isRed = false;
        this.paper.appendChild(this.doc.createTextNode(
                `${(" ").repeat(this.marginLeft)}${Flexowriter.cursorChar}`));
        this.printerLine = 0;
        this.printerCol = this.marginLeft;
        this.paper.scrollTop = this.paper.scrollHeight; // scroll to end
    }

    /**************************************/
    printNewLine() {
        /* Appends a newline to the current text node, and then a new text
        node to the end of the <pre> element within the paper element */
        let paper = this.paper;

        while (paper.childNodes.length > Flexowriter.maxScrollLines) {
            paper.removeChild(paper.firstChild);
        }

        const node = this.getLastPaperTextNode();
        const line = node.nodeValue;
        node.nodeValue = line.slice(0, -1) + "\n";
        paper.appendChild(this.doc.createTextNode(
                `${(" ").repeat(this.marginLeft)}${Flexowriter.cursorChar}`));
        if (this.isRed) {
            this.isRed = false;         // to force printRed() to do something
            this.printRed(true);
        }

        this.printerCol = this.marginLeft;
        ++this.printerLine;
        paper.scrollIntoView(false);
    }

    /**************************************/
    printTab() {
        /* Simulates tabulation by inserting an appropriate number of spaces */
        let tabCol = this.columns-1;    // tabulation column (defaults to end of carriage)

        for (const stop of this.tabStops) {
            if (stop > this.printerCol) {
                tabCol = Math.min(stop, tabCol);
                break; // out of for loop
            }
        } // for x

        while (this.printerCol < tabCol) {
            this.printChar(" ");        // output a space
            if (this.printerCol <= this.marginLeft) {
                break;                  // auto-return occurred
            }
        }
    }

    /**************************************/
    printBackspace() {
    /* Erases the last character output to the print line */

        if (this.printerCol > this.marginLeft) {
            const paper = this.paper;
            const node = this.getLastPaperTextNode();
            const line = node.nodeValue;

            if (line.length > 1) {
                // If the print line has at least two characters, we can simply
                // trim the cursor character and the one before it, then
                // re-append the cursor.
                node.nodeValue = `${line.slice(0, -2)}${Flexowriter.cursorChar}`;
            } else if (paper.firstChild !== paper.lastChild) {
                // Otherwise, if it's not the only node, it has just the cursor
                // character, so delete this node and examine the prior node.
                if (node.parentNode.nodeType == Node.ELEMENT_NODE && node.parentNode.tagName == "SPAN") {
                    // The parent is a red span, so delete the parent
                    paper.removeChild(node.parentNode);
                } else {
                    // Just delete the text node.
                    paper.removeChild(node);
                }

                // Now trim the last (non-cursor) character.
                let priorNode = paper.lastChild;
                let priorText = this.getLastPaperTextNode();
                if (priorText.length > 1) {
                    // If that node has at least two characters, just trim the last one.
                    priorText.nodeValue = priorText.nodeValue.slice(0, -1);
                } else {
                    // That node has only one character, so we need to delete it, too.
                    if (priorNode.parentNode.nodeType == Node.ELEMENT_NODE && priorNode.parentNode.tagName == "SPAN") {
                        paper.removeChild(priorNode.parentNode);
                    } else {
                        paper.removeChild(priorNode);
                    }

                    priorNode = paper.lastChild;        // get new priorNode
                    priorText = this.getLastPaperTextNode();
                }

                // Finally, append the cursor with current color to what's left.
                if (priorNode.nodeType == Node.TEXT_NODE && this.isRed) {
                    // Last is a text node but printing red, so append new red span.
                    this.isRed = false;         // so printRed() will do something
                    this.printRed(false);
                } else if (priorNode.nodeType == Node.ELEMENT_NODE && !this.isRed) {
                    // Last is a red span but printing black, so append a new text node.
                    this.isRed = true;          // so printBlack() will do something
                    this.printBlack(false);
                } else {
                    // Just append a cursor to the current text node.
                    priorText.nodeValue += Flexowriter.cursorChar;
                }
            }

            --this.printerCol;
        }
    }

    /**************************************/
    printChar(char) {
    /* Outputs the ANSI character "char" to the device */
        const node = this.getLastPaperTextNode();
        const line = node.nodeValue;

        if (this.printerCol < 1) {                      // first char on line
            node.nodeValue = `${char}${Flexowriter.cursorChar}`;
            this.printerCol = 1;
            this.paper.scrollTop = this.paper.scrollHeight;     // scroll line into view
        } else {
            if (this.printerCol > this.columns) {       // right margin overflow -- auto new line
                this.printNewLine();
                /***** Use this instead to stop at the right margin *****
                if (this.printerCol >= Flexowriter.maxCols) {
                    node.nodeValue =
                            `${line.substring(0, this.columns-1)}${Flexowriter.pillowChar}${Flexowriter.cursorChar}`;
                }
                ****** end stop at right margin *****/
            }

            node.nodeValue = `${line.slice(0, -1)}${char}${Flexowriter.cursorChar}`;    // print char
            ++this.printerCol;
        }
    }

    /**************************************/
    printRed(trimCursor) {
        /* Shifts to printing red if it's not already doing red */

        if (!this.isRed) {
            if (trimCursor) {
                const node = this.getLastPaperTextNode();
                node.nodeValue = node.nodeValue.slice(0, -1);
            }

            this.isRed = true;
            this.redBtn.checked = true;
            this.paper.appendChild(this.doc.createElement("SPAN"));
            this.paper.lastChild.className = "printRed";
            this.paper.lastChild.appendChild(this.doc.createTextNode(Flexowriter.cursorChar));
        }
    }

    /**************************************/
    printBlack(trimCursor) {
        /* Shifts back to printing black if it's already doing red */

        if (this.isRed) {
            if (trimCursor) {
                const node = this.getLastPaperTextNode();
                node.nodeValue = node.nodeValue.slice(0, -1);
            }

            this.isRed = false;
            this.blackBtn.checked = true;
            this.paper.appendChild(this.doc.createTextNode(Flexowriter.cursorChar));
        }
    }

    /**************************************/
    printCode(code) {
        /* Outputs one tape code to the typewriter printer, and if enabled,
        the paper-tape punch. This routines outputs immediately and unconditionally.
        The caller must take care of proper timing */
        const flexCode = code & 0x3F;

        if (Flexowriter.validCodes[flexCode]) {
            // Output to the typewriter.
            switch (flexCode) {
            case IOCodes.ioCarriageReturn:
                this.printNewLine();
                break;
            case IOCodes.ioTab:
                this.printTab();
                break;
            case IOCodes.ioLowerCase:
                this.setUpperCase(false);
                break;
            case IOCodes.ioUpperCase:
                this.setUpperCase(true);
                break;
            case IOCodes.ioColorShift:
                if (this.isRed) {
                    this.printBlack(true);
                } else {
                    this.printRed(true);
                }
                break;
            case IOCodes.ioBackspace:
                this.printBackspace();
                break;
            case IOCodes.ioTapeFeed:
            case IOCodes.ioDelete:
                // valid, but ignored by the typewriter
                break;
            default:
                if (this.upperCase) {
                    this.printChar(Flexowriter.upperGlyphs[flexCode]);
                } else {
                    this.printChar(Flexowriter.lowerGlyphs[flexCode]);
                }
                break;
            }

            // Output to the punch if it's on.
            if (this.punchOnLever.state) {
                this.tapePunch.write(flexCode);
            }
        }
    }

    /**************************************/
    write(code) {
        /* Receives a tape code from the Processor and enqueues it for output
        to the printer and (optionally) the paper-tape punch. If the code is
        accepted (the printer is idle), returns 0; otherwise returns -1. Note
        that when non-Flexowriter codes are "written", they still take a
        character time, even though nothing is output to the typewriter or punch */

        if (this.inputQueue.length) {
            return -1;                  // still busy from previous write
        } else {
            this.enqueueInput(code & 0x3F);
            return 0;
        }
    }

    /**************************************/
    extractPaper(ev) {
        /* Copies the text contents of the "paper" area of the device, opens a new
        temporary window, and pastes that text into the window so it can be copied
        or saved by the user */
        let text = this.paper.textContent;
        let title = "retro-lgp21 Typewriter Output";

        openPopup(this.window, "./FramePaper.html", "",
                "scrollbars,resizable,width=500,height=500",
                this, (ev) => {
            let doc = ev.target;
            let win = doc.defaultView;

            doc.title = title;
            win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
            doc.getElementById("Paper").textContent = text;
        });
    }

    /**************************************/
    savePaper() {
        /* Extracts the text of the Typewriter paper area, converts it to a
        DataURL, and constructs a link to cause the URL to be "downloaded" and
        stored on the local device */
        let text = this.paper.textContent;

        if (text[text.length-1] == "_") {       // strip the cursor character
            text = text.slice(0, -1);
        }

        if (text[text.length-1] != "\n") {      // make sure there's a final new-line
            text = text + "\n";
        }

        const url = `data:text/plain,${encodeURIComponent(text)}`;
        const hiddenLink = this.doc.createElement("a");

        hiddenLink.setAttribute("download", "retro-lgp21-Typewriter-Paper.txt");
        hiddenLink.setAttribute("href", url);
        hiddenLink.click();
    }

    /**************************************/
    menuOpen() {
        /* Opens the Typewriter menu panel and wires up events */

        this.$$("TypewriterMenu").style.display = "block";
        this.$$("TypewriterMenu").addEventListener("click", this.boundMenuClick, false);
    }

    /**************************************/
    menuClose() {
        /* Closes the Typewriter menu panel and disconnects events */

        this.$$("TypewriterMenu").removeEventListener("click", this.boundMenuClick, false);
        this.$$("TypewriterMenu").style.display = "none";
    }

    /**************************************/
    menuClick(ev) {
        /* Handles click for the menu icon and menu panel */

        switch (ev.target.id) {
        case "TypewriterMenuIcon":
            if (this.$$("TypewriterMenu").style.display == "block") {
                this.menuClose();
            } else {
                this.menuOpen();
            }
            break;
        case "TypewriterExtractBtn":
            this.extractPaper();
            break;
        case "TypewriterPrintBtn":
            this.platen.contentWindow.print();
            break;
        case "TypewriterSaveBtn":
            this.savePaper();
            break;
        case "TypewriterClearBtn":
            this.setPaperEmpty();
            //-no break -- clear always closes panel
        case "TypewriterCloseBtn":
            this.menuClose();
            break;
        }
    }

    /**************************************/
    beforeUnload(ev) {
        const msg = "Closing this window will make the panel unusable.\n" +
                    "Suggest you stay on the page and minimize this window instead";

        ev.preventDefault();
        ev.returnValue = msg;
        return msg;
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device */

        if (this.window) {
            this.tapeReader.cancel();
            this.cancelTypeOMatic();
            this.closeTypeOMaticPanel();
            this.$$("CaseIndicator").removeEventListener("click", this.boundChangeCaseShift, false);
            this.$$("ColorIndicator").removeEventListener("click", this.boundChangeColorShift, false);
            this.window.removeEventListener("beforeunload", this.boundBeforeUnload);
            this.doc.body.removeEventListener("keydown", this.boundPanelKeydown, false);
            this.doc.body.removeEventListener("paste", this.boundPanelPaste, true);
            this.paperDoc.removeEventListener("keydown", this.boundPanelKeydown, false);
            this.paperDoc.removeEventListener("paste", this.boundPanelPaste, true);
            this.startReadLever.removeEventListener("click", this.boundStartTapeRead);
            this.stopReadLever.removeEventListener("click", this.boundStopTapeRead);
            this.startCompLever.removeEventListener("click", this.boundStopRead);
            this.$$("TypewriterMenuIcon").removeEventListener("click", this.boundMenuClick, false);
            this.$$("TypeOMaticPanel").removeEventListener("click", this.boundTOMPanelClick, false);

            this.condStopLever.shutDown();
            this.startReadLever.shutDown();
            this.stopReadLever.shutDown();
            this.punchOnLever.shutDown();
            this.tapeFeedLever.shutDown();
            this.codeDeleteLever.shutDown();
            this.manInputLever.shutDown();
            this.startCompLever.shutDown();
            this.flexowriterPunch = null;
            this.flexowriterReader = null;

            this.window.close();
        }
    }

} // class Flexowriter
