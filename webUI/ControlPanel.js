/***********************************************************************
* retro-lgp21/webUI ControlPanel.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General Precision LGP-21 emulator support class implementing display
* and behavior for the main control panel and diagnostic oscilloscope.
*
* This panel exists as an in iframe in an overlay over the Home page
* window for the site. Its visibility is enabled when the emulator is
* started (which hides the Home page) and disabled when the emulator is
* shut down.
************************************************************************
* 2026-03-21  P.Kimpel
*   Original version, extracted from retro-1620 ControlPanel.js.
* 2026-05-15  P.Kimpel
*   Revised from an independent pop-up window to an iframe overlay on the
*   Home page.
***********************************************************************/

export {ControlPanel};

import * as Version from "../emulator/Version.js";
import * as Util from "../emulator/Util.js";
import * as IOCodes from "../emulator/IOCodes.js";
import {FlipFlop} from "../emulator/FlipFlop.js";
import {Disk} from "../emulator/Disk.js";
import {Processor} from "../emulator/Processor.js";

import {openPopup} from "./WebUIUtil.js";
import {ColoredLamp} from "./ColoredLamp.js";
import {ToggleSwitch} from "./ToggleSwitch.js";
import {ThreeWaySwitch} from "./ThreeWaySwitch.js";

class ControlPanel {

    // Static class properties

    static defaultMsgTimeout = 5;       // for setResultMsg()
    static displayAlpha = 0.01;         // running average decay factor
    static displayRefreshPeriod = 50;   // ms
    static lampFreezeThreshold = FlipFlop.lampPersistence*2;
    static downSwitchImage = "./resources/ToggleDown.png";
    static upSwitchImage = "./resources/ToggleUp.png";
    static midSwitchImage = "./resources/ToggleMid.png";
    static windowHeight = 452;          // window innerHeight, pixels
    static windowWidth = 1000;          // window innerWidth, pixels

    // Scope trace parameters
    static scopeBeamWidth = 16;         // width of scope trace beam, units
    static scopeTraceX = 120;           // horizontal offset of scope traces on scope
    static scopeTraceCY = 384.0;        // vertical offset of C register trace
    static scopeTraceRY = 649.5;        // vertical offset of R register trace
    static scopeTraceAY = 915.0;        // vertical offset of A register trace
    static scopeTraceHOffset = 10;      // horizontal offset of first (sign) bit
    static scopeTraceVOffset = 106;     // vertical offset of the 0 state
    static scopeTraceWidth = 1220;      // total width of the trace
    static scopeBitHeight = 91;         // height of the 1 state
    static scopeBitWidth = 37.5;        // total width of one bit-time
    static scopeRampUpWidth = 3;        // width of the bit ramp-up slant
    static scopeRampDownWidth = 1;      // width of the bit ramp-down slant

    // Public instance properties

    doc = null;                         // window document object
    innerHeight = 0;                    // window specified innerHeight
    window = null;                      // window object

    // Performance stats
    avgInstructionRate = 30;            // running average instructions/sec (starting with a reasonable value)
    intervalToken = 0;                  // panel refresh timer cancel token
    lastETime = 0;                      // last emulation clock value
    lastInstructionCount = 0;           // prior total instruction count (for average)
    lastRunTime = 0;                    // prior total run time (for average), ms
    emulationPaused = false;            // true => emulation has been paused
    pauseStartStamp = 0;                // timestamp when the current pause occurred
    resultMsgTimeoutToken = 0;          // for setResultMsg() use
    runTimeOffset = 0;                  // disk runTime offset for display purposes
    statsVisible = false;               // true => timing stats visible on panel


    /**************************************/
    constructor(context, asIframe) {
        /* Constructs the LGP-21 control panel controls and wires up their events.
        "context" is an object passing other objects and callback functions from
        the global script:
            processor is the Processor object
            systemShutDown() shuts down the emulator
        "asIframe"=true opens the panel in an iframe instead of a pop-up window */

        this.context = context;
        this.config = context.config;
        this.window = null;
        this.iframe = null;
        this.processor = context.processor;
        this.systemShutdown = context.systemShutdown;

        this.boundUpdatePanel = this.updatePanel.bind(this);
        this.boundBeforeUnload = this.beforeUnload.bind(this);
        this.boundPanelOnLoad = this.panelOnLoad.bind(this);
        this.boundPanelUnload = this.panelUnload.bind(this);
        this.boundControlSwitchClick = this.controlSwitchClick.bind(this);
        this.boundResetTiming = this.resetTiming.bind(this);
        this.boundOpenDebugPanel = this.openDebugPanel.bind(this);
        this.boundToggleTracing = this.toggleTracing.bind(this);
        this.boundChangeVisibility = this.changeVisibility.bind(this);
        this.boundShutDown = this.shutDown.bind(this);

        if (asIframe) {
            // Create an <iframe> on the Home page window and load the HTML.
            this.iframe = window.document.createElement("iframe");
            this.iframe.id = "ControlPanelFrame";
            this.iframe.addEventListener("load", this.boundPanelOnLoad, {once: true});
            this.iframe.src = "./ControlPanel.html";
            window.document.getElementById("EmulatorFrame").appendChild(this.iframe);
        } else {
            // Create the Control Panel window
            let geometry = this.config.formatWindowGeometry("ControlPanel");
            if (geometry.length) {
                [this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop] =
                        this.config.getWindowGeometry("ControlPanel");
            } else {
                this.innerHeight = ControlPanel.windowHeight;
                this.innerWidth =  ControlPanel.windowWidth;
                this.windowLeft =  screen.availWidth - ControlPanel.windowWidth;
                this.windowTop =   0;
                geometry = `,left=${this.windowLeft},top=${this.windowTop}` +
                           `,innerWidth=${this.innerWidth},innerHeight=${this.innerHeight}`;
            }

            openPopup(window, "../webUI/ControlPanel.html", "retro-lgp21.ControlPanel",
                    "location=no,scrollbars,resizable" + geometry,
                    this, this.panelOnLoad);
        }
    }

