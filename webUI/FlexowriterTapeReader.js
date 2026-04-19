/***********************************************************************
* retro-lgp21/webUI FlexowriterTapeReader.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* LGP-21 emulator paper tape reader. Defines the paper tape input device
* for the Flexowriter.
*
* There are two paper-tape image formats. The first is ".ptp", used for
* binary tape images. Each tape frame is represented as one byte with the
* bits arranged thus:
*
*       _ _ 6 1 2.3 4 5
*
* where the bits are numbered according to the convention used by the
* LGP-21 processor. The "_" are unused bits and should be zero. The "."
* represents the location of the sprocket hole in the tape. Bits 6 and 5
* are zone bits. Internally, the processor rotates the code to read as
* 123456, so that both zone bits are on the low-order end.
*
* The second format is ".ptx". This format represents a tape as ASCII
* text using mostly the same codes as would be typed on the Flexowriter.
* Letter codes are interpreted case-insensitively.
*
************************************************************************
* 2026-04-16  P.Kimpel
*   Original version, from retro-g15 PaperTapeReader.js.
***********************************************************************/

export {FlexowriterTapeReader};

import * as Util from "../emulator/Util.js";
import * as IOCodes from "../emulator/IOCodes.js";
import {Flexowriter} from "./Flexowriter.js";


class FlexowriterTapeReader {

    // Static properties

    static defaultFrameRate = 571/60;   // default reading rate, frames/sec
    static defaultFramePeriod = 1000/FlexowriterTapeReader.defaultFrameRate;
                                        // default single-frame time, ms

    static commentRex = /#[^\x0D\x0A]*/g;
    static newLineRex = /[\x0D\x0A\x0C]+/g;

    constructor(context, flexowriter) {
        /* Initializes and wires up events for the Paper Tape Reader.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            processor is the Processor object
        "flexowriter" is the parent Flexowriter object.
        */
        let $$ = this.$$ = flexowriter.$$.bind(flexowriter);
        this.processor = context.processor;
        this.flexowriter = flexowriter;
        this.tapeSupplyBar = $$("PRTapeSupplyBar");
        this.readerCaption = $$("PRCaption");
        this.timer = new Util.Timer();

        this.boundMenuClick = this.menuClick.bind(this);
        this.boundFileSelectorChange = this.fileSelectorChange.bind(this);

        this.clear();                                   // creates additional instance variables

        $$("PRMenuIcon").addEventListener("click", this.boundMenuClick);
    }

    /**************************************/
    clear() {
        /* Initializes (and if necessary, creates) the reader unit state */

        this.ready = false;             // a tape has been loaded into the reader
        this.busy = false;              // an I/O is in progress
        this.canceled = false;          // current I/O canceled

        this.buffer = null;             // reader input buffer (paper-tape reel)
        this.bufLength = 0;             // current input buffer length (characters)
        this.bufIndex = 0;              // 0-relative offset to next character to be read
        this.nextStartStamp = 0;        // earliest time next read can start

        this.makeBusy(false);
        this.setReaderEmpty();
    }

    /**************************************/
    makeBusy(busy) {
        /* Makes the reader busy (I/O in progress) or not busy (idle) */

        this.busy = busy;
    }

    /**************************************/
    cancel() {
        /* Cancels the I/O currently in process */

        if (this.busy) {
            this.canceled = true;
        }
    }

    /**************************************/
    setReaderEmpty() {
        /* Sets the reader to a not-ready status and empties the buffer */

        this.ready = false;
        this.tapeSupplyBar.value = 0;
        this.buffer = "";                   // discard the input buffer
        this.bufLength = 0;
        this.bufIndex = 0;
        this.$$("PRFileSelector").value = null; // reset the control so the same file can be reloaded
        this.$$("PRFormatSelect").selectedIndex = 0;    // default to Auto
    }

    /**************************************/
    stripComments(buf) {
        /* Strips "#" comments from a text buffer, returning a new buffer */

        return buf.replace(FlexowriterTapeReader.commentRex, "")
                  .replace(FlexowriterTapeReader.newLineRex, "");
    }

    /**************************************/
    prepareBuffer(imageLength) {
        /* Prepares this.buffer for more image data by assuring that there is
        sufficient room, resizing it if necessary. If any existing buffer has
        been read to its end, the buffer is treated as empty and its existing
        image data is discarded */
        let bufIndex = this.bufIndex;
        let bufLength = this.bufLength;

        if (!this.buffer) {
            this.buffer = new Uint8Array(imageLength);
            bufIndex = bufLength = 0;
        }

        if (this.buffer.length - bufLength < imageLength) {
            // Not enough room in the current buffer, so resize it
            const oldBuf = this.buffer;
            this.buffer = new Uint8Array(bufLength + imageLength);
            this.buffer.set(oldBuf, 0);
            bufLength += imageLength;
        }

        this.bufIndex = bufIndex;
        this.bufLength = bufLength;
    }

    /**************************************/
    loadAsPTP(arrayBuffer) {
        /* Load the image file as binary in .ptp format, which directly
        represents LGP-21 tape codes */
        const image = new Uint8Array(arrayBuffer);
        const imageLength = image.length;
        let bufLength = this.bufLength;

        console.debug("loadAsPTP");
        this.prepareBuffer(imageLength);
        bufLength = this.bufLength;

        for (let x=0; x<imageLength; ++x) {
            this.buffer[bufLength++] = image[x] & 0b11111;
        }

        this.bufLength = bufLength;
        this.$$("PRTapeSupplyBar").max = bufLength;
        this.$$("PRTapeSupplyBar").value = bufLength - this.bufIndex;
        this.ready = true;
    }

