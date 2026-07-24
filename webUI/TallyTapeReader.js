/***********************************************************************
* retro-lgp21/webUI TallyTapeReader.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General Precision LGP-21 Tally 141 Paper Tape Reader device.
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
* The reader allows multiple tape image files to be loaded to its
* internal buffer. Once loaded, however, the image files are treated
* as if they had been spliced, and are treated as one continugous tape.
*
************************************************************************
* 2026-06-16  P.Kimpel
*   Original version, from FlexowriterTapeReader.js.
***********************************************************************/

export {TallyTapeReader};

import * as IOCodes from "../emulator/IOCodes.js";
import {Timer} from "../emulator/Util.js";
import {WaitSignal} from "../emulator/WaitSignal.js";
import {openPopup, computeTextPitch} from "./WebUIUtil.js";

class TallyTapeReader {

    // Static properties

    static defaultCycleRate = 60;       // reader speed, codes/sec
    static defaultCyclePeriod = 1000/TallyTapeReader.defaultCycleRate;
                                        // default read period, ms/code
    static maxFeedPeriod = 1000/300;    // max forward tape feed speed, ms/code
    static minCyclePeriod = 1000/2500;  // minimum character period, ms/char (2500 cps)

    static windowTopOffset = 100;       // offset from top of window to top of screen
    static windowHeight = 80;           // window innerHeight, pixels
    static windowWidth = 420;           // window innerWidth, pixels

    static forwardArrowHead = "\u2BC8"; // right-pointing arrowhead     was: \u2B9E
    static rewindArrowHead = "\u2BC7";  // left-pointing arrowhead      was: \u2B9C
    static commentRex = /#[^\x0D\x0A]*/g;
    static newLineRex = /[\x0D\x0A\x0C]+/g;


    // Public Instance Properties

    buffer = null;                      // internal tape image buffer
    bufIndex = 0;                       // current 0-relative index into buffer
    bufLength = 0;                      // current length of buffer
    bufLoaded = new WaitSignal();       // signal that buffer is no longer empty
    busy = false;                       // an I/O is in progress
    cyclePeriod = 0;                    // current tape frame period
    doc = null;                         // window document object
    feeding = false;                    // true it forward/rewind tape feeding is in progress
    frameTimer = new Timer();           // tape motion speed throttling timer
    innerHeight = 0;                    // window specified innerHeight
    menuConfig = null;                  // object to store window sizing while menu is open
    menuOpened = false;                 // tape reader menu is currently open
    nextFrameStamp = 0;                 // time that the next frame can be sent
    ready = false;                      // a tape has been loaded into the reader
    tapeSupplyBar = null;               // input buffer meter bar
    tapeView = null;                    // tape characters view area
    tapeViewLength = 0;                 // chars that will fit in the TRView box
    window = null;                      // window object


    constructor(context) {
        /* Initializes and wires up events for the Tally Tape Reader.
        "context" is an object passing other objects and callback functions from
        the global script:
            config is the SystemConfig object
            processor is the Processor object
        */

        this.context = context;
        this.config = context.config;
        this.processor = context.processor;

        this.boundFeedForward = this.feedForward.bind(this);
        this.boundFeedRewind = this.feedRewind.bind(this);
        this.boundFileSelectorChange = this.fileSelectorChange.bind(this);
        this.boundFormatSelectChange = this.formatSelectChange.bind(this);
        this.boundMenuClick = this.menuClick.bind(this);
        this.boundRewindReader = this.rewindReader.bind(this);
        this.boundResizeWindow = this.resizeWindow.bind(this);

        // Create the reader window.
        let geometry = this.config.formatWindowGeometry("TallyTapeReader");
        if (geometry.length) {
            [this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop] =
                    this.config.getWindowGeometry("TallyTapeReader");
        } else {
            this.innerWidth  = TallyTapeReader.windowWidth;
            this.innerHeight = TallyTapeReader.windowHeight;
            this.windowLeft =  8;
            this.windowTop =   TallyTapeReader.windowTopOffset;
            geometry = `,left=${this.windowLeft},top=${this.windowTop}` +
                       `,innerWidth=${this.innerWidth},innerHeight=${this.innerHeight}`;
        }

        openPopup(window, "../webUI/TallyTapeReader.html", "retro-lgp21.TallyTapeReader",
                "location=no,scrollbars,resizable" + geometry,
                this, this.readerOnLoad);
    }

