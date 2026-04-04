/***********************************************************************
* retro-lgp21/emulator Disk.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for the LGP-21 disk and system timing.
************************************************************************
* 2026-03-21  P.Kimpel
*   Original version.
***********************************************************************/

export {Disk}

import * as Util from "./Util.js";
import {Register} from "./Register.js";
import {WaitSignal} from "./WaitSignal.js";


class Disk {

    static minThrottleDelay =           // minimum time to accumulate throttling delay, >= 4ms
            Util.minTimeout+1;
    static storageName = "retro-lgp21-Disk-Storage-DB";
    static storageVersion = 1;                          // IndexedDB schema version
    static persistenceStore = "Persist";// name of the IDB store for disk persistence

    static S1 = [                       // S1 address track: maps sector location to sector address
        0x4000000, 0xC000100, 0x72000E4, 0xF2001E4, 0x64000C8, 0xE4001C8, 0x56000AC, 0xD6001AC,
        0x4800090, 0xC800190, 0x7A00074, 0xFA00174, 0x6C00058, 0xEC00158, 0x5E0003C, 0xDE0013C,
        0x5000020, 0xD000120, 0x4200004, 0xC200104, 0x74000E8, 0xF4001E8, 0x66000CC, 0xE6001CC,
        0x58000B0, 0xD8001B0, 0x4A00094, 0xCA00194, 0x7C00078, 0xFC00178, 0x6E0005C, 0xEE0015C,
        0x6000040, 0xE000140, 0x5200024, 0xD200124, 0x4400008, 0xC400108, 0x76000EC, 0xF6001EC,
        0x68000D0, 0xE8001D0, 0x5A000B4, 0xDA001B4, 0x4C00098, 0xCC00198, 0x7E0007C, 0xFE0017C,
        0x7000060, 0xF000160, 0x6200044, 0xE200144, 0x5400028, 0xD400128, 0x460000C, 0xC60010C,
        0x78000F0, 0xF8001F0, 0x6A000D4, 0xEA001D4, 0x5C000B8, 0xDC001B8, 0x4E0009C, 0xCE0019C,
        0x4000080, 0xC000180, 0x7200064, 0xF200164, 0x6400048, 0xE400148, 0x560002C, 0xD60012C,
        0x4800010, 0xC800110, 0x7A000F4, 0xFA001F4, 0x6C000D8, 0xEC001D8, 0x5E000BC, 0xDE001BC,
        0x50000A0, 0xD0001A0, 0x4200084, 0xC200184, 0x7400068, 0xF400168, 0x660004C, 0xE60014C,
        0x5800030, 0xD800130, 0x4A00014, 0xCA00114, 0x7C000F8, 0xFC001F8, 0x6E000DC, 0xEE001DC,
        0x60000C0, 0xE0001C0, 0x52000A4, 0xD2001A4, 0x4400088, 0xC400188, 0x760006C, 0xF60016C,
        0x6800050, 0xE800150, 0x5A00034, 0xDA00134, 0x4C00018, 0xCC00118, 0x7E000FC, 0xFE001FC,
        0x70000E0, 0xF0001E0, 0x62000C4, 0xE2001C4, 0x54000A8, 0xD4001A8, 0x460008C, 0xC60018C,
        0x7800070, 0xF800170, 0x6A00054, 0xEA00154, 0x5C00038, 0xDC00138, 0x4E0001C, 0xCE0011C];


    constructor() {
        /* Constructor for the LGP-21 disk object, including the disk-based registers */

        this.alertWin = window;

        // System timing and synchronization variables.
        this.eTime = 0;                 // current emulation time, ms
        this.eTimeSliceEnd = 0;         // current timeslice end emulation time, ms
        this.timingActive = false;      // true if clock is running
        this.runTime = 0;               // total accumulated run time, ms
        this.diskTime = 0;              // disk clock in word-times
        this.diskTimer = new Util.Timer();

        // Disk storage and track layout.
        this.diskSize = Util.physicalTracks*Util.physicalTrackSize;     // 4096 words
        this.diskBuf = new ArrayBuffer(this.diskWords*Util.wordBytes);  // 32-bit Uint words
        this.diskWord = new Uint32Array(this.diskBuf);
        this.L = new Register(7, this, false);  // current disk rotational position: word-time 0-127
        this.track = new Register(5, this, false);      // current track number, 0-31

        // Disk persistence IndexedDB
        this.db = null;                 // IndexedDB instance
        this.dberror = null;            // IndexedDB error handler
        this.dbabort = null;            // IndexedDb abort handler

        // Build the double-precision registers (not implemented as part of the disk array).
        this.regA = new Register(Util.wordBits, this, false);
        this.regC = new Register(Util.wordBits, this, false);
        this.regI = new Register(Util.wordBits, this, false);
        this.regAStarLow = new Register(Util.wordBits, this, false);
        this.regAStarHigh = new Register(Util.wordBits, this, false);

        // Restore the disk image from the persistence store.
        this.openDatabase();

        // Custom methods.
        this.regC.incAddress = function() {
            /* Increments only the address portion of the register, discarding
            any overflow to achieve address wraparound */

            if (this.visible) {
               this.updateLampGlow(0);
            }

            this.intVal = (this.intVal+Util.addressIncrement) & Util.addressMask;
        };

        this.regC.setOverflow = function(value) {
            /* Sets or resets the sign bit of the register. In the C register,
            this indicates arithmetic overflow */

            if (this.visible) {
               this.updateLampGlow(0);
            }

            this.intVal = value ? this.intVal | Util.wordSignMask
                                : this.intVal & ~Util.wordSignMask;
        };

        this.regC.getOverflow = function() {
            /* Returns the sign bit of the register. In the C register, this
            indicated whether arithmetic overflow is set */

            return (this.intVal & Util.wordSignMask) ? 1 : 0;
        };

    }

