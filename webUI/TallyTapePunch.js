/***********************************************************************
* retro-lgp21/webUI TallyTapePunch.js
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
* 2026-06-22  P.Kimpel
*   Original version, from TallyTapeReader.js & FlexowriterTapeReader.js.
***********************************************************************/

export {TallyTapePunch};

import * as IOCodes from "../emulator/IOCodes.js";
import {Timer} from "../emulator/Util.js";
import {openPopup, btoaUint8, computeTextPitch} from "./WebUIUtil.js";

class TallyTapePunch {

    // Static properties

    static bufferLimit = 0x3FFFF;       // maximum output that will be buffered (almost an hour's worth)
    static defaultCycleRate = 60;       // punch speed, codes/sec
    static defaultCyclePeriod = 1000/TallyTapePunch.defaultCycleRate;
                                        // default punch period, ms/code
    static minCyclePeriod = 1000/2500;  // minimum character period, ms/char (2500 cps)
    static windowTopOffset = 260;       // offset from top of window to top of screen
    static windowHeight = 60;           // window innerHeight, pixels
    static windowWidth = 420;           // window innerWidth, pixels


    // Public Instance Properties

    buffer = null;                      // internal tape image buffer
    bufLength = 0;                      // current 0-relative index into buffer
    cyclePeriod = 0;                    // current tape frame period
    doc = null;                         // window document object
    feeding = false;                    // true it forward/rewind tape feeding is in progress
    frameTimer = new Timer();           // tape motion speed throttling timer
    innerHeight = 0;                    // window specified innerHeight
    menuConfig = null;                  // object to store window sizing while menu is open
    menuOpened = false;                 // tape punch menu is currently open
    nextFrameStamp = 0;                 // time that the next frame can be sent
    tapeView = null;                    // tape characters view area
    tapeViewLength = 0;                 // chars that will fit in the TPView box
    window = null;                      // window object


    constructor(context) {
        /* Initializes and wires up events for the Tally Tape Punch.
        "context" is an object passing other objects and callback functions from
        the global script:
            processor is the Processor object
        */

        this.context = context;
        this.config = context.config;
        this.processor = context.processor;
        this.buffer = new Uint8Array(TallyTapePunch.bufferLimit+1);

        this.boundMenuClick = this.menuClick.bind(this);
        this.boundFeedTape = this.feedTape.bind(this);
        this.boundResizeWindow = this.resizeWindow.bind(this);

        // Create the punch window.
        let geometry = this.config.formatWindowGeometry("TallyTapePunch");
        if (geometry.length) {
            [this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop] =
                    this.config.getWindowGeometry("TallyTapePunch");
        } else {
            this.innerWidth  = TallyTapePunch.windowWidth;
            this.innerHeight = TallyTapePunch.windowHeight;
            this.windowLeft =  8;
            this.windowTop =   TallyTapePunch.windowTopOffset;
            geometry = `,left=${this.windowLeft},top=${this.windowTop}` +
                       `,innerWidth=${this.innerWidth},innerHeight=${this.innerHeight}`;
        }

        openPopup(window, "../webUI/TallyTapePunch.html", "retro-lgp21.TallyTapePunch",
                "location=no,scrollbars,resizable" + geometry,
                this, this.punchOnLoad);
    }

    /**************************************/
    $$(id) {
        /* Returns a DOM element from its id property. Must not be called until
        punchOnLoad is called */

        return this.doc.getElementById(id);
    }