    /**************************************/
    loadAsPTX(image) {
        /* Load the image file as ASCII text in .ptx format and converts it to
        LGP-21 tape codes. Simply bypasses any invalid tape image characters
        and comments as if they did not exist. */
        const text = this.stripComments(image);
        const imageLength = text.length;
        let code = 0;

        console.debug("loadAsPTX");
        this.prepareBuffer(imageLength);
        let bufLength = this.bufLength;

        for (const char of text) {
            code = IOCodes.ioASCIIToTapeCode[char.charCodeAt(0) & 0x7F];
            if (code < 0xFF) {          // not an ignored character
                this.buffer[bufLength++] = code;
            }
        }

        this.bufLength = bufLength;
        this.$$("PRTapeSupplyBar").max = bufLength;
        this.$$("PRTapeSupplyBar").value = bufLength - this.bufIndex;
        this.ready = true;
    }

    /**************************************/
    async fileSelectorChange(ev) {
        /* Handle the <input type=file> onchange event when files are selected.
        For each file, load it and add it to the input buffer of the reader */
        const fileList = ev.target.files;
        const formatSelect = this.$$("PRFormatSelect");
        const formatIndex = formatSelect.selectedIndex;
        let tapeFormat = "Auto";

        if (formatIndex > 0) {
            tapeFormat = formatSelect.options[formatIndex].value;
        }

        if (!this.busy) {
            for (const file of fileList) {
                const fileName = file.name;
                let readAs = tapeFormat;
                if (tapeFormat == "Auto") {
                    let x = fileName.lastIndexOf(".");
                    readAs = x < 0 ? ".ptp" : fileName.substring(x).toLowerCase();
                }

                console.debug(`readAs ${readAs} ${fileName} ${file.size} bytes`);
                switch (readAs) {
                case ".ptx":
                    this.loadAsPTX(await file.text());
                    break;
                default:
                    this.loadAsPTP(await file.arrayBuffer());
                    break;
                }
            }
        }
    }

    /**************************************/
    menuOpen() {
        /* Opens the reader menu panel and wires up events */
        const prMenu = this.$$("PRControlsMenu");

        if (prMenu.style.display != "block") {
            prMenu.style.display = "block";
            prMenu.addEventListener("click", this.boundMenuClick, false);
            this.$$("PRFileSelector").addEventListener("change", this.boundFileSelectorChange);
        }
    }

    /**************************************/
    menuClose() {
        /* Closes the punch menu panel and disconnects events */
        const prMenu = this.$$("PRControlsMenu");

        prMenu.removeEventListener("click", this.boundMenuClick, false);
        prMenu.style.display = "none";
        this.$$("PRFileSelector").removeEventListener("change", this.boundFileSelectorChange);
    }

    /**************************************/
    menuClick(ev) {
        /* Event handler for the reader menu */

        switch (ev.target.id) {
        case "PRMenuIcon":
            if (this.$$("PRControlsMenu").style.display == "block") {
                this.menuClose();
            } else {
                this.menuOpen();
            }
            break;
        case "PRUnloadBtn":
            this.setReaderEmpty();
            break;
        case "PRMenuCloseBtn":
            this.menuClose();
            break;
        }
    }

    /**************************************/
    async read() {
        /* Initiates the Paper Tape Reader to begin sending frame codes to the
        Flexowriter for printing, punching, and/or forwarding to the Processor's
        I/O subsystem. Reads until a COND STOP code is sensed, the end of the
        tape buffer is encountered, or a cancel request is received. Calls the
        Flexowriter's forwardCode() function with a non-negative tape code for
        each frame read, including the stop code, or -1 if the read is canceled,
        or there is no tape in the reader, or end-of-tape occurs. Frames are
        read and passed on at the reader's rated speed */

        if (this.busy) {
            return;                     // already reading
        }

        const cyclePeriod = Math.max(Flexowriter.defaultCyclePeriod/Util.timingFactor,
                                     Flexowriter.minCyclePeriod);
        let bufLength = this.bufLength; // current buffer length
        let code = 0;                   // current LGP-21 tape code
        let eob = false;                // end-of-block flag
        let nextFrameStamp = performance.now(); // time of next character frame
        let x = this.bufIndex;          // current buffer index

        this.canceled = false;
        this.makeBusy(true);
        this.readerCaption.classList.add("active");

        // Synchronize timing to the Flexowriter's cycle.
        if (this.nextStartStamp > nextFrameStamp) {     // still busy from last read
            nextFrameStamp = this.nextStartStamp;
        } else {
            nextFrameStamp = nextFrameStamp - nextFrameStamp%cyclePeriod + cyclePeriod;
        }

        // Read tape frames.
        do {
            // Wait for the next frame time.
            await this.timer.delayUntil(nextFrameStamp);
            nextFrameStamp += cyclePeriod;

            // Get the next frame.
            if (this.canceled) {                // canceled by the Flexowriter
                await this.flexowriter.forwardCode(-1);
                this.canceled = false;
                eob = true;
            } else if (x >= bufLength) {        // end of buffer
                await this.flexowriter.forwardCode(-1);
                eob = true;
            } else {
                code = this.buffer[x];
                ++x;
                this.tapeSupplyBar.value = bufLength-x;
                if (code == IOCodes.ioCondStop && !this.flexowriter.condStopLever.state) {
                    eob = true;                 // stop the reader
                }

                // Send the tape code to the Processor.
                await this.flexowriter.forwardCode(code);
            }
        } while (!eob);

        this.bufIndex = x;
        this.makeBusy(false);
        this.nextStartStamp = nextFrameStamp;
        this.readerCaption.classList.remove("active");
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device */

        this.timer.clear();
        $$("PRMenuIcon").removeEventListener("click", this.boundMenuClick);
    }
}
