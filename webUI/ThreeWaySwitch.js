/***********************************************************************
* retro-lgp21/webUI ThreeWaySwitch.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for three-way toggle switch objects.
************************************************************************
* 2026-03-31  P.Kimpel
*   Original version, from retro-g15 ToggleSwitch.js.
***********************************************************************/

export {ThreeWaySwitch};

class ThreeWaySwitch {

    // Caption classes
    static imageClass =                 "toggleSwitch";
    static mainCaptionClass =           "toggleCaptionMain";
    static topLeftCaptionClass =        "toggleCaptionTopLeft";
    static bottomLeftCaptionClass =     "toggleCaptionBottomLeft";
    static middleLeftCaptionClass =     "toggleCaptionMiddleLeft";

    // Caption locations.
    static captionMain =       0;
    static captionTopLeft =    1;
    static captionBottomLeft = 2;
    static captionMiddleLeft = 3;

    // Switch state values.
    static stateOff = 0;
    static stateUp = 1;
    static stateDown = 2;


    constructor(parent, x, y, id, classList, offImage, onImage1, onImage2) {
        /* Parameters:
            parent      the DOM container element for this switch object.
            x & y       coordinates of the center of the switch.
            id          the DOM id for the lamp object.
            classList   CSS class name applied to image and captions
            offImage    path to image for the switch in the off state.
            onImage1    path to the image for the switch in the up state
            onImage2    path to the image for the switch in the down state */

        this.state = ThreeWaySwitch.stateOff;   // current switch state, 0=off, 1=up, 2=down
        this.mainCaptionDiv = null;             // optional main caption element
        this.topLeftCaptionDiv = null;          // optional top-left caption element
        this.bottomLeftCaptionDiv = null;       // optional bottom-left caption element
        this.middleLeftCaptionDiv = null;       // optional middle-left caption element
        this.classList = classList || "";       // optional class applied to image and captions
        this.offImage = offImage;               // image used for the off state
        this.onImage1 = onImage1;               // image used for the lower on state
        this.onImage2 = onImage2;               // image used for the upper on state
        this.x = x;
        this.y = y;
        this.boundCaptionClick = this.captionClick.bind(this);

        // visible DOM element
        if (x !== null) {
            this.element.style.left = `${x}px`;
        }
        if (y !== null) {
            this.element.style.top = `${y}px`;
        }

        this.element = document.createElement("img");
        this.element.id = id;
        this.element.className = `${ThreeWaySwitch.imageClass} ${classList}`;
        this.element.src = offImage;
        if (parent) {
            parent.appendChild(this.element);
        }
    }

    /**************************************/
    addEventListener(eventName, handler, useCapture) {
        /* Sets an event handler on the image element */

        this.element.addEventListener(eventName, handler, useCapture);
    }

    /**************************************/
    removeEventListener(eventName, handler, useCapture) {
        /* Removess an event handler from the image element */

        this.element.removeEventListener(eventName, handler, useCapture);
    }

    /**************************************/
    set(state) {
        /* Changes the visible state of the switch according to the value
        of "state" */

        if (this.state != state) {          // the state has changed
            switch (state) {
            case ThreeWaySwitch.stateDown:  // down position
                this.state = state;
                this.element.src = this.onImage1;
                break;
            case ThreeWaySwitch.stateUp:    // up position
                this.state = state;
                this.element.src = this.onImage2;
                break;
            default:                        // middle (off) position
                this.state = ThreeWaySwitch.stateOff;
                this.element.src = this.offImage;
                break;
            } // switch state
        }
    }

    /**************************************/
    flip() {
        /* Increments the visible state of the switch */

        this.set(this.state+1);
    }

    /**************************************/
    captionClick(ev) {
        /* Event handler to set the state when a caption is clicked */
        const e = ev.target;

        switch(true) {
        case e.classList.contains(ThreeWaySwitch.topLeftCaptionClass):
            this.set(ThreeWaySwitch.stateUp);
            ev.stopPropagation();
            break;
        case e.classList.contains(ThreeWaySwitch.bottomLeftCaptionClass):
            this.set(ThreeWaySwitch.stateOff);
            ev.stopPropagation();
            break;
        case e.classList.contains(ThreeWaySwitch.middleLeftCaptionClass):
            this.set(ThreeWaySwitch.stateDown);
            ev.stopPropagation();
            break;
        }
    }

    /**************************************/
    setCaption(caption, location=ThreeWaySwitch.captionMain) {
        /* Establishes an optional caption for a switch image.
        Returns the caption element */
        let e = null;

        switch (location) {
        case ThreeWaySwitch.captionMain:
            e = this.mainCaptionDiv;
            break;
        case ThreeWaySwitch.captionTopLeft:
            e = this.topLeftCaptionDiv;
            break;
        case ThreeWaySwitch.captionBottomLeft:
            e = this.bottomLeftCaptionDiv;
            break;
        case ThreeWaySwitch.captionMiddleLeft:
            e = this.middleLeftCaptionDiv;
            break;
        }

        if (!e) {
            e = document.createElement("div");
            switch (location) {
            case ThreeWaySwitch.captionMain:
                e.className = ThreeWaySwitch.mainCaptionClass;
                this.mainCaptionDiv = e;
                break;
            case ThreeWaySwitch.captionTopLeft:
                e.className = ThreeWaySwitch.topLeftCaptionClass;
                this.topLeftCaptionDiv =  e;
                break;
            case ThreeWaySwitch.captionBottomLeft:
                e.className = ThreeWaySwitch.bottomLeftCaptionClass;
                this.bottomLeftCaptionDiv = e;
                break;
            case ThreeWaySwitch.captionMiddleLeft:
                e.className = ThreeWaySwitch.middleLeftCaptionClass;
                this.middleLeftCaptionDiv = e;
                break;
            }

            if (this.x !== null) {
                this.element.style.left = `${this.x}px`;
            }
            if (this.y !== null) {
                this.element.style.top = `${this.y}px`;
            }

            e.classList.add(this.classList);
            this.element.parentNode.appendChild(e);
            e.addEventListener("click", this.boundCaptionClick);
        }

        if (e) {
            e.textContent = caption;
        }
        return e;
    }

} // class ThreeWaySwitch
