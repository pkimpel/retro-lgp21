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


    constructor(parent, x, y, id, classList, offImage, upImage, downImage) {
        /* Parameters:
            parent      the DOM container element for this switch object.
            x & y       coordinates of the center of the switch.
            id          the DOM id for the lamp object.
            classList   CSS class name applied to image and captions
            offImage    path to image for the switch in the off state.
            upImage    path to the image for the switch in the up state
            downImage    path to the image for the switch in the down state */

        this.state = ThreeWaySwitch.stateOff;   // current switch state, 0=off, 1=up, 2=down
        this.priorState = ThreeWaySwitch.stateDown; // prior state of the switch
        this.mainCaptionLabel = null;           // optional main caption element
        this.topLeftCaptionLabel = null;        // optional top-left caption element
        this.bottomLeftCaptionLabel = null;     // optional bottom-left caption element
        this.middleLeftCaptionLabel = null;     // optional middle-left caption element
        this.classList = classList || "";       // optional class applied to image and captions
        this.offImage = offImage;               // image used for the off state
        this.upImage = upImage;                 // image used for the lower on state
        this.downImage = downImage;             // image used for the upper on state
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

        if (this.state != state) {              // the state has changed
            this.priorState = this.state;
            switch (state) {
            case ThreeWaySwitch.stateUp:        // up (1) position
                this.state = state;
                this.element.src = this.upImage;
                break;
            case ThreeWaySwitch.stateDown:      // down (2) position
                this.state = state;
                this.element.src = this.downImage;
                break;
            default:                            // middle (0=off) position
                this.state = ThreeWaySwitch.stateOff;
                this.element.src = this.offImage;
                break;
            } // switch state
        }
    }

    /**************************************/
    flip() {
        /* Steps the state of the switch */

        switch (this.state) {
        case ThreeWaySwitch.stateUp:            // up (1) position
            this.set(ThreeWaySwitch.stateOff);
            break;
        case ThreeWaySwitch.stateDown:          // down (2) position
            this.set(ThreeWaySwitch.stateOff);
            break;
        default:                                // middle (0=off) position
            this.set(this.priorState == ThreeWaySwitch.stateUp ?
                    ThreeWaySwitch.stateDown : ThreeWaySwitch.stateUp);
            break;
        } // switch state
    }

    /**************************************/
    captionClick(ev) {
        /* Event handler to set the state when a caption is clicked */
        const e = ev.target;

        switch(true) {
        case e.classList.contains(ThreeWaySwitch.topLeftCaptionClass):
            this.set(ThreeWaySwitch.stateUp);
            break;
        case e.classList.contains(ThreeWaySwitch.bottomLeftCaptionClass):
            this.set(ThreeWaySwitch.stateDown);
            break;
        case e.classList.contains(ThreeWaySwitch.middleLeftCaptionClass):
            this.set(ThreeWaySwitch.stateOff);
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
            e = this.mainCaptionLabel;
            break;
        case ThreeWaySwitch.captionTopLeft:
            e = this.topLeftCaptionLabel;
            break;
        case ThreeWaySwitch.captionBottomLeft:
            e = this.bottomLeftCaptionLabel;
            break;
        case ThreeWaySwitch.captionMiddleLeft:
            e = this.middleLeftCaptionLabel;
            break;
        }

        if (!e) {
            e = document.createElement("label");
            e.htmlFor = this.element.id;
            switch (location) {
            case ThreeWaySwitch.captionMain:
                e.className = ThreeWaySwitch.mainCaptionClass;
                this.mainCaptionLabel = e;
                break;
            case ThreeWaySwitch.captionTopLeft:
                e.className = ThreeWaySwitch.topLeftCaptionClass;
                this.topLeftCaptionLabel =  e;
                break;
            case ThreeWaySwitch.captionBottomLeft:
                e.className = ThreeWaySwitch.bottomLeftCaptionClass;
                this.bottomLeftCaptionLabel = e;
                break;
            case ThreeWaySwitch.captionMiddleLeft:
                e.className = ThreeWaySwitch.middleLeftCaptionClass;
                this.middleLeftCaptionLabel = e;
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
