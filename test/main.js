var assert = require('assert');
var mocha  = require('mocha');
var sinon  = require('sinon');
var fs     = require('fs');
var path   = require('path');
var gpio   = require('../rpi-gpio.js');

var _proc_cpuinfo = 'Processor   : ARMv6-compatible processor rev 7 (v6l)\nBogoMIPS    : 697.95\nFeatures    : swp half thumb fastmult vfp edsp java tls\nCPU implementer : 0x41\nCPU architecture: 7\nCPU variant : 0x0\nCPU part    : 0xb76\nCPU revision    : 7\n\n\nHardware    : BCM2708\nRevision    : 0002\nSerial   : 000000009a5d9c22';

describe('rpi-gpio', function() {

    before(function() {
        sinon.stub(fs, 'writeFile');
        sinon.stub(fs, 'exists');
        sinon.stub(fs, 'watchFile');
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
            var callback;

            beforeEach(function(done) {
                fs.writeFile.yields();
                fs.exists.yields(true);

                callback = sinon.spy();
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
    });

});
