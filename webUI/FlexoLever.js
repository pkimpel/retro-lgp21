/***********************************************************************
* retro-lgp21/webUI FlexoLever.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General Precision LGP-21 emulator Flexowriter "lever" switch object.
*
* Defines the lever switches on the Flexowriter, which were glorified
* toggle switches.
*
************************************************************************
* 2026-04-09  P.Kimpel
*   Original version.
***********************************************************************/

export {FlexoLever};

class FlexoLever {
    /* Implements the toggle levers along the top of the Flexowriter case.
    These were essentially toggle switches that were either latching or
    momentary depending on their purpose. The lever face rotated down when
    pressed to their on-state. Each lever had a centered label */

    static offClass = "flexoLeverUp";
    static onClass = "flexoLeverDown";

    constructor(parent, x, y, id, label, momentary) {
        /* Parameters:
            parent      the DOM container element for this switch object.
            x & y       optional coordinates of the switch within its containing element.
            id          the DOM id for the switch object.
            momentary   true if this is a momentary switch, false if latching */

        this.state = 0;                     // current switch state, 0=off (up)

        // visible DOM element
        this.element = document.createElement("button");
        this.element.id = id;
        this.element.className = FlexoLever.offClass;
        this.momentary = momentary ? true : false;
        this.boundFlip = this.flip.bind(this);

        if (x !== null) {
            this.element.style.left = x.toString() + "px";
        }
        if (y !== null) {
            this.element.style.top = y.toString() + "px";
        }

        this.setLabel(label);
        if (parent) {
            parent.appendChild(this.element);
        }


        if (!this.momentary) {
            this.addEventListener("click", this.boundFlip, false);
        } else {
            this.addEventListener("mousedown", (ev) => {
                this.element.classList.add(FlexoLever.onClass);
            }, false);
            this.addEventListener("mouseup", (ev) => {
                this.element.classList.remove(FlexoLever.onClass);
            }, false);
        }
    }

    /**************************************/
    addEventListener(eventName, handler, useCapture) {
        /* Sets an event handler whenever the image element is clicked */

        this.element.addEventListener(eventName, handler, useCapture);
    }

    /**************************************/
    removeEventListener(eventName, handler, useCapture) {
        /* Removes an event handler */

        this.element.addEventListener(eventName, handler, useCapture);
    }

    /**************************************/
    set(newState) {
        /* Changes the visible state of the switch according to the value of
        "newState", 0/1 */

        if (this.state != newState) {       // the state has changed
            this.state = newState ? 1 : 0;
            if (newState) {
                this.element.classList.add(FlexoLever.onClass);
            } else {
                this.element.classList.remove(FlexoLever.onClass);
            }
        }
    }

    /**************************************/
    flip() {
        /* Complements the visible state of the switch */

        this.set(1 - this.state);
    }

    /**************************************/
    setLabel(label) {
        /* Sets the switch's label */

        this.element.textContent = label;
    }

    /**************************************/
    shutDown() {
        /* Unwires the control's events */


    }
} // class FlexoLever
