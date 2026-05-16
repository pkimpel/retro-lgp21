/***********************************************************************
* retro-lgp21/webUI WebUIUtil.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General Precision LGP-21 emulator web-based UI utilities.
************************************************************************
* 2026-03-31  P.Kimpel
*   Original version, from retro-g15 PopUtil.js.
* 2026-05-15  P.Kimpel
*   Revised into a module of general-purpose web user-interface utilities.
***********************************************************************/

export {openPopup, computeTextPitch};

// Private variables
let popupOpenDelayIncrement = 250;      // increment for pop-up open delay adjustment, ms
let popupOpenDelay = 500;               // current pop-up open delay, ms
let popupOpenQueue = [];                // queue of pop-up open argument objects


/**************************************/
function openPopup(parent, url, windowName, options, context, onload) {
    /* Schedules the opening of a pop-up window so that browsers such as Apple
    Safari (11.0+) will not block the opens if they occur too close together.
    Parameters:
        parent:     parent window for the pop-up
        url:        url of window context, passed to window.open()
        windowName: internal name of the window, passed to window.open()
        options:    string of window options, passed to window.open()
        context:    object context ("this") for the onload function (may be null)
        onload:     event handler for the window's onload event (may be null).
    Queues window open requests and processes them to completion sequentially.
    This attempts to defeat browsers that limit how quickly a page can open
    sub-windows if there has been no user action to trigger the open. If the
    queue of pending pop-up opens in popupOpenQueue[] is empty, then attempts
    to open the window immediately. Otherwise queues the open parameters, which will be dequeued and acted upon after the previously-
    queued entries are completed by dequeuePopup() */

    popupOpenQueue.push({
        parent: parent,
        url: url,
        windowName: windowName,
        options: options,
        context: context,
        onload: onload});
    if (popupOpenQueue.length == 1) { // queue was empty
        dequeuePopup();
    }
}

/**************************************/
function dequeuePopup() {
    /* Dequeues a popupOpenQueue[] entry and attempts to open the pop-up window.
    Called either directly by openPopup() when an entry is inserted into an
    empty queue, or by setTimeout() after a delay. If the open fails, the entry
    is reinserted into the head of the queue, the open delay is incremented, and
    this function is rescheduled for the new delay. If the open is successful,
    attaches a load event to the new window, which will call the request's
    "onload" routine. If the queue is non-empty, this function is then scheduled
    for the current open delay to process the next entry in the queue */
    let entry = popupOpenQueue.shift();
    let loader1 = null;
    let loader2 = null;
    let win = null;

    if (entry) {
        try {
            win = entry.parent.open(entry.url, entry.windowName, entry.options);
        } catch (e) {
            win = null;
        }

        if (!win) {                     // window open failed, requeue
            popupOpenQueue.unshift(entry);
            popupOpenDelay += popupOpenDelayIncrement;
            setTimeout(dequeuePopup, popupOpenDelay);
            //console.log("Pop-up open failed: " + entry.windowName + ", new delay=" + popupOpenDelay + "ms");
        } else {                        // window open was successful
            if (entry.onload) {
                loader1 = entry.onload.bind(entry.context);
                win.addEventListener("load", loader1, false);
            }

            loader2 = function(ev) {    // remove the load event listeners after loading
                win.removeEventListener("load", loader2, false);
                if (loader1) {
                    win.removeEventListener("load", loader1, false);
                }
            };

            win.addEventListener("load", loader2, false);
            if (popupOpenQueue.length > 0) {
                setTimeout(dequeuePopup, popupOpenDelay);
            }
        }
    }
}

/**************************************/
function computeTextPitch(win, element, text) {
    /* Calculates the average character pitch in pixels/character of
    "text" in the context of current styling for the DOM element "element"
    as a descendant of window "win". Adapted from retro-1620 and
    https://www.geeksforgeeks.org/calculate-the-width-of-the-text-in-javascript/ */
    const standardText = "ABCDEFGHIJKLMNOPQRSTUVWXYZ.(-+;/.,'\"*_ (0123456789|)";
    const getCssStyle = (e, prop) => {
        return win.getComputedStyle(e, null).getPropertyValue(prop);
    };

    // Determine the current font properties for the element.
    const fontWeight = getCssStyle(element, 'font-weight') || 'normal';
    const fontSize = getCssStyle(element, 'font-size') || '12px';
    const fontFamily = getCssStyle(element, 'font-family') || 'monospace';

    // Create a temporary Canvas element and set its font.
    const canvas = document.createElement("canvas");
    const dc = canvas.getContext("2d");
    const fontSpecs = `${fontWeight} ${fontSize} ${fontFamily}`;
    dc.font = fontSpecs;

    // Compute the width of some sample text and from that the average
    // pitch of the characters in that text.
    const sampleText = text || standardText;
    const textSpecs = dc.measureText(sampleText);
    const sampleWidth = textSpecs.width;

    //console.debug("computeTextPitch: font specs %s, sample width %f / length %i = pitch %f",
    //          fontSpecs, sampleWidth, sampleText.length, sampleWidth/sampleText.length);

    return sampleWidth/sampleText.length;
}
