rpi-gpio.js
==========

Control Raspberry Pi GPIO pins with io.js / node.js

[![Build Status](https://travis-ci.org/JamesBarwell/rpi-gpio.js.svg?branch=master)](https://travis-ci.org/JamesBarwell/rpi-gpio.js)
[![NPM version](https://badge.fury.io/js/rpi-gpio.svg)](http://badge.fury.io/js/rpi-gpio)

## Supported hardware

* Raspberry Pi 1 Model A
* Raspberry Pi 1 Model A+
* Raspberry Pi 1 Model B
* Raspberry Pi 1 Model B+
* Raspberry Pi 2 Model B

### Unknown - please raise an issue to let us know if this works for you

* Raspberry Pi 3 Model B
* Raspberry Pi Zero

## Setup
See this guide on how to get [node.js running on Raspberry Pi](https://learn.adafruit.com/node-embedded-development/installing-node-dot-js).

This module can then be installed with npm:
```
npm install rpi-gpio
```

### Dependency

If you are having trouble installing this module make sure you are running gcc/g++ `-v 4.8` or higher. [Here](https://github.com/fivdi/onoff/wiki/Node.js-v4-and-native-addons) is an installation guide.

## Usage
Firstly, make make sure you are running your application as root or with sudo, else the Raspberry Pi will not let you output to the GPIO.

Before you can read or write, you must use setup() to open a channel, and must specify whether it will be used for input or output. Having done this, you can then read in the state of the channel or write a value to it using read() or write().

All of the functions relating to the pin state within this module are asynchronous, so where necessary - for example in reading the value of a channel - a callback must be provided. This module inherits the standard [EventEmitter](http://nodejs.org/api/events.html), so you may use its functions to listen to events.

Please note that there are two different and confusing ways to reference a channel; either using the Raspberry Pi or the BCM/SoC naming schema (sadly, neither of which match the physical pins!). This module supports both schemas, with Raspberry Pi being the default. Please see [this page](http://elinux.org/RPi_Low-level_peripherals) for more details.

## API

### Methods

#### setup(channel [, direction, edge], callback)
Sets up a channel for read or write. Must be done before the channel can be used.
* channel: Reference to the pin in the current mode's schema.
* direction: The pin direction, pass either DIR_IN for read mode or DIR_OUT for write mode. You can also pass DIR_LOW or DIR_HIGH to use the write mode and specify an initial state of 'off' or 'on' respectively. Defaults to DIR_OUT.
* edge: Interrupt generating GPIO chip setting, pass in EDGE_NONE for no interrupts, EDGE_RISING for interrupts on rising values, EDGE_FALLING for interrupts on falling values or EDGE_BOTH for all interrupts.
Defaults to EDGE_NONE.
* callback: Provides Error as the first argument if an error occurred.

#### read(channel, callback)
Reads the value of a channel.
* channel: Reference to the pin in the current mode's schema.
* callback: Provides Error as the first argument if an error occured, otherwise the pin value boolean as the second argument.

#### write(channel, value [, callback])
Writes the value of a channel.
* channel: Reference to the pin in the current mode's schema.
* value: Boolean value to specify whether the channel will turn on or off.
* callback: Provides Error as the first argument if an error occured.

#### setMode(mode)
Sets the channel addressing schema.
* mode: Specify either Raspberry Pi or SoC/BCM pin schemas, by passing MODE_RPI or MODE_BCM. Defaults to MODE_RPI.

#### input()
Alias of read().

#### output()
Alias of write().

#### destroy()
Tears down any previously set up channels.

#### reset()
Tears down the module state - used for testing.

### Events
See Node [EventEmitter](http://nodejs.org/api/events.html) for documentation on listening to events.

#### change
Emitted when the value of a channel changed
* channel
* value

## Examples

### Setup and read the value of a pin
```js
var gpio = require('rpi-gpio');

gpio.setup(7, gpio.DIR_IN, readInput);

function readInput() {
    gpio.read(7, function(err, value) {
        console.log('The value is ' + value);
    });
}
```

### Setup and write to a pin
```js
var gpio = require('rpi-gpio');

gpio.setup(7, gpio.DIR_OUT, write);

function write() {
    gpio.write(7, true, function(err) {
        if (err) throw err;
        console.log('Written to pin');
    });
}
```

### Setup and write to a pin that starts as on
This example shows how to setup the pin for write mode with the default state as
"on". Why do this? It can sometimes be useful to reverse the default initial
state due to wiring or uncontrollable circumstances.
```js
var gpio = require('rpi-gpio');

gpio.setup(7, gpio.DIR_HIGH, write);

function write() {
    gpio.write(7, false, function(err) {
        if (err) throw err;
        console.log('Written to pin');
    });
}
```

### Listen for changes on a pin
```js
var gpio = require('rpi-gpio');

gpio.on('change', function(channel, value) {
	console.log('Channel ' + channel + ' value is now ' + value);
});
gpio.setup(7, gpio.DIR_IN, gpio.EDGE_BOTH);
```

### Unexport pins opened by the module when finished
```js
var gpio = require('../rpi-gpio');

gpio.on('export', function(channel) {
    console.log('Channel set: ' + channel);
});

gpio.setup(7, gpio.DIR_OUT);
gpio.setup(15, gpio.DIR_OUT);
gpio.setup(16, gpio.DIR_OUT, pause);

function pause() {
    setTimeout(closePins, 2000);
}

function closePins() {
    gpio.destroy(function() {
        console.log('All pins unexported');
    });
}
```


### Voltage cycling a pin
This example shows how to set up a channel for output mode. After it is set up, it executes a callback which in turn calls another, causing the voltage to alternate up and down three times.
```js
var gpio = require('rpi-gpio');

var pin   = 7;
var delay = 2000;
var count = 0;
var max   = 3;

gpio.setup(pin, gpio.DIR_OUT, on);

function on() {
    if (count >= max) {
        gpio.destroy(function() {
            console.log('Closed pins, now exit');
        });
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

### Using flow control modules
Due to the asynchronous nature of this module, using an asynchronous flow control module can help to simplify development. This example uses [async.js](https://github.com/caolan/async) to turn pins on and off in series.
```js
var gpio = require('rpi-gpio');
var async = require('async');

async.parallel([
    function(callback) {
        gpio.setup(7, gpio.DIR_OUT, callback)
    },
    function(callback) {
        gpio.setup(15, gpio.DIR_OUT, callback)
    },
    function(callback) {
        gpio.setup(16, gpio.DIR_OUT, callback)
    },
], function(err, results) {
    console.log('Pins set up');
    write();
});

function write() {
    async.series([
        function(callback) {
            delayedWrite(7, true, callback);
        },
        function(callback) {
            delayedWrite(15, true, callback);
        },
        function(callback) {
            delayedWrite(16, true, callback);
        },
        function(callback) {
            delayedWrite(7, false, callback);
        },
        function(callback) {
            delayedWrite(15, false, callback);
        },
        function(callback) {
            delayedWrite(16, false, callback);
        },
    ], function(err, results) {
        console.log('Writes complete, pause then unexport pins');
        setTimeout(function() {
            gpio.destroy(function() {
                console.log('Closed pins, now exit');
            });
        }, 500);
    });
};

function delayedWrite(pin, value, callback) {
    setTimeout(function() {
        gpio.write(pin, value, callback);
    }, 500);
}
```

## Contributing
Contributions are appreciated, both in the form of bug reports and pull requests.

Due to the nature of this project it can be quite time-consuming to test against real hardware, so the automated test suite is all the more important. I will not accept any pull requests that cause the build to fail, and probably will not accept any that do not have corresponding test coverage.

You can run the tests with npm:
```
npm test
```
and create a coverage report with:
```
npm run coverage
```
There is also an integration test that you can run on Raspberry Pi hardware, having connected two GPIO pins across a resistor. The command to run the test will provide further instructions on how to set up the hardware:
```
npm run int
```

The tests use [mochajs](http://mochajs.org) as the test framework, and [Sinon.JS](http://sinonjs.org) to stub and mock out file system calls.
