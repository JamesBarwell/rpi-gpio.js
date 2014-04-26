var assert = require('assert');
var mocha  = require('mocha');
var sinon  = require('sinon');
var fs     = require('fs');
var path   = require('path');
var gpio   = require('../rpi-gpio.js');

var _proc_cpuinfo = 'Processor   : ARMv6-compatible processor rev 7 (v6l)\nBogoMIPS    : 697.95\nFeatures    : swp half thumb fastmult vfp edsp java tls\nCPU implementer : 0x41\nCPU architecture: 7\nCPU variant : 0x0\nCPU part    : 0xb76\nCPU revision    : 7\n\n\nHardware    : BCM2708\nRevision    : 0002\nSerial   : 000000009a5d9c22';

describe('rpi-gpio', function() {

    before(function() {
        sinon.stub(fs, 'writeFile').yieldsAsync();
        sinon.stub(fs, 'exists').yieldsAsync(false);
        sinon.stub(fs, 'watchFile').yieldsAsync();
        sinon.stub(fs, 'readFile').withArgs('/proc/cpuinfo').yieldsAsync(null, _proc_cpuinfo);
    });

    beforeEach(function() {
        gpio.reset();
        gpio.setMode(gpio.MODE_BCM);
        gpio.version = 1;

        fs.writeFile.reset();
        fs.exists.reset();
        fs.watchFile.reset();
    });

    describe('setMode', function() {
        it('should throw an error if the mode is invalid', function() {
            assert.throws(function() {
                gpio.setMode('invalid');
            }, Error);
        });
        it('should emit a modeChange event for RPI', function(done) {
            gpio.on('modeChange', function(mode) {
                assert.equal(mode, gpio.MODE_RPI);
                done();
            });
            gpio.setMode(gpio.MODE_RPI);
        });
        it('should emit a modeChange event for BCM', function(done) {
            gpio.on('modeChange', function(mode) {
                assert.equal(mode, gpio.MODE_BCM);
                done();
            });
            gpio.setMode(gpio.MODE_BCM);
        });
    });

    describe('cpuinfo parsing', function() {

        it('should return the revision', function() {
            var cpuInfo = gpio.parseCpuinfo(_proc_cpuinfo);
            assert.equal(cpuInfo, '0002');
        });
    });

    describe('setup()', function() {
        context('when run with an invalid channel', function() {
            var callback;

            beforeEach(function() {
                callback = sinon.spy();
                gpio.setup(null, null, callback);
            });

            it('should run the callback with an error if the channel if invalid', function() {
                sinon.assert.calledOnce(callback);

                var errorArg = callback.lastCall.args[0];
                assert.ok(errorArg);
            });
        });


        context('when the channel is already exported', function() {
            beforeEach(function(done) {
                fs.exists.yieldsAsync(true);

                gpio.setup(1, null, function() {
                    done();
                });
            });

            it('should unexport and export the channel', function() {
                sinon.assert.called(fs.writeFile);

                var args0 = fs.writeFile.getCall(0).args;
                assert.equal(args0[0], '/sys/class/gpio/unexport');
                assert.equal(args0[1], '1');

                var args1 = fs.writeFile.getCall(1).args;
                assert.equal(args1[0], '/sys/class/gpio/export');
                assert.equal(args1[1], '1');
            });
        });

        context('when the channel is not already exported', function() {
            beforeEach(function() {
                fs.exists.yieldsAsync(false);
            });

            context('and minimum arguments are specified', function() {
                var listener;

                beforeEach(function(done) {
                    listener = sinon.spy();
                    gpio.on('export', listener);

                    gpio.setup(1, null, function() {
                        done();
                    });
                });

                it('should export the channel', function() {
                    sinon.assert.called(fs.writeFile);

                    var args0 = fs.writeFile.getCall(0).args;
                    assert.equal(args0[0], '/sys/class/gpio/export');
                    assert.equal(args0[1], '1');
                });

                it('should emit an export event', function() {
                    // The emitted channel is the same format as given
                    sinon.assert.calledWith(listener, 1);
                });

                it('should set the channel direction to out by default', function() {
                    var args1 = fs.writeFile.getCall(1).args;
                    assert.equal(args1[0], '/sys/class/gpio/gpio1/direction');
                    assert.equal(args1[1], 'out');
                });

                it('should set up a file watcher for the value', function() {
                    var args = fs.watchFile.lastCall.args;
                    assert.equal(args[0], '/sys/class/gpio/gpio1/value');
                });
            });

            context('and direction is specified inwards', function() {
                beforeEach(function(done) {
                    gpio.setup(1, gpio.DIR_IN, function() {
                        done();
                    });
                });

                it('should set the channel direction', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[0], '/sys/class/gpio/gpio1/direction');
                    assert.equal(args[1], 'in');
                });
            });

            context('and direction is specified outwards', function() {
                beforeEach(function(done) {
                    gpio.setup(1, gpio.DIR_OUT, function() {
                        done();
                    });
                });

                it('should set the channel direction', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[0], '/sys/class/gpio/gpio1/direction');
                    assert.equal(args[1], 'out');
                });
            });

            context('and callback is specified', function() {
                var callback;

                beforeEach(function(done) {
                    function onSetupComplete () {
                        done();
                    }
                    callback = sinon.spy(onSetupComplete);
                    gpio.setup(1, callback);
                });

                it('should execute the callback when direction is missing', function() {
                    sinon.assert.called(callback);
                });
            });

        });

    });

    describe('write', function() {
        var callback;

        beforeEach(function(done) {
            gpio.setup(1, gpio.DIR_OUT, onSetup);

            callback = sinon.spy(onWrite);
            function onWrite() {
                done();
            }

            function onSetup() {
                gpio.write(1, true, callback);
            }
        });

        it('should write the value to the file system', function() {
            var args = fs.writeFile.lastCall.args;
            assert.equal(args[0], '/sys/class/gpio/gpio1/value');
            assert.equal(args[1], '1');

            sinon.assert.called(callback);
        });

        it('should normalise truthy values when writing', function() {
            [true, 1, '1'].forEach(function(truthyValue) {
                fs.writeFile.reset();
                gpio.write(1, truthyValue);
                var args = fs.writeFile.lastCall.args;
                assert.equal(args[1], '1');
            });
        });

        it('should normalise falsey values when writing', function() {
            [false, 0, '0'].forEach(function(falseyValue) {
                fs.writeFile.reset();
                gpio.write(1, falseyValue);
                var args = fs.writeFile.lastCall.args;
                assert.equal(args[1], '0');
            });
        });
    });

    describe('read', function() {
        var callback;

        context('when the pin is on', function() {
            beforeEach(function(done) {
                fs.readFile.yieldsAsync(null, '1');
                gpio.setup(1, gpio.DIR_IN, onSetup);

                callback = sinon.spy(onRead);
                function onRead() {
                    done();
                }

                function onSetup() {
                    gpio.read(1, callback);
                }
            });

            it('should read the value from the file system', function() {
                var args = fs.readFile.lastCall.args;
                assert.equal(args[0], '/sys/class/gpio/gpio1/value');
                sinon.assert.calledWith(callback, null, true);
            });
        });
    });

});
