/***********************************************************************
* retro-lgp21/emulator Disk.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for the LGP-21 disk and system timing.
*
* Implements disk memory storage as Int32 (twos-complement signed binary
* integer words). Also manages the system timing (which on a real system
* was determined by disk rotational latency) and throttling of performance
* to legacy speed.
*
* The disk memory object can preserve its contents in a local IndexedDB
* instance across emulator restarts using its persist() and restore()
* methods. Both must be called externally. The data base is created
* automatically on first instantiation and the saved image words are set
* to zero values.
************************************************************************
* 2026-03-21  P.Kimpel
*   Original version.
***********************************************************************/

export {Disk}

import * as Util from "./Util.js";
import {Register} from "./Register.js";
import {WaitSignal} from "./WaitSignal.js";


class RegisterC extends Register {

    static addressIncrement = 1 << Util.sectorShift; // value to increment address fields


    incAddress() {
        /* Increments only the address portion of the register, discarding
        any overflow to achieve address wraparound */

        if (this.visible) {
           this.updateLampGlow(0);
        }

        this.intVal = (this.intVal & ~Util.addressMask) |
                      ((this.intVal & Util.addressMask) + RegisterC.addressIncrement) & Util.addressMask;
    }

    setOverflow(value) {
        /* Sets or resets the sign bit of the register. In the C register,
        this indicates arithmetic overflow */

        if (this.visible) {
           this.updateLampGlow(0);
        }

        this.intVal = value ? this.intVal | Util.wordSignMask
                            : this.intVal & ~Util.wordSignMask;
    }

    getOverflow() {
        /* Returns the sign bit of the register. In the C register, this
        indicated whether arithmetic overflow is set */

        return (this.intVal & Util.wordSignMask) ? 1 : 0;
    }
} // class RegisterC


class Disk {

    static defaultRPM = 1125;                           // default disk revolution speed, rev/min
    static maxRPM = Disk.defaultRPM*100;                // maximum disk revolution speed, rev/min
    static physicalTracks = 32;                         // physical number of tracks on the disk
    static physicalTrackSize = 128;                     // words in a physical track
    static logicalTracks = 64;                          // logical (LGP-30) number of tracks on the disk
    static logicalTrackSize = 64;                       // words in a logical (LGP-30) track
    static interleaveFactor = 18;                       // physical sector distance beween logical addresses
    static minThrottleDelay = Util.minTimeout*3;        // minimum time to accumulate throttling delay, >= 4ms
    static storageName = "retro-lgp21-Disk-Storage-DB";
    static storageVersion = 1;                          // IndexedDB schema version
    static memoryStore = "Persist";// name of the IDB store for disk persistence

    // Disk Timing Tracks:
    // S1 indexed by a physical disk location yields the logical sector address
    // in the NEXT physical disk location. This is used in this.findSector to
    // stop the sector search so that the desired word can be read in the next
    // word-time.
    static S1 = [                       // S1 address track: maps sector location to sector address
        0xC000100, 0x72000E4, 0xF2001E4, 0x64000C8, 0xE4001C8, 0x56000AC, 0xD6001AC, 0x4800090,
        0xC800190, 0x7A00074, 0xFA00174, 0x6C00058, 0xEC00158, 0x5E0003C, 0xDE0013C, 0x5000020,
        0xD000120, 0x4200004, 0xC200104, 0x74000E8, 0xF4001E8, 0x66000CC, 0xE6001CC, 0x58000B0,
        0xD8001B0, 0x4A00094, 0xCA00194, 0x7C00078, 0xFC00178, 0x6E0005C, 0xEE0015C, 0x6000040,
        0xE000140, 0x5200024, 0xD200124, 0x4400008, 0xC400108, 0x76000EC, 0xF6001EC, 0x68000D0,
        0xE8001D0, 0x5A000B4, 0xDA001B4, 0x4C00098, 0xCC00198, 0x7E0007C, 0xFE0017C, 0x7000060,
        0xF000160, 0x6200044, 0xE200144, 0x5400028, 0xD400128, 0x460000C, 0xC60010C, 0x78000F0,
        0xF8001F0, 0x6A000D4, 0xEA001D4, 0x5C000B8, 0xDC001B8, 0x4E0009C, 0xCE0019C, 0x4000080,
        0xC000180, 0x7200064, 0xF200164, 0x6400048, 0xE400148, 0x560002C, 0xD60012C, 0x4800010,
        0xC800110, 0x7A000F4, 0xFA001F4, 0x6C000D8, 0xEC001D8, 0x5E000BC, 0xDE001BC, 0x50000A0,
        0xD0001A0, 0x4200084, 0xC200184, 0x7400068, 0xF400168, 0x660004C, 0xE60014C, 0x5800030,
        0xD800130, 0x4A00014, 0xCA00114, 0x7C000F8, 0xFC001F8, 0x6E000DC, 0xEE001DC, 0x60000C0,
        0xE0001C0, 0x52000A4, 0xD2001A4, 0x4400088, 0xC400188, 0x760006C, 0xF60016C, 0x6800050,
        0xE800150, 0x5A00034, 0xDA00134, 0x4C00018, 0xCC00118, 0x7E000FC, 0xFE001FC, 0x70000E0,
        0xF0001E0, 0x62000C4, 0xE2001C4, 0x54000A8, 0xD4001A8, 0x460008C, 0xC60018C, 0x7800070,
        0xF800170, 0x6A00054, 0xEA00154, 0x5C00038, 0xDC00138, 0x4E0001C, 0xCE0011C, 0x4000000
        ];
    static S2 = 0b00000000000000000011111111111100;     // S2 timing track: address bits, all words
    static S3 = 0b10000000000011110011111000000000;     // S3 timing track: op & track bits, all words


