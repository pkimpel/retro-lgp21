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
* Letter codes are interpreted case-insensitively. See the Flexowriter
* wiki page for details on this image format.
*
************************************************************************
* 2026-04-16  P.Kimpel
*   Original version, from retro-g15 PaperTapeReader.js.
***********************************************************************/

export {FlexowriterTapeReader};

import * as IOCodes from "../emulator/IOCodes.js";
import {Flexowriter} from "./Flexowriter.js";


class FlexowriterTapeReader {

    // Static properties

    static defaultReadRate = 571/60;    // reader speed, codes/sec
    static defaultReadPeriod = 1000/FlexowriterTapeReader.defaultReadRate;
                                        // default read period, ms/code
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
        this.window = flexowriter.window;
        this.flexowriter = flexowriter;
        this.tapeSupplyBar = $$("PRTapeSupplyBar");
        this.bufferLevel = $$("PRBufferLevel");

        this.boundFileSelectorChange = this.fileSelectorChange.bind(this);
        this.boundFormatSelectChange = this.formatSelectChange.bind(this);
        this.boundMenuClick = this.menuClick.bind(this);
        this.boundRewindReader = this.rewindReader.bind(this);

        this.clear();                                   // creates additional instance variables

        $$("PRMenuIcon").addEventListener("click", this.boundMenuClick);
        this.tapeSupplyBar.addEventListener("dblclick", this.boundRewindReader);
    }

    /**************************************/
    clear() {
        /* Initializes (and if necessary, creates) the reader unit state */

        this.ready = false;             // a tape has been loaded into the reader
        this.menuOpened = false;        // tape reader menu is currently open

        this.buffer = null;             // reader input buffer (paper-tape image)
        this.bufLength = 0;             // current input buffer length (characters)
        this.bufIndex = 0;              // 0-relative offset to next character to be read
        this.nextStartStamp = 0;        // earliest time next read can start

        this.setReaderEmpty();
    }

    /**************************************/
    updateBufferLevel() {
        /* Updates the buffer level display on the tape reader menu */

        this.bufferLevel.textContent = this.bufLength > 0 ?
                `${this.bufLength - this.bufIndex}/${this.bufLength}` : "Empty";
    }

    /**************************************/
    setReaderEmpty() {
        /* Sets the reader to a not-ready status and empties the buffer */

        this.ready = false;
        this.flexowriter.stopTapeRead();
        this.tapeSupplyBar.value = 0;
        this.buffer = "";                   // discard the input buffer
        this.bufLength = 0;
        this.bufIndex = 0;
        this.$$("PRFileSelector").value = null; // reset the control so the same file can be reloaded
        this.$$("PRFormatSelect").selectedIndex = 0;    // default to Auto
        this.$$("PRFileSelector").accept = ".ptp,.ptx"; // default to both extensions for auto
        this.updateBufferLevel();
    }

    /**************************************/
    rewindReader() {
        /* Rewinds the current reader buffer to its beginning. This was not a
        feature supported by the Flexowriter, but is provided as a convenience.
        Note that it does not rewind to the beginning of the current tape image
        FILE, but to the beginning of whatever has been loaded into the buffer */

        this.flexowriter.stopTapeRead();
        this.bufIndex = 0;
        this.tapeSupplyBar.value = this.bufLength;
        this.window.getSelection().removeAllRanges(); // deselect the menu icon
        this.updateBufferLevel();
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
    }

    /**************************************/
    async formatSelectChange(ev){
        /* Update file selector default extension list based on format selector*/
        const formatSelect = this.$$("PRFormatSelect");
        const formatIndex = formatSelect.selectedIndex;
        const tapeFormat = formatSelect.options[formatIndex].value;

        if (tapeFormat == "Auto") {
            this.$$("PRFileSelector").accept = ".ptp,.ptx";
        } else {
            this.$$("PRFileSelector").accept = tapeFormat;
        }
    }

    /**************************************/
    async fileSelectorChange(ev) {
        /* Handle the <input type=file> onchange event when files are selected.
        For each file, load it and add it to the input buffer of the reader.
        Thanks to Bill Kuker for a better idea on how to handle Auto mode  */
        const fileList = ev.target.files;
        const formatSelect = this.$$("PRFormatSelect");
        const formatIndex = formatSelect.selectedIndex;
        const formatList = [];          // list of format to be applied to each file
        let defaultFormat = "Auto";     // default format selection
        let error = false;              // invalid format flag
        let flx = 0;                    // index into formatList[]
        let msg = "";                   // result message text

        this.flexowriter.stopTapeRead();
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
                console.debug(`Flexowriter Reader: ${info}`);
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

            this.flexowriter.context.controlPanel.setResultMsg(msg, 7);
            if (!error) {
                this.updateBufferLevel();
                this.window.setTimeout(() => {
                    this.menuClose();
                    this.$$("PRFileSelector").value = null;
                }, 3000);
            }
        }
    }

    /**************************************/
    menuOpen() {
        /* Opens the reader menu panel and wires up events */
        const prMenu = this.$$("PRControlsMenu");

        if (!this.menuOpened) {
            this.menuOpened = true;
            prMenu.style.display = "block";
            prMenu.addEventListener("click", this.boundMenuClick, false);
            this.$$("PRFileSelector").addEventListener("change", this.boundFileSelectorChange);
            this.$$("PRFormatSelect").addEventListener("change", this.boundFormatSelectChange);
            this.updateBufferLevel();
        }
    }

    /**************************************/
    menuClose() {
        /* Closes the punch menu panel and disconnects events */
        const prMenu = this.$$("PRControlsMenu");

        this.menuOpened = false;
        prMenu.removeEventListener("click", this.boundMenuClick, false);
        this.$$("PRFileSelector").removeEventListener("change", this.boundFileSelectorChange);
        this.$$("PRFormatSelect").removeEventListener("change", this.boundFormatSelectChange);
        prMenu.style.display = "none";
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
            this.updateBufferLevel();
            break;
        case "PRMenuCloseBtn":
            this.menuClose();
            break;
        }
    }

    /**************************************/
    read() {
        /* Extracts the next tape code from the buffer and returns it to the
        caller or -1 if there is no tape in the reader, or end-of-tape occurs.
        Caller determines the speed of reading */
        let bufLength = this.bufLength; // current buffer length
        let code = 0;                   // current LGP-21 tape code
        let x = this.bufIndex;          // current buffer index

        if (x >= bufLength) {           // end of buffer
            code = -1;
        } else {
            code = this.buffer[x];
            ++x;
            this.tapeSupplyBar.value = bufLength-x;
        }

        this.bufIndex = x;
        if (this.menuOpened) {
            this.updateBufferLevel();
        }

        return code;
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device */

        $$("PRMenuIcon").removeEventListener("click", this.boundMenuClick);
        this.tapeSupplyBar.removeEventListener("dblclick", this.boundRewindReader);
    }
}
