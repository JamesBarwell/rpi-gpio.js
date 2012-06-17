# rp-gpio.js
==========


Control Raspberry Pi GPIO pins with node.js

## Setup
See this guide on how to get [node.js running on Raspberry Pi](http://elsmorian.com/post/23474168753/node-js-on-raspberry-pi).

## Usage
After loading the module, initialise a pin by calling `setup`. Each GPIO pin can be set as either an input or output, which lets you read and write to it respectively. The 'channel' must be specified, to indicate which pin to use. There are two different ways to reference a channel; either using the Raspberry Pi or the BCM naming schema. This module supports both (using the `setMode` function to switch), and uses the Raspberry Pi schema by default. Please see [this page](http://elinux.org/RPi_Low-level_peripherals) for more details.

### Listen for changes on RPi GPIO #7
The GPIO module inherits from `EventEmitter` so any of the [EventEmitter functions](http://nodejs.org/api/events.html) can be used. The example below shows how to listen for a change in value to a channel.
```js
var gpio = require('./rp-gpio');

var pin = 7;

gpio.setup(pin, gpio.DIRECTION.in);
gpio.on('change', function(channel, value) {
	console.log('Channel ' + channel + ' value is now ' + value);
});
```

### Voltage cycling on RPi GPIO #7 (or BCM GPIO #4)
This example shows how to set up a channel for output mode. After it is set up, it executes a callback which in turn calls another, causing the voltage to alternate up and down.
```js
var gpio = require('./rp-gpio');

var pin   = 7,
    delay = 2000,
    count = 0,
    max   = 3;

gpio.setup(pin, gpio.DIRECTION.out, on);

function on() {
    if (count >= max) {
        process.exit(0);
        return;
    }

    setTimeout(function() {
        gpio.write(pin, 1, off);
        count += 1;
    }, delay);
}

function off() {
    setTimeout(function() {
        gpio.write(pin, 0, on);
    }, delay);
}
```
