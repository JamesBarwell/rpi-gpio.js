
declare module 'rpi-gpio' {
    
    interface GPIO extends NodeJS.EventEmitter { 
        DIR_IN: string;
        DIR_OUT: string;
        DIR_LOW: string;
        DIR_HIGH: string;
    
        MODE_RPI: string;
        MODE_BCM: string;
    
        EDGE_NONE: string;
        EDGE_RISING: string;
        EDGE_FALLING: string;
        EDGE_BOTH: string;
    
        /**
         * Set pin reference mode. Defaults to 'mode_rpi'.
         *
         * @param {string} mode Pin reference mode, 'mode_rpi' or 'mode_bcm'
         */
        setMode(mode: string): void;
    
        /**
         * Setup a channel for use as an input or output, direction = DIR_OUT edge = EDGE_NONE
         *
         * @param {number}   channel   Reference to the pin in the current mode's schema
         * @param {function} onSetup   Optional callback
         */
        setup(channel: number, onSetup: (err: Error) => void): void;
    
        /**
         * Setup a channel for use as an input or output, edge = EDGE_NONE
         *
         * @param {number}   channel   Reference to the pin in the current mode's schema
         * @param {string}   direction The pin direction, either 'in' or 'out'     
         * @param {function} onSetup   Optional callback
         */
        setup(channel: number, direction: string, onSetup: (err: Error) => void): void;
    
        /**
         * Setup a channel for use as an input or output
         *
         * @param {number}   channel   Reference to the pin in the current mode's schema
         * @param {string}   direction The pin direction, either 'in' or 'out'
         * @param {string}   edge      edge Informs the GPIO chip if it needs to generate interrupts. Either 'none', 'rising', 'falling' or 'both'. Defaults to 'none'
         * @param {function} onSetup   Optional callback
         */
        setup(channel: number, direction?: string, edge?: string, onSetup?: (err: Error) => void): void;
    
        /**
         * Write a value to a channel
         *
         * @param {number}   channel The channel to write to
         * @param {boolean}  value   If true, turns the channel on, else turns off
         * @param {function} cb      Optional callback
         */
        write(channel: number, value: boolean, cb?: (err: Error) => void): void;
    
        /**
         * Write a value to a channel
         *
         * @param {number}   channel The channel to write to
         * @param {boolean}  value   If true, turns the channel on, else turns off
         * @param {function} cb      Optional callback
         */
        output(channel: number, value: boolean, cb?: (err: Error) => void): void;
        
        /**
         * Read a value from a channel
         *
         * @param {number}   channel The channel to read from
         * @param {function} cb      Callback which receives the channel's boolean value
         */
        read(channel: number, cb: (err: Error, value: boolean) => void): void;
    
        /**
         * Read a value from a channel
         *
         * @param {number}   channel The channel to read from
         * @param {function} cb      Callback which receives the channel's boolean value
         */
        input(channel: number, cb: (err: Error, value: boolean) => void): void;
        

        /**
         * Unexport any pins setup by this module
         *
         * @param {function} cb Optional callback
         */
        destroy(cb?: (err: Error) => void): void;
    
        /**
         * Reset the state of the module
         */
        reset(): void;
    }

    var internal: GPIO;
    export = internal;
}
