/***********************************************************************
* retro-lgp-21/webUI FlexowriterTapePunch.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* LGP-21 emulator Flexowriter tape punch.
*
* Defines the paper tape output device for the Flexowriter. See
* FlexowriterTapeReader.js for a description of the tape formats supported.
*
************************************************************************
* 2026-04-08  P.Kimpel
*   Original version, from retro-g15 PaperTapePunch.js.
***********************************************************************/

export {FlexowriterTapePunch};

import * as Util from "../emulator/Util.js";
import * as IOCodes from "../emulator/IOCodes.js";
import {Flexowriter} from "./Flexowriter.js";
import {openPopup} from "./PopupUtil.js";


class FlexowriterTapePunch {

    static bufferLimit = 0x3FFFF;       // maximum output that will be buffered (about 7 hours worth)


    constructor(context, flexowriter) {
        /* Initializes and wires up events for the Paper Tape punch.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            processor is the Processor object
        "flexowriter" is the parent Flexowriter object.
        */
        let $$ = this.$$ = flexowriter.$$.bind(flexowriter);
        this.processor = context.processor;
        this.flexowriter = flexowriter;
        this.window = flexowriter.window;
        this.doc = this.flexowriter.doc;
        this.tapeView = $$("PTView");
        this.tapeViewLength = 50;       // chars that will fit in the TapeView box
        this.feeding = false;           // true when punching Tape Feed or Delete codes
        this.buffer = new Uint8Array(FlexowriterTapePunch.bufferLimit+1);

        this.boundMenuClick = this.menuClick.bind(this);
        this.boundFeedTape = this.feedTape.bind(this);
        this.boundDeleteCode = this.deleteCode.bind(this);
        this.boundResizeWindow = this.resizeWindow.bind(this);

        this.clear();

        this.window.addEventListener("resize", this.boundResizeWindow);
        $$("PTMenuIcon").addEventListener("click", this.boundMenuClick);
        this.flexowriter.tapeFeedLever.addEventListener("mousedown", this.boundFeedTape);
        this.flexowriter.codeDeleteLever.addEventListener("mousedown", this.boundDeleteCode);

        // Do offsetting window resizes after loading calms down a bit to force
        // recalculation of the number of characters the TapeView box can display.
        this.tapeView.value = "_";
        setTimeout(() => {
            this.window.resizeBy(-4, 0);
            setTimeout(() => {
                this.window.resizeBy(4, 0);
                this.tapeView.value = " ";
            }, 500);
        }, 500);
    }

    /**************************************/
    clear() {
        /* Initializes (and if necessary, creates) the punch unit state */

        this.canceled = false;          // current I/O canceled
        this.setPunchEmpty();
    }

    /**************************************/
    resizeWindow(ev) {
        /* Handles the window onresize event. Calculates the width of the
        TapeView text box element in terms of characters of monospaced text so
        we'll know how  much text to show in the TapeView text box element
        without overflow (Chrome doesn't properly display text that exceeds the
        size of a right-justified text box). Adapted from retro-1620 and
        https://www.geeksforgeeks.org/calculate-the-width-of-the-text-in-javascript/ */
        const getCssStyle = (e, prop) => {
            return this.window.getComputedStyle(e, null).getPropertyValue(prop);
        }

        // Determine the current font properties for TapeView.
        const fontWeight = getCssStyle(this.tapeView, 'font-weight') || 'normal';
        const fontSize = getCssStyle(this.tapeView, 'font-size') || '12px';
        const fontFamily = getCssStyle(this.tapeView, 'font-family') || 'monospace';

        // Create a temporary Canvas element and set its font.
        const canvas = document.createElement("canvas");
        const dc = canvas.getContext("2d");
        const fontSpecs = `${fontWeight} ${fontSize} ${fontFamily}`;
        dc.font = fontSpecs;

        // Compute the width of some sample text and from that the number of
        // characters that will fit in the TapeView box.
        const sample = ("ABCDEFGHIJKLMNOPQRSTUVWXYZ.(-+;/.,'*_ (0123456789|)");
        const textSpecs = dc.measureText(sample);
        const sampleWidth = textSpecs.width;
        this.tapeViewLength = Math.floor(sample.length/sampleWidth*this.tapeView.clientWidth);
        //console.debug("PT Resize: font specs %s, sample length %i / width %f * TV width %i = TVLength %i",
        //          fontSpecs, sample.length, sampleWidth, this.tapeView.clientWidth, this.tapeViewLength);
        if (this.tapeView.value.length > this.tapeViewLength) {
            this.tapeView.value = this.tapeView.value.slice(-this.tapeViewLength);
        }
    }

