/***********************************************************************
* retro-lgp21/webUI LGP21.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General Precision LGP-21 Emulator home page routines.
************************************************************************
* 2026-03-26  P.Kimpel
*   Original version, from retro-1620 1620.js.
***********************************************************************/

import * as Version from "../emulator/Version.js";
import {Processor} from "../emulator/Processor.js";

import {ControlPanel} from "./ControlPanel.js";
import {SystemConfig} from "./SystemConfig.js";
import {Flexowriter} from "./Flexowriter.js";
import {TallyTapeReader} from "./TallyTapeReader.js";
import {TallyTapePunch} from "./TallyTapePunch.js";


const globalLoad = (ev) => {
    const config = new SystemConfig();  // system configuration object
    let statusMsgTimerToken = 0;        // status message timer control token

    const context = {
        config,
        systemShutDown,
        window
    };


    /**************************************/
    function $$(id) {
        return document.getElementById(id);
    }

    /**************************************/
    function configReporter(msg) {
        /* Displays a configuration result message */

        $$("ConfigMsg").textContent = msg;
    }

    /**************************************/
    function configureSystem(ev) {
        /* Opens the system configuration UI */

        config.openConfigUI(configReporter);
    }

    /**************************************/
    function clearStatusMsg(inSeconds) {
        /* Delays for "inSeconds" seconds, then clears the StatusMsg element */

        if (statusMsgTimerToken) {
            clearTimeout(statusMsgTimerToken);
        }

        statusMsgTimerToken = setTimeout(function(ev) {
            $$("StatusMsg").textContent = "";
            statusMsgTimerToken = 0;
        }, inSeconds*1000);
    }

    /**************************************/
    function beforeUnload(ev) {
        var msg = "Closing this window will terminate the emulator";

        ev.preventDefault();
        ev.returnValue = msg;
        return msg;
    }

    /**************************************/
    function parseQueryString(context) {
        /* Parses the query string for the request, looking for known key/value
        pairs. If found, applies them to the current configuration options */
        let url = new URL(window.location);

        for (let pair of url.searchParams) {
            let key = (pair[0] || "").trim().toUpperCase();
            let val = (pair[1] || "").trim().toUpperCase();

            switch (key) {
            case "RPM":
                context.processor.disk.setTiming(parseInt(val, 10) ?? 0);
                break;
            }
        }
    }

    /**************************************/
    async function systemInitialize() {
        /* Activates the system configuration object (asynchronously) and
        enables the Start and Configure buttons on the window */

        const msg = await config.activate();
        configReporter(msg);

        $$("StartUpBtn").disabled = false;
        $$("StartUpBtn").addEventListener("click", systemStartup, false);
        $$("StartUpBtn").focus();
        $$("ConfigureBtn").disabled = false;
        $$("ConfigureBtn").addEventListener("click", configureSystem, false);
    }

    /**************************************/
    async function systemStartup(ev) {
        /* Establishes the system components */

        const msg = await config.activate();
        configReporter(msg);

        $$("StartUpBtn").disabled = true;
        $$("ConfigureBtn").disabled = true;
        $$("EmulatorFrame").style.visibility = "visible";

        window.addEventListener("beforeunload", beforeUnload);

        context.processor = new Processor(context);
        parseQueryString(context);

        context.controlPanel = new ControlPanel(context, true);

        context.devices = {};
        context.devices.flexowriter = new Flexowriter(context, true);

        switch (config.getNode("TallyTapeReader.mode")) {
        case 1:
            context.devices.tallyTapeReader = new TallyTapeReader(context);
            break;
        case 2:
            context.devices.tallyTapeReader = context.devices.flexowriter;
            break;
        }

        switch (config.getNode("TallyTapePunch.mode")) {
        case 1:
            context.devices.tallyTapePunch = new TallyTapePunch(context);
            break;
        case 2:
            context.devices.tallyTapePunch = context.devices.flexowriter;
            break;
        }
    }

    /**************************************/
    async function systemShutDown() {
        /* Powers down the Processor and shuts down all of the panels and I/O devices */
        const processor = context.processor;

        // Shut down the Processor and I/O.
        if (!processor.blocked) {
            processor.stop();
            processor.modeSwitch = Processor.modeOneOperation;  // to allow power down to succeed
            processor.terminateIO();
            if (statusMsgTimerToken < 5) {      // reuse this variable since it's not in use now
                ++ statusMsgTimerToken;
                setTimeout(systemShutDown, 1000);
                return;
            }
        }

        // If the Tally devices were redirected to the Flexowriter, don't call shutdown() on them.
        if (context.devices.tallyTapeReader === context.devices.flexowriter) {
            context.devices.tallyTapeReader = null;
        }

        if (context.devices.tallyTapePunch === context.devices.flexowriter) {
            context.devices.tallyTapePunch = null;
        }

        // Shutdown the I/O devices.
        for (const e in context.devices) {
            if (context.devices[e]) {
                context.devices[e].shutDown();
                context.devices[e] = null;
            }
        }

        // Power down the system and switch back to the emulator Home page.
        await processor.powerDown();
        $$("EmulatorFrame").style.visibility = "hidden";

        context.devices = null;
        context.controlPanel = null;
        context.processor = null;

        $$("StartUpBtn").disabled = false;
        $$("StartUpBtn").focus();
        $$("ConfigureBtn").disabled = false;
        config.flush();
        window.removeEventListener("beforeunload", beforeUnload);
    }

    /**************************************/
    function checkBrowser() {
        /* Checks whether this browser can support the necessary stuff */
        let missing = "";

        if (!window.ArrayBuffer) {missing += ", ArrayBuffer"}
        if (!window.DataView) {missing += ", DataView"}
        if (!window.Blob) {missing += ", Blob"}
        if (!window.File) {missing += ", File"}
        if (!window.FileReader) {missing += ", FileReader"}
        if (!window.FileList) {missing += ", FileList"}
        if (!window.indexedDB) {missing += ", IndexedDB"}
        if (!window.JSON) {missing += ", JSON"}
        if (!window.localStorage) {missing += ", LocalStorage"}
        if (!(window.performance && "now" in performance)) {missing += ", performance.now"}
        if (!window.Promise) {missing += ", Promise"}

        if (missing.length == 0) {
            return true;
        } else {
            alert("The emulator cannot run...\n" +
                "your browser does not support the following features:\n\n" +
                missing.substring(2));
            return false;
        }
    }

    /***** globalLoad() outer block *****/

    $$("StartUpBtn").disabled = true;
    $$("EmulatorVersion").textContent = Version.lgp21Version;
    if (checkBrowser()) {
        systemInitialize();
        //$$("StatusMsg").textContent = "??";
        //clearStatusMsg(30);
    }
} // globalLoad

window.addEventListener("load", globalLoad, {once: true});
