/***********************************************************************
* retro-lgp21/webUI ControlPanel.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General Precision LGP-21 emulator support class implementing display
* and behavior for the main control panel.
************************************************************************
* 2026-03-21  P.Kimpel
*   Original version, extracted from retro-1620 ControlPanel.js.
***********************************************************************/

export {ControlPanel};

import * as Util from "../emulator/Util.js";
import * as Version from "../emulator/Version.js";
import {FlipFlop} from "../emulator/FlipFlop.js";
import {openPopup} from "./PopupUtil.js";
import {Processor} from "../emulator/Processor.js";

import {ColoredLamp} from "./ColoredLamp.js";
import {ToggleSwitch} from "./ToggleSwitch.js";
import {ThreeWaySwitch} from "./ThreeWaySwitch.js";

class ControlPanel {

    // Static class properties

    static displayAlpha = 0.01;         // running average decay factor
    static displayRefreshPeriod = 50;   // ms
    static lampFreezeThreshold = FlipFlop.lampPersistence*2;
    static downSwitchImage = "./resources/ToggleDown.png";
    static upSwitchImage = "./resources/ToggleUp.png";
    static midSwitchImage = "./resources/ToggleMid.png";
    static windowHeight = 456;          // window innerHeight, pixels
    static windowWidth = 1000;          // window innerWidth, pixels

    // Scope trace parameters
    static scopeTraceBits = 32;
    static scopeTraceHOffset = 10;
    static scopeTraceVOffset = 106;
    static scopeTraceWidth = 1220;
    static scopeBitWidth = 37.5;
    static scopeBitHeight = 91;

    // Public instance properties

    doc = null;                         // window document object
    innerHeight = 0;                    // window specified innerHeight
    window = null;                      // window object

    avgInstructionRate = 0;             // running average instructions/sec
    intervalToken = 0;                  // panel refresh timer cancel token
    lastETime = 0;                      // last emulation clock value
    lastInstructionCount = 0;           // prior total instruction count (for average)
    lastRunTime = 0;                    // prior total run time (for average), ms