    /**************************************/
    startTiming() {
        /* Initializes the disk and emulation timing. The Math.max() is used
        to compensate for many browsers limiting the precision of
        performance.now() to one millisecond, which can make real time appear
        to go backwards */

        if (this.timingActive) {
            debugger;
        } else {
            const now = performance.now();
            this.timingActive = true;
            while (this.runTime >= 0) {
                this.runTime -= now;
            }

            if (Math.floor(now/Util.wordTime) > Math.floor(this.eTime/Util.wordTime)) {
                this.eTime = now;
            } else {
                this.eTime += Util.wordTime;
            }

            this.eTimeSliceEnd = this.eTime + Disk.minThrottleDelay;
            this.L.value = Math.floor(this.eTime/Util.wordTime) % Util.longLineSize;
        }
    }

    /**************************************/
    stopTiming() {
        /* Stops the run timer */

        if (!this.timingActive) {
            debugger;
        } else {
            const now = performance.now();
            this.timingActive = false;
            while (this.runTime < 0) {
                this.runTime += now;
            }
        }
    }

    /**************************************/
    async stepDisk() {
        /* Steps the disk to its next word-time and updates the timing.
        Returns either immediately or after a delay to allow browser real time
        to catch up with the emulation clock, this.eTime. Since most browsers
        will force a setTimeout() to wait for a minimum of 4ms, this routine
        will not delay if emulation time has not yet reached the end of its
        time slice */

        // If a step is already in progress, complain.
        if (this.stepWait) {
            throw new Error("Disk stepDrum called during stepping");
        }

        // Determine if it's time slow things down to real time.
        if ((this.eTime += Util.wordTime) < this.eTimeSliceEnd) {
            this.stepWait = Promise.resolve();  // i.e., don't wait at all
        } else {
            this.eTimeSliceEnd += Drum.minThrottleDelay;
            this.stepWait = this.diskTimer.delayUntil(this.eTime);
        }

        ++this.diskTime;
        this.L.inc();

        await this.stepWait;
        this.stepWait = null;
    }

    /**************************************/
    async seek(address) {
        /* Rotates the disk to the sector portion of "address" and sets
        this.track from the track portion of "address". Delays until the sector
        address is under the read head. The address parameter is in the format
        used by the C and I registers. Other bits in the parameter are ignored */
        const sectorBits = (address & Util.sectorMask);

        this.track.value = (address & Util.trackMask) >>> Util.trackShift;

        while ((Disk.S1[this.L.value] & Util.sectorMask) != sectorBits) {
            await this.stepDisk();
        }
    }

    /**************************************/
    async read() {
        /* Reads and returns a word transparently from current disk location
        specified by this.track and this.L (=this.sector) */
        const index = this.track.value*Util.physicalTrackSize + this.L.value;
        const word = this.diskWord[index];

        await this.stepDisk();
        return word;
    }

    /**************************************/
    async write(word) {
        /* Writes a word transparently to the current disk location specified
        by this.track and this.L (=this.dector). Unconditionally clears the
        spacer bit */
        const index = this.track.value*Util.physicalTrackSize + this.L.value;

        this.diskword[index] = word & Util.wordMask;
        await this.stepDisk();
    }

    /**************************************/
    async modify(transform) {
        /* Modifies a word transparently at the current disk location by
        applying the caller-supplied transform function to it. Unconditionally
        clears the spacer bit and returns the new value of the word */
        const index = this.track.value*Util.physicalTrackSize + this.L.value;

        let word = transform(this.diskWord[index]) & Util.wordMask;
        this.diskWord[index] = word;
        await this.stepDisk();
        return word;
    }

    /*******************************************************************
    *   Disk Image Perisistence Module                                 *
    *******************************************************************/

    /**************************************/
    genericIDBError(ev) {
        // Formats a generic alert message when an otherwise-unhandled data base error occurs */
        const msg = "Disk persistence UNHANDLED ERROR: " + ev.target.error.message;

        console.log(msg);
        this.alertWin?.alert(msg);
    }

