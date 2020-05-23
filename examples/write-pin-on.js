//This example shows how to setup the pin for write mode with the default state as "on". Why do this? It can sometimes be useful to reverse the default initial state due to wiring or uncontrollable circumstances.
const gpio = require('../rpi-gpio');

async function main() {
  await gpio.setup(7, gpio.DIR_HIGH);
  await gpio.write(7, false);
  console.log('Written to pin');
}

main();