    constructor() {
        /* Constructor for the LGP-21 disk object, including the disk-based registers */

        this.alertWin = window;

        // System timing and synchronization variables.
        this.diskRPM = Disk.defaultRPM; // disk revolution speed, rev/minute
        this.wordTime = 0;              // one word time on the disk [128 words/rev], ms
        this.bitTime = 0;               // one bit time on the disk, ms
        this.diskCycleTime = 0;         // one disk cycle (128 words), ms
        this.timingFactor = 1;          // global emulator speed factor
        this.eTime = 0;                 // current emulation time, ms
        this.eTimeSliceEnd = 0;         // current timeslice end emulation time, ms
        this.timingActive = false;      // true if clock is running
        this.runTime = 0;               // total accumulated run time, ms
        this.diskTime = 0;              // disk clock in word-times

        // Disk storage and track layout.
        this.diskSize = Disk.physicalTracks*Disk.physicalTrackSize;     // 4096 words
        this.diskMem = new Uint32Array(this.diskSize);                  // the memory storage
        this.L = new Register(7, this, false);  // current disk rotational position: word-time 0-127
        this.track = new Register(5, this, false);      // current track number, 0-31
        this.diskIndex = 0;             // current 0-relative index into diskMem[]

        // Disk persistence IndexedDB
        this.db = null;                 // IndexedDB instance
        this.dberror = null;            // IndexedDB error handler
        this.dbabort = null;            // IndexedDb abort handler

        // Build the double-precision registers (not implemented as part of the disk array).
        this.regA = new Register(Util.wordBits, this, false);           // accumulator
        this.regC = new RegisterC(Util.wordBits, this, false);          // instruction counter
        this.regR = new Register(Util.wordBits, this, false);           // instruction word
        this.regAStarLow = new Register(Util.wordBits, this, false);
        this.regAStarHigh = new Register(Util.wordBits, this, false);

        // Restore the memory disk image from its persistence store.
        this.openDatabase();            // initiates restore, which runs asyncronously
        this.setTiming(Disk.defaultRPM);
    }


    /**************************************/
    startTiming() {
        /* Initializes the disk and emulation timing by using real-world time
        to determine the current rotational position of the disk. Math.floor()
        is used to compensate for many browsers limiting the precision of
        performance.now() to one millisecond, which can make real time appear
        to go backwards. Starts the Run Timer */

        if (this.timingActive) {
            debugger;
        } else {
            const now = performance.now();
            this.timingActive = true;
            while (this.runTime >= 0) {
                this.runTime -= now;
            }

            if (Math.floor(now/this.wordTime) > Math.floor(this.eTime/this.wordTime)) {
                this.eTime = now;
            } else {
                this.eTime += this.wordTime;
            }

            this.eTimeSliceEnd = this.eTime + Disk.minThrottleDelay;
            this.L.value = Math.floor(this.eTime/this.wordTime) % Disk.physicalTrackSize;
        }
    }