    /**************************************/
    openDatabase() {
        /* Attempts to open the disk persistence database specified by
        Disk.storageName. If successful, sets this.db to the IDB object and
        fulfills the async Promise with value true */

        return new Promise((resolve, reject) => {
            const req = indexedDB.open(Disk.storageName, Disk.storageVersion);

            req.onerror = (ev) => {
                this.alertWin?.alert("Cannot open disk storage\ndata base \"" +
                      Disk.storageName + "\":\n" + ev.target.error);
            };

            req.onblocked = (ev) => {
                this.alertWin?.alert(Disk.storageName + " disk storage open is blocked -- CANNOT CONTINUE");
            };

            req.onupgradeneeded = (ev) => {
                /* Handles the onupgradeneeded event for the IDB data base. Upgrades
                the schema to the current version. For a new data base, creates the default
                configuration. "ev" is the upgradeneeded event */
                const req = ev.target;
                const db = req.result;
                const txn = req.transaction;

                txn.onabort = (ev) => {
                    this.alertWin?.alert("Aborted DB upgrade to disk storage\ndata base \"" +
                          Disk.storageName + "\":\n" + ev.target.error);
                };

                txn.onerror = (ev) => {
                    this.alertWin?.alert("Error in DB upgrade to Disk storage\ndata base \"" +
                          Disk.storageName + "\":\n" + ev.target.error);
                };

                if (ev.oldVersion < 1) {
                    // New data base: create store for disk persistence
                    const store = db.createObjectStore(Disk.persistenceStore);
                    store.put(this.diskBuf, 0);         // initialize the single object
                    console.log(`Disk data base initialized to version=${ev.newVersion}`);
                }

                if (ev.newVersion < Disk.storageVersion) {
                    this.alertWin?.alert("Disk storage downgrade unsupported: IDB version: old=" +
                          ev.oldVersion + ", new=" + ev.newVersion);
                    txn.abort();
                } else if (ev.newVersion > Disk.storageVersion) {
                    // This will need to be replaced by any necessary schema
                    // changes if the storage version is increased in the future.
                    this.alertWin?.alert("Disk storage upgrade unsupported: IDB version: old=" +
                          ev.oldVersion + ", new=" + ev.newVersion);
                    txn.abort();
                }
            };

            req.onsuccess = (ev) => {
                /* Handles a successful IDB open result */
                const idbError = this.genericIDBError.bind(this);

                // Save the DB object reference globally for later use
                this.db = ev.target.result;
                // Set up the generic error handlers
                this.dberror = idbError;
                this.dbabort = idbError;
                resolve(true);
                console.debug(`Disk persistence data base opened successfully, version=${Disk.storageVersion}`);
            };
        });
    }

    /**************************************/
    persist() {
        /* Stores the current contents of the entire disk in the IndexedDB
        instance to preserve it across a power-off. Returns a Promise that
        resolves to true if successful */

        return new Promise((resolve, reject) => {
            const txn = this.db.transaction(Disk.persistenceStore, "readwrite");
            const store = txn.objectStore(Disk.persistenceStore);

            txn.onerror = (ev) => {
                const msg = `Disk ${Disk.persistenceStore}: persist error: ${ev.target.error.name}`;
                console.log(msg);
                resolve(false);
            };

            txn.onabort = (ev) => {
                const msg = `Disk ${Disk.persistenceStore}: persist abort: ${ev.target.error.name}`;
                console.log(msg);
                resolve(false);
            };

            txn.oncomplete = (ev) => {
                resolve(true);
                console.log(`Disk ${Disk.persistenceStore}: memory image saved.`);
            };

            store.put(new Uint32Array(this.diskBuf), 0);
        });
    }

    /**************************************/
    restore() {
        /* Restores the contents of the entire disk from the IndexedDB instance.
        Returns a Promise that resolves to true if successful */

        return new Promise((resolve, reject) => {
            const txn = this.db.transaction(Disk.persistenceStore, "readonly");
            const store = txn.objectStore(Disk.persistenceStore);

            txn.onerror = (ev) => {
                const msg = `Disk ${Disk.persistenceStore}: restore error: ${ev.target.error.name}`;
                console.log(msg);
                resolve(false);
            };

            txn.onabort = (ev) => {
                const msg = `Disk ${Disk.persistenceStore}: restore abort: ${ev.target.error.name}`;
                console.log(msg);
                resolve(false);
            };

            txn.oncomplete = (ev) => {
                resolve(true);
                console.log(`Disk ${Disk.persistenceStore}: memory image restored.`);
            };

            store.get(0).onsuccess = (ev) => {
                const diskWords = new Uint32Array(this.diskBuf);
                diskWords.set(ev.target.result);
            };
        });
    }

} // class Disk
