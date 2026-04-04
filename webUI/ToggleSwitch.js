/***********************************************************************
* retro-lgp21/webUI ToggleSwitch.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for two-position toggle switch objects.
************************************************************************
* 2026-03-31  P.Kimpel
*   Original version, from retro-g15 ToggleSwitch.js.
***********************************************************************/

export {ToggleSwitch};

class ToggleSwitch {

    // Caption classes
    static imageClass =                 "toggleSwitch";
    static mainCaptionClass =           "toggleCaptionMain";
    static topLeftCaptionClass =        "toggleCaptionTopLeft";
    static bottomLeftCaptionClass =     "toggleCaptionBottomLeft";

    // Caption locations.
    static captionMain =       0;
    static captionTopLeft =    1;
    static captionBottomLeft = 2;


    constructor(parent, x, y, id, classList, offImage, onImage) {
        /* Parameters:
            parent      the DOM container element for this switch object.
            x & y       coordinates of the center of the switch.
            id          the DOM id for the lamp object.
            classList   CSS class name applied to image and captions
            offImage    path to image for the switch in the off state.
            onImage     path to the image for the switch in the on state */

        this.state = 0;                         // current switch state, 0=off
        this.mainCaptionDiv = null;             // optional main caption element
        this.topLeftCaptionDiv = null;          // optional top-left caption element
        this.bottomLeftCaptionDiv = null;       // optional bottom-left caption element
        this.classList = classList || "";       // optional class applied to image and captions
        this.offImage = offImage;               // image used for the off state
        this.onImage = onImage;                 // image used for the on state
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
        this.element.className = `${ToggleSwitch.imageClass} ${classList}`;
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
        /* Changes the visible state of the switch according to the low-order
        bit of "state" */
        let newState = state & 1;

        if (this.state ^ newState) {         // the state has changed
            this.state = newState;
            this.element.src = (newState ? this.onImage : this.offImage);
        }
    }

    /**************************************/
    flip() {
        /* Complements the visible state of the switch */
        let newState = this.state ^ 1;

        this.state = newState;
        this.element.src = (newState ? this.onImage : this.offImage);
    }

    /**************************************/
    captionClick(ev) {
        /* Event handler to set the state when a caption is clicked */
        const e = ev.target;

        switch(true) {
        case e.classList.contains(ToggleSwitch.topLeftCaptionClass):
            this.set(1);
            ev.stopPropagation();
            break;
        case e.classList.contains(ToggleSwitch.bottomLeftCaptionClass):
            this.set(0);
            ev.stopPropagation();
            break;
        }
    }

    /**************************************/
    setCaption(caption, location=ToggleSwitch.captionMain) {
        /* Establishes an optional caption for a switch image.
        Returns the caption element */
        let e = null;

        switch (location) {
        case ToggleSwitch.captionMain:
            e = this.mainCaptionDiv;
            break;
        case ToggleSwitch.captionTopLeft:
            e = this.topLeftCaptionDiv;
            break;
        case ToggleSwitch.captionBottomLeft:
            e = this.bottomLeftCaptionDiv;
            break;
        }

        if (!e) {
            e = document.createElement("div");
            switch (location) {
            case ToggleSwitch.captionMain:
                e.className = ToggleSwitch.mainCaptionClass;
                this.mainCaptionDiv = e;
                break;
            case ToggleSwitch.captionTopLeft:
                e.className = ToggleSwitch.topLeftCaptionClass;
                this.topLeftCaptionDiv =  e;
                break;
            case ToggleSwitch.captionBottomLeft:
                e.className = ToggleSwitch.bottomLeftCaptionClass;
                this.bottomLeftCaptionDiv = e;
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

} // class ToggleSwitch