    /**************************************/
    setPunchEmpty() {
        /* Empties the punch output buffer */

        this.buffer.fill(0);            // punch output buffer
        this.bufLength = 0;             // current output buffer length (characters)
        this.tapeView.value = "";
        this.feeding = false;
    }

    /**************************************/
    cancel() {
        /* Cancels the I/O currently in process */

        this.canceled = true;           // currently affects nothing
    }

    /**************************************/
    btoaUint8(bytes, start, end) {
        /* Converts a Uint8Array directly to base-64 encoding without using
        window.btoa and returns the base-64 string. "start" is the 0-relative
        index to the first byte; "end" is the 0-relative index to the ending
        byte + 1. Adapted from https://gist.github.com/jonleighton/958841 */
        let b64 = "";
        const byteLength = end - start;
        const remainderLength = byteLength % 3;
        const mainLength = byteLength - remainderLength;

        const encoding = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

        // Main loop deals with bytes in chunks of 3.
        for (let i=start; i<mainLength; i+=3) {
            // Combine the three bytes into a single integer.
            const chunk = (((bytes[i] << 8) | bytes[i+1]) << 8) | bytes[i+2];

            // Extract 6-bit segments from the triplet and convert to the ASCII encoding.
            b64 += encoding[(chunk & 0xFC0000) >> 18] +
                   encoding[(chunk &  0x3F000) >> 12] +
                   encoding[(chunk &    0xFC0) >>  6] +
                   encoding[chunk &      0x3F];
        }

        // Deal with any remaining bytes and padding.
        if (remainderLength == 1) {
           // Encode the high-order 6 and low-order 2 bits, and add padding.
           const chunk = bytes[mainLength];
           b64 += encoding[(chunk & 0xFC) >> 2] +
                  encoding[(chunk & 0x03) << 4] + "==";
        } else if (remainderLength == 2) {
           // Encode the high-order 6 bits of the first byte, plus the low-order
           // 2 bits of the first byte with the high-order 4 bits of the second
           // byte, and add padding.
           const chunk = (bytes[mainLength] << 8) | bytes[mainLength+1];
           b64 += encoding[(chunk & 0xFC00) >> 10] +
                  encoding[(chunk &  0x3F0) >> 4] +
                  encoding[(chunk &    0xF) << 2] + "=";
        }

        return b64;
    }

    /**************************************/
    extractTape() {
        /* Copies the text contents of the "paper" area of the device, opens a new
        temporary window, and pastes that text into the window so it can be copied
        or saved by the user */

        openPopup(this.window, "./FramePaper.html", "",
                "scrollbars,resizable,width=500,height=500",
                this, (ev) => {
            const doc = ev.target;
            const win = doc.defaultView;
            const buf = this.buffer;
            const len = this.bufLength;
            let text = "";

            for (let x=0; x<len; ++x) {
                const code = buf[x];
                text += IOCodes.ioTapeCodeToASCII[code];
                if (code == IOCodes.ioCarriageReturn) {
                    text += "\n";
                }
            }

            doc.title = "retro-lgp21 Flexowriter Punch Output";
            win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
            doc.getElementById("Paper").textContent = text;
        });
    }

    /**************************************/
    saveAsPTX() {
        /* Converts the punch buffer to PTX format, builds a DataURL, and
        constructs a link to cause the URL to be "downloaded" to the local
        device */
        const buf = this.buffer;
        const len = this.bufLength;
        let text = "";

        for (let x=0; x<len; ++x) {
            const code = buf[x];
            text += IOCodes.ioTapeCodeToASCII[code];
            if (code == IOCodes.ioCarriageReturn) {
                text += "\n";
            }
        }

        if (!text.endsWith("\n")) {     // make sure there's a final new-line
            text += "\n";
        }

        const url = `data:text/plain,${encodeURIComponent(text)}`;
        const hiddenLink = this.doc.createElement("a");
        hiddenLink.setAttribute("download", "retro-lgp21-Flexowriter-Tape.ptx");
        hiddenLink.setAttribute("href", url);
        hiddenLink.click();
    }

    /**************************************/
    saveAsPTP() {
        /* Converts the punch buffer to PTP format, builds a DataURL, and
        constructs a link to cause the URL to be "downloaded" to the local
        device */

        const url = "data:application/octet-stream;base64," +
                    this.btoaUint8(this.buffer, 0, this.bufLength);
        const hiddenLink = this.doc.createElement("a");
        hiddenLink.setAttribute("download", "retro-lgp21-Flexowriter-Tape.ptp");
        hiddenLink.setAttribute("href", url);
        hiddenLink.click();
    }

