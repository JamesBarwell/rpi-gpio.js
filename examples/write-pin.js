const gpio = require('../rpi-gpio');

async function main() {
  await gpio.setup(7, gpio.DIR_OUT);
  await gpio.write(7, true);
  console.log('Written to pin');
}

main();
