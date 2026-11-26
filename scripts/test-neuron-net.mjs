// Checks the hero's organic background: neurons form ONE connected network for every size and seed, each sends 1 or 2 axons,
// axons end on a dendrite tip of another neuron, most are 260 to 520 px long, dendrites branch 3 deep, and growing a new axon never splits the network.
import assert from 'node:assert/strict';
import { buildNet, assertNeuronsConnected, neuronsConnected, pickRegrow, mulberry, AXON_MIN, AXON_MAX } from '../src/scripts/neuron-net.ts';

const sizes = [[1440, 900, 45], [1920, 1080, 45], [2560, 1300, 45], [1100, 800, 45], [768, 1024, 30], [390, 844, 22], [360, 640, 22], [320, 568, 22]];
let nets = 0, axons = 0, inRange = 0;
for (const [w, h, target] of sizes) for (let seed = 1; seed <= 20; seed++) {
  const net = buildNet(w, h, target, seed); assertNeuronsConnected(net); nets++;
  assert.ok(net.neurons.length >= target * 0.8 && net.neurons.length <= target * 1.6, `${net.neurons.length} neurons for a target of ${target} at ${w}x${h}`);
  net.neurons.forEach((nu, i) => {
    assert.ok(nu.out.length >= 1, `neuron ${i} sends no axon at ${w}x${h} seed ${seed}`);
    assert.ok(nu.out.length <= 2, `neuron ${i} sends ${nu.out.length} axons`);
    const roots = net.segs.filter((s) => s.n === i && s.parent === -1).length;
    assert.ok(roots >= 4 && roots <= 7, `${roots} dendrites`);
    assert.equal(nu.segs.length, roots * 15, 'a dendrite is 3 levels of branching: 1+2+4+8 segments');
    assert.equal(nu.tips.length, roots * 8);
  });
  net.axons.forEach((a) => { axons++; assert.notEqual(a.from, a.to); assert.equal(net.segs[a.tip].n, a.to, 'axon does not end on a dendrite of its target'); assert.ok(net.segs[a.tip].depth === 3, 'axon must end on a dendrite tip'); if (a.length >= AXON_MIN && a.length <= AXON_MAX) inRange++; });
  if (seed === 1) console.log(`  ${w}x${h}: ${net.neurons.length} neurons, ${net.axons.length} axons, ${net.segs.length} dendrite segments`);
}
assert.ok(inRange / axons > 0.85, `only ${((inRange / axons) * 100).toFixed(0)} % of axons are ${AXON_MIN} to ${AXON_MAX} px long`);
// regrowth: retire an axon and grow another toward a different neuron, many times; the network must stay connected and the shape must change
{
  const net = buildNet(1440, 900, 45, 3), rand = mulberry(5); let done = 0; const shapes = new Set();
  for (let i = 0; i < 300; i++) {
    const g = pickRegrow(net, rand); if (!g) continue;
    net.axons.splice(net.axons.indexOf(g.old), 1); net.neurons[g.old.from].out = net.neurons[g.old.from].out.filter((a) => a !== g.old);
    g.fresh.state = 'live'; net.axons.push(g.fresh); net.neurons[g.fresh.from].out.push(g.fresh); done++;
    assert.ok(neuronsConnected(net), `network split after regrowth ${done}`); shapes.add(`${g.fresh.lat1.toFixed(4)}:${g.fresh.lat2.toFixed(4)}`);
  }
  assert.ok(done > 250 && shapes.size === done, `${done} regrowths, ${shapes.size} distinct shapes`);
  console.log(`  regrowth: ${done} axons replaced, network connected every time, every new shape different`);
}
// a deliberately split network must be refused
assert.throws(() => assertNeuronsConnected({ neurons: [{}, {}, {}], axons: [{ from: 0, to: 1 }] }), /not connected/);
console.log(`neuron network: ${nets} networks connected, ${axons} axons (${((inRange / axons) * 100).toFixed(0)} % within ${AXON_MIN} to ${AXON_MAX} px)`);
