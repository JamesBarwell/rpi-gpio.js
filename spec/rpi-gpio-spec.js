describe('rpi-gpio', function() {

    var fs   = require('fs'),
        path = require('path'),
        gpio = require('../rpi-gpio.js');

    beforeEach(function() {
        // Use BCM by default to avoid dealing with pin mapping
        gpio.reset();
        gpio.setMode(gpio.MODE_BCM);
        gpio.setRaspberryVersion = function(cb) { cb(); };
        gpio.version = 1;
    });

    describe('setMode', function() {
        it('should throw an error if the mode is invalid', function() {
            expect(function() {
                gpio.setMode('invalid');
            }).toThrow(new Error('Cannot set invalid mode'));
        });
        it('should emit a modeChange event', function() {
            spyOn(gpio, 'emit');
            gpio.setMode(gpio.MODE_RPI);
            expect(gpio.emit).toHaveBeenCalledWith('modeChange', gpio.MODE_RPI);

            gpio.setMode(gpio.MODE_BCM);
            expect(gpio.emit).toHaveBeenCalledWith('modeChange', gpio.MODE_BCM);
        });
    });

    describe('cpuinfo parsing', function() {
        var data = 'Processor   : ARMv6-compatible processor rev 7 (v6l)\nBogoMIPS    : 697.95\nFeatures    : swp half thumb fastmult vfp edsp java tls\nCPU implementer : 0x41\nCPU architecture: 7\nCPU variant : 0x0\nCPU part    : 0xb76\nCPU revision    : 7\n\n\nHardware    : BCM2708\nRevision    : 0002\nSerial   : 000000009a5d9c22';

        it('should return the revision', function() {
            expect(gpio.parseCpuinfo(data)).toEqual('0002');
        });
    });

    describe('setup', function() {
        beforeEach(function() {
            spyOn(fs, 'writeFile').andCallFake(function(path, value, cb) { cb(); });
        });

        it('should throw an error if the channel if invalid', function() {
            var callback = jasmine.createSpy();
            gpio.setup(null, null, callback);
            expect(callback).toHaveBeenCalledWith(new Error('Channel not specified'));
        });

        describe('when the channel is already exported', function() {
            beforeEach(function() {
                spyOn((fs.exists ? fs : path), 'exists').andCallFake(function(path, cb) {
                    cb(true);
                });
                spyOn(fs, 'watchFile').andCallFake(function(path, cb) { });
                var callback = jasmine.createSpy();
                gpio.setup(1, null, callback);
            });
            it('should unexport and export the channel', function() {
                expect(fs.writeFile).toHaveBeenCalled();
                var args = fs.writeFile.calls[0].args;
                expect(args[0]).toEqual('/sys/class/gpio/unexport');
                expect(args[1]).toEqual('1');

                args = fs.writeFile.calls[1].args;
                expect(args[0]).toEqual('/sys/class/gpio/export');
                expect(args[1]).toEqual('1');
            });
        });

        describe('when the channel is not already exported', function() {
            describe('and minimum arguments are specified', function() {
                beforeEach(function() {
                    spyOn((fs.exists ? fs : path), 'exists').andCallFake(function(path, cb) {
                        cb(false);
                    });
                    spyOn(fs, 'watchFile').andCallFake(function(path, cb) {});
                    spyOn(gpio, 'emit');
                    gpio.setup(1);
                });
                it('should export the channel', function() {
                    expect(fs.writeFile).toHaveBeenCalled();
                    var args = fs.writeFile.calls[0].args;
                    expect(args[0]).toEqual('/sys/class/gpio/export');
                    expect(args[1]).toEqual('1');
                });
                it('should emit an export event', function() {
                    // The emitted channel is the same format as given
                    expect(gpio.emit).toHaveBeenCalledWith('export', 1);
                });
                it('should set the channel direction to out by default', function() {
                    var args = fs.writeFile.calls[1].args;
                    expect(args[0]).toEqual('/sys/class/gpio/gpio1/direction');
                    expect(args[1]).toEqual('out');
                });
                it('should set up a file watcher for the value', function() {
                    var args = fs.watchFile.mostRecentCall.args;
                    expect(args[0]).toEqual('/sys/class/gpio/gpio1/value');
                });
            });
            describe('and direction is specified', function() {
                beforeEach(function() {
                    spyOn((fs.exists ? fs : path), 'exists').andCallFake(function(path, cb) {
                        cb(false);
                    });
                    spyOn(fs, 'watchFile').andCallFake(function(path, cb) { });
                });
                it('should set the channel direction', function() {
                    var callback = jasmine.createSpy();
                    // Input
                    gpio.setup(1, gpio.DIR_IN, callback);
                    var args = fs.writeFile.calls[1].args;
                    expect(args[0]).toEqual('/sys/class/gpio/gpio1/direction');
                    expect(args[1]).toEqual('in');

                    // Output
                    fs.writeFile.reset();
                    gpio.setup(1, gpio.DIR_OUT, callback);
                    var args = fs.writeFile.calls[1].args;
                    expect(args[0]).toEqual('/sys/class/gpio/gpio1/direction');
                    expect(args[1]).toEqual('out');
                });
            });
            describe('and callback is specified', function() {
                beforeEach(function() {
                    spyOn((fs.exists ? fs : path), 'exists').andCallFake(function(path, cb) {
                        cb(false);
                    });
                    spyOn(fs, 'watchFile').andCallFake(function(path, cb) { });
                });
                it('should execute the callback when direction is missing', function() {
                    var callback = jasmine.createSpy();
                    gpio.setup(1, callback);
                    expect(callback).toHaveBeenCalled();
                });
            });
        });
    });

    describe('write', function() {
        beforeEach(function() {
            spyOn(fs, 'writeFile').andCallFake(function(path, value, cb) { cb(); });
            spyOn((fs.exists ? fs : path), 'exists').andCallFake(function(path, cb) {
                cb(false);
            });
            spyOn(fs, 'watchFile').andCallFake(function(path, cb) { });
            var callback = jasmine.createSpy();
            gpio.setup(1, gpio.DIR_OUT, callback);
        });

        it('should write the value to the file system', function() {
            var callback = jasmine.createSpy();
            gpio.write(1, true, callback);
            var args = fs.writeFile.mostRecentCall.args;
            expect(args[0]).toEqual('/sys/class/gpio/gpio1/value');
            expect(args[1]).toEqual('1');
            expect(callback).toHaveBeenCalled();
        });
        it('should normalise truthy values when writing', function() {
            [true, 1, '1'].forEach(function(truthyValue) {
                fs.writeFile.reset();
                gpio.write(1, truthyValue);
                expect(fs.writeFile.mostRecentCall.args[1]).toEqual('1');
            });
        });
        it('should normalise falsey values when writing', function() {
            [false, 0, '0'].forEach(function(falseyValue) {
                fs.writeFile.reset();
                gpio.write(1, falseyValue);
                expect(fs.writeFile.mostRecentCall.args[1]).toEqual('0');
            });
        });
    });

    describe('read', function() {
        beforeEach(function() {
            spyOn(fs, 'writeFile').andCallFake(function(path, value, cb) { cb(); });
            spyOn((fs.exists ? fs : path), 'exists').andCallFake(function(path, cb) {
                cb(false);
            });
            spyOn(fs, 'watchFile').andCallFake(function(path, cb) { });
            spyOn(fs, 'readFile').andCallFake(function(path, encoding, cb) { cb(null, '1'); });
            var callback = jasmine.createSpy();
            gpio.setup(1, gpio.DIR_IN, callback);
        });
        it('should read the value from the file system', function() {
            var callback = jasmine.createSpy();
            gpio.read(1, callback);
            var args = fs.readFile.mostRecentCall.args;
            expect(args[0]).toEqual('/sys/class/gpio/gpio1/value');
            expect(callback).toHaveBeenCalledWith(null, true);
        });
    });

    describe('destroy', function() {
        beforeEach(function() {
            spyOn(fs, 'writeFile').andCallFake(function(path, value, cb) { cb(); });
            spyOn((fs.exists ? fs : path), 'exists').andCallFake(function(path, cb) {
                cb(false);
            });
            spyOn(fs, 'watchFile').andCallFake(function(path, cb) { });
            var callback = jasmine.createSpy();
            [1, 2, 3].forEach(function(pin) {
                gpio.setup(pin, gpio.DIR_IN, callback);
            });
        });
        it('should unexport any exported pins', function() {
            var callback = jasmine.createSpy();
            fs.writeFile.reset();
            gpio.destroy(callback);

            var unexportPath = '/sys/class/gpio/unexport';
            var pathsExported = [];
            expect(fs.writeFile.calls[0].args[0]).toEqual(unexportPath);
            expect(fs.writeFile.calls[1].args[0]).toEqual(unexportPath);
            expect(fs.writeFile.calls[2].args[0]).toEqual(unexportPath);

            // Paths are unexported in reverse order, so just get them
            // into an array and sort before asserting
            [0,1,2].forEach(function(callNumber) {
                pathsExported.push(fs.writeFile.calls[callNumber].args[1]);
            });
            pathsExported.sort();

            expect(pathsExported[0]).toEqual('1');
            expect(pathsExported[1]).toEqual('2');
            expect(pathsExported[2]).toEqual('3');
            expect(callback).toHaveBeenCalled();
        });
    });

    describe('pin value change', function() {
        var fileChangeCallback;
        beforeEach(function() {
            spyOn(fs, 'writeFile').andCallFake(function(path, value, cb) { cb(); });
            spyOn((fs.exists ? fs : path), 'exists').andCallFake(function(path, cb) {
                cb(false);
            });
            spyOn(fs, 'watchFile').andCallFake(function(path, cb) {
                fileChangeCallback = cb;
            });
            spyOn(fs, 'readFile').andCallFake(function(path, encoding, cb) {
                cb(null, '1');
            });
            spyOn(gpio, 'emit');
            var callback = jasmine.createSpy();
            gpio.setup(1, gpio.DIR_IN, callback);
        });
        it('should emit a change event', function() {
            // Manually trigger the event as if the pin value had changed
            fileChangeCallback();
            expect(gpio.emit).toHaveBeenCalledWith('change', 1, true);
        });
    });

    describe('pin translation', function() {
        beforeEach(function() {
            spyOn(fs, 'writeFile').andCallFake(function(path, value, cb) { cb(); });
            spyOn((fs.exists ? fs : path), 'exists').andCallFake(function(path, cb) {
                cb(false);
            });
            spyOn(fs, 'watchFile').andCallFake(function(path, cb) { });
        });
        describe('when in RPI mode', function() {
            beforeEach(function() {
                gpio.setMode(gpio.MODE_RPI);
            });
            describe('when using the raspberry pi v1', function() {
                beforeEach(function() {
                    gpio.version = 1;
                });
                it('should map the RPI pin to the BCM pin', function() {
                    var map = {
                        // RPI to BCM
                        '3':  '0',
                        '5':  '1',
                        '7':  '4',
                        '8':  '14',
                        '10': '15',
                        '11': '17',
                        '12': '18',
                        '13': '21',
                        '15': '22',
                        '16': '23',
                        '18': '24',
                        '19': '10',
                        '21': '9',
                        '22': '25',
                        '23': '11',
                        '24': '8',
                        '26': '7'
                    }

                    for (var rpiPin in map) {
                        var bcmPin = map[rpiPin];
                        var callback = jasmine.createSpy();
                        fs.writeFile.reset();
                        gpio.setup(rpiPin, gpio.DIR_IN, callback);
                        expect(fs.writeFile.calls[0].args[1]).toEqual(bcmPin);
                    }
                });
            });
            describe('when using the raspberry pi v2', function() {
                beforeEach(function() {
                    gpio.version = 2;
                });
                it('should map the RPI pin to the BCM pin', function() {
                    var map = {
                        // RPI to BCM
                        '3':  '2',
                        '5':  '3',
                        '7':  '4',
                        '8':  '14',
                        '10': '15',
                        '11': '17',
                        '12': '18',
                        '13': '27',
                        '15': '22',
                        '16': '23',
                        '18': '24',
                        '19': '10',
                        '21': '9',
                        '22': '25',
                        '23': '11',
                        '24': '8',
                        '26': '7'
                    }

                    for (var rpiPin in map) {
                        var bcmPin = map[rpiPin];
                        var callback = jasmine.createSpy();
                        fs.writeFile.reset();
                        gpio.setup(rpiPin, gpio.DIR_IN, callback);
                        expect(fs.writeFile.calls[0].args[1]).toEqual(bcmPin);
                    }
                });
            });
        });
        describe('when in BCM mode', function() {
            beforeEach(function() {
                gpio.setMode(gpio.MODE_BCM);
            });
            it('should return the untranslated BCM pin', function() {
                [1,2,3,4,5,6,7,8,9,10].forEach(function(bcmPin) {
                    bcmPin = bcmPin + '';
                    var callback = jasmine.createSpy();
                    fs.writeFile.reset();
                    gpio.setup(bcmPin, gpio.DIR_IN, callback);
                    expect(fs.writeFile.calls[0].args[1]).toEqual(bcmPin);
                });
            });
        });
    });

});