    /**************************************/
    punchOnLoad(ev) {
        /* Initializes the punch window and user interface */
        const prefs = this.config.getNode("TallyTapePunch");

        this.doc = ev.target;           // now we can use this.$$()
        this.window = this.doc.defaultView;
        this.doc.title = "retro-lgp21 Tally Tape Punch";

        this.tapeView = this.$$("TPView");

        // Events
        this.window.addEventListener("beforeunload", this.beforeUnload);
        this.window.addEventListener("resize", this.boundResizeWindow);
        this.$$("TPMenuIcon").addEventListener("click", this.boundMenuClick);
        this.$$("TPTapeFeedBtn").addEventListener("mousedown", this.boundFeedTape);
        this.$$("TPTapeFeedBtn").addEventListener("mouseup", this.boundFeedTape);

        // Recalculate scaling and offsets after initial window resize.
        this.config.restoreWindowGeometry(this.window,
                this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop);

        // Do offsetting window resizes after things calm down a bit to force
        // recalculation of the number of characters the TPView box can display.
        this.tapeView.value = "_";
        setTimeout(() => {
            this.window.resizeBy(-4, 0);
            setTimeout(() => {
                this.window.resizeBy(4, 0);
                this.tapeView.value = "";
            }, 500);
        }, 500);
    }

    /**************************************/
    calcTiming(basePeriod) {
        /* Calculates the duration of an operation relative to "basePeriod"
        and returns the period time. All timing is in terms of milliseconds */

        return Math.max(basePeriod/this.processor.disk.timingFactor, TallyTapePunch.minCyclePeriod);
    }

    /**************************************/
    beforeUnload(ev) {
        const msg = "Closing this window will make the device unusable.\n" +
                    "Suggest you stay on the page and minimize this window instead";

        ev.preventDefault();
        ev.returnValue = msg;
        return msg;
    }