    /**************************************/
    $$(id) {
        /* Returns a DOM element from its id property. Must not be called until
        readerOnLoad is called */

        return this.doc.getElementById(id);
    }

    /**************************************/
    readerOnLoad(ev) {
        /* Initializes the reader window and user interface */
        //const prefs = this.config.getNode("TallyTapeReader");

        this.doc = ev.target;           // now we can use this.$$()
        this.window = this.doc.defaultView;
        this.doc.title = "retro-lgp21 Tally Tape Reader";

        this.bufferLevel = this.$$("TRBufferLevel");
        this.fileSelector = this.$$("TRFileSelector");
        this.tapeSupplyBar = this.$$("TRTapeSupplyBar");
        this.tapeView = this.$$("TRView");

        // Events
        this.window.addEventListener("beforeunload", this.beforeUnload);
        this.window.addEventListener("resize", this.boundResizeWindow);
        this.$$("TRMenuIcon").addEventListener("click", this.boundMenuClick);
        this.tapeSupplyBar.addEventListener("dblclick", this.boundRewindReader);
        this.fileSelector.addEventListener("change", this.boundFileSelectorChange);
        this.$$("TRForwardBtn").addEventListener("mousedown", this.boundFeedForward);
        this.$$("TRForwardBtn").addEventListener("mouseup", this.boundFeedForward);
        this.$$("TRRewindBtn").addEventListener("mousedown", this.boundFeedRewind);
        this.$$("TRRewindBtn").addEventListener("mouseup", this.boundFeedRewind);

        this.setReaderEmpty();

        // Recalculate scaling and offsets after initial window resize.
        this.config.restoreWindowGeometry(this.window,
                this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop);

        // Do offsetting window resizes after things calm down a bit to force
        // recalculation of the number of characters the TRView box can display.
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

        return Math.max(basePeriod/this.processor.disk.timingFactor, TallyTapeReader.minCyclePeriod);
    }

    /**************************************/
    cancel() {
        /* Cancels the I/O currently in process */

        this.busy = false;
        if (this.bufLoaded.waiting) {
            this.bufLoaded.proceed(-1);
        }
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
        TRView text box element in terms of characters of monospaced text so
        we'll know how  much text to show in the TRView text box element
        without overflow (Chrome doesn't properly display text that exceeds the
        size of a right-justified text box) */

        const pitch = computeTextPitch(this.window, this.tapeView);
        this.tapeViewLength = Math.floor(this.tapeView.clientWidth/pitch)-1;

        if (this.tapeView.value.length > this.tapeViewLength) {
            this.tapeView.value = this.tapeView.value.slice(-this.tapeViewLength );
        }
    }

    /**************************************/
    updateBufferLevel() {
        /* Updates the buffer level display on the tape reader menu */

        this.bufferLevel.textContent = this.bufLength > 0 ?
                `${this.bufLength - this.bufIndex}/${this.bufLength}` : "Empty";
    }