    /**************************************/
    stopTiming() {
        /* Stops the Run Timer */

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
    setTiming(newRPM=Disk.defaultRPM) {
        /* Computes the disk timing factors from the specified newRPM */

        if (newRPM > 0 && newRPM <= Disk.maxRPM) {
            this.diskRPM = newRPM;                                      // disk revolution speed, rev/minute
            this.timingFactor = this.diskRPM/Disk.defaultRPM;           // emulator speed factor
            this.wordTime = 60000/this.diskRPM/Disk.physicalTrackSize;  // one word time on the disk, ms
            this.bitTime = this.wordTime/Util.wordBits;                 // one bit time on the disk, ms
            this.diskCycleTime = this.wordTime*Disk.physicalTrackSize;  // one disk revolution (128 words), ms
        }
    }

    /**************************************/
    stepDisk() {
        /* Steps the disk to its next word-time and updates the emulation
        timing. Returns true if it is time for a throttling delay. Since most
        browsers will force a setTimeout() to wait for a minimum of 4ms, this
        routine will not signal a delay if emulation time has not yet reached
        the end of its time slice. Does not increment the track number */
        let paws = false;               // time to throttle

        ++this.diskTime;
        const newL = this.L.inc();
        this.diskIndex = this.track.value*Disk.physicalTrackSize + newL;

        // Determine if it's time to throttle the emulation until real time catches up.
        if ((this.eTime += this.wordTime) > this.eTimeSliceEnd) {
            paws = true;
            this.eTimeSliceEnd += Disk.minThrottleDelay;
        }

        return paws;
    }

    /**************************************/
    computeDiskIndex(address) {
        /* Returns diskMem index for logical address "address", i.e., at the
        address the Processor uses, not the physical sector location. The
        address is a simple integer, not the C register format. This calculation
        looks weird because it has to unravel the 18-word sector interleaving */
        const logicalSector = address%Disk.logicalTrackSize;
        const logicalTrack = (address - logicalSector)/Disk.logicalTrackSize;
        const halfTrack = logicalTrack%2;

        return (logicalSector*Disk.interleaveFactor)%Disk.physicalTrackSize +   // physical track offset
               (logicalTrack - halfTrack)*Disk.logicalTrackSize +               // physical track start
               halfTrack;                                                       // logical even/odd track
    }

    /**************************************/
    fetchWord(address) {
        /* Returns the word value at logical address "address", i.e., at the
        address the Processor uses, not the physical sector location. The
        address is a simple integer, not the C register format */

        return this.diskMem[this.computeDiskIndex(address)] >>> 0;
    }

    /**************************************/
    storeWord(address, word) {
        /* Stores the word value at logical address "address", i.e., at the
        address the Processor uses, not the physical sector location. The
        address is a simple integer, not the C register format */

        this.diskMem[this.computeDiskIndex(address)] = word >>> 0;
    }

    /**************************************/
    findSector(address) {
        /* Returns true if the sector portion of "address" matches the current
        S1 sector address, which is the logical address of the NEXT physical
        location (L+1) on the disk. Sets this.track from the track portion of
        "address". The address parameter is in the format used by the C and R
        registers. Other bits in the parameter are ignored. Returns true if at
        the desired sector. DOES NOT STEP to the next physical location (that
        will be done by Processor Phase 1 or 3 to step to the word it needs) */
        const currentLoc = this.L.value;
        const targetSector = (address & Util.sectorMask);
        const targetTrack = (address & Util.trackMask) >>> Util.trackShift;

        this.track.value = targetTrack;
        this.diskIndex = targetTrack*Disk.physicalTrackSize + currentLoc;

        if ((Disk.S1[currentLoc] & Util.sectorMask) == targetSector) {
            return true;
        } else {
            return false;
        }
    }

    /**************************************/
    read() {
        /* Reads and returns a word transparently from current disk location
        specified by this.track and this.L. Does not step */
        const word = this.diskMem[this.diskIndex];

        return word;
    }

    /**************************************/
    write(word) {
        /* Writes a word transparently to the current disk location specified
        by this.track and this.L (=this.dector). Unconditionally clears the
        spacer bit. Does not step */

        this.diskMem[this.diskIndex] = (word & Util.wordMask) >>> 0;    // make sure it's 32-bit unsigned
    }

    /**************************************/
    modify(transform) {
        /* Modifies a word transparently at the current disk location by
        applying the caller-supplied transform function to it. Unconditionally
        clears the spacer bit and returns the new value of the word.
        Does not step */

        let word = transform(this.diskMem[this.diskIndex]) & Util.wordMask;
        this.diskMem[this.diskIndex] = word >>> 0;                      // make sure it's 32-bit unsigned
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
                this.alertWin?.alert(`Cannot open Memory ${Disk.storageName} data base:\n` +
                        ev.target.error);
            };

            req.onblocked = (ev) => {
                this.alertWin?.alert(`Memory ${Disk.storageName} data base ` +
                        "open is blocked -- CANNOT CONTINUE");
            };

            req.onupgradeneeded = (ev) => {
                /* Handles the onupgradeneeded event for the IDB data base. Upgrades
                the schema to the current version. For a new data base, creates the default
                configuration. "ev" is the upgradeneeded event */
                const req = ev.target;
                const db = req.result;
                const txn = req.transaction;

                txn.onabort = (ev) => {
                    this.alertWin?.alert(`Memory ${Disk.storageName} DB upgrade aborted to data base\n` +
                            ev.target.error);
                };

                txn.onerror = (ev) => {
                    this.alertWin?.alert(`Memory ${Disk.storageName} DB upgrade error:\n` +
                            ev.target.error);
                };

                if (ev.oldVersion < 1) {
                    // New data base: create store for memory persistence
                    const store = db.createObjectStore(Disk.memoryStore);
                    store.put(this.diskMem, 0);        // initialize the single DB object
                    console.log(`Memory ${Disk.storageName} data base initialized to version=` +
                            `${ev.newVersion}, ${this.diskMem.length} words`);
                }

                if (ev.newVersion < Disk.storageVersion) {
                    this.alertWin?.alert(`Memory ${Disk.storageName} DB downgrade unsupported:\n` +
                            `IDB version: old=${ev.oldVersion}, new=${ev.newVersion}`);
                    txn.abort();
                } else if (ev.newVersion > Disk.storageVersion) {
                    // This will need to be replaced by any necessary schema
                    // changes if the storage version is increased in the future.
                    this.alertWin?.alert(`Memory ${Disk.storageName} DB upgrade unsupported:\n` +
                            `IDB version: old=${ev.oldVersion}, new=${ev.newVersion}`);
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
                console.debug(`Memory data base "${Disk.storageName}" opened successfully, version=` +
                        Disk.storageVersion);
            };
        });
    }

    /**************************************/
    persist() {
        /* Stores the current contents of the entire disk in the IndexedDB
        instance to preserve it across a power-off. Returns a Promise that
        resolves to true if successful */

        return new Promise((resolve, reject) => {
            const txn = this.db.transaction(Disk.memoryStore, "readwrite");
            const store = txn.objectStore(Disk.memoryStore);

            txn.onerror = (ev) => {
                const msg = `Memory ${Disk.memoryStore}: persist error: ${ev.target.error.name}`;
                console.log(msg);
                resolve(false);
            };

            txn.onabort = (ev) => {
                const msg = `Memory ${Disk.memoryStore}: persist abort: ${ev.target.error.name}`;
                console.log(msg);
                resolve(false);
            };

            txn.oncomplete = (ev) => {
                resolve(true);
                console.log(`Memory ${Disk.memoryStore}: memory image saved, ` +
                        `${this.diskMem.length} words.`);
            };

            store.put(this.diskMem, 0);
        });
    }

    /**************************************/
    restore() {
        /* Restores the contents of the entire memory from the IndexedDB instance.
        Returns a Promise that resolves to true if successful */

        return new Promise((resolve, reject) => {
            const txn = this.db.transaction(Disk.memoryStore, "readonly");
            const store = txn.objectStore(Disk.memoryStore);

            txn.onerror = (ev) => {
                const msg = `Memory ${Disk.memoryStore}: restore error: ${ev.target.error.name}`;
                console.log(msg);
                resolve(false);
            };

            txn.onabort = (ev) => {
                const msg = `Memory ${Disk.memoryStore}: restore abort: ${ev.target.error.name}`;
                console.log(msg);
                resolve(false);
            };

            txn.oncomplete = (ev) => {
                resolve(true);
            };

            store.get(0).onsuccess = (ev) => {
                // The slice shouldn't be necessary, but is a belt-and-suspenders thing.
                const buf = ev.target.result;
                this.diskMem.set(buf.slice(0, this.diskMem.length));
                console.log(`Memory ${Disk.memoryStore}: memory image restored, ` +
                        `${buf.length} words.`);
            };
        });
    }

} // class Disk