    /**************************************/
    $$(id) {
        /* Returns a DOM element from its id property. Cannot be called until
        panelOnLoad is called */

        return this.doc.getElementById(id);
    }

    /**************************************/
    panelOnLoad(ev) {
        /* Initializes the Control Panel window and user interface */
        const p = this.processor;
        let parent = null;              // parent sub-panel DOM object

        this.doc = ev.target.contentDocument;   // now we can use this.$$
        this.window = this.doc.defaultView;

        this.$$("LGP21Version").textContent = Version.lgp21Version;

        // Configure the switch frame.
        parent = this.$$("SwitchFrame");

        this.bs4Switch = new ToggleSwitch(parent, null, null, "BS4Switch", "bs4Switch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.bs4Switch.setCaption("BS-4",  ToggleSwitch.captionMain);
        this.bs4Switch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.bs4Switch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.bs4Switch.set(this.config.getNode("ControlPanel.bs4Switch"));
        p.bs4Switch = this.bs4Switch.state;

        this.bs8Switch = new ToggleSwitch(parent, null, null, "BS8Switch", "bs8Switch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.bs8Switch.setCaption("BS-8",  ToggleSwitch.captionMain);
        this.bs8Switch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.bs8Switch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.bs8Switch.set(this.config.getNode("ControlPanel.bs8Switch"));
        p.bs8Switch = this.bs8Switch.state;

        this.bs16Switch = new ToggleSwitch(parent, null, null, "BS16Switch", "bs16Switch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.bs16Switch.setCaption("BS-16", ToggleSwitch.captionMain);
        this.bs16Switch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.bs16Switch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.bs16Switch.set(this.config.getNode("ControlPanel.bs16Switch"));
        p.bs16Switch = this.bs16Switch.state;

        this.bs32Switch = new ToggleSwitch(parent, null, null, "BS32Switch", "bs32Switch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.bs32Switch.setCaption("BS-32", ToggleSwitch.captionMain);
        this.bs32Switch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.bs32Switch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.bs32Switch.set(this.config.getNode("ControlPanel.bs32Switch"));
        p.bs32Switch = this.bs32Switch.state;

        this.tcSwitch = new ToggleSwitch(parent, null, null, "TCSwitch", "tcSwitch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.tcSwitch.setCaption("TC",    ToggleSwitch.captionMain);
        this.tcSwitch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.tcSwitch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.tcSwitch.set(this.config.getNode("ControlPanel.tcSwitch"));
        p.tcSwitch = this.tcSwitch.state;

        this.modeSwitch = new ThreeWaySwitch(parent, null, null, "ModeSwitch", "modeSwitch",
                        ControlPanel.midSwitchImage, ControlPanel.upSwitchImage, ControlPanel.downSwitchImage);
        this.modeSwitch.element.classList.add("toggleLarge");
        this.modeSwitch.setCaption("MODE",       ThreeWaySwitch.captionMain);
        this.modeSwitch.setCaption("MAN\nINPUT", ThreeWaySwitch.captionTopLeft);
        this.modeSwitch.setCaption("ONE\nOPER",  ThreeWaySwitch.captionMiddleLeft);
        this.modeSwitch.setCaption("NORMAL",     ThreeWaySwitch.captionBottomLeft);
        this.modeSwitch.mainCaptionLabel.classList.add("modeCaptionMain");
        this.modeSwitch.topLeftCaptionLabel.classList.add("modeCaptionTL");
        this.modeSwitch.bottomLeftCaptionLabel.classList.add("modeCaptionBL");
        this.modeSwitch.middleLeftCaptionLabel.classList.add("modeCaptionML");
        this.modeSwitch.set(this.config.getNode("ControlPanel.modeSwitch"));
        // Mode Switch state will be set after power-on to get Man Input effects.

        // Configure the button/lamp frame.
        parent = this.$$("ButtonFrame");

        this.powerBtn = new ColoredLamp(parent, null, null, "PowerBtn", "POWER", "squareButton", "whiteButtonLit");
        this.powerBtn.setTitle("DOUBLE-click to power off and shut down the emulator");
        this.ioBtn = new ColoredLamp(parent, null, null, "IOBtn", "I/O", "squareButton", "whiteButtonLit");
        this.stopBtn = new ColoredLamp(parent, null, null, "StopBtn", "STOP", "squareButton redButton", "redButtonLit");
        this.startBtn = new ColoredLamp(parent, null, null, "StartBtn", "START", "squareButton", "whiteButtonLit");

        // Set up the performance statistics and 'scope references.
        this.runTime = this.$$("RunTime");
        this.iCount = this.$$("InstructionCount");
        this.iAvgRate = this.$$("InstructionRate");
        this.busyRate = this.$$("BusyRate");
        this.delayAvg = this.$$("DelayAvg");
        this.deltaAvg = this.$$("DelayDeltaAvg");

        this.statsVisible = this.config.getNode("ControlPanel.ShowTimingStatsCheck") ? true : false;
        this.$$("TimingStatsPanel").style.display = this.statsVisible ? "block" : "none";

        this.scopePathC = this.$$("ScopeCTrace");
        this.scopePathR = this.$$("ScopeRTrace");
        this.scopePathA = this.$$("ScopeATrace");

        // Wire up the events.
        this.doc.addEventListener("beforeunload", this.boundBeforeUnload);
        this.doc.addEventListener("pagehide", this.boundPanelUnload);
        this.doc.addEventListener("visibilitychange", this.boundChangeVisibility);
        this.$$("GPLogoTurquoise").addEventListener("dblclick", this.boundOpenDebugPanel);
        this.$$("ControlsFrame").addEventListener("click", this.boundControlSwitchClick);
        this.$$("RunTimerDiv").addEventListener("dblclick", this.boundResetTiming);
        this.$$("ButtonFrame").addEventListener("click", this.boundControlSwitchClick);
        this.powerBtn.addEventListener("dblclick", this.boundControlSwitchClick);
        this.$$("LGP21Version").addEventListener("dblclick", this.boundToggleTracing);

        // Power up and initialize the system.
        this.startSystem();

        if (!this.iframe) {
            // Recalculate scaling and offsets after initial window resize.
            this.config.restoreWindowGeometry(this.window,
                    this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop);
        }
    }

    /**************************************/
    startSystem(ev) {
        /* Powers up and initializes the system for operation */
        const p = this.processor;

        this.powerBtn.set(0);
        this.window.setTimeout(async () => {
            await p.powerUp();
            this.$$("PowerBtnFX").style.display = "block";
            this.$$("PowerBtnFX").classList.add("powerUp");

            this.window.setTimeout(() => {      // wait for the DC power supplies...
                this.powerBtn.set(1);
                this.$$("PowerBtnFX").classList.remove("powerUp");
                this.$$("PowerBtnFX").style.display = "none";
                this.lastRunTime = this.processor.disk.runTime;
                this.resetTiming();             // initialize the run timer
                this.updatePanel();             // initialize the scope traces
                this.intervalToken = this.window.setTimeout(this.boundUpdatePanel, ControlPanel.displayRefreshPeriod);

                // Reinstate the former MODE switch setting and get the side effects.
                const modeState = this.config.getNode("ControlPanel.modeSwitch");
                this.modeSwitch.set(modeState);
                switch (modeState) {
                case ThreeWaySwitch.stateUp:        // MANUAL INPUT
                    p.modeSwitchChange(Processor.modeManInput);
                    break;
                case ThreeWaySwitch.stateDown:      // NORMAL
                    p.modeSwitchChange(Processor.modeNormal);
                    break;
                default:                            // ONE OPERATION
                    p.modeSwitchChange(Processor.modeOneOperation);
                    break;
                }
            }, 4000);
        }, 500);
    }

    /**************************************/
    alert(msg) {
        /* Displays an alert from the Control Panel window. This method allows
        Processor and other components to generate alerts without having direct
        access to the UI */

        this.window.alert(msg);
    }

    /**************************************/
    resetResultMsg() {
        /* Removes the ResultMsg div from the DOM */
        const e = this.$$("#ResultMsg");

        if (this.resultMsgTimeoutToken) {
            clearTimeout(this.resultMsgTimeoutToken);
            this.resultMsgTimeoutToken = 0;
        }

        if (e) {
            e.parentNode.removeChild(e);
        }
    }

    /**************************************/
    setResultMsg(text, seconds=ControlPanel.defaultMsgTimeout) {
        /* Createes and sets the text of the ResultMsg div and initiates
        the fader styling */
        const div = this.doc.createElement("div");

        this.resetResultMsg();
        div.id = "ResultMsg";
        div.className = "resultMsg fadeMsg";
        div.textContent = text;
        div.style.animationDuration = `${seconds}s`;
        div.style.display = "block";
        this.doc.body.appendChild(div);
        this.resultMsgTimeoutToken = setTimeout(this.boundResetResultMsg, seconds*1000);
    }

    /**************************************/
    resetTiming() {
        /* Double-click handler for the HeaderTable element. Sets this.runTimeOffset
        to the current Disk.RunTime to zero the display of total run time on the panel */
        const now = performance.now();
        let rt = this.processor.disk.runTime;

        while (rt < 0) {
            rt += now;
        }

        this.runTimeOffset = rt;
    }

    /**************************************/
    toggleTracing(ev) {
        /* Toggles the Processor's tracing option */
        const p = this.processor;

        p.tracing = !p.tracing;
        if (p.tracing) {
            ev.target.classList.add("active");
            ev.target.title = "Emulator tracing enabled";
            console.log("<TRACE ON>");
            p.traceHeading();
        } else {
            ev.target.classList.remove("active");
            ev.target.title = "";
            console.log("<TRACE OFF>");
        }
    }

    /**************************************/
    drawScopeTrace(path, x0, y0, value) {
        /* Draws a scope trace for a 32-bit value using SVG <path> "id" and
        starting at x0, y0 */
        const h = ControlPanel.scopeBitHeight;
        const bw = ControlPanel.scopeBitWidth;
        const rd = ControlPanel.scopeRampDownWidth;
        const ru = ControlPanel.scopeRampUpWidth;

        let word = (value >>> 0);               // value to trace (in 2s-complement)
        let bit = 0;                            // current bit value
        let lastBit = 0;                        // prior bit value
        let rw = 0;                             // vertical trace ramp width (up/down)
        let tail = ControlPanel.scopeTraceWidth - ControlPanel.scopeBeamWidth;
                                                // distance left on the trace
        let dx = ControlPanel.scopeTraceHOffset - ControlPanel.scopeBeamWidth/2;
                                                // cumulative undrawn horizontal trace

        let d = `M${x0+ControlPanel.scopeBeamWidth/2},${y0+ControlPanel.scopeTraceVOffset}`;
        while (word) {
            bit = word & Util.wordSignMask;
            if (bit == lastBit) {
                dx += bw;
            } else {
                lastBit = bit;
                rw = bit ? ru : rd;
                d += ` h${dx} l${rw},${bit ? -h : h}`;
                tail -= dx + rw;
                dx = bw - rw;
            }

            word <<= 1;
        }

        if (lastBit) {
            d += ` h${dx} l${rw},${h}`;
            tail -= dx + rw;
        }

        d += ` h${tail}`;
        path.setAttribute("d", d);
    }

    /**************************************/
    updatePanel() {
        /* Updates the panel registers and flip-flops from processor state */
        const p = this.processor;

        if (!p) {
            return;                     // probably got caught in a shutdown
        }

        const eTime = p.disk.eTime;
        if (eTime - this.lastETime <= ControlPanel.lampFreezeThreshold) {
            p.updateLampGlow(1);    // Processor is not executing: freeze lamps
        } else {
            this.lastETime = eTime;
            p.updateLampGlow(0);
        }

        const now = performance.now();
        let runTime = p.disk.runTime;
        while (runTime < 0) {
            runTime += now;
        }

        this.runTime.textContent = ((runTime-this.runTimeOffset)/1000).toFixed(2).padStart(9, "0");
        const deltaRT = runTime - this.lastRunTime;
        if (deltaRT) {
            this.avgInstructionRate = this.avgInstructionRate*Processor.statsAlpha1 +
                    (p.instructionCount - this.lastInstructionCount)/deltaRT*1000*Processor.statsAlpha;
            this.lastInstructionCount = p.instructionCount;
            this.lastRunTime = runTime;
        }

        if (this.statsVisible) {
            this.iCount.textContent = p.instructionCount;
            this.iAvgRate.textContent = this.avgInstructionRate.toFixed(2);
            this.busyRate.textContent = (p.avgBusy*100).toFixed(2);
            this.delayAvg.textContent = p.avgThrottleDelay.toFixed(2);
            this.deltaAvg.textContent =
                    `${p.avgThrottleDelta < 0 ? "" : "+"}${p.avgThrottleDelta.toFixed(2)}`;
        }

        this.ioBtn.set(p.activeIODevice ? 1 : 0);
        this.stopBtn.set(p.blocked ? 1 : 0);
        this.startBtn.set(p.blocked ? 0 : 1);

        this.drawScopeTrace(this.scopePathC, ControlPanel.scopeTraceX, ControlPanel.scopeTraceCY, p.C.value & 0x80003FFF);
        this.drawScopeTrace(this.scopePathR, ControlPanel.scopeTraceX, ControlPanel.scopeTraceRY, p.R.value);
        this.drawScopeTrace(this.scopePathA, ControlPanel.scopeTraceX, ControlPanel.scopeTraceAY, p.A.value);

        this.intervalToken = this.window.setTimeout(this.boundUpdatePanel, ControlPanel.displayRefreshPeriod);
    }

    /**************************************/
    controlSwitchClick(ev) {
        /* Event handler for the pane's switch controls */
        let e = ev.target;
        const p = this.processor;

        switch (e.id) {
        case "PowerBtn":
            if (ev.type == "dblclick" && p.poweredOn) {
                this.shutDown();
            }
            break;
        case "IOBtn":
            p.panelClearIO();
            break;
        case "StartBtn":                // Note: StopBtn is just a lamp
            if (this.emulationPaused) {
                this.resumeEmulation();         // Firefox window minimization bug
            } else {
                p.start();
            }
            break;

        case "BS4Switch":
            this.bs4Switch.flip();
            this.config.putNode("ControlPanel.bs4Switch", this.bs4Switch.state);
            p.bs4Switch = this.bs4Switch.state;
            break;
        case "BS8Switch":
            this.bs8Switch.flip();
            this.config.putNode("ControlPanel.bs8Switch", this.bs8Switch.state);
            p.bs8Switch = this.bs8Switch.state;
            break;
        case "BS16Switch":
            this.bs16Switch.flip();
            this.config.putNode("ControlPanel.bs16Switch", this.bs16Switch.state);
            p.bs16Switch = this.bs16Switch.state;
            break;
        case "BS32Switch":
            this.bs32Switch.flip();
            this.config.putNode("ControlPanel.bs32Switch", this.bs32Switch.state);
            p.bs32Switch = this.bs32Switch.state;
            break;
        case "TCSwitch":
            this.tcSwitch.flip();
            this.config.putNode("ControlPanel.tcSwitch", this.tcSwitch.state);
            p.tcSwitch = this.tcSwitch.state;
            break;

        case "ModeSwitch":
            this.modeSwitch.flip();
            this.config.putNode("ControlPanel.modeSwitch", this.modeSwitch.state);

            switch (this.modeSwitch.state) {
            case ThreeWaySwitch.stateUp:        // MANUAL INPUT
                p.modeSwitchChange(Processor.modeManInput);
                break;
            case ThreeWaySwitch.stateDown:      // NORMAL
                p.modeSwitchChange(Processor.modeNormal);
                break;
            default:                            // ONE OPERATION
                p.modeSwitchChange(Processor.modeOneOperation);
                break;
            }
            break;

        case "ExecuteBtn":
            p.panelExecute();
            break;
        case "FillClearBtn":
            p.panelFillClear();
            break;

        default:
            // Golly, this is a kludge...
            if (e.tagName == "LABEL") {
                if (e.classList.contains("modeCaptionTL")) {
                    this.config.putNode("ControlPanel.modeSwitch", Processor.modeManInput);
                    p.modeSwitchChange(Processor.modeManInput);
                } else if (e.classList.contains("modeCaptionML")) {
                    this.config.putNode("ControlPanel.modeSwitch", Processor.modeOneOperation);
                    p.modeSwitchChange(Processor.modeOneOperation);
                } else if (e.classList.contains("modeCaptionBL")) {
                    this.config.putNode("ControlPanel.modeSwitch", Processor.modeNormal);
                    p.modeSwitchChange(Processor.modeNormal);
                }
            }
            break;
        }
    }


    /*******************************************************************
    *   Visibility & Hidden-tab Management                             *
    *******************************************************************/

    /**************************************/
    pauseEmulation() {
        /* Pauses the emulation at the end of the current execytion phase and
        saves the state necessary to resume emulation with proper timing later */

        if (this.emulationPaused) {
            throw new Error("<ERROR> Pause requested during paused state");
        } else {
            this.emulationPaused = true;
            this.pauseStartStamp = performance.now();
            this.processor.startPause(this.pauseStartStamp);
            console.debug(`<Emulation paused>  stamp=${this.pauseStartStamp}`);
            clearTimeout(this.intervalToken);           // stop Control Panel refresh
            this.intervalToken = 0;                     // reset the token
        }
    }

    /**************************************/
    resumeEmulation() {
        /* Resumes emulation after it has been paused and restores timing state
        so that from the emulation timeline it appears that the pause did not
        occur */

        if (!this.emulationPaused) {
            throw new Error("<ERROR> Pause resumed when not in paused state");
        } else {
            const now = performance.now();
            const deltaTime = now - this.pauseStartStamp;
            this.emulationPaused = false;
            this.lastRunTime += deltaTime;
            this.processor.endPause(this.pauseStartStamp, deltaTime);
            this.setResultMsg("Emulation resumed after browser hidden-page throttling", 7);
            console.debug(`<Emulation resumed> stamp=${now}, delta=${deltaTime} ms`);
            if (this.intervalToken == 0) {
                this.intervalToken = this.window.setTimeout(this.boundUpdatePanel, ControlPanel.displayRefreshPeriod);
            }
        }
    }

    /**************************************/
    changeVisibility(ev) {
        /* Called when the visibilitychange event fires to report a change in
        the visibility of the Home page window. This indicates the the browser
        may soon severely slow down the application */
        const doc = this.window.document;
        const state = doc.visibilityState;

        console.debug(`<Visibility Change> visibility=${state}, paused=${this.emulationPaused}, blocked=${this.processor.blocked}`);
        if (!this.processor.blocked) {
            if (state == "hidden") {
                this.pauseEmulation();
            } else if (this.emulationPaused) {
                this.resumeEmulation();
            }
        }
    }


    /*******************************************************************
    *   Diagnostic Panel                                               *
    *******************************************************************/

    /**************************************/
    openDebugPanel() {
        /* Opens the DebugPanelDiv and wires up its events */
        const p = this.processor;
        const disk = p.disk;
        const memSize = disk.diskSize;

        const hex = (v) => v.toString(16).padStart(8, "0");

        const xlateText = (word) => {
            let w = word >>> 0;
            let s = IOCodes.ioTapeCodeToASCII[(w >>> 26) & 0x3F];
            for (let i = 0; i<4; ++i) {
                w = (w << 6) >>> 0;
                s += IOCodes.ioTapeCodeToASCII[(w >>> 26) & 0x3F];
            }

            return s;
        };

        //----------------------------
        const formatMemDump = (putLine) => {
            /* Formats the contents of memory in MemDump format and outputs it
            through the putLine() function parameter */
            const wpl = 8;              // words per line
            const alphaStart = wpl*8 + 16; // line length before alpha interpretation

            let addr = 0;               // current memory address
            let alpha = "";             // alpha interpretation of words on line
            let dups = 0;               // count of contiguous duplicate words
            let lastWord = -1;          // value of prior word output
            let line = "";              // line assembly buffer
            let lineAddr = 0;           // address of start of line
            let word = 0;               // scratch variable
            let words = wpl;            // words placed on current line (initialized for overflow)

            const startLine = (addr) => {
                line = `${addr.toString().padStart(4)} ${Util.lgp21DecAddress(addr)} ` +
                       `${Util.lgp21Hex(addr<<2).slice(-4)}: `;
                lineAddr = addr;
                words = 0;
                alpha = "";
            };

            const endLine = () => {
                if (alpha.length) {
                    putLine(`${line.padEnd(alphaStart, " ")}${alpha}`);
                } else {
                    putLine(line);
                }
            };

            const putWord = (word) => {
                line += `${(word >>> 0).toString(16).padStart(8, "0").toUpperCase()} `;
                alpha += xlateText(word);
                lastWord = word;
                ++words;
            };

            putLine(`retro-lgp21 v${Version.lgp21Version} Memory Dump - ${(new Date()).toString()}`);
            putLine("");

            word = p.C.value >>> 0;
            addr = (word & Util.addressMask) >>> Util.sectorShift;
            putLine(`C=${hex(word)}:    ${Util.lgp21DecAddress(addr)} (${addr.toString().padStart(4)})`);

            word = p.R.value >>> 0;
            addr = (word & Util.addressMask) >>> Util.sectorShift;
            putLine(`R=${hex(word)}: ${Util.lgp21FormatOp(word)} (${addr.toString().padStart(4)})`);

            word = p.A.value >>> 0;
            putLine(`A=${hex(word)}: ${(word|0).toString()} "${xlateText(word)}"`);

            putLine(`P=0x${p.P.value.toString(16).padStart(2, "0")}` +
                           ` (${p.P.value.toString(2).padStart(6, "0")}) ` +
                           ` Q1${p.Q.Q1 ? "+":"-"} Q2${p.Q.Q2 ? "+":"-"} Q3${p.Q.Q3 ? "+":"-"} Q4${p.Q.Q4 ? "+":"-"}`);
            putLine("");
            line = "Addr TTSS iAddr";
            addr = 0;

            while (addr < memSize) {
                word = disk.fetchWord(addr);
                if (word == lastWord) {
                    ++dups;                     // count contiguous zero words
                } else {
                    // Fill in any duplicate words that will fit on the line.
                    while (dups && words < wpl) {
                        putWord(lastWord);
                        --dups;
                    }

                    // If there are remaining dups, skip to the line with the current address.
                    if (dups) {
                        endLine();
                        lineAddr += wpl;
                        const dupLines = Math.floor(dups/wpl);
                        if (dupLines > 1) {     // at least two lines of dups
                            const elided = dupLines*wpl;
                            putLine(`${(" ").padEnd(21)}[ ${elided} words of ` +
                                    `${lastWord.toString(16).padStart(8, "0")} "${xlateText(lastWord)}" ]`);
                            dups -= elided;
                            lineAddr += elided;
                        }

                        startLine(lineAddr);
                        while (dups) {          // output any remaining dups
                            if (words >= wpl) {
                                endLine();
                                startLine(lineAddr + wpl);
                            }

                            putWord(lastWord);
                            --dups;
                        }
                    }

                    // Output the current non-zero word, starting a new line as needed.
                    if (words >= wpl) {
                        endLine();
                        startLine(addr);
                    }

                    putWord(word);
                }

                // Increment memory address.
                ++addr;
            }

            // Fill in any final duplicates that will fit on the line.
            while (dups && words < wpl) {
                putWord(lastWord);
                --dups;
            }

            // If there are still final dups, output a final suppression line.
            endLine();
            if (dups) {
                putLine(`${(" ").padEnd(21)}[ ${dups} words of ` +
                        `${lastWord.toString(16).padStart(8, "0")} "${xlateText(lastWord)}" ]`);
            }

            putLine("");
            putLine("End Memory Dump");
        };

        //----------------------------
        const buildMemDumpView = (ev) => {
            /* Handles the onLoad event for the MemDump view pop-up window and
            populates the window with the MemDump */
            const doc = ev.target;
            const win = doc.defaultView;
            const text = doc.getElementById("Paper");
            const title = `retro-lgp21 Memory Dump${(new Date()).toISOString().replaceAll(":", "")}`;

            const putLine = (line) => {
                text.appendChild(doc.createTextNode(line.trimEnd() + "\n"));
            };

            doc.title = title;
            text.style.fontFamily = "DejaVuSansMonoWeb,monospace";
            text.style.fontSize = "9pt";
            text.style.width = "fit-content";
            win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
            formatMemDump(putLine);
        };

        //----------------------------
        const initiateMemDumpView = () => {
            /* Formats the contents of core memory to a pop-up window, from which the
            user can copy/save/print it as they desire */

            openPopup(this.window, "./FramePaper.html", "",
                    "scrollbars,resizable,width=882,height=500", this, buildMemDumpView);
            closeDebugPanel();
        };

        //----------------------------
        const saveMemory = () => {
            /* Saves the current contents of the disk memory and processor
            state to a JSON file */
            const now = new Date();
            const state = {
                Comment: [`retro-lgp21 v${Version.lgp21Version} State Dump - ${now.toString()}`],
                Registers: {C: p.C.value, R: p.R.value, A: p.A.value},
                Memory: []};

            if (!(p.blocked)) {
                this.setResultMsg("Save Memory requires the Processor to be halted", 5);
                return;
            }

            for (let a=0; a<memSize; ++a) {
                state.Memory[a] = disk.fetchWord(a);
            }

            let text = JSON.stringify(state);
            if (!text.endsWith("\n")) {         // make sure there's a final new-line
                text = text + "\n";
            }

            const url = `data:text/plain,${encodeURIComponent(text)}`;
            const hiddenLink = this.doc.createElement("a");

            hiddenLink.setAttribute("download",
                    `retro-lgp21-Memory-State-${now.toISOString().replaceAll(":", "")}.json`);
            hiddenLink.setAttribute("href", url);
            hiddenLink.click();
        };

        //----------------------------
        const loadMemory = () => {
            /* Restores the contents of the disk memory and processor state from
            a JSON file */

            const closeMemLoadDiv = () => {
                this.$$("DebugLoadMemDiv").style.display = "none";
                this.$$("DebugLoadMemSelector").removeEventListener("change", loadMemSelect);
            };

            const loadMemSelect = async (ev) => {
                /* Handle the <input type=file> onchange event when a file is selected
                to initiate a disk state load */
                const f = ev.target.files[0];
                const fileName = f.name;
                let fileType = f.type ?? "";

                // Determine which type of file we're getting.
                switch (fileType) {
                case "application/json":
                    // do nothing
                    break;
                default:
                    const x = fileName.lastIndexOf(".");
                    const ext = x < 0 ? "" : fileName.substring(x).toLowerCase();
                    switch (ext) {
                    case ".json":
                        fileType = "application/json";
                        break;
                    default:
                        this.setResultMsg(`Memory load file "${fileName}" invalid type "${fileType}"`, 9);
                        closeMemLoadDiv();
                        return;
                        break;
                    }
                }

                // Obtain the disk state as JSON.
                const reader = new FileReader();
                let json = await f.text();

                // Parse the disk state JSON to an object.
                let state = null;
                try {
                    state = JSON.parse(json);
                } catch (e) {
                    this.setResultMsg(`Could not parse JSON disk state:\n${e.message}:\nAborting load.`, 9);
                }

                if (state) {
                    if (!("Memory" in state)) {
                        this.setResultMsg("No Memory object in state file", 9);
                    } else if ((typeof state.Memory) != "array") {
                        this.setResultMsg("Memory object is not an array", 9);
                    } else if (this.window.confirm(
                            `Are you sure you want to COMPLETELY REPLACE the the contents of the memory?`)) {
                        console.log(`Loading disk state from ${fileName}`);
                        const limit = Math.min(state.Memory.length, memSize);
                        let x = 0;
                        while (x < limit) {
                            let w = state.Memory[x];
                            disk.storeWord(x, ((typeof w) == "number") ? state.Memory[x] : 0);
                            ++x;
                        }

                        while (x < memSize) {
                            disk.storeWord(x, 0);
                            ++x;
                        }

                        if ("Registers" in state) {
                            const reg = state.Registers;
                            p.C.value = typeof reg.C == "number" ? reg.C : 0;
                            p.R.value = typeof reg.R == "number" ? reg.R : 0;
                            p.A.value = typeof reg.A == "number" ? reg.A : 0;
                        }

                        this.setResultMsg("Memory state restored.", 5);
                        console.log("Memory state restored successfully.");
                    }
                }

                closeMemLoadDiv();
            };

            // Outer block of loadMemory.

            if (!(p.blocked)) {
                this.setResultMsg("Load Memory requires the Processor to be halted", 5);
            } else {
                this.$$("DebugLoadMemDiv").style.display = "block";
                this.$$("DebugLoadMemSelector").addEventListener("change", loadMemSelect);
                this.$$("DebugLoadMemCancelBtn").addEventListener("click", () => {
                    closeMemLoadDiv();
                }, {once: true});
            }
        };

        //----------------------------
        const debugPanelClick = (ev) => {
            /* Dispatches clicks on the Debug Panel */

            switch (ev.target.id) {
            case "DebugMemDumpBtn":
                initiateMemDumpView();
                break;
            case "ShowTimingStatsCheck":
                this.statsVisible = ev.target.checked;
                this.$$("TimingStatsPanel").style.display = this.statsVisible ? "block" : "none";
                this.config.putNode("ControlPanel.ShowTimingStatsCheck", this.statsVisible ? 1 : 0);
                break;
            case "DebugSaveMemoryBtn":
                saveMemory();
                break;
            case "DebugLoadMemoryBtn":
                loadMemory();
                break;
            case "DebugCloseBtn":
                closeDebugPanel();
                break;
            }
        };

        //----------------------------
        const closeDebugPanel = () => {
            /* Unwires the local events and closes the debug panel */

            this.$$("DebugPanelDiv").removeEventListener("click", debugPanelClick);
            this.$$("DebugPanelDiv").style.display = "none";
        };

        //--------Outer Block---------

        this.$$("ShowTimingStatsCheck").checked = this.statsVisible;
        this.$$("DebugPanelDiv").style.display = "block";
        this.$$("DebugPanelDiv").addEventListener("click", debugPanelClick);
    }


    /*******************************************************************
    *   Termination                                                    *
    *******************************************************************/

    /**************************************/
    beforeUnload(ev) {
        const msg = "Closing this window will make the panel unusable.\n" +
                    "Suggest you stay on the page and minimize this window instead";

        ev.preventDefault();
        ev.returnValue = msg;
        return msg;
    }

    /**************************************/
    panelUnload(ev) {
        /* Event handler for the window unload event */

        this.shutDown();
    }

    /**************************************/
    shutDown() {
        /* Shuts down the panel */

        // Clear the scope.
        this.scopePathC.setAttribute("d", "");
        this.scopePathR.setAttribute("d", "");
        this.scopePathA.setAttribute("d", "");

        // Ramp down.
        this.$$("PowerBtnFX").style.display = "block";
        this.$$("PowerBtnFX").classList.add("powerDown");
        this.window.setTimeout(() => {
            this.powerBtn.set(0);
            this.$$("PowerBtnFX").classList.remove("powerDown");
            this.$$("PowerBtnFX").style.display = "none";
            if (this.intervalToken) {
                this.window.clearTimeout(this.intervalToken);
                this.intervalToken = 0;
            }

            this.doc.removeEventListener("beforeunload", this.boundBeforeUnload);
            this.doc.removeEventListener("pagehide", this.boundPanelUnload);
            this.doc.removeEventListener("visibilitychange", this.boundChangeVisibility);
            this.config.putWindowGeometry(this.window, "ControlPanel");
            this.$$("GPLogoTurquoise").removeEventListener("dblclick", this.boundOpenDebugPanel);
            this.$$("ControlsFrame").removeEventListener("click", this.boundControlSwitchClick);
            this.$$("RunTimerDiv").removeEventListener("dblclick", this.boundResetTiming);
            this.$$("ButtonFrame").removeEventListener("click", this.boundControlSwitchClick);
            this.$$("LGP21Version").removeEventListener("dblclick", this.boundToggleTracing);
            this.powerBtn.removeEventListener("dblclick", this.boundControlSwitchClick);
            this.context.systemShutDown();

            if (!this.iframe) {
                this.window.setTimeout(() => {
                    this.window.close();
                }, 500);
            }
        }, 2000);
    }
} // class ControlPanel