    /**************************************/
    updateTapeView(char) {
        /* Updates the TRTapeView display with the code just read */
        const view = this.tapeView.value;           // current tape view contents

        if (view.length < this.tapeViewLength) {
            this.tapeView.value = view + char;
        } else {
            let len = 1-this.tapeViewLength;
            if (char == TallyTapeReader.forwardArrowHead || char == TallyTapeReader.rewindArrowHead) {
                ++len;
            }

            this.tapeView.value = view.slice(1-this.tapeViewLength) + char;
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
        this.$$("TRFileSelector").value = null; // reset the control so the same file can be reloaded
        this.$$("TRFormatSelect").selectedIndex = 0;    // default to Auto
        this.$$("TRFileSelector").accept = ".ptp,.ptx"; // default to both extensions for auto
        this.updateBufferLevel();
    }

    /**************************************/
    rewindReader() {
        /* Rewinds the current reader buffer to its beginning. This was not a
        feature supported by the Tally Reader, but is provided as a convenience.
        Note that it does not rewind to the beginning of the current tape image
        FILE, but to the beginning of whatever has been loaded into the buffer */

        this.bufIndex = 0;
        this.tapeSupplyBar.value = this.bufLength;
        this.window.getSelection().removeAllRanges(); // deselect the menu icon
        this.tapeView.value = "";
        this.updateBufferLevel();
    }

    /**************************************/
    stripComments(buf) {
        /* Strips "#" comments from a text buffer, returning a new buffer */

        return buf.replace(TallyTapeReader.commentRex, "")
                  .replace(TallyTapeReader.newLineRex, "");
    }

    /**************************************/
    prepareBuffer(imageLength) {
        /* Prepares this.buffer for more image data by assuring that there is
        sufficient room, resizing it if necessary. If all existing buffer data
        has been read to its end, the buffer is treated as empty and its
        existing data is discarded, otherwise any read data is discarded */
        let bufIndex = this.bufIndex;
        let bufLength = this.bufLength;
        let curLength = bufLength - bufIndex;   // current active length

        if (!this.buffer) {
            this.buffer = new Uint8Array(imageLength);
            bufIndex = bufLength = 0;   // set new buffer empty
        } else if (curLength <= 0) {
            bufIndex = bufLength = 0;   // set existing buffer empty
        }

        // Assure there's enough room for the active + new lengths
        if (this.buffer.length < bufLength + imageLength) {
            // Not enough room at end of buffer -- see if compacting will work.
            if (imageLength <= this.buffer.length - curLength) {
                this.buffer.copyWithin(0, bufIndex, bufLength);
            } else {                    // won't fit, so resize buffer
                const oldBuf = this.buffer;
                this.buffer = new Uint8Array(curLength + imageLength);
                this.buffer.set(oldBuf.slice(bufIndex, bufLength), 0);
            }

            bufLength = curLength;
            bufIndex = 0;
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

        this.prepareBuffer(imageLength);
        bufLength = this.bufLength;

        for (let x=0; x<imageLength; ++x) {
            this.buffer[bufLength++] = image[x] & 0x3F;
        }

        this.bufLength = bufLength;
        this.tapeSupplyBar.max = bufLength;
        this.tapeSupplyBar.value = bufLength - this.bufIndex;
        this.ready = true;
        if (this.bufLoaded.waiting) {
            this.bufLoaded.proceed(0);
        }
    }

    /**************************************/
    loadAsPTX(image) {
        /* Load the image file as ASCII text in .ptx format and converts it to
        LGP-21 tape codes. Simply bypasses any invalid tape image characters
        and comments as if they did not exist. */
        const text = this.stripComments(image);
        const imageLength = text.length;
        let code = 0;

        this.prepareBuffer(imageLength);
        let bufLength = this.bufLength;

        for (const char of text) {
            code = IOCodes.ioASCIIToTapeCode[char.charCodeAt(0) & 0x7F];
            if (code < 0xFF) {          // not an ignored character
                this.buffer[bufLength++] = code;
            }
        }

        this.bufLength = bufLength;
        this.tapeSupplyBar.max = bufLength;
        this.tapeSupplyBar.value = bufLength - this.bufIndex;
        this.ready = true;
        if (this.bufLoaded.waiting) {
            this.bufLoaded.proceed(0);
        }
    }

    /**************************************/
    async formatSelectChange(ev){
        /* Update file selector default extension list based on format selector*/
        const formatSelect = this.$$("TRFormatSelect");
        const formatIndex = formatSelect.selectedIndex;
        const tapeFormat = formatSelect.options[formatIndex].value;

        if (tapeFormat == "Auto") {
            this.$$("TRFileSelector").accept = ".ptp,.ptx";
        } else {
            this.$$("TRFileSelector").accept = tapeFormat;
        }
    }

    /**************************************/
    async fileSelectorChange(ev) {
        /* Handle the <input type=file> onchange event when files are selected.
        For each file, load it and add it to the input buffer of the reader.
        Thanks to Bill Kuker for a better idea on how to handle Auto mode */
        const fileList = ev.target.files;
        const formatSelect = this.$$("TRFormatSelect");
        const formatIndex = formatSelect.selectedIndex;
        const formatList = [];          // list of format to be applied to each file
        let defaultFormat = "Auto";     // default format selection
        let error = false;              // invalid format flag
        let flx = 0;                    // index into formatList[]
        let msg = "";                   // result message text

        if (formatIndex > 0) {
            defaultFormat = formatSelect.options[formatIndex].value;
        }

        // First, assign the image format for each file. If the selected format
        // is "Auto", the file must have a ".ptp" (binary) or .ptx (text) extension.
        for (const file of fileList) {
            const fileName = file.name;
            let readAs = defaultFormat;
            if (readAs == "Auto") {
                let x = fileName.lastIndexOf(".");
                readAs = x < 0 ? "" : fileName.substring(x).toLowerCase();
            }

            switch (readAs) {
            case ".ptp":
            case ".ptx":
                formatList[flx] = readAs;
                break;
            default:
                error = true;
                formatList[flx] = null;
                msg += `\n>>${fileName}: invalid extension for Auto`;
                break;
            }

            ++flx;
        }

        // Now load the files into the buffer based on their assigned format.
        if (error) {
            this.window.alert(`Load aborted:${msg}`);
        } else {
            flx = 0;
            for (const file of fileList) {
                const fileName = file.name;
                let readAs = formatList[flx];
                let info = `${fileName} loaded as ${readAs}, ${file.size} bytes`;

                msg += ` • ${info}`;
                console.debug(`Tally Reader: ${info}`);
                switch (readAs) {
                case ".ptp":
                    this.loadAsPTP(await file.arrayBuffer());
                    break;
                case ".ptx":
                    this.loadAsPTX(await file.text());
                    break;
                default:                // should never happen
                    error = true;
                    this.window.alert(`>> LOAD ERROR >> ${fileName} invalid format ${readAs}`);
                    break;
                }

                ++flx;
            }

            this.context.controlPanel.setResultMsg(msg, 7);
            if (!error) {
                this.updateBufferLevel();
                this.window.setTimeout(() => {
                    this.menuClose();
                    this.$$("TRFileSelector").value = null;
                }, 3000);
            }
        }
    }

    /**************************************/
    menuOpen() {
        /* Opens the reader menu panel and wires up events */
        const readerMenu = this.$$("TRControlsMenu");

        if (!this.menuOpened) {
            // Resize and move the reader window to accommodate the menu panel.
            const config = {
                width:  this.window.outerWidth,
                height: this.window.outerHeight,
                left:   this.window.screenX,
                top:    this.window.screenY
            };

            let hMargin = screen.availWidth  - config.left - config.width  - 16;
            let vMargin = screen.availHeight - config.top  - config.height - 16;

            readerMenu.style.display = "block";
            const rect = readerMenu.getBoundingClientRect();
            let deltaWidth =  Math.max(rect.width + 8 - this.window.innerWidth, 0);
            let deltaHeight = rect.height + 8;
            let deltaX = Math.min(hMargin - config.deltaWidth, 0);
            let deltaY = Math.min(vMargin - config.deltaHeight, 0);

            if (deltaX != 0 || deltaY != 0) {
                this.window.moveBy(deltaX, deltaY);
            }

            this.window.resizeBy(deltaWidth, deltaHeight);

            this.menuConfig = config;   // save the config for menuClose to use
            this.updateBufferLevel();
            readerMenu.addEventListener("click", this.boundMenuClick, false);
            this.$$("TRFileSelector").addEventListener("change", this.boundFileSelectorChange);
            this.$$("TRFormatSelect").addEventListener("change", this.boundFormatSelectChange);
            this.menuOpened = true;
        }
    }

    /**************************************/
    menuClose() {
        /* Closes the punch menu panel and disconnects events */
        const readerMenu = this.$$("TRControlsMenu");
        const config = this.menuConfig;

        this.menuOpened = false;
        this.menuConfig = null;
        readerMenu.removeEventListener("click", this.boundMenuClick, false);
        this.$$("TRFileSelector").removeEventListener("change", this.boundFileSelectorChange);
        this.$$("TRFormatSelect").removeEventListener("change", this.boundFormatSelectChange);
        readerMenu.style.display = "none";

        // Restore the reader window size and position.
        this.window.resizeTo(config.width, config.height);
        if (config.deltaX != 0 || config.deltaY != 0) {
            this.window.moveTo(config.left, config.top);
        }
    }

    /**************************************/
    menuClick(ev) {
        /* Event handler for the reader menu */

        switch (ev.target.id) {
        case "TRMenuIcon":
            if (this.$$("TRControlsMenu").style.display == "block") {
                this.menuClose();
            } else {
                this.menuOpen();
            }
            break;
        case "TRUnloadBtn":
            this.setReaderEmpty();
            this.updateBufferLevel();
            break;
        case "TRMenuCloseBtn":
            this.menuClose();
            break;
        }
    }

    /**************************************/
    enableSend(autoStart) {
        /* Called by Processor when an INPUT command is initiated. Starts the
        reader, which will continue until the Processor terminates the I/O */

        console.debug("Tally Reader: enableSend");
        this.cyclePeriod = this.calcTiming(TallyTapeReader.defaultCyclePeriod);
        this.nextFrameStamp = performance.now() + this.cyclePeriod;
    }

    /**************************************/
    async sendCode() {
        /* Called by Processor when an INPUT command is active to indicate the
        next input code should be sent. Throttles the rate of sending to the
        reader's speed */

        console.debug(`Tally Reader: sendCode, busy=${this.busy}`);
        if (this.busy) {
            console.error(`Tally Reader: sendCode called with busy=true, index=${this.bufIndex}`);
            console.trace();
        } else {
            this.busy = true;
        }

        // If the buffer is empty, wait until either more tape image has been
        // loaded into the buffer or the I/O has been canceled.
        while (this.bufIndex >= this.bufLength && this.busy) {
            if (await this.bufLoaded.wait() < 0) {
                this.busy = false;      // I/O canceled
            }
        }

        // If nextFrameStamp is in the future, wait for it; if it is more
        // than one cyclePeriod in the past, resynchronize it to the current
        // time; otherwise, we're running a little behind, so just continue
        // without waiting or changing nextFrameStamp to at least partially
        // catch up during this cycle.
        if (this.busy) {                // not canceled
            const now = performance.now();
            const delay = this.nextFrameStamp - now;
            if (delay > 0) {            // nextFrameStamp is in the future
                await this.frameTimer.set(delay);
            } else if (delay + this.cyclePeriod < 0) {  // nextFrameStamp > one cyclePeriod in the past
                this.nextFrameStamp = now;
            }

            this.nextFrameStamp += this.cyclePeriod;
        }

        // Read and send the next code to the Processor.
        if (this.busy) {                // still not canceled
            const code = this.buffer[this.bufIndex];
            ++this.bufIndex;
            this.tapeSupplyBar.value = this.bufLength-this.bufIndex;
            this.updateTapeView(IOCodes.ioTapeCodeToASCII[code]);
            if (this.menuOpened) {
                this.updateBufferLevel();
            }

            console.debug(`Tally Reader: sending "${IOCodes.ioTapeCodeToASCII[code]}" ${code.toString(2).padStart(6, "0")}`);
            this.busy = false;
            const result = await this.processor.receiveInputCode(code);
            if (result) {
                console.log(`**Tally Reader: Processor.receiveInputCode(${code}) returned ${result}`);
            }
        }
    }

    /**************************************/
    write(code) {
        /* Dummy method to satisfy the I/O driver API and return a normal
        result if called */

        return 0;                       // just accept the code and ignore it
    }

    /**************************************/
    feedForward(ev) {
        /* Event handler for the FORWARD button. Moves tape in the forward
        direction without sending data to the Processor. If the button is held
        down for more than 0.25 seconds, speeds up the tape motion until it
        reaches the default cycle rate */
        let cyclePeriod = 250;          // initial inter-frame delay, ms
        let timerToken = 0;

        const skipFrame = () => {
            if (this.feeding && this.bufIndex < this.bufLength && !this.busy) {
                const now = performance.now();
                const code = this.buffer[this.bufIndex];
                ++this.bufIndex;
                this.tapeSupplyBar.value = this.bufLength-this.bufIndex;
                this.updateTapeView(IOCodes.ioTapeCodeToASCII[code]);
                if (this.menuOpened) {
                    this.updateBufferLevel();
                }

                this.nextFrameStamp += cyclePeriod;
                timerToken = this.window.setTimeout(skipFrame, this.nextFrameStamp - now);
                if (cyclePeriod > TallyTapeReader.defaultCyclePeriod) {
                    cyclePeriod *= 0.95;        // ramp up the tape speed
                }
            }
        };

        switch(ev.type) {
        case "mousedown":
            if (!this.feeding) {
                this.feeding = true;
                this.nextFrameStamp = performance.now();
                skipFrame();
            }
            break;
        case "mouseup":
            this.window.clearTimeout(timerToken);
            this.feeding = false;
            break;
        }
    }

    /**************************************/
    feedRewind(ev) {
        /* Event handler for the REWIND button. Moves tape in the reverse
        direction without sending data to the Processor. If the button is held
        down for more than 0.25 seconds, speeds up the tape motion until it
        reaches the maximum feed rate */
        let cyclePeriod = 250;          // initial inter-frame delay, ms
        let timerToken = 0;

        const skipFrame = () => {
            if (this.feeding && this.bufIndex > 0 && !this.busy) {
                const now = performance.now();
                --this.bufIndex;
                const code = this.buffer[this.bufIndex];
                this.tapeSupplyBar.value = this.bufLength-this.bufIndex;
                this.updateTapeView(IOCodes.ioTapeCodeToASCII[code]);
                if (this.menuOpened) {
                    this.updateBufferLevel();
                }

                this.nextFrameStamp += cyclePeriod;
                timerToken = this.window.setTimeout(skipFrame, this.nextFrameStamp - now);
                if (cyclePeriod > TallyTapeReader.maxFeedPeriod) {
                    cyclePeriod *= 0.95;        // ramp up the tape speed
                }
            }
        };

        switch(ev.type) {
        case "mousedown":
            if (!this.feeding) {
                this.feeding = true;
                this.nextFrameStamp = performance.now();
                this.updateTapeView(TallyTapeReader.rewindArrowHead);
                skipFrame();
            }
            break;
        case "mouseup":
            this.feeding = false;
            this.window.clearTimeout(timerToken);
            this.updateTapeView(TallyTapeReader.forwardArrowHead);
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
            this.$$("TRMenuIcon").removeEventListener("click", this.boundMenuClick);
            this.tapeSupplyBar.removeEventListener("dblclick", this.boundRewindReader);
            this.fileSelector.removeEventListener("change", this.boundFileSelectorChange);
            this.$$("TRForwardBtn").removeEventListener("mousedown", this.boundFeedForward);
            this.$$("TRForwardBtn").removeEventListener("mouseUp", this.boundFeedForward);
            this.$$("TRRewindBtn").removeEventListener("mousedown", this.boundFeedRewind);
            this.$$("TRRewindBtn").removeEventListener("mouseUp", this.boundFeedRewind);

            this.config.putWindowGeometry(this.window, "TallyTapeReader");
            this.window.close();
        }
    }
} // class TallyTapeReader