    /**************************************/
    constructor(context) {
        /* Constructs the LGP-21 control panel controls and wires up their events.
        "context" is an object passing other objects and callback functions from
        the global script:
            processor is the Processor object
            systemShutDown() shuts down the emulator
        */

        this.context = context;
        this.config = context.config;
        this.systemShutdown = context.systemShutdown;

        this.boundUpdatePanel = this.updatePanel.bind(this);
        this.boundBeforeUnload = this.beforeUnload.bind(this);
        this.boundStartSystem = this.startSystem.bind(this);
        this.boundControlSwitchClick = this.controlSwitchClick.bind(this);
        this.boundPanelUnload = this.panelUnload.bind(this);
        this.boundShutDown = this.shutDown.bind(this);

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

        openPopup(window, "../webUI/ControlPanel.html", "retro-LGP-21.ControlPanel",
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
    alert(msg) {
        /* Displays an alert from the Control Panel window. This method allows
        Processor and other components to generate alerts without having direct
        access to the UI */

        this.window.alert(msg);
    }

    /**************************************/
    async panelOnLoad(ev) {
        /* Initializes the Control Panel window and user interface */
        const p = this.context.processor;
        let parent = null;              // parent sub-panel DOM object

        this.doc = ev.target;
        this.window = this.doc.defaultView;
        let body = this.doc.body;

        parent = this.$$("SwitchFrame");

        this.bs4Switch = new ToggleSwitch(parent, null, null, "BS4Switch", "bs4Switch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.bs4Switch.setCaption("BS-4",  ToggleSwitch.captionMain);
        this.bs4Switch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.bs4Switch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.bs4Switch.set(0);
        this.bs4Switch.set(this.config.getNode("ControlPanel.bs4Switch"));
        p.bs4Switch = this.bs4Switch.state;

        this.bs8Switch = new ToggleSwitch(parent, null, null, "BS8Switch", "bs8Switch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.bs8Switch.setCaption("BS-8",  ToggleSwitch.captionMain);
        this.bs8Switch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.bs8Switch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.bs8Switch.set(0);
        this.bs8Switch.set(this.config.getNode("ControlPanel.bs8Switch"));
        p.bs8Switch = this.bs8Switch.state;

        this.bs16Switch = new ToggleSwitch(parent, null, null, "BS16Switch", "bs16Switch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.bs16Switch.setCaption("BS-16", ToggleSwitch.captionMain);
        this.bs16Switch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.bs16Switch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.bs16Switch.set(0);
        this.bs16Switch.set(this.config.getNode("ControlPanel.bs16Switch"));
        p.bs16Switch = this.bs16Switch.state;

        this.bs32Switch = new ToggleSwitch(parent, null, null, "BS32Switch", "bs32Switch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.bs32Switch.setCaption("BS-32", ToggleSwitch.captionMain);
        this.bs32Switch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.bs32Switch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.bs32Switch.set(0);
        this.bs32Switch.set(this.config.getNode("ControlPanel.bs32Switch"));
        p.bs32Switch = this.bs32Switch.state;

        this.tcSwitch = new ToggleSwitch(parent, null, null, "TCSwitch", "tcSwitch",
                        ControlPanel.downSwitchImage, ControlPanel.upSwitchImage);
        this.tcSwitch.setCaption("TC",    ToggleSwitch.captionMain);
        this.tcSwitch.setCaption("ON",    ToggleSwitch.captionTopLeft);
        this.tcSwitch.setCaption("OFF",   ToggleSwitch.captionBottomLeft);
        this.tcSwitch.set(0);
        this.tcSwitch.set(this.config.getNode("ControlPanel.tcSwitch"));
        p.tcSwitch = this.tcSwitch.state;

        this.modeSwitch = new ThreeWaySwitch(parent, null, null, "ModeSwitch", "modeSwitch",
                        ControlPanel.midSwitchImage, ControlPanel.upSwitchImage, ControlPanel.downSwitchImage);
        this.modeSwitch.element.classList.add("toggleLarge");
        this.modeSwitch.setCaption("MODE",       ThreeWaySwitch.captionMain);
        this.modeSwitch.setCaption("MAN\nINPUT", ThreeWaySwitch.captionTopLeft);
        this.modeSwitch.setCaption("ONE\nOPER",  ThreeWaySwitch.captionMiddleLeft);
        this.modeSwitch.setCaption("NORMAL",     ThreeWaySwitch.captionBottomLeft);
        this.modeSwitch.mainCaptionDiv.classList.add("modeCaptionMain");
        this.modeSwitch.topLeftCaptionDiv.classList.add("modeCaptionTL");
        this.modeSwitch.bottomLeftCaptionDiv.classList.add("modeCaptionBL");
        this.modeSwitch.middleLeftCaptionDiv.classList.add("modeCaptionML");
        this.modeSwitch.set(this.config.getNode("ControlPanel.modeSwitch"));
        p.modeSwitch = this.modeSwitch.state;

        parent = this.$$("ButtonFrame");

        this.powerBtn = new ColoredLamp(parent, null, null, "PowerBtn", "POWER", "squareButton", "whiteButtonLit");
        this.powerBtn.title = "Double-click to power off and shut down the emulator";
        this.ioBtn = new ColoredLamp(parent, null, null, "IOBtn", "I/O", "squareButton", "whiteButtonLit");
        this.stopBtn = new ColoredLamp(parent, null, null, "StopBtn", "STOP", "squareButton redButton", "redButtonLit");
        this.startBtn = new ColoredLamp(parent, null, null, "StartBtn", "START", "squareButton", "whiteButtonLit");

        this.scopePathC = this.$$("ScopeCTrace");
        this.scopePathI = this.$$("ScopeITrace");
        this.scopePathA = this.$$("ScopeATrace");

        this.$$("EmulatorVersion").textContent = Version.lgp21Version;
        this.window.addEventListener("beforeunload", this.boundBeforeUnload);
        this.window.addEventListener("unload", this.boundPanelUnload);
        this.$$("ControlsFrame").addEventListener("click", this.boundControlSwitchClick);
        this.powerBtn.addEventListener("dblclick", this.boundControlSwitchClick);
        //this.$$("GPLogoTurquoise").addEventListener("dblclick", this.boundOpenDebugPanel);

        // Power up and initialize the system.
        this.powerBtn.set(0);
        this.powerBtn.addEventListener("click", this.boundStartSystem);

        // Recalculate scaling and offsets after initial window resize.
        this.config.restoreWindowGeometry(this.window,
                this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop);
    }

    /**************************************/
    startSystem(ev) {
        /* Powers up and initializes the system for operation */

        this.window.setTimeout(async () => {
            this.powerBtn.removeEventListener("click", this.boundStartSystem);
            await this.context.processor.powerUp();
            this.$$("PowerBtnFX").style.display = "block";
            this.$$("PowerBtnFX").classList.add("powerUp");
            this.window.setTimeout(() => {      // wait for the DC power supplies...
                this.powerBtn.set(1);
                this.$$("PowerBtnFX").classList.remove("powerUp");
                this.$$("PowerBtnFX").style.display = "none";
                this.intervalToken = this.window.setTimeout(this.boundUpdatePanel, ControlPanel.displayRefreshPeriod);
            }, 4000);
        }, 500);
    }

    /**************************************/
    openDebugPanel(ev) {
        /* Opens the DebugPanelDiv and wires up its events */
        const p = this.context.processor;

    }

    /**************************************/
    toggleTracing(ev) {
        /* Toggles the Processor's tracing option */
        const p = this.context.processor;

        //this.$$("FrontPanel").focus();  // de-select the version <div>

        p.tracing = !p.tracing;
        if (p.tracing) {
            ev.target.classList.add("active");
            console.log("<TRACE ON>");
        } else {
            ev.target.classList.remove("active");
            console.log("<TRACE OFF>");
        }
    }

    /**************************************/
    drawScopeTrace(path, x0, y0, value) {
        /* Draws a scope trace for a 32-bit value using SVG <path> "id" and
        starting at x0, y0 */
        const h = ControlPanel.scopeBitHeight;
        const w = ControlPanel.scopeBitWidth;
        let word = value;
        let bit = 0;
        let lastBit = 0;
        let tail = ControlPanel.scopeTraceWidth;
        let dx = ControlPanel.scopeTraceHOffset;

        let d = `M${x0},${y0+ControlPanel.scopeTraceVOffset}`;
        while (word) {
            bit = word & Util.wordSignMask;
            if (bit == lastBit) {
                dx += w;
            } else {
                d += ` h${dx} v${bit ? -h : h}`;
                tail -= dx;
                dx = w;
            }

            lastBit = bit;
            word <<= 1;
        }

        if (lastBit) {
            d += ` h${dx} v${h}`;
            tail -= dx;
        }

        d += ` h${tail}`;
        path.setAttribute("d", d);
    }

    /**************************************/
    updatePanel() {
        /* Updates the panel registers and flip-flops from processor state */
        const p = this.context.processor;

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

        this.ioBtn.set(0 /*** TBD ***/);
        this.stopBtn.set(p.blocked ? 1 : 0);
        this.startBtn.set(p.blocked ? 0 : 1);

        this.drawScopeTrace(this.scopePathC, 120, 384.0, /**p.C.value**/ 100);
        this.drawScopeTrace(this.scopePathI, 120, 649.5, /**p.I.value**/ performance.now());
        this.drawScopeTrace(this.scopePathA, 120, 915.0, /**p.A.value**/ Math.random()*Util.wordMask);

        this.intervalToken = this.window.setTimeout(this.boundUpdatePanel, ControlPanel.displayRefreshPeriod);
    }

    /**************************************/
    controlSwitchClick(ev) {
        /* Event handler for the pane's switch controls */
        let e = ev.target;
        const p = this.context.processor;

        switch (e.id) {
        case "PowerBtn":
            if (ev.type == "dblclick" && p.poweredOn) {
                this.shutDown();
            }
            break;
        case "IOBtn":
            p.panelClearIO();
            break;
        case "StopBtn":
            p.stop();
            break;
        case "StartBtn":
            p.start();
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

            switch (this.tcSwitch.state) {
            case ThreeWaySwitch.stateOff:       // ONE OPERATION
                p.modeSwitchChange(Processor.mode1Operation);
                break;
            case ThreeWaySwitch.stateUp:        // MANUAL INPUT
                p.modeSwitchChange(Processor.modeManInput);
                break;
            case ThreeWaySwitch.stateDown:      // NORMAL
                p.modeSwitchChange(Processor.modeNormal);
                break;
            }
            break;

        case "ExecuteBtn":
            p.panelExecute();
            break;
        case "FillClearBtn":
            p.panelFillClear();
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
    panelUnload(ev) {
        /* Event handler for the window unload event */

        this.shutDown();
    }

    /**************************************/
    shutDown() {
        /* Shuts down the panel */

        if (this.intervalToken) {
            this.window.clearTimeout(this.intervalToken);
            this.intervalToken = 0;
        }

        this.$$("PowerBtnFX").style.display = "block";
        this.$$("PowerBtnFX").classList.add("powerDown");
        this.window.setTimeout(() => {
            this.powerBtn.set(0);
            this.$$("PowerBtnFX").classList.remove("powerDown");
            this.$$("PowerBtnFX").style.display = "none";

            this.powerBtn.removeEventListener("dblclick", this.boundControlSwitchClick);
            //this.$$("GPLogoTurquoise").removeEventListener("dblClick", this.boundOpenDebugPanel);
            this.config.putWindowGeometry(this.window, "ControlPanel");
            this.$$("ControlsFrame").removeEventListener("click", this.boundControlSwitchClick);
            this.window.removeEventListener("beforeunload", this.boundBeforeUnload);
            this.window.removeEventListener("unload", this.boundPanelUnload);
            this.context.systemShutDown();
            this.window.setTimeout(() => {
                this.window.close();
            }, 500);
        }, 2000);
    }
} // class ControlPanel
