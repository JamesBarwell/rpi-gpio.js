const gpio = require('../rpi-gpio');

async function main() {
  await gpio.setup(7, gpio.DIR_IN);
  const value = await gpio.read(7)
  console.log('The value is ' + value);
}

main();
