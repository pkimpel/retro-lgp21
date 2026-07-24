/***********************************************************************
* retro-lgp-21/webUI FlexowriterTapePunch.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General Precision LGP-21 Tally 151 Paper Tape Punch device.
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
* Letter codes are interpreted case-insensitively. See the Flexowriter
* wiki page for details on this image format.
*
************************************************************************
* 2026-04-08  P.Kimpel
*   Original version, from retro-g15 PaperTapePunch.js.
***********************************************************************/

export {FlexowriterTapePunch};

import * as Util from "../emulator/Util.js";
import * as IOCodes from "../emulator/IOCodes.js";
import {Flexowriter} from "./Flexowriter.js";
import {openPopup, btoaUint8, computeTextPitch} from "./WebUIUtil.js";


class FlexowriterTapePunch {

    static bufferLimit = 0x3FFFF;       // maximum output that will be buffered (about 7 hours worth)


    // Public Instance Properties

    buffer = null;                      // internal tape image buffer
    bufLength = 0;                      // current 0-relative index into buffer
    busy = false;                       // an I/O is in progress
    cyclePeriod = 0;                    // current tape frame period
    doc = null;                         // window document object
    feeding = false;                    // true it forward/rewind tape feeding is in progress
    innerHeight = 0;                    // window specified innerHeight
    menuConfig = null;                  // object to store window sizing while menu is open
    menuOpened = false;                 // tape punch menu is currently open
    nextFrameStamp = 0;                 // time that the next frame can be sent
    tapeView = null;                    // tape characters view area
    tapeViewLength = 0;                 // chars that will fit in the TPView box
    window = null;                      // window object


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
        this.buffer = new Uint8Array(FlexowriterTapePunch.bufferLimit+1);

        this.boundMenuClick = this.menuClick.bind(this);
        this.boundFeedTape = this.feedTape.bind(this);
        this.boundDeleteCode = this.deleteCode.bind(this);

        this.setPunchEmpty();

        $$("PTMenuIcon").addEventListener("click", this.boundMenuClick);
        this.flexowriter.tapeFeedLever.addEventListener("mousedown", this.boundFeedTape);
        this.flexowriter.codeDeleteLever.addEventListener("mousedown", this.boundDeleteCode);

        // Do offsetting window resizes after loading calms down a bit to force
        // recalculation of the number of characters the PTView box can display.
        this.tapeView.value = "_";
        this.window.setTimeout(() => {
            this.window.resizeBy(-4, 0);
            this.window.setTimeout(() => {
                this.window.resizeBy(4, 0);
                this.tapeView.value = "";
            }, 500);
        }, 500);
    }

    /**************************************/
    resizeWindow(ev) {
        /* Handles the window onresize event. Calculates the width of the
        PTView text box element in terms of characters of monospaced text so
        we'll know how  much text to show in the PTView text box element
        without overflow (Chrome doesn't properly display text that exceeds the
        size of a right-justified text box) */

        const pitch = computeTextPitch(this.window, this.tapeView);
        this.tapeViewLength = Math.floor(this.tapeView.clientWidth/pitch);

        //console.debug("PTView Resize: avg pitch %s, sample length %i, TV width %i = TVLength %i",
        //          pitch.toFixed(3), sampleText.length, this.tapeView.clientWidth, this.tapeViewLength);

        if (this.tapeView.value.length > this.tapeViewLength) {
            this.tapeView.value = this.tapeView.value.slice(-this.tapeViewLength);
        }
    }

    /**************************************/
    updateTapeView(char) {
        /* Updates the TRTapeView display with the code just punched */
        const view = this.tapeView.value;           // current tape view contents

        if (view.length < this.tapeViewLength) {
            this.tapeView.value = view + char;
        } else {
            this.tapeView.value = view.slice(1-this.tapeViewLength) + char;
        }
    }

    /**************************************/
    setPunchEmpty() {
        /* Empties the punch output buffer */

        this.buffer.fill(0);            // punch output buffer
        this.bufLength = 0;             // current output buffer length (characters)
        this.tapeView.value = "";
        this.tapeView.classList.remove("bufferFull");
        this.feeding = false;
    }

    /**************************************/
    cancel() {
        /* Cancels the I/O currently in process */

        this.canceled = true;           // currently affects nothing
    }

    /**************************************/
    extractTape() {
        /* Copies the text contents of the punch buffer of the device, opens a
        new temporary window, and pastes that text into the window so it can be
        copied, printed, or saved by the user. All characters are ASCII according
        to the convention used by the retro-lgp21 Flexowriter */

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

        if (this.bufLength > 0) {
            const url = `data:text/plain,${encodeURIComponent(text)}`;
            const hiddenLink = this.doc.createElement("a");
            hiddenLink.setAttribute("download", "retro-lgp21-Flexowriter-Tape.ptx");
            hiddenLink.setAttribute("href", url);
            hiddenLink.click();
        }
    }

    /**************************************/
    saveAsPTP() {
        /* Converts the punch buffer to PTP format, builds a DataURL, and
        constructs a link to cause the URL to be "downloaded" to the local
        device */

        // Eventually btoaUint8() should be replaced with ArrayBuffer.toBase64().

        if (this.bufLength > 0) {
            const url = "data:application/octet-stream;base64," +
                        btoaUint8(this.buffer, 0, this.bufLength);
            const hiddenLink = this.doc.createElement("a");
            hiddenLink.setAttribute("download", "retro-lgp21-Flexowriter-Tape.ptp");
            hiddenLink.setAttribute("href", url);
            hiddenLink.click();
        }
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
        const char = IOCodes.ioTapeCodeToASCII[code];
        let result = 0;

        if (this.bufLength >= FlexowriterTapePunch.bufferLimit) {
            this.tapeView.classList.add("bufferFull");
            result = -1;
        } else {
            this.buffer[this.bufLength] = code;
            ++this.bufLength;
            this.updateTapeView(char);
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

                this.window.setTimeout(() => {
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

                this.window.setTimeout(() => {
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
        this.$$("PTMenuIcon").removeEventListener("click", this.boundMenuClick);
        this.flexowriter.tapeFeedLever.removeEventListener("mousedown", this.boundFeedTape);
        this.flexowriter.codeDeleteLever.removeEventListener("mousedown", this.boundDeleteCode);
    }
} // class FlexowriterTapePunch
