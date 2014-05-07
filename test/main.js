var assert = require('assert');
var fs     = require('fs');
var mocha  = require('mocha');
var sinon  = require('sinon');
var gpio   = require('../rpi-gpio.js');

var cpuinfo = {
    v1: 'Processor   : ARMv6-compatible processor rev 7 (v6l)\nBogoMIPS    : 697.95\nFeatures    : swp half thumb fastmult vfp edsp java tls\nCPU implementer : 0x41\nCPU architecture: 7\nCPU variant : 0x0\nCPU part    : 0xb76\nCPU revision    : 7\n\n\nHardware    : BCM2708\nRevision    : 0002\nSerial   : 000000009a5d9c22',
    v2: 'Processor   : ARMv6-compatible processor rev 7 (v6l)\nBogoMIPS    : 697.95\nFeatures    : swp half thumb fastmult vfp edsp java tls\nCPU implementer : 0x41\nCPU architecture: 7\nCPU variant : 0x0\nCPU part    : 0xb76\nCPU revision    : 7\n\n\nHardware    : BCM2708\nRevision    : 0004\nSerial   : 000000009a5d9c22'
}

describe('rpi-gpio', function() {

    before(function() {
        sinon.stub(fs, 'writeFile').yieldsAsync();
        sinon.stub(fs, 'exists').yieldsAsync(false);
        sinon.stub(fs, 'watchFile').yieldsAsync();
        sinon.stub(fs, 'readFile')
            .withArgs('/proc/cpuinfo').yieldsAsync(null, cpuinfo.v1);
    });

    beforeEach(function() {
        gpio.reset();
        gpio.setMode(gpio.MODE_BCM);
        gpio.version = 1;

        fs.writeFile.reset();
        fs.exists.reset();
        fs.watchFile.reset();
    });

    describe('setMode()', function() {
        context('to RPI mode', function() {
            var listener;

            beforeEach(function() {
                listener = sinon.spy();
                gpio.on('modeChange', listener);

                gpio.setMode(gpio.MODE_RPI);
            });

            it('should emit a modeChange event and pass the mode callback', function() {
                sinon.assert.calledOnce(listener);
                sinon.assert.calledWith(listener, gpio.MODE_RPI);
            });
        });

        context('to BCM mode', function() {
            var listener;

            beforeEach(function() {
                listener = sinon.spy();
                gpio.on('modeChange', listener);

                gpio.setMode(gpio.MODE_BCM);
            });

            it('should emit a modeChange event and pass the mode callback', function() {
                sinon.assert.calledOnce(listener);
                sinon.assert.calledWith(listener, gpio.MODE_BCM);
            });
        });

        context('with an invalid mode', function() {
            var invalidModeSet;

            beforeEach(function() {
                invalidModeSet = function() {
                    gpio.setMode('invalid');
                };
            });

            it('should throw an error', function() {
                assert.throws(invalidModeSet, Error);
            });
        });
    });

    describe('parseCpuInfo()', function() {

        context('using Raspberry Pi revision 1 hardware', function() {
            var result;

            beforeEach(function() {
                result = gpio.parseCpuinfo(cpuinfo.v1);
            });

            it('should return the revision 0002', function() {
                assert.equal(result, '0002');
            });
        });

        context('using Raspberry Pi revision 2 hardware', function() {
            var result;

            beforeEach(function() {
                result = gpio.parseCpuinfo(cpuinfo.v2);
            });

            it('should return the revision 0004', function() {
                assert.equal(result, '0004');
            });
        });
    });

    describe('setup()', function() {
        context('when given an invalid channel', function() {
            var callback;

            beforeEach(function(done) {
                callback = sinon.spy(onSetupComplete);
                function onSetupComplete() {
                    done();
                }

                gpio.setup(null, null, callback);
            });

            it('should run the callback with an error', function() {
                sinon.assert.calledOnce(callback);
                assert.ok(callback.getCall(0).args[0]);
            });
        });


        context('when the channel is already exported', function() {
            beforeEach(function(done) {
                fs.exists.yieldsAsync(true);

                gpio.setup(1, null, function() {
                    done();
                });
            });

            it('should first unexport the channel', function() {
                var args0 = fs.writeFile.getCall(0).args;
                assert.equal(args0[0], '/sys/class/gpio/unexport');
                assert.equal(args0[1], '1');
            });


            it('should second export the channel', function() {
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

    describe('write()', function() {
        context('when writing to a pin', function() {
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
        });

        context('when given boolean true', function() {
            beforeEach(function() {
                gpio.write(1, true);
            });

            it('should normalise to string "1"', function() {
                sinon.assert.calledOnce(fs.writeFile);
                var args = fs.writeFile.lastCall.args;
                assert.equal(args[1], '1');
            });
        });

        context('when given number 1', function() {
            beforeEach(function() {
                gpio.write(1, 1);
            });

            it('should normalise to string "1"', function() {
                sinon.assert.calledOnce(fs.writeFile);
                var args = fs.writeFile.lastCall.args;
                assert.equal(args[1], '1');
            });
        });

        context('when given string "1"', function() {
            beforeEach(function() {
                gpio.write(1, 1);
            });

            it('should normalise to string "1"', function() {
                sinon.assert.calledOnce(fs.writeFile);
                var args = fs.writeFile.lastCall.args;
                assert.equal(args[1], '1');
            });
        });

        context('when given boolean false', function() {
            beforeEach(function() {
                gpio.write(1, false);
            });

            it('should normalise to string "0"', function() {
                sinon.assert.calledOnce(fs.writeFile);
                var args = fs.writeFile.lastCall.args;
                assert.equal(args[1], '0');
            });
        });

        context('when given number 0', function() {
            beforeEach(function() {
                gpio.write(1, 0);
            });

            it('should normalise to string "0"', function() {
                sinon.assert.calledOnce(fs.writeFile);
                var args = fs.writeFile.lastCall.args;
                assert.equal(args[1], '0');
            });
        });

        context('when given string "0"', function() {
            beforeEach(function() {
                gpio.write(1, '0');
            });

            it('should normalise to string "0"', function() {
                sinon.assert.calledOnce(fs.writeFile);
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

    describe('destroy', function() {
        context('when pins 1, 2, 3 have been exported', function() {
            var callback;
            var unexportPath = '/sys/class/gpio/unexport';

            beforeEach(function(done) {
                var i = 3;
                [1, 2, 3].forEach(function(pin) {
                    gpio.setup(pin, gpio.DIR_IN, function() {
                        if (--i === 0) {
                            onSetupComplete();
                        }
                    });
                });

                function onSetupComplete() {
                    fs.writeFile.reset();
                    gpio.destroy(callback);
                }

                callback = sinon.spy(onDestroy);
                function onDestroy() {
                    done();
                }
            });

            it('should unexport pin 1', function() {
                sinon.assert.calledWith(fs.writeFile, unexportPath, '1');
            });

            it('should unexport pin 2', function() {
                sinon.assert.calledWith(fs.writeFile, unexportPath, '2');
            });

            it('should unexport pin 3', function() {
                sinon.assert.calledWith(fs.writeFile, unexportPath, '3');
            });

        });
    });

    describe('pin value change', function() {
        var listener;

        beforeEach(function(done) {
            // @todo Must be sync yields, else the beforeEach completes
            // before the read finishes. Make this neater.
            fs.readFile.yields(null, '1');

            listener = sinon.spy();
            gpio.on('change', listener);

            gpio.setup(1, gpio.DIR_IN, onSetupComplete);

            function onSetupComplete() {
                var cb = fs.watchFile.getCall(0).args[1];
                cb();
                done();
            }
        });

        it('should emit a change event', function() {
            sinon.assert.calledWith(listener, 1, true);
        });
    });

    describe('pin translation', function() {

        context('when in RPI mode', function() {
            beforeEach(function() {
                gpio.setMode(gpio.MODE_RPI);
            });

            context('using Raspberry Pi revision 1 hardware', function() {
                beforeEach(function() {
                    fs.readFile.withArgs('/proc/cpuinfo').yieldsAsync(null, cpuinfo.v1);
                });

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

                Object.keys(map).forEach(function(rpiPin) {
                    var bcmPin = map[rpiPin];

                    context('writing to RPI pin ' + rpiPin, function() {
                        beforeEach(function(done) {
                            gpio.setup(rpiPin, gpio.DIR_IN, done);
                        });

                        it('should write to pin ' + bcmPin + ' (BCM)', function() {
                            assert.equal(fs.writeFile.getCall(0).args[1], bcmPin);
                        });
                    });
                });
            });

            context('using Raspberry Pi revision 2 hardware', function() {
                beforeEach(function() {
                    fs.readFile.withArgs('/proc/cpuinfo').yieldsAsync(null, cpuinfo.v2);
                });

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

                Object.keys(map).forEach(function(rpiPin) {
                    var bcmPin = map[rpiPin];

                    context('writing to RPI pin ' + rpiPin, function() {
                        beforeEach(function(done) {
                            gpio.setup(rpiPin, gpio.DIR_IN, done);
                        });

                        it('should write to pin ' + bcmPin + ' (BCM)', function() {
                            assert.equal(fs.writeFile.getCall(0).args[1], bcmPin);
                        });
                    });
                });
            });

        });

        describe('when in BCM mode', function() {
            beforeEach(function() {
                gpio.setMode(gpio.MODE_BCM);
            });

            var bcmPins = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

            bcmPins.forEach(function(bcmPin) {
                bcmPin += '';

                context('writing to BCM pin ' + bcmPin, function() {
                    beforeEach(function(done) {
                        gpio.setup(bcmPin, gpio.DIR_IN, done);
                    });

                    it('should write to the same pin ' + bcmPin + ' (BCM)', function() {
                        assert.equal(fs.writeFile.getCall(0).args[1], bcmPin);
                    });
                });
            });
        });
    });

});