    /**************************************/
    menuOpen() {
        /* Opens the punch menu panel and wires up events */
        const ptMenu = this.$$("PTControlsMenu");

        if (ptMenu.style.display != "block") {
            ptMenu.style.display = "block";
            ptMenu.addEventListener("click", this.boundMenuClick, false);
        }
    }

    /**************************************/
    menuClose() {
        /* Closes the punch menu panel and disconnects events */

        this.$$("PTControlsMenu").removeEventListener("click", this.boundMenuClick, false);
        this.$$("PTControlsMenu").style.display = "none";
    }

    /**************************************/
    menuClick(ev) {
        /* Event handler for the punch menu */

        switch (ev.target.id) {
        case "PTMenuIcon":
            if (this.$$("PTControlsMenu").style.display == "block") {
                this.menuClose();
            } else {
                this.menuOpen();
            }
            break;
        case "PTSavePTXBtn":
            this.saveAsPTX();
            break;
        case "PTSavePTPBtn":
            this.saveAsPTP();
            break;
        case "PTExtractBtn":
            this.extractTape();
            break;
        case "PTClearBtn":
            this.setPunchEmpty();
            //-no break -- clear always closes panel
        case "PTMenuCloseBtn":
            this.menuClose();
            break;
        }
    }

    /**************************************/
    write(code) {
        /* Writes one tape code to the punch. The physical punch device
        operates at 10 characters/second, but the speed is controlled by the
        parent Flexowriter device. The parent device will also filter out
        non-Flexowriter tape codes. Returns 0 if successful or -1 if the
        code cannot be written (due to buffer full) */
        let char = IOCodes.ioTapeCodeToASCII[code];
        let result = 0;

        if (this.bufLength >= FlexowriterTapePunch.bufferLimit) {
            result = -1;
        } else {
            this.buffer[this.bufLength] = code;
            ++this.bufLength;

            // Update the tape view control
            let view = this.tapeView.value; // current tape view contents
            if (view.length < this.tapeViewLength) {
                this.tapeView.value = view + char;
            } else {
                this.tapeView.value = view.slice(1-this.tapeViewLength) + char;
            }
        }

        return result;
    }

    /**************************************/
    feedTape() {
        /* Event handler for the Tape Feed lever. Feeds one blank frame of
        paper tape. If the lever is held down for more than a character cycle
        time, continues feeding at the character cycle rate */
        let cyclePeriod = Flexowriter.defaultCyclePeriod;

        if (!this.flexowriter.codeDeleteLever.state) {
            if (!this.flexowriter.punchOnLever.state) {
                this.feeding = false;
            } else {
                this.write(IOCodes.ioTapeFeed);
                if (!this.feeding) {
                    this.feeding = true;
                    cyclePeriod *= 2.5;     // longer initial delay to debounce the lever switch
                }

                setTimeout(() => {
                   if (this.flexowriter.tapeFeedLever.state) {
                       this.feedTape();
                   } else {
                       this.feeding = false;
                   }
                }, cyclePeriod);
            }
        }
    }

    /**************************************/
    deleteCode() {
        /* Event handler for the CodeDelete lever. Punches one rubout frame of
        paper tape. If the lever is held down for more than a character cycle
        time, continues punching at the character cycle rate */
        let cyclePeriod = Flexowriter.defaultCyclePeriod;

        if (!this.flexowriter.tapeFeedLever.state) {
            if (!this.flexowriter.punchOnLever.state) {
                this.feeding = false;
            } else {
                this.write(IOCodes.ioDelete);
                if (!this.feeding) {
                    this.feeding = true;
                    cyclePeriod *= 2.5;     // longer initial delay to debounce the lever switch
                }

                setTimeout(() => {
                   if (this.flexowriter.codeDeleteLever.state) {
                       this.deleteCode();
                   } else {
                       this.feeding = false;
                   }
                }, cyclePeriod);
            }
        }
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device */

        this.menuClose();
        this.window.removeEventListener("resize", this.boundResizeWindow);
        this.$$("PTMenuIcon").removeEventListener("click", this.boundMenuClick);
        this.flexowriter.tapeFeedLever.removeEventListener("mousedown", this.boundFeedTape);
        this.flexowriter.codeDeleteLever.removeEventListener("mousedown", this.boundDeleteCode);
    }
} // class FlexowriterTapePunch