    /**************************************/
    resizeWindow(ev) {
        /* Handles the window onresize event. Calculates the width of the
        TPView text box element in terms of characters of monospaced text so
        we'll know how  much text to show in the TPView text box element
        without overflow (Chrome doesn't properly display text that exceeds the
        size of a right-justified text box) */

        const pitch = computeTextPitch(this.window, this.tapeView);
        this.tapeViewLength = Math.floor(this.tapeView.clientWidth/pitch)-1;

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

        // Does nothing in this device (standard device API method).
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

            doc.title = "retro-lgp21 Tally Punch Output";
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
            hiddenLink.setAttribute("download", "retro-lgp21-Tally-Tape.ptx");
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

            hiddenLink.setAttribute("download", "retro-lgp21-Tally-Tape.ptp");
            hiddenLink.setAttribute("href", url);
            hiddenLink.click();
        }
    }

    /**************************************/
    menuOpen() {
        /* Opens the punch menu panel and wires up events */
        const punchMenu = this.$$("TPControlsMenu");

        if (!this.menuOpened) {
            // Resize and move the punch window to accommodate the menu panel.
            const config = {
                width:  this.window.outerWidth,
                height: this.window.outerHeight,
                left:   this.window.screenX,
                top:    this.window.screenY
            };

            let hMargin = screen.availWidth  - config.left - config.width  - 16;
            let vMargin = screen.availHeight - config.top  - config.height - 16;

            punchMenu.style.display = "block";
            const rect = punchMenu.getBoundingClientRect();
            let deltaWidth =  Math.max(rect.width + 8 - this.window.innerWidth, 0);
            let deltaHeight = rect.height + 8;
            let deltaX = Math.min(hMargin - config.deltaWidth, 0);
            let deltaY = Math.min(vMargin - config.deltaHeight, 0);

            if (deltaX != 0 || deltaY != 0) {
                this.window.moveBy(deltaX, deltaY);
            }

            this.window.resizeBy(deltaWidth, deltaHeight);

            this.menuConfig = config;   // save the config for menuClose to use
            punchMenu.addEventListener("click", this.boundMenuClick, false);
            this.menuOpened = true;
        }
    }

    /**************************************/
    menuClose() {
        /* Closes the punch menu panel and disconnects events */
        const punchMenu = this.$$("TPControlsMenu");
        const config = this.menuConfig;

        this.menuOpened = false;
        this.menuConfig = null;
        punchMenu.removeEventListener("click", this.boundMenuClick, false);
        punchMenu.style.display = "none";

        // Restore the punch window size and position.
        this.window.resizeTo(config.width, config.height);
        if (config.deltaX != 0 || config.deltaY != 0) {
            this.window.moveTo(config.left, config.top);
        }
    }

    /**************************************/
    menuClick(ev) {
        /* Handles click for the menu icon and menu panel */

        switch (ev.target.id) {
        case "TPMenuIcon":
            if (this.$$("TPControlsMenu").style.display == "block") {
                this.menuClose();
            } else {
                this.menuOpen();
            }
            break;
        case "TPSavePTXBtn":
            this.saveAsPTX();
            break;
        case "TPSavePTPBtn":
            this.saveAsPTP();
            break;
        case "TPExtractBtn":
            this.extractTape();
            break;
        case "TPClearBtn":
            this.setPunchEmpty();
            //-no break -- clear always closes panel
        case "TPMenuCloseBtn":
            this.menuClose();
            break;
        }
    }

    /**************************************/
    read(autostart) {
        /* Dummy method to satisfy the I/O driver API and return an error
        result if called */

        return -1;                      // just accept the code and ignore it
    }

    /**************************************/
    write(code) {
        /* Receives a tape code from the Processor and writes it to the punch.
        If the code is accepted (the punch is idle), returns 0; otherwise
        returns -1 */
        const now = performance.now();
        const delta = this.nextFrameStamp - now;

        if (delta > 0) {
            return -1;                  // still busy from previous write
        } else if (-delta > this.cyclePeriod) {
            // Has been idle for more than a cycle, so reset cycle period & nextFrameStamp.
            this.cyclePeriod = this.calcTiming(TallyTapePunch.defaultCyclePeriod);
            this.nextFrameStamp = now + this.cyclePeriod;
            return -1;
        } else {
            if (this.bufLength >= TallyTapePunch.bufferLimit) {
                this.tapeView.classList.add("bufferFull");
                return -1;
            } else {
                this.buffer[this.bufLength] = code;
                ++this.bufLength;
                this.updateTapeView(IOCodes.ioTapeCodeToASCII[code]);
                return 0;
            }
        }
    }

    /**************************************/
    feedTape(ev) {
        /* Event handler for the FEED TAPE button. Punches Tape-Feed codes
        manually. If the button is held down for more than 0.25 seconds, speeds
        up the tape motion until it reaches the default cycle rate */
        const char = IOCodes.ioTapeCodeToASCII[IOCodes.ioTapeFeed];
        let cyclePeriod = 250;          // initial inter-frame delay
        let timerToken = 0;

        const punchFrame = () => {
            if (this.feeding) {
                const now = performance.now();
                if (this.bufLength >= TallyTapePunch.bufferLimit) {
                    this.tapeView.classList.add("bufferFull");
                    feeding = false;
                } else {
                    this.buffer[this.bufLength] = IOCodes.ioTapeFeed;
                    ++this.bufLength;
                    this.updateTapeView(char);

                    this.nextFrameStamp += cyclePeriod;
                    timerToken = this.window.setTimeout(punchFrame, this.nextFrameStamp - now);
                    if (cyclePeriod > TallyTapePunch.defaultCyclePeriod) {
                        cyclePeriod *= 0.95;        // ramp up the tape speed
                    }
                }
            }
        };

        switch(ev.type) {
        case "mousedown":
            if (!this.feeding) {
                this.feeding = true;
                this.nextFrameStamp = performance.now();
                punchFrame();
            }
            break;
        case "mouseup":
            this.window.clearTimeout(timerToken);
            this.feeding = false;
            break;
        }
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device. If the window open failed and onLoad didn't
        run, do nothing because this.window, etc., didn't get initialized */

        if (this.window) {
            this.window.removeEventListener("beforeunload", this.beforeUnload);
            this.window.removeEventListener("resize", this.boundResizeWindow);
            this.$$("TPMenuIcon").removeEventListener("click", this.boundMenuClick);
            this.$$("TPTapeFeedBtn").removeEventListener("mousedown", this.boundFeedTape);
            this.$$("TPTapeFeedBtn").removeEventListener("mouseUp", this.boundFeedTape);

            this.config.putWindowGeometry(this.window, "TallyTapePunch");
            this.window.close();
        }
    }
} // class TallyTapePunch
